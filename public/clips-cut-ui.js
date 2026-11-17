// clips-cut-ui.js (goes in the public folder next to clips-ui.js).
// Adds a "Download clip" button to each moment card.
// The person picks THEIR OWN video file once; the server cuts the moment from it.
(function () {
  'use strict';

  var picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'video/*';
  picker.style.display = 'none';
  document.body.appendChild(picker);

  var chosen = null;

  function download(btn, m, vertical) {
    var label = btn.getAttribute('data-label');
    btn.disabled = true;
    btn.textContent = 'Cutting…';

    var url = '/api/research/cut?start=' + m.start + '&end=' + m.end +
      (vertical ? '&vertical=1' : '');

    fetch(url, { method: 'POST', body: chosen, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            throw new Error(d.error || 'Could not cut the clip.');
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'clip-' + m.start + '-' + m.end + (vertical ? '-short' : '') + '.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
        btn.textContent = 'Downloaded ✓';
      })
      .catch(function (e) { btn.textContent = e.message || 'Failed'; })
      .then(function () {
        setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 3000);
      });
  }

  function makeButton(text, m, vertical) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn alt small';
    b.textContent = text;
    b.setAttribute('data-label', text);
    b.onclick = function () {
      if (chosen) return download(b, m, vertical);
      picker.onchange = function () {
        if (picker.files && picker.files[0]) {
          chosen = picker.files[0];
          download(b, m, vertical);
        }
      };
      picker.click();
    };
    return b;
  }

  // Call this from card() in clips-ui.js, right after the Open on YouTube link.
  window.addCutButtons = function (row, m) {
    row.appendChild(makeButton('Download clip', m, false));
    row.appendChild(makeButton('Download as Short (9:16)', m, true));

    var up = document.createElement('a');
    up.className = 'btn alt small';
    up.textContent = 'Upload to my YouTube';
    up.href = 'https://www.youtube.com/upload';
    up.target = '_blank';
    up.rel = 'noopener';
    row.appendChild(up);
  };
})();
