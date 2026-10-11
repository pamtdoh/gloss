import * as React from "react";
import { CircleHelp, GitCompareArrows, Menu, MessageCircleQuestion, Moon, Sun } from "lucide-react";
import { BRAND_SVG } from "./brand.js";
import { COARSE } from "./common.js";
import { keyFor } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.js";

export function Header(props: {
  review: string;
  progress: { seen: number; total: number };
  position: { index: number; count: number };
  questions: { total: number; answered: number };
  /** the agent's status line, shown while it works */
  status: string | null;
  revision: number;
  revisions: number[];
  served: number | null;
  canCompare: boolean;
  compareOn: boolean;
  canFinish: boolean;
  pending: number;
  dark: boolean;
  onTree: () => void;
  onQuestions: () => void;
  onHelp: () => void;
  onTheme: () => void;
  onCompare: () => void;
  onRevision: (revision: number) => void;
  onFinish: () => void;
}): React.JSX.Element {
  const { questions } = props;
  const latest = Math.max(...props.revisions);
  return (
    <header className="hdr">
      <Button variant="ghost" size="icon-sm" className="hamburger" id="btn-tree" aria-label="Toggle fact tree" onClick={props.onTree}>
        <Menu />
      </Button>
      <h1>
        <span className="brand" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND_SVG }} />
        <span id="review-name">{props.review}</span>
      </h1>
      <span className="progress stat" id="progress">
        <span className="max-[560px]:hidden">
          {props.progress.seen} / {props.progress.total} reviewed
        </span>
        {/* sequential readers care where they are, not how much is seen */}
        <span className="hidden max-[560px]:inline">
          {props.position.index + 1}/{props.position.count}
        </span>
      </span>
      <span aria-live="polite">
        {questions.total > 0 && (
          <button className={`pill ${questions.answered ? "attn" : ""}`} id="question-pill" onClick={props.onQuestions}>
            <span className="max-[560px]:hidden">
              {questions.answered
                ? `${questions.answered} answered — your turn`
                : `${questions.total} open question${questions.total > 1 ? "s" : ""}`}
            </span>
            <span className="hidden items-center gap-1 max-[560px]:inline-flex">
              <MessageCircleQuestion className="lucide size-3.5" size={14} />
              {questions.answered || questions.total}
            </span>
          </button>
        )}
      </span>
      {props.status && (
        <span className="agent-status" id="agent-status" role="status" title={props.status}>
          <span className="agent-status-dot" aria-hidden="true" />
          <span className="max-[560px]:hidden">{props.status}</span>
        </span>
      )}
      <span className="spacer" />
      <Button variant="ghost" size="icon-sm" id="btn-help" aria-label="Help" title="Shortcuts & concepts (?)" onClick={props.onHelp}>
        <CircleHelp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        id="btn-theme"
        aria-label={props.dark ? "Switch to light theme" : "Switch to dark theme"}
        title={props.dark ? "Light theme" : "Dark theme"}
        onClick={props.onTheme}
      >
        {props.dark ? <Moon /> : <Sun />}
      </Button>
      {props.canCompare && (
        <Button
          variant="ghost"
          size="icon-sm"
          id="btn-compare"
          className={props.compareOn ? "compare-active" : ""}
          aria-label={props.compareOn ? "Exit compare" : "Compare revisions"}
          aria-pressed={props.compareOn}
          aria-keyshortcuts={keyFor("compare")}
          title={`${props.compareOn ? "Exit compare" : "Compare revisions"}${COARSE ? "" : ` (${keyFor("compare")})`}`}
          onClick={props.onCompare}
        >
          <GitCompareArrows />
        </Button>
      )}
      <Select value={String(props.revision)} onValueChange={(value) => props.onRevision(Number(value))}>
        <SelectTrigger
          size="sm"
          id="revision-select"
          aria-label="Revision"
          title={props.revision === latest ? undefined : `Older revision — ${latest} is latest`}
          className={`revision-select w-[140px] max-[560px]:w-[76px] ${props.revision === latest ? "" : "revision-stale"}`}
        >
          <span className="max-[560px]:hidden">
            <SelectValue />
          </span>
          <span className="hidden max-[560px]:inline">R{props.revision}</span>
        </SelectTrigger>
        <SelectContent>
          {props.revisions.map((r) => (
            <SelectItem key={r} value={String(r)}>
              Revision {r}
              {r === props.served ? " · in review" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.pending > 0 && (
        <span className="pill unsaved-pill" id="unsaved-pill" role="status">
          {props.pending} unsent
        </span>
      )}
      {props.canFinish && (
        <Button size="sm" id="btn-finish" onClick={props.onFinish}>
          <span className="max-[560px]:hidden">Finish review</span>
          <span className="hidden max-[560px]:inline">Finish</span>
        </Button>
      )}
    </header>
  );
}
