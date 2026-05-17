import { Hono } from "hono";
import { z } from "zod";
import { HephError, isHephError } from "@heph/core";
import type { Context, Env } from "hono";
import type { AgentSession, AuthContext, HephRuntime, InboxEvent, McpBinding, Message, Run, RunEvent, RunInput } from "@heph/core";

export type GetAuth<E extends Env = Env> = (c: Context<E>) => AuthContext | null | Promise<AuthContext | null>;

export interface CreateHephRouterOptions<E extends Env = Env> {
  heph: HephRuntime;
  getAuth?: GetAuth<E>;
  requireAuth?: boolean;
  stream?: StreamOptions;
}

export interface CreateHephAppOptions<E extends Env = Env> extends CreateHephRouterOptions<E> {}

export interface DevAuthOptions {
  subject?: string;
  userId?: string;
  tenantId?: string;
  roles?: string[];
  scopes?: string[];
  cookieName?: string;
}

export interface StreamOptions {
  pollIntervalMs?: number;
  closeOnTerminal?: boolean;
}

const createAgentSchema = z.object({
  spec: z.string().min(1),
  input: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  capabilities: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional()
});

const createMessageSchema = z.object({
  type: z.enum(["user.message", "steering.message"]).optional(),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const createRunSchema = z.object({
  input: z.union([z.string(), z.record(z.string(), z.unknown())]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const createMcpBindingSchema = z.object({
  capabilityId: z.string().min(1),
  accountRef: z.string().min(1).nullable().optional(),
  allowTools: z.union([z.literal("all"), z.array(z.string())]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export function createHephApp<E extends Env = Env>(options: CreateHephAppOptions<E>): Hono<E> {
  const app = new Hono<E>();
  app.route("/", createHephRouter(options));
  return app;
}

export function createHephRouter<E extends Env = Env>(options: CreateHephRouterOptions<E>): Hono<E> {
  const app = new Hono<E>();

  app.post("/agents", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const body = await parseJson(c, createAgentSchema);
    if (body instanceof Response) return body;

    const metadata = mergeMetadata(body.metadata, {
      capabilities: body.capabilities,
      skills: body.skills
    });

    if (body.input === undefined) {
      const agent = await options.heph.agents.create({
        spec: body.spec,
        skills: body.skills,
        auth,
        state: body.state,
        metadata
      });
      return c.json({ agent: serializeAgent(agent) }, 201);
    }

    const created = await options.heph.agents.createAndRun({
      spec: body.spec,
      input: normalizeRunInput(body.input),
      skills: body.skills,
      auth,
      state: body.state,
      metadata
    });

    return c.json(
      {
        agent_id: created.agent_id,
        agent_spec_id: created.agent_spec_id,
        run_id: created.run_id,
        agent: serializeAgent(created.agent),
        run: serializeRun(created.run),
        message: created.message ? serializeMessage(created.message) : null
      },
      201
    );
  });

  app.get("/agents/:agentId", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const agent = await options.heph.agents.get(c.req.param("agentId"));
    if (!agent) return errorResponse(c, notFound("AgentSession not found", { agentId: c.req.param("agentId") }));

    return c.json({ agent: serializeAgent(agent) });
  });

  app.post("/agents/:agentId/mcp-bindings", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const agentId = c.req.param("agentId");
    const agent = await options.heph.agents.get(agentId);
    if (!agent) return errorResponse(c, notFound("AgentSession not found", { agentId }));

    const body = await parseJson(c, createMcpBindingSchema);
    if (body instanceof Response) return body;

    const binding = await options.heph.agents.addMcpBinding({
      agentId,
      capabilityId: body.capabilityId,
      accountRef: body.accountRef ?? null,
      allowTools: body.allowTools,
      auth,
      metadata: body.metadata
    });

    return c.json(
      {
        mcp_binding_id: binding.id,
        binding: serializeMcpBinding(binding)
      },
      201
    );
  });

  app.get("/agents/:agentId/mcp-bindings", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const agentId = c.req.param("agentId");
    const agent = await options.heph.agents.get(agentId);
    if (!agent) return errorResponse(c, notFound("AgentSession not found", { agentId }));

    const bindings = await options.heph.agents.listMcpBindings(agentId);
    return c.json({ bindings: bindings.map(serializeMcpBinding) });
  });

  app.delete("/agents/:agentId/mcp-bindings/:bindingId", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const binding = await options.heph.agents.removeMcpBinding({
      agentId: c.req.param("agentId"),
      bindingId: c.req.param("bindingId")
    });

    return c.json({ binding: serializeMcpBinding(binding) });
  });

  app.post("/agents/:agentId/messages", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const agentId = c.req.param("agentId");
    const agent = await options.heph.agents.get(agentId);
    if (!agent) return errorResponse(c, notFound("AgentSession not found", { agentId }));

    const body = await parseJson(c, createMessageSchema);
    if (body instanceof Response) return body;

    const appended = await options.heph.agents.appendMessage({
      agentId,
      type: body.type,
      content: body.content,
      auth,
      metadata: body.metadata
    });

    return c.json(
      {
        message_id: appended.message_id,
        inbox_event_id: appended.inbox_event_id,
        scheduled: appended.scheduled,
        message: serializeMessage(appended.message),
        inbox_event: serializeInboxEvent(appended.inboxEvent)
      },
      202
    );
  });

  app.post("/agents/:agentId/runs", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const agentId = c.req.param("agentId");
    const body = await parseJson(c, createRunSchema);
    if (body instanceof Response) return body;

    const run = await options.heph.runs.create({
      agentId,
      input: normalizeRunInput(body.input),
      auth,
      metadata: body.metadata
    });

    return c.json({ run_id: run.id, run: serializeRun(run) }, 201);
  });

  app.get("/runs/:runId", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const run = await options.heph.runs.get(c.req.param("runId"));
    if (!run) return errorResponse(c, notFound("Run not found", { runId: c.req.param("runId") }));

    return c.json({ run: serializeRun(run) });
  });

  app.get("/runs/:runId/events", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const runId = c.req.param("runId");
    const run = await options.heph.runs.get(runId);
    if (!run) return errorResponse(c, notFound("Run not found", { runId }));

    const after = parseOptionalInteger(c.req.query("after"));
    const limit = parseOptionalInteger(c.req.query("limit"));
    const listOptions: { after?: number; limit?: number } = {};
    if (after !== undefined) listOptions.after = after;
    if (limit !== undefined) listOptions.limit = limit;
    const events = await options.heph.stores.events.listRunEvents(runId, listOptions);

    return c.json({ events: events.map(serializeRunEvent) });
  });

  app.get("/runs/:runId/stream", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const runId = c.req.param("runId");
    const run = await options.heph.runs.get(runId);
    if (!run) return errorResponse(c, notFound("Run not found", { runId }));

    const after = parseOptionalInteger(c.req.query("after")) ?? parseOptionalInteger(c.req.header("Last-Event-ID")) ?? 0;
    return streamEvents(options.heph, runId, after, c.req.raw.signal, options.stream);
  });

  app.post("/runs/:runId/cancel", async (c) => {
    const auth = await resolveAuth(c, options);
    if (auth instanceof Response) return auth;

    const run = await options.heph.runs.cancel(c.req.param("runId"));
    return c.json({ run: serializeRun(run) });
  });

  app.onError((error, c) => {
    return errorResponse(c, error);
  });

  return app;
}

export function createDevAuth(options: DevAuthOptions = {}): GetAuth {
  return (c) => {
    const cookieValue = options.cookieName ? readCookie(c.req.header("Cookie"), options.cookieName) : null;
    const subject = cookieValue ?? options.subject ?? "dev";

    const auth: AuthContext = {
      subject,
      userId: options.userId ?? subject,
      actorType: "user"
    };

    if (options.tenantId !== undefined) auth.tenantId = options.tenantId;
    if (options.roles !== undefined) auth.roles = options.roles;
    if (options.scopes !== undefined) auth.scopes = options.scopes;

    return auth;
  };
}

async function resolveAuth<E extends Env>(
  c: Context<E>,
  options: CreateHephRouterOptions<E>
): Promise<AuthContext | null | Response> {
  const auth = options.getAuth ? await options.getAuth(c) : null;

  if (options.requireAuth && !auth) {
    return errorResponse(
      c,
      new HephError({
        code: "HEPH6001",
        title: "Unauthorized",
        message: "Authentication is required.",
        status: 401
      })
    );
  }

  return auth;
}

async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  let raw: unknown;

  try {
    raw = await c.req.json();
  } catch (cause) {
    return errorResponse(
      c,
      new HephError({
        code: "HEPH6002",
        title: "Invalid JSON body",
        message: "Request body must be valid JSON.",
        status: 400,
        cause
      })
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      c,
      new HephError({
        code: "HEPH6003",
        title: "Invalid request body",
        message: "Request body does not match the expected shape.",
        status: 400,
        details: {
          issues: parsed.error.issues
        }
      })
    );
  }

  return parsed.data;
}

function streamEvents(
  heph: HephRuntime,
  runId: string,
  startAfter: number,
  signal: AbortSignal,
  options: StreamOptions = {}
): Response {
  const encoder = new TextEncoder();
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const closeOnTerminal = options.closeOnTerminal ?? true;
  let after = startAfter;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      while (!signal.aborted) {
        const events = await heph.stores.events.listRunEvents(runId, { after });

        for (const event of events) {
          after = event.seq;
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        }

        const latestRun = await heph.runs.get(runId);
        if (closeOnTerminal && latestRun && isTerminalStatus(latestRun.status) && events.length === 0) {
          break;
        }

        if (closeOnTerminal && latestRun && isTerminalStatus(latestRun.status) && events.length > 0) {
          const lastEvent = events.at(-1);
          if (lastEvent && isTerminalEvent(lastEvent)) {
            break;
          }
        }

        await delay(pollIntervalMs, signal);
      }

      controller.close();
    },
    cancel() {
      // The request AbortSignal is the source of cancellation for this stream.
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

function formatSseEvent(event: RunEvent): string {
  return `event: ${event.type}\nid: ${event.seq}\ndata: ${JSON.stringify(serializeRunEvent(event))}\n\n`;
}

function serializeAgent(agent: AgentSession) {
  return {
    agent_id: agent.id,
    agent_spec_id: agent.agentSpecId,
    agent_spec_version: agent.agentSpecVersion,
    active_run_id: agent.activeRunId,
    state: agent.state,
    auth: agent.auth,
    metadata: agent.metadata,
    created_at: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString()
  };
}

function serializeRun(run: Run) {
  return {
    run_id: run.id,
    agent_id: run.agentId,
    agent_spec_id: run.agentSpecId,
    agent_spec_version: run.agentSpecVersion,
    status: run.status,
    input: run.input,
    error: run.error,
    context_manifest: run.contextManifest,
    skill_manifest: run.skillManifest,
    tool_manifest: run.toolManifest,
    metadata: run.metadata,
    queued_at: run.queuedAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    completed_at: run.completedAt?.toISOString() ?? null,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString()
  };
}

function serializeMcpBinding(binding: McpBinding) {
  return {
    mcp_binding_id: binding.id,
    agent_id: binding.agentId,
    capability_id: binding.capabilityId,
    account_ref: binding.accountRef,
    allow_tools: binding.allowTools,
    status: binding.status,
    metadata: binding.metadata,
    created_at: binding.createdAt.toISOString(),
    updated_at: binding.updatedAt.toISOString(),
    removed_at: binding.removedAt?.toISOString() ?? null
  };
}

function serializeMessage(message: Message) {
  return {
    message_id: message.id,
    agent_id: message.agentId,
    role: message.role,
    content: message.content,
    source_run_id: message.sourceRunId,
    metadata: message.metadata,
    created_at: message.createdAt.toISOString()
  };
}

function serializeInboxEvent(event: InboxEvent) {
  return {
    inbox_event_id: event.id,
    agent_id: event.agentId,
    type: event.type,
    input: event.input,
    status: event.status,
    run_id: event.runId,
    metadata: event.metadata,
    created_at: event.createdAt.toISOString(),
    updated_at: event.updatedAt.toISOString()
  };
}

function serializeRunEvent(event: RunEvent) {
  return {
    event_id: event.id,
    run_id: event.runId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    source_refs: event.sourceRefs,
    created_at: event.createdAt.toISOString()
  };
}

function errorResponse(c: Context, error: unknown): Response {
  const hephError = isHephError(error)
    ? error
    : new HephError({
        code: "HEPH6004",
        title: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unexpected server error.",
        status: 500,
        cause: error
      });

  return Response.json(
    {
      error: {
        code: hephError.code,
        title: hephError.title,
        message: hephError.message,
        details: hephError.details ?? null
      }
    },
    {
      status: hephError.status ?? 500
    }
  );
}

function notFound(title: string, details: Record<string, unknown>): HephError {
  return new HephError({
    code: "HEPH6005",
    title,
    message: title,
    status: 404,
    details
  });
}

function normalizeRunInput(input: string | Record<string, unknown>): string | RunInput {
  if (typeof input === "string") {
    return input;
  }

  return input as RunInput;
}

function mergeMetadata(
  metadata: Record<string, unknown> | undefined,
  generated: { capabilities?: string[] | undefined; skills?: string[] | undefined }
): Record<string, unknown> | undefined {
  const entries = Object.entries(generated).filter(([, value]) => value !== undefined);

  if (!metadata && entries.length === 0) {
    return undefined;
  }

  return {
    ...(metadata ?? {}),
    ...Object.fromEntries(entries)
  };
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isTerminalStatus(status: Run["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isTerminalEvent(event: RunEvent): boolean {
  return event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled";
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}
