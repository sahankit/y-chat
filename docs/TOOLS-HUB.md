# Tools hub (sahankit.github.io)

The **user site** repo hosts free calculators and writing tools for AdSense/SEO:

**Live:** https://sahankit.github.io/

Source in this monorepo: `deploy/sahankit.github.io/` (pushed to [sahankit/sahankit.github.io](https://github.com/sahankit/sahankit.github.io)).

## Pages

- 12 tools (word counter, JSON, EMI, BMI, IFSC/PAN format, etc.)
- 3 guides
- `sitemap.xml`, `robots.txt`, `ads.txt`, shared `assets/ads.js`

## Update

```bash
cd deploy/sahankit.github.io
node build-site.mjs
git add -A && git commit -m "Update tools" && git push
```

Y-Chat stays at `/y-chat/` in the separate `y-chat` repo.
