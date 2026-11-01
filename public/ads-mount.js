"use strict";

/** Manual display slots on static pages (after Terms consent in localStorage). */
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

  function pickSlot(slots, keys) {
    if (!slots || typeof slots !== "object") return "";
    for (const key of keys) {
      const id = String(slots[key] || "").trim();
      if (/^\d+$/.test(id)) return id;
    }
    return "";
  }

  function fillHost(host, client, slot) {
    if (!host || !client || !slot) return;
    if (host.dataset.ychatAdSlot === slot && host.querySelector("ins.adsbygoogle")) return;
    host.dataset.ychatAdSlot = slot;
    host.replaceChildren();
    const label = document.createElement("p");
    label.className = "ad-label";
    label.textContent = "Advertisement";
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", client);
    ins.setAttribute("data-ad-slot", slot);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    host.appendChild(label);
    host.appendChild(ins);
    host.hidden = false;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* ignore */
    }
  }

  function mountGuideAds() {
    if (!legalOk()) return;
    const ready = window.ychatAdsReady ? window.ychatAdsReady() : Promise.resolve();
    ready
      .then(() => fetch(new URL("ads.json", location.href).href))
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (!cfg || !/^ca-pub-\d+$/.test(String(cfg.client || ""))) return;
        const slot = pickSlot(cfg.slots, ["guide", "display", "welcome"]);
        if (!slot) return;
        for (const id of ["ad-guide-top", "ad-guide", "ad-guide-bottom"]) {
          fillHost(document.getElementById(id), cfg.client, slot);
        }
      })
      .catch(() => {});
  }

  window.ychatMountGuideAds = mountGuideAds;
  if (legalOk()) mountGuideAds();
})();
