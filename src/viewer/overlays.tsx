import * as React from "react";
import { Search } from "lucide-react";
import { COARSE, keepFocusOutOfFields } from "./common.js";
import { titleOf, type Fact, type ReviewData } from "./model.js";
import { SHORTCUTS } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { Kbd } from "./ui/kbd.js";

// one line per gloss term — the depth layer behind the in-flow microcopy;
// everything else the viewer teaches at the moment of use
const CONCEPTS: [string, string][] = [
  ["Fact", "one small claim about the design, one file. Let it stand or raise something on it — silence is agreement."],
  ["Overview", "the review's front page, the root fact. Notes on it speak to the review as a whole: its altitude, its focus, what to deepen or drop — or ask for a cold read."],
  ["Revision", "one pass of the review. After your feedback the agent writes the next one; each is a standalone copy."],
  ["Note", "a comment or a question, raised on a fact or on the overview."],
  ["Comment", "requests a change — the agent addresses it when it revises the facts, like a review comment on an MR."],
  ["Ask", "a live question — the agent answers in a thread on the fact while you keep reviewing."],
  ["Seen", "your own reading progress mark. It decides nothing."],
  ["Raised", "the scope that keeps only facts with notes; s cycles All, Changed, Raised."],
  ["Finish", "ends the session; the agent writes the next revision from everything you raised and serves it."],
  ["Approve", "accepts this revision as the agreed design — implementation starts from it, the review is over."],
];

export function Help(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  const sections = [...new Set(SHORTCUTS.map((s) => s.section))];
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        id="help-sheet"
        className="max-h-[74vh] overflow-y-auto sm:max-w-[640px]"
        onCloseAutoFocus={keepFocusOutOfFields}
      >
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
        </DialogHeader>
        {/* no keyboard on a touch screen: the shortcut sections would
            list keys the reader cannot press */}
        {!COARSE && (
          <div className="grid grid-cols-2 gap-x-7 gap-y-1">
            {sections.map((section) => (
              <div key={section}>
                <h3 className="text-muted-foreground mt-3 mb-1 text-[11px] font-[650] tracking-wide uppercase">
                  {section}
                </h3>
                {SHORTCUTS.filter((s) => s.section === section).map((s) => (
                  <div key={s.id} className="flex justify-between gap-3 py-0.5 text-[13px]">
                    <span>{s.label}</span>
                    <Kbd>{s.shown}</Kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className={COARSE ? "" : "border-line-soft border-t pt-3"} id="help-concepts">
          <h3 className="text-muted-foreground mb-1 text-[11px] font-[650] tracking-wide uppercase">
            Concepts
          </h3>
          {CONCEPTS.map(([term, definition]) => (
            <p key={term} className="m-0 py-0.5 text-[13px]">
              <strong className="font-[650]">{term}</strong>{" "}
              <span className="text-muted-foreground">— {definition}</span>
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}


// The one end-of-session surface. Two outcomes, each explained where it is
// chosen, and the approve confirmation swaps this sheet's content in place —
// a dialog stacked on a dialog reads as a malfunction, not a flow.
export function FinishSheet(props: {
  open: boolean;
  data: ReviewData;
  progress: { seen: number; total: number };
  openQuestions: number;
  raisedFacts: Fact[];
  /** boxes with unsent text — a draft survives navigation, not the session */
  drafts: number;
  onFinish: () => void;
  onApprove: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [step, setStep] = React.useState<"choose" | "approve">("choose");
  const raised = props.raisedFacts.length;
  const clean = raised === 0 && props.openQuestions === 0;
  const close = (): void => {
    setStep("choose");
    props.onClose();
  };
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && close()}>
      <DialogContent id="finish-sheet" className="sm:max-w-[560px]">
        {step === "approve" ? (
          <>
            <DialogHeader>
              <DialogTitle>Approve this design?</DialogTitle>
            </DialogHeader>
            <p className="text-[13px]">
              Revision {props.data.revision} becomes the agreed design: it is copied to{" "}
              <code>approved/</code>, implementation starts from that copy, and the review
              session ends.
            </p>
            {!clean && (
              <p className="text-muted-foreground text-[13px]">
                Your {raised} fact{raised === 1 ? "" : "s"} with notes and{" "}
                {props.openQuestions} open question{props.openQuestions === 1 ? "" : "s"} will
                be approved as written — go back and finish instead if the agent should
                address them first.
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button size="sm" id="approve-go" onClick={props.onApprove}>
                Approve design
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>End review — revision {props.data.revision}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground stat text-[13px]">
              {props.progress.seen} of {props.progress.total} facts seen · {raised} fact
              {raised === 1 ? "" : "s"} with notes · {props.openQuestions} open question
              {props.openQuestions === 1 ? "" : "s"}
            </p>
            {/* a draft outlives the box it was typed in, not the session:
                the one moment to say so is before the session ends */}
            {props.drafts > 0 && (
              <p className="text-[13px]" id="finish-drafts">
                <strong className="font-[650]">
                  {props.drafts} unsent draft{props.drafts === 1 ? "" : "s"}
                </strong>{" "}
                <span className="text-muted-foreground">
                  — only posted notes reach the agent. Go back and post or discard{" "}
                  {props.drafts === 1 ? "it" : "them"} first.
                </span>
              </p>
            )}
            <ul className="max-h-[32vh] list-none overflow-y-auto p-0">
              {props.raisedFacts.map((fact) => {
                const items = fact.sidecar?.items ?? [];
                return (
                  <li key={fact.path} className="border-line-soft border-b py-1.5 text-[13px]">
                    {items.length > 0 && (
                      <span className="chip count mr-1.5">
                        {items.length} note{items.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {titleOf(fact)}
                    <div className="text-muted-foreground text-[11px]">{fact.path}</div>
                  </li>
                );
              })}
              {raised === 0 && (
                <li className="py-1.5 text-[13px]">Nothing raised on any fact.</li>
              )}
            </ul>
            {/* the two ways out, each saying what it does — "finish" and
                "approve" are gloss terms a first-time reviewer has never met */}
            <div className="grid gap-2.5">
              <div className="border-line-soft rounded-lg border p-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-[650]">Send feedback</span>
                  <Button
                    size="sm"
                    variant={clean ? "outline" : "default"}
                    id="confirm-finish"
                    onClick={props.onFinish}
                  >
                    Finish review
                  </Button>
                </div>
                <p className="text-muted-foreground m-0 text-[12.5px]">
                  {clean
                    ? "Ends the session without notes — continue with the agent in the terminal."
                    : "The session ends and the agent writes the next revision from your notes and serves it."}
                </p>
              </div>
              <div className="border-line-soft rounded-lg border p-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[13px] font-[650]">Approve the design</span>
                  <Button
                    size="sm"
                    variant={clean ? "default" : "outline"}
                    id="confirm-approve"
                    onClick={() => setStep("approve")}
                  >
                    Approve…
                  </Button>
                </div>
                <p className="text-muted-foreground m-0 text-[12.5px]">
                  Accept these facts as the agreed design and end the review — implementation
                  will start from this revision.
                  {!clean && " Anything you raised is accepted as written."}
                </p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

