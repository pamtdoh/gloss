# Writing fact files

A Gloss review succeeds when the human decides every fact without
opening anything else. Reading source is the cost Gloss exists to
remove, so a fact that sends the reviewer to the code has failed at
its one job. Every fact carries two duties: the reviewer can *decide*
it, and a cold reader can *follow* it. Failing either is a defect.
Hold every fact you write against this contract.

## What counts as a fact

**A standalone, decidable observation.** The title is one decidable
sentence — the reviewer can agree or object to it alone. The body
*observes* the design; the reviewer supplies the judgment. A fact is
not a thesis to defend: it needs no supporting argument, only enough
content for a cold reader to follow what is being stated.

**Written for a cold reader.** The reviewer arrives knowing roughly
what the project is and nothing else. They have not seen your
terminal, your screenshots, or the code you just read. A fact may
never lean on:

- **The generating conversation.** "The bug in the original
  screenshot" means nothing to a reviewer who was not there.
  Describe the bug in the fact.
- **Git archaeology.** A bare commit hash ("reverted in `5d851d1`")
  is an errand. State what happened; a hash may follow as a locator,
  never substitute.
- **The code itself.** The reviewer has no code open to check a
  claim against, so the fact carries its claim entirely in its own
  words. Test: if the fact only makes sense to someone with the
  codebase in front of them, it is an index into the codebase, not a
  fact. Showing a relevant shape — a struct, a schema, a signature —
  is fine; that is the fact carrying the content itself.

**Standing alone.** The test for a well-cut fact: someone who knows
the design and has read only the group's `_index.md` could write it
without reading its sibling facts. If two files can't be written independently, they are
one fact. If a file needs a preamble before its first sentence, the
preamble belongs in `_index.md`. Numeric prefixes order the reading
as a courtesy, not a dependency; a genuinely layered design may make
later facts assume earlier ones, but that is an allowed exception,
not the default shape.

**One claim per sentence.** A sentence carries one decidable claim:
an em dash, a colon, or an "and" must not fuse two claims the
reviewer could judge differently. If removing the joiner leaves two
sentences that each say something, write two sentences.

## What to write

**Open with the what.** The first sentence of the body states what
exists, what it does, or what changed — the way you would describe
the code to a colleague at a higher altitude. No situation paragraph,
no problem-first buildup. Two genre-shaped exceptions: when the
fact's substance is a block or table (interface, inventory), the
block itself may open the body; a delta may open with the old
behavior, because before → after order is its what.

**Elaborate to answer anticipated questions.** Body text beyond the
opening statement answers questions the reviewer would plausibly ask,
or supplies context they need to understand the statement; prose a
cold reader needs to follow the mechanism is an answer, not padding.
Context stays inline. A substantial answer goes under its own `##`
heading phrased as the literal question — "Why is this needed?",
"Why X and not Y?", "What is the flow, step by step?" — skippable
for a reviewer who already knows. A short fact is fine when nothing
needs answering; length is never spent on ceremony, hedging, or
general programming background. A reviewer cannot decide a why, so
justification is never the decidable content of a file; a fact whose
only substance is justification is deleted or merged into the fact
it justifies.

**Ground any claim the reviewer can't check from the fact alone.**
Three ways a claim stays abstract:

- If the reviewer would have to **simulate** it in their head —
  encodings, offsets, path resolution, ordering, concurrency — walk
  one real value through it, end to end, and show what comes out the
  other side — never a token example that stays vague.
- If they would have to **imagine** an artifact — a UI state, an
  error or empty state, CLI or wire output, a rendered result — show
  the real thing: the actual output line, a short transcript, or a
  figure ("Show, don't describe", below).
- If they would have to **trust** a quantity or rule — a boundary, a
  threshold, a precedence chain, an "only when" claim, a
  platform-divergent behavior — show what settles it: a constant or
  comparison read from the code, or a probe run where reading can't
  settle it.

A happy-path walkthrough may come first to build the reader's model;
a claim that can fail is still grounded at the failure or the
boundary. Each genre bullet below names its natural form of
grounding.

**Start from a genre.** The six genres below are reference shapes:
most facts fit one, and a fact may blend two when its subject demands
it — a mechanism whose walkthrough is a numbered ladder, an interface
with a short procedure attached. A fact that fits no shape is usually
making two claims.

| Genre | States | Typical form |
|---|---|---|
| Inventory | what parts exist | table, one row per part |
| Procedure | the steps of an important flow or API | numbered list |
| Mechanism | how one piece works | prose + one concrete walkthrough |
| Delta | what changed, at design level | before → after prose |
| Interface | the exact shape of a boundary | fenced code block |
| Invariant | a guarantee the design maintains | one operational "when…" sentence |

- **Inventory** lists what exists in some corner of the design:
  commands, endpoints, message types, files, states, UI pages, UI
  components. One row per part, with only the columns a reviewer
  needs to judge the set — name, role, and at most one or two more.
  The decidable claim is the set itself: the reviewer objects to a
  row, asks about a missing one, lets the rest stand. The table is
  its own grounding.
- **Procedure** writes down the steps of an important flow — a
  request lifecycle, an API call sequence, a startup order — as a
  numbered list, one action per step, in the order the system
  performs them. Ground it with one real request run through the
  steps. When the flow branches or loops, a short pseudocode block is
  often the clearest rendering; the ban is on pasting real code that
  must be reviewed line by line, not on code-shaped clarity.
- **Mechanism** explains the behavior of a single piece: what it
  does, in prose a cold reader can follow, grounded with a
  `Concretely:` walkthrough.
- **Delta** describes a change at design level: what the behavior
  was, what it is now, and what surface it touches. It substitutes
  for reading the diff, so it names the observable difference, not
  the edited lines. Ground it with the same input shown under old and
  new behavior. This is the genre for "review what changed" scopes.
- **Interface** shows a boundary as a fenced code block: a schema, a
  config format, a wire message, a CLI surface, a file layout. The
  block *is* the
  decidable content; the body around it stays minimal — one sentence
  on what the shape is for, plus only the field notes a reviewer
  couldn't infer from the shape itself. Ground it with a sample
  instance next to the schema when fields aren't obvious. Questions
  the shape raises go under `##` headings, as in any fact. Telling it
  apart from
  inventory: judging *what's in a set* is inventory; judging
  *field-level shape* is interface; both is two facts.
- **Invariant** states a property the design maintains across parts,
  written operationally — *"when/whenever ⟨event⟩, ⟨what holds⟩"* —
  with an actor, a moment, and an observable outcome. Slogan phrasing
  ("revisions are standalone") may appear only in the title, never as
  the body's statement. The one concrete violation serves as its
  concrete case. Telling it apart from mechanism: if deleting one
  component would make the claim meaningless, it's mechanism; if the
  claim still constrains whatever replaces that component, it's
  invariant. A mechanism often enforces an invariant, and the
  invariant fact may name it.

## How to word it

A fact's reader is a cold reader, often not a native English speaker,
with no author to ask. These rules come from ASD-STE100
controlled-language practice; each is checkable word by word:

| Rule | Write | Not |
|---|---|---|
| Active voice, named actor | "The server mints a token." | "A token is minted." |
| Simple tenses | "the viewer re-reads the sidecar" | "the sidecar has been re-read" |
| One plain verb, never a phrasal verb | "start the session" | "spin up the session" |
| The verb, not its noun | "the viewer resolves the anchor" | "the viewer performs resolution of the anchor" |
| One name per concept, used everywhere | always "run" | "run", "segment", "chunk" in rotation |
| Noun stacks of at most three words | "the arithmetic that maps offsets" | "the DOM source offset mapping arithmetic" |
| At most ~25 words per sentence; split instead of joining | two short sentences | "clause; clause" or a chain of subordinate clauses |
| Keep the subject, verb, and articles | "the lines that were not located" | "lines not located" (which lines?) |

Four more rules govern flow rather than words. Give information gradually: each sentence adds one new idea
to what the reader already holds. Connect sentences with visible
connecting words ("then", "thus", "because of this") — the reader
must never have to infer the link between two sentences. Introduce a
long term in full once, then use one consistent short form. Keep one
topic per paragraph, at most about six sentences.

Two shapes to copy directly. State a sharp edge the way a warning is
written — the condition first, then the consequence: "If
you delete a sidecar item during a live session, the viewer treats
it as resolved", never a risk buried mid-sentence. And a caution: a
hedge is content. "May drift" must not become "drifts" to save
words — the goal is a sentence that cannot be misread, not the
shortest sentence.

## How to display it

Prose is the default; a form is chosen when it shows structure that
prose would force the reader to reconstruct.

| Content | Form |
|---|---|
| three or more parallel cases (part × attribute, case × handling) | GFM table |
| a small unordered set of points | bullet list |
| steps in a required order | numbered list |
| an exact shape (schema, config, wire format, CLI surface) | fenced code block |
| an algorithm — a decision ladder, a matching loop, branching logic | short pseudocode block |
| a value crossing boundaries, a lifecycle, a data flow | Mermaid diagram |
| a visual subject (a page, a component, styling, a user flow) | screenshot or drawn figure — see "Show, don't describe" |
| real code the reviewer must read line by line | never — that defeats the review |

### Show, don't describe

A visual fact with no figure asks the reviewer to imagine the thing
they are judging: when the subject is visual, the fact carries a
figure. (When to capture is workflow — SKILL.md step 2.) What a
figure must be:

- **A screenshot of the running app, not a mockup.** Staged state is
  fine — a seeded database, planted review items, a fabricated
  session — but the fact must say the state is staged, so the
  reviewer doesn't mistake sample data for their own.
- **Proportionate.** One figure per fact by default, and prose
  suffices where one sentence fully specifies the state ("the empty
  list shows 'No reviews yet'").
- **Drawn only where values are better seen than read** — a palette
  as swatches, layout regimes side by side, a state chart — and
  hand-drawn SVG only where a Mermaid diagram can't show it.
- **Stored inside the revision directory**, referenced relatively, so
  it survives revision copies.
- **Self-backgrounded.** The viewer renders in light and dark themes;
  a figure that assumes the page's background is unreadable in the
  other theme.

## Examples

One complete fact, mechanism genre, at full length:

```markdown
# Viewer auth is a one-time token, then a session cookie

The session URL carries a token that works exactly once. The first
visit burns the token and sets a session cookie. Every later request
from that browser uses the cookie.

Concretely: the `session.started` event prints
`http://127.0.0.1:37665/auth?token=ba47…`. The first visit burns the
token and redirects to the viewer with a cookie set. Pasting that
same URL into a second browser gets a 403, because the token is
already burned.

Each `gloss session` run mints a fresh token. Nothing
persists across runs.

## Why a one-time token?

The session URL lands in terminal scrollback and shell history. A
token that burns on first use means a leaked line cannot open the
review for anyone else.

## What does a second reviewer do?

They ask for a new `gloss session` run. Tokens are per run, so a
shared link cannot admit them.
```

Compact examples of four more genres, showing each form:

**Inventory** — a complete fact can be a title and a table:

```markdown
# The CLI has three commands

| Command | Role |
|---|---|
| `gloss init` | create `.gloss/` in the repo (idempotent) |
| `gloss session <review>` | serve the viewer, stream JSONL events until the review finishes |
| `gloss skill install` | write the skills where an agent will find them |
```

**Delta** — the observable difference, not the edited lines:

```markdown
# Fact paths now normalize to "/" where the server creates them

Before, fact paths used the platform's separator. On Windows the
viewer received `10-flow\_index.md`, so no directory grouping matched
and facts rendered as one flat backslashed list. Now the server
normalizes to `/` at the two places it creates a path, and the same
fact arrives everywhere as `10-flow/_index.md`.
```

**Interface** — the block is the claim:

````markdown
# A sidecar item is a comment or a question with a thread

```json
{
  "id": "q1",
  "type": "question",
  "anchor": { "quote": "the exact text the reviewer selected" },
  "thread": [{ "who": "human", "text": "…" }]
}
```

`anchor` is optional. An item without one applies to the whole fact.
`type` is `"comment"` or `"question"`. A comment carries `text`
instead of a `thread`.
````

**Invariant** — operational statement, then the violation:

```markdown
# Revisions never reference each other

Whenever the agent creates a new revision, it copies every fact file
into it as a standalone copy, with no link, include, or mention of
the previous revision. The concrete violation: a fact in `2/` that
says "unchanged from revision 1", or an image referenced from `1/`.
Either breaks the guarantee that every revision, including
`approved/`, stays readable after anyone edits or deletes the
earlier ones.
```
