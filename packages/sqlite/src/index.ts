import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { HephError } from "@heph/core";
import type {
  AgentSession,
  AgentSessionId,
  AppendInboxEventInput,
  AppendMessageInput,
  AppendRunEventInput,
  ApprovalRequest,
  ApprovalRequestId,
  ApprovalRequestStatus,
  ApprovalStore,
  CompleteDeferredToolOperationStoreInput,
  CreateApprovalRequestStoreInput,
  CreateAgentSessionStoreInput,
  CreateDeferredToolOperationStoreInput,
  CreateMcpBindingStoreInput,
  CreateRunStoreInput,
  CreateSkillBindingStoreInput,
  DecideApprovalRequestStoreInput,
  DeferredToolOperation,
  DeferredToolOperationId,
  DeferredToolOperationStatus,
  DeferredToolOperationStore,
  EnqueueOptions,
  EventLog,
  HephJob,
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
  QueueAdapter,
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
} from "@heph/core";
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
} from "@heph/core";

type SqliteDatabase = {
  pragma(sql: string): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
};

type SqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

type SqliteFactory = new (filename: string) => SqliteDatabase;

export type SQLiteMigrationMode = "apply" | "write_out" | "none";

export interface SQLiteMigrationOptions {
  mode?: SQLiteMigrationMode;
  outputDir?: string;
}

export interface SQLiteAdapterOptions {
  databasePath: string;
  migrations?: SQLiteMigrationOptions;
}

export interface SQLiteQueueOptions extends SQLiteAdapterOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
  onError?: (error: unknown, job: HephJob) => void;
}

export interface SQLiteAdapters {
  stores: SQLiteHephStore;
  queue: SQLiteQueue;
}

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as SqliteFactory;
const INITIAL_MIGRATION_VERSION = "0001_initial_heph_sqlite";
const DEFAULT_MIGRATION_OUTPUT_DIR = "migrations/heph";

export function createSQLiteAdapters(options: SQLiteQueueOptions): SQLiteAdapters {
  return {
    stores: createSQLiteHephStore(options),
    queue: createSQLiteQueue({
      ...options,
      migrations: {
        ...options.migrations,
        mode: "none"
      }
    })
  };
}

export function createSQLiteHephStore(options: SQLiteAdapterOptions): SQLiteHephStore {
  return new SQLiteHephStore(openDatabase(options));
}

export function createSQLiteQueue(options: SQLiteQueueOptions): SQLiteQueue {
  return new SQLiteQueue(openDatabase(options), options);
}

export function writeSQLiteMigration(outputDir = DEFAULT_MIGRATION_OUTPUT_DIR): string {
  mkdirSync(outputDir, { recursive: true });
  const file = join(outputDir, `${INITIAL_MIGRATION_VERSION}.sql`);
  writeFileSync(file, INITIAL_MIGRATION_SQL, "utf8");
  return file;
}

export class SQLiteHephStore
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

  constructor(readonly db: SqliteDatabase) {}

  close(): void {
    this.db.close();
  }

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

    this.db
      .prepare(
        `insert into heph_agent_sessions
          (id, agent_spec_id, agent_spec_version, state_json, active_run_id, auth_json, metadata_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.agentSpecId,
        agent.agentSpecVersion,
        stringifyJson(agent.state),
        agent.activeRunId,
        stringifyJson(agent.auth),
        stringifyJson(agent.metadata),
        toIso(agent.createdAt),
        toIso(agent.updatedAt)
      );

    return clonePlain(agent);
  }

  async getAgentSession(id: AgentSessionId): Promise<AgentSession | null> {
    const row = this.db.prepare("select * from heph_agent_sessions where id = ?").get(id);
    return row ? rowToAgentSession(row as AgentSessionRow) : null;
  }

  async updateAgentSession(
    id: AgentSessionId,
    patch: Partial<Omit<AgentSession, "id" | "createdAt">>
  ): Promise<AgentSession> {
    const existing = await this.getAgentSession(id);

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

    this.db
      .prepare(
        `update heph_agent_sessions
         set agent_spec_id = ?, agent_spec_version = ?, state_json = ?, active_run_id = ?, auth_json = ?, metadata_json = ?, updated_at = ?
         where id = ?`
      )
      .run(
        updated.agentSpecId,
        updated.agentSpecVersion,
        stringifyJson(updated.state),
        updated.activeRunId,
        stringifyJson(updated.auth),
        stringifyJson(updated.metadata),
        toIso(updated.updatedAt),
        id
      );

    return clonePlain(updated);
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

    this.db
      .prepare(
        `insert into heph_runs
          (id, agent_id, agent_spec_id, agent_spec_version, status, input_json, auth_json, context_manifest_json,
           skill_manifest_json, tool_manifest_json, error_json, metadata_json, queued_at, started_at, completed_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.agentId,
        run.agentSpecId,
        run.agentSpecVersion,
        run.status,
        stringifyJson(run.input),
        stringifyJson(run.auth),
        stringifyJson(run.contextManifest),
        stringifyJson(run.skillManifest),
        stringifyJson(run.toolManifest),
        stringifyJson(run.error),
        stringifyJson(run.metadata),
        toIso(run.queuedAt),
        toIsoOrNull(run.startedAt),
        toIsoOrNull(run.completedAt),
        toIso(run.createdAt),
        toIso(run.updatedAt)
      );

    return clonePlain(run);
  }

  async getRun(id: RunId): Promise<Run | null> {
    const row = this.db.prepare("select * from heph_runs where id = ?").get(id);
    return row ? rowToRun(row as RunRow) : null;
  }

  async updateRun(id: RunId, patch: Partial<Omit<Run, "id" | "createdAt">>): Promise<Run> {
    const existing = await this.getRun(id);

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

    this.db
      .prepare(
        `update heph_runs
         set agent_id = ?, agent_spec_id = ?, agent_spec_version = ?, status = ?, input_json = ?, auth_json = ?,
             context_manifest_json = ?, skill_manifest_json = ?, tool_manifest_json = ?, error_json = ?, metadata_json = ?, queued_at = ?, started_at = ?,
             completed_at = ?, updated_at = ?
         where id = ?`
      )
      .run(
        updated.agentId,
        updated.agentSpecId,
        updated.agentSpecVersion,
        updated.status,
        stringifyJson(updated.input),
        stringifyJson(updated.auth),
        stringifyJson(updated.contextManifest),
        stringifyJson(updated.skillManifest),
        stringifyJson(updated.toolManifest),
        stringifyJson(updated.error),
        stringifyJson(updated.metadata),
        toIso(updated.queuedAt),
        toIsoOrNull(updated.startedAt),
        toIsoOrNull(updated.completedAt),
        toIso(updated.updatedAt),
        id
      );

    return clonePlain(updated);
  }

  async listRunsByAgent(agentId: AgentSessionId): Promise<Run[]> {
    return this.db
      .prepare("select * from heph_runs where agent_id = ? order by created_at asc, id asc")
      .all(agentId)
      .map((row) => rowToRun(row as RunRow));
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

    this.db
      .prepare(
        `insert into heph_messages
          (id, agent_id, role, content, source_run_id, auth_json, metadata_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.agentId,
        message.role,
        message.content,
        message.sourceRunId,
        stringifyJson(message.auth),
        stringifyJson(message.metadata),
        toIso(message.createdAt)
      );

    return clonePlain(message);
  }

  async listMessages(agentId: AgentSessionId, options: { limit?: number } = {}): Promise<Message[]> {
    const params: unknown[] = [agentId];
    let sql = "select * from heph_messages where agent_id = ? order by created_at desc, id desc";

    if (options.limit !== undefined) {
      sql += " limit ?";
      params.push(options.limit);
    }

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToMessage(row as MessageRow))
      .reverse();
  }

  async appendInboxEvent(input: AppendInboxEventInput): Promise<InboxEvent> {
    const now = new Date();
    const event: InboxEvent = {
      id: input.id ?? createInboxEventId(),
      agentId: input.agentId,
      type: input.input.type,
      input: input.input,
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

    this.db
      .prepare(
        `insert into heph_inbox_events
          (id, agent_id, type, input_json, status, run_id, auth_json, metadata_json, created_at, updated_at,
           claimed_at, claim_lease_until, processed_at, failed_at, error_json, attempt)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.agentId,
        event.type,
        stringifyJson(event.input),
        event.status,
        event.runId,
        stringifyJson(event.auth),
        stringifyJson(event.metadata),
        toIso(event.createdAt),
        toIso(event.updatedAt),
        toIsoOrNull(event.claimedAt),
        null,
        toIsoOrNull(event.processedAt),
        toIsoOrNull(event.failedAt),
        stringifyJson(event.error),
        0
      );

    return clonePlain(event);
  }

  async getInboxEvent(id: InboxEventId): Promise<InboxEvent | null> {
    const row = this.db.prepare("select * from heph_inbox_events where id = ?").get(id);
    return row ? rowToInboxEvent(row as InboxEventRow) : null;
  }

  async listInboxEvents(
    agentId: AgentSessionId,
    options: { status?: InboxEventStatus; types?: Array<InboxEvent["type"]>; limit?: number } = {}
  ): Promise<InboxEvent[]> {
    const where = ["agent_id = ?"];
    const params: unknown[] = [agentId];

    if (options.status !== undefined) {
      where.push("status = ?");
      params.push(options.status);
    }

    if (options.types !== undefined && options.types.length > 0) {
      where.push(`type in (${options.types.map(() => "?").join(", ")})`);
      params.push(...options.types);
    }

    let sql = `select * from heph_inbox_events where ${where.join(" and ")} order by created_at asc, id asc`;

    if (options.limit !== undefined) {
      sql += " limit ?";
      params.push(options.limit);
    }

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToInboxEvent(row as InboxEventRow));
  }

  async claimPendingInboxEvents(
    agentId: AgentSessionId,
    options: { types?: Array<InboxEvent["type"]>; limit?: number } = {}
  ): Promise<InboxEvent[]> {
    const transaction = this.db.transaction(() => {
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + 30_000);
      const where = ["agent_id = ?", "(status = 'pending' or (status = 'processing' and claim_lease_until <= ?))"];
      const params: unknown[] = [agentId, toIso(now)];

      if (options.types !== undefined && options.types.length > 0) {
        where.push(`type in (${options.types.map(() => "?").join(", ")})`);
        params.push(...options.types);
      }

      let sql = `select * from heph_inbox_events where ${where.join(" and ")} order by created_at asc, id asc`;

      if (options.limit !== undefined) {
        sql += " limit ?";
        params.push(options.limit);
      }

      const rows = this.db.prepare(sql).all(...params) as InboxEventRow[];
      const update = this.db.prepare(
        `update heph_inbox_events
         set status = 'processing', claimed_at = ?, claim_lease_until = ?, updated_at = ?, attempt = attempt + 1
         where id = ?`
      );

      for (const row of rows) {
        update.run(toIso(now), toIso(leaseUntil), toIso(now), row.id);
      }

      return rows.map((row) => ({
        ...row,
        status: "processing",
        claimed_at: toIso(now),
        claim_lease_until: toIso(leaseUntil),
        updated_at: toIso(now),
        attempt: row.attempt + 1
      }));
    });

    return (transaction() as InboxEventRow[]).map(rowToInboxEvent);
  }

  async markInboxEventsProcessed(ids: InboxEventId[], runId: RunId): Promise<InboxEvent[]> {
    const transaction = this.db.transaction(() => {
      const now = new Date();
      const update = this.db.prepare(
        `update heph_inbox_events
         set status = 'processed', run_id = ?, processed_at = ?, updated_at = ?, error_json = null
         where id = ?`
      );

      for (const id of ids) {
        update.run(runId, toIso(now), toIso(now), id);
      }

      return ids.map((id) => {
        const row = this.db.prepare("select * from heph_inbox_events where id = ?").get(id);

        if (!row) {
          throw notFound("InboxEvent not found", { inboxEventId: id });
        }

        return row as InboxEventRow;
      });
    });

    return (transaction() as InboxEventRow[]).map(rowToInboxEvent);
  }

  async markInboxEventsFailed(ids: InboxEventId[], error: RunError): Promise<InboxEvent[]> {
    const transaction = this.db.transaction(() => {
      const now = new Date();
      const update = this.db.prepare(
        `update heph_inbox_events
         set status = 'failed', failed_at = ?, updated_at = ?, error_json = ?
         where id = ?`
      );

      for (const id of ids) {
        update.run(toIso(now), toIso(now), stringifyJson(error), id);
      }

      return ids.map((id) => {
        const row = this.db.prepare("select * from heph_inbox_events where id = ?").get(id);

        if (!row) {
          throw notFound("InboxEvent not found", { inboxEventId: id });
        }

        return row as InboxEventRow;
      });
    });

    return (transaction() as InboxEventRow[]).map(rowToInboxEvent);
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<RunEvent> {
    const transaction = this.db.transaction(() => {
      const seqRow = this.db
        .prepare("select coalesce(max(seq), 0) + 1 as seq from heph_run_events where run_id = ?")
        .get(input.runId) as { seq: number };
      const event: RunEvent = {
        id: input.id ?? createRunEventId(),
        runId: input.runId,
        seq: seqRow.seq,
        type: input.type,
        payload: input.payload ?? {},
        sourceRefs: input.sourceRefs ?? [],
        createdAt: new Date()
      };

      this.db
        .prepare(
          `insert into heph_run_events
            (id, run_id, seq, type, payload_json, source_refs_json, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.runId,
          event.seq,
          event.type,
          stringifyJson(event.payload),
          stringifyJson(event.sourceRefs),
          toIso(event.createdAt)
        );

      return event;
    });

    return clonePlain(transaction() as RunEvent);
  }

  async listRunEvents(runId: RunId, options: { after?: number; limit?: number } = {}): Promise<RunEvent[]> {
    const params: unknown[] = [runId, options.after ?? 0];
    let sql = "select * from heph_run_events where run_id = ? and seq > ? order by seq asc";

    if (options.limit !== undefined) {
      sql += " limit ?";
      params.push(options.limit);
    }

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToRunEvent(row as RunEventRow));
  }

  async putMemory(input: PutMemoryInput): Promise<MemoryItem> {
    const now = new Date();
    const existing = input.id ? ((this.db.prepare("select * from heph_memory_items where id = ?").get(input.id) as MemoryRow | undefined) ?? null) : null;
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
      createdAt: existing ? parseDate(existing.created_at) : now,
      updatedAt: now
    };

    this.db
      .prepare(
        `insert into heph_memory_items
          (id, scope_type, scope_id, kind, content, source_refs_json, importance, confidence, embedding_ref, expires_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           scope_type = excluded.scope_type,
           scope_id = excluded.scope_id,
           kind = excluded.kind,
           content = excluded.content,
           source_refs_json = excluded.source_refs_json,
           importance = excluded.importance,
           confidence = excluded.confidence,
           embedding_ref = excluded.embedding_ref,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`
      )
      .run(
        item.id,
        item.scope.type,
        item.scope.id,
        item.kind,
        item.content,
        stringifyJson(item.sourceRefs),
        item.importance,
        item.confidence,
        item.embeddingRef,
        toIsoOrNull(item.expiresAt),
        toIso(item.createdAt),
        toIso(item.updatedAt)
      );

    return clonePlain(item);
  }

  async searchMemory(input: SearchMemoryInput): Promise<MemoryItem[]> {
    const rows = this.db.prepare("select * from heph_memory_items").all() as MemoryRow[];
    const now = Date.now();
    const query = input.query?.trim().toLowerCase();
    const topK = input.topK ?? 8;
    const scopes = input.scopes ?? [];

    return rows
      .map(rowToMemoryItem)
      .filter((item) => item.expiresAt === null || item.expiresAt.getTime() > now)
      .filter((item) => scopes.length === 0 || scopes.some((scope) => sameScope(scope, item.scope)))
      .map((item) => ({
        item,
        score: scoreMemory(item, query)
      }))
      .filter(({ score }) => score > 0 || !query)
      .sort((a, b) => b.score - a.score || b.item.updatedAt.getTime() - a.item.updatedAt.getTime())
      .slice(0, topK)
      .map(({ item }) => clonePlain(item));
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

    this.db
      .prepare(
        `insert into heph_mcp_bindings
          (id, agent_id, capability_id, account_ref, allow_tools_json, status, metadata_json, created_at, updated_at, removed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        binding.id,
        binding.agentId,
        binding.capabilityId,
        binding.accountRef,
        stringifyJson(binding.allowTools),
        binding.status,
        stringifyJson(binding.metadata),
        toIso(binding.createdAt),
        toIso(binding.updatedAt),
        toIsoOrNull(binding.removedAt)
      );

    return clonePlain(binding);
  }

  async getMcpBinding(id: McpBindingId): Promise<McpBinding | null> {
    const row = this.db.prepare("select * from heph_mcp_bindings where id = ?").get(id);
    return row ? rowToMcpBinding(row as McpBindingRow) : null;
  }

  async listMcpBindings(
    agentId: AgentSessionId,
    options: { status?: McpBindingStatus | "all" | undefined } = {}
  ): Promise<McpBinding[]> {
    const params: unknown[] = [agentId];
    let sql = "select * from heph_mcp_bindings where agent_id = ?";
    const status = options.status ?? "active";

    if (status !== "all") {
      sql += " and status = ?";
      params.push(status);
    }

    sql += " order by created_at asc, id asc";

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToMcpBinding(row as McpBindingRow));
  }

  async removeMcpBinding(id: McpBindingId): Promise<McpBinding> {
    const existing = await this.getMcpBinding(id);

    if (!existing) {
      throw notFound("McpBinding not found", { bindingId: id });
    }

    const now = new Date();
    const removedAt = existing.removedAt ?? now;

    this.db
      .prepare("update heph_mcp_bindings set status = 'removed', updated_at = ?, removed_at = ? where id = ?")
      .run(toIso(now), toIso(removedAt), id);

    return {
      ...existing,
      status: "removed",
      updatedAt: now,
      removedAt
    };
  }

  async createSkillBinding(input: CreateSkillBindingStoreInput): Promise<SkillBinding> {
    const now = new Date();
    const binding: SkillBinding = {
      id: input.id ?? createSkillBindingId(),
      agentId: input.agentId,
      skillId: input.skillId,
      name: input.name,
      version: input.version ?? null,
      source: clonePlain(input.source),
      allowReferences: input.allowReferences === undefined ? [] : clonePlain(input.allowReferences),
      status: "active",
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      removedAt: null
    };

    this.db
      .prepare(
        `insert into heph_skill_bindings
          (id, agent_id, skill_id, name, version, source_json, allow_references_json, status,
           metadata_json, created_at, updated_at, removed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        binding.id,
        binding.agentId,
        binding.skillId,
        binding.name,
        binding.version,
        stringifyJson(binding.source),
        stringifyJson(binding.allowReferences),
        binding.status,
        stringifyJson(binding.metadata),
        toIso(binding.createdAt),
        toIso(binding.updatedAt),
        toIsoOrNull(binding.removedAt)
      );

    return clonePlain(binding);
  }

  async getSkillBinding(id: SkillBindingId): Promise<SkillBinding | null> {
    const row = this.db.prepare("select * from heph_skill_bindings where id = ?").get(id);
    return row ? rowToSkillBinding(row as SkillBindingRow) : null;
  }

  async listSkillBindings(
    agentId: AgentSessionId,
    options: { status?: SkillBindingStatus | "all" | undefined } = {}
  ): Promise<SkillBinding[]> {
    const params: unknown[] = [agentId];
    let sql = "select * from heph_skill_bindings where agent_id = ?";
    const status = options.status ?? "active";

    if (status !== "all") {
      sql += " and status = ?";
      params.push(status);
    }

    sql += " order by created_at asc, id asc";

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToSkillBinding(row as SkillBindingRow));
  }

  async removeSkillBinding(id: SkillBindingId): Promise<SkillBinding> {
    const existing = await this.getSkillBinding(id);

    if (!existing) {
      throw notFound("SkillBinding not found", { bindingId: id });
    }

    const now = new Date();
    const removedAt = existing.removedAt ?? now;

    this.db
      .prepare("update heph_skill_bindings set status = 'removed', updated_at = ?, removed_at = ? where id = ?")
      .run(toIso(now), toIso(removedAt), id);

    return {
      ...existing,
      status: "removed",
      updatedAt: now,
      removedAt
    };
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

    this.db
      .prepare(
        `insert into heph_approval_requests
          (id, agent_id, run_id, tool_id, input_json, status, requested_by_json, decided_by_json,
           metadata_json, created_at, updated_at, decided_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        request.id,
        request.agentId,
        request.runId,
        request.toolId,
        stringifyJson(request.input),
        request.status,
        stringifyJson(request.requestedBy),
        stringifyJson(request.decidedBy),
        stringifyJson(request.metadata),
        toIso(request.createdAt),
        toIso(request.updatedAt),
        toIsoOrNull(request.decidedAt)
      );

    return clonePlain(request);
  }

  async getApprovalRequest(id: ApprovalRequestId): Promise<ApprovalRequest | null> {
    const row = this.db.prepare("select * from heph_approval_requests where id = ?").get(id);
    return row ? rowToApprovalRequest(row as ApprovalRequestRow) : null;
  }

  async listApprovalRequests(
    runId: RunId,
    options: { status?: ApprovalRequestStatus | "all" | undefined } = {}
  ): Promise<ApprovalRequest[]> {
    const params: unknown[] = [runId];
    let sql = "select * from heph_approval_requests where run_id = ?";
    const status = options.status ?? "all";

    if (status !== "all") {
      sql += " and status = ?";
      params.push(status);
    }

    sql += " order by created_at asc, id asc";

    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => rowToApprovalRequest(row as ApprovalRequestRow));
  }

  async decideApprovalRequest(input: DecideApprovalRequestStoreInput): Promise<ApprovalRequest> {
    const existing = await this.getApprovalRequest(input.id);

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

    this.db
      .prepare(
        `update heph_approval_requests
         set status = ?, decided_by_json = ?, metadata_json = ?, updated_at = ?, decided_at = ?
         where id = ?`
      )
      .run(
        updated.status,
        stringifyJson(updated.decidedBy),
        stringifyJson(updated.metadata),
        toIso(updated.updatedAt),
        toIsoOrNull(updated.decidedAt),
        input.id
      );

    return clonePlain(updated);
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

    this.db
      .prepare(
        `insert into heph_deferred_tool_operations
          (id, agent_id, run_id, tool_id, tool_call_id, status, resume_policy, auth_json,
           result_json, error_json, metadata_json, created_at, updated_at, completed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        operation.id,
        operation.agentId,
        operation.runId,
        operation.toolId,
        operation.toolCallId,
        operation.status,
        operation.resumePolicy,
        stringifyJson(operation.auth),
        stringifyJson(operation.result),
        stringifyJson(operation.error),
        stringifyJson(operation.metadata),
        toIso(operation.createdAt),
        toIso(operation.updatedAt),
        toIsoOrNull(operation.completedAt)
      );

    return clonePlain(operation);
  }

  async getDeferredToolOperation(id: DeferredToolOperationId): Promise<DeferredToolOperation | null> {
    const row = this.db.prepare("select * from heph_deferred_tool_operations where id = ?").get(id);
    return row ? rowToDeferredToolOperation(row as DeferredToolOperationRow) : null;
  }

  async completeDeferredToolOperation(input: CompleteDeferredToolOperationStoreInput): Promise<DeferredToolOperation> {
    const existing = await this.getDeferredToolOperation(input.id);

    if (!existing) {
      throw notFound("DeferredToolOperation not found", { operationId: input.id });
    }

    if (existing.status !== "pending") {
      return clonePlain(existing);
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

    this.db
      .prepare(
        `update heph_deferred_tool_operations
         set status = ?, result_json = ?, error_json = ?, metadata_json = ?, updated_at = ?, completed_at = ?
         where id = ?`
      )
      .run(
        updated.status,
        stringifyJson(updated.result),
        stringifyJson(updated.error),
        stringifyJson(updated.metadata),
        toIso(updated.updatedAt),
        toIsoOrNull(updated.completedAt),
        input.id
      );

    return clonePlain(updated);
  }
}

export class SQLiteQueue implements QueueAdapter {
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly onError: (error: unknown, job: HephJob) => void;
  private readonly activeAgents = new Set<string>();
  private readonly idleResolvers = new Set<() => void>();
  private activeCount = 0;
  private handler: ((job: HephJob) => Promise<void>) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly db: SqliteDatabase,
    options: SQLiteQueueOptions = { databasePath: ":memory:" }
  ) {
    this.concurrency = options.concurrency ?? 4;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.onError =
      options.onError ??
      ((error, job) => {
        console.error("Unhandled Heph SQLite queue error", { error, job });
      });
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.db.close();
  }

  async enqueue(job: HephJob, options: EnqueueOptions = {}): Promise<void> {
    const now = new Date();
    const availableAt = new Date(now.getTime() + (options.delayMs ?? 0));
    const idempotencyKey = options.idempotencyKey ?? null;
    const id = idempotencyKey ?? `queue_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`}`;

    this.db
      .prepare(
        `insert into heph_queue_jobs
          (id, idempotency_key, type, agent_id, run_id, job_json, status, attempt, max_attempts,
           available_at, leased_until, created_at, updated_at, last_error_json)
         values (?, ?, ?, ?, ?, ?, 'available', 0, ?, ?, null, ?, ?, null)
         on conflict(id) do nothing`
      )
      .run(
        id,
        idempotencyKey,
        job.type,
        job.agentId,
        "runId" in job ? job.runId : null,
        stringifyJson(job),
        this.maxAttempts,
        toIso(availableAt),
        toIso(now),
        toIso(now)
      );

    this.schedule(0);
  }

  async startConsumer(handler: (job: HephJob) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.schedule(0);
  }

  async onIdle(): Promise<void> {
    if (this.isIdle()) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  private schedule(delayMs = this.pollIntervalMs): void {
    if (!this.handler || this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, delayMs);
    this.timer.unref?.();
  }

  private pump(): void {
    if (!this.handler) {
      this.resolveIdleIfNeeded();
      return;
    }

    while (this.activeCount < this.concurrency) {
      const row = this.claimNextJob();

      if (!row) {
        break;
      }

      const job = parseJson<HephJob>(row.job_json);
      this.activeCount += 1;
      this.activeAgents.add(row.agent_id);

      void this.handler(job)
        .then(() => {
          this.markDone(row.id);
        })
        .catch((error) => {
          this.onError(error, job);
          this.markRetryOrFailed(row, error);
        })
        .finally(() => {
          this.activeCount -= 1;
          this.activeAgents.delete(row.agent_id);
          this.resolveIdleIfNeeded();
          this.schedule(0);
        });
    }

    this.resolveIdleIfNeeded();
    this.schedule();
  }

  private claimNextJob(): QueueJobRow | null {
    const transaction = this.db.transaction(() => {
      const now = new Date();
      const rows = this.db
        .prepare(
          `select * from heph_queue_jobs
           where ((status = 'available' and available_at <= ?) or (status = 'leased' and leased_until <= ?))
             and not exists (
               select 1 from heph_queue_jobs active
               where active.agent_id = heph_queue_jobs.agent_id
                 and active.status = 'leased'
                 and active.leased_until > ?
             )
           order by available_at asc, id asc
           limit 50`
        )
        .all(toIso(now), toIso(now), toIso(now)) as QueueJobRow[];
      const row = rows.find((candidate) => !this.activeAgents.has(candidate.agent_id));

      if (!row) {
        return null;
      }

      const leasedUntil = new Date(now.getTime() + this.leaseMs);
      this.db
        .prepare(
          `update heph_queue_jobs
           set status = 'leased', attempt = attempt + 1, leased_until = ?, updated_at = ?
           where id = ?`
        )
        .run(toIso(leasedUntil), toIso(now), row.id);

      return {
        ...row,
        status: "leased",
        attempt: row.attempt + 1,
        leased_until: toIso(leasedUntil),
        updated_at: toIso(now)
      };
    });

    return transaction() as QueueJobRow | null;
  }

  private markDone(id: string): void {
    this.db
      .prepare("update heph_queue_jobs set status = 'done', updated_at = ? where id = ?")
      .run(toIso(new Date()), id);
  }

  private markRetryOrFailed(row: QueueJobRow, error: unknown): void {
    const now = new Date();
    const status = row.attempt >= row.max_attempts ? "failed" : "available";
    const availableAt = row.attempt >= row.max_attempts ? row.available_at : toIso(new Date(now.getTime() + this.retryDelayMs));

    this.db
      .prepare(
        `update heph_queue_jobs
         set status = ?, available_at = ?, leased_until = null, updated_at = ?, last_error_json = ?
         where id = ?`
      )
      .run(status, availableAt, toIso(now), stringifyJson(toErrorDetails(error)), row.id);
  }

  private isIdle(): boolean {
    if (this.activeCount > 0) {
      return false;
    }

    const row = this.db
      .prepare("select count(*) as count from heph_queue_jobs where status in ('available', 'leased')")
      .get() as { count: number };
    return row.count === 0;
  }

  private resolveIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }

    for (const resolve of this.idleResolvers) {
      resolve();
    }

    this.idleResolvers.clear();
  }
}

function openDatabase(options: SQLiteAdapterOptions): SqliteDatabase {
  if (options.databasePath !== ":memory:") {
    mkdirSync(dirname(options.databasePath), { recursive: true });
  }

  const db = new BetterSqlite3(options.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  handleMigrations(db, options.migrations);
  return db;
}

function handleMigrations(db: SqliteDatabase, options: SQLiteMigrationOptions | undefined): void {
  const mode = options?.mode ?? "apply";

  if (mode === "none") {
    return;
  }

  if (mode === "write_out") {
    writeSQLiteMigration(options?.outputDir ?? DEFAULT_MIGRATION_OUTPUT_DIR);
    return;
  }

  db.exec(INITIAL_MIGRATION_SQL);
  ensureSQLiteSchemaCompatibility(db);
  db.prepare(
    `insert into heph_schema_migrations (version, name, applied_at)
     values (?, ?, ?)
     on conflict(version) do nothing`
  ).run(INITIAL_MIGRATION_VERSION, "Initial Heph SQLite schema", toIso(new Date()));
}

function ensureSQLiteSchemaCompatibility(db: SqliteDatabase): void {
  const runColumns = db.prepare("pragma table_info(heph_runs)").all() as Array<{ name: string }>;

  if (!runColumns.some((column) => column.name === "skill_manifest_json")) {
    db.exec("alter table heph_runs add column skill_manifest_json text");
  }

  if (!runColumns.some((column) => column.name === "tool_manifest_json")) {
    db.exec("alter table heph_runs add column tool_manifest_json text");
  }

  db.exec(DEFERRED_TOOL_OPERATIONS_SQL);
}

type AgentSessionRow = {
  id: string;
  agent_spec_id: string;
  agent_spec_version: string | null;
  state_json: string;
  active_run_id: string | null;
  auth_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: string;
  agent_id: string;
  agent_spec_id: string;
  agent_spec_version: string | null;
  status: Run["status"];
  input_json: string;
  auth_json: string | null;
  context_manifest_json: string | null;
  skill_manifest_json: string | null;
  tool_manifest_json: string | null;
  error_json: string | null;
  metadata_json: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  agent_id: string;
  role: Message["role"];
  content: string;
  source_run_id: string | null;
  auth_json: string | null;
  metadata_json: string;
  created_at: string;
};

type InboxEventRow = {
  id: string;
  agent_id: string;
  type: InboxEvent["type"];
  input_json: string;
  status: InboxEventStatus;
  run_id: string | null;
  auth_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  claim_lease_until: string | null;
  processed_at: string | null;
  failed_at: string | null;
  error_json: string | null;
  attempt: number;
};

type RunEventRow = {
  id: string;
  run_id: string;
  seq: number;
  type: RunEvent["type"];
  payload_json: string;
  source_refs_json: string;
  created_at: string;
};

type MemoryRow = {
  id: string;
  scope_type: MemoryScope["type"];
  scope_id: string;
  kind: MemoryItem["kind"];
  content: string;
  source_refs_json: string;
  importance: number | null;
  confidence: number | null;
  embedding_ref: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type McpBindingRow = {
  id: string;
  agent_id: string;
  capability_id: string;
  account_ref: string | null;
  allow_tools_json: string;
  status: McpBindingStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
};

type SkillBindingRow = {
  id: string;
  agent_id: string;
  skill_id: string;
  name: string;
  version: string | null;
  source_json: string;
  allow_references_json: string;
  status: SkillBindingStatus;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
};

type ApprovalRequestRow = {
  id: string;
  agent_id: string;
  run_id: string;
  tool_id: string;
  input_json: string | null;
  status: ApprovalRequestStatus;
  requested_by_json: string | null;
  decided_by_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
};

type DeferredToolOperationRow = {
  id: string;
  agent_id: string;
  run_id: string;
  tool_id: string;
  tool_call_id: string | null;
  status: DeferredToolOperationStatus;
  resume_policy: DeferredToolOperation["resumePolicy"];
  auth_json: string | null;
  result_json: string | null;
  error_json: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type QueueJobRow = {
  id: string;
  idempotency_key: string | null;
  type: HephJob["type"];
  agent_id: string;
  run_id: string | null;
  job_json: string;
  status: "available" | "leased" | "done" | "failed";
  attempt: number;
  max_attempts: number;
  available_at: string;
  leased_until: string | null;
  created_at: string;
  updated_at: string;
  last_error_json: string | null;
};

function rowToAgentSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    agentSpecId: row.agent_spec_id,
    agentSpecVersion: row.agent_spec_version,
    state: parseJson(row.state_json),
    activeRunId: row.active_run_id,
    auth: parseNullableJson(row.auth_json),
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at)
  };
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentSpecId: row.agent_spec_id,
    agentSpecVersion: row.agent_spec_version,
    status: row.status,
    input: parseJson(row.input_json),
    auth: parseNullableJson(row.auth_json),
    contextManifest: parseNullableJson(row.context_manifest_json),
    skillManifest: parseSkillManifest(row.skill_manifest_json),
    toolManifest: parseToolManifest(row.tool_manifest_json),
    error: parseNullableJson(row.error_json),
    metadata: parseJson(row.metadata_json),
    queuedAt: parseDate(row.queued_at),
    startedAt: parseNullableDate(row.started_at),
    completedAt: parseNullableDate(row.completed_at),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at)
  };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    agentId: row.agent_id,
    role: row.role,
    content: row.content,
    sourceRunId: row.source_run_id,
    auth: parseNullableJson(row.auth_json),
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at)
  };
}

function rowToInboxEvent(row: InboxEventRow): InboxEvent {
  return {
    id: row.id,
    agentId: row.agent_id,
    type: row.type,
    input: parseJson(row.input_json),
    status: row.status,
    runId: row.run_id,
    auth: parseNullableJson(row.auth_json),
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    claimedAt: parseNullableDate(row.claimed_at),
    processedAt: parseNullableDate(row.processed_at),
    failedAt: parseNullableDate(row.failed_at),
    error: parseNullableJson(row.error_json)
  };
}

function rowToRunEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    type: row.type,
    payload: parseJson(row.payload_json),
    sourceRefs: parseJson(row.source_refs_json),
    createdAt: parseDate(row.created_at)
  };
}

function rowToMemoryItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    scope: {
      type: row.scope_type,
      id: row.scope_id
    },
    kind: row.kind,
    content: row.content,
    sourceRefs: parseJson(row.source_refs_json),
    importance: row.importance,
    confidence: row.confidence,
    embeddingRef: row.embedding_ref,
    expiresAt: parseNullableDate(row.expires_at),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at)
  };
}

function rowToMcpBinding(row: McpBindingRow): McpBinding {
  return {
    id: row.id,
    agentId: row.agent_id,
    capabilityId: row.capability_id,
    accountRef: row.account_ref,
    allowTools: parseJson(row.allow_tools_json),
    status: row.status,
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    removedAt: parseNullableDate(row.removed_at)
  };
}

function rowToSkillBinding(row: SkillBindingRow): SkillBinding {
  return {
    id: row.id,
    agentId: row.agent_id,
    skillId: row.skill_id,
    name: row.name,
    version: row.version,
    source: parseJson(row.source_json),
    allowReferences: parseJson(row.allow_references_json),
    status: row.status,
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    removedAt: parseNullableDate(row.removed_at)
  };
}

function rowToApprovalRequest(row: ApprovalRequestRow): ApprovalRequest {
  return {
    id: row.id,
    agentId: row.agent_id,
    runId: row.run_id,
    toolId: row.tool_id,
    input: parseNullableJson(row.input_json),
    status: row.status,
    requestedBy: parseNullableJson(row.requested_by_json),
    decidedBy: parseNullableJson(row.decided_by_json),
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    decidedAt: parseNullableDate(row.decided_at)
  };
}

function rowToDeferredToolOperation(row: DeferredToolOperationRow): DeferredToolOperation {
  return {
    id: row.id,
    agentId: row.agent_id,
    runId: row.run_id,
    toolId: row.tool_id,
    toolCallId: row.tool_call_id,
    status: row.status,
    resumePolicy: row.resume_policy,
    auth: parseNullableJson(row.auth_json),
    result: parseNullableJson(row.result_json),
    error: parseNullableJson(row.error_json),
    metadata: parseJson(row.metadata_json),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
    completedAt: parseNullableDate(row.completed_at)
  };
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

function toErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
}

function stringifyJson(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseNullableJson<T>(value: string | null): T | null {
  return value === null ? null : parseJson<T>(value);
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseDate(value: string): Date {
  return new Date(value);
}

function parseNullableDate(value: string | null): Date | null {
  return value ? parseDate(value) : null;
}

function parseToolManifest(value: string | null): Run["toolManifest"] {
  const manifest = parseNullableJson<Run["toolManifest"]>(value);

  if (!manifest) {
    return null;
  }

  return {
    ...manifest,
    createdAt: new Date(manifest.createdAt)
  };
}

function parseSkillManifest(value: string | null): Run["skillManifest"] {
  const manifest = parseNullableJson<Run["skillManifest"]>(value);

  if (!manifest) {
    return null;
  }

  return {
    ...manifest,
    createdAt: new Date(manifest.createdAt)
  };
}

function clonePlain<T>(value: T): T {
  return structuredClone(value);
}

const DEFERRED_TOOL_OPERATIONS_SQL = `
create table if not exists heph_deferred_tool_operations (
  id text primary key,
  agent_id text not null,
  run_id text not null,
  tool_id text not null,
  tool_call_id text,
  status text not null,
  resume_policy text not null,
  auth_json text,
  result_json text,
  error_json text,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create index if not exists idx_heph_deferred_tool_operations_run on heph_deferred_tool_operations(run_id, created_at);
create index if not exists idx_heph_deferred_tool_operations_agent_status on heph_deferred_tool_operations(agent_id, status, created_at);
`;

const INITIAL_MIGRATION_SQL = `
create table if not exists heph_schema_migrations (
  version text primary key,
  name text not null,
  applied_at text not null
);

create table if not exists heph_agent_sessions (
  id text primary key,
  agent_spec_id text not null,
  agent_spec_version text,
  state_json text not null,
  active_run_id text,
  auth_json text,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_heph_agent_sessions_spec on heph_agent_sessions(agent_spec_id);

create table if not exists heph_runs (
  id text primary key,
  agent_id text not null,
  agent_spec_id text not null,
  agent_spec_version text,
  status text not null,
  input_json text not null,
  auth_json text,
  context_manifest_json text,
  skill_manifest_json text,
  tool_manifest_json text,
  error_json text,
  metadata_json text not null,
  queued_at text not null,
  started_at text,
  completed_at text,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_heph_runs_agent_created on heph_runs(agent_id, created_at);
create index if not exists idx_heph_runs_status on heph_runs(status);

create table if not exists heph_messages (
  id text primary key,
  agent_id text not null,
  role text not null,
  content text not null,
  source_run_id text,
  auth_json text,
  metadata_json text not null,
  created_at text not null
);

create index if not exists idx_heph_messages_agent_created on heph_messages(agent_id, created_at);

create table if not exists heph_inbox_events (
  id text primary key,
  agent_id text not null,
  type text not null,
  input_json text not null,
  status text not null,
  run_id text,
  auth_json text,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null,
  claimed_at text,
  claim_lease_until text,
  processed_at text,
  failed_at text,
  error_json text,
  attempt integer not null default 0
);

create index if not exists idx_heph_inbox_agent_status_created on heph_inbox_events(agent_id, status, created_at);
create index if not exists idx_heph_inbox_lease on heph_inbox_events(status, claim_lease_until);

create table if not exists heph_run_events (
  id text primary key,
  run_id text not null,
  seq integer not null,
  type text not null,
  payload_json text not null,
  source_refs_json text not null,
  created_at text not null,
  unique(run_id, seq)
);

create index if not exists idx_heph_run_events_run_seq on heph_run_events(run_id, seq);

create table if not exists heph_memory_items (
  id text primary key,
  scope_type text not null,
  scope_id text not null,
  kind text not null,
  content text not null,
  source_refs_json text not null,
  importance real,
  confidence real,
  embedding_ref text,
  expires_at text,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_heph_memory_scope on heph_memory_items(scope_type, scope_id);
create index if not exists idx_heph_memory_expires on heph_memory_items(expires_at);

create table if not exists heph_mcp_bindings (
  id text primary key,
  agent_id text not null,
  capability_id text not null,
  account_ref text,
  allow_tools_json text not null,
  status text not null,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null,
  removed_at text
);

create index if not exists idx_heph_mcp_bindings_agent_status on heph_mcp_bindings(agent_id, status, created_at);
create index if not exists idx_heph_mcp_bindings_capability on heph_mcp_bindings(capability_id);

create table if not exists heph_skill_bindings (
  id text primary key,
  agent_id text not null,
  skill_id text not null,
  name text not null,
  version text,
  source_json text not null,
  allow_references_json text not null,
  status text not null,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null,
  removed_at text
);

create index if not exists idx_heph_skill_bindings_agent_status on heph_skill_bindings(agent_id, status, created_at);
create index if not exists idx_heph_skill_bindings_skill on heph_skill_bindings(skill_id);

create table if not exists heph_approval_requests (
  id text primary key,
  agent_id text not null,
  run_id text not null,
  tool_id text not null,
  input_json text,
  status text not null,
  requested_by_json text,
  decided_by_json text,
  metadata_json text not null,
  created_at text not null,
  updated_at text not null,
  decided_at text
);

create index if not exists idx_heph_approval_requests_run_status on heph_approval_requests(run_id, status, created_at);
create index if not exists idx_heph_approval_requests_agent on heph_approval_requests(agent_id, created_at);

${DEFERRED_TOOL_OPERATIONS_SQL}

create table if not exists heph_queue_jobs (
  id text primary key,
  idempotency_key text unique,
  type text not null,
  agent_id text not null,
  run_id text,
  job_json text not null,
  status text not null,
  attempt integer not null default 0,
  max_attempts integer not null,
  available_at text not null,
  leased_until text,
  created_at text not null,
  updated_at text not null,
  last_error_json text
);

create index if not exists idx_heph_queue_available on heph_queue_jobs(status, available_at);
create index if not exists idx_heph_queue_lease on heph_queue_jobs(status, leased_until);
create index if not exists idx_heph_queue_agent on heph_queue_jobs(agent_id, status);
`;
