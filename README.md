# Y-Chat

Local chat rooms and a private messenger in the browser. Guests can join with a nickname; optional accounts keep a buddy list and status on the machine running the server.

## Requirements

- Node.js 18 or newer

## Quick start

```bash
npm install
npm start
```

Open the URL printed in the terminal (default port **4317**). Override with `PORT=8080 npm start`.

## Tests

With the server running:

```bash
npm test
```

Point at another host with `YCHAT_URL=http://127.0.0.1:4317 npm test`.

## Data

Registered users are stored in `data/accounts.json` (created on first sign-up). That folder is gitignored. Room chat and private messages are not persisted; user-created rooms disappear when the server process stops.

## Public deploy

Put HTTPS in front of the app and use `wss://` for WebSockets. The server rejects WebSocket connections whose `Origin` header does not match `Host`. Sign-in attempts are rate-limited per IP and username after repeated failures. Account passwords must be at least 8 characters. Configure `public/ads.json` and `public/analytics.json` only if you use AdSense or Google Analytics (both load after the legal gate on the home page).
