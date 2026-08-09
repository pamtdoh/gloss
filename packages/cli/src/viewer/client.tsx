import { render, type JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { tinykeys } from "tinykeys";
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
  isIndex,
  nameOf,
  nextId,
  normalizeSidecar,
  titleOf,
  type Fact,
  type ReviewData,
  type Row,
} from "./model.js";
import { searchFacts } from "./search.js";
import { SHORTCUTS } from "./shortcuts.js";

const DECISIONS: { d: Decision; key: string; label: string }[] = [
  { d: "not-needed", key: "1", label: "Not needed" },
  { d: "simplify", key: "2", label: "Simplify" },
  { d: "defer", key: "3", label: "Defer" },
];

type Composer =
  | { mode: "new"; type: SidecarItem["type"]; path: string; anchor?: Anchor }
  | { mode: "edit"; path: string; id: string; initial: string }
  | { mode: "reply"; path: string; id: string };

interface Toast {
  message: string;
  undo?: () => void;
}

const POLL_DISABLED = new URLSearchParams(location.search).get("poll") === "0";

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

async function fetchReview(snapshot?: number): Promise<ReviewData> {
  const res = await api("/api/review" + (snapshot ? `?snapshot=${snapshot}` : ""));
  if (!res.ok) throw new Error(`review fetch failed: ${res.status}`);
  return res.json();
}

function seenKey(review: string, snapshot: number): string {
  return `rk-seen:${review}:${snapshot}`;
}

function loadSeen(review: string, snapshot: number): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey(review, snapshot)) ?? "[]"));
  } catch {
    return new Set();
  }
}

function storeSeen(review: string, snapshot: number, seen: Set<string>): void {
  localStorage.setItem(seenKey(review, snapshot), JSON.stringify([...seen].sort()));
}

function App(): JSX.Element {
  const [data, setData] = useState<ReviewData | null>(null);
  const [prev, setPrev] = useState<Map<string, string> | null>(null);
  const [cursor, setCursor] = useState<Row | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [overlay, setOverlay] = useState<"help" | "palette" | "finish" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  const pendingPuts = useRef(new Set<string>());
  const readRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ data: ReviewData | null; composer: Composer | null; done: boolean }>({
    data: null, composer: null, done: false,
  });
  stateRef.current = { data, composer, done: done !== null };

  // ---------- data loading ----------
  async function load(snapshot?: number): Promise<void> {
    const next = await fetchReview(snapshot);
    setData(next);
    setSeen(loadSeen(next.review, next.snapshot));
    const prior = next.snapshots.filter((s) => s < next.snapshot).pop();
    if (prior !== undefined) {
      const before = await fetchReview(prior);
      setPrev(new Map(before.facts.map((f) => [f.path, f.content])));
    } else {
      setPrev(null);
    }
    setCursor((old) => old ?? null);
  }
  useEffect(() => {
    void load();
  }, []);

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
          for (const fact of fresh.facts) {
            // in-flight local writes win over poll data
            if (pendingPuts.current.has(fact.path)) {
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

  // ---------- selection affordance ----------
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onSelection = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        setHasSelection(
          !!sel && !sel.isCollapsed && !!readRef.current?.contains(sel.anchorNode),
        );
      }, 120);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  // ---------- derived ----------
  const rows = useMemo(
    () => (data ? buildRows(data.facts, (dir) => !collapsed.has(dir)) : []),
    [data, collapsed],
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
    if (!data) return { total: 0, answered: 0 };
    let total = 0;
    let answered = 0;
    for (const fact of data.facts) {
      const stats = factStats(fact);
      total += stats.questions;
      answered += stats.answered;
    }
    return { total, answered };
  }, [data]);

  const factPaths = useMemo(() => data?.facts.map((f) => f.path) ?? [], [data]);
  const progress = { seen: factPaths.filter((p) => seen.has(p)).length, total: factPaths.length };

  // ---------- actions ----------
  function saveSeen(next: Set<string>): void {
    if (!data) return;
    setSeen(new Set(next));
    storeSeen(data.review, data.snapshot, next);
  }

  function putSidecar(fact: Fact): void {
    if (!data) return;
    pendingPuts.current.add(fact.path);
    void api("/api/sidecar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: data.snapshot, path: fact.path, sidecar: fact.sidecar ?? {} }),
    }).finally(() => pendingPuts.current.delete(fact.path));
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
        const current = sidecar.decision;
        const next = bulk ? decision : current === decision ? null : decision;
        if (next) sidecar.decision = next;
        else delete sidecar.decision;
      });
    }
    if (bulk) {
      setSelection(new Set());
      setToast({
        message: `${decision ? `Marked ${targets.length} facts ${decision}` : `Cleared ${targets.length} decisions`}`,
        undo: () => {
          for (const [path, prior] of before) {
            mutateFact(path, (sidecar) => {
              if (prior) sidecar.decision = prior;
              else delete sidecar.decision;
            });
          }
          setToast(null);
        },
      });
    }
  }

  const undoStack = useRef<{ path: string; id: string }[]>([]);

  function beginItem(type: SidecarItem["type"]): void {
    if (!targetFact) return;
    let anchor: Anchor | undefined;
    const sel = window.getSelection();
    if (type !== "comment" && sel && !sel.isCollapsed && readRef.current) {
      const span = sourceSpanForSelection(readRef.current, sel);
      if (span) anchor = describeAnchor(targetFact.content, span.start, span.end);
    }
    setComposer({ mode: "new", type, path: targetFact.path, anchor });
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
    if (!data) return;
    const fact = data.facts.find((f) => f.path === path);
    const item = fact?.sidecar?.items?.find((i) => i.id === id);
    if (!item) return;
    const snapshot = structuredClone(item);
    mutateFact(path, (sidecar) => {
      sidecar.items = sidecar.items?.filter((i) => i.id !== id);
    });
    setMenuFor(null);
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
    const sel = window.getSelection();
    if (!fact || !sel || sel.isCollapsed || !readRef.current) {
      setToast({ message: "Select the new text in the fact first, then re-anchor." });
      return;
    }
    const span = sourceSpanForSelection(readRef.current, sel);
    if (!span) return;
    const anchor = describeAnchor(fact.content, span.start, span.end);
    mutateFact(path, (sidecar) => {
      const item = sidecar.items?.find((i) => i.id === id);
      if (item) item.anchor = anchor;
    });
    setMenuFor(null);
  }

  function moveCursor(delta: number): void {
    if (!rows.length) return;
    const index = cursorIndex === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, cursorIndex + delta));
    setCursor(rows[index]!);
  }

  function moveCursorWhere(predicate: (fact: Fact) => boolean, direction: 1 | -1): void {
    if (!data || !rows.length) return;
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

  function toggleSeen(advance: boolean): void {
    if (!targetFact) return;
    const next = new Set(seen);
    if (next.has(targetFact.path) && !advance) next.delete(targetFact.path);
    else next.add(targetFact.path);
    saveSeen(next);
    if (advance) moveCursorWhere((f) => !next.has(f.path), 1);
  }

  function toggleSelect(): void {
    if (!effectiveCursor || effectiveCursor.kind !== "fact") return;
    const next = new Set(selection);
    if (next.has(effectiveCursor.path)) next.delete(effectiveCursor.path);
    else next.add(effectiveCursor.path);
    setSelection(next);
  }

  async function finish(): Promise<void> {
    try {
      await api("/api/finish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshot: data?.snapshot }) });
    } catch { /* server exits as it answers */ }
    setDone("Review finished. The agent has been notified — you can close this tab.");
  }

  async function approve(): Promise<void> {
    try {
      const res = await api("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: data?.snapshot }),
      });
      if (!res.ok) {
        const err = await res.json();
        setToast({ message: `Approve failed: ${err.error}` });
        return;
      }
    } catch { /* as above */ }
    setDone(`Snapshot ${data?.snapshot} approved — promoted to approved/.`);
  }

  // ---------- keyboard ----------
  // Bound once; dispatch goes through a ref updated synchronously on every
  // render, so handlers can never see a stale closure (an effect-flush race
  // otherwise lets a fast keypress act on the previous render's rows).
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
    "decide-not-needed": () => decide("not-needed"),
    "decide-simplify": () => decide("simplify"),
    "decide-defer": () => decide("defer"),
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
    escape: () => {
      if (menuFor) setMenuFor(null);
      else if (composer) setComposer(null);
      else if (overlay) setOverlay(null);
      else if (selection.size) setSelection(new Set());
    },
  };
  useEffect(() => {
    const run = (id: string) => actions.current[id]?.();
    const guard = (id: string, opts?: { allowRepeat?: boolean }) => (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.isComposing) return;
      if (target && target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.repeat && !opts?.allowRepeat) return;
      e.preventDefault();
      run(id);
    };
    const handlers: Record<string, (e: KeyboardEvent) => void> = {
      j: guard("next", { allowRepeat: true }),
      k: guard("prev", { allowRepeat: true }),
      "Shift+J": guard("nextItems"),
      "Shift+K": guard("prevItems"),
      n: guard("nextQuestion"),
      p: guard("prevQuestion"),
      ArrowRight: guard("expand"),
      ArrowLeft: guard("collapse"),
      "1": guard("decide-not-needed"),
      "2": guard("decide-simplify"),
      "3": guard("decide-defer"),
      "0": guard("clearDecision"),
      v: guard("seen"),
      "Shift+Enter": guard("seenAdvance"),
      x: guard("select"),
      a: guard("annotate"),
      q: guard("question"),
      c: guard("comment"),
      u: guard("undo"),
      "Shift+?": guard("help"),
      "/": guard("palette"),
      "$mod+KeyK": (e) => {
        e.preventDefault();
        run("palette");
      },
      Escape: (e) => {
        e.preventDefault();
        run("escape");
      },
    };
    // Custom ignore: the default would drop key repeats (hold-j scrolling)
    // and swallow Escape inside fields; guard() handles field targets.
    return tinykeys(window, handlers, { ignore: (e: KeyboardEvent) => e.isComposing });
  }, []);

  // ---------- fact rendering + highlights ----------
  const readingFact = effectiveCursor?.kind === "fact" ? targetFact : null;
  const dirIndexFact = effectiveCursor?.kind === "dir" ? targetFact : null;
  const renderedFact = readingFact ?? dirIndexFact;

  const factHtml = useMemo(() => {
    if (!renderedFact || !data) return "";
    return renderMarkdown(renderedFact.content, {
      assetBase: `/asset/${data.snapshot}/`,
      factDir: dirOf(renderedFact.path),
    });
  }, [renderedFact, data]);

  const anchorStates = useMemo(() => {
    const states = new Map<string, "exact" | "drifted" | "detached">();
    if (!renderedFact) return states;
    for (const item of renderedFact.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(renderedFact.content, item.anchor);
      states.set(item.id, resolved ? resolved.state : "detached");
    }
    return states;
  }, [renderedFact]);

  useEffect(() => {
    const highlights = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
      ?.highlights as Map<string, unknown> | undefined;
    const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!highlights || !HighlightCtor || !readRef.current || !renderedFact) return;
    const annotationRanges: Range[] = [];
    const questionRanges: Range[] = [];
    const focusRanges: Range[] = [];
    for (const item of renderedFact.sidecar?.items ?? []) {
      if (!item.anchor) continue;
      const resolved = resolveAnchor(renderedFact.content, item.anchor);
      if (!resolved) continue;
      const range = rangeForSourceSpan(readRef.current, resolved.start, resolved.end);
      if (!range) continue;
      if (item.id === focusItemId) focusRanges.push(range);
      else if (item.type === "question") questionRanges.push(range);
      else annotationRanges.push(range);
    }
    highlights.set("rk-anno", new HighlightCtor(...annotationRanges));
    highlights.set("rk-question", new HighlightCtor(...questionRanges));
    highlights.set("rk-focused", new HighlightCtor(...focusRanges));
    return () => {
      highlights.delete("rk-anno");
      highlights.delete("rk-question");
      highlights.delete("rk-focused");
    };
  }, [factHtml, renderedFact, focusItemId]);

  // ---------- mermaid ----------
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
        const src = pre.textContent ?? "";
        void mermaid
          .render(`rk-mmd-${Date.now()}-${i}`, src)
          .then(({ svg }) => {
            pre.innerHTML = svg;
          })
          .catch(() => pre.removeAttribute("data-done"));
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

  if (!data) return <div class="app" />;
  if (done) {
    return (
      <div class="done-screen" id="done">
        <div>{done}</div>
      </div>
    );
  }

  const yourTurn = openQuestions.answered;

  return (
    <div class="app">
      <header class="hdr">
        <h1>
          reviewkit — <span id="review-name">{data.review}</span>
        </h1>
        <span class="progress" id="progress">
          {progress.seen} / {progress.total} reviewed
        </span>
        {openQuestions.total > 0 && (
          <button
            class={`pill ${yourTurn ? "attn" : ""}`}
            id="question-pill"
            onClick={() => moveCursorWhere((f) => factStats(f).questions > 0, 1)}
          >
            {yourTurn
              ? `${yourTurn} answered — your turn`
              : `${openQuestions.total} open question${openQuestions.total > 1 ? "s" : ""}`}
          </button>
        )}
        <span class="spacer" />
        <label for="snapshot-select" style="color:var(--text-faint)">snapshot</label>
        <select
          id="snapshot-select"
          aria-label="Snapshot"
          onChange={(e) => void load(Number((e.target as HTMLSelectElement).value))}
        >
          {data.snapshots.map((s) => (
            <option value={s} selected={s === data.snapshot}>
              {s}
            </option>
          ))}
        </select>
        <button id="btn-finish" class="primary" onClick={() => setOverlay("finish")}>
          Finish review
        </button>
      </header>

      <div class="cols">
        <nav class="tree-col" aria-label="Facts">
          <ul class="tree" id="fact-list">
            {rows.map((row) => (
              <TreeRow
                key={`${row.kind}:${row.path}`}
                row={row}
                data={data}
                prev={prev}
                seen={seen}
                selection={selection}
                collapsed={collapsed}
                isCursor={row.kind === effectiveCursor?.kind && row.path === effectiveCursor?.path}
                onOpen={() => setCursor(row)}
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
        </nav>

        <main class="read-col">
          <div class="read-inner">
            {effectiveCursor?.kind === "dir" ? (
              <DirView
                dir={effectiveCursor.path}
                data={data}
                prev={prev}
                seen={seen}
                selection={selection}
                indexHtml={factHtml}
                readRef={readRef}
                onOpen={(row) => setCursor(row)}
                onToggleSelect={(path) =>
                  setSelection((s) => {
                    const next = new Set(s);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
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
                <div class="crumb">
                  <span>{renderedFact.path}</span>
                  <ChangeBadge status={changeStatus(prev, renderedFact)} />
                  {seen.has(renderedFact.path) && <span class="seen-dot" title="Seen" />}
                </div>
                <article
                  class="fact-body"
                  id="fact-content"
                  ref={readRef}
                  dangerouslySetInnerHTML={{ __html: factHtml }}
                />
                {hasSelection && (
                  <div class="sel-hint" id="sel-hint">
                    <kbd>a</kbd> annotate · <kbd>q</kbd> ask
                  </div>
                )}
              </>
            ) : (
              <p>No facts.</p>
            )}
            {selection.size > 0 && (
              <div class="bulkbar" id="bulkbar">
                <span>{selection.size} selected</span>
                {DECISIONS.map(({ d, key, label }) => (
                  <button onClick={() => decide(d)}>
                    {key} {label}
                  </button>
                ))}
                <button onClick={() => setSelection(new Set())}>esc clear</button>
              </div>
            )}
          </div>
        </main>

        {panelOpen ? (
          <aside class="panel-col panel" aria-label="Review panel">
            <Panel
              fact={targetFact}
              anchorStates={anchorStates}
              composer={composer}
              menuFor={menuFor}
              onMenu={setMenuFor}
              onDecide={(d) => decide(d)}
              onFocusItem={setFocusItemId}
              onEdit={(item) =>
                targetFact &&
                setComposer({
                  mode: "edit",
                  path: targetFact.path,
                  id: item.id,
                  initial: item.type === "question" ? item.thread?.[0]?.text ?? "" : item.text ?? "",
                })
              }
              onDelete={(id) => targetFact && deleteItem(targetFact.path, id)}
              onReply={(id) => targetFact && setComposer({ mode: "reply", path: targetFact.path, id })}
              onReanchor={(id) => targetFact && reanchor(targetFact.path, id)}
              onCollapse={() => setPanelOpen(false)}
              onCommit={commitComposer}
              onCancel={() => setComposer(null)}
            />
          </aside>
        ) : (
          <aside class="panel-col rail">
            <button class="rail-toggle" aria-label="Open review panel" onClick={() => setPanelOpen(true)}>
              ◀
            </button>
            {targetFact && factStats(targetFact).items > 0 && (
              <div class="rail-badge">{factStats(targetFact).items}</div>
            )}
          </aside>
        )}
      </div>

      {overlay === "help" && <Help onClose={() => setOverlay(null)} />}
      {overlay === "palette" && (
        <Palette
          data={data}
          onClose={() => setOverlay(null)}
          onJump={(path) => {
            setOverlay(null);
            setCursor({ kind: "fact", path, depth: 0 });
          }}
          commands={[
            { label: "Finish review", run: () => setOverlay("finish") },
            { label: "Approve snapshot", run: () => void approve() },
            {
              label: "Mark all facts seen",
              run: () => saveSeen(new Set(factPaths)),
            },
            { label: "Toggle review panel", run: () => setPanelOpen((open) => !open) },
            { label: "Keyboard help", run: () => setOverlay("help") },
            ...data.snapshots
              .filter((s) => s !== data.snapshot)
              .map((s) => ({ label: `Switch to snapshot ${s}`, run: () => void load(s) })),
          ]}
        />
      )}
      {overlay === "finish" && (
        <FinishSheet
          data={data}
          progress={progress}
          openQuestions={openQuestions.total}
          onFinish={() => void finish()}
          onApprove={() => void approve()}
          onClose={() => setOverlay(null)}
        />
      )}
      {toast && (
        <div class="toast" id="toast">
          <span>{toast.message}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function ChangeBadge({ status }: { status: "new" | "changed" | undefined }): JSX.Element | null {
  if (!status) return null;
  return <span class={`chip ${status}`}>{status === "new" ? "new" : "changed"}</span>;
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
}): JSX.Element {
  const { row, data } = props;
  const pad = `${10 + row.depth * 16}px`;
  if (row.kind === "dir") {
    const stats = dirStats(data.facts, row.path);
    const isCollapsed = props.collapsed.has(row.path);
    return (
      <li
        class={`row dir ${props.isCursor ? "cursor" : ""}`}
        style={{ paddingLeft: pad }}
        data-path={row.path}
        data-kind="dir"
        onClick={props.onOpen}
      >
        <button
          class="caret"
          aria-label={isCollapsed ? "Expand" : "Collapse"}
          aria-expanded={!isCollapsed}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
        >
          {isCollapsed ? "▶" : "▼"}
        </button>
        <span class="name dirname">{nameOf(row.path)}/</span>
        <span class="badges">
          {stats.questions > 0 && <span class="chip q">{stats.questions}?</span>}
          {stats.items > 0 && <span class="chip count">{stats.items}</span>}
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
      class={`row fact ${props.isCursor ? "cursor" : ""} ${!props.seen.has(fact.path) ? "unseen" : ""} ${decision === "not-needed" ? "checked-off" : ""}`}
      style={{ paddingLeft: pad }}
      data-path={row.path}
      data-kind="fact"
      onClick={props.onOpen}
    >
      {props.selection.has(fact.path) && <input class="sel-box" type="checkbox" checked readOnly />}
      <span class="name">{nameOf(fact.path)}</span>
      <span class="badges">
        <ChangeBadge status={status} />
        {stats.questions > 0 && <span class="chip q">{stats.questions}?</span>}
        {stats.items - stats.questions > 0 && <span class="chip count">{stats.items - stats.questions}</span>}
        {decision && <span class={`chip ${decision} ${status === "changed" ? "stale" : ""}`}>{decision}</span>}
        {props.seen.has(fact.path) && <span class="seen-dot" title="Seen" />}
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
  readRef: { current: HTMLDivElement | null };
  onOpen: (row: Row) => void;
  onToggleSelect: (path: string) => void;
  onDecide: (path: string, d: Decision) => void;
}): JSX.Element {
  const index = indexFactOf(props.data.facts, props.dir);
  const children = childFactsOf(props.data.facts, props.dir);
  const subdirs = childDirsOf(props.data.facts, props.dir);
  return (
    <div class="dirview" id="dir-view">
      <div class="crumb">
        <span>{props.dir}/</span>
      </div>
      {index ? (
        <article
          class="fact-body"
          id="fact-content"
          ref={props.readRef as never}
          dangerouslySetInnerHTML={{ __html: props.indexHtml }}
        />
      ) : (
        <h1>{nameOf(props.dir)}/</h1>
      )}
      <div class="facttable" id="fact-table" role="grid" aria-label={`Facts in ${props.dir}`}>
        {subdirs.map((dir) => (
          <div
            class="trow"
            role="row"
            data-path={dir}
            onClick={() => props.onOpen({ kind: "dir", path: dir, depth: 0 })}
          >
            <span class="title dirname" role="gridcell">
              {nameOf(dir)}/ <span style="color:var(--text-faint)">({dirStats(props.data.facts, dir).facts} facts)</span>
            </span>
          </div>
        ))}
        {children.map((fact) => {
          const decision = fact.sidecar?.decision;
          const stats = factStats(fact);
          return (
            <div
              class={`trow ${!props.seen.has(fact.path) ? "unseen" : ""} ${decision ? "has-decision" : ""}`}
              role="row"
              data-path={fact.path}
              onClick={() => props.onOpen({ kind: "fact", path: fact.path, depth: 0 })}
            >
              <input
                type="checkbox"
                role="gridcell"
                aria-label={`Select ${fact.path}`}
                checked={props.selection.has(fact.path)}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleSelect(fact.path);
                }}
              />
              <span class="title" role="gridcell">
                {titleOf(fact)}
              </span>
              <span class="badges" role="gridcell">
                <ChangeBadge status={changeStatus(props.prev, fact)} />
                {stats.questions > 0 && <span class="chip q">{stats.questions}?</span>}
                {stats.items - stats.questions > 0 && (
                  <span class="chip count">{stats.items - stats.questions}</span>
                )}
              </span>
              <span class="decide" role="gridcell">
                {DECISIONS.map(({ d, label }) => (
                  <button
                    class={decision === d ? "on" : ""}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDecide(fact.path, d);
                    }}
                  >
                    {label}
                  </button>
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
  menuFor: string | null;
  onMenu: (id: string | null) => void;
  onDecide: (d: Decision) => void;
  onFocusItem: (id: string | null) => void;
  onEdit: (item: SidecarItem) => void;
  onDelete: (id: string) => void;
  onReply: (id: string) => void;
  onReanchor: (id: string) => void;
  onCollapse: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const fact = props.fact;
  const decision = fact?.sidecar?.decision;
  return (
    <>
      <h2>
        Decision
        <button class="rail-toggle" style="float:right" aria-label="Collapse panel" onClick={props.onCollapse}>
          ▶
        </button>
      </h2>
      <div class="decisions" id="decisions" role="group" aria-label="Decision">
        {DECISIONS.map(({ d, key, label }) => (
          <button class={decision === d ? "on" : ""} data-decision={d} onClick={() => props.onDecide(d)}>
            <kbd>{key}</kbd>
            {label}
          </button>
        ))}
      </div>
      <h2>Items</h2>
      <div id="panel-items">
        {(fact?.sidecar?.items ?? []).map((item) => {
          const anchorState = item.anchor ? props.anchorStates.get(item.id) : undefined;
          return (
            <div
              class={`card item-${item.type} ${anchorState === "drifted" ? "drifted" : ""} ${anchorState === "detached" ? "detached" : ""}`}
              data-id={item.id}
              onMouseEnter={() => props.onFocusItem(item.id)}
              onMouseLeave={() => props.onFocusItem(null)}
            >
              <span class="kind">
                {item.type}
                {anchorState === "drifted" && <span class="chip changed">drifted</span>}
                {anchorState === "detached" && <span class="chip stale">quote no longer found</span>}
              </span>
              <button class="menu-btn" aria-label={`Actions for ${item.id}`} onClick={() => props.onMenu(props.menuFor === item.id ? null : item.id)}>
                ⋯
              </button>
              {props.menuFor === item.id && (
                <div class="menu">
                  <button onClick={() => { props.onMenu(null); props.onEdit(item); }}>Edit</button>
                  <button onClick={() => props.onDelete(item.id)}>Delete</button>
                  {anchorState === "detached" && (
                    <button onClick={() => props.onReanchor(item.id)}>Re-anchor to selection</button>
                  )}
                </div>
              )}
              {item.anchor?.quote && <blockquote>{item.anchor.quote}</blockquote>}
              {item.type === "question" ? (
                <>
                  {(item.thread ?? []).map((turn) => (
                    <p>
                      <span class="who">{turn.who}</span>
                      {turn.text}
                    </p>
                  ))}
                  <span class="actions">
                    <button class="item-reply" onClick={() => props.onReply(item.id)}>
                      Reply
                    </button>
                    {answeredByAgent(item) && <span class="chip q">your turn</span>}
                  </span>
                </>
              ) : (
                item.text && <p>{item.text}</p>
              )}
            </div>
          );
        })}
        {fact && (fact.sidecar?.items ?? []).length === 0 && (
          <p style="color:var(--text-faint)">Nothing raised on this fact.</p>
        )}
      </div>
      {props.composer && (
        <ComposerBox composer={props.composer} onCommit={props.onCommit} onCancel={props.onCancel} />
      )}
      <p class="keys-hint">
        j/k move · 1–3 decide · v seen · a/q/c raise · ? help · ⌘K search
      </p>
    </>
  );
}

function ComposerBox(props: {
  composer: Composer;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const composer = props.composer;
  const label =
    composer.mode === "new"
      ? composer.type + (composer.anchor ? ` — "${composer.anchor.quote}"` : " — whole fact")
      : composer.mode === "edit"
        ? `edit ${composer.id}`
        : `reply — ${composer.id}`;
  return (
    <form
      class="composer"
      id="item-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onCommit(ref.current?.value ?? "");
      }}
    >
      <div class="ctx" id="item-form-label">{label}</div>
      <textarea
        id="item-input"
        aria-label="Item text"
        ref={ref}
        defaultValue={composer.mode === "edit" ? composer.initial : ""}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            props.onCommit(ref.current?.value ?? "");
          }
        }}
      />
      <div class="row">
        <button type="submit" class="save" id="item-save">
          Save
        </button>
        <button type="button" id="item-cancel" onClick={props.onCancel}>
          Cancel
        </button>
        <span class="hint">⌘↵ save · esc cancel</span>
      </div>
    </form>
  );
}

function Help(props: { onClose: () => void }): JSX.Element {
  const sections = [...new Set(SHORTCUTS.map((s) => s.section))];
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="sheet" id="help-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div class="helpgrid">
          {sections.map((section) => (
            <div>
              <h3>{section}</h3>
              {SHORTCUTS.filter((s) => s.section === section).map((s) => (
                <div class="helprow">
                  <span>{s.label}</span>
                  <kbd>{s.shown}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Palette(props: {
  data: ReviewData;
  commands: { label: string; run: () => void }[];
  onJump: (path: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const isCommand = query.startsWith(">");
  const docs = useMemo(
    () =>
      props.data.facts.map((f) => ({ path: f.path, title: titleOf(f), body: f.content })),
    [props.data],
  );
  const results: { label: string; sub?: string; run: () => void }[] = isCommand
    ? props.commands
        .filter((c) => c.label.toLowerCase().includes(query.slice(1).trim().toLowerCase()))
        .map((c) => ({ label: c.label, run: c.run }))
    : searchFacts(docs, query).map((path) => ({
        label: docs.find((d) => d.path === path)?.title ?? path,
        sub: path,
        run: () => props.onJump(path),
      }));
  const clamped = Math.min(active, Math.max(0, results.length - 1));
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="sheet palette" id="palette" onClick={(e) => e.stopPropagation()}>
        <input
          id="palette-input"
          placeholder="Search facts… (type > for commands)"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              results[clamped]?.run();
              if (isCommand) props.onClose();
            } else if (e.key === "Escape") {
              props.onClose();
            }
          }}
          autofocus
        />
        <div class="results" role="listbox">
          {results.map((result, i) => (
            <div
              class={`result ${i === clamped ? "active" : ""}`}
              role="option"
              aria-selected={i === clamped}
              onClick={() => {
                result.run();
                if (isCommand) props.onClose();
              }}
            >
              <span>{result.label}</span>
              {result.sub && <span class="sub">{result.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinishSheet(props: {
  data: ReviewData;
  progress: { seen: number; total: number };
  openQuestions: number;
  onFinish: () => void;
  onApprove: () => void;
  onClose: () => void;
}): JSX.Element {
  const decided = props.data.facts.filter((f) => f.sidecar?.decision);
  const withItems = props.data.facts.filter((f) => (f.sidecar?.items ?? []).length > 0);
  return (
    <div class="overlay" onClick={props.onClose}>
      <div class="sheet" id="finish-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Finish review — snapshot {props.data.snapshot}</h2>
        <p style="color:var(--text-soft)">
          {props.progress.seen} of {props.progress.total} facts seen · {decided.length} decisions ·{" "}
          {props.openQuestions} open question{props.openQuestions === 1 ? "" : "s"}
        </p>
        <ul class="finish-list">
          {decided.map((f) => (
            <li>
              <span class={`chip ${f.sidecar!.decision}`}>{f.sidecar!.decision}</span>{" "}
              {titleOf(f)} <div class="path">{f.path}</div>
            </li>
          ))}
          {withItems.map((f) => (
            <li>
              {(f.sidecar?.items ?? []).length} item(s) on {titleOf(f)}
              <div class="path">{f.path}</div>
            </li>
          ))}
          {decided.length === 0 && withItems.length === 0 && (
            <li>Nothing raised — finishing records agreement with every fact.</li>
          )}
        </ul>
        <div class="row">
          <button class="primary" id="confirm-finish" onClick={props.onFinish}>
            Finish review
          </button>
          <button id="confirm-approve" onClick={props.onApprove}>
            Approve snapshot
          </button>
          <span class="spacer" />
          <button onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
