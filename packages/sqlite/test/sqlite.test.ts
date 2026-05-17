import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHeph, defineAgent } from "@heph/core";
import { createSQLiteAdapters, createSQLiteHephStore, createSQLiteQueue, writeSQLiteMigration } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("SQLite adapters", () => {
  it("persists Heph store records across adapter instances", async () => {
    const dbPath = join(await tempDir(), "heph.db");
    const first = createSQLiteHephStore({ databasePath: dbPath });
    const agent = await first.state.createAgentSession({
      agentSpecId: "sqlite-agent"
    });
    const message = await first.messages.appendMessage({
      agentId: agent.id,
      role: "user",
      content: "hello sqlite"
    });
    first.close();

    const second = createSQLiteHephStore({ databasePath: dbPath });
    const loadedAgent = await second.state.getAgentSession(agent.id);
    const messages = await second.messages.listMessages(agent.id);

    expect(loadedAgent?.agentSpecId).toBe("sqlite-agent");
    expect(messages.map((item) => item.id)).toEqual([message.id]);
    second.close();
  });

  it("persists MCP bindings, SkillBindings, approval requests, and Run manifests", async () => {
    const dbPath = join(await tempDir(), "mcp.db");
    const first = createSQLiteHephStore({ databasePath: dbPath });
    const agent = await first.state.createAgentSession({
      agentSpecId: "mcp-agent"
    });
    const run = await first.state.createRun({
      agentId: agent.id,
      agentSpecId: "mcp-agent",
      status: "queued",
      input: {
        type: "user.message",
        text: "hello"
      }
    });
    const manifestCreatedAt = new Date();
    await first.state.updateRun(run.id, {
      skillManifest: {
        runId: run.id,
        skills: [],
        createdAt: manifestCreatedAt
      },
      toolManifest: {
        runId: run.id,
        tools: [],
        createdAt: manifestCreatedAt
      }
    });
    const binding = await first.mcpBindings.createMcpBinding({
      agentId: agent.id,
      capabilityId: "crm",
      accountRef: "acct_1",
      allowTools: ["lookup"]
    });
    const skillBinding = await first.skillBindings.createSkillBinding({
      agentId: agent.id,
      skillId: "pr-review",
      name: "pr-review",
      version: "0.1.0",
      source: {
        type: "host-resolved"
      }
    });
    const approval = await first.approvals.createApprovalRequest({
      agentId: agent.id,
      runId: run.id,
      toolId: `mcp.${binding.id}.lookup`,
      input: { customerId: "cus_1" }
    });
    first.close();

    const second = createSQLiteHephStore({ databasePath: dbPath });
    const loadedRun = await second.state.getRun(run.id);
    const bindings = await second.mcpBindings.listMcpBindings(agent.id);
    const skillBindings = await second.skillBindings.listSkillBindings(agent.id);
    const approvals = await second.approvals.listApprovalRequests(run.id);
    const decided = await second.approvals.decideApprovalRequest({
      id: approval.id,
      decision: "granted"
    });

    expect(loadedRun?.skillManifest?.createdAt).toBeInstanceOf(Date);
    expect(loadedRun?.toolManifest?.createdAt).toBeInstanceOf(Date);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      id: binding.id,
      capabilityId: "crm",
      allowTools: ["lookup"],
      status: "active"
    });
    expect(skillBindings[0]).toMatchObject({
      id: skillBinding.id,
      skillId: "pr-review",
      allowReferences: [],
      status: "active"
    });
    expect(approvals[0]).toMatchObject({
      id: approval.id,
      status: "pending"
    });
    expect(decided.status).toBe("granted");
    second.close();
  });

  it("runs Heph with SQLite store and SQLite-backed queue", async () => {
    const dbPath = join(await tempDir(), "heph.db");
    const adapters = createSQLiteAdapters({
      databasePath: dbPath,
      pollIntervalMs: 1
    });
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "runtime-agent",
          instructions: "Use SQLite."
        })
      ],
      stores: adapters.stores,
      queue: adapters.queue
    });

    const created = await heph.agents.createAndRun({
      spec: "runtime-agent",
      input: "hello"
    });
    await heph.drain();

    const run = await heph.runs.get(created.run.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    expect(run?.status).toBe("completed");
    expect(events.map((event) => event.type)).toContain("run.completed");

    adapters.queue.close();
    adapters.stores.close();
  });

  it("serializes jobs for the same agent in the SQLite queue", async () => {
    const dbPath = join(await tempDir(), "queue.db");
    const queue = createSQLiteQueue({
      databasePath: dbPath,
      pollIntervalMs: 1,
      concurrency: 4
    });
    let active = 0;
    let maxActive = 0;

    await queue.startConsumer(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    await queue.enqueue({ type: "schedule_agent", agentId: "agent_1" });
    await queue.enqueue({ type: "schedule_agent", agentId: "agent_1" });
    await queue.onIdle();

    expect(maxActive).toBe(1);
    queue.close();
  });

  it("writes migration SQL without applying it", async () => {
    const outputDir = join(await tempDir(), "migrations/heph");
    const file = writeSQLiteMigration(outputDir);
    const sql = await readFile(file, "utf8");

    expect(file).toContain("0001_initial_heph_sqlite.sql");
    expect(sql).toContain("create table if not exists heph_agent_sessions");
    expect(sql).toContain("create table if not exists heph_mcp_bindings");
    expect(sql).toContain("create table if not exists heph_skill_bindings");
    expect(sql).toContain("create table if not exists heph_approval_requests");
    expect(sql).toContain("create table if not exists heph_queue_jobs");
  });

  it("retries expired processing InboxEvents", async () => {
    const dbPath = join(await tempDir(), "lease.db");
    const store = createSQLiteHephStore({ databasePath: dbPath });
    const agent = await store.state.createAgentSession({
      agentSpecId: "lease-agent"
    });
    const event = await store.inbox.appendInboxEvent({
      agentId: agent.id,
      input: {
        type: "user.message",
        text: "retry me"
      }
    });

    await store.inbox.claimPendingInboxEvents(agent.id);
    store.db
      .prepare("update heph_inbox_events set claim_lease_until = ? where id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), event.id);

    const reclaimed = await store.inbox.claimPendingInboxEvents(agent.id);
    expect(reclaimed.map((item) => item.id)).toEqual([event.id]);
    store.close();
  });

  it("marks failed queue jobs after max attempts", async () => {
    const dbPath = join(await tempDir(), "failed-queue.db");
    const queue = createSQLiteQueue({
      databasePath: dbPath,
      pollIntervalMs: 1,
      retryDelayMs: 1,
      maxAttempts: 1,
      onError() {}
    });

    await queue.startConsumer(async () => {
      throw new Error("boom");
    });
    await queue.enqueue({ type: "schedule_agent", agentId: "agent_1" });
    await queue.onIdle();

    const row = queue.db.prepare("select status from heph_queue_jobs").get() as { status: string };
    expect(row.status).toBe("failed");
    queue.close();
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "heph-sqlite-"));
  tempDirs.push(dir);
  return dir;
}
