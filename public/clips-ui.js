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
        reset(String(e.message || 'Download failed').slice(0, 160), 8000);
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

  // ---- Studio view: swipeable vertical (9:16) clip cards with live captions ----
  var studioCss = document.createElement('style');
  studioCss.textContent = [
    '.sstrip{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px calc(50% - min(36vw,150px)) 14px;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
    '.sstrip::-webkit-scrollbar{display:none}',
    '.sclip{flex:0 0 min(72vw,300px);scroll-snap-align:center;opacity:.5;transform:scale(.94);transition:opacity .2s,transform .2s;color:#fff}',
    '.sclip.on{opacity:1;transform:none}',
    '.sbox{position:relative;aspect-ratio:9/16;border-radius:22px;overflow:hidden;background:#111}',
    '.sbg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(22px) brightness(.65);transform:scale(1.4)}',
    '.sstage{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);aspect-ratio:16/9;background:#000}',
    '.sstage .sth,.sstage video,.sstage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}',
    '.sstage .shit{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0;padding:0;z-index:2}',
    '.splay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;width:64px;height:64px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;display:flex;align-items:center;justify-content:center;padding:0}',
    '.splay svg{width:28px;height:28px}',
    '.scap{position:absolute;left:10px;right:10px;bottom:17%;z-index:3;text-align:center;font-weight:800;font-size:22px;line-height:1.2;text-transform:uppercase;pointer-events:none;text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000}',
    '.sbadge{position:absolute;top:12px;left:12px;z-index:3;background:rgba(0,0,0,.55);border-radius:999px;padding:4px 10px;font-size:13px;font-weight:700}',
    '.sbar{position:absolute;left:12px;right:12px;bottom:12px;z-index:3;display:flex;align-items:center;gap:10px;font-size:13px}',
    '.sbar input{flex:1;min-width:0}',
    '.sscore{text-align:center;font-weight:700;padding:10px 0 4px;opacity:.85}',
    '.sinfo{padding:6px 2px 0}',
    '.sinfo h2{font-size:16px;margin:0 0 6px;display:flex;gap:8px;align-items:flex-start}',
    '.sinfo p{margin:0 0 8px;font-size:14px;opacity:.75}'
  ].join('\n');
  document.head.appendChild(studioCss);

  function studioCard(id, m, i, total) {
    var len = m.end - m.start;
    var caps = m.captions || [];
    var c = el('article', 'sclip');
    var box = el('div', 'sbox');

    var thumbSrc = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    var bg = document.createElement('img');
    bg.className = 'sbg'; bg.alt = ''; bg.src = thumbSrc;
    var stage = el('div', 'sstage');
    var th = document.createElement('img');
    th.className = 'sth'; th.alt = ''; th.loading = 'lazy'; th.src = thumbSrc;
    stage.appendChild(th);

    var play = el('button', 'splay');
    play.type = 'button';
    play.setAttribute('aria-label', 'Play ' + m.title);
    play.innerHTML = PLAY_ICON;
    var cap = el('div', 'scap');
    var badge = el('div', 'sbadge', fmt(m.start) + ' – ' + fmt(m.end));
    var bar = el('div', 'sbar');
    var rng = document.createElement('input');
    rng.type = 'range'; rng.min = 0; rng.max = len; rng.step = 0.1; rng.value = 0;
    var tm = el('span', '', '0:00 / ' + fmt(len));
    bar.appendChild(rng);
    bar.appendChild(tm);

    box.appendChild(bg);
    box.appendChild(stage);
    box.appendChild(cap);
    box.appendChild(badge);
    box.appendChild(play);
    box.appendChild(bar);

    var ctl = null, ticker = null, started = false;

    function capAt(t) {
      var text = '';
      for (var k = 0; k < caps.length; k++) {
        if (caps[k].at <= t) text = (t - caps[k].at < 4) ? caps[k].text : '';
        else break;
      }
      return text;
    }
    function tick() {
      if (!document.body.contains(c)) { clearInterval(ticker); return; }
      try {
        var t = ctl.time();
        if (t >= len) { ctl.seek(0); t = 0; }
        if (t < 0) t = 0;
        rng.value = t;
        tm.textContent = fmt(t) + ' / ' + fmt(len);
        cap.textContent = capAt(t);
        play.style.display = ctl.paused() ? '' : 'none';
      } catch (e) { /* player not ready yet */ }
    }
    function toggle() {
      try {
        if (ctl.paused()) { pauseOthers(); ctl.play(); } else ctl.pause();
      } catch (e) {}
    }
    function wire() {
      var hit = el('button', 'shit');
      hit.type = 'button';
      hit.setAttribute('aria-label', 'Play or pause');
      hit.onclick = toggle;
      stage.appendChild(hit);
      pauseOthers();
      activeCtl = ctl;
      ticker = setInterval(tick, 150);
    }
    function start() {
      started = true;
      if (localUrl) {
        var v = document.createElement('video');
        v.src = localUrl; v.playsInline = true; v.preload = 'auto';
        stage.appendChild(v);
        v.addEventListener('loadedmetadata', function () { v.currentTime = m.start; v.play(); });
        ctl = {
          play: function () { v.play(); },
          pause: function () { v.pause(); },
          seek: function (t) { v.currentTime = m.start + t; },
          time: function () { return v.currentTime - m.start; },
          paused: function () { return v.paused; }
        };
        wire();
      } else {
        var holder = document.createElement('div');
        stage.appendChild(holder);
        loadYT().then(function (YT) {
          var yp = new YT.Player(holder, {
            videoId: id,
            host: 'https://www.youtube-nocookie.com',
            playerVars: { start: m.start, autoplay: 1, rel: 0, playsinline: 1, controls: 0, disablekb: 1, modestbranding: 1 },
            events: { onReady: function (e) { e.target.seekTo(m.start, true); e.target.playVideo(); } }
          });
          ctl = {
            play: function () { yp.playVideo(); },
            pause: function () { yp.pauseVideo(); },
            seek: function (t) { yp.seekTo(m.start + t, true); },
            time: function () { return yp.getCurrentTime() - m.start; },
            paused: function () { var s = yp.getPlayerState(); return s === 2 || s === 5 || s === 0; }
          };
          wire();
        });
      }
    }
    play.onclick = function () { if (!started) start(); else if (ctl) toggle(); };
    rng.oninput = function () { if (ctl) { try { ctl.seek(Number(rng.value)); } catch (e) {} } };
    c.pauseNow = function () { if (ctl) { try { ctl.pause(); } catch (e) {} } };

    c.appendChild(box);
    if (m.score) c.appendChild(el('div', 'sscore', '🔥 ' + Number(m.score).toFixed(1)));

    var info = el('div', 'sinfo');
    var h = el('h2');
    h.appendChild(el('span', 'num', String(i + 1)));
    h.appendChild(document.createTextNode(m.title));
    info.appendChild(h);
    if (m.reason) info.appendChild(el('p', '', m.reason));
    info.appendChild(el('p', '', 'Clip ' + (i + 1) + ' of ' + total + ' · ' + fmt(len)));

    var row = el('div', 'row');
    var link = 'https://youtu.be/' + id + '?t=' + m.start;

    var dl = el('button', 'btn small', 'Download clip');
    dl.type = 'button';
    dl.onclick = function () { downloadClip(m, dl, id); };

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

    row.appendChild(dl);
    row.appendChild(cp);
    row.appendChild(op);
    if (window.addCutButtons) window.addCutButtons(row, m);
    info.appendChild(row);
    c.appendChild(info);
    return c;
  }

  var activeCtl = null;
  function pauseOthers() {
    if (activeCtl) { try { activeCtl.pause(); } catch (e) {} }
  }

  function render(d) {
    out.textContent = '';
    if (!d.moments || !d.moments.length) {
      showMessage(d.reason || 'No clear moments found in this video.');
      return;
    }
    clearStatus();
    activeCtl = null;
    var strip = el('div', 'sstrip');
    d.moments.forEach(function (m, i) {
      strip.appendChild(studioCard(d.id, m, i, d.moments.length));
    });
    out.appendChild(strip);
    var cards = Array.prototype.slice.call(strip.children);
    if (window.IntersectionObserver) {
      cards[0].classList.add('on');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          e.target.classList.toggle('on', e.isIntersecting);
          if (!e.isIntersecting && e.target.pauseNow) e.target.pauseNow();
        });
      }, { root: strip, threshold: 0.6 });
      cards.forEach(function (ch) { io.observe(ch); });
    } else {
      cards.forEach(function (ch) { ch.classList.add('on'); });
    }
    out.firstChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The old note said downloads need your own file. The server can now download from the link.
  Array.prototype.forEach.call(document.querySelectorAll('p,small,span,div,li'), function (n) {
    if (!n.children.length && /^To download a clip, choose your own video file/.test(n.textContent.trim())) {
      n.textContent = 'Tap Download clip on any clip, or choose your own video file for cleaner clips. Only use videos you own or have permission to use.';
    }
  });

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
