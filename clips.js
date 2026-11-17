const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function getId(u) {
  try {
    const x = new URL(u);
    if (x.hostname === "youtu.be") return x.pathname.slice(1, 12);
    const v = x.searchParams.get("v");
    if (v) return v;
    const m = x.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

module.exports = async function clips(req, res) {
  try {
    const link = new URL(req.url, "http://x").searchParams.get("url");
    const id = getId(link || "");
    if (!id) return send(res, 400, { error: "Bad YouTube link" });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY not set" });

    const prompt =
      "Find the 5 to 8 best moments in this video for short clips " +
      "(funny, surprising, useful or emotional). Each clip 15 to 60 seconds. " +
      "Reply ONLY with JSON: " +
      '{"moments":[{"title":"","reason":"","start":0,"end":0}]} ' +
      "start and end are whole seconds.";

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { file_data: { file_uri: "https://www.youtube.com/watch?v=" + id } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return send(res, 502, { error: data.error?.message || "AI error" });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    const moments = (parsed.moments || [])
      .map((m) => ({
        title: String(m.title || "Moment"),
        reason: String(m.reason || ""),
        start: Math.max(0, Math.floor(Number(m.start))),
        end: Math.floor(Number(m.end)),
      }))
      .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start)
      .sort((a, b) => a.start - b.start)
      .slice(0, 8);

    send(res, 200, { id, moments });
  } catch (e) {
    send(res, 500, { error: "Failed: " + e.message });
  }
};
