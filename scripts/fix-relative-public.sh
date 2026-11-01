#!/usr/bin/env bash
# Use relative asset URLs so GitHub Pages (/y-chat/) and root hosts both work.
set -euo pipefail
P="public"
for f in "$P"/*.html; do
  sed -i '' \
    -e 's|href="/styles.css"|href="styles.css"|g' \
    -e 's|src="/site-meta.js"|src="site-meta.js"|g' \
    -e 's|src="/analytics.js"|src="analytics.js"|g' \
    -e 's|src="/profile.js"|src="profile.js"|g' \
    -e 's|src="/app.js"|src="app.js"|g' \
    -e 's|href="/icon-180.png"|href="icon-180.png"|g' \
    -e 's|href="/manifest.webmanifest"|href="manifest.webmanifest"|g' \
    -e 's|content="/og.png"|content="og.png"|g' \
    -e 's|href="/"|href="index.html"|g' \
    -e 's|href="/chat-rooms"|href="chat-rooms.html"|g' \
    -e 's|href="/messenger"|href="messenger.html"|g' \
    -e 's|href="/terms"|href="terms.html"|g' \
    -e 's|href="/privacy"|href="privacy.html"|g' \
    -e 's|href="/#gate-entry"|href="index.html#gate-entry"|g' \
    -e 's|"item": "/"|"item": "index.html"|g' \
    "$f"
done
