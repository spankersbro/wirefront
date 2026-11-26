# Gemini tactics proxy (WF-24)

Asks Gemini for enemy tank tactics. The game never sees the Gemini key; it sends a short fight
summary here with the player's Firebase anonymous ID token, and gets back one tactic per tank.

Limits, from WF-7: at most one call per player every 4 s, and 900 calls per UTC day across all
players (counted in Firestore `proxyUsage/<day>`, so restarts do not reset it). Above either limit,
or when Gemini fails, the answer is `{ "source": "scripted" }` and the game keeps its own AI.

Tests: `npm test` (no network: Gemini, sign-in and Firestore are faked).

## Configuration

| Variable | Example |
| --- | --- |
| `APP__FIREBASE__PROJECT_ID` | `wirefront-49636` |
| `APP__GEMINI__API_KEY` | from Secret Manager `gemini-api-key` |
| `APP__GEMINI__MODEL` | `gemini-3.1-flash-lite` |
| `APP__GEMINI__TIMEOUT_SECONDS` | `4` |
| `APP__LIMITS__DAILY_CALLS` | `900` |
| `APP__LIMITS__MIN_INTERVAL_SECONDS` | `4` |
| `APP__CORS__ORIGINS` | `https://wirefront.davidirving.dev` (comma-separated) |

## Deploy

One-time setup: a service account that can read the key and the Firestore counter, and nothing else.

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
  --source proxy --allow-unauthenticated --max-instances 1 --concurrency 20 --memory 256Mi \
  --service-account wirefront-gemini-proxy@wirefront-49636.iam.gserviceaccount.com \
  --set-secrets APP__GEMINI__API_KEY=gemini-api-key:latest \
  --set-env-vars APP__FIREBASE__PROJECT_ID=wirefront-49636,APP__GEMINI__MODEL=gemini-3.1-flash-lite,APP__GEMINI__TIMEOUT_SECONDS=4,APP__LIMITS__DAILY_CALLS=900,APP__LIMITS__MIN_INTERVAL_SECONDS=4,APP__CORS__ORIGINS=https://wirefront.davidirving.dev
```
