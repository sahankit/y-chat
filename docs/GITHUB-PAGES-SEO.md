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
| `404.html` | OK | Helpful links, `noindex` |
| Breadcrumbs + CTAs | OK | Guide/legal pages link back to join chat |
| `WebPage` / `Organization` schema | OK | Guides, terms, privacy, home |

## Search engines (manual dashboards)

**Sitemap URL (both):** `https://sahankit.github.io/y-chat/sitemap.xml`

### Google Search Console

1. **Property:** URL prefix → `https://sahankit.github.io/y-chat/`
2. **Verify:** HTML file → [google34da527c15058477.html](https://sahankit.github.io/y-chat/google34da527c15058477.html)
3. **Sitemaps** → submit full sitemap URL above
4. **URL inspection** → `index.html` → **Request indexing** (once per key page)
5. After 3–7 days: **Performance** / **Pages**

### Bing Webmaster Tools

1. Site: `https://sahankit.github.io/y-chat/` (verify if not already)
2. **Sitemaps** → same URL as Google
3. Optional: **URL Submission** → home + guide pages (Bing allows batch submit)
4. After a few days: **Site Explorer** / **Search Performance**

### Fix: “Sitemap could not be read”

The live file is valid XML (open [sitemap.xml](https://sahankit.github.io/y-chat/sitemap.xml) in your browser). Search Console often shows this once if the first fetch was too early or the wrong URL was used.

1. In **Sitemaps**, delete the failed `/sitemap.xml` entry.
2. Wait **5–10 minutes**.
3. **Add sitemap** again — paste the **full** URL:
   ```text
   https://sahankit.github.io/y-chat/sitemap.xml
   ```
   (If the box only accepts a path, enter `sitemap.xml` — not `/sitemap.xml` at the site root.)
4. Top bar **URL inspection** → same sitemap URL → confirm fetch is OK.
5. Recheck **Sitemaps** in **24 hours** (status can lag).

Property must stay **URL prefix** `https://sahankit.github.io/y-chat/`, not Domain `github.io`.

## Optional (not required for basics)

| Item | Why |
|------|-----|
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
| `public/.nojekyll` | Skip Jekyll on GitHub Pages |
| `public/ychatindexnow*.txt` | [IndexNow](https://www.indexnow.org/) key (Bing, Yandex, etc.) |
| Deploy workflow | Pings IndexNow after each Pages deploy |

### IndexNow (automatic)

Each push to `main` posts your five public URLs to IndexNow (helps **Bing** crawl sooner). Google still relies on Search Console + sitemap.

### Absolute canonical / OG URLs

HTML `canonical`, `og:url`, and share images use the full `https://sahankit.github.io/y-chat/…` URLs so crawlers do not depend on JavaScript. If you change the Pages path, update those tags in the five HTML files to match **sitemap.xml**.

If you fork to another Pages path, update **sitemap.xml**, **robots.txt**, canonical/OG tags, and the IndexNow key URL in **pages.yml** to match your base URL.

## Off-site (you do this — biggest lever while `site:` is empty)

| Action | Why |
|--------|-----|
| GitHub repo **About** → link `https://sahankit.github.io/y-chat/` | Google trusts github.io; gives a direct link to your path |
| GitHub **Topics** on the repo | `chat`, `websocket`, `github-pages`, `yahoo` |
| Profile README or pin the repo | One more crawl path |
| GSC **Request indexing** on home + guides | Still required for Google |

No amount of on-page SEO replaces **verify in GSC + sitemap + request indexing** and a few days’ wait.

## Sharing

Use one URL everywhere: **https://sahankit.github.io/y-chat/**
