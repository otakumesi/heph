import { z } from "zod";
import { HephError } from "./errors.js";
import type {
  AgentDefinition,
  AgentSpec as AgentSpecType,
  ContextProvider as ContextProviderType,
  ContextProviderDefinition,
  ContextTemplate as ContextTemplateType,
  McpAgentPolicy,
  SkillAgentPolicy,
  Tool as ToolType,
  ToolDefinition
} from "./types.js";

export function defineAgent<TApp = unknown>(definition: AgentDefinition<TApp>): AgentSpecType<TApp> {
  return {
    id: definition.id,
    version: definition.version ?? null,
    instructions: definition.instructions,
    model: definition.model ?? null,
    tools: definition.tools ?? [],
    mcp: normalizeMcpPolicy(definition.mcp, definition.allowAllMcpTools),
    skills: normalizeSkillPolicy(definition.skills),
    contextProviders: [...(definition.contextProviders ?? []), ...(definition.context ?? [])],
    contextTemplate: definition.contextTemplate ?? null,
    metadata: definition.metadata ?? {}
  };
}

function normalizeMcpPolicy(
  policy: AgentDefinition["mcp"],
  allowAllTools: boolean | undefined
): McpAgentPolicy | null {
  if (policy === undefined || policy === null) {
    return null;
  }

  if (Array.isArray(policy)) {
    const normalized: McpAgentPolicy = {
      allowCapabilities: policy
    };

    if (allowAllTools !== undefined) {
      normalized.allowAllTools = allowAllTools;
    }

    return normalized;
  }

  if (allowAllTools !== undefined) {
    return {
      ...policy,
      allowAllTools
    };
  }

  return policy;
}

function normalizeSkillPolicy(policy: AgentDefinition["skills"]): SkillAgentPolicy | null {
  if (policy === undefined || policy === null) {
    return null;
  }

  if (policy === "all") {
    return {
      allow: "all"
    };
  }

  if (Array.isArray(policy)) {
    return {
      allow: policy
    };
  }

  return policy;
}

export function defineContextProvider<TApp = unknown>(
  definition: ContextProviderDefinition<TApp>
): ContextProviderType<TApp> {
  return {
    id: definition.id,
    load: definition.load
  };
}

export function defineContextTemplate(template: ContextTemplateType): ContextTemplateType {
  return template;
}

export function defineTool<TSchema extends z.ZodType, TResult = unknown, TApp = unknown>(
  definition: ToolDefinition<TSchema, TResult, TApp>
): ToolType<z.infer<TSchema>, TResult, TApp> {
  const jsonSchema = toJsonSchema(definition.id, definition.inputSchema);
  const tool: ToolType<z.infer<TSchema>, TResult, TApp> = {
    id: definition.id,
    description: definition.description,
    inputSchema: definition.inputSchema,
    jsonSchema,
    sideEffect: definition.sideEffect ?? false,
    requiresApproval: definition.requiresApproval ?? false,
    execute: definition.execute
  };

  if (definition.concurrencyKey !== undefined) {
    tool.concurrencyKey = definition.concurrencyKey;
  }

  return tool;
}

export const AgentSpec = {
  define: defineAgent
};

export const ContextProvider = {
  define: defineContextProvider
};

export const ContextTemplate = {
  define: defineContextTemplate
};

export const Tool = {
  define: defineTool
};

function toJsonSchema(toolId: string, schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch (cause) {
    throw new HephError({
      code: "HEPH3001",
      title: "Tool schema is not JSON Schema representable",
      message: `Tool ${toolId} uses a Zod schema that cannot be exposed to the model.`,
      status: 422,
      details: {
        toolId
      },
      cause
    });
  }
}
