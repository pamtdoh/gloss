# Writing fact files

A Gloss review succeeds when the human decides every fact without
opening anything else. Every fact serves the reviewer in two ways: they can
*decide* it, and they can *follow* it as a cold reader. A fact they
cannot decide leaves them nothing to accept or object to, so it
costs a reading pass without settling anything. A fact they cannot
follow sends them to you or to the code for the missing context,
which is the reading Gloss exists to remove. The rest of this guide
is how to give the reviewer both.

## What counts as a fact

**A standalone, decidable observation.** The title is one decidable
sentence with a verb: the reviewer can agree or object to it alone.
The body *observes* the design in neutral terms, including its
sharp edges, and the reviewer supplies the judgment. A fact is not
a thesis to defend. It needs no supporting argument, only enough
content for a cold reader to follow what is being stated.

**Written for a cold reader.** The reviewer arrives knowing roughly
what the project is and nothing else. They have not seen your
terminal, your screenshots, or the code you just read. They also do
not share your tooling vocabulary, so any term the project itself
does not define (a harness, a compaction, an agent tool name) gets
a plain gloss at its first use. A fact may never lean on:

- **The generating conversation.** "The bug in the original
  screenshot" means nothing to a reviewer who was not there.
  Describe the bug in the fact.
- **Git archaeology.** A bare commit hash ("reverted in `5d851d1`")
  sends the reviewer on an errand. State what happened. A hash may
  follow as a locator, never substitute.
- **The code itself.** The reviewer has no code open to check a
  claim against, so the fact carries its claim entirely in its own
  words. Test: if the fact only makes sense to someone with the
  codebase in front of them, it is an index into the codebase, not
  a fact. Showing a relevant shape (a struct, a schema, a
  signature) is fine, because then the fact carries the content
  itself.

## What to write

**Open with the what.** The first thing in the body states what
exists, what it does, or what changed, the way you would describe
the code to a colleague one level above it. The reason: the
reviewer can only start judging once the claim is in front of them,
so buildup delays the verdict without informing it. Anything that
*is* the claim counts as opening with it. A schema block or an
inventory table can
open the body when the block is the fact's substance. A delta opens
with the old behavior, because before → after is that genre's what.

**Elaborate to answer anticipated questions.** Body text beyond the
opening statement answers questions the reviewer would plausibly
ask, or supplies context they need to understand the statement.
Prose a cold reader needs to follow the mechanism is an answer, not
padding, and context stays inline. A substantial answer goes under
its own `##` heading phrased as the literal question ("Why is this
needed?", "Why X and not Y?", "What is the flow, step by step?"),
so a reviewer who already knows can skip it. A short fact is
complete when nothing needs answering. Length that answers no
question costs reading time without adding anything to judge, so
ceremony, hedging, and general programming background stay out. A
reviewer cannot decide a why, so justification is never the
decidable content of a file. A fact whose only substance is
justification is deleted or merged into the fact it justifies.

**Stop at the review's altitude.** The review's prompt sets how
deep the tree descends (SKILL.md governs this), and elaboration
stops at that level. Detail below it is named, not elaborated: one
sentence that says the layer exists and what the fact leaves out,
so the reviewer knows there is more and can pull it with a question
or a comment. A named, unelaborated detail is therefore not a hole
and needs no grounding, because the fact claims only that the
detail exists, not what it does.

**Ground any claim the reviewer can't check from the fact alone.**
Grounding is evidence inside the fact: the claim states the design,
the grounding shows it, so the reviewer checks instead of trusts.
Three cues that a claim needs grounding:

- If the reviewer would have to **simulate** it in their head
  (encodings, offsets, path resolution, ordering, concurrency),
  walk one real value through it, end to end, and show what comes
  out the other side. The reason: a placeholder example leaves the
  simulation to the reader, and that is the work grounding exists
  to remove.
- If they would have to **imagine** an artifact (a UI state, an
  error or empty state, CLI or wire output, a rendered result),
  show the real thing: the actual output line, a short transcript,
  or a figure (see "Show, don't describe" below).
- If they would have to **trust** a quantity or rule (a boundary, a
  threshold, a precedence chain, an "only when" claim, a
  platform-divergent behavior), show what settles it: a constant or
  comparison read from the code, or a probe run where reading can't
  settle it. An unverified "only" is the easiest false claim to
  write, so check it against the source before writing it.

A happy-path walkthrough may come first to build the reader's
model. A claim that can fail is still grounded at the failure or
the boundary. Each genre bullet below names its natural form of
grounding.

**Start from a genre.** The six genres below are reference shapes:
most facts fit one, and a fact may blend two when its subject
demands it. Pick whichever shape presents the fact in the way a
reader will understand most easily.

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
  needs to judge the set: usually name, role, and at most one or
  two more. The decidable claim is the set itself. The reviewer
  objects to a row, asks about a missing one, and lets the rest
  stand. The table is its own grounding.
- **Procedure** writes down the steps of an important flow (a
  request lifecycle, an API call sequence, a startup order) as a
  numbered list, one action per step, in the order the system
  performs them. Ground it with one real request run through the
  steps. Choose the rendering that shows the logic, because the
  aim is the reviewer's effort, not the syntax. For example, a
  flow that branches or loops is often clearest as a short
  pseudocode block.
- **Mechanism** explains the behavior of a single piece: what it
  does, in prose a cold reader can follow, grounded with a
  `Concretely:` walkthrough.
- **Delta** describes a change at design level: what the behavior
  was, what it is now, and what surface it touches. It substitutes
  for reading the diff, so it names the observable difference, not
  the edited lines. Ground it with the same input shown under old
  and new behavior. For example, a "review what changed" scope is
  written in this genre.
- **Interface** shows a boundary as a fenced code block: a schema,
  a config format, a wire message, a CLI surface, a file layout.
  The block *is* the decidable content, so the body around it stays
  minimal: one sentence on what the shape is for, plus only the
  field notes a reviewer couldn't infer from the shape itself.
  Ground it with a sample instance next to the schema when fields
  aren't obvious. Questions the shape raises go under `##`
  headings, as in any fact.
- **Invariant** states a property the design maintains across
  parts, written operationally: *"when/whenever ⟨event⟩, ⟨what
  holds⟩"*, with an actor, a moment, and an observable outcome. A
  slogan ("revisions are standalone") can serve as the title, but
  it names the guarantee without saying who upholds it, or when.
  Ground it with the one concrete violation that would break it.
  For example, "the first visit burns the token" is mechanism, and
  "no revision references another" is invariant. A mechanism often enforces an
  invariant, and the invariant fact may name it.

## How to word it

A fact's reader is a cold reader, often not a native English
speaker, with no author to ask. This guidance comes from
ASD-STE100, an aerospace standard for simplified technical English.
Each row is checkable word by word:

| Guideline | Write | Not |
|---|---|---|
| Active voice, named actor | "The server mints a token." | "A token is minted." |
| Simple tenses | "the viewer re-reads the sidecar" | "the sidecar has been re-read" |
| One plain verb, never a phrasal verb | "start the session" | "spin up the session" |
| The verb, not its noun | "the viewer resolves the anchor" | "the viewer performs resolution of the anchor" |
| One name per concept, used everywhere | always "run" | "run", "segment", "chunk" in rotation |
| Noun stacks of at most three words | "the arithmetic that maps offsets" | "the DOM source offset mapping arithmetic" |
| At most ~25 words per sentence, split instead of joining | two short sentences | a chain of subordinate clauses |
| No semicolon outside a verbatim quote | two sentences | "clause; clause" |
| Keep the subject, verb, and articles | "the lines that were not located" | "lines not located" (which lines?) |
| An aside becomes its own sentence. Parentheses hold only a short gloss (a definition, an abbreviation, an example tag), never a clause | "The first visit burns the token, so it works exactly once." | "The token — burned on first visit — works once." and "The token works once (the first visit burns it)." |

Brackets of any shape ask the reader to hold the main sentence open
while a second sentence runs inside it, so an aside earns a
sentence of its own.

Four flow guidelines govern above the sentence:

- Give information gradually: each sentence adds one new idea to
  what the reader already holds.
- Connect sentences with visible connecting words ("then", "thus",
  "because of this"), so the reader never has to infer the link
  between two sentences.
- Introduce a long term in full once, then use one consistent short
  form.
- Keep one topic per paragraph, at most about six sentences.

One sentence pattern to copy directly: state a sharp edge the way a
warning is written, the condition first and then the consequence,
because a reader who meets the condition first knows to read on
with care. For example, write "If you delete a sidecar item during
a live session, the viewer treats it as resolved".

## How to display it

Write prose by default. Switch to a table, a list, a code block, or
a diagram when the content has a shape the reader would otherwise
have to build in their head. For example, three options with the
same three attributes each is really a table.

| Content | Form |
|---|---|
| three or more parallel cases (part × attribute, case × handling) | GFM table |
| a small unordered set of points | bullet list |
| steps in a required order | numbered list |
| an exact shape (schema, config, wire format, CLI surface) | fenced code block |
| an algorithm (a decision ladder, a matching loop, branching logic) | short pseudocode block |
| a value crossing boundaries, a lifecycle, a data flow | Mermaid diagram |
| a visual subject (a page, a component, styling, a user flow) | screenshot or drawn figure (see "Show, don't describe") |
| a short verbatim excerpt (code or document text), when its exact wording is what the reviewer judges | fenced or quoted block |

When a fact quotes its source, prefer one excerpt over many
fragments. Show the operative words inside enough surrounding text
that the reader sees where they live, mark the operative words in
bold, and cut unrelated stretches with an ellipsis. One block per
fact is usually enough, and it keeps the quoted lines in their
source order. Your own sentences carry the point, and the verbatim
words stay in the block, so the reader never parses two voices in
one sentence.

For example, a fact claiming that losing the event stream loses no
review state quotes its source once, with the operative words
marked:

> Stdout is JSONL, one event per line. … The session also writes
> every line to `.gloss/.local/<review>/session.jsonl`, so **the
> event stream is always readable as a file**.

The paraphrase before the block makes the claim, the bold shows the
words that settle it, and the ellipsis skips the event names the
claim doesn't need.

### Show, don't describe

A visual fact with no figure asks the reviewer to imagine the thing
they are judging, so when the subject is visual, the fact carries a
figure. (When to capture is workflow: SKILL.md step 2.) What a
figure must be:

- **A screenshot of the running app, not a mockup.** Staged state
  is fine (a seeded database, planted review items, a fabricated
  session), but the fact must say the state is staged, so the
  reviewer doesn't mistake sample data for their own.
- **Proportionate.** One figure per fact by default, and prose
  suffices where one sentence fully specifies the state ("the empty
  list shows 'No reviews yet'").
- **Drawn only where values are better seen than read** (a palette
  as swatches, layout regimes side by side, a state chart), and
  hand-drawn SVG only where a Mermaid diagram can't show it.
- **Stored inside the revision directory**, referenced relatively,
  so it survives revision copies.
- **Self-backgrounded.** The viewer renders in light and dark
  themes, so a figure that assumes the page's background is
  unreadable in the other theme.

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

Compact examples of the five other genres, showing each form:

**Inventory**: a complete fact can be a title and a table:

```markdown
# The CLI has three commands

| Command | Role |
|---|---|
| `gloss init` | create `.gloss/` in the repo (idempotent) |
| `gloss session <review>` | serve the viewer, stream JSONL events until the review finishes |
| `gloss skill install` | write the skills where an agent will find them |
```

**Procedure**: numbered steps, grounded with one real value:

```markdown
# A question travels from the viewer to the agent and back

1. The human selects text in a fact and asks a question.
2. The viewer writes the question into the fact's sidecar.
3. The session prints a `question.asked` event.
4. The agent appends its answer to the question's thread and
   writes the sidecar back.
5. The viewer re-reads the sidecar and shows the answer in the same
   thread, where the human can reply.

Concretely: a question on `collision-retry.md` lands in
`collision-retry.review.json` as

    {"id":"q1","type":"question","thread":[{"who":"human","text":"…"}]}

and the answer appends `{"who":"agent","text":"…"}` to that thread.

## What happens when the human closes the tab?

Nothing is lost, because the sidecar file is the record. The next
session serves the same revision, and the thread is still there.
```

**Delta**: the observable difference, not the edited lines:

```markdown
# Fact paths now normalize to "/" where the server creates them

Before, fact paths used the platform's separator. On Windows the
viewer received `10-flow\_index.md`, so no directory grouping matched
and facts rendered as one flat backslashed list. Now the server
normalizes to `/` at every place it creates a path, and the same
fact arrives everywhere as `10-flow/_index.md`.
```

**Interface**: the block is the claim:

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

`type` is `"comment"` or `"question"`. A comment carries `text`
instead of a `thread`. `anchor` is optional. An item without one
applies to the whole fact.

## Why is `anchor` optional?

So the human can comment on a fact as a unit without selecting
text.
````

**Invariant**: operational statement, then the violation:

```markdown
# Revisions never reference each other

Whenever the agent creates a new revision, it copies every fact file
into it as a standalone copy, with no link, include, or mention of
the previous revision. The concrete violation: a fact in `2/` that
calls itself unchanged from revision 1, or an image referenced from
`1/`.
Either breaks the guarantee that every revision, including
`approved/`, stays readable after anyone edits or deletes the
earlier ones.
```
