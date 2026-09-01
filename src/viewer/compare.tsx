import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { computeBlockDiff, computeDiff, type DiffLine } from "./diff.js";
import {
  clearHighlight,
  pointForSourceOffset,
  rangeForSourceSpan,
  setHighlight,
} from "./dom-anchor.js";
import { renderMarkdown } from "./markdown.js";
import { useMermaidHtml } from "./mermaid.js";

// Diff of one fact between the compare base and the viewed revision.
// Facts are small, so the whole file renders — no hunks, no folded
// context. Lines wrap (prose is long); the pane never scrolls
// horizontally.

function Text({ line }: { line: DiffLine }): React.JSX.Element {
  return (
    <span className="dtext">
      {line.segs.map((seg, i) =>
        seg.changed ? (
          <mark key={i} className="dmark">
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
      {/* an empty line still needs row height */}
      {line.segs.every((s) => s.text === "") && " "}
    </span>
  );
}

/** The default compare view: each block rendered as itself — tables,
 * images, and code as the reader sees them — tinted by what happened to
 * it, with the changed pair's added words marked via the same CSS
 * highlight machinery the anchors use. */
function RenderedDiff(props: {
  before: string;
  after: string;
  /** asset URL prefixes per side, e.g. "/asset/1/" and "/asset/3/" */
  baseAsset: string;
  headAsset: string;
  factDir: string;
}): React.JSX.Element {
  const diff = useMemo(
    () => computeBlockDiff(props.before, props.after),
    [props.before, props.after],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const rawHtmls = useMemo(
    () =>
      diff.rows.map((row) =>
        renderMarkdown(row.source, {
          // a removed block's images live in the base revision
          assetBase: row.kind === "del" ? props.baseAsset : props.headAsset,
          factDir: props.factDir,
        }),
      ),
    [diff, props.baseAsset, props.headAsset, props.factDir],
  );
  const htmls = useMermaidHtml(rawHtmls);
  useEffect(() => {
    if (!rootRef.current) return;
    const blocks = rootRef.current.querySelectorAll<HTMLElement>("[data-row]");
    // Each edit region owns one added-words range and one struck removed
    // run, spliced side by side (git word-diff grouping). They must be
    // handled together: the <del> lands exactly at the range's start
    // boundary, where the DOM's split rules would leave it INSIDE the
    // range — the green highlight would paint across the red strike — so
    // the range start is moved past the del after insertion. Regions run
    // in descending offset order to keep earlier insertion points valid.
    // Code blocks and tables get no splice: struck raw source inside
    // them confuses more than it informs; the source layouts carry those.
    const ranges: Range[] = [];
    const inserted: HTMLElement[] = [];
    diff.rows.forEach((row, i) => {
      const el = blocks[i];
      if (!el) return;
      const regions = new Map<
        number,
        { mark?: { start: number; end: number }; del?: { at: number; text: string } }
      >();
      for (const mark of row.marks ?? []) regions.set(mark.start, { mark });
      for (const del of row.dels ?? []) {
        const region = regions.get(del.at) ?? {};
        region.del = del;
        regions.set(del.at, region);
      }
      for (const [at, region] of [...regions.entries()].sort((a, b) => b[0] - a[0])) {
        const range = region.mark
          ? rangeForSourceSpan(el, region.mark.start, region.mark.end)
          : null;
        const point = region.del ? pointForSourceOffset(el, at) : null;
        if (region.del && point && !point.node.parentElement?.closest("pre, table")) {
          const delEl = document.createElement("del");
          delEl.className = "rk-dd";
          delEl.textContent = region.del.text;
          const tail = point.node.splitText(point.offset);
          tail.parentNode!.insertBefore(delEl, tail);
          inserted.push(delEl);
          range?.setStartAfter(delEl);
        }
        if (range) ranges.push(range);
      }
    });
    setHighlight("rk-diff-ins", ranges);
    return () => {
      clearHighlight("rk-diff-ins");
      for (const el of inserted) el.remove();
    };
    // keyed on htmls, not diff alone: the mermaid splice rewrites a row's
    // innerHTML, detaching every Range and del the row held
  }, [diff, htmls]);
  const untouched = diff.added + diff.removed + diff.changed === 0;
  return (
    <div className="rdiff" ref={rootRef}>
      <div className="diffstats stat">
        {diff.added > 0 && <span className="dstat add">+{diff.added}</span>}
        {diff.removed > 0 && <span className="dstat del">−{diff.removed}</span>}
        {diff.changed > 0 && <span className="dstat chg">~{diff.changed}</span>}
        <span className="dstat unit">{untouched ? "no block changed" : "blocks"}</span>
      </div>
      {/* the fact changed but no block did: whitespace between blocks */}
      {untouched && props.before !== props.after && (
        <p className="unchanged-note">
          Only whitespace between blocks changed — see the Unified or Split
          layout for the exact edit.
        </p>
      )}
      {diff.rows.map((row, i) => (
        <div key={i} className={`rblock ${row.kind}`}>
          {row.kind === "del" && <span className="rtag del">removed</span>}
          {row.kind === "add" && <span className="rtag add">added</span>}
          {row.invisible && (
            <span className="rtag invisible">changed in source only — a link, path, or formatting edit; see the source layout</span>
          )}
          <div
            className="fact-body rblock-body"
            data-row={i}
            dangerouslySetInnerHTML={htmls[i]}
          />
        </div>
      ))}
    </div>
  );
}

/** The source layouts: the whole file line by line, unified or split,
 * with word marks inside changed line pairs. */
function SourceDiff(props: {
  before: string;
  after: string;
  layout: "unified" | "split";
}): React.JSX.Element {
  const diff = useMemo(
    () => computeDiff(props.before, props.after),
    [props.before, props.after],
  );
  return (
    <>
      <div className="diffstats stat">
        <span className="dstat add">+{diff.added}</span>
        <span className="dstat del">−{diff.removed}</span>
      </div>
      {props.layout === "unified" ? (
        <div className="dtable unified">
          {diff.unified.map((line, i) => (
            <div key={i} className={`dline ${line.kind}`}>
              <span className="dnum">{line.oldNum ?? ""}</span>
              <span className="dnum">{line.newNum ?? ""}</span>
              <span className="dsign">
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
              </span>
              <Text line={line} />
            </div>
          ))}
        </div>
      ) : (
        <div className="dtable split">
          {diff.split.map((row, i) => (
            <div key={i} className="drow">
              <div className={`dcell ${row.left ? row.left.kind : "empty"}`}>
                <span className="dnum">{row.left?.oldNum ?? ""}</span>
                {row.left && <Text line={row.left} />}
              </div>
              <div className={`dcell ${row.right ? row.right.kind : "empty"}`}>
                <span className="dnum">{row.right?.newNum ?? ""}</span>
                {row.right && <Text line={row.right} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function DiffView(props: {
  before: string;
  after: string;
  layout: "rendered" | "unified" | "split";
  baseAsset: string;
  headAsset: string;
  factDir: string;
}): React.JSX.Element {
  return (
    <div className="diffview" id="diff-view">
      {props.layout === "rendered" ? (
        <RenderedDiff
          before={props.before}
          after={props.after}
          baseAsset={props.baseAsset}
          headAsset={props.headAsset}
          factDir={props.factDir}
        />
      ) : (
        <SourceDiff before={props.before} after={props.after} layout={props.layout} />
      )}
    </div>
  );
}
