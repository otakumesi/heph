import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createHeph, createInMemorySkillCatalog, defineAgent, type McpBindingResolver } from "@heph/core";
import { createDevAuth, createHephApp, createHephRouter } from "../src/index.js";

describe("createHephRouter", () => {
  it("creates an AgentSession and initial Run through POST /agents", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "support-agent",
          instructions: "You are a support agent."
        })
      ]
    });
    const app = createHephApp({
      heph,
      getAuth: createDevAuth({ subject: "dev-user" })
    });

    const response = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "support-agent",
        input: "hello"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent_id).toMatch(/^agent_/);
    expect(body.run_id).toMatch(/^run_/);

    await heph.drain();

    const runResponse = await app.request(`/runs/${body.run_id}`);
    const runBody = await runResponse.json();
    expect(runBody.run.status).toBe("completed");
  });

  it("mounts into an existing Hono app and receives host auth through getAuth(c)", async () => {
    type TestEnv = {
      Variables: {
        auth: {
          subject: string;
          userId: string;
          tenantId: string;
        };
      };
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "embedded-agent",
          instructions: "You are embedded."
        })
      ]
    });
    const host = new Hono<TestEnv>();

    host.use("/api/heph/*", async (c, next) => {
      c.set("auth", {
        subject: "user_1",
        userId: "user_1",
        tenantId: "tenant_1"
      });
      await next();
    });
    host.route(
      "/api/heph",
      createHephRouter<TestEnv>({
        heph,
        getAuth: (c) => c.get("auth")
      })
    );

    const response = await host.request("/api/heph/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "embedded-agent"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent.auth.subject).toBe("user_1");
    expect(body.agent.auth.tenantId).toBe("tenant_1");
  });

  it("appends user messages through InboxEvents and schedules the agent", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "message-agent",
          instructions: "You answer messages."
        })
      ]
    });
    const app = createHephApp({
      heph
    });
    const createdResponse = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "message-agent"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const created = await createdResponse.json();
    const agentId = created.agent.agent_id;

    const response = await app.request(`/agents/${agentId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "user.message",
        content: "hello again"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.message_id).toMatch(/^msg_/);
    expect(body.inbox_event_id).toMatch(/^inbox_/);
    expect(body.scheduled).toBe(true);
    expect(body.inbox_event.status).toBe("pending");
    expect(body.inbox_event.type).toBe("user.message");

    await heph.drain();

    const inboxEvents = await heph.stores.inbox.listInboxEvents(agentId);
    const runs = await heph.stores.state.listRunsByAgent(agentId);
    expect(inboxEvents[0]?.status).toBe("processed");
    expect(runs[0]?.status).toBe("completed");
  });

  it("manages AgentSession MCP bindings through Hono routes", async () => {
    const resolver: McpBindingResolver = {
      async resolve() {
        return {
          transport: "streamable_http",
          endpoint: "https://mcp.example/rpc",
          tools: [{ name: "lookup", sideEffect: false }]
        };
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "mcp-route-agent",
          instructions: "Route MCP.",
          mcp: {
            allowCapabilities: ["crm"]
          }
        })
      ],
      mcp: {
        resolver
      }
    });
    const app = createHephApp({ heph });
    const createdResponse = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "mcp-route-agent"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const created = await createdResponse.json();

    const createResponse = await app.request(`/agents/${created.agent.agent_id}/mcp-bindings`, {
      method: "POST",
      body: JSON.stringify({
        capabilityId: "crm",
        allowTools: ["lookup"],
        accountRef: "acct_1"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createBody.mcp_binding_id).toMatch(/^mcpbind_/);
    expect(createBody.binding.capability_id).toBe("crm");
    expect(createBody.binding.allow_tools).toEqual(["lookup"]);

    const listResponse = await app.request(`/agents/${created.agent.agent_id}/mcp-bindings`);
    const listBody = await listResponse.json();
    expect(listBody.bindings.map((binding: { mcp_binding_id: string }) => binding.mcp_binding_id)).toEqual([
      createBody.mcp_binding_id
    ]);

    const deleteResponse = await app.request(
      `/agents/${created.agent.agent_id}/mcp-bindings/${createBody.mcp_binding_id}`,
      {
        method: "DELETE"
      }
    );
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody.binding.status).toBe("removed");

    const listAfterDeleteResponse = await app.request(`/agents/${created.agent.agent_id}/mcp-bindings`);
    const listAfterDeleteBody = await listAfterDeleteResponse.json();
    expect(listAfterDeleteBody.bindings).toEqual([]);
  });

  it("activates session skills from POST /agents skills", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "skill-route-agent",
          instructions: "Use routed skills.",
          skills: {
            allow: ["support-triage"]
          }
        })
      ],
      skills: {
        catalog: createInMemorySkillCatalog([
          {
            id: "support-triage",
            name: "support-triage",
            description: "Use this skill for support triage.",
            version: "0.1.0",
            instructions: "Classify urgency before answering.",
            source: {
              type: "host-resolved"
            },
            references: [],
            assets: [],
            templates: [],
            metadata: {},
            loadedAt: new Date()
          }
        ])
      }
    });
    const app = createHephApp({ heph });

    const response = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "skill-route-agent",
        input: "triage this",
        skills: ["support-triage"]
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();
    await heph.drain();

    const bindings = await heph.stores.skillBindings.listSkillBindings(body.agent_id);
    const run = await heph.runs.get(body.run_id);
    expect(response.status).toBe(201);
    expect(bindings[0]).toMatchObject({
      skillId: "support-triage",
      status: "active"
    });
    expect(run?.skillManifest?.skills[0]?.instructions).toBe("Classify urgency before answering.");
    expect(run?.skillManifest?.skills[0]?.bindingId).toBe(bindings[0]?.id);
  });

  it("rejects follow_up.message until its lifecycle is defined", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "follow-up-agent",
          instructions: "You answer messages."
        })
      ]
    });
    const app = createHephApp({ heph });
    const createdResponse = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "follow-up-agent"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const created = await createdResponse.json();

    const response = await app.request(`/agents/${created.agent.agent_id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        type: "follow_up.message",
        content: "extra detail"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("HEPH6003");
  });

  it("streams run events from EventLog with after replay support", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "stream-agent",
          instructions: "You stream events."
        })
      ]
    });
    const app = createHephApp({
      heph,
      stream: {
        pollIntervalMs: 1
      }
    });
    const createdResponse = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "stream-agent",
        input: "stream this"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const created = await createdResponse.json();
    await heph.drain();

    const streamResponse = await app.request(`/runs/${created.run_id}/stream?after=1`);
    const text = await streamResponse.text();

    expect(streamResponse.headers.get("Content-Type")).toContain("text/event-stream");
    expect(text).toContain("event: run.started");
    expect(text).toContain("event: run.completed");
    expect(text).not.toContain("event: run.queued");
  });

  it("returns a stable error payload when auth is required", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "auth-agent",
          instructions: "Auth required."
        })
      ]
    });
    const app = createHephApp({
      heph,
      requireAuth: true
    });

    const response = await app.request("/agents", {
      method: "POST",
      body: JSON.stringify({
        spec: "auth-agent"
      }),
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("HEPH6001");
  });
});
