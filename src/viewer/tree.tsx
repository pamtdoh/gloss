import * as React from "react";
import { PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { COARSE } from "./common.js";
import { TreeRow } from "./components.js";
import type { Fact, ReviewData, Row } from "./model.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select.js";

// Tree scope: "changed" is what moved since the basis revision (deleted
// facts included, as read-only ghosts); "raised" is what has notes.
export type Scope = "all" | "changed" | "raised";
export const SCOPES: Scope[] = ["all", "changed", "raised"];
const SCOPE_LABEL: Record<Scope, string> = { all: "All", changed: "Changed", raised: "Raised" };

export function TreeColumn(props: {
  data: ReviewData;
  rows: Row[];
  factMap: Map<string, Fact>;
  baseMap: Map<string, string> | null;
  basisRevision: number | null;
  seen: Set<string>;
  collapsed: Set<string>;
  cursor: Row | null;
  filter: string;
  scope: Scope;
  counts: Record<Scope, number>;
  matches: number;
  progress: { seen: number; total: number };
  drawerOpen: boolean;
  railed: boolean;
  onFilter: (value: string) => void;
  onScope: (scope: Scope) => void;
  onOpen: (row: Row) => void;
  onToggle: (dir: string) => void;
  onRail: (railed: boolean) => void;
}): React.JSX.Element {
  const { filter, scope } = props;
  const filtering = filter.trim().length > 0;
  if (props.railed) {
    return (
      <nav className="tree-col rail" aria-label="Facts">
        <Button variant="ghost" size="icon-sm" id="btn-tree-expand" aria-label="Open fact tree" onClick={() => props.onRail(false)}>
          <PanelLeftOpen />
        </Button>
      </nav>
    );
  }
  return (
    <nav className="tree-col" aria-label="Facts" data-open={props.drawerOpen ? "" : undefined}>
      <div className="tree-filter">
        <div className="filter-box">
          <Search className="lucide filter-icon size-3.5" size={14} aria-hidden="true" />
          <Input
            id="tree-filter"
            className="pl-7"
            placeholder={COARSE ? "Filter facts" : "Filter facts (f)"}
            aria-label="Filter facts"
            value={filter}
            onChange={(e) => props.onFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                props.onFilter("");
                e.currentTarget.blur();
              }
            }}
          />
          <button
            className="filter-clear"
            data-show={filter ? "" : undefined}
            aria-label="Clear filter"
            tabIndex={filter ? 0 : -1}
            onClick={() => props.onFilter("")}
          >
            <X className="lucide size-3.5" size={14} />
          </button>
        </div>
        <Select value={scope} onValueChange={(v) => v && props.onScope(v as Scope)}>
          <SelectTrigger
            size="sm"
            id="scope-btn"
            aria-label={`Scope: ${SCOPE_LABEL[scope]}`}
            className={`gap-1.5 px-2.5 text-[12px] ${scope !== "all" ? "scope-active" : ""}`}
          >
            {SCOPE_LABEL[scope]}
            <span className="scope-count">{props.counts[scope]}</span>
          </SelectTrigger>
          <SelectContent align="end">
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s} id={`scope-${s}`} disabled={s === "changed" && !props.baseMap}>
                <span className="flex-1">{SCOPE_LABEL[s]}</span>
                <span className="scope-count">{props.counts[s]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" id="btn-tree-collapse" aria-label="Collapse fact tree" onClick={() => props.onRail(true)}>
          <PanelLeftClose />
        </Button>
      </div>
      <div className="drawer-tools">
        <span className="stat text-muted-foreground flex-1 self-center text-[13px]">
          {props.progress.seen} / {props.progress.total} reviewed
        </span>
      </div>
      {(filtering || scope !== "all") && (
        <div className="filter-count" aria-live="polite">
          {filtering
            ? `${props.matches} match${props.matches === 1 ? "" : "es"}${scope !== "all" ? ` in ${SCOPE_LABEL[scope].toLowerCase()}` : ""}`
            : scope === "changed"
              ? `${props.counts.changed} changed since revision ${props.basisRevision ?? "—"}`
              : `${props.counts.raised} with notes`}
        </div>
      )}
      {props.rows.length === 0 ? (
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
          aria-activedescendant={props.cursor ? `row-${props.cursor.kind}-${props.cursor.path}` : undefined}
        >
          {props.rows.map((row) => (
            <TreeRow
              key={`${row.kind}:${row.path}`}
              row={row}
              data={props.data}
              prev={props.baseMap}
              fact={row.kind === "fact" ? props.factMap.get(row.path) : undefined}
              seen={props.seen}
              collapsed={props.collapsed}
              isCursor={row.kind === props.cursor?.kind && row.path === props.cursor?.path}
              onOpen={() => props.onOpen(row)}
              onToggle={() => props.onToggle(row.path)}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}
