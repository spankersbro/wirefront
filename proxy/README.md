# Gemini tactics proxy (WF-24)

Asks Gemini for enemy tank tactics. The game never sees the Gemini key; it sends a short fight
summary here with the player's Firebase anonymous ID token, and gets back one tactic per tank.

Limits (WF-7, €5/month):
- at most one call per player every 4 s, and 180 calls per player per UTC day;
- a daily spend budget across all players, $0.18 (about €5 a month). Spend is estimated from the
  token counts Gemini reports, thinking tokens included, and stored in Firestore `proxyUsage/<day>`,
  so restarts do not reset it.

Above any limit, or when Gemini fails, the answer is `{ "source": "scripted" }` and the game keeps
its own AI.

Not capped by this service: Cloud Run request charges for refused requests (after 2M free requests a
month, $0.40 per million). `--max-instances 1` caps instance time. A budget-triggered shutdown is
WF-26.

Tests: `npm test` (no network: Gemini, sign-in and Firestore are faked).

## Configuration

| Variable | Example |
| --- | --- |
| `APP__FIREBASE__PROJECT_ID` | `wirefront-49636` |
| `APP__GEMINI__API_KEY` | from Secret Manager `gemini-api-key` |
| `APP__GEMINI__MODEL` | `gemini-3.1-flash-lite` |
| `APP__GEMINI__TIMEOUT_SECONDS` | `4` |
| `APP__GEMINI__INPUT_USD_PER_MILLION_TOKENS` | `0.25` (list price, check when changing model) |
| `APP__GEMINI__OUTPUT_USD_PER_MILLION_TOKENS` | `1.50` (includes thinking tokens) |
| `APP__LIMITS__DAILY_BUDGET_USD` | `0.18` |
| `APP__LIMITS__CALLS_PER_PLAYER_PER_DAY` | `180` |
| `APP__LIMITS__MIN_INTERVAL_SECONDS` | `4` |
| `APP__CORS__ORIGINS` | `https://wirefront.davidirving.dev` (comma-separated) |

## Deploy

The Gemini key (`wirefront-gemini`) is restricted to the Generative Language API.

One-time setup: a service account that can read the key and use Firestore. Note that
`roles/datastore.user` covers all of Firestore, not only the counter.

```
gcloud iam service-accounts create wirefront-gemini-proxy --project wirefront-49636
gcloud secrets add-iam-policy-binding gemini-api-key --project wirefront-49636 \
  --member serviceAccount:wirefront-gemini-proxy@wirefront-49636.iam.gserviceaccount.com \
  --role roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding wirefront-49636 \
  --member serviceAccount:wirefront-gemini-proxy@wirefront-49636.iam.gserviceaccount.com \
  --role roles/datastore.user
```

Deploy from the repo root. The service is public on purpose: callers prove who they are with a
Firebase ID token, which the app checks.

```
gcloud run deploy wirefront-gemini-proxy --project wirefront-49636 --region europe-west1 \
  --source proxy --allow-unauthenticated --max-instances 1 --concurrency 20 --memory 256Mi --timeout 10 \
  --service-account wirefront-gemini-proxy@wirefront-49636.iam.gserviceaccount.com \
  --set-secrets APP__GEMINI__API_KEY=gemini-api-key:latest \
  --set-env-vars APP__FIREBASE__PROJECT_ID=wirefront-49636,APP__GEMINI__MODEL=gemini-3.1-flash-lite,APP__GEMINI__TIMEOUT_SECONDS=4,APP__GEMINI__INPUT_USD_PER_MILLION_TOKENS=0.25,APP__GEMINI__OUTPUT_USD_PER_MILLION_TOKENS=1.50,APP__LIMITS__DAILY_BUDGET_USD=0.18,APP__LIMITS__CALLS_PER_PLAYER_PER_DAY=180,APP__LIMITS__MIN_INTERVAL_SECONDS=4,APP__CORS__ORIGINS=https://wirefront.davidirving.dev
```
