import { BRAND_DATA_URI } from "./brand.js";

// The version on each asset URL keeps the offline cache consistent: a
// cached page only ever loads the script and styles it was built with.
export const viewerHtml = (version: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review</title>
<link rel="icon" type="image/svg+xml" href="${BRAND_DATA_URI}">
<link rel="stylesheet" href="/client.css?v=${version}">
</head>
<body>
<div id="root"></div>
<script src="/client.js?v=${version}"></script>
</body>
</html>
`;
