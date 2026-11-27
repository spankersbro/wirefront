// WF-18: leaderboard initials. Runs against the Firestore emulator via `npm run test:rules`.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, addDoc, doc, getDoc, setDoc } = require('firebase/firestore');

const ROOT = path.join(__dirname, '..', '..');
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-wirefront',
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });
});

after(() => testEnv.cleanup());
beforeEach(() => testEnv.clearFirestore());

function addScore(initials) {
  const db = testEnv.unauthenticatedContext().firestore();
  return addDoc(collection(db, 'scores'), { initials, score: 1200, wave: 3, ts: Date.now() });
}

test('ordinary initials are accepted', async () => {
  for (const initials of ['ACE', 'DAV', 'A', 'JO', 'WTF', 'NAZ']) await assertSucceeds(addScore(initials));
});

test('blocked words are refused', async () => {
  for (const initials of ['ASS', 'FUK', 'KYS', 'FUT', 'KKK', 'KZ', 'SS', 'HH']) {
    await assertFails(addScore(initials), `expected ${initials} to be refused`);
  }
});

test('the existing format checks still apply', async () => {
  for (const initials of ['', 'ACES', 'ace', 'A1', 'A B']) await assertFails(addScore(initials));
});

// Reads both lists on purpose: the game and the rule must block exactly the same words.
test('the game and the rule block the same list', () => {
  const game = fs.readFileSync(path.join(ROOT, 'js', 'net', 'leaderboard.js'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const gameList = game.match(/const BLOCKED_INITIALS = (\[[^\]]*\]);/);
  const ruleList = rules.match(/initials in (\[[^\]]*\])/);
  assert.ok(gameList, 'BLOCKED_INITIALS not found in js/net/leaderboard.js');
  assert.ok(ruleList, 'blocked list not found in firestore.rules');
  const parse = (list) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(parse(ruleList[1]), parse(gameList[1]));
});

// WF-24: the Gemini proxy's daily call counter is server-only; players must not read or reset it.
test('players cannot read or write the proxy usage counter', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const signedIn = testEnv.authenticatedContext('alice').firestore();
  await assertFails(getDoc(doc(db, 'proxyUsage', '2026-11-26')));
  await assertFails(setDoc(doc(db, 'proxyUsage', '2026-11-26'), { calls: 0 }));
  await assertFails(setDoc(doc(signedIn, 'proxyUsage', '2026-11-26'), { calls: 0 }));
});
