# Minimal Tool Agent

This example starts a Hono server with Heph mounted at `/api/heph`.

The important part is that a client drives Heph through HTTP while the executor
uses `pi-agent-core` and `pi-ai` to run an agent loop:

- `POST /api/heph/agents` creates an AgentSession and initial Run.
- The executor creates a pi `Agent` with a `pi-ai` faux model.
- The pi agent emits a tool call.
- The pi tool implementation bridges into Heph with `ctx.tools.tryCall()`.
- `GET /api/heph/runs/:runId` returns Run state.
- `GET /api/heph/runs/:runId/events` shows the Heph tool lifecycle events.
- `GET /api/heph/runs/:runId/stream` streams the same events as SSE.

The faux model keeps the tutorial deterministic and credential-free while still
using pi's agent/model/tool-call path.

## What Heph Adds Around pi

`pi-agent-core` and `pi-ai` provide the in-memory agent loop, model/provider
abstraction, transcript handling, and model-facing tool-call protocol.

Heph adds the application/server runtime around that loop:

- durable AgentSession and Run records
- Run-scoped ToolManifest snapshots
- HTTP APIs for creating agents, scheduling runs, reading run state, and reading events
- SSE replay from EventLog
- tool lifecycle events for audit/debugging
- auth context propagation into tools
- approval/cancellation/deferred-result hooks around tool execution
- queue-based execution so Hono routes do not run long agent work inline

In this example, pi decides to call `addNumbers`; Heph validates and executes
that tool through `ctx.tools.tryCall()` and records the runtime events. Tool
failures become pi error tool results, so the next model turn can decide whether
to retry or change approach without failing the whole Heph Run.

## Run

From the Heph repository root:

```sh
pnpm install
pnpm --filter @heph/example-minimal-tool-agent start
```

The server listens on `http://localhost:3333` by default.

## Call The Heph API

Create an agent and initial run:

```sh
curl -s -X POST http://localhost:3333/api/heph/agents \
  -H "Content-Type: application/json" \
  -d '{"spec":"calculator","input":"add 2 and 3"}'
```

The response includes `agent_id` and `run_id`.

Inspect the Run:

```sh
curl -s http://localhost:3333/api/heph/runs/$RUN_ID
```

Inspect the Run events:

```sh
curl -s http://localhost:3333/api/heph/runs/$RUN_ID/events
```

The events should include:

```text
tool_manifest.created
tool.started
tool.completed
message.completed
run.completed
```

Stream events with SSE:

```sh
curl -N http://localhost:3333/api/heph/runs/$RUN_ID/stream
```

## What The Executor Does

The executor creates a pi agent and gives it a pi tool whose `execute` function
delegates to Heph:

```ts
const agent = new Agent({
  initialState: {
    model: createFauxToolCallingModel(),
    messages: [{ role: "user", content: runInputText(ctx.run), timestamp: Date.now() }],
    tools: [createPiToolBridge(ctx)]
  }
});

function createPiToolBridge(ctx: RunExecutionContext): AgentTool<any> {
  return {
    name: "addNumbers",
    async execute(_toolCallId, params) {
      const toolCall = await ctx.tools.tryCall({
        toolId: "addNumbers",
        input: params
      });
      if (!toolCall.ok) {
        throw new Error(toolCall.error.message);
      }
      return jsonToolResult(toolCall.result, "added numbers");
    }
  };
}
```

This keeps validation, approval rules, cancellation, and tool events inside the
Heph runtime path. Use `ctx.tools.call()` when a tool failure should fail the
Run; use `ctx.tools.tryCall()` when the agent loop should receive the failure as
tool feedback and continue.
