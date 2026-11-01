"use strict";

/** Injects the AdSense / Auto ads script after the 18+ Terms gate (same snippet as AdSense dashboard). */
(() => {
  const LEGAL_KEY = "ychat-legal";
  const LEGAL_VERSION = "3";

  function legalOk() {
    try {
      return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION;
    } catch {
      return false;
    }
  }

  function findAdSenseScript(client) {
    const want = encodeURIComponent(client);
    for (const node of document.querySelectorAll('script[src*="adsbygoogle.js"]')) {
      const src = node.getAttribute("src") || "";
      if (src.includes(want)) return node;
    }
    return null;
  }

  function injectAdSense(client) {
    if (findAdSenseScript(client)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => reject(new Error("adsense")));
      document.head.appendChild(script);
    });
  }

  let started = false;

  function startYchatAds() {
    if (window.__ychatAdsClient) return injectAdSense(window.__ychatAdsClient);
    if (started) return Promise.resolve();
    started = true;
    return fetch(new URL("ads.json", location.href).href)
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        const client = String((cfg && cfg.client) || "").trim();
        if (!/^ca-pub-\d+$/.test(client)) return;
        window.__ychatAdsClient = client;
        return injectAdSense(client);
      })
      .catch(() => {});
  }

  window.startYchatAds = startYchatAds;
  if (legalOk()) startYchatAds();
})();
