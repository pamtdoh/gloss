# Every mutation rewrites the whole file

`addLink` and `recordHit` each load the entire JSON file, change one entry,
and write the whole file back (`src/store.js`). There is no locking or
atomic-rename step: two concurrent writers read-modify-write independently,
and the last write wins, silently dropping the other's change.
