import { type NoteOp, applyOp } from "../notes.js";
import type { Sidecar } from "../summary.js";
import { readJson, writeJson } from "./common.js";
import type { Fact } from "./model.js";

// The viewer's one source of state (ARCHITECTURE.md). It loads a snapshot,
// then follows the server's event stream: every change anyone makes — this
// tab, another tab, the agent — arrives as an event and lands here. The
// tab's own changes are single operations kept in an outbox until the
// server confirms them, and shown applied on top of the server's copy
// meanwhile. Nothing here polls, and nothing sends a whole sidecar.

export interface Meta {
  review: string;
  version: string;
  seq: number;
  /** the revision under review; null before the agent published one */
  served: number | null;
  round: "open" | "closed";
  approved: number | null;
  /** the agent's status line, e.g. "writing revision 3" */
  status: string | null;
  revisions: number[];
}

/** live: the event stream is open. connecting: it dropped and the
 * browser is retrying. offline: the server is gone — reading from the
 * browser's copy, nothing reaches the agent. */
export type Connection = "live" | "connecting" | "offline";

export interface PendingOp {
  opId: string;
  revision: number;
  path: string;
  op: NoteOp;
}

export interface Notice {
  kind: "published" | "finished" | "approved" | "error" | "stopped";
  text: string;
  revision?: number;
}

export interface State {
  meta: Meta | null;
  /** loaded revisions, sidecars as the server last reported them */
  revisions: Record<number, Fact[]>;
  connection: Connection;
  outbox: PendingOp[];
  notice: Notice | null;
  /** why the server stopped, when it said so */
  stopped: string | null;
  loadError: string | null;
}

type Listener = () => void;

const OFFLINE_AFTER_MS = 3000;
const RETRY_MS = 3000;

export class ReviewStore {
  private state: State = {
    meta: null,
    revisions: {},
    connection: "connecting",
    outbox: [],
    notice: null,
    stopped: null,
    loadError: null,
  };
  private listeners = new Set<Listener>();
  /** per revision:path, the seq of the server state held — an answer or
   * event older than what is held never overwrites it */
  private factSeq = new Map<string, number>();
  private source: EventSource | null = null;
  private offlineTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmed = new Map<string, string>();

  getState = (): State => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ---------- loading ----------

  async start(): Promise<void> {
    try {
      await this.sync();
    } catch (error) {
      this.set({ loadError: String((error as Error).message ?? error) });
      return;
    }
    this.connect();
    void this.prefetchAll();
  }

  /** Fetch the snapshot and every loaded revision afresh. Run at start and
   * whenever the stream comes back after a gap: the files are the record,
   * and anything may have changed them while this tab wasn't listening. */
  private async sync(): Promise<void> {
    const res = await fetch("/api/review");
    if (!res.ok) throw new Error(`the review didn't load (HTTP ${res.status})`);
    const meta = (await res.json()) as Meta;
    const offline = res.headers.get("x-gloss-offline") === "1";
    const lastReview = localStorage.getItem("gloss-last-review");
    if (lastReview && lastReview !== meta.review) {
      // the address now belongs to another review (its old port was
      // reused): nothing queued for the old one may be sent here
      localStorage.removeItem(`gloss-outbox:${lastReview}`);
    }
    localStorage.setItem("gloss-last-review", meta.review);
    const outbox = readJson<PendingOp[]>(`gloss-outbox:${meta.review}`, []);
    const wanted = new Set([
      ...Object.keys(this.state.revisions).map(Number),
      ...(meta.served !== null ? [meta.served] : []),
      ...(meta.revisions.length ? [meta.revisions.at(-1)!] : []),
    ]);
    const revisions: Record<number, Fact[]> = {};
    for (const n of wanted) {
      if (!meta.revisions.includes(n)) continue;
      revisions[n] = await this.fetchRevision(n, meta.seq);
    }
    this.set({ meta, revisions, outbox, connection: offline ? "offline" : this.state.connection });
  }

  private async fetchRevision(n: number, seq: number): Promise<Fact[]> {
    const res = await fetch(`/api/revision/${n}`);
    if (!res.ok) throw new Error(`revision ${n} didn't load (HTTP ${res.status})`);
    const body = (await res.json()) as { facts: Fact[] };
    for (const fact of body.facts) this.factSeq.set(`${n}:${fact.path}`, seq);
    return body.facts;
  }

  /** A revision on demand (the picker, compare). `fresh` re-reads one
   * already held: the files are the record, whatever wrote them since. */
  async loadRevision(n: number, fresh = false): Promise<Fact[]> {
    const held = this.state.revisions[n];
    if (held && !fresh) return held;
    const facts = await this.fetchRevision(n, this.state.meta?.seq ?? 0);
    this.set({ revisions: { ...this.state.revisions, [n]: facts } });
    return facts;
  }

  /** Every revision, in the background: the offline copy should cover
   * the whole review, not only the pages visited. */
  private async prefetchAll(): Promise<void> {
    for (const n of this.state.meta?.revisions ?? []) {
      try {
        await this.loadRevision(n);
      } catch {
        return;
      }
    }
  }

  // ---------- the event stream ----------

  private connect(): void {
    const since = this.state.meta?.seq ?? 0;
    const source = new EventSource(`/api/events?since=${since}`);
    this.source = source;
    let wasDown = false;
    source.onopen = () => {
      if (this.offlineTimer) clearTimeout(this.offlineTimer);
      this.offlineTimer = null;
      const resync = wasDown || this.state.connection === "offline";
      this.set({ connection: "live", stopped: null });
      if (resync) {
        // back after a gap: re-read everything rather than trust that
        // the replayed events cover it
        void this.sync().then(() => this.flush()).catch(() => {});
      } else {
        void this.flush();
      }
    };
    source.onerror = () => {
      wasDown = true;
      if (this.state.connection === "live") this.set({ connection: "connecting" });
      if (!this.offlineTimer) {
        this.offlineTimer = setTimeout(() => {
          this.offlineTimer = null;
          if (this.state.connection !== "live") this.set({ connection: "offline" });
        }, OFFLINE_AFTER_MS);
      }
    };
    source.onmessage = (message) => {
      try {
        this.apply(JSON.parse(message.data));
      } catch {
        // a malformed event is skipped; the next sync covers it
      }
    };
  }

  private apply(event: { seq: number; type: string; [key: string]: any }): void {
    const meta = this.state.meta;
    if (!meta) return;
    if (event.type === "reset") {
      void this.sync();
      return;
    }
    if (event.seq <= meta.seq && event.type !== "server.stopping") return;
    const nextMeta: Meta = { ...meta, seq: Math.max(meta.seq, event.seq) };
    switch (event.type) {
      case "note.changed": {
        this.setSidecar(event.revision, event.path, event.sidecar, event.seq);
        this.set({ meta: nextMeta });
        return;
      }
      case "revision.published": {
        const previous = meta.served;
        nextMeta.served = event.revision;
        nextMeta.round = "open";
        nextMeta.status = null;
        nextMeta.revisions = event.revisions ?? [...new Set([...meta.revisions, event.revision])];
        this.set({ meta: nextMeta });
        void this.loadRevision(event.revision).then(() =>
          this.set({
            notice: {
              kind: "published",
              revision: event.revision,
              text:
                previous !== null && previous !== event.revision
                  ? `Revision ${event.revision} is ready.`
                  : `Revision ${event.revision} is open for review.`,
            },
          }),
        );
        return;
      }
      case "agent.status":
        nextMeta.status = event.text ?? null;
        this.set({ meta: nextMeta });
        return;
      case "round.finished":
        nextMeta.round = "closed";
        this.set({
          meta: nextMeta,
          notice: { kind: "finished", text: "Review finished — the agent is working on the next revision." },
        });
        return;
      case "review.approved":
        nextMeta.round = "closed";
        nextMeta.approved = event.revision;
        this.set({
          meta: nextMeta,
          notice: { kind: "approved", revision: event.revision, text: `Revision ${event.revision} approved.` },
        });
        return;
      case "server.stopping":
        this.set({ meta: nextMeta, stopped: event.reason ?? "stopped" });
        return;
      default:
        this.set({ meta: nextMeta });
    }
  }

  private setSidecar(revision: number, path: string, sidecar: Sidecar | null, seq: number): void {
    const key = `${revision}:${path}`;
    if ((this.factSeq.get(key) ?? -1) >= seq) return;
    const facts = this.state.revisions[revision];
    if (!facts) return;
    this.factSeq.set(key, seq);
    const normalized = sidecar && (sidecar.items ?? []).length > 0 ? sidecar : null;
    this.set({
      revisions: {
        ...this.state.revisions,
        [revision]: facts.map((f) => (f.path === path ? { ...f, sidecar: normalized } : f)),
      },
    });
  }

  // ---------- views ----------

  /** A revision's facts as this tab sees them: the server's sidecars with
   * the tab's own unconfirmed operations applied on top. */
  factsOf(revision: number): Fact[] | null {
    const facts = this.state.revisions[revision];
    if (!facts) return null;
    const pending = this.state.outbox.filter((p) => p.revision === revision);
    if (pending.length === 0) return facts;
    return facts.map((fact) => {
      const ops = pending.filter((p) => p.path === fact.path);
      if (ops.length === 0) return fact;
      let sidecar: Sidecar | undefined = fact.sidecar ?? undefined;
      for (const p of ops) {
        const result = applyOp(sidecar, p.op);
        if (result.ok) sidecar = result.sidecar;
      }
      return { ...fact, sidecar: sidecar && (sidecar.items ?? []).length > 0 ? sidecar : null };
    });
  }

  /** Whether notes can be written on a revision right now. */
  writable(revision: number): boolean {
    const meta = this.state.meta;
    return meta !== null && meta.served === revision && meta.round === "open" && meta.approved === null;
  }

  // ---------- writes ----------

  /** Queue one operation. It shows at once, and is sent when the server
   * is reachable — retried with the same id until it confirms or refuses. */
  send(revision: number, path: string, op: NoteOp): string | null {
    if (!this.writable(revision)) return null;
    const pending: PendingOp = { opId: crypto.randomUUID(), revision, path, op };
    this.saveOutbox([...this.state.outbox, pending]);
    void this.flush();
    return pending.opId;
  }

  /** The id the server gave the note an operation created. */
  idOf(opId: string): string | undefined {
    return this.confirmed.get(opId);
  }

  /** Take back an operation not sent yet. False once it is on its way. */
  cancel(opId: string): boolean {
    const index = this.state.outbox.findIndex((p) => p.opId === opId);
    if (index === -1 || (index === 0 && this.flushing)) return false;
    this.saveOutbox(this.state.outbox.filter((p) => p.opId !== opId));
    return true;
  }

  private saveOutbox(outbox: PendingOp[]): void {
    const review = this.state.meta?.review;
    if (review) writeJson(`gloss-outbox:${review}`, outbox.length ? outbox : null);
    this.set({ outbox });
  }

  /** Send queued operations in order, one at a time: a note's creation
   * must land before its edit. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.state.outbox.length > 0) {
        const next = this.state.outbox[0]!;
        let res: Response;
        try {
          res = await fetch("/api/op", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ opId: next.opId, revision: next.revision, path: next.path, ...next.op }),
          });
        } catch {
          this.scheduleRetry();
          return;
        }
        if (res.status >= 500 || res.headers.get("x-gloss-offline")) {
          this.scheduleRetry();
          return;
        }
        const body = (await res.json().catch(() => null)) as any;
        const rest = this.state.outbox.filter((p) => p.opId !== next.opId);
        if (res.ok && body?.ok) {
          this.confirmed.set(next.opId, body.id);
          this.setSidecar(next.revision, next.path, body.sidecar, body.seq ?? 0);
        } else {
          // the server's verdict (the note is gone, the round is over):
          // no retry can land it
          this.set({ notice: { kind: "error", text: `Not saved: ${body?.error ?? `HTTP ${res.status}`}` } });
        }
        this.saveOutbox(rest);
      }
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, RETRY_MS);
  }

  /** End the round or approve. Both need the server, and every queued
   * operation sent first. */
  async end(action: "finish" | "approve", revision: number): Promise<string | null> {
    await this.flush();
    if (this.state.outbox.length > 0) {
      return `${this.state.outbox.length} change${this.state.outbox.length === 1 ? "" : "s"} not sent yet — the server isn't answering.`;
    }
    try {
      const res = await fetch(`/api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok || !body?.ok) return body?.error ?? `HTTP ${res.status}`;
      return null;
    } catch {
      return "The review server isn't answering.";
    }
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  notify(notice: Notice): void {
    this.set({ notice });
  }
}
