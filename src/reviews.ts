import { join } from "node:path";
import { glossHome, groupBy } from "./home.js";
import { findCheckout, groupName } from "./repo.js";

// Where reviews live (ARCHITECTURE.md): ~/.gloss/reviews, one folder per
// repository — all its worktrees together, by default — outside every
// repo, so nothing is scaffolded in the working tree. The CLI owns the
// location and `gloss dir` reports it, so any harness that can run the
// CLI finds the same place.

/** This repository's reviews directory, absolute and native. Not created
 * — `gloss dir` does that; a session over a missing review just fails. */
export function reviewsDir(cwd: string): string {
  return join(glossHome(), "reviews", groupName(findCheckout(cwd), groupBy()));
}
