const { test, expect } = require('@playwright/test');

// WF-20: brighter lines with a bloom glow.
const BLOOM_SCRIPTS = /cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\//;

async function openGame(page, { blockBloom = false } = {}) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com/, (route) => route.abort());
  if (blockBloom) await page.route(BLOOM_SCRIPTS, (route) => route.abort());
  await page.goto('/index.html?e2e&bloom');
  await page.locator('#startBtn').click();
}

const probe = (page) => page.evaluate(() => window.__wirefrontProbe());

// Mean brightness (0-255) of the ground: the lower half of the screen, below the horizon.
async function groundBrightness(page) {
  const png = await page.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, Math.floor(image.height / 2), image.width, Math.floor(image.height / 2) - 60);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return sum / (data.length / 4);
  }, png.toString('base64'));
}

test('the glow is on when the bloom scripts load', async ({ page }) => {
  await openGame(page);
  await page.clock.runFor(500);
  expect((await probe(page)).bloom).toBe(true);
  await expect(page.locator('body')).not.toHaveClass(/no-bloom/);
});

test('without the bloom scripts the game still plays, with the CSS glow', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openGame(page, { blockBloom: true });
  await page.clock.runFor(500);
  expect(await probe(page)).toMatchObject({ state: 'playing', bloom: false });
  await expect(page.locator('body')).toHaveClass(/no-bloom/);
  expect(pageErrors).toEqual([]);
});

test('the glow turns off when the first 120 frames average under 45fps', async ({ page }) => {
  await openGame(page);
  // One frame per 25ms jump is 40fps.
  for (let i = 0; i < 150; i++) await page.clock.fastForward(25);
  expect((await probe(page)).bloom).toBe(false);
  await expect(page.locator('body')).toHaveClass(/no-bloom/);
});

test('the glow stays on at 60fps', async ({ page }) => {
  await openGame(page);
  // runFor steps animation frames at about 16ms: well over 120 frames at 60fps.
  await page.clock.runFor(3000);
  expect((await probe(page)).bloom).toBe(true);
});

test('the ground is clearly lit and glows, not near-black', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  await page.clock.runFor(2500);
  // Measured 2026-11-26 in headless Chromium: 1.4 before WF-20, 36 after; 16.7 with the new
  // colours but no bloom pass. 25 needs both.
  expect(await groundBrightness(page)).toBeGreaterThan(25);
});

test('automated browsers skip the glow unless the URL asks for it', async ({ page }) => {
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com/, (route) => route.abort());
  await page.goto('/index.html?e2e');
  expect((await probe(page)).bloom).toBe(false);
  await expect(page.locator('body')).toHaveClass(/no-bloom/);
});

test('if one effect script is missing, the game falls back to the CSS glow without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(/examples\/js\/shaders\/LuminosityHighPassShader\.js/, (route) => route.abort());
  await openGame(page);
  await page.clock.runFor(500);
  expect(await probe(page)).toMatchObject({ state: 'playing', bloom: false });
  expect(pageErrors).toEqual([]);
});

// WF-21: every tank variant builds, including the heavy tank that only appears from wave 3.
test('the showcase shows all four tank variants without errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com/, (route) => route.abort());
  await page.goto('/index.html?e2e&bloom&showcase');
  await page.clock.runFor(300);
  expect((await probe(page)).state).toBe('showcase');
  expect(pageErrors).toEqual([]);
});
