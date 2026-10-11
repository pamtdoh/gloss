import pkg from "../package.json" with { type: "json" };

/** The CLI's version: a running server of another version is restarted,
 * since the viewer it serves and the protocol it speaks may differ. */
export const VERSION: string = pkg.version;
