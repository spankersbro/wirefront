const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeGeminiClient, GeminiError } = require('../src/gemini');

const SUMMARY = { wave: 1, player: { yaw: 0, lives: 3 }, tanks: [{ id: 't1', variant: 'scout', dx: 1, dz: 2, hp: 1 }], sinceLastOrders: { kills: 0, losses: 0 } };

function fakeFetch(reply) {
  const requests = [];
  const impl = async (url, init) => { requests.push({ url, init }); return reply; };
  return { impl, requests };
}

const okReply = (text) => ({ ok: true, status: 200, text: async () => text, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { totalTokenCount: 321 } }) });

test('sends the summary to the pinned model with the key in a header, asking for JSON', async () => {
  const fake = fakeFetch(okReply('{"orders":[{"id":"t1","tactic":"advance"}]}'));
  const ask = makeGeminiClient({ apiKey: 'k-123', model: 'gemini-3.1-flash-lite', timeoutSeconds: 4, fetchImpl: fake.impl });
  const result = await ask(SUMMARY);
  assert.deepEqual(result, { json: { orders: [{ id: 't1', tactic: 'advance' }] }, usage: { totalTokenCount: 321 } });
  const { url, init } = fake.requests[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
  assert.equal(init.headers['x-goog-api-key'], 'k-123');
  assert.ok(!url.includes('k-123'), 'key must not be in the URL, where it would be logged');
  const body = JSON.parse(init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(body.generationConfig.responseSchema.properties.orders.maxItems, 10);
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), SUMMARY);
});

test('an HTTP error, network error, empty answer or non-JSON answer throws GeminiError', async () => {
  const cases = [
    'network',
    // An error status must throw even when the body happens to look like an answer.
    { ...okReply('{"orders":[]}'), ok: false, status: 503 },
    { ok: true, status: 200, json: async () => ({ candidates: [] }) },
    okReply('not json'),
  ];
  for (const reply of cases) {
    const fetchImpl = reply === 'network' ? async () => { throw new TypeError('fetch failed'); } : fakeFetch(reply).impl;
    const ask = makeGeminiClient({ apiKey: 'k', model: 'm', timeoutSeconds: 4, fetchImpl });
    await assert.rejects(ask(SUMMARY), GeminiError);
  }
});
