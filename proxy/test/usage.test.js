const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDailyUsage } = require('../src/usage');

// In-memory stand-in for the Firestore calls the counter uses.
function fakeFirestore() {
  const docs = new Map();
  return {
    docs,
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}` }) }),
    runTransaction: async (work) => work({
      get: async (ref) => ({ exists: docs.has(ref.key), get: (field) => docs.get(ref.key)[field] }),
      set: (ref, value) => docs.set(ref.key, { ...(docs.get(ref.key) || {}), ...value }),
    }),
  };
}

test('allows calls up to the daily limit, then refuses until the next UTC day', async () => {
  const firestore = fakeFirestore();
  let clock = Date.parse('2026-11-26T23:59:00Z');
  const usage = makeDailyUsage({ firestore, dailyCallLimit: 2, now: () => clock });
  assert.equal(await usage.reserve(), true);
  assert.equal(await usage.reserve(), true);
  assert.equal(await usage.reserve(), false);
  assert.deepEqual(firestore.docs.get('proxyUsage/2026-11-26'), { calls: 2 });
  clock = Date.parse('2026-11-27T00:00:01Z');
  assert.equal(await usage.reserve(), true);
  assert.deepEqual(firestore.docs.get('proxyUsage/2026-11-27'), { calls: 1 });
});
