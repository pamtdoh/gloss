import { BRAND_DATA_URI } from "./brand.js";

// The version on each asset URL keeps the offline cache consistent: a
// cached page only ever loads the script and styles it was built with.
// The user's preferences ride in the page itself, so the first frame is
// already right on any review — each has its own address, and so its own
// browser storage, which a review opened for the first time hasn't got.
export const viewerHtml = (version: string, prefs: { theme?: string } = {}) => `<!doctype html>
<html lang="en"${prefs.theme === "dark" ? ' class="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review</title>
<link rel="icon" type="image/svg+xml" href="${BRAND_DATA_URI}">
<link rel="stylesheet" href="/client.css?v=${version}">
<script>window.__GLOSS_PREFS = ${JSON.stringify(prefs).replace(/</g, "\\u003c")};</script>
</head>
<body>
<div id="root"></div>
<script src="/client.js?v=${version}"></script>
</body>
</html>
`;
