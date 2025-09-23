#!/usr/bin/env bash
set -euo pipefail

# SmartMeet backend deploy script (Cloud Run)
# - Builds and deploys backend to Cloud Run
# - Updates environment variables from backend/env.json (overrides BACKEND_BASE_URL/WEBHOOK_BASE_URL with actual Run URL)
# - Creates Pub/Sub topic + push subscription for Gmail Push
# Requirements: gcloud CLI authenticated; roles to deploy Cloud Run and manage Pub/Sub; Python 3 installed.

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/backend/env.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env.json not found at $ENV_FILE" >&2
  exit 1
fi

json_get() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import json,sys
with open(sys.argv[1]) as f:
    d=json.load(f)
print(str(d.get(sys.argv[2], '')))
PY
}

PROJECT=$(json_get GOOGLE_CLOUD_PROJECT_ID)
REGION=${REGION:-asia-northeast1}
SERVICE=${SERVICE:-smartmeet-backend}
TOPIC_NAME=${TOPIC_NAME:-agent-gmail}
TAG=$(date +%Y%m%d-%H%M%S)

if [[ -z "$PROJECT" ]]; then
  echo "GOOGLE_CLOUD_PROJECT_ID is empty in env.json" >&2
  exit 1
fi

echo "==> Setting gcloud defaults"
gcloud config set project "$PROJECT" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

echo "==> Enabling required services (idempotent)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com pubsub.googleapis.com iam.googleapis.com --project="$PROJECT" >/dev/null

echo "==> Building container image via Cloud Build"
gcloud builds submit "$ROOT_DIR/backend" --tag "gcr.io/$PROJECT/$SERVICE:$TAG"

echo "==> Deploying to Cloud Run"
gcloud run deploy "$SERVICE" \
  --image "gcr.io/$PROJECT/$SERVICE:$TAG" \
  --region "$REGION" \
  --allow-unauthenticated \
  --project "$PROJECT"

RUN_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.address.url)')
RUN_SA=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(template.spec.serviceAccountName)')

if [[ -z "$RUN_URL" || -z "$RUN_SA" ]]; then
  echo "Failed to resolve Cloud Run URL or Service Account" >&2
  exit 1
fi

echo "==> Cloud Run URL: $RUN_URL"
echo "==> Cloud Run SA : $RUN_SA"

echo "==> Preparing environment variables from env.json"
SET_VARS=$(python3 - "$ENV_FILE" "$RUN_URL" <<'PY'
import json,sys
env_path, run_url = sys.argv[1], sys.argv[2]
with open(env_path) as f:
    data = json.load(f)
data['BACKEND_BASE_URL'] = run_url
data['WEBHOOK_BASE_URL'] = run_url
data['GOOGLE_REDIRECT_URI'] = run_url.rstrip('/') + '/auth/callback'
def kv(k,v):
    return f"{k}={str(v).replace(',', '\\,')}"
pairs = []
for k,v in data.items():
    if v is None or isinstance(v,(dict,list)):
        continue
    if k == 'PORT':
        continue
    pairs.append(kv(k,v))
print(",".join(pairs))
PY
)

echo "==> Updating Cloud Run environment"
gcloud run services update "$SERVICE" --region="$REGION" --set-env-vars "$SET_VARS"

echo "==> Creating Pub/Sub topic (idempotent)"
gcloud pubsub topics create "$TOPIC_NAME" --project="$PROJECT" 2>/dev/null || true
echo "==> Granting gmail system publisher to topic"
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --project="$PROJECT" \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher 1>/dev/null || true

echo "==> Creating push subscription to Gmail webhook (idempotent)"
SUB_NAME=gmail-push-subscription
gcloud pubsub subscriptions create "$SUB_NAME" \
  --project="$PROJECT" \
  --topic="$TOPIC_NAME" \
  --push-endpoint="$RUN_URL/webhooks/gmail-push" \
  --push-auth-service-account="$RUN_SA" \
  --ack-deadline=10 1>/dev/null || true

echo
echo "Deployment completed. Next steps:"
echo "1) Start watches (once):"
echo "   curl -s -X POST \"$RUN_URL/api/admin/watch/start\""
echo "2) Complete OAuth (once): open in browser:"
echo "   $RUN_URL/auth/login"
echo "3) Verify readiness:"
echo "   curl -s \"$RUN_URL/health\""
echo "4) (Optional) Create weekly report:"
echo "   curl -s -X POST \"$RUN_URL/api/reports/weekly\" -H 'Content-Type: application/json' -d '{"days":7}'"
