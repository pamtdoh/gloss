# Writing fact files

A review succeeds when the reviewer — the human reading it — decides
every fact without opening anything else. So each fact must be
*decidable*: they can agree or object to it. It must also be
*followable* by a cold reader, because a fact they can't follow sends
them back to you or to the code, which is the reading Gloss exists to
remove.

Contents: what a fact is · what to write · genres · wording ·
display · figures.

## What a fact is

**One standalone, decidable claim.** The title is one sentence with a
verb that the reviewer can agree or object to on its own. The body
describes the design in neutral terms, sharp edges included; the
verdict is the reviewer's. A fact needs no argument for itself, only
enough content to follow.

**Written for a cold reader.** The reviewer knows roughly what the
project is and nothing else. Explain any term the project doesn't
define (a harness, a compaction, a tool name) at first use. A fact
never leans on:

- **This conversation.** "The bug in the original screenshot" means
  nothing to someone who wasn't there; describe the bug.
- **Git history.** State what happened; a commit hash may follow as a
  locator, never as a substitute.
- **The code.** The reviewer has none open. Showing a shape (a
  struct, a schema, a signature) is fine, as long as the fact carries
  its claim in its own words.
- **Other facts.** A fact may name another ("the merge rule, stated
  in the merge fact"), but must make sense without opening it.

**Each thing is stated once.** When several facts depend on the same
rule or mechanism, one fact states it and the others name it in a
clause. A group's `_index.md` holds what its facts share; it doesn't
restate or list them, since the tree already shows them.

## What to write

**Open with the claim:** what exists, what it does, or what changed,
described one level above the code. A schema or table can open the
body when it is the substance.

**Answer anticipated questions, nothing more.** Elaborate only to
answer what the reviewer would plausibly ask, or to give context they
need. A substantial answer goes under a `##` heading phrased as the
question ("Why is this needed?"), so a reviewer who already knows can
skip it. A fact is complete when nothing is left to answer; length
that answers no question only costs reading time.

**Stop at the review's altitude** (SKILL.md sets it). Name detail
below it in one sentence — that the layer exists and what the fact
leaves out — and don't elaborate or ground it.

**Ground what the reviewer can't check from the fact alone**, by
putting the evidence in the fact:

- A claim they would have to **simulate** (encodings, offsets,
  ordering, concurrency): walk one real value through it, end to end,
  along a path the code can actually take. An interleaving or failure
  you imagined, never traced in the code or produced by running it,
  is a guess dressed as evidence.
- An artifact they would have to **imagine** (a UI state, an error,
  CLI or wire output): show the real output, a short transcript, or
  a figure. A transcript's commands run exactly as shown, and lines
  cut from the output are marked with `…`.
- A quantity or rule they would have to **trust** (a threshold, a
  boundary, an "only when"): show the constant from the code, or a
  probe where reading can't settle it.

**Universal claims are the easiest false claims to write.** "Only",
"all", "every", "never", "any", "anything else", "guaranteed": each
holds only if every case does. Check each case — every row of an
inventory, every route, every caller — and probe at least one hostile
or malformed input. If a case breaks the claim, the claim is the
break.

**A "why" comes from a source.** Answer "Why…?" from a code comment,
a doc, the commit history, or the human; otherwise say the reason
isn't recorded. A reason you infer is a judgment, and the verdict is
the reviewer's.

## Genres

Most facts fit one of six reference shapes; blend two when the
subject demands it.

| Genre | States | Typical form and grounding |
|---|---|---|
| Inventory | what parts exist | table, one row per part; the set is the claim and the table its own grounding |
| Procedure | the steps of an important flow | numbered list, one action per step, one real request walked through it |
| Mechanism | how one piece works | prose + one `Concretely:` walkthrough with a real value |
| Delta | what changed, at design level | old behavior → new behavior; the observable difference, not the edited lines |
| Interface | the exact shape of a boundary | fenced code block that *is* the claim; minimal prose around it |
| Invariant | a guarantee the design maintains | "when ⟨event⟩, ⟨what holds⟩" with an actor and an observable outcome, plus every way it can break, each traced through all the components it crosses |

One complete fact in the mechanism genre — an opening claim, a
grounded walkthrough, and question-headed elaboration:

```markdown
# Proxied viewer auth is a one-time token, then a session cookie

When a session is served through a private proxy (`--serve-host`),
its URL carries a token that works exactly once. The first visit
burns the token and sets a session cookie. Every later request
from that browser uses the cookie.

Concretely: the `session.started` event prints
`http://127.0.0.1:37665/auth?token=ba47…`. The first visit loads a
page that posts the token back; the server burns it and redirects to
the viewer with a cookie set. Opening that same URL in a second
browser gets a 403: "This one-time review link has expired."

## Why a one-time token?

The code comment on the check gives the reason: "with --serve-host
the viewer is reachable beyond this machine, so a one-time token
gates a session cookie." Without `--serve-host` the server skips both
the token and the cookie.
```

## Wording

The reader is cold, often not a native English speaker, and can't
ask you, so write plain connected prose: short sentences, one idea
each, joined with visible links ("then", "because of this"). Name the
actor — "the server mints a token", not "a token is minted". Use one
name per concept everywhere. Give an aside its own sentence. Write a
sharp edge condition first, like a warning: "If you delete a note
from a sidecar during a live session, the viewer treats it as
resolved."

## Display

Write prose by default, and switch form when the content has a shape
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

When quoting a source, use one excerpt rather than many fragments:
enough surrounding text to show where the words live, the operative
words in bold, unrelated stretches cut with an ellipsis. Your own
sentences make the point.

## Figures

When the subject is visual, the fact carries a figure; without one,
the reviewer judges something they have to imagine.

- **Screenshot the running app, not a mockup.** Staged state (seeded
  data, planted notes) is fine if the fact says so, so the reviewer
  doesn't mistake sample data for their own.
- **Store every figure in `images/` at the revision root**, referenced
  relatively (`images/panel.png`, or `../images/panel.png` from a
  subdirectory), so references survive revision copies.
- **One figure per fact by default**; skip it when one sentence fully
  specifies the state.
- **Give each figure its own background.** The viewer has light and
  dark themes, and a figure that relies on the page's background is
  unreadable in one of them. Draw diagrams only where values are
  better seen than read, and prefer Mermaid where it shows the same
  thing.
