#!/usr/bin/env bash
# Deploy Y-Chat to Google Cloud (static UI on Cloud Storage, relay on Cloud Run).
#
# Usage (after gcloud auth login with the project owner account):
#   GCP_PROJECT=chatkaro-1754733802 ./deploy/gcp/deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${GCP_PROJECT:-chatkaro-1754733802}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${GCP_SERVICE:-ychat-relay}"
BUCKET="${GCP_UI_BUCKET:-${PROJECT}-ychat-ui}"

gcloud config set project "$PROJECT"

echo "Enabling APIs (first run may take a minute)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  --quiet

echo "Creating UI bucket gs://${BUCKET} (if missing)..."
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access
fi

ARTIFACT_REPO="${GCP_ARTIFACT_REPO:-ychat}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${ARTIFACT_REPO}/relay:latest"

gcloud artifacts repositories describe "$ARTIFACT_REPO" --location="$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$ARTIFACT_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Y-Chat relay images" \
    --quiet

echo "Building relay image..."
gcloud builds submit "$ROOT" \
  --config "$ROOT/deploy/gcp/cloudbuild.yaml" \
  --substitutions="_IMAGE=${IMAGE}" \
  --quiet

echo "Deploying relay to Cloud Run..."
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --set-env-vars "ALLOWED_ORIGINS=https://storage.googleapis.com" \
  --quiet

RELAY_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
RELAY_WS="${RELAY_URL/https/wss}"
RELAY_HEALTH="${RELAY_URL}/health"

cat >"$ROOT/public/config.json" <<EOF
{
  "wsUrl": "${RELAY_WS}",
  "healthUrl": "${RELAY_HEALTH}"
}
EOF

echo "Uploading UI to gs://${BUCKET} ..."
gcloud storage rsync "$ROOT/public/" "gs://${BUCKET}/" --delete-unmatched-destination-objects

echo "Making UI objects publicly readable..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member=allUsers \
  --role=roles/storage.objectViewer \
  --quiet >/dev/null

UI_URL="https://storage.googleapis.com/${BUCKET}/index.html"

echo ""
echo "Done (project: ${PROJECT})."
echo "  UI:     ${UI_URL}"
echo "  Relay:  ${RELAY_WS}"
echo "  Health: ${RELAY_HEALTH}"
echo ""
echo "Open the UI link. If the relay pill is red, wait ~30s and refresh (Cloud Run cold start)."
