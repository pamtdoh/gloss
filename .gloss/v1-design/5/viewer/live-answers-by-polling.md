# Live Q&A works by the agent editing files and the viewer polling

Mid-session, the agent answers a question by appending to the sidecar's
thread on disk. The viewer polls the review every two seconds and
re-renders only when file content actually changed. There is no push
channel; two seconds of latency is the accepted cost of keeping files as
the only interface. The agent's half of the bargain: it must watch the
session's event stream while the session runs — an agent that only wakes
when the command exits answers nothing live.
