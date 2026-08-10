import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, SquareDot, SquareMinus, SquarePlus } from "lucide-react";
import type { SidecarItem } from "../summary.js";
import { QUICK_COMMENTS, type QuickComment } from "./common.js";
import { rangeForSourceSpan } from "./dom-anchor.js";
import { renderMarkdown } from "./markdown.js";
import {
  changeStatus,
  childDirsOf,
  childFactsOf,
  dirStats,
  factStats,
  nameOf,
  titleOf,
  type ChangeStatus,
  type Fact,
  type ReviewData,
  type Row,
} from "./model.js";
import { Button } from "./ui/button.js";
import { Checkbox } from "./ui/checkbox.js";

export function rowLabel(row: Row): string {
  return row.kind === "dir" ? `${nameOf(row.path)}/` : nameOf(row.path);
}

// The bubble owns its position tracking: scroll frames re-render this leaf
// alone, never the app tree, and the Range is built once per span — only
// getBoundingClientRect runs per frame (rebuilding the Range re-queried
// every offset run in the fact, per frame).
export function SelBubble(props: {
  span: { path: string; start: number; end: number };
  quote: string;
  readRef: React.MutableRefObject<HTMLElement | null>;
  onAct: (type: SidecarItem["type"]) => void;
}): React.JSX.Element | null {
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null);
  useEffect(() => {
    const container = props.readRef.current;
    const range =
      container && container.getAttribute("data-fact-path") === props.span.path
        ? rangeForSourceSpan(container, props.span.start, props.span.end)
        : null;
    if (!range) {
      setPos(null);
      return;
    }
    let raf = 0;
    const update = (): void => {
      const rect = range.getBoundingClientRect();
      const next = { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
      setPos((p) =>
        p && p.x === next.x && p.top === next.top && p.bottom === next.bottom ? p : next,
      );
    };
    update();
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [props.span, props.readRef]);
  if (!pos) return null;
  return (
    <div
      className="sel-pop"
      id="sel-pop"
      role="toolbar"
      aria-label="Selected text actions"
      data-quote={props.quote}
      // preventDefault on the container too: a press anywhere on the
      // bubble — including its padding — must not collapse the
      // selection it acts on (medium-editor's one gap, closed)
      onPointerDown={(e) => e.preventDefault()}
      style={{
        left: Math.min(Math.max(8, pos.x - 85), window.innerWidth - 178),
        top: pos.top - 44 < 54 ? pos.bottom + 8 : pos.top - 44,
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onPointerDown={(e) => {
          e.preventDefault();
          props.onAct("comment");
        }}
      >
        Comment
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onPointerDown={(e) => {
          e.preventDefault();
          props.onAct("question");
        }}
      >
        Ask
      </Button>
    </div>
  );
}

// Markdown rendered behind a stable {__html} object — see factHtmlProp:
// React 19 diffs dangerouslySetInnerHTML by object identity, so an inline
// object re-writes the DOM (and re-parses the markdown) on every render.
export function Md(props: { text: string; block?: boolean; className?: string }): React.JSX.Element {
  const html = useMemo(() => ({ __html: renderMarkdown(props.text) }), [props.text]);
  return props.block ? (
    <div className={props.className} dangerouslySetInnerHTML={html} />
  ) : (
    <span className={props.className} dangerouslySetInnerHTML={html} />
  );
}

export function ChangeBadge({ status }: { status: ChangeStatus }): React.JSX.Element | null {
  if (!status) return null;
  return <span className={`chip ${status}`}>{status}</span>;
}

// tree rows use 14px glyphs instead of word chips — the words cost ~45px
// of name width in a 300px column (GitHub/GitLab both glyph here)
const GLYPHS = { changed: SquareDot, new: SquarePlus, removed: SquareMinus } as const;
export function ChangeGlyph({ status }: { status: ChangeStatus }): React.JSX.Element | null {
  if (!status) return null;
  const Icon = GLYPHS[status];
  return (
    <span className={`gbadge ${status}`} title={status} aria-label={status}>
      <Icon className="lucide size-3.5" size={14} aria-hidden="true" />
    </span>
  );
}

export function TreeRow(props: {
  row: Row;
  data: ReviewData;
  prev: Map<string, string> | null;
  fact: Fact | undefined;
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
  const fact = props.fact;
  if (!fact) return <li />;
  const stats = factStats(fact);
  const status = changeStatus(props.prev, fact);
  return (
    <li
      id={rowId}
      className={`row fact ${props.isCursor ? "cursor" : ""} ${
        fact.ghost ? "ghost" : !props.seen.has(fact.path) ? "unseen" : ""
      }`}
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
        <ChangeGlyph status={status} />
        {stats.questions > 0 && <span className="chip q">{stats.questions}?</span>}
        {stats.items - stats.questions > 0 && (
          <span className="chip count">{stats.items - stats.questions}</span>
        )}
        {props.seen.has(fact.path) && (
          <Check className="lucide size-3.5 seen-check" size={14} aria-label="Seen" />
        )}
      </span>
    </li>
  );
}

export function DirView(props: {
  dir: string;
  data: ReviewData;
  /** the scoped + filtered display set — the table always mirrors the tree */
  facts: Fact[];
  prev: Map<string, string> | null;
  seen: Set<string>;
  selection: Set<string>;
  /** already wrapped in the stable {__html} object — see factHtmlProp */
  indexHtml: { __html: string };
  indexFact: Fact | null;
  readRef: React.MutableRefObject<HTMLElement | null>;
  onOpen: (row: Row) => void;
  onToggleSelect: (path: string) => void;
  onSelectAll: (paths: string[], on: boolean) => void;
  onQuickComment: (path: string, note: QuickComment) => void;
}): React.JSX.Element {
  const children = childFactsOf(props.facts, props.dir);
  const subdirs = childDirsOf(props.facts, props.dir);
  const stats = dirStats(props.facts, props.dir);
  const selectable = children.filter((f) => !f.ghost);
  const allSelected =
    selectable.length > 0 && selectable.every((f) => props.selection.has(f.path));
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
          dangerouslySetInnerHTML={props.indexHtml}
        />
      ) : (
        <h1 className="text-[22px] font-[650] my-2">{nameOf(props.dir)}/</h1>
      )}
      <div className="dirstats stat">
        {stats.facts} fact{stats.facts === 1 ? "" : "s"} · {stats.items} note
        {stats.items === 1 ? "" : "s"} · {stats.questions} open question
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
                  selectable.map((f) => f.path),
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
                ({dirStats(props.facts, dir).facts} facts)
              </span>
            </span>
          </div>
        ))}
        {children.map((fact) => {
          const stats = factStats(fact);
          const ghost = fact.ghost === true;
          return (
            <div
              key={fact.path}
              className={`trow ${ghost ? "ghost" : !props.seen.has(fact.path) ? "unseen" : ""}`}
              data-path={fact.path}
              onClick={() => props.onOpen({ kind: "fact", path: fact.path, depth: 0 })}
            >
              {ghost ? (
                <span className="caret-spacer" style={{ width: 16 }} aria-hidden="true" />
              ) : (
                <Checkbox
                  aria-label={`Select ${fact.path}`}
                  checked={props.selection.has(fact.path)}
                  onCheckedChange={() => props.onToggleSelect(fact.path)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
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
              {!ghost && (
                <span className="decide" onClick={(e) => e.stopPropagation()}>
                  {QUICK_COMMENTS.map((note) => (
                    <Button
                      key={note.key}
                      variant="outline"
                      size="xs"
                      onClick={() => props.onQuickComment(fact.path, note)}
                    >
                      {note.label}
                    </Button>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

