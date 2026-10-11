import { expect, test } from "bun:test";
import { agentLabel, commitLabel, tildePath } from "./about.js";

test("commits read short, with uncommitted changes marked", () => {
  expect(commitLabel({ commit: "ba7b06828e275064d3a8f10ed7280fee909be36b" })).toBe("ba7b068");
  expect(commitLabel({ commit: "ba7b068abc", dirty: true })).toBe("ba7b068 + uncommitted");
  expect(commitLabel({})).toBeNull();
});

test("paths under the home read as ~/…", () => {
  expect(tildePath("/home/me/src/myapp", "/home/me")).toBe("~/src/myapp");
  expect(tildePath("/home/me", "/home/me/")).toBe("~");
  expect(tildePath("/home/meadow/x", "/home/me")).toBe("/home/meadow/x");
  expect(tildePath("C:\\Users\\me\\src", "C:\\Users\\me")).toBe("~\\src");
  expect(tildePath("/srv/x", undefined)).toBe("/srv/x");
});

test("agent identifiers read as names", () => {
  expect(agentLabel("claude-code_2-1-296_agent")).toBe("Claude Code 2.1.296");
  expect(agentLabel("claude-code")).toBe("Claude Code");
  expect(agentLabel("cursor-agent 1.4")).toBe("cursor-agent 1.4");
});
