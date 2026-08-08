# Redirects are 302 and count the hit before responding

`GET /<slug>` looks the slug up on every request (a fresh file read),
records the hit synchronously, then answers 302 with the stored URL
(`src/server.js`). Unknown slugs fall through to the plain-text 404.
