import { existsSync } from "node:fs";
import { join } from "node:path";
import { moduleManifestSchema } from "@attentionos/core";
import { describe, expect, it } from "vitest";
import mod from "../src/index.ts";
import { tools as dropshipTools } from "@attentionos/module-dropship";

describe("ops module definition", () => {
  it("has a valid manifest whose schedules match real jobs", () => {
    expect(moduleManifestSchema.parse(mod.manifest).id).toBe("ops");
    const jobIds = mod.jobs.map((j) => j.id);
    for (const id of Object.keys(mod.manifest.schedules)) expect(jobIds).toContain(id);
  });

  it("names tools <module>_<verb>_<noun> and jobs ops.<name>", () => {
    expect(mod.tools.map((t) => t.name)).toEqual([
      "ops_get_morning_brief",
      "ops_list_approvals",
      "ops_decide_approval",
      "ops_send_notification",
      "ops_set_quiet_hours",
      "ops_set_demo_mode",
      "ops_process_chat",
    ]);
    for (const j of mod.jobs) expect(j.id).toMatch(/^ops\.[a-z-]+$/);
  });

  it("ships the skills its LLM jobs use", () => {
    for (const j of mod.jobs) {
      if (j.kind === "llm") expect(existsSync(join(mod.skillsDir!, j.skill, "SKILL.md"))).toBe(true);
    }
  });

  it("only allows MCP tools that exist", () => {
    // knowledge_search comes from the knowledge module, which is core (always on). The dropship tools are there when
    // the opt-in dropship module is on; while it's off the chat simply doesn't see them.
    const names = new Set([
      ...mod.tools.map((t) => `mcp__attentionos__${t.name}`),
      "mcp__attentionos__knowledge_search",
      ...dropshipTools.map((t) => `mcp__attentionos__${t.name}`),
    ]);
    for (const j of mod.jobs) {
      if (j.kind !== "llm") continue;
      for (const t of j.allowedTools.filter((x) => x.startsWith("mcp__"))) expect(names.has(t)).toBe(true);
    }
  });
});
