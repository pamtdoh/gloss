# The HTTP surface is two routes and nothing else

`src/server.js` serves `POST /links` (create) and `GET /<slug>` (redirect).
There is no listing, deletion, update, health check, or authentication over
HTTP; everything else is a 404.
