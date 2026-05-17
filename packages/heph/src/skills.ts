import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HephError } from "@heph/core";
import type { SkillCatalog as SkillCatalogType, SkillPackage, SkillResourceRef } from "@heph/core";

export interface LocalSkillCatalogOptions {
  rootDir: string;
}

export function localSkillCatalog(options: LocalSkillCatalogOptions): SkillCatalogType {
  const skills = loadLocalSkills(options.rootDir);
  const byId = new Map(skills.map((skill) => [skill.id, cloneSkillPackage(skill)]));

  return {
    async getSkill(id) {
      const skill = byId.get(id);
      return skill ? cloneSkillPackage(skill) : null;
    },
    async listSkills() {
      return Array.from(byId.values())
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(cloneSkillPackage);
    }
  };
}

export const SkillCatalog = {
  local: localSkillCatalog
};

function loadLocalSkills(rootDir: string): SkillPackage[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkillDirectory(rootDir, entry.name));
}

function loadSkillDirectory(rootDir: string, directoryName: string): SkillPackage {
  const skillDir = join(rootDir, directoryName);
  const scriptDir = join(skillDir, "scripts");

  if (existsSync(scriptDir) && statSync(scriptDir).isDirectory()) {
    throw new HephError({
      code: "HEPH8001",
      title: "Skill scripts are not allowed",
      message: `Skill package ${directoryName} contains a scripts/ directory, which Heph does not load or execute.`,
      status: 422,
      details: {
        skill: directoryName,
        path: scriptDir
      }
    });
  }

  const skillFile = join(skillDir, "SKILL.md");

  if (!existsSync(skillFile)) {
    throw invalidSkillPackage(directoryName, "Skill package must contain SKILL.md.", { path: skillFile });
  }

  const parsed = parseSkillMarkdown(directoryName, readFileSync(skillFile, "utf8"));

  return {
    id: parsed.name,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    instructions: parsed.body.trim(),
    source: {
      type: "local",
      pathOrRef: skillDir
    },
    references: listResourceRefs(join(skillDir, "references"), "references"),
    assets: listResourceRefs(join(skillDir, "assets"), "assets"),
    templates: listResourceRefs(join(skillDir, "templates"), "templates"),
    metadata: parsed.metadata,
    loadedAt: new Date()
  };
}

function parseSkillMarkdown(
  directoryName: string,
  content: string
): {
  name: string;
  description: string;
  version: string | null;
  metadata: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---\n")) {
    throw invalidSkillPackage(directoryName, "SKILL.md must start with frontmatter.");
  }

  const end = content.indexOf("\n---", 4);

  if (end === -1) {
    throw invalidSkillPackage(directoryName, "SKILL.md frontmatter is not closed.");
  }

  const frontmatter = content.slice(4, end).trim();
  const body = content.slice(end + "\n---".length).trim();
  const values: Record<string, string> = {};

  // Heph intentionally parses only the narrow Skill frontmatter subset it owns:
  // name, description, and optional version. Skill packages are instruction
  // bundles, not arbitrary YAML documents. Add a YAML dependency only if the
  // public Skill manifest contract grows beyond this subset.
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const separator = line.indexOf(":");

    if (separator === -1) {
      throw invalidSkillPackage(directoryName, "Skill frontmatter supports only simple key: value lines.");
    }

    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());

    if (!key) {
      throw invalidSkillPackage(directoryName, "Skill frontmatter contains an empty key.");
    }

    values[key] = value;
  }

  const name = values.name;
  const description = values.description;

  if (!name) {
    throw invalidSkillPackage(directoryName, "Skill frontmatter must include name.");
  }

  if (!description) {
    throw invalidSkillPackage(directoryName, "Skill frontmatter must include description.");
  }

  const { version, ...metadata } = Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== "name" && key !== "description")
  );

  return {
    name,
    description,
    version: version || null,
    metadata,
    body
  };
}

function listResourceRefs(directory: string, kind: "references" | "assets" | "templates"): SkillResourceRef[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      id: entry.name,
      pathOrRef: join(directory, entry.name),
      contentType: null,
      metadata: {
        kind
      }
    }));
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function invalidSkillPackage(skill: string, message: string, details: Record<string, unknown> = {}): HephError {
  return new HephError({
    code: "HEPH8002",
    title: "Invalid skill package",
    message,
    status: 422,
    details: {
      skill,
      ...details
    }
  });
}

function cloneSkillPackage(skill: SkillPackage): SkillPackage {
  return {
    ...skill,
    source: { ...skill.source },
    references: skill.references.map(cloneResourceRef),
    assets: skill.assets.map(cloneResourceRef),
    templates: skill.templates.map(cloneResourceRef),
    metadata: { ...skill.metadata },
    loadedAt: new Date(skill.loadedAt)
  };
}

function cloneResourceRef(ref: SkillResourceRef): SkillResourceRef {
  return {
    ...ref,
    metadata: { ...ref.metadata }
  };
}
