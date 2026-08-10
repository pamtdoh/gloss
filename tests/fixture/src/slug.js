const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomSlug(length = 6) {
  let slug = "";
  for (let i = 0; i < length; i++) {
    slug += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return slug;
}

// Retry until the slug is unused; give up after 10 tries.
export function freshSlug(links) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = randomSlug();
    if (!(slug in links)) return slug;
  }
  throw new Error("could not find a free slug");
}
