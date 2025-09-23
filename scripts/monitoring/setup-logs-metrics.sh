#!/usr/bin/env bash
set -euo pipefail

# Creates basic logs-based metrics and a sample dashboard for SmartMeet.
# Prereqs: gcloud CLI authenticated; Monitoring API enabled.

PROJECT_ID=${1:-$(gcloud config get-value project)}
if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <PROJECT_ID>" >&2
  exit 1
fi

create_metric() {
  local NAME=$1
  local FILTER=$2
  echo "Creating logs-based metric: ${NAME}"
  gcloud logging metrics create "${NAME}" \
    --project="${PROJECT_ID}" \
    --description="SmartMeet logs-based counter: ${NAME}" \
    --log-filter="${FILTER}" || true
}

# Metrics based on our structured metric logs (jsonPayload.type="metric")
create_metric "event_gmail_push"     'jsonPayload.type="metric" AND jsonPayload.entry.name="event_gmail_push"'
create_metric "event_calendar_watch" 'jsonPayload.type="metric" AND jsonPayload.entry.name="event_calendar_watch"'
create_metric "task_success"         'jsonPayload.type="metric" AND jsonPayload.entry.name="task_success"'
create_metric "task_failure"         'jsonPayload.type="metric" AND jsonPayload.entry.name="task_failure"'
create_metric "suggestion_pending"   'jsonPayload.type="metric" AND jsonPayload.entry.name="suggestion_pending"'
create_metric "suggestion_auto_sent" 'jsonPayload.type="metric" AND jsonPayload.entry.name="suggestion_auto_sent"'
create_metric "meeting_created"      'jsonPayload.type="metric" AND jsonPayload.entry.name="meeting_created"'

echo "Creating dashboard"
gcloud monitoring dashboards create \
  --project="${PROJECT_ID}" \
  --config-from-file="$(dirname "$0")/smartmeet-dashboard.json" || true

echo "Creating alert policy (task_failure spikes)"
gcloud alpha monitoring policies create \
  --project="${PROJECT_ID}" \
  --policy-from-file="$(dirname "$0")/alert-task-failure.json" || true

echo "Done."

