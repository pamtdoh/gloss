# Slugs are short random identifiers chosen by the server

A slug is 6 random base62 characters (`src/slug.js`). Users cannot pick a
custom slug through any interface — the server generates one on every
create, from the CLI and the HTTP API alike.
