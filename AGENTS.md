# AGENTS.md

## Project

This repository implements Heph (`heph`), a TypeScript framework for building web-facing AI agent servers on top of Hono and `pi-agent-core`.

Heph is short for Hephaestus, the mythic smith god of fire and craft. Use `Heph` as the product name and `heph` as the CLI / main npm package name.

## Core concepts

- `agent_id` in public APIs means AgentSession ID.
- `agent_spec_id` means reusable developer-defined AgentSpec ID.
- AgentSpec is developer-defined code.
- AgentSession is runtime-created durable state.
- Run is one execution.
- MessageStore, EventLog, StateStore, and MemoryStore must remain separate.
- Memory is not state, not message history, and not event log. Memory is a scoped retrieval layer with source refs.
- Context is rendered per Run.
- ContextTemplate may be application-editable, but ContextRenderer and safety controls are runtime-owned.
- Default ContextTemplate is provided by Heph and placed into the app by `heph init` as an editable application-owned file.
- SSE streams are backed by EventLog.
- Queue is a dispatch/wake-up mechanism, not source of truth. Store and EventLog are source of truth.
- Worker/executor is generic Run execution machinery, not one process per agent.
- Auth is adapter-based. Do not implement login/signup in core.
- Default browser auth should be cookie-session friendly for SSE. Prefer sharing the host app session when mounted into an existing Hono app.

## Scope boundaries

- Heph is not a terminal coding agent.
- Heph is a web-facing agent server framework for Hono and pi-agent-core.
- If documentation needs to describe terminal-operated coding agents, recommend Pi / `pi-coding-agent` instead of reimplementing that UX in Heph.
- Do not add terminal TUI behavior, shell-first coding-agent UX, or pi-coding-agent replacement features to Heph core.

## Implementation rules

- Keep framework internals hidden behind library APIs.
- Keep user-defined components scaffoldable and editable.
- Keep init-generated shell files editable.
- Keep build-generated files clearly marked as generated.
- Do not over-implement future phases.
- Prefer small focused changes.
- Add tests for new behavior.
- Run typecheck and tests before final response.

## Package conventions

- `packages/core`: framework-independent core.
- `packages/heph`: public umbrella package for Heph.
- `packages/server-hono`: Hono adapter and router module.
- `packages/worker`: queue worker and run executor.
- `packages/cli`: scaffolding and inspect commands.
- Optional adapters live under package-specific folders.

## Coding style

- TypeScript first.
- Prefer explicit interfaces.
- Avoid framework dependencies in core.
- Avoid importing Hono into core.
- Avoid importing Better Auth into core.
- Use dependency inversion for stores, queues, auth, memory, MCP, skills, and A2A.
- Keep public APIs stable and documented.

## Naming

- Product name: Heph.
- CLI name: `heph`.
- Main npm package: `heph`.
- `Hephaestus` appears only in origin/name explanation.
- Fallback package candidate: `hepha`.
- Use `createHeph`, `createHephRouter`, and `createHephApp` for public APIs.
- Do not use `createHephaestus` in new code.
- Do not use `agent-rocket` in new code or documentation.

## Hono integration

- Provide both standalone app and router-module integration.
- Existing Hono apps should be able to mount Heph with `app.route(...)`.
- Router integration must support `getAuth(c)` so the host app can pass its existing authenticated session.
- Do not force a separate auth system when Heph is embedded in an existing app.

## Context Template

- Heph provides a default ContextTemplate.
- `heph init` should place `src/context-templates/default.template.ts` into the app.
- The generated default template is application-owned and editable.
- AgentSpec may omit `contextTemplate` and use the default.
- AgentSpec may provide an agent-specific template.
- ContextTemplate controls wording and slot layout.
- ContextRenderer controls runtime safety: platform policy, security policy, tool policy injection, tenant boundary, secret redaction, token budgeting, required slots, context manifest, and template versioning.
- Default context should follow proven OSS agent patterns: policy first, agent identity second, current task/state before history, selected skills as instruction-only blocks, bounded retrieved memory with source refs, condensed history before recent messages, optional domain/workspace context, and Run-scoped ToolManifest.
- Do not put full message history, full MemoryStore contents, full EventLog, all skills, or all external documents into the default context.
- Condensed history and recent messages must be separate blocks. Recent messages must be bounded. Older history should be represented by summaries/condensation.
- Memory must enter context through MemoryContextProvider with source refs and must remain separate from state/message/event logs.
- ToolManifest must be Run-scoped and reflect only tools available to that Run.
- ContextManifest must record template version, block ids, source refs, and token counts.

## Deployment modes

- Support `single-process` for dev and PoC: web + local in-process queue + scheduler/reducer + RunExecutor in one process.
- Support `platform-queue`: HTTP handler and queue consumer handler in the same application release / platform stack, using a platform-managed queue such as Cloudflare Queues, Vercel Queues, or SQS + Lambda.
- Support `split-worker` for production: API and worker are separate deployment/release boundaries sharing Queue, Store, and EventLog.
- Queue is not source of truth. Store and EventLog are source of truth.
- Server and worker should coordinate through Queue, Store, and EventLog, not direct RPC.
- Do not hold long-running execution inside a Hono route handler. Even single-process mode should use a local queue.
- In SQS + Lambda adapters, account for at-least-once delivery, partial batch response, leases/idempotency, visibility timeout, DLQ, and Lambda's 15-minute invocation ceiling.

## Memory architecture

- Keep MessageStore, EventLog, StateStore, and MemoryStore as separate concepts and interfaces.
- Do not use MemoryStore as durable runtime state.
- Do not use run_events as direct RAG memory.
- Do not use message history as EventLog.
- Memory items must include scope and sourceRefs.
- Memory writes must go through policy. Do not store credentials, temporary secrets, or raw large tool results by default.
- Use MemoryContextProvider to retrieve memory into context.
- Optional memory tools may exist, but they must record audit events and source refs.

## Skills architecture

- Skills are reusable workflow/domain-expertise packages, not tools, not memory, and not event logs.
- Skills are a runtime specification/loading contract in the MVP, not a CLI-generated user component.
- Do not add `heph add skill` or skill scaffolding commands in the MVP.
- Prefer Agent Skills compatible folder format when a host app or existing skill system provides skills: `skills/<name>/SKILL.md` plus optional `references/`, `assets/`, and `templates/`.
- Do not support `scripts/` in Skills.
- Skill script execution is prohibited. Do not execute, import, load, shell out from, or sandbox skill scripts.
- If executable behavior is needed, implement it as a Tool, MCP binding, or TeamTool; never as a Skill script.
- Use progressive disclosure: load only skill name/description for discovery, load full `SKILL.md` only when activated, and load references/assets/templates only when needed.
- Store Run-scoped SkillManifest snapshots for audit/reproducibility.
- Do not build a remote skill marketplace or arbitrary remote skill installer in early phases.
- Skills may declare required tools or MCP capabilities, but must not add external tools directly. Dynamic external tools go through MCP bindings.
- Skills must not contain credentials, tokens, or tenant-specific secrets.
- Treat untrusted third-party skills as prompt/code supply-chain risk.

## MCP dynamic external tools

- Dynamic external tools must go through MCP bindings.
- Do not create a generic arbitrary HTTP callback tool API for dynamic external tools.
- Do not allow client-supplied arbitrary MCP URLs by default. Prefer capability IDs resolved by the host app.
- MCP bindings are AgentSession-scoped.
- ToolManifest snapshots are Run-scoped.
- Heph must not own a global external Tool Store.
- Dynamic external MCP should prefer Streamable HTTP.
- Do not allow dynamic stdio MCP bindings.
- `allowTools` is required. Empty allowlist means no tools are exposed.
- Unknown side effects should default to requiring approval.
- Credentials are resolved by host app / CredentialResolver and must not be stored in Heph.
- Do not pass through user access tokens blindly to MCP servers.

## Team / A2A

- Team-internal agent communication should be LLM-facing TeamTools.
- Local team agents use Heph native Team Runtime with child runs and team events.
- Do not force A2A inside a local Heph team.
- Use A2A at the boundary for remote, cross-framework, or opaque external agents.
- Use MCP for tools and A2A for remote agents.
- Add delegation limits, cycle detection, budget controls, and event logging for team communication.

## Architecture guardrails

- Do not mix MessageStore, EventLog, StateStore, and MemoryStore.
- Do not use MemoryStore as source of truth for runtime state.
- Do not stream directly from workers to clients. Stream from EventLog.
- Do not hold long-running execution inside a Hono route handler. Even single-process mode should use a local queue.
- Do not make worker/executor one process per agent.
- Do not embed auth product functionality in core.
- Do not bypass Tool lifecycle for side-effecting operations.
- Do not execute Skill scripts.
