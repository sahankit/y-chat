"use strict";

/**
 * AdSense Auto ads + script load after 18+ Terms consent.
 * Return visits: boot from cached publisher ID in <head> so Google Auto ads can run early.
 */
(() => {
  const LEGAL_KEY = "ychat-legal";
  const LEGAL_VERSION = "3";
  const CLIENT_CACHE = "ychat-ads-client";

  function legalOk() {
    try {
      return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION;
    } catch {
      return false;
    }
  }

  function cacheClient(client) {
    try {
      localStorage.setItem(CLIENT_CACHE, client);
    } catch {
      /* private mode */
    }
  }

  function findAdSenseScript(client) {
    for (const node of document.querySelectorAll('script[src*="adsbygoogle.js"]')) {
      const src = node.getAttribute("src") || "";
      if (src.includes(client)) return node;
    }
    return null;
  }

  function queueAutoAds(client, enabled) {
    if (enabled === false) return;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.push({
      google_ad_client: client,
      enable_page_level_ads: true,
    });
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

  function bootAdSense(client, autoAds = true) {
    if (!/^ca-pub-\d+$/.test(client)) return Promise.resolve();
    window.__ychatAdsClient = client;
    queueAutoAds(client, autoAds);
    return injectAdSense(client);
  }

  let readyPromise = null;

  function startYchatAds() {
    if (readyPromise) return readyPromise;
    readyPromise = fetch(new URL("ads.json", location.href).href)
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        const client = String((cfg && cfg.client) || "").trim();
        const autoAds = cfg && cfg.autoAds !== false;
        if (!/^ca-pub-\d+$/.test(client)) return;
        cacheClient(client);
        return bootAdSense(client, autoAds);
      })
      .catch(() => {});
    return readyPromise;
  }

  window.startYchatAds = startYchatAds;
  window.ychatAdsReady = startYchatAds;
  window.ychatBootAdSense = bootAdSense;

  if (legalOk()) {
    let cached = "";
    try {
      cached = String(localStorage.getItem(CLIENT_CACHE) || "").trim();
    } catch {
      cached = "";
    }
    if (/^ca-pub-\d+$/.test(cached)) bootAdSense(cached, true);
    startYchatAds();
  }
})();
