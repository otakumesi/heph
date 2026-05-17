import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillCatalog, localSkillCatalog } from "../src/skills.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("localSkillCatalog", () => {
  it("loads local SKILL.md packages into an immutable catalog", async () => {
    const root = await tempDir();
    const skillDir = join(root, "pr-review");
    await mkdir(join(skillDir, "references"), { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: pr-review
description: Use this skill for pull request review.
version: 0.1.0
---

# PR Review

Inspect changed files and prioritize correctness.
`,
      "utf8"
    );
    await writeFile(join(skillDir, "references", "checklist.md"), "Checklist", "utf8");

    const catalog = localSkillCatalog({ rootDir: root });
    const namespaceCatalog = SkillCatalog.local({ rootDir: root });
    const skill = await catalog.getSkill("pr-review");
    const namespaceSkill = await namespaceCatalog.getSkill("pr-review");

    expect(skill).toMatchObject({
      id: "pr-review",
      name: "pr-review",
      description: "Use this skill for pull request review.",
      version: "0.1.0",
      source: {
        type: "local",
        pathOrRef: skillDir
      }
    });
    expect(namespaceSkill?.id).toBe("pr-review");
    expect(skill?.instructions).toContain("Inspect changed files");
    expect(skill?.references[0]).toMatchObject({
      id: "checklist.md",
      metadata: {
        kind: "references"
      }
    });
  });

  it("fails closed when a skill package contains scripts", async () => {
    const root = await tempDir();
    const skillDir = join(root, "unsafe");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: unsafe
description: Unsafe package.
---

Do not load.
`,
      "utf8"
    );

    expect(() => localSkillCatalog({ rootDir: root })).toThrow(expect.objectContaining({ code: "HEPH8001" }));
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "heph-skills-"));
  tempDirs.push(dir);
  return dir;
}
