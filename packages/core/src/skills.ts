import type { SkillCatalog, SkillPackage } from "./types.js";

export function createInMemorySkillCatalog(skills: SkillPackage[]): SkillCatalog {
  const byId = new Map<string, SkillPackage>();

  for (const skill of skills) {
    byId.set(skill.id, cloneSkillPackage(skill));
  }

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

function cloneSkillPackage(skill: SkillPackage): SkillPackage {
  return {
    ...skill,
    source: { ...skill.source },
    references: skill.references.map((ref) => ({
      ...ref,
      metadata: { ...ref.metadata }
    })),
    assets: skill.assets.map((ref) => ({
      ...ref,
      metadata: { ...ref.metadata }
    })),
    templates: skill.templates.map((ref) => ({
      ...ref,
      metadata: { ...ref.metadata }
    })),
    metadata: { ...skill.metadata },
    loadedAt: new Date(skill.loadedAt)
  };
}
