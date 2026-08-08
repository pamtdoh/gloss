# Hit counts are persisted on every redirect

Each successful redirect increments the link's `hits` counter and writes it
to disk before the response is sent (`recordHit` in `src/store.js`, called
from `src/server.js`). Redirect latency therefore includes a full
load-and-rewrite of the store file.
