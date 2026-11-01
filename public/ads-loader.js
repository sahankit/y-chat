"use strict";

/** AdSense + Auto ads after the 18+ Terms gate (same client as the AdSense dashboard snippet). */
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
    for (const node of document.querySelectorAll('script[src*="adsbygoogle.js"]')) {
      const src = node.getAttribute("src") || "";
      if (src.includes(client)) return node;
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

  function queueAutoAds(client) {
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.push({
      google_ad_client: client,
      enable_page_level_ads: true,
    });
  }

  let readyPromise = null;

  function startYchatAds() {
    if (window.__ychatAdsClient) {
      queueAutoAds(window.__ychatAdsClient);
      return injectAdSense(window.__ychatAdsClient);
    }
    if (readyPromise) return readyPromise;
    readyPromise = fetch(new URL("ads.json", location.href).href)
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        const client = String((cfg && cfg.client) || "").trim();
        if (!/^ca-pub-\d+$/.test(client)) return;
        window.__ychatAdsClient = client;
        queueAutoAds(client);
        return injectAdSense(client);
      })
      .catch(() => {});
    return readyPromise;
  }

  window.startYchatAds = startYchatAds;
  window.ychatAdsReady = startYchatAds;
  if (legalOk()) startYchatAds();
})();
