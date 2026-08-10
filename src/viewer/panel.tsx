import * as React from "react";
import { useEffect, useRef } from "react";
import { DropdownMenu as DM } from "radix-ui";
import { MoreHorizontal, PanelRightClose } from "lucide-react";
import type { SidecarItem } from "../summary.js";
import { QUICK_COMMENTS, type Composer, type QuickComment } from "./common.js";
import { Md } from "./components.js";
import { answeredByAgent, type Fact } from "./model.js";
import { Button } from "./ui/button.js";
import { Kbd } from "./ui/kbd.js";
import { Textarea } from "./ui/textarea.js";

export function Panel(props: {
  fact: Fact | null;
  ghost: boolean;
  anchorStates: Map<string, "exact" | "drifted" | "detached">;
  composer: Composer | null;
  onQuickComment: (note: QuickComment) => void;
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
  return (
    <>
      <h2 className="flex items-center justify-between">
        Quick comment
        <Button variant="ghost" size="icon-xs" aria-label="Collapse panel" onClick={props.onCollapse}>
          <PanelRightClose />
        </Button>
      </h2>
      <div id="quick-comment" className="flex flex-wrap gap-1.5" role="group" aria-label="Quick comment">
        {QUICK_COMMENTS.map((note) => (
          <Button
            key={note.key}
            variant="outline"
            size="sm"
            data-quick={note.label}
            aria-keyshortcuts={note.key}
            disabled={!fact}
            onClick={() => props.onQuickComment(note)}
          >
            <Kbd>{note.key}</Kbd>
            {note.label}
          </Button>
        ))}
      </div>
      <h2>Notes</h2>
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
                {item.type === "question" ? "question" : "comment"}
                {anchorState === "drifted" && <span className="chip changed">drifted</span>}
                {anchorState === "detached" && <span className="chip stale">detached</span>}
              </span>
              <DM.Root>
                <DM.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="menu-btn"
                    style={{ position: "absolute", top: 6, right: 6 }}
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
                      <Md text={turn.text} />
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
                item.text && <Md block className="cardtext" text={item.text} />
              )}
            </div>
          );
        })}
        {fact && (fact.sidecar?.items ?? []).length === 0 && (
          <p className="text-muted-foreground text-[13px]">No notes on this fact.</p>
        )}
        {!fact && (
          <p className="text-muted-foreground text-[13px]">
            {props.ghost
              ? "This fact was removed — read-only, nothing to note."
              : "This directory has no _index.md — select a fact to review it."}
          </p>
        )}
      </div>
      {props.composer && (
        <ComposerBox composer={props.composer} onCommit={props.onCommit} onCancel={props.onCancel} />
      )}
      <p className="keys-hint">
        j/k move · 1–3 quick comment · v seen · c/q raise · <Kbd>?</Kbd> help · <Kbd>⌘K</Kbd> search
      </p>
    </>
  );
}

export function ComposerBox(props: {
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

