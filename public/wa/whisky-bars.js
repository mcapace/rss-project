/* America's Top Whisky Bars: the map and list (whisky-bars.json, built by scripts/wa-whisky-bars.mjs), the six classic cocktails and the film. */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var track = function (name, data) { if (window.WA && WA.track) WA.track(name, data); };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Hero film loop: wide screens only, paused off screen, skipped for reduced motion and data saver ---------- */
  (function () {
    var v = $("wbHeroVideo"); if (!v) return;
    var save = navigator.connection && navigator.connection.saveData;
    if (reduce || save || !matchMedia("(min-width: 900px)").matches) return;
    v.src = v.getAttribute("data-src");
    v.addEventListener("playing", function () { v.classList.add("is-on"); }, { once: true });
    new IntersectionObserver(function (e) { if (e[0].isIntersecting && !document.body.classList.contains("wb-film-on")) v.play().catch(function () {}); else v.pause(); }, { threshold: 0.15 }).observe(v);
  })();

  /* ---------- The six classics ---------- */
  var DRINKS = [
    { id: "manhattan", name: "The Manhattan", img: "manhattan", recipe: "2 parts Maker's Mark 46\u00ae\n1 part sweet vermouth\n2 dashes Angostura\u00ae bitters\nLuxardo\u00ae cherry for garnish\n\nCombine ingredients over ice in a mixing glass. Stir and strain into a chilled cocktail glass neat or on the rocks. Garnish with a Luxardo\u00ae cherry.", take: "Today's bartenders revisit the Manhattan through nuance, not novelty. They explore the spectrum of vermouths from blanc to dry, utilize bitters with chocolate or cherry, and introduce smoke or barrel-aging for added depth. Each variation reflects the dialogue between sweetness and spirit, reaffirming why this drink remains a benchmark.", shop: "https://www.reservebar.com/products/makers-46-bourbon-whisky/GROUPING-34281" },
    { id: "highball", name: "The Highball", img: "highball", recipe: "2 parts Suntory Toki\u00ae\n4 parts chilled soda water\nLemon twist for garnish\n\nFill a highball glass with ice. Add whisky, then top with soda water. Stir gently once or twice. Express lemon twist over drink and drop in or discard.", take: "The Japanese Highball has elevated a simple serve into a ritual of precision. Bartenders obsess over ice clarity, carbonation levels, and the exact ratio of whisky to water. Some add citrus oils or swap soda for tonic or ginger ale. The result: a refreshingly deliberate drink.", shop: "https://store.whiskyadvocate.com/products/suntory-whisky-toki" },
    { id: "rob-roy", name: "The Rob Roy", img: "rob-roy", recipe: "2 parts Laphroaig\u00ae 10 Year Old\n1 part sweet vermouth\n2 dashes Angostura\u00ae bitters\nBrandied cherry for garnish\n\nStir ingredients with ice and strain into a chilled coupe. Garnish with a brandied cherry.", take: "The Rob Roy invites experimentation with Scotch's regional diversity. Bartenders might swap in peated Islay malts for smoke or sherried Speysides for richness. Vermouth choices, from dry to blanc, shift the balance, while bitters add complexity. A Scottish cousin of the Manhattan, it rewards those who explore.", shop: "https://store.whiskyadvocate.com/products/laphroaig-10-year-old" },
    { id: "old-fashioned", name: "The Old Fashioned", img: "old-fashioned", recipe: "2 parts Knob Creek\u00ae Bourbon\n1 sugar cube\n2-3 dashes Angostura\u00ae bitters\nOrange peel for garnish\n\nMuddle sugar cube with bitters and a splash of water. Add bourbon and ice. Stir until chilled. Express orange peel over drink and drop in.", take: "The Old Fashioned is the cocktail canon's cornerstone, and bartenders treat it with reverence and creativity in equal measure. Variations include smoked presentations, maple or demerara syrups, and whiskey swaps from rye to Japanese. The best versions honor simplicity while revealing depth.", shop: "https://www.reservebar.com/products/knob-creek-kentucky-straight-bourbon-whiskey/GROUPING-33220" },
    { id: "boulevardier", name: "The Boulevardier", img: "boulevardier", recipe: "1.5 parts Basil Hayden's\u00ae Bourbon\n1 part Campari\u00ae\n1 part sweet vermouth\nOrange twist for garnish\n\nStir all ingredients with ice and strain into a chilled coupe or rocks glass over a large ice cube. Garnish with an orange twist.", take: "A whiskey-based Negroni variation, the Boulevardier sets bourbon's vanilla sweetness against Campari's bitter edge. Modern takes experiment with rye for spice, aged vermouths for depth, or aperitivos beyond Campari. Some add amaro floats or citrus oils to brighten the profile.", shop: "https://store.whiskyadvocate.com/products/basil-haydens-bourbon" },
    { id: "gold-rush", name: "The Gold Rush", img: "gold-rush", recipe: "2 parts Maker's Mark\u00ae Bourbon\n0.75 parts fresh lemon juice\n0.75 parts honey syrup (3:1 honey to water)\n\nShake all ingredients with ice and strain into a chilled rocks glass over fresh ice. No garnish needed.", take: "A modern classic born at NYC's Milk & Honey, the Gold Rush reimagines the whiskey sour with honey's floral sweetness. Bartenders experiment with infused honeys, ginger additions, or egg white for texture. Seasonal variations might feature apple or pear, but the template remains elegantly simple.", shop: "https://store.whiskyadvocate.com/products/makers-mark-bourbon" }
  ];
  DRINKS.forEach(function (d) {
    var parts = d.recipe.split("\n\n"); d.lines = parts[0].split("\n"); d.method = parts[1] || "";
    d.spirit = d.lines[0].replace(/^[\d.]+\s+parts?\s+/i, "").replace(/\u00ae/g, "");
  });
  var src = function (d, w) { return "img/bars/" + d.img + (w ? "-" + w : "") + ".webp"; };

  (function () {
    var box = $("wbDrinks"), dlg = $("wbDrinkDlg"); if (!box || !dlg) return;
    box.innerHTML = DRINKS.map(function (d, i) {
      return '<button type="button" class="wb-drink" data-i="' + i + '"><img src="' + src(d, 560) + '" srcset="' + src(d, 560) + ' 560w, ' + src(d) + ' 1050w" sizes="(min-width: 1100px) 360px, (min-width: 700px) 30vw, 70vw" alt="" width="560" height="647" loading="lazy">'
        + '<span class="wb-drink-copy"><span class="mono">' + esc(d.spirit) + '</span><strong>' + esc(d.name) + '</strong><span class="wb-drink-go">The recipe <i aria-hidden="true">&rarr;</i></span></span></button>';
    }).join("");
    var cur = 0;
    function show(i) {
      cur = (i + DRINKS.length) % DRINKS.length; var d = DRINKS[cur];
      dlg.innerHTML = '<div class="wb-dlg-in"><img src="' + src(d) + '" alt="' + esc(d.name) + ' with ' + esc(d.spirit) + '" width="1050" height="1214">'
        + '<div class="wb-dlg-copy"><button type="button" class="wb-x" data-close aria-label="Close">&times;</button><span class="mono">Elevating the classics &middot; ' + (cur + 1) + ' of ' + DRINKS.length + '</span><h2 class="d2" id="wbDrinkName">' + esc(d.name) + '</h2>'
        + '<h3 class="mono">The original</h3><ul class="wb-spec">' + d.lines.map(function (l) { var m = l.match(/^([\d.\-]+\s+(?:parts?|dashes?)|\d+\s+sugar cube)\s+(.*)$/i); return m ? "<li><b>" + esc(m[1]) + "</b>" + esc(m[2]) + "</li>" : "<li><b></b>" + esc(l) + "</li>"; }).join("") + "</ul>"
        + '<p class="wb-method">' + esc(d.method) + '</p><h3 class="mono">Today&rsquo;s take</h3><p>' + esc(d.take) + '</p>'
        + '<div class="wb-dlg-act"><a class="pill solid" href="' + esc(d.shop) + '" target="_blank" rel="noopener" data-shop>Shop ' + esc(d.spirit) + '</a><span class="wb-dlg-nav"><button type="button" class="pill" data-step="-1" aria-label="Previous cocktail">&larr;</button><button type="button" class="pill" data-step="1" aria-label="Next cocktail">&rarr;</button></span></div></div></div>';
    }
    box.addEventListener("click", function (e) { var b = e.target.closest(".wb-drink"); if (!b) return; show(+b.getAttribute("data-i")); dlg.showModal(); track("bars_cocktail", { id: DRINKS[cur].id }); });
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg || e.target.closest("[data-close]")) { dlg.close(); return; }
      var s = e.target.closest("[data-step]"); if (s) { show(cur + +s.getAttribute("data-step")); dlg.querySelector('[data-step="' + s.getAttribute("data-step") + '"]').focus(); }
      if (e.target.closest("[data-shop]")) track("bars_cocktail_shop", { id: DRINKS[cur].id });
    });
    dlg.addEventListener("keydown", function (e) { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { show(cur + (e.key === "ArrowRight" ? 1 : -1)); } });
  })();

  /* ---------- The film ---------- */
  (function () {
    var btn = $("wbPlay"), box = $("wbFilm"); if (!btn) return;
    btn.addEventListener("click", function () {
      var v = document.createElement("video");
      v.controls = true; v.playsInline = true; v.autoplay = true; v.poster = "img/bars/film.webp";
      v.src = innerWidth > 1300 ? "https://cdn.jwplayer.com/videos/vn5OBNyP-VLJR2Jsq.mp4" : "https://cdn.jwplayer.com/videos/vn5OBNyP-WBFwZoOE.mp4";
      v.setAttribute("aria-label", "An ode to the whisky bar");
      box.innerHTML = ""; box.appendChild(v); box.classList.add("is-playing");
      document.body.classList.add("wb-film-on"); var h = $("wbHeroVideo"); if (h) h.pause();
      v.play().catch(function () {}); v.focus(); track("bars_film_play", {});
    });
  })();

  /* ---------- Map and list ---------- */
  var svg = $("wbSvg"), list = $("wbList"); if (!svg || !list) return;
  var D, BARS = [], byId = {}, W = 975, H = 610, view = { x: 0, y: 0, w: W, h: H }, full = { x: 0, y: 0, w: W, h: H };
  var dots = {}, rows = {}, sel = null, here = null, q = "", stateF = "", shown = [], expanded = false;
  var phone = matchMedia("(max-width: 860px)");
  var map = $("wbMap"), tip = $("wbTip"), card = $("wbCard"), count = $("wbCount"), find = $("wbFind"), stateSel = $("wbState"), nearBtn = $("wbNear"), reset = $("wbReset");

  function el(tag, attrs) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function pxW() { return svg.getBoundingClientRect().width || W; }
  function fitAspect(v) {
    var r = svg.getBoundingClientRect(), a = r.width && r.height ? r.width / r.height : W / H;
    var w = v.w, h = v.h; if (w / h < a) w = h * a; else h = w / a;
    return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w: w, h: h };
  }
  function apply(v) {
    view = v; svg.setAttribute("viewBox", v.x.toFixed(2) + " " + v.y.toFixed(2) + " " + v.w.toFixed(2) + " " + v.h.toFixed(2));
    var k = v.w / pxW(); svg.style.setProperty("--k", k.toFixed(4));
    var r = 3.4 * Math.max(k, 0.12) * Math.min(1.5, Math.pow(full.w / v.w, 0.22));
    for (var id in dots) dots[id].setAttribute("r", (dots[id].classList.contains("is-on") ? r * 1.7 : r).toFixed(2));
    reset.hidden = v.w > full.w * 0.92; map.classList.toggle("is-zoomed", !reset.hidden);
  }
  var anim = 0;
  function go(target, ms) {
    target = fitAspect(target); cancelAnimationFrame(anim);
    if (reduce || ms === 0) { apply(target); return; }
    var from = { x: view.x, y: view.y, w: view.w, h: view.h }, t0 = performance.now(); ms = ms || 650;
    (function step(t) {
      var p = Math.min(1, (t - t0) / ms), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      apply({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e });
      if (p < 1) anim = requestAnimationFrame(step);
    })(t0);
  }
  function boxOf(pts, pad, minW) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[2] == null ? p[0] : p[2]); y1 = Math.max(y1, p[3] == null ? p[1] : p[3]); });
    var w = Math.max(x1 - x0, minW || 0), h = Math.max(y1 - y0, (minW || 0) * 0.62), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    w *= 1 + pad; h *= 1 + pad; return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function stateBox(name) { var s = D.states.filter(function (x) { return x.name === name; })[0]; return s ? boxOf([s.box], 0.18, 70) : full; }

  function miles(a, b) {
    var R = 3958.8, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  var fold = function (s) { return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };

  function render() {
    var words = fold(q).split(/\s+/).filter(Boolean);
    shown = BARS.filter(function (b) {
      if (stateF && b.state !== stateF) return false;
      return words.every(function (w) { return b._k.indexOf(w) >= 0; });
    });
    if (here) shown.sort(function (a, b) { return a._mi - b._mi; });
    var on = {}; shown.forEach(function (b) { on[b.id] = 1; });
    for (var id in dots) dots[id].classList.toggle("is-dim", !on[id]);
    var html = "", lastState = "", cap = phone.matches && !expanded && shown.length > 14 ? 12 : Infinity;
    if (sel && cap < Infinity && shown.indexOf(sel) >= cap) cap = shown.indexOf(sel) + 1;
    shown.slice(0, cap).forEach(function (b) {
      if (!here && b.state !== lastState) { lastState = b.state; html += '<li class="wb-st mono">' + esc(b.state) + '<span>' + BARS.filter(function (x) { return x.state === b.state && (!words.length || shown.indexOf(x) >= 0); }).length + '</span></li>'; }
      html += '<li><button type="button" class="wb-row' + (sel && sel.id === b.id ? " is-on" : "") + '" data-id="' + b.id + '" aria-pressed="' + (sel && sel.id === b.id) + '"><span class="wb-row-t"><strong>' + esc(b.name) + '</strong><em>' + esc(b.city + (b.st ? ", " + b.st : "")) + '</em></span>'
        + (here ? '<span class="wb-mi">' + (b._mi < 10 ? b._mi.toFixed(1) : Math.round(b._mi).toLocaleString()) + ' mi</span>' : '<i aria-hidden="true">&rarr;</i>') + "</button></li>";
    });
    if (cap < shown.length) html += '<li class="wb-more"><button type="button" class="pill" data-more>Show all ' + shown.length + ' bars</button></li>';
    list.innerHTML = html || '<li class="wb-empty">No bars match. <button type="button" class="pill" data-clear>Show every bar</button></li>';
    rows = {}; list.querySelectorAll(".wb-row").forEach(function (r) { rows[r.getAttribute("data-id")] = r; });
    count.textContent = shown.length === BARS.length && !here ? BARS.length + " bars, A to Z by state" : here ? shown.length + " bars, nearest first" : shown.length + (shown.length === 1 ? " bar" : " bars") + (stateF ? " in " + stateF : "") + (q ? " matching \u201c" + q + "\u201d" : "");
  }

  function cardHtml(b) {
    var i = shown.indexOf(b), maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.name + ", " + b.addr);
    return '<button type="button" class="wb-x" data-close aria-label="Close">&times;</button>'
      + '<span class="mono">' + esc(b.city + (b.st ? ", " + b.st : "")) + (b._mi != null && here ? " &middot; " + (b._mi < 10 ? b._mi.toFixed(1) : Math.round(b._mi)) + " mi away" : "") + '</span>'
      + '<h3>' + esc(b.name) + '</h3><p class="wb-addr">' + esc(b.addr) + '</p>' + (b.desc ? '<p class="wb-desc">' + esc(b.desc) + '</p>' : "")
      + '<div class="wb-card-act">' + (b.list ? '<a class="pill solid" href="' + esc(b.list) + '" target="_blank" rel="noopener" data-out="list">Whisky list</a>' : "")
      + (b.web ? '<a class="pill' + (b.list ? "" : " solid") + '" href="' + esc(b.web) + '" target="_blank" rel="noopener" data-out="web">Website</a>' : "")
      + '<a class="pill" href="' + maps + '" target="_blank" rel="noopener" data-out="maps">Directions</a><button type="button" class="pill" data-share>Share</button></div>'
      + (shown.length > 1 && i >= 0 ? '<div class="wb-card-nav"><button type="button" data-step="-1" aria-label="Previous bar">&larr;</button><span class="mono">' + (i + 1) + " of " + shown.length + '</span><button type="button" data-step="1" aria-label="Next bar">&rarr;</button></div>' : "");
  }

  function select(b, opts) {
    opts = opts || {};
    if (sel && dots[sel.id]) dots[sel.id].classList.remove("is-on");
    if (sel && rows[sel.id]) { rows[sel.id].classList.remove("is-on"); rows[sel.id].setAttribute("aria-pressed", "false"); }
    sel = b; tip.hidden = true;
    if (!b) { card.hidden = true; map.classList.remove("has-card"); setUrl(); apply(view); return; }
    var d = dots[b.id]; if (d) { d.classList.add("is-on"); d.parentNode.appendChild(d); }
    var r = rows[b.id]; if (r) { r.classList.add("is-on"); r.setAttribute("aria-pressed", "true"); if (!opts.fromList) { var lw = list.parentNode; lw.scrollTop = r.offsetTop - lw.clientHeight / 2 + r.offsetHeight / 2; } }
    card.innerHTML = cardHtml(b); card.hidden = false; map.classList.add("has-card");
    if (b.x != null && opts.zoom !== false) {
      var mobile = innerWidth < 861, w = Math.min(Math.max(view.w, 150), 230);
      var v = fitAspect({ x: b.x - w / 2, y: b.y - w * 0.31, w: w, h: w * 0.62 });
      if (!mobile) { v.x += v.w * 0.14; v.y += v.h * 0.1; }
      go(v);
    } else apply(view);
    setUrl(); track("bars_select", { slug: b.slug, state: b.state });
    if (opts.scroll && innerWidth < 861) map.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  function setUrl() {
    var u = new URL(location.href); u.searchParams.delete("bar"); u.searchParams.delete("state");
    if (sel) u.searchParams.set("bar", sel.slug); else if (stateF) u.searchParams.set("state", stateF);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }

  function setState(name, zoom) {
    stateF = name; stateSel.value = name; render();
    if (sel && name && sel.state !== name) select(null);
    if (zoom !== false) go(name ? stateBox(name) : full);
    setUrl();
  }

  function near() {
    if (!navigator.geolocation) { count.textContent = "Your browser can't share a location; choose a state instead."; return; }
    nearBtn.setAttribute("aria-busy", "true"); count.textContent = "Finding bars near you\u2026";
    navigator.geolocation.getCurrentPosition(function (p) {
      here = { lat: p.coords.latitude, lng: p.coords.longitude };
      BARS.forEach(function (b) { b._mi = b.lat != null ? miles(here, b) : 1e9; });
      nearBtn.removeAttribute("aria-busy"); nearBtn.setAttribute("aria-pressed", "true");
      stateF = ""; stateSel.value = ""; q = ""; find.value = ""; render();
      var top = shown.slice(0, 4).filter(function (b) { return b.x != null; });
      if (shown[0]) select(shown[0], { zoom: false });
      if (top.length) go(boxOf(top.map(function (b) { return [b.x, b.y]; }), 0.6, 90));
      list.parentNode.scrollTop = 0; track("bars_near", {});
    }, function () {
      nearBtn.removeAttribute("aria-busy"); count.textContent = "Location is off for this site. Choose a state or search instead.";
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  }

  function clusterAt(b) {
    var k = view.w / pxW(), lim = 9 * k;
    return shown.filter(function (x) { return x.x != null && Math.abs(x.x - b.x) < lim && Math.abs(x.y - b.y) < lim; });
  }

  function build() {
    stateSel.innerHTML = '<option value="">All states</option>' + Array.from(new Set(BARS.map(function (b) { return b.state; }))).sort().map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + " (" + BARS.filter(function (b) { return b.state === s; }).length + ")</option>";
    }).join("");
    var defs = el("defs", {}); defs.innerHTML = '<radialGradient id="wbGlow"><stop offset="0" stop-color="#ffd38a" stop-opacity="0.55"/><stop offset="1" stop-color="#e3a443" stop-opacity="0"/></radialGradient>';
    svg.appendChild(defs);
    var gS = el("g", { "class": "wb-states" });
    D.states.forEach(function (s) { var p = el("path", { d: s.d, "class": s.bars ? "has-bars" : "" }); p.setAttribute("data-state", s.name); var t = el("title", {}); t.textContent = s.name; p.appendChild(t); gS.appendChild(p); });
    svg.appendChild(gS);
    var prBox = D.states.filter(function (s) { return s.name === "Puerto Rico"; })[0];
    if (prBox) { var b = prBox.box; var f = el("rect", { x: b[0] - 10, y: b[1] - 12, width: b[2] - b[0] + 20, height: b[3] - b[1] + 22, rx: 6, "class": "wb-inset" }); svg.insertBefore(f, gS.nextSibling); }
    var gD = el("g", { "class": "wb-dots" });
    BARS.forEach(function (b) {
      if (b.x == null) return;
      var c = el("circle", { cx: b.x, cy: b.y, r: 3.4, "class": "wb-dot" }); c.setAttribute("data-id", b.id);
      dots[b.id] = c; gD.appendChild(c);
    });
    svg.appendChild(gD);
    apply(fitAspect(full));
  }

  /* Map pointer: hover names a bar (or a cluster), a tap selects or zooms into a cluster, a drag pans when zoomed. */
  var drag = null;
  svg.addEventListener("pointerdown", function (e) { if (e.button) return; drag = { x: e.clientX, y: e.clientY, v: { x: view.x, y: view.y, w: view.w, h: view.h }, moved: false }; });
  addEventListener("pointermove", function (e) {
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5 && view.w < full.w * 0.98) { drag.moved = true; svg.setPointerCapture && svg.setPointerCapture(e.pointerId); map.classList.add("is-drag"); cancelAnimationFrame(anim); }
      if (drag.moved) { var k = view.w / pxW(); apply({ x: drag.v.x - dx * k, y: drag.v.y - dy * k, w: drag.v.w, h: drag.v.h }); }
      return;
    }
    if (e.pointerType !== "mouse" || !svg.contains(e.target)) return;
    var c = e.target.closest && e.target.closest(".wb-dot");
    if (!c) { tip.hidden = true; return; }
    var b = byId[c.getAttribute("data-id")], cl = clusterAt(b), mr = map.getBoundingClientRect();
    tip.innerHTML = cl.length > 1 ? "<strong>" + cl.length + " bars here</strong><span>" + esc(b.city + ", " + b.st) + "</span><em>Click to zoom in</em>" : "<strong>" + esc(b.name) + "</strong><span>" + esc(b.city + ", " + b.st) + "</span>";
    tip.hidden = false; tip.style.transform = "translate(" + Math.min(e.clientX - mr.left + 14, mr.width - 260) + "px," + (e.clientY - mr.top + 14) + "px)";
  });
  addEventListener("pointerup", function (e) {
    if (!drag) return; var d = drag; drag = null; map.classList.remove("is-drag");
    if (d.moved || !svg.contains(e.target)) return;
    var c = e.target.closest && e.target.closest(".wb-dot");
    if (c) {
      var b = byId[c.getAttribute("data-id")], cl = clusterAt(b);
      if (cl.length > 1 && view.w > 60) { go(boxOf(cl.map(function (x) { return [x.x, x.y]; }), 0.6, Math.max(view.w / 7, 14))); tip.hidden = true; }
      else select(b);
      return;
    }
    var p = e.target.closest && e.target.closest("path[data-state]");
    if (p && p.getAttribute("class") === "has-bars") setState(p.getAttribute("data-state"));
  });
  svg.addEventListener("pointerleave", function () { tip.hidden = true; });

  $("wbZoomIn").addEventListener("click", function () { var w = Math.max(view.w / 1.7, 18); go({ x: view.x + (view.w - w) / 2, y: view.y + (view.h - w / view.w * view.h) / 2, w: w, h: w / view.w * view.h }, 380); });
  $("wbZoomOut").addEventListener("click", function () { var w = Math.min(view.w * 1.7, full.w * 1.05); go({ x: view.x + (view.w - w) / 2, y: view.y + (view.h - w / view.w * view.h) / 2, w: w, h: w / view.w * view.h }, 380); });
  reset.addEventListener("click", function () { select(null); setState("", true); });

  list.addEventListener("click", function (e) {
    if (e.target.closest("[data-clear]")) { q = ""; find.value = ""; setState(""); return; }
    if (e.target.closest("[data-more]")) { expanded = true; render(); return; }
    var r = e.target.closest(".wb-row"); if (r) select(byId[r.getAttribute("data-id")], { fromList: true, scroll: true });
  });
  list.addEventListener("pointerover", function (e) { var r = e.target.closest(".wb-row"); svg.querySelectorAll(".is-hot").forEach(function (d) { d.classList.remove("is-hot"); }); if (r && dots[r.getAttribute("data-id")]) dots[r.getAttribute("data-id")].classList.add("is-hot"); });
  list.addEventListener("pointerleave", function () { svg.querySelectorAll(".is-hot").forEach(function (d) { d.classList.remove("is-hot"); }); });

  card.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { select(null); return; }
    var s = e.target.closest("[data-step]");
    if (s && sel) { var i = shown.indexOf(sel), n = shown[(i + +s.getAttribute("data-step") + shown.length) % shown.length]; select(n); var nb = card.querySelector('[data-step="' + s.getAttribute("data-step") + '"]'); if (nb) nb.focus(); return; }
    var o = e.target.closest("[data-out]"); if (o && sel) track("bars_out", { slug: sel.slug, kind: o.getAttribute("data-out") });
    if (e.target.closest("[data-share]") && sel) {
      var u = new URL(location.href); u.search = "?bar=" + sel.slug; var btn = e.target.closest("[data-share]");
      if (navigator.share) navigator.share({ title: sel.name + " \u00b7 America\u2019s Top Whisky Bars", url: u.href }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(u.href).then(function () { btn.textContent = "Link copied"; setTimeout(function () { btn.textContent = "Share"; }, 1800); });
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sel && !document.querySelector("dialog[open]")) select(null); });

  var qt = 0;
  find.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { q = find.value.trim(); render(); var pts = shown.filter(function (b) { return b.x != null; }); if (q && pts.length) go(pts.length === 1 ? boxOf([[pts[0].x, pts[0].y]], 0, 160) : boxOf(pts.map(function (b) { return [b.x, b.y]; }), 0.5, 90)); else if (!q) go(stateF ? stateBox(stateF) : full); }, 140); });
  find.addEventListener("keydown", function (e) { if (e.key === "Enter" && shown[0]) { e.preventDefault(); select(shown[0], { scroll: true }); } });
  stateSel.addEventListener("change", function () { if (here) { here = null; nearBtn.setAttribute("aria-pressed", "false"); } setState(stateSel.value); });
  nearBtn.addEventListener("click", function () {
    if (here) { here = null; nearBtn.setAttribute("aria-pressed", "false"); render(); go(full); return; }
    near();
  });
  var heroNear = $("wbNearHero");
  if (heroNear) heroNear.addEventListener("click", function () { $("explore").scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); near(); });
  var rz = 0; addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { apply(fitAspect(view)); }, 120); });

  (window.WA && WA.loadJSON ? WA.loadJSON("whisky-bars.json") : fetch("whisky-bars.json").then(function (r) { return r.json(); })).then(function (d) {
    D = d; W = d.box[0]; H = d.box[1]; full = { x: 0, y: 0, w: W, h: H };
    BARS = d.bars.slice().sort(function (a, b) { return a.state.localeCompare(b.state) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name); });
    BARS.forEach(function (b) { byId[b.id] = b; b._k = fold([b.name, b.city, b.state, b.st, b.addr].join(" ")); });
    var st = new Set(BARS.map(function (b) { return b.state; })), extra = ["District of Columbia", "Puerto Rico"].filter(function (s) { return st.has(s); });
    var dd = document.querySelectorAll("#wbStats dd"); if (dd.length === 3) { dd[0].textContent = BARS.length; dd[1].textContent = st.size - extra.length; dd[2].textContent = extra.map(function (s) { return s === "Puerto Rico" ? "Puerto Rico" : "D.C."; }).join(" & ") || "Coast to coast"; }
    build(); render();
    var p = new URLSearchParams(location.search), want = p.get("bar"), ws = p.get("state");
    var hit = want && (BARS.filter(function (b) { return b.slug === want; })[0] || (/^\d+$/.test(want) ? byId[+want] : null));
    if (hit) { select(hit, { zoom: true }); if (location.search.indexOf("bar=") >= 0 && !location.hash) setTimeout(function () { $("explore").scrollIntoView(); }, 50); }
    else if (ws && st.has(ws)) setState(ws);
  }).catch(function () { count.textContent = "The bars could not load. Check your connection and reload the page."; });
})();
