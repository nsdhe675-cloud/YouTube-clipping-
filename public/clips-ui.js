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
    player.style.aspectRatio = 'auto';
    player.style.height = 'auto';
    player.style.paddingBottom = '0';
    var v = document.createElement('video');
    v.src = localUrl;
    v.playsInline = true;
    v.preload = 'auto';
    v.style.width = '100%';
    v.style.display = 'block';
    v.style.background = '#000';
    var len = m.end - m.start;

    var bar = el('div', 'cleanbar');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:#000;color:#fff;font-size:14px';
    var pb = el('button', '', '⏸');
    pb.type = 'button';
    pb.style.cssText = 'background:none;border:0;color:#fff;font-size:20px;padding:4px 8px';
    var rng = document.createElement('input');
    rng.type = 'range'; rng.min = 0; rng.max = len; rng.step = 0.1; rng.value = 0;
    rng.style.cssText = 'flex:1;min-width:0';
    var tm = el('span', '', '0:00 / ' + fmt(len));
    bar.appendChild(pb); bar.appendChild(rng); bar.appendChild(tm);

    function toStart() { v.currentTime = m.start; }
    v.addEventListener('loadedmetadata', function () { toStart(); v.play(); });
    v.addEventListener('timeupdate', function () {
      if (v.currentTime >= m.end) { v.pause(); toStart(); pb.textContent = '▶'; }
      var t = Math.min(len, Math.max(0, v.currentTime - m.start));
      rng.value = t;
      tm.textContent = fmt(t) + ' / ' + fmt(len);
    });
    v.addEventListener('play', function () { pb.textContent = '⏸'; });
    v.addEventListener('pause', function () { pb.textContent = '▶'; });
    pb.onclick = function () { if (v.paused) v.play(); else v.pause(); };
    rng.oninput = function () { v.currentTime = m.start + Number(rng.value); };
    v.onclick = pb.onclick;

    player.appendChild(v);
    player.appendChild(bar);
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
