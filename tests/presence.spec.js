const { test, expect } = require('@playwright/test');
const path = require('path');

// WF-10: presence is written under the anonymous Firebase Auth uid, with a server timestamp.
const FAKE_SDK = path.join(__dirname, 'fixtures', 'fake-firebase.js');

async function openWithFakeFirebase(page) {
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, (route) => route.abort());
  // Playwright tries the most recently added route first, so the fake SDK goes after the block.
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (route) => route.fulfill({ path: FAKE_SDK }));
  await page.goto('/index.html');
  await expect(page.locator('#titleOverlay')).toBeVisible();
}

const presenceWrites = (page) => page.evaluate(() => window.__fakeRtdb.writes);

test('presence is written under the signed-in uid with a server timestamp, and removed on disconnect', async ({ page }) => {
  await openWithFakeFirebase(page);
  await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
  const writes = await presenceWrites(page);
  const ownPath = writes[0].path;
  expect(ownPath).toMatch(/^rooms\/global\/players\/fake-anon-uid-[a-z0-9]+$/);
  expect(await page.evaluate(() => window.__fakeRtdb.disconnectRemoves)).toEqual([ownPath]);
  for (const write of writes) {
    expect(write.path).toBe(ownPath);
    expect(write.value.t).toEqual({ '.sv': 'timestamp' });
    expect(write.value.name).toMatch(/^[A-Z]{3,8} [A-Z]{3,8}$/);
  }
});

test('our own entry in the room is not shown or announced as an ally', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    speechSynthesis.speak = (utterance) => window.__spoken.push(utterance.text);
  });
  await openWithFakeFirebase(page);
  await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
  const ownKey = (await presenceWrites(page))[0].path.split('/').pop();
  await page.evaluate((ownKey) => {
    window.__fakeRtdb.finishInitialLoad();
    window.__fakeRtdb.emit('child_added', ownKey, { name: 'IRON WOLF', x: 0, z: 0, yaw: 0, t: Date.now() });
  }, ownKey);
  // Longer than the 900ms announcement batch window.
  await page.waitForTimeout(1500);
  await expect(page.locator('#commsFeed .comms-line')).toHaveCount(0);
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
});

test('the game still plays when anonymous sign-in fails', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'firebase', {
      configurable: true,
      set(value) {
        const realAuth = value.auth;
        value.auth = () => ({ setPersistence: () => Promise.resolve(), signInAnonymously: () => Promise.reject(new Error('auth/operation-not-allowed')) });
        value.auth.Auth = realAuth.Auth;
        Object.defineProperty(window, 'firebase', { value, writable: true, configurable: true });
      },
    });
  });
  await openWithFakeFirebase(page);
  await page.locator('#startBtn').click();
  await expect(page.locator('#titleOverlay')).toBeHidden();
  await page.waitForTimeout(500);
  expect(await presenceWrites(page)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('a stale-ally delete refused by the rules does not raise a page error', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openWithFakeFirebase(page);
  await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__fakeRtdb.refuseRemoves = true;
    window.__fakeRtdb.finishInitialLoad();
    // 20s old: past the 15s presence timeout, so the next sweep (every 3s) tries to delete it.
    window.__fakeRtdb.emit('child_added', 'someone-else', { name: 'IRON WOLF', x: 30, z: 30, yaw: 0, t: Date.now() - 20000 });
  });
  await expect.poll(() => page.evaluate(() => window.__fakeRtdb.removes), { timeout: 5000 }).toContain('rooms/global/players/someone-else');
  expect(pageErrors).toEqual([]);
});

test('two tabs in the same browser get separate uids and entries', async ({ browser }) => {
  const context = await browser.newContext();
  const keys = [];
  for (let i = 0; i < 2; i++) {
    const page = await context.newPage();
    await openWithFakeFirebase(page);
    await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
    keys.push((await presenceWrites(page))[0].path);
  }
  expect(keys[0]).not.toBe(keys[1]);
  await context.close();
});

// WF-14: presence t is server time, so the stale sweep must compare it with server time, not the local clock.
async function addAllyAtServerAge(page, offsetMs, ageMs) {
  await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
  await page.evaluate(([offsetMs, ageMs]) => {
    window.__fakeRtdb.setServerTimeOffset(offsetMs);
    window.__fakeRtdb.finishInitialLoad();
    const serverNow = Date.now() + offsetMs;
    window.__fakeRtdb.emit('child_added', 'someone-else', { name: 'IRON WOLF', x: 30, z: 30, yaw: 0, t: serverNow - ageMs });
  }, [offsetMs, ageMs]);
}

test('with the local clock 60s fast, a fresh ally is not swept', async ({ page }) => {
  await openWithFakeFirebase(page);
  await addAllyAtServerAge(page, -60000, 0);
  // Longer than one 3s sweep interval.
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => window.__fakeRtdb.removes)).toEqual([]);
});

test('with the local clock 60s slow, an ally 20s stale on the server is swept', async ({ page }) => {
  await openWithFakeFirebase(page);
  await addAllyAtServerAge(page, 60000, 20000);
  await expect.poll(() => page.evaluate(() => window.__fakeRtdb.removes), { timeout: 5000 }).toContain('rooms/global/players/someone-else');
});

test('with no clock offset, an ally 10s old is kept and one 20s old is swept', async ({ page }) => {
  await openWithFakeFirebase(page);
  await expect.poll(async () => (await presenceWrites(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__fakeRtdb.finishInitialLoad();
    window.__fakeRtdb.emit('child_added', 'fresh-ally', { name: 'IRON WOLF', x: 30, z: 30, yaw: 0, t: Date.now() - 10000 });
    window.__fakeRtdb.emit('child_added', 'stale-ally', { name: 'GHOST HAWK', x: 40, z: 40, yaw: 0, t: Date.now() - 20000 });
  });
  await expect.poll(() => page.evaluate(() => window.__fakeRtdb.removes), { timeout: 5000 }).toContain('rooms/global/players/stale-ally');
  expect(await page.evaluate(() => window.__fakeRtdb.removes)).not.toContain('rooms/global/players/fresh-ally');
});
