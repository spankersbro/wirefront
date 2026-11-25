// WF-10: a player may write only their own presence entry. Runs against the
// RTDB emulator via `npm run test:rules`, never against live data.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { ref, set, remove, serverTimestamp } = require('firebase/database');

const PLAYERS = 'rooms/global/players';
// Must match PRESENCE_TIMEOUT_MS in index.html.
const STALE_MS = 15000;

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-wirefront',
    database: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'database.rules.json'), 'utf8') },
  });
});

after(() => testEnv.cleanup());
beforeEach(() => testEnv.clearDatabase());

function presence(overrides = {}) {
  return { name: 'IRON WOLF', x: 1, z: 2, yaw: 0.5, t: serverTimestamp(), ...overrides };
}

function dbAs(uid) {
  return uid ? testEnv.authenticatedContext(uid).database() : testEnv.unauthenticatedContext().database();
}

async function seed(uid, data) {
  await testEnv.withSecurityRulesDisabled((context) => set(ref(context.database(), `${PLAYERS}/${uid}`), data));
}

test('a signed-in player can write their own entry', async () => {
  await assertSucceeds(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence()));
});

test('a signed-in player cannot write another player\'s entry', async () => {
  await assertFails(set(ref(dbAs('mallory'), `${PLAYERS}/alice`), presence()));
});

test('a signed-out client cannot write any entry', async () => {
  await assertFails(set(ref(dbAs(null), `${PLAYERS}/alice`), presence()));
});

test('a player can delete their own entry', async () => {
  await seed('alice', presence());
  await assertSucceeds(remove(ref(dbAs('alice'), `${PLAYERS}/alice`)));
});

test('a player cannot delete another player\'s fresh entry', async () => {
  await seed('alice', presence());
  await assertFails(remove(ref(dbAs('mallory'), `${PLAYERS}/alice`)));
});

test('a player can delete another player\'s stale entry', async () => {
  await seed('alice', presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertSucceeds(remove(ref(dbAs('bob'), `${PLAYERS}/alice`)));
});

test('a player cannot delete another player\'s entry before it is 15s old', async () => {
  await seed('alice', presence({ t: Date.now() - STALE_MS + 5000 }));
  await assertFails(remove(ref(dbAs('bob'), `${PLAYERS}/alice`)));
});

test('a player cannot overwrite another player\'s stale entry', async () => {
  await seed('alice', presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertFails(set(ref(dbAs('bob'), `${PLAYERS}/alice`), presence()));
});

test('a signed-out client cannot delete a stale entry', async () => {
  await seed('alice', presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertFails(remove(ref(dbAs(null), `${PLAYERS}/alice`)));
});

test('a client-chosen timestamp is rejected, so nobody can fake a fresh or stale entry', async () => {
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence({ t: Date.now() + 60000 })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence({ t: Date.now() - 60000 })));
});

test('existing shape checks still apply to your own entry', async () => {
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence({ name: 'hello world' })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence({ x: 5000 })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), presence({ extra: 1 })));
  const { name, ...withoutName } = presence();
  assert.equal(name, 'IRON WOLF');
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice`), withoutName));
});

test('the room is still readable without signing in', async () => {
  const { get } = require('firebase/database');
  await seed('alice', presence());
  await assertSucceeds(get(ref(dbAs(null), PLAYERS)));
});
