const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDailyUsage } = require('../src/usage');

// In-memory stand-in for the Firestore calls the counter uses; counts reads.
function fakeFirestore() {
  const docs = new Map();
  const stats = { reads: 0 };
  const snapshot = (key) => ({ exists: docs.has(key), get: (field) => docs.get(key)[field], data: () => ({ ...docs.get(key) }) });
  return {
    docs,
    stats,
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}`, get: async () => { stats.reads += 1; return snapshot(`${name}/${id}`); } }) }),
    runTransaction: async (work) => work({
      get: async (ref) => { stats.reads += 1; return snapshot(ref.key); },
      set: (ref, value) => docs.set(ref.key, value),
    }),
  };
}

const PRICES = { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 1.5 };

test('spend is priced from input, output and thinking tokens', async () => {
  const firestore = fakeFirestore();
  const usage = makeDailyUsage({ firestore, dailyBudgetUsd: 1, ...PRICES, now: () => Date.parse('2026-11-26T12:00:00Z') });
  // 400 in = $0.0001; 60 out + 40 thinking = 100 at $1.50/M = $0.00015.
  const usd = await usage.record({ promptTokenCount: 400, candidatesTokenCount: 60, thoughtsTokenCount: 40 });
  assert.equal(Math.round(usd * 1e7), 2500);
  await usage.record({ promptTokenCount: 400, candidatesTokenCount: 60, thoughtsTokenCount: 40 });
  const day = firestore.docs.get('proxyUsage/2026-11-26');
  assert.equal(day.calls, 2);
  assert.equal(Math.round(day.usd * 1e7), 5000);
});

test('no budget once today\'s spend reaches the limit; the next UTC day starts fresh', async () => {
  const firestore = fakeFirestore();
  let clock = Date.parse('2026-11-26T23:59:00Z');
  const usage = makeDailyUsage({ firestore, dailyBudgetUsd: 0.0005, ...PRICES, now: () => clock });
  assert.equal(await usage.hasBudget(), true);
  await usage.record({ promptTokenCount: 2000 }); // $0.0005
  assert.equal(await usage.hasBudget(), false);
  clock = Date.parse('2026-11-27T00:00:01Z');
  assert.equal(await usage.hasBudget(), true);
});

test('once a day is used up, further checks do not read Firestore', async () => {
  const firestore = fakeFirestore();
  const usage = makeDailyUsage({ firestore, dailyBudgetUsd: 0.0001, ...PRICES, now: () => Date.parse('2026-11-26T12:00:00Z') });
  await usage.record({ promptTokenCount: 400 });
  assert.equal(await usage.hasBudget(), false);
  const reads = firestore.stats.reads;
  for (let i = 0; i < 5; i++) assert.equal(await usage.hasBudget(), false);
  assert.equal(firestore.stats.reads, reads);
});
