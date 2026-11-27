const { TACTICS } = require('./tactics');

const SYSTEM_PROMPT = [
  'You command the enemy tanks in a wireframe arcade tank battle against one human player.',
  'Each turn you get a short summary: the wave, the player\'s heading and lives, and each tank\'s position relative to where the player was last seen',
  '(dx, dz in world units; the player looks along -z when yaw is 0), its type and hit points, plus kills and losses since your last orders.',
  'Your tanks only know what they can see. player.seen says whether any tank sees the player now; player.lastSeenS is how many seconds ago one last did.',
  'When the player is not seen, the position and heading are from that last sighting, and the player may have moved since.',
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
      maxItems: 10,
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, tactic: { type: 'string', enum: TACTICS } },
        required: ['id', 'tactic'],
      },
    },
  },
  required: ['orders'],
};

// usage: token counts when Google answered (it bills those even if the answer was unusable), else null.
class GeminiError extends Error {
  constructor(message, usage = null) {
    super(message);
    this.usage = usage;
  }
}

// Calls generateContent and returns the parsed JSON plus token usage. Throws GeminiError on any failure.
function makeGeminiClient({ apiKey, model, timeoutSeconds, fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return async function askGemini(summary) {
    let response;
    try {
      response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(summary) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // Gemini 3 thinks by default and bills thinking as output; keep it minimal (WF-7 budget).
          thinkingConfig: { thinkingLevel: 'minimal' },
          maxOutputTokens: 300,
        },
      }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      });
    } catch (error) {
      throw new GeminiError(`Gemini request failed: ${error.message}`);
    }
    if (!response.ok) throw new GeminiError(`Gemini HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
    const data = await response.json().catch(() => null);
    const usage = (data && data.usageMetadata) || null;
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map((part) => part.text || '').join('') : '';
    if (!text) throw new GeminiError('Gemini returned no text', usage);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GeminiError('Gemini returned text that is not JSON', usage);
    }
    return { json, usage };
  };
}

module.exports = { makeGeminiClient, GeminiError, SYSTEM_PROMPT, RESPONSE_SCHEMA };
