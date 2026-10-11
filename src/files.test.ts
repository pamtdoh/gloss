import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { draftDiffers, freezeDraft, listRevisions, notesToDraft, walkFiles } from "./files.js";

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

  test("a round's notes come back to the draft; resolving them makes a new revision", () => {
    put("draft/a.md", "# A\n");
    freezeDraft(review);
    // the round: the server writes notes into the frozen revision
    put("1/a.review.json", '{"items":[{"id":"c1","type":"comment","text":"x"}]}\n');
    put("1/images/notes/p.png", "png");
    notesToDraft(review, 1);
    expect(read("draft/a.review.json")).toContain("c1");
    expect(read("draft/images/notes/p.png")).toBe("png");
    // nothing changed yet: the same revision is served again
    expect(draftDiffers(review)).toBe(false);
    // the agent edits a fact and resolves the note, in place
    put("draft/a.md", "# A, revised\n");
    rmSync(join(review, "draft/a.review.json"));
    expect(draftDiffers(review)).toBe(true);
    expect(freezeDraft(review)).toBe(2);
    expect(read("2/a.md")).toBe("# A, revised\n");
    expect(existsSync(join(review, "2/a.review.json"))).toBe(false);
    expect(read("1/a.md")).toBe("# A\n"); // revision 1 stays as reviewed
  });

  test("notes carried forward go into the new revision and leave the draft", () => {
    put("draft/a.md", "# A\n");
    put("draft/a.review.json", '{"items":[{"id":"q1","type":"question"}]}\n');
    freezeDraft(review);
    expect(read("1/a.review.json")).toContain("q1");
    expect(existsSync(join(review, "draft/a.review.json"))).toBe(false);
  });

  test("a review planted as numbered revisions gets a draft when a round ends", () => {
    put("1/a.md", "# A\n");
    put("1/a.review.json", '{"items":[]}\n');
    notesToDraft(review, 1);
    expect(walkFiles(join(review, "draft"))).toEqual(["a.md", "a.review.json"]);
    expect(statSync(join(review, "draft/a.md")).mode & 0o200).not.toBe(0);
  });
});
