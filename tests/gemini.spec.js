const { test, expect } = require('@playwright/test');
const path = require('path');

// WF-25: enemy tactics from Gemini through the proxy, with the scripted AI as fallback. The proxy is faked here.
const FAKE_SDK = path.join(__dirname, 'fixtures', 'fake-firebase.js');
const PROXY = 'https://wirefront-gemini-proxy-690237862698.europe-west1.run.app/tactics';
const ASK_EVERY_MS = 5000;

// `reply(body, n)` returns (or resolves to) the proxy's JSON answer for request n; null aborts it (proxy unreachable).
async function openGame(page, reply, { seed } = {}) {
  const requests = [];
  if (seed !== undefined) {
    // Same seed, same spawn positions: lets a test compare two tactics on identical tanks.
    await page.addInitScript((seed) => {
      let state = seed;
      Math.random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
    }, seed);
  }
  await page.addInitScript(() => {
    window.__spoken = [];
    speechSynthesis.speak = (utterance) => window.__spoken.push(utterance.text);
    speechSynthesis.cancel = () => {};
    window.__hidden = false;
    Object.defineProperty(document, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible') });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com/, (route) => route.abort());
  // Playwright tries the most recently added route first, so the fake SDK and proxy go after the block.
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (route) => route.fulfill({ path: FAKE_SDK }));
  await page.route(PROXY, async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData());
    requests.push({ body, authorization: request.headers().authorization });
    const answer = await reply(body, requests.length);
    if (answer === null) return route.abort();
    // Like the real proxy (proxy/src/server.js): 'too-soon' comes back as HTTP 429.
    const status = answer.reason === 'too-soon' ? 429 : 200;
    return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answer) });
  });
  await page.goto('/index.html?e2e');
  await expect(page.locator('#titleOverlay')).toBeVisible();
  // Freeze time so only the test moves it; real time leaking in between steps makes the 5s checks flaky.
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  return requests;
}

async function engage(page) {
  await page.locator('#startBtn').click();
  await expect(page.locator('#titleOverlay')).toBeHidden();
  // One frame: the game asks Gemini on its first frame of play.
  await page.clock.runFor(50);
}

// Jumps game time without rendering every frame in between; the next frame sees the whole jump.
async function skip(page, ms) {
  await page.clock.fastForward(ms);
  await page.clock.runFor(50);
}

const enemies = async (page) => (await page.evaluate(() => window.__wirefrontProbe())).enemies;
const allTanks = (tactic) => (body) => ({ source: 'gemini', orders: body.tanks.map((tank) => ({ id: tank.id, tactic })) });
const commsLines = (page) => page.locator('#commsFeed .comms-line');
const spoken = (page) => page.evaluate(() => window.__spoken);
const radarLabel = (page) => page.locator('#radarLabel');
// Starts the next wave the way clearing a wave does (e2e-only hook).
const nextWave = (page) => page.evaluate(() => window.__wirefrontNextWave());

// Lets the game run until enemy fire ends it; standing still, that takes about 25s of game time.
async function playUntilGameOver(page) {
  for (let i = 0; i < 60 && !(await page.locator('#gameOverOverlay').isVisible()); i++) await page.clock.runFor(1000);
  await expect(page.locator('#gameOverOverlay')).toBeVisible();
}

test('the fight summary goes to the proxy with the sign-in token when play starts, then every 5s; not on the title screen', async ({ page }) => {
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }));
  await skip(page, ASK_EVERY_MS * 2);
  expect(requests).toHaveLength(0);

  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  const { body, authorization } = requests[0];
  expect(authorization).toBe('Bearer fake-id-token');
  expect(body.wave).toBe(1);
  expect(body.player.lives).toBe(3);
  expect(body.tanks).toHaveLength(3);
  for (const tank of body.tanks) {
    expect(tank.id).toMatch(/^t[0-9]{1,7}$/);
    expect(['scout', 'standard', 'heavy']).toContain(tank.variant);
    expect(Math.hypot(tank.dx, tank.dz)).toBeGreaterThan(30);
  }
  expect(body.sinceLastOrders).toEqual({ kills: 0, losses: 0 });

  await skip(page, ASK_EVERY_MS - 300);
  expect(requests).toHaveLength(1);
  await skip(page, 400);
  await expect.poll(() => requests.length).toBe(2);
});

test('Gemini orders are applied, marked on the tanks, shown on the radar and announced', async ({ page }) => {
  await openGame(page, allTanks('flank_left'));
  await engage(page);
  await expect.poll(async () => (await enemies(page)).map((e) => [e.tactic, e.source, e.marker]))
    .toEqual([['flank_left', 'gemini', true], ['flank_left', 'gemini', true], ['flank_left', 'gemini', true]]);
  await page.clock.runFor(50);
  await expect(page.locator('#radarLabel')).toHaveText('Scan · AI Gemini');
  await expect(commsLines(page).last()).toHaveText('GEMINI: 3 TANKS FLANK LEFT');
  expect(await spoken(page)).toEqual(['Gemini orders 3 tanks to flank left']);
});

test('the same orders again are not announced again; a change is', async ({ page }) => {
  const requests = await openGame(page, (body, n) => allTanks(n <= 2 ? 'advance' : 'retreat')(body));
  await engage(page);
  await expect.poll(() => spoken(page)).toEqual(['Gemini orders 3 tanks to advance']);
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => requests.length).toBe(2);
  await page.clock.runFor(50);
  expect(await spoken(page)).toEqual(['Gemini orders 3 tanks to advance']);
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => spoken(page)).toEqual(['Gemini orders 3 tanks to advance', 'Gemini orders 3 tanks to retreat']);
});

test('when the proxy says scripted, the tanks go back to the scripted AI and lose the marker', async ({ page }) => {
  await openGame(page, (body, n) => (n === 1 ? allTanks('hold_and_suppress')(body) : { source: 'scripted', reason: 'daily-limit' }));
  await engage(page);
  await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
  await skip(page, ASK_EVERY_MS);
  await expect.poll(async () => (await enemies(page)).map((e) => [e.tactic, e.source, e.marker]))
    .toEqual([['advance', 'scripted', false], ['advance', 'scripted', false], ['advance', 'scripted', false]]);
  await page.clock.runFor(50);
  await expect(page.locator('#radarLabel')).toHaveText('Scan · AI scripted');
});

test('a too-soon answer keeps the current Gemini orders', async ({ page }) => {
  const requests = await openGame(page, (body, n) => (n === 1 ? allTanks('retreat')(body) : { source: 'scripted', reason: 'too-soon' }));
  await engage(page);
  await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => requests.length).toBe(2);
  await page.clock.runFor(50);
  expect((await enemies(page)).map((e) => e.source)).toEqual(['gemini', 'gemini', 'gemini']);
});

test('if the proxy cannot be reached, the game plays on with the scripted AI and no page errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const requests = await openGame(page, () => null);
  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => requests.length).toBe(2);
  await page.clock.runFor(50);
  expect((await enemies(page)).every((e) => e.source === 'scripted')).toBe(true);
  await expect(page.locator('#radarLabel')).toHaveText('Scan · AI scripted');
  expect(pageErrors).toEqual([]);
});

test('without fresh orders for 12s, Gemini-driven tanks fall back to scripted', async ({ page }) => {
  await openGame(page, (body, n) => (n === 1 ? allTanks('flank_right')(body) : null));
  await engage(page);
  await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
  await skip(page, 11000);
  expect((await enemies(page))[0].source).toBe('gemini');
  await skip(page, 1500);
  await expect.poll(async () => (await enemies(page)).every((e) => e.source === 'scripted')).toBe(true);
});

test('nothing is sent while the tab is hidden', async ({ page }) => {
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }));
  await page.evaluate(() => { window.__hidden = true; });
  await engage(page);
  await skip(page, ASK_EVERY_MS * 3);
  expect(requests).toHaveLength(0);
  await page.evaluate(() => { window.__hidden = false; });
  await page.clock.runFor(100);
  await expect.poll(() => requests.length).toBe(1);
});

test('with comms muted, Gemini orders are shown but not spoken', async ({ page }) => {
  const requests = await openGame(page, allTanks('advance'));
  await page.keyboard.press('m');
  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(50);
  await expect(commsLines(page).last()).toHaveText('GEMINI: 3 TANKS ADVANCE');
  expect(await spoken(page)).toEqual([]);
});

test('retreating tanks move away from the player; advancing ones close in', async ({ browser }) => {
  for (const [tactic, closer] of [['retreat', false], ['advance', true]]) {
    const page = await browser.newPage();
    await openGame(page, allTanks(tactic), { seed: 11 });
    await engage(page);
    await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
    // Tanks turn at about 1 rad/s from their spawn heading; measure once they are on course.
    await page.clock.runFor(3000);
    const before = (await enemies(page)).map((e) => e.dist);
    await page.clock.runFor(2000);
    const after = (await enemies(page)).map((e) => e.dist);
    after.forEach((dist, i) => {
      const label = `${tactic} tank ${i}: ${before[i].toFixed(1)} -> ${dist.toFixed(1)}`;
      if (closer) expect(dist, label).toBeLessThan(before[i]);
      // A retreating tank never closes in; beyond the retreat range it holds still.
      else expect(dist, label).toBeGreaterThanOrEqual(before[i] - 0.01);
    });
    await page.close();
  }
});

test('hits on the player since the last orders are reported to Gemini', async ({ page }) => {
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }));
  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  // Standing still, enemy fire lands within about 15s of game time.
  for (let i = 0; i < 20 && (await page.locator('.life-glyph.spent').count()) === 0; i++) await page.clock.runFor(1000);
  const hits = await page.locator('.life-glyph.spent').count();
  expect(hits).toBeGreaterThan(0);
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => requests.length).toBeGreaterThan(1);
  const reported = requests.slice(1).reduce((sum, request) => sum + request.body.sinceLastOrders.kills, 0);
  expect(reported).toBe(hits);
});

test('flank-left tanks circle one way around the player, flank-right tanks the other', async ({ browser }) => {
  const turned = {};
  for (const tactic of ['flank_left', 'flank_right']) {
    const page = await browser.newPage();
    await openGame(page, allTanks(tactic), { seed: 7 });
    await engage(page);
    await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
    const before = (await enemies(page)).map((e) => e.bearing);
    await page.clock.runFor(6000);
    const after = (await enemies(page)).map((e) => e.bearing);
    // Signed change in each tank's angle around the player, wrapped to -pi..pi.
    turned[tactic] = after.map((b, i) => Math.atan2(Math.sin(b - before[i]), Math.cos(b - before[i])));
    await page.close();
  }
  // The same tanks (same seed): each one ends up further round to the left when flanking left.
  turned.flank_left.forEach((left, i) => expect(left, `tank ${i}`).toBeGreaterThan(turned.flank_right[i] + 0.02));
});

test('nothing is sent after game over, while the tanks are still on the field', async ({ page }) => {
  test.setTimeout(120000);
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }));
  await engage(page);
  await playUntilGameOver(page);
  const sent = requests.length;
  await skip(page, ASK_EVERY_MS * 3);
  expect(requests).toHaveLength(sent);
});

test('a new wave starts with the scripted AI: no Gemini label and no marked tanks', async ({ page }) => {
  await openGame(page, (body, n) => (n === 1 ? allTanks('flank_left')(body) : null));
  await engage(page);
  await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
  await page.clock.runFor(50);
  await expect(radarLabel(page)).toHaveText('Scan · AI Gemini');
  await nextWave(page);
  await page.clock.runFor(50);
  const wave2 = await enemies(page);
  expect(wave2).toHaveLength(4);
  expect(wave2.map((e) => [e.source, e.marker])).toEqual(Array(4).fill(['scripted', false]));
  await expect(radarLabel(page)).toHaveText('Scan · AI scripted');
});

test('Retry starts with the scripted AI and reports no hits from the last game', async ({ page }) => {
  test.setTimeout(120000);
  let gameOver = false;
  const requests = await openGame(page, (body) => (gameOver ? null : allTanks('hold_and_suppress')(body)));
  await engage(page);
  await playUntilGameOver(page);
  await expect(radarLabel(page)).toHaveText('Scan · AI Gemini');
  gameOver = true;
  const sent = requests.length;
  await page.locator('#retryBtn').click();
  await page.clock.runFor(50);
  await expect(radarLabel(page)).toHaveText('Scan · AI scripted');
  expect((await enemies(page)).every((e) => e.source === 'scripted')).toBe(true);
  await skip(page, ASK_EVERY_MS);
  await expect.poll(() => requests.length).toBeGreaterThan(sent);
  expect(requests[sent].body.sinceLastOrders).toEqual({ kills: 0, losses: 0 });
});

test('an answer that arrives after a new wave started changes nothing', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const requests = await openGame(page, (body) => held.then(() => allTanks('retreat')(body)));
  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  await nextWave(page);
  const answered = page.waitForResponse(PROXY);
  release();
  await answered;
  await page.clock.runFor(50);
  expect((await enemies(page)).map((e) => [e.source, e.marker])).toEqual(Array(4).fill(['scripted', false]));
  await expect(radarLabel(page)).toHaveText('Scan · AI scripted');
  await expect(commsLines(page).filter({ hasText: 'GEMINI' })).toHaveCount(0);
});

test('a Gemini answer with no orders leaves the tanks scripted and the label unchanged', async ({ page }) => {
  const requests = await openGame(page, () => ({ source: 'gemini', orders: [] }));
  await engage(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(50);
  await expect(radarLabel(page)).toHaveText('Scan · AI scripted');
  expect((await enemies(page)).every((e) => e.source === 'scripted')).toBe(true);
  expect(await spoken(page)).toEqual([]);
});

test('one tank given new orders is announced as "1 TANK"', async ({ page }) => {
  await openGame(page, (body) => ({ source: 'gemini', orders: [{ id: body.tanks[0].id, tactic: 'flank_left' }] }));
  await engage(page);
  await expect(commsLines(page).last()).toHaveText('GEMINI: 1 TANK FLANK LEFT');
  expect(await spoken(page)).toEqual(['Gemini orders a tank to flank left']);
});

test('the player heading sent to the proxy stays within -pi..pi after turning past pi', async ({ page }) => {
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }), { seed: 7 });
  await engage(page);
  // Turn left just before the second request: about 2.4s at 1.7 rad/s goes past pi. A hit would reset the heading.
  await page.clock.runFor(2500);
  await page.keyboard.down('a');
  await page.clock.runFor(2500);
  await page.keyboard.up('a');
  await expect.poll(() => requests.length).toBe(2);
  const rawYaw = (await page.evaluate(() => window.__wirefrontProbe())).yaw;
  expect(rawYaw).toBeGreaterThan(Math.PI);
  const sentYaw = requests[1].body.player.yaw;
  expect(sentYaw).toBeGreaterThanOrEqual(-Math.PI);
  expect(sentYaw).toBeLessThanOrEqual(Math.PI);
});

test('if Firebase auth throws, the game plays on with no page errors and sends nothing', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const requests = await openGame(page, () => ({ source: 'scripted', reason: 'daily-limit' }));
  await page.evaluate(() => { firebase.auth = () => { throw new Error('No Firebase App'); }; });
  await engage(page);
  await skip(page, ASK_EVERY_MS);
  expect(requests).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test('answers with no orders do not keep old Gemini orders fresh: the tanks still fall back after 12s', async ({ page }) => {
  await openGame(page, (body, n) => (n === 1 ? allTanks('flank_right')(body) : { source: 'gemini', orders: [] }));
  await engage(page);
  await expect.poll(async () => (await enemies(page))[0].source).toBe('gemini');
  for (let i = 0; i < 5; i++) await skip(page, 2500);
  await expect.poll(async () => (await enemies(page)).every((e) => e.source === 'scripted')).toBe(true);
});
