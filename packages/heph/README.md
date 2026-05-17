# Heph

Heph is under active pre-release development. APIs and package structure may
change while the runtime is tested in real applications.

Heph is a TypeScript runtime for durable web agents built for Hono-based
application servers. It gives your server the pieces around an agent loop:
sessions, runs, tools, event logs, approvals, queues, and HTTP/SSE APIs.

Heph does not replace a model client or an in-memory agent loop. Hono can expose
the HTTP/SSE surface, `pi-agent-core` can decide when to call tools, and Heph
records and controls the durable runtime path around that execution.

## Install

```sh
pnpm add @otakumesi/heph hono zod @mariozechner/pi-agent-core @mariozechner/pi-ai
```

## Entrypoints

```ts
import { AgentSpec, Tool, createHeph } from "@otakumesi/heph";
import { createHephRouter } from "@otakumesi/heph/hono";
```

Other adapter entrypoints:

- `@otakumesi/heph/hono`
- `@otakumesi/heph/sqlite`
- `@otakumesi/heph/worker`
- `@otakumesi/heph/mcp`
- `@otakumesi/heph/skills`

## What Heph Provides

- Durable `AgentSession` and `Run` state
- Run-scoped `ToolManifest` snapshots
- Tool lifecycle events: `tool.started`, `tool.completed`, `tool.failed`
- HTTP APIs for creating agents, appending messages, reading runs, and reading events
- SSE replay from the persisted EventLog
- Auth context propagation into tools
- Approval, cancellation, and deferred-result hooks
- Queue-based execution so web routes can enqueue long-running agent work
- Hono routing helpers, SQLite stores, worker helpers, and CLI adapters

## Tool Bridge

Call Heph from your agent-loop tool implementation:

```ts
const toolCall = await ctx.tools.tryCall({
  toolId: "addNumbers",
  input: params
});

if (!toolCall.ok) {
  throw new Error(toolCall.error.message);
}
```

`ctx.tools.tryCall()` records `tool.failed` and returns the failure so an agent
loop can notify the model and continue. `ctx.tools.call()` is the stricter API:
it throws on tool failure, which is useful when the whole Run should fail.

## Documentation

- Repository: https://github.com/otakumesi/heph
- Minimal tutorial: https://github.com/otakumesi/heph/blob/main/docs/tutorials/minimal-tool-agent.md
