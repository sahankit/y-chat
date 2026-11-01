# SEO on GitHub Pages (no custom domain)

**Live site:** https://sahankit.github.io/y-chat/

## Verified on site (technical)

| Check | Status | URL / note |
|--------|--------|------------|
| Home loads | OK | `/` and `/index.html` (prefer **one** in links; sitemap uses `index.html`) |
| Guide pages | OK | `chat-rooms.html`, `messenger.html` |
| Legal pages | OK | `terms.html`, `privacy.html` |
| `robots.txt` | OK | Allows crawl; sitemap URL is absolute |
| `sitemap.xml` | OK | Five pages, absolute `sahankit.github.io/y-chat/…` URLs |
| Google verification file | OK | `google34da527c15058477.html` |
| Share image | OK | `og.png` (1200×630 for OG/Twitter on home) |
| PWA manifest | OK | `manifest.webmanifest` |
| Meta / OG / FAQ schema | OK | Home + guides; `site-meta.js` absolutizes URLs |
| Mobile | OK | Viewport, responsive CSS |
| Indexable gate content | OK | Long `.discover` + FAQ in static HTML |

## You do in Search Console (manual)

1. **Property:** URL prefix → `https://sahankit.github.io/y-chat/`
2. **Verify:** HTML file method → [verification URL](https://sahankit.github.io/y-chat/google34da527c15058477.html)
3. **Sitemaps** → add: `sitemap.xml` (or full URL above)
4. **URL inspection** → test `https://sahankit.github.io/y-chat/index.html` → **Request indexing** (once)
5. After 3–7 days: **Performance** / **Pages** for impressions and queries

## Optional (not required for basics)

| Item | Why |
|------|-----|
| [Bing Webmaster Tools](https://www.bing.com/webmasters) | Extra search engine; import from GSC |
| GitHub repo **About** + **Topics** | `chat`, `websocket`, `github-pages` — helps GitHub discovery |
| Analytics (GA) after consent | `public/analytics.json` + measurement ID — tracks landing, not room text |
| AdSense | Separate approval; see terms / 18+ gate |
| Custom domain | Update `sitemap.xml`, `robots.txt`, Cloud Run `ALLOWED_ORIGINS` — [CUSTOM-DOMAIN.md](./CUSTOM-DOMAIN.md) |

## Repo files

| File | Purpose |
|------|---------|
| `public/sitemap.xml` | Submit in GSC |
| `public/robots.txt` | Crawler + sitemap pointer |
| `public/site-meta.js` | Absolute canonical, OG, JSON-LD |
| `public/google34da527c15058477.html` | Search Console verification |

If you fork to another Pages path, update **sitemap.xml** and **robots.txt** to match your base URL.

## Sharing

Use one URL everywhere: **https://sahankit.github.io/y-chat/**
