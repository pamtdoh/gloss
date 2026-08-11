import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { toProtocolPath } from "./protocol.js";
// Skill content is embedded at build time; installing is just writing files.
import reviewSkill from "../skills/gloss/SKILL.md" with { type: "text" };
import reviewWritingFacts from "../skills/gloss/references/writing-facts.md" with { type: "text" };
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
  const skills: [string, [string, string][]][] = [
    [
      "gloss",
      [
        ["SKILL.md", reviewSkill],
        ["references/writing-facts.md", reviewWritingFacts],
      ],
    ],
    ["gloss-apply", [["SKILL.md", implementSkill]]],
  ];
  const root = global ? homedir() : cwd;
  const installed: string[] = [];
  for (const [name, files] of skills) {
    for (const [rel, content] of files) {
      const path = join(root, DESTINATIONS[agent], name, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      // Absolute --global paths stay native; they name a real location.
      installed.push(global ? path : toProtocolPath(relative(cwd, path)));
    }
  }
  return installed;
}
