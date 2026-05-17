import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("heph CLI", () => {
  it("initializes an editable Heph app scaffold", async () => {
    const cwd = await tempDir();
    const io = captureIo(cwd);
    const code = await runCli(["init", "my-agent-app"], io);
    const root = join(cwd, "my-agent-app");

    expect(code).toBe(0);
    await expectExists(join(root, "heph.config.ts"));
    await expectExists(join(root, "src/agents/support-agent.agent.ts"));
    await expectExists(join(root, "src/context-templates/default.template.ts"));
    await expectExists(join(root, "migrations/heph/.gitkeep"));
    await expectExists(join(root, "var/.gitkeep"));
    const runtime = await readFile(join(root, "src/runtime.ts"), "utf8");
    const env = await readFile(join(root, ".env.example"), "utf8");
    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    expect(runtime).toContain('import { createSQLiteAdapters } from "@otakumesi/heph/sqlite";');
    expect(env).toContain("HEPH_DATABASE_PATH=./var/heph.db");
    expect(gitignore).toContain("/var/*.db");
    expect(io.stdoutText()).toContain("Initialized Heph app");
  });

  it("adds an agent and updates src/agents/index.ts", async () => {
    const cwd = await tempDir();
    const io = captureIo(cwd);

    expect(await runCli(["init"], io)).toBe(0);
    expect(await runCli(["add", "agent", "billing-agent"], io)).toBe(0);

    const index = await readFile(join(cwd, "src/agents/index.ts"), "utf8");
    expect(index).toContain('import { billingAgent } from "./billing-agent.agent.js";');
    expect(index).toContain("export { billingAgent };");
    expect(index).toContain("billingAgent");
    await expectExists(join(cwd, "src/agents/billing-agent.agent.ts"));
  });

  it("does not scaffold skills in the MVP", async () => {
    const cwd = await tempDir();
    const io = captureIo(cwd);
    const code = await runCli(["add", "skill", "review"], io);

    expect(code).toBe(1);
    expect(io.stderrText()).toContain("HEPH9002");
    expect(io.stderrText()).toContain("heph add skill is not part of the MVP");
  });

  it("inspects rendered context from a config file without executing the run", async () => {
    const cwd = await tempDir();
    const coreUrl = pathToFileURL(resolve(process.cwd(), "../core/src/index.ts")).href;
    const config = `import { defineAgent } from ${JSON.stringify(coreUrl)};

export default {
  agents: [
    defineAgent({
      id: "inspect-agent",
      instructions: "You inspect context."
    })
  ]
};
`;
    await writeFile(join(cwd, "heph.config.ts"), config, "utf8");

    const io = captureIo(cwd);
    const code = await runCli(["inspect", "context", "--agent", "inspect-agent", "--input", "show context", "--format", "json"], io);
    const body = JSON.parse(io.stdoutText());

    expect(code).toBe(0);
    expect(body.messages).toHaveLength(3);
    expect(body.manifest.contextTemplateId).toBe("default");
    expect(body.manifest.blocks.some((block: { key: string }) => block.key === "toolManifest")).toBe(true);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "heph-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function expectExists(path: string): Promise<void> {
  await expect(stat(path)).resolves.toBeTruthy();
}

function captureIo(cwd: string) {
  let stdout = "";
  let stderr = "";

  return {
    cwd,
    stdout: {
      write(chunk: string | Uint8Array) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      write(chunk: string | Uint8Array) {
        stderr += String(chunk);
        return true;
      }
    },
    stdoutText() {
      return stdout;
    },
    stderrText() {
      return stderr;
    }
  };
}
