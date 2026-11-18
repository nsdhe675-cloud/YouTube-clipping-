// download.js (goes next to clips.js on the server).
// POST /api/research/download  with JSON: { id, start, end, title, captions: [{at, text}] }
// 1) yt-dlp downloads ONLY the section start..end of the video
// 2) ffmpeg makes it vertical 9:16 (blurred background) with the captions burned in
// 3) the finished MP4 is sent back to the browser.
//
// Needs on the server: yt-dlp and ffmpeg (both on PATH). Keep yt-dlp up to date.
// Optional env:
//   YTDLP_COOKIES=/path/to/cookies.txt   (helps when YouTube blocks the server;
//                                         the file is copied first, so read-only
//                                         Render Secret Files work)
//   ALLOWED_CHANNEL_IDS=UCxxxx,UCyyyy    (only these channels can be downloaded)

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_SECONDS = 65;
const MAX_PARALLEL = 2;
const TIMEOUT_MS = 4 * 60 * 1000;
const ALLOWED = (process.env.ALLOWED_CHANNEL_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let running = 0;

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 100000) { reject(new Error("Body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Runs a command. Resolves with stdout. On failure, the error message is the
// real "ERROR:" line from the tool (not just the last warning).
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out = (out + d).slice(-20000); });
    p.stderr.on("data", (d) => { err = (err + d).slice(-8000); });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(cmd + " timed out")); }, TIMEOUT_MS);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === "ENOENT" ? cmd + " is not installed on the server" : e.message));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const lines = err.split("\n").map((l) => l.trim()).filter(Boolean);
      const bad = lines.slice().reverse().find((l) => /ERROR/i.test(l)) || lines[lines.length - 1] || "unknown error";
      reject(new Error(cmd + " failed: " + bad.slice(0, 300)));
    });
  });
}

function srtTime(s) {
  const ms = Math.round((s % 1) * 1000);
  const t = Math.floor(s);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)},${p(ms, 3)}`;
}

function makeSrt(caps, len) {
  let out = "";
  caps.forEach((c, i) => {
    const start = c.at;
    const next = caps[i + 1] ? caps[i + 1].at : start + 3;
    const end = Math.min(len, Math.max(start + 0.8, Math.min(next, start + 4)));
    if (start >= len) return;
    out += `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${c.text.toUpperCase()}\n\n`;
  });
  return out;
}

module.exports = async function download(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  if (running >= MAX_PARALLEL) return send(res, 429, { error: "Server is busy. Try again in a minute." });

  let dir;
  running++;
  try {
    const body = JSON.parse(await readBody(req));
    const id = String(body.id || "");
    const start = Math.max(0, Math.floor(Number(body.start)));
    let end = Math.floor(Number(body.end));
    if (!/^[\w-]{11}$/.test(id)) return send(res, 400, { error: "Bad video id" });
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return send(res, 400, { error: "Bad time range" });
    end = Math.min(end, start + MAX_SECONDS);
    const len = end - start;

    const caps = (Array.isArray(body.captions) ? body.captions : [])
      .map((c) => ({ at: Number(c.at), text: String(c.text || "").replace(/[\r\n]+/g, " ").slice(0, 80) }))
      .filter((c) => Number.isFinite(c.at) && c.at >= 0 && c.text)
      .sort((a, b) => a.at - b.at)
      .slice(0, 40);

    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));

    // Common yt-dlp args. Cookies are copied into the temp dir because yt-dlp
    // wants to write to the cookie file (fails on read-only Secret Files).
    const common = ["--no-playlist"];
    const cookieSrc = process.env.YTDLP_COOKIES;
    if (cookieSrc && fs.existsSync(cookieSrc)) {
      const cookieCopy = path.join(dir, "cookies.txt");
      fs.copyFileSync(cookieSrc, cookieCopy);
      common.push("--cookies", cookieCopy);
    }
    const videoUrl = "https://www.youtube.com/watch?v=" + id;

    // 0) Optional: only allow videos from approved channels
    if (ALLOWED.length) {
      const printed = await run("yt-dlp", [...common, "--skip-download", "--print", "%(channel_id)s", videoUrl]);
      const cid = printed.trim().split("\n")[0];
      if (!ALLOWED.includes(cid)) return send(res, 403, { error: "This channel is not allowed." });
    }

    // 1) yt-dlp: fetch only this section
    await run("yt-dlp", [
      ...common,
      "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--download-sections", `*${start}-${end}`,
      "--force-keyframes-at-cuts",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, "src.%(ext)s"),
      videoUrl,
    ]);

    const src = fs.readdirSync(dir).find((f) => f.startsWith("src."));
    if (!src) throw new Error("Download produced no file");

    // 2) ffmpeg: 9:16 with blurred background, captions burned in
    const base =
      "[0:v]split=2[a][b];" +
      "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.15[bg];" +
      "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];" +
      "[bg][fg]overlay=(W-w)/2:(H-h)/2";
    const style = "Fontsize=14,Bold=1,Outline=2,Shadow=0,Alignment=2,MarginV=55";
    const encode = (filter) => [
      "-y", "-i", path.join(dir, src),
      "-filter_complex", filter,
      "-map", "[v]", "-map", "0:a?",
      "-t", String(len),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      path.join(dir, "out.mp4"),
    ];

    let done = false;
    if (caps.length) {
      fs.writeFileSync(path.join(dir, "cap.srt"), makeSrt(caps, len));
      try {
        // relative srt path + cwd avoids filter-escaping problems
        await run("ffmpeg", encode(`${base},subtitles=cap.srt:force_style='${style}'[v]`), { cwd: dir });
        done = true;
      } catch (e) {
        if (/not installed/.test(e.message)) throw e;
        // ffmpeg without subtitle support: fall back to no captions
      }
    }
    if (!done) await run("ffmpeg", encode(`${base}[v]`), { cwd: dir });

    // 3) send it back
    const file = path.join(dir, "out.mp4");
    const name = String(body.title || "clip").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "clip";
    const stat = fs.statSync(file);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${name}.mp4"`,
    });
    const rs = fs.createReadStream(file);
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
    rs.on("close", cleanup);
    rs.on("error", cleanup);
    rs.pipe(res);
    dir = null; // cleanup now handled by the stream
  } catch (e) {
    console.error("download failed:", e.message);
    send(res, 500, { error: "Failed: " + e.message });
  } finally {
    running--;
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  }
};
