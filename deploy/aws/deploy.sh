#!/usr/bin/env bash
# Deploy Y-Chat to your personal AWS account (S3 + CloudFront UI, EC2 + CloudFront relay).
# Usage: AWS_PROFILE=personal ./deploy/aws/deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-ychat}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-}"

AWS=(aws)
if [[ -n "$PROFILE" ]]; then
  AWS+=(--profile "$PROFILE")
fi
AWS+=(--region "$REGION")

echo "Checking AWS credentials (profile: ${PROFILE:-default}, region: $REGION)..."
if ! "${AWS[@]}" sts get-caller-identity >/dev/null; then
  echo ""
  echo "AWS credentials are missing or expired."
  echo "For a personal account, run:"
  echo "  aws configure --profile personal"
  echo "Then deploy with:"
  echo "  AWS_PROFILE=personal AWS_REGION=us-east-1 ./deploy/aws/deploy.sh"
  exit 1
fi

ACCOUNT="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
echo "Deploying to account $ACCOUNT..."

KEY_PARAM=()
if [[ -n "${EC2_KEY_NAME:-}" ]]; then
  KEY_PARAM=(ParameterKey=KeyName,ParameterValue="$EC2_KEY_NAME")
fi

"${AWS[@]}" cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$ROOT/deploy/aws/stack.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "ProjectName=${STACK_NAME}" "${KEY_PARAM[@]}" \
  --no-fail-on-empty-changeset

UI_URL="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UiUrl'].OutputValue" --output text)"
RELAY_WS="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RelayWebSocketUrl'].OutputValue" --output text)"
RELAY_HEALTH="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RelayHealthUrl'].OutputValue" --output text)"
BUCKET="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UiBucketName'].OutputValue" --output text)"
DIST_ID="$("${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='UiDistributionId'].OutputValue" --output text)"

CONFIG="$ROOT/public/config.json"
cat >"$CONFIG" <<EOF
{
  "wsUrl": "$RELAY_WS",
  "healthUrl": "$RELAY_HEALTH"
}
EOF

echo "Uploading UI to s3://$BUCKET ..."
"${AWS[@]}" s3 sync "$ROOT/public/" "s3://$BUCKET/" --delete \
  --exclude ".DS_Store"

echo "Invalidating CloudFront cache..."
"${AWS[@]}" cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" >/dev/null

echo ""
echo "Done."
echo "  UI:     $UI_URL"
echo "  Relay:  $RELAY_WS"
echo "  Health: $RELAY_HEALTH"
echo ""
echo "Wait 2–5 minutes for CloudFront and the EC2 relay to finish booting, then open the UI URL."
