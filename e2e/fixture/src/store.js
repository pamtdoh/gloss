import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = process.env.LINKBOX_FILE ?? "links.json";

export function loadLinks() {
  if (!existsSync(FILE)) return {};
  return JSON.parse(readFileSync(FILE, "utf8"));
}

export function saveLinks(links) {
  writeFileSync(FILE, JSON.stringify(links, null, 2) + "\n");
}

export function addLink(slug, url) {
  const links = loadLinks();
  links[slug] = { url, hits: 0, createdAt: new Date().toISOString() };
  saveLinks(links);
}

export function recordHit(slug) {
  const links = loadLinks();
  if (links[slug]) {
    links[slug].hits += 1;
    saveLinks(links);
  }
}
