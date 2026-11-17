'use strict';
// gemini.js: asks Gemini and tries several models in order.
// If a model is retired, busy or over its limit, the next one is tried.
// Needs GEMINI_API_KEY in Render. GEMINI_MODEL is optional (it is tried first).

const MODELS = () => [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-lite-latest']
  .filter((x, i, a) => x && a.indexOf(x) === i);

async function askGemini(parts, opts) {
  opts = opts || {};
  const key = opts.key || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');
  const config = Object.assign({ temperature: 0, maxOutputTokens: opts.maxOutputTokens || 2000 }, opts.generationConfig || {});
  if (opts.json) config.responseMimeType = 'application/json';

  let lastError = 'The AI did not answer.';
  for (const model of MODELS()) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 70000);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: ctl.signal,
        body: JSON.stringify({ contents: [{ parts }], generationConfig: config }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const ps = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const text = ps.map((x) => x.text || '').join('');
        if (text) return { text, model, raw: j };
        lastError = 'The AI gave an empty answer.';
        continue;
      }
      const msg = String((j && j.error && j.error.message) || '').slice(0, 200);
      console.error('Gemini', model, r.status, msg);
      lastError = 'Gemini ' + r.status + (msg ? ': ' + msg : '');
      if (r.status === 401 || (r.status === 400 && /api key/i.test(msg))) throw new Error('Google did not accept GEMINI_API_KEY. Check it in Render.');
    } catch (e) {
      if (e && /GEMINI_API_KEY/.test(e.message || '')) throw e;
      lastError = e && e.name === 'AbortError' ? 'The AI took too long to answer.' : 'Could not reach the AI.';
    } finally { clearTimeout(timer); }
  }
  throw new Error(lastError);
}

module.exports = { askGemini, MODELS };
