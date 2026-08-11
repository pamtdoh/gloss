# Writing fact files

A Gloss review succeeds when the human decides every fact without
opening anything else: not the source, not git history, not the
conversation that produced the review. SKILL.md defines the workflow;
this file defines the words. Read it before writing the first fact,
and hold every fact you write against it.

## Write for the cold reader

The reviewer arrives knowing roughly what the project is and nothing
else. They have not seen your terminal, your screenshots, or the code
you just read. Everything needed to judge a claim must be inside the
fact that makes it. A fact may never lean on:

- **The generating conversation.** "The bug in the original screenshot"
  means nothing to a reviewer who was not there. Describe the bug in
  the fact.
- **Git archaeology.** A bare commit hash ("reverted in `5d851d1`") is
  an errand. State what happened and why; a hash may follow as a
  locator, never substitute for the story.
- **The code itself.** A pointer like `session.ts:57` may *anchor* a
  claim so the implementer can find it later. It must never *carry*
  the claim. Test: delete every pointer from the fact. If the fact
  stops making sense, it was an index into the codebase, not a fact.

## Shape each fact as a story

A fact has a beginning, middle, and end, in that order:

1. **Title: the claim.** One decidable sentence. The reviewer should
   be able to agree or object to the title alone.
2. **Situation.** What corner of the system this concerns and why it
   matters: what breaks without it, what risk it answers, what a cold
   reader must know coming in. One to three sentences.
3. **Mechanism.** What the design does. Specific to this codebase;
   no general programming education.
4. **Consequence.** What follows: the property gained, the trade-off
   accepted, the sharp edge that remains. When this is rationale
   rather than behavior, set it apart in a callout (next section).

Never open mid-thought. A first sentence like "`walkFacts` and the
sidecar PUT handler build fact paths with `path.relative()`" hands the
reader implementation names before they know a problem exists.

Facts in a group tell one story between them: numbered prefixes make
reading order the narrative order, and `_index.md` opens the group by
setting the scene, so no child fact starts from zero.

## Set rationale apart in a callout

The reviewer judges two different things: what the design *does* and
whether that choice was *right*. Keep them visually distinct. Behavior
goes in plain paragraphs; rationale goes in a blockquote callout:

> **Why this design:** normalizing at the source keeps one canonical
> form for every downstream reader, instead of teaching N readers to
> be tolerant.

At most one callout per fact. If the rationale outgrows its callout,
it is probably its own fact.

## Spend length on clarity, not ceremony

Prefer the fact a cold reader understands in one pass over a shorter
one they must decode. You may exceed "a few sentences" when
self-containment costs that much; three plain paragraphs beat one
dense one. The budget buys context and explanation only. It does not
buy general programming background, code restated line by line, or
hedging.

## Walk one concrete case through hard mechanisms

Some claims are abstract by nature: encodings, offsets, path
resolution, ordering, concurrency. Prose alone forces the reviewer to
simulate the mechanism in their head. Spare them: after stating the
mechanism, walk a single real value through it and show what comes out
the other end. A one-line "Concretely: …" is often enough:

> Concretely: selecting `second line here` on the second line of a
> CRLF fact stored the quote `\nsecond line her`, and every saved
> highlight painted one character off per preceding line.

One example per hard claim. Choose the case that shows the failure or
the boundary, not the happy path; the reviewer already believes the
happy path.

## One claim per sentence

An em dash must not join two independent claims, and a colon must not
chain three. Dash-spliced sentences let distant facts sit next to each
other without the connective tissue that would reveal whether they
actually cohere. If removing the dash leaves two sentences that each
say something, write two sentences.

Bad:

> The old guard is lexical — Win32 trims trailing dots, so `".. "`
> survives `resolve()` as an ordinary child — yet the OS opens it
> as `..`.

Good:

> The old guard compares strings, so it sees `".. "` as an ordinary
> child name. Windows disagrees: the filesystem trims trailing dots
> and spaces, so the OS opens that same segment as `..`.

## Reach for tables and diagrams first

If a paragraph enumerates three or more parallel cases, it is a table.
If it walks a value through a sequence of steps or boundaries, it is a
Mermaid diagram.

| Content | Form |
|---|---|
| platform × behavior, file × failure mode, case × handling | GFM table |
| a value crossing boundaries, a request lifecycle, a data flow | Mermaid diagram |
| an exact shape that *is* the claim (schema, config, wire format) | fenced code block |
| code the reviewer would have to review line by line | never; that defeats the review |

## Screenshots, when the scope is visual

Screenshots are optional; capturing them takes tooling and time. But
when the review scope is UI (pages, components, or user-flow-heavy
changes), a picture decides faster than prose. Ask the user before
generating: does this review deserve screenshots? If yes, save images
inside the revision directory and reference them relatively, so they
travel with revision copies.

## Re-read the revision before handing it over

You wrote the facts one at a time; the reviewer reads them as one
document. Before presenting, re-read the whole revision in tree order
and fix what only shows at that altitude: two facts that contradict
each other, a term used before the fact that introduces it, a story
order that buries the load-bearing fact last.

## Worked example

A real before and after. The subject: a Windows bug where fact paths
were built with backslashes.

**Bad.** Carried by pointers, leans on the conversation, dash-spliced:

```markdown
# Fact paths are normalized once, server-side, where they are born

`walkFacts` and the sidecar PUT handler build fact paths with
`node:path.relative()`, which yields `10-flow\_index.md` on Windows.
The entire viewer is written against `/`: directory grouping splits on
it (`model.ts`), the tree derives group headers from it, and the URL
hash round-trips it. With `\`, every fact fell out of its group into
one flat backslashed list — the bug in the original screenshot.
```

The first sentence assumes the reader knows what `walkFacts` is. "The
bug in the original screenshot" points at a conversation the reviewer
never saw. The `/`-consumers hide in a colon-and-dash chain.

**Good.** The same design, self-contained and in story order:

```markdown
# Fact paths are normalized to "/" once, where the server creates them

Every fact has a path like `10-flow/_index.md`, and the viewer uses
that path three ways: to group facts under directories, to label the
groups, and to link to a fact from the URL. All three assume `/` as
the separator.

The server builds these paths with Node's `path.relative()`, which
uses the platform's native separator. On Windows that produced
`10-flow\_index.md`: no grouping matched, and the viewer degraded to
one flat list of backslashed names.

The design normalizes at the two places the server creates a path
(`toFactPath()` in `session.ts`) rather than teaching each consumer
to accept both separators.

> **Why this design:** the same path strings flow onward into session
> events and come back from the client in API calls. One canonical
> form at the source keeps every downstream reader simple.
```
