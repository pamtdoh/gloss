import * as React from "react";
import { Search } from "lucide-react";
import { keepFocusOutOfFields } from "./common.js";
import { titleOf, type Fact, type ReviewData } from "./model.js";
import { SHORTCUTS } from "./shortcuts.js";
import { Button } from "./ui/button.js";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { Kbd } from "./ui/kbd.js";

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
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-7 gap-y-1">
          {sections.map((section) => (
            <div key={section}>
              <h3 className="text-muted-foreground mt-3 mb-1 text-[11px] font-[650] tracking-wide uppercase">
                {section}
              </h3>
              {SHORTCUTS.filter((s) => s.section === section && s.id !== "paletteSlash").map((s) => (
                <div key={s.id} className="flex justify-between gap-3 py-0.5 text-[13px]">
                  <span>{s.label}</span>
                  <Kbd>{s.shown}</Kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Palette(props: {
  open: boolean;
  data: ReviewData;
  commands: { label: string; run: () => void }[];
  onJump: (path: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      onCloseAutoFocus={keepFocusOutOfFields}
      title="Search facts and commands"
      description="Type to search facts; commands are listed below"
    >
      <CommandInput placeholder="Search facts and commands…" />
      <CommandList id="palette-list">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Facts">
          {props.data.facts.map((fact) => (
            <CommandItem
              key={fact.path}
              value={`${titleOf(fact)} ${fact.path}`}
              onSelect={() => props.onJump(fact.path)}
            >
              <span className="truncate">{titleOf(fact)}</span>
              <span className="text-muted-foreground ml-auto truncate text-[11px]">
                {fact.path}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Commands">
          {props.commands.map((command) => (
            <CommandItem
              key={command.label}
              value={`> ${command.label}`}
              onSelect={() => {
                props.onClose();
                command.run();
              }}
            >
              {command.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function FinishSheet(props: {
  open: boolean;
  data: ReviewData;
  progress: { seen: number; total: number };
  openQuestions: number;
  raisedFacts: Fact[];
  onFinish: () => void;
  onApprove: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent id="finish-sheet" className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Finish review — revision {props.data.revision}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground stat text-[13px]">
          {props.progress.seen} of {props.progress.total} facts seen ·{" "}
          {props.raisedFacts.length} fact{props.raisedFacts.length === 1 ? "" : "s"} with notes ·{" "}
          {props.openQuestions} open question
          {props.openQuestions === 1 ? "" : "s"}
        </p>
        <ul className="max-h-[40vh] list-none overflow-y-auto p-0">
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
          {props.raisedFacts.length === 0 && (
            <li className="py-1.5 text-[13px]">
              Nothing raised — finishing records agreement with every fact.
            </li>
          )}
        </ul>
        <DialogFooter>
          <Button variant="outline" size="sm" id="confirm-approve" onClick={props.onApprove}>
            Approve revision…
          </Button>
          <Button size="sm" id="confirm-finish" onClick={props.onFinish}>
            Finish review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

