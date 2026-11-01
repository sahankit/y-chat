"use strict";

(() => {
const LEGAL_KEY = "ychat-legal";
const LEGAL_VERSION = "2";

function legalOk() {
  try {
    return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

let started = false;

function startYchatAnalytics() {
  if (started) return;
  started = true;
  fetch("/analytics.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      const id = String((cfg && cfg.measurementId) || "").trim();
      if (!/^G-[A-Z0-9]{6,}$/.test(id)) return;
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag("js", new Date());
      gtag("config", id);
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      document.head.appendChild(script);
    })
    .catch(() => {});
}

window.startYchatAnalytics = startYchatAnalytics;
if (legalOk()) startYchatAnalytics();
})();
