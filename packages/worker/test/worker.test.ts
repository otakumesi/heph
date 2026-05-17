import { describe, expect, it } from "vitest";
import { createHeph, defineAgent } from "@heph/core";
import { createHephWorker } from "../src/index.js";

describe("createHephWorker", () => {
  it("handles schedule_agent and execute_run jobs through the runtime", async () => {
    const heph = createHeph({
      agents: [
        defineAgent({
          id: "worker-agent",
          instructions: "Run from worker jobs."
        })
      ],
      execution: {
        mode: "split-worker"
      }
    });
    const worker = createHephWorker({ heph });
    const agent = await heph.agents.create({
      spec: "worker-agent"
    });

    await heph.agents.appendMessage({
      agentId: agent.id,
      content: "hello worker",
      schedule: false
    });
    await worker.handle({
      type: "schedule_agent",
      agentId: agent.id
    });

    const scheduledRuns = await heph.stores.state.listRunsByAgent(agent.id);
    const run = scheduledRuns[0];
    expect(run?.status).toBe("queued");

    await worker.handle({
      type: "execute_run",
      agentId: agent.id,
      runId: run!.id
    });

    const completed = await heph.runs.get(run!.id);
    expect(completed?.status).toBe("completed");
  });
});
