import * as React from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { tinykeys } from "tinykeys";
import { Check, GitCompareArrows, ListTodo, MessageCircleQuestion, MessageSquare, PanelRightOpen, X } from "lucide-react";
import type { SidecarItem } from "../summary.js";
import { describeAnchor, resolveAnchor } from "./anchor.js";
import { Banners } from "./banners.js";
import { COARSE, readJson, writeJson, type Composer } from "./common.js";
import { ChangeBadge, DirView, SelBubble, rowLabel } from "./components.js";
import { DiffView } from "./compare.js";
import { clearHighlight, paintNotes, rangeForSourceSpan, setHighlight } from "./dom-anchor.js";
import { Drafts, pruneDrafts } from "./drafts.js";
import { Header } from "./header.js";
import { closeLightbox, lightboxOpen, openGallery } from "./lightbox.js";
import { renderMarkdown } from "./markdown.js";
import { useMermaidHtml } from "./mermaid.js";
import {
  type AnchorState,
  type Fact,
  type ReviewData,
  ROOT,
  type Row,
  assetBase,
  buildRows,
  changeStatus,
  contentMap,
  dirOf,
  factStats,
  indexFactOf,
  isRoot,
} from "./model.js";
import { FinishSheet, Help } from "./overlays.js";
import { Panel } from "./panel.js";
import { PanelResizer, TreeResizer } from "./resizers.js";
import { useSelection } from "./selection.js";
import { SHORTCUTS, keyFor } from "./shortcuts.js";
import type { ReviewStore } from "./store.js";
import { useTheme } from "./theme.js";
import { SCOPES, type Scope, TreeColumn } from "./tree.js";
import { Button } from "./ui/button.js";
import { Kbd } from "./ui/kbd.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";

interface Toast {
  message: string;
  undo?: () => void;
  action?: { label: string; run: () => void };
}

// the URL names the page: "#/" the front page, "#dir/" or "#dir/fact.md"
// below it, so back/forward walk visited pages and links survive reloads
function cursorFromHash(facts: Fact[]): Row | null {
  const raw = decodeURI(location.hash.slice(1));
  if (!raw) return null;
  if (raw.endsWith("/")) {
    const path = raw.slice(0, -1);
    if (path === "") return ROOT;
    return facts.some((f) => f.path.startsWith(`${path}/`)) ? { kind: "dir", path, depth: 0 } : null;
  }
  return facts.some((f) => f.path === raw) ? { kind: "fact", path: raw, depth: 0 } : null;
}

// Seen is keyed by fact content (browser-local): a new revision keeps the
// marks of unchanged facts and clears exactly the changed ones.
const seenKey = (review: string) => `rk-seen2:${review}`;

const isMobile = (): boolean => window.matchMedia("(max-width: 860px)").matches;
const panelIsOverlay = (): boolean => window.matchMedia("(max-width: 1100px)").matches;

export function App({ store }: { store: ReviewStore }): React.JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const meta = state.meta;
  const theme = useTheme();

  // ---------- which revision is on screen ----------
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [compareRev, setCompareRev] = useState<number | null>(null);
  const compareMemo = useRef<{ base: number | null; inside: Scope; outside: Scope }>({
    base: null,
    inside: "changed",
    outside: "all",
  });
  useEffect(() => {
    if (meta && viewRev === null) setViewRev(meta.served ?? meta.revisions.at(-1) ?? null);
  }, [meta, viewRev]);

  const facts = useMemo(() => (viewRev === null ? null : store.factsOf(viewRev)), [state, viewRev, store]);
  const previous = useMemo(() => {
    if (!meta || viewRev === null) return null;
    const earlier = meta.revisions.filter((r) => r < viewRev);
    return earlier.length ? earlier.at(-1)! : null;
  }, [meta, viewRev]);
  const prevFacts = useMemo(() => (previous === null ? null : store.factsOf(previous)), [state, previous, store]);
  const compareFacts = useMemo(() => (compareRev === null ? null : store.factsOf(compareRev)), [state, compareRev, store]);
  // revisions the page needs that aren't loaded yet
  useEffect(() => {
    for (const r of [viewRev, previous, compareRev]) {
      if (r !== null && !state.revisions[r]) void store.loadRevision(r).catch(() => {});
    }
  }, [viewRev, previous, compareRev, state.revisions, store]);

  const data: ReviewData | null =
    meta && viewRev !== null && facts
      ? { review: meta.review, revision: viewRev, served: meta.served ?? viewRev, revisions: meta.revisions, facts }
      : null;
  useEffect(() => {
    if (meta) document.title = meta.review;
  }, [meta?.review]);

  // ---------- view state ----------
  const [cursor, setCursor] = useState<Row | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [overlay, setOverlay] = useState<"help" | "finish" | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeRailed, setTreeRailed] = useState(false);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [seenVersion, setSeenVersion] = useState(0);
  const [diffLayout, setDiffLayout] = useState<"rendered" | "unified" | "split">(() => {
    const stored = localStorage.getItem("rk-diff-layout");
    return stored === "unified" || stored === "split" ? stored : "rendered";
  });
  const readRef = useRef<HTMLElement | null>(null);
  const readColRef = useRef<HTMLElement | null>(null);
  const userMoved = useRef(false);
  const autoMarked = useRef(new Set<string>());
  const undoStack = useRef<{ path: string; opId: string; revision: number }[]>([]);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const sel = useSelection({ readRef, composerOpen: () => composerRef.current !== null });

  const closeSheetIfOverlay = (): void => {
    if (panelIsOverlay()) setPanelOpen(false);
  };

  /** Show another revision; everything tied to the old one is dropped. */
  function showRevision(revision: number, compareTo?: number): void {
    setViewRev(revision);
    setComposer(null);
    setFilter("");
    setOpenThreadId(null);
    autoMarked.current.clear();
    if (compareTo !== undefined) {
      compareMemo.current.outside = "all";
      compareMemo.current.base = compareTo;
      setScope(compareMemo.current.inside);
      setCompareRev(compareTo);
    } else {
      setScope("all");
      setCompareRev(null);
    }
  }

  // A published revision is followed: a tab on the revision it replaces
  // moves to it, showing what changed. A tab reading something older
  // stays put and gets a link instead.
  const lastServed = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!meta) return;
    const before = lastServed.current;
    lastServed.current = meta.served;
    if (before === undefined || meta.served === null || before === meta.served) return;
    if (before !== null && viewRev === before) {
      // a diff only reads forward; a re-published older revision is just shown
      if (before < meta.served) {
        showRevision(meta.served, before);
        setToast({ message: `Revision ${meta.served} is ready — showing what changed since ${before}.` });
      } else {
        showRevision(meta.served);
        setToast({ message: `Revision ${meta.served} is under review again.` });
      }
    } else if (viewRev !== meta.served) {
      const target = meta.served;
      setToast({ message: `Revision ${target} is ready.`, action: { label: "Show", run: () => showRevision(target) } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.served]);

  // the store's notices become toasts; round and approval states are
  // banners, not toasts
  useEffect(() => {
    const notice = state.notice;
    if (!notice) return;
    if (notice.kind === "error") setToast({ message: notice.text });
    store.dismissNotice();
  }, [state.notice, store]);

  useEffect(() => {
    if (meta && viewRev !== null) pruneDrafts(meta.review, meta.served ?? viewRev);
  }, [meta?.review, meta?.served, viewRev]);

  // ---------- seen ----------
  const seen = useMemo(() => {
    if (!data) return new Set<string>();
    void seenVersion;
    const marks = readJson<Record<string, string>>(seenKey(data.review), {});
    return new Set(data.facts.filter((f) => marks[f.path] === f.content).map((f) => f.path));
  }, [data?.facts, data?.review, seenVersion]);
  function setSeen(fact: Fact, on: boolean): void {
    if (!data) return;
    const marks = readJson<Record<string, string>>(seenKey(data.review), {});
    if (on) marks[fact.path] = fact.content;
    else delete marks[fact.path];
    writeJson(seenKey(data.review), marks);
    setSeenVersion((v) => v + 1);
  }

  // ---------- derived ----------
  const compareOn = compareRev !== null && compareFacts !== null;
  const writable = viewRev !== null && !compareOn && store.writable(viewRev);
  const readOnly = !writable;
  const basisFacts = compareOn ? compareFacts : prevFacts;
  const basisRevision = compareOn ? compareRev : previous;
  const baseMap = useMemo(() => (basisFacts ? contentMap(basisFacts) : null), [basisFacts]);
  const ghosts = useMemo(() => {
    if (!baseMap || !data) return [];
    const live = new Set(data.facts.map((f) => f.path));
    return [...baseMap.entries()]
      .filter(([path]) => !live.has(path))
      .map(([path, content]): Fact => ({ path, content, sidecar: null, ghost: true }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [baseMap, data?.facts]);
  const factMap = useMemo(() => new Map([...(data?.facts ?? []), ...ghosts].map((f) => [f.path, f])), [data?.facts, ghosts]);
  const changedFacts = useMemo(
    () => (data?.facts ?? []).filter((f) => changeStatus(baseMap, f) !== undefined),
    [data?.facts, baseMap],
  );
  const raisedFacts = useMemo(() => (data?.facts ?? []).filter((f) => (f.sidecar?.items?.length ?? 0) > 0), [data?.facts]);
  const counts = { all: data?.facts.length ?? 0, changed: changedFacts.length + ghosts.length, raised: raisedFacts.length };
  const scopedFacts = useMemo(() => {
    if (scope === "changed") return [...changedFacts, ...ghosts].sort((a, b) => a.path.localeCompare(b.path));
    if (scope === "raised") return raisedFacts;
    return data?.facts ?? [];
  }, [data?.facts, scope, changedFacts, raisedFacts, ghosts]);
  const filteredFacts = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return scopedFacts;
    return scopedFacts.filter((fact) => {
      const notes = (fact.sidecar?.items ?? [])
        .map((i) => `${i.text ?? ""} ${(i.thread ?? []).map((t) => t.text).join(" ")}`)
        .join(" ");
      const text = `${fact.path} ${fact.content} ${notes}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [scopedFacts, filter]);
  const filtering = filter.trim().length > 0;
  const narrowing = filtering || scope !== "all";
  const withRoot = data !== null && (!narrowing || filteredFacts.some((f) => f.path === "_index.md"));
  const rows = useMemo(
    () => buildRows(filteredFacts, (dir) => (narrowing ? true : !collapsed.has(dir)), withRoot),
    [filteredFacts, collapsed, narrowing, withRoot],
  );
  const effectiveCursor: Row | null = cursor ?? rows[0] ?? null;
  const cursorIndex = rows.findIndex((r) => r.kind === effectiveCursor?.kind && r.path === effectiveCursor?.path);
  const targetFact: Fact | null = useMemo(() => {
    if (!data || !effectiveCursor) return null;
    if (effectiveCursor.kind === "fact") return factMap.get(effectiveCursor.path) ?? null;
    return indexFactOf(data.facts, effectiveCursor.path);
  }, [data?.facts, effectiveCursor, factMap]);
  const targetIsGhost = targetFact?.ghost === true;
  const questions = useMemo(() => {
    let total = 0;
    let answered = 0;
    for (const fact of data?.facts ?? []) {
      const stats = factStats(fact);
      total += stats.questions;
      answered += stats.answered;
    }
    return { total, answered };
  }, [data?.facts]);
  const progress = { seen: seen.size, total: data?.facts.length ?? 0 };
  // the notes on screen: the base revision's while comparing (they were
  // raised on that text), the viewed fact's otherwise
  const notesFact: Fact | null = compareOn
    ? (compareFacts!.find((f) => f.path === targetFact?.path) ?? null)
    : targetIsGhost
      ? null
      : targetFact;
  const panelBadge = notesFact ? factStats(notesFact).items : 0;
  const drafts = data ? new Drafts(data.review, data.served) : null;

  // a deep link lands on its page once the facts are in
  const landed = useRef(false);
  useEffect(() => {
    if (!data || landed.current) return;
    landed.current = true;
    setCursor(cursorFromHash(data.facts));
  }, [data]);

  // cursor followers: keep the row on screen, reset the reading scroll
  useEffect(() => {
    if (!effectiveCursor) return;
    document.getElementById(`row-${effectiveCursor.kind}-${effectiveCursor.path}`)?.scrollIntoView({ block: "nearest" });
    if (readColRef.current) readColRef.current.scrollTop = 0;
  }, [effectiveCursor?.kind, effectiveCursor?.path]);

  // cursor -> URL (a history entry per page reached); URL -> cursor
  useEffect(() => {
    if (!effectiveCursor || !landed.current) return;
    const target = `#${encodeURI(effectiveCursor.path)}${effectiveCursor.kind === "dir" ? "/" : ""}`;
    if (location.hash === target) return;
    if (userMoved.current) history.pushState(null, "", target);
    else history.replaceState(null, "", target);
  }, [effectiveCursor?.kind, effectiveCursor?.path]);
  const factsRef = useRef<Fact[]>([]);
  factsRef.current = data?.facts ?? [];
  useEffect(() => {
    const onPop = (): void => setCursor(cursorFromHash(factsRef.current));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // a composer, a selection, and an open thread belong to their fact
  useEffect(() => {
    if (composer && composer.path !== targetFact?.path) setComposer(null);
    sel.setPending((p) => (p && p.path !== targetFact?.path ? null : p));
    sel.setLive((s) => (s && s.path !== targetFact?.path ? null : s));
    if (sel.lastSpan.current && sel.lastSpan.current.path !== targetFact?.path) sel.lastSpan.current = null;
    setOpenThreadId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path]);

  // a thread whose note is gone (deleted elsewhere, renumbered by the
  // server) closes instead of showing nothing
  useEffect(() => {
    if (openThreadId && notesFact && !notesFact.sidecar?.items?.some((i) => i.id === openThreadId)) setOpenThreadId(null);
  }, [openThreadId, notesFact]);

  // ---------- drafts: a box's text comes back where it was left ----------
  const composerCanShow = drafts !== null && targetFact !== null && !targetIsGhost && !readOnly && openThreadId === null;
  useEffect(() => {
    const fact = targetFact;
    if (!drafts || !fact || !composerCanShow) return;
    if (composer && composer.path === fact.path) return;
    const draft = drafts.noteFor(fact.path, fact.sidecar?.items ?? []);
    if (!draft) return;
    setComposer(draft);
    if (draft.mode !== "new") return;
    const span = draft.anchor ? resolveAnchor(fact.content, draft.anchor) : null;
    if (span) sel.setPending({ path: fact.path, start: span.start, end: span.end });
    else if (!COARSE) sel.setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path, composerCanShow]);

  const litItemId = openThreadId ?? focusItemId;

  // seen on dwell, once the reader has navigated; waits out a selection
  useEffect(() => {
    const fact = targetFact;
    if (!fact || !data || !userMoved.current || targetIsGhost || compareOn) return;
    if (seen.has(fact.path) || autoMarked.current.has(fact.path)) return;
    let timer: ReturnType<typeof setTimeout>;
    const fire = (): void => {
      if (sel.busy()) {
        timer = setTimeout(fire, 1500);
        return;
      }
      autoMarked.current.add(fact.path);
      setSeen(fact, true);
    };
    timer = setTimeout(fire, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path, data?.facts, seen, compareOn]);

  // ---------- compare ----------
  async function startCompare(base: number): Promise<void> {
    if (viewRev === null || base >= viewRev) return;
    try {
      await store.loadRevision(base, true);
    } catch {
      setToast({ message: `Couldn't load revision ${base}.` });
      return;
    }
    if (compareRev === null) {
      compareMemo.current.outside = scope;
      setScope(compareMemo.current.inside);
    }
    compareMemo.current.base = base;
    setCompareRev(base);
    setComposer(null);
    setOpenThreadId(null);
    sel.clear();
  }
  function exitCompare(): void {
    compareMemo.current.inside = scope;
    setScope(compareMemo.current.outside);
    setCompareRev(null);
    setOpenThreadId(null);
  }
  function toggleCompare(): void {
    if (viewRev === null) return;
    if (compareRev !== null) return exitCompare();
    if (previous === null) {
      setToast({ message: "Nothing to compare — this is the first revision." });
      return;
    }
    const remembered = compareMemo.current.base;
    void startCompare(remembered !== null && remembered < viewRev && meta?.revisions.includes(remembered) ? remembered : previous);
  }

  // ---------- writes: one operation each, through the store ----------
  function beginItem(type: SidecarItem["type"]): void {
    if (!targetFact || targetIsGhost || readOnly) return;
    const span = sel.current(targetFact.path);
    const anchor = span ? describeAnchor(targetFact.content, span.start, span.end) : undefined;
    // desktop: the span becomes the composer's draft anchor, painted
    if (!COARSE) sel.setPending(span ? { path: targetFact.path, start: span.start, end: span.end } : null);
    if (drafts) {
      const prior = drafts.get(targetFact.path, { mode: "new" });
      if (prior?.mode === "new") drafts.set({ ...prior, type, anchor });
    }
    setOpenThreadId(null);
    setComposer({ mode: "new", type, path: targetFact.path, anchor });
    setPanelOpen(true);
  }
  function dropComposer(): void {
    setComposer(null);
    if (!COARSE) {
      sel.setPending(null);
      sel.setLive(null);
    }
  }
  function cancelComposer(): void {
    if (composer) drafts?.delete(composer.path, composer);
    dropComposer();
    closeSheetIfOverlay();
  }
  function commitComposer(text: string): void {
    const active = composer;
    if (!active || !text.trim() || viewRev === null) return cancelComposer();
    const body = text.trim();
    drafts?.delete(active.path, active);
    sel.clear();
    if (active.mode === "new") {
      const opId = store.send(viewRev, active.path, { op: "create", type: active.type, text: body, anchor: active.anchor });
      if (opId && active.type !== "question") undoStack.current.push({ path: active.path, opId, revision: viewRev });
    } else {
      store.send(viewRev, active.path, { op: "edit", id: active.id, text: body });
    }
    setComposer(null);
    closeSheetIfOverlay();
  }
  function openThread(id: string | null): void {
    if (id !== null && composer) dropComposer();
    setOpenThreadId(id);
  }
  function submitReply(id: string, text: string): void {
    const body = text.trim();
    if (!targetFact || targetIsGhost || readOnly || !body || viewRev === null) return;
    drafts?.delete(targetFact.path, { mode: "reply", id });
    store.send(viewRev, targetFact.path, { op: "reply", id, text: body });
  }
  function deleteItem(path: string, id: string): void {
    const item = data?.facts.find((f) => f.path === path)?.sidecar?.items?.find((i) => i.id === id);
    if (!item || viewRev === null) return;
    const revision = viewRev;
    const copy = structuredClone(item);
    store.send(revision, path, { op: "delete", id });
    setToast({
      message: `Deleted ${id}`,
      undo: () => {
        store.send(revision, path, { op: "restore", item: copy });
        setToast(null);
      },
    });
  }
  function undoLast(): void {
    const last = undoStack.current.pop();
    if (!last || !store.writable(last.revision)) return;
    if (store.cancel(last.opId)) return;
    const id = store.idOf(last.opId);
    if (id) store.send(last.revision, last.path, { op: "delete", id });
  }
  function reanchor(path: string, id: string): void {
    const fact = data?.facts.find((f) => f.path === path);
    const span = sel.lastSpan.current;
    if (!fact || !span || span.path !== path || viewRev === null) {
      setToast({ message: "Select the new text in the fact first, then re-anchor." });
      return;
    }
    store.send(viewRev, path, { op: "anchor", id, anchor: describeAnchor(fact.content, span.start, span.end) });
  }

  // ---------- navigation ----------
  function moveCursor(delta: number): void {
    if (!rows.length) return;
    userMoved.current = true;
    const index = cursorIndex === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, cursorIndex + delta));
    setCursor(rows[index]!);
  }
  function moveCursorWhere(predicate: (fact: Fact) => boolean, direction: 1 | -1): void {
    if (!data || !rows.length) return;
    userMoved.current = true;
    const from = cursorIndex === -1 ? 0 : cursorIndex;
    for (let step = 1; step <= rows.length; step++) {
      const row = rows[(from + direction * step + rows.length * step) % rows.length]!;
      const fact = row.kind === "fact" ? data.facts.find((f) => f.path === row.path) : indexFactOf(data.facts, row.path);
      if (fact && predicate(fact)) return setCursor(row);
    }
  }
  function openRow(row: Row): void {
    userMoved.current = true;
    setCursor(row);
    if (row.kind === "fact" && isMobile()) setTreeOpen(false);
  }
  function toggleSeen(advance: boolean): void {
    if (!targetFact || targetIsGhost || compareOn) return;
    if (seen.has(targetFact.path) && !advance) setSeen(targetFact, false);
    else setSeen(targetFact, true);
    if (advance) moveCursorWhere((f) => !seen.has(f.path) && f.path !== targetFact.path, 1);
  }

  async function end(action: "finish" | "approve"): Promise<void> {
    if (viewRev === null) return;
    const error = await store.end(action, viewRev);
    if (error) return setToast({ message: `${action === "finish" ? "Finish" : "Approve"} failed: ${error}` });
    setOverlay(null);
  }

  // ---------- keyboard, from the SHORTCUTS table ----------
  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    next: () => moveCursor(1),
    prev: () => moveCursor(-1),
    nextItems: () => moveCursorWhere((f) => factStats(f).items > 0, 1),
    prevItems: () => moveCursorWhere((f) => factStats(f).items > 0, -1),
    nextQuestion: () => moveCursorWhere((f) => factStats(f).questions > 0, 1),
    prevQuestion: () => moveCursorWhere((f) => factStats(f).questions > 0, -1),
    expand: () => {
      const c = effectiveCursor;
      if (c?.kind === "dir" && !isRoot(c)) setCollapsed((s) => new Set([...s].filter((d) => d !== c.path)));
    },
    collapse: () => {
      const c = effectiveCursor;
      if (c?.kind === "dir" && !isRoot(c)) setCollapsed((s) => new Set(s).add(c.path));
    },
    seen: () => toggleSeen(false),
    seenAdvance: () => toggleSeen(true),
    comment: () => beginItem("comment"),
    question: () => beginItem("question"),
    undo: () => undoLast(),
    help: () => setOverlay((o) => (o === "help" ? null : "help")),
    filter: () => document.getElementById("tree-filter")?.focus(),
    scope: () =>
      setScope((s) => {
        const order = SCOPES.filter((x) => x !== "changed" || baseMap !== null);
        return order[(order.indexOf(s) + 1) % order.length] ?? "all";
      }),
    compare: toggleCompare,
    close: () => {
      if (lightboxOpen()) closeLightbox();
      else if (composer) cancelComposer();
      else if (overlay) setOverlay(null);
      else if (sel.pending || sel.live) {
        sel.clear();
        window.getSelection()?.removeAllRanges();
      } else if (openThreadId) openThread(null);
      else if (compareOn) exitCompare();
    },
  };
  useEffect(() => {
    const run = (id: string): void => actions.current[id]?.();
    const handlers: Record<string, (e: KeyboardEvent) => void> = {};
    for (const def of SHORTCUTS) {
      for (const key of def.keys) {
        handlers[key] = def.raw
          ? (e) => {
              if (e.defaultPrevented) return;
              e.preventDefault();
              run(def.id);
            }
          : (e) => {
              const target = e.target as HTMLElement | null;
              if (e.isComposing || e.defaultPrevented) return;
              if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
              if (e.repeat && !def.allowRepeat) return;
              e.preventDefault();
              run(def.id);
            };
      }
    }
    return tinykeys(window, handlers, { ignore: (e: KeyboardEvent) => e.isComposing });
  }, []);

  // ---------- the fact: rendering and highlights ----------
  useEffect(() => closeLightbox(), [targetFact?.path]);
  const factHtml = useMemo(() => {
    if (!targetFact || viewRev === null) return "";
    // a ghost's images live in the revision it was deleted from
    const revision = targetFact.ghost ? (basisRevision ?? viewRev) : viewRev;
    return renderMarkdown(targetFact.content, { assetBase: assetBase(revision), factDir: dirOf(targetFact.path) });
  }, [targetFact?.content, targetFact?.path, targetFact?.ghost, viewRev, basisRevision]);
  const factHtmls = useMemo(() => [factHtml], [factHtml]);
  const factHtmlProp = useMermaidHtml(factHtmls)[0]!;
  const anchorStates = useMemo(() => {
    const states = new Map<string, AnchorState>();
    for (const item of notesFact?.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(notesFact!.content, item.anchor);
      states.set(item.id, resolved ? resolved.state : "detached");
    }
    return states;
  }, [notesFact]);
  useEffect(() => {
    const pane = readRef.current;
    if (!pane || !notesFact) return;
    const clearNotes = paintNotes(notesFact.sidecar?.items ?? [], litItemId, (anchor) => {
      const resolved = resolveAnchor(notesFact.content, anchor);
      const range = resolved && rangeForSourceSpan(pane, resolved.start, resolved.end);
      return range ? [range] : [];
    });
    // fine pointers: the native selection is the highlight while it is
    // live; the pending span paints once a composer owns the screen
    const pending =
      sel.pending && sel.pending.path === notesFact.path && (COARSE || composer)
        ? rangeForSourceSpan(pane, sel.pending.start, sel.pending.end)
        : null;
    setHighlight("rk-pending", pending ? [pending] : []);
    return () => {
      clearNotes();
      clearHighlight("rk-pending");
    };
    // keyed on factHtmlProp: the mermaid splice rewrites the DOM the
    // highlight ranges point into
  }, [factHtmlProp, notesFact, litItemId, sel.pending, composer, compareOn]);

  // toasts dismiss themselves, unless hovered
  const toastHover = useRef(false);
  useEffect(() => {
    if (!toast) return;
    const timer = setInterval(() => {
      if (!toastHover.current) {
        clearInterval(timer);
        setToast(null);
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [toast]);

  if (state.loadError) {
    return (
      <div className="done-screen" id="load-error">
        <div>
          The review couldn't be loaded: {state.loadError}. If its server has stopped and this browser never opened it,
          there is no saved copy to show.
        </div>
      </div>
    );
  }
  if (!meta || !data || viewRev === null) return <div className="app" />;

  const targetStatus = targetFact ? changeStatus(baseMap, targetFact) : undefined;
  const factArticle = targetFact && (
    <article
      className="fact-body"
      id="fact-content"
      data-gallery=""
      data-fact-path={targetFact.path}
      ref={readRef as React.RefObject<HTMLElement>}
      dangerouslySetInnerHTML={factHtmlProp}
    />
  );
  const factPane: React.ReactNode = !targetFact ? null : !compareOn ? (
    factArticle
  ) : targetStatus === undefined ? (
    <>
      <div className="unchanged-note" id="unchanged-note" role="status">
        Unchanged since revision {compareRev}.
      </div>
      {factArticle}
    </>
  ) : (
    <DiffView
      before={baseMap?.get(targetFact.path) ?? ""}
      after={targetFact.ghost ? "" : targetFact.content}
      layout={diffLayout}
      baseAsset={assetBase(compareRev!)}
      headAsset={assetBase(viewRev)}
      factDir={dirOf(targetFact.path)}
      notes={notesFact?.sidecar?.items}
      litId={litItemId}
    />
  );
  const canFinish = store.writable(viewRev) && state.connection !== "offline";

  return (
    <div className="app" onClick={(e) => openGallery(e.target as Element)}>
      <Header
        review={meta.review}
        progress={progress}
        position={{ index: cursorIndex, count: rows.length }}
        questions={questions}
        status={meta.round === "closed" && meta.approved === null ? null : meta.status}
        revision={viewRev}
        revisions={meta.revisions}
        served={meta.served}
        canCompare={previous !== null}
        compareOn={compareOn}
        canFinish={canFinish}
        pending={state.outbox.length}
        dark={theme.dark}
        onTree={() => {
          setTreeRailed(false);
          setTreeOpen((open) => !open);
        }}
        onQuestions={() => moveCursorWhere((f) => factStats(f).questions > 0, 1)}
        onHelp={() => setOverlay((o) => (o === "help" ? null : "help"))}
        onTheme={theme.toggle}
        onCompare={toggleCompare}
        onRevision={(r) => showRevision(r)}
        onFinish={() => setOverlay("finish")}
      />
      <Banners
        meta={meta}
        connection={state.connection}
        stopped={state.stopped}
        pending={state.outbox.length}
        viewRevision={viewRev}
        onSwitch={(r) => showRevision(r)}
      />
      {compareOn && (
        <div className="compare-bar" id="compare-bar">
          <GitCompareArrows className="lucide size-3.5" size={14} aria-hidden="true" />
          <span className="sr-only" role="status">
            Comparing revision {compareRev} to revision {viewRev} — read-only
          </span>
          <span className="compare-label">
            Changes from revision
            <Select value={String(compareRev)} onValueChange={(value) => void startCompare(Number(value))}>
              <SelectTrigger size="sm" id="compare-base" aria-label="Compare base revision" className="compare-base-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meta.revisions
                  .filter((r) => r < viewRev)
                  .map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            to {viewRev} — read-only
          </span>
          <span className="layout-toggle" role="group" aria-label="Diff layout">
            {(["rendered", "unified", "split"] as const).map((layout) => (
              <button
                key={layout}
                id={`diff-${layout}`}
                aria-pressed={diffLayout === layout}
                className={diffLayout === layout ? "on" : ""}
                onClick={() => {
                  setDiffLayout(layout);
                  localStorage.setItem("rk-diff-layout", layout);
                }}
              >
                {layout === "rendered" ? "Rendered" : layout === "unified" ? "Unified" : "Split"}
              </button>
            ))}
          </span>
          <span className="flex-1" />
          <button className="compare-exit" id="compare-exit" onClick={exitCompare}>
            Exit compare
          </button>
          {!COARSE && <Kbd title="Toggle compare">{keyFor("compare")}</Kbd>}
        </div>
      )}

      <div className="cols">
        {treeOpen && <div className="scrim" onClick={() => setTreeOpen(false)} />}
        <TreeColumn
          data={data}
          rows={rows}
          factMap={factMap}
          baseMap={baseMap}
          basisRevision={basisRevision}
          seen={seen}
          collapsed={collapsed}
          cursor={effectiveCursor}
          filter={filter}
          scope={scope}
          counts={counts}
          matches={filteredFacts.length}
          progress={progress}
          drawerOpen={treeOpen}
          railed={treeRailed}
          onFilter={setFilter}
          onScope={setScope}
          onOpen={openRow}
          onToggle={(dir) =>
            setCollapsed((c) => {
              const next = new Set(c);
              if (next.has(dir)) next.delete(dir);
              else next.add(dir);
              return next;
            })
          }
          onRail={setTreeRailed}
        />
        {!treeRailed && <TreeResizer />}

        <main className="read-col" ref={readColRef as React.RefObject<HTMLElement>}>
          <div className="read-inner">
            {effectiveCursor?.kind === "dir" ? (
              <DirView
                dir={effectiveCursor.path}
                data={data}
                facts={filteredFacts}
                prev={baseMap}
                seen={seen}
                indexBody={factPane}
                onOpen={openRow}
              />
            ) : targetFact ? (
              <>
                <div className="crumb">
                  <span>{targetFact.path}</span>
                  <ChangeBadge status={targetStatus} />
                  {seen.has(targetFact.path) && <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />}
                </div>
                {targetIsGhost && !compareOn && (
                  <div className="ghost-banner" id="ghost-banner" role="status">
                    Removed in revision {viewRev} — shown as it was in revision {basisRevision}. Read-only.
                  </div>
                )}
                {factPane}
              </>
            ) : (
              <p className="text-muted-foreground">{filtering ? `Nothing matches “${filter.trim()}”.` : "No facts."}</p>
            )}
            {cursorIndex !== -1 && rows.length > 1 && (
              <nav className="pagenav" aria-label="Previous and next fact">
                <button id="nav-prev" className="pagenav-link prev" disabled={cursorIndex <= 0} onClick={() => moveCursor(-1)}>
                  <span className="pagenav-dir">← Previous</span>
                  <span className="pagenav-label">{cursorIndex > 0 ? rowLabel(rows[cursorIndex - 1]!) : ""}</span>
                </button>
                <button
                  id="nav-next"
                  className="pagenav-link next"
                  disabled={cursorIndex >= rows.length - 1}
                  onClick={() => moveCursor(1)}
                >
                  <span className="pagenav-dir">Next →</span>
                  <span className="pagenav-label">{cursorIndex < rows.length - 1 ? rowLabel(rows[cursorIndex + 1]!) : ""}</span>
                </button>
              </nav>
            )}
          </div>
        </main>

        {!panelOpen && !sel.pending && (
          <button className="panel-fab" id="panel-fab" aria-label="Open review panel" onClick={() => setPanelOpen(true)}>
            <ListTodo className="lucide size-4" size={16} />
            Notes
            {panelBadge > 0 && <span className="chip count">{panelBadge}</span>}
          </button>
        )}
        {panelOpen && <PanelResizer />}
        {panelOpen ? (
          <aside className="panel-col panel" aria-label="Review panel">
            <Panel
              fact={notesFact}
              ghost={targetIsGhost}
              root={effectiveCursor !== null && isRoot(effectiveCursor)}
              revision={compareOn ? compareRev! : viewRev}
              anchorStates={anchorStates}
              composer={composer}
              openThreadId={openThreadId}
              readonly={readOnly}
              drafts={readOnly ? null : drafts}
              onOpenThread={openThread}
              onReplySubmit={submitReply}
              onBegin={beginItem}
              onFocusItem={setFocusItemId}
              onEdit={(item) =>
                targetFact &&
                setComposer({
                  mode: "edit",
                  path: targetFact.path,
                  id: item.id,
                  initial: item.type === "question" ? (item.thread?.[0]?.text ?? "") : (item.text ?? ""),
                })
              }
              onDelete={(id) => targetFact && deleteItem(targetFact.path, id)}
              onReanchor={(id) => targetFact && reanchor(targetFact.path, id)}
              onCollapse={() => setPanelOpen(false)}
              onCommit={commitComposer}
              onCancel={cancelComposer}
              canCompare={previous !== null}
            />
          </aside>
        ) : (
          <aside className="panel-col rail">
            <Button variant="ghost" size="icon-sm" aria-label="Open review panel" onClick={() => setPanelOpen(true)}>
              <PanelRightOpen />
            </Button>
            {panelBadge > 0 && <div className="chip count mt-2">{panelBadge}</div>}
          </aside>
        )}
      </div>

      {COARSE
        ? sel.pending &&
          targetFact &&
          !readOnly &&
          sel.pending.path === targetFact.path &&
          !composer && (
            <div className="sel-bar" id="sel-bar" role="toolbar" aria-label="Selected text actions">
              <span className="sel-bar-quote">“{targetFact.content.slice(sel.pending.start, sel.pending.end)}”</span>
              <Button size="sm" onClick={() => beginItem("comment")}>
                <MessageSquare className="lucide size-3.5" size={14} aria-hidden="true" />
                Comment
              </Button>
              <Button size="sm" variant="outline" onClick={() => beginItem("question")}>
                <MessageCircleQuestion className="lucide size-3.5" size={14} aria-hidden="true" />
                Ask
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Dismiss selection" onClick={() => sel.clear()}>
                <X />
              </Button>
            </div>
          )
        : sel.live &&
          targetFact &&
          !readOnly &&
          sel.live.path === targetFact.path &&
          !composer && (
            <SelBubble
              span={sel.live}
              quote={targetFact.content.slice(sel.live.start, sel.live.end)}
              readRef={readRef}
              onAct={beginItem}
            />
          )}

      <Help open={overlay === "help"} onClose={() => setOverlay(null)} />
      <FinishSheet
        open={overlay === "finish"}
        data={data}
        progress={progress}
        openQuestions={questions.total}
        raisedFacts={raisedFacts}
        drafts={overlay === "finish" && drafts ? drafts.count(data.facts) : 0}
        onFinish={() => void end("finish")}
        onApprove={() => void end("approve")}
        onClose={() => setOverlay(null)}
      />

      {toast && (
        <div
          className="toast"
          id="toast"
          role="status"
          aria-live="polite"
          onMouseEnter={() => (toastHover.current = true)}
          onMouseLeave={() => (toastHover.current = false)}
        >
          <span>{toast.message}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="lucide size-3.5" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
