# Auth is one-shot: a single token for a single human session

The session binds an ephemeral loopback port and prints a one-time-token
URL. Redeeming the token once sets an HttpOnly SameSite=Strict cookie;
reuse gets 403. Host and Origin headers are checked on every request.
There is no multi-session support and no way to rejoin after the token is
spent except restarting the session.
