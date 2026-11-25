const { test, expect } = require('@playwright/test');

const FIREBASE_HOSTS = /gstatic\.com\/firebasejs|firebaseio\.com|firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com/;
const FIREBASE_SDK_SCRIPTS = ['firebase-app-compat.js', 'firebase-firestore-compat.js', 'firebase-database-compat.js'];
// The game caps frame time at 50ms, so a slow software-WebGL runner also slows game time. 15s covers ~2fps.
const SLOW_RUNNER_POLL = { timeout: 15000 };

async function openGame(page) {
  const pageErrors = [];
  const firebaseRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(FIREBASE_HOSTS, (route) => {
    firebaseRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/index.html?e2e');
  await expect(page.locator('#titleOverlay')).toBeVisible();
  return { pageErrors, firebaseRequests };
}

function probe(page) {
  return page.evaluate(() => window.__wirefrontProbe());
}

test('title screen loads offline without page errors', async ({ page }) => {
  const { pageErrors } = await openGame(page);
  await expect(page.locator('#startBtn')).toBeVisible();
  expect((await probe(page)).state).toBe('title');
  expect(pageErrors).toEqual([]);
});

test('Engage starts the game, the tank drives and fires', async ({ page }) => {
  const { pageErrors } = await openGame(page);
  await page.locator('#startBtn').click();
  await expect(page.locator('#titleOverlay')).toBeHidden();
  expect((await probe(page)).state).toBe('playing');

  await page.keyboard.down('w');
  await expect.poll(async () => {
    const { x, z } = await probe(page);
    return Math.hypot(x, z);
  }, SLOW_RUNNER_POLL).toBeGreaterThan(1);
  await page.keyboard.up('w');

  await page.keyboard.down('a');
  await expect.poll(async () => Math.abs((await probe(page)).yaw), SLOW_RUNNER_POLL).toBeGreaterThan(0.2);
  await page.keyboard.up('a');

  await page.keyboard.down(' ');
  await expect.poll(async () => (await probe(page)).playerShots, SLOW_RUNNER_POLL).toBeGreaterThan(0);
  await page.keyboard.up(' ');
  expect(pageErrors).toEqual([]);
});

test('the e2e probe is absent without the e2e flag', async ({ page }) => {
  await page.route(FIREBASE_HOSTS, (route) => route.abort());
  await page.goto('/index.html');
  await expect(page.locator('#titleOverlay')).toBeVisible();
  expect(await page.evaluate(() => typeof window.__wirefrontProbe)).toBe('undefined');
});

test('Firebase traffic is blocked, so tests never touch live data', async ({ page }) => {
  const { firebaseRequests } = await openGame(page);
  for (const script of FIREBASE_SDK_SCRIPTS) {
    expect(firebaseRequests.some((url) => url.endsWith(script)), script).toBe(true);
  }
  expect(await page.evaluate(() => typeof window.firebase)).toBe('undefined');
});
