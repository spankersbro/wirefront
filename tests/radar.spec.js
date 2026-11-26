const { test, expect } = require('@playwright/test');

// WF-27: the radar pings what the player's tank can see, draws the obstacles, and enemy tanks need line of sight too.
// World layout: the player starts at (0, 0) facing -z, so on the heading-up radar "in front" is up and +x is right.
// A tank with yaw PI faces +z.
const RADAR_CENTRE = 66;
const RADAR_PX_PER_UNIT = 66 / 170; // radar radius in px / world radius
const FULL_SWEEP_MS = 3300; // the sweep turns 2 rad/s, one turn is about 3.14 s

async function openGame(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route(/gstatic\.com\/firebasejs|firebaseio\.com|googleapis\.com|run\.app/, (route) => route.abort());
  await page.goto('/index.html?e2e');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#startBtn').click();
  await page.clock.runFor(50);
}

// Replaces the obstacles and tanks with the given ones and puts the player at (0, 0) facing -z (e2e-only hook).
const arrange = (page, spec) => page.evaluate((spec) => window.__wirefrontArrange(spec), spec);
const probe = (page) => page.evaluate(() => window.__wirefrontProbe());
const blipOf = async (page, id) => (await probe(page)).radar.blips.find((blip) => blip.id === id);

test('a tank in plain sight is pinged when the sweep passes, and the ping stays where the tank was', async ({ page }) => {
  await openGame(page);
  const [front] = await arrange(page, { obstacles: [], enemies: [{ x: 0, z: -50, yaw: Math.PI }] });
  let blip;
  for (let i = 0; i < FULL_SWEEP_MS / 50 && !blip; i++) {
    await page.clock.runFor(50);
    blip = await blipOf(page, front);
  }
  expect(blip).toBeDefined();
  // Straight ahead, centred. The tank closes in from 50 units while the sweep comes round, so 20-50 units up.
  expect(blip.x).toBeCloseTo(RADAR_CENTRE, 0);
  expect(blip.y).toBeGreaterThan(RADAR_CENTRE - 50 * RADAR_PX_PER_UNIT - 1);
  expect(blip.y).toBeLessThan(RADAR_CENTRE - 20 * RADAR_PX_PER_UNIT);

  // The tank keeps driving towards the player. Well before the sweep comes round again, the ping has not moved and has faded.
  const tankBefore = (await probe(page)).enemies.find((e) => e.id === front).dist;
  await page.clock.runFor(1000);
  const later = await blipOf(page, front);
  const tankAfter = (await probe(page)).enemies.find((e) => e.id === front).dist;
  expect(tankAfter).toBeLessThan(tankBefore - 2);
  expect([later.x, later.y]).toEqual([blip.x, blip.y]);
  expect(later.alpha).toBeLessThan(blip.alpha);
});

test('a tank hidden behind an obstacle is never pinged; one in plain sight is', async ({ page }) => {
  await openGame(page);
  const [hidden, visible] = await arrange(page, {
    obstacles: [{ x: 0, z: -25, r: 5 }],
    enemies: [{ x: 0, z: -50, speed: 0 }, { x: 50, z: 0, speed: 0 }],
  });
  await page.clock.runFor(FULL_SWEEP_MS);
  expect(await blipOf(page, hidden)).toBeUndefined();
  expect(await blipOf(page, visible)).toBeDefined();
});

test('obstacles are drawn on the radar where they are, at their size', async ({ page }) => {
  await openGame(page);
  await arrange(page, { obstacles: [{ x: 30, z: 0, r: 6 }], enemies: [] });
  await page.clock.runFor(50);
  const { obstacles } = (await probe(page)).radar;
  expect(obstacles).toHaveLength(1);
  // 30 units to the right: 30 * 66/170 = 11.6 px right of the centre, radius 6 * 66/170 = 2.3 px.
  expect(obstacles[0].x).toBeCloseTo(RADAR_CENTRE + 30 * RADAR_PX_PER_UNIT, 0);
  expect(obstacles[0].y).toBeCloseTo(RADAR_CENTRE, 0);
  expect(obstacles[0].r).toBeCloseTo(6 * RADAR_PX_PER_UNIT, 0);
  // And on the canvas itself: amber outline pixels around that spot (rings and sweep are green, tanks are absent).
  const amberPixels = await page.evaluate(({ x, y }) => {
    const { data } = document.getElementById('radar').getContext('2d').getImageData(Math.round(x) - 4, Math.round(y) - 4, 9, 9);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 3] > 60) count += 1;
    return count;
  }, obstacles[0]);
  expect(amberPixels).toBeGreaterThan(3);
});

// Enemy tanks fire every 2-4 s while they can see the player, so 8 s is at least two shots.
// A shot lives 4.5 s, so sampling every 0.5 s cannot miss one. Returns the most shots seen in flight at once.
async function shotsFiredIn8s(page, obstacles) {
  await openGame(page);
  await arrange(page, { obstacles, enemies: [{ x: 0, z: -30, speed: 0, yaw: Math.PI }] });
  let fired = 0;
  for (let i = 0; i < 16; i++) {
    await page.clock.runFor(500);
    fired = Math.max(fired, (await probe(page)).enemyShots);
  }
  return fired;
}

test('a tank that cannot see the player does not fire', async ({ page }) => {
  expect(await shotsFiredIn8s(page, [{ x: 0, z: -15, r: 4 }])).toBe(0);
});

test('the same tank with a clear line to the player fires', async ({ page }) => {
  expect(await shotsFiredIn8s(page, [])).toBeGreaterThan(0);
});

test('a tank that cannot see the player drives to where it last saw the player, not to the player', async ({ page }) => {
  await openGame(page);
  // The obstacle blocks the line from the tank to the player; the tank last saw the player at (40, -60).
  const [tank] = await arrange(page, {
    obstacles: [{ x: 0, z: -30, r: 6 }],
    enemies: [{ x: 0, z: -60, yaw: Math.PI, lastSeen: { x: 40, z: -60 } }],
  });
  await page.clock.runFor(4000);
  const moved = (await probe(page)).enemies.find((e) => e.id === tank);
  // It starts facing the player. Towards (40, -60) it turns right and goes right; towards the player it stays at x = 0.
  expect(moved.x).toBeGreaterThan(3);
});

// Counts how often the tank gets a fresh ping (its blip comes back at full strength) over the given game time.
async function pingsWhile(page, id, ms) {
  let pings = 0, lastAlpha = 0;
  for (let t = 0; t < ms; t += 50) {
    await page.clock.runFor(50);
    const blip = await blipOf(page, id);
    const alpha = blip ? blip.alpha : 0;
    if (alpha > lastAlpha + 0.2) pings += 1;
    lastAlpha = alpha;
  }
  return pings;
}

test('turning against the sweep does not make the radar skip tanks', async ({ page }) => {
  await openGame(page);
  // 100 units away, out of firing range: a hit would reset the player's heading.
  const [tank] = await arrange(page, { obstacles: [], enemies: [{ x: 0, z: -100, speed: 0 }] });
  // Turning right spins the heading-up picture against the sweep: about 2 + 1.7 = 3.7 rad/s, one pass every 1.7 s.
  await page.keyboard.down('d');
  const pings = await pingsWhile(page, tank, 12000);
  await page.keyboard.up('d');
  // 12 s at 3.7 rad/s is 7 passes; the turn eases in, so expect at least 6. A sweep test that ignores the turn got 4.
  expect(pings).toBeGreaterThanOrEqual(6);
});

test('a ping fades with the sweep, not with wall-clock time, when frames are slow', async ({ page }) => {
  await openGame(page);
  const [tank] = await arrange(page, { obstacles: [], enemies: [{ x: 0, z: -50, speed: 0 }] });
  let blip;
  for (let i = 0; i < 80 && !(blip && blip.alpha > 0.9); i++) {
    await page.clock.runFor(50);
    blip = await blipOf(page, tank);
  }
  // Two 1 s gaps between frames: the game caps a frame at 0.05 s, so the sweep barely moves and the ping barely fades.
  await page.clock.fastForward(1000);
  await page.clock.runFor(20);
  await page.clock.fastForward(1000);
  await page.clock.runFor(20);
  expect((await blipOf(page, tank)).alpha).toBeGreaterThan(blip.alpha - 0.15);
});

test('a tank that lost the player and reached the last seen place keeps searching instead of parking', async ({ page }) => {
  await openGame(page);
  // The tank last saw the player right where it stands, and an obstacle hides the player now.
  const [tank] = await arrange(page, {
    obstacles: [{ x: 0, z: -30, r: 8 }],
    enemies: [{ x: 0, z: -60, yaw: Math.PI, lastSeen: { x: 0, z: -60 } }],
  });
  const start = (await probe(page)).enemies.find((e) => e.id === tank);
  await page.clock.runFor(5000);
  const later = (await probe(page)).enemies.find((e) => e.id === tank);
  expect(Math.hypot(later.x - start.x, later.z - start.z)).toBeGreaterThan(5);
});

test('a holding tank that lost the player also searches instead of parking', async ({ page }) => {
  await openGame(page);
  const [tank] = await arrange(page, {
    obstacles: [{ x: 0, z: -30, r: 8 }],
    enemies: [{ x: 0, z: -60, yaw: Math.PI, tactic: 'hold_and_suppress', lastSeen: { x: 0, z: -60 } }],
  });
  const start = (await probe(page)).enemies.find((e) => e.id === tank);
  // It keeps one search spot until it gets there (15-30 units away, so not within the first second).
  await page.clock.runFor(100);
  const spot = (await probe(page)).enemies.find((e) => e.id === tank).lastSeen;
  await page.clock.runFor(1000);
  expect((await probe(page)).enemies.find((e) => e.id === tank).lastSeen).toEqual(spot);
  await page.clock.runFor(3900);
  const later = (await probe(page)).enemies.find((e) => e.id === tank);
  expect(Math.hypot(later.x - start.x, later.z - start.z)).toBeGreaterThan(5);
});
