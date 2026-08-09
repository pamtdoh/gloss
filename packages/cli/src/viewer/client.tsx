import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { tinykeys } from "tinykeys";
import { DropdownMenu as DM } from "radix-ui";
import {
  Check,
  ChevronRight,
  CircleHelp,
  MessageCircleQuestion,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import type { Decision, Sidecar, SidecarItem } from "../summary.js";
import { describeAnchor, resolveAnchor, type Anchor } from "./anchor.js";
import { rangeForSourceSpan, sourceSpanForSelection } from "./dom-anchor.js";
import { renderMarkdown } from "./markdown.js";
import {
  answeredByAgent,
  buildRows,
  changeStatus,
  childDirsOf,
  childFactsOf,
  dirOf,
  dirStats,
  factStats,
  indexFactOf,
  nameOf,
  nextId,
  normalizeSidecar,
  titleOf,
  type Fact,
  type ReviewData,
  type Row,
} from "./model.js";
import { SHORTCUTS } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import { Checkbox } from "./ui/checkbox.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.js";
import { Input } from "./ui/input.js";
import { Kbd } from "./ui/kbd.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
import { Textarea } from "./ui/textarea.js";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.js";

// theme: system preference -> .dark class (utilities target it)
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (): void => {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
};
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const DECISIONS: { d: Decision; key: string; label: string }[] = [
  { d: "not-needed", key: "1", label: "Not needed" },
  { d: "simplify", key: "2", label: "Simplify" },
  { d: "defer", key: "3", label: "Defer" },
];

type Composer =
  | { mode: "new"; type: SidecarItem["type"]; path: string; anchor?: Anchor }
  | { mode: "edit"; path: string; id: string; initial: string }
  | { mode: "reply"; path: string; id: string };

interface ToastState {
  message: string;
  undo?: () => void;
}

const POLL_DISABLED = new URLSearchParams(location.search).get("poll") === "0";

// Dialogs restore focus on close; if that would land in a text field, the
// single-key shortcuts die silently — drop the restore instead.
function keepFocusOutOfFields(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable]")) {
    event.preventDefault();
    target.blur();
  }
}

async function fetchReview(snapshot?: number): Promise<ReviewData> {
  const res = await fetch("/api/review" + (snapshot ? `?snapshot=${snapshot}` : ""));
  if (!res.ok) throw new Error(`review fetch failed: ${res.status}`);
  return res.json();
}

// Seen is keyed by fact CONTENT per review (browser-local): an iterated
// snapshot keeps its seen marks for unchanged facts and clears them exactly
// where the text changed — GitHub's "Viewed" semantic.
function seenStore(review: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`rk-seen2:${review}`) ?? "{}");
  } catch {
    return {};
  }
}

function writeSeenStore(review: string, store: Record<string, string>): void {
  localStorage.setItem(`rk-seen2:${review}`, JSON.stringify(store));
}

function App(): React.JSX.Element {
  const [data, setData] = useState<ReviewData | null>(null);
  const [prev, setPrev] = useState<Map<string, string> | null>(null);
  const [cursor, setCursor] = useState<Row | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [seenVersion, setSeenVersion] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [overlay, setOverlay] = useState<"help" | "palette" | "finish" | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selHint, setSelHint] = useState<{ x: number; y: number } | null>(null);

  const pendingWrites = useRef(new Map<string, number>());
  const readRef = useRef<HTMLElement | null>(null);
  const readColRef = useRef<HTMLElement | null>(null);
  const lastSpan = useRef<{ path: string; start: number; end: number } | null>(null);
  const userMoved = useRef(false);
  const autoMarked = useRef(new Set<string>());
  const undoStack = useRef<{ path: string; id: string }[]>([]);
  const stateRef = useRef<{ data: ReviewData | null; composer: Composer | null; done: boolean }>({
    data: null,
    composer: null,
    done: false,
  });
  stateRef.current = { data, composer, done: done !== null };

  // ---------- data ----------
  async function load(snapshot?: number): Promise<void> {
    const next = await fetchReview(snapshot);
    const prior = next.snapshots.filter((s) => s < next.snapshot).pop();
    setPrev(
      prior === undefined
        ? null
        : new Map((await fetchReview(prior)).facts.map((f) => [f.path, f.content])),
    );
    setData(next);
    setCursor(null);
    setSelection(new Set());
    setComposer(null);
    setFilter("");
    autoMarked.current.clear();
  }
  useEffect(() => {
    void load();
  }, []);

  // ---------- seen (content-keyed) ----------
  const seen = useMemo(() => {
    if (!data) return new Set<string>();
    void seenVersion;
    const store = seenStore(data.review);
    return new Set(data.facts.filter((f) => store[f.path] === f.content).map((f) => f.path));
  }, [data, seenVersion]);

  function markSeen(fact: Fact): void {
    if (!data) return;
    const store = seenStore(data.review);
    store[fact.path] = fact.content;
    writeSeenStore(data.review, store);
    setSeenVersion((v) => v + 1);
  }

  function unmarkSeen(path: string): void {
    if (!data) return;
    const store = seenStore(data.review);
    delete store[path];
    writeSeenStore(data.review, store);
    setSeenVersion((v) => v + 1);
  }

  // ---------- polling (live Q&A) ----------
  useEffect(() => {
    if (POLL_DISABLED) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async (): Promise<void> => {
      if (stop) return;
      const st = stateRef.current;
      const busy =
        document.hidden ||
        st.done ||
        st.composer !== null ||
        !(window.getSelection()?.isCollapsed ?? true);
      if (!busy && st.data) {
        try {
          const fresh = await fetchReview(st.data.snapshot);
          const now = Date.now();
          for (const fact of fresh.facts) {
            // recent local writes win over poll data (covers the GET-in-flight race)
            const writtenAt = pendingWrites.current.get(fact.path);
            if (writtenAt !== undefined && now - writtenAt < 2500) {
              const local = st.data.facts.find((f) => f.path === fact.path);
              if (local) fact.sidecar = local.sidecar;
            }
          }
          if (JSON.stringify(fresh) !== JSON.stringify(stateRef.current.data)) {
            setData(fresh);
          }
        } catch {
          // session ending
        }
      }
      timer = setTimeout(() => void tick(), 2000);
    };
    timer = setTimeout(() => void tick(), 2000);
    const onVisible = (): void => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ---------- selection affordance (mouse path + stored span for a/q) ----------
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onSelection = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const container = readRef.current;
        if (
          sel &&
          !sel.isCollapsed &&
          container &&
          container.contains(sel.anchorNode) &&
          stateRef.current.data
        ) {
          const span = sourceSpanForSelection(container as HTMLElement, sel);
          const path = container.getAttribute("data-fact-path");
          if (span && path) lastSpan.current = { path, ...span };
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          setSelHint({ x: rect.left + rect.width / 2, y: rect.top });
        } else {
          setSelHint(null);
        }
      }, 30);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  // ---------- derived ----------
  const filteredFacts = useMemo(() => {
    const facts = data?.facts ?? [];
    const query = filter.trim().toLowerCase();
    if (!query) return facts;
    const words = query.split(/\s+/);
    return facts.filter((fact) => {
      const items = fact.sidecar?.items ?? [];
      const itemText = items
        .map((i) => `${i.text ?? ""} ${(i.thread ?? []).map((t) => t.text).join(" ")}`)
        .join(" ");
      const text = `${fact.path} ${fact.content} ${itemText}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [data, filter]);
  const filtering = filter.trim().length > 0;
  const rows = useMemo(
    () => buildRows(filteredFacts, (dir) => (filtering ? true : !collapsed.has(dir))),
    [filteredFacts, collapsed, filtering],
  );
  const effectiveCursor: Row | null = cursor ?? rows[0] ?? null;
  const cursorIndex = rows.findIndex(
    (r) => r.kind === effectiveCursor?.kind && r.path === effectiveCursor?.path,
  );

  const targetFact: Fact | null = useMemo(() => {
    if (!data || !effectiveCursor) return null;
    if (effectiveCursor.kind === "fact") {
      return data.facts.find((f) => f.path === effectiveCursor.path) ?? null;
    }
    return indexFactOf(data.facts, effectiveCursor.path);
  }, [data, effectiveCursor]);

  const openQuestions = useMemo(() => {
    let total = 0;
    let answered = 0;
    for (const fact of data?.facts ?? []) {
      const stats = factStats(fact);
      total += stats.questions;
      answered += stats.answered;
    }
    return { total, answered };
  }, [data]);

  const progress = {
    seen: seen.size,
    total: data?.facts.length ?? 0,
  };

  // cursor followers: keep the row on screen, reset reading scroll
  useEffect(() => {
    if (!effectiveCursor) return;
    document
      .getElementById(`row-${effectiveCursor.kind}-${effectiveCursor.path}`)
      ?.scrollIntoView({ block: "nearest" });
    if (readColRef.current) readColRef.current.scrollTop = 0;
  }, [effectiveCursor?.kind, effectiveCursor?.path]);

  // a composer belongs to the fact it was opened on
  useEffect(() => {
    if (composer && composer.path !== targetFact?.path) setComposer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path]);

  // auto-seen on dwell, only after the user has actually navigated
  useEffect(() => {
    const fact = targetFact;
    if (!fact || !data || !userMoved.current) return;
    if (seen.has(fact.path) || autoMarked.current.has(fact.path)) return;
    const timer = setTimeout(() => {
      autoMarked.current.add(fact.path);
      markSeen(fact);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path, data, seen]);

  // ---------- sidecar writes ----------
  function putSidecar(fact: Fact): void {
    if (!data) return;
    pendingWrites.current.set(fact.path, Date.now());
    void fetch("/api/sidecar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot: data.snapshot,
        path: fact.path,
        sidecar: fact.sidecar ?? {},
      }),
    }).then(() => pendingWrites.current.set(fact.path, Date.now()));
  }

  function mutateFact(path: string, fn: (sidecar: Sidecar) => void): void {
    setData((current) => {
      if (!current) return current;
      const facts = current.facts.map((fact) => {
        if (fact.path !== path) return fact;
        const sidecar: Sidecar = structuredClone(fact.sidecar ?? {});
        fn(sidecar);
        const next = { ...fact, sidecar: normalizeSidecar(sidecar) };
        putSidecar(next);
        return next;
      });
      return { ...current, facts };
    });
  }

  function decide(decision: Decision | null): void {
    if (!data) return;
    const bulk = selection.size > 0;
    const targets = bulk ? [...selection] : targetFact ? [targetFact.path] : [];
    if (!targets.length) return;
    const before = new Map(
      targets.map((p) => [p, data.facts.find((f) => f.path === p)?.sidecar?.decision]),
    );
    for (const path of targets) {
      mutateFact(path, (sidecar) => {
        const next = bulk ? decision : sidecar.decision === decision ? null : decision;
        if (next) sidecar.decision = next;
        else delete sidecar.decision;
      });
    }
    if (bulk) {
      setSelection(new Set());
      setToast({
        message: decision
          ? `Marked ${targets.length} facts ${decision}`
          : `Cleared ${targets.length} decisions`,
        undo: () => {
          for (const [path, priorDecision] of before) {
            mutateFact(path, (sidecar) => {
              if (priorDecision) sidecar.decision = priorDecision;
              else delete sidecar.decision;
            });
          }
          setToast(null);
        },
      });
    }
  }

  function beginItem(type: SidecarItem["type"]): void {
    if (!targetFact) return;
    let anchor: Anchor | undefined;
    if (type !== "comment") {
      // live selection first; fall back to the last captured span (the
      // click that opened a menu may already have collapsed the selection)
      const sel = window.getSelection();
      const container = readRef.current;
      let span: { start: number; end: number } | null = null;
      if (sel && !sel.isCollapsed && container && container.contains(sel.anchorNode)) {
        span = sourceSpanForSelection(container as HTMLElement, sel);
      }
      if (!span && lastSpan.current?.path === targetFact.path) span = lastSpan.current;
      if (span) anchor = describeAnchor(targetFact.content, span.start, span.end);
    }
    setComposer({ mode: "new", type, path: targetFact.path, anchor });
    setSelHint(null);
  }

  function commitComposer(text: string): void {
    const active = composer;
    if (!active || !text.trim()) {
      setComposer(null);
      return;
    }
    const body = text.trim();
    if (active.mode === "new") {
      mutateFact(active.path, (sidecar) => {
        const items = (sidecar.items ??= []);
        const id = nextId(items, active.type[0]!);
        const item: SidecarItem = { id, type: active.type };
        if (active.anchor) item.anchor = active.anchor;
        if (active.type === "question") item.thread = [{ who: "human", text: body }];
        else item.text = body;
        items.push(item);
        if (active.type !== "question") undoStack.current.push({ path: active.path, id });
      });
    } else if (active.mode === "edit") {
      mutateFact(active.path, (sidecar) => {
        const item = sidecar.items?.find((i) => i.id === active.id);
        if (!item) return;
        if (item.type === "question" && item.thread?.length) item.thread[0]!.text = body;
        else item.text = body;
      });
    } else {
      mutateFact(active.path, (sidecar) => {
        const item = sidecar.items?.find((i) => i.id === active.id);
        if (item) (item.thread ??= []).push({ who: "human", text: body });
      });
    }
    setComposer(null);
  }

  function deleteItem(path: string, id: string): void {
    const item = data?.facts
      .find((f) => f.path === path)
      ?.sidecar?.items?.find((i) => i.id === id);
    if (!item) return;
    const snapshot = structuredClone(item);
    mutateFact(path, (sidecar) => {
      sidecar.items = sidecar.items?.filter((i) => i.id !== id);
    });
    setToast({
      message: `Deleted ${id}`,
      undo: () => {
        mutateFact(path, (sidecar) => (sidecar.items ??= []).push(snapshot));
        setToast(null);
      },
    });
  }

  function undoLast(): void {
    const last = undoStack.current.pop();
    if (last) {
      mutateFact(last.path, (sidecar) => {
        sidecar.items = sidecar.items?.filter((i) => i.id !== last.id);
      });
    }
  }

  function reanchor(path: string, id: string): void {
    const fact = data?.facts.find((f) => f.path === path);
    if (!fact || lastSpan.current?.path !== path) {
      setToast({ message: "Select the new text in the fact first, then re-anchor." });
      return;
    }
    const anchor = describeAnchor(fact.content, lastSpan.current.start, lastSpan.current.end);
    mutateFact(path, (sidecar) => {
      const item = sidecar.items?.find((i) => i.id === id);
      if (item) item.anchor = anchor;
    });
  }

  function moveCursor(delta: number): void {
    if (!rows.length) return;
    userMoved.current = true;
    const index =
      cursorIndex === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, cursorIndex + delta));
    setCursor(rows[index]!);
  }

  function moveCursorWhere(predicate: (fact: Fact) => boolean, direction: 1 | -1): void {
    if (!data || !rows.length) return;
    userMoved.current = true;
    const from = cursorIndex === -1 ? 0 : cursorIndex;
    for (let step = 1; step <= rows.length; step++) {
      const index = (from + direction * step + rows.length * step) % rows.length;
      const row = rows[index]!;
      if (row.kind !== "fact") continue;
      const fact = data.facts.find((f) => f.path === row.path);
      if (fact && predicate(fact)) {
        setCursor(row);
        return;
      }
    }
  }

  function openRow(row: Row): void {
    userMoved.current = true;
    setCursor(row);
  }

  function toggleSeen(advance: boolean): void {
    if (!targetFact) return;
    if (seen.has(targetFact.path) && !advance) unmarkSeen(targetFact.path);
    else markSeen(targetFact);
    if (advance) moveCursorWhere((f) => !seen.has(f.path) && f.path !== targetFact.path, 1);
  }

  function toggleSelect(path?: string): void {
    const target = path ?? (effectiveCursor?.kind === "fact" ? effectiveCursor.path : null);
    if (!target) return;
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }

  async function finish(): Promise<void> {
    try {
      await fetch("/api/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: data?.snapshot }),
      });
    } catch {
      /* server exits as it answers */
    }
    setDone("Review finished. The agent has been notified — you can close this tab.");
  }

  async function approve(): Promise<void> {
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: data?.snapshot }),
      });
      if (!res.ok) {
        setToast({ message: `Approve failed: ${(await res.json()).error}` });
        return;
      }
    } catch {
      /* as above */
    }
    setDone(`Snapshot ${data?.snapshot} approved — promoted to approved/.`);
  }

  // ---------- keyboard: built from the SHORTCUTS table ----------
  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    next: () => moveCursor(1),
    prev: () => moveCursor(-1),
    nextItems: () => moveCursorWhere((f) => factStats(f).items > 0, 1),
    prevItems: () => moveCursorWhere((f) => factStats(f).items > 0, -1),
    nextQuestion: () => moveCursorWhere((f) => factStats(f).questions > 0, 1),
    prevQuestion: () => moveCursorWhere((f) => factStats(f).questions > 0, -1),
    expand: () => {
      if (effectiveCursor?.kind === "dir") {
        setCollapsed((c) => {
          const next = new Set(c);
          next.delete(effectiveCursor.path);
          return next;
        });
      }
    },
    collapse: () => {
      if (effectiveCursor?.kind === "dir") {
        setCollapsed((c) => new Set(c).add(effectiveCursor.path));
      }
    },
    notNeeded: () => decide("not-needed"),
    simplify: () => decide("simplify"),
    defer: () => decide("defer"),
    clearDecision: () => decide(null),
    seen: () => toggleSeen(false),
    seenAdvance: () => toggleSeen(true),
    select: () => toggleSelect(),
    annotate: () => beginItem("annotation"),
    question: () => beginItem("question"),
    comment: () => beginItem("comment"),
    undo: () => undoLast(),
    help: () => setOverlay((o) => (o === "help" ? null : "help")),
    palette: () => setOverlay((o) => (o === "palette" ? null : "palette")),
    paletteSlash: () => setOverlay("palette"),
    filter: () => document.getElementById("tree-filter")?.focus(),
    close: () => {
      if (composer) setComposer(null);
      else if (overlay) setOverlay(null);
      else if (selection.size) setSelection(new Set());
    },
  };
  useEffect(() => {
    const run = (id: string): void => actions.current[id]?.();
    const handlers: Record<string, (e: KeyboardEvent) => void> = {};
    for (const def of SHORTCUTS) {
      for (const key of def.keys) {
        handlers[key] = def.raw
          ? (e) => {
              e.preventDefault();
              run(def.id);
            }
          : (e) => {
              const target = e.target as HTMLElement | null;
              if (e.isComposing) return;
              if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
              if (e.repeat && !def.allowRepeat) return;
              e.preventDefault();
              run(def.id);
            };
      }
    }
    return tinykeys(window, handlers, { ignore: (e: KeyboardEvent) => e.isComposing });
  }, []);

  // ---------- fact rendering + highlights + mermaid ----------
  const renderedFact =
    effectiveCursor?.kind === "fact"
      ? targetFact
      : effectiveCursor
        ? indexFactOf(data?.facts ?? [], effectiveCursor.path)
        : null;

  const factHtml = useMemo(() => {
    if (!renderedFact || !data) return "";
    return renderMarkdown(renderedFact.content, {
      assetBase: `/asset/${data.snapshot}/`,
      factDir: dirOf(renderedFact.path),
    });
  }, [renderedFact, data]);

  const anchorStates = useMemo(() => {
    const states = new Map<string, "exact" | "drifted" | "detached">();
    for (const item of renderedFact?.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(renderedFact!.content, item.anchor);
      states.set(item.id, resolved ? resolved.state : "detached");
    }
    return states;
  }, [renderedFact]);

  useEffect(() => {
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
      .Highlight;
    if (!highlights || !HighlightCtor || !readRef.current || !renderedFact) return;
    const buckets: Record<string, Range[]> = { "rk-anno": [], "rk-question": [], "rk-focused": [] };
    for (const item of renderedFact.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(renderedFact.content, item.anchor);
      if (!resolved) continue;
      const range = rangeForSourceSpan(readRef.current as HTMLElement, resolved.start, resolved.end);
      if (!range) continue;
      if (item.id === focusItemId) buckets["rk-focused"]!.push(range);
      else if (item.type === "question") buckets["rk-question"]!.push(range);
      else buckets["rk-anno"]!.push(range);
    }
    for (const [name, ranges] of Object.entries(buckets)) {
      highlights.set(name, new HighlightCtor(...ranges));
    }
    return () => {
      for (const name of Object.keys(buckets)) highlights.delete(name);
    };
  }, [factHtml, renderedFact, focusItemId]);

  useEffect(() => {
    const container = readRef.current;
    if (!container) return;
    const blocks = container.querySelectorAll("pre.rk-mermaid:not([data-done])");
    if (!blocks.length) return;
    const renderAll = (): void => {
      const mermaid = (window as unknown as {
        __rkMermaid?: { render: (id: string, src: string) => Promise<{ svg: string }> };
      }).__rkMermaid;
      if (!mermaid) return;
      container.querySelectorAll("pre.rk-mermaid:not([data-done])").forEach((pre, i) => {
        pre.setAttribute("data-done", "1");
        void mermaid
          .render(`rk-mmd-${i}-${(pre.textContent ?? "").length}`, pre.textContent ?? "")
          .then(({ svg }) => {
            pre.innerHTML = svg;
          })
          .catch(() => pre.setAttribute("data-error", "1"));
      });
    };
    if ((window as unknown as { __rkMermaid?: unknown }).__rkMermaid) {
      renderAll();
    } else {
      document.addEventListener("rk-mermaid-ready", renderAll, { once: true });
      if (!document.querySelector("script[src='/mermaid.js']")) {
        const script = document.createElement("script");
        script.src = "/mermaid.js";
        document.body.appendChild(script);
      }
      return () => document.removeEventListener("rk-mermaid-ready", renderAll);
    }
  }, [factHtml]);

  // toast auto-dismiss (paused while hovered)
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

  if (!data) return <div className="app" />;
  if (done) {
    return (
      <div className="done-screen" id="done">
        <div>{done}</div>
      </div>
    );
  }

  const yourTurn = openQuestions.answered;
  const decidedFacts = data.facts.filter((f) => f.sidecar?.decision || f.sidecar?.items?.length);

  return (
    <div className="app">
      <header className="hdr">
        <h1>
          reviewkit — <span id="review-name">{data.review}</span>
        </h1>
        <span className="progress stat" id="progress">
          {progress.seen} / {progress.total} reviewed
        </span>
        <span aria-live="polite">
          {openQuestions.total > 0 && (
            <button
              className={`pill ${yourTurn ? "attn" : ""}`}
              id="question-pill"
              onClick={() => moveCursorWhere((f) => factStats(f).questions > 0, 1)}
            >
              {yourTurn
                ? `${yourTurn} answered — your turn`
                : `${openQuestions.total} open question${openQuestions.total > 1 ? "s" : ""}`}
            </button>
          )}
        </span>
        <span className="spacer" />
        <Select
          value={String(data.snapshot)}
          onValueChange={(value) => void load(Number(value))}
        >
          <SelectTrigger size="sm" id="snapshot-select" aria-label="Snapshot" className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.snapshots.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Snapshot {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" id="btn-finish" onClick={() => setOverlay("finish")}>
          Finish review
        </Button>
      </header>

      <div className="cols">
        <nav className="tree-col" aria-label="Facts">
          <div className="tree-filter">
            <Input
              id="tree-filter"
              className="h-8"
              placeholder="Filter facts (f)"
              aria-label="Filter facts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setFilter("");
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              className="filter-clear"
              data-show={filter ? "" : undefined}
              aria-label="Clear filter"
              tabIndex={filter ? 0 : -1}
              onClick={() => setFilter("")}
            >
              <X className="lucide size-3.5" size={14} />
            </button>
          </div>
          {filtering && (
            <div className="filter-count" aria-live="polite">
              {filteredFacts.length} match{filteredFacts.length === 1 ? "" : "es"}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="tree-empty">Nothing matches “{filter.trim()}”.</div>
          ) : (
            <ul
              className="tree"
              id="fact-list"
              role="tree"
              aria-label="Facts"
              aria-activedescendant={
                effectiveCursor
                  ? `row-${effectiveCursor.kind}-${effectiveCursor.path}`
                  : undefined
              }
            >
              {rows.map((row) => (
                <TreeRow
                  key={`${row.kind}:${row.path}`}
                  row={row}
                  data={data}
                  prev={prev}
                  seen={seen}
                  selection={selection}
                  collapsed={collapsed}
                  isCursor={
                    row.kind === effectiveCursor?.kind && row.path === effectiveCursor?.path
                  }
                  onOpen={() => openRow(row)}
                  onToggle={() =>
                    setCollapsed((c) => {
                      const next = new Set(c);
                      if (next.has(row.path)) next.delete(row.path);
                      else next.add(row.path);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          )}
        </nav>

        <main className="read-col" ref={readColRef as React.RefObject<HTMLElement>}>
          <div className="read-inner">
            {effectiveCursor?.kind === "dir" ? (
              <DirView
                dir={effectiveCursor.path}
                data={data}
                prev={prev}
                seen={seen}
                selection={selection}
                indexHtml={factHtml}
                readRef={readRef}
                indexFact={renderedFact}
                onOpen={openRow}
                onToggleSelect={toggleSelect}
                onSelectAll={(paths, on) =>
                  setSelection((current) => {
                    const next = new Set(current);
                    for (const p of paths) {
                      if (on) next.add(p);
                      else next.delete(p);
                    }
                    return next;
                  })
                }
                onDecide={(path, d) =>
                  mutateFact(path, (sidecar) => {
                    if (sidecar.decision === d) delete sidecar.decision;
                    else sidecar.decision = d;
                  })
                }
              />
            ) : renderedFact ? (
              <>
                <div className="crumb">
                  <span>{renderedFact.path}</span>
                  <ChangeBadge status={changeStatus(prev, renderedFact)} />
                  {seen.has(renderedFact.path) && (
                    <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />
                  )}
                </div>
                <article
                  className="fact-body"
                  id="fact-content"
                  data-fact-path={renderedFact.path}
                  ref={readRef as React.RefObject<HTMLElement>}
                  dangerouslySetInnerHTML={{ __html: factHtml }}
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                {filtering ? `Nothing matches “${filter.trim()}”.` : "No facts."}
              </p>
            )}
            {selection.size > 0 && (
              <div className="bulkbar" id="bulkbar" role="toolbar" aria-label="Bulk decisions">
                <span className="stat" aria-live="polite">
                  {selection.size} selected
                </span>
                {DECISIONS.map(({ d, key, label }) => (
                  <button key={d} onClick={() => decide(d)}>
                    <Kbd className="mr-1">{key}</Kbd>
                    {label}
                  </button>
                ))}
                <button onClick={() => setSelection(new Set())}>esc clear</button>
              </div>
            )}
          </div>
        </main>

        {panelOpen ? (
          <aside className="panel-col panel" aria-label="Review panel">
            <Panel
              fact={targetFact}
              anchorStates={anchorStates}
              composer={composer}
              onDecide={(d) => decide(d)}
              onFocusItem={setFocusItemId}
              onEdit={(item) =>
                targetFact &&
                setComposer({
                  mode: "edit",
                  path: targetFact.path,
                  id: item.id,
                  initial:
                    item.type === "question" ? (item.thread?.[0]?.text ?? "") : (item.text ?? ""),
                })
              }
              onDelete={(id) => targetFact && deleteItem(targetFact.path, id)}
              onReply={(id) =>
                targetFact && setComposer({ mode: "reply", path: targetFact.path, id })
              }
              onReanchor={(id) => targetFact && reanchor(targetFact.path, id)}
              onCollapse={() => setPanelOpen(false)}
              onCommit={commitComposer}
              onCancel={() => setComposer(null)}
            />
          </aside>
        ) : (
          <aside className="panel-col rail">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open review panel"
              onClick={() => setPanelOpen(true)}
            >
              <PanelRightOpen />
            </Button>
            {targetFact && factStats(targetFact).items > 0 && (
              <div className="chip count mt-2">{factStats(targetFact).items}</div>
            )}
          </aside>
        )}
      </div>

      {selHint && (
        <div
          className="sel-hint"
          id="sel-hint"
          style={{ left: Math.max(8, selHint.x - 70), top: Math.max(8, selHint.y - 40) }}
        >
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => beginItem("annotation")}
          >
            <Kbd>a</Kbd> Annotate
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => beginItem("question")}
          >
            <Kbd>q</Kbd> Ask
          </Button>
        </div>
      )}

      <Help open={overlay === "help"} onClose={() => setOverlay(null)} />
      <Palette
        open={overlay === "palette"}
        data={data}
        onClose={() => setOverlay(null)}
        onJump={(path) => {
          setOverlay(null);
          openRow({ kind: "fact", path, depth: 0 });
        }}
        commands={[
          { label: "Finish review", run: () => setOverlay("finish") },
          { label: "Approve snapshot…", run: () => setApproveOpen(true) },
          {
            label: "Mark all facts seen",
            run: () => {
              if (!data) return;
              const store = seenStore(data.review);
              for (const fact of data.facts) store[fact.path] = fact.content;
              writeSeenStore(data.review, store);
              setSeenVersion((v) => v + 1);
            },
          },
          { label: "Toggle review panel", run: () => setPanelOpen((open) => !open) },
          { label: "Keyboard help", run: () => setOverlay("help") },
          ...data.snapshots
            .filter((s) => s !== data.snapshot)
            .map((s) => ({ label: `Switch to snapshot ${s}`, run: () => void load(s) })),
        ]}
      />
      <FinishSheet
        open={overlay === "finish"}
        data={data}
        progress={progress}
        openQuestions={openQuestions.total}
        decidedFacts={decidedFacts}
        onFinish={() => void finish()}
        onApprove={() => setApproveOpen(true)}
        onClose={() => setOverlay(null)}
      />
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent id="approve-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve snapshot {data.snapshot}?</AlertDialogTitle>
            <AlertDialogDescription>
              The snapshot is copied to approved/ — that directory existing is the approval —
              and this session ends. Implementation starts from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction id="approve-go" onClick={() => void approve()}>
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="lucide size-3.5" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeBadge({ status }: { status: "new" | "changed" | undefined }): React.JSX.Element | null {
  if (!status) return null;
  return <span className={`chip ${status}`}>{status}</span>;
}

function TreeRow(props: {
  row: Row;
  data: ReviewData;
  prev: Map<string, string> | null;
  seen: Set<string>;
  selection: Set<string>;
  collapsed: Set<string>;
  isCursor: boolean;
  onOpen: () => void;
  onToggle: () => void;
}): React.JSX.Element {
  const { row, data } = props;
  const pad = `${10 + row.depth * 16}px`;
  const rowId = `row-${row.kind}-${row.path}`;
  if (row.kind === "dir") {
    const stats = dirStats(data.facts, row.path);
    const isCollapsed = props.collapsed.has(row.path);
    return (
      <li
        id={rowId}
        className={`row dir ${props.isCursor ? "cursor" : ""}`}
        style={{ paddingLeft: pad }}
        data-path={row.path}
        data-kind="dir"
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={props.isCursor}
        aria-expanded={!isCollapsed}
        tabIndex={props.isCursor ? 0 : -1}
        onClick={props.onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onOpen();
        }}
      >
        <button
          className="caret"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          aria-expanded={!isCollapsed}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
        >
          <ChevronRight className="lucide size-3.5" size={14} />
        </button>
        <span className="name dirname">{nameOf(row.path)}/</span>
        <span className="badges">
          {stats.questions > 0 && <span className="chip q">{stats.questions}?</span>}
          {stats.items > 0 && <span className="chip count">{stats.items}</span>}
        </span>
      </li>
    );
  }
  const fact = data.facts.find((f) => f.path === row.path);
  if (!fact) return <li />;
  const stats = factStats(fact);
  const status = changeStatus(props.prev, fact);
  const decision = fact.sidecar?.decision;
  return (
    <li
      id={rowId}
      className={`row fact ${props.isCursor ? "cursor" : ""} ${!props.seen.has(fact.path) ? "unseen" : ""} ${decision === "not-needed" ? "checked-off" : ""}`}
      style={{ paddingLeft: pad }}
      data-path={row.path}
      data-kind="fact"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={props.isCursor}
      tabIndex={props.isCursor ? 0 : -1}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onOpen();
      }}
    >
      <span className="caret-spacer" aria-hidden="true" />
      {props.selection.has(fact.path) && (
        <Checkbox checked aria-label={`${fact.path} selected`} tabIndex={-1} />
      )}
      <span className="name">{nameOf(fact.path)}</span>
      <span className="badges">
        <ChangeBadge status={status} />
        {stats.questions > 0 && <span className="chip q">{stats.questions}?</span>}
        {stats.items - stats.questions > 0 && (
          <span className="chip count">{stats.items - stats.questions}</span>
        )}
        {decision && (
          <span
            className={`chip ${decision} ${status === "changed" ? "stale" : ""}`}
            title={status === "changed" ? "Decision predates the latest edit" : undefined}
          >
            {decision}
            {status === "changed" ? " (stale)" : ""}
          </span>
        )}
        {props.seen.has(fact.path) && (
          <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />
        )}
      </span>
    </li>
  );
}

function DirView(props: {
  dir: string;
  data: ReviewData;
  prev: Map<string, string> | null;
  seen: Set<string>;
  selection: Set<string>;
  indexHtml: string;
  indexFact: Fact | null;
  readRef: React.MutableRefObject<HTMLElement | null>;
  onOpen: (row: Row) => void;
  onToggleSelect: (path: string) => void;
  onSelectAll: (paths: string[], on: boolean) => void;
  onDecide: (path: string, d: Decision) => void;
}): React.JSX.Element {
  const children = childFactsOf(props.data.facts, props.dir);
  const subdirs = childDirsOf(props.data.facts, props.dir);
  const stats = dirStats(props.data.facts, props.dir);
  const allSelected = children.length > 0 && children.every((f) => props.selection.has(f.path));
  return (
    <div className="dirview" id="dir-view">
      <div className="crumb">
        <span>{props.dir}/</span>
      </div>
      {props.indexFact ? (
        <article
          className="fact-body"
          id="fact-content"
          data-fact-path={props.indexFact.path}
          ref={props.readRef as React.RefObject<HTMLElement>}
          dangerouslySetInnerHTML={{ __html: props.indexHtml }}
        />
      ) : (
        <h1 className="text-[22px] font-[650] my-2">{nameOf(props.dir)}/</h1>
      )}
      <div className="dirstats stat">
        {stats.facts} facts · {stats.undecided} undecided · {stats.questions} open question
        {stats.questions === 1 ? "" : "s"}
      </div>
      <div className="facttable" id="fact-table" aria-label={`Facts in ${props.dir}`}>
        {children.length > 0 && (
          <div className="selectall flex items-center gap-2.5 border-b border-line-soft px-1.5 py-1.5">
            <Checkbox
              aria-label="Select all facts in this directory"
              checked={allSelected}
              onCheckedChange={(on) =>
                props.onSelectAll(
                  children.map((f) => f.path),
                  on === true,
                )
              }
            />
            <span className="text-muted-foreground text-[12px]">select all</span>
          </div>
        )}
        {subdirs.map((dir) => (
          <div
            key={dir}
            className="trow"
            data-path={dir}
            onClick={() => props.onOpen({ kind: "dir", path: dir, depth: 0 })}
          >
            <span className="caret-spacer" style={{ width: 16 }} aria-hidden="true" />
            <span className="title dirname">
              {nameOf(dir)}/{" "}
              <span className="text-muted-foreground">
                ({dirStats(props.data.facts, dir).facts} facts)
              </span>
            </span>
          </div>
        ))}
        {children.map((fact) => {
          const decision = fact.sidecar?.decision;
          const stats = factStats(fact);
          return (
            <div
              key={fact.path}
              className={`trow ${!props.seen.has(fact.path) ? "unseen" : ""} ${decision ? "has-decision" : ""}`}
              data-path={fact.path}
              onClick={() => props.onOpen({ kind: "fact", path: fact.path, depth: 0 })}
            >
              <Checkbox
                aria-label={`Select ${fact.path}`}
                checked={props.selection.has(fact.path)}
                onCheckedChange={() => props.onToggleSelect(fact.path)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="title">{titleOf(fact)}</span>
              <span className="badges">
                <ChangeBadge status={changeStatus(props.prev, fact)} />
                {stats.questions > 0 && <span className="chip q">{stats.questions}?</span>}
                {stats.items - stats.questions > 0 && (
                  <span className="chip count">{stats.items - stats.questions}</span>
                )}
                {props.seen.has(fact.path) && (
                  <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />
                )}
              </span>
              <span className="decide" onClick={(e) => e.stopPropagation()}>
                {DECISIONS.map(({ d, label }) => (
                  <Button
                    key={d}
                    variant={decision === d ? "default" : "outline"}
                    size="xs"
                    onClick={() => props.onDecide(fact.path, d)}
                  >
                    {label}
                  </Button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Panel(props: {
  fact: Fact | null;
  anchorStates: Map<string, "exact" | "drifted" | "detached">;
  composer: Composer | null;
  onDecide: (d: Decision) => void;
  onFocusItem: (id: string | null) => void;
  onEdit: (item: SidecarItem) => void;
  onDelete: (id: string) => void;
  onReply: (id: string) => void;
  onReanchor: (id: string) => void;
  onCollapse: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const fact = props.fact;
  const decision = fact?.sidecar?.decision ?? "";
  return (
    <>
      <h2 className="flex items-center justify-between">
        Decision
        <Button variant="ghost" size="icon-xs" aria-label="Collapse panel" onClick={props.onCollapse}>
          <PanelRightClose />
        </Button>
      </h2>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        id="decisions"
        aria-label="Decision"
        value={decision}
        disabled={!fact}
        onValueChange={(value) => {
          if (value) props.onDecide(value as Decision);
          else if (decision) props.onDecide(decision as Decision); // toggle off
        }}
      >
        {DECISIONS.map(({ d, key, label }) => (
          <ToggleGroupItem key={d} value={d} data-decision={d} aria-keyshortcuts={key}>
            <Kbd>{key}</Kbd>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <h2>Items</h2>
      <div id="panel-items">
        {(fact?.sidecar?.items ?? []).map((item) => {
          const anchorState = item.anchor ? props.anchorStates.get(item.id) : undefined;
          return (
            <div
              key={item.id}
              className={`card item-${item.type} ${anchorState === "drifted" ? "drifted" : ""} ${anchorState === "detached" ? "detached" : ""}`}
              data-id={item.id}
              tabIndex={0}
              onMouseEnter={() => props.onFocusItem(item.id)}
              onMouseLeave={() => props.onFocusItem(null)}
              onFocus={() => props.onFocusItem(item.id)}
              onBlur={() => props.onFocusItem(null)}
            >
              <span className="kind">
                {item.type}
                {anchorState === "drifted" && <span className="chip changed">drifted</span>}
                {anchorState === "detached" && <span className="chip stale">detached</span>}
              </span>
              <DM.Root>
                <DM.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="menu-btn absolute top-2 right-2"
                    aria-label={`Actions for ${item.id}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DM.Trigger>
                <DM.Portal>
                  <DM.Content
                    className="menu z-50 min-w-[130px] rounded-md border bg-popover p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                    align="end"
                    sideOffset={4}
                  >
                    <DM.Item
                      className="rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                      onSelect={() => props.onEdit(item)}
                    >
                      Edit
                    </DM.Item>
                    <DM.Item
                      className="rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent"
                      onSelect={() => props.onDelete(item.id)}
                    >
                      Delete
                    </DM.Item>
                  </DM.Content>
                </DM.Portal>
              </DM.Root>
              {item.anchor?.quote && <blockquote>{item.anchor.quote}</blockquote>}
              {anchorState === "detached" && (
                <div className="actions">
                  <Button variant="outline" size="xs" onClick={() => props.onReanchor(item.id)}>
                    Re-anchor to selection
                  </Button>
                </div>
              )}
              {item.type === "question" ? (
                <>
                  {(item.thread ?? []).map((turn, i) => (
                    <div key={i} className="turn cardtext">
                      <span className="who">{turn.who}</span>
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text) }} />
                    </div>
                  ))}
                  <span className="actions">
                    <Button
                      variant="outline"
                      size="xs"
                      className="item-reply"
                      onClick={() => props.onReply(item.id)}
                    >
                      Reply
                    </Button>
                    {answeredByAgent(item) && <span className="chip q">your turn</span>}
                  </span>
                </>
              ) : (
                item.text && (
                  <div
                    className="cardtext"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
                  />
                )
              )}
            </div>
          );
        })}
        {fact && (fact.sidecar?.items ?? []).length === 0 && (
          <p className="text-muted-foreground text-[13px]">Nothing raised on this fact.</p>
        )}
        {!fact && (
          <p className="text-muted-foreground text-[13px]">
            This directory has no _index.md — select a fact to review it.
          </p>
        )}
      </div>
      {props.composer && (
        <ComposerBox composer={props.composer} onCommit={props.onCommit} onCancel={props.onCancel} />
      )}
      <p className="keys-hint">
        j/k move · 1–3 decide · v seen · a/q/c raise · <Kbd>?</Kbd> help · <Kbd>⌘K</Kbd> search
      </p>
    </>
  );
}

function ComposerBox(props: {
  composer: Composer;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const composer = props.composer;
  const label =
    composer.mode === "new"
      ? composer.type + (composer.anchor ? ` — “${composer.anchor.quote}”` : " — whole fact")
      : composer.mode === "edit"
        ? `edit ${composer.id}`
        : `reply — ${composer.id}`;
  return (
    <form
      className="composer mt-3 rounded-lg border p-3"
      id="item-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onCommit(ref.current?.value ?? "");
      }}
    >
      <div className="text-muted-foreground mb-2 text-[12px] whitespace-pre-wrap" id="item-form-label">
        {label}
      </div>
      <Textarea
        id="item-input"
        aria-label="Item text"
        ref={ref}
        defaultValue={composer.mode === "edit" ? composer.initial : ""}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            props.onCancel();
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            props.onCommit(e.currentTarget.value);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm" id="item-save">
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" id="item-cancel" onClick={props.onCancel}>
          Cancel
        </Button>
        <span className="text-muted-foreground ml-auto text-[11px]">⌘↵ save · esc cancel</span>
      </div>
    </form>
  );
}

function Help(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  const sections = [...new Set(SHORTCUTS.map((s) => s.section))];
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        id="help-sheet"
        className="max-h-[74vh] overflow-y-auto sm:max-w-[640px]"
        onCloseAutoFocus={keepFocusOutOfFields}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-7 gap-y-1">
          {sections.map((section) => (
            <div key={section}>
              <h3 className="text-muted-foreground mt-3 mb-1 text-[11px] font-[650] tracking-wide uppercase">
                {section}
              </h3>
              {SHORTCUTS.filter((s) => s.section === section && s.id !== "paletteSlash").map((s) => (
                <div key={s.id} className="flex justify-between gap-3 py-0.5 text-[13px]">
                  <span>{s.label}</span>
                  <Kbd>{s.shown}</Kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Palette(props: {
  open: boolean;
  data: ReviewData;
  commands: { label: string; run: () => void }[];
  onJump: (path: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      onCloseAutoFocus={keepFocusOutOfFields}
      title="Search facts and commands"
      description="Type to search facts; commands are listed below"
    >
      <CommandInput placeholder="Search facts and commands…" />
      <CommandList id="palette-list">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Facts">
          {props.data.facts.map((fact) => (
            <CommandItem
              key={fact.path}
              value={`${titleOf(fact)} ${fact.path}`}
              onSelect={() => props.onJump(fact.path)}
            >
              <span className="truncate">{titleOf(fact)}</span>
              <span className="text-muted-foreground ml-auto truncate text-[11px]">
                {fact.path}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Commands">
          {props.commands.map((command) => (
            <CommandItem
              key={command.label}
              value={`> ${command.label}`}
              onSelect={() => {
                props.onClose();
                command.run();
              }}
            >
              {command.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function FinishSheet(props: {
  open: boolean;
  data: ReviewData;
  progress: { seen: number; total: number };
  openQuestions: number;
  decidedFacts: Fact[];
  onFinish: () => void;
  onApprove: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const decisions = props.data.facts.filter((f) => f.sidecar?.decision).length;
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent id="finish-sheet" className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Finish review — snapshot {props.data.snapshot}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground stat text-[13px]">
          {props.progress.seen} of {props.progress.total} facts seen · {decisions} decision
          {decisions === 1 ? "" : "s"} · {props.openQuestions} open question
          {props.openQuestions === 1 ? "" : "s"}
        </p>
        <ul className="max-h-[40vh] list-none overflow-y-auto p-0">
          {props.decidedFacts.map((fact) => {
            const items = fact.sidecar?.items ?? [];
            return (
              <li key={fact.path} className="border-line-soft border-b py-1.5 text-[13px]">
                {fact.sidecar?.decision && (
                  <span className={`chip ${fact.sidecar.decision} mr-1.5`}>
                    {fact.sidecar.decision}
                  </span>
                )}
                {items.length > 0 && (
                  <span className="chip count mr-1.5">
                    {items.length} item{items.length === 1 ? "" : "s"}
                  </span>
                )}
                {titleOf(fact)}
                <div className="text-muted-foreground text-[11px]">{fact.path}</div>
              </li>
            );
          })}
          {props.decidedFacts.length === 0 && (
            <li className="py-1.5 text-[13px]">
              Nothing raised — finishing records agreement with every fact.
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button variant="outline" size="sm" id="confirm-approve" onClick={props.onApprove}>
            Approve snapshot…
          </Button>
          <Button size="sm" id="confirm-finish" onClick={props.onFinish}>
            Finish review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
