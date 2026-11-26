const { test, expect } = require('@playwright/test');
const path = require('path');

// WF-18: initials on the public leaderboard. The game blocks the same words as firestore.rules.
const FAKE_SDK = path.join(__dirname, 'fixtures', 'fake-firebase.js');

async function reachGameOver(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, (route) => route.abort());
  // Playwright tries the most recently added route first, so the fake SDK goes after the block.
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (route) => route.fulfill({ path: FAKE_SDK }));
  await page.goto('/index.html');
  await page.locator('#startBtn').click();
  await playUntilGameOver(page);
}

async function playUntilGameOver(page) {
  // Standing still, enemy fire ends the game in about 15s of game time; 3 minutes is a generous cap.
  for (let i = 0; i < 12 && !(await page.locator('#gameOverOverlay').isVisible()); i++) await page.clock.runFor(15000);
  await expect(page.locator('#gameOverOverlay')).toBeVisible();
}

// Every frame still renders WebGL, so a game over costs 2-7s of real time, more on a loaded runner.
test.beforeEach(() => test.setTimeout(120000));

const scoreAdds = (page) => page.evaluate(() => window.__fakeFirestore.adds.map((doc) => doc.initials));

test('the initials step is labelled as initials', async ({ page }) => {
  await reachGameOver(page);
  await expect(page.getByLabel('Enter Initials')).toHaveValue('ACE');
});

test('blocked initials are not saved and the player is asked for others', async ({ page }) => {
  await reachGameOver(page);
  await page.locator('#initials').fill('ass');
  await page.locator('#submitScoreBtn').click();
  await expect(page.locator('#initialsError')).toBeVisible();
  await expect(page.locator('#initials')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#initialsStep')).toBeVisible();
  expect(await scoreAdds(page)).toEqual([]);

  await page.locator('#initials').fill('ACE');
  await expect(page.locator('#initialsError')).toBeHidden();
  await expect(page.locator('#initials')).toHaveAttribute('aria-invalid', 'false');
  await page.locator('#initials').press('Enter');
  await expect(page.locator('#initialsStep')).toBeHidden();
  expect(await scoreAdds(page)).toEqual(['ACE']);
});

test('ordinary initials are saved as typed', async ({ page }) => {
  await reachGameOver(page);
  await page.locator('#initials').fill('dav');
  await page.locator('#submitScoreBtn').click();
  await expect(page.locator('#initialsStep')).toBeHidden();
  expect(await scoreAdds(page)).toEqual(['DAV']);
});

test('the blocked-initials message does not carry over to the next game over', async ({ page }) => {
  await reachGameOver(page);
  await page.locator('#initials').fill('KKK');
  await page.locator('#submitScoreBtn').click();
  await expect(page.locator('#initialsError')).toBeVisible();
  await page.locator('#retryBtn').click();
  await expect(page.locator('#gameOverOverlay')).toBeHidden();
  await playUntilGameOver(page);
  await expect(page.locator('#initialsError')).toBeHidden();
});
