"use strict";

(() => {
  const page = location.pathname.replace(/\/[^/]*$/, "") || "";
  const root = `${location.origin}${page.endsWith("/") ? page : `${page}/`}`.replace(/\/{2,}$/, "/");
  const abs = (path) => new URL(path, root).href;
  document.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach((node) => {
    const attr = node.tagName === "LINK" ? "href" : "content";
    const value = node.getAttribute(attr);
    if (value && !/^https?:\/\//i.test(value)) node.setAttribute(attr, abs(value));
  });
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach((node) => {
    const value = node.getAttribute("content");
    if (value && !/^https?:\/\//i.test(value)) node.setAttribute("content", abs(value));
  });
  function absolutizeLd(value) {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) return value;
      if (value === "/" || value.startsWith("/")) return abs(value.replace(/^\//, "") || "index.html");
      if (/\.html$/i.test(value)) return abs(value);
      return value;
    }
    if (Array.isArray(value)) return value.map(absolutizeLd);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = absolutizeLd(child);
      return out;
    }
    return value;
  }

  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    try {
      const data = absolutizeLd(JSON.parse(node.textContent));
      node.textContent = JSON.stringify(data);
    } catch { /* ignore */ }
  });

  const nav = document.querySelector(".site-nav");
  if (nav && !nav.querySelector(".site-nav-toggle")) {
    const menu = nav.querySelector(".site-nav-links");
    if (menu) {
      menu.id = "site-nav-menu";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "site-nav-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", "site-nav-menu");
      toggle.textContent = "Menu";
      nav.insertBefore(toggle, menu);
      toggle.addEventListener("click", () => {
        const open = nav.classList.toggle("site-nav-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      menu.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
          nav.classList.remove("site-nav-open");
          toggle.setAttribute("aria-expanded", "false");
        });
      });
    }
  }
})();
