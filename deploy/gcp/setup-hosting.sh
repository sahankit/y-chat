#!/usr/bin/env bash
# Free UI: Firebase Hosting (custom domain ready). Relay stays on Cloud Run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${GCP_PROJECT:-chatkaro-1754733802}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCP_SERVICE:-ychat-relay}"

gcloud config set project "$PROJECT"

RELAY_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
RELAY_WS="${RELAY_URL/https/wss}"
RELAY_HEALTH="${RELAY_URL}/health"

SITE_HOST="${FIREBASE_SITE:-${PROJECT}}"
UI_ORIGIN="https://${SITE_HOST}.web.app"
UI_ORIGIN_ALT="https://${SITE_HOST}.firebaseapp.com"

cat >"$ROOT/public/config.json" <<EOF
{
  "wsUrl": "${RELAY_WS}",
  "healthUrl": "${RELAY_HEALTH}"
}
EOF

echo "Updating relay ALLOWED_ORIGINS for Firebase Hosting..."
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "ALLOWED_ORIGINS=${UI_ORIGIN},${UI_ORIGIN_ALT},https://storage.googleapis.com" \
  --quiet

echo "Linking Firebase to GCP project (if needed)..."
npx --yes firebase-tools@13 projects:addfirebase "$PROJECT" 2>/dev/null || true

echo "Deploying Firebase Hosting..."
cd "$ROOT"
npx --yes firebase-tools@13 deploy --only hosting --project "$PROJECT"

echo ""
echo "Live UI (free HTTPS):"
echo "  ${UI_ORIGIN}"
echo "  ${UI_ORIGIN_ALT}"
echo "Relay: ${RELAY_WS}"
echo ""
echo "Custom domain (free): Firebase console → Hosting → Add custom domain → www.yourdomain.com"
echo "Then run:"
echo "  gcloud run services update $SERVICE --region $REGION --update-env-vars ALLOWED_ORIGINS=https://www.yourdomain.com,https://yourdomain.com,${UI_ORIGIN},${UI_ORIGIN_ALT}"
