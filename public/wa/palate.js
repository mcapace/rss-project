/* Your palate: the flavor profile of the bottles on My Shelf (flavor.json), worked out in this browser and never sent
   anywhere. Bottles you own count more than bottles you want to try. WA.palate(cb) hands back the profile and picks;
   WA.renderPalate(el) draws the shelf page's panel. */
(function () {
  'use strict';
  var AXES = ['smoke', 'maritime', 'sweet', 'fresh_fruit', 'dried_fruit', 'tropical', 'floral', 'spice', 'oak', 'grain', 'nutty', 'herbal'];
  var LABEL = { smoke: 'Smoke', maritime: 'Sea', sweet: 'Vanilla', fresh_fruit: 'Orchard', dried_fruit: 'Sherry', tropical: 'Tropical', floral: 'Floral', spice: 'Spice', oak: 'Oak', grain: 'Grain', nutty: 'Nutty', herbal: 'Herbal' };
  var PHRASE = { smoke: 'smoke', maritime: 'sea salt', sweet: 'vanilla', fresh_fruit: 'orchard fruit', dried_fruit: 'sherried fruit', tropical: 'tropical fruit', floral: 'flowers', spice: 'spice', oak: 'oak', grain: 'malt', nutty: 'nuttiness', herbal: 'herbs' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var FLAVOR = null;
  function flavors(cb) {
    if (FLAVOR) return cb(FLAVOR);
    WA.loadJSON('flavor.json').then(function (d) { var col = {}; d.cols.forEach(function (c, i) { col[c] = i; }); FLAVOR = {}; d.rows.forEach(function (r) { FLAVOR[r[col.slug].toLowerCase()] = r[col.f].split('').map(function (ch) { return parseInt(ch, 11) || 0; }); }); cb(FLAVOR); }, function () { cb(null); });
  }
  function shelf() { try { return (WAReader.read(localStorage).shelf || []).filter(function (x) { return x.kind === 'bottle'; }); } catch (e) { return []; } }
  function cosine(a, b) { var d = 0, na = 0, nb = 0; for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
  function vec(f) { var v = f.slice(0, 12); v.push(f[12] * 2, f[13] * 2); return v; }

  WA.palate = function (cb) {
    WA.archive(function (data) {
      flavors(function (F) {
        if (!F) return cb(null);
        var saved = shelf(), have = {}, sum = new Array(14).fill(0), weight = 0, counted = 0, all = new Array(14).fill(0), n = 0;
        saved.forEach(function (x) { have[x.slug.toLowerCase()] = true; var f = F[x.slug.toLowerCase()]; if (!f) return; var w = x.status === 'owned' ? 1.5 : 1; f.forEach(function (v, i) { sum[i] += v * w; }); weight += w; counted++; });
        Object.keys(F).forEach(function (k) { F[k].forEach(function (v, i) { all[i] += v; }); n++; });
        all = all.map(function (v) { return v / (n || 1); });
        if (counted < 3) return cb({ counted: counted, saved: saved.length, average: all });
        var profile = sum.map(function (v) { return v / weight; }), me = vec(profile), houses = {};
        var picks = data.filter(function (r) { return r.slug && !have[r.slug.toLowerCase()] && F[r.slug.toLowerCase()] && r.s >= 90 && r.d >= '2021'; })
          .map(function (r) { return { r: r, d: cosine(me, vec(F[r.slug.toLowerCase()])) + (r.s - 90) * 0.004 }; })
          .sort(function (a, b) { return b.d - a.d; })
          .filter(function (x) { var h = (x.r.pr || x.r.n.split(' ')[0]).toLowerCase(); if (houses[h]) return false; houses[h] = 1; return true; })
          .slice(0, 6).map(function (x) { return x.r; });
        // What sets this shelf apart: the axes furthest above the archive's average.
        var lean = AXES.map(function (a, i) { return { a: a, v: profile[i], lift: profile[i] - all[i] }; }).filter(function (x) { return x.v >= 3; }).sort(function (a, b) { return b.lift - a.lift; }).slice(0, 3);
        cb({ counted: counted, saved: saved.length, profile: profile, average: all, lean: lean, picks: picks, body: profile[12], finish: profile[13] });
      });
    });
  };

  function radar(p, avg) {
    var cx = 150, cy = 150, R = 112;
    function pt(i, v) { var a = -Math.PI / 2 + (i / 12) * Math.PI * 2, r = (v / 10) * R; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
    function poly(vals) { return vals.slice(0, 12).map(function (v, i) { return pt(i, v).map(function (n) { return n.toFixed(1); }).join(','); }).join(' '); }
    var rings = [2.5, 5, 7.5, 10].map(function (v) { return '<polygon class="pal-ring" points="' + poly(new Array(12).fill(v)) + '"/>'; }).join('');
    var spokes = AXES.map(function (a, i) { var e = pt(i, 10), l = pt(i, 12.4); return '<line class="pal-spoke" x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '"/><text x="' + l[0].toFixed(1) + '" y="' + l[1].toFixed(1) + '" text-anchor="middle" dominant-baseline="middle">' + LABEL[a] + '</text>'; }).join('');
    return '<svg class="pal-radar" viewBox="-20 -10 340 320" role="img" aria-label="Your palate compared with the average rated bottle">' + rings + spokes + '<polygon class="pal-avg" points="' + poly(avg) + '"/><polygon class="pal-me" points="' + poly(p) + '"/></svg>';
  }

  WA.renderPalate = function (el) {
    if (!el) return;
    WA.palate(function (res) {
      if (!res) { el.hidden = true; return; }
      el.hidden = false;
      if (!res.profile) {
        el.innerHTML = '<div class="pal-empty"><span class="mono">Your palate</span><h2 class="d3">Save three bottles you like and your palate appears here.</h2><p class="muted">It is worked out from the tasting notes of what you save, in this browser only. ' + (res.counted ? res.counted + ' of 3 so far.' : '') + '</p><a class="pill" href="finder.html">Find bottles to save</a></div>';
        return;
      }
      var lean = res.lean.map(function (x) { return PHRASE[x.a]; }), words = lean.length > 1 ? lean.slice(0, -1).join(', ') + ' and ' + lean[lean.length - 1] : lean[0] || 'a little of everything';
      var weight = res.body >= 3.6 ? 'full-bodied' : res.body <= 2.5 ? 'lighter' : 'medium-bodied', finish = res.finish >= 3.8 ? ' with a long finish' : '';
      el.innerHTML = '<div class="pal-grid"><div class="pal-chart">' + radar(res.profile, res.average) + '<p class="pal-key"><i class="me"></i>Your shelf <i class="avg"></i>The average rated bottle</p></div>' +
        '<div class="pal-copy"><span class="mono">Your palate · from ' + res.counted + ' bottles</span><h2 class="d3">You lean toward ' + esc(words) + '.</h2><p class="muted">Mostly ' + weight + ' whiskies' + finish + '. Worked out from the tasting notes of what you saved, in this browser only.</p>' +
        '<div class="pal-actions"><a class="pill" href="flavor-map.html#shelf">See your shelf on the flavor map</a></div>' +
        (res.picks.length ? '<h3 class="mono pal-picks-head">Bottles you have not saved that fit your palate</h3><div class="rail pal-picks">' + res.picks.map(function (r) { return WA.bottleCard(r); }).join('') + '</div>' : '') + '</div></div>';
      if (WA.fillNotes) WA.fillNotes(el);
    });
  };
})();
