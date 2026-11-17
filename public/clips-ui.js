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
      player.textContent = '';
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + id +
        '?start=' + m.start + '&end=' + m.end + '&autoplay=1&rel=0&playsinline=1';
      f.title = m.title;
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      player.appendChild(f);
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
