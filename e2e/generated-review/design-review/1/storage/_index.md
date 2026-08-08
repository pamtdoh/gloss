# All persistence is a single JSON file

Every link lives in one `links.json` object keyed by slug (`src/store.js`),
holding `url`, `hits`, and `createdAt`. There is no database, no index, and
no other durable state anywhere in the system.
