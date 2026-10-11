// The viewer's service worker (ARCHITECTURE.md): network first for every
// read, falling back to the last copy when the server is gone, so a
// review stays readable after its server stops. Responses served from
// the cache carry `x-gloss-offline`, which is how the page knows.
export const SW_JS = `
const CACHE = "gloss-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api/events" || url.pathname === "/auth" || url.pathname.startsWith("/api/agent/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const hit = await cache.match(request);
      if (!hit) return Response.error();
      const headers = new Headers(hit.headers);
      headers.set("x-gloss-offline", "1");
      return new Response(await hit.blob(), { status: hit.status, headers });
    }
  })());
});
`;
