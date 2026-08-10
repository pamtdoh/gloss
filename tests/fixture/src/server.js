import { createServer } from "node:http";
import { loadLinks, addLink, recordHit } from "./store.js";
import { freshSlug } from "./slug.js";

const PORT = Number(process.env.PORT ?? 8321);

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/links") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { url } = JSON.parse(body);
      const slug = freshSlug(loadLinks());
      addLink(slug, url);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ slug }));
    });
    return;
  }

  if (req.method === "GET" && req.url && req.url.length > 1) {
    const slug = req.url.slice(1);
    const link = loadLinks()[slug];
    if (link) {
      recordHit(slug);
      res.writeHead(302, { location: link.url });
      res.end();
      return;
    }
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`linkbox on :${PORT}`));
