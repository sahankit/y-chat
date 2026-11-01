# SEO on GitHub Pages (no custom domain)

**Live site:** https://sahankit.github.io/y-chat/

## Files in this repo

| File | Purpose |
|------|---------|
| `public/sitemap.xml` | Absolute URLs under `/y-chat/` for Google |
| `public/robots.txt` | Points crawlers to that sitemap |
| `public/site-meta.js` | Turns relative canonical, Open Graph, and JSON-LD URLs into absolute links in the browser |

If you fork the repo to another GitHub Pages path, update **sitemap.xml** and **robots.txt** to match your `https://<user>.github.io/<repo>/` base.

## Google Search Console

1. Open [Google Search Console](https://search.google.com/search-console).
2. Add a **URL prefix** property: `https://sahankit.github.io/y-chat/`
3. Verify — HTML file `public/google34da527c15058477.html` is deployed at  
   `https://sahankit.github.io/y-chat/google34da527c15058477.html`
4. **Sitemaps** → submit: `https://sahankit.github.io/y-chat/sitemap.xml`
5. Use **Pages** and **Performance** reports after a few days to see queries and indexing.

## Sharing

Use the same URL everywhere (README, social, Discord):  
**https://sahankit.github.io/y-chat/**

## Custom domain later

See [CUSTOM-DOMAIN.md](./CUSTOM-DOMAIN.md). After you add a domain, replace URLs in `sitemap.xml` and `robots.txt`, and add the domain to Cloud Run `ALLOWED_ORIGINS`.
