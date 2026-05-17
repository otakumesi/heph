# Heph

Heph is under active pre-release development. APIs and package structure may
change while the runtime is tested in real applications.

Heph is a TypeScript runtime for durable web agents built for Hono-based
application servers. It gives your server the pieces around an agent loop:
sessions, runs, tools, event logs, approvals, queues, and HTTP/SSE APIs.

Heph does not try to replace a model client or an in-memory agent loop. For
example, Hono can expose the HTTP/SSE surface, `pi-agent-core` can decide when
to call tools, and Heph can record and control the server-side runtime path
around that execution.

## Minimal Start

Install the public package in a Hono app:

```sh
pnpm add @otakumesi/heph hono zod @mariozechner/pi-agent-core @mariozechner/pi-ai
```

The repository includes a runnable Hono server with a minimal tool-executing
agent if you want to try the full flow immediately:

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

Inspect the run and events:

```sh
curl -s http://localhost:3333/api/heph/runs/$RUN_ID
curl -s http://localhost:3333/api/heph/runs/$RUN_ID/events
curl -N http://localhost:3333/api/heph/runs/$RUN_ID/stream
```

See the full walkthrough in
[docs/tutorials/minimal-tool-agent.md](docs/tutorials/minimal-tool-agent.md).

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

## Relationship To Agent Loops

Use your model and agent-loop library for model-facing behavior:

- model/provider selection
- prompt and message conversion
- tool-call planning
- streaming model output
- deciding whether to retry after a tool error

Use Heph for application/runtime behavior:

- creating and scheduling runs
- validating Run-scoped tool availability
- executing tools through the Heph runtime
- recording auditable events
- exposing state and events over HTTP/SSE

For a tool bridge, call Heph from the agent-loop tool implementation:

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

## Packages

- `@otakumesi/heph`: public package that re-exports the core runtime and adapters
- internal workspace packages:
  - `@heph/core`: framework-independent runtime
  - `@heph/server-hono`: Hono HTTP/SSE adapter
  - `@heph/sqlite`: SQLite stores and queue adapters
  - `@heph/worker`: worker helpers for queue consumers
  - `@heph/cli`: CLI scaffold and inspection commands

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Build a local tarball for pre-publish testing:

```sh
pnpm --filter @otakumesi/heph build
pnpm --filter @otakumesi/heph pack --pack-destination packages/heph
```

The package is published as `@otakumesi/heph`.

## Name

Heph is short for Hephaestus, the smith god of fire and craft.

The name reflects the role of the library: a forge where Hono's web application
surface and pi's agent loop are shaped into a durable agent runtime. Hono brings
HTTP, routing, middleware, and deployment fit. pi brings model-facing agent
execution. Heph binds those pieces with persistent runs, tool manifests, event
logs, queues, and runtime controls.
