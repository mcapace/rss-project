/* Water your whisky (water.html): any rated bottle, a target strength, and exactly how much water to add, drawn in a WebGL
   Glencairn; the perfect-proof calculator from Charles K. Cowdery's guide; and a lineup of bottles at one strength with the
   cost of each glass once the water is in. */
(function () {
  "use strict";
  var ML = 29.5735, BOTTLE_OZ = 750 / ML, CAPACITY = 6;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var store = { get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  var track = function (n, p) { if (window.WA && WA.track) WA.track(n, p || {}); };

  var POURS = { oz: [1, 1.5, 2, 3], ml: [25, 35, 50, 75] };
  var S = { row: null, unit: "oz", scale: "abv", pour: 2, target: 45, lineup: [], brand: null };
  var DATA = [], GL = null;

  var fmtPct = function (v) { return (Math.round(v * 10) / 10).toString().replace(/\.0$/, "") + "%"; };
  var fmtStrength = function (v) { return S.scale === "proof" ? (Math.round(v * 20) / 10).toString().replace(/\.0$/, "") + " proof" : fmtPct(v); };
  var trim = function (n, d) { return (+n.toFixed(d)).toString(); };
  function fmtVol(oz) { return S.unit === "ml" ? trim(oz * ML, oz * ML < 10 ? 1 : 0) + " ml" : trim(oz, oz < 1 ? 2 : 1) + " oz"; }
  function waterFor(pour, abv, target) { return target >= abv ? 0 : pour * (abv / target - 1); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").replace(/[^a-z0-9.%]+/g, " ").trim(); }

  /* ---- the glass ---------------------------------------------------------------------------------------------------- */
  // Glass profile in glass units (x half-width, y 0..1), shared by the shader and the fill-level maths.
  function bowlW(y) { var t = Math.min(1, Math.max(0, (y - 0.17) / 0.75)); return 0.10 + 0.17 * Math.sin(Math.PI * (Math.pow(t, 0.6) * 0.92 + 0.04)) * (1 - 0.55 * t) + 0.025 * smooth(0.85, 1, t); }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  var Y0 = 0.19, YMAX = 0.9, VTAB = [];
  (function () { var v = 0, n = 400; for (var i = 0; i <= n; i++) { var y = Y0 + (YMAX - Y0) * i / n; if (i) { var w = bowlW(y) - 0.012; v += w * w * (YMAX - Y0) / n; } VTAB.push([y, v]); } })();
  function levelFor(oz) { var f = Math.min(1, oz / CAPACITY) * VTAB[VTAB.length - 1][1]; for (var i = 1; i < VTAB.length; i++) if (VTAB[i][1] >= f) { var a = VTAB[i - 1], b = VTAB[i]; return a[0] + (b[0] - a[0]) * ((f - a[1]) / (b[1] - a[1] || 1)); } return YMAX; }

  var FRAG = [
    "precision highp float;",
    "uniform vec2 u_res; uniform float u_t, u_l0, u_l1, u_mix, u_S, u_by;",
    "uniform vec3 u_c0, u_c1;",
    "const float PI = 3.14159265;",
    "float sm(float a, float b, float x) { return smoothstep(a, b, x); }",
    "float bowlW(float y) { float t = clamp((y - 0.17) / 0.75, 0.0, 1.0); return 0.10 + 0.17 * sin(PI * (pow(t, 0.6) * 0.92 + 0.04)) * (1.0 - 0.55 * t) + 0.025 * sm(0.85, 1.0, t); }",
    "float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }",
    "float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }",
    "void main() {",
    "  vec2 px = gl_FragCoord.xy; vec2 p = vec2((px.x - u_res.x * 0.5) / u_S, (px.y - u_by) / u_S);",
    "  float ax = abs(p.x), aa = 1.5 / u_S; vec3 col = vec3(0.0); float a = 0.0;",
    // light pool on the table, tinted by the whisky
    "  float pool = exp(-pow(p.x / 0.34, 2.0) - pow((p.y - 0.035) / 0.03, 2.0)) * (0.35 + 0.4 * (u_l1 - 0.19));",
    "  col += mix(u_c1, vec3(1.0, 0.8, 0.5), 0.3) * pool; a += pool * 0.9;",
    "  float wo = 0.0; if (p.y > 0.04 && p.y < 0.08) wo = 0.205; else if (p.y >= 0.08 && p.y < 0.17) wo = mix(0.125, 0.15, sm(0.08, 0.17, p.y)); else if (p.y >= 0.17 && p.y < 0.92) wo = bowlW(p.y);",
    "  float inG = (1.0 - sm(wo - aa, wo + aa, ax)) * step(0.04, p.y) * step(p.y, 0.92);",
    "  float wi = (p.y > 0.19) ? wo - 0.012 : 0.0;",
    "  float inB = (1.0 - sm(wi - aa, wi + aa, ax)) * step(0.19, p.y);",
    "  if (inG > 0.0) {",
    "    float edge = 1.0 - sm(0.0, 0.03, wo - ax);",
    "    float spec = exp(-pow((p.x + wo * 0.62) / (wo * 0.08 + 0.004), 2.0)) * sm(0.2, 0.32, p.y) * (1.0 - sm(0.7, 0.86, p.y));",
    "    float solid = 1.0 - inB;",
    "    vec3 g = vec3(1.0, 0.97, 0.92); float ga = 0.05 + 0.18 * solid + 0.55 * edge + 0.5 * spec;",
    "    if (p.y < 0.19) { float caust = fbm(vec2(p.x * 14.0, p.y * 30.0 + u_t * 0.3)); g = mix(g, u_c1 * 1.4, 0.35); ga += 0.12 * caust; }",
    "    float rim = exp(-pow((p.y - 0.918) / 0.004, 2.0)); ga += rim * 0.6;",
    "    if (inB > 0.0) {",
    "      float wave = 0.0025 * sin(p.x * 34.0 + u_t * 1.7) + 0.0015 * sin(p.x * 61.0 - u_t * 2.3);",
    "      float surf = u_l1 + wave;",
    "      float liq = 1.0 - sm(surf - aa, surf + aa, p.y);",
    "      if (liq > 0.0) {",
    "        float n = fbm(vec2(p.x * 9.0 + sin(u_t * 0.4) * 0.6, p.y * 11.0 - u_t * 0.45));",
    "        float pre = sm(u_l0 - 0.004, u_l0 + 0.004, p.y);",
    "        vec3 water = vec3(0.86, 0.9, 0.92);",
    "        vec3 c0 = mix(u_c0, water, pre * 0.85);",
    "        float m = clamp(u_mix * 1.5 - 0.5 + (n - 0.5) * 1.2 * (1.0 - u_mix), 0.0, 1.0);",
    "        vec3 lc = mix(c0, u_c1, m);",
    "        float streak = (1.0 - abs(u_mix * 2.0 - 1.0)) * pow(abs(sin(n * 22.0 + p.y * 8.0)), 10.0);",
    "        lc += streak * 0.22;",
    "        float side = pow(ax / max(wi, 0.01), 2.0);",
    "        lc *= 1.0 - 0.38 * side; lc *= 0.82 + 0.3 * sm(0.19, surf, p.y);",
    "        float men = exp(-pow((p.y - surf + 0.003) / 0.0035, 2.0));",
    "        lc += men * 0.35;",
    "        float la = mix(0.55, 0.93, 1.0 - pre * (1.0 - m) * 0.7);",
    "        col = mix(col, lc, liq * la); a = mix(a, 1.0, liq * la);",
    "      }",
    "    }",
    "    col = col * (1.0 - ga * inG) + g * ga * inG; a = a + (1.0 - a) * ga * inG;",
    "  }",
    "  gl_FragColor = vec4(col * 1.0, clamp(a, 0.0, 1.0));",
    "  gl_FragColor.rgb *= 1.0; gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(gl_FragColor.a));",
    "}"
  ].join("\n");

  function glass(canvas) {
    var gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: true, alpha: true });
    if (!gl) return null;
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
    var vs = sh(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ["u_res", "u_t", "u_l0", "u_l1", "u_mix", "u_S", "u_by", "u_c0", "u_c1"].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    var st = { l0: 0.3, l1: 0.34, tl0: 0.3, tl1: 0.34, mix: 1, c0: [0.72, 0.36, 0.09], c1: [0.85, 0.55, 0.2], tc1: [0.85, 0.55, 0.2] };
    var W = 0, H = 0, dpr = 1, raf = 0, visible = true, t0 = performance.now(), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function geom() { var Sc = Math.min(H * 0.98, W * 1.6); return { S: Sc, by: H * 0.02 + Math.max(0, (H - Sc) * 0.5) }; }
    function size() { var r = canvas.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr)); canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); }
    function frame(now) {
      raf = 0; var t = (now - t0) / 1000, k = still ? 1 : 0.09;
      st.l0 += (st.tl0 - st.l0) * k; st.l1 += (st.tl1 - st.l1) * k;
      for (var i = 0; i < 3; i++) st.c1[i] += (st.tc1[i] - st.c1[i]) * k;
      st.mix = still ? 1 : Math.min(1, st.mix + 0.009);
      var g = geom();
      gl.uniform2f(U.u_res, W, H); gl.uniform1f(U.u_t, still ? 0 : t); gl.uniform1f(U.u_l0, st.l0); gl.uniform1f(U.u_l1, st.l1); gl.uniform1f(U.u_mix, st.mix);
      gl.uniform1f(U.u_S, g.S); gl.uniform1f(U.u_by, g.by); gl.uniform3fv(U.u_c0, st.c0); gl.uniform3fv(U.u_c1, st.c1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (visible && !still) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) kick(); }).observe(canvas);
    new ResizeObserver(function () { size(); kick(); if (GL && GL.onResize) GL.onResize(); }).observe(canvas);
    size();
    return {
      set: function (l0, l1, c0, c1, poured) { st.tl0 = l0; st.tl1 = l1; st.c0 = c0; st.tc1 = c1; if (poured) st.mix = Math.min(st.mix, 0.25); kick(); },
      toPx: function (y, x) { var g = geom(); return { x: (W * 0.5 + x * g.S) / dpr, y: (H - (g.by + y * g.S)) / dpr }; }
    };
  }

  /* Deep amber at bottle strength, paler and more golden as the water goes in. */
  function colors(abv, target) {
    var deep = [0.62, 0.29, 0.07], pale = [0.95, 0.74, 0.38], f = abv > target ? Math.min(1, (abv - target) / abv * 1.6) : 0;
    return [deep, deep.map(function (d, i) { return d + (pale[i] - d) * f; })];
  }

  /* ---- search ------------------------------------------------------------------------------------------------------ */
  var BRANDS = [];
  function index() {
    var P = {};
    DATA.forEach(function (r) { r._n = norm(r.n + " " + r.pr); if (!r.pr || r.pr === "Unknown producer") return; (P[r.pr] || (P[r.pr] = { name: r.pr, key: norm(r.pr), rows: [] })).rows.push(r); });
    BRANDS = Object.keys(P).map(function (k) { return P[k]; }).sort(function (a, b) { return b.rows.length - a.rows.length; });
  }
  function search(q) {
    var t = norm(q).split(" ").filter(Boolean); if (!t.length) return { brands: [], rows: [] };
    var brands = BRANDS.filter(function (b) { return t.every(function (w) { return b.key.indexOf(w) >= 0; }); }).slice(0, 3);
    var rows = DATA.filter(function (r) { return t.every(function (w) { return r._n.indexOf(w) >= 0; }); })
      .sort(function (a, b) { return (b.s - a.s) || (b.d > a.d ? 1 : -1); }).slice(0, 7);
    return { brands: brands, rows: rows };
  }
  var sugIdx = -1;
  function suggest() {
    var q = $("wtFind").value, ul = $("wtSuggest"), r = search(q); sugIdx = -1;
    if (!q.trim() || (!r.brands.length && !r.rows.length)) { ul.hidden = true; ul.innerHTML = q.trim() ? '<li class="wt-none">No rated bottle matches that.</li>' : ""; ul.hidden = !q.trim(); return; }
    ul.innerHTML = r.brands.map(function (b) { return '<li role="option"><button type="button" data-brand="' + esc(b.name) + '"><span class="wt-sug-k mono">Brand</span><span class="wt-sug-n">' + esc(b.name) + '</span><span class="wt-sug-m">' + b.rows.length + (b.rows.length === 1 ? " rating" : " ratings") + "</span></button></li>"; }).join("")
      + r.rows.map(function (x) { return '<li role="option"><button type="button" data-slug="' + esc(x.slug) + '"><span class="score-type">' + x.s + '</span><span class="wt-sug-n">' + esc(x.n) + '</span><span class="wt-sug-m">' + fmtStrength(x.a) + "</span></button></li>"; }).join("");
    ul.hidden = false;
  }
  function pickSug(btn) {
    $("wtSuggest").hidden = true;
    if (btn.hasAttribute("data-brand")) { var b = BRANDS.filter(function (x) { return x.name === btn.getAttribute("data-brand"); })[0]; if (b) brand(b); track("water_brand", { brand: b && b.name }); }
    else { var r = WA.find(DATA, btn.getAttribute("data-slug")); if (r) { S.brand = null; choose(r); } }
    $("wtFind").value = "";
  }

  /* A brand: its bottles by strength, so the lighter and the stronger expressions sit side by side. */
  function brandRows(b) {
    var seen = {}; return b.rows.filter(function (r) { return r.a > 0; }).sort(function (x, y) { return (y.d > x.d ? 1 : -1); })
      .filter(function (r) { var k = norm(r.n).replace(/\b(19|20)\d\d\b/g, ""); if (seen[k]) return false; seen[k] = 1; return true; })
      .sort(function (x, y) { return x.a - y.a || y.s - x.s; });
  }
  function brand(b) {
    S.brand = b; var rows = brandRows(b);
    var best = rows.slice().sort(function (x, y) { return y.s - x.s; })[0];
    if (best) choose(best);
  }

  /* ---- render -------------------------------------------------------------------------------------------------------- */
  function bottleCard() {
    var r = S.row, el = $("wtBottle"); if (!r) { el.innerHTML = ""; return; }
    var html = '<div class="wt-b-main"><span class="wt-b-score">' + r.s + '</span><div><a class="wt-b-name" href="' + esc(WA.bottleHref(r)) + '">' + esc(r.n.replace(/,\s*[\d.]+%\s*$/, "")) + '</a><span class="wt-b-meta">' + esc(r.c) + (r.p ? " · $" + r.p : "") + '</span></div><span class="wt-b-abv"><b>' + fmtPct(r.a) + "</b>" + (Math.round(r.a * 20) / 10) + " proof</span></div>";
    if (S.brand) {
      var rows = brandRows(S.brand);
      html += '<div class="wt-brand"><div class="wt-row"><span class="mono wt-lab">' + esc(S.brand.name) + " by strength</span>" + (rows.length > 1 ? '<button type="button" class="wt-link" id="wtLineAll">Line them up</button>' : "") + '</div><div class="wt-brand-list">'
        + rows.slice(0, 14).map(function (x) { return '<button type="button" class="wt-chip" data-slug="' + esc(x.slug) + '" aria-pressed="' + (x === r) + '" title="' + esc(x.n) + '"><b>' + fmtPct(x.a) + "</b><span>" + esc(short(x.n, S.brand.name)) + "</span></button>"; }).join("") + "</div></div>";
    }
    el.innerHTML = html;
  }
  function short(n, brandName) { var s = n.replace(/,\s*[\d.]+%\s*$/, ""); if (brandName && s.toLowerCase().indexOf(brandName.toLowerCase()) === 0) s = s.slice(brandName.length).replace(/^[\s:–-]+/, ""); return s.length > 34 ? s.slice(0, 33).replace(/\s\S*$/, "") + "…" : (s || n); }

  function pours() {
    var el = $("wtPour"), cur = S.unit === "ml" ? Math.round(S.pour * ML) : S.pour;
    el.innerHTML = POURS[S.unit].map(function (v) { return '<button type="button" data-v="' + v + '" aria-pressed="' + (Math.abs(v - cur) < (S.unit === "ml" ? 1 : 0.01)) + '">' + v + " " + S.unit + "</button>"; }).join("");
    document.querySelectorAll("[data-unit-label]").forEach(function (e) { e.textContent = S.unit; });
  }

  function slider() {
    var r = S.row, inp = $("wtTarget"); if (!r) return;
    var max = Math.max(20.5, Math.min(70, Math.floor((r.a - 0.5) * 2) / 2)), min = 20;
    inp.min = min; inp.max = max; inp.disabled = r.a <= 20.5;
    S.target = Math.min(Math.max(S.target, min), max); inp.value = S.target;
    var marks = [[50, "Pappy Van Winkle"], [40, "Bottling strength"], [r.a / 2, "Booker Noe’s 1:1"]].filter(function (m) { return m[0] >= min && m[0] <= max; });
    var prev = -99, low = false;
    $("wtMarks").innerHTML = marks.sort(function (a, b) { return a[0] - b[0]; }).map(function (m) { var x = (m[0] - min) / (max - min) * 100; low = x - prev < 24 ? !low : false; prev = x; return '<button type="button" class="' + (low ? "lo" : "") + '" data-t="' + m[0] + '" style="left:' + x.toFixed(2) + '%"><i></i><span>' + m[1] + "<b>" + fmtStrength(m[0]) + "</b></span></button>"; }).join("");
    inp.style.setProperty("--fill", ((S.target - min) / (max - min) * 100).toFixed(2) + "%");
  }

  var lastWater = -1;
  function update(opts) {
    var r = S.row; if (!r) return; opts = opts || {};
    var A = r.a, T = Math.min(S.target, A), V = S.pour, W = waterFor(V, A, T), F = V + W;
    $("wtTargetOut").textContent = fmtStrength(T);
    $("wtTargetSub").textContent = S.scale === "proof" ? fmtPct(T) + " ABV" : (Math.round(T * 20) / 10) + " proof";
    $("wtTarget").style.setProperty("--fill", ((T - $("wtTarget").min) / ($("wtTarget").max - $("wtTarget").min) * 100).toFixed(2) + "%");
    var ml = W * ML, alt;
    if (A <= 20.5 || W <= 0) { $("wtWater").textContent = "No water"; alt = "This bottle is already at " + fmtStrength(A) + "."; }
    else if (ml < 2.5) { $("wtWater").textContent = Math.max(1, Math.round(ml * 20)) + (Math.round(ml * 20) === 1 ? " drop" : " drops"); alt = trim(ml, 1) + " ml"; }
    else { $("wtWater").textContent = fmtVol(W); var tsp = ml / 4.929; alt = (S.unit === "ml" ? trim(W, 2) + " oz" : trim(ml, 0) + " ml") + " · " + (tsp < 12 ? (WA.fmtAmount ? WA.fmtAmount(tsp) : trim(tsp, 1)) + " teaspoons" : trim(ml / 14.787, 1) + " tablespoons"); }
    $("wtWaterAlt").textContent = alt;
    var parts = W > 0 ? V / W : 0;
    $("wtSummary").innerHTML = W > 0 ? fmtVol(V) + " at " + fmtStrength(A) + " becomes <b>" + fmtVol(F) + " at " + fmtStrength(T) + "</b>." + (parts >= 0.75 && parts <= 40 ? " About " + (parts >= 1.5 ? Math.round(parts) + " parts whisky to 1 of water." : "equal parts whisky and water.") : "") : "Pour it as it comes.";
    if (GL) {
      var c = colors(A, T), poured = W > lastWater + 0.01 && !opts.quiet;
      GL.set(levelFor(V), levelFor(F), c[0], c[1], poured); lastWater = W;
      levels(V, F, W);
    }
    perfect(); lineup(); url();
  }
  function levels(V, F, W) {
    var el = $("wtLevels"); if (!GL) return;
    var l0 = levelFor(V), l1 = levelFor(F), p0 = GL.toPx(l0, -bowlW(l0) - 0.025), p1 = GL.toPx(l1, -bowlW(l1) - 0.025);
    var cv = $("wtGlass"), ox = cv.offsetLeft, oy = cv.offsetTop; p0.x += ox; p1.x += ox; p0.y += oy; p1.y += oy;
    var gap = p0.y - p1.y;
    el.innerHTML = '<span class="wt-lv wt-lv-w" style="left:' + p0.x.toFixed(1) + "px;top:" + (W > 0 && gap < 24 ? p1.y + 24 : p0.y).toFixed(1) + 'px">Whisky <b>' + fmtVol(V) + "</b><i></i></span>"
      + (W > 0 ? '<span class="wt-lv wt-lv-a" style="left:' + p1.x.toFixed(1) + "px;top:" + p1.y.toFixed(1) + 'px">With water <b>' + fmtVol(F) + "</b><i></i></span>" : "");
  }

  function perfect() {
    var r = S.row; if (!r) return;
    var k = S.unit === "ml" ? 1 / ML : 1, V = parseFloat($("ppWhisky").value) * k, W = parseFloat($("ppWater").value) * k;
    if (!(V > 0) || !(W >= 0)) { $("ppOut").textContent = "–"; return; }
    var T = V / (V + W) * r.a; S.pp = T;
    $("ppOut").innerHTML = fmtStrength(T) + '<small>from ' + esc(short(r.n)) + " at " + fmtStrength(r.a) + "</small>";
  }

  /* Each bottle at the chosen strength: whisky and water for one glass the size of the pour, and what that glass costs. */
  function lineup() {
    var el = $("wtLineup"), rows = S.lineup.map(function (s) { return WA.find(DATA, s); }).filter(Boolean);
    $("wtAdd").disabled = !S.row || S.lineup.indexOf(S.row.slug) >= 0 || S.lineup.length >= 6;
    if (!rows.length) { el.innerHTML = '<p class="wt-empty muted">Add the bottle above, or search a brand and line up its expressions.</p>'; return; }
    var F = S.pour, T = S.target;
    var calc = rows.map(function (r) { var T2 = Math.min(T, r.a), wh = F * T2 / r.a; return { r: r, T: T2, wh: wh, wa: F - wh, cost: r.p ? r.p / BOTTLE_OZ * wh : null }; });
    var costs = calc.filter(function (c) { return c.cost != null; }).map(function (c) { return c.cost; }), maxC = Math.max.apply(null, costs.concat([0.01])), minC = Math.min.apply(null, costs.length ? costs : [0]);
    el.innerHTML = '<div class="wt-l-head mono"><span>Bottle</span><span>Bottled</span><span>For a ' + fmtVol(F) + " glass at " + fmtStrength(T) + "</span><span>Per glass</span><span></span></div>"
      + calc.map(function (c) {
        var r = c.r, best = c.cost != null && costs.length > 1 && c.cost === minC;
        return '<div class="wt-l-row' + (r === S.row ? " is-cur" : "") + '"><a href="' + esc(WA.bottleHref(r)) + '" class="wt-l-name"><b>' + r.s + "</b>" + esc(r.n.replace(/,\s*[\d.]+%\s*$/, "")) + "</a>"
          + '<span class="wt-l-abv">' + fmtStrength(r.a) + "</span>"
          + '<span class="wt-l-mix"><span class="wt-l-bar"><i style="width:' + (c.wh / F * 100).toFixed(1) + '%"></i></span>' + (c.T < T ? "Already below " + fmtStrength(T) : c.wa < 0.005 ? "Already at " + fmtStrength(T) : fmtVol(c.wh) + " whisky + " + fmtVol(c.wa) + " water") + "</span>"
          + '<span class="wt-l-cost">' + (c.cost != null ? '<span class="wt-l-cbar"><i style="width:' + (c.cost / maxC * 100).toFixed(1) + '%"></i></span>$' + c.cost.toFixed(2) + (best ? '<em>Best buy</em>' : "") : '<span class="muted">No price</span>') + "</span>"
          + '<button type="button" class="wt-x" data-rm="' + esc(r.slug) + '" aria-label="Remove ' + esc(r.n) + '">×</button></div>';
      }).join("");
  }

  function url() {
    if (!S.row || !history.replaceState) return;
    var q = new URLSearchParams({ b: S.row.slug, t: String(S.target), v: String(+S.pour.toFixed(3)) });
    if (S.unit === "ml") q.set("u", "ml"); if (S.lineup.length) q.set("l", S.lineup.join(","));
    try { history.replaceState(null, "", location.pathname + "?" + q.toString()); } catch (e) {}
    store.set("wa.water", { b: S.row.slug, t: S.target, v: S.pour, u: S.unit, s: S.scale, l: S.lineup });
  }

  function choose(r) { S.row = r; bottleCard(); slider(); update(); }

  /* ---- events -------------------------------------------------------------------------------------------------------- */
  function wire() {
    var f = $("wtFind"), ul = $("wtSuggest");
    f.addEventListener("input", suggest);
    f.addEventListener("focus", function () { if (f.value.trim()) suggest(); });
    f.addEventListener("keydown", function (e) {
      var b = ul.querySelectorAll("button"); if (!b.length || ul.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + b.length) % b.length; b[sugIdx].focus(); }
      else if (e.key === "Escape") ul.hidden = true;
    });
    ul.addEventListener("keydown", function (e) {
      var b = [].slice.call(ul.querySelectorAll("button")), i = b.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); i = i + (e.key === "ArrowDown" ? 1 : -1); if (i < 0) { f.focus(); return; } b[Math.min(i, b.length - 1)].focus(); }
      else if (e.key === "Escape") { ul.hidden = true; f.focus(); }
    });
    $("wtFindForm").addEventListener("submit", function (e) { e.preventDefault(); var b = ul.querySelector("button"); if (b) pickSug(b); });
    ul.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) pickSug(b); });
    document.addEventListener("click", function (e) { if (!e.target.closest("#wtFindForm")) ul.hidden = true; });

    $("wtBottle").addEventListener("click", function (e) {
      var c = e.target.closest(".wt-chip"); if (c) { var r = WA.find(DATA, c.getAttribute("data-slug")); if (r) choose(r); return; }
      if (e.target.closest("#wtLineAll") && S.brand) {
        var rows = brandRows(S.brand), byAbv = {};
        rows.forEach(function (r) { var k = Math.round(r.a); if (!byAbv[k] || r.s > byAbv[k].s) byAbv[k] = r; });
        var all = Object.keys(byAbv).map(function (k) { return byAbv[k]; }).sort(function (a, b) { return a.a - b.a; }), n = Math.min(6, all.length), pick = [];
        for (var i = 0; i < n; i++) pick.push(all[Math.round(i * (all.length - 1) / Math.max(1, n - 1))]);
        S.lineup = pick.filter(function (r, i) { return pick.indexOf(r) === i; }).map(function (r) { return r.slug; });
        update({ quiet: true }); track("water_lineup_brand", { brand: S.brand.name });
        $("wtLineup").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    $("wtUnit").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || b.getAttribute("data-unit") === S.unit) return;
      var k = b.getAttribute("data-unit") === "ml" ? ML : 1 / ML;
      ["ppWhisky", "ppWater"].forEach(function (id) { var v = parseFloat($(id).value); if (v >= 0) $(id).value = trim(v * k, k > 1 ? 0 : 2); });
      $("ppWhisky").step = k > 1 ? "5" : "0.25"; $("ppWater").step = k > 1 ? "1" : "0.05";
      S.unit = b.getAttribute("data-unit");
      $("wtUnit").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      var opts = POURS[S.unit].map(function (v) { return S.unit === "ml" ? v / ML : v; }), near = opts.reduce(function (a, v) { return Math.abs(v - S.pour) < Math.abs(a - S.pour) ? v : a; });
      S.pour = near; pours(); update({ quiet: true });
    });
    $("wtScale").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; S.scale = b.getAttribute("data-scale");
      $("wtScale").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      bottleCard(); slider(); update({ quiet: true });
    });
    $("wtPour").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; var v = +b.getAttribute("data-v");
      S.pour = S.unit === "ml" ? v / ML : v; pours(); update();
    });
    $("wtTarget").addEventListener("input", function () { S.target = +this.value; update(); });
    $("wtTarget").addEventListener("change", function () { store.set("wa.proof", S.target); track("water_target", { target: S.target, slug: S.row && S.row.slug }); });
    $("wtMarks").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; S.target = Math.round(+b.getAttribute("data-t") * 2) / 2; $("wtTarget").value = S.target; store.set("wa.proof", S.target); update(); });
    ["ppWhisky", "ppWater"].forEach(function (id) { $(id).addEventListener("input", perfect); });
    $("ppUse").addEventListener("click", function () {
      if (!(S.pp > 0)) return; S.target = Math.round(S.pp * 2) / 2; store.set("wa.proof", S.target); slider(); update();
      track("water_perfect", { target: S.target }); $("wtStage").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("wtAdd").addEventListener("click", function () { if (!S.row || S.lineup.indexOf(S.row.slug) >= 0) return; S.lineup.push(S.row.slug); S.lineup = S.lineup.slice(-6); update({ quiet: true }); track("water_lineup_add", { slug: S.row.slug }); });
    $("wtLineup").addEventListener("click", function (e) { var b = e.target.closest("[data-rm]"); if (!b) return; S.lineup = S.lineup.filter(function (s) { return s !== b.getAttribute("data-rm"); }); update({ quiet: true }); });
  }

  /* ---- start --------------------------------------------------------------------------------------------------------- */
  function start(all) {
    DATA = all.filter(function (r) { return r.a > 0; }); DATA.bySlug = all.bySlug; index();
    var q = new URLSearchParams(location.search), saved = store.get("wa.water") || {};
    S.unit = q.get("u") === "ml" ? "ml" : (saved.u === "ml" && !q.get("b") ? "ml" : "oz");
    S.scale = saved.s === "proof" ? "proof" : "abv";
    S.pour = +q.get("v") || saved.v || (S.unit === "ml" ? 50 / ML : 2);
    S.target = +q.get("t") || store.get("wa.proof") || saved.t || 45;
    S.lineup = (q.get("l") ? q.get("l").split(",") : saved.l || []).filter(function (s) { return WA.find(DATA, s); }).slice(0, 6);
    var r = (q.get("b") && WA.find(DATA, q.get("b"))) || (saved.b && WA.find(DATA, saved.b));
    if (!r) { var bk = BRANDS.filter(function (b) { return b.name === "Booker’s" || b.name === "Booker's"; })[0]; r = bk ? brandRows(bk).sort(function (x, y) { return y.s - x.s; })[0] : DATA.filter(function (x) { return x.a >= 55; }).sort(function (x, y) { return y.s - x.s; })[0]; }
    if (S.unit === "ml") { $("wtUnit").querySelector('[data-unit="ml"]').setAttribute("aria-pressed", "true"); $("wtUnit").querySelector('[data-unit="oz"]').setAttribute("aria-pressed", "false"); $("ppWhisky").value = "60"; $("ppWater").value = "15"; $("ppWhisky").step = "5"; $("ppWater").step = "1"; }
    if (S.scale === "proof") $("wtScale").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-scale") === "proof"); });
    GL = glass($("wtGlass"));
    if (GL) GL.onResize = function () { if (S.row) { var A = S.row.a, T = Math.min(S.target, A), W = waterFor(S.pour, A, T); levels(S.pour, S.pour + W, W); } };
    else $("wtStage").classList.add("no-gl");
    pours(); wire(); choose(r);
  }
  WA.archive(start);
})();
