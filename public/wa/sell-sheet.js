/* Sell sheets for the trade: a rating drawn in the house typography on a canvas, then saved as a one-page PDF.
   Three layouts: a 4 x 6 in shelf talker and a letter sell sheet for one bottle, and a letter portfolio sheet for a producer.
   Open industry.html#sheet=<slug> or industry.html#portfolio=<producer> to start on a bottle or a house. */
(function () {
  'use strict';
  var DPI = 200, INK = '#17120d', INK2 = '#4b3f33', INK3 = '#8b7b6a', AMBER = '#c9731d', PAPER = '#fffbf5', RULE = 'rgba(23,18,13,0.14)';
  var SANS = 'Aeonik, "Helvetica Neue", Arial, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  var SIZES = { talker: [4, 6], sheet: [8.5, 11], portfolio: [8.5, 11] };
  var NAMES = { talker: 'Shelf talker · 4 × 6 in', sheet: 'Sell sheet · Letter', portfolio: 'Portfolio sheet · Letter' };

  var logo = null, logoReady = fetch('logo.svg').then(function (r) { return r.text(); }).then(function (svg) {
    return new Promise(function (ok) {
      var img = new Image(); img.onload = function () { logo = img; ok(); }; img.onerror = function () { ok(); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/currentColor/g, INK));
    });
  }).catch(function () {});
  var fontsReady = document.fonts ? Promise.all(['700 100px Aeonik', '500 100px Aeonik', '400 100px Aeonik', '400 40px "JetBrains Mono"'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : Promise.resolve();

  function photo(r) {
    if (!r || !r.img || !window.WA || !WA.bottleSrc) return Promise.resolve(null);
    return new Promise(function (ok) { var img = new Image(); img.crossOrigin = 'anonymous'; img.onload = function () { ok(img); }; img.onerror = function () { ok(null); }; img.src = WA.bottleSrc(r); });
  }

  function font(ctx, weight, px, face) { ctx.font = weight + ' ' + px + 'px ' + (face || SANS); }
  function spaced(ctx, em) { if ('letterSpacing' in ctx) ctx.letterSpacing = em + 'px'; }
  // Wrap text to a width; the last allowed line ends in an ellipsis when the text runs over.
  function wrap(ctx, text, width, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > width && line) { lines.push(line); line = words[i]; if (lines.length === maxLines) { line = ''; break; } } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length === maxLines && lines.join(' ').split(/\s+/).length < words.length) {
      var last = lines[maxLines - 1]; while (last && ctx.measureText(last + '…').width > width) last = last.replace(/\s*\S+$/, '');
      lines[maxLines - 1] = last.replace(/[,;:.\s]+$/, '') + '…';
    }
    return lines;
  }
  function lines(ctx, list, x, y, lh) { list.forEach(function (l, i) { ctx.fillText(l, x, y + i * lh); }); return y + list.length * lh; }
  function contain(ctx, img, x, y, w, h) { var k = Math.min(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
  function drawLogo(ctx, x, y, w, align) { if (!logo) { font(ctx, 500, w * 0.16); ctx.fillStyle = INK; ctx.textAlign = align || 'left'; ctx.fillText('Whisky Advocate', x, y + w * 0.2); ctx.textAlign = 'left'; return; } var h = w * 212 / 620; ctx.drawImage(logo, align === 'center' ? x - w / 2 : x, y, w, h); }
  function reviewUrl(r) { return 'whiskyadvocate.com' + (r && r.slug ? '/' + r.slug : ''); }
  function meta(r) { return [r.p > 0 ? '$' + Math.round(r.p).toLocaleString() : '', r.a ? r.a + '% ABV' : ''].filter(Boolean).join('  ·  '); }
  function rated(r) { return [r.by ? 'Rated by ' + r.by : '', r.issue || (r.d ? String(r.d).slice(0, 4) : '')].filter(Boolean).join('  ·  '); }

  function talker(ctx, W, H, r, note, img) {
    var m = 56, x = m + 8, w = W - 2 * x;
    ctx.strokeStyle = RULE; ctx.lineWidth = 2; ctx.strokeRect(m - 24, m - 24, W - 2 * (m - 24), H - 2 * (m - 24));
    drawLogo(ctx, W / 2, m + 6, 330, 'center');
    var y = m + 6 + 330 * 212 / 620 + 52;
    font(ctx, 400, 21, MONO); spaced(ctx, 3); ctx.fillStyle = INK3; ctx.textAlign = 'center'; ctx.fillText(String(r.c || '').toUpperCase(), W / 2, y); spaced(ctx, 0); ctx.textAlign = 'left';
    y += 28;
    var imgW = img ? 230 : 0, scoreX = img ? x : W / 2;
    if (img) contain(ctx, img, W - x - imgW, y, imgW, 330);
    font(ctx, 700, 250); spaced(ctx, -10); ctx.fillStyle = AMBER; ctx.textAlign = img ? 'left' : 'center'; ctx.fillText(String(r.s), scoreX - (img ? 8 : 0), y + 230); spaced(ctx, 0);
    font(ctx, 400, 22, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.fillText('POINTS', scoreX, y + 290); spaced(ctx, 0); ctx.textAlign = 'left';
    y += img ? 400 : 380;
    font(ctx, 500, 46); spaced(ctx, -0.6); ctx.fillStyle = INK; y = lines(ctx, wrap(ctx, r.n, w, 3), x, y, 54); spaced(ctx, 0);
    y += 20;
    var foot = H - m - 92;
    font(ctx, 400, 27); ctx.fillStyle = INK2; lines(ctx, wrap(ctx, note, w, Math.max(0, Math.floor((foot - 40 - y) / 38))), x, y, 38);
    ctx.fillStyle = RULE; ctx.fillRect(x, foot, w, 2);
    font(ctx, 500, 26); ctx.fillStyle = INK; ctx.fillText(meta(r), x, foot + 44);
    font(ctx, 400, 18, MONO); spaced(ctx, 1); ctx.fillStyle = INK3; ctx.fillText(rated(r).toUpperCase(), x, foot + 80); spaced(ctx, 0);
  }

  function sheet(ctx, W, H, r, note, img) {
    var m = 120, w = W - 2 * m;
    drawLogo(ctx, m, m - 10, 420);
    font(ctx, 400, 24, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.textAlign = 'right'; ctx.fillText('SELL SHEET', W - m, m + 56); spaced(ctx, 0); ctx.textAlign = 'left';
    var y = m + 200; ctx.fillStyle = RULE; ctx.fillRect(m, y, w, 2); y += 90;
    var colW = img ? 520 : 0, tx = img ? m + colW + 80 : m, tw = W - m - tx;
    if (img) { ctx.fillStyle = '#f3ece1'; roundRect(ctx, m, y, colW, 760, 28); ctx.fill(); contain(ctx, img, m + 40, y + 40, colW - 80, 680); }
    font(ctx, 400, 24, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.fillText(String(r.c || '').toUpperCase(), tx, y + 20); spaced(ctx, 0);
    font(ctx, 700, 300); spaced(ctx, -12); ctx.fillStyle = AMBER; ctx.fillText(String(r.s), tx - 10, y + 300); spaced(ctx, 0);
    font(ctx, 400, 26, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.fillText('POINTS', tx, y + 360); spaced(ctx, 0);
    var ny = y + 450; font(ctx, 500, 64); spaced(ctx, -1.2); ctx.fillStyle = INK; ny = lines(ctx, wrap(ctx, r.n, tw, 4), tx, ny, 74); spaced(ctx, 0);
    y = (img ? Math.max(y + 760, ny) : ny) + 90;
    font(ctx, 400, 24, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.fillText('TASTING NOTE', m, y); spaced(ctx, 0); y += 64;
    var factsTop = H - m - 330;
    font(ctx, 400, 38); ctx.fillStyle = INK2; lines(ctx, wrap(ctx, note, w, Math.max(0, Math.floor((factsTop - 50 - y) / 56))), m, y, 56);
    ctx.fillStyle = RULE; ctx.fillRect(m, factsTop, w, 2);
    var facts = [['Price', r.p > 0 ? '$' + Math.round(r.p).toLocaleString() : 'Not listed'], ['Strength', r.a ? r.a + '% ABV' : 'Not listed'], ['Producer', r.pr && r.pr !== 'Unknown producer' ? r.pr : ''], ['Rated by', r.by || 'Whisky Advocate'], ['Issue', r.issue || (r.d ? String(r.d).slice(0, 4) : '')]].filter(function (f) { return f[1]; });
    var fw = w / facts.length;
    facts.forEach(function (f, i) {
      var fx = m + i * fw;
      font(ctx, 400, 20, MONO); spaced(ctx, 3); ctx.fillStyle = INK3; ctx.fillText(f[0].toUpperCase(), fx, factsTop + 70); spaced(ctx, 0);
      font(ctx, 500, 32); ctx.fillStyle = INK; lines(ctx, wrap(ctx, f[1], fw - 30, 2), fx, factsTop + 122, 40);
    });
    font(ctx, 400, 24); ctx.fillStyle = INK3; ctx.fillText('Rating and tasting note from Whisky Advocate  ·  ' + reviewUrl(r), m, H - m + 20);
  }

  function portfolio(ctx, W, H, house, rows) {
    var m = 120, w = W - 2 * m;
    drawLogo(ctx, m, m - 10, 420);
    font(ctx, 400, 24, MONO); spaced(ctx, 4); ctx.fillStyle = INK3; ctx.textAlign = 'right'; ctx.fillText('PORTFOLIO', W - m, m + 56); spaced(ctx, 0); ctx.textAlign = 'left';
    var y = m + 200; ctx.fillStyle = RULE; ctx.fillRect(m, y, w, 2); y += 130;
    font(ctx, 500, 96); spaced(ctx, -3); ctx.fillStyle = INK; y = lines(ctx, wrap(ctx, house, w, 2), m, y, 104); spaced(ctx, 0);
    var scores = rows.map(function (r) { return r.s; }), avg = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    y += 30; font(ctx, 400, 34); ctx.fillStyle = INK2;
    ctx.fillText(rows.length + (rows.length === 1 ? ' bottle' : ' bottles') + ' rated  ·  highest ' + Math.max.apply(null, scores) + '  ·  average ' + avg.toFixed(1), m, y);
    y += 80;
    var best = rows.slice().sort(function (a, b) { return b.s - a.s || (b.d || '').localeCompare(a.d || ''); }), rowH = 112, room = Math.floor((H - m - 90 - y) / rowH);
    font(ctx, 400, 20, MONO); spaced(ctx, 3); ctx.fillStyle = INK3; ctx.fillText('SCORE', m, y); ctx.fillText('BOTTLE', m + 190, y); ctx.textAlign = 'right'; ctx.fillText('PRICE', W - m, y); ctx.textAlign = 'left'; spaced(ctx, 0);
    y += 26;
    best.slice(0, room).forEach(function (r) {
      ctx.fillStyle = RULE; ctx.fillRect(m, y, w, 2);
      font(ctx, 700, 62); spaced(ctx, -2); ctx.fillStyle = AMBER; ctx.fillText(String(r.s), m, y + 78); spaced(ctx, 0);
      font(ctx, 500, 34); ctx.fillStyle = INK; ctx.fillText(wrap(ctx, r.n, w - 190 - 200, 1)[0] || '', m + 190, y + 56);
      font(ctx, 400, 24); ctx.fillStyle = INK3; ctx.fillText([r.c, r.issue].filter(Boolean).join('  ·  '), m + 190, y + 92);
      font(ctx, 500, 32); ctx.fillStyle = INK2; ctx.textAlign = 'right'; ctx.fillText(r.p > 0 ? '$' + Math.round(r.p).toLocaleString() : '—', W - m, y + 70); ctx.textAlign = 'left';
      y += rowH;
    });
    if (best.length > room) { font(ctx, 400, 26); ctx.fillStyle = INK3; ctx.fillText('Plus ' + (best.length - room) + ' more at whiskyadvocate.com', m, y + 50); }
    font(ctx, 400, 24); ctx.fillStyle = INK3; ctx.fillText('Ratings from Whisky Advocate  ·  whiskyadvocate.com', m, H - m + 20);
  }

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // Draw a layout onto a canvas at print resolution. job: { kind, row, note, house, rows }.
  function render(canvas, job) {
    return Promise.all([fontsReady, logoReady, job.kind === 'portfolio' ? null : photo(job.row)]).then(function (got) {
      var size = SIZES[job.kind], W = Math.round(size[0] * DPI), H = Math.round(size[1] * DPI);
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d'); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H); ctx.textBaseline = 'alphabetic';
      if (job.kind === 'talker') talker(ctx, W, H, job.row, job.note, got[2]);
      else if (job.kind === 'sheet') sheet(ctx, W, H, job.row, job.note, got[2]);
      else portfolio(ctx, W, H, job.house, job.rows);
      return canvas;
    });
  }

  // A one-page PDF holding the canvas as a JPEG, sized to the layout in points.
  function toPdf(canvas, kind) {
    return new Promise(function (ok, fail) {
      canvas.toBlob(function (blob) {
        if (!blob) return fail(Error('Could not draw the sheet'));
        blob.arrayBuffer().then(function (buf) {
          var jpg = new Uint8Array(buf), size = SIZES[kind], wpt = size[0] * 72, hpt = size[1] * 72, enc = new TextEncoder(), parts = [], offsets = [], len = 0;
          function add(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; }
          function obj(n, body, stream) { offsets[n] = len; add(n + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n')); if (stream) { add(stream); add('\nendstream\nendobj\n'); } }
          add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
          obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
          obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
          obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wpt + ' ' + hpt + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
          obj(4, '<< /Type /XObject /Subtype /Image /Width ' + canvas.width + ' /Height ' + canvas.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>', jpg);
          var draw = enc.encode('q ' + wpt + ' 0 0 ' + hpt + ' 0 0 cm /Im0 Do Q');
          obj(5, '<< /Length ' + draw.length + ' >>', draw);
          var xref = len, table = 'xref\n0 6\n0000000000 65535 f \n';
          for (var i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
          add(table + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
          ok(new Blob(parts, { type: 'application/pdf' }));
        }, fail);
      }, 'image/jpeg', 0.92);
    });
  }

  function fileName(job) {
    var base = job.kind === 'portfolio' ? job.house : (job.row && job.row.n) || 'bottle';
    return 'Whisky Advocate ' + (job.kind === 'talker' ? 'shelf talker' : job.kind === 'sheet' ? 'sell sheet' : 'portfolio') + ' - ' + String(base).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) + '.pdf';
  }
  function download(canvas, job) {
    return toPdf(canvas, job.kind).then(function (blob) {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = fileName(job); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return blob;
    });
  }

  window.WASellSheet = { render: render, toPdf: toPdf, download: download, fileName: fileName, NAMES: NAMES };
})();
