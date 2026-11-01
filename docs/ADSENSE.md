# Google AdSense for Y-Chat (GitHub Pages)

**Live site:** https://sahankit.github.io/y-chat/

Y-Chat already loads ads **only after** the user accepts the 18+ Terms (same gate as analytics). Slots are **outside** the live message UI: welcome area and room list—not inside chat or private IM.

## Before you apply (read this)

Google often **declines** or limits sites that are mostly **user-generated chat** with little editorial content. Y-Chat mitigates that with:

- Static guides (`chat-rooms.html`, `messenger.html`), FAQ, and long copy on the home page  
- Clear **18+** Terms, Privacy, and “Advertisement” labels  
- No ads in the message stream  

Approval is **not guaranteed**. If rejected, fix what Google cites in the email (content, navigation, contact info, moderation story) and reapply after 2–4 weeks.

## GitHub Pages quirk (project site, not custom domain)

Y-Chat is a **project site**: `https://sahankit.github.io/y-chat/` (path under your username).

**AdSense “Add site” will reject that URL** with *“URL must be a valid top-level domain”* and suggest **`https://sahankit.github.io`** instead. That is expected: register the **host**, not the `/y-chat/` folder.

| What | URL |
|------|-----|
| Enter in AdSense **Add site** | **`https://sahankit.github.io`** (no `/y-chat/`) |
| Where users open Y-Chat | `https://sahankit.github.io/y-chat/` |
| Search Console (keep as-is) | URL prefix `https://sahankit.github.io/y-chat/` |

You still run ads **only on Y-Chat pages** via `ads.json` in this repo. AdSense just ties the account to the `github.io` site name.

### Root `ads.txt` (required)

AdSense looks for **`https://sahankit.github.io/ads.txt`**, not only under `/y-chat/`.

This repo deploys to **`/y-chat/`**, so you also need a **user site** repo named **`sahankit.github.io`** (same GitHub account) with at least:

```text
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

in **`ads.txt` at the repo root**, plus optional `index.html` that links or redirects to `/y-chat/`. Enable GitHub Pages on that repo (Deploy from branch → `main` / root).

Keep **`public/ads.txt`** in **y-chat** too (same line) at `…/y-chat/ads.txt` — some checks use the page URL path.

### Custom domain (optional, easiest long-term)

If you add a domain (e.g. `ytalk.in`) to this project in GitHub Pages settings, you can add **`https://ytalk.in`** in AdSense instead. Then one **`ads.txt`** at the domain root is enough. Update canonical URLs and `ALLOWED_ORIGINS` when you switch.

## 1. Create / sign in to AdSense

1. Go to [Google AdSense](https://www.google.com/adsense/).
2. **Add site** → **`https://sahankit.github.io`** (not the `/y-chat/` path).
3. Connect **Search Console** if asked (your `/y-chat/` property is fine for content; site name in AdSense is still the host above).

## 2. Verify site ownership

AdSense may offer one of:

| Method | What to do in this repo |
|--------|-------------------------|
| **HTML meta tag** | Fill `client` in `public/ads.json` with your `ca-pub-…` ID, push to `main`. `ads-head.js` on every page sets `<meta name="google-adsense-account" content="ca-pub-…">` for crawlers. |
| **ads.txt snippet** | See step 4 below. |
| **HTML file upload** | Rare for GitHub Pages; prefer meta + ads.txt. |

After you edit `ads.json`, deploy (push to `main`), then click **Verify** in AdSense.

## 3. Create display ad units

In AdSense → **Ads** → **By ad unit** → **Display ads**, create **two** responsive units:

| Unit purpose | Y-Chat slot key in `ads.json` | Where it shows |
|--------------|----------------------------------|----------------|
| Welcome / gate area | `welcome` | `#ad-welcome` on home (after Terms accepted) |
| Room list | `rooms` | Top of lobby room list (after you join chat) |

Copy each unit’s **data-ad-slot** numeric ID into `public/ads.json`:

```json
{
  "client": "ca-pub-1234567890123456",
  "slots": {
    "welcome": "1111111111",
    "rooms": "2222222222"
  }
}
```

Use **`public/ads.example.json`** as a template. The `ca-pub-…` ID is public (it appears in the page source when ads run).

Commit and push. GitHub Pages redeploys in a few minutes.

## 4. ads.txt (required for revenue)

AdSense → **Account** → **ads.txt** shows the exact line for your publisher ID.

Create **`public/ads.txt`** (site root on Pages):

```text
google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
```

Use the **`pub-…`** form from the dashboard (same digits as in `ca-pub-…`, without the `ca-` prefix). Push to `main`, then confirm:

https://sahankit.github.io/y-chat/ads.txt

In AdSense, run **Check for updates** on ads.txt until status is OK.

Confirm **both** if you use a project site:

- https://sahankit.github.io/ads.txt (user site repo)
- https://sahankit.github.io/y-chat/ads.txt (this repo’s `public/ads.txt`)

## 5. Test after approval

1. Open https://sahankit.github.io/y-chat/ in a **private/incognito** window (or clear site data).
2. Accept the 18+ Terms checkbox.
3. You should see an **Advertisement** block on the welcome area; after joining chat, another may appear above the room list.
4. If slots stay empty: new units can take **hours**; ad blockers must be off; check the browser console for `adsbygoogle` errors.

Ads do **not** load until Terms are accepted (`app.js` → `setupAds()` after legal gate).

## 6. Policy checklist (ongoing)

- Keep **Terms**, **Privacy**, and guide pages linked from the nav.  
- Do not place ad code inside room chat, IM windows, or message lists (already enforced in code).  
- If you enable **Google Analytics**, set `public/analytics.json` → `measurementId`; it also loads only after accept.  
- EEA/UK users may need a **consent banner** (CMP) later if Google flags it—Privacy Policy already mentions cookies when ads are on.

## Files reference

| File | Role |
|------|------|
| `public/ads.json` | Publisher ID + slot IDs (deploy this) |
| `public/ads.example.json` | Template |
| `public/ads.txt` | You add after AdSense gives the line |
| `public/ads-head.js` | Site verification meta for crawlers |
| `public/app.js` | Loads AdSense script + fills slots after consent |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Verify fails | Confirm `ads.json` `client` matches AdSense; meta visible in page source; wait for Pages deploy. |
| ads.txt not found | File must be `public/ads.txt` → `…/y-chat/ads.txt` on live site. |
| “No fill” / blank slots | Normal on low traffic; wait; check slot IDs and approval status. |
| Application rejected | Add clearer contact/about, stress moderation rules, more static content; avoid implying Yahoo affiliation in ad landing experience. |
