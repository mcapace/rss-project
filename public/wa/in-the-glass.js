/* In the glass: the rating page's flavor fingerprint, closest bottles, strength gauge and price-against-score chart.
   Flavor profiles come from flavor.json (twelve flavors 0-10, body and finish 1-5), loaded once when the band nears the screen. */
(function () {
  var AXES = ["smoke", "maritime", "sweet", "fresh_fruit", "dried_fruit", "tropical", "floral", "spice", "oak", "grain", "nutty", "herbal"];
  var WHEEL = ["smoke", "maritime", "herbal", "grain", "fresh_fruit", "floral", "tropical", "sweet", "spice", "oak", "nutty", "dried_fruit"];
  var LABEL = { smoke: "Smoke", maritime: "Sea and brine", sweet: "Vanilla and caramel", fresh_fruit: "Orchard and citrus", dried_fruit: "Dried fruit and sherry", tropical: "Tropical fruit", floral: "Floral", spice: "Spice", oak: "Oak and leather", grain: "Grain and malt", nutty: "Nut and chocolate", herbal: "Herbal" };
  var SHORT = { smoke: "Smoke", maritime: "Sea", sweet: "Sweet", fresh_fruit: "Orchard", dried_fruit: "Sherry", tropical: "Tropical", floral: "Floral", spice: "Spice", oak: "Oak", grain: "Malt", nutty: "Nutty", herbal: "Herbal" };
  var HUE = { smoke: "#a9b1b8", maritime: "#7fb6d6", herbal: "#9cc28a", grain: "#e0cd9a", fresh_fruit: "#ecd060", floral: "#e7a9c7", tropical: "#f4a24a", sweet: "#e3a443", spice: "#dd6a3c", oak: "#b07a44", nutty: "#c9946a", dried_fruit: "#b8553f" };
  var BODY = ["", "Light", "Light to medium", "Medium", "Full", "Rich and full"], FINISH = ["", "Short", "Short to medium", "Medium", "Long", "Very long"];
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = null, waiting = [];

  function decode(f) { var v = []; for (var i = 0; i < f.length; i++) v.push(parseInt(f[i], 11) || 0); return v; }
  function load(cb) {
    if (store) return cb(store);
    waiting.push(cb); if (waiting.length > 1) return;
    WA.loadJSON("flavor.json").then(function (fl) {
      var col = {}; fl.cols.forEach(function (c, i) { col[c] = i; });
      var by = {}; fl.rows.forEach(function (row) { by[row[col.slug].toLowerCase()] = { f: decode(row[col.f]), t: row[col.t] || "" }; });
      store = by; var w = waiting; waiting = []; w.forEach(function (fn) { fn(store); });
    }, function () { var w = waiting; waiting = []; w.forEach(function (fn) { fn(null); }); });
  }
  function prof(slug) { return store && slug ? store[String(slug).toLowerCase()] : null; }
  function setup(c) { var d = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight; c.width = w * d; c.height = h * d; var g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); return { g: g, w: w, h: h }; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function kind(c) { return String(c || "whisky").replace("/Tennessee Whiskey", "").toLowerCase(); }

  // Category averages and each flavor's spread within the category, for the outline and the percentile line.
  function peersOf(r, data) {
    var list = data.filter(function (x) { return x.c === r.c && x.slug !== r.slug; }).map(function (x) { return prof(x.slug); }).filter(Boolean);
    var avg = AXES.map(function (a, i) { return list.length ? list.reduce(function (t, p) { return t + p.f[i]; }, 0) / list.length : 0; });
    return { list: list, avg: avg };
  }

  // The fingerprint: a petal per flavor, its length the bottle's strength, the category average traced over it.
  function fingerprint(card, r, data) {
    var canvas = card.querySelector("canvas"), p = prof(r.slug);
    if (!p) { card.classList.add("no-print"); return; }
    card.classList.remove("no-print");
    var peers = peersOf(r, data), val = {}, avg = {};
    AXES.forEach(function (a, i) { val[a] = p.f[i]; avg[a] = peers.avg[i]; });
    var top = AXES.slice().sort(function (a, b) { return val[b] - val[a]; }), lead = top.filter(function (a) { return val[a] >= 4; }).slice(0, 2);
    var line = card.querySelector("[data-print-line]"), stat = card.querySelector("[data-print-stat]");
    line.textContent = !lead.length ? "Gentle and balanced, nothing shouts." : lead.length === 1 ? LABEL[lead[0]] + " leads the glass." : LABEL[lead[0]] + ", then " + LABEL[lead[1]].toLowerCase() + ".";
    // The flavor where the bottle stands furthest above its category.
    var best = null; AXES.forEach(function (a, i) { var lift = val[a] - avg[a]; if (val[a] >= 3 && (!best || lift > best.lift)) best = { a: a, i: i, lift: lift }; });
    if (best && peers.list.length > 20 && best.lift > 0.5) {
      var below = peers.list.filter(function (q) { return q.f[best.i] < val[best.a]; }).length, pct = Math.round(below / peers.list.length * 100);
      stat.textContent = pct >= 60 ? "More " + LABEL[best.a].toLowerCase() + " than " + pct + "% of " + kind(r.c) + "." : "";
    } else stat.textContent = "";
    var notes = (p.t || "").split(" · ").filter(Boolean);
    card.querySelector("[data-print-notes]").innerHTML = notes.map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("");
    meter(card.querySelector("[data-print-body]"), p.f[12], BODY);
    meter(card.querySelector("[data-print-finish]"), p.f[13], FINISH);
    card.querySelector("[data-print-avg]").textContent = "Average " + kind(r.c);
    var hover = null, t0 = null, D = reduce ? 0 : 1100;
    function draw(now) {
      var f = setup(canvas), g = f.g, cx = f.w / 2, cy = f.h / 2, R = Math.min(f.w, f.h) / 2 - 46, k = D ? Math.min(1, (now - t0) / D) : 1, n = WHEEL.length, step = Math.PI * 2 / n;
      if (R <= 0) return;
      g.clearRect(0, 0, f.w, f.h);
      g.strokeStyle = "rgba(255,246,234,0.08)"; g.lineWidth = 1;
      [0.25, 0.5, 0.75, 1].forEach(function (q) { g.beginPath(); g.arc(cx, cy, R * q, 0, Math.PI * 2); g.stroke(); });
      WHEEL.forEach(function (a, i) {
        var a0 = -Math.PI / 2 + i * step - step / 2 + 0.035, a1 = a0 + step - 0.07, e = Math.max(0, Math.min(1, k * 1.6 - i * 0.05)), ease = 1 - Math.pow(1 - e, 3);
        var len = Math.max(0.05, Math.sqrt(val[a] / 10)) * R * ease, on = hover === a;
        var grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, len));
        grad.addColorStop(0, "rgba(255,246,234,0.04)"); grad.addColorStop(1, HUE[a]);
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, len, a0, a1); g.closePath();
        g.globalAlpha = hover && !on ? 0.35 : val[a] ? 0.95 : 0.4; g.fillStyle = grad; g.fill(); g.globalAlpha = 1;
        var mid = (a0 + a1) / 2, lx = cx + Math.cos(mid) * (R + 12), ly = cy + Math.sin(mid) * (R + 12);
        g.font = "500 10px JetBrains Mono, monospace"; g.textAlign = Math.abs(Math.cos(mid)) < 0.3 ? "center" : Math.cos(mid) > 0 ? "left" : "right"; g.textBaseline = "middle";
        g.fillStyle = on ? "#fff6ea" : val[a] >= 4 ? "rgba(255,246,234,0.86)" : "rgba(255,246,234,0.38)";
        g.fillText(SHORT[a].toUpperCase(), lx, ly);
      });
      // Category average as a dashed ring through every flavor.
      if (peers.list.length) {
        g.beginPath();
        WHEEL.forEach(function (a, i) { var ang = -Math.PI / 2 + i * step, rr = Math.max(0.05, Math.sqrt(avg[a] / 10)) * R * Math.min(1, k * 1.3); var x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath(); g.setLineDash([3, 4]); g.strokeStyle = "rgba(255,246,234,0.7)"; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      }
      if (hover) {
        g.fillStyle = "rgba(20,16,12,0.82)"; g.beginPath(); g.arc(cx, cy, 44, 0, Math.PI * 2); g.fill();
        g.textAlign = "center"; g.fillStyle = "#fff6ea"; g.font = "500 22px Aeonik, system-ui, sans-serif"; g.fillText(String(val[hover]), cx, cy - 6);
        g.font = "10px JetBrains Mono, monospace"; g.fillStyle = "rgba(255,246,234,0.6)"; g.fillText("AVG " + avg[hover].toFixed(1), cx, cy + 14);
      }
      if (k < 1) requestAnimationFrame(draw);
    }
    function at(e) {
      var b = canvas.getBoundingClientRect(), x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2, R = Math.min(b.width, b.height) / 2 - 46;
      if (Math.hypot(x, y) > R + 24) return null;
      var step = Math.PI * 2 / WHEEL.length, ang = (Math.atan2(y, x) + Math.PI / 2 + step / 2 + Math.PI * 4) % (Math.PI * 2);
      return WHEEL[Math.floor(ang / step) % WHEEL.length];
    }
    canvas.onpointermove = function (e) { var a = at(e); if (a !== hover) { hover = a; canvas.title = a ? LABEL[a] + ": " + val[a] + " of 10 (average " + avg[a].toFixed(1) + ")" : ""; draw(performance.now() + 1e6); } };
    canvas.onpointerleave = function () { if (hover) { hover = null; draw(performance.now() + 1e6); } };
    canvas.setAttribute("aria-label", "Flavor fingerprint: " + top.filter(function (a) { return val[a] > 0; }).map(function (a) { return LABEL[a] + " " + val[a]; }).join(", "));
    // Draw when the card first shows, so the petals grow in view.
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); t0 = performance.now(); requestAnimationFrame(draw); } }, { threshold: 0.35 });
    io.observe(canvas);
    card._redraw = function () { if (t0 != null) draw(performance.now() + 1e6); };
  }
  function meter(el, v, words) {
    if (!el) return;
    el.innerHTML = '<span class="pm-dots">' + [1, 2, 3, 4, 5].map(function (i) { return "<i" + (i <= v ? ' class="on"' : "") + "></i>"; }).join("") + "</span><span>" + (words[v] || "") + "</span>";
  }

  // The closest bottles by flavor profile, with the notes they share; hovering one marks it on the compass.
  function kin(el, r, data, onHover) {
    var p = prof(r.slug); if (!el) return;
    if (!p) { el.hidden = true; return; }
    var v = p.f.slice(0, 12).concat([p.f[12] * 2, p.f[13] * 2]), mine = (p.t || "").split(" · ");
    function cos(a, b) { var d = 0, na = 0, nb = 0; for (var i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
    var near = data.filter(function (x) { return x.slug && x.slug !== r.slug && x.n !== r.n && x.s >= 85; }).map(function (x) { var q = prof(x.slug); if (!q) return null; return { x: x, q: q, sim: cos(v, q.f.slice(0, 12).concat([q.f[12] * 2, q.f[13] * 2])) - (x.pr === r.pr ? 0.02 : 0) }; }).filter(Boolean).sort(function (a, b) { return b.sim - a.sim; });
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

  // Strength: where the ABV sits from 40% to 70%, with the serving zones under it.
  function proof(el, abv) {
    if (!el) return;
    if (!abv) { el.hidden = true; return; }
    el.hidden = false;
    var pos = Math.max(0, Math.min(100, (abv - 40) / 30 * 100));
    el.innerHTML = '<div class="proof-track"><i class="proof-fill" style="width:' + pos + '%"></i><b class="proof-mark" style="left:' + pos + '%"><span>' + abv + "%</span></b></div>" +
      '<div class="proof-zones"><span style="flex:6">Neat</span><span style="flex:9">A few drops</span><span style="flex:15">Water opens it</span></div>';
  }

  // Price against score for the category: every bottle a dot, the best score at each price traced, this bottle ringed.
  function valuePlot(canvas, r, data) {
    var peers = data.filter(function (x) { return x.c === r.c && x.p > 0 && x.s >= 70; });
    if (!canvas || peers.length < 8) { if (canvas) canvas.hidden = true; return null; }
    canvas.hidden = false;
    var f = setup(canvas), g = f.g, L = 34, B = 26, T = 12, Rr = 12, W = f.w - L - Rr, H = f.h - T - B;
    var lo = Math.log(Math.max(15, Math.min.apply(null, peers.map(function (x) { return x.p; })))), hi = Math.log(Math.min(5000, Math.max.apply(null, peers.map(function (x) { return x.p; })).valueOf()) * 1.05);
    var smin = Math.max(70, Math.min(80, Math.min.apply(null, peers.map(function (x) { return x.s; })))), smax = 100;
    function X(p) { return L + (Math.log(Math.max(Math.exp(lo), Math.min(Math.exp(hi), p))) - lo) / (hi - lo) * W; }
    function Y(s) { return T + (1 - (s - smin) / (smax - smin)) * H; }
    g.clearRect(0, 0, f.w, f.h);
    g.font = "10px JetBrains Mono, monospace"; g.fillStyle = "#8b7b6a"; g.strokeStyle = "rgba(23,18,13,0.07)"; g.lineWidth = 1;
    for (var s = Math.ceil(smin / 5) * 5; s <= 100; s += 5) { g.beginPath(); g.moveTo(L, Y(s)); g.lineTo(L + W, Y(s)); g.stroke(); g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(String(s), L - 8, Y(s)); }
    [25, 50, 100, 250, 500, 1000, 2500].forEach(function (p) { if (Math.log(p) < lo || Math.log(p) > hi) return; g.textAlign = "center"; g.textBaseline = "top"; g.fillText("$" + (p >= 1000 ? p / 1000 + "k" : p), X(p), T + H + 8); });
    g.textAlign = "left"; g.textBaseline = "top"; g.fillStyle = "#8b7b6a"; g.fillText("SCORE", L + 4, T);
    g.textAlign = "right"; g.textBaseline = "bottom"; g.fillText("PRICE", L + W, T + H - 4);
    var pts = peers.map(function (x) { var me = x.slug === r.slug; return { x: X(x.p), y: Y(x.s), r: x, me: me }; });
    pts.forEach(function (q) { if (q.me) return; g.beginPath(); g.arc(q.x, q.y, 2.6, 0, Math.PI * 2); g.fillStyle = q.r.s >= 90 ? "rgba(142,74,27,0.55)" : "rgba(75,63,51,0.22)"; g.fill(); });
    // The frontier: the best score money can buy at or under each price.
    var sorted = peers.slice().sort(function (a, b) { return a.p - b.p; }), bestS = -1, line = [];
    sorted.forEach(function (x) { if (x.s > bestS) { if (line.length) line.push([X(x.p), Y(bestS)]); line.push([X(x.p), Y(x.s)]); bestS = x.s; } });
    if (line.length) { line.push([L + W, line[line.length - 1][1]]); g.beginPath(); line.forEach(function (q, i) { if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.strokeStyle = "rgba(201,115,29,0.75)"; g.lineWidth = 1.5; g.stroke(); }
    if (r.p > 0) {
      var mx = X(r.p), my = Y(r.s);
      g.beginPath(); g.arc(mx, my, 12, 0, Math.PI * 2); g.fillStyle = "rgba(201,115,29,0.16)"; g.fill();
      g.beginPath(); g.arc(mx, my, 6, 0, Math.PI * 2); g.fillStyle = "#c9731d"; g.fill(); g.strokeStyle = "#fffbf5"; g.lineWidth = 2; g.stroke();
      var tag = "This bottle", tw = g.measureText(tag).width, tx = mx + 16 + tw > L + W ? mx - 16 - tw : mx + 16;
      g.font = "500 11px JetBrains Mono, monospace"; tw = g.measureText(tag).width; tx = mx + 16 + tw > L + W ? mx - 18 - tw : mx + 16; g.fillStyle = "rgba(255,251,245,0.94)"; g.fillRect(tx - 5, my - 9, tw + 10, 18); g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = "#17120d"; g.fillText(tag, tx, my);
    }
    return pts;
  }

  window.WAGlass = { load: load, profile: prof, fingerprint: fingerprint, kin: kin, proof: proof, valuePlot: valuePlot };
})();
