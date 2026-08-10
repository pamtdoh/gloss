# The blocking session command is the whole notification system

`reviewkit session` blocks until the human finishes or approves, then
exits 0 with a JSON summary (fact and annotation counts, open
questions, approval status). An agent runs it as a background task and
the task completing is the wake-up — no push infrastructure, no
webhooks. `--events` adds JSONL on stdout (`session.started`,
`question.asked`, `session.finished`); `--serve-host` lets a private
proxy such as tailscale carry the session to the owner's other devices
while the server stays loopback-only.
