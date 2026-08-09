# The CLI is three commands, and state never flows through it

`init`, `session`, and `skill install` — nothing else. Creating reviews,
writing facts, reading sidecars, copying snapshots, and promoting to
`approved/` are all direct file operations by agents. Command results are
single-line JSON on stdout; errors are JSON on stderr.
