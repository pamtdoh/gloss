# The blocking session command is the whole notification system

`reviewkit session` blocks until the human finishes or approves, then
exits 0 with a JSON summary. An agent runs it as a background task and the
task completing is the wake-up — no push infrastructure, no polling loops,
no webhooks. `--events` adds JSONL on stdout (`session.started`,
`decision.changed` coalesced, `question.asked`, `session.finished`).
