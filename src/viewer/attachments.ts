// Pictures in a note. The reviewer pastes, drops, or picks an image; the
// viewer uploads it into the served revision at images/notes/<hash>.<ext>
// and, on posting, appends it to the note's text as an ordinary Markdown
// image, relative to the fact's directory exactly like a figure. There is
// no sidecar field for it: the text is the record, and the agent meets
// the picture where it meets every figure — as a path in Markdown. In the
// box the pictures are chips, not text, so a note's tail is split back
// into chips when an edit opens and joined again when it posts.

export interface ImageRef {
  alt: string;
  /** as written in the text: images/notes/x.png, or ../images/notes/x.png from a subdirectory */
  url: string;
}

const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(",");

const NOTE_IMAGE = /^(?:\.\.\/)*images\/notes\/[A-Za-z0-9._-]+$/;
// the last paragraph of an already right-trimmed text, when it is one image
const TAIL = /(?:^|\n\n)!\[([^\]\n]*)\]\(([^)\s]+)\)$/;

/** Peel trailing note-image paragraphs off a text into chips. Only
 * paragraphs the viewer itself writes qualify — one image, pointing under
 * images/notes/ — so a figure or a picture the human wrote by hand stays
 * text. */
export function splitAttachments(text: string): { text: string; refs: ImageRef[] } {
  const refs: ImageRef[] = [];
  let rest = text.trimEnd();
  for (;;) {
    const m = TAIL.exec(rest);
    if (!m || !NOTE_IMAGE.test(m[2]!)) break;
    refs.unshift({ alt: m[1]!, url: m[2]! });
    rest = rest.slice(0, m.index).trimEnd();
  }
  return { text: rest, refs };
}

/** The text as posted: the words, then one image paragraph per chip. With
 * no chips the text passes through untouched, so drafts keep their exact
 * characters. */
export function joinAttachments(text: string, refs: ImageRef[]): string {
  if (refs.length === 0) return text;
  const images = refs.map((ref) => `![${ref.alt}](${ref.url})`);
  return [text.trimEnd(), ...images].filter(Boolean).join("\n\n");
}

/** A revision-relative asset path as the fact's text must write it. */
export function relativeToFact(factPath: string, assetPath: string): string {
  return "../".repeat(factPath.split("/").length - 1) + assetPath;
}

/** Back from the text's form to the revision-relative path — exact only
 * because NOTE_IMAGE pins every match to the revision root. */
export function revisionPathOf(url: string): string {
  return url.replace(/^(?:\.\.\/)+/, "");
}

/** The picture's alt text from its filename; a paste arrives as image.png */
export function altFor(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[[\]\n]/g, "").trim() || "image";
}

export function pickImages(files: Iterable<File> | null | undefined): File[] {
  return files ? [...files].filter((file) => UPLOAD_TYPES.includes(file.type)) : [];
}

/** One upload; resolves to the revision-relative path the server stored
 * it at, content-addressed so a repeat is the same file. */
export async function uploadImage(file: File, revision: number): Promise<string> {
  const res = await fetch(`/api/upload?revision=${revision}`, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; path?: string; error?: string }
    | null;
  if (!res.ok || !body?.ok || !body.path) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body.path;
}
