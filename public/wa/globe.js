/* The distillery globe: every producer with three or more ratings, placed where its whisky is made (globe.json),
   on a dotted Earth drawn with WebGL. Drag to turn it, wheel or pinch to zoom, tap a light for the house. */
(function () {
  'use strict';
  var stage = document.getElementById('globeStage'), canvas = document.getElementById('globeCanvas'), tip = document.getElementById('globeTip'), panel = document.getElementById('globePanel'), status = document.getElementById('globeStatus'), jumps = document.getElementById('globeJumps'), halo = document.getElementById('globeHalo');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var JUMPS = [{ id: 'all', label: 'Everywhere', lat: 30, lon: -30, k: 1 }, { id: 'scotland', label: 'Scotland', lat: 56.9, lon: -4.6, k: 4.6 }, { id: 'ireland', label: 'Ireland', lat: 53.4, lon: -7.7, k: 5 }, { id: 'kentucky', label: 'Kentucky and Tennessee', lat: 37.2, lon: -85.6, k: 5 }, { id: 'usa', label: 'United States', lat: 39, lon: -97, k: 2.2 }, { id: 'japan', label: 'Japan', lat: 36.5, lon: 138, k: 3.6 }, { id: 'world', label: 'Australia, India, Taiwan', lat: 5, lon: 115, k: 1.6 }];
  var D = 3.4, off = { x: 0, y: 0 }, view = { yaw: -30, pitch: 30, k: 1 }, target = null, spin = { yaw: 0, pitch: 0 }, idleAt = 0, W = 0, H = 0, dpr = 1, dirty = true;
  var gl, prog, landBuf, placeBuf, ringBuf, loc = {}, land = 0, places = [], hover = -1, selected = -1, born = 0, data = [];

  function rad(d) { return d * Math.PI / 180; }
  function radius() { return Math.min(W, H) * 0.4 * view.k; }
  function project(lat, lon) {
    var la = rad(lat), lo = rad(lon), x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    var cy = Math.cos(rad(view.yaw)), sy = Math.sin(rad(view.yaw)), cp = Math.cos(rad(view.pitch)), sp = Math.sin(rad(view.pitch));
    var x1 = x * cy - z * sy, z1 = x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, f = D / (D - z2), R = radius();
    return [W / 2 + off.x + x1 * R * f, H / 2 + off.y - y2 * R * f, z2];
  }

  function setup() {
    gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) return false;
    var vs = 'attribute vec2 a_ll; attribute float a_size; attribute vec3 a_col; uniform vec4 u_rot; uniform vec2 u_res; uniform float u_R; uniform float u_D; uniform float u_t; uniform float u_mode; uniform vec2 u_off; uniform float u_k; varying vec3 v_col; varying float v_a; varying float v_mode;' +
      'void main() { float la = radians(a_ll.x), lo = radians(a_ll.y); vec3 p = vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));' +
      ' float x1 = p.x * u_rot.x - p.z * u_rot.y, z1 = p.x * u_rot.y + p.z * u_rot.x, y2 = p.y * u_rot.z - z1 * u_rot.w, z2 = p.y * u_rot.w + z1 * u_rot.z; float f = u_D / (u_D - z2);' +
      ' gl_Position = vec4((x1 * u_R * f + u_off.x) / (u_res.x * 0.5), (y2 * u_R * f - u_off.y) / (u_res.y * 0.5), -z2 * 0.5, 1.0);' +
      ' float rise = smoothstep(0.0, 1.0, u_t); v_col = u_mode < 0.5 ? vec3(0.98, 0.9, 0.78) : a_col; v_mode = u_mode; float zin = smoothstep(2.2, 3.6, u_k), keep = a_col.x > 1.5 ? zin : a_col.x > 0.5 ? 1.0 - zin : 1.0;' +
      ' v_a = u_mode < 0.5 ? smoothstep(-0.2, 0.35, z2) * (0.25 + 0.75 * smoothstep(-0.2, 0.8, z2)) * rise * keep : smoothstep(-0.05, 0.12, z2) * rise;' +
      ' gl_PointSize = a_size * f * (u_mode < 0.5 ? clamp(pow(u_R / 320.0, 0.7), 0.8, 3.6) : (0.6 + 0.4 * rise)); }';
    var fs = 'precision mediump float; varying vec3 v_col; varying float v_a; varying float v_mode;' +
      'void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0 || v_a < 0.01) discard;' +
      ' if (v_mode < 0.5) { float a = (1.0 - smoothstep(0.55, 1.0, d)) * v_a; gl_FragColor = vec4(v_col * a, a); return; }' +
      ' if (v_mode > 1.5) { float ring = smoothstep(0.62, 0.72, d) * (1.0 - smoothstep(0.86, 1.0, d)); gl_FragColor = vec4(vec3(1.0, 0.94, 0.82) * ring * v_a, ring * v_a); return; }' +
      ' float dot = 1.0 - smoothstep(0.62, 0.92, d); float core = 1.0 - smoothstep(0.3, 0.5, d); vec3 c = mix(vec3(0.16, 0.09, 0.04), v_col, core); gl_FragColor = vec4(c * dot * v_a, dot * v_a); }';
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    ['a_ll', 'a_size', 'a_col'].forEach(function (n) { loc[n] = gl.getAttribLocation(prog, n); });
    ['u_rot', 'u_res', 'u_R', 'u_D', 'u_t', 'u_mode', 'u_off', 'u_k'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    gl.enable(gl.BLEND);
    return true;
  }
  function bind(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc.a_ll); gl.vertexAttribPointer(loc.a_ll, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(loc.a_size); gl.vertexAttribPointer(loc.a_size, 1, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(loc.a_col); gl.vertexAttribPointer(loc.a_col, 3, gl.FLOAT, false, 24, 12);
  }
  function scoreColour(avg) { var t = Math.max(0, Math.min(1, (avg - 85) / 8)); return [0.95, 0.5 + 0.35 * t, 0.18 + 0.32 * t * t]; }
  function upload(g) {
    var landRaw = g.land, detail = g.detail || [], patches = g.patches || [], a = new Float32Array(((landRaw.length + detail.length) / 2) * 6), j = 0;
    function inPatch(lat, lon) { return patches.some(function (b) { return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]; }); }
    for (var i = 0; i < landRaw.length; i += 2, j += 6) { a[j] = landRaw[i] / 10; a[j + 1] = landRaw[i + 1] / 10; a[j + 2] = 2.1 * dpr; a[j + 3] = inPatch(a[j], a[j + 1]) ? 1 : 0; }
    for (i = 0; i < detail.length; i += 2, j += 6) { a[j] = detail[i] / 100; a[j + 1] = detail[i + 1] / 100; a[j + 2] = 1.15 * dpr; a[j + 3] = 2; }
    land = j / 6; landBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, landBuf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
    var b = new Float32Array(places.length * 6);
    places.forEach(function (p, i) { var c = scoreColour(p.avg), o = i * 6; b[o] = p.lat; b[o + 1] = p.lon; b[o + 2] = (4 + Math.sqrt(p.count) * 1.6) * dpr; b[o + 3] = c[0]; b[o + 4] = c[1]; b[o + 5] = c[2]; });
    placeBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, placeBuf); gl.bufferData(gl.ARRAY_BUFFER, b, gl.STATIC_DRAW);
    ringBuf = gl.createBuffer();
  }

  function resize() {
    var r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    dirty = true;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (target) {
      var e = reduce ? 1 : 0.08, dy = ((target.yaw - view.yaw + 540) % 360) - 180;
      view.yaw += dy * e; view.pitch += (target.pitch - view.pitch) * e; view.k += (target.k - view.k) * e;
      if (Math.abs(dy) < 0.05 && Math.abs(target.pitch - view.pitch) < 0.05 && Math.abs(target.k - view.k) < 0.003) target = null;
      dirty = true;
    } else if (Math.abs(spin.yaw) + Math.abs(spin.pitch) > 0.01) {
      view.yaw += spin.yaw; view.pitch = Math.max(-80, Math.min(80, view.pitch + spin.pitch)); spin.yaw *= 0.94; spin.pitch *= 0.94; dirty = true;
    } else if (!reduce && selected < 0 && hover < 0 && now - idleAt > 2500 && !drag) { view.yaw += 0.035; dirty = true; }
    var phone = W < 760, want = selected < 0 ? { x: 0, y: 0 } : phone ? { x: 0, y: -H * 0.24 } : { x: -Math.min(200, W * 0.18), y: 0 };
    if (Math.abs(want.x - off.x) + Math.abs(want.y - off.y) > 0.5) { var g = reduce ? 1 : 0.1; off.x += (want.x - off.x) * g; off.y += (want.y - off.y) * g; dirty = true; }
    var t = reduce ? 1 : Math.min(1, (now - born) / 1400);
    if (t < 1) dirty = true;
    if (!dirty || !gl) return;
    dirty = false;
    var R = radius();
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(loc.u_rot, Math.cos(rad(view.yaw)), Math.sin(rad(view.yaw)), Math.cos(rad(view.pitch)), Math.sin(rad(view.pitch)));
    gl.uniform2f(loc.u_res, W, H); gl.uniform1f(loc.u_R, R); gl.uniform1f(loc.u_D, D); gl.uniform1f(loc.u_t, t); gl.uniform2f(loc.u_off, off.x, off.y); gl.uniform1f(loc.u_k, view.k);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(loc.u_mode, 0); bind(landBuf); gl.drawArrays(gl.POINTS, 0, land);
    gl.uniform1f(loc.u_mode, 1); bind(placeBuf); gl.drawArrays(gl.POINTS, 0, places.length);
    if (selected >= 0) { var p = places[selected]; gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); bind(ringBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([p.lat, p.lon, 30 * dpr, 1, 1, 1]), gl.DYNAMIC_DRAW); gl.uniform1f(loc.u_mode, 2); gl.drawArrays(gl.POINTS, 0, 1); }
    halo.style.setProperty('--r', R.toFixed(0) + 'px'); halo.style.setProperty('--x', (W / 2 + off.x).toFixed(0) + 'px'); halo.style.setProperty('--y', (H / 2 + off.y).toFixed(0) + 'px');
    if (hover >= 0) showTip(hover);
  }

  function nearest(sx, sy, r) {
    var best = -1, bd = r * r;
    places.forEach(function (p, i) { var s = project(p.lat, p.lon); if (s[2] < 0.05) return; var dx = s[0] - sx, dy = s[1] - sy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function showTip(i) {
    var p = places[i], s = project(p.lat, p.lon);
    if (s[2] < 0.05) { tip.hidden = true; return; }
    tip.innerHTML = '<strong>' + esc(p.n) + '</strong><span>' + esc(p.place) + '</span><em>' + p.count + ' ratings · average ' + p.avg + '</em>';
    tip.hidden = false;
    var x = Math.min(W - tip.offsetWidth - 10, Math.max(10, s[0] + 14)), y = s[1] - tip.offsetHeight - 12; if (y < 10) y = s[1] + 16;
    tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }
  function select(i) {
    selected = i; dirty = true;
    stage.classList.toggle('has-panel', i >= 0);
    if (i >= 0) jumps.querySelectorAll('[data-j]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
    if (i < 0) { panel.hidden = true; return; }
    var p = places[i], kind = { distillery: 'Distillery', blender: 'Blender', bottler: 'Independent bottler', brand: 'Brand' }[p.kind] || 'Producer';
    var top = data.filter(function (r) { return r.pr === p.n; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 5);
    panel.innerHTML = '<button type="button" class="fmap-close" aria-label="Close">×</button><p class="mono">' + esc(kind) + ' · ' + esc(p.country) + '</p><h2>' + esc(p.n) + '</h2><p class="globe-place">' + esc(p.place) + '</p>' +
      '<p class="fmap-score"><span class="score-type">' + p.avg + '</span><span>average of ' + p.count + ' ratings</span></p>' +
      (top.length ? '<h3 class="mono">Highest rated</h3><ul class="fmap-near">' + top.map(function (r) { return '<li><a href="' + esc(WA.bottleHref(r)) + '"><span class="score-type">' + r.s + '</span><span>' + esc(r.n) + '<small>' + esc(r.c) + (r.p ? ' · ' + WA.fmt(r.p) : '') + '</small></span></a></li>'; }).join('') + '</ul>' : '') +
      '<a class="pill solid" href="' + esc(WA.producerHref(p.n)) + '">Every rating from ' + esc(p.n) + '</a>';
    panel.hidden = false;
    target = { yaw: p.lon, pitch: p.lat, k: Math.max(view.k, 3) };
    WA.track && WA.track('globe_select', { producer: p.n });
  }
  panel.addEventListener('click', function (e) { if (e.target.closest('.fmap-close')) select(-1); });

  var pointers = {}, drag = null, pinch = null, moved = false;
  function local(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId); pointers[e.pointerId] = local(e); moved = false; target = null; spin = { yaw: 0, pitch: 0 }; idleAt = performance.now();
    var ids = Object.keys(pointers);
    if (ids.length === 1) drag = { p: local(e), last: local(e), at: performance.now() };
    else if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; }
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = local(e); if (pointers[e.pointerId]) pointers[e.pointerId] = p;
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; view.k = Math.max(0.7, Math.min(9, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); moved = true; dirty = true; return; }
    if (drag) {
      var dx = p[0] - drag.last[0], dy = p[1] - drag.last[1]; if (Math.abs(p[0] - drag.p[0]) + Math.abs(p[1] - drag.p[1]) > 4) moved = true;
      if (moved) { var per = 180 / (Math.PI * radius()); view.yaw -= dx * per; view.pitch = Math.max(-80, Math.min(80, view.pitch + dy * per)); spin = { yaw: -dx * per * 0.9, pitch: dy * per * 0.9 }; drag.last = p; dirty = true; tip.hidden = true; hover = -1; }
      return;
    }
    if (e.pointerType === 'mouse') { var i = nearest(p[0], p[1], 14); if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : 'grab'; if (i < 0) tip.hidden = true; else showTip(i); } idleAt = performance.now(); }
  });
  function up(e) {
    var p = local(e), tap = drag && !moved && !pinch;
    delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinch = null; if (!Object.keys(pointers).length) drag = null;
    idleAt = performance.now();
    if (tap) { var i = nearest(p[0], p[1], e.pointerType === 'mouse' ? 14 : 22); if (i >= 0) select(i); }
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', function () { if (hover >= 0) { hover = -1; tip.hidden = true; } });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); target = null; view.k = Math.max(0.7, Math.min(9, view.k * Math.exp(-e.deltaY * 0.0018))); dirty = true; idleAt = performance.now(); }, { passive: false });
  document.getElementById('globeZoomIn').onclick = function () { target = { yaw: view.yaw, pitch: view.pitch, k: Math.min(9, view.k * 1.6) }; };
  document.getElementById('globeZoomOut').onclick = function () { target = { yaw: view.yaw, pitch: view.pitch, k: Math.max(0.7, view.k / 1.6) }; };

  jumps.innerHTML = JUMPS.map(function (j) { return '<button type="button" class="pill" data-j="' + j.id + '">' + esc(j.label) + '</button>'; }).join('');
  jumps.addEventListener('click', function (e) { var b = e.target.closest('[data-j]'); if (!b) return; var j = JUMPS.filter(function (x) { return x.id === b.getAttribute('data-j'); })[0]; select(-1); target = { yaw: j.lon, pitch: j.lat, k: j.k }; jumps.querySelectorAll('[data-j]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); });

  var find = document.getElementById('globeFind'), suggest = document.getElementById('globeSuggest');
  find.addEventListener('input', function () { var q = find.value.trim().toLowerCase(); var list = q ? places.map(function (p, i) { return { p: p, i: i }; }).filter(function (x) { return x.p.n.toLowerCase().indexOf(q) >= 0 || x.p.place.toLowerCase().indexOf(q) >= 0; }).slice(0, 7) : []; suggest.innerHTML = list.map(function (x) { return '<li><button type="button" data-i="' + x.i + '"><span class="score-type">' + x.p.avg + '</span>' + esc(x.p.n) + ' <small>' + esc(x.p.place) + '</small></button></li>'; }).join(''); suggest.hidden = !list.length; });
  suggest.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; suggest.hidden = true; find.value = ''; select(+b.getAttribute('data-i')); });
  document.getElementById('globeFindForm').addEventListener('submit', function (e) { e.preventDefault(); var b = suggest.querySelector('[data-i]'); if (b) b.click(); });

  WA.archive(function (rows) {
    data = rows;
    WA.loadJSON('globe.json').then(function (g) {
      places = g.places;
      resize();
      if (!setup()) { status.textContent = 'The globe needs WebGL, which this browser has turned off.'; return; }
      upload(g); born = performance.now(); idleAt = born; requestAnimationFrame(frame);
      var countries = {}; places.forEach(function (p) { countries[p.country] = 1; });
      status.textContent = places.length + ' producers in ' + Object.keys(countries).length + ' countries. Lights grow with the number of ratings and warm with the average score.';
      var want = WA.hashSlug().toLowerCase(), hit = want ? places.findIndex(function (p) { return p.n.toLowerCase() === want; }) : -1;
      if (hit >= 0) setTimeout(function () { select(hit); }, reduce ? 0 : 900);
    }).catch(function () { status.textContent = 'The globe could not load. Try again in a moment.'; });
  });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else addEventListener('resize', resize);
})();
