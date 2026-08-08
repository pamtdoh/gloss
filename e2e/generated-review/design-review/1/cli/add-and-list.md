# The CLI is a second front door over the same store

`linkbox add <url>` and `linkbox list` (`src/cli.js`) reuse the store and
slug modules directly rather than calling the HTTP API. The CLI and a
running server can therefore mutate `links.json` concurrently, subject to
the store's last-write-wins behavior.
