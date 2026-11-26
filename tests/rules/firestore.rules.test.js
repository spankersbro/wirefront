// WF-18: leaderboard initials. Runs against the Firestore emulator via `npm run test:rules`.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, addDoc } = require('firebase/firestore');

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
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const gameList = html.match(/var BLOCKED_INITIALS = (\[[^\]]*\]);/);
  const ruleList = rules.match(/initials in (\[[^\]]*\])/);
  assert.ok(gameList, 'BLOCKED_INITIALS not found in index.html');
  assert.ok(ruleList, 'blocked list not found in firestore.rules');
  const parse = (list) => JSON.parse(list.replace(/'/g, '"'));
  assert.deepEqual(parse(ruleList[1]), parse(gameList[1]));
});
