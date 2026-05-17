# Minimal Tool Agent

This tutorial walks through the smallest useful Heph application: a Hono server
with one agent, one tool, and one HTTP API that you can call with `curl`.

It is designed for readers who are new to agent applications. You do not need an
LLM provider key for this example. The runnable app uses `pi-ai`'s faux provider,
so the model behavior is deterministic while still exercising the real
agent-loop and tool-call path.

## Install Heph

For an application, install the public package:

```sh
pnpm add @otakumesi/heph hono zod @mariozechner/pi-agent-core @mariozechner/pi-ai
```

This tutorial uses the repository example so you can run the complete server
without creating files by hand.

## What You Will Build

The example has three layers:

- Hono exposes the web server and routes.
- pi runs the in-memory agent loop and decides to call a tool.
- Heph stores the durable runtime state: sessions, runs, tool manifests, events,
  and SSE replay.

The request flow is:

1. A client calls `POST /api/heph/agents`.
2. Heph creates an `AgentSession` and a `Run`.
3. The `RunExecutor` starts a pi `Agent`.
4. The faux model asks pi to call `addNumbers`.
5. The pi tool bridge calls Heph with `ctx.tools.tryCall()`.
6. Heph validates and executes the tool, then writes tool lifecycle events.
7. The executor stores the final assistant message.
8. A client reads the run, events, or SSE stream with `curl`.

## Run It First

Start from the Heph repository root:

```sh
pnpm install
pnpm --filter @heph/example-minimal-tool-agent start
```

The server listens on `http://localhost:3333`.

Create an agent session and initial run:

```sh
curl -s -X POST http://localhost:3333/api/heph/agents \
  -H "Content-Type: application/json" \
  -d '{"spec":"calculator","input":"add 2 and 3"}'
```

The response includes `agent_id` and `run_id`. Save the run id:

```sh
RUN_ID=run_xxx
```

Read the run state:

```sh
curl -s http://localhost:3333/api/heph/runs/$RUN_ID
```

Read the run events:

```sh
curl -s http://localhost:3333/api/heph/runs/$RUN_ID/events
```

You should see events such as:

```text
tool_manifest.created
run.started
tool.started
tool.completed
message.completed
run.completed
```

Stream the same events with SSE:

```sh
curl -N http://localhost:3333/api/heph/runs/$RUN_ID/stream
```

## The Agent And Tool

An agent is the developer-defined thing that can run. A tool is a function the
agent loop may ask to execute.

In this example, the agent is called `calculator`, and it has one tool:
`addNumbers`.

```ts
import { AgentSpec, Tool } from "@otakumesi/heph";
import { z } from "zod";

const addNumbers = Tool.define({
  id: "addNumbers",
  description: "Add two numbers and return the sum.",
  inputSchema: z.object({
    left: z.number(),
    right: z.number()
  }),
  sideEffect: false,
  requiresApproval: false,
  execute: addNumbersHandler
});

function addNumbersHandler(input: { left: number; right: number }) {
  return {
    left: input.left,
    right: input.right,
    sum: input.left + input.right
  };
}

const calculatorAgent = AgentSpec.define({
  id: "calculator",
  instructions: "Use tools to answer arithmetic questions.",
  tools: [addNumbers]
});
```

Important details:

- `inputSchema` validates tool input before execution.
- `sideEffect: false` marks this as a read-only/safe tool.
- `requiresApproval: false` lets the tool run without a human approval step.
- `execute` can be an inline function or a separately defined function.

## The pi Tool Bridge

pi and Heph both need to know about tools, but for different reasons.

pi needs a model-facing tool definition so the agent loop can call it. Heph
needs to execute that tool through the durable runtime path so it can validate
input, inherit auth, handle cancellation, and write events.

The bridge is the pi tool's `execute` function:

```ts
import { type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { RunExecutor } from "@otakumesi/heph";

function createPiToolBridge(ctx: Parameters<RunExecutor["execute"]>[0]): AgentTool<any> {
  return {
    name: "addNumbers",
    label: "Add numbers",
    description: "Add two numbers and return the sum.",
    parameters: Type.Object({
      left: Type.Number(),
      right: Type.Number()
    }),
    async execute(_toolCallId, params) {
      const toolCall = await ctx.tools.tryCall({
        toolId: "addNumbers",
        input: params
      });

      if (!toolCall.ok) {
        throw new Error(toolCall.error.message);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(toolCall.result) }],
        details: toolCall.result
      };
    }
  };
}
```

Use `ctx.tools.tryCall()` for agent loops. It records `tool.failed` in Heph, then
returns `{ ok: false, error }` so the bridge can surface the failure as a pi tool
error. That lets the next model turn decide whether to retry or change approach.

Use `ctx.tools.call()` when a tool failure should throw out of the executor and
fail the whole Heph run.

## The Faux Model

The example uses `pi-ai`'s faux provider instead of a real LLM provider. This
keeps the tutorial credential-free while still using pi's normal tool-call path.

```ts
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";

function createFauxToolCallingModel() {
  const faux = registerFauxProvider({
    models: [{ id: "heph-minimal-tool-agent" }],
    tokensPerSecond: 0
  });

  faux.setResponses([
    () => fauxAssistantMessage(fauxToolCall("addNumbers", { left: 2, right: 3 })),
    () => fauxAssistantMessage("2 + 3 = 5")
  ]);

  return faux.getModel();
}
```

In a real application, this is the part you replace with another `pi-ai` model
provider. The Heph HTTP API and tool runtime do not need to change.

## The Run Executor

The `RunExecutor` is where application code connects Heph's durable run to the
agent loop.

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import type { RunExecutor } from "@otakumesi/heph";

const executor: RunExecutor = {
  async execute(ctx) {
    const agent = new Agent({
      sessionId: ctx.agent.id,
      toolExecution: "sequential",
      initialState: {
        systemPrompt: "You are a concise calculator agent.",
        model: createFauxToolCallingModel(),
        thinkingLevel: "off",
        messages: [{ role: "user", content: runInputText(ctx.run), timestamp: Date.now() }],
        tools: [createPiToolBridge(ctx)]
      }
    });

    await agent.continue();

    const content = latestAssistantText(agent.state.messages);
    await ctx.appendMessage({
      role: "assistant",
      content,
      sourceRunId: ctx.run.id
    });
  }
};
```

The executor is intentionally small:

- It creates the pi agent.
- It passes the current Heph run input as the user message.
- It passes the pi tool bridge.
- It stores the final assistant message back into Heph.

## Mount Heph In Hono

The Hono app owns the web server. Heph contributes a router that exposes the
agent/runtime APIs.

```ts
import { Hono } from "hono";
import { createHeph } from "@otakumesi/heph";
import { createDevAuth, createHephRouter } from "@otakumesi/heph/hono";

const heph = createHeph({
  agents: [calculatorAgent],
  executor
});

const app = new Hono();

app.route(
  "/api/heph",
  createHephRouter({
    heph,
    getAuth: createDevAuth({ subject: "example-user" })
  })
);
```

`createDevAuth()` is only for local development. In a real Hono app, you would
usually adapt your existing auth/session system and return the current user from
`getAuth`.

## Published Package

The public package is `@otakumesi/heph`.

```sh
pnpm add @otakumesi/heph hono zod @mariozechner/pi-agent-core @mariozechner/pi-ai
```

It provides the main runtime and adapter entry points used in this tutorial:

```ts
import { AgentSpec, Tool, createHeph } from "@otakumesi/heph";
import { createHephRouter } from "@otakumesi/heph/hono";
```

## What Heph Adds Around pi

`pi-agent-core` and `pi-ai` provide the model-facing execution layer:

- model/provider selection through `pi-ai`
- the in-memory agent loop through `pi-agent-core`
- model-facing messages and tool calls
- pi tool execution hooks
- streaming agent events inside one process

Heph provides the server-side runtime around that layer:

- durable `AgentSession` and `Run` records
- Run-scoped `ToolManifest` snapshots
- HTTP APIs for agent creation, message append, run inspection, cancellation,
  and event reads
- SSE replay from the persisted EventLog
- tool lifecycle events for audit/debugging
- auth context propagation into tool execution
- approval, cancellation, and deferred-result hooks around tools
- queue-based execution so Hono routes enqueue work instead of doing long agent
  work inline

The important idea is separation of responsibilities: pi decides what the agent
does next, Hono exposes the web surface, and Heph makes the runtime durable and
observable.

## Next Steps

After this example, try replacing one piece at a time:

- Replace the faux model with a real `pi-ai` provider.
- Add a second tool and inspect the emitted events.
- Change `requiresApproval` to `true` and observe the approval flow.
- Replace `createDevAuth()` with your Hono app's real auth adapter.
- Move from in-process/local development stores to durable stores and a queue.
