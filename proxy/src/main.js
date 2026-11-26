const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createServer } = require('./server');
const { makeGeminiClient } = require('./gemini');
const { makeDailyUsage } = require('./usage');
const config = require('./config');

const requiredEnv = (name) => config.requiredEnv(process.env, name);
const positiveNumberEnv = (name) => config.positiveNumberEnv(process.env, name);

function log(severity, message, fields = {}) {
  process.stdout.write(JSON.stringify({ severity: severity.toUpperCase(), message, ...fields }) + '\n');
}

initializeApp({ projectId: requiredEnv('APP__FIREBASE__PROJECT_ID') });

const server = createServer({
  verifyToken: async (token) => (await getAuth().verifyIdToken(token)).uid,
  askGemini: makeGeminiClient({
    apiKey: requiredEnv('APP__GEMINI__API_KEY'),
    model: requiredEnv('APP__GEMINI__MODEL'),
    timeoutSeconds: positiveNumberEnv('APP__GEMINI__TIMEOUT_SECONDS'),
  }),
  dailyUsage: makeDailyUsage({
    firestore: getFirestore(),
    dailyBudgetUsd: positiveNumberEnv('APP__LIMITS__DAILY_BUDGET_USD'),
    inputUsdPerMillionTokens: positiveNumberEnv('APP__GEMINI__INPUT_USD_PER_MILLION_TOKENS'),
    outputUsdPerMillionTokens: positiveNumberEnv('APP__GEMINI__OUTPUT_USD_PER_MILLION_TOKENS'),
  }),
  allowedOrigins: requiredEnv('APP__CORS__ORIGINS').split(',').map((origin) => origin.trim()),
  minIntervalSeconds: positiveNumberEnv('APP__LIMITS__MIN_INTERVAL_SECONDS'),
  callsPerPlayerPerDay: positiveNumberEnv('APP__LIMITS__CALLS_PER_PLAYER_PER_DAY'),
  log,
});

// Slow or stalled uploads must not hold the few concurrency slots.
server.requestTimeout = 10000;
server.headersTimeout = 10000;

const port = Number(process.env.PORT || 8080);
server.listen(port, () => log('info', 'listening', { port }));
