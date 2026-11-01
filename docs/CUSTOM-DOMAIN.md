# Custom domain (free)

## Recommended (free)

| Part | Service | Cost |
|------|---------|------|
| UI | **GitHub Pages** | $0 |
| Relay | **Cloud Run** (already deployed) | $0 at low traffic |

**Live UI (now):** https://sahankit.github.io/y-chat/

**Relay:** `wss://ychat-relay-eh5bo3zvta-uc.a.run.app`

## Connect your domain

1. **GitHub** → repo **sahankit/y-chat** → **Settings** → **Pages** → **Custom domain** → enter `www.yourdomain.com`.
2. At your registrar (or **Cloudflare** free DNS), add the records GitHub shows (usually `CNAME www → sahankit.github.io`).
3. Enable **Enforce HTTPS** in GitHub Pages settings.
4. Update Cloud Run so the relay accepts your site:

```bash
# Add your domain to the list (keep existing origins):
gcloud run services update ychat-relay --region us-central1 \
  --env-vars-file deploy/gcp/relay-env.yaml
```

Edit `deploy/gcp/relay-env.yaml` and add `https://www.yourdomain.com,https://yourdomain.com` to `ALLOWED_ORIGINS`.

5. Optional: add a **`relay.`** subdomain on Cloud Run ([Custom domains](https://console.cloud.google.com/run/detail/us-central1/ychat-relay?project=chatkaro-1754733802)) and point `public/config.json` to `wss://relay.yourdomain.com`.

## Alternative UI host (same GCP project)

Firebase Hosting (free SSL): run `./deploy/gcp/setup-hosting.sh` after `npx firebase-tools login`.
