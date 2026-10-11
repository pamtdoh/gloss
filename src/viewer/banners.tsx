import * as React from "react";
import type { Connection, Meta } from "./store.js";

// The review's state, said once at the top of the page. One banner at a
// time, the most consequential first: whether anything reaches the
// agent outranks which revision is on screen.

const STOPPED: Record<string, string> = {
  approved: "The review is approved and its server has stopped.",
  idle: "The review server stopped after a while with nothing connected.",
  stopped: "The review server was stopped.",
};

export function Banners(props: {
  meta: Meta;
  connection: Connection;
  stopped: string | null;
  pending: number;
  viewRevision: number;
  onSwitch: (revision: number) => void;
}): React.JSX.Element | null {
  const { meta } = props;
  const queued =
    props.pending > 0 ? ` ${props.pending} change${props.pending === 1 ? "" : "s"} will be sent when it's back.` : "";

  if (props.connection === "offline") {
    const why = props.stopped ? (STOPPED[props.stopped] ?? STOPPED.stopped) : "The review server isn't running.";
    return (
      <div className="conn-banner" id="conn-banner" role="alert" data-state="offline">
        {why} You're reading this browser's saved copy — notes can't reach the agent.{queued}
      </div>
    );
  }
  if (props.connection === "connecting") {
    return (
      <div className="conn-banner" id="conn-banner" role="status" data-state="connecting">
        Reconnecting to the review server…{queued}
      </div>
    );
  }
  if (meta.approved !== null) {
    return (
      <div className="round-banner" id="round-banner" role="status" data-state="approved">
        Revision {meta.approved} is approved — the agreed design. Implementation starts from it.
      </div>
    );
  }
  if (meta.round === "closed") {
    return (
      <div className="round-banner" id="round-banner" role="status" data-state="finished">
        Review of revision {meta.served} finished.{" "}
        {meta.status ? `The agent: ${meta.status}.` : "The agent is working on the next revision; it will appear here."}
      </div>
    );
  }
  if (meta.served !== null && props.viewRevision !== meta.served) {
    return (
      <div className="stale-banner" id="stale-banner" role="status">
        Viewing revision {props.viewRevision} read-only — revision {meta.served} is under review ·{" "}
        <button onClick={() => props.onSwitch(meta.served!)}>Switch</button>
      </div>
    );
  }
  return null;
}
