import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
// Skill content is embedded at build time; installing is just writing files.
import reviewSkill from "../skills/gloss/SKILL.md" with { type: "text" };
import implementSkill from "../skills/gloss-apply/SKILL.md" with { type: "text" };

const DESTINATIONS = {
  claude: ".claude/skills",
  codex: ".agents/skills",
} as const;

export type SkillAgent = keyof typeof DESTINATIONS;

export function isSkillAgent(value: string): value is SkillAgent {
  return value in DESTINATIONS;
}

// Global installs land in the same directories under $HOME, where both agents
// look for skills that apply to every repo.
export function installSkills(cwd: string, agent: SkillAgent, global = false): string[] {
  const skills: [string, string][] = [
    ["gloss", reviewSkill],
    ["gloss-apply", implementSkill],
  ];
  const root = global ? homedir() : cwd;
  const installed: string[] = [];
  for (const [name, content] of skills) {
    const dir = join(root, DESTINATIONS[agent], name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(path, content);
    // Relative paths in the JSON result are protocol strings like fact
    // paths: "/"-separated on every platform. Absolute --global paths
    // stay native.
    installed.push(global ? path : relative(cwd, path).split(sep).join("/"));
  }
  return installed;
}
