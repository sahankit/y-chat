"use strict";

/** Sets AdSense site-verification meta when `ads.json` has a publisher ID (no ad script here). */
(() => {
  fetch(new URL("ads.json", location.href).href)
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      const client = String((cfg && cfg.client) || "").trim();
      if (!/^ca-pub-\d+$/.test(client)) return;
      let node = document.querySelector('meta[name="google-adsense-account"]');
      if (!node) {
        node = document.createElement("meta");
        node.setAttribute("name", "google-adsense-account");
        document.head.appendChild(node);
      }
      node.setAttribute("content", client);
    })
    .catch(() => {});
})();
