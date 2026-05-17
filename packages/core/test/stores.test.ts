import { describe, expect, it } from "vitest";
import { InMemoryHephStore } from "../src/index.js";

describe("InMemoryHephStore", () => {
  it("keeps state, messages, events, and memory separate", async () => {
    const store = new InMemoryHephStore();
    const agent = await store.state.createAgentSession({
      agentSpecId: "support-agent"
    });
    const run = await store.state.createRun({
      agentId: agent.id,
      agentSpecId: "support-agent",
      status: "queued",
      input: {
        type: "user.message",
        text: "hello"
      }
    });
    const message = await store.messages.appendMessage({
      agentId: agent.id,
      role: "user",
      content: "hello"
    });
    const inboxEvent = await store.inbox.appendInboxEvent({
      agentId: agent.id,
      input: {
        type: "user.message",
        text: "hello",
        messageIds: [message.id]
      }
    });
    const memory = await store.memory.putMemory({
      scope: {
        type: "session",
        id: agent.id
      },
      kind: "fact",
      content: "The user asked about Heph.",
      sourceRefs: [
        {
          type: "message",
          id: message.id
        }
      ]
    });

    await store.events.appendRunEvent({
      runId: run.id,
      type: "run.queued"
    });

    expect(await store.messages.listMessages(agent.id)).toHaveLength(1);
    expect(await store.inbox.listInboxEvents(agent.id)).toEqual([inboxEvent]);
    expect(await store.events.listRunEvents(run.id)).toHaveLength(1);
    expect(await store.memory.searchMemory({ scopes: [{ type: "session", id: agent.id }] })).toEqual([memory]);
  });

  it("claims and marks InboxEvents independently from messages and events", async () => {
    const store = new InMemoryHephStore();
    const agent = await store.state.createAgentSession({
      agentSpecId: "support-agent"
    });
    const event = await store.inbox.appendInboxEvent({
      agentId: agent.id,
      input: {
        type: "user.message",
        text: "hello"
      }
    });

    const claimed = await store.inbox.claimPendingInboxEvents(agent.id);
    expect(claimed.map((item) => item.id)).toEqual([event.id]);
    expect(claimed[0]?.status).toBe("processing");

    const run = await store.state.createRun({
      agentId: agent.id,
      agentSpecId: "support-agent",
      status: "queued",
      input: {
        type: "user.message",
        text: "hello"
      }
    });
    await store.inbox.markInboxEventsProcessed([event.id], run.id);

    const processed = await store.inbox.listInboxEvents(agent.id, { status: "processed" });
    expect(processed[0]?.runId).toBe(run.id);
    expect(await store.messages.listMessages(agent.id)).toHaveLength(0);
    expect(await store.events.listRunEvents(run.id)).toHaveLength(0);
  });

  it("assigns run-local event sequences", async () => {
    const store = new InMemoryHephStore();
    const agent = await store.state.createAgentSession({
      agentSpecId: "support-agent"
    });
    const first = await store.state.createRun({
      agentId: agent.id,
      agentSpecId: "support-agent",
      status: "queued",
      input: {
        type: "user.message",
        text: "first"
      }
    });
    const second = await store.state.createRun({
      agentId: agent.id,
      agentSpecId: "support-agent",
      status: "queued",
      input: {
        type: "user.message",
        text: "second"
      }
    });

    const firstEvent = await store.events.appendRunEvent({ runId: first.id, type: "run.queued" });
    const secondEvent = await store.events.appendRunEvent({ runId: second.id, type: "run.queued" });
    const nextFirstEvent = await store.events.appendRunEvent({ runId: first.id, type: "run.started" });

    expect(firstEvent.seq).toBe(1);
    expect(secondEvent.seq).toBe(1);
    expect(nextFirstEvent.seq).toBe(2);
  });
});
