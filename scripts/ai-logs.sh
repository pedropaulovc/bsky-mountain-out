#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ai-lib.sh
source "${SCRIPT_DIR}/ai-lib.sh"

hours="${1:-24}"
if [[ ! "$hours" =~ ^[0-9]+$ || "$hours" -lt 1 || "$hours" -gt 720 ]]; then
  printf 'usage: %s [hours: 1-720]\n' "$0" >&2
  exit 2
fi
# Every query is restricted to cloud_RoleName == 'bsky-mountain-out'.
role_filter="$(ai_role_filter)"
query="union isfuzzy=true traces, requests, dependencies, customEvents
| where timestamp >= ago(${hours}h)
| where ${role_filter}
| project timestamp, itemType, name, message, resultCode, success, operation_Id
| order by timestamp desc"

ai_query "$query" "${hours}h"
