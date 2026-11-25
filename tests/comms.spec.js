const { test, expect } = require('@playwright/test');
const path = require('path');

// WF-3: a burst of players joining or leaving the room. Each event below is one
// RTDB child_added/child_removed, which is what each extra client produces.
// Values from index.html: ANNOUNCE_BATCH_MS 900, ANNOUNCE_MIN_AUDIO_GAP_MS 4000, MAX_COMMS_LINES 3.

const FAKE_SDK = path.join(__dirname, 'fixtures', 'fake-firebase.js');
const BATCH_MS = 900;
const AUDIO_GAP_MS = 4000;
const CLOCK_START = new Date('2026-01-01T00:00:00Z');
// Page load runs on the fake clock in real time; 60s is far more than a load takes.
const CLOCK_PAUSE = new Date('2026-01-01T00:01:00Z');

// t is filled in inside the page, from the page's fake clock.
function presence(name) {
  return { name, x: 30, z: 30, yaw: 0 };
}

function emitInPage(page, event, id, data) {
  return page.evaluate(([event, id, data]) => {
    window.__fakeRtdb.emit(event, id, data && { ...data, t: Date.now() });
  }, [event, id, data]);
}

async function openRoom(page, playersAlreadyThere = []) {
  await page.addInitScript(() => {
    window.__spoken = [];
    speechSynthesis.speak = (utterance) => window.__spoken.push(utterance.text);
    speechSynthesis.cancel = () => {};
  });
  await page.clock.install({ time: CLOCK_START });
  // Playwright tries the most recently added route first, so the fake SDK goes after the block.
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|firestore\.googleapis\.com|firebaseinstallations\.googleapis\.com/, (route) => route.abort());
  await page.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (route) => route.fulfill({ path: FAKE_SDK }));
  await page.goto('/index.html');
  await expect(page.locator('#titleOverlay')).toBeVisible();
  // Freeze time so only runFor moves it; otherwise real time leaks in between steps and splits batches.
  await page.clock.pauseAt(CLOCK_PAUSE);
  for (const [id, data] of playersAlreadyThere) await emitInPage(page, 'child_added', id, data);
  await page.evaluate(() => window.__fakeRtdb.finishInitialLoad());
}

function join(page, id, name) {
  return emitInPage(page, 'child_added', id, presence(name));
}

function leave(page, id) {
  return emitInPage(page, 'child_removed', id, null);
}

const commsLines = (page) => page.locator('#commsFeed .comms-line');
const spoken = (page) => page.evaluate(() => window.__spoken);

test('players already in the room are not announced', async ({ page }) => {
  await openRoom(page, [['p1', presence('IRON WOLF')], ['p2', presence('GHOST HAWK')], ['p3', presence('LONE FOX')]]);
  await page.clock.runFor(BATCH_MS * 2);
  await expect(commsLines(page)).toHaveCount(0);
  expect(await spoken(page)).toEqual([]);
});

test('one player joining is announced by name', async ({ page }) => {
  await openRoom(page);
  await join(page, 'p1', 'IRON WOLF');
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page)).toHaveText(['IRON WOLF ON GRID']);
  expect(await spoken(page)).toEqual(['IRON WOLF has entered the field']);
});

test('a burst of 5 joins inside one batch window reads as one line and one voice line', async ({ page }) => {
  await openRoom(page);
  for (const [i, name] of ['IRON WOLF', 'GHOST HAWK', 'LONE FOX', 'GRIM RAVEN', 'SWIFT LYNX'].entries()) {
    await join(page, 'p' + i, name);
    await page.clock.runFor(150);
  }
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page)).toHaveText(['5 PILOTS ON GRID']);
  expect(await spoken(page)).toEqual(['5 pilots have entered the field']);
});

test('nothing is announced before the batch window closes', async ({ page }) => {
  await openRoom(page);
  await join(page, 'p1', 'IRON WOLF');
  await page.clock.runFor(BATCH_MS - 100);
  await expect(commsLines(page)).toHaveCount(0);
  expect(await spoken(page)).toEqual([]);
});

test('a second batch within 4s shows a line but stays silent; after 4s it speaks again', async ({ page }) => {
  await openRoom(page);
  await join(page, 'p1', 'IRON WOLF');
  await join(page, 'p2', 'GHOST HAWK');
  await page.clock.runFor(BATCH_MS);

  await join(page, 'p3', 'LONE FOX');
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page).last()).toHaveText('LONE FOX ON GRID');
  expect(await spoken(page)).toEqual(['2 pilots have entered the field']);

  await page.clock.runFor(AUDIO_GAP_MS);
  await join(page, 'p4', 'GRIM RAVEN');
  await page.clock.runFor(BATCH_MS);
  expect(await spoken(page)).toEqual(['2 pilots have entered the field', 'GRIM RAVEN has entered the field']);
});

test('joins and leaves in the same window give two lines; only the join is spoken', async ({ page }) => {
  await openRoom(page, [['p1', presence('IRON WOLF')], ['p2', presence('GHOST HAWK')]]);
  await leave(page, 'p1');
  await leave(page, 'p2');
  await join(page, 'p3', 'LONE FOX');
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page)).toHaveText(['LONE FOX ON GRID', '2 PILOTS OFFLINE']);
  expect(await spoken(page)).toEqual(['LONE FOX has entered the field']);
});

test('the comms feed never shows more than 3 lines', async ({ page }) => {
  await openRoom(page);
  for (let i = 0; i < 5; i++) {
    await join(page, 'p' + i, 'IRON WOLF');
    await page.clock.runFor(BATCH_MS);
  }
  await expect(commsLines(page)).toHaveCount(3);
});

test('a player leaving and an unknown leave event', async ({ page }) => {
  await openRoom(page, [['p1', presence('IRON WOLF')]]);
  await leave(page, 'never-joined');
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page)).toHaveCount(0);

  await leave(page, 'p1');
  await page.clock.runFor(BATCH_MS);
  await expect(commsLines(page)).toHaveText(['IRON WOLF OFFLINE']);
});

test('every batch waits its own full window, even right after an earlier batch', async ({ page }) => {
  await openRoom(page);
  await join(page, 'p1', 'IRON WOLF');
  await page.clock.runFor(800);
  await join(page, 'p2', 'GHOST HAWK');
  await page.clock.runFor(100);
  await expect(commsLines(page)).toHaveText(['2 PILOTS ON GRID']);

  await page.clock.runFor(100);
  await join(page, 'p3', 'LONE FOX');
  await page.clock.runFor(BATCH_MS - 100);
  await expect(commsLines(page)).toHaveCount(1);
  await page.clock.runFor(100);
  await expect(commsLines(page).last()).toHaveText('LONE FOX ON GRID');
});
