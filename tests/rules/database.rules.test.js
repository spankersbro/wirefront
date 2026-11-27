// WF-10: a player may write only their own presence entry. Runs against the
// RTDB emulator via `npm run test:rules`, never against live data.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { ref, set, update, get, remove, serverTimestamp } = require('firebase/database');

const PLAYERS = 'rooms/global/players';
// Entry keys are the anonymous uid; each tab signs in with its own.
const ALICE = 'alice';
// Must match PRESENCE_TIMEOUT_MS in js/config.js.
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

async function seed(key, data) {
  await testEnv.withSecurityRulesDisabled((context) => set(ref(context.database(), `${PLAYERS}/${key}`), data));
}

test('a signed-in player can write their own entry', async () => {
  await assertSucceeds(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence()));
});

test('one account cannot hold a second entry, so one sign-in is one tank', async () => {
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alice_2`), presence()));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/alicex`), presence()));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/xalice`), presence()));
});

test('a signed-in player cannot write another player\'s entry', async () => {
  await assertFails(set(ref(dbAs('mallory'), `${PLAYERS}/${ALICE}`), presence()));
});

test('a signed-out client cannot write any entry', async () => {
  await assertFails(set(ref(dbAs(null), `${PLAYERS}/${ALICE}`), presence()));
});

test('a player can delete their own entry', async () => {
  await seed(ALICE, presence());
  await assertSucceeds(remove(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`)));
});

test('a player cannot delete another player\'s fresh entry', async () => {
  await seed(ALICE, presence());
  await assertFails(remove(ref(dbAs('mallory'), `${PLAYERS}/${ALICE}`)));
});

test('a player can delete another player\'s stale entry', async () => {
  await seed(ALICE, presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertSucceeds(remove(ref(dbAs('bob'), `${PLAYERS}/${ALICE}`)));
});

test('a player cannot delete another player\'s entry before it is 15s old', async () => {
  await seed(ALICE, presence({ t: Date.now() - STALE_MS + 5000 }));
  await assertFails(remove(ref(dbAs('bob'), `${PLAYERS}/${ALICE}`)));
});

test('a player cannot overwrite another player\'s stale entry', async () => {
  await seed(ALICE, presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertFails(set(ref(dbAs('bob'), `${PLAYERS}/${ALICE}`), presence()));
});

test('a signed-out client cannot delete a stale entry', async () => {
  await seed(ALICE, presence({ t: Date.now() - STALE_MS - 5000 }));
  await assertFails(remove(ref(dbAs(null), `${PLAYERS}/${ALICE}`)));
});

test('a client-chosen timestamp is rejected, so nobody can fake a fresh or stale entry', async () => {
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ t: Date.now() + 60000 })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ t: Date.now() - 60000 })));
});

test('existing shape checks still apply to your own entry', async () => {
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ name: 'hello world' })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ x: 5000 })));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ extra: 1 })));
  const { name, ...withoutName } = presence();
  assert.equal(name, 'IRON WOLF');
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), withoutName));
});

test('the room is still readable without signing in', async () => {
  await seed(ALICE, presence());
  await assertSucceeds(get(ref(dbAs(null), PLAYERS)));
});

// WF-13: callsigns are read aloud to every player, so the rule allows only the game's own words.
function writeName(name) {
  return set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence({ name }));
}

test('a callsign made of one adjective and one noun from the game is accepted', async () => {
  await assertSucceeds(writeName('GHOST HAWK'));
  await assertSucceeds(writeName('SILENT FALCON'));
  await assertSucceeds(writeName('VOID FOX'));
});

test('any other two words are refused, even in the old name format', async () => {
  for (const name of ['HELLO WORLD', 'WOLF IRON', 'IRON IRON', 'XIRON WOLF', 'IRONX WOLF', 'IRON XWOLF', 'IRON WOLFX',
    'IRON  WOLF', 'IRON WOLF ', ' IRON WOLF', 'iron wolf', 'IRON', 'IRON WOLF FOX', '']) {
    await assertFails(writeName(name), `expected "${name}" to be refused`);
  }
});

// Reads the lists out of js/config.js on purpose: this guards against the game and the rule drifting apart.
test('every callsign the game can generate is accepted', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'config.js'), 'utf8');
  const list = (varName) => {
    const found = source.match(new RegExp(`const ${varName} = (\\[[^\\]]*\\]);`));
    assert.ok(found, `${varName} not found in js/config.js; update this parser and the name rule`);
    return [...found[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const adjectives = list('CALLSIGN_ADJ');
  const nouns = list('CALLSIGN_NOUN');
  assert.equal(adjectives.length * nouns.length, 225);
  for (const adjective of adjectives) {
    for (const noun of nouns) await assertSucceeds(writeName(`${adjective} ${noun}`));
  }
});

test('an entry written before the name rule cannot be kept alive by updating other fields', async () => {
  await seed(ALICE, presence({ name: 'HELLO WORLD', t: Date.now() }));
  await assertFails(update(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), { x: 3, t: serverTimestamp() }));
  await assertFails(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}/x`), 7));
  await assertSucceeds(set(ref(dbAs('alice'), `${PLAYERS}/${ALICE}`), presence()));
});
