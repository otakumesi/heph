import { HephError } from "./errors.js";
import {
  createApprovalRequestId,
  createAgentSessionId,
  createDeferredToolOperationId,
  createInboxEventId,
  createMemoryId,
  createMcpBindingId,
  createMessageId,
  createRunEventId,
  createRunId,
  createSkillBindingId
} from "./ids.js";
import type {
  AgentSession,
  AgentSessionId,
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalRequestStatus,
  ApprovalStore,
  CreateApprovalRequestStoreInput,
  AppendMessageInput,
  CompleteDeferredToolOperationStoreInput,
  CreateDeferredToolOperationStoreInput,
  AppendInboxEventInput,
  AppendRunEventInput,
  CreateAgentSessionStoreInput,
  CreateMcpBindingStoreInput,
  CreateRunStoreInput,
  CreateSkillBindingStoreInput,
  DecideApprovalRequestStoreInput,
  DeferredToolOperation,
  DeferredToolOperationId,
  DeferredToolOperationStore,
  EventLog,
  HephStores,
  InboxEvent,
  InboxEventId,
  InboxEventStatus,
  InboxStore,
  MemoryItem,
  MemoryScope,
  MemoryStore,
  McpBinding,
  McpBindingId,
  McpBindingStatus,
  McpBindingStore,
  Message,
  MessageStore,
  PutMemoryInput,
  Run,
  RunError,
  RunEvent,
  RunId,
  SearchMemoryInput,
  SkillBinding,
  SkillBindingId,
  SkillBindingStatus,
  SkillBindingStore,
  StateStore
} from "./types.js";

export class InMemoryHephStore
  implements
    StateStore,
    MessageStore,
    InboxStore,
    EventLog,
    MemoryStore,
    McpBindingStore,
    SkillBindingStore,
    ApprovalStore,
    DeferredToolOperationStore,
    HephStores
{
  readonly state: StateStore = this;
  readonly messages: MessageStore = this;
  readonly inbox: InboxStore = this;
  readonly events: EventLog = this;
  readonly memory: MemoryStore = this;
  readonly mcpBindings: McpBindingStore = this;
  readonly skillBindings: SkillBindingStore = this;
  readonly approvals: ApprovalStore = this;
  readonly deferredToolOperations: DeferredToolOperationStore = this;

  private readonly agentSessions = new Map<AgentSessionId, AgentSession>();
  private readonly runs = new Map<RunId, Run>();
  private readonly messageList: Message[] = [];
  private readonly inboxList: InboxEvent[] = [];
  private readonly inboxEvents = new Map<InboxEventId, InboxEvent>();
  private readonly eventList: RunEvent[] = [];
  private readonly eventSeqByRun = new Map<RunId, number>();
  private readonly memoryItems = new Map<string, MemoryItem>();
  private readonly mcpBindingList: McpBinding[] = [];
  private readonly mcpBindingsById = new Map<McpBindingId, McpBinding>();
  private readonly skillBindingList: SkillBinding[] = [];
  private readonly skillBindingsById = new Map<SkillBindingId, SkillBinding>();
  private readonly approvalRequests = new Map<ApprovalRequestId, ApprovalRequest>();
  private readonly deferredOperations = new Map<DeferredToolOperationId, DeferredToolOperation>();

  async createAgentSession(input: CreateAgentSessionStoreInput): Promise<AgentSession> {
    const now = new Date();
    const agent: AgentSession = {
      id: input.id ?? createAgentSessionId(),
      agentSpecId: input.agentSpecId,
      agentSpecVersion: input.agentSpecVersion ?? null,
      state: input.state ?? {},
      activeRunId: null,
      auth: input.auth ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.agentSessions.set(agent.id, cloneAgentSession(agent));
    return cloneAgentSession(agent);
  }

  async getAgentSession(id: AgentSessionId): Promise<AgentSession | null> {
    const agent = this.agentSessions.get(id);
    return agent ? cloneAgentSession(agent) : null;
  }

  async updateAgentSession(
    id: AgentSessionId,
    patch: Partial<Omit<AgentSession, "id" | "createdAt">>
  ): Promise<AgentSession> {
    const existing = this.agentSessions.get(id);

    if (!existing) {
      throw notFound("AgentSession not found", { agentId: id });
    }

    const updated: AgentSession = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    };

    this.agentSessions.set(id, cloneAgentSession(updated));
    return cloneAgentSession(updated);
  }

  async createRun(input: CreateRunStoreInput): Promise<Run> {
    const now = new Date();
    const run: Run = {
      id: input.id ?? createRunId(),
      agentId: input.agentId,
      agentSpecId: input.agentSpecId,
      agentSpecVersion: input.agentSpecVersion ?? null,
      status: input.status,
      input: input.input,
      auth: input.auth ?? null,
      contextManifest: null,
      skillManifest: null,
      toolManifest: null,
      error: null,
      metadata: input.metadata ?? {},
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.runs.set(run.id, cloneRun(run));
    return cloneRun(run);
  }

  async getRun(id: RunId): Promise<Run | null> {
    const run = this.runs.get(id);
    return run ? cloneRun(run) : null;
  }

  async updateRun(id: RunId, patch: Partial<Omit<Run, "id" | "createdAt">>): Promise<Run> {
    const existing = this.runs.get(id);

    if (!existing) {
      throw notFound("Run not found", { runId: id });
    }

    const updated: Run = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date()
    };

    this.runs.set(id, cloneRun(updated));
    return cloneRun(updated);
  }

  async listRunsByAgent(agentId: AgentSessionId): Promise<Run[]> {
    return Array.from(this.runs.values())
      .filter((run) => run.agentId === agentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneRun);
  }

  async appendMessage(input: AppendMessageInput): Promise<Message> {
    const message: Message = {
      id: input.id ?? createMessageId(),
      agentId: input.agentId,
      role: input.role,
      content: input.content,
      sourceRunId: input.sourceRunId ?? null,
      auth: input.auth ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date()
    };

    this.messageList.push(cloneMessage(message));
    return cloneMessage(message);
  }

  async listMessages(agentId: AgentSessionId, options: { limit?: number } = {}): Promise<Message[]> {
    const messages = this.messageList
      .filter((message) => message.agentId === agentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const limited = options.limit === undefined ? messages : messages.slice(Math.max(0, messages.length - options.limit));
    return limited.map(cloneMessage);
  }

  async appendInboxEvent(input: AppendInboxEventInput): Promise<InboxEvent> {
    const now = new Date();
    const event: InboxEvent = {
      id: input.id ?? createInboxEventId(),
      agentId: input.agentId,
      type: input.input.type,
      input: clonePlain(input.input),
      status: "pending",
      runId: null,
      auth: input.auth ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      claimedAt: null,
      processedAt: null,
      failedAt: null,
      error: null
    };

    this.inboxList.push(cloneInboxEvent(event));
    this.inboxEvents.set(event.id, cloneInboxEvent(event));
    return cloneInboxEvent(event);
  }

  async getInboxEvent(id: InboxEventId): Promise<InboxEvent | null> {
    const event = this.inboxEvents.get(id);
    return event ? cloneInboxEvent(event) : null;
  }

  async listInboxEvents(
    agentId: AgentSessionId,
    options: { status?: InboxEventStatus; types?: Array<InboxEvent["type"]>; limit?: number } = {}
  ): Promise<InboxEvent[]> {
    const events = this.inboxList
      .filter((event) => event.agentId === agentId)
      .filter((event) => options.status === undefined || event.status === options.status)
      .filter((event) => options.types === undefined || options.types.includes(event.type))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const limited = options.limit === undefined ? events : events.slice(0, options.limit);
    return limited.map(cloneInboxEvent);
  }

  async claimPendingInboxEvents(
    agentId: AgentSessionId,
    options: { types?: Array<InboxEvent["type"]>; limit?: number } = {}
  ): Promise<InboxEvent[]> {
    const now = new Date();
    const pending = this.inboxList
      .filter((event) => event.agentId === agentId && event.status === "pending")
      .filter((event) => options.types === undefined || options.types.includes(event.type))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const selected = options.limit === undefined ? pending : pending.slice(0, options.limit);

    return selected.map((event) => {
      const updated = this.replaceInboxEvent({
        ...event,
        status: "processing",
        claimedAt: now,
        updatedAt: now
      });
      return cloneInboxEvent(updated);
    });
  }

  async markInboxEventsProcessed(ids: InboxEventId[], runId: RunId): Promise<InboxEvent[]> {
    const now = new Date();
    return ids.map((id) =>
      cloneInboxEvent(
        this.replaceInboxEvent({
          ...this.getInboxEventOrThrow(id),
          status: "processed",
          runId,
          processedAt: now,
          updatedAt: now,
          error: null
        })
      )
    );
  }

  async markInboxEventsFailed(ids: InboxEventId[], error: RunError): Promise<InboxEvent[]> {
    const now = new Date();
    return ids.map((id) =>
      cloneInboxEvent(
        this.replaceInboxEvent({
          ...this.getInboxEventOrThrow(id),
          status: "failed",
          failedAt: now,
          updatedAt: now,
          error
        })
      )
    );
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<RunEvent> {
    const seq = (this.eventSeqByRun.get(input.runId) ?? 0) + 1;
    this.eventSeqByRun.set(input.runId, seq);

    const event: RunEvent = {
      id: input.id ?? createRunEventId(),
      runId: input.runId,
      seq,
      type: input.type,
      payload: input.payload ?? {},
      sourceRefs: input.sourceRefs ?? [],
      createdAt: new Date()
    };

    this.eventList.push(cloneRunEvent(event));
    return cloneRunEvent(event);
  }

  async listRunEvents(runId: RunId, options: { after?: number; limit?: number } = {}): Promise<RunEvent[]> {
    const after = options.after ?? 0;
    const events = this.eventList
      .filter((event) => event.runId === runId && event.seq > after)
      .sort((a, b) => a.seq - b.seq);

    const limited = options.limit === undefined ? events : events.slice(0, options.limit);
    return limited.map(cloneRunEvent);
  }

  async putMemory(input: PutMemoryInput): Promise<MemoryItem> {
    const now = new Date();
    const existing = input.id ? this.memoryItems.get(input.id) : undefined;
    const item: MemoryItem = {
      id: input.id ?? createMemoryId(),
      scope: input.scope,
      kind: input.kind,
      content: input.content,
      sourceRefs: input.sourceRefs,
      importance: input.importance ?? null,
      confidence: input.confidence ?? null,
      embeddingRef: input.embeddingRef ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.memoryItems.set(item.id, cloneMemoryItem(item));
    return cloneMemoryItem(item);
  }

  async searchMemory(input: SearchMemoryInput): Promise<MemoryItem[]> {
    const now = Date.now();
    const query = input.query?.trim().toLowerCase();
    const topK = input.topK ?? 8;
    const scopes = input.scopes ?? [];

    return Array.from(this.memoryItems.values())
      .filter((item) => item.expiresAt === null || item.expiresAt.getTime() > now)
      .filter((item) => scopes.length === 0 || scopes.some((scope) => sameScope(scope, item.scope)))
      .map((item) => ({
        item,
        score: scoreMemory(item, query)
      }))
      .filter(({ score }) => score > 0 || !query)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.getTime() - a.item.updatedAt.getTime())
      .slice(0, topK)
      .map(({ item }) => cloneMemoryItem(item));
  }

  async createMcpBinding(input: CreateMcpBindingStoreInput): Promise<McpBinding> {
    const now = new Date();
    const binding: McpBinding = {
      id: input.id ?? createMcpBindingId(),
      agentId: input.agentId,
      capabilityId: input.capabilityId,
      accountRef: input.accountRef ?? null,
      allowTools: clonePlain(input.allowTools),
      status: "active",
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      removedAt: null
    };

    this.mcpBindingList.push(cloneMcpBinding(binding));
    this.mcpBindingsById.set(binding.id, cloneMcpBinding(binding));
    return cloneMcpBinding(binding);
  }

  async getMcpBinding(id: McpBindingId): Promise<McpBinding | null> {
    const binding = this.mcpBindingsById.get(id);
    return binding ? cloneMcpBinding(binding) : null;
  }

  async listMcpBindings(
    agentId: AgentSessionId,
    options: { status?: McpBindingStatus | "all" | undefined } = {}
  ): Promise<McpBinding[]> {
    const status = options.status ?? "active";
    return this.mcpBindingList
      .filter((binding) => binding.agentId === agentId)
      .filter((binding) => status === "all" || binding.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneMcpBinding);
  }

  async removeMcpBinding(id: McpBindingId): Promise<McpBinding> {
    const existing = this.mcpBindingsById.get(id);

    if (!existing) {
      throw notFound("McpBinding not found", { bindingId: id });
    }

    const now = new Date();
    const updated: McpBinding = {
      ...existing,
      status: "removed",
      updatedAt: now,
      removedAt: existing.removedAt ?? now
    };

    this.replaceMcpBinding(updated);
    return cloneMcpBinding(updated);
  }

  async createSkillBinding(input: CreateSkillBindingStoreInput): Promise<SkillBinding> {
    const now = new Date();
    const binding: SkillBinding = {
      id: input.id ?? createSkillBindingId(),
      agentId: input.agentId,
      skillId: input.skillId,
      name: input.name,
      version: input.version ?? null,
      source: { ...input.source },
      allowReferences: input.allowReferences === undefined ? [] : clonePlain(input.allowReferences),
      status: "active",
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      removedAt: null
    };

    this.skillBindingList.push(cloneSkillBinding(binding));
    this.skillBindingsById.set(binding.id, cloneSkillBinding(binding));
    return cloneSkillBinding(binding);
  }

  async getSkillBinding(id: SkillBindingId): Promise<SkillBinding | null> {
    const binding = this.skillBindingsById.get(id);
    return binding ? cloneSkillBinding(binding) : null;
  }

  async listSkillBindings(
    agentId: AgentSessionId,
    options: { status?: SkillBindingStatus | "all" | undefined } = {}
  ): Promise<SkillBinding[]> {
    const status = options.status ?? "active";
    return this.skillBindingList
      .filter((binding) => binding.agentId === agentId)
      .filter((binding) => status === "all" || binding.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneSkillBinding);
  }

  async removeSkillBinding(id: SkillBindingId): Promise<SkillBinding> {
    const existing = this.skillBindingsById.get(id);

    if (!existing) {
      throw notFound("SkillBinding not found", { bindingId: id });
    }

    const now = new Date();
    const updated: SkillBinding = {
      ...existing,
      status: "removed",
      updatedAt: now,
      removedAt: existing.removedAt ?? now
    };

    this.replaceSkillBinding(updated);
    return cloneSkillBinding(updated);
  }

  async createApprovalRequest(input: CreateApprovalRequestStoreInput): Promise<ApprovalRequest> {
    const now = new Date();
    const request: ApprovalRequest = {
      id: input.id ?? createApprovalRequestId(),
      agentId: input.agentId,
      runId: input.runId,
      toolId: input.toolId,
      input: clonePlain(input.input),
      status: "pending",
      requestedBy: input.requestedBy ?? null,
      decidedBy: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      decidedAt: null
    };

    this.approvalRequests.set(request.id, cloneApprovalRequest(request));
    return cloneApprovalRequest(request);
  }

  async getApprovalRequest(id: ApprovalRequestId): Promise<ApprovalRequest | null> {
    const request = this.approvalRequests.get(id);
    return request ? cloneApprovalRequest(request) : null;
  }

  async listApprovalRequests(
    runId: RunId,
    options: { status?: ApprovalRequestStatus | "all" | undefined } = {}
  ): Promise<ApprovalRequest[]> {
    const status = options.status ?? "all";
    return Array.from(this.approvalRequests.values())
      .filter((request) => request.runId === runId)
      .filter((request) => status === "all" || request.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneApprovalRequest);
  }

  async decideApprovalRequest(input: DecideApprovalRequestStoreInput): Promise<ApprovalRequest> {
    const existing = this.approvalRequests.get(input.id);

    if (!existing) {
      throw notFound("ApprovalRequest not found", { approvalRequestId: input.id });
    }

    const now = new Date();
    const updated: ApprovalRequest = {
      ...existing,
      status: input.decision,
      decidedBy: input.decidedBy ?? null,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {})
      },
      updatedAt: now,
      decidedAt: now
    };

    this.approvalRequests.set(input.id, cloneApprovalRequest(updated));
    return cloneApprovalRequest(updated);
  }

  async createDeferredToolOperation(input: CreateDeferredToolOperationStoreInput): Promise<DeferredToolOperation> {
    const now = new Date();
    const operation: DeferredToolOperation = {
      id: input.id ?? createDeferredToolOperationId(),
      agentId: input.agentId,
      runId: input.runId,
      toolId: input.toolId,
      toolCallId: input.toolCallId ?? null,
      status: "pending",
      resumePolicy: input.resumePolicy ?? "auto",
      auth: input.auth ?? null,
      result: null,
      error: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    this.deferredOperations.set(operation.id, cloneDeferredToolOperation(operation));
    return cloneDeferredToolOperation(operation);
  }

  async getDeferredToolOperation(id: DeferredToolOperationId): Promise<DeferredToolOperation | null> {
    const operation = this.deferredOperations.get(id);
    return operation ? cloneDeferredToolOperation(operation) : null;
  }

  async completeDeferredToolOperation(input: CompleteDeferredToolOperationStoreInput): Promise<DeferredToolOperation> {
    const existing = this.deferredOperations.get(input.id);

    if (!existing) {
      throw notFound("DeferredToolOperation not found", { operationId: input.id });
    }

    if (existing.status !== "pending") {
      return cloneDeferredToolOperation(existing);
    }

    const now = new Date();
    const updated: DeferredToolOperation = {
      ...existing,
      status: input.status,
      result: input.result ?? null,
      error: input.error ?? null,
      metadata: {
        ...existing.metadata,
        ...(input.metadata ?? {})
      },
      updatedAt: now,
      completedAt: now
    };

    this.deferredOperations.set(updated.id, cloneDeferredToolOperation(updated));
    return cloneDeferredToolOperation(updated);
  }

  private replaceInboxEvent(updated: InboxEvent): InboxEvent {
    const index = this.inboxList.findIndex((event) => event.id === updated.id);

    if (index === -1) {
      throw notFound("InboxEvent not found", { inboxEventId: updated.id });
    }

    this.inboxList[index] = cloneInboxEvent(updated);
    this.inboxEvents.set(updated.id, cloneInboxEvent(updated));
    return cloneInboxEvent(updated);
  }

  private getInboxEventOrThrow(id: InboxEventId): InboxEvent {
    const event = this.inboxEvents.get(id);

    if (!event) {
      throw notFound("InboxEvent not found", { inboxEventId: id });
    }

    return cloneInboxEvent(event);
  }

  private replaceMcpBinding(updated: McpBinding): McpBinding {
    const index = this.mcpBindingList.findIndex((binding) => binding.id === updated.id);

    if (index === -1) {
      throw notFound("McpBinding not found", { bindingId: updated.id });
    }

    this.mcpBindingList[index] = cloneMcpBinding(updated);
    this.mcpBindingsById.set(updated.id, cloneMcpBinding(updated));
    return cloneMcpBinding(updated);
  }

  private replaceSkillBinding(updated: SkillBinding): SkillBinding {
    const index = this.skillBindingList.findIndex((binding) => binding.id === updated.id);

    if (index === -1) {
      throw notFound("SkillBinding not found", { bindingId: updated.id });
    }

    this.skillBindingList[index] = cloneSkillBinding(updated);
    this.skillBindingsById.set(updated.id, cloneSkillBinding(updated));
    return cloneSkillBinding(updated);
  }
}

function scoreMemory(item: MemoryItem, query: string | undefined): number {
  const importance = item.importance ?? 0.5;
  const confidence = item.confidence ?? 0.5;
  const content = item.content.toLowerCase();
  const queryScore = query && content.includes(query) ? 2 : 0;
  return importance + confidence + queryScore;
}

function sameScope(a: MemoryScope, b: MemoryScope): boolean {
  return a.type === b.type && a.id === b.id;
}

function notFound(message: string, details: Record<string, unknown>): HephError {
  return new HephError({
    code: "HEPH5001",
    title: message,
    message,
    status: 404,
    details
  });
}

function cloneAgentSession(agent: AgentSession): AgentSession {
  return {
    ...agent,
    state: { ...agent.state },
    metadata: { ...agent.metadata },
    auth: agent.auth ? { ...agent.auth } : null,
    createdAt: new Date(agent.createdAt),
    updatedAt: new Date(agent.updatedAt)
  };
}

function cloneRun(run: Run): Run {
  return {
    ...run,
    input: clonePlain(run.input),
    auth: run.auth ? { ...run.auth } : null,
    contextManifest: run.contextManifest ? clonePlain(run.contextManifest) : null,
    skillManifest: run.skillManifest ? clonePlain(run.skillManifest) : null,
    toolManifest: run.toolManifest ? clonePlain(run.toolManifest) : null,
    error: run.error ? clonePlain(run.error) : null,
    metadata: { ...run.metadata },
    queuedAt: new Date(run.queuedAt),
    startedAt: run.startedAt ? new Date(run.startedAt) : null,
    completedAt: run.completedAt ? new Date(run.completedAt) : null,
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt)
  };
}

function cloneMessage(message: Message): Message {
  return {
    ...message,
    auth: message.auth ? { ...message.auth } : null,
    metadata: { ...message.metadata },
    createdAt: new Date(message.createdAt)
  };
}

function cloneInboxEvent(event: InboxEvent): InboxEvent {
  return {
    ...event,
    input: clonePlain(event.input),
    auth: event.auth ? { ...event.auth } : null,
    metadata: { ...event.metadata },
    createdAt: new Date(event.createdAt),
    updatedAt: new Date(event.updatedAt),
    claimedAt: event.claimedAt ? new Date(event.claimedAt) : null,
    processedAt: event.processedAt ? new Date(event.processedAt) : null,
    failedAt: event.failedAt ? new Date(event.failedAt) : null,
    error: event.error ? clonePlain(event.error) : null
  };
}

function cloneRunEvent(event: RunEvent): RunEvent {
  return {
    ...event,
    payload: clonePlain(event.payload),
    sourceRefs: event.sourceRefs.map((ref) => ({ ...ref })),
    createdAt: new Date(event.createdAt)
  };
}

function cloneMemoryItem(item: MemoryItem): MemoryItem {
  return {
    ...item,
    scope: { ...item.scope },
    sourceRefs: item.sourceRefs.map((ref) => ({ ...ref })),
    expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt)
  };
}

function cloneMcpBinding(binding: McpBinding): McpBinding {
  return {
    ...binding,
    allowTools: clonePlain(binding.allowTools),
    metadata: { ...binding.metadata },
    createdAt: new Date(binding.createdAt),
    updatedAt: new Date(binding.updatedAt),
    removedAt: binding.removedAt ? new Date(binding.removedAt) : null
  };
}

function cloneSkillBinding(binding: SkillBinding): SkillBinding {
  return {
    ...binding,
    source: { ...binding.source },
    allowReferences: clonePlain(binding.allowReferences),
    metadata: { ...binding.metadata },
    createdAt: new Date(binding.createdAt),
    updatedAt: new Date(binding.updatedAt),
    removedAt: binding.removedAt ? new Date(binding.removedAt) : null
  };
}

function cloneApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    input: clonePlain(request.input),
    requestedBy: request.requestedBy ? { ...request.requestedBy } : null,
    decidedBy: request.decidedBy ? { ...request.decidedBy } : null,
    metadata: { ...request.metadata },
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
    decidedAt: request.decidedAt ? new Date(request.decidedAt) : null
  };
}

function cloneDeferredToolOperation(operation: DeferredToolOperation): DeferredToolOperation {
  return {
    ...operation,
    auth: operation.auth ? { ...operation.auth } : null,
    result: clonePlain(operation.result),
    error: operation.error ? clonePlain(operation.error) : null,
    metadata: { ...operation.metadata },
    createdAt: new Date(operation.createdAt),
    updatedAt: new Date(operation.updatedAt),
    completedAt: operation.completedAt ? new Date(operation.completedAt) : null
  };
}

function clonePlain<T>(value: T): T {
  return structuredClone(value);
}
