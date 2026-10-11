import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glossHome, groupBy, readConfig, saveViewerPrefs, viewerPrefs } from "./home.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gloss-home-"));
  process.env.GLOSS_HOME = join(home, "g");
});
afterEach(() => {
  delete process.env.GLOSS_HOME;
  rmSync(home, { recursive: true, force: true });
});

test("the home is created private, where GLOSS_HOME points", () => {
  expect(glossHome()).toBe(join(home, "g"));
  expect(statSync(join(home, "g")).mode & 0o077).toBe(0);
});

test("a missing or malformed config is the defaults", () => {
  expect(readConfig()).toEqual({});
  expect(groupBy()).toBe("repo");
  writeFileSync(join(glossHome(), "config.json"), "{ not json");
  expect(readConfig()).toEqual({});
});

test("viewer preferences are saved alongside the user's own settings", () => {
  writeFileSync(join(glossHome(), "config.json"), JSON.stringify({ groupReviewsBy: "remote", note: "mine" }));
  expect(saveViewerPrefs({ theme: "dark", panelWidth: 380 })).toEqual({ theme: "dark", panelWidth: 380 });
  const saved = JSON.parse(readFileSync(join(home, "g/config.json"), "utf8"));
  expect(saved).toEqual({ groupReviewsBy: "remote", note: "mine", theme: "dark", panelWidth: 380 });
  expect(groupBy()).toBe("remote");
  // null resets a preference to its default
  expect(saveViewerPrefs({ theme: null })).toEqual({ panelWidth: 380 });
});

test("unknown preferences and bad values are refused", () => {
  expect(saveViewerPrefs({ groupReviewsBy: "checkout" })).toBe("unknown preference: groupReviewsBy");
  expect(saveViewerPrefs({ theme: "pink" })).toBe("bad value for theme");
  expect(saveViewerPrefs({ treeWidth: 5 })).toBe("bad value for treeWidth");
  expect(viewerPrefs({ theme: "pink" as never, diffLayout: "split" })).toEqual({ diffLayout: "split" });
});
