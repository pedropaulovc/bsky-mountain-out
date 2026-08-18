#!/usr/bin/env bash
set -euo pipefail

# Shared Application Insights query helpers. Authentication is delegated to the
# user's existing Azure CLI login; no bearer token is stored in this repository.
: "${APPLICATIONINSIGHTS_APP_ID:=${APPINSIGHTS_APP_ID:-${AI_APP_ID:-}}}"
readonly APPLICATIONINSIGHTS_APP_ID
AI_ROLE="bsky-mountain-out"
readonly AI_ROLE

if [[ -z "$APPLICATIONINSIGHTS_APP_ID" ]]; then
  printf 'error: APPLICATIONINSIGHTS_APP_ID (or APPINSIGHTS_APP_ID) is required\n' >&2
  exit 2
fi

ai_fail() {
  {
    printf '\nERROR: Application Insights is not reachable; refusing to continue.\n'
    printf '       Empty results can masquerade as a healthy bot.\n'
    printf '       app id: %s\n' "$APPLICATIONINSIGHTS_APP_ID"
    if [[ -n "${1:-}" ]]; then
      printf '\naz reported:\n%s\n' "$1"
    fi
    printf '\nLikely fixes:\n'
    printf '  - Log in to the correct Azure tenant: az login\n'
    printf '  - Verify the App Insights app id and subscription context.\n'
    printf '  - Install the CLI extension if needed: az extension add --name application-insights\n'
  } >&2
  exit 1
}

ai_query() {
  if [[ $# -lt 1 || $# -gt 2 || -z "$1" ]]; then
    printf 'usage: ai_query KQL [OFFSET]\n' >&2
    return 2
  fi
  command -v az >/dev/null 2>&1 || {
    printf 'error: Azure CLI (az) is required\n' >&2
    return 127
  }
  command -v jq >/dev/null 2>&1 || {
    printf 'error: jq is required\n' >&2
    return 127
  }

  local query="$1"
  local offset="${2:-30d}"
  local output error_file
  error_file="$(mktemp)"
  if output="$(az monitor app-insights query \
    --app "$APPLICATIONINSIGHTS_APP_ID" \
    --offset "$offset" \
    --analytics-query "$query" \
    --output json 2>"$error_file")" \
    && printf '%s' "$output" | jq -e '.tables | type == "array"' >/dev/null 2>&1; then
    rm -f "$error_file"
    printf '%s\n' "$output"
    return 0
  fi
  local details
  details="$(cat "$error_file" 2>/dev/null || true)"
  rm -f "$error_file"
  ai_fail "$details"
}

ai_role_filter() {
  if [[ ! "$AI_ROLE" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'error: AI_ROLE contains unsupported KQL characters\n' >&2
    return 2
  fi
  printf "cloud_RoleName == '%s'" "$AI_ROLE"
}

ai_rows() {
  if [[ $# -ne 1 ]]; then
    printf 'usage: ai_rows RESPONSE_JSON\n' >&2
    return 2
  fi
  jq -e -r '.tables[0] as $table | ($table.columns | map(.name)) as $names | $table.rows[]? | map(tostring) | @tsv' <<<"$1"
}
