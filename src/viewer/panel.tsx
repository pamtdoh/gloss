import * as React from "react";
import { useEffect, useRef } from "react";
import { DropdownMenu as DM } from "radix-ui";
import {
  ArrowLeft,
  ChevronRight,
  MessageCircleQuestion,
  MessageSquare,
  MoreHorizontal,
  PanelRightClose,
  Sparkles,
} from "lucide-react";
import type { SidecarItem, ThreadEntry } from "../summary.js";
import type { Composer } from "./common.js";
import { Md } from "./components.js";
import { answeredByAgent, type AnchorState, type Fact } from "./model.js";
import { MOD } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import { Kbd } from "./ui/kbd.js";
import { Textarea } from "./ui/textarea.js";

function AnchorChips(props: { state: AnchorState | undefined }): React.JSX.Element | null {
  if (props.state === "drifted") return <span className="chip changed">drifted</span>;
  if (props.state === "detached") return <span className="chip stale">detached</span>;
  return null;
}

function KindRow(props: {
  item: SidecarItem;
  anchorState: AnchorState | undefined;
}): React.JSX.Element {
  return (
    <span className="kind">
      {props.item.type === "question" ? "question" : "comment"}
      <AnchorChips state={props.anchorState} />
    </span>
  );
}

/** Human and agent turns, both left-aligned: the human's in a tinted
 * card, the agent's as plain markdown under an icon+label header — the
 * tint asymmetry ChatGPT/Claude/Copilot use, mirrored left for a narrow
 * panel, with the label carrying identity so color never stands alone. */
function Turns(props: { thread: ThreadEntry[] }): React.JSX.Element {
  return (
    <div className="msgs">
      {props.thread.map((turn, i) => {
        const first = i === 0 || props.thread[i - 1]!.who !== turn.who;
        return (
          <div key={i} className={`msg ${turn.who}`}>
            {first && (
              <span className="msg-who">
                {turn.who === "agent" ? (
                  <>
                    <Sparkles className="lucide size-3" size={12} aria-hidden="true" />
                    Agent
                  </>
                ) : (
                  "You"
                )}
              </span>
            )}
            <Md block className="msg-body" text={turn.text} />
          </div>
        );
      })}
    </div>
  );
}

function ThreadView(props: {
  item: SidecarItem;
  anchorState: AnchorState | undefined;
  onBack: () => void;
  /** absent when the notes are read-only (compare, a stale revision):
   * no reply box, and no "your turn" since there is no turn to take */
  onReplySubmit?: (id: string, text: string) => void;
}): React.JSX.Element {
  const item = props.item;
  const ref = useRef<HTMLTextAreaElement>(null);
  // a takeover view moves focus in with it, so keyboard and screen-reader
  // users land where they are (the close control), not on <body>
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);
  return (
    <div className="thread-page" id="thread-page">
      <div className="thread-head">
        <Button
          variant="ghost"
          size="icon-xs"
          id="thread-back"
          ref={backRef}
          aria-label="Back to all notes"
          onClick={props.onBack}
        >
          <ArrowLeft />
        </Button>
        <span className="thread-title">Question</span>
        <AnchorChips state={props.anchorState} />
        {props.onReplySubmit && answeredByAgent(item) && <span className="chip q">your turn</span>}
      </div>
      {item.anchor?.quote && <blockquote>{item.anchor.quote}</blockquote>}
      <Turns thread={item.thread ?? []} />
      {props.onReplySubmit && (
        <form
          className="composer thread-reply"
          id="thread-reply"
          onSubmit={(e) => {
            e.preventDefault();
            const text = ref.current?.value ?? "";
            if (!text.trim()) return;
            props.onReplySubmit!(item.id, text);
            if (ref.current) ref.current.value = "";
          }}
        >
          <Textarea
            id="thread-reply-input"
            aria-label="Reply"
            placeholder="Reply…"
            ref={ref}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // keep the draft: first escape leaves the field, the next
                // (global) closes the thread
                e.stopPropagation();
                e.currentTarget.blur();
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button type="submit" size="sm" id="thread-send">
              Reply
            </Button>
            <span className="text-muted-foreground ml-auto text-[11px]">{MOD}↵ send</span>
          </div>
        </form>
      )}
    </div>
  );
}

/** A question folded to its summary card: the question, then a summary
 * line — the full exchange lives in the thread subpage. The accessible
 * open control is the real chevron button; click and Enter/Space on the
 * card body (wired by the caller) are conveniences. */
function FoldedQuestion(props: {
  item: SidecarItem;
  /** writable notes show whose move it is */
  yourTurn: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const thread = props.item.thread ?? [];
  const replies = Math.max(0, thread.length - 1);
  const last = thread[thread.length - 1];
  return (
    <>
      <div className="q-text cardtext">
        <Md block text={thread[0]?.text ?? ""} />
      </div>
      {last && replies > 0 && (
        <div className="q-preview">
          {last.who === "agent" ? "Agent: " : "You: "}
          {last.text}
        </div>
      )}
      <div className="q-meta">
        <span>{replies === 0 ? "No reply yet" : `${replies} repl${replies === 1 ? "y" : "ies"}`}</span>
        {props.yourTurn && <span className="chip q">your turn</span>}
        <button
          className="q-open"
          aria-label={`Open thread ${props.item.id}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onOpen();
          }}
        >
          <ChevronRight className="lucide size-3.5" size={14} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

export function Panel(props: {
  /** the fact whose notes show: the base revision's copy while
   * comparing, the viewed fact otherwise (null for a ghost or a dir) */
  fact: Fact | null;
  ghost: boolean;
  /** the review's front page: its notes speak to the review as a whole */
  root: boolean;
  anchorStates: Map<string, AnchorState>;
  composer: Composer | null;
  /** id of the question thread opened as a subpage */
  openThreadId: string | null;
  /** compare / stale-revision mode: the notes belong to this revision
   * and nothing writes — no Comment/Ask buttons, menus, composer, or replies */
  readonlyRevision: number | null;
  onOpenThread: (id: string | null) => void;
  onReplySubmit: (id: string, text: string) => void;
  /** open the composer for the whole fact, or the live selection if any —
   * the buttons' path for readers without a keyboard */
  onBegin: (type: SidecarItem["type"]) => void;
  onFocusItem: (id: string | null) => void;
  onEdit: (item: SidecarItem) => void;
  onDelete: (id: string) => void;
  onReanchor: (id: string) => void;
  onCollapse: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const fact = props.fact;
  const readonly = props.readonlyRevision !== null;
  const items = fact?.sidecar?.items ?? [];
  const scrollTop = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelEl = (): Element | null => rootRef.current?.closest(".panel-col") ?? null;

  // when the subpage closes — Back or Escape alike — the list comes back
  // at its saved scroll position (Slack keeps the channel position when a
  // thread closes), with focus returned to the card that opened it
  const lastOpenThread = useRef<string | null>(null);
  useEffect(() => {
    const closed = lastOpenThread.current;
    lastOpenThread.current = props.openThreadId;
    if (!closed || props.openThreadId) return;
    const el = panelEl();
    if (el) el.scrollTop = scrollTop.current;
    (rootRef.current?.querySelector(`[data-id="${closed}"]`) as HTMLElement | null)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openThreadId]);

  const openItem = props.openThreadId ? items.find((i) => i.id === props.openThreadId) : undefined;
  if (openItem) {
    return (
      <ThreadView
        item={openItem}
        anchorState={openItem.anchor ? props.anchorStates.get(openItem.id) : undefined}
        onBack={() => props.onOpenThread(null)}
        onReplySubmit={readonly ? undefined : props.onReplySubmit}
      />
    );
  }

  const collapse = (
    <Button variant="ghost" size="icon-xs" aria-label="Collapse panel" onClick={props.onCollapse}>
      <PanelRightClose />
    </Button>
  );
  return (
    <div ref={rootRef}>
      {readonly ? (
        <h2 className="flex items-center justify-between">
          Notes on revision {props.readonlyRevision}
          {collapse}
        </h2>
      ) : (
        <>
          <h2 className="flex items-center justify-between">
            Notes
            {collapse}
          </h2>
          <div id="note-actions" className="flex flex-wrap gap-1.5" role="group" aria-label="Raise a note">
            <Button
              variant="outline"
              size="sm"
              id="note-comment"
              aria-keyshortcuts="c"
              title={props.root ? "Comment on the review (c)" : "Comment on the whole fact (c)"}
              disabled={!fact}
              onClick={() => props.onBegin("comment")}
            >
              <MessageSquare aria-hidden="true" />
              Comment
            </Button>
            <Button
              variant="outline"
              size="sm"
              id="note-ask"
              aria-keyshortcuts="q"
              title={props.root ? "Ask about the review (q)" : "Ask about the whole fact (q)"}
              disabled={!fact}
              onClick={() => props.onBegin("question")}
            >
              <MessageCircleQuestion aria-hidden="true" />
              Ask
            </Button>
          </div>
        </>
      )}
      <div id="panel-items">
        {items.map((item) => {
          const anchorState = item.anchor ? props.anchorStates.get(item.id) : undefined;
          // the edit composer lives inside the card it acts on — a form
          // at the panel's foot reads as targeting the last item
          const composerHere =
            props.composer && props.composer.mode === "edit" && props.composer.id === item.id
              ? props.composer
              : null;
          const composerBox = composerHere && (
            <ComposerBox
              key={`edit-${item.id}`}
              composer={composerHere}
              bare
              onCommit={props.onCommit}
              onCancel={props.onCancel}
            />
          );
          const question = item.type === "question";
          // the card itself carries no button role (a role=button may not
          // wrap the actions menu — nested interactive controls)
          const openThread = (): void => {
            scrollTop.current = panelEl()?.scrollTop ?? 0;
            props.onOpenThread(item.id);
          };
          const opens = question && !composerHere;
          return (
            <div
              key={item.id}
              className={`card item-${item.type} ${readonly ? "readonly" : ""} ${question ? "folded" : ""} ${anchorState === "drifted" ? "drifted" : ""} ${anchorState === "detached" ? "detached" : ""}`}
              data-id={item.id}
              tabIndex={0}
              onMouseEnter={() => props.onFocusItem(item.id)}
              onMouseLeave={() => props.onFocusItem(null)}
              onFocus={() => props.onFocusItem(item.id)}
              onBlur={() => props.onFocusItem(null)}
              onClick={opens ? openThread : undefined}
              onKeyDown={
                opens
                  ? (e) => {
                      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                        e.preventDefault(); // Space must open, not scroll
                        openThread();
                      }
                    }
                  : undefined
              }
            >
              <KindRow item={item} anchorState={anchorState} />
              {!readonly && (
                <DM.Root>
                  <DM.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="menu-btn"
                      style={{ position: "absolute", top: 6, right: 6 }}
                      aria-label={`Actions for ${item.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DM.Trigger>
                  <DM.Portal>
                    <DM.Content
                      className="menu z-50 min-w-[130px] rounded-md border bg-popover p-1 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                      align="end"
                      sideOffset={4}
                      onClick={(e) => e.stopPropagation()}
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
              )}
              {item.anchor?.quote && <blockquote>{item.anchor.quote}</blockquote>}
              {!readonly && anchorState === "detached" && (
                <div className="actions">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onReanchor(item.id);
                    }}
                  >
                    Re-anchor to selection
                  </Button>
                </div>
              )}
              {composerHere ? (
                composerBox
              ) : question ? (
                <FoldedQuestion
                  item={item}
                  yourTurn={!readonly && answeredByAgent(item)}
                  onOpen={openThread}
                />
              ) : (
                item.text && <Md block className="cardtext" text={item.text} />
              )}
            </div>
          );
        })}
        {readonly && items.length === 0 && (
          <p className="text-muted-foreground text-[13px]">
            No notes on this fact in revision {props.readonlyRevision}.
          </p>
        )}
        {/* the empty state is the manual: the one moment the reviewer will
            read what Comment and Ask actually set in motion */}
        {!readonly && fact && items.length === 0 && props.root && (
          <p className="text-muted-foreground text-[13px]">
            No notes on the review yet. A note here speaks to the whole review — the
            altitude, what to deepen or drop, where to focus next.{" "}
            <strong className="text-foreground font-[650]">Comment</strong> sets the direction
            of the next revision;{" "}
            <strong className="text-foreground font-[650]">Ask</strong> gets a live answer,
            including a cold read of this revision.
          </p>
        )}
        {!readonly && fact && items.length === 0 && !props.root && (
          <p className="text-muted-foreground text-[13px]">
            No notes on this fact. Select text in it, or use the buttons above for the whole
            fact, then <strong className="text-foreground font-[650]">Comment</strong> to
            request a change (the agent addresses it in the next revision) or{" "}
            <strong className="text-foreground font-[650]">Ask</strong> to get a live answer.
          </p>
        )}
        {!readonly && !fact && (
          <p className="text-muted-foreground text-[13px]">
            {props.ghost
              ? "This fact was removed — read-only, nothing to note."
              : props.root
                ? "This review has no overview fact (an _index.md at the revision root), so there is nowhere to note the review as a whole — select a fact to review it."
                : "This directory has no _index.md — select a fact to review it."}
          </p>
        )}
      </div>
      {!readonly && props.composer?.mode === "new" && (
        <ComposerBox
          composer={props.composer}
          root={props.root}
          onCommit={props.onCommit}
          onCancel={props.onCancel}
        />
      )}
      {!readonly && (
        <p className="keys-hint">
          j/k move · v seen · c/q raise · f filter · <Kbd>?</Kbd> help
        </p>
      )}
    </div>
  );
}

export function ComposerBox(props: {
  composer: Composer;
  /** rendered inside an item card: the card is the box, so no border,
   * no padding, and no "edit — q3" label restating what the card shows */
  bare?: boolean;
  /** on the front page an unanchored note is about the whole review */
  root?: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const composer = props.composer;
  const whole = props.root ? " — whole review" : " — whole fact";
  const label =
    composer.mode === "new"
      ? composer.type + (composer.anchor ? ` — “${composer.anchor.quote}”` : whole)
      : `edit ${composer.id}`;
  return (
    <form
      className={props.bare ? "composer mt-2" : "composer mt-3 rounded-lg border p-3"}
      id="item-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onCommit(ref.current?.value ?? "");
      }}
    >
      {!props.bare && (
        <div className="text-muted-foreground mb-2 text-[12px] whitespace-pre-wrap" id="item-form-label">
          {label}
        </div>
      )}
      {/* first-contact teaching: what each verb sets in motion */}
      {composer.mode === "new" && (
        <p className="text-muted-foreground mt-0 mb-2 text-[11.5px]">
          {composer.type === "question"
            ? "A question gets a live answer: the agent replies in a thread on this fact while you keep reviewing."
            : "A comment requests a change: the agent addresses it when it revises the facts, like a review comment on an MR."}
        </p>
      )}
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
        <span className="text-muted-foreground ml-auto text-[11px]">{MOD}↵ save · esc cancel</span>
      </div>
    </form>
  );
}
