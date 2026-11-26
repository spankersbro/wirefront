// The fight summary the game sends, and the orders Gemini may give back.
const TACTICS = ['flank_left', 'flank_right', 'hold_and_suppress', 'advance', 'retreat'];
const VARIANTS = ['scout', 'standard', 'heavy'];
const MAX_TANKS = 10;

class BadRequest extends Error {}

function isFiniteNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Accepts only the exact shape the game sends, so nothing else reaches the prompt.
function parseSummary(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('body must be an object');
  const { wave, player, tanks, sinceLastOrders } = body;
  if (!isInteger(wave, 1, 999)) throw new BadRequest('wave');
  if (!player || !isFiniteNumber(player.yaw, -100, 100) || !isInteger(player.lives, 0, 9)) throw new BadRequest('player');
  if (!Array.isArray(tanks) || tanks.length < 1 || tanks.length > MAX_TANKS) throw new BadRequest('tanks');
  const ids = new Set();
  const cleanTanks = tanks.map((tank) => {
    if (!tank || typeof tank.id !== 'string' || !/^[a-z0-9]{1,8}$/.test(tank.id) || ids.has(tank.id)) throw new BadRequest('tank id');
    if (!VARIANTS.includes(tank.variant)) throw new BadRequest('tank variant');
    if (!isFiniteNumber(tank.dx, -400, 400) || !isFiniteNumber(tank.dz, -400, 400)) throw new BadRequest('tank position');
    if (!isInteger(tank.hp, 0, 9)) throw new BadRequest('tank hp');
    ids.add(tank.id);
    return { id: tank.id, variant: tank.variant, dx: round(tank.dx), dz: round(tank.dz), hp: tank.hp };
  });
  const since = sinceLastOrders || { kills: 0, losses: 0 };
  if (!isInteger(since.kills, 0, 99) || !isInteger(since.losses, 0, 99)) throw new BadRequest('sinceLastOrders');
  return {
    wave,
    player: { yaw: round(player.yaw), lives: player.lives },
    tanks: cleanTanks,
    sinceLastOrders: { kills: since.kills, losses: since.losses },
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

// Keeps only orders for tanks we asked about, with a known tactic; anything else is dropped.
function parseOrders(geminiJson, summary) {
  const ids = new Set(summary.tanks.map((tank) => tank.id));
  const orders = Array.isArray(geminiJson && geminiJson.orders) ? geminiJson.orders : [];
  const seen = new Set();
  return orders.filter((order) => {
    const valid = order && ids.has(order.id) && TACTICS.includes(order.tactic) && !seen.has(order.id);
    if (valid) seen.add(order.id);
    return valid;
  }).map((order) => ({ id: order.id, tactic: order.tactic }));
}

module.exports = { TACTICS, VARIANTS, MAX_TANKS, BadRequest, parseSummary, parseOrders };
