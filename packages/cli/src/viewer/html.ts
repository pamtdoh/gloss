export const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>reviewkit</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.55 system-ui, sans-serif; color: #1a1d21; background: #f6f7f8; }
  button { font: inherit; cursor: pointer; }
  header {
    display: flex; align-items: center; gap: 12px; height: 48px;
    padding: 0 16px; background: #fff; border-bottom: 1px solid #dde0e3;
  }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  header .spacer { flex: 1; }
  header select { font: inherit; padding: 2px 4px; }
  header button { border: 1px solid #c8ccd0; background: #fff; border-radius: 6px; padding: 5px 12px; }
  #btn-finish { background: #1a56db; border-color: #1a56db; color: #fff; }
  main { display: grid; grid-template-columns: 300px 1fr 380px; height: calc(100vh - 48px); }
  main > * { overflow-y: auto; }
  nav { background: #fff; border-right: 1px solid #dde0e3; }
  #fact-list { list-style: none; margin: 0; padding: 8px 0; }
  .fact-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; cursor: pointer; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .fact-item:hover { background: #f0f2f4; }
  .fact-item.selected { background: #e8f0fe; }
  .fact-item .path { overflow: hidden; text-overflow: ellipsis; }
  .badge {
    margin-left: auto; font-size: 11px; border-radius: 10px; padding: 1px 8px;
    background: #e4e6e8; color: #333; flex: none;
  }
  .badge.keep { background: #d9f2e3; color: #14522d; }
  .badge.not-needed { background: #e4e6e8; color: #44484c; }
  .badge.simplify { background: #fdeeca; color: #6b4d05; }
  .badge.defer { background: #e9e2f7; color: #45308a; }
  .dot { width: 6px; height: 6px; border-radius: 3px; background: #1a56db; flex: none; }
  #col-fact { padding: 28px 36px; }
  #fact-title { color: #6b7075; font-size: 12px; margin-bottom: 12px; }
  #fact-content { max-width: 46em; }
  #fact-content h1 { font-size: 20px; line-height: 1.3; }
  #fact-content code { background: #eceef0; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
  aside { background: #fff; border-left: 1px solid #dde0e3; padding: 16px; }
  aside h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7075; margin: 16px 0 8px; }
  aside h2:first-child { margin-top: 0; }
  #decisions { display: flex; gap: 6px; flex-wrap: wrap; }
  #decisions button {
    border: 1px solid #c8ccd0; background: #fff; border-radius: 6px; padding: 5px 10px;
  }
  #decisions button.active { background: #1a56db; border-color: #1a56db; color: #fff; }
  #decisions button kbd {
    font: 11px monospace; background: #eceef0; border-radius: 3px; padding: 0 4px; margin-right: 5px;
  }
  #decisions button.active kbd { background: rgba(255,255,255,.25); color: #fff; }
  .item { position: relative; border: 1px solid #e2e5e8; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .item .item-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7075; }
  .item blockquote {
    margin: 6px 0; padding: 2px 10px; border-left: 3px solid #c8ccd0;
    color: #55595e; font-size: 13px; white-space: pre-wrap;
  }
  .item p { margin: 6px 0 0; white-space: pre-wrap; }
  .item .who { color: #6b7075; font-weight: 600; margin-right: 6px; }
  .item-remove {
    position: absolute; top: 8px; right: 8px; border: none; background: none;
    color: #9aa0a6; padding: 2px 6px; border-radius: 4px;
  }
  .item-remove:hover { background: #f0f2f4; color: #1a1d21; }
  #item-form { border: 1px solid #c8ccd0; border-radius: 8px; padding: 12px; margin-top: 12px; }
  #item-form-label { font-size: 12px; color: #6b7075; margin-bottom: 8px; white-space: pre-wrap; }
  #item-input { width: 100%; min-height: 72px; font: inherit; padding: 8px; border: 1px solid #c8ccd0; border-radius: 6px; resize: vertical; }
  #item-form .row { display: flex; gap: 8px; margin-top: 8px; }
  #item-form button { border: 1px solid #c8ccd0; background: #fff; border-radius: 6px; padding: 4px 12px; }
  #item-save { background: #1a56db; border-color: #1a56db; color: #fff; }
  .hints { color: #9aa0a6; font-size: 12px; margin-top: 20px; }
  #overlay {
    position: fixed; inset: 0; display: grid; place-items: center;
    background: #f6f7f8; font-size: 18px; text-align: center; padding: 24px;
  }
  #overlay[hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>
<header>
  <h1>reviewkit — <span id="review-name"></span></h1>
  <label for="snapshot-select" style="color:#6b7075">snapshot</label>
  <select id="snapshot-select" aria-label="Snapshot"></select>
  <span class="spacer"></span>
  <button id="btn-approve" aria-label="Approve snapshot">Approve</button>
  <button id="btn-finish" aria-label="Finish review">Finish review</button>
</header>
<main>
  <nav aria-label="Facts"><ul id="fact-list"></ul></nav>
  <section id="col-fact">
    <div id="fact-title"></div>
    <article id="fact-content"></article>
  </section>
  <aside aria-label="Review panel">
    <h2>Decision</h2>
    <div id="decisions" role="group" aria-label="Decision">
      <button data-decision="keep"><kbd>1</kbd>Keep</button>
      <button data-decision="not-needed"><kbd>2</kbd>Not needed</button>
      <button data-decision="simplify"><kbd>3</kbd>Simplify</button>
      <button data-decision="defer"><kbd>4</kbd>Defer</button>
    </div>
    <h2>Items</h2>
    <div id="panel-items"></div>
    <form id="item-form" hidden>
      <div id="item-form-label"></div>
      <textarea id="item-input" aria-label="Item text"></textarea>
      <div class="row">
        <button type="submit" id="item-save">Save</button>
        <button type="button" id="item-cancel">Cancel</button>
      </div>
    </form>
    <p class="hints">j/k navigate &middot; 1&ndash;4 decide &middot; a annotate selection &middot; q ask &middot; c comment &middot; u undo</p>
  </aside>
</main>
<div id="overlay" hidden><div id="overlay-msg"></div></div>
<script src="/client.js"></script>
</body>
</html>
`;
