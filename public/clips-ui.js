// clips-ui.js (goes in the public folder with clips.html and clips-style.css).
// The page sends the YouTube link to /api/research/clips (clips.js on the server)
// and shows each best moment as a card that plays only that part of the video.
(function () {
  'use strict';

  var ID_RE = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/;
  var form = document.getElementById('form');
  var input = document.getElementById('url');
  var goBtn = document.getElementById('go');
  var statusBox = document.getElementById('status');
  var out = document.getElementById('out');

  var PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  // 75 -> "1:15", 3725 -> "1:02:05"
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var ss = (s < 10 ? '0' : '') + s;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + ss;
    return m + ':' + ss;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); }
      document.body.removeChild(ta);
    });
  }

  function showLoading() {
    statusBox.textContent = '';
    var box = el('div', 'load');
    box.appendChild(el('span', 'spin'));
    var t = el('div');
    t.appendChild(document.createTextNode('Watching the video and finding the best moments…'));
    t.appendChild(el('small', '', 'This can take up to a minute for long videos.'));
    box.appendChild(t);
    statusBox.appendChild(box);
  }

  function showMessage(msg) {
    statusBox.textContent = '';
    statusBox.appendChild(el('div', 'warn', msg));
  }

  function clearStatus() { statusBox.textContent = ''; }

  // ---- Clean clip player: plays only the cut part of YOUR OWN video file ----
  var localUrl = null;
  var pick = el('div', 'localpick');
  var pickBtn = el('button', 'btn alt', 'Choose my video file (for clean clips)');
  pick.style.cssText = 'margin:12px 0';
  pickBtn.type = 'button';
  var pickInfo = el('small', '', 'Optional. Pick the same video file once. Clips then play with no YouTube.');
  var fileIn = document.createElement('input');
  fileIn.type = 'file';
  fileIn.accept = 'video/*';
  fileIn.style.display = 'none';
  pickBtn.onclick = function () { fileIn.click(); };
  fileIn.onchange = function () {
    var f = fileIn.files && fileIn.files[0];
    if (!f) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = URL.createObjectURL(f);
    pickBtn.textContent = 'Video chosen: ' + f.name;
    pickInfo.textContent = 'Now tap play on any clip.';
  };
  pick.appendChild(pickBtn);
  pick.appendChild(pickInfo);
  pick.appendChild(fileIn);
  out.parentNode.insertBefore(pick, out);

  function cleanPlayer(player, m) {
    player.textContent = '';
    player.style.cssText = 'aspect-ratio:auto;height:auto;padding:0;max-width:340px;margin:0 auto;background:#000;border-radius:16px;overflow:hidden;position:relative';
    var len = m.end - m.start;
    var caps = m.captions || [];

    var box = el('div', '');
    box.style.cssText = 'position:relative;width:100%;aspect-ratio:9/16;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden';
    var v = document.createElement('video');
    v.src = localUrl;
    v.playsInline = true;
    v.preload = 'auto';
    v.style.cssText = 'width:100%;height:auto;max-height:100%;display:block';
    var bg = document.createElement('canvas');
    bg.width = 64; bg.height = 114;
    bg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;filter:blur(18px) brightness(.7);transform:scale(1.3)';
    var bgx = bg.getContext('2d');
    var bgTimer = setInterval(function () {
      if (!document.body.contains(bg)) { clearInterval(bgTimer); return; }
      try { if (v.videoWidth) bgx.drawImage(v, 0, 0, bg.width, bg.height); } catch (e) {}
    }, 200);
    var cap = el('div', '', '');
    cap.style.cssText = 'position:absolute;left:8px;right:8px;bottom:18%;text-align:center;color:#fff;font-weight:800;font-size:22px;line-height:1.2;text-transform:uppercase;text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000;pointer-events:none';
    box.appendChild(bg);
    box.appendChild(v);
    box.appendChild(cap);
    v.style.position = 'relative';

    var bar = el('div', 'cleanbar');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:#111;color:#fff;font-size:14px';
    var pb = el('button', '', '⏸');
    pb.type = 'button';
    pb.style.cssText = 'background:none;border:0;color:#fff;font-size:20px;padding:4px 8px';
    var rng = document.createElement('input');
    rng.type = 'range'; rng.min = 0; rng.max = len; rng.step = 0.1; rng.value = 0;
    rng.style.cssText = 'flex:1;min-width:0';
    var tm = el('span', '', '0:00 / ' + fmt(len));
    bar.appendChild(pb); bar.appendChild(rng); bar.appendChild(tm);

    function toStart() { v.currentTime = m.start; }
    function showCap(t) {
      var text = '';
      for (var k = 0; k < caps.length; k++) {
        if (caps[k].at <= t) text = (t - caps[k].at < 4) ? caps[k].text : '';
        else break;
      }
      cap.textContent = text;
    }
    v.addEventListener('loadedmetadata', function () { toStart(); v.play(); });
    v.addEventListener('timeupdate', function () {
      if (v.currentTime >= m.end) { v.pause(); toStart(); pb.textContent = '▶'; }
      var t = Math.min(len, Math.max(0, v.currentTime - m.start));
      rng.value = t;
      tm.textContent = fmt(t) + ' / ' + fmt(len);
      showCap(t);
    });
    v.addEventListener('play', function () { pb.textContent = '⏸'; });
    v.addEventListener('pause', function () { pb.textContent = '▶'; });
    pb.onclick = function () { if (v.paused) v.play(); else v.pause(); };
    rng.oninput = function () { v.currentTime = m.start + Number(rng.value); };
    v.onclick = pb.onclick;

    player.appendChild(box);
    player.appendChild(bar);
    if (m.score) {
      var sc = el('div', '', '🔥 ' + m.score.toFixed(1));
      sc.style.cssText = 'text-align:center;color:#fff;font-weight:700;padding:8px;background:#111';
      player.appendChild(sc);
    }
  }

  // ---- Download a clip: cut from YOUR OWN chosen video file, captions burned in ----
  // Records the clip in real time (about as long as the clip) into a 9:16 video file.
  function pickMime() {
    if (!window.MediaRecorder) return '';
    var list = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (var i = 0; i < list.length; i++) {
      if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function wrapText(ctx, text, maxW) {
    var words = text.split(' ');
    var lines = [];
    var line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  // No file chosen: the server downloads the clip from the YouTube link (yt-dlp + ffmpeg).
  function serverDownload(id, m, btn, reset) {
    btn.disabled = true;
    btn.textContent = 'Cutting on server…';
    fetch('/api/research/download', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, start: m.start, end: m.end, title: m.title, captions: m.captions || [] })
    })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            throw new Error(d.error || 'Server error');
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var name = (m.title || 'clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'clip';
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name + '.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
        reset('Saved ✓', 3000);
      })
      .catch(function (e) {
        reset(String(e.message || 'Download failed').slice(0, 60), 6000);
      });
  }

  function downloadClip(m, btn, id) {
    var label = 'Download clip';
    function reset(msg, ms) {
      btn.disabled = false;
      btn.textContent = msg || label;
      if (msg) setTimeout(function () { btn.textContent = label; }, ms || 3000);
    }

    if (!localUrl) {
      serverDownload(id, m, btn, reset);
      return;
    }
    var mime = pickMime();
    if (!mime || !HTMLCanvasElement.prototype.captureStream) {
      reset('Not supported in this browser', 4000);
      return;
    }

    var W = 720, H = 1280;
    var len = m.end - m.start;
    var caps = m.captions || [];
    btn.disabled = true;
    btn.textContent = 'Preparing…';

    var v = document.createElement('video');
    v.src = localUrl;
    v.playsInline = true;
    v.preload = 'auto';

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var small = document.createElement('canvas');
    small.width = 36; small.height = 64;
    var sctx = small.getContext('2d');

    // Audio goes to the recording only, so nothing plays out loud.
    var AC = window.AudioContext || window.webkitAudioContext;
    var ac = new AC();
    if (ac.resume) ac.resume();
    var dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(v).connect(dest);

    var stream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });

    var chunks = [];
    var rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime }); }
    catch (e) { ac.close(); reset('Could not start recording', 4000); return; }
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

    var running = false;
    function cleanup() {
      running = false;
      v.pause();
      v.removeAttribute('src');
      v.load();
      try { ac.close(); } catch (e) {}
    }

    rec.onstop = function () {
      var ext = mime.indexOf('mp4') > -1 ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: mime.split(';')[0] });
      var name = (m.title || 'clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'clip';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      cleanup();
      reset('Saved ✓', 3000);
    };

    function currentCaption(t) {
      var text = '';
      for (var k = 0; k < caps.length; k++) {
        if (caps[k].at <= t) text = (t - caps[k].at < 4) ? caps[k].text : '';
        else break;
      }
      return text;
    }

    function draw() {
      if (!running) return;
      var vw = v.videoWidth, vh = v.videoHeight;
      if (vw) {
        // Blurred, darkened background (small frame stretched up)
        sctx.drawImage(v, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(small, 0, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, W, H);
        // Video centered, fitted inside 9:16
        var s = Math.min(W / vw, H / vh);
        var dw = vw * s, dh = vh * s;
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        // Captions
        var t = Math.max(0, v.currentTime - m.start);
        var text = currentCaption(t).toUpperCase();
        if (text) {
          ctx.font = '800 46px -apple-system, "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 9;
          ctx.strokeStyle = '#000';
          ctx.fillStyle = '#fff';
          var lines = wrapText(ctx, text, W - 80);
          var y = H * 0.8 - (lines.length - 1) * 56;
          lines.forEach(function (ln, i) {
            ctx.strokeText(ln, W / 2, y + i * 56);
            ctx.fillText(ln, W / 2, y + i * 56);
          });
        }
        btn.textContent = 'Recording ' + fmt(Math.min(len, t)) + ' / ' + fmt(len);
      }
      if (v.currentTime >= m.end || v.ended) {
        running = false;
        if (rec.state !== 'inactive') rec.stop();
        return;
      }
      requestAnimationFrame(draw);
    }

    v.addEventListener('error', function () {
      if (rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
      cleanup();
      reset('Could not read the video file', 4000);
    });
    v.addEventListener('loadedmetadata', function () { v.currentTime = m.start; });
    v.addEventListener('seeked', function onSeeked() {
      v.removeEventListener('seeked', onSeeked);
      running = true;
      rec.start(1000);
      v.play().then(function () { requestAnimationFrame(draw); })
        .catch(function () {
          running = false;
          rec.onstop = null;
          if (rec.state !== 'inactive') rec.stop();
          cleanup();
          reset('Could not play the video', 4000);
        });
    });
  }

  var ytPromise = null;
  function loadYT() {
    if (ytPromise) return ytPromise;
    ytPromise = new Promise(function (resolve) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (prev) prev();
        resolve(window.YT);
      };
      var tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
    return ytPromise;
  }

  function card(id, m, i) {
    var c = el('article', 'clip');

    var player = el('div', 'player');
    var img = document.createElement('img');
    img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    img.alt = '';
    img.loading = 'lazy';
    player.appendChild(img);

    var play = el('button', 'playbtn');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play ' + m.title);
    play.innerHTML = '<span>' + PLAY_ICON + '</span>';
    player.appendChild(play);
    player.appendChild(el('span', 'time', fmt(m.start) + ' – ' + fmt(m.end)));

    // The video loads only when you tap play. start and end make it play just this moment.
    play.onclick = function () {
      if (localUrl) { cleanPlayer(player, m); return; }
      player.textContent = '';
      var holder = document.createElement('div');
      player.appendChild(holder);
      loadYT().then(function (YT) {
        var timer = null;
        var yp = new YT.Player(holder, {
          videoId: id,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { start: m.start, autoplay: 1, rel: 0, playsinline: 1 },
          events: {
            onReady: function (e) {
              e.target.seekTo(m.start, true);
              e.target.playVideo();
              timer = setInterval(function () {
                var t = 0;
                try { t = yp.getCurrentTime(); } catch (x) { return; }
                if (t >= m.end) {
                  yp.pauseVideo();
                  yp.seekTo(m.start, true);
                }
              }, 250);
            }
          }
        });
      });
    };

    var info = el('div', 'info');
    var h = el('h2');
    h.appendChild(el('span', 'num', String(i + 1)));
    h.appendChild(document.createTextNode(m.title));
    info.appendChild(h);
    if (m.reason) info.appendChild(el('p', '', m.reason));
    info.appendChild(el('p', '', 'Length: ' + fmt(m.end - m.start)));

    var row = el('div', 'row');
    var link = 'https://youtu.be/' + id + '?t=' + m.start;

    var cp = el('button', 'btn alt small', 'Copy link');
    cp.type = 'button';
    cp.onclick = function () {
      copyText(link)
        .then(function () { cp.textContent = 'Copied ✓'; })
        .catch(function () { cp.textContent = 'Copy failed'; });
      setTimeout(function () { cp.textContent = 'Copy link'; }, 2000);
    };

    var op = el('a', 'btn alt small', 'Open on YouTube');
    op.href = link;
    op.target = '_blank';
    op.rel = 'noopener';

    row.appendChild(cp);
    row.appendChild(op);

    var dl = el('button', 'btn small', 'Download clip');
    dl.type = 'button';
    dl.onclick = function () { downloadClip(m, dl, id); };
    row.appendChild(dl);

    if (window.addCutButtons) window.addCutButtons(row, m);
    info.appendChild(row);

    c.appendChild(player);
    c.appendChild(info);
    return c;
  }

  function render(d) {
    out.textContent = '';
    if (!d.moments || !d.moments.length) {
      showMessage(d.reason || 'No clear moments found in this video.');
      return;
    }
    clearStatus();
    d.moments.forEach(function (m, i) { out.appendChild(card(d.id, m, i)); });
    out.firstChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = input.value.trim();
    if (!ID_RE.test(url)) {
      showMessage('That does not look like a YouTube link. Paste the full link to a video.');
      return;
    }
    out.textContent = '';
    goBtn.disabled = true;
    goBtn.textContent = 'Working…';
    showLoading();

    fetch('/api/research/clips?url=' + encodeURIComponent(url), { credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.error) { showMessage(d.error); return; }
        render(d || {});
      })
      .catch(function () { showMessage('Could not reach the server. Check your internet and try again.'); })
      .then(function () {
        goBtn.disabled = false;
        goBtn.textContent = 'Find clips';
      });
  });
})();
