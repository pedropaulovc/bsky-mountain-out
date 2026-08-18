#!/usr/bin/env bash
set -euo pipefail

# Provision the App Insights action group and two scheduled-query alerts for
# this worker. Set DRY_RUN=true to print the exact Azure CLI commands without
# invoking az (useful for review and CI plans).
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${APPINSIGHTS_RESOURCE_ID:?APPINSIGHTS_RESOURCE_ID is required}"
: "${ALERT_EMAIL:=pedro@vezza.com.br}"
: "${ACTION_GROUP_NAME:=bsky-mountain-out-alerts}"
: "${ACTION_GROUP_SHORT_NAME:=bskybot}"
: "${ERROR_ALERT_NAME:=bsky-mountain-out-errors}"
: "${HEARTBEAT_ALERT_NAME:=bsky-mountain-out-daylight-heartbeat}"
: "${AZURE_LOCATION:=global}"
: "${HEARTBEAT_WINDOW_MINUTES:=120}"
: "${DRY_RUN:=false}"

if [[ ! "$HEARTBEAT_WINDOW_MINUTES" =~ ^[0-9]+$ || "$HEARTBEAT_WINDOW_MINUTES" -lt 20 || "$HEARTBEAT_WINDOW_MINUTES" -gt 1440 ]]; then
  printf 'error: HEARTBEAT_WINDOW_MINUTES must be an integer from 20 to 1440\n' >&2
  exit 2
fi
case "$DRY_RUN" in
  true|TRUE|1|yes|YES) dry_run=true ;;
  false|FALSE|0|no|NO) dry_run=false ;;
  *) printf 'error: DRY_RUN must be true or false\n' >&2; exit 2 ;;
esac

if [[ "$dry_run" == false ]]; then
  command -v az >/dev/null 2>&1 || {
    printf 'error: Azure CLI (az) is required unless DRY_RUN=true\n' >&2
    exit 127
  }
fi

run_az() {
  local -a command=("$@")
  if [[ "$dry_run" == true ]]; then
    printf 'DRY-RUN:'
    printf ' %q' "${command[@]}"
    printf '\n'
  else
    "${command[@]}"
  fi
}

# The action-group resource ID is deterministic, so dry runs can render the
# same command graph as real runs without querying Azure.
action_group_id="/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.Insights/actionGroups/${ACTION_GROUP_NAME}"

run_az az account set --subscription "$AZURE_SUBSCRIPTION_ID"
run_az az monitor action-group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$ACTION_GROUP_NAME" \
  --short-name "$ACTION_GROUP_SHORT_NAME" \
  --action email "name=owner" "emailAddress=${ALERT_EMAIL}"

# Keep the role predicate in every query. Double quotes around the role avoid
# colliding with the single quotes used by az's count condition syntax.
error_query="union isfuzzy=true exceptions, traces, requests
| where timestamp > ago(30m)
| where cloud_RoleName == \"bsky-mountain-out\"
| where itemType == \"exception\" or severityLevel >= 3 or success == false
| project timestamp, itemType, type, outerMessage, message, severityLevel, resultCode, operation_Id"
error_condition="count '${error_query}' > 0"

run_az az monitor scheduled-query create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  --name "$ERROR_ALERT_NAME" \
  --scopes "$APPINSIGHTS_RESOURCE_ID" \
  --description "bsky-mountain-out role has an exception, failed request, or error trace" \
  --condition "$error_condition" \
  --evaluation-frequency 5m \
  --window-size 30m \
  --severity 2 \
  --action "$action_group_id" \
  --enabled true \
  --skip-query-validation

heartbeat_query="let pacificNow = datetime_utc_to_local(now(), \"US/Pacific\");
let pacificMinutes = datetime_part(\"Hour\", pacificNow) * 60 + datetime_part(\"Minute\", pacificNow);
let daylight = pacificMinutes >= 360 and pacificMinutes <= 1290;
union isfuzzy=true traces, customEvents
| where cloud_RoleName == \"bsky-mountain-out\"
| where timestamp > ago(${HEARTBEAT_WINDOW_MINUTES}m)
| where message has \"heartbeat\" or name == \"heartbeat\"
| summarize HeartbeatCount = count()
| where daylight and HeartbeatCount == 0"
heartbeat_condition="count '${heartbeat_query}' > 0"

run_az az monitor scheduled-query create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  --name "$HEARTBEAT_ALERT_NAME" \
  --scopes "$APPINSIGHTS_RESOURCE_ID" \
  --description "dead-man alert when bsky-mountain-out stops heartbeating during the daylight window" \
  --condition "$heartbeat_condition" \
  --evaluation-frequency 20m \
  --window-size "${HEARTBEAT_WINDOW_MINUTES}m" \
  --severity 1 \
  --action "$action_group_id" \
  --enabled true \
  --skip-query-validation
