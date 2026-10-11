import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { loadPrefs } from "./prefs.js";
import { ReviewStore } from "./store.js";

// The viewer's entry. The service worker keeps a copy of everything the
// tab reads, so the review stays readable once its server has stopped —
// even across a reload.
if ("serviceWorker" in navigator && new URLSearchParams(location.search).get("sw") !== "0") {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // no service worker (an insecure proxied origin): online only
  });
}

const store = new ReviewStore();
void store.start();
void loadPrefs();
createRoot(document.getElementById("root")!).render(<App store={store} />);
