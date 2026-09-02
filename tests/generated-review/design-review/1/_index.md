# linkbox is three small parts sharing one JSON file

This review covers the whole of linkbox, a self-hosted URL shortener,
at the level of its design decisions: what each part is and what it
leaves out, not how the code is written. Every fact below stays at
that altitude; a detail beneath it is named, not elaborated.

| Part | What it is | Facts |
|---|---|---|
| HTTP server | two routes: create a link, redirect a slug | `http/` |
| CLI | add and list links, over the same store as the server | `cli/` |
| Slugs | six random base62 characters, chosen by the server | `slugs/` |
| Storage | one `links.json` file, rewritten whole on every change | `storage/` |

Read the groups in order. The storage facts carry the sharp edges the
other groups inherit: whole-file writes with no locking, and a hit
counter persisted on every redirect.
