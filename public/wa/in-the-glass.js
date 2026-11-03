/* In the glass: the rating page's flavor fingerprint (a shader), where the bottle sits on the flavor map (WebGL points),
   the closest bottles, and price against score as a density field. Flavor profiles come from flavor.json (twelve flavors 0-10,
   body and finish 1-5, the flavor map's x and y), loaded once when the band nears the screen. */
(function () {
  var AXES = ["smoke", "maritime", "sweet", "fresh_fruit", "dried_fruit", "tropical", "floral", "spice", "oak", "grain", "nutty", "herbal"];
  var WHEEL = ["smoke", "maritime", "herbal", "grain", "fresh_fruit", "floral", "tropical", "sweet", "spice", "oak", "nutty", "dried_fruit"];
  var LABEL = { smoke: "Smoke", maritime: "Sea and brine", sweet: "Vanilla and caramel", fresh_fruit: "Orchard and citrus", dried_fruit: "Dried fruit and sherry", tropical: "Tropical fruit", floral: "Floral", spice: "Spice", oak: "Oak and leather", grain: "Grain and malt", nutty: "Nut and chocolate", herbal: "Herbal" };
  var SHORT = { smoke: "Smoke", maritime: "Sea", sweet: "Sweet", fresh_fruit: "Orchard", dried_fruit: "Sherry", tropical: "Tropical", floral: "Floral", spice: "Spice", oak: "Oak", grain: "Malt", nutty: "Nutty", herbal: "Herbal" };
  var HUE = { smoke: [0.66, 0.70, 0.74], maritime: [0.45, 0.72, 0.86], herbal: [0.58, 0.78, 0.50], grain: [0.90, 0.80, 0.56], fresh_fruit: [0.95, 0.83, 0.36], floral: [0.92, 0.63, 0.78], tropical: [0.98, 0.62, 0.27], sweet: [0.89, 0.64, 0.26], spice: [0.88, 0.40, 0.22], oak: [0.70, 0.47, 0.26], nutty: [0.80, 0.58, 0.40], dried_fruit: [0.74, 0.32, 0.24] };
  var GROUPS = [[/bourbon|tennessee/i, [0.96, 0.68, 0.26]], [/rye/i, [0.93, 0.42, 0.25]], [/single malt scotch/i, [0.55, 0.76, 0.95]], [/scotch/i, [0.72, 0.64, 0.96]], [/irish/i, [0.45, 0.85, 0.58]], [/japan/i, [0.97, 0.55, 0.68]], [/./, [0.86, 0.82, 0.74]]];
  var BODY = ["", "Light", "Light to medium", "Medium", "Full", "Rich and full"], FINISH = ["", "Short", "Short to medium", "Medium", "Long", "Very long"];
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = null, waiting = [];

  function decode(f) { var v = []; for (var i = 0; i < f.length; i++) v.push(parseInt(f[i], 11) || 0); return v; }
  function load(cb) {
    if (store) return cb(store);
    waiting.push(cb); if (waiting.length > 1) return;
    WA.loadJSON("flavor.json").then(function (fl) {
      var col = {}; fl.cols.forEach(function (c, i) { col[c] = i; });
      var by = {}, all = []; fl.rows.forEach(function (row) { var e = { slug: row[col.slug], f: decode(row[col.f]), t: row[col.t] || "" }; by[e.slug.toLowerCase()] = e; all.push(e); });
      layout(all, fl.axes || AXES); store = by; var w = waiting; waiting = []; w.forEach(function (fn) { fn(store); });
    }, function () { var w = waiting; waiting = []; w.forEach(function (fn) { fn(null); }); });
  }
  // The flavor map's disc: each bottle pulled toward the flavors where it stands above the average bottle, its distance from
  // the middle its rank by strength of pull (the same layout as flavor-map.js, so the two read alike).
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function layout(list, axes) {
    var n = list.length; if (!n) return;
    var mean = [], sd = [];
    for (var i = 0; i < 12; i++) { var m = 0; list.forEach(function (p) { m += p.f[i]; }); m /= n; var v = 0; list.forEach(function (p) { v += (p.f[i] - m) * (p.f[i] - m); }); mean.push(m); sd.push(Math.sqrt(v / n) || 1); }
    var pulls = list.map(function (p) { var x = 0, y = 0; for (var i = 0; i < 12; i++) { var w = Math.max(0, (p.f[i] - mean[i]) / sd[i]); if (!w) continue; w = Math.pow(w, 1.3); var a = -Math.PI / 2 + WHEEL.indexOf(axes[i]) * Math.PI * 2 / 12; x += Math.cos(a) * w; y += Math.sin(a) * w; } return [x, y, Math.hypot(x, y)]; });
    var order = list.map(function (p, i) { return i; }).sort(function (a, b) { return pulls[a][2] - pulls[b][2]; }), rank = [];
    order.forEach(function (i, k) { rank[i] = k / Math.max(1, n - 1); });
    list.forEach(function (p, i) { var q = pulls[i], ang = q[2] ? Math.atan2(q[1], q[0]) : fnv(p.slug) * Math.PI * 2, rr = (0.2 + 0.8 * Math.sqrt(rank[i])) * 420 * 0.95 + fnv(p.slug + "·") * 8; p.x = 500 + Math.cos(ang) * rr; p.y = 500 + Math.sin(ang) * rr; });
  }
  function prof(slug) { return store && slug ? store[String(slug).toLowerCase()] : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kind(c) { return String(c || "whisky").replace("/Tennessee Whiskey", "").toLowerCase(); }
  function groupColor(c) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][0].test(c || "")) return GROUPS[i][1]; return GROUPS[GROUPS.length - 1][1]; }

  // WebGL plumbing shared by the three views.
  function context(canvas) {
    var g = canvas.__gl || canvas.getContext("webgl", { premultipliedAlpha: true, antialias: true, alpha: true });
    canvas.__gl = g; return g;
  }
  function program(g, vs, fs) {
    function sh(type, src) { var s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; }
    var p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
    return p;
  }
  function fit(canvas, g) {
    var d = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight, W = Math.round(w * d), H = Math.round(h * d);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (g) g.viewport(0, 0, W, H);
    return { w: w, h: h, d: d };
  }
  function whenSeen(el, fn) { var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); fn(); } }, { threshold: 0.25 }); io.observe(el); }

  // ---- The fingerprint: one luminous shape, its radius at each angle the strength of that flavor, the category average as a dashed ring.
  var PRINT_FS = [
    "precision highp float;",
    "uniform vec2 u_res; uniform float u_R, u_t, u_grow, u_hover;",
    "uniform float u_val[12]; uniform float u_avg[12]; uniform vec3 u_hue[12];",
    "void main() {",
    "  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_R; p.y = -p.y;",
    "  float r = length(p), ang = atan(p.x, -p.y); if (ang < 0.0) ang += 6.2831853;",
    "  float t = ang / 6.2831853 * 12.0, i0f = floor(t), f = t - i0f;",
    "  int i0 = int(mod(i0f, 12.0)), i1 = int(mod(i0f + 1.0, 12.0));",
    "  float a0 = 0.0, a1 = 0.0, b0 = 0.0, b1 = 0.0; vec3 c0 = vec3(0.0), c1 = vec3(0.0);",
    "  for (int i = 0; i < 12; i++) { if (i == i0) { a0 = u_val[i]; b0 = u_avg[i]; c0 = u_hue[i]; } if (i == i1) { a1 = u_val[i]; b1 = u_avg[i]; c1 = u_hue[i]; } }",
    "  float s = f * f * (3.0 - 2.0 * f);",
    "  float pinch = 1.0 - 0.16 * (0.5 - 0.5 * cos(6.2831853 * f));",
    "  float edge = max(0.07, mix(a0, a1, s) * pinch * u_grow) * (1.0 + 0.01 * sin(u_t * 1.4 + ang * 5.0));",
    "  float avgE = max(0.07, mix(b0, b1, s));",
    "  vec3 col = mix(c0, c1, s);",
    "  float px = 1.4 / u_R;",
    "  float inside = smoothstep(edge + px, edge - px, r);",
    "  float depth = clamp(r / edge, 0.0, 1.0);",
    "  float sheen = 0.5 + 0.5 * sin(ang * 3.0 - u_t * 0.6 + r * 9.0);",
    "  vec3 fill = col * (0.18 + 0.9 * pow(depth, 1.8)) + vec3(0.06) * sheen * depth;",
    "  float rim = exp(-abs(r - edge) * 70.0);",
    "  float glow = exp(-max(0.0, r - edge) * 8.0) * 0.32 * (1.0 - inside);",
    "  float near = mod(floor(t + 0.5), 12.0);",
    "  float dim = u_hover < 0.0 ? 1.0 : (abs(near - u_hover) < 0.5 ? 1.15 : 0.4);",
    "  vec3 c = (fill * inside + col * (rim * 0.9 + glow)) * dim;",
    "  float a = clamp(inside * 0.96 + rim * 0.9 + glow, 0.0, 1.0) * min(dim, 1.0);",
    "  float ring = 0.0; for (int k = 1; k <= 4; k++) ring += smoothstep(px * 1.2, 0.0, abs(r - float(k) * 0.25)) * 0.06;",
    "  float spoke = smoothstep(0.012, 0.0, abs(fract(t + 0.5) - 0.5) * r) * 0.035 * step(r, 1.0);",
    "  float dash = step(0.42, fract(t * 4.0));",
    "  float avgL = smoothstep(px * 1.6, 0.0, abs(r - avgE)) * 0.9 * dash;",
    "  vec3 paper = vec3(1.0, 0.965, 0.918);",
    "  c += paper * (ring + spoke) * (1.0 - inside) + paper * avgL;",
    "  a = clamp(max(a, ring + spoke) + avgL, 0.0, 1.0);",
    "  gl_FragColor = vec4(min(c, vec3(a)), a);",
    "}"].join("\n");
  var QUAD_VS = "attribute vec2 a_p; void main() { gl_Position = vec4(a_p, 0.0, 1.0); }";

  function fingerprint(card, r, data) {
    var p = prof(r.slug), canvas = card.querySelector("canvas");
    meters(card, r, p);
    if (!p) { card.classList.add("no-print"); return; }
    card.classList.remove("no-print");
    var peers = data.filter(function (x) { return x.c === r.c && x.slug !== r.slug; }).map(function (x) { return prof(x.slug); }).filter(Boolean);
    var val = {}, avg = {};
    AXES.forEach(function (a, i) { val[a] = p.f[i]; avg[a] = peers.length ? peers.reduce(function (t, q) { return t + q.f[i]; }, 0) / peers.length : 0; });
    var top = AXES.slice().sort(function (a, b) { return val[b] - val[a]; }), lead = top.filter(function (a) { return val[a] >= 4; }).slice(0, 2);
    card.querySelector("[data-print-line]").textContent = !lead.length ? "Gentle and balanced, nothing shouts." : lead.length === 1 ? LABEL[lead[0]] + " leads the glass." : LABEL[lead[0]] + ", then " + LABEL[lead[1]].toLowerCase() + ".";
    var best = null; AXES.forEach(function (a, i) { var lift = val[a] - avg[a]; if (val[a] >= 3 && (!best || lift > best.lift)) best = { a: a, i: i, lift: lift }; });
    var stat = "";
    if (best && peers.length > 20 && best.lift > 0.5) { var pct = Math.round(peers.filter(function (q) { return q.f[best.i] < val[best.a]; }).length / peers.length * 100); if (pct >= 60) stat = "More " + LABEL[best.a].toLowerCase() + " than " + pct + "% of " + kind(r.c) + "."; }
    card.querySelector("[data-print-stat]").textContent = stat;
    card.querySelector("[data-print-notes]").innerHTML = (p.t || "").split(" · ").filter(Boolean).map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("");
    card.querySelector("[data-print-avg]").textContent = "Average " + kind(r.c);
    // Crisp labels in HTML around the shader, each with its score.
    var labels = card.querySelector("[data-print-labels]");
    labels.innerHTML = WHEEL.map(function (a, i) { var ang = i / 12 * Math.PI * 2; return '<span data-a="' + a + '" class="' + (val[a] >= 4 ? "on" : "") + '" style="left:' + (50 + Math.sin(ang) * 45).toFixed(2) + "%;top:" + (50 - Math.cos(ang) * 45).toFixed(2) + '%">' + SHORT[a] + "<b>" + val[a] + "</b></span>"; }).join("");
    var readout = card.querySelector("[data-print-readout]");
    canvas.setAttribute("aria-label", "Flavor fingerprint: " + top.filter(function (a) { return val[a] > 0; }).map(function (a) { return LABEL[a] + " " + val[a] + " of 10"; }).join(", "));
    var g = context(canvas);
    if (!g) { card.classList.add("no-gl"); return; }
    var prog = canvas.__printProg || (canvas.__printProg = program(g, QUAD_VS, PRINT_FS));
    var buf = canvas.__printBuf || (canvas.__printBuf = g.createBuffer());
    g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    var U = {}; ["u_res", "u_R", "u_t", "u_grow", "u_hover", "u_val", "u_avg", "u_hue"].forEach(function (n) { U[n] = g.getUniformLocation(prog, n); });
    var vals = new Float32Array(WHEEL.map(function (a) { return Math.sqrt(val[a] / 10); })), avgs = new Float32Array(WHEEL.map(function (a) { return Math.sqrt(avg[a] / 10); })), hues = new Float32Array([].concat.apply([], WHEEL.map(function (a) { return HUE[a]; })));
    var hover = -1, t0 = 0, raf = 0, alive = true, token = card.__token = {};
    function frame(now) {
      if (card.__token !== token || !canvas.isConnected) return;
      var f = fit(canvas, g), R = Math.min(f.w, f.h) * f.d / 2 * 0.86, k = reduce ? 1 : Math.min(1, (now - t0) / 1400), grow = 1 - Math.pow(1 - k, 3);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      g.useProgram(prog); g.bindBuffer(g.ARRAY_BUFFER, buf);
      var loc = g.getAttribLocation(prog, "a_p"); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
      g.uniform2f(U.u_res, canvas.width, canvas.height); g.uniform1f(U.u_R, R); g.uniform1f(U.u_t, reduce ? 0 : now / 1000); g.uniform1f(U.u_grow, grow); g.uniform1f(U.u_hover, hover);
      g.uniform1fv(U.u_val, vals); g.uniform1fv(U.u_avg, avgs); g.uniform3fv(U.u_hue, hues);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      if (!reduce && alive) raf = requestAnimationFrame(frame);
    }
    function setHover(i) {
      if (i === hover) return; hover = i;
      labels.querySelectorAll("span").forEach(function (s, k) { s.classList.toggle("hot", k === i); });
      if (i < 0) { readout.hidden = true; } else { var a = WHEEL[i]; readout.hidden = false; readout.innerHTML = "<strong>" + val[a] + "</strong><span>" + esc(LABEL[a]) + "</span><em>Average " + avg[a].toFixed(1) + "</em>"; }
      if (reduce) frame(performance.now());
    }
    canvas.onpointermove = function (e) {
      var b = canvas.getBoundingClientRect(), x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2, R = Math.min(b.width, b.height) / 2 * 0.86;
      if (Math.hypot(x, y) > R * 1.05) return setHover(-1);
      var ang = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2); setHover(Math.round(ang / (Math.PI * 2) * 12) % 12);
    };
    canvas.onpointerleave = function () { setHover(-1); };
    labels.onpointerover = function (e) { var s = e.target.closest("span[data-a]"); if (s) setHover(WHEEL.indexOf(s.getAttribute("data-a"))); };
    labels.onpointerleave = function () { setHover(-1); };
    // Animate only while the card is on screen.
    var io = new IntersectionObserver(function (es) { alive = es[0].isIntersecting; if (alive) { if (!t0) t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } }, { threshold: 0.05 });
    io.observe(canvas);
    card._redraw = function () { if (t0) frame(performance.now()); };
  }
  function meters(card, r, p) {
    function dots(v) { return '<span class="pm-dots">' + [1, 2, 3, 4, 5].map(function (i) { return "<i" + (i <= v ? ' class="on"' : "") + "></i>"; }).join("") + "</span>"; }
    var abv = r.a || 0, strength = abv ? Math.max(1, Math.min(5, Math.round((abv - 38) / 5))) : 0;
    var set = function (sel, html) { var el = card.querySelector(sel); if (el) { el.innerHTML = html; el.parentElement.hidden = !html; } };
    set("[data-print-body]", p ? dots(p.f[12]) + "<span>" + BODY[p.f[12]] + "</span>" : "");
    set("[data-print-finish]", p ? dots(p.f[13]) + "<span>" + FINISH[p.f[13]] + "</span>" : "");
    set("[data-print-abv]", abv ? dots(strength) + "<span>" + abv + "% ABV</span>" : "");
  }

  // ---- Where it sits: every rated bottle on the flavor map's disc as a point of light; this bottle and its closest kin lit.
  var MAP_VS = [
    "attribute vec2 a_pos; attribute vec3 a_col; attribute float a_kind;",
    "uniform vec2 u_res; uniform vec2 u_c; uniform float u_k, u_d, u_t;",
    "varying vec3 v_col; varying float v_kind;",
    "void main() {",
    "  vec2 q = (a_pos - u_c) * u_k + 0.5 * u_res;",
    "  gl_Position = vec4(q / u_res * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y;",
    "  float pulse = 1.0 + 0.18 * sin(u_t * 2.4);",
    "  gl_PointSize = (a_kind > 1.5 ? 30.0 * pulse : a_kind > 0.5 ? 13.0 : 3.8) * u_d;",
    "  v_col = a_col; v_kind = a_kind;",
    "}"].join("\n");
  var MAP_FS = [
    "precision mediump float; varying vec3 v_col; varying float v_kind;",
    "void main() {",
    "  float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;",
    "  if (v_kind > 1.5) {",
    "    float core = 1.0 - smoothstep(0.22, 0.3, d);",
    "    float ring = smoothstep(0.5, 0.56, d) * (1.0 - smoothstep(0.62, 0.7, d));",
    "    float halo = (1.0 - d) * 0.35;",
    "    vec3 c = vec3(1.0, 0.97, 0.92) * core + vec3(0.89, 0.64, 0.26) * (ring + halo);",
    "    float a = clamp(core + ring + halo, 0.0, 1.0); gl_FragColor = vec4(c, a); return;",
    "  }",
    "  if (v_kind > 0.5) { float c = 1.0 - smoothstep(0.55, 0.75, d); float h = (1.0 - d) * 0.5; float a = clamp(c + h, 0.0, 1.0); gl_FragColor = vec4(vec3(0.95, 0.72, 0.36) * a + vec3(0.2) * c, a); return; }",
    "  float a = (1.0 - smoothstep(0.3, 1.0, d)) * 0.5;",
    "  gl_FragColor = vec4(v_col * a, a);",
    "}"].join("\n");
  var LINE_VS = "attribute vec2 a_pos; uniform vec2 u_res; uniform vec2 u_c; uniform float u_k; void main() { vec2 q = (a_pos - u_c) * u_k + 0.5 * u_res; gl_Position = vec4(q / u_res * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }";
  var LINE_FS = "precision mediump float; uniform float u_a; void main() { gl_FragColor = vec4(vec3(0.95, 0.72, 0.36) * u_a, u_a); }";
  var RIM = ["smoke", "maritime", "herbal", "grain", "fresh_fruit", "floral", "tropical", "sweet", "spice", "oak", "nutty", "dried_fruit"];

  function whereMap(wrap, r, data, kinList) {
    var canvas = wrap.querySelector("canvas"), me = prof(r.slug);
    if (!me) { wrap.hidden = true; return null; }
    wrap.hidden = false;
    var g = context(canvas); if (!g) { wrap.hidden = true; return null; }
    var rows = [], kinSlugs = {}; (kinList || []).forEach(function (x) { kinSlugs[x.slug] = true; });
    data.forEach(function (x) { var q = prof(x.slug); if (!q || x.slug === r.slug) return; rows.push({ r: x, q: q, kind: kinSlugs[x.slug] ? 1 : 0 }); });
    rows.sort(function (a, b) { return a.kind - b.kind; });
    rows.push({ r: r, q: me, kind: 2 });
    var n = rows.length, pos = new Float32Array(n * 2), col = new Float32Array(n * 3), kd = new Float32Array(n);
    rows.forEach(function (o, i) { pos[i * 2] = o.q.x; pos[i * 2 + 1] = o.q.y; var c = groupColor(o.r.c); col.set(c, i * 3); kd[i] = o.kind; });
    var P = canvas.__mapProg || (canvas.__mapProg = program(g, MAP_VS, MAP_FS)), L = canvas.__lineProg || (canvas.__lineProg = program(g, LINE_VS, LINE_FS));
    var bp = canvas.__bp || (canvas.__bp = g.createBuffer()), bc = canvas.__bc || (canvas.__bc = g.createBuffer()), bk = canvas.__bk || (canvas.__bk = g.createBuffer()), bl = canvas.__bl || (canvas.__bl = g.createBuffer());
    g.bindBuffer(g.ARRAY_BUFFER, bp); g.bufferData(g.ARRAY_BUFFER, pos, g.STATIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, bc); g.bufferData(g.ARRAY_BUFFER, col, g.STATIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, bk); g.bufferData(g.ARRAY_BUFFER, kd, g.STATIC_DRAW);
    var lines = []; rows.forEach(function (o) { if (o.kind === 1) lines.push(me.x, me.y, o.q.x, o.q.y); });
    g.bindBuffer(g.ARRAY_BUFFER, bl); g.bufferData(g.ARRAY_BUFFER, new Float32Array(lines), g.STATIC_DRAW);
    var rim = wrap.querySelector("[data-rim]");
    rim.innerHTML = RIM.map(function (a, i) { var ang = -Math.PI / 2 + i * Math.PI * 2 / 12; return '<span style="left:' + (50 + Math.cos(ang) * 47).toFixed(2) + "%;top:" + (50 + Math.sin(ang) * 47).toFixed(2) + '%">' + SHORT[a] + "</span>"; }).join("");
    var hot = null, alive = true, raf = 0, token = wrap.__token = {}, view = { k: 1 };
    function attr(prog, name, buf, size) { var l = g.getAttribLocation(prog, name); if (l < 0) return; g.bindBuffer(g.ARRAY_BUFFER, buf); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, size, g.FLOAT, false, 0, 0); }
    function frame(now) {
      if (wrap.__token !== token || !canvas.isConnected) return;
      var f = fit(canvas, g), k = Math.min(canvas.width, canvas.height) / 1000 * 1.18; view.k = k / f.d; view.w = f.w; view.h = f.h;
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      g.useProgram(L); attr(L, "a_pos", bl, 2);
      g.uniform2f(g.getUniformLocation(L, "u_res"), canvas.width, canvas.height); g.uniform2f(g.getUniformLocation(L, "u_c"), 500, 500); g.uniform1f(g.getUniformLocation(L, "u_k"), k); g.uniform1f(g.getUniformLocation(L, "u_a"), hot ? 0.25 : 0.55);
      if (lines.length) g.drawArrays(g.LINES, 0, lines.length / 2);
      g.useProgram(P); attr(P, "a_pos", bp, 2); attr(P, "a_col", bc, 3); attr(P, "a_kind", bk, 1);
      g.uniform2f(g.getUniformLocation(P, "u_res"), canvas.width, canvas.height); g.uniform2f(g.getUniformLocation(P, "u_c"), 500, 500); g.uniform1f(g.getUniformLocation(P, "u_k"), k); g.uniform1f(g.getUniformLocation(P, "u_d"), f.d); g.uniform1f(g.getUniformLocation(P, "u_t"), reduce ? 0 : now / 1000);
      g.drawArrays(g.POINTS, 0, n);
      if (!reduce && alive) raf = requestAnimationFrame(frame);
    }
    var io = new IntersectionObserver(function (es) { alive = es[0].isIntersecting; if (alive) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } }, { threshold: 0.05 });
    io.observe(canvas);
    if (WA.canvasTips) WA.canvasTips(canvas, function () { return rows.map(function (o) { return { x: (o.q.x - 500) * view.k + view.w / 2, y: (o.q.y - 500) * view.k + view.h / 2, r: o.r }; }); }, function (x) { return "<strong>" + (x === r ? "This bottle · " : "") + x.s + " points</strong>" + (x.p ? " · " + WA.fmt(x.p) : "") + "<br>" + esc(x.n) + '<span class="ctip-sub">' + esc(x.c) + "</span>"; }, function (x) { return x === r ? null : WA.bottleHref(x); });
    return {
      redraw: function () { frame(performance.now()); },
      highlight: function (x) {
        hot = x; kd.fill(0); rows.forEach(function (o, i) { kd[i] = o.kind === 2 ? 2 : (x ? (o.r === x ? 1 : 0) : o.kind); });
        g.bindBuffer(g.ARRAY_BUFFER, bk); g.bufferData(g.ARRAY_BUFFER, kd, g.STATIC_DRAW); frame(performance.now());
      }
    };
  }

  // The closest bottles by flavor profile, with the notes they share.
  function kin(el, r, data, onHover) {
    var p = prof(r.slug); if (!el) return [];
    if (!p) { el.hidden = true; return []; }
    var v = p.f.slice(0, 12).concat([p.f[12] * 2, p.f[13] * 2]), mine = (p.t || "").split(" · ");
    function cos(a, b) { var d = 0, na = 0, nb = 0; for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
    var near = data.filter(function (x) { return x.slug && x.slug !== r.slug && x.n !== r.n && x.s >= 85; }).map(function (x) { var q = prof(x.slug); if (!q) return null; return { x: x, q: q, sim: cos(v, q.f.slice(0, 12).concat([q.f[12] * 2, q.f[13] * 2])) }; }).filter(Boolean).sort(function (a, b) { return b.sim - a.sim; });
    var seen = {}, pick = [];
    near.forEach(function (m) { var key = m.x.n.split(",")[0]; if (pick.length < 3 && !seen[key]) { seen[key] = 1; pick.push(m); } });
    el.hidden = !pick.length;
    el.querySelector("ol").innerHTML = pick.map(function (m, i) {
      var shared = (m.q.t || "").split(" · ").filter(function (n) { return mine.indexOf(n) >= 0; });
      return '<li><a href="' + WA.bottleHref(m.x) + '" data-k="' + i + '"><b>' + m.x.s + "</b><span><strong>" + esc(m.x.n) + "</strong><em>" + Math.round(m.sim * 100) + "% match" + (shared.length ? " · shares " + esc(shared.slice(0, 2).join(", ")) : m.x.p ? " · " + WA.fmt(m.x.p) : "") + "</em></span></a></li>";
    }).join("");
    el.onpointerover = function (e) { var a = e.target.closest("a[data-k]"); onHover(a ? pick[+a.getAttribute("data-k")].x : null); };
    el.onpointerleave = function () { onHover(null); };
    el.onfocusin = function (e) { var a = e.target.closest("a[data-k]"); if (a) onHover(pick[+a.getAttribute("data-k")].x); };
    el.onfocusout = function () { onHover(null); };
    return pick.map(function (m) { return m.x; });
  }

  // ---- Value: the category's price and score as a glowing density field (WebGL splats), the best score at each price and this bottle drawn crisp on top.
  var SPLAT_VS = "attribute vec2 a_pos; attribute float a_w; uniform vec2 u_res; uniform float u_size; varying float v_w; void main() { gl_Position = vec4(a_pos / u_res * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; gl_PointSize = u_size; v_w = a_w; }";
  var SPLAT_FS = "precision mediump float; varying float v_w; void main() { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q); float a = (exp(-d * 30.0) * 0.16 + exp(-d * 260.0) * 0.5) * v_w; if (d > 0.25) discard; gl_FragColor = vec4(vec3(0.95, 0.6, 0.24) * a, a); }";
  function valuePlot(wrap, r, data) {
    var peers = data.filter(function (x) { return x.c === r.c && x.p > 0 && x.s >= 70; }), gl = wrap.querySelector("canvas.vp-gl"), over = wrap.querySelector("canvas.vp-ink");
    if (peers.length < 8) { wrap.hidden = true; return null; }
    wrap.hidden = false;
    var f = fit(over), L = 40, B = 30, T = 16, Rr = 16, W = f.w - L - Rr, H = f.h - T - B;
    var prices = peers.map(function (x) { return x.p; }).sort(function (a, b) { return a - b; });
    var lo = Math.log(Math.max(15, prices[Math.floor(prices.length * 0.01)] * 0.85)), hi = Math.log(Math.min(6000, prices[Math.floor(prices.length * 0.99)] * 1.2));
    var smin = 78, smax = 100;
    function X(p) { return L + (Math.log(Math.max(Math.exp(lo), Math.min(Math.exp(hi), p))) - lo) / (hi - lo) * W; }
    function Y(s) { return T + (1 - (Math.max(smin, s) - smin) / (smax - smin)) * H; }
    peers = peers.filter(function (x) { var l = Math.log(x.p); return l >= lo && l <= hi && x.s >= smin; });
    function jit(x) { var h = 0; for (var i = 0; i < x.n.length; i++) h = (h * 31 + x.n.charCodeAt(i)) % 9973; return (h / 9973 - 0.5) * 0.9; }
    var g = context(gl);
    if (g) {
      var gf = fit(gl, g), P = gl.__splat || (gl.__splat = program(g, SPLAT_VS, SPLAT_FS));
      var pos = new Float32Array(peers.length * 2), w = new Float32Array(peers.length);
      peers.forEach(function (x, i) { pos[i * 2] = X(x.p) * gf.d; pos[i * 2 + 1] = Y(x.s + jit(x)) * gf.d; w[i] = x.s >= 90 ? 1.5 : 1; });
      var b1 = gl.__b1 || (gl.__b1 = g.createBuffer()), b2 = gl.__b2 || (gl.__b2 = g.createBuffer());
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      g.useProgram(P);
      g.bindBuffer(g.ARRAY_BUFFER, b1); g.bufferData(g.ARRAY_BUFFER, pos, g.STATIC_DRAW); var l1 = g.getAttribLocation(P, "a_pos"); g.enableVertexAttribArray(l1); g.vertexAttribPointer(l1, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, b2); g.bufferData(g.ARRAY_BUFFER, w, g.STATIC_DRAW); var l2 = g.getAttribLocation(P, "a_w"); g.enableVertexAttribArray(l2); g.vertexAttribPointer(l2, 1, g.FLOAT, false, 0, 0);
      g.uniform2f(g.getUniformLocation(P, "u_res"), gl.width, gl.height); g.uniform1f(g.getUniformLocation(P, "u_size"), Math.min(48, 22 * gf.d));
      g.drawArrays(g.POINTS, 0, peers.length);
    }
    var c = over.getContext("2d"); c.setTransform(f.d, 0, 0, f.d, 0, 0); c.clearRect(0, 0, f.w, f.h);
    c.font = "10px JetBrains Mono, monospace"; c.lineWidth = 1;
    for (var s = 80; s <= 100; s += 5) { c.strokeStyle = "rgba(255,246,234,0.07)"; c.beginPath(); c.moveTo(L, Y(s) + 0.5); c.lineTo(L + W, Y(s) + 0.5); c.stroke(); c.fillStyle = "rgba(255,246,234,0.45)"; c.textAlign = "right"; c.textBaseline = "middle"; c.fillText(String(s), L - 10, Y(s)); }
    [20, 50, 100, 200, 500, 1000, 2000, 5000].forEach(function (p) { if (Math.log(p) < lo || Math.log(p) > hi) return; c.fillStyle = "rgba(255,246,234,0.45)"; c.textAlign = "center"; c.textBaseline = "top"; c.fillText("$" + (p >= 1000 ? p / 1000 + "k" : p), X(p), T + H + 10); });
    // The frontier as a smooth glowing line.
    var sorted = peers.slice().sort(function (a, b) { return a.p - b.p; }), bestS = -1, line = [];
    sorted.forEach(function (x) { if (x.s > bestS) { line.push([X(x.p), Y(x.s)]); bestS = x.s; } });
    if (line.length > 1) {
      line.push([L + W, line[line.length - 1][1]]);
      c.save(); c.shadowColor = "rgba(227,164,67,0.8)"; c.shadowBlur = 10; c.strokeStyle = "#e3a443"; c.lineWidth = 2; c.lineJoin = "round"; c.beginPath();
      line.forEach(function (q, i) { if (!i) return c.moveTo(q[0], q[1]); var pr = line[i - 1]; c.lineTo(q[0], pr[1]); c.lineTo(q[0], q[1]); });
      c.stroke(); c.restore();
    }
    if (r.p > 0) {
      var mx = X(r.p), my = Y(r.s);
      c.save(); c.shadowColor = "rgba(255,246,234,0.9)"; c.shadowBlur = 16; c.beginPath(); c.arc(mx, my, 6, 0, Math.PI * 2); c.fillStyle = "#fffaf2"; c.fill(); c.restore();
      c.beginPath(); c.arc(mx, my, 11, 0, Math.PI * 2); c.strokeStyle = "rgba(227,164,67,0.9)"; c.lineWidth = 1.5; c.stroke();
      c.font = "500 11px JetBrains Mono, monospace"; var tag = r.s + " · " + WA.fmt(r.p), tw = c.measureText(tag).width, tx = mx + 18 + tw > L + W ? mx - 18 - tw : mx + 18;
      c.fillStyle = "rgba(20,17,14,0.85)"; c.beginPath(); if (c.roundRect) c.roundRect(tx - 7, my - 11, tw + 14, 22, 11); else c.rect(tx - 7, my - 11, tw + 14, 22); c.fill();
      c.fillStyle = "#fffaf2"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(tag, tx, my + 0.5);
    }
    return peers.map(function (x) { return { x: X(x.p), y: Y(x.s + jit(x)), r: x }; });
  }

  window.WAGlass = { load: load, profile: prof, fingerprint: fingerprint, whereMap: whereMap, kin: kin, valuePlot: valuePlot, proof: function () {} };
})();
