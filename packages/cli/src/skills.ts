import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
// Skill content is embedded at build time; installing is just writing files.
import reviewSkill from "../../../skills/gloss/SKILL.md" with { type: "text" };
import implementSkill from "../../../skills/gloss-apply/SKILL.md" with { type: "text" };

const DESTINATIONS = {
  claude: ".claude/skills",
  codex: ".agents/skills",
} as const;

export type SkillAgent = keyof typeof DESTINATIONS;

export function isSkillAgent(value: string): value is SkillAgent {
  return value in DESTINATIONS;
}

export function installSkills(cwd: string, agent: SkillAgent): string[] {
  const skills: [string, string][] = [
    ["gloss", reviewSkill],
    ["gloss-apply", implementSkill],
  ];
  const installed: string[] = [];
  for (const [name, content] of skills) {
    const dir = join(cwd, DESTINATIONS[agent], name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(path, content);
    installed.push(relative(cwd, path));
  }
  return installed;
}
