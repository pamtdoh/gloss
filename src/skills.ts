import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { toProtocolPath } from "./protocol.js";
// Skill content is embedded at build time; installing is just writing files.
import reviewSkill from "../skills/gloss/SKILL.md" with { type: "text" };
import reviewWritingFacts from "../skills/gloss/references/writing-facts.md" with { type: "text" };
import implementSkill from "../skills/gloss-apply/SKILL.md" with { type: "text" };

// One skill body, two mount points: .claude/skills for Claude Code, or
// .agents/skills for any other harness that can supervise a streaming
// background process (Cursor qualifies).
const DESTINATIONS = {
  claude: ".claude/skills",
  agents: ".agents/skills",
} as const;

export type SkillDest = keyof typeof DESTINATIONS;

// Global installs land in the same directories under $HOME, where the
// harnesses look for skills that apply to every repo.
export function installSkills(cwd: string, agent: SkillDest, global = false): string[] {
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
