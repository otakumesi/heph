import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { HephError, createHeph } from "@heph/core";
import type { AuthContext, CreateHephOptions, HephRuntime } from "@heph/core";

export interface CliIo {
  cwd?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

interface CliContext {
  cwd: string;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

export async function runCli(argv = process.argv.slice(2), io: CliIo = {}): Promise<number> {
  const ctx: CliContext = {
    cwd: io.cwd ?? process.cwd(),
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr
  };

  try {
    const parsed = parseArgs(argv);
    const [command, subcommand, name] = parsed.positionals;

    if (!command || command === "help" || parsed.flags.has("help")) {
      printHelp(ctx);
      return 0;
    }

    if (command === "init") {
      await initProject(ctx, parsed);
      return 0;
    }

    if (command === "add") {
      await addScaffold(ctx, subcommand, name, parsed);
      return 0;
    }

    if (command === "inspect" && subcommand === "context") {
      await inspectContext(ctx, parsed);
      return 0;
    }

    if (command === "add" && subcommand === "skill") {
      throw cliUsage("heph add skill is not part of the MVP. Skills are runtime bindings, not scaffolded components.");
    }

    throw cliUsage(`Unknown command: ${parsed.positionals.join(" ")}`);
  } catch (error) {
    writeLine(ctx.stderr, formatCliError(error));
    return 1;
  }
}

function printHelp(ctx: CliContext): void {
  writeLine(
    ctx.stdout,
    `heph

Usage:
  heph init [dir] [--force]
  heph add agent <id> [--dir <dir>] [--force]
  heph add tool <id> [--dir <dir>] [--force]
  heph add context-provider <id> [--dir <dir>] [--force]
  heph add template <id> [--dir <dir>] [--force]
  heph inspect context --agent <agent_spec_id> --input <text> [--config <path>] [--format json]

MVP note:
  heph add skill is intentionally not available.`
  );
}

async function initProject(ctx: CliContext, parsed: ParsedArgs): Promise<void> {
  const targetArg = parsed.positionals[1] && !parsed.positionals[1].startsWith("-") ? parsed.positionals[1] : ".";
  const targetDir = resolvePath(ctx.cwd, targetArg);
  const force = parsed.flags.has("force");
  const projectName = toPackageName(basename(targetDir) || "my-agent-app");
  const writes: Array<[string, string]> = [
    ["package.json", packageJsonTemplate(projectName)],
    ["tsconfig.json", tsconfigTemplate()],
    [".env.example", envTemplate()],
    ["heph.config.ts", hephConfigTemplate()],
    ["src/runtime.ts", runtimeTemplate()],
    ["src/server.ts", serverTemplate()],
    ["src/worker.ts", workerTemplate()],
    ["src/agents/index.ts", agentsIndexTemplate()],
    ["src/agents/support-agent.agent.ts", supportAgentTemplate()],
    ["src/tools/index.ts", emptyIndexTemplate()],
    ["src/context/index.ts", emptyIndexTemplate()],
    ["src/context-templates/default.template.ts", defaultTemplateTemplate()],
    ["src/auth/index.ts", authIndexTemplate()],
    ["src/auth/auth.adapter.ts", authAdapterTemplate()],
    ["src/memory/index.ts", emptyIndexTemplate()],
    ["src/policies/index.ts", emptyIndexTemplate()],
    ["migrations/heph/.gitkeep", ""],
    ["var/.gitkeep", ""],
    ["AGENTS.md", agentsMdTemplate()]
  ];

  for (const [relativePath, content] of writes) {
    await writeProjectFile(join(targetDir, relativePath), content, force);
  }
  await upsertGitignore(targetDir, ["/var/*.db", "/var/*.db-*"]);

  writeLine(ctx.stdout, `Initialized Heph app at ${targetDir}`);
}

async function addScaffold(
  ctx: CliContext,
  kind: string | undefined,
  id: string | undefined,
  parsed: ParsedArgs
): Promise<void> {
  if (!kind || !id) {
    throw cliUsage("Usage: heph add <agent|tool|context-provider|template> <id>");
  }

  const root = resolvePath(ctx.cwd, getStringFlag(parsed, "dir") ?? ".");
  const force = parsed.flags.has("force");
  const normalized = normalizeId(id);

  if (kind === "agent") {
    const file = join(root, "src/agents", `${normalized.kebab}.agent.ts`);
    await writeProjectFile(file, agentTemplate(normalized), force);
    await upsertAgentIndex(join(root, "src/agents/index.ts"), normalized);
    writeLine(ctx.stdout, `Added agent ${id}`);
    return;
  }

  if (kind === "tool") {
    const file = join(root, "src/tools", `${normalized.kebab}.tool.ts`);
    await writeProjectFile(file, toolTemplate(normalized), force);
    await appendExport(join(root, "src/tools/index.ts"), `export { ${componentVar(normalized, "Tool")} } from "./${normalized.kebab}.tool";\n`);
    writeLine(ctx.stdout, `Added tool ${id}`);
    return;
  }

  if (kind === "context-provider") {
    const file = join(root, "src/context", `${normalized.kebab}.context.ts`);
    await writeProjectFile(file, contextProviderTemplate(normalized), force);
    await appendExport(join(root, "src/context/index.ts"), `export { ${componentVar(normalized, "Context")} } from "./${normalized.kebab}.context";\n`);
    writeLine(ctx.stdout, `Added context provider ${id}`);
    return;
  }

  if (kind === "template") {
    const file = join(root, "src/context-templates", `${normalized.kebab}.template.ts`);
    await writeProjectFile(file, contextTemplateTemplate(normalized), force);
    writeLine(ctx.stdout, `Added context template ${id}`);
    return;
  }

  if (kind === "skill") {
    throw cliUsage("heph add skill is not part of the MVP. Skills are runtime bindings, not scaffolded components.");
  }

  throw cliUsage(`Unknown scaffold type: ${kind}`);
}

async function inspectContext(ctx: CliContext, parsed: ParsedArgs): Promise<void> {
  const agentSpecId = getStringFlag(parsed, "agent") ?? getStringFlag(parsed, "spec");
  const input = getStringFlag(parsed, "input") ?? parsed.positionals.slice(2).join(" ");
  const format = getStringFlag(parsed, "format") ?? "text";

  if (!agentSpecId) {
    throw cliUsage("heph inspect context requires --agent <agent_spec_id>.");
  }

  if (!input) {
    throw cliUsage("heph inspect context requires --input <text>.");
  }

  const configPath = await resolveConfigPath(ctx.cwd, getStringFlag(parsed, "config"));
  const loaded = await loadConfig(configPath);
  const heph = isHephRuntime(loaded) ? loaded : createHeph(loaded as CreateHephOptions);
  const auth: AuthContext = {
    subject: "inspect",
    actorType: "service"
  };
  const agent = await heph.agents.create({
    spec: agentSpecId,
    auth
  });
  const run = await heph.runs.create({
    agentId: agent.id,
    input,
    auth,
    enqueue: false
  });
  const rendered = await heph.renderRunContext(run.id);

  if (format === "json") {
    writeLine(
      ctx.stdout,
      JSON.stringify(
        {
          messages: rendered.messages,
          manifest: rendered.manifest
        },
        null,
        2
      )
    );
    return;
  }

  for (const message of rendered.messages) {
    writeLine(ctx.stdout, `--- ${message.role} ---`);
    writeLine(ctx.stdout, message.content);
  }

  writeLine(ctx.stdout, "--- context manifest ---");
  writeLine(ctx.stdout, JSON.stringify(rendered.manifest, null, 2));
}

async function loadConfig(configPath: string): Promise<unknown> {
  try {
    const jiti = createJiti(pathToFileURL(configPath).href, {
      interopDefault: true,
      moduleCache: false
    });
    const module = await jiti.import<Record<string, unknown>>(configPath);
    return module.default ?? module.heph ?? module.config ?? module;
  } catch (cause) {
    throw new HephError({
      code: "HEPH9003",
      title: "Failed to load Heph config",
      message: `Failed to load Heph config at ${configPath}.`,
      details: {
        configPath
      },
      cause
    });
  }
}

async function resolveConfigPath(cwd: string, explicitPath: string | undefined): Promise<string> {
  if (explicitPath) {
    return resolvePath(cwd, explicitPath);
  }

  for (const candidate of ["heph.config.ts", "heph.config.mts", "heph.config.mjs", "heph.config.js"]) {
    const fullPath = join(cwd, candidate);
    if (await exists(fullPath)) {
      return fullPath;
    }
  }

  throw cliUsage("Could not find heph.config.ts. Pass --config <path>.");
}

function isHephRuntime(value: unknown): value is HephRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "agents" in value &&
    "runs" in value &&
    "renderRunContext" in value
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      const key = rawKey;

      if (!key) {
        continue;
      }

      if (inlineValue !== undefined) {
        flags.set(key, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        index += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }

    positionals.push(arg);
  }

  return {
    positionals,
    flags
  };
}

function getStringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

async function writeProjectFile(path: string, content: string, force: boolean): Promise<void> {
  if (!force && (await exists(path))) {
    throw new HephError({
      code: "HEPH9001",
      title: "File already exists",
      message: `${path} already exists. Re-run with --force to overwrite it.`,
      details: {
        path
      }
    });
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function appendExport(path: string, exportLine: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = (await exists(path)) ? await readFile(path, "utf8") : "";

  if (existing.includes(exportLine.trim())) {
    return;
  }

  await writeFile(path, `${existing.trimEnd()}\n${exportLine}`.trimStart(), "utf8");
}

async function upsertGitignore(root: string, entries: string[]): Promise<void> {
  const path = join(root, ".gitignore");
  const existing = (await exists(path)) ? await readFile(path, "utf8") : "";
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !existingLines.has(entry));

  if (missing.length === 0) {
    return;
  }

  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const header = existingLines.has("# Heph local runtime data") ? "" : `${prefix}# Heph local runtime data\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${existing}${header}${missing.join("\n")}\n`, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function cliUsage(message: string): HephError {
  return new HephError({
    code: "HEPH9002",
    title: "Invalid CLI usage",
    message
  });
}

function formatCliError(error: unknown): string {
  if (error instanceof HephError) {
    return `${error.code} ${error.title}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function writeLine(stream: Pick<NodeJS.WriteStream, "write">, line: string): void {
  stream.write(`${line}\n`);
}

function normalizeId(id: string): { raw: string; kebab: string; camel: string; pascal: string } {
  const kebab = id
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const words = kebab.split("-").filter(Boolean);
  const pascal = words.map(capitalize).join("");
  const camel = pascal ? `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}` : "component";

  if (!kebab) {
    throw cliUsage(`Invalid id: ${id}`);
  }

  return {
    raw: id,
    kebab,
    camel,
    pascal
  };
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function toPackageName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function packageJsonTemplate(projectName: string): string {
  return `${JSON.stringify(
    {
      name: projectName || "my-agent-app",
      version: "0.0.1",
      private: true,
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit"
      },
      dependencies: {
        "@otakumesi/heph": "^0.0.2-alpha.0",
        hono: "^4.10.7",
        zod: "^4.1.12"
      },
      devDependencies: {
        "@types/node": "^24.10.1",
        typescript: "^5.9.3"
      }
    },
    null,
    2
  )}\n`;
}

function tsconfigTemplate(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "heph.config.ts"]
}
`;
}

function envTemplate(): string {
  return `# Application-owned environment for your Heph app.
# Add model provider credentials and host-app secrets here.
HEPH_DATABASE_PATH=./var/heph.db
`;
}

function hephConfigTemplate(): string {
  return `import type { CreateHephOptions } from "@otakumesi/heph";
import { agents } from "./src/agents/index.js";

const config = {
  agents,
  execution: {
    mode: "single-process"
  }
} satisfies CreateHephOptions;

export default config;
`;
}

function runtimeTemplate(): string {
  return `import { createHeph } from "@otakumesi/heph";
import { createSQLiteAdapters } from "@otakumesi/heph/sqlite";
import config from "../heph.config.js";

const sqlite = createSQLiteAdapters({
  databasePath: process.env.HEPH_DATABASE_PATH ?? "./var/heph.db",
  migrations: {
    mode: "apply",
    outputDir: "migrations/heph"
  }
});

export const heph = createHeph({
  ...config,
  stores: sqlite.stores,
  queue: sqlite.queue
});
`;
}

function serverTemplate(): string {
  return `import { createDevAuth, createHephApp } from "@otakumesi/heph/hono";
import { heph } from "./runtime.js";

export default createHephApp({
  heph,
  getAuth: createDevAuth({
    subject: "dev-user"
  })
});
`;
}

function workerTemplate(): string {
  return `import { createHephWorker } from "@otakumesi/heph/worker";
import { heph } from "./runtime.js";

export const worker = createHephWorker({ heph });
`;
}

function agentsIndexTemplate(): string {
  return `import { supportAgent } from "./support-agent.agent.js";

export { supportAgent };

export const agents = [
  supportAgent
];
`;
}

function supportAgentTemplate(): string {
  return `import { defineAgent, memorySearch, recentMessages, threadState } from "@otakumesi/heph";

export const supportAgent = defineAgent({
  id: "support-agent",
  instructions: \`
You are a support agent for this application.
Use the provided context, bounded memory, and available tools.
\`,
  contextProviders: [
    threadState(),
    recentMessages({ limit: 20 }),
    memorySearch({ topK: 8 })
  ]
});
`;
}

function emptyIndexTemplate(): string {
  return `export {};
`;
}

function defaultTemplateTemplate(): string {
  return `import { defaultContextTemplate, defineContextTemplate } from "@otakumesi/heph";

// Application-owned and editable. Runtime-owned safety controls still live in Heph.
export const defaultTemplate = defineContextTemplate(defaultContextTemplate);
`;
}

function authIndexTemplate(): string {
  return `export { devAuth } from "./auth.adapter.js";
`;
}

function authAdapterTemplate(): string {
  return `import { createDevAuth } from "@otakumesi/heph/hono";

export const devAuth = createDevAuth({
  subject: "dev-user"
});
`;
}

function agentsMdTemplate(): string {
  return `# AGENTS.md

This is a Heph application.

- Generated files are application-owned and editable.
- Keep AgentSpec, Tool, ContextProvider, and ContextTemplate definitions in src/.
- Do not put login/signup flows into Heph core integration code.
- Do not execute Skill scripts.
`;
}

function agentTemplate(id: ReturnType<typeof normalizeId>): string {
  const variable = componentVar(id, "Agent");
  return `import { defineAgent, recentMessages, threadState } from "@otakumesi/heph";

export const ${variable} = defineAgent({
  id: "${id.kebab}",
  instructions: \`
Describe the ${id.raw} agent's role here.
\`,
  contextProviders: [
    threadState(),
    recentMessages({ limit: 20 })
  ]
});
`;
}

async function upsertAgentIndex(path: string, id: ReturnType<typeof normalizeId>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = (await exists(path)) ? await readFile(path, "utf8") : "";
  const variable = componentVar(id, "Agent");
  const importLine = `import { ${variable} } from "./${id.kebab}.agent.js";`;
  const exportLine = `export { ${variable} };`;
  let next = existing.trim();

  if (!next) {
    next = `${importLine}\n\n${exportLine}\n\nexport const agents = [\n  ${variable}\n];`;
  } else {
    if (!next.includes(importLine)) {
      next = `${importLine}\n${next}`;
    }

    if (!next.includes(exportLine)) {
      const exportConstIndex = next.indexOf("export const agents");
      if (exportConstIndex >= 0) {
        next = `${next.slice(0, exportConstIndex).trimEnd()}\n${exportLine}\n\n${next.slice(exportConstIndex)}`;
      } else {
        next = `${next}\n${exportLine}`;
      }
    }

    const agentsMatch = next.match(/export const agents = \[([\s\S]*?)\];/);
    if (agentsMatch) {
      const currentAgents = agentsMatch[1]
        ?.split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.replace(/\n/g, "").trim()) ?? [];
      const allAgents = Array.from(new Set([...currentAgents, variable]));
      next = next.replace(/export const agents = \[[\s\S]*?\];/, `export const agents = [\n  ${allAgents.join(",\n  ")}\n];`);
    } else {
      next = `${next}\n\nexport const agents = [\n  ${variable}\n];`;
    }
  }

  await writeFile(path, `${next.trimEnd()}\n`, "utf8");
}

function toolTemplate(id: ReturnType<typeof normalizeId>): string {
  const variable = componentVar(id, "Tool");
  return `import { defineTool } from "@otakumesi/heph";
import { z } from "zod";

export const ${variable} = defineTool({
  id: "${id.kebab}",
  description: "Describe what this tool does.",
  inputSchema: z.object({
    query: z.string()
  }),
  sideEffect: false,
  async execute(input) {
    return {
      query: input.query,
      result: null
    };
  }
});
`;
}

function contextProviderTemplate(id: ReturnType<typeof normalizeId>): string {
  const variable = componentVar(id, "Context");
  return `import { defineContextProvider } from "@otakumesi/heph";

export const ${variable} = defineContextProvider({
  id: "${id.kebab}",
  async load() {
    return {
      key: "domainContext",
      type: "context_provider",
      content: "Add ${id.raw} context here."
    };
  }
});
`;
}

function contextTemplateTemplate(id: ReturnType<typeof normalizeId>): string {
  const variable = componentVar(id, "Template");
  return `import { defaultContextTemplate, defineContextTemplate } from "@otakumesi/heph";

export const ${variable} = defineContextTemplate({
  ...defaultContextTemplate,
  id: "${id.kebab}",
  version: "0.0.1"
});
`;
}

function componentVar(id: ReturnType<typeof normalizeId>, suffix: "Agent" | "Tool" | "Context" | "Template"): string {
  return id.camel.toLowerCase().endsWith(suffix.toLowerCase()) ? id.camel : `${id.camel}${suffix}`;
}
