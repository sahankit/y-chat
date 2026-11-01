# Deploy Y-Chat on Google Cloud

Target project: **`chatkaro-1754733802`**

| Piece | GCP service |
|--------|-------------|
| UI (`public/`) | **Cloud Storage** bucket (public HTTPS URLs) |
| Relay (`server.js`) | **Cloud Run** (WebSocket + `/health`) |

Cloud Run free tier covers light use; Storage egress may incur small charges at scale.

## 1. Sign in with the project owner

The CLI must use the Google account that **owns** `chatkaro-1754733802`, not an expired work login.

```bash
gcloud auth login
gcloud auth application-default login   # optional; helps Cloud Build
gcloud config set project chatkaro-1754733802
gcloud projects describe chatkaro-1754733802
```

If the project is under a different Gmail, switch account in the [Cloud Console](https://console.cloud.google.com/welcome?project=chatkaro-1754733802) and run `gcloud auth login` again.

## 2. Deploy

From the repo root:

```bash
chmod +x deploy/gcp/deploy.sh
GCP_PROJECT=chatkaro-1754733802 ./deploy/gcp/deploy.sh
```

Optional:

```bash
GCP_REGION=us-central1 GCP_UI_BUCKET=chatkaro-1754733802-ychat-ui ./deploy/gcp/deploy.sh
```

## 3. After deploy

- Open **`https://storage.googleapis.com/<bucket>/index.html`**
- Relay URL is written into `public/config.json` as `wss://…run.app`
- Relay allows origin **`https://storage.googleapis.com`** (required for UI + relay on different hosts)

## 4. Update UI only

```bash
gcloud storage rsync public/ gs://chatkaro-1754733802-ychat-ui/ --delete-unmatched-destination-objects
```

## 5. Update relay only

Re-run `./deploy/gcp/deploy.sh` or:

```bash
gcloud run deploy ychat-relay --source . --dockerfile deploy/gcp/Dockerfile --region us-central1
```

## 6. Custom domain (after you buy one)

Use two hostnames:

| Host | Example | Points to |
|------|---------|-----------|
| **UI** | `www.yourdomain.com` | Static hosting (see below) |
| **Relay** | `relay.yourdomain.com` | Cloud Run service `ychat-relay` |

### Relay (`relay.…`)

1. [Cloud Run → ychat-relay → Manage custom domains](https://console.cloud.google.com/run?project=chatkaro-1754733802)
2. Add `relay.yourdomain.com` and follow the **DNS records** Google shows (usually CNAME).
3. Wait for managed SSL (often 15–60 minutes).
4. Update relay env:

```bash
gcloud run services update ychat-relay --region us-central1 \
  --set-env-vars "ALLOWED_ORIGINS=https://www.yourdomain.com,https://yourdomain.com"
```

5. Set `public/config.json`:

```json
{
  "wsUrl": "wss://relay.yourdomain.com",
  "healthUrl": "https://relay.yourdomain.com/health"
}
```

Re-upload the UI (Firebase/Pages/GCS — wherever the UI lives).

### UI (`www.…`)

GCS bucket URLs **cannot** use a nice custom domain without a paid load balancer. For a **free HTTPS custom domain**, pick one:

- **Firebase Hosting** (same GCP project) — `firebase deploy`, add custom domain in Firebase console.
- **Cloudflare Pages** — connect repo, build `public/` as static.
- **GitHub Pages** — custom domain in repo settings (CNAME `www`).

Point **`www`** (and optionally **`@`** apex via redirect) to that host. Use **`https://www.yourdomain.com`** as the canonical site in SEO tags.

### DNS tip

Use **Cloudflare** (free) for DNS: proxy orange-cloud optional for UI; for **relay**, follow Cloud Run docs (often DNS-only / grey cloud for WebSockets).

## 7. Tear down

```bash
gcloud run services delete ychat-relay --region us-central1 --quiet
gcloud storage rm -r gs://chatkaro-1754733802-ychat-ui/
```
