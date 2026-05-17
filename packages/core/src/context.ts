import { HephError } from "./errors.js";
import type {
  ContextBlock,
  ContextManifest,
  ContextManifestBlock,
  ContextTemplate,
  ContextTemplateMessage,
  RenderedContext,
  RunId
} from "./types.js";

export interface ContextRendererOptions {
  template: ContextTemplate;
  blocks: ContextBlock[];
  runId: RunId;
  input: string;
  runtime?: Record<string, string>;
}

export class ContextRenderer {
  render(options: ContextRendererOptions): RenderedContext {
    const slotValues = new Map<string, string>();
    const manifestBlocks: ContextManifestBlock[] = [];

    for (const block of options.blocks) {
      const slot = options.template.slots[block.key];
      const originalTokens = estimateTokens(block.content);
      const truncatedContent = slot?.maxTokens ? truncateToTokens(block.content, slot.maxTokens) : block.content;
      const tokens = estimateTokens(truncatedContent);
      const existing = slotValues.get(block.key);

      slotValues.set(block.key, existing ? `${existing}\n\n${truncatedContent}` : truncatedContent);
      manifestBlocks.push({
        key: block.key,
        type: block.type,
        tokens,
        sourceRefs: block.sourceRefs ?? [],
        truncated: tokens < originalTokens
      });
    }

    for (const [key, slot] of Object.entries(options.template.slots)) {
      const value = slotValues.get(key);

      if (slot.required && isBlank(value)) {
        throw new HephError({
          code: "HEPH2001",
          title: "Required context slot is missing",
          message: `Context template ${options.template.id} requires slot ${key}.`,
          status: 422,
          details: {
            templateId: options.template.id,
            slot: key
          }
        });
      }
    }

    const messages = options.template.messages.map((message) => ({
      role: message.role,
      content: interpolate(message.content, {
        input: options.input,
        runtime: options.runtime ?? {},
        slots: slotValues
      }).trim()
    }));

    const manifest: ContextManifest = {
      runId: options.runId,
      contextTemplateId: options.template.id,
      contextTemplateVersion: options.template.version,
      blocks: manifestBlocks,
      totalTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      createdAt: new Date()
    };

    return {
      messages,
      manifest
    };
  }
}

export const defaultContextTemplate: ContextTemplate = {
  id: "default",
  version: "0.1.0",
  slots: {
    runtimePolicy: { required: true },
    agentIdentity: { required: true },
    developerRules: { maxTokens: 1200 },
    currentTask: { required: true, maxTokens: 1200 },
    sessionState: { required: true, maxTokens: 1500 },
    openTasks: { maxTokens: 1000 },
    pendingApprovals: { maxTokens: 800 },
    skills: { maxTokens: 2000 },
    memories: { maxTokens: 2000 },
    condensedHistory: { maxTokens: 2000 },
    recentMessages: { maxTokens: 3000 },
    domainContext: { maxTokens: 2500 },
    workspaceContext: { maxTokens: 2500 },
    artifacts: { maxTokens: 1500 },
    teamContext: { maxTokens: 1500 },
    toolManifest: { required: true, maxTokens: 2500 },
    outputContract: { maxTokens: 1000 }
  },
  messages: [
    {
      role: "system",
      content: `
{{ runtimePolicy }}

{{ agentIdentity }}
`
    },
    {
      role: "developer",
      content: `
Developer rules:
{{ developerRules }}

Tool and safety policy:
{{ runtime.toolPolicy }}

Output contract:
{{ outputContract }}
`
    },
    {
      role: "user",
      content: `
Current task:
{{ currentTask }}

Current session state:
{{ sessionState }}

Open tasks:
{{ openTasks }}

Pending approvals or blocked actions:
{{ pendingApprovals }}

Active skills:
{{ skills }}

Relevant memory:
{{ memories }}

Condensed prior history:
{{ condensedHistory }}

Recent conversation:
{{ recentMessages }}

Domain context:
{{ domainContext }}

Workspace context:
{{ workspaceContext }}

Relevant artifacts:
{{ artifacts }}

Team context:
{{ teamContext }}

Available tools for this Run:
{{ toolManifest }}

User input:
{{ input }}
`
    }
  ]
};

export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.max(1, Math.ceil(content.length / 4));
}

function truncateToTokens(content: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4);

  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n[truncated]`;
}

function interpolate(
  template: string,
  values: {
    input: string;
    runtime: Record<string, string>;
    slots: Map<string, string>;
  }
): string {
  return template.replaceAll(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    if (key === "input") {
      return values.input;
    }

    if (key.startsWith("runtime.")) {
      return values.runtime[key.slice("runtime.".length)] ?? "";
    }

    return values.slots.get(key) ?? "";
  });
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function messagesToText(messages: ContextTemplateMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}
