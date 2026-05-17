import { serve } from "@hono/node-server";
import { Agent, type AgentTool, type AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Message } from "@mariozechner/pi-ai";
import { Hono } from "hono";
import { AgentSpec, Tool, createHeph, type Run, type RunExecutor } from "@otakumesi/heph";
import { createDevAuth, createHephRouter } from "@otakumesi/heph/hono";
import { z } from "zod";

const addNumbers = Tool.define({
  id: "addNumbers",
  description: "Add two numbers and return the sum.",
  inputSchema: z.object({
    left: z.number(),
    right: z.number()
  }),
  sideEffect: false,
  requiresApproval: false,
  execute: addNumbersHandler
});

function addNumbersHandler(input: { left: number; right: number }) {
  return {
    left: input.left,
    right: input.right,
    sum: input.left + input.right
  };
}

const calculatorAgent = AgentSpec.define({
  id: "calculator",
  instructions: "Use tools to answer arithmetic questions.",
  tools: [addNumbers]
});

const executor: RunExecutor = {
  async execute(ctx) {
    await ctx.emit({
      type: "turn.started",
      payload: {
        executor: "pi-agent-core"
      }
    });

    const agent = new Agent({
      sessionId: ctx.agent.id,
      toolExecution: "sequential",
      initialState: {
        systemPrompt: "You are a concise calculator agent. Use tools when arithmetic is needed.",
        model: createFauxToolCallingModel(),
        thinkingLevel: "off",
        messages: [
          {
            role: "user",
            content: runInputText(ctx.run),
            timestamp: Date.now()
          }
        ],
        tools: [createPiToolBridge(ctx)]
      }
    });

    await agent.continue();

    const content = latestAssistantText(agent.state.messages);
    const message = await ctx.appendMessage({
      role: "assistant",
      content,
      sourceRunId: ctx.run.id
    });

    await ctx.emit({
      type: "message.completed",
      payload: {
        messageId: message.id,
        content: message.content
      }
    });
    await ctx.emit({
      type: "turn.completed",
      payload: {
        executor: "pi-agent-core"
      }
    });
  }
};

const heph = createHeph({
  agents: [calculatorAgent],
  executor
});

const app = new Hono();

app.get("/", (c) =>
  c.text(
    [
      "Heph minimal tool agent",
      "",
      "Create an agent run:",
      `curl -s -X POST http://localhost:${port()}/api/heph/agents \\`,
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"spec":"calculator","input":"add 2 and 3"}\'',
      "",
      "Then inspect the run and events with the returned run_id."
    ].join("\n")
  )
);

app.route(
  "/api/heph",
  createHephRouter({
    heph,
    getAuth: createDevAuth({
      subject: "example-user"
    })
  })
);

serve(
  {
    fetch: app.fetch,
    port: port()
  },
  (info) => {
    console.log(`Heph minimal tool agent listening on http://localhost:${info.port}`);
    console.log("");
    console.log("Create a run:");
    console.log(`curl -s -X POST http://localhost:${info.port}/api/heph/agents \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"spec":"calculator","input":"add 2 and 3"}\'');
  }
);

function createFauxToolCallingModel() {
  const faux = registerFauxProvider({
    models: [{ id: "heph-minimal-tool-agent", name: "Heph Minimal Tool Agent Faux Model" }],
    tokensPerSecond: 0
  });
  faux.setResponses([
    (context) => {
      const [left = 0, right = 0] = parseNumbers(lastUserText(context.messages));
      return fauxAssistantMessage(fauxToolCall("addNumbers", { left, right }, { id: "call_add_numbers" }));
    },
    (context) => {
      const result = addNumbersResult(lastToolResultDetails(context.messages));
      return fauxAssistantMessage(`${result.left} + ${result.right} = ${result.sum}`);
    }
  ]);
  return faux.getModel();
}

function createPiToolBridge(ctx: Parameters<RunExecutor["execute"]>[0]): AgentTool<any> {
  return {
    name: "addNumbers",
    label: "Add numbers",
    description: "Add two numbers and return the sum.",
    parameters: Type.Object({
      left: Type.Number(),
      right: Type.Number()
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const toolCall = await ctx.tools.tryCall({
        toolId: "addNumbers",
        input: params
      });
      if (!toolCall.ok) {
        throw new Error(toolFailureMessage(toolCall.error));
      }
      return jsonToolResult(toolCall.result, "added numbers");
    }
  };
}

function jsonToolResult<T>(details: T, message: string): AgentToolResult<T> {
  return {
    content: [{ type: "text", text: `${message}\n${JSON.stringify(details, null, 2)}` }],
    details
  };
}

function toolFailureMessage(error: { code?: string; message: string }): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

function port(): number {
  return Number(process.env.PORT ?? 3333);
}

function runInputText(run: Run): string {
  return "text" in run.input ? run.input.text : "";
}

function latestAssistantText(messages: Message[]): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const text = assistant?.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("pi agent did not produce an assistant text message");
  return text;
}

function lastUserText(messages: Message[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  if (!user) return "";
  return typeof user.content === "string"
    ? user.content
    : user.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

function lastToolResultDetails(messages: Message[]): unknown {
  const toolResult = [...messages].reverse().find((message) => message.role === "toolResult");
  return toolResult?.details;
}

function parseNumbers(text: string): number[] {
  return text.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
}

function addNumbersResult(value: unknown): { left: number; right: number; sum: number } {
  const parsed = z
    .object({
      left: z.number(),
      right: z.number(),
      sum: z.number()
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new Error("addNumbers returned an invalid result");
  }
  return parsed.data;
}
