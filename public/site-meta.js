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
})();
