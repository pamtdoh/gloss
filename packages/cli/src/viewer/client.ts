import { renderMarkdown } from "./markdown.js";
import { widenQuote } from "./quote.js";
import type { Sidecar, SidecarItem } from "../summary.js";

interface Fact {
  path: string;
  content: string;
  sidecar: Sidecar | null;
}

let review = "";
let snapshot = 0;
let snapshots: number[] = [];
let facts: Fact[] = [];
let idx = 0;
let pending: { type: SidecarItem["type"]; anchor?: { quote: string } } | null = null;
const undoStack: { path: string; id: string }[] = [];

const $ = (id: string) => document.getElementById(id)!;
const fact = (): Fact | undefined => facts[idx];

async function load(snap?: number): Promise<void> {
  const res = await fetch("/api/review" + (snap ? `?snapshot=${snap}` : ""));
  const data = await res.json();
  review = data.review;
  snapshot = data.snapshot;
  snapshots = data.snapshots;
  facts = data.facts;
  idx = Math.min(idx, Math.max(0, facts.length - 1));
  renderAll();
}

function renderAll(): void {
  $("review-name").textContent = review;
  const select = $("snapshot-select") as HTMLSelectElement;
  select.innerHTML = "";
  for (const n of snapshots) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = String(n);
    option.selected = n === snapshot;
    select.appendChild(option);
  }
  renderList();
  renderFact();
  renderPanel();
}

function renderList(): void {
  const ul = $("fact-list");
  ul.innerHTML = "";
  facts.forEach((f, i) => {
    const li = document.createElement("li");
    li.className = "fact-item" + (i === idx ? " selected" : "");
    li.dataset.path = f.path;
    const depth = f.path.split("/").length - 1;
    li.style.paddingLeft = `${12 + depth * 16}px`;
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = f.path;
    li.appendChild(path);
    if (f.sidecar?.items?.length) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.title = `${f.sidecar.items.length} item(s)`;
      li.appendChild(dot);
    }
    if (f.sidecar?.decision) {
      const badge = document.createElement("span");
      badge.className = `badge ${f.sidecar.decision}`;
      badge.textContent = f.sidecar.decision;
      li.appendChild(badge);
    }
    li.addEventListener("click", () => {
      idx = i;
      renderAll();
    });
    ul.appendChild(li);
  });
}

function renderFact(): void {
  const f = fact();
  $("fact-title").textContent = f?.path ?? "";
  $("fact-content").innerHTML = f ? renderMarkdown(f.content) : "";
}

function renderPanel(): void {
  const f = fact();
  for (const button of $("decisions").querySelectorAll("button")) {
    button.classList.toggle(
      "active",
      !!f?.sidecar?.decision && button.dataset.decision === f.sidecar.decision,
    );
  }
  const panel = $("panel-items");
  panel.innerHTML = "";
  for (const item of f?.sidecar?.items ?? []) {
    const div = document.createElement("div");
    div.className = `item item-${item.type}`;
    div.dataset.id = item.id;
    const kind = document.createElement("span");
    kind.className = "item-kind";
    kind.textContent = item.type;
    div.appendChild(kind);
    if (item.anchor?.quote) {
      const quote = document.createElement("blockquote");
      quote.textContent = item.anchor.quote;
      div.appendChild(quote);
    }
    if (item.type === "question") {
      for (const entry of item.thread ?? []) {
        const p = document.createElement("p");
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = entry.who;
        p.appendChild(who);
        p.appendChild(document.createTextNode(entry.text));
        div.appendChild(p);
      }
    } else if (item.text) {
      const p = document.createElement("p");
      p.textContent = item.text;
      div.appendChild(p);
    }
    if (item.type !== "question") {
      const remove = document.createElement("button");
      remove.className = "item-remove";
      remove.setAttribute("aria-label", `Remove ${item.id}`);
      remove.textContent = "✕";
      remove.addEventListener("click", () => removeItem(f!.path, item.id));
      div.appendChild(remove);
    }
    panel.appendChild(div);
  }
}

function normalize(sidecar: Sidecar): Sidecar | null {
  if (sidecar.items && sidecar.items.length === 0) delete sidecar.items;
  if (sidecar.decision === undefined && !sidecar.items) return null;
  return sidecar;
}

function putSidecar(f: Fact): Promise<Response> {
  return fetch("/api/sidecar", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot, path: f.path, sidecar: f.sidecar ?? {} }),
  });
}

function setDecision(decision: string): void {
  const f = fact();
  if (!f) return;
  const sidecar: Sidecar = f.sidecar ?? {};
  if (sidecar.decision === decision) delete sidecar.decision;
  else sidecar.decision = decision as Sidecar["decision"];
  f.sidecar = normalize(sidecar);
  void putSidecar(f);
  renderAll();
}

function nextId(items: SidecarItem[], prefix: string): string {
  let max = 0;
  for (const item of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + (max + 1);
}

// Which occurrence of `text` (within the rendered fact) is selected.
function occurrenceIndex(selection: Selection, text: string): number {
  const container = $("fact-content");
  const range = document.createRange();
  range.setStart(container, 0);
  const selRange = selection.getRangeAt(0);
  range.setEnd(selRange.startContainer, selRange.startOffset);
  const before = range.toString();
  let count = 0;
  let i = 0;
  while ((i = before.indexOf(text, i)) !== -1) {
    count++;
    i++;
  }
  return count;
}

function beginItem(type: SidecarItem["type"]): void {
  const f = fact();
  if (!f) return;
  let anchor: { quote: string } | undefined;
  if (type !== "comment") {
    const selection = window.getSelection();
    const text = selection?.toString() ?? "";
    if (text && selection && $("fact-content").contains(selection.anchorNode)) {
      // Anchor to the fact source; widen until the quote is unique in it.
      const quote = f.content.includes(text)
        ? widenQuote(f.content, text, occurrenceIndex(selection, text))
        : text;
      anchor = { quote };
    }
  }
  pending = { type, anchor };
  $("item-form-label").textContent =
    type + (anchor ? ` — “${anchor.quote}”` : " — whole fact");
  ($("item-form") as HTMLFormElement).hidden = false;
  const input = $("item-input") as HTMLTextAreaElement;
  input.value = "";
  input.focus();
}

function cancelForm(): void {
  pending = null;
  ($("item-form") as HTMLFormElement).hidden = true;
}

function commitItem(): void {
  const f = fact();
  const input = $("item-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!f || !pending || !text) return cancelForm();
  const sidecar: Sidecar = f.sidecar ?? {};
  const items = (sidecar.items ??= []);
  const id = nextId(items, pending.type[0]!);
  const item: SidecarItem = { id, type: pending.type };
  if (pending.anchor) item.anchor = pending.anchor;
  if (pending.type === "question") item.thread = [{ who: "human", text }];
  else item.text = text;
  items.push(item);
  f.sidecar = sidecar;
  if (pending.type !== "question") undoStack.push({ path: f.path, id });
  void putSidecar(f);
  cancelForm();
  renderAll();
}

function removeItem(path: string, id: string): void {
  const f = facts.find((x) => x.path === path);
  if (!f?.sidecar?.items) return;
  f.sidecar.items = f.sidecar.items.filter((item) => item.id !== id);
  f.sidecar = normalize(f.sidecar);
  const stackIdx = undoStack.findIndex((u) => u.path === path && u.id === id);
  if (stackIdx !== -1) undoStack.splice(stackIdx, 1);
  void putSidecar(f);
  renderAll();
}

function undo(): void {
  const last = undoStack.pop();
  if (last) removeItem(last.path, last.id);
}

function move(delta: number): void {
  if (!facts.length) return;
  idx = Math.min(facts.length - 1, Math.max(0, idx + delta));
  renderAll();
}

function showOverlay(message: string): void {
  $("overlay-msg").textContent = message;
  ($("overlay") as HTMLElement).hidden = false;
}

async function finish(): Promise<void> {
  try {
    await fetch("/api/finish", { method: "POST" });
  } catch {
    // server exits as it answers; a dropped connection is fine
  }
  showOverlay("Review finished. The agent has been notified — you can close this tab.");
}

async function approve(): Promise<void> {
  try {
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    });
    if (!res.ok) {
      const err = await res.json();
      showOverlay(`Approve failed: ${err.error}`);
      return;
    }
  } catch {
    // as above
  }
  showOverlay(`Snapshot ${snapshot} approved — promoted to approved/.`);
}

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName)) {
    if (event.key === "Escape") cancelForm();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitItem();
    }
    return;
  }
  switch (event.key) {
    case "j": move(1); break;
    case "k": move(-1); break;
    case "1": setDecision("keep"); break;
    case "2": setDecision("not-needed"); break;
    case "3": setDecision("simplify"); break;
    case "4": setDecision("defer"); break;
    case "a": event.preventDefault(); beginItem("annotation"); break;
    case "q": event.preventDefault(); beginItem("question"); break;
    case "c": event.preventDefault(); beginItem("comment"); break;
    case "u": undo(); break;
  }
});

$("decisions").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (button?.dataset.decision) setDecision(button.dataset.decision);
});
$("item-form").addEventListener("submit", (event) => {
  event.preventDefault();
  commitItem();
});
$("item-cancel").addEventListener("click", cancelForm);
$("btn-finish").addEventListener("click", () => void finish());
$("btn-approve").addEventListener("click", () => void approve());
($("snapshot-select") as HTMLSelectElement).addEventListener("change", (event) => {
  void load(Number((event.target as HTMLSelectElement).value));
});

void load();
