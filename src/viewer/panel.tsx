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
import { COARSE, type Composer } from "./common.js";
import { Md } from "./components.js";
import { answeredByAgent, type AnchorState, type Fact } from "./model.js";
import { MOD, keyFor } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import { Kbd } from "./ui/kbd.js";
import { Textarea } from "./ui/textarea.js";

function AnchorChips(props: { state: AnchorState | undefined }): React.JSX.Element | null {
  if (props.state === "drifted") return <span className="chip changed">drifted</span>;
  if (props.state === "detached") return <span className="chip stale">detached</span>;
  return null;
}

/** The kind's glyph: a speech square for a comment, a question bubble for
 * a question — the same two icons the selection bubble offers, so the
 * card repeats the choice that made it. */
function KindIcon(props: { kind: string }): React.JSX.Element {
  return props.kind === "question" ? (
    <MessageCircleQuestion className="lucide size-3 q" size={12} aria-hidden="true" />
  ) : (
    <MessageSquare className="lucide size-3" size={12} aria-hidden="true" />
  );
}

function KindRow(props: {
  item: SidecarItem;
  anchorState: AnchorState | undefined;
}): React.JSX.Element {
  return (
    <span className="kind">
      <KindIcon kind={props.item.type} />
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
        <ReplyBox onSubmit={(text) => props.onReplySubmit!(item.id, text)} />
      )}
    </div>
  );
}

/** The keyboard contract every box in the panel shares: the modifier
 * chord commits, and Escape is the box's own exit. */
function boxKeys(
  commit: () => void,
  onEscape: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void,
): (e: React.KeyboardEvent<HTMLTextAreaElement>) => void {
  return (e) => {
    if (e.key === "Escape") onEscape(e);
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };
}

/** The chord and the exit, printed where there is a keyboard. */
function KeyHint(props: { escape: string }): React.JSX.Element | null {
  if (COARSE) return null;
  return (
    <span className="text-muted-foreground ml-auto text-[11px]">
      {MOD}↵ · esc {props.escape}
    </span>
  );
}

/** The thread's reply box: a field and its verb, nothing more — the
 * subpage is the frame, so no card around it, and there is no state to
 * cancel out of. It stays put: a reply clears it, a blank reply is a
 * no-op, Escape drops a draft and leaves the field, and Escape on an
 * empty field falls through to the global close, which shuts the
 * thread. Focus stays on the Back control the subpage opened with. */
function ReplyBox(props: { onSubmit: (text: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const commit = (): void => {
    const text = ref.current?.value ?? "";
    if (!text.trim()) return;
    props.onSubmit(text);
    if (ref.current) ref.current.value = "";
  };
  return (
    <form
      className="thread-reply"
      id="thread-reply"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <Textarea
        id="thread-reply-input"
        aria-label="Reply"
        placeholder="Reply…"
        ref={ref}
        onKeyDown={boxKeys(commit, (e) => {
          if (!e.currentTarget.value) return; // nothing to drop: the thread closes
          e.stopPropagation();
          e.currentTarget.value = "";
          e.currentTarget.blur();
        })}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm" id="thread-send">
          Reply
        </Button>
        <KeyHint escape="clears" />
      </div>
    </form>
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
  /** a previous revision exists, so the diff toggle does something */
  canCompare: boolean;
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
          {/* the buttons exist for readers without a keyboard; with one, c
              and q are the whole-fact path and the hint below names them */}
          {COARSE && (
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
          )}
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
            <strong className="text-foreground font-[650]">Ask</strong> gets a live answer. To
            have the next revision read cold before you see it, say so in a comment.
          </p>
        )}
        {!readonly && fact && items.length === 0 && !props.root && (
          <p className="text-muted-foreground text-[13px]">
            No notes on this fact. Select text in it, or{" "}
            {COARSE ? "use the buttons above" : "press c or q"} for the whole fact, then{" "}
            <strong className="text-foreground font-[650]">Comment</strong> to request a change
            (the agent addresses it in the next revision) or{" "}
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
      {!readonly && !COARSE && (
        <p className="keys-hint">
          j/k move · v seen · c/q raise · f filter ·{" "}
          {props.canCompare && `${keyFor("compare")} diff · `}
          <Kbd>?</Kbd> help
        </p>
      )}
    </div>
  );
}

/** The composer for a new note or an edit: the kind, the anchor context,
 * and the verb that opened it, on the shared box below. */
export function ComposerBox(props: {
  composer: Composer;
  /** rendered inside an item card: the card is the box and already names
   * the kind, so no border and no header */
  bare?: boolean;
  /** on the front page an unanchored note is about the whole review */
  root?: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const composer = props.composer;
  const isNew = composer.mode === "new";
  // the anchor's quote becomes the card's blockquote; an unanchored note
  // says its scope beside the kind word instead
  const quote = isNew && composer.anchor ? composer.anchor.quote : undefined;
  const scope = isNew && !composer.anchor ? (props.root ? "whole review" : "whole fact") : undefined;
  const submitLabel = !isNew ? "Save" : composer.type === "question" ? "Ask" : "Comment";
  return (
    <NoteComposer
      kind={isNew ? composer.type : "comment"}
      quote={quote}
      scope={scope}
      submitLabel={submitLabel}
      initial={isNew ? "" : composer.initial}
      bare={props.bare}
      formId="item-form"
      inputId="item-input"
      submitId="item-save"
      cancelId="item-cancel"
      labelId="item-form-label"
      onCommit={props.onCommit}
      onCancel={props.onCancel}
    />
  );
}

/** The box a note is typed into — a new one, or an edit inside its
 * card — styled as the card its text becomes: the kind's left border
 * and uppercase word, then the context, the textarea, and the verb that
 * raised it. Cancel closes it without saving. (A thread reply is not a
 * note in the making; it has its own box above.) */
export function NoteComposer(props: {
  kind: "comment" | "question";
  /** the quoted text an anchored note points at, shown as the card's blockquote */
  quote?: string;
  /** an unanchored note's scope, "whole fact" or "whole review", beside the kind word */
  scope?: string;
  submitLabel: string;
  initial?: string;
  /** inside a card: the card is the box and already names the kind */
  bare?: boolean;
  formId: string;
  inputId: string;
  submitId: string;
  cancelId: string;
  labelId?: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const commit = (): void => props.onCommit(ref.current?.value ?? "");
  const tone = props.kind === "comment" ? "item-comment" : "item-question";
  return (
    <form
      className={props.bare ? "composer composer-bare" : `composer card ${tone}`}
      id={props.formId}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      {!props.bare && (
        <div className="composer-head" id={props.labelId}>
          <span className="kind-word">
            <KindIcon kind={props.kind} />
            {props.kind}
          </span>
          {props.scope && <span className="ctx"> — {props.scope}</span>}
        </div>
      )}
      {!props.bare && props.quote && <blockquote>{props.quote}</blockquote>}
      <Textarea
        id={props.inputId}
        aria-label="Note text"
        ref={ref}
        defaultValue={props.initial ?? ""}
        onKeyDown={boxKeys(commit, (e) => {
          e.stopPropagation();
          props.onCancel();
        })}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm" id={props.submitId}>
          {props.submitLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          id={props.cancelId}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <KeyHint escape="cancel" />
      </div>
    </form>
  );
}
