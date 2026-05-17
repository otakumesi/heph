import type {
  AgentSession,
  AgentSpec,
  AppendMessageInput,
  AppendRunEventInput,
  AuthContext,
  DeferredToolOperation,
  HephStores,
  Message,
  RenderedContext,
  Run
} from "./types.js";
import type { CallToolInput, DeferToolResultInput, ToolCallAttemptResult, ToolCallResult } from "./runtime.js";

export interface RunExecutionContext<TApp = unknown> {
  auth: AuthContext | null;
  agent: AgentSession;
  spec: AgentSpec<TApp>;
  run: Run;
  renderedContext: RenderedContext;
  stores: HephStores;
  app: TApp;
  signal: AbortSignal;
  emit(event: Omit<AppendRunEventInput, "runId">): Promise<void>;
  appendMessage(input: Omit<AppendMessageInput, "agentId" | "auth">): Promise<Message>;
  tools: {
    call(input: CallToolInput): Promise<ToolCallResult>;
    tryCall(input: CallToolInput): Promise<ToolCallAttemptResult>;
  };
  callTool(input: CallToolInput): Promise<ToolCallResult>;
  tryCallTool(input: CallToolInput): Promise<ToolCallAttemptResult>;
  deferToolResult(input: Omit<DeferToolResultInput, "runId"> & { runId?: Run["id"] }): Promise<DeferredToolOperation>;
}

export interface RunExecutor<TApp = unknown> {
  execute(ctx: RunExecutionContext<TApp>): Promise<void>;
}

export class MinimalRunExecutor<TApp = unknown> implements RunExecutor<TApp> {
  async execute(ctx: RunExecutionContext<TApp>): Promise<void> {
    await ctx.emit({
      type: "turn.started",
      payload: {
        executor: "minimal"
      }
    });

    const text = runInputText(ctx.run.input);
    const response = text ? `Minimal executor received: ${text}` : "Minimal executor completed the run.";

    await ctx.emit({
      type: "message.started",
      payload: {
        role: "assistant"
      }
    });
    await ctx.emit({
      type: "message.delta",
      payload: {
        text: response
      }
    });

    const message = await ctx.appendMessage({
      role: "assistant",
      content: response,
      sourceRunId: ctx.run.id,
      metadata: {
        executor: "minimal"
      }
    });

    await ctx.emit({
      type: "message.completed",
      payload: {
        messageId: message.id,
        role: message.role,
        content: message.content
      },
      sourceRefs: [
        {
          type: "message",
          id: message.id
        }
      ]
    });
    await ctx.emit({
      type: "turn.completed",
      payload: {
        executor: "minimal"
      }
    });
  }
}

function runInputText(input: Run["input"]): string {
  return "text" in input ? input.text : "";
}
