const { test, expect } = require('@playwright/test');

const FIREBASE_HOSTS = /gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com/;

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
  }).toBeGreaterThan(1);
  await page.keyboard.up('w');

  await page.keyboard.down('a');
  await expect.poll(async () => Math.abs((await probe(page)).yaw)).toBeGreaterThan(0.2);
  await page.keyboard.up('a');

  await page.keyboard.down(' ');
  await expect.poll(async () => (await probe(page)).playerShots).toBeGreaterThan(0);
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
  expect(firebaseRequests.length).toBeGreaterThan(0);
});
