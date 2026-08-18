#!/usr/bin/env bash
set -euo pipefail

# Ensure the account-level Workers Observability destinations referenced by
# wrangler.jsonc exist before deploying this worker.
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${GATEWAY_INGEST_BEARER:?GATEWAY_INGEST_BEARER is required}"
: "${TELEMETRY_GATEWAY_URL:=https://mirror-telemetry-gateway.twitter-mirror-vza-net-prod.workers.dev/v1}"
: "${DRY_RUN:=false}"

case "$DRY_RUN" in
  true|TRUE|1|yes|YES) dry_run=true ;;
  false|FALSE|0|no|NO) dry_run=false ;;
  *) printf 'error: DRY_RUN must be true or false\n' >&2; exit 2 ;;
esac

command -v curl >/dev/null 2>&1 || { printf 'error: curl is required\n' >&2; exit 127; }
command -v jq >/dev/null 2>&1 || { printf 'error: jq is required\n' >&2; exit 127; }

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/observability/destinations"
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

auth_file="$tmp_dir/cloudflare-auth"
gateway_file="$tmp_dir/gateway-bearer"
printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN" >"$auth_file"
printf '%s\n' "$GATEWAY_INGEST_BEARER" >"$gateway_file"
chmod 600 "$auth_file" "$gateway_file"

destinations=''
if [[ "$dry_run" == false ]]; then
  destinations="$(curl --fail-with-body --silent --show-error \
    --connect-timeout 10 --max-time 60 \
    "$api" -H "@$auth_file")"
  printf '%s' "$destinations" | jq -e '.success == true and (.result | type == "array")' >/dev/null || {
    printf 'error: Cloudflare returned an invalid observability destination list\n' >&2
    exit 1
  }
fi

for dataset in opentelemetry-logs opentelemetry-traces; do
  suffix="${dataset##*-}"
  name="azure-appi-${suffix}"
  if [[ "$dry_run" == false ]] && jq -e --arg name "$name" '.result[] | select(.name == $name)' <<<"$destinations" >/dev/null; then
    printf 'destination %s already exists\n' "$name"
    continue
  fi

  payload_file="$tmp_dir/${suffix}-payload"
  jq -n \
    --arg name "$name" \
    --arg dataset "$dataset" \
    --arg url "${TELEMETRY_GATEWAY_URL%/}/${suffix}" \
    --rawfile bearer "$gateway_file" \
    '{name:$name,enabled:true,configuration:{type:"logpush",logpushDataset:$dataset,url:$url,headers:{Authorization:("Bearer " + ($bearer | rtrimstr("\n")))}}}' \
    >"$payload_file"
  chmod 600 "$payload_file"

  if [[ "$dry_run" == true ]]; then
    printf 'DRY-RUN: create %s dataset=%s url=%s\n' "$name" "$dataset" "${TELEMETRY_GATEWAY_URL%/}/${suffix}"
    continue
  fi

  response="$(curl --fail-with-body --silent --show-error \
    --connect-timeout 10 --max-time 60 \
    -X POST "$api" \
    -H "@$auth_file" \
    -H 'Content-Type: application/json' \
    --data-binary "@$payload_file")"
  printf '%s' "$response" | jq -e '.success == true' >/dev/null || {
    printf 'error: failed to create observability destination %s\n' "$name" >&2
    exit 1
  }
  printf 'created destination %s\n' "$name"
done
