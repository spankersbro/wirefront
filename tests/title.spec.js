const { test, expect } = require('@playwright/test');

// WF-29: the title screen's ripple wordmark and its synth loop. Audio runs on real time, so these tests use real time too.
async function openTitle(page, { muted = false } = {}) {
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com|run\.app/, (route) => route.abort());
  if (muted) await page.addInitScript(() => localStorage.setItem('wirefront.commsMuted', '1'));
  await page.goto('/index.html?e2e');
  await expect(page.locator('#titleOverlay')).toBeVisible();
}

const probe = (page) => page.evaluate(() => window.__wirefrontProbe());
const music = async (page) => (await probe(page)).titleMusic;

test('the title draws the WIREFRONT wordmark with the ripple shader, in the game green', async ({ page }) => {
  await openTitle(page);
  const canvas = page.locator('#titleRipple');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await probe(page)).titleRippleFrames).toBeGreaterThan(5);
  // The heading stays for screen readers.
  await expect(page.getByRole('heading', { level: 1, name: 'WIREFRONT' })).toBeAttached();
  const png = await canvas.screenshot();
  const green = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 120 && data[i + 1] > data[i] * 1.5 && data[i + 1] > data[i + 2] * 1.5) n++;
    return n / (data.length / 4);
  }, png.toString('base64'));
  // Hatched letters and the dot field: a real share of the canvas is bright green, not black and not white.
  expect(green).toBeGreaterThan(0.03);
});

test('the title music starts on the first input, not before', async ({ page }) => {
  await openTitle(page);
  await page.waitForTimeout(800);
  expect(await music(page)).toEqual({ state: 'off', notes: 0 });
  await page.keyboard.press('x');
  await expect.poll(async () => (await music(page)).notes).toBeGreaterThan(8);
  expect((await music(page)).state).toBe('playing');
});

test('M mutes the title music and M again brings it back', async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press('x');
  await expect.poll(async () => (await music(page)).notes).toBeGreaterThan(8);
  await page.keyboard.press('m');
  await expect.poll(async () => (await music(page)).state).toBe('muted');
  const before = (await music(page)).notes;
  await page.waitForTimeout(1200);
  expect((await music(page)).notes).toBe(before);
  await page.keyboard.press('m');
  await expect.poll(async () => (await music(page)).notes).toBeGreaterThan(before);
  expect((await music(page)).state).toBe('playing');
});

test('comms muted on an earlier visit: input does not start the music', async ({ page }) => {
  await openTitle(page, { muted: true });
  await page.keyboard.press('x');
  await page.waitForTimeout(1200);
  expect(await music(page)).toEqual({ state: 'muted', notes: 0 });
});

test('the music stops when play starts', async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press('x');
  await expect.poll(async () => (await music(page)).notes).toBeGreaterThan(8);
  await page.locator('#startBtn').click();
  await expect.poll(async () => (await music(page)).state).toBe('off');
  const before = (await music(page)).notes;
  await page.waitForTimeout(1200);
  expect((await music(page)).notes).toBe(before);
});

test('with reduced motion the wordmark stands still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTitle(page);
  const canvas = page.locator('#titleRipple');
  await expect.poll(async () => (await probe(page)).titleRippleFrames).toBeGreaterThan(5);
  const first = await canvas.screenshot();
  await page.waitForTimeout(600);
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);
});

test('without reduced motion the wordmark moves', async ({ page }) => {
  await openTitle(page);
  const canvas = page.locator('#titleRipple');
  await expect.poll(async () => (await probe(page)).titleRippleFrames).toBeGreaterThan(5);
  const first = await canvas.screenshot();
  await page.waitForTimeout(600);
  expect((await canvas.screenshot()).equals(first)).toBe(false);
});

test('Engage as the very first click plays no note at all', async ({ page }) => {
  await openTitle(page);
  await page.locator('#startBtn').click();
  await page.waitForTimeout(800);
  expect(await music(page)).toEqual({ state: 'off', notes: 0 });
});

test('Enter as the very first key starts the game with no note played', async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await probe(page)).state).toBe('playing');
  await page.waitForTimeout(600);
  expect(await music(page)).toEqual({ state: 'off', notes: 0 });
});

test('M as the very first key mutes before any note is played', async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press('m');
  await page.waitForTimeout(600);
  expect(await music(page)).toEqual({ state: 'muted', notes: 0 });
});
