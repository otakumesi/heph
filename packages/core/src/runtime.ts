import { ContextRenderer, defaultContextTemplate } from "./context.js";
import { HephError, toErrorDetails } from "./errors.js";
import { MinimalRunExecutor } from "./executor.js";
import { createInMemorySkillCatalog } from "./skills.js";
import { InMemoryHephStore } from "./stores.js";
import { InProcessQueue } from "./queue.js";
import { createMcpBindingId } from "./ids.js";
import type { HephJob, QueueAdapter } from "./queue.js";
import type {
  AgentSession,
  AgentSessionId,
  AgentSpec,
  AgentSpecId,
  ApprovalRequest,
  ApprovalRequestId,
  AuthContext,
  DeferredToolOperation,
  DeferredToolOperationId,
  DeferredToolResumePolicy,
  ContextBlock,
  ContextProvider,
  HephStores,
  InboxEvent,
  InboxEventId,
  McpAllowTools,
  McpBinding,
  McpBindingId,
  McpBindingResolver,
  McpCatalogTool,
  McpToolExecutor,
  McpToolManifestTool,
  Message,
  MessageId,
  RenderedContext,
  ResolvedMcpBinding,
  Run,
  RunError,
  RunId,
  RunInput,
  SourceRef,
  SkillBinding,
  SkillCatalog,
  SkillManifest,
  SkillManifestEntry,
  SkillPackage,
  SkillResourceRef,
  Tool,
  ToolManifest,
  ToolManifestTool
} from "./types.js";
import type { RunExecutor } from "./executor.js";

export interface AgentSpecResolverContext {
  auth: AuthContext | null;
}

export interface AgentSpecResolver<TApp = unknown> {
  resolve(id: AgentSpecId, ctx: AgentSpecResolverContext): Promise<AgentSpec<TApp> | null>;
}

export type AgentSpecRegistration<TApp = unknown> =
  | AgentSpec<TApp>[]
  | Record<string, AgentSpec<TApp>>
  | AgentSpecResolver<TApp>;

export interface CreateHephOptions<TApp = unknown> {
  agents: AgentSpecRegistration<TApp>;
  stores?: HephStores;
  queue?: QueueAdapter;
  executor?: RunExecutor<TApp>;
  app?: TApp;
  inbox?: {
    maxEventsPerRun?: number | null | undefined;
    textSeparator?: string | undefined;
  };
  execution?: {
    mode?: "single-process" | "platform-queue" | "split-worker";
    concurrency?: number;
    autoStartConsumer?: boolean;
  };
  runtimePolicy?: string;
  toolPolicy?: string;
  mcp?: {
    resolver?: McpBindingResolver<TApp> | undefined;
    toolExecutor?: McpToolExecutor<TApp> | undefined;
  };
  skills?: {
    catalog?: SkillCatalog | undefined;
  };
}

export interface CreateAgentSessionInput {
  spec: AgentSpecId;
  skills?: string[] | undefined;
  auth?: AuthContext | null | undefined;
  state?: Record<string, unknown> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateAgentAndRunInput extends CreateAgentSessionInput {
  input: string | RunInput;
}

export interface CreateRunInput {
  agentId: AgentSessionId;
  input: string | RunInput;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  enqueue?: boolean | undefined;
}

export interface AppendAgentMessageInput {
  agentId: AgentSessionId;
  content: string;
  type?: "user.message" | "steering.message" | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  schedule?: boolean | undefined;
}

export interface AppendAgentMessageResult {
  message: Message;
  inboxEvent: InboxEvent;
  message_id: MessageId;
  inbox_event_id: InboxEventId;
  scheduled: boolean;
}

export interface AddMcpBindingInput {
  agentId: AgentSessionId;
  capabilityId: string;
  accountRef?: string | null | undefined;
  allowTools: McpAllowTools;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RemoveMcpBindingInput {
  agentId: AgentSessionId;
  bindingId: McpBindingId;
}

export interface CallToolInput {
  toolId: string;
  input?: unknown;
  auth?: AuthContext | null | undefined;
  approvalRequestId?: ApprovalRequestId | undefined;
  signal?: AbortSignal | undefined;
}

export interface ToolCallResult {
  toolId: string;
  result: unknown;
  ok: true;
}

export interface FailedToolCallResult {
  toolId: string;
  error: RunError;
  ok: false;
}

export type ToolCallAttemptResult = ToolCallResult | FailedToolCallResult;

export interface DeferToolResultInput {
  runId: RunId;
  toolId: string;
  operationId?: DeferredToolOperationId | undefined;
  toolCallId?: string | null | undefined;
  resumePolicy?: DeferredToolResumePolicy | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CompleteDeferredToolResultInput {
  operationId: DeferredToolOperationId;
  status?: "completed" | "failed" | "cancelled" | undefined;
  result?: unknown;
  content?: string | undefined;
  error?: RunError | null | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  schedule?: boolean | undefined;
}

export interface CompleteDeferredToolResultResult {
  operation: DeferredToolOperation;
  message: Message;
  inboxEvent: InboxEvent | null;
  scheduled: boolean;
}

export interface CreateAgentAndRunResult {
  agent: AgentSession;
  run: Run;
  message: Message | null;
  inboxEvent: InboxEvent | null;
  agent_id: AgentSessionId;
  agent_spec_id: AgentSpecId;
  run_id: RunId;
}

export interface HephRuntime<TApp = unknown> {
  stores: HephStores;
  queue: QueueAdapter;
  agents: {
    create(input: CreateAgentSessionInput): Promise<AgentSession>;
    createAndRun(input: CreateAgentAndRunInput): Promise<CreateAgentAndRunResult>;
    appendMessage(input: AppendAgentMessageInput): Promise<AppendAgentMessageResult>;
    schedule(agentId: AgentSessionId): Promise<Run | null>;
    get(agentId: AgentSessionId): Promise<AgentSession | null>;
    addMcpBinding(input: AddMcpBindingInput): Promise<McpBinding>;
    listMcpBindings(agentId: AgentSessionId): Promise<McpBinding[]>;
    removeMcpBinding(input: RemoveMcpBindingInput): Promise<McpBinding>;
  };
  runs: {
    create(input: CreateRunInput): Promise<Run>;
    get(runId: RunId): Promise<Run | null>;
    cancel(runId: RunId): Promise<Run>;
  };
  messages: {
    append(input: {
      agentId: AgentSessionId;
      role: "user" | "assistant" | "tool" | "developer" | "system";
      content: string;
      auth?: AuthContext | null | undefined;
      metadata?: Record<string, unknown> | undefined;
    }): Promise<Message>;
    list(agentId: AgentSessionId, options?: { limit?: number }): Promise<Message[]>;
  };
  approvals: {
    get(approvalRequestId: ApprovalRequestId): Promise<ApprovalRequest | null>;
    list(runId: RunId): Promise<ApprovalRequest[]>;
    decide(input: {
      approvalRequestId: ApprovalRequestId;
      decision: "granted" | "rejected";
      auth?: AuthContext | null | undefined;
      metadata?: Record<string, unknown> | undefined;
    }): Promise<ApprovalRequest>;
  };
  tools: {
    call(runId: RunId, input: CallToolInput): Promise<ToolCallResult>;
    tryCall(runId: RunId, input: CallToolInput): Promise<ToolCallAttemptResult>;
  };
  operations: {
    deferToolResult(input: DeferToolResultInput): Promise<DeferredToolOperation>;
    get(operationId: DeferredToolOperationId): Promise<DeferredToolOperation | null>;
    complete(input: CompleteDeferredToolResultInput): Promise<CompleteDeferredToolResultResult>;
  };
  renderRunContext(runId: RunId): Promise<RenderedContext>;
  handleJob(job: HephJob): Promise<void>;
  startWorker(): Promise<void>;
  drain(): Promise<void>;
}

export class StreamableHttpMcpToolExecutor<TApp = unknown> implements McpToolExecutor<TApp> {
  async callTool(ctx: Parameters<McpToolExecutor<TApp>["callTool"]>[0]): Promise<unknown> {
    const credentials = await ctx.resolved.resolveCredentials?.({
      auth: ctx.auth,
      agent: ctx.agent,
      run: ctx.run,
      binding: ctx.binding,
      app: ctx.app
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    });

    for (const [key, value] of Object.entries(credentials?.headers ?? {})) {
      headers.set(key, value);
    }

    const rpcId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`;
    const requestInit: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "tools/call",
        params: {
          name: ctx.manifestTool.remoteToolName,
          arguments: ctx.input ?? {}
        }
      })
    };

    if (ctx.signal !== undefined) {
      requestInit.signal = ctx.signal;
    }

    const response = await fetch(ctx.resolved.endpoint, requestInit);

    const rawBody = await response.text();
    const parsed = parseMcpResponseBody(rawBody, response.headers.get("Content-Type"));

    if (!response.ok) {
      throw new HephError({
        code: "HEPH7002",
        title: "MCP tool call failed",
        message: `MCP server returned HTTP ${response.status}.`,
        status: 503,
        details: {
          toolId: ctx.manifestTool.id,
          bindingId: ctx.binding.id,
          status: response.status,
          body: parsed ?? rawBody
        }
      });
    }

    if (isJsonRpcError(parsed)) {
      throw new HephError({
        code: "HEPH7002",
        title: "MCP tool call failed",
        message: "MCP server returned a JSON-RPC error.",
        status: 503,
        details: {
          toolId: ctx.manifestTool.id,
          bindingId: ctx.binding.id,
          error: parsed.error
        }
      });
    }

    if (isRecord(parsed) && "result" in parsed) {
      return parsed.result;
    }

    return parsed;
  }
}

export function createHeph<TApp = unknown>(options: CreateHephOptions<TApp>): HephRuntime<TApp> {
  const stores = options.stores ?? new InMemoryHephStore();
  const queue =
    options.queue ??
    new InProcessQueue({
      concurrency: options.execution?.concurrency ?? 4
    });
  const executor = options.executor ?? new MinimalRunExecutor<TApp>();
  const resolver = normalizeAgentSpecResolver(options.agents);
  const mcpResolver = options.mcp?.resolver ?? null;
  const mcpToolExecutor = options.mcp?.toolExecutor ?? new StreamableHttpMcpToolExecutor<TApp>();
  const skillCatalog = options.skills?.catalog ?? createInMemorySkillCatalog([]);
  const renderer = new ContextRenderer();
  const app = (options.app ?? {}) as TApp;
  const abortControllers = new Map<RunId, AbortController>();
  const executionMode = options.execution?.mode ?? "single-process";
  const reducerOptions = {
    maxEventsPerRun: normalizeMaxEventsPerRun(options.inbox?.maxEventsPerRun),
    textSeparator: options.inbox?.textSeparator ?? "\n\n--- next message ---\n\n"
  };
  let consumerStarted = false;

  const runtime: HephRuntime<TApp> = {
    stores,
    queue,
    agents: {
      async create(input) {
        const spec = await resolveSpecOrThrow(resolver, input.spec, input.auth ?? null);
        const skillPackages = await resolveSkillPackagesForSession(spec, input.skills ?? []);
        const agent = await stores.state.createAgentSession({
          agentSpecId: spec.id,
          agentSpecVersion: spec.version,
          state: input.state,
          auth: input.auth ?? null,
          metadata: input.metadata
        });

        for (const skillPackage of skillPackages) {
          await stores.skillBindings.createSkillBinding({
            agentId: agent.id,
            skillId: skillPackage.id,
            name: skillPackage.name,
            version: skillPackage.version,
            source: skillPackage.source,
            allowReferences: [],
            metadata: {
              description: skillPackage.description
            }
          });
        }

        return agent;
      },
      async createAndRun(input) {
        const agent = await runtime.agents.create(input);
        const runInput = normalizeRunInput(input.input);
        const appended = await appendRunInputToInbox({
          agentId: agent.id,
          input: runInput,
          auth: input.auth ?? null,
          metadata: input.metadata,
          messageMetadata: {
            ...(input.metadata ?? {}),
            runInput: true
          }
        });
        const run = await scheduleAgent(agent.id);

        if (!run) {
          throw new HephError({
            code: "HEPH4002",
            title: "Run was not scheduled",
            message: `AgentSession ${agent.id} did not produce a Run from its initial input.`,
            status: 409,
            details: {
              agentId: agent.id,
              inboxEventId: appended.inboxEvent.id
            }
          });
        }

        return {
          agent,
          run,
          message: appended.message,
          inboxEvent: appended.inboxEvent,
          agent_id: agent.id,
          agent_spec_id: agent.agentSpecId,
          run_id: run.id
        };
      },
      async appendMessage(input) {
        await getAgentOrThrow(stores, input.agentId);
        const appended = await appendRunInputToInbox({
          agentId: input.agentId,
          input: {
            type: input.type ?? "user.message",
            text: input.content
          },
          auth: input.auth ?? null,
          metadata: input.metadata,
          messageMetadata: input.metadata
        });
        const shouldSchedule = input.schedule ?? true;

        if (!appended.message) {
          throw new HephError({
            code: "HEPH4004",
            title: "Message was not stored",
            message: "The user message input did not produce a MessageStore record.",
            status: 500,
            details: {
              agentId: input.agentId,
              inboxEventId: appended.inboxEvent.id
            }
          });
        }

        const inboxEvent = shouldSchedule
          ? await scheduleAfterAppend(input.agentId, appended.inboxEvent)
          : appended.inboxEvent;

        return {
          message: appended.message,
          inboxEvent,
          message_id: appended.message.id,
          inbox_event_id: inboxEvent.id,
          scheduled: shouldSchedule
        };
      },
      schedule(agentId) {
        return scheduleAgent(agentId);
      },
      get(agentId) {
        return stores.state.getAgentSession(agentId);
      },
      async addMcpBinding(input) {
        const agent = await getAgentOrThrow(stores, input.agentId);
        const spec = await resolveSpecOrThrow(resolver, agent.agentSpecId, input.auth ?? agent.auth);
        const bindingId = createMcpBindingId();
        const now = new Date();
        const draft: McpBinding = {
          id: bindingId,
          agentId: agent.id,
          capabilityId: input.capabilityId,
          accountRef: input.accountRef ?? null,
          allowTools: Array.isArray(input.allowTools) ? [...input.allowTools] : input.allowTools,
          status: "active",
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
          removedAt: null
        };

        enforceMcpPolicy(spec, draft);
        const resolved = await resolveMcpBindingOrThrow({
          resolver: mcpResolver,
          auth: input.auth ?? agent.auth,
          agent,
          binding: draft,
          app
        });
        validateMcpCatalog(draft, resolved);

        return stores.mcpBindings.createMcpBinding({
          id: bindingId,
          agentId: agent.id,
          capabilityId: input.capabilityId,
          accountRef: input.accountRef ?? null,
          allowTools: Array.isArray(input.allowTools) ? [...input.allowTools] : input.allowTools,
          metadata: input.metadata
        });
      },
      async listMcpBindings(agentId) {
        await getAgentOrThrow(stores, agentId);
        return stores.mcpBindings.listMcpBindings(agentId);
      },
      async removeMcpBinding(input) {
        const agent = await getAgentOrThrow(stores, input.agentId);
        const binding = await stores.mcpBindings.getMcpBinding(input.bindingId);

        if (!binding || binding.agentId !== agent.id) {
          throw new HephError({
            code: "HEPH5001",
            title: "McpBinding not found",
            message: `McpBinding ${input.bindingId} was not found.`,
            status: 404,
            details: {
              agentId: input.agentId,
              bindingId: input.bindingId
            }
          });
        }

        return stores.mcpBindings.removeMcpBinding(input.bindingId);
      }
    },
    runs: {
      async create(input) {
        const agent = await getAgentOrThrow(stores, input.agentId);
        return createRunForAgent({
          agent,
          input: normalizeRunInput(input.input),
          auth: input.auth ?? agent.auth,
          metadata: input.metadata,
          enqueue: input.enqueue ?? true
        });
      },
      get(runId) {
        return stores.state.getRun(runId);
      },
      async cancel(runId) {
        return cancelRun(runId);
      }
    },
    messages: {
      append(input) {
        return stores.messages.appendMessage({
          agentId: input.agentId,
          role: input.role,
          content: input.content,
          auth: input.auth ?? null,
          metadata: input.metadata
        });
      },
      list(agentId, listOptions) {
        return stores.messages.listMessages(agentId, listOptions);
      }
    },
    approvals: {
      get(approvalRequestId) {
        return stores.approvals.getApprovalRequest(approvalRequestId);
      },
      list(runId) {
        return stores.approvals.listApprovalRequests(runId);
      },
      async decide(input) {
        const request = await stores.approvals.decideApprovalRequest({
          id: input.approvalRequestId,
          decision: input.decision,
          decidedBy: input.auth ?? null,
          metadata: input.metadata
        });
        await stores.events.appendRunEvent({
          runId: request.runId,
          type: input.decision === "granted" ? "approval.granted" : "approval.rejected",
          payload: {
            approvalRequestId: request.id,
            toolId: request.toolId
          },
          sourceRefs: [
            {
              type: "approval_request",
              id: request.id
            }
          ]
        });
        return request;
      }
    },
    tools: {
      call(runId, input) {
        return callTool(runId, input);
      },
      tryCall(runId, input) {
        return tryCallTool(runId, input);
      }
    },
    operations: {
      deferToolResult(input) {
        return deferToolResult(input);
      },
      get(operationId) {
        return stores.deferredToolOperations.getDeferredToolOperation(operationId);
      },
      complete(input) {
        return completeDeferredToolResult(input);
      }
    },
    renderRunContext(runId) {
      return renderRunContext(runId);
    },
    handleJob(job) {
      return handleJob(job);
    },
    async startWorker() {
      if (consumerStarted) {
        return;
      }

      if (!queue.startConsumer) {
        throw new HephError({
          code: "HEPH4003",
          title: "Queue consumer is not available",
          message: "This QueueAdapter does not expose startConsumer(). Use handleJob() or an adapter-specific batch handler.",
          status: 422
        });
      }

      consumerStarted = true;
      await queue.startConsumer((job) => handleJob(job));
    },
    async drain() {
      await queue.onIdle?.();
    }
  };

  if (options.execution?.autoStartConsumer ?? executionMode === "single-process") {
    void runtime.startWorker();
  }

  return runtime;

  async function handleJob(job: HephJob): Promise<void> {
    switch (job.type) {
      case "schedule_agent":
        await scheduleAgent(job.agentId);
        return;
      case "execute_run":
      case "resume_run":
        await executeRun(job.runId);
        return;
      case "cancel_run":
        await cancelRun(job.runId);
        return;
      case "ingest_memory":
        return;
    }
  }

  async function appendRunInputToInbox(input: {
    agentId: AgentSessionId;
    input: string | RunInput;
    auth: AuthContext | null;
    metadata?: Record<string, unknown> | undefined;
    messageMetadata?: Record<string, unknown> | undefined;
  }): Promise<{ runInput: RunInput; message: Message | null; inboxEvent: InboxEvent }> {
    const normalized = normalizeRunInput(input.input);
    const message =
      "text" in normalized
        ? await stores.messages.appendMessage({
            agentId: input.agentId,
            role: "user",
            content: normalized.text,
            auth: input.auth,
            metadata: input.messageMetadata
          })
        : null;
    const runInput = message ? addMessageIdToRunInput(normalized, message.id) : normalized;
    const inboxEvent = await stores.inbox.appendInboxEvent({
      agentId: input.agentId,
      input: runInput,
      auth: input.auth,
      metadata: input.metadata
    });

    return {
      runInput,
      message,
      inboxEvent
    };
  }

  async function scheduleAfterAppend(agentId: AgentSessionId, inboxEvent: InboxEvent): Promise<InboxEvent> {
    if (inboxEvent.type === "steering.message") {
      await scheduleAgent(agentId);
      return (await stores.inbox.getInboxEvent(inboxEvent.id)) ?? inboxEvent;
    }

    await queue.enqueue({
      type: "schedule_agent",
      agentId
    });
    return inboxEvent;
  }

  async function scheduleAgent(agentId: AgentSessionId): Promise<Run | null> {
    let agent = await getAgentOrThrow(stores, agentId);

    if (agent.activeRunId) {
      const activeRun = await stores.state.getRun(agent.activeRunId);

      if (activeRun && !isTerminalRun(activeRun)) {
        await processPendingCancellationEvents(agent, activeRun);
        await processPendingSteeringEvents(agent, activeRun);
        return null;
      }

      agent = await stores.state.updateAgentSession(agent.id, {
        activeRunId: null
      });
    }

    const nextPending = await stores.inbox.listInboxEvents(agent.id, {
      status: "pending",
      limit: 1
    });

    if (nextPending.length === 0) {
      return null;
    }

    const claimOptions: { types: RunInput["type"][]; limit?: number } = {
      types: [nextPending[0]!.type]
    };
    if (reducerOptions.maxEventsPerRun !== undefined) {
      claimOptions.limit = reducerOptions.maxEventsPerRun;
    }
    const claimed = await stores.inbox.claimPendingInboxEvents(agent.id, claimOptions);

    if (claimed.length === 0) {
      return null;
    }

    try {
      const inboxEventIds = claimed.map((event) => event.id);
      const run = await createRunForAgent({
        agent,
        input: reduceInboxEvents(claimed, reducerOptions.textSeparator),
        auth: firstAuth(claimed) ?? agent.auth,
        metadata: {
          inboxEventIds,
          inboxEventCount: claimed.length
        },
        sourceRefs: toInboxSourceRefs(claimed),
        enqueue: false
      });

      await stores.inbox.markInboxEventsProcessed(inboxEventIds, run.id);
      await queue.enqueue({
        type: "execute_run",
        agentId: agent.id,
        runId: run.id
      });

      return run;
    } catch (error) {
      await stores.inbox.markInboxEventsFailed(
        claimed.map((event) => event.id),
        toRunError(error)
      );
      throw error;
    }
  }

  async function processPendingCancellationEvents(agent: AgentSession, activeRun: Run): Promise<void> {
    const cancellationEvents = await stores.inbox.claimPendingInboxEvents(agent.id, {
      types: ["run.cancel_requested"]
    });

    if (cancellationEvents.length === 0) {
      return;
    }

    const cancelled = await cancelRun(activeRun.id, {
      sourceRefs: toInboxSourceRefs(cancellationEvents)
    });
    await stores.inbox.markInboxEventsProcessed(
      cancellationEvents.map((event) => event.id),
      cancelled.id
    );
  }

  async function processPendingSteeringEvents(agent: AgentSession, activeRun: Run): Promise<void> {
    const steeringEvents = await stores.inbox.claimPendingInboxEvents(agent.id, {
      types: ["steering.message"]
    });

    for (const event of steeringEvents) {
      await stores.events.appendRunEvent({
        runId: activeRun.id,
        type: "run.steering_received",
        payload: {
          agentId: agent.id,
          inboxEventId: event.id,
          input: event.input
        },
        sourceRefs: toInboxSourceRefs([event])
      });
    }

    if (steeringEvents.length > 0) {
      await stores.inbox.markInboxEventsProcessed(
        steeringEvents.map((event) => event.id),
        activeRun.id
      );
    }
  }

  async function createRunForAgent(input: {
    agent: AgentSession;
    input: RunInput;
    auth: AuthContext | null;
    metadata?: Record<string, unknown> | undefined;
    sourceRefs?: SourceRef[] | undefined;
    enqueue: boolean;
  }): Promise<Run> {
    const spec = await resolveSpecOrThrow(resolver, input.agent.agentSpecId, input.auth ?? input.agent.auth);
    const run = await stores.state.createRun({
      agentId: input.agent.id,
      agentSpecId: spec.id,
      agentSpecVersion: spec.version,
      status: "queued",
      input: input.input,
      auth: input.auth,
      metadata: input.metadata
    });

    await stores.state.updateAgentSession(input.agent.id, {
      activeRunId: run.id
    });
    await stores.events.appendRunEvent({
      runId: run.id,
      type: "run.queued",
      payload: {
        agentId: input.agent.id,
        agentSpecId: spec.id
      },
      sourceRefs: input.sourceRefs
    });

    if (input.enqueue) {
      await queue.enqueue({
        type: "execute_run",
        agentId: input.agent.id,
        runId: run.id
      });
    }

    return run;
  }

  async function cancelRun(runId: RunId, options: { sourceRefs?: SourceRef[] | undefined } = {}): Promise<Run> {
    const run = await getRunOrThrow(stores, runId);

    if (isTerminalRun(run)) {
      return run;
    }

    const controller = abortControllers.get(run.id);
    controller?.abort();

    await stores.events.appendRunEvent({
      runId: run.id,
      type: "run.cancel_requested",
      payload: {},
      sourceRefs: options.sourceRefs
    });
    const cancelled = await stores.state.updateRun(run.id, {
      status: "cancelled",
      completedAt: new Date()
    });
    await stores.events.appendRunEvent({
      runId: run.id,
      type: "run.cancelled",
      payload: {}
    });

    const agent = await stores.state.getAgentSession(run.agentId);
    if (agent?.activeRunId === run.id) {
      await stores.state.updateAgentSession(agent.id, {
        activeRunId: null
      });
    }
    await enqueueScheduleIfPending(run.agentId);

    return cancelled;
  }

  async function executeRun(runId: RunId): Promise<void> {
    const initialRun = await getRunOrThrow(stores, runId);

    if (isTerminalRun(initialRun)) {
      return;
    }

    const agent = await getAgentOrThrow(stores, initialRun.agentId);
    const spec = await resolveSpecOrThrow(resolver, initialRun.agentSpecId, initialRun.auth ?? agent.auth);
    const controller = new AbortController();
    abortControllers.set(initialRun.id, controller);

    try {
      const skillManifest = await createSkillManifestForRun(agent, initialRun);
      const runWithSkillManifest = await stores.state.updateRun(initialRun.id, {
        skillManifest
      });
      await stores.events.appendRunEvent({
        runId: runWithSkillManifest.id,
        type: "skill_manifest.created",
        payload: {
          skillCount: skillManifest.skills.length
        },
        sourceRefs: skillManifest.skills.map((skill) => ({
          type: "skill_binding" as const,
          id: skill.bindingId
        }))
      });

      const toolManifest = await createToolManifestForRun(agent, spec, runWithSkillManifest);
      const runWithToolManifest = await stores.state.updateRun(runWithSkillManifest.id, {
        toolManifest
      });
      await stores.events.appendRunEvent({
        runId: runWithToolManifest.id,
        type: "tool_manifest.created",
        payload: {
          toolCount: toolManifest.tools.length,
          localToolCount: toolManifest.tools.filter((tool) => tool.source === "local").length,
          mcpToolCount: toolManifest.tools.filter((tool) => tool.source === "mcp").length
        },
        sourceRefs: toolManifest.tools.flatMap((tool) =>
          tool.source === "mcp"
            ? [
                {
                  type: "mcp_binding" as const,
                  id: tool.bindingId
                }
              ]
            : []
        )
      });

      const running = await stores.state.updateRun(runWithToolManifest.id, {
        status: "running",
        startedAt: new Date()
      });
      await stores.events.appendRunEvent({
        runId: running.id,
        type: "run.started",
        payload: {
          agentId: agent.id,
          agentSpecId: spec.id
        }
      });

      const renderedContext = await renderRunContext(running.id);
      const runWithContext = await stores.state.updateRun(running.id, {
        contextManifest: renderedContext.manifest
      });
      const callToolForRun = (input: CallToolInput) =>
        callTool(runWithContext.id, {
          ...input,
          auth: input.auth ?? runWithContext.auth,
          signal: input.signal ?? controller.signal
        });
      const tryCallToolForRun = (input: CallToolInput) =>
        tryCallTool(runWithContext.id, {
          ...input,
          auth: input.auth ?? runWithContext.auth,
          signal: input.signal ?? controller.signal
        });

      await executor.execute({
        auth: runWithContext.auth,
        agent,
        spec,
        run: runWithContext,
        renderedContext,
        stores,
        app,
        signal: controller.signal,
        emit(event) {
          return stores.events.appendRunEvent({
            ...event,
            runId: runWithContext.id
          }).then(() => undefined);
        },
        appendMessage(message) {
          return stores.messages.appendMessage({
            ...message,
            agentId: agent.id,
            auth: runWithContext.auth
          });
        },
        tools: {
          call: callToolForRun,
          tryCall: tryCallToolForRun
        },
        callTool: callToolForRun,
        tryCallTool: tryCallToolForRun,
        deferToolResult(input) {
          return deferToolResult({
            ...input,
            runId: input.runId ?? runWithContext.id,
            auth: input.auth ?? runWithContext.auth
          });
        }
      });

      const current = await getRunOrThrow(stores, running.id);

      if (current.status === "running") {
        await stores.state.updateRun(current.id, {
          status: "completed",
          completedAt: new Date()
        });
        await stores.events.appendRunEvent({
          runId: current.id,
          type: "run.completed",
          payload: {}
        });
        await clearActiveRunIfCurrent(agent.id, current.id);
        await enqueueScheduleIfPending(agent.id);
      }
    } catch (error) {
      const current = await stores.state.getRun(initialRun.id);

      if (current?.status === "cancelled") {
        return;
      }

      const runError = {
        message: error instanceof Error ? error.message : String(error),
        details: toErrorDetails(error)
      };

      if (error instanceof HephError) {
        Object.assign(runError, { code: error.code });
      }

      await stores.state.updateRun(initialRun.id, {
        status: "failed",
        completedAt: new Date(),
        error: runError
      });
      await stores.events.appendRunEvent({
        runId: initialRun.id,
        type: "run.failed",
        payload: toErrorDetails(error)
      });
      await clearActiveRunIfCurrent(agent.id, initialRun.id);
      await enqueueScheduleIfPending(agent.id);
    } finally {
      abortControllers.delete(initialRun.id);
    }
  }

  async function deferToolResult(input: DeferToolResultInput): Promise<DeferredToolOperation> {
    const run = await getRunOrThrow(stores, input.runId);
    const agent = await getAgentOrThrow(stores, run.agentId);
    const operation = await stores.deferredToolOperations.createDeferredToolOperation({
      agentId: agent.id,
      runId: run.id,
      toolId: input.toolId,
      auth: input.auth ?? run.auth ?? agent.auth,
      ...(input.operationId !== undefined ? { id: input.operationId } : {}),
      ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
      ...(input.resumePolicy !== undefined ? { resumePolicy: input.resumePolicy } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
    });

    await stores.events.appendRunEvent({
      runId: run.id,
      type: "tool.deferred",
      payload: {
        operationId: operation.id,
        toolId: operation.toolId,
        toolCallId: operation.toolCallId,
        resumePolicy: operation.resumePolicy
      },
      sourceRefs: [
        {
          type: "deferred_tool_operation",
          id: operation.id
        }
      ]
    });

    return operation;
  }

  async function completeDeferredToolResult(input: CompleteDeferredToolResultInput): Promise<CompleteDeferredToolResultResult> {
    const existing = await stores.deferredToolOperations.getDeferredToolOperation(input.operationId);

    if (!existing) {
      throw new HephError({
        code: "HEPH3005",
        title: "DeferredToolOperation not found",
        message: `DeferredToolOperation ${input.operationId} was not found.`,
        status: 404,
        details: {
          operationId: input.operationId
        }
      });
    }

    const status = input.status ?? (input.error ? "failed" : "completed");
    const operation = await stores.deferredToolOperations.completeDeferredToolOperation({
      id: input.operationId,
      status,
      result: input.result,
      error: input.error,
      metadata: input.metadata
    });
    const message = await stores.messages.appendMessage({
      agentId: operation.agentId,
      role: "tool",
      content: input.content ?? renderDeferredToolResultContent(operation),
      sourceRunId: operation.runId,
      auth: input.auth ?? operation.auth,
      metadata: {
        type: "tool_result",
        deferredToolOperationId: operation.id,
        toolId: operation.toolId,
        toolCallId: operation.toolCallId,
        status: operation.status,
        ...(input.metadata ?? {})
      }
    });
    const eventType = status === "completed" ? "deferred_tool.completed" : "deferred_tool.failed";
    await stores.events.appendRunEvent({
      runId: operation.runId,
      type: eventType,
      payload: {
        operationId: operation.id,
        toolId: operation.toolId,
        toolCallId: operation.toolCallId,
        status: operation.status,
        messageId: message.id,
        result: operation.result,
        error: operation.error
      },
      sourceRefs: [
        {
          type: "deferred_tool_operation",
          id: operation.id
        },
        {
          type: "message",
          id: message.id
        }
      ]
    });

    const shouldSchedule = input.schedule ?? operation.resumePolicy === "auto";
    if (!shouldSchedule) {
      return { operation, message, inboxEvent: null, scheduled: false };
    }

    const inboxEvent = await stores.inbox.appendInboxEvent({
      agentId: operation.agentId,
      input: {
        type: "system.event",
        payload: {
          event: "deferred_tool.completed",
          operationId: operation.id,
          runId: operation.runId,
          toolId: operation.toolId,
          toolCallId: operation.toolCallId,
          status: operation.status
        },
        messageIds: [message.id]
      },
      auth: input.auth ?? operation.auth,
      metadata: {
        deferredToolOperationId: operation.id,
        toolId: operation.toolId,
        status: operation.status
      }
    });

    await queue.enqueue({
      type: "schedule_agent",
      agentId: operation.agentId
    });

    return { operation, message, inboxEvent, scheduled: true };
  }

  async function enqueueScheduleIfPending(agentId: AgentSessionId): Promise<void> {
    const pending = await stores.inbox.listInboxEvents(agentId, {
      status: "pending",
      limit: 1
    });

    if (pending.length > 0) {
      await queue.enqueue({
        type: "schedule_agent",
        agentId
      });
    }
  }

  async function clearActiveRunIfCurrent(agentId: AgentSessionId, runId: RunId): Promise<void> {
    const agent = await stores.state.getAgentSession(agentId);

    if (agent?.activeRunId === runId) {
      await stores.state.updateAgentSession(agentId, {
        activeRunId: null
      });
    }
  }

  async function resolveSkillPackagesForSession(spec: AgentSpec<TApp>, skillIds: string[]): Promise<SkillPackage[]> {
    const uniqueSkillIds = unique(skillIds);

    if (uniqueSkillIds.length === 0) {
      return [];
    }

    const packages: SkillPackage[] = [];

    for (const skillId of uniqueSkillIds) {
      enforceSkillPolicy(spec, skillId);
      const skillPackage = await skillCatalog.getSkill(skillId);

      if (!skillPackage) {
        throw new HephError({
          code: "HEPH8003",
          title: "Skill not found",
          message: `Skill ${skillId} was not found in the configured SkillCatalog.`,
          status: 422,
          details: {
            agentSpecId: spec.id,
            skillId
          }
        });
      }

      packages.push(skillPackage);
    }

    return packages;
  }

  async function createSkillManifestForRun(agent: AgentSession, run: Run): Promise<SkillManifest> {
    const bindings = await stores.skillBindings.listSkillBindings(agent.id);
    const skills: SkillManifestEntry[] = [];

    for (const binding of bindings) {
      const skillPackage = await skillCatalog.getSkill(binding.skillId);

      if (!skillPackage) {
        throw new HephError({
          code: "HEPH8003",
          title: "Skill not found",
          message: `Skill ${binding.skillId} was not found in the configured SkillCatalog.`,
          status: 422,
          details: {
            agentId: agent.id,
            bindingId: binding.id,
            skillId: binding.skillId
          }
        });
      }

      skills.push({
        bindingId: binding.id,
        skillId: binding.skillId,
        name: skillPackage.name,
        version: skillPackage.version,
        description: skillPackage.description,
        instructions: skillPackage.instructions,
        descriptionHash: await sha256Text(skillPackage.description),
        instructionHash: await sha256Text(skillPackage.instructions),
        source: { ...binding.source },
        availableReferences: filterSkillReferences(skillPackage.references, binding.allowReferences),
        availableAssets: skillPackage.assets.map(cloneSkillResourceRef),
        availableTemplates: skillPackage.templates.map(cloneSkillResourceRef),
        metadata: {
          ...skillPackage.metadata,
          ...binding.metadata
        }
      });
    }

    return {
      runId: run.id,
      skills,
      createdAt: new Date()
    };
  }

  async function createToolManifestForRun(
    agent: AgentSession,
    spec: AgentSpec<TApp>,
    run: Run
  ): Promise<ToolManifest> {
    const tools: ToolManifestTool[] = spec.tools.map(toLocalManifestTool);
    const bindings = await stores.mcpBindings.listMcpBindings(agent.id);

    for (const binding of bindings) {
      enforceMcpPolicy(spec, binding);
      const resolved = await resolveMcpBindingOrThrow({
        resolver: mcpResolver,
        auth: run.auth ?? agent.auth,
        agent,
        binding,
        app
      });
      validateMcpCatalog(binding, resolved);
      tools.push(...filterMcpCatalog(binding, resolved).map((tool) => toMcpManifestTool(binding, tool)));
    }

    return {
      runId: run.id,
      tools,
      createdAt: new Date()
    };
  }

  async function callTool(runId: RunId, input: CallToolInput): Promise<ToolCallResult> {
    const run = await getRunOrThrow(stores, runId);

    if (run.status !== "running" && run.status !== "paused") {
      throw new HephError({
        code: "HEPH3004",
        title: "Tool call is not allowed for this Run status",
        message: `Run ${run.id} is ${run.status}; tool calls require running or paused.`,
        status: 409,
        details: {
          runId: run.id,
          status: run.status,
          toolId: input.toolId
        }
      });
    }

    if (!run.toolManifest) {
      throw new HephError({
        code: "HEPH3003",
        title: "ToolManifest is not ready",
        message: `Run ${run.id} is ${run.status} but has no Run-scoped ToolManifest.`,
        status: 500,
        details: {
          runId: run.id,
          status: run.status,
          toolId: input.toolId
        }
      });
    }

    const manifestTool = run.toolManifest.tools.find((tool) => tool.id === input.toolId);

    if (!manifestTool) {
      throw new HephError({
        code: "HEPH3005",
        title: "Tool is not available for this Run",
        message: `Tool ${input.toolId} is not present in Run ${run.id}'s ToolManifest.`,
        status: 404,
        details: {
          runId: run.id,
          toolId: input.toolId
        }
      });
    }

    const agent = await getAgentOrThrow(stores, run.agentId);
    const spec = await resolveSpecOrThrow(resolver, run.agentSpecId, input.auth ?? run.auth ?? agent.auth);
    const auth = input.auth ?? run.auth;
    const toolInput = input.input ?? {};
    await ensureToolApproval({
      run,
      agent,
      manifestTool,
      input: toolInput,
      auth,
      approvalRequestId: input.approvalRequestId
    });

    await stores.events.appendRunEvent({
      runId: run.id,
      type: "tool.started",
      payload: {
        toolId: manifestTool.id,
        displayName: manifestTool.displayName,
        source: manifestTool.source,
        input: toolInput
      },
      sourceRefs: toolSourceRefs(manifestTool, input.approvalRequestId)
    });

    try {
      const result =
        manifestTool.source === "local"
          ? await callLocalTool({
              spec,
              manifestTool,
              input: toolInput,
              auth,
              agent,
              run,
              signal: input.signal ?? new AbortController().signal
            })
          : await callMcpTool({
              manifestTool,
              input: toolInput,
              auth,
              agent,
              run,
              signal: input.signal
            });

      await stores.events.appendRunEvent({
        runId: run.id,
        type: "tool.completed",
        payload: {
          toolId: manifestTool.id,
          source: manifestTool.source,
          result
        },
        sourceRefs: toolSourceRefs(manifestTool, input.approvalRequestId)
      });

      return {
        toolId: manifestTool.id,
        result,
        ok: true
      };
    } catch (error) {
      await stores.events.appendRunEvent({
        runId: run.id,
        type: "tool.failed",
        payload: {
          toolId: manifestTool.id,
          source: manifestTool.source,
          error: toErrorDetails(error)
        },
        sourceRefs: toolSourceRefs(manifestTool, input.approvalRequestId)
      });
      throw error;
    }
  }

  async function tryCallTool(runId: RunId, input: CallToolInput): Promise<ToolCallAttemptResult> {
    try {
      const result = await callTool(runId, input);
      return {
        ...result,
        ok: true
      };
    } catch (error) {
      if (shouldRethrowToolCallAttemptError(error)) {
        throw error;
      }
      return {
        toolId: input.toolId,
        ok: false,
        error: toRunError(error)
      };
    }
  }

  async function ensureToolApproval(input: {
    run: Run;
    agent: AgentSession;
    manifestTool: ToolManifestTool;
    input: unknown;
    auth: AuthContext | null;
    approvalRequestId?: ApprovalRequestId | undefined;
  }): Promise<void> {
    const requiresApproval = input.manifestTool.requiresApproval || input.manifestTool.sideEffect !== false;

    if (!requiresApproval) {
      return;
    }

    if (input.approvalRequestId) {
      const request = await stores.approvals.getApprovalRequest(input.approvalRequestId);

      if (
        request &&
        request.runId === input.run.id &&
        request.toolId === input.manifestTool.id &&
        request.status === "granted"
      ) {
        return;
      }

      throw new HephError({
        code: "HEPH3002",
        title: "Approval required",
        message: `Tool ${input.manifestTool.id} requires a granted approval request.`,
        status: 409,
        details: {
          approvalRequestId: input.approvalRequestId,
          runId: input.run.id,
          toolId: input.manifestTool.id,
          approvalStatus: request?.status ?? null
        }
      });
    }

    const approval = await stores.approvals.createApprovalRequest({
      agentId: input.agent.id,
      runId: input.run.id,
      toolId: input.manifestTool.id,
      input: input.input,
      requestedBy: input.auth,
      metadata: {
        toolSource: input.manifestTool.source,
        displayName: input.manifestTool.displayName
      }
    });

    if (input.run.status === "running") {
      await stores.state.updateRun(input.run.id, {
        status: "paused"
      });
      await stores.events.appendRunEvent({
        runId: input.run.id,
        type: "run.paused",
        payload: {
          reason: "approval_required",
          approvalRequestId: approval.id,
          toolId: input.manifestTool.id
        },
        sourceRefs: [
          {
            type: "approval_request",
            id: approval.id
          }
        ]
      });
    }

    await stores.events.appendRunEvent({
      runId: input.run.id,
      type: "approval.requested",
      payload: {
        approvalRequestId: approval.id,
        toolId: input.manifestTool.id,
        displayName: input.manifestTool.displayName
      },
      sourceRefs: [
        ...toolSourceRefs(input.manifestTool),
        {
          type: "approval_request",
          id: approval.id
        }
      ]
    });

    throw new HephError({
      code: "HEPH3002",
      title: "Approval required",
      message: `Tool ${input.manifestTool.id} requires approval before execution.`,
      status: 409,
      details: {
        approvalRequestId: approval.id,
        runId: input.run.id,
        toolId: input.manifestTool.id
      }
    });
  }

  async function callLocalTool(input: {
    spec: AgentSpec<TApp>;
    manifestTool: ToolManifestTool;
    input: unknown;
    auth: AuthContext | null;
    agent: AgentSession;
    run: Run;
    signal: AbortSignal;
  }): Promise<unknown> {
    const tool = input.spec.tools.find((candidate) => candidate.id === input.manifestTool.id);

    if (!tool) {
      throw new HephError({
        code: "HEPH3005",
        title: "Local tool is not registered",
        message: `Local tool ${input.manifestTool.id} is not registered on AgentSpec ${input.spec.id}.`,
        status: 500,
        details: {
          toolId: input.manifestTool.id,
          agentSpecId: input.spec.id
        }
      });
    }

    const parsedInput = tool.inputSchema.parse(input.input);
    return tool.execute(parsedInput, {
      auth: input.auth,
      agent: input.agent,
      run: input.run,
      app,
      signal: input.signal
    });
  }

  async function callMcpTool(input: {
    manifestTool: McpToolManifestTool;
    input: unknown;
    auth: AuthContext | null;
    agent: AgentSession;
    run: Run;
    signal?: AbortSignal | undefined;
  }): Promise<unknown> {
    const binding = await stores.mcpBindings.getMcpBinding(input.manifestTool.bindingId);

    if (!binding) {
      throw new HephError({
        code: "HEPH7001",
        title: "MCP binding not found",
        message: `MCP binding ${input.manifestTool.bindingId} was not found.`,
        status: 500,
        details: {
          bindingId: input.manifestTool.bindingId,
          toolId: input.manifestTool.id
        }
      });
    }

    const resolved = await resolveMcpBindingOrThrow({
      resolver: mcpResolver,
      auth: input.auth,
      agent: input.agent,
      binding,
      app
    });

    return mcpToolExecutor.callTool({
      auth: input.auth,
      agent: input.agent,
      run: input.run,
      binding,
      manifestTool: input.manifestTool,
      resolved,
      input: input.input,
      app,
      signal: input.signal
    });
  }

  async function renderRunContext(runId: RunId): Promise<RenderedContext> {
    const run = await getRunOrThrow(stores, runId);
    const agent = await getAgentOrThrow(stores, run.agentId);
    const spec = await resolveSpecOrThrow(resolver, run.agentSpecId, run.auth ?? agent.auth);
    const providerBlocks = await loadProviderBlocks(spec.contextProviders, {
      auth: run.auth,
      agent,
      run,
      spec,
      input: run.input,
      stores,
      app
    });
    const builtInBlocks = createBuiltInBlocks({
      agent,
      spec,
      run,
      runtimePolicy:
        options.runtimePolicy ??
        "Follow the active platform, security, tenant-boundary, and tool policies supplied by the runtime.",
      toolPolicy: options.toolPolicy ?? "Use only the tools listed in the Run-scoped ToolManifest."
    });
    const rendered = renderer.render({
      template: spec.contextTemplate ?? defaultContextTemplate,
      blocks: [...builtInBlocks, ...providerBlocks],
      runId: run.id,
      input: runInputText(run.input),
      runtime: {
        toolPolicy: options.toolPolicy ?? "Use only the tools listed in the Run-scoped ToolManifest."
      }
    });

    await stores.events.appendRunEvent({
      runId: run.id,
      type: "context.rendered",
      payload: {
        contextTemplateId: rendered.manifest.contextTemplateId,
        contextTemplateVersion: rendered.manifest.contextTemplateVersion,
        totalTokens: rendered.manifest.totalTokens,
        blocks: rendered.manifest.blocks.map((block) => ({
          key: block.key,
          type: block.type,
          tokens: block.tokens,
          truncated: block.truncated
        }))
      }
    });

    return rendered;
  }
}

function normalizeAgentSpecResolver<TApp>(registration: AgentSpecRegistration<TApp>): AgentSpecResolver<TApp> {
  if (isAgentSpecResolver(registration)) {
    return registration;
  }

  const specs = new Map<AgentSpecId, AgentSpec<TApp>>();

  if (Array.isArray(registration)) {
    for (const spec of registration) {
      specs.set(spec.id, spec);
    }
  } else {
    for (const [id, spec] of Object.entries(registration)) {
      specs.set(id, spec);
    }
  }

  return {
    async resolve(id) {
      return specs.get(id) ?? null;
    }
  };
}

function isAgentSpecResolver<TApp>(registration: AgentSpecRegistration<TApp>): registration is AgentSpecResolver<TApp> {
  return typeof (registration as AgentSpecResolver<TApp>).resolve === "function";
}

async function resolveSpecOrThrow<TApp>(
  resolver: AgentSpecResolver<TApp>,
  id: AgentSpecId,
  auth: AuthContext | null
): Promise<AgentSpec<TApp>> {
  const spec = await resolver.resolve(id, { auth });

  if (!spec) {
    throw new HephError({
      code: "HEPH1001",
      title: "Agent spec not found",
      message: `Agent spec ${id} was not found.`,
      status: 404,
      details: {
        agentSpecId: id
      }
    });
  }

  return spec;
}

async function getAgentOrThrow(stores: HephStores, agentId: AgentSessionId): Promise<AgentSession> {
  const agent = await stores.state.getAgentSession(agentId);

  if (!agent) {
    throw new HephError({
      code: "HEPH5001",
      title: "AgentSession not found",
      message: `AgentSession ${agentId} was not found.`,
      status: 404,
      details: {
        agentId
      }
    });
  }

  return agent;
}

async function getRunOrThrow(stores: HephStores, runId: RunId): Promise<Run> {
  const run = await stores.state.getRun(runId);

  if (!run) {
    throw new HephError({
      code: "HEPH4001",
      title: "Run not found",
      message: `Run ${runId} was not found.`,
      status: 404,
      details: {
        runId
      }
    });
  }

  return run;
}

async function loadProviderBlocks<TApp>(
  providers: ContextProvider<TApp>[],
  ctx: Parameters<ContextProvider<TApp>["load"]>[0]
): Promise<ContextBlock[]> {
  const blocks: ContextBlock[] = [];

  for (const provider of providers) {
    const loaded = await provider.load(ctx);

    if (!loaded) {
      continue;
    }

    if (Array.isArray(loaded)) {
      blocks.push(...loaded);
    } else {
      blocks.push(loaded);
    }
  }

  return blocks;
}

function enforceMcpPolicy<TApp>(spec: AgentSpec<TApp>, binding: Pick<McpBinding, "capabilityId" | "allowTools">): void {
  if (!spec.mcp) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP is disabled for this AgentSpec",
      message: `AgentSpec ${spec.id} does not allow dynamic MCP bindings.`,
      status: 422,
      details: {
        agentSpecId: spec.id,
        capabilityId: binding.capabilityId
      }
    });
  }

  if (!spec.mcp.allowCapabilities.includes(binding.capabilityId)) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP capability is not allowed",
      message: `AgentSpec ${spec.id} does not allow MCP capability ${binding.capabilityId}.`,
      status: 422,
      details: {
        agentSpecId: spec.id,
        capabilityId: binding.capabilityId
      }
    });
  }

  if (binding.allowTools === "all" && spec.mcp.allowAllTools !== true) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP allowTools all is not allowed",
      message: `AgentSpec ${spec.id} must opt in before an MCP binding can expose all tools.`,
      status: 422,
      details: {
        agentSpecId: spec.id,
        capabilityId: binding.capabilityId
      }
    });
  }
}

function enforceSkillPolicy<TApp>(spec: AgentSpec<TApp>, skillId: string): void {
  if (!spec.skills) {
    throw new HephError({
      code: "HEPH8004",
      title: "Skills are disabled for this AgentSpec",
      message: `AgentSpec ${spec.id} does not allow session skill activation.`,
      status: 422,
      details: {
        agentSpecId: spec.id,
        skillId
      }
    });
  }

  if (spec.skills.allow !== "all" && !spec.skills.allow.includes(skillId)) {
    throw new HephError({
      code: "HEPH8004",
      title: "Skill is not allowed",
      message: `AgentSpec ${spec.id} does not allow skill ${skillId}.`,
      status: 422,
      details: {
        agentSpecId: spec.id,
        skillId
      }
    });
  }
}

async function resolveMcpBindingOrThrow<TApp>(input: {
  resolver: McpBindingResolver<TApp> | null;
  auth: AuthContext | null;
  agent: AgentSession;
  binding: McpBinding;
  app: TApp;
}): Promise<ResolvedMcpBinding<TApp>> {
  if (!input.resolver) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP binding resolver is not configured",
      message: "createHeph({ mcp: { resolver } }) is required before MCP bindings can be resolved.",
      status: 422,
      details: {
        bindingId: input.binding.id,
        capabilityId: input.binding.capabilityId
      }
    });
  }

  const resolved = await input.resolver.resolve({
    auth: input.auth,
    agent: input.agent,
    binding: input.binding,
    app: input.app
  });

  if (resolved.transport !== "streamable_http") {
    throw new HephError({
      code: "HEPH7001",
      title: "Unsupported MCP transport",
      message: "The MCP MVP supports only Streamable HTTP bindings.",
      status: 422,
      details: {
        bindingId: input.binding.id,
        transport: resolved.transport
      }
    });
  }

  if (!resolved.endpoint.trim()) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP endpoint is missing",
      message: "Resolved MCP bindings must include a Streamable HTTP endpoint.",
      status: 422,
      details: {
        bindingId: input.binding.id
      }
    });
  }

  return resolved;
}

function validateMcpCatalog<TApp>(
  binding: Pick<McpBinding, "id" | "capabilityId" | "allowTools">,
  resolved: ResolvedMcpBinding<TApp>
): void {
  const toolNames = new Set(resolved.tools.map((tool) => tool.name));
  const invalidTools = resolved.tools.filter((tool) => !tool.name.trim());

  if (invalidTools.length > 0) {
    throw new HephError({
      code: "HEPH7001",
      title: "MCP tool catalog is invalid",
      message: "MCP tool catalog entries must include non-empty tool names.",
      status: 422,
      details: {
        bindingId: binding.id,
        capabilityId: binding.capabilityId
      }
    });
  }

  if (binding.allowTools !== "all") {
    const unknownTools = binding.allowTools.filter((toolName) => !toolNames.has(toolName));

    if (unknownTools.length > 0) {
      throw new HephError({
        code: "HEPH7001",
        title: "MCP allowTools contains unknown tools",
        message: "MCP binding allowTools must name tools present in the resolved catalog.",
        status: 422,
        details: {
          bindingId: binding.id,
          capabilityId: binding.capabilityId,
          unknownTools
        }
      });
    }
  }
}

function filterMcpCatalog<TApp>(binding: Pick<McpBinding, "allowTools">, resolved: ResolvedMcpBinding<TApp>): McpCatalogTool[] {
  if (binding.allowTools === "all") {
    return resolved.tools;
  }

  const allowSet = new Set(binding.allowTools);
  return resolved.tools.filter((tool) => allowSet.has(tool.name));
}

function toolSourceRefs(tool: ToolManifestTool, approvalRequestId?: ApprovalRequestId | undefined): SourceRef[] {
  const refs: SourceRef[] =
    tool.source === "mcp"
      ? [
          {
            type: "mcp_binding",
            id: tool.bindingId
          }
        ]
      : [];

  if (approvalRequestId) {
    refs.push({
      type: "approval_request",
      id: approvalRequestId
    });
  }

  return refs;
}

function createBuiltInBlocks<TApp>(input: {
  agent: AgentSession;
  spec: AgentSpec<TApp>;
  run: Run;
  runtimePolicy: string;
  toolPolicy: string;
}): ContextBlock[] {
  return [
    {
      key: "runtimePolicy",
      type: "policy",
      content: input.runtimePolicy
    },
    {
      key: "agentIdentity",
      type: "agent_identity",
      content: input.spec.instructions
    },
    {
      key: "currentTask",
      type: "input",
      content: runInputText(input.run.input)
    },
    {
      key: "sessionState",
      type: "state",
      content: JSON.stringify(input.agent.state, null, 2)
    },
    {
      key: "skills",
      type: "skill",
      content: formatSkillsBlock(input.run.skillManifest),
      sourceRefs:
        input.run.skillManifest?.skills.map((skill) => ({
          type: "skill_binding" as const,
          id: skill.bindingId
        })) ?? []
    },
    {
      key: "toolManifest",
      type: "tool_manifest",
      content: JSON.stringify(input.run.toolManifest ?? createLocalToolManifest(input.run.id, input.spec.tools), null, 2)
    }
  ];
}

function createLocalToolManifest(runId: RunId, tools: Tool[]): ToolManifest {
  return {
    runId,
    tools: tools.map(toLocalManifestTool),
    createdAt: new Date()
  };
}

function toLocalManifestTool(tool: Tool): ToolManifestTool {
  return {
    id: tool.id,
    displayName: tool.id,
    source: "local",
    localToolId: tool.id,
    description: tool.description,
    inputSchema: tool.jsonSchema,
    sideEffect: tool.sideEffect,
    requiresApproval: tool.requiresApproval,
    metadata: {}
  };
}

function toMcpManifestTool(binding: McpBinding, tool: McpCatalogTool): McpToolManifestTool {
  const sideEffect = tool.sideEffect ?? null;
  return {
    id: `mcp.${binding.id}.${tool.name}`,
    displayName: `${binding.capabilityId}.${tool.name}`,
    source: "mcp",
    bindingId: binding.id,
    capabilityId: binding.capabilityId,
    remoteToolName: tool.name,
    transport: "streamable_http",
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? {
      type: "object",
      additionalProperties: true
    },
    sideEffect,
    requiresApproval: tool.requiresApproval ?? sideEffect !== false,
    metadata: tool.metadata ?? {}
  };
}

function normalizeRunInput(input: string | RunInput): RunInput {
  if (typeof input === "string") {
    return {
      type: "user.message",
      text: input
    };
  }

  return input;
}

function renderDeferredToolResultContent(operation: DeferredToolOperation): string {
  const lines = [`Deferred tool operation ${operation.id} ${operation.status}.`];
  lines.push(`- toolId: ${operation.toolId}`);
  lines.push(`- runId: ${operation.runId}`);
  if (operation.toolCallId) lines.push(`- toolCallId: ${operation.toolCallId}`);
  if (operation.error) lines.push(`- error: ${operation.error.message}`);
  if (operation.result !== null && operation.result !== undefined) lines.push(`- result: ${JSON.stringify(operation.result)}`);
  return lines.join("\n");
}

function addMessageIdToRunInput(input: RunInput, messageId: MessageId): RunInput {
  return {
    ...input,
    messageIds: [...(input.messageIds ?? []), messageId]
  };
}

function reduceInboxEvents(events: InboxEvent[], textSeparator: string): RunInput {
  const messageIds = unique(events.flatMap((event) => event.input.messageIds ?? []));
  const textEvents = events.filter((event) => "text" in event.input);

  if (textEvents.length === events.length) {
    const first = textEvents[0];

    return {
      type: first?.input.type === "steering.message" || first?.input.type === "follow_up.message" ? first.input.type : "user.message",
      text: textEvents.map((event) => ("text" in event.input ? event.input.text : "")).join(textSeparator),
      messageIds,
      payload: {
        inboxEventIds: events.map((event) => event.id),
        reducedInboxEvents: events.map(toReducedInboxEvent)
      }
    };
  }

  if (events.length === 1) {
    return {
      ...events[0]!.input,
      messageIds,
      payload: {
        ...(typeof events[0]!.input.payload === "object" && events[0]!.input.payload !== null ? events[0]!.input.payload : {}),
        reducedInboxEvents: events.map(toReducedInboxEvent)
      }
    };
  }

  return {
    type: "system.event",
    messageIds,
    payload: {
      inboxEvents: events.map((event) => ({
        id: event.id,
        type: event.type,
        input: event.input
      })),
      reducedInboxEvents: events.map(toReducedInboxEvent)
    }
  };
}

function normalizeMaxEventsPerRun(value: number | null | undefined): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (value === undefined) {
    return 20;
  }

  if (!Number.isFinite(value) || value < 1) {
    throw new HephError({
      code: "HEPH4006",
      title: "Invalid inbox reducer configuration",
      message: "inbox.maxEventsPerRun must be a positive number or null.",
      status: 422,
      details: {
        maxEventsPerRun: value
      }
    });
  }

  return Math.floor(value);
}

function toReducedInboxEvent(event: InboxEvent): Record<string, unknown> {
  const input = event.input;
  return {
    inboxEventId: event.id,
    type: event.type,
    messageIds: input.messageIds ?? [],
    text: "text" in input ? input.text : null
  };
}

function firstAuth(events: InboxEvent[]): AuthContext | null {
  return events.find((event) => event.auth !== null)?.auth ?? null;
}

function toInboxSourceRefs(events: InboxEvent[]): SourceRef[] {
  return events.map((event) => ({
    type: "inbox_event",
    id: event.id
  }));
}

function toRunError(error: unknown): RunError {
  const runError: RunError = {
    message: error instanceof Error ? error.message : String(error),
    details: toErrorDetails(error)
  };

  if (error instanceof HephError) {
    runError.code = error.code;
  }

  return runError;
}

function shouldRethrowToolCallAttemptError(error: unknown): boolean {
  if (!(error instanceof HephError)) {
    return false;
  }

  return error.code === "HEPH3002" || error.code === "HEPH3003" || error.code === "HEPH3004";
}

function isTerminalRun(run: Run): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function runInputText(input: RunInput): string {
  return "text" in input ? input.text : JSON.stringify(input.payload ?? {});
}

function formatSkillsBlock(manifest: SkillManifest | null): string {
  if (!manifest || manifest.skills.length === 0) {
    return "";
  }

  return manifest.skills
    .map((skill) => {
      const version = skill.version ? `@${skill.version}` : "";
      const referenceLines =
        skill.availableReferences.length === 0
          ? ""
          : `\nAvailable references:\n${skill.availableReferences
              .map((ref) => `- ${ref.id}: ${ref.pathOrRef}`)
              .join("\n")}`;

      return `# ${skill.name}${version}\n\nDescription: ${skill.description}\n\nInstructions:\n${skill.instructions}${referenceLines}`;
    })
    .join("\n\n---\n\n");
}

function filterSkillReferences(references: SkillResourceRef[], allowReferences: SkillBinding["allowReferences"]): SkillResourceRef[] {
  if (allowReferences === "all") {
    return references.map(cloneSkillResourceRef);
  }

  const allowSet = new Set(allowReferences);
  return references.filter((reference) => allowSet.has(reference.id)).map(cloneSkillResourceRef);
}

function cloneSkillResourceRef(ref: SkillResourceRef): SkillResourceRef {
  return {
    ...ref,
    metadata: { ...ref.metadata }
  };
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function parseMcpResponseBody(body: string, contentType: string | null): unknown {
  const trimmed = body.trim();

  if (!trimmed) {
    return null;
  }

  if (contentType?.includes("text/event-stream")) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line && line !== "[DONE]");
    const lastData = dataLines.at(-1);

    if (!lastData) {
      return null;
    }

    try {
      return JSON.parse(lastData);
    } catch {
      return lastData;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function isJsonRpcError(value: unknown): value is { error: unknown } {
  return isRecord(value) && "error" in value && value.error !== undefined && value.error !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
