const http = require('node:http');
const { BadRequest, parseSummary, parseOrders } = require('./tactics');

const MAX_BODY_BYTES = 8 * 1024;

// All outside services are passed in, so tests can replace them.
function createServer({ verifyToken, askGemini, dailyUsage, allowedOrigins, minIntervalSeconds, now = Date.now, log }) {
  const lastCallAt = new Map();

  function setCors(req, res) {
    const origin = req.headers.origin;
    res.setHeader('vary', 'origin');
    if (!allowedOrigins.includes(origin)) return false;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'POST');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-max-age', '600');
    return true;
  }

  function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new BadRequest('body too large');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BadRequest('body is not JSON');
    }
  }

  // One call per uid per interval. Old entries are pruned so the map stays small.
  function tooSoon(uid) {
    const at = now();
    for (const [key, time] of lastCallAt) if (at - time > minIntervalSeconds * 1000) lastCallAt.delete(key);
    if (lastCallAt.has(uid)) return true;
    lastCallAt.set(uid, at);
    return false;
  }

  async function handleTactics(req, res) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    let uid;
    try {
      uid = await verifyToken(token);
    } catch {
      return send(res, 401, { error: 'sign-in required' });
    }

    let summary;
    try {
      summary = parseSummary(await readJson(req));
    } catch (error) {
      if (error instanceof BadRequest) return send(res, 400, { error: error.message });
      throw error;
    }

    if (tooSoon(uid)) return send(res, 429, { source: 'scripted', reason: 'too-soon' });
    if (!(await dailyUsage.reserve())) {
      log('warning', 'daily Gemini call limit reached');
      return send(res, 200, { source: 'scripted', reason: 'daily-limit' });
    }

    try {
      const { json, usage } = await askGemini(summary);
      const orders = parseOrders(json, summary);
      log('info', 'gemini orders', { tanks: summary.tanks.length, orders: orders.length, usage });
      return send(res, 200, { source: 'gemini', orders });
    } catch (error) {
      log('warning', 'gemini call failed', { error: error.message });
      return send(res, 200, { source: 'scripted', reason: 'gemini-error' });
    }
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
      if (req.url !== '/tactics') return send(res, 404, { error: 'not found' });
      const corsOk = setCors(req, res);
      if (!corsOk) return send(res, 403, { error: 'origin not allowed' });
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      return await handleTactics(req, res);
    } catch (error) {
      log('error', 'unexpected error', { error: error.stack });
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    }
  });
}

module.exports = { createServer, MAX_BODY_BYTES };
