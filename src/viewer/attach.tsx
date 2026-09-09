import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, RotateCw, X } from "lucide-react";
import {
  UPLOAD_ACCEPT,
  altFor,
  joinAttachments,
  pickImages,
  relativeToFact,
  revisionPathOf,
  splitAttachments,
  uploadImage,
  type ImageRef,
} from "./attachments.js";
import { assetBase } from "./model.js";
import { Button } from "./ui/button.js";

// A box — a note composer or a thread reply — is a textarea and its
// pictures. The pictures are square thumbnails above the text, the size
// the card will show them once posted: a paste, a drop, or the attach
// control adds one, it uploads at once, and the box posts it as a
// Markdown image (attachments.ts). The chips are the box's own state; the
// text they become is computed when the box posts or reports a draft.

export interface Attachment {
  key: string;
  alt: string;
  status: "uploading" | "done" | "error";
  /** revision-relative path once stored */
  path?: string;
  /** the file itself, shown until it is stored */
  preview?: string;
  error?: string;
  /** kept until stored, for a retry */
  file?: File;
}

/** the pictures of a box, as the tray and the attach button see them */
export interface Attachments {
  items: Attachment[];
  /** what a thumbnail shows: the stored copy, else the file itself */
  srcOf: (item: Attachment) => string;
  /** an upload is in flight: posting now would drop it */
  busy: boolean;
  add: (files: File[]) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  clear: () => void;
}

/** a box: its textarea, the words it opened with, and its pictures */
export interface NoteBox extends Attachments {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  /** the text as it would post now: the words, then one image paragraph per picture */
  posted: () => string;
}

/** where a box's pictures upload to, and the fact its text is relative to */
export interface UploadTarget {
  revision: number;
  factPath: string;
}

let nextKey = 0;

export function useNoteBox(
  target: UploadTarget,
  /** the text the box opens with — an edit's, or a kept draft's — pictures included */
  initial: string,
  /** the posted form of the box after a change, for the caller to keep as a draft */
  onChange: (posted: string) => void,
): NoteBox {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [init] = useState(() => splitAttachments(initial));
  const [items, setItems] = useState<Attachment[]>(() =>
    init.refs.map((r) => ({ key: `a${nextKey++}`, alt: r.alt, status: "done", path: revisionPathOf(r.url) })),
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const base = assetBase(target.revision);
  const srcOf = (item: Attachment): string => (item.path ? base + item.path : (item.preview ?? ""));
  const patch = (key: string, change: Partial<Attachment>): void =>
    setItems((prev) => prev.map((a) => (a.key === key ? { ...a, ...change } : a)));
  const forget = (gone: Attachment[]): void => {
    for (const a of gone) if (a.preview) URL.revokeObjectURL(a.preview);
  };
  const start = (att: Attachment): void => {
    void uploadImage(att.file!, target.revision).then(
      (path) => {
        forget([att]);
        patch(att.key, { status: "done", path, preview: undefined, file: undefined, error: undefined });
      },
      (error: unknown) =>
        patch(att.key, { status: "error", error: error instanceof Error ? error.message : String(error) }),
    );
  };
  const add = (files: File[]): void => {
    if (files.length === 0) return;
    const fresh: Attachment[] = files.map((file) => ({
      key: `a${nextKey++}`,
      alt: altFor(file),
      status: "uploading",
      preview: URL.createObjectURL(file),
      file,
    }));
    setItems((prev) => [...prev, ...fresh]);
    fresh.forEach(start);
  };
  const remove = (key: string): void => {
    forget(itemsRef.current.filter((a) => a.key === key));
    setItems((prev) => prev.filter((a) => a.key !== key));
  };
  const retry = (key: string): void => {
    const att = itemsRef.current.find((a) => a.key === key);
    if (!att?.file) return;
    patch(key, { status: "uploading", error: undefined });
    start(att);
  };
  const clear = (): void => {
    forget(itemsRef.current);
    setItems([]);
  };
  useEffect(() => () => forget(itemsRef.current), []); // the box goes, its previews with it
  const refs = items
    .filter((a) => a.status === "done" && a.path)
    .map((a) => ({ alt: a.alt, url: relativeToFact(target.factPath, a.path!) }));
  const posted = (): string => joinAttachments(ref.current?.value ?? "", refs);
  const busy = items.some((a) => a.status === "uploading");
  // report when the stored set changes — after the render that knows it,
  // and not on mount: a box that opened with its pictures is not a new draft
  const signature = refs.map((r) => r.url).join("\n");
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChange(posted());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return { ref, text: init.text, posted, items, srcOf, busy, add, remove, retry, clear };
}

function hasFiles(dt: DataTransfer | null): boolean {
  return dt !== null && Array.from(dt.types).includes("Files");
}

/** One frame around the text, its pictures, and the attach control: the
 * textarea inside gives its border to this wrapper, and a paste or a drop
 * anywhere in it adds a picture. Text pastes pass through untouched. */
export function AttachField(props: {
  attachments: Attachments;
  buttonId: string;
  inputId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`field${over ? " drop" : ""}`}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault(); // a dropped file must never navigate the viewer away
        props.attachments.add(pickImages(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = pickImages(e.clipboardData.files);
        if (files.length === 0) return;
        e.preventDefault();
        props.attachments.add(files);
      }}
    >
      <AttachTray attachments={props.attachments} />
      {props.children}
      <div className="field-foot">
        <AttachButton id={props.buttonId} inputId={props.inputId} attachments={props.attachments} />
      </div>
    </div>
  );
}

/** A note's pictures as the card shows them: the thumbnails the box had,
 * without the controls. A gallery root when they should open in the lightbox. */
export function Pictures(props: {
  refs: ImageRef[];
  assetBase: string;
  gallery?: boolean;
}): React.JSX.Element | null {
  if (props.refs.length === 0) return null;
  return (
    <div className="pics" data-gallery={props.gallery ? "" : undefined}>
      {props.refs.map((ref) => (
        <div key={ref.url} className="pic">
          <img src={props.assetBase + revisionPathOf(ref.url)} alt={ref.alt} />
        </div>
      ))}
    </div>
  );
}

function AttachTray({ attachments }: { attachments: Attachments }): React.JSX.Element | null {
  if (attachments.items.length === 0) return null;
  return (
    <div className="pics" role="list" aria-label="Attached images">
      {attachments.items.map((item) => (
        <div
          key={item.key}
          role="listitem"
          className={`pic ${item.status}`}
          data-status={item.status}
          title={item.status === "error" ? `Upload failed: ${item.error}` : item.alt}
        >
          <img src={attachments.srcOf(item)} alt={item.alt} />
          {item.status === "uploading" && (
            <LoaderCircle className="lucide attach-spin animate-spin size-4" size={16} aria-label="Uploading" />
          )}
          {item.status === "error" && (
            <button
              type="button"
              className="attach-retry"
              aria-label={`Retry uploading ${item.alt}`}
              onClick={() => attachments.retry(item.key)}
            >
              <RotateCw className="lucide size-4" size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${item.alt}`}
            onClick={() => attachments.remove(item.key)}
          >
            <X className="lucide size-3" size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The attach control: an icon feeding a hidden file input — the way in
 * without a clipboard, and the only one on touch. */
function AttachButton(props: {
  id: string;
  inputId: string;
  attachments: Attachments;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        id={props.inputId}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          props.attachments.add(pickImages(e.currentTarget.files));
          e.currentTarget.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        id={props.id}
        aria-label="Attach image"
        title="Attach an image (or paste one)"
        onClick={() => input.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
      </Button>
    </>
  );
}
