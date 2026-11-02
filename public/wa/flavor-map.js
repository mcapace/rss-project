/* The flavor map: every rated bottle on a flavor wheel, drawn with WebGL. The twelve flavor families sit around the
   rim, related ones side by side; each bottle is pulled toward the flavors that stand out in its tasting note, so bold
   single-minded bottles sit near the rim and balanced ones near the middle. Drag to pan, wheel or pinch to zoom, hover or tap a point for the bottle. */
(function () {
  'use strict';
  var AXES = ['smoke', 'maritime', 'sweet', 'fresh_fruit', 'dried_fruit', 'tropical', 'floral', 'spice', 'oak', 'grain', 'nutty', 'herbal', 'body', 'finish'];
  var AXIS_LABEL = { smoke: 'Smoke', maritime: 'Sea and brine', sweet: 'Vanilla and caramel', fresh_fruit: 'Orchard and citrus', dried_fruit: 'Dried fruit and sherry', tropical: 'Tropical fruit', floral: 'Floral', spice: 'Spice', oak: 'Oak and leather', grain: 'Grain and malt', nutty: 'Nut and chocolate', herbal: 'Herbal', body: 'Body', finish: 'Finish' };
  var GROUPS = [
    { id: 'bourbon', label: 'Bourbon', color: [0.96, 0.68, 0.26], test: function (c) { return /bourbon|tennessee/i.test(c); } },
    { id: 'rye', label: 'Rye', color: [0.93, 0.42, 0.25], test: function (c) { return /rye/i.test(c); } },
    { id: 'malt', label: 'Single malt Scotch', color: [0.55, 0.76, 0.95], test: function (c) { return /single malt scotch/i.test(c); } },
    { id: 'blend', label: 'Blended Scotch', color: [0.72, 0.64, 0.96], test: function (c) { return /scotch/i.test(c); } },
    { id: 'irish', label: 'Irish', color: [0.45, 0.85, 0.58], test: function (c) { return /irish/i.test(c); } },
    { id: 'japan', label: 'Japanese', color: [0.97, 0.55, 0.68], test: function (c) { return /japan/i.test(c); } },
    { id: 'world', label: 'Everything else', color: [0.86, 0.82, 0.74], test: function () { return true; } }
  ];
  var stage = document.getElementById('fmapStage'), canvas = document.getElementById('fmapCanvas'), labels = document.getElementById('fmapLabels'), tip = document.getElementById('fmapTip'), panel = document.getElementById('fmapPanel');
  var status = document.getElementById('fmapStatus'), find = document.getElementById('fmapFind'), suggest = document.getElementById('fmapSuggest'), chips = document.getElementById('fmapChips'), minScore = document.getElementById('fmapScore'), colorBy = document.getElementById('fmapColor');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var pts = [], grid = {}, CELL = 24, view = { x: 500, y: 500, k: 1 }, target = null, hover = -1, selected = -1, group = 'all', born = 0;
  var gl, prog, buf, loc = {}, dpr = 1, W = 0, H = 0, dirty = true;

  var WHEEL = ['smoke', 'maritime', 'herbal', 'grain', 'fresh_fruit', 'floral', 'tropical', 'sweet', 'spice', 'oak', 'nutty', 'dried_fruit'], RIM = 420, CX = 500, CY = 500;
  function angleOf(axis) { return -Math.PI / 2 + WHEEL.indexOf(axis) * Math.PI * 2 / WHEEL.length; }
  // Each bottle's pull toward every flavor is how far it stands above the average bottle on that flavor.
  function wheel(list) {
    var mean = AXES.slice(0, 12).map(function (a, i) { return list.reduce(function (t, p) { return t + p.f[i]; }, 0) / list.length; });
    var sd = mean.map(function (m, i) { return Math.sqrt(list.reduce(function (t, p) { return t + (p.f[i] - m) * (p.f[i] - m); }, 0) / list.length) || 1; });
    var pulls = list.map(function (p) {
      var x = 0, y = 0;
      for (var i = 0; i < 12; i++) { var w = Math.max(0, (p.f[i] - mean[i]) / sd[i]); if (!w) continue; w = Math.pow(w, 1.3); var a = angleOf(AXES[i]); x += Math.cos(a) * w; y += Math.sin(a) * w; }
      return [x, y, Math.hypot(x, y)];
    });
    // Distance from the middle follows each bottle's rank by strength of pull, so the disc fills evenly.
    var order = list.map(function (p, i) { return i; }).sort(function (a, b) { return pulls[a][2] - pulls[b][2]; }), rank = [];
    order.forEach(function (i, n) { rank[i] = n / Math.max(1, order.length - 1); });
    list.forEach(function (p, i) {
      var q = pulls[i], j = hash(p.slug), a = j * Math.PI * 2, ang = q[2] ? Math.atan2(q[1], q[0]) : a;
      var r = Math.sqrt(rank[i]) * RIM * 0.95 + hash(p.slug + '·') * 8;
      p.x = CX + Math.cos(ang) * r; p.y = CY + Math.sin(ang) * r;
      p.fx = CX + Math.cos(a * 7) * 30 * j; p.fy = CY + Math.sin(a * 7) * 30 * j;
    });
  }

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function decode(f) { var v = []; for (var i = 0; i < f.length; i++) v.push(parseInt(f[i], 11) || 0); return v; }
  function vec(p) { var v = p.f.slice(0, 12); v.push(p.f[12] * 2, p.f[13] * 2); return v; }
  function cosine(a, b) { var d = 0, na = 0, nb = 0; for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
  function groupOf(c) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].test(c || '')) return i; return GROUPS.length - 1; }
  function visible(p) { return p.s >= +minScore.value && (group === 'all' || (group === 'shelf' ? p.saved : GROUPS[p.g].id === group)); }
  function savedSlugs() { var out = {}; try { (WAReader.read(localStorage).shelf || []).forEach(function (x) { if (x.kind === 'bottle') out[x.slug.toLowerCase()] = true; }); } catch (e) {} return out; }

  // Data space (0-1000 square) to CSS pixels, fitted to the stage with a margin.
  function base() { return W < 600 ? Math.min(W / 1320, H / 1080) : Math.min(W, H) / 1100; }
  function toScreen(x, y) { var s = base() * view.k; return [(x - view.x) * s + W / 2, (y - view.y) * s + H / 2]; }
  function toData(sx, sy) { var s = base() * view.k; return [(sx - W / 2) / s + view.x, (sy - H / 2) / s + view.y]; }

  function nearest(sx, sy, radius) {
    var d = toData(sx, sy), r = radius / (base() * view.k), best = -1, bd = r * r;
    for (var gx = Math.floor((d[0] - r) / CELL); gx <= Math.floor((d[0] + r) / CELL); gx++) for (var gy = Math.floor((d[1] - r) / CELL); gy <= Math.floor((d[1] + r) / CELL); gy++) {
      var cell = grid[gx + ',' + gy]; if (!cell) continue;
      for (var i = 0; i < cell.length; i++) { var p = pts[cell[i]]; if (!visible(p)) continue; var dx = p.x - d[0], dy = p.y - d[1], dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = cell[i]; } }
    }
    return best;
  }

  function setup() {
    gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) return false;
    var vs = 'attribute vec2 a_pos; attribute vec2 a_from; attribute vec3 a_col; attribute float a_state; uniform vec4 u_view; uniform float u_t; uniform float u_size; uniform float u_gain; varying vec3 v_col; varying float v_gain; varying float v_state;' +
      'void main() { float t = u_t * u_t * (3.0 - 2.0 * u_t); vec2 p = mix(a_from, a_pos, t); gl_Position = vec4((p - u_view.xy) * u_view.zw, 0.0, 1.0); gl_Position.y = -gl_Position.y;' +
      ' v_col = a_col; v_state = a_state; v_gain = u_gain; gl_PointSize = a_state < 0.5 ? u_size * 0.55 : (a_state > 1.5 ? u_size * 3.2 : u_size); }';
    var fs = 'precision mediump float; varying vec3 v_col; varying float v_state; varying float v_gain;' +
      'void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;' +
      ' if (v_state > 1.5) { float ring = smoothstep(0.62, 0.72, d) * (1.0 - smoothstep(0.86, 1.0, d)); float core = 1.0 - smoothstep(0.18, 0.3, d); gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * (ring + core), ring + core); return; }' +
      ' float a = v_state < 0.5 ? 0.06 : v_gain; float glow = exp(-d * d * 5.0) * 0.55 + (1.0 - smoothstep(0.25, 0.45, d)) * 0.6; gl_FragColor = vec4(v_col * glow * a, glow * a); }';
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    ['a_pos', 'a_from', 'a_col', 'a_state'].forEach(function (n) { loc[n] = gl.getAttribLocation(prog, n); });
    ['u_view', 'u_t', 'u_size', 'u_gain'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    buf = gl.createBuffer();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    return true;
  }

  // One interleaved buffer: position, start position, colour, state (0 filtered out, 1 shown, 2 selected).
  function upload() {
    var score = colorBy.value === 'score', data = new Float32Array(pts.length * 8);
    pts.forEach(function (p, i) {
      var c = GROUPS[p.g].color;
      if (score) { var t = Math.max(0, Math.min(1, (p.s - 80) / 17)); c = [0.35 + 0.65 * t, 0.22 + 0.62 * t * t, 0.12 + 0.5 * t * t * t]; }
      var o = i * 8; data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.fx; data[o + 3] = p.fy; data[o + 4] = c[0]; data[o + 5] = c[1]; data[o + 6] = c[2]; data[o + 7] = visible(p) ? 1 : 0;
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var stride = 32;
    gl.enableVertexAttribArray(loc.a_pos); gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.a_from); gl.vertexAttribPointer(loc.a_from, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(loc.a_col); gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(loc.a_state); gl.vertexAttribPointer(loc.a_state, 1, gl.FLOAT, false, stride, 28);
    dirty = true;
  }

  var guides = document.createElement('canvas'), g2 = guides.getContext('2d'); guides.className = 'fmap-guides'; guides.setAttribute('aria-hidden', 'true'); stage.insertBefore(guides, canvas);
  function drawGuides() {
    if (!g2) return;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H);
    var c = toScreen(CX, CY), s = base() * view.k;
    g2.lineWidth = 1;
    [0.33, 0.66, 1].forEach(function (f, i) { g2.beginPath(); g2.arc(c[0], c[1], RIM * f * s, 0, Math.PI * 2); g2.strokeStyle = i === 2 ? 'rgba(255,236,210,0.22)' : 'rgba(255,236,210,0.08)'; g2.stroke(); });
    for (var i = 0; i < WHEEL.length; i++) { var a = angleOf(WHEEL[i]) + Math.PI / WHEEL.length; g2.beginPath(); g2.moveTo(c[0] + Math.cos(a) * RIM * 0.12 * s, c[1] + Math.sin(a) * RIM * 0.12 * s); g2.lineTo(c[0] + Math.cos(a) * RIM * s, c[1] + Math.sin(a) * RIM * s); g2.strokeStyle = 'rgba(255,236,210,0.07)'; g2.stroke(); }
    g2.fillStyle = 'rgba(255,236,210,0.42)'; g2.font = '500 11px ' + getComputedStyle(document.body).fontFamily; g2.textAlign = 'center'; g2.fillText('BALANCED', c[0], c[1] + 4);
  }

  function resize() {
    var r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    guides.width = canvas.width; guides.height = canvas.height; guides.style.width = W + 'px'; guides.style.height = H + 'px';
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    dirty = true;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (target) { var e = reduce ? 1 : 0.14; view.x += (target.x - view.x) * e; view.y += (target.y - view.y) * e; view.k += (target.k - view.k) * e; if (Math.abs(target.k - view.k) < 0.002 && Math.abs(target.x - view.x) < 0.05 && Math.abs(target.y - view.y) < 0.05) { view.x = target.x; view.y = target.y; view.k = target.k; target = null; } dirty = true; }
    var t = reduce ? 1 : Math.min(1, (now - born) / 1600);
    if (t < 1) dirty = true;
    if (!dirty || !gl) return;
    dirty = false;
    var s = base() * view.k;
    drawGuides();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(loc.u_view, view.x, view.y, (2 * s) / W, (2 * s) / H);
    gl.uniform1f(loc.u_t, t); gl.uniform1f(loc.u_gain, Math.min(1, 0.5 + 0.18 * view.k));
    gl.uniform1f(loc.u_size, Math.max(5, Math.min(22, 4.6 * Math.sqrt(view.k) * Math.min(W, H) / 700)) * dpr);
    gl.drawArrays(gl.POINTS, 0, pts.length);
    if (selected >= 0 && t >= 1) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); var p = pts[selected]; drawOne(p); gl.blendFunc(gl.ONE, gl.ONE); }
    place();
  }
  // The selected bottle: a ring, drawn from a one-point buffer so the main buffer stays untouched.
  var one;
  function drawOne(p) {
    one = one || gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, one); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([p.x, p.y, p.x, p.y, 1, 1, 1, 2]), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(loc.a_from, 2, gl.FLOAT, false, 32, 8); gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, 32, 16); gl.vertexAttribPointer(loc.a_state, 1, gl.FLOAT, false, 32, 28);
    gl.drawArrays(gl.POINTS, 0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(loc.a_from, 2, gl.FLOAT, false, 32, 8); gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, 32, 16); gl.vertexAttribPointer(loc.a_state, 1, gl.FLOAT, false, 32, 28);
  }

  // The flavor families around the rim. Each name is a button that zooms into its part of the wheel.
  var regions = [];
  function findRegions() {
    regions = WHEEL.map(function (a) {
      var i = AXES.indexOf(a), n = pts.filter(function (p) { var top = 0; for (var k = 1; k < 12; k++) if (p.f[k] > p.f[top]) top = k; return top === i; }).length, ang = angleOf(a);
      return { axis: a, label: AXIS_LABEL[a], n: n, ang: ang, x: CX + Math.cos(ang) * RIM * 1.1, y: CY + Math.sin(ang) * RIM * 1.1 };
    });
    labels.innerHTML = regions.map(function (r, i) { return '<button type="button" class="fmap-region" data-r="' + i + '">' + esc(r.label) + '</button>'; }).join('');
  }
  labels.addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return; var r = regions[+b.getAttribute('data-r')];
    select(-1); target = { x: CX + Math.cos(r.ang) * RIM * 0.62, y: CY + Math.sin(r.ang) * RIM * 0.62, k: 2.4 };
    WA.track && WA.track('flavor_map_region', { axis: r.axis });
  });
  function place() {
    var els = labels.children, intro = born + 1200 > performance.now();
    regions.forEach(function (r, i) {
      var el = els[i], s = toScreen(r.x, r.y), w = el.offsetWidth || 120, h = el.offsetHeight || 28, cos = Math.cos(r.ang);
      var x = s[0] - w / 2 + cos * w * 0.35, y = s[1] - h / 2, off = s[0] < -20 || s[1] < -20 || s[0] > W + 20 || s[1] > H + 20; x = Math.max(6, Math.min(W - w - 6, x)); y = Math.max(6, Math.min(H - h - 6, y));
      el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; el.classList.toggle('off', off || intro);
    });
    if (hover >= 0) showTip(hover);
  }

  function showTip(i) {
    var p = pts[i], s = toScreen(p.x, p.y);
    tip.innerHTML = '<strong>' + esc(p.n) + '</strong><span>' + p.s + ' points' + (p.p ? ' · ' + WA.fmt(p.p) : '') + '</span>' + (p.t ? '<em>' + esc(p.t) + '</em>' : '');
    tip.hidden = false;
    var x = Math.min(W - tip.offsetWidth - 10, Math.max(10, s[0] + 14)), y = s[1] - tip.offsetHeight - 14; if (y < 10) y = s[1] + 16;
    tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function bars(p) {
    return '<div class="fmap-bars">' + AXES.slice(0, 12).map(function (a, i) { return '<div><span>' + esc(AXIS_LABEL[a]) + '</span><i><b style="width:' + p.f[i] * 10 + '%"></b></i></div>'; }).join('') +
      '<div><span>Body</span><i><b style="width:' + p.f[12] * 20 + '%"></b></i></div><div><span>Finish</span><i><b style="width:' + p.f[13] * 20 + '%"></b></i></div></div>';
  }
  function select(i, fly) {
    selected = i; dirty = true;
    if (i < 0) { panel.hidden = true; stage.classList.remove('has-panel'); if (history.replaceState) history.replaceState(null, '', location.pathname + location.search); return; }
    var p = pts[i], me = vec(p);
    var near = pts.map(function (q, j) { return { j: j, d: j === i || q.n === p.n ? -1 : cosine(me, vec(q)) - Math.abs(q.s - p.s) * 0.002 }; }).filter(function (x) { return x.d > 0 && pts[x.j].s >= 85; }).sort(function (a, b) { return b.d - a.d; }).slice(0, 5);
    panel.innerHTML = '<button type="button" class="fmap-close" aria-label="Close">×</button><p class="mono">' + esc(p.c) + (p.d ? ' · ' + String(p.d).slice(0, 4) : '') + '</p><h2>' + esc(p.n) + '</h2>' +
      '<p class="fmap-score"><span class="score-type">' + p.s + '</span><span>' + (p.p ? WA.fmt(p.p) : '') + '</span></p>' + (p.t ? '<p class="fmap-notes">' + esc(p.t) + '</p>' : '') + bars(p) +
      '<a class="pill solid" href="' + esc(WA.bottleHref(p.slug)) + '">Read the review</a>' +
      (near.length ? '<h3 class="mono">Nearest in flavor</h3><ul class="fmap-near">' + near.map(function (x) { var q = pts[x.j]; return '<li><button type="button" data-i="' + x.j + '"><span class="score-type">' + q.s + '</span><span>' + esc(q.n) + '<small>' + esc(q.c) + (q.p ? ' · ' + WA.fmt(q.p) : '') + '</small></span></button></li>'; }).join('') + '</ul>' : '');
    panel.hidden = false; stage.classList.add('has-panel');
    if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(p.slug));
    // Centre the bottle in the part of the stage the panel leaves open (beside it on desktop, above the sheet on phones).
    var k = fly ? Math.max(view.k, 3.2) : view.k, s = base() * k, sheet = W <= 760;
    var dx = sheet ? 0 : (panel.offsetWidth + 16) / 2, dy = sheet ? (panel.offsetHeight + 10) / 2 : 0;
    var sp = toScreen(p.x, p.y), covered = sheet ? sp[1] > H - panel.offsetHeight - 30 : sp[0] > W - panel.offsetWidth - 40;
    if (fly || covered) target = { x: p.x + dx / s, y: p.y + dy / s, k: k };
    WA.track && WA.track('flavor_map_select', { slug: p.slug });
  }
  panel.addEventListener('click', function (e) {
    if (e.target.closest('.fmap-close')) return select(-1);
    var b = e.target.closest('[data-i]'); if (b) select(+b.getAttribute('data-i'), true);
  });

  // Pan, zoom and pinch with pointer events; a tap or click without movement selects.
  var pointers = {}, drag = null, pinch = null, moved = false;
  function zoomAt(sx, sy, factor) {
    var before = toData(sx, sy), k = Math.max(0.8, Math.min(40, (target ? target.k : view.k) * factor));
    var s = base() * k, nx = before[0] - (sx - W / 2) / s, ny = before[1] - (sy - H / 2) / s;
    target = { x: nx, y: ny, k: k };
  }
  function local(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId); pointers[e.pointerId] = local(e); moved = false;
    var ids = Object.keys(pointers);
    if (ids.length === 1) drag = { p: local(e), x: view.x, y: view.y };
    else if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], data: toData((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; drag = null; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = local(e);
    if (pointers[e.pointerId]) pointers[e.pointerId] = p;
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], k = Math.max(0.8, Math.min(40, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = base() * k;
      target = null; view.k = k; view.x = pinch.data[0] - (c[0] - W / 2) / s; view.y = pinch.data[1] - (c[1] - H / 2) / s; moved = true; dirty = true; return;
    }
    if (drag) {
      var dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) { target = null; var s2 = base() * view.k; view.x = drag.x - dx / s2; view.y = drag.y - dy / s2; dirty = true; tip.hidden = true; hover = -1; }
      return;
    }
    if (e.pointerType === 'mouse') { var i = nearest(p[0], p[1], 14); if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : 'grab'; if (i < 0) tip.hidden = true; else showTip(i); } }
  });
  function up(e) {
    var p = local(e), wasDrag = drag && !moved && !pinch;
    delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch = null;
    if (!Object.keys(pointers).length) drag = null;
    if (wasDrag) { var i = nearest(p[0], p[1], e.pointerType === 'mouse' ? 14 : 22); select(i, false); }
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', function () { if (hover >= 0) { hover = -1; tip.hidden = true; } });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); var p = local(e); zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022))); }, { passive: false });
  canvas.addEventListener('dblclick', function (e) { var p = local(e); zoomAt(p[0], p[1], 2); });
  document.getElementById('fmapZoomIn').onclick = function () { zoomAt(W / 2, H / 2, 1.6); };
  document.getElementById('fmapZoomOut').onclick = function () { zoomAt(W / 2, H / 2, 1 / 1.6); };
  document.getElementById('fmapReset').onclick = function () { target = { x: 500, y: 500, k: 1 }; };

  // Find a bottle by name.
  function matches(q) { var words = q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return []; return pts.filter(function (p) { return words.every(function (w) { return p.key.indexOf(w) >= 0; }); }).sort(function (a, b) { return b.s - a.s; }).slice(0, 7); }
  find.addEventListener('input', function () {
    var list = matches(find.value);
    suggest.innerHTML = list.map(function (p) { return '<li><button type="button" data-i="' + p.i + '"><span class="score-type">' + p.s + '</span>' + esc(p.n) + '</button></li>'; }).join('');
    suggest.hidden = !list.length;
  });
  suggest.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; suggest.hidden = true; find.value = ''; select(+b.getAttribute('data-i'), true); });
  document.getElementById('fmapFindForm').addEventListener('submit', function (e) { e.preventDefault(); var list = matches(find.value); if (list.length) { suggest.hidden = true; find.value = ''; select(list[0].i, true); } });

  function filters() {
    var mine = pts.filter(function (p) { return p.saved; }).length;
    chips.innerHTML = '<button type="button" class="pill" data-g="all" aria-pressed="' + (group === 'all') + '">All</button>' + (mine ? '<button type="button" class="pill" data-g="shelf" aria-pressed="' + (group === 'shelf') + '"><i style="background:#fff"></i>My shelf · ' + mine + '</button>' : '') + GROUPS.map(function (g) { var n = pts.filter(function (p) { return GROUPS[p.g].id === g.id; }).length; return n ? '<button type="button" class="pill" data-g="' + g.id + '" aria-pressed="' + (group === g.id) + '"><i style="background:rgb(' + g.color.map(function (c) { return Math.round(c * 255); }).join(',') + ')"></i>' + esc(g.label) + '</button>' : ''; }).join('');
    var shown = pts.filter(visible).length;
    status.textContent = shown.toLocaleString() + ' of ' + pts.length.toLocaleString() + ' rated bottles. Near the middle: balanced. Toward the rim: one flavor leads.';
  }
  chips.addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (!b) return; group = b.getAttribute('data-g'); filters(); upload(); if (selected >= 0 && !visible(pts[selected])) select(-1); });
  minScore.addEventListener('change', function () { filters(); upload(); });
  colorBy.addEventListener('change', function () { stage.classList.toggle('by-score', colorBy.value === 'score'); upload(); });

  WA.archive(function (data) {
    WA.loadJSON('flavor.json').then(function (fl) {
      var col = {}, saved = savedSlugs(); fl.cols.forEach(function (c, i) { col[c] = i; });
      fl.rows.forEach(function (row) {
        var r = WA.find(data, row[col.slug]); if (!r) return;
        var p = { i: pts.length, slug: r.slug, n: r.n, c: r.c, s: r.s, p: r.p, d: r.d, t: row[col.t], f: decode(row[col.f]) };
        p.g = groupOf(p.c); p.key = (p.n + ' ' + p.c).toLowerCase(); p.saved = !!saved[p.slug.toLowerCase()];
        pts.push(p);
      });
      wheel(pts);
      pts.forEach(function (p) { var k = Math.floor(p.x / CELL) + ',' + Math.floor(p.y / CELL); (grid[k] = grid[k] || []).push(p.i); });
      resize();
      if (!setup()) { status.textContent = 'The flavor map needs WebGL, which this browser has turned off.'; stage.classList.add('no-gl'); return; }
      if (WA.hashSlug() === 'shelf' && pts.some(function (p) { return p.saved; })) group = 'shelf';
      filters(); findRegions(); upload(); born = performance.now(); requestAnimationFrame(frame);
      var want = WA.hashSlug(), hit = want && pts.filter(function (p) { return p.slug.toLowerCase() === want.toLowerCase(); })[0];
      if (hit) setTimeout(function () { select(hit.i, true); }, reduce ? 0 : 1500);
    }).catch(function () { status.textContent = 'The flavor map could not load. Try again in a moment.'; });
  });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else addEventListener('resize', resize);
})();
