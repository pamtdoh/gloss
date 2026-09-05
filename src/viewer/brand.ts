/** The mark: a page of text with one phrase highlighted — what a gloss is.
 * Drawn in the muted Everforest green with the highlighter's yellow, and
 * kept as one string so the favicon and the header cannot drift apart. */
export const BRAND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="8" fill="#4e7837"/>' +
  '<rect x="7" y="9" width="18" height="4" rx="2" fill="#fafaf9"/>' +
  '<rect x="7" y="19" width="7" height="4" rx="2" fill="#fafaf9"/>' +
  '<rect x="15" y="18" width="10" height="6" rx="2" fill="#dfa000"/>' +
  "</svg>";

export const BRAND_DATA_URI = "data:image/svg+xml," + encodeURIComponent(BRAND_SVG);
