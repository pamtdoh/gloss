# Link creation accepts any body without validation

`POST /links` parses the request body as JSON and stores `url` as-is
(`src/server.js`). Malformed JSON throws inside the request handler, and a
missing or non-URL `url` value is stored without complaint — there is no
error handling or input validation on the create path.
