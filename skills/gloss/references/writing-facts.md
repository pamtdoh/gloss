# Writing fact files

A Gloss review succeeds when the human decides every fact without
opening anything else. Every fact serves the reviewer in two ways:
they can *decide* it, and they can *follow* it as a cold reader. A
fact they cannot decide costs a reading pass without settling
anything; a fact they cannot follow sends them to you or to the code
for the missing context, which is the reading Gloss exists to
remove.

In this file: what counts as a fact · what to write · genres ·
wording · display · figures.

## What counts as a fact

**A standalone, decidable observation.** The title is one decidable
sentence with a verb: the reviewer can agree or object to it alone.
The body observes the design in neutral terms, sharp edges included,
and the reviewer supplies the judgment. A fact is not a thesis to
defend — it needs no supporting argument, only enough content for a
cold reader to follow what is being stated.

**Written for a cold reader.** The reviewer arrives knowing roughly
what the project is and nothing else — not your terminal, your
screenshots, or the code you just read. Any term the project itself
does not define (a harness, a compaction, an agent tool name) gets a
plain gloss at first use. A fact may never lean on:

- **The generating conversation.** "The bug in the original
  screenshot" means nothing to a reviewer who was not there —
  describe the bug in the fact.
- **Git archaeology.** A bare commit hash sends the reviewer on an
  errand. State what happened; a hash may follow as a locator,
  never substitute.
- **The code itself.** The reviewer has no code open, so the fact
  carries its claim entirely in its own words. If the fact only
  makes sense to someone with the codebase in front of them, it is
  an index into the codebase, not a fact. Showing a relevant shape
  (a struct, a schema, a signature) is fine — then the fact carries
  the content itself.

## What to write

**Open with the what.** The first thing in the body states what
exists, what it does, or what changed, the way you would describe
the code to a colleague one level above it — the reviewer can only
start judging once the claim is in front of them. Anything that *is*
the claim counts as opening with it: a schema block or an inventory
table can open the body when the block is the fact's substance.

**Elaborate to answer anticipated questions.** Body text beyond the
opening answers questions the reviewer would plausibly ask, or
supplies context they need to follow the statement. A substantial
answer goes under its own `##` heading phrased as the literal
question ("Why is this needed?", "What is the flow, step by step?"),
so a reviewer who already knows can skip it. A short fact is
complete when nothing needs answering; length that answers no
question costs reading time without adding anything to judge.

**Stop at the review's altitude** (SKILL.md governs it). Detail
below the altitude is named, not elaborated: one sentence that the
layer exists and what the fact leaves out, so the reviewer knows
there is more and can pull it. A named, unelaborated detail is not a
hole and needs no grounding.

**Ground any claim the reviewer can't check from the fact alone.**
Grounding is evidence inside the fact: the claim states the design,
the grounding shows it, so the reviewer checks instead of trusts.
Three cues that a claim needs it:

- If the reviewer would have to **simulate** it in their head
  (encodings, offsets, ordering, concurrency), walk one real value
  through it, end to end.
- If they would have to **imagine** an artifact (a UI state, an
  error, CLI or wire output), show the real thing: the actual
  output line, a short transcript, or a figure.
- If they would have to **trust** a quantity or rule (a boundary, a
  threshold, an "only when" claim), show what settles it: a
  constant read from the code, or a probe where reading can't
  settle it. An unverified "only" is the easiest false claim to
  write.

## Start from a genre

Most facts fit one of six reference shapes; blend two when the
subject demands it.

| Genre | States | Typical form and grounding |
|---|---|---|
| Inventory | what parts exist | table, one row per part; the set is the claim and the table its own grounding |
| Procedure | the steps of an important flow | numbered list, one action per step, one real request walked through it |
| Mechanism | how one piece works | prose + one `Concretely:` walkthrough with a real value |
| Delta | what changed, at design level | old behavior → new behavior; the observable difference, not the edited lines |
| Interface | the exact shape of a boundary | fenced code block that *is* the claim; minimal prose around it |
| Invariant | a guarantee the design maintains | "when ⟨event⟩, ⟨what holds⟩" with an actor and an observable outcome, plus the one violation that would break it |

One complete fact, mechanism genre, showing the shape most facts
take — an opening claim, a grounded walkthrough, and
question-headed elaboration:

```markdown
# Proxied viewer auth is a one-time token, then a session cookie

When a session is served through a private proxy (`--serve-host`),
its URL carries a token that works exactly once. The first visit
burns the token and sets a session cookie. Every later request
from that browser uses the cookie.

Concretely: the `session.started` event prints
`http://127.0.0.1:37665/auth?token=ba47…`. The first visit burns the
token and redirects to the viewer with a cookie set. Pasting that
same URL into a second browser gets a 403, because the token is
already burned.

## Why a one-time token?

The session URL lands in terminal scrollback and shell history. A
token that burns on first use means a leaked line cannot open the
review for anyone else.
```

## How to word it

The reader is cold, often not a native English speaker, and has no
author to ask, so plain connected prose serves them best. Short
sentences, each adding one idea, connected with visible links
("then", "because of this") so the reader never infers the joint.
Name the actor — "the server mints a token", not "a token is
minted" — because an actorless sentence hides who does the work.
Call each concept by one name everywhere; introduce a long term in
full once, then use one consistent short form. Keep asides out of
the middle of sentences — an aside usually deserves a sentence of
its own. State a sharp edge the way a warning is written, condition
first: "If you delete a note from a sidecar during a live session, the
viewer treats it as resolved." These are directions, not rules to
audit — when a sentence reads clearly aloud, it is done.

## How to display it

Write prose by default. Switch form when the content has a shape
the reader would otherwise build in their head:

| Content | Form |
|---|---|
| three or more parallel cases | GFM table |
| a small unordered set of points | bullet list |
| steps in a required order | numbered list |
| an exact shape (schema, config, wire format) | fenced code block |
| an algorithm or branching logic | short pseudocode block |
| a value crossing boundaries, a lifecycle | Mermaid diagram |
| a visual subject (a page, a component, styling) | screenshot or figure |

When a fact quotes its source, prefer one excerpt over many
fragments: show the operative words inside enough surrounding text
that the reader sees where they live, mark them in bold, and cut
unrelated stretches with an ellipsis. Your own sentences carry the
point; the verbatim words stay in the block.

## Figures

A visual fact with no figure asks the reviewer to imagine the thing
they are judging, so when the subject is visual, the fact carries a
figure. (When to capture is workflow: SKILL.md step 2.)

- **A screenshot of the running app, not a mockup.** Staged state
  is fine (seeded data, planted notes), but the fact must
  say so, so the reviewer doesn't mistake sample data for their
  own.
- **Stored in `images/` at the revision root**, referenced
  relatively (`images/panel.png`, or `../images/panel.png` from a
  fact inside a subdirectory). One place for every figure, so
  nothing is scattered or orphaned, and the references survive
  revision copies.
- **Proportionate.** One figure per fact by default; prose suffices
  where one sentence fully specifies the state.
- **Self-backgrounded.** The viewer renders in light and dark
  themes, so a figure that assumes the page's background is
  unreadable in the other theme. Draw figures only where values are
  better seen than read, and prefer Mermaid where it can show the
  same thing.
