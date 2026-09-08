// Unsent text survives in the browser: a note being typed, or a thread
// reply, filed by review, revision, fact, and the box it was typed in.
// Only the served revision accepts notes, so only it can hold a draft;
// the store for any other revision is pruned on load. Drafts never touch
// the files — they are the human's own work in progress, not review
// state — and, like the seen marks, they live in localStorage: per
// origin, which is per session while the port is ephemeral. That is the
// lifetime that matters: a stray back button, a tree click, or a reload
// mid-sentence no longer loses the sentence.
import type { SidecarItem } from "../summary.js";
import { readJson, writeJson, type Composer } from "./common.js";
import type { Fact } from "./model.js";

/** a reply being typed in a thread — the third box, beside the two a
 * composer can be; `initial` is the text, as in the composer */
export type ReplyDraft = { mode: "reply"; path: string; id: string; initial: string };
/** a draft is the box's own state, kept: the composer as it stands, or
 * the reply in the making */
export type Draft = Composer | ReplyDraft;
/** which box on a fact a draft is filed under: the one new-note
 * composer, or the edit or reply box of one item — a composer or a
 * draft names its own slot */
export type Slot = { mode: "new" } | { mode: "edit" | "reply"; id: string };

const slotOf = (slot: Slot): string => (slot.mode === "new" ? "new" : `${slot.mode}:${slot.id}`);
type Store = Record<string, Record<string, Draft>>; // fact path -> slot -> draft
const PREFIX = "rk-drafts:";
const keyFor = (review: string, revision: number): string => `${PREFIX}${review}:${revision}`;

/** the drafts of one revision of one review */
export class Drafts {
  private readonly key: string;
  constructor(review: string, revision: number) {
    this.key = keyFor(review, revision);
  }
  private read(): Store {
    return readJson<Store>(this.key, {});
  }
  private write(store: Store): void {
    writeJson(this.key, Object.keys(store).length ? store : null);
  }

  get(path: string, slot: Slot): Draft | undefined {
    return this.read()[path]?.[slotOf(slot)];
  }

  /** blank text is no draft: the slot is cleared instead of kept */
  set(draft: Draft): void {
    if (!draft.initial?.trim()) {
      this.delete(draft.path, draft);
      return;
    }
    const store = this.read();
    (store[draft.path] ??= {})[slotOf(draft)] = draft;
    this.write(store);
  }

  delete(path: string, slot: Slot): void {
    const store = this.read();
    const slots = store[path];
    const key = slotOf(slot);
    if (!slots?.[key]) return;
    delete slots[key];
    if (Object.keys(slots).length === 0) delete store[path];
    this.write(store);
  }

  /** the composer a fact should come back with: the new note first,
   * else an edit whose item is still there */
  noteFor(path: string, items: SidecarItem[]): Composer | undefined {
    const slots = this.read()[path];
    if (!slots) return undefined;
    const fresh = slots["new"];
    if (fresh?.mode === "new") return fresh;
    for (const draft of Object.values(slots)) {
      if (draft.mode === "edit" && items.some((i) => i.id === draft.id)) return draft;
    }
    return undefined;
  }

  /** how many boxes hold unsent text. A draft on an item that is gone
   * does not exist — and is back if the deletion is undone — so the
   * rule is applied here, on read, not by every writer that deletes. */
  count(facts: Fact[]): number {
    let n = 0;
    for (const [path, slots] of Object.entries(this.read())) {
      const fact = facts.find((f) => f.path === path);
      if (!fact) continue;
      const items = fact.sidecar?.items ?? [];
      for (const draft of Object.values(slots)) {
        if (draft.mode === "new" || items.some((i) => i.id === draft.id)) n++;
      }
    }
    return n;
  }
}

/** every revision's store but the served one goes: its notes are
 * read-only now, so nothing typed for it can be posted */
export function pruneDrafts(review: string, served: number): void {
  const keep = keyFor(review, served);
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${PREFIX}${review}:`) && key !== keep) localStorage.removeItem(key);
  }
}
