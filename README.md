# Y-Chat

Browser chat rooms and private messenger. The **UI is static**; a small **WebSocket relay** handles live rooms and messages only.

## Try online (free tier)

| Piece | URL |
|--------|-----|
| **Chat UI** | [https://sahankit.github.io/y-chat/](https://sahankit.github.io/y-chat/) (GitHub Pages) |
| **Relay** | Google Cloud Run free tier — configured in `public/config.json` |

After you push to `main`, enable **Settings → Pages → Build and deployment → GitHub Actions** once if the site is not live yet.

**SEO (no custom domain):** `public/sitemap.xml` and `public/robots.txt` target this GitHub Pages URL. Submit the sitemap in [Google Search Console](https://search.google.com/search-console) — see **[docs/GITHUB-PAGES-SEO.md](docs/GITHUB-PAGES-SEO.md)**.

## Requirements

- Node.js 18+

## Local development

Terminal 1 — chat relay (WebSocket + `/health` only):

```bash
npm install
cp public/config.example.json public/config.json   # points UI at ws://127.0.0.1:4317
npm start
```

Terminal 2 — static UI:

```bash
npm run static
```

Open **http://127.0.0.1:4318**. The relay listens on **4317** by default (`PORT=… npm start`).

## Tests

With both processes running:

```bash
npm test
```

## What runs where

| Piece | Host | Role |
|--------|------|------|
| `public/` | GitHub Pages, S3, Netlify, `npm run static`, etc. | HTML, CSS, JS, legal pages, **profiles & buddies in localStorage** |
| `server.js` | Fly, Railway, VPS, etc. | Rooms, messages, presence, resume tokens — **no static files, no account database** |

Set `public/config.json` when the UI and relay are on different origins:

```json
{
  "wsUrl": "wss://your-relay.example.com",
  "healthUrl": "https://your-relay.example.com/health"
}
```

On the relay, set `ALLOWED_ORIGINS` to your static site origin(s), comma-separated (for example `https://sahankit.github.io`).

## Deploy

- **GitHub Pages:** push `main` — workflow `.github/workflows/pages.yml` publishes `public/`. Set `config.json` to your relay URL.
- **AWS (personal account):** see **[deploy/aws/README.md](deploy/aws/README.md)** — `./deploy/aws/deploy.sh` with `AWS_PROFILE=personal`.
- **GCP:** see **[deploy/gcp/README.md](deploy/gcp/README.md)** — `./deploy/gcp/deploy.sh` with `GCP_PROJECT=chatkaro-1754733802`.
- **Relay elsewhere:** run `npm start` on Fly/Railway/VPS; set `ALLOWED_ORIGINS` and `config.json` `wss://` URL.

Room chat and private messages are not stored on the relay. User-created rooms disappear when the relay restarts.
