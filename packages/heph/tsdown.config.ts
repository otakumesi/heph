import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    core: "src/core.ts",
    hono: "src/hono.ts",
    mcp: "src/mcp.ts",
    sqlite: "src/sqlite.ts",
    skills: "src/skills-entry.ts",
    worker: "src/worker.ts"
  },
  deps: {
    alwaysBundle: ["@heph/cli", "@heph/core", "@heph/server-hono", "@heph/sqlite", "@heph/worker"]
  },
  format: ["esm"],
  dts: true,
  clean: true
});
