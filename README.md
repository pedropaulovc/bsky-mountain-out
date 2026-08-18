# Is Mt Rainier Out?

A Cloudflare Worker that checks the Space Needle PanoCam and posts to Bluesky when Mount Rainier changes visibility. The bot is inspired by [@IsMtRainierOut](https://x.com/ismtrainierout); it is an independent implementation for Bluesky.

## What it does

Every 20 minutes during approximately 06:00–21:30 Pacific time, the Worker:

1. Probes the Space Needle PanoCam CDN for the newest available frame.
2. Builds an attributed JPEG focused on the Seattle skyline and Mount Rainier.
3. Classifies the image with Workers AI.
4. Requires two consecutive high-confidence checks before posting a visibility transition.
5. Posts an occasional “still not visible” update every three days in a randomly selected dramatic-light window.
6. Logs structured tick, frame, classifier, decision, CPU-timing, and post-URI fields.

Each image includes a visible source credit. Each Bluesky post includes descriptive alt text: the scene, an explicit Rainier visibility statement, and the PanoCam timestamp.

## Architecture

- **Runtime:** Cloudflare Workers cron
- **Vision:** Workers AI, configurable with `MODEL_ID` (default `@cf/moondream/moondream3.1-9B-A2B`)
- **State:** Workers KV
- **Image source:** Space Needle PanoCam CDN (`spaceneedle.com/webcam`)
- **Posting:** three direct AT Protocol XRPC requests to `BSKY_SERVICE_URL` (production uses `https://ismtrainierout.selfhosted.social`); no Bluesky SDK
- **Telemetry:** Cloudflare Workers Observability export to the existing `azure-appi-logs` and `azure-appi-traces` destinations, then Application Insights
- **Alerts:** Azure action group, error query alert, and a daylight heartbeat dead-man switch

`data.json` is intentionally not fetched by the Worker: it is a multi-megabyte historical index. Latest-frame discovery probes the cached `share.jpg` asset URL backwards in ten-minute Pacific increments.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with the bot handle and Bluesky app password.
npm test
npm run check
npm run dev
```

The checked-in KV IDs are placeholders. Replace them with a namespace created for this Worker before deployment:

```sh
npx wrangler kv namespace create STATE
```

Then set the returned production and preview IDs in `wrangler.jsonc`.

Development routes require `Authorization: Bearer $DEV_TOKEN`; do not put the token in a URL:

```sh
curl -H "Authorization: Bearer $DEV_TOKEN" http://localhost:8787/status
curl -H "Authorization: Bearer $DEV_TOKEN" "http://localhost:8787/check?raw=1"
```

- `GET /status` — current KV state
- `GET /check` — dry-run frame, image, classifier, and decision pipeline
- `GET /check?raw=1` — returns the generated JPEG for crop/watermark review
- `GET /check?raw=1&refs=1` — returns the classifier contact sheet with target and reference tiles
- `GET /check?post=1` — explicitly permits a real post when `POSTING_ENABLED=true`

Keep `POSTING_ENABLED=false` while observing the first deployment. Set it to `true` only after verifying classifier decisions, CPU time, image attribution, and alt text.

## Image modes

`IMAGE_MODE=stitched` is the normal mode. It fetches slices 8–11 and creates a readable skyline crop. `raw-slice` fetches slice 9 and is the lower-CPU fallback. `raw-slice-unwatermarked` is an emergency diagnostic mode only and violates the normal attribution requirement; do not use it for public posts.

Measure actual Worker CPU time after deployment. If the free plan cannot run the stitched path, switch to `raw-slice` or upgrade the Worker to the Paid plan.

## Classifier evaluation

The classifier is the main risk because Rainier is a small horizon feature and vision models may rely on Seattle priors. Add reviewed archive examples to `scripts/labels.json`, then run:

```sh
CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run eval -- --models @cf/moondream/moondream3.1-9B-A2B
```

The evaluator reports per-model accuracy, confusion, precision, and recall. Do not deploy a model until clear, hazy, dawn/dusk, and no-mountain examples meet the desired accuracy threshold.
Production classification uses `CLASSIFIER_REFERENCE_URLS`, a comma-separated list of public PanoCam images. The Worker builds a labeled contact sheet with `TARGET` plus up to four `REFERENCE` tiles because Moondream accepts one image input. The original target artifact remains unchanged for Bluesky posting. Remove the variable or set it empty to disable references if CPU or memory is too high.

## Telemetry and alerts

The observability destinations named in `wrangler.jsonc` are account-level resources. Verify or create them before deployment with the same telemetry gateway used by the mirror workers:

```sh
DRY_RUN=true CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
GATEWAY_INGEST_BEARER=... ./scripts/provision-observability.sh
```

Run without `DRY_RUN=true` after reviewing the destination names and gateway URL. Workers Observability export and reliable external alerting may require the Cloudflare Paid plan; verify the current account limits before deployment.

The diagnostic scripts query only this Worker role:

```sh
./scripts/ai-logs.sh 6
./scripts/ai-errors.sh 24
```

Configure Azure CLI credentials and run the alert provisioner with an explicit recipient:

```sh
ALERT_EMAIL=pedro@vezza.com.br ./scripts/provision-alerts.sh
```

It creates or updates the email action group and scheduled-query rules. The dead-man switch is aligned to the UTC cron schedule and filters for successful `heartbeat` events during the Pacific daylight window. Application Insights delivery can lag, so tune the alert evaluation window before enabling paging.

## Production Wrangler access

If production access is missing or the named profile needs refreshed scopes, run:

```sh
npx wrangler auth create twitter-mirror-vza-net-prod \
  --browser \
  --scopes account:read user:read workers:write workers_kv:write secrets_store:write workers_scripts:write
```

Then deploy with:

```sh
npx wrangler deploy --profile twitter-mirror-vza-net-prod
```

## Secrets

Never commit credentials. Upload them with Wrangler:

```sh
npx wrangler secret put BSKY_IDENTIFIER
npx wrangler secret put BSKY_APP_PASSWORD
```

The bot account should use an app password, not the primary Bluesky password. The account bio should credit `@IsMtRainierOut` as inspiration and the Space Needle PanoCam as the image source.

## Credits and rights

- Camera frames: [Space Needle webcam](https://www.spaceneedle.com/webcam)
- Inspiration: [@IsMtRainierOut](https://x.com/ismtrainierout)

This project does not copy the original service's watermarked timelapse images. It uses the Space Needle PanoCam CDN directly and stamps every normal output with source, timestamp, and bot attribution.
