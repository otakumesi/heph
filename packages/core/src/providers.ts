import { defineContextProvider } from "./definitions.js";
import type { ContextBlock, ContextProvider, MemoryScope, Message } from "./types.js";

export interface RecentMessagesOptions {
  limit?: number;
}

export function recentMessages(options: RecentMessagesOptions = {}): ContextProvider {
  const limit = options.limit ?? 20;

  return defineContextProvider({
    id: "recent-messages",
    async load(ctx) {
      const messages = await ctx.stores.messages.listMessages(ctx.agent.id, { limit });

      if (messages.length === 0) {
        return null;
      }

      return {
        key: "recentMessages",
        type: "message_history",
        content: formatMessages(messages),
        sourceRefs: messages.map((message) => ({
          type: "message",
          id: message.id
        }))
      };
    }
  });
}

export function threadState(): ContextProvider {
  return defineContextProvider({
    id: "thread-state",
    async load(ctx) {
      return {
        key: "sessionState",
        type: "state",
        content: JSON.stringify(ctx.agent.state, null, 2)
      };
    }
  });
}

export interface MemorySearchOptions {
  topK?: number;
  scopes?: MemoryScope[];
}

export function memorySearch(options: MemorySearchOptions = {}): ContextProvider {
  const topK = options.topK ?? 8;

  return defineContextProvider({
    id: "memory-search",
    async load(ctx) {
      const query = "text" in ctx.input ? ctx.input.text : undefined;
      const searchInput = {
        scopes: options.scopes ?? defaultMemoryScopes(ctx.agent.id, ctx.spec.id, ctx.auth?.userId),
        topK
      };
      const memories = await ctx.stores.memory.searchMemory(
        query === undefined
          ? searchInput
          : {
              ...searchInput,
              query
            }
      );

      if (memories.length === 0) {
        return null;
      }

      return {
        key: "memories",
        type: "memory",
        content: memories
          .map((memory) => {
            const sourceRefs = memory.sourceRefs.map((ref) => `${ref.type}:${ref.id}`).join(", ");
            return `- [${memory.kind}] ${memory.content} (sourceRefs: ${sourceRefs})`;
          })
          .join("\n"),
        sourceRefs: memories.map((memory) => ({
          type: "memory",
          id: memory.id
        }))
      };
    }
  });
}

function formatMessages(messages: Message[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function defaultMemoryScopes(sessionId: string, agentSpecId: string, userId: string | undefined): MemoryScope[] {
  const scopes: MemoryScope[] = [
    {
      type: "session",
      id: sessionId
    },
    {
      type: "agent",
      id: agentSpecId
    }
  ];

  if (userId) {
    scopes.push({
      type: "user",
      id: userId
    });
  }

  return scopes;
}

export function block(block: ContextBlock): ContextBlock {
  return block;
}
