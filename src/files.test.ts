import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { draftDiffers, ensureDraft, escapesDir, freezeDraft, listRevisions, resolveFact, snapshotNotes, walkFiles } from "./files.js";

let review: string;
const put = (path: string, text: string) => {
  mkdirSync(dirname(join(review, path)), { recursive: true });
  writeFileSync(join(review, path), text);
};
const read = (path: string) => readFileSync(join(review, path), "utf8");

beforeEach(() => {
  review = mkdtempSync(join(tmpdir(), "gloss-files-"));
});
afterEach(() => rmSync(review, { recursive: true, force: true }));

describe("the draft and its frozen revisions", () => {
  test("a draft with no facts has nothing to freeze", () => {
    mkdirSync(join(review, "draft"));
    expect(draftDiffers(review)).toBe(false);
  });

  test("freezing copies the draft to the next number, read-only, and keeps the draft", () => {
    put("draft/_index.md", "# Overview\n");
    put("draft/storage/files.md", "# Files\n");
    expect(draftDiffers(review)).toBe(true);
    expect(freezeDraft(review)).toBe(1);
    expect(listRevisions(review)).toEqual([1]);
    expect(walkFiles(join(review, "1"))).toEqual(["_index.md", "storage/files.md"]);
    expect(statSync(join(review, "1/_index.md")).mode & 0o222).toBe(0);
    // the agent's paths are untouched: it edits them in place next round
    expect(read("draft/storage/files.md")).toBe("# Files\n");
    expect(draftDiffers(review)).toBe(false);
  });

  test("notes live in the draft; a revision gets their copy when its round ends", () => {
    put("draft/a.md", "# A\n");
    freezeDraft(review);
    // the round: the server writes notes into the draft
    put("draft/a.review.json", '{"items":[{"id":"c1","type":"comment","text":"x"}]}\n');
    put("draft/images/notes/p.png", "png");
    expect(existsSync(join(review, "1/a.review.json"))).toBe(false);
    snapshotNotes(review, 1);
    expect(read("1/a.review.json")).toContain("c1");
    expect(read("1/images/notes/p.png")).toBe("png");
    expect(read("draft/a.review.json")).toContain("c1"); // the draft keeps them
    // resolving notes alone is no new revision
    rmSync(join(review, "draft/a.review.json"));
    expect(draftDiffers(review)).toBe(false);
    // a changed fact is; the new revision takes facts only
    put("draft/a.md", "# A, revised\n");
    expect(draftDiffers(review)).toBe(true);
    expect(freezeDraft(review)).toBe(2);
    expect(walkFiles(join(review, "2"))).toEqual(["a.md"]);
    expect(read("1/a.md")).toBe("# A\n"); // revision 1 stays as reviewed
    expect(read("1/a.review.json")).toContain("c1"); // with its notes
  });

  test("a revision's snapshot is replaced, not merged, when its round ends again", () => {
    put("draft/a.md", "# A\n");
    freezeDraft(review);
    put("draft/a.review.json", '{"items":[{"id":"c1","type":"comment","text":"x"}]}\n');
    snapshotNotes(review, 1);
    rmSync(join(review, "draft/a.review.json"));
    snapshotNotes(review, 1);
    expect(existsSync(join(review, "1/a.review.json"))).toBe(false);
  });

  test("a review planted as numbered revisions gets a writable draft, notes included", () => {
    put("1/a.md", "# A\n");
    put("1/a.review.json", '{"items":[]}\n');
    ensureDraft(review);
    expect(walkFiles(join(review, "draft"))).toEqual(["a.md", "a.review.json"]);
    expect(statSync(join(review, "draft/a.md")).mode & 0o200).not.toBe(0);
    expect(draftDiffers(review)).toBe(false);
  });
});

test("a path escapes a revision by '..' segments, not by a name starting with two dots", () => {
  expect(escapesDir("/r/1", "/r/1/..notes.md")).toBe(false);
  expect(escapesDir("/r/1", "/r/1/dir/..x.md")).toBe(false);
  expect(escapesDir("/r/1", "/r/2/a.md")).toBe(true);
  expect(escapesDir("/r/1", "/r")).toBe(true);
  expect(escapesDir("/r/1", "/r/1")).toBe(true);
  put("1/..notes.md", "# Dots\n");
  expect(resolveFact(join(review, "1"), "..notes.md")).toBe("..notes.md");
  expect(resolveFact(join(review, "1"), "../1/..notes.md")).toBe("..notes.md");
  expect(resolveFact(join(review, "1"), "../draft/a.md")).toBeNull();
});
