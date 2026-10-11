import { beforeEach, expect, test } from "bun:test";
import type { Fact } from "./model.js";
import type { Meta } from "./store.js";

// The store against a scripted server: fetch answers are controlled per
// test (some held open to stage a race), and the event stream is a fake
// the test drives.

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class FakeEventSource {
  static last: FakeEventSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  send(event: object): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  close(): void {}
}

type Handler = (body: any) => Response | Promise<Response>;
let routes: Record<string, Handler>;
const calls: string[] = [];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = () => {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const g = globalThis as any;
g.localStorage = new MemoryStorage();
g.EventSource = FakeEventSource;
g.fetch = async (url: string, init?: { body?: string }) => {
  const path = new URL(url, "http://x").pathname;
  calls.push(path);
  const handler = routes[path];
  if (!handler) return json({ ok: false }, 404);
  return handler(init?.body ? JSON.parse(init.body) : undefined);
};

const { ReviewStore } = await import("./store.js");

const meta = (patch: Partial<Meta> = {}): Meta => ({
  review: "r",
  version: "t",
  seq: 40,
  served: 1,
  round: "open",
  approved: null,
  status: null,
  revisions: [1],
  ...patch,
});
const fact = (sidecar: Fact["sidecar"]): Fact[] => [{ path: "a.md", content: "# A\n", sidecar }];

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  calls.length = 0;
  routes = {
    "/api/review": () => json(meta()),
    "/api/revision/1": () => json({ facts: fact(null) }),
  };
});

test("finishing waits for a note still on its way, instead of blaming the server", async () => {
  const store = new ReviewStore();
  await store.start();
  const op = deferred();
  routes["/api/op"] = () => op.promise;
  routes["/api/finish"] = () => json({ ok: true });
  store.send(1, "a.md", { op: "create", type: "comment", text: "x" });
  await tick(); // the op is in flight
  const ended = store.end("finish", 1);
  await tick();
  expect(calls).not.toContain("/api/finish"); // not before the op lands
  op.resolve(json({ ok: true, id: "c1", seq: 41, sidecar: { items: [{ id: "c1", type: "comment", text: "x" }] } }));
  expect(await ended).toBeNull();
  expect(calls.at(-1)).toBe("/api/finish");
});

test("a revision served again is re-read: notes resolved in the draft don't come back", async () => {
  routes["/api/revision/1"] = () => json({ facts: fact({ items: [{ id: "c1", type: "comment", text: "x" }] }) });
  routes["/api/review"] = () => json(meta({ round: "closed" }));
  const store = new ReviewStore();
  await store.start();
  expect(store.factsOf(1)![0]!.sidecar?.items).toHaveLength(1);
  // the agent resolved c1 in the draft (no event), then served 1 again
  routes["/api/revision/1"] = () => json({ facts: fact(null) });
  FakeEventSource.last.send({ seq: 41, type: "revision.published", revision: 1, revisions: [1] });
  await tick();
  await tick();
  expect(store.factsOf(1)![0]!.sidecar).toBeNull();
  expect(store.getState().meta!.round).toBe("open");
});

test("an event arriving during a resync is applied on top of it, not lost", async () => {
  const store = new ReviewStore();
  await store.start();
  const source = FakeEventSource.last;
  source.onopen!();
  await tick();
  // the stream drops and comes back: a resync starts reading
  const revision = deferred();
  routes["/api/revision/1"] = () => revision.promise;
  source.onerror!();
  source.onopen!();
  await tick();
  // while it reads, the human finishes in another tab
  source.send({ seq: 41, type: "round.finished", revision: 1, summary: {} });
  revision.resolve(json({ facts: fact(null) }));
  await tick();
  await tick();
  expect(store.getState().meta).toMatchObject({ seq: 41, round: "closed" });
});
