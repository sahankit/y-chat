# Create AdSense display units (2 minutes)

I can’t log into your Google account from here. Run these steps once, then paste the **slot ID** (digits only) into chat or edit `public/ads.json` yourself.

**Publisher ID (already in repo):** `ca-pub-5596933121293455`

## Steps

1. Open [Google AdSense](https://www.google.com/adsense/) → **Ads** → **By ad unit**.
2. **Display ads** → name e.g. **Y-Chat display** → **Responsive** → **Create**.
3. Copy the **data-ad-slot** number (often shown as “Ad unit ID”, 10 digits).
4. In **`public/ads.json`**, set one line (used for welcome, room list, and guide pages):

```json
{
  "client": "ca-pub-5596933121293455",
  "slots": {
    "display": "PASTE_ID_HERE",
    "welcome": "",
    "rooms": ""
  }
}
```

5. Push to `main` (or ask the agent to commit).

6. **Ads** → **Auto ads** → **ON** → **Apply to site** (for anchor/vignette ads without a slot).

## After push

- Accept **18+ Terms** on https://sahankit.github.io/y-chat/
- Test with ad blocker **off**
- New sites: **Sites** may show **Getting ready** — no fill until Google approves
