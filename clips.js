const { askGemini } = require("./gemini");

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

    const prompt =
      "Find the 5 to 8 best moments in this video for short clips " +
      "(funny, surprising, useful or emotional). Each clip must be about 1 minute long, between 55 and 65 seconds, never longer. " +
      "Reply ONLY with JSON: " +
      '{"moments":[{"title":"","reason":"","start":0,"end":0,"score":7.5,"captions":[{"at":0,"text":""}]}]} ' +
      "start and end are whole seconds in the video. " +
      "score is how likely the clip is to go viral, 1 to 10, one decimal. captions are short subtitle lines (3 to 7 words) of what is said, " +
      "one every 2 to 3 seconds. at is seconds from the START of the clip.";

    const out = await askGemini(
      [
        { file_data: { file_uri: "https://www.youtube.com/watch?v=" + id } },
        { text: prompt },
      ],
      {
        json: true,
        maxOutputTokens: 8000,
        timeoutMs: 120000,
        generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW" },
      }
    );

    const parsed = JSON.parse(out.text.replace(/```json|```/g, "").trim());
    const moments = (parsed.moments || [])
      .map((m) => ({
        title: String(m.title || "Moment"),
        reason: String(m.reason || ""),
        start: Math.max(0, Math.floor(Number(m.start))),
        end: Math.floor(Number(m.end)),
        score: Math.min(10, Math.max(0, Number(m.score) || 0)),
        captions: (Array.isArray(m.captions) ? m.captions : [])
          .map((c) => ({ at: Number(c.at), text: String(c.text || "").slice(0, 80) }))
          .filter((c) => Number.isFinite(c.at) && c.at >= 0 && c.text)
          .sort((a, b) => a.at - b.at)
          .slice(0, 40),
      }))
      .map((m) => ({ ...m, end: Math.min(m.end, m.start + 65) }))
      .filter((m) => Number.isFinite(m.start) && Number.isFinite(m.end) && m.end > m.start)
      .sort((a, b) => a.start - b.start)
      .slice(0, 8);

    send(res, 200, { id, moments });
  } catch (e) {
    send(res, 500, { error: "Failed: " + e.message });
  }
};
