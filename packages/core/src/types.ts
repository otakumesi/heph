import type { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export type AgentSessionId = string;
export type RunId = string;
export type MessageId = string;
export type RunEventId = string;
export type MemoryId = string;
export type InboxEventId = string;
export type DeferredToolOperationId = string;
export type AgentSpecId = string;
export type McpBindingId = string;
export type SkillBindingId = string;
export type ApprovalRequestId = string;

export interface AuthContext {
  subject: string;
  userId?: string | undefined;
  tenantId?: string | undefined;
  roles?: string[] | undefined;
  scopes?: string[] | undefined;
  actorType?: "user" | "service" | "anonymous" | undefined;
  claims?: Record<string, unknown> | undefined;
}

export interface AuthAdapter {
  authenticate(request: Request): Promise<AuthContext | null>;
}

export interface SourceRef {
  type:
    | "message"
    | "run_event"
    | "artifact"
    | "manual"
    | "memory"
    | "inbox_event"
    | "mcp_binding"
    | "skill_binding"
    | "approval_request"
    | "deferred_tool_operation";
  id: string;
}

export interface AgentSession {
  id: AgentSessionId;
  agentSpecId: AgentSpecId;
  agentSpecVersion: string | null;
  state: Record<string, unknown>;
  activeRunId: RunId | null;
  auth: AuthContext | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type RunInput =
  | {
      type: "user.message" | "steering.message" | "follow_up.message";
      text: string;
      messageIds?: MessageId[];
      payload?: unknown;
    }
  | {
      type: "approval.granted" | "approval.rejected" | "run.cancel_requested" | "webhook.received" | "system.event";
      payload?: unknown;
      messageIds?: MessageId[];
    };

export interface RunError {
  code?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Run {
  id: RunId;
  agentId: AgentSessionId;
  agentSpecId: AgentSpecId;
  agentSpecVersion: string | null;
  status: RunStatus;
  input: RunInput;
  auth: AuthContext | null;
  contextManifest: ContextManifest | null;
  skillManifest: SkillManifest | null;
  toolManifest: ToolManifest | null;
  error: RunError | null;
  metadata: Record<string, unknown>;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface Message {
  id: MessageId;
  agentId: AgentSessionId;
  role: MessageRole;
  content: string;
  sourceRunId: RunId | null;
  auth: AuthContext | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type InboxEventStatus = "pending" | "processing" | "processed" | "failed";

export interface InboxEvent {
  id: InboxEventId;
  agentId: AgentSessionId;
  type: RunInput["type"];
  input: RunInput;
  status: InboxEventStatus;
  runId: RunId | null;
  auth: AuthContext | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  claimedAt: Date | null;
  processedAt: Date | null;
  failedAt: Date | null;
  error: RunError | null;
}

export type RunEventType =
  | "run.cancel_requested"
  | "run.queued"
  | "run.started"
  | "run.steering_received"
  | "run.paused"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "turn.started"
  | "turn.completed"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "tool.started"
  | "tool.updated"
  | "tool.deferred"
  | "tool.completed"
  | "tool.failed"
  | "deferred_tool.completed"
  | "deferred_tool.failed"
  | "skill_manifest.created"
  | "tool_manifest.created"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "context.rendered";

export interface RunEvent {
  id: RunEventId;
  runId: RunId;
  seq: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  sourceRefs: SourceRef[];
  createdAt: Date;
}

export interface MemoryScope {
  type: "user" | "project" | "team" | "agent" | "session";
  id: string;
}

export interface MemoryItem {
  id: MemoryId;
  scope: MemoryScope;
  kind: "fact" | "preference" | "decision" | "summary" | "entity" | "lesson";
  content: string;
  sourceRefs: SourceRef[];
  importance: number | null;
  confidence: number | null;
  embeddingRef: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ContextBlockType =
  | "policy"
  | "agent_identity"
  | "state"
  | "memory"
  | "message_summary"
  | "message_history"
  | "context_provider"
  | "skill"
  | "tool_manifest"
  | "artifact"
  | "team"
  | "input";

export interface ContextBlock {
  key: string;
  type: ContextBlockType;
  content: string;
  priority?: number;
  sourceRefs?: SourceRef[];
  metadata?: Record<string, unknown>;
}

export interface ContextSlot {
  required?: boolean;
  maxTokens?: number;
}

export interface ContextTemplateMessage {
  role: Extract<MessageRole, "system" | "developer" | "user" | "assistant">;
  content: string;
}

export interface ContextTemplate {
  id: string;
  version: string;
  slots: Record<string, ContextSlot>;
  messages: ContextTemplateMessage[];
}

export interface ContextManifestBlock {
  key: string;
  type: ContextBlockType;
  tokens: number;
  sourceRefs: SourceRef[];
  truncated: boolean;
}

export interface ContextManifest {
  runId: RunId;
  contextTemplateId: string;
  contextTemplateVersion: string;
  blocks: ContextManifestBlock[];
  totalTokens: number;
  createdAt: Date;
}

export interface RenderedContext {
  messages: ContextTemplateMessage[];
  manifest: ContextManifest;
}

export interface ToolExecutionContext<TApp = unknown> {
  auth: AuthContext | null;
  agent: AgentSession;
  run: Run;
  app: TApp;
  signal: AbortSignal;
}

export type ToolConcurrencyKeyFn<TInput> = (args: { input: TInput; auth: AuthContext | null; agent: AgentSession }) => string;

export interface Tool<TInput = unknown, TResult = unknown, TApp = unknown> {
  id: string;
  description: string;
  inputSchema: z.ZodType;
  jsonSchema: JsonSchema;
  sideEffect: boolean;
  requiresApproval: boolean;
  concurrencyKey?: ToolConcurrencyKeyFn<TInput>;
  execute(input: TInput, ctx: ToolExecutionContext<TApp>): Promise<TResult> | TResult;
}

export type ToolManifestSource = "local" | "mcp";

export interface ToolManifest {
  runId: RunId;
  tools: ToolManifestTool[];
  createdAt: Date;
}

export type ToolManifestTool = LocalToolManifestTool | McpToolManifestTool;

export interface ToolManifestToolBase {
  id: string;
  displayName: string;
  source: ToolManifestSource;
  description: string;
  inputSchema: JsonSchema;
  sideEffect: boolean | null;
  requiresApproval: boolean;
  metadata: Record<string, unknown>;
}

export interface LocalToolManifestTool extends ToolManifestToolBase {
  source: "local";
  localToolId: string;
}

export interface McpToolManifestTool extends ToolManifestToolBase {
  source: "mcp";
  bindingId: McpBindingId;
  capabilityId: string;
  remoteToolName: string;
  transport: "streamable_http";
}

export interface ToolDefinition<TSchema extends z.ZodType, TResult = unknown, TApp = unknown> {
  id: string;
  description: string;
  inputSchema: TSchema;
  sideEffect?: boolean;
  requiresApproval?: boolean;
  concurrencyKey?: ToolConcurrencyKeyFn<z.infer<TSchema>>;
  execute(input: z.infer<TSchema>, ctx: ToolExecutionContext<TApp>): Promise<TResult> | TResult;
}

export type SkillBindingSource =
  | {
      type: "local";
      pathOrRef: string;
    }
  | {
      type: "host-resolved";
      pathOrRef?: string | undefined;
    };

export type SkillBindingStatus = "active" | "removed";

export type SkillAllowReferences = string[] | "all";

export interface SkillResourceRef {
  id: string;
  pathOrRef: string;
  contentType: string | null;
  metadata: Record<string, unknown>;
}

export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  version: string | null;
  instructions: string;
  source: SkillBindingSource;
  references: SkillResourceRef[];
  assets: SkillResourceRef[];
  templates: SkillResourceRef[];
  metadata: Record<string, unknown>;
  loadedAt: Date;
}

export interface SkillCatalog {
  getSkill(id: string): Promise<SkillPackage | null>;
  listSkills?(): Promise<SkillPackage[]>;
}

export interface SkillManifest {
  runId: RunId;
  skills: SkillManifestEntry[];
  createdAt: Date;
}

export interface SkillManifestEntry {
  bindingId: SkillBindingId;
  skillId: string;
  name: string;
  version: string | null;
  description: string;
  instructions: string;
  descriptionHash: string;
  instructionHash: string;
  source: SkillBindingSource;
  availableReferences: SkillResourceRef[];
  availableAssets: SkillResourceRef[];
  availableTemplates: SkillResourceRef[];
  metadata: Record<string, unknown>;
}

export interface ContextProviderContext<TApp = unknown> {
  auth: AuthContext | null;
  agent: AgentSession;
  run: Run;
  spec: AgentSpec<TApp>;
  input: RunInput;
  stores: HephStores;
  app: TApp;
}

export interface ContextProvider<TApp = unknown> {
  id: string;
  load(ctx: ContextProviderContext<TApp>): Promise<ContextBlock | ContextBlock[] | null | undefined>;
}

export interface ContextProviderDefinition<TApp = unknown> {
  id: string;
  load(ctx: ContextProviderContext<TApp>): Promise<ContextBlock | ContextBlock[] | null | undefined>;
}

export interface AgentSpec<TApp = unknown> {
  id: AgentSpecId;
  version: string | null;
  instructions: string;
  model: string | null;
  tools: Tool<any, any, TApp>[];
  mcp: McpAgentPolicy | null;
  skills: SkillAgentPolicy | null;
  contextProviders: ContextProvider<TApp>[];
  contextTemplate: ContextTemplate | null;
  metadata: Record<string, unknown>;
}

export interface AgentDefinition<TApp = unknown> {
  id: AgentSpecId;
  version?: string;
  instructions: string;
  model?: string;
  tools?: Tool<any, any, TApp>[];
  mcp?: McpAgentPolicy | string[] | null;
  allowAllMcpTools?: boolean;
  skills?: SkillAgentPolicy | string[] | "all" | null;
  contextProviders?: ContextProvider<TApp>[];
  context?: ContextProvider<TApp>[];
  contextTemplate?: ContextTemplate;
  metadata?: Record<string, unknown>;
}

export interface McpAgentPolicy {
  allowCapabilities: string[];
  allowAllTools?: boolean;
}

export interface SkillAgentPolicy {
  allow: string[] | "all";
}

export type McpAllowTools = string[] | "all";

export type McpBindingStatus = "active" | "removed";

export interface McpBinding {
  id: McpBindingId;
  agentId: AgentSessionId;
  capabilityId: string;
  accountRef: string | null;
  allowTools: McpAllowTools;
  status: McpBindingStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface CreateMcpBindingStoreInput {
  id?: McpBindingId;
  agentId: AgentSessionId;
  capabilityId: string;
  accountRef?: string | null | undefined;
  allowTools: McpAllowTools;
  metadata?: Record<string, unknown> | undefined;
}

export interface SkillBinding {
  id: SkillBindingId;
  agentId: AgentSessionId;
  skillId: string;
  name: string;
  version: string | null;
  source: SkillBindingSource;
  allowReferences: SkillAllowReferences;
  status: SkillBindingStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface CreateSkillBindingStoreInput {
  id?: SkillBindingId;
  agentId: AgentSessionId;
  skillId: string;
  name: string;
  version?: string | null | undefined;
  source: SkillBindingSource;
  allowReferences?: SkillAllowReferences | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type ApprovalRequestStatus = "pending" | "granted" | "rejected";

export interface ApprovalRequest {
  id: ApprovalRequestId;
  agentId: AgentSessionId;
  runId: RunId;
  toolId: string;
  input: unknown;
  status: ApprovalRequestStatus;
  requestedBy: AuthContext | null;
  decidedBy: AuthContext | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
}

export type DeferredToolOperationStatus = "pending" | "completed" | "failed" | "cancelled";
export type DeferredToolResumePolicy = "auto" | "manual";

export interface DeferredToolOperation {
  id: DeferredToolOperationId;
  agentId: AgentSessionId;
  runId: RunId;
  toolId: string;
  toolCallId: string | null;
  status: DeferredToolOperationStatus;
  resumePolicy: DeferredToolResumePolicy;
  auth: AuthContext | null;
  result: unknown;
  error: RunError | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CreateDeferredToolOperationStoreInput {
  id?: DeferredToolOperationId;
  agentId: AgentSessionId;
  runId: RunId;
  toolId: string;
  toolCallId?: string | null | undefined;
  resumePolicy?: DeferredToolResumePolicy | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CompleteDeferredToolOperationStoreInput {
  id: DeferredToolOperationId;
  status: Extract<DeferredToolOperationStatus, "completed" | "failed" | "cancelled">;
  result?: unknown;
  error?: RunError | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateApprovalRequestStoreInput {
  id?: ApprovalRequestId;
  agentId: AgentSessionId;
  runId: RunId;
  toolId: string;
  input: unknown;
  requestedBy?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface DecideApprovalRequestStoreInput {
  id: ApprovalRequestId;
  decision: Extract<ApprovalRequestStatus, "granted" | "rejected">;
  decidedBy?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface McpCatalogTool {
  name: string;
  description?: string | undefined;
  inputSchema?: JsonSchema | undefined;
  sideEffect?: boolean | null | undefined;
  requiresApproval?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface McpResolvedCredentials {
  headers?: Record<string, string> | undefined;
}

export interface McpBindingResolverContext<TApp = unknown> {
  auth: AuthContext | null;
  agent: AgentSession;
  binding: McpBinding;
  app: TApp;
}

export interface McpCredentialResolverContext<TApp = unknown> extends McpBindingResolverContext<TApp> {
  run?: Run | undefined;
}

export interface ResolvedMcpBinding<TApp = unknown> {
  transport: "streamable_http";
  endpoint: string;
  tools: McpCatalogTool[];
  resolveCredentials?:
    | ((ctx: McpCredentialResolverContext<TApp>) => McpResolvedCredentials | Promise<McpResolvedCredentials>)
    | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface McpBindingResolver<TApp = unknown> {
  resolve(ctx: McpBindingResolverContext<TApp>): ResolvedMcpBinding<TApp> | Promise<ResolvedMcpBinding<TApp>>;
}

export interface McpToolCallContext<TApp = unknown> {
  auth: AuthContext | null;
  agent: AgentSession;
  run: Run;
  binding: McpBinding;
  manifestTool: McpToolManifestTool;
  resolved: ResolvedMcpBinding<TApp>;
  input: unknown;
  app: TApp;
  signal?: AbortSignal | undefined;
}

export interface McpToolExecutor<TApp = unknown> {
  callTool(ctx: McpToolCallContext<TApp>): Promise<unknown>;
}

export interface CreateAgentSessionStoreInput {
  id?: AgentSessionId;
  agentSpecId: AgentSpecId;
  agentSpecVersion?: string | null | undefined;
  state?: Record<string, unknown> | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateRunStoreInput {
  id?: RunId;
  agentId: AgentSessionId;
  agentSpecId: AgentSpecId;
  agentSpecVersion?: string | null | undefined;
  status: RunStatus;
  input: RunInput;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AppendMessageInput {
  id?: MessageId;
  agentId: AgentSessionId;
  role: MessageRole;
  content: string;
  sourceRunId?: RunId | null | undefined;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AppendInboxEventInput {
  id?: InboxEventId;
  agentId: AgentSessionId;
  input: RunInput;
  auth?: AuthContext | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AppendRunEventInput {
  id?: RunEventId;
  runId: RunId;
  type: RunEventType;
  payload?: Record<string, unknown> | undefined;
  sourceRefs?: SourceRef[] | undefined;
}

export interface PutMemoryInput {
  id?: MemoryId;
  scope: MemoryScope;
  kind: MemoryItem["kind"];
  content: string;
  sourceRefs: SourceRef[];
  importance?: number | null;
  confidence?: number | null;
  embeddingRef?: string | null;
  expiresAt?: Date | null;
}

export interface SearchMemoryInput {
  query?: string;
  scopes?: MemoryScope[];
  topK?: number;
}

export interface StateStore {
  createAgentSession(input: CreateAgentSessionStoreInput): Promise<AgentSession>;
  getAgentSession(id: AgentSessionId): Promise<AgentSession | null>;
  updateAgentSession(id: AgentSessionId, patch: Partial<Omit<AgentSession, "id" | "createdAt">>): Promise<AgentSession>;
  createRun(input: CreateRunStoreInput): Promise<Run>;
  getRun(id: RunId): Promise<Run | null>;
  updateRun(id: RunId, patch: Partial<Omit<Run, "id" | "createdAt">>): Promise<Run>;
  listRunsByAgent(agentId: AgentSessionId): Promise<Run[]>;
}

export interface MessageStore {
  appendMessage(input: AppendMessageInput): Promise<Message>;
  listMessages(agentId: AgentSessionId, options?: { limit?: number }): Promise<Message[]>;
}

export interface InboxStore {
  appendInboxEvent(input: AppendInboxEventInput): Promise<InboxEvent>;
  getInboxEvent(id: InboxEventId): Promise<InboxEvent | null>;
  listInboxEvents(
    agentId: AgentSessionId,
    options?: { status?: InboxEventStatus; types?: RunInput["type"][]; limit?: number }
  ): Promise<InboxEvent[]>;
  claimPendingInboxEvents(
    agentId: AgentSessionId,
    options?: { types?: RunInput["type"][]; limit?: number }
  ): Promise<InboxEvent[]>;
  markInboxEventsProcessed(ids: InboxEventId[], runId: RunId): Promise<InboxEvent[]>;
  markInboxEventsFailed(ids: InboxEventId[], error: RunError): Promise<InboxEvent[]>;
}

export interface EventLog {
  appendRunEvent(input: AppendRunEventInput): Promise<RunEvent>;
  listRunEvents(runId: RunId, options?: { after?: number; limit?: number }): Promise<RunEvent[]>;
}

export interface MemoryStore {
  putMemory(input: PutMemoryInput): Promise<MemoryItem>;
  searchMemory(input: SearchMemoryInput): Promise<MemoryItem[]>;
}

export interface McpBindingStore {
  createMcpBinding(input: CreateMcpBindingStoreInput): Promise<McpBinding>;
  getMcpBinding(id: McpBindingId): Promise<McpBinding | null>;
  listMcpBindings(
    agentId: AgentSessionId,
    options?: { status?: McpBindingStatus | "all" | undefined }
  ): Promise<McpBinding[]>;
  removeMcpBinding(id: McpBindingId): Promise<McpBinding>;
}

export interface SkillBindingStore {
  createSkillBinding(input: CreateSkillBindingStoreInput): Promise<SkillBinding>;
  getSkillBinding(id: SkillBindingId): Promise<SkillBinding | null>;
  listSkillBindings(
    agentId: AgentSessionId,
    options?: { status?: SkillBindingStatus | "all" | undefined }
  ): Promise<SkillBinding[]>;
  removeSkillBinding(id: SkillBindingId): Promise<SkillBinding>;
}

export interface ApprovalStore {
  createApprovalRequest(input: CreateApprovalRequestStoreInput): Promise<ApprovalRequest>;
  getApprovalRequest(id: ApprovalRequestId): Promise<ApprovalRequest | null>;
  listApprovalRequests(
    runId: RunId,
    options?: { status?: ApprovalRequestStatus | "all" | undefined }
  ): Promise<ApprovalRequest[]>;
  decideApprovalRequest(input: DecideApprovalRequestStoreInput): Promise<ApprovalRequest>;
}

export interface DeferredToolOperationStore {
  createDeferredToolOperation(input: CreateDeferredToolOperationStoreInput): Promise<DeferredToolOperation>;
  getDeferredToolOperation(id: DeferredToolOperationId): Promise<DeferredToolOperation | null>;
  completeDeferredToolOperation(input: CompleteDeferredToolOperationStoreInput): Promise<DeferredToolOperation>;
}

export interface HephStores {
  state: StateStore;
  messages: MessageStore;
  inbox: InboxStore;
  events: EventLog;
  memory: MemoryStore;
  mcpBindings: McpBindingStore;
  skillBindings: SkillBindingStore;
  approvals: ApprovalStore;
  deferredToolOperations: DeferredToolOperationStore;
}
