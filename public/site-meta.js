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
  const ld = document.querySelector('script[type="application/ld+json"]');
  if (ld && ld.textContent.includes('"/"')) {
    try {
      const data = JSON.parse(ld.textContent);
      if (data.url && !/^https?:\/\//i.test(data.url)) data.url = abs(data.url);
      if (data.image && !/^https?:\/\//i.test(data.image)) data.image = abs(data.image);
      ld.textContent = JSON.stringify(data);
    } catch { /* ignore */ }
  }

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
