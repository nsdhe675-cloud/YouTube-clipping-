// clips-cut.js (server). Cuts a clip out of a video file the person uploads.
// Needs ffmpeg installed on the server. No extra npm packages.
//
// Plain Node http:
//   const cut = require('./clips-cut');
//   if (req.method === 'POST' && req.url.startsWith('/api/research/cut')) return cut(req, res);
// Express:
//   app.post('/api/research/cut', require('./clips-cut'));
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB upload limit
var MAX_CLIP_SECONDS = 180;             // Shorts are up to 3 minutes

function fail(res, code, msg) {
  if (res.headersSent) return res.end();
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: msg }));
}

function cleanup(files) {
  files.forEach(function (f) { fs.unlink(f, function () {}); });
}

module.exports = function cutHandler(req, res) {
  var q = new URL(req.url, 'http://localhost').searchParams;
  var start = Number(q.get('start'));
  var end = Number(q.get('end'));
  var vertical = q.get('vertical') === '1';

  if (!isFinite(start) || !isFinite(end) || start < 0 || end <= start) {
    return fail(res, 400, 'Start and end times are not valid.');
  }
  if (end - start > MAX_CLIP_SECONDS) {
    return fail(res, 400, 'Clip is too long. The limit is 3 minutes.');
  }

  var id = crypto.randomBytes(8).toString('hex');
  var inFile = path.join(os.tmpdir(), 'cut-in-' + id);
  var outFile = path.join(os.tmpdir(), 'cut-out-' + id + '.mp4');
  var files = [inFile, outFile];

  var received = 0;
  var tooBig = false;
  var sink = fs.createWriteStream(inFile);

  req.on('data', function (chunk) {
    received += chunk.length;
    if (received > MAX_BYTES && !tooBig) {
      tooBig = true;
      sink.destroy();
      req.destroy();
      cleanup(files);
      fail(res, 413, 'File is too big. The limit is 2 GB.');
    }
  });
  req.on('error', function () { cleanup(files); });
  req.pipe(sink);

  sink.on('finish', function () {
    if (tooBig) return;

    var args = [
      '-y',
      '-ss', String(start),
      '-i', inFile,
      '-t', String(end - start),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart'
    ];
    if (vertical) {
      // Centre-crop to 9:16 and scale to 1080x1920 for YouTube Shorts.
      args.push('-vf', 'crop=ih*9/16:ih,scale=1080:1920');
    }
    args.push(outFile);

    var ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'ignore'] });

    ff.on('error', function () {
      cleanup(files);
      fail(res, 500, 'ffmpeg is not installed on the server.');
    });

    ff.on('close', function (code) {
      if (code !== 0) {
        cleanup(files);
        return fail(res, 500, 'Could not cut this file. Make sure it is a video.');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="clip.mp4"');
      var rs = fs.createReadStream(outFile);
      rs.pipe(res);
      res.on('close', function () { cleanup(files); });
    });
  });
};
