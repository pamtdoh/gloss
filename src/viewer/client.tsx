import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { tinykeys } from "tinykeys";
import {
  Check,
  CircleHelp,
  GitCompareArrows,
  ListTodo,
  Menu,
  MessageCircleQuestion,
  MessageSquare,
  Moon,
  PanelRightOpen,
  Search,
  Sun,
  X,
} from "lucide-react";
import PhotoSwipe, { type SlideData } from "photoswipe";
import type { Sidecar, SidecarItem } from "../summary.js";
import { describeAnchor, resolveAnchor, type Anchor } from "./anchor.js";
import {
  clearHighlight,
  paintNotes,
  rangeForSourceSpan,
  setHighlight,
  sourceSpanForSelection,
} from "./dom-anchor.js";
import { renderMarkdown } from "./markdown.js";
import {
  ROOT,
  buildRows,
  changeStatus,
  contentMap,
  dirOf,
  factStats,
  indexFactOf,
  isRoot,
  nextId,
  normalizeSidecar,
  previousRevision,
  type AnchorState,
  type Fact,
  type ReviewData,
  type Row,
} from "./model.js";
import { COARSE, type Composer } from "./common.js";
import { ChangeBadge, DirView, SelBubble, TreeRow, rowLabel } from "./components.js";
import { DiffView } from "./compare.js";
import { useMermaidHtml } from "./mermaid.js";
import { Help, FinishSheet } from "./overlays.js";
import { Panel } from "./panel.js";
import { SHORTCUTS, keyFor } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Kbd } from "./ui/kbd.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";

// theme: light | dark | system -> .dark class (utilities target it).
// Applied once at module load so the first paint is already correct.
type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "rk-theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const storedTheme = (): ThemeMode => {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
};
const applyTheme = (dark: boolean): void => {
  document.documentElement.classList.toggle("dark", dark);
};
const initialTheme = storedTheme();
applyTheme(initialTheme === "dark" || (initialTheme === "system" && darkQuery.matches));

interface ToastState {
  message: string;
  undo?: () => void;
}

const POLL_DISABLED = new URLSearchParams(location.search).get("poll") === "0";
// The liveness timings are one policy, derived so they can't drift apart:
// local writes must outlive one GET already in flight, and "alive moments
// ago" (the finish/approve exit race) means within a few missed polls.
const POLL_MS = 2000;
const WRITE_GRACE_MS = POLL_MS + 500;
const RECENT_LIVE_MS = 4 * POLL_MS;

const unsavedPhrase = (n: number): string => `${n} change${n === 1 ? "" : "s"}`;

// Tree scope, GitHub/GitLab-style but sharper: "changed" is what moved
// since the previous revision (including facts the agent deleted, shown as
// read-only ghosts); "raised" is what the human commented or asked on.
type Scope = "all" | "changed" | "raised";
const SCOPES: Scope[] = ["all", "changed", "raised"];
const SCOPE_LABEL: Record<Scope, string> = { all: "All", changed: "Changed", raised: "Raised" };

// the URL names the page being viewed: "#/" for the front page, "#dir/"
// or "#dir/fact.md" below it, so back/forward walk previously viewed
// pages and links survive a reload
function cursorFromHash(facts: Fact[]): Row | null {
  const raw = decodeURI(location.hash.slice(1));
  if (!raw) return null;
  if (raw.endsWith("/")) {
    const path = raw.slice(0, -1);
    if (path === "") return ROOT;
    return facts.some((f) => f.path.startsWith(`${path}/`))
      ? { kind: "dir", path, depth: 0 }
      : null;
  }
  return facts.some((f) => f.path === raw) ? { kind: "fact", path: raw, depth: 0 } : null;
}

// Coarse pointers get the fixed bottom action bar (iOS owns the selection
// callout and collapses the selection on any tap — floating popovers near
// the selection are unwinnable there). Fine pointers get a bubble at the
// selection instead.

async function fetchReview(revision?: number): Promise<ReviewData> {
  const res = await fetch("/api/review" + (revision ? `?revision=${revision}` : ""));
  if (!res.ok) {
    const error = new Error(`review fetch failed: ${res.status}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Seen is keyed by fact CONTENT per review (browser-local): an iterated
// revision keeps its seen marks for unchanged facts and clears them exactly
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

// Desktop-only drag handle between the reading pane and the review panel.
// It owns --panel-w on the root (the width .panel-col already reads);
// double-click resets to the stylesheet default. Hidden below 1101px,
// where the panel is a fixed overlay with its own width.
const PANEL_W_KEY = "rk-panel-w";
const savedPanelW = Number(localStorage.getItem(PANEL_W_KEY));
if (savedPanelW) document.documentElement.style.setProperty("--panel-w", `${savedPanelW}px`);

// what the lightbox opens: the images and diagrams of one fact body
const FIGURE = "img, .rk-mermaid svg";

// A Mermaid diagram in the lightbox: the live SVG as html content, so it
// stays vector-crisp at every zoom and keeps the page's fonts and theme.
// A vector has no native size to stop at, so it is declared four
// viewports wide — room for PhotoSwipe's zoom ladder (fit, 3× fit,
// 4× fit), which images get from their pixel size. The wrapper carries
// pswp__img because PhotoSwipe's mouse click handler keys on that class
// alone (tapAction covers touch only); it is what makes click-to-zoom
// and the zoom cursors work on a diagram.
function diagramSlide(svg: SVGSVGElement): SlideData {
  const box = svg.viewBox.baseVal;
  const width = box.width || svg.clientWidth || 800;
  const height = box.height || svg.clientHeight || 600;
  const scale = Math.max(1, (4 * window.innerWidth) / width);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style"); // mermaid's inline max-width; the CSS sizes it
  return {
    type: "html",
    html: `<div class="rk-mermaid-zoom pswp__img">${clone.outerHTML}</div>`,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function PanelResizer(): React.JSX.Element {
  const [active, setActive] = useState(false);
  return (
    <button
      className="col-resizer"
      id="panel-resizer"
      aria-orientation="vertical"
      aria-label="Resize review panel (double-click to reset)"
      title="Drag to resize · double-click resets"
      data-active={active ? "" : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!active) return;
        const max = Math.min(640, window.innerWidth * 0.5);
        const width = Math.round(Math.min(Math.max(window.innerWidth - e.clientX, 240), max));
        document.documentElement.style.setProperty("--panel-w", `${width}px`);
        localStorage.setItem(PANEL_W_KEY, String(width));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setActive(false);
      }}
      onDoubleClick={() => {
        document.documentElement.style.removeProperty("--panel-w");
        localStorage.removeItem(PANEL_W_KEY);
      }}
    />
  );
}

function App(): React.JSX.Element {
  const [data, setData] = useState<ReviewData | null>(null);
  // the previous revision: the changed-since basis outside compare mode
  const [prevData, setPrevData] = useState<ReviewData | null>(null);
  const [cursor, setCursor] = useState<Row | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [seenVersion, setSeenVersion] = useState(0);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [overlay, setOverlay] = useState<"help" | "finish" | null>(null);
  const pswpRef = useRef<PhotoSwipe | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [panelOpen, setPanelOpen] = useState(
    () => window.matchMedia("(min-width: 1101px)").matches,
  );
  const [treeOpen, setTreeOpen] = useState(false); // mobile drawer
  const isMobile = (): boolean => window.matchMedia("(max-width: 860px)").matches;
  // the panel is an overlay/sheet below 1100px — after an action it should
  // get out of the way instead of covering the fact
  const closeSheetIfOverlay = (): void => {
    if (window.matchMedia("(max-width: 1100px)").matches) setPanelOpen(false);
  };
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // question thread opened as a panel subpage
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  // compare mode: head is the viewed revision, the human picks the base
  // (GitHub's single-axis picker); the base revision held whole is the
  // mode's state. Beside it, what a toggle must not lose — the base last
  // compared against and the scope on each side — so leaving and
  // returning is lossless.
  const [compareData, setCompareData] = useState<ReviewData | null>(null);
  const compareMemo = useRef<{ base: number | null; inside: Scope; outside: Scope }>({
    base: null,
    inside: "changed",
    outside: "all",
  });
  const [diffLayout, setDiffLayout] = useState<"rendered" | "unified" | "split">(() => {
    const stored = localStorage.getItem("rk-diff-layout");
    return stored === "unified" || stored === "split" ? stored : "rendered";
  });
  const [theme, setTheme] = useState<ThemeMode>(storedTheme);
  // OS scheme changes re-render so the header icon tracks the effective theme
  const [sysDark, setSysDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = (): void => setSysDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  const effectiveDark = theme === "dark" || (theme === "system" && sysDark);
  useEffect(() => {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
    applyTheme(effectiveDark);
  }, [theme, effectiveDark]);
  // The captured selection survives iOS Safari collapsing the native one:
  // painted as rk-pending and acted on from a stable bottom bar on touch.
  // On fine pointers it is set only when the composer opens — the draft
  // anchor — never while the native selection is doing its job.
  const [pendingSel, setPendingSel] = useState<{
    path: string;
    start: number;
    end: number;
  } | null>(null);
  // fine pointers: the mapped live selection driving the bubble — a pure
  // mirror of the native selection, cleared the moment it collapses
  const [liveSel, setLiveSel] = useState<{
    path: string;
    start: number;
    end: number;
  } | null>(null);

  const pendingWrites = useRef(new Map<string, number>());
  // sidecar writes not yet ACKed by the server, keyed `revision:path` —
  // "saved" is the server's word, not the fetch having been fired
  const unsaved = useRef(new Map<string, { revision: number; path: string; sidecar: Sidecar }>());
  const flushing = useRef(false);
  const flushQueued = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unsavedCount, setUnsavedCount] = useState(0);
  // liveness: the 2s poll doubles as a heartbeat, so "server gone" is a
  // state the UI can show instead of a guess each fetch makes alone
  const lastPollOk = useRef(Date.now());
  const pollFailures = useRef(0);
  const [connLost, setConnLost] = useState<"unreachable" | "unauthorized" | null>(null);
  // a finger is down: no re-renders allowed, or iOS drops the selection
  const touchActive = useRef(false);
  // native handle drags fire NO pointer events — selectionchange activity
  // is the only signal that a gesture may be in progress
  const lastSelActivity = useRef(0);
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
  async function load(revision?: number): Promise<void> {
    const next = await fetchReview(revision);
    serverOk();
    const prior = previousRevision(next);
    setPrevData(prior === null ? null : await fetchReview(prior));
    setData(next);
    // deep links land on their page; revision switches keep the place
    setCursor(cursorFromHash(next.facts));
    setComposer(null);
    setFilter("");
    setScope("all"); // like the text filter: a new revision starts unscoped
    setOpenThreadId(null);
    // compare pins its head to the viewed revision, so switching
    // revisions ends the comparison
    setCompareData(null);
    autoMarked.current.clear();
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (data) document.title = data.review;
  }, [data?.review]);

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
      if (!st.done && !document.hidden && st.data) {
        try {
          const fresh = await fetchReview(st.data.revision);
          serverOk();
          // busy gates MERGING only (a re-render mid-gesture drops
          // selections) — the fetch above doubles as the liveness probe.
          // Measured after the await, at the moment it protects.
          const busy =
            stateRef.current.done ||
            stateRef.current.composer !== null ||
            touchActive.current ||
            Date.now() - lastSelActivity.current < 2000 ||
            !(window.getSelection()?.isCollapsed ?? true);
          if (!busy) {
            // merged as an updater, against the state as it is when the
            // merge applies: a local write made while this GET was in
            // flight has already run its own updater (arming the unsaved
            // shield) by then, so its sidecar wins over the pre-write data
            setData((current) => {
              if (!current || current.revision !== fresh.revision) return current;
              const now = Date.now();
              const facts = fresh.facts.map((fact) => {
                // recently ACKed or still-unsaved local writes win over
                // poll data (the GET-in-flight race and queued retries)
                const writtenAt = pendingWrites.current.get(fact.path);
                const shielded =
                  (writtenAt !== undefined && now - writtenAt < WRITE_GRACE_MS) ||
                  unsaved.current.has(`${current.revision}:${fact.path}`);
                const local = shielded ? current.facts.find((f) => f.path === fact.path) : undefined;
                return local ? { ...fact, sidecar: local.sidecar } : fact;
              });
              const merged = { ...fresh, facts };
              return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
            });
          }
        } catch (error) {
          if (stateRef.current.done) {
            // the exit after finish/approve is the one legitimate silence
          } else if ((error as { status?: number }).status === 401) {
            // definitive: the server answered and rejected this tab
            setConnLost("unauthorized");
          } else {
            // one failure could be a blip; two in a row is a dead server —
            // say so instead of silently dropping writes
            pollFailures.current += 1;
            if (pollFailures.current >= 2) setConnLost("unreachable");
          }
        }
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
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

  // closing the tab must not lose un-ACKed writes silently
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (unsaved.current.size > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---------- selection capture ----------
  // iOS Safari drops an in-progress selection if the page re-renders, and
  // native handle drags fire no pointer events, so there is no reliable
  // "still dragging" signal. On touch we therefore NEVER touch state while
  // a selection is live — the span is tracked silently in a ref, and only
  // committed when the selection collapses (= the gesture is over). On
  // fine pointers a short settle after the drag is safe.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout>;
    const commit = (span: { path: string; start: number; end: number }): void => {
      setPendingSel((current) =>
        current &&
        current.path === span.path &&
        current.start === span.start &&
        current.end === span.end
          ? current
          : span,
      );
    };
    const settle = (): void => {
      const sel = window.getSelection();
      const container = readRef.current;
      const live =
        sel &&
        !sel.isCollapsed &&
        container &&
        container.contains(sel.anchorNode) &&
        stateRef.current.data;
      if (!COARSE) {
        // desktop: the bubble is a pure mirror of the live selection. While
        // the composer is open ALL selection churn is ignored (medium-
        // editor's stopSelectionUpdates) — its draft anchor must not move.
        if (stateRef.current.composer) return;
        const span = live ? sourceSpanForSelection(container as HTMLElement, sel) : null;
        const path = span ? container!.getAttribute("data-fact-path") : null;
        setLiveSel((current) =>
          span && path
            ? current &&
              current.path === path &&
              current.start === span.start &&
              current.end === span.end
              ? current
              : { path, ...span }
            : null,
        );
        return;
      }
      // touch: capture silently mid-gesture, commit when it ends (iOS
      // drops an in-progress selection if the page re-renders)
      if (live) {
        const span = sourceSpanForSelection(container as HTMLElement, sel);
        const path = container.getAttribute("data-fact-path");
        if (span && path) lastSpan.current = { path, ...span };
      } else if (lastSpan.current) {
        commit(lastSpan.current);
      }
    };
    const onSelection = (): void => {
      lastSelActivity.current = Date.now();
      clearTimeout(debounce);
      // coarse keeps the long iOS buffer. Fine pointers gate on the mouse
      // button instead (Hypothesis adder / Plate floating-toolbar pattern):
      // nothing fires mid-drag, so selectionchange only covers keyboard
      // selections, with a short trailing debounce.
      if (COARSE) debounce = setTimeout(settle, 250);
      else if (!touchActive.current) debounce = setTimeout(settle, 100);
    };
    const onPointerDown = (): void => {
      touchActive.current = true;
    };
    const onPointerUp = (): void => {
      touchActive.current = false;
      if (!COARSE) {
        // the selection is final a tick after mouseup — show near-instantly
        // (Hypothesis uses 10ms here)
        clearTimeout(debounce);
        debounce = setTimeout(settle, 10);
      }
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      clearTimeout(debounce);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, []);

  // ---------- derived ----------
  // Compare mode reuses the whole changed-since machinery by swapping the
  // basis: normally the previous revision, in compare mode the chosen
  // base. Ghosts, badges, and scopes all follow.
  const compareOn = compareData !== null;
  const compareBase = compareData?.revision ?? null;
  // every revision but the served one is read-only — feedback on old text
  // refers to words iteration no longer starts from (the server rejects
  // such writes too)
  const staleReadOnly = data !== null && data.revision !== data.served;
  const readOnly = compareOn || staleReadOnly;
  const basisData = compareData ?? prevData;
  const baseMap = useMemo(() => (basisData ? contentMap(basisData.facts) : null), [basisData]);
  // facts deleted since the basis revision, resurrected read-only from
  // the basis revision's copy (baseMap already holds their content)
  const ghosts = useMemo(() => {
    if (!baseMap || !data) return [];
    const live = new Set(data.facts.map((f) => f.path));
    return [...baseMap.entries()]
      .filter(([path]) => !live.has(path))
      .map(([path, content]): Fact => ({ path, content, sidecar: null, ghost: true }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [baseMap, data]);
  // every fact a row can name, ghosts included — the one path->fact lookup
  const factMap = useMemo(
    () => new Map([...(data?.facts ?? []), ...ghosts].map((f) => [f.path, f])),
    [data, ghosts],
  );

  const changedFacts = useMemo(
    () => (data?.facts ?? []).filter((f) => changeStatus(baseMap, f) !== undefined),
    [data, baseMap],
  );
  const raisedFacts = useMemo(
    () => (data?.facts ?? []).filter((f) => (f.sidecar?.items?.length ?? 0) > 0),
    [data],
  );
  const scopeCounts = {
    all: data?.facts.length ?? 0,
    changed: changedFacts.length + ghosts.length,
    raised: raisedFacts.length,
  };

  const scopedFacts = useMemo(() => {
    if (scope === "changed") {
      return [...changedFacts, ...ghosts].sort((a, b) => a.path.localeCompare(b.path));
    }
    if (scope === "raised") return raisedFacts;
    return data?.facts ?? [];
  }, [data, scope, changedFacts, raisedFacts, ghosts]);

  const filteredFacts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return scopedFacts;
    const words = query.split(/\s+/);
    return scopedFacts.filter((fact) => {
      const items = fact.sidecar?.items ?? [];
      const itemText = items
        .map((i) => `${i.text ?? ""} ${(i.thread ?? []).map((t) => t.text).join(" ")}`)
        .join(" ");
      const text = `${fact.path} ${fact.content} ${itemText}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [scopedFacts, filter]);
  const filtering = filter.trim().length > 0;
  const narrowing = filtering || scope !== "all";
  // the front page is always there to land on; under a filter or scope it
  // stays only when its overview fact is one of the matches. Never before
  // the data is in: a row before load would become the cursor, and the
  // URL effect would overwrite a deep link with "#/" before load reads it.
  const withRoot =
    data !== null && (!narrowing || filteredFacts.some((f) => f.path === "_index.md"));
  const rows = useMemo(
    () => buildRows(filteredFacts, (dir) => (narrowing ? true : !collapsed.has(dir)), withRoot),
    [filteredFacts, collapsed, narrowing, withRoot],
  );
  const effectiveCursor: Row | null = cursor ?? rows[0] ?? null;
  const cursorIndex = rows.findIndex(
    (r) => r.kind === effectiveCursor?.kind && r.path === effectiveCursor?.path,
  );

  const targetFact: Fact | null = useMemo(() => {
    if (!data || !effectiveCursor) return null;
    if (effectiveCursor.kind === "fact") return factMap.get(effectiveCursor.path) ?? null;
    return indexFactOf(data.facts, effectiveCursor.path);
  }, [data, effectiveCursor, factMap]);
  // a ghost is readable but not actionable: no comments, no seen, no select
  const targetIsGhost = targetFact?.ghost === true;

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

  // cursor -> URL: every page the user reaches becomes a history entry.
  // A popstate-restored cursor already matches the hash, so no re-push;
  // the pre-navigation initial cursor only replaces.
  useEffect(() => {
    if (!effectiveCursor) return;
    const target = `#${encodeURI(effectiveCursor.path)}${effectiveCursor.kind === "dir" ? "/" : ""}`;
    if (location.hash === target) return;
    if (userMoved.current) history.pushState(null, "", target);
    else history.replaceState(null, "", target);
  }, [effectiveCursor?.kind, effectiveCursor?.path]);

  // URL -> cursor: back/forward re-open the page named by the hash
  useEffect(() => {
    const onPop = (): void => {
      setCursor(cursorFromHash(stateRef.current.data?.facts ?? []));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a composer, a pending selection, and an open thread belong to the
  // fact they started on
  useEffect(() => {
    if (composer && composer.path !== targetFact?.path) setComposer(null);
    setPendingSel((p) => (p && p.path !== targetFact?.path ? null : p));
    setLiveSel((s) => (s && s.path !== targetFact?.path ? null : s));
    if (lastSpan.current && lastSpan.current.path !== targetFact?.path) {
      lastSpan.current = null;
    }
    setOpenThreadId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path]);

  // the item whose anchor is lit in the reading pane: the open thread's,
  // else the hovered or focused card's
  const litItemId = openThreadId ?? focusItemId;

  // auto-seen on dwell, only after the user has actually navigated. The
  // mark waits out any active touch/selection — its re-render would make
  // iOS drop an in-progress selection.
  useEffect(() => {
    const fact = targetFact;
    // reading a diff is not reading the fact — no seen marks in compare
    if (!fact || !data || !userMoved.current || targetIsGhost || readOnly) return;
    if (seen.has(fact.path) || autoMarked.current.has(fact.path)) return;
    let timer: ReturnType<typeof setTimeout>;
    const fire = (): void => {
      if (
        touchActive.current ||
        Date.now() - lastSelActivity.current < 2000 ||
        !(window.getSelection()?.isCollapsed ?? true)
      ) {
        timer = setTimeout(fire, 1500);
        return;
      }
      autoMarked.current.add(fact.path);
      markSeen(fact);
    };
    timer = setTimeout(fire, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path, data, seen, readOnly]);

  // ---------- liveness ----------
  // Every successful round-trip is proof of life; one owner for the
  // bookkeeping so a PUT and a GET count the same.
  function serverOk(): void {
    lastPollOk.current = Date.now();
    pollFailures.current = 0;
    setConnLost((lost) => (lost === null ? lost : null));
  }

  // ---------- compare mode ----------
  async function startCompare(base: number): Promise<void> {
    if (!data || base >= data.revision) return;
    const entering = compareData === null;
    try {
      // fetched fresh even for the previous revision already in hand:
      // the files are the record, and anything may have written them
      // since load
      const baseReview = await fetchReview(base);
      serverOk();
      if (entering) {
        // the scope outside is kept for the way back; the mode resumes
        // the scope it last had — "changed" at first, since the changes
        // are what a comparison is for
        compareMemo.current.outside = scope;
        setScope(compareMemo.current.inside);
      }
      compareMemo.current.base = base;
      setCompareData(baseReview);
      setComposer(null);
      setOpenThreadId(null);
      setPendingSel(null);
      setLiveSel(null);
    } catch {
      setToast({ message: `Couldn't load revision ${base}.` });
    }
  }

  function exitCompare(): void {
    compareMemo.current.inside = scope;
    setScope(compareMemo.current.outside);
    setCompareData(null);
    setOpenThreadId(null); // a base-revision thread must not carry over
  }

  // the one switch between the diff and the revision itself: back to
  // the base last chosen (the previous revision until one is), with the
  // scope and layout each side had
  function toggleCompare(): void {
    if (!data) return;
    if (compareData !== null) {
      exitCompare();
      return;
    }
    if (prevData === null) {
      setToast({ message: "Nothing to compare — this is the first revision." });
      return;
    }
    const remembered = compareMemo.current.base;
    const base =
      remembered !== null && remembered < data.revision && data.revisions.includes(remembered)
        ? remembered
        : prevData.revision;
    void startCompare(base);
  }

  // ---------- sidecar writes ----------
  // Called inside setData updaters — touch refs only, defer the flush.
  // pendingWrites is stamped on ACK (in flushWrites), not here: until the
  // ACK, the unsaved entry itself is what shields the fact from the poll.
  function putSidecar(revision: number, fact: Fact): void {
    unsaved.current.set(`${revision}:${fact.path}`, {
      revision,
      path: fact.path,
      sidecar: fact.sidecar ?? {},
    });
    if (flushQueued.current) return;
    flushQueued.current = true;
    setTimeout(() => {
      flushQueued.current = false;
      setUnsavedCount(unsaved.current.size);
      void flushWrites();
    }, 0);
  }

  // Drain the unsaved queue; entries are one-per-fact and independent, so
  // they go out concurrently. A write leaves the queue only on a 2xx; a
  // failed one stays and the retry timer below is the sole retry driver —
  // the liveness banner, not this loop, is what tells the user.
  async function flushWrites(): Promise<void> {
    if (flushing.current) return;
    flushing.current = true;
    try {
      await Promise.all(
        [...unsaved.current].map(async ([key, write]) => {
          try {
            const res = await fetch("/api/sidecar", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(write),
            });
            if (res.status === 401) return setConnLost("unauthorized");
            if (!res.ok) {
              // a 4xx is the server's verdict (a read-only revision, a
              // fact that no longer exists): no retry can land it, so it
              // leaves the queue with the reason instead of retrying forever
              if (res.status < 500 && unsaved.current.get(key) === write) {
                unsaved.current.delete(key);
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                setToast({ message: `Not saved: ${body?.error ?? `HTTP ${res.status}`}` });
              }
              return;
            }
            serverOk();
            pendingWrites.current.set(write.path, Date.now());
            // a newer write for this fact may have queued while this one
            // was in flight — only clear the entry we actually sent
            if (unsaved.current.get(key) === write) unsaved.current.delete(key);
          } catch {
            /* stays queued for the retry below */
          }
        }),
      );
    } finally {
      flushing.current = false;
      setUnsavedCount(unsaved.current.size);
      if (unsaved.current.size > 0 && flushTimer.current === null) {
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          void flushWrites();
        }, POLL_MS);
      }
    }
  }

  // The one funnel every sidecar write passes through, so the served-
  // revision rule holds here regardless of which handler, undo closure,
  // or stale callback asked: judged against the state as it is when the
  // update applies, not the render that made the closure.
  function mutateFact(path: string, fn: (sidecar: Sidecar) => void): void {
    setData((current) => {
      if (!current || current.revision !== current.served) return current;
      const facts = current.facts.map((fact) => {
        if (fact.path !== path) return fact;
        const sidecar: Sidecar = structuredClone(fact.sidecar ?? {});
        fn(sidecar);
        const next = { ...fact, sidecar: normalizeSidecar(sidecar) };
        putSidecar(current.revision, next);
        return next;
      });
      return { ...current, facts };
    });
  }

  function beginItem(type: SidecarItem["type"]): void {
    if (!targetFact || targetIsGhost || readOnly) return;
    // both comments and questions anchor when text is selected;
    // live selection first, then the pending (survives iOS collapse)
    let anchor: Anchor | undefined;
    const sel = window.getSelection();
    const container = readRef.current;
    let span: { start: number; end: number } | null = null;
    if (sel && !sel.isCollapsed && container && container.contains(sel.anchorNode)) {
      span = sourceSpanForSelection(container as HTMLElement, sel);
    }
    if (!span && !COARSE && liveSel?.path === targetFact.path) span = liveSel;
    if (!span && pendingSel?.path === targetFact.path) span = pendingSel;
    if (!span && lastSpan.current?.path === targetFact.path) span = lastSpan.current;
    if (span) anchor = describeAnchor(targetFact.content, span.start, span.end);
    // desktop: the span becomes the composer's draft anchor — the only
    // moment pendingSel (and its painted highlight) exists on fine pointers
    if (!COARSE) {
      setPendingSel(span ? { path: targetFact.path, start: span.start, end: span.end } : null);
    }
    setOpenThreadId(null); // the composer renders in the list view
    setComposer({ mode: "new", type, path: targetFact.path, anchor });
    setPanelOpen(true); // on mobile the composer lives in the bottom sheet
  }

  // the ONE way out of a composer without saving — every path that drops
  // one (empty save, Escape, the panel's Cancel button, a thread opening
  // over it) must drop the desktop draft anchor too, or a stale span
  // re-shows highlight or bubble with no native selection behind it
  // (touch keeps its bar, re-actionable)
  function dropComposer(): void {
    setComposer(null);
    if (!COARSE) {
      setPendingSel(null);
      setLiveSel(null);
    }
  }

  function cancelComposer(): void {
    dropComposer();
    closeSheetIfOverlay();
  }

  function commitComposer(text: string): void {
    const active = composer;
    if (!active || !text.trim()) {
      cancelComposer();
      return;
    }
    const body = text.trim();
    setPendingSel(null);
    setLiveSel(null);
    lastSpan.current = null; // a later collapse must not resurrect the bar
    if (active.mode === "new") {
      mutateFact(active.path, (sidecar) => {
        const items = (sidecar.items ??= []);
        const id = nextId(items, active.type === "question" ? "q" : "c");
        const item: SidecarItem = { id, type: active.type };
        if (active.anchor) item.anchor = active.anchor;
        if (active.type === "question") item.thread = [{ who: "human", text: body }];
        else item.text = body;
        items.push(item);
        if (active.type !== "question") undoStack.current.push({ path: active.path, id });
      });
    } else {
      mutateFact(active.path, (sidecar) => {
        const item = sidecar.items?.find((i) => i.id === active.id);
        if (!item) return;
        if (item.type === "question" && item.thread?.length) item.thread[0]!.text = body;
        else item.text = body;
      });
    }
    setComposer(null);
    closeSheetIfOverlay();
  }

  // the one way threads open or close. An open composer would keep
  // running invisibly under the subpage (its busy gate would even stall
  // poll merges), so it is dropped first.
  function openThread(id: string | null): void {
    if (id !== null && composer) dropComposer();
    setOpenThreadId(id);
  }

  // replies come from the thread subpage's own box, not the composer
  function submitReply(id: string, text: string): void {
    const body = text.trim();
    if (!targetFact || targetIsGhost || readOnly || !body) return;
    mutateFact(targetFact.path, (sidecar) => {
      const item = sidecar.items?.find((i) => i.id === id);
      if (item) (item.thread ??= []).push({ who: "human", text: body });
    });
  }

  function deleteItem(path: string, id: string): void {
    const item = data?.facts
      .find((f) => f.path === path)
      ?.sidecar?.items?.find((i) => i.id === id);
    if (!item) return;
    const revision = structuredClone(item);
    mutateFact(path, (sidecar) => {
      sidecar.items = sidecar.items?.filter((i) => i.id !== id);
    });
    setToast({
      message: `Deleted ${id}`,
      undo: () => {
        mutateFact(path, (sidecar) => (sidecar.items ??= []).push(revision));
        setToast(null);
      },
    });
  }

  function undoLast(): void {
    if (readOnly) return; // read-only, like every other write path
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
      // a directory row stands for its index fact — the overview, for the
      // front page — so a question raised there is reachable like any other
      const fact =
        row.kind === "fact"
          ? data.facts.find((f) => f.path === row.path)
          : indexFactOf(data.facts, row.path);
      if (fact && predicate(fact)) {
        setCursor(row);
        return;
      }
    }
  }

  function openRow(row: Row): void {
    userMoved.current = true;
    setCursor(row);
    if (row.kind === "fact" && isMobile()) setTreeOpen(false);
  }

  function toggleSeen(advance: boolean): void {
    if (!targetFact || targetIsGhost || readOnly) return;
    if (seen.has(targetFact.path) && !advance) unmarkSeen(targetFact.path);
    else markSeen(targetFact);
    if (advance) moveCursorWhere((f) => !seen.has(f.path) && f.path !== targetFact.path, 1);
  }

  // One protocol for both terminal actions: drain unsaved writes first
  // (bounce only if they still won't land), demand a real response, and
  // accept a dropped request as the server's exit race only if it was
  // provably alive moments ago — a dead tab gets the liveness banner,
  // never a false "the agent has been notified".
  async function endSession(action: "Finish" | "Approve", doneMessage: string): Promise<void> {
    if (unsaved.current.size > 0) {
      await flushWrites();
      if (unsaved.current.size > 0) {
        setToast({ message: `${unsavedPhrase(unsaved.current.size)} not saved yet — retrying, hold on.` });
        return;
      }
    }
    try {
      const res = await fetch(action === "Finish" ? "/api/finish" : "/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: data?.revision }),
      });
      if (res.status === 401) return setConnLost("unauthorized");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setToast({ message: `${action} failed: ${body?.error ?? `HTTP ${res.status}`}` });
        return;
      }
    } catch {
      if (POLL_DISABLED || Date.now() - lastPollOk.current < RECENT_LIVE_MS) {
        // the server exits as it answers; a drop this close to a live
        // heartbeat is that race, not a dead tab
      } else {
        setConnLost("unreachable");
        return;
      }
    }
    setDone(doneMessage);
  }

  const finish = (): Promise<void> =>
    endSession("Finish", "Review finished. The agent has been notified — you can close this tab.");
  const approve = (): Promise<void> =>
    endSession("Approve", `Revision ${data?.revision} approved — promoted to approved/.`);

  // ---------- lightbox ----------
  // The images and diagrams of one fact body open in one gallery. Fact
  // HTML is innerHTML-injected, so the click is delegated from the
  // reading column rather than carried by the figures themselves.
  function openGallery(target: Element): void {
    const figure = target.closest(FIGURE);
    const body = figure?.closest(".fact-body");
    if (!figure || !body) return;
    const figures = Array.from(body.querySelectorAll(FIGURE));
    const pswp = new PhotoSwipe({
      dataSource: figures.map((el) =>
        el instanceof HTMLImageElement
          ? {
              src: el.currentSrc || el.src,
              // the clicked image is loaded, siblings may still be lazy —
              // natural sizes are a hint, PhotoSwipe corrects after decode
              width: el.naturalWidth || 1600,
              height: el.naturalHeight || 1200,
              alt: el.alt,
              // already-loaded pixels as placeholder while full decodes
              msrc: el.currentSrc || el.src,
            }
          : diagramSlide(el as SVGSVGElement),
      ),
      index: Math.max(0, figures.indexOf(figure)),
      wheelToZoom: true,
      // instant open/close (owner call, after trying zoom and fade):
      // figures here are opened to inspect, many times a session — any
      // transition is one you end up watching
      showHideAnimationType: "none",
    });
    // html content is unzoomable by PhotoSwipe's default; a diagram is
    // opened precisely to zoom into it
    pswp.addFilter(
      "isContentZoomable",
      (zoomable, content) => zoomable || content.data.type === "html",
    );
    pswp.on("destroy", () => {
      if (pswpRef.current === pswp) pswpRef.current = null;
    });
    pswpRef.current = pswp;
    pswp.init();
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
      if (effectiveCursor?.kind === "dir" && !isRoot(effectiveCursor)) {
        setCollapsed((c) => {
          const next = new Set(c);
          next.delete(effectiveCursor.path);
          return next;
        });
      }
    },
    collapse: () => {
      if (effectiveCursor?.kind === "dir" && !isRoot(effectiveCursor)) {
        setCollapsed((c) => new Set(c).add(effectiveCursor.path));
      }
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
      // PhotoSwipe closes itself on Escape; this keeps the same keypress
      // from ALSO falling through to clear selection underneath
      if (pswpRef.current) pswpRef.current.close();
      else if (composer) cancelComposer();
      else if (overlay) setOverlay(null);
      else if (pendingSel || liveSel) {
        setPendingSel(null);
        setLiveSel(null);
        lastSpan.current = null;
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
              // an Escape a layer already consumed (a Radix dropdown
              // closing itself) must not also fire the close chain
              if (e.defaultPrevented) return;
              e.preventDefault();
              run(def.id);
            }
          : (e) => {
              const target = e.target as HTMLElement | null;
              if (e.isComposing) return;
              // an element that handled the key itself (a card opening on
              // Enter, a menu item) must not also fire the shortcut
              if (e.defaultPrevented) return;
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
  // which revision the change badges and ghosts are measured against —
  // the previous one, or the compare base while comparing
  const basisRevision = basisData?.revision ?? null;
  // the fact whose notes the panel holds: the base revision's copy of the
  // viewed fact while comparing (its notes were raised on that text),
  // the viewed fact otherwise. Anchors, chips, the lit highlight, and the
  // fab and rail badges all follow this one choice.
  const notesFact: Fact | null = compareOn
    ? (compareData.facts.find((f) => f.path === targetFact?.path) ?? null)
    : targetIsGhost
      ? null
      : targetFact;
  const readonlyRevision = compareOn ? compareBase : staleReadOnly ? data!.revision : null;
  const panelBadge = notesFact ? factStats(notesFact).items : 0;

  useEffect(() => pswpRef.current?.close(), [targetFact?.path]);

  const factHtml = useMemo(() => {
    if (!targetFact || !data) return "";
    // a ghost's images live in the revision it was deleted from
    const revision = targetFact.ghost ? (basisRevision ?? data.revision) : data.revision;
    return renderMarkdown(targetFact.content, {
      assetBase: `/asset/${revision}/`,
      factDir: dirOf(targetFact.path),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact, data, basisRevision]);

  const anchorStates = useMemo(() => {
    const states = new Map<string, AnchorState>();
    for (const item of notesFact?.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(notesFact!.content, item.anchor);
      states.set(item.id, resolved ? resolved.state : "detached");
    }
    return states;
  }, [notesFact]);

  const factHtmls = useMemo(() => [factHtml], [factHtml]);
  const factHtmlProp = useMermaidHtml(factHtmls)[0]!;

  useEffect(() => {
    // the reading pane holds the viewed fact; while comparing it exists
    // only for an unchanged fact, whose text the base notes were raised
    // on too — so notesFact's anchors resolve against it either way
    const pane = readRef.current;
    if (!pane || !notesFact) return;
    const clearNotes = paintNotes(notesFact.sidecar?.items ?? [], litItemId, (anchor) => {
      const resolved = resolveAnchor(notesFact.content, anchor);
      const range = resolved && rangeForSourceSpan(pane, resolved.start, resolved.end);
      return range ? [range] : [];
    });
    // On fine pointers the native selection IS the highlight while it is
    // live (every studied implementation — Hypothesis, medium-editor,
    // Plate, tiptap — relies on it); rk-pending paints only once the
    // composer owns the screen and the native selection is free to
    // collapse. Touch paints throughout — iOS collapses on any tap.
    const pending =
      pendingSel && pendingSel.path === notesFact.path && (COARSE || composer)
        ? rangeForSourceSpan(pane, pendingSel.start, pendingSel.end)
        : null;
    setHighlight("rk-pending", pending ? [pending] : []);
    return () => {
      clearNotes();
      clearHighlight("rk-pending");
    };
    // keyed on factHtmlProp, not factHtml: the mermaid splice rewrites
    // innerHTML without changing factHtml, detaching every Range the
    // highlights hold — they must rebuild against the new DOM. compareOn
    // is here because entering compare unmounts the pane (the ranges
    // would pin the detached subtree) and leaving it mounts a fresh one.
  }, [factHtmlProp, notesFact, litItemId, pendingSel, composer, compareOn]);

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
  const latestRevision = Math.max(...data.revisions);

  // The viewed fact's body — its text, or its diff while comparing (an
  // unchanged fact reads as itself, said so). One element for both
  // pages: the fact page, and the directory page whose index fact it is
  // (the overview, on the front page), so the diff reaches there too.
  const targetStatus = targetFact ? changeStatus(baseMap, targetFact) : undefined;
  const factArticle = targetFact && (
    <article
      className="fact-body"
      id="fact-content"
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
        Unchanged since revision {compareBase}.
      </div>
      {factArticle}
    </>
  ) : (
    <DiffView
      before={baseMap?.get(targetFact.path) ?? ""}
      after={targetFact.ghost ? "" : targetFact.content}
      layout={diffLayout}
      baseAsset={`/asset/${compareBase}/`}
      headAsset={`/asset/${data.revision}/`}
      factDir={dirOf(targetFact.path)}
      notes={notesFact?.sidecar?.items}
      litId={litItemId}
    />
  );

  return (
    <div className="app">
      <header className="hdr">
        <Button
          variant="ghost"
          size="icon-sm"
          className="hamburger"
          id="btn-tree"
          aria-label="Toggle fact tree"
          onClick={() => setTreeOpen((open) => !open)}
        >
          <Menu />
        </Button>
        <h1>
          <span id="review-name">{data.review}</span>
        </h1>
        <span className="progress stat" id="progress">
          <span className="max-[560px]:hidden">
            {progress.seen} / {progress.total} reviewed
          </span>
          {/* sequential readers care where they ARE, not how much is seen */}
          <span className="hidden max-[560px]:inline">
            {cursorIndex + 1}/{rows.length}
          </span>
        </span>
        <span aria-live="polite">
          {openQuestions.total > 0 && (
            <button
              className={`pill ${yourTurn ? "attn" : ""}`}
              id="question-pill"
              onClick={() => moveCursorWhere((f) => factStats(f).questions > 0, 1)}
            >
              <span className="max-[560px]:hidden">
                {yourTurn
                  ? `${yourTurn} answered — your turn`
                  : `${openQuestions.total} open question${openQuestions.total > 1 ? "s" : ""}`}
              </span>
              <span className="hidden items-center gap-1 max-[560px]:inline-flex">
                <MessageCircleQuestion className="lucide size-3.5" size={14} />
                {yourTurn || openQuestions.total}
              </span>
            </button>
          )}
        </span>
        <span className="spacer" />
        {/* owner: "just a simple toggle" — flips light/dark; the palette
            still offers "Theme: system" to hand control back to the OS */}
        <Button
          variant="ghost"
          size="icon-sm"
          id="btn-help"
          aria-label="Help"
          title="Shortcuts & concepts (?)"
          onClick={() => setOverlay((o) => (o === "help" ? null : "help"))}
        >
          <CircleHelp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          id="btn-theme"
          aria-label={effectiveDark ? "Switch to light theme" : "Switch to dark theme"}
          title={effectiveDark ? "Light theme" : "Dark theme"}
          onClick={() => setTheme(effectiveDark ? "light" : "dark")}
        >
          {effectiveDark ? <Moon /> : <Sun />}
        </Button>
        {prevData !== null && (
          <Button
            variant="ghost"
            size="icon-sm"
            id="btn-compare"
            className={compareOn ? "compare-active" : ""}
            aria-label={compareOn ? "Exit compare" : "Compare revisions"}
            aria-pressed={compareOn}
            aria-keyshortcuts={keyFor("compare")}
            title={`${compareOn ? "Exit compare" : "Compare revisions"}${
              COARSE ? "" : ` (${keyFor("compare")})`
            }`}
            onClick={toggleCompare}
          >
            <GitCompareArrows />
          </Button>
        )}
        <Select
          value={String(data.revision)}
          onValueChange={(value) => void load(Number(value))}
        >
          <SelectTrigger
            size="sm"
            id="revision-select"
            aria-label="Revision"
            title={
              data.revision === latestRevision
                ? undefined
                : `Older revision — ${latestRevision} is latest`
            }
            className={`revision-select w-[140px] max-[560px]:w-[76px] ${
              data.revision === latestRevision ? "" : "revision-stale"
            }`}
          >
            <span className="max-[560px]:hidden">
              <SelectValue />
            </span>
            <span className="hidden max-[560px]:inline">S{data.revision}</span>
          </SelectTrigger>
          <SelectContent>
            {data.revisions.map((s) => (
              <SelectItem key={s} value={String(s)}>
                Revision {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unsavedCount > 0 && (
          <span className="pill unsaved-pill" id="unsaved-pill" role="status">
            {unsavedCount} unsaved
          </span>
        )}
        <Button size="sm" id="btn-finish" onClick={() => setOverlay("finish")}>
          <span className="max-[560px]:hidden">Finish review</span>
          <span className="hidden max-[560px]:inline">Finish</span>
        </Button>
      </header>
      {connLost && (
        <div className="conn-banner" id="conn-banner" role="alert">
          {connLost === "unauthorized"
            ? "This tab lost its session — nothing is being saved. Restart the session and use the fresh link."
            : "Session unreachable — nothing is being saved. Reconnecting…"}
          {unsavedCount > 0 && ` ${unsavedPhrase(unsavedCount)} pending.`}
        </div>
      )}
      {staleReadOnly && (
        <div className="stale-banner" id="stale-banner" role="status">
          Viewing revision {data.revision} read-only — the session serves {data.served} ·{" "}
          <button onClick={() => void load(data.served)}>Switch</button>
        </div>
      )}
      {compareOn && (
        <div className="compare-bar" id="compare-bar">
          <GitCompareArrows className="lucide size-3.5" size={14} aria-hidden="true" />
          {/* the announceable text alone is the live region — the visible
              controls never belong inside one */}
          <span className="sr-only" role="status">
            Comparing revision {compareBase} to revision {data.revision} — read-only
          </span>
          <span className="compare-label">
            Changes from revision
            <Select
              value={String(compareBase)}
              onValueChange={(value) => void startCompare(Number(value))}
            >
              <SelectTrigger size="sm" id="compare-base" aria-label="Compare base revision" className="compare-base-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.revisions
                  .filter((r) => r < data.revision)
                  .map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            to {data.revision} — read-only
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
          {/* the toggle is learned here, where it matters most: the
              key flips between the diff and the revision itself */}
          {!COARSE && (
            <Kbd title="Toggle compare">{keyFor("compare")}</Kbd>
          )}
        </div>
      )}

      <div className="cols">
        {treeOpen && <div className="scrim" onClick={() => setTreeOpen(false)} />}
        <nav className="tree-col" aria-label="Facts" data-open={treeOpen ? "" : undefined}>
          {/* pinned while the tree scrolls; the input and scope chip share the row */}
          <div className="tree-filter">
            <div className="filter-box">
                <Search className="lucide filter-icon size-3.5" size={14} aria-hidden="true" />
                <Input
                  id="tree-filter"
                  className="pl-7"
                  placeholder={COARSE ? "Filter facts" : "Filter facts (f)"}
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
              <Select value={scope} onValueChange={(v) => v && setScope(v as Scope)}>
                <SelectTrigger
                  size="sm"
                  id="scope-btn"
                  aria-label={`Scope: ${SCOPE_LABEL[scope]}`}
                  className={`gap-1.5 px-2.5 text-[12px] ${scope !== "all" ? "scope-active" : ""}`}
                >
                  {SCOPE_LABEL[scope]}
                  <span className="scope-count">{scopeCounts[scope]}</span>
                </SelectTrigger>
                <SelectContent align="end">
                  {SCOPES.map((s) => (
                    <SelectItem key={s} value={s} id={`scope-${s}`} disabled={s === "changed" && !baseMap}>
                      <span className="flex-1">{SCOPE_LABEL[s]}</span>
                      <span className="scope-count">{scopeCounts[s]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
          <div className="drawer-tools">
            <span className="stat text-muted-foreground flex-1 self-center text-[13px]">
              {progress.seen} / {progress.total} reviewed
            </span>
          </div>
          {narrowing && (
            <div className="filter-count" aria-live="polite">
              {filtering
                ? `${filteredFacts.length} match${filteredFacts.length === 1 ? "" : "es"}${
                    scope !== "all" ? ` in ${SCOPE_LABEL[scope].toLowerCase()}` : ""
                  }`
                : scope === "changed"
                  ? `${scopeCounts.changed} changed since revision ${basisRevision ?? "—"}`
                  : `${scopeCounts.raised} with notes`}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="tree-empty">
              {filtering
                ? `Nothing matches “${filter.trim()}”.`
                : scope === "changed"
                  ? "Nothing changed in this revision."
                  : "No facts with notes."}
            </div>
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
                  prev={baseMap}
                  fact={row.kind === "fact" ? factMap.get(row.path) : undefined}
                  seen={seen}
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

        <main
          className="read-col"
          ref={readColRef as React.RefObject<HTMLElement>}
          onClick={(e) => openGallery(e.target as Element)}
        >
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
                  {seen.has(targetFact.path) && (
                    <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />
                  )}
                </div>
                {targetIsGhost && !compareOn && (
                  <div className="ghost-banner" id="ghost-banner" role="status">
                    Removed in revision {data.revision} — shown as it was in revision{" "}
                    {basisRevision}. Read-only.
                  </div>
                )}
                {factPane}
              </>
            ) : (
              <p className="text-muted-foreground">
                {filtering ? `Nothing matches “${filter.trim()}”.` : "No facts."}
              </p>
            )}
            {cursorIndex !== -1 && rows.length > 1 && (
              <nav className="pagenav" aria-label="Previous and next fact">
                <button
                  id="nav-prev"
                  className="pagenav-link prev"
                  disabled={cursorIndex <= 0}
                  onClick={() => moveCursor(-1)}
                >
                  <span className="pagenav-dir">← Previous</span>
                  <span className="pagenav-label">
                    {cursorIndex > 0 ? rowLabel(rows[cursorIndex - 1]!) : ""}
                  </span>
                </button>
                <button
                  id="nav-next"
                  className="pagenav-link next"
                  disabled={cursorIndex >= rows.length - 1}
                  onClick={() => moveCursor(1)}
                >
                  <span className="pagenav-dir">Next →</span>
                  <span className="pagenav-label">
                    {cursorIndex < rows.length - 1 ? rowLabel(rows[cursorIndex + 1]!) : ""}
                  </span>
                </button>
              </nav>
            )}
          </div>
        </main>

        {!panelOpen && !pendingSel && (
          <button
            className="panel-fab"
            id="panel-fab"
            aria-label="Open review panel"
            onClick={() => setPanelOpen(true)}
          >
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
              anchorStates={anchorStates}
              composer={composer}
              openThreadId={openThreadId}
              readonlyRevision={readonlyRevision}
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
                  initial:
                    item.type === "question" ? (item.thread?.[0]?.text ?? "") : (item.text ?? ""),
                })
              }
              onDelete={(id) => targetFact && deleteItem(targetFact.path, id)}
              onReanchor={(id) => targetFact && reanchor(targetFact.path, id)}
              onCollapse={() => setPanelOpen(false)}
              onCommit={commitComposer}
              onCancel={cancelComposer}
              canCompare={prevData !== null}
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
            {panelBadge > 0 && <div className="chip count mt-2">{panelBadge}</div>}
          </aside>
        )}
      </div>

      {COARSE
        ? pendingSel &&
          targetFact &&
          !readOnly &&
          pendingSel.path === targetFact.path &&
          !composer && (
            <div
              className="sel-bar"
              id="sel-bar"
              role="toolbar"
              aria-label="Selected text actions"
            >
              <span className="sel-bar-quote">
                “{targetFact.content.slice(pendingSel.start, pendingSel.end)}”
              </span>
              <Button size="sm" onClick={() => beginItem("comment")}>
                <MessageSquare className="lucide size-3.5" size={14} aria-hidden="true" />
                Comment
              </Button>
              <Button size="sm" variant="outline" onClick={() => beginItem("question")}>
                <MessageCircleQuestion className="lucide size-3.5" size={14} aria-hidden="true" />
                Ask
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Dismiss selection"
                onClick={() => {
                  setPendingSel(null);
                  lastSpan.current = null; // else the next tap re-commits it
                }}
              >
                <X />
              </Button>
            </div>
          )
        : liveSel &&
          targetFact &&
          !readOnly &&
          liveSel.path === targetFact.path &&
          !composer && (
            <SelBubble
              span={liveSel}
              quote={targetFact.content.slice(liveSel.start, liveSel.end)}
              readRef={readRef}
              onAct={beginItem}
            />
          )}

      <Help open={overlay === "help"} onClose={() => setOverlay(null)} />
      <FinishSheet
        open={overlay === "finish"}
        data={data}
        progress={progress}
        openQuestions={openQuestions.total}
        raisedFacts={raisedFacts}
        onFinish={() => void finish()}
        onApprove={() => void approve()}
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
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="lucide size-3.5" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}


createRoot(document.getElementById("root")!).render(<App />);
