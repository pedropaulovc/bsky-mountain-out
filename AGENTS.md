# bsky-mountain-out operational notes

## Production Cloudflare resources

- Repository: `/home/pedro/src/bsky-mountain-out`.
- Worker: `bsky-mountain-out`.
- Public Worker URL: `https://bsky-mountain-out.twitter-mirror-vza-net-prod.workers.dev`.
- Wrangler profile: `twitter-mirror-vza-net-prod`.
- Cloudflare account ID: `311e8b818f9ee28bad6766f04d52de2c`.
- Source configuration: `wrangler.jsonc`.
- Cron: `*/20 * * * *`.
- Production KV namespace `STATE`: `b2f07d5ca4724fdcaa6a82e78a99148f`.
- Preview KV namespace: `8817542bf88d49558da7cc79983fd758`.
- Worker state key: `bot-state`.

Read production state without invoking the classifier or mutating state:

```sh
npx wrangler kv key get bot-state \
  --namespace-id b2f07d5ca4724fdcaa6a82e78a99148f \
  --remote --text --profile twitter-mirror-vza-net-prod
```

The authenticated status endpoint is `/status`. `.env.local` is ignored; load it without printing its values:

```sh
set -a; . .env.local; set +a
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${DEV_TOKEN}" \
  https://bsky-mountain-out.twitter-mirror-vza-net-prod.workers.dev/status
```

Inspect deployments and versions:

```sh
npx wrangler deployments list --profile twitter-mirror-vza-net-prod
npx wrangler deployments status --profile twitter-mirror-vza-net-prod
npx wrangler versions view VERSION_ID --profile twitter-mirror-vza-net-prod
```

Production Worker secrets are `BSKY_IDENTIFIER`, `BSKY_APP_PASSWORD`, `OPENAI_API_KEY`, and `DEV_TOKEN`. Use `npx wrangler secret list --profile twitter-mirror-vza-net-prod` for names only; never print secret values. `BSKY_SERVICE_URL` (`https://ismtrainierout.selfhosted.social`) is the Bluesky service/PDS, not the Worker URL.

## 1Password credentials

`.env.local` contains `OP_SERVICE_ACCOUNT_TOKEN`. Never commit, echo, paste, or document its value. It is ignored by `.gitignore`.

Load the token only into the current shell:

```sh
set -a; . .env.local; set +a
```

The production Bluesky Login item is in vault `twitter-mirror-backup`, titled `ismtrainierout.selfhosted.social`. Fetch fields into variables with `op read`; do not run `op read` bare because it writes the secret to stdout:

```sh
bsky_identifier="$(op read 'op://twitter-mirror-backup/ismtrainierout.selfhosted.social/username')"
bsky_app_password="$(op read 'op://twitter-mirror-backup/ismtrainierout.selfhosted.social/password')"
```

Use the variables directly with clients or test processes. Do not log them, put them in command-line arguments or URLs, commit them, or place them in shell history. Service-account `op item get` commands require `--vault twitter-mirror-backup`.

## Azure Application Insights telemetry

- Azure subscription: `Pay-As-You-Go Dev/Test` (`07aba226-fd59-489a-b07b-4158fef12a5d`).
- Application Insights: `appi-twitter-mirror`.
- Resource group: `rg-twitter-mirror-obs`.
- App ID: `fe8c1549-5202-44af-a5cb-2f5795163916`.
- Resource ID: `/subscriptions/07aba226-fd59-489a-b07b-4158fef12a5d/resourceGroups/rg-twitter-mirror-obs/providers/Microsoft.Insights/components/appi-twitter-mirror`.
- Cloudflare Workers Observability destinations: `azure-appi-logs` and `azure-appi-traces`.
- Default telemetry gateway: `https://mirror-telemetry-gateway.twitter-mirror-vza-net-prod.workers.dev/v1`.

Use the existing Azure CLI login and the checked-in query scripts:

```sh
az login
az account set --subscription 07aba226-fd59-489a-b07b-4158fef12a5d

APPLICATIONINSIGHTS_APP_ID=fe8c1549-5202-44af-a5cb-2f5795163916 \
  ./scripts/ai-logs.sh 24
APPLICATIONINSIGHTS_APP_ID=fe8c1549-5202-44af-a5cb-2f5795163916 \
  ./scripts/ai-errors.sh 24
```

Both scripts accept a lookback from 1 to 720 hours and restrict queries to `cloud_RoleName == 'bsky-mountain-out'`. `ai-logs.sh` queries traces, requests, dependencies, and custom events. `ai-errors.sh` queries exceptions, traces, and requests, selecting exceptions, severity >= 3, or failed requests. The scripts require `APPLICATIONINSIGHTS_APP_ID` (aliases `APPINSIGHTS_APP_ID` and `AI_APP_ID` also work), `az`, and `jq`; they fail on unreachable telemetry instead of treating empty output as health.

Alert provisioning uses the same Application Insights resource. Dry-run before any change:

```sh
AZURE_SUBSCRIPTION_ID=07aba226-fd59-489a-b07b-4158fef12a5d \
AZURE_RESOURCE_GROUP=rg-twitter-mirror-obs \
APPINSIGHTS_RESOURCE_ID=/subscriptions/07aba226-fd59-489a-b07b-4158fef12a5d/resourceGroups/rg-twitter-mirror-obs/providers/Microsoft.Insights/components/appi-twitter-mirror \
ALERT_EMAIL=pedro@vezza.com.br \
DRY_RUN=true ./scripts/provision-alerts.sh
```
