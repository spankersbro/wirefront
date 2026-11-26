const { TACTICS } = require('./tactics');

const SYSTEM_PROMPT = [
  'You command the enemy tanks in a wireframe arcade tank battle against one human player.',
  'Each turn you get a short summary: the wave, the player\'s heading and lives, and each tank\'s position relative to the player',
  '(dx, dz in world units; the player looks along -z when yaw is 0), its type and hit points, plus kills and losses since your last orders.',
  'Give every tank exactly one tactic:',
  'flank_left / flank_right: circle around the player on that side; advance: close in head on;',
  'hold_and_suppress: stop at range and keep firing; retreat: back off out of easy range.',
  'Coordinate the tanks: mix tactics so the player cannot face them all at once. Scouts are fast and fragile, heavies slow and tough.',
].join(' ');

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    orders: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, tactic: { type: 'string', enum: TACTICS } },
        required: ['id', 'tactic'],
      },
    },
  },
  required: ['orders'],
};

// Calls generateContent and returns the parsed JSON the model produced. Throws on any failure.
function makeGeminiClient({ apiKey, model, timeoutSeconds, fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return async function askGemini(summary) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(summary) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.8,
          maxOutputTokens: 400,
        },
      }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
    const data = await response.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
      && data.candidates[0].content.parts && data.candidates[0].content.parts.map((part) => part.text || '').join('');
    if (!text) throw new Error('Gemini returned no text');
    return { json: JSON.parse(text), usage: data.usageMetadata || null };
  };
}

module.exports = { makeGeminiClient, SYSTEM_PROMPT, RESPONSE_SCHEMA };
