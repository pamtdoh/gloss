# Writing fact files

A Gloss review succeeds when the human decides every fact without
opening anything else: not the source, not git history, not the
conversation that produced the review. SKILL.md governs the workflow
and the shape of the tree; this file governs the words inside each
fact. Read it before writing the first fact, and hold every fact you
write against it. Four sections: what counts as a fact, what to
write, how to display it, examples.

## What counts as a fact

**A standalone, decidable observation.** The title is one decidable
sentence — the reviewer can agree or object to it alone. The body
*observes* the design; the reviewer supplies the judgment. A fact is
not a thesis to defend: it needs no supporting argument, only enough
content for a cold reader to understand what is being stated.

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
- **The code itself.** A pointer like `session.ts:57` may *anchor* a
  claim so the implementer can find it later. It must never *carry*
  the claim. Test: delete every pointer from the fact. If the fact
  stops making sense, it was an index into the codebase, not a fact.

**Standing alone.** The test for a well-cut fact: someone who read
only the group's `_index.md` could write it without reading its
sibling facts. If two files can't be written independently, they are
one fact. If a file needs a preamble before its first sentence, the
preamble belongs in `_index.md`. Numeric prefixes order the reading
as a courtesy, not a dependency; a genuinely layered design may make
later facts assume earlier ones, but that is an allowed exception,
not the default shape.

**One claim per sentence.** An em dash must not join two independent
claims, and a colon must not chain three. Dash-spliced sentences let
distant facts sit next to each other without the connective tissue
that would reveal whether they cohere. If removing the dash leaves
two sentences that each say something, write two sentences.

## What to write

**Open with the what.** The first sentence of the body states what
exists, what it does, or what changed — the way you would describe
the code to a colleague at a higher altitude. No situation paragraph,
no problem-first buildup.

**Elaborate only to answer anticipated questions.** Body text beyond
the opening statement serves two purposes only: answering a question
the reviewer would plausibly ask ("what happens on conflict?", "where
does this run?"), or supplying context they need to understand the
statement. If no question is anticipated, the fact ends after the
what — two sentences is a complete fact. Length is spent on answers
and context, never on ceremony, hedging, or general programming
background.

**Ground any claim the reviewer can't check from the fact alone.**
Three ways a claim stays abstract:

- If the reviewer would have to **simulate** it in their head —
  encodings, offsets, path resolution, ordering, concurrency — walk
  one real value through it and show what comes out the other end.
- If they would have to **imagine** an artifact — a UI state, an
  error or empty state, CLI or wire output, a rendered result — show
  the real thing: the actual output line, a short transcript, or a
  figure ("Show, don't describe", below).
- If they would have to **trust** a quantity or rule — a boundary, a
  threshold, a precedence chain, an "only when" claim, a
  platform-divergent behavior — show what settles it: a constant or
  comparison read from the code, or a probe run where reading can't
  settle it.

One case per claim, chosen at the failure or the boundary, not the
happy path. Each genre has its own natural form of this:

| Genre | Its concrete case |
|---|---|
| Mechanism | a `Concretely:` walkthrough (the heaviest user) |
| Procedure | one real request run through the numbered steps |
| Invariant | the one violation that would break the guarantee |
| Delta | the same input shown under old and new behavior |
| Interface | a sample instance next to the schema, when fields aren't obvious |
| Inventory | rarely needed — the table is already concrete parts |

**Keep the why in one callout.** Rationale goes in a single
`> **Why:**` blockquote, at most one per fact, visually apart from
behavior. Rationale that outgrows its callout is cut, not promoted; a
reviewer who wants more can ask in the fact's thread. A reviewer
cannot decide a why, so a why is never the decidable content of a
file. A fact whose only substance is justification is deleted or
merged into the fact it justifies.

**Pick the genre before writing.** Every fact is one of six genres;
the genre decides its shape. A fact that fits none of them is usually
two facts.

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
  The decidable claim is the set itself: the
  reviewer scans it the way they would skim a module's exports —
  object to a row that shouldn't exist, ask about one that seems
  missing, let the rest stand.
- **Procedure** writes down the steps of an important flow — a
  request lifecycle, an API call sequence, a startup order — as a
  numbered list, one action per step, in the order the system
  performs them. When branching or looping makes prose steps awkward,
  a short pseudocode block is a legitimate rendering; the ban is on
  pasting real code that must be reviewed line by line, not on
  code-shaped clarity.
- **Mechanism** explains the behavior of a single piece: what it
  does, in prose a cold reader can follow, anchored (not carried) by
  a file pointer, then grounded with a `Concretely:` walkthrough.
- **Delta** describes a change at design level: what the behavior
  was, what it is now, and what surface it touches. It substitutes
  for reading the diff, so it names the observable difference, not
  the edited lines. This is the genre for "review what changed"
  scopes.
- **Interface** shows a boundary as a fenced code block: a schema, a
  config format, a wire message, a CLI surface, a file layout. The
  block *is* the
  decidable content; surrounding prose stays minimal — one sentence
  on what the shape is for, plus only the field notes a reviewer
  couldn't infer from the shape itself. Telling it apart from
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

## How to display it

Prose is the default; a form is chosen when it shows structure that
prose would force the reader to reconstruct.

| Content | Form |
|---|---|
| three or more parallel cases (part × attribute, case × handling) | GFM table |
| a small unordered set of points | bullet list |
| steps in a required order | numbered list |
| an exact shape (schema, config, wire format, CLI surface) | fenced code block |
| branching or looping logic clearer as code | short pseudocode block |
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
  it travels with revision copies and stays readable in `approved/`
  after earlier revisions are gone.
- **Self-backgrounded.** The viewer renders in light and dark themes;
  a figure that assumes the page's background is unreadable in the
  other theme.

## Examples

One complete fact, mechanism genre, at full length:

```markdown
# Viewer auth: one-time token, then a session cookie

The session URL carries a token that works exactly once. Opening it
sets a session cookie and burns the token; every later request from
that browser rides the cookie.

Concretely: the `session.started` event prints
`http://127.0.0.1:37665/auth?token=ba47…`. The first visit consumes
the token and redirects to the viewer with a cookie set. Pasting that
same URL into a second browser gets a 403, because the token is
already spent. A second reviewer needs a new session, not a shared
link.

The token is minted fresh per `gloss session` run (`session.ts`);
nothing is persisted across runs.

> **Why:** the session URL lands in terminal scrollback and shell
> history; a token that burns on first use means a leaked line can't
> open the review for anyone else.
```

Compact examples of the remaining genres, showing each form:

**Inventory** — a complete fact can be a title, one sentence, and a
table:

```markdown
# The CLI has three commands

| Command | Role |
|---|---|
| `gloss init` | create `.gloss/` in the repo; idempotent |
| `gloss session <review>` | serve the viewer, stream JSONL events until the review finishes |
| `gloss skill install` | write the skills where an agent will find them |
```

**Procedure** — one action per step, in execution order:

```markdown
# A question travels file-first from viewer to agent

1. The reviewer asks a question on a fact; the viewer writes it into
   the fact's `.review.json` sidecar.
2. The server emits a `question.asked` line on stdout.
3. The agent appends its answer to the same sidecar item's `thread`.
4. The viewer re-reads the sidecar within a few seconds and shows the
   answer in place.
```

**Delta** — the observable difference, not the edited lines:

```markdown
# Fact paths now normalize to "/" where the server creates them

Before, fact paths used the platform's separator. On Windows the
viewer received `10-flow\_index.md`, so no directory grouping matched
and facts rendered as one flat backslashed list. Now the server
normalizes to `/` at the two places it creates a path, and every
consumer sees one canonical form.

> **Why:** the same strings flow into session events and come back in
> API calls; one form at the source keeps every reader simple.
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

`anchor` is optional; an item without one applies to the whole fact.
````

**Invariant** — operational statement, then the violation:

```markdown
# Revisions never reference each other

Whenever a new revision is created, every fact file is copied into it
as a standalone copy, with no link, include, or mention of the
previous revision. The concrete violation: a fact in `2/` that says
"unchanged from revision 1", or an image referenced from `1/` —
either breaks the guarantee that any revision, including `approved/`,
stays fully readable after earlier revisions are edited or deleted.
```
