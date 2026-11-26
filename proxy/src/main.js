const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createServer } = require('./server');
const { makeGeminiClient } = require('./gemini');
const { makeDailyUsage } = require('./usage');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value.trim();
}

function log(severity, message, fields = {}) {
  process.stdout.write(JSON.stringify({ severity: severity.toUpperCase(), message, ...fields }) + '\n');
}

initializeApp({ projectId: requiredEnv('APP__FIREBASE__PROJECT_ID') });

const server = createServer({
  verifyToken: async (token) => (await getAuth().verifyIdToken(token)).uid,
  askGemini: makeGeminiClient({
    apiKey: requiredEnv('APP__GEMINI__API_KEY'),
    model: requiredEnv('APP__GEMINI__MODEL'),
    timeoutSeconds: Number(requiredEnv('APP__GEMINI__TIMEOUT_SECONDS')),
  }),
  dailyUsage: makeDailyUsage({
    firestore: getFirestore(),
    dailyCallLimit: Number(requiredEnv('APP__LIMITS__DAILY_CALLS')),
  }),
  allowedOrigins: requiredEnv('APP__CORS__ORIGINS').split(','),
  minIntervalSeconds: Number(requiredEnv('APP__LIMITS__MIN_INTERVAL_SECONDS')),
  log,
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => log('info', 'listening', { port }));
