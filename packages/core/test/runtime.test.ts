import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentSpec,
  ContextProvider,
  createHeph,
  createInMemorySkillCatalog,
  defineAgent,
  Tool,
  memorySearch,
  recentMessages,
  threadState,
  type McpBindingResolver,
  type McpToolExecutor,
  type RunExecutor
} from "../src/index.js";

describe("createHeph", () => {
  it("exposes namespace-style definition factories", () => {
    const provider = ContextProvider.define({
      id: "factory-provider",
      async load() {
        return null;
      }
    });
    const tool = Tool.define({
      id: "factory-tool",
      description: "Factory tool.",
      inputSchema: z.object({ value: z.string() }),
      execute(input) {
        return input.value;
      }
    });
    const agent = AgentSpec.define({
      id: "factory-agent",
      instructions: "Use factories.",
      tools: [tool],
      context: [provider]
    });

    expect(agent.id).toBe("factory-agent");
    expect(agent.tools[0]?.id).toBe("factory-tool");
    expect(agent.contextProviders[0]?.id).toBe("factory-provider");
  });

  it("normalizes defineAgent shorthand options", () => {
    const contextProvider = threadState();
    const agentSpec = defineAgent({
      id: "shorthand-agent",
      instructions: "Use shorthand.",
      mcp: ["crm"],
      allowAllMcpTools: true,
      skills: ["support-triage"],
      context: [contextProvider]
    });
    const allSkillsAgent = defineAgent({
      id: "all-skills-agent",
      instructions: "Use all skills.",
      skills: "all"
    });

    expect(agentSpec.mcp).toEqual({
      allowCapabilities: ["crm"],
      allowAllTools: true
    });
    expect(agentSpec.skills).toEqual({
      allow: ["support-triage"]
    });
    expect(agentSpec.contextProviders).toEqual([contextProvider]);
    expect(allSkillsAgent.skills).toEqual({
      allow: "all"
    });
  });

  it("creates an AgentSession and initial Run through the high-level API", async () => {
    const agentSpec = defineAgent({
      id: "support-agent",
      instructions: "You are a concise support agent.",
      contextProviders: [threadState(), recentMessages({ limit: 5 })]
    });
    const heph = createHeph({
      agents: [agentSpec]
    });

    const created = await heph.agents.createAndRun({
      spec: "support-agent",
      input: "hello",
      auth: {
        subject: "user_1",
        userId: "user_1"
      }
    });

    expect(created.agent_id).toMatch(/^agent_/);
    expect(created.run_id).toMatch(/^run_/);
    expect(created.inboxEvent?.id).toMatch(/^inbox_/);
    expect(created.run.status).toBe("queued");

    await heph.drain();

    const run = await heph.runs.get(created.run.id);
    const messages = await heph.messages.list(created.agent.id);
    const inboxEvents = await heph.stores.inbox.listInboxEvents(created.agent.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    const queuedEvent = events.find((event) => event.type === "run.queued");

    expect(run?.status).toBe("completed");
    expect(run?.contextManifest?.contextTemplateId).toBe("default");
    expect(inboxEvents[0]?.status).toBe("processed");
    expect(inboxEvents[0]?.runId).toBe(created.run.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(events.map((event) => event.seq)).toEqual(events.map((_event, index) => index + 1));
    expect(queuedEvent?.sourceRefs).toContainEqual({
      type: "inbox_event",
      id: created.inboxEvent?.id
    });
    expect(events.map((event) => event.type)).toContain("context.rendered");
    expect(events.map((event) => event.type)).toContain("run.completed");
  });

  it("reduces appended user messages from InboxEvents into a scheduled Run", async () => {
    const agentSpec = defineAgent({
      id: "inbox-agent",
      instructions: "Process inbox events."
    });
    const heph = createHeph({
      agents: [agentSpec]
    });
    const agent = await heph.agents.create({
      spec: "inbox-agent"
    });

    const appended = await heph.agents.appendMessage({
      agentId: agent.id,
      content: "first follow up"
    });

    expect(appended.message_id).toMatch(/^msg_/);
    expect(appended.inbox_event_id).toMatch(/^inbox_/);
    expect(appended.scheduled).toBe(true);

    await heph.drain();

    const inboxEvents = await heph.stores.inbox.listInboxEvents(agent.id);
    const runs = await heph.stores.state.listRunsByAgent(agent.id);
    const run = runs[0];
    expect(run?.status).toBe("completed");
    expect(run?.input).toMatchObject({
      type: "user.message",
      text: "first follow up",
      messageIds: [appended.message_id]
    });
    expect(inboxEvents[0]?.status).toBe("processed");
    expect(inboxEvents[0]?.runId).toBe(run?.id);
  });

  it("re-schedules pending user messages after the active Run completes", async () => {
    let releaseRun!: () => void;
    let executions = 0;
    const started = deferred<void>();
    const executor: RunExecutor = {
      async execute() {
        executions += 1;
        if (executions > 1) {
          return;
        }

        started.resolve();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "pending-agent",
          instructions: "Process pending messages."
        })
      ],
      executor
    });
    const created = await heph.agents.createAndRun({
      spec: "pending-agent",
      input: "first"
    });
    await started.promise;

    const appended = await heph.agents.appendMessage({
      agentId: created.agent.id,
      content: "second"
    });
    const pendingBeforeCompletion = await heph.stores.inbox.getInboxEvent(appended.inbox_event_id);
    expect(pendingBeforeCompletion?.status).toBe("pending");

    releaseRun();
    await heph.drain();

    const runs = await heph.stores.state.listRunsByAgent(created.agent.id);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.status)).toEqual(["completed", "completed"]);
    expect(runs[1]?.input).toMatchObject({
      type: "user.message",
      text: "second",
      messageIds: [appended.message_id]
    });
  });

  it("uses configurable reducer limits and text separators", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "batch-agent",
          instructions: "Process batches."
        })
      ],
      inbox: {
        maxEventsPerRun: 2,
        textSeparator: "\n\n--- custom boundary ---\n\n"
      }
    });
    const agent = await heph.agents.create({
      spec: "batch-agent"
    });

    const first = await heph.agents.appendMessage({ agentId: agent.id, content: "first", schedule: false });
    const second = await heph.agents.appendMessage({ agentId: agent.id, content: "second", schedule: false });
    const third = await heph.agents.appendMessage({ agentId: agent.id, content: "third", schedule: false });

    const firstRun = await heph.agents.schedule(agent.id);
    expect(firstRun?.input).toMatchObject({
      type: "user.message",
      text: "first\n\n--- custom boundary ---\n\nsecond",
      messageIds: [first.message_id, second.message_id]
    });
    expect(firstRun?.input.payload).toMatchObject({
      reducedInboxEvents: [
        { inboxEventId: first.inbox_event_id, text: "first" },
        { inboxEventId: second.inbox_event_id, text: "second" }
      ]
    });

    await heph.drain();

    const runs = await heph.stores.state.listRunsByAgent(agent.id);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.input).toMatchObject({
      type: "user.message",
      text: "third",
      messageIds: [third.message_id]
    });
  });

  it("records active-run steering messages in the current Run EventLog", async () => {
    let releaseRun!: () => void;
    const started = deferred<void>();
    const executor: RunExecutor = {
      async execute() {
        started.resolve();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "steering-agent",
          instructions: "Accept steering."
        })
      ],
      executor
    });
    const created = await heph.agents.createAndRun({
      spec: "steering-agent",
      input: "start"
    });
    await started.promise;

    const appended = await heph.agents.appendMessage({
      agentId: created.agent.id,
      type: "steering.message",
      content: "adjust course"
    });

    expect(appended.inboxEvent.status).toBe("processed");
    expect(appended.inboxEvent.runId).toBe(created.run.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "run.steering_received",
        sourceRefs: [
          {
            type: "inbox_event",
            id: appended.inbox_event_id
          }
        ]
      })
    );

    releaseRun();
    await heph.drain();
  });

  it("records a cancel request before cancelling a Run", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "cancel-agent",
          instructions: "Can be cancelled."
        })
      ]
    });
    const agent = await heph.agents.create({
      spec: "cancel-agent"
    });
    const run = await heph.runs.create({
      agentId: agent.id,
      input: "cancel me",
      enqueue: false
    });

    const cancelled = await heph.runs.cancel(run.id);
    const events = await heph.stores.events.listRunEvents(run.id);

    expect(cancelled.status).toBe("cancelled");
    expect(events.map((event) => event.type)).toEqual(["run.queued", "run.cancel_requested", "run.cancelled"]);
  });

  it("retrieves memory through the memory context provider", async () => {
    const agentSpec = defineAgent({
      id: "memory-agent",
      instructions: "Use relevant memory when available.",
      contextProviders: [memorySearch({ topK: 3 })]
    });
    const heph = createHeph({
      agents: [agentSpec]
    });
    const auth = {
      subject: "user_1",
      userId: "user_1"
    };
    const agent = await heph.agents.create({
      spec: "memory-agent",
      auth
    });

    await heph.stores.memory.putMemory({
      scope: {
        type: "user",
        id: "user_1"
      },
      kind: "preference",
      content: "The user prefers short answers about Heph.",
      sourceRefs: [
        {
          type: "manual",
          id: "manual_1"
        }
      ]
    });

    const run = await heph.runs.create({
      agentId: agent.id,
      input: "Heph answer style?",
      auth
    });

    await heph.drain();

    const completed = await heph.runs.get(run.id);
    expect(completed?.contextManifest?.blocks.some((block) => block.key === "memories")).toBe(true);
  });

  it("serializes runs for the same AgentSession in the in-process queue", async () => {
    let active = 0;
    let maxActive = 0;
    const executor: RunExecutor = {
      async execute() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }
    };
    const agentSpec = defineAgent({
      id: "serial-agent",
      instructions: "Run serially."
    });
    const heph = createHeph({
      agents: [agentSpec],
      executor,
      execution: {
        concurrency: 4
      }
    });
    const agent = await heph.agents.create({
      spec: "serial-agent"
    });

    await Promise.all([
      heph.runs.create({
        agentId: agent.id,
        input: "first"
      }),
      heph.runs.create({
        agentId: agent.id,
        input: "second"
      })
    ]);
    await heph.drain();

    expect(maxActive).toBe(1);
  });

  it("snapshots active MCP bindings into the Run ToolManifest before running", async () => {
    let resolveCount = 0;
    const resolver: McpBindingResolver = {
      async resolve() {
        resolveCount += 1;
        return {
          transport: "streamable_http",
          endpoint: "https://mcp.example/rpc",
          tools: [
            {
              name: "lookup_customer",
              description: "Look up a customer.",
              inputSchema: { type: "object", additionalProperties: true },
              sideEffect: false
            }
          ]
        };
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "mcp-agent",
          instructions: "Use MCP tools.",
          mcp: {
            allowCapabilities: ["crm"]
          }
        })
      ],
      mcp: {
        resolver
      }
    });
    const agent = await heph.agents.create({
      spec: "mcp-agent"
    });
    const binding = await heph.agents.addMcpBinding({
      agentId: agent.id,
      capabilityId: "crm",
      allowTools: ["lookup_customer"]
    });
    const run = await heph.runs.create({
      agentId: agent.id,
      input: "find the customer"
    });

    await heph.drain();

    const completed = await heph.runs.get(run.id);
    const events = await heph.stores.events.listRunEvents(run.id);
    const eventTypes = events.map((event) => event.type);
    const manifestTool = completed?.toolManifest?.tools[0];

    expect(resolveCount).toBe(2);
    expect(manifestTool).toMatchObject({
      id: `mcp.${binding.id}.lookup_customer`,
      displayName: "crm.lookup_customer",
      source: "mcp",
      bindingId: binding.id,
      requiresApproval: false
    });
    expect(eventTypes.indexOf("tool_manifest.created")).toBeLessThan(eventTypes.indexOf("run.started"));
    expect(completed?.contextManifest?.blocks.some((block) => block.key === "toolManifest")).toBe(true);
  });

  it("enforces AgentSpec MCP policy when adding bindings", async () => {
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
          id: "restricted-mcp-agent",
          instructions: "Use restricted MCP tools.",
          mcp: {
            allowCapabilities: ["crm"]
          }
        })
      ],
      mcp: {
        resolver
      }
    });
    const agent = await heph.agents.create({
      spec: "restricted-mcp-agent"
    });

    await expect(
      heph.agents.addMcpBinding({
        agentId: agent.id,
        capabilityId: "crm",
        allowTools: "all"
      })
    ).rejects.toMatchObject({
      code: "HEPH7001",
      status: 422
    });

    await expect(
      heph.agents.addMcpBinding({
        agentId: agent.id,
        capabilityId: "billing",
        allowTools: ["lookup"]
      })
    ).rejects.toMatchObject({
      code: "HEPH7001",
      status: 422
    });
  });

  it("activates session skills and snapshots them into Run SkillManifest before running", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "skilled-agent",
          instructions: "Use activated skills.",
          skills: {
            allow: ["pr-review"]
          }
        })
      ],
      skills: {
        catalog: createInMemorySkillCatalog([
          skillPackage({
            id: "pr-review",
            description: "Use this skill for pull request review.",
            instructions: "Inspect changed files and prioritize correctness."
          })
        ])
      }
    });

    const created = await heph.agents.createAndRun({
      spec: "skilled-agent",
      skills: ["pr-review"],
      input: "review this"
    });
    await heph.drain();

    const bindings = await heph.stores.skillBindings.listSkillBindings(created.agent.id);
    const run = await heph.runs.get(created.run.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    const eventTypes = events.map((event) => event.type);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.id).toMatch(/^skillbind_/);
    expect(run?.skillManifest?.skills[0]).toMatchObject({
      bindingId: bindings[0]?.id,
      skillId: "pr-review",
      name: "pr-review",
      description: "Use this skill for pull request review.",
      instructions: "Inspect changed files and prioritize correctness.",
      descriptionHash: expect.stringMatching(/^sha256:/),
      instructionHash: expect.stringMatching(/^sha256:/)
    });
    expect(eventTypes.indexOf("skill_manifest.created")).toBeLessThan(eventTypes.indexOf("tool_manifest.created"));
    expect(eventTypes.indexOf("tool_manifest.created")).toBeLessThan(eventTypes.indexOf("run.started"));
    expect(run?.contextManifest?.blocks.some((block) => block.key === "skills")).toBe(true);
  });

  it("fails closed for missing or disallowed session skills", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "skill-policy-agent",
          instructions: "Use only allowed skills.",
          skills: {
            allow: ["known-skill"]
          }
        }),
        defineAgent({
          id: "skill-disabled-agent",
          instructions: "No skills."
        }),
        defineAgent({
          id: "skill-open-agent",
          instructions: "All catalog skills.",
          skills: {
            allow: "all"
          }
        })
      ],
      skills: {
        catalog: createInMemorySkillCatalog([
          skillPackage({
            id: "known-skill"
          })
        ])
      }
    });

    await expect(
      heph.agents.create({
        spec: "skill-policy-agent",
        skills: ["unknown-skill"]
      })
    ).rejects.toMatchObject({
      code: "HEPH8004",
      status: 422
    });

    await expect(
      heph.agents.create({
        spec: "skill-open-agent",
        skills: ["missing-skill"]
      })
    ).rejects.toMatchObject({
      code: "HEPH8003",
      status: 422
    });

    await expect(
      heph.agents.create({
        spec: "skill-disabled-agent",
        skills: ["known-skill"]
      })
    ).rejects.toMatchObject({
      code: "HEPH8004",
      status: 422
    });
  });

  it("executes Run-scoped MCP tools and gates approval-required calls", async () => {
    let releaseRun!: () => void;
    const started = deferred<void>();
    const executor: RunExecutor = {
      async execute() {
        started.resolve();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      }
    };
    const resolver: McpBindingResolver = {
      async resolve() {
        return {
          transport: "streamable_http",
          endpoint: "https://mcp.example/rpc",
          tools: [
            {
              name: "read_customer",
              sideEffect: false,
              requiresApproval: false
            },
            {
              name: "update_customer",
              sideEffect: true
            }
          ]
        };
      }
    };
    const calls: string[] = [];
    const toolExecutor: McpToolExecutor = {
      async callTool(ctx) {
        calls.push(ctx.manifestTool.remoteToolName);
        return {
          remoteToolName: ctx.manifestTool.remoteToolName,
          input: ctx.input
        };
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "mcp-call-agent",
          instructions: "Call MCP tools.",
          mcp: {
            allowCapabilities: ["crm"],
            allowAllTools: true
          }
        })
      ],
      executor,
      mcp: {
        resolver,
        toolExecutor
      }
    });
    const agent = await heph.agents.create({
      spec: "mcp-call-agent"
    });
    const binding = await heph.agents.addMcpBinding({
      agentId: agent.id,
      capabilityId: "crm",
      allowTools: "all"
    });
    const run = await heph.runs.create({
      agentId: agent.id,
      input: "start"
    });
    await started.promise;

    const readToolId = `mcp.${binding.id}.read_customer`;
    const updateToolId = `mcp.${binding.id}.update_customer`;
    const readResult = await heph.tools.call(run.id, {
      toolId: readToolId,
      input: { customerId: "cus_1" }
    });

    expect(readResult.result).toMatchObject({
      remoteToolName: "read_customer",
      input: { customerId: "cus_1" }
    });

    await expect(
      heph.tools.call(run.id, {
        toolId: updateToolId,
        input: { customerId: "cus_1", name: "New Name" }
      })
    ).rejects.toMatchObject({
      code: "HEPH3002",
      status: 409
    });

    const paused = await heph.runs.get(run.id);
    const approvals = await heph.approvals.list(run.id);
    expect(paused?.status).toBe("paused");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      toolId: updateToolId,
      status: "pending"
    });

    await heph.approvals.decide({
      approvalRequestId: approvals[0]!.id,
      decision: "granted"
    });
    const updateResult = await heph.tools.call(run.id, {
      toolId: updateToolId,
      input: { customerId: "cus_1", name: "New Name" },
      approvalRequestId: approvals[0]!.id
    });
    const events = await heph.stores.events.listRunEvents(run.id);

    expect(updateResult.result).toMatchObject({
      remoteToolName: "update_customer"
    });
    expect(calls).toEqual(["read_customer", "update_customer"]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["approval.requested", "approval.granted", "tool.started", "tool.completed"])
    );

    releaseRun();
    await heph.drain();
  });

  it("lets executors call Run-scoped tools through the execution context", async () => {
    const tool = Tool.define({
      id: "sum",
      description: "Sum two numbers.",
      inputSchema: z.object({
        left: z.number(),
        right: z.number()
      }),
      sideEffect: false,
      requiresApproval: false,
      execute(input) {
        return input.left + input.right;
      }
    });
    const executor: RunExecutor = {
      async execute(ctx) {
        const result = await ctx.tools.call({
          toolId: "sum",
          input: {
            left: 2,
            right: 3
          }
        });
        const aliasResult = await ctx.callTool({
          toolId: "sum",
          input: {
            left: result.result as number,
            right: 4
          }
        });
        await ctx.appendMessage({
          role: "assistant",
          content: `result=${aliasResult.result}`
        });
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "tool-context-agent",
          instructions: "Use tools.",
          tools: [tool]
        })
      ],
      executor
    });
    const created = await heph.agents.createAndRun({
      spec: "tool-context-agent",
      input: "add numbers"
    });

    await heph.drain();

    const messages = await heph.messages.list(created.agent.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    expect(messages.at(-1)?.content).toBe("result=9");
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(2);
  });

  it("lets executors return failed tool calls to the agent loop without failing the Run", async () => {
    const tool = Tool.define({
      id: "flakyLookup",
      description: "Sometimes fails.",
      inputSchema: z.object({
        query: z.string()
      }),
      sideEffect: false,
      requiresApproval: false,
      execute() {
        throw new Error("temporary lookup failure");
      }
    });
    const executor: RunExecutor = {
      async execute(ctx) {
        const result = await ctx.tools.tryCall({
          toolId: "flakyLookup",
          input: {
            query: "retryable"
          }
        });
        await ctx.appendMessage({
          role: "assistant",
          content: result.ok ? "unexpected success" : `tool failed: ${result.error.message}`
        });
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "tool-try-call-agent",
          instructions: "Use tools.",
          tools: [tool]
        })
      ],
      executor
    });
    const created = await heph.agents.createAndRun({
      spec: "tool-try-call-agent",
      input: "lookup"
    });

    await heph.drain();

    const run = await heph.runs.get(created.run.id);
    const messages = await heph.messages.list(created.agent.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    expect(run?.status).toBe("completed");
    expect(messages.at(-1)?.content).toBe("tool failed: temporary lookup failure");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["tool.failed", "run.completed"]));
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
  });

  it("keeps throwing failed tool calls through the strict executor tool API", async () => {
    const tool = Tool.define({
      id: "strictFailure",
      description: "Always fails.",
      inputSchema: z.object({}),
      sideEffect: false,
      requiresApproval: false,
      execute() {
        throw new Error("strict tool failure");
      }
    });
    const executor: RunExecutor = {
      async execute(ctx) {
        await ctx.tools.call({
          toolId: "strictFailure",
          input: {}
        });
      }
    };
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "tool-strict-call-agent",
          instructions: "Use tools.",
          tools: [tool]
        })
      ],
      executor
    });
    const created = await heph.agents.createAndRun({
      spec: "tool-strict-call-agent",
      input: "lookup"
    });

    await heph.drain();

    const run = await heph.runs.get(created.run.id);
    const events = await heph.stores.events.listRunEvents(created.run.id);
    expect(run?.status).toBe("failed");
    expect(run?.error?.message).toBe("strict tool failure");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["tool.failed", "run.failed"]));
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject
  };
}

function skillPackage(input: {
  id: string;
  description?: string;
  instructions?: string;
}) {
  return {
    id: input.id,
    name: input.id,
    description: input.description ?? "A test skill.",
    version: "0.1.0",
    instructions: input.instructions ?? "Use this test skill.",
    source: {
      type: "host-resolved" as const
    },
    references: [],
    assets: [],
    templates: [],
    metadata: {},
    loadedAt: new Date()
  };
}
