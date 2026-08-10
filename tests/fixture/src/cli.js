import { loadLinks, addLink } from "./store.js";
import { freshSlug } from "./slug.js";

const [command, arg] = process.argv.slice(2);

if (command === "add" && arg) {
  const slug = freshSlug(loadLinks());
  addLink(slug, arg);
  console.log(slug);
} else if (command === "list") {
  const links = loadLinks();
  for (const [slug, link] of Object.entries(links)) {
    console.log(`${slug}\t${link.hits}\t${link.url}`);
  }
} else {
  console.error("usage: linkbox add <url> | linkbox list");
  process.exit(1);
}
