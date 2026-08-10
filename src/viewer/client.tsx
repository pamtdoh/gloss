import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { tinykeys } from "tinykeys";
import {
  Check,
  ListTodo,
  Menu,
  MessageCircleQuestion,
  Moon,
  PanelRightOpen,
  Search,
  Sun,
  X,
} from "lucide-react";
import PhotoSwipe from "photoswipe";
import type { Sidecar, SidecarItem } from "../summary.js";
import { describeAnchor, resolveAnchor, type Anchor } from "./anchor.js";
import { rangeForSourceSpan, sourceSpanForSelection } from "./dom-anchor.js";
import { renderMarkdown } from "./markdown.js";
import {
  buildRows,
  changeStatus,
  dirOf,
  factStats,
  indexFactOf,
  nextId,
  normalizeSidecar,
  type ChangeStatus,
  type Fact,
  type ReviewData,
  type Row,
} from "./model.js";
import { QUICK_COMMENTS, keepFocusOutOfFields, type Composer, type QuickComment } from "./common.js";
import { ChangeBadge, DirView, SelBubble, TreeRow, rowLabel } from "./components.js";
import { Help, Palette, FinishSheet } from "./overlays.js";
import { Panel } from "./panel.js";
import { SHORTCUTS } from "./shortcuts.js";
import { Button } from "./ui/button.js";
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

// Tree scope, GitHub/GitLab-style but sharper: "changed" is what moved
// since the previous revision (including facts the agent deleted, shown as
// read-only ghosts); "raised" is what the human commented or asked on.
type Scope = "all" | "changed" | "raised";
const SCOPES: Scope[] = ["all", "changed", "raised"];
const SCOPE_LABEL: Record<Scope, string> = { all: "All", changed: "Changed", raised: "Raised" };

// the URL names the page being viewed: "#dir/" or "#dir/fact.md", so
// back/forward walk previously viewed pages and links survive a reload
function cursorFromHash(facts: Fact[]): Row | null {
  const raw = decodeURI(location.hash.slice(1));
  if (!raw) return null;
  if (raw.endsWith("/")) {
    const path = raw.slice(0, -1);
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
const COARSE = window.matchMedia("(pointer: coarse)").matches;

// Mermaid rendering goes THROUGH React state, never DOM mutation: mutating
// dangerouslySetInnerHTML's subtree behind React's back meant any re-render
// of the fact (its own sidecar changing, a poll) reverted the diagram to
// raw source. SVGs are rendered once per source into a module cache and
// spliced into the HTML React owns.
let mermaidSeq = 0;
const mermaidCache = new Map<string, string>(); // source -> svg | "__error__"
let mermaidLoader: Promise<void> | null = null;
function ensureMermaid(): Promise<void> {
  if ((window as unknown as { __rkMermaid?: unknown }).__rkMermaid) return Promise.resolve();
  if (!mermaidLoader) {
    mermaidLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/mermaid.js";
      script.onload = () => resolve();
      script.onerror = () => {
        mermaidLoader = null; // a failed load may retry next time
        script.remove();
        reject(new Error("mermaid failed to load"));
      };
      document.body.appendChild(script);
    });
  }
  return mermaidLoader;
}
const MERMAID_BLOCK = /<pre class="rk-mermaid"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g;
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

async function fetchReview(revision?: number): Promise<ReviewData> {
  const res = await fetch("/api/review" + (revision ? `?revision=${revision}` : ""));
  if (!res.ok) throw new Error(`review fetch failed: ${res.status}`);
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

function App(): React.JSX.Element {
  const [data, setData] = useState<ReviewData | null>(null);
  const [prev, setPrev] = useState<Map<string, string> | null>(null);
  const [cursor, setCursor] = useState<Row | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [seenVersion, setSeenVersion] = useState(0);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [overlay, setOverlay] = useState<"help" | "palette" | "finish" | null>(null);
  const pswpRef = useRef<PhotoSwipe | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
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
    const prior = next.revisions.filter((s) => s < next.revision).pop();
    setPrev(
      prior === undefined
        ? null
        : new Map((await fetchReview(prior)).facts.map((f) => [f.path, f.content])),
    );
    setData(next);
    // deep links land on their page; revision switches keep the place
    setCursor(cursorFromHash(next.facts));
    setSelection(new Set());
    setComposer(null);
    setFilter("");
    setScope("all"); // like the text filter: a new revision starts unscoped
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
      const busy =
        document.hidden ||
        st.done ||
        st.composer !== null ||
        touchActive.current ||
        Date.now() - lastSelActivity.current < 2000 ||
        !(window.getSelection()?.isCollapsed ?? true);
      if (!busy && st.data) {
        try {
          const fresh = await fetchReview(st.data.revision);
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
  // facts deleted since the previous revision, resurrected read-only from
  // the previous revision's copy (prev already holds their content)
  const ghosts = useMemo(() => {
    if (!prev || !data) return [];
    const live = new Set(data.facts.map((f) => f.path));
    return [...prev.entries()]
      .filter(([path]) => !live.has(path))
      .map(([path, content]): Fact => ({ path, content, sidecar: null, ghost: true }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [prev, data]);
  // every fact a row can name, ghosts included — the one path->fact lookup
  const factMap = useMemo(
    () => new Map([...(data?.facts ?? []), ...ghosts].map((f) => [f.path, f])),
    [data, ghosts],
  );

  const changedFacts = useMemo(
    () => (data?.facts ?? []).filter((f) => changeStatus(prev, f) !== undefined),
    [data, prev],
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
  const rows = useMemo(
    () => buildRows(filteredFacts, (dir) => (narrowing ? true : !collapsed.has(dir))),
    [filteredFacts, collapsed, narrowing],
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

  // a composer and a pending selection belong to the fact they started on
  useEffect(() => {
    if (composer && composer.path !== targetFact?.path) setComposer(null);
    setPendingSel((p) => (p && p.path !== targetFact?.path ? null : p));
    setLiveSel((s) => (s && s.path !== targetFact?.path ? null : s));
    if (lastSpan.current && lastSpan.current.path !== targetFact?.path) {
      lastSpan.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFact?.path]);

  // auto-seen on dwell, only after the user has actually navigated. The
  // mark waits out any active touch/selection — its re-render would make
  // iOS drop an in-progress selection.
  useEffect(() => {
    const fact = targetFact;
    if (!fact || !data || !userMoved.current || targetIsGhost) return;
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
  }, [targetFact?.path, data, seen]);

  // ---------- sidecar writes ----------
  function putSidecar(fact: Fact): void {
    if (!data) return;
    pendingWrites.current.set(fact.path, Date.now());
    void fetch("/api/sidecar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision: data.revision,
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

  function applyQuickComment(note: QuickComment, paths?: string[]): void {
    if (!data) return;
    const bulk = !paths && selection.size > 0;
    // ghosts can't get here: not selectable, and the cursor case is guarded
    const targets =
      paths ?? (bulk ? [...selection] : targetFact && !targetIsGhost ? [targetFact.path] : []);
    if (!targets.length) return;
    const created: { path: string; id: string }[] = [];
    for (const path of targets) {
      mutateFact(path, (sidecar) => {
        const items = (sidecar.items ??= []);
        const id = nextId(items, "c");
        items.push({ id, type: "comment", text: note.text });
        created.push({ path, id });
        if (!bulk) undoStack.current.push({ path, id });
      });
    }
    if (!bulk) closeSheetIfOverlay();
    if (bulk) {
      setSelection(new Set());
      setToast({
        message: `Commented “${note.label}” on ${targets.length} facts`,
        undo: () => {
          for (const c of created) {
            mutateFact(c.path, (sidecar) => {
              sidecar.items = sidecar.items?.filter((i) => i.id !== c.id);
            });
          }
          setToast(null);
        },
      });
    }
  }

  function beginItem(type: SidecarItem["type"]): void {
    if (!targetFact || targetIsGhost) return;
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
    setComposer({ mode: "new", type, path: targetFact.path, anchor });
    setPanelOpen(true); // on mobile the composer lives in the bottom sheet
  }

  // the ONE way out of a composer without saving — every cancel path
  // (empty save, Escape, the panel's Cancel button) must drop the desktop
  // draft anchor, or a stale span re-shows highlight or bubble with no
  // native selection behind it (touch keeps its bar, re-actionable)
  function cancelComposer(): void {
    setComposer(null);
    if (!COARSE) {
      setPendingSel(null);
      setLiveSel(null);
    }
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
    closeSheetIfOverlay();
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
    if (row.kind === "fact" && isMobile()) setTreeOpen(false);
  }

  function toggleSeen(advance: boolean): void {
    if (!targetFact || targetIsGhost) return;
    if (seen.has(targetFact.path) && !advance) unmarkSeen(targetFact.path);
    else markSeen(targetFact);
    if (advance) moveCursorWhere((f) => !seen.has(f.path) && f.path !== targetFact.path, 1);
  }

  function toggleSelect(path?: string): void {
    // explicit paths come from table checkboxes, which ghosts never render
    const target =
      path ?? (effectiveCursor?.kind === "fact" && !targetIsGhost ? effectiveCursor.path : null);
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
        body: JSON.stringify({ revision: data?.revision }),
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
        body: JSON.stringify({ revision: data?.revision }),
      });
      if (!res.ok) {
        setToast({ message: `Approve failed: ${(await res.json()).error}` });
        return;
      }
    } catch {
      /* as above */
    }
    setDone(`Revision ${data?.revision} approved — promoted to approved/.`);
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
    notNeeded: () => applyQuickComment(QUICK_COMMENTS[0]!),
    simplify: () => applyQuickComment(QUICK_COMMENTS[1]!),
    defer: () => applyQuickComment(QUICK_COMMENTS[2]!),
    seen: () => toggleSeen(false),
    seenAdvance: () => toggleSeen(true),
    select: () => toggleSelect(),
    comment: () => beginItem("comment"),
    question: () => beginItem("question"),
    undo: () => undoLast(),
    help: () => setOverlay((o) => (o === "help" ? null : "help")),
    palette: () => setOverlay((o) => (o === "palette" ? null : "palette")),
    paletteSlash: () => setOverlay("palette"),
    filter: () => document.getElementById("tree-filter")?.focus(),
    scope: () =>
      setScope((s) => {
        const order = SCOPES.filter((x) => x !== "changed" || prev !== null);
        return order[(order.indexOf(s) + 1) % order.length] ?? "all";
      }),
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
      } else if (selection.size) setSelection(new Set());
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

  const prevRevision = data ? (data.revisions.filter((s) => s < data.revision).pop() ?? null) : null;

  useEffect(() => pswpRef.current?.close(), [renderedFact?.path]);

  const factHtml = useMemo(() => {
    if (!renderedFact || !data) return "";
    // a ghost's images live in the revision it was deleted from
    const revision = renderedFact.ghost ? (prevRevision ?? data.revision) : data.revision;
    return renderMarkdown(renderedFact.content, {
      assetBase: `/asset/${revision}/`,
      factDir: dirOf(renderedFact.path),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedFact, data, prevRevision]);

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
    const buckets: Record<string, Range[]> = {
      "rk-anno": [],
      "rk-question": [],
      "rk-focused": [],
      "rk-pending": [],
    };
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
    // On fine pointers the native selection IS the highlight while it is
    // live (every studied implementation — Hypothesis, medium-editor,
    // Plate, tiptap — relies on it); rk-pending paints only once the
    // composer owns the screen and the native selection is free to
    // collapse. Touch paints throughout — iOS collapses on any tap.
    if (pendingSel && pendingSel.path === renderedFact.path && (COARSE || composer)) {
      const range = rangeForSourceSpan(
        readRef.current as HTMLElement,
        pendingSel.start,
        pendingSel.end,
      );
      if (range) buckets["rk-pending"]!.push(range);
    }
    for (const [name, ranges] of Object.entries(buckets)) {
      highlights.set(name, new HighlightCtor(...ranges));
    }
    return () => {
      for (const name of Object.keys(buckets)) highlights.delete(name);
    };
  }, [factHtml, renderedFact, focusItemId, pendingSel, composer]);

  const [diagramVersion, setDiagramVersion] = useState(0);
  useEffect(() => {
    const sources = [...factHtml.matchAll(MERMAID_BLOCK)].map((m) => unescapeHtml(m[1]!));
    const missing = sources.filter((src) => !mermaidCache.has(src));
    if (!missing.length) return;
    let cancelled = false;
    void ensureMermaid()
      .then(async () => {
        const mermaid = (window as unknown as {
          __rkMermaid: { render: (id: string, src: string) => Promise<{ svg: string }> };
        }).__rkMermaid;
        for (const src of missing) {
          if (mermaidCache.has(src)) continue;
          try {
            const { svg } = await mermaid.render(`rk-mmd-${++mermaidSeq}`, src);
            mermaidCache.set(src, svg);
          } catch {
            mermaidCache.set(src, "__error__");
          }
        }
        if (!cancelled) setDiagramVersion((v) => v + 1);
      })
      .catch(() => {
        /* load failed; a later view retries */
      });
    return () => {
      cancelled = true;
    };
  }, [factHtml]);

  // splice cached SVGs into the HTML React owns — re-renders are now stable
  const processedHtml = useMemo(() => {
    void diagramVersion;
    return factHtml.replace(MERMAID_BLOCK, (block, code: string) => {
      const svg = mermaidCache.get(unescapeHtml(code));
      if (!svg) return block; // still loading: show the source
      if (svg === "__error__") {
        return `<pre class="rk-mermaid" data-error="1"><code>${code}</code></pre>`;
      }
      return `<div class="rk-mermaid">${svg}</div>`;
    });
  }, [factHtml, diagramVersion]);

  // React 19 diffs dangerouslySetInnerHTML by OBJECT identity, not by the
  // __html string: a fresh {__html} object every render rewrites innerHTML
  // even when the markup is byte-identical — destroying the reader's live
  // text selection (and, before the mermaid cache, the rendered diagrams).
  // One memoized object per markup value makes re-renders truly inert.
  const factHtmlProp = useMemo(() => ({ __html: processedHtml }), [processedHtml]);

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
          id="btn-theme"
          aria-label={effectiveDark ? "Switch to light theme" : "Switch to dark theme"}
          title={effectiveDark ? "Light theme" : "Dark theme"}
          onClick={() => setTheme(effectiveDark ? "light" : "dark")}
        >
          {effectiveDark ? <Moon /> : <Sun />}
        </Button>
        <Select
          value={String(data.revision)}
          onValueChange={(value) => void load(Number(value))}
        >
          <SelectTrigger
            size="sm"
            id="revision-select"
            aria-label="Revision"
            title={
              data.revision === Math.max(...data.revisions)
                ? undefined
                : `Older revision — ${Math.max(...data.revisions)} is latest`
            }
            className={`revision-select w-[140px] max-[560px]:w-[76px] ${
              data.revision === Math.max(...data.revisions) ? "" : "revision-stale"
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
        <Button size="sm" id="btn-finish" onClick={() => setOverlay("finish")}>
          <span className="max-[560px]:hidden">Finish review</span>
          <span className="hidden max-[560px]:inline">Finish</span>
        </Button>
      </header>
      {data.revision !== latestRevision && (
        <div className="stale-banner" id="stale-banner" role="status">
          Viewing revision {data.revision} — latest is {latestRevision} ·{" "}
          <button onClick={() => void load(latestRevision)}>Switch</button>
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
                    <SelectItem key={s} value={s} id={`scope-${s}`} disabled={s === "changed" && !prev}>
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
                  ? `${scopeCounts.changed} changed since revision ${prevRevision ?? "—"}`
                  : `${scopeCounts.raised} with notes or questions`}
            </div>
          )}
          {rows.length === 0 ? (
            <div className="tree-empty">
              {filtering
                ? `Nothing matches “${filter.trim()}”.`
                : scope === "changed"
                  ? "Nothing changed in this revision."
                  : "No facts with notes or questions."}
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
                  prev={prev}
                  fact={row.kind === "fact" ? factMap.get(row.path) : undefined}
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

        <main
          className="read-col"
          ref={readColRef as React.RefObject<HTMLElement>}
          onClick={(e) => {
            // delegated: fact HTML is innerHTML-injected, so images can't
            // carry their own React handlers
            const target = e.target as HTMLElement;
            if (!(target instanceof HTMLImageElement)) return;
            const body = target.closest(".fact-body");
            if (!body) return;
            const imgs = Array.from(body.querySelectorAll("img"));
            // the clicked image is loaded, siblings may still be lazy —
            // natural sizes are a hint, PhotoSwipe corrects after decode
            const pswp = new PhotoSwipe({
              dataSource: imgs.map((el) => ({
                src: el.currentSrc || el.src,
                width: el.naturalWidth || 1600,
                height: el.naturalHeight || 1200,
                alt: el.alt,
                // already-loaded pixels as placeholder while full decodes
                msrc: el.currentSrc || el.src,
              })),
              index: Math.max(0, imgs.indexOf(target)),
              wheelToZoom: true,
              // instant open/close (owner call, after trying zoom and
              // fade): images here are opened to inspect, many times a
              // session — any transition is one you end up watching
              showHideAnimationType: "none",
            });
            pswp.on("destroy", () => {
              if (pswpRef.current === pswp) pswpRef.current = null;
            });
            pswpRef.current = pswp;
            pswp.init();
          }}
        >
          <div className="read-inner">
            {effectiveCursor?.kind === "dir" ? (
              <DirView
                dir={effectiveCursor.path}
                data={data}
                facts={filteredFacts}
                prev={prev}
                seen={seen}
                selection={selection}
                indexHtml={factHtmlProp}
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
                onQuickComment={(path, note) => applyQuickComment(note, [path])}
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
                {targetIsGhost && (
                  <div className="ghost-banner" id="ghost-banner" role="status">
                    Removed in revision {data.revision} — shown as it was in revision{" "}
                    {prevRevision}. Read-only.
                  </div>
                )}
                <article
                  className="fact-body"
                  id="fact-content"
                  data-fact-path={renderedFact.path}
                  ref={readRef as React.RefObject<HTMLElement>}
                  dangerouslySetInnerHTML={factHtmlProp}
                />
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
            {selection.size > 0 && (
              <div className="bulkbar" id="bulkbar" role="toolbar" aria-label="Bulk quick comments">
                <span className="stat" aria-live="polite">
                  {selection.size} selected
                </span>
                {QUICK_COMMENTS.map((note) => (
                  <button key={note.key} onClick={() => applyQuickComment(note)}>
                    <Kbd className="mr-1">{note.key}</Kbd>
                    {note.label}
                  </button>
                ))}
                <button onClick={() => setSelection(new Set())}>esc clear</button>
              </div>
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
            {targetFact && factStats(targetFact).items > 0 && (
              <span className="chip count">{factStats(targetFact).items}</span>
            )}
          </button>
        )}
        {panelOpen ? (
          <aside className="panel-col panel" aria-label="Review panel">
            <Panel
              fact={targetIsGhost ? null : targetFact}
              ghost={targetIsGhost}
              anchorStates={anchorStates}
              composer={composer}
              onQuickComment={(note) => applyQuickComment(note)}
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
              onCancel={cancelComposer}
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

      {COARSE
        ? pendingSel &&
          targetFact &&
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
                Comment
              </Button>
              <Button size="sm" variant="outline" onClick={() => beginItem("question")}>
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
          { label: "Approve revision…", run: () => setApproveOpen(true) },
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
          ...(["light", "dark", "system"] as const)
            .filter((mode) => mode !== theme)
            .map((mode) => ({
              label: `Theme: ${mode}`,
              run: () => setTheme(mode),
            })),
          ...SCOPES.filter((s) => s !== scope && (s !== "changed" || prev !== null)).map((s) => ({
            label: `Scope: ${s === "all" ? "all facts" : `${s} only`}`,
            run: () => setScope(s),
          })),
          ...data.revisions
            .filter((s) => s !== data.revision)
            .map((s) => ({ label: `Switch to revision ${s}`, run: () => void load(s) })),
        ]}
      />
      <FinishSheet
        open={overlay === "finish"}
        data={data}
        progress={progress}
        openQuestions={openQuestions.total}
        raisedFacts={raisedFacts}
        onFinish={() => void finish()}
        onApprove={() => setApproveOpen(true)}
        onClose={() => setOverlay(null)}
      />
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent id="approve-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve revision {data.revision}?</AlertDialogTitle>
            <AlertDialogDescription>
              The revision is copied to approved/ — that directory existing is the approval —
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


createRoot(document.getElementById("root")!).render(<App />);
