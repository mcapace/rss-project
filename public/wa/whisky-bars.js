/* America's Top Whisky Bars: the map and list (whisky-bars.json, built by scripts/wa-whisky-bars.mjs), the six classic cocktails and the film. */
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var track = function (name, data) { if (window.WA && WA.track) WA.track(name, data); };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      v.play().catch(function () {}); v.focus(); track("bars_film_play", {});
    });
  })();

  /* ---------- The map and the panel ---------- */
  var stage = $("wbStage"), list = $("wbList"); if (!stage || !list) return;
  var BP = window.WA && typeof WA.BASE === "string" ? WA.BASE : "/wa";
  var pageOf = function (slug) { return BP + "/whisky-bars/" + encodeURIComponent(slug); };
  var panel = $("wbPanel"), listView = $("wbListView"), detail = $("wbDetail"), count = $("wbCount"), find = $("wbFind"), stateSel = $("wbState"), nearBtn = $("wbNear"), tip = $("wbTip"), loading = $("wbLoading");
  var phone = matchMedia("(max-width: 860px)");
  var D, BARS = [], byId = {}, stSlug = {}, shown = [], sel = null, here = null, q = "", stateF = "", expanded = false;
  var M = null, selMarker = null, youMarker = null, hoverId = null;

  var fold = function (s) { return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
  var place = function (b) { return b.city + (b.st ? ", " + b.st : ""); };
  var mi = function (n) { return n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString(); };
  function miles(a, b) {
    if (a.lat == null || b.lat == null) return Infinity;
    var t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 3958.8 * Math.asin(Math.sqrt(h));
  }
  function pad() {
    if (phone.matches) return { top: 50, bottom: 40, left: 36, right: 36 };
    return { top: 70, bottom: 60, left: panel.offsetWidth + 60, right: 80 };
  }

  /* ---- list ---- */
  function render() {
    var words = fold(q).split(/\s+/).filter(Boolean);
    shown = BARS.filter(function (b) { return (!stateF || b.state === stateF) && words.every(function (w) { return b._k.indexOf(w) >= 0; }); });
    if (here) shown.sort(function (a, b) { return a._mi - b._mi; });
    if (M) M.map.getSource("bars").setData(M.features(shown));
    follow.key = "";
    var cap = phone.matches && !expanded && shown.length > 14 ? 12 : Infinity, html = "", last = "";
    shown.slice(0, cap).forEach(function (b) {
      if (!here && b.state !== last) { last = b.state; var n = shown.filter(function (x) { return x.state === b.state; }).length; html += '<li class="wbx-st"><a class="mono" href="' + pageOf(b._st) + '">' + esc(b.state) + '</a><span class="mono">' + n + "</span></li>"; }
      html += '<li><button type="button" class="wbx-row' + (sel === b ? " is-on" : "") + '" data-id="' + b.id + '"><span class="wbx-row-t"><strong>' + esc(b.name) + "</strong><em>" + esc(place(b)) + "</em></span>"
        + (here ? '<span class="wbx-mi">' + mi(b._mi) + " mi</span>" : '<i aria-hidden="true">&rarr;</i>') + "</button></li>";
    });
    if (cap < shown.length) html += '<li class="wbx-more"><button type="button" data-more>Show all ' + shown.length + " bars</button></li>";
    list.innerHTML = html || '<li class="wbx-empty"><p>No bars match.</p><button type="button" data-clear>Show every bar</button></li>';
    count.textContent = here ? shown.length + " bars, nearest first" : shown.length === BARS.length ? BARS.length + " bars, A to Z by state" : shown.length + (shown.length === 1 ? " bar" : " bars") + (stateF ? " in " + stateF : "") + (q ? " matching \u201c" + q + "\u201d" : "");
  }

  /* ---- detail ---- */
  function detailHtml(b) {
    var i = shown.indexOf(b), maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.name + ", " + b.addr);
    var near = BARS.filter(function (x) { return x !== b; }).map(function (x) { return { x: x, d: miles(b, x) }; }).sort(function (p, q) { return p.d - q.d; }).slice(0, 3);
    return '<div class="wbx-detail-bar"><button type="button" class="wbx-back" data-back><span aria-hidden="true">&larr;</span> ' + (here ? "Nearest bars" : stateF ? esc(stateF) : "All bars") + "</button>"
      + (shown.length > 1 && i >= 0 ? '<span class="wbx-steps"><button type="button" data-step="-1" aria-label="Previous bar">&lsaquo;</button><span class="mono">' + (i + 1) + " / " + shown.length + '</span><button type="button" data-step="1" aria-label="Next bar">&rsaquo;</button></span>' : "") + "</div>"
      + '<span class="mono wbx-kicker">' + esc(place(b)) + (here && b._mi != null ? " &middot; " + mi(b._mi) + " mi away" : "") + "</span>"
      + '<h2 class="wbx-name"><a href="' + pageOf(b.slug) + '">' + esc(b.name) + "</a></h2><p class=\"wbx-addr\">" + esc(b.addr) + "</p>"
      + (b.desc ? '<p class="wbx-desc">' + esc(b.desc) + "</p>" : "")
      + '<div class="wbx-act">' + (b.list ? '<a class="wbx-btn solid" href="' + esc(b.list) + '" target="_blank" rel="noopener" data-out="list">Whisky list</a>' : "")
      + (b.web ? '<a class="wbx-btn' + (b.list ? "" : " solid") + '" href="' + esc(b.web) + '" target="_blank" rel="noopener" data-out="web">Website</a>' : "")
      + '<a class="wbx-btn" href="' + maps + '" target="_blank" rel="noopener" data-out="maps">Directions</a><button type="button" class="wbx-btn" data-share>Share</button></div>'
      + '<a class="wbx-full" href="' + pageOf(b.slug) + '">The full page on ' + esc(b.name) + ' <i aria-hidden="true">&rarr;</i></a>'
      + '<h3 class="mono wbx-near-h">Close by on the list</h3><ul class="wbx-nearby">' + near.map(function (o) { return '<li><button type="button" data-id="' + o.x.id + '"><span><strong>' + esc(o.x.name) + "</strong><em>" + esc(place(o.x)) + '</em></span><span class="wbx-mi">' + mi(o.d) + " mi</span></button></li>"; }).join("") + "</ul>";
  }

  function setOn(id, on) { if (M && id != null) M.map.setFeatureState({ source: "bars", id: id }, { on: on }); }
  function select(b, opts) {
    opts = opts || {};
    if (sel) setOn(sel.id, false);
    sel = b; tip.hidden = true;
    list.querySelectorAll(".wbx-row.is-on").forEach(function (r) { r.classList.remove("is-on"); });
    if (!b) {
      detail.hidden = true; listView.hidden = false; panel.classList.remove("has-detail");
      if (selMarker) { selMarker.remove(); selMarker = null; }
      if (M && M.map.getPitch() > 0) M.map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      setUrl(); return;
    }
    var r = list.querySelector('.wbx-row[data-id="' + b.id + '"]'); if (r) r.classList.add("is-on");
    detail.innerHTML = detailHtml(b); detail.hidden = false; listView.hidden = true; panel.classList.add("has-detail"); detail.scrollTop = 0;
    if (M && b.lat != null) {
      setOn(b.id, true);
      if (selMarker) selMarker.setLngLat([b.lng, b.lat]); else selMarker = M.marker("wbx-pulse", [b.lng, b.lat]);
      var z = Math.max(M.map.getZoom(), opts.zoom || 15.2);
      var cam = { center: [b.lng, b.lat], zoom: z, pitch: reduce ? 0 : 52, bearing: reduce ? 0 : -14, padding: pad(), speed: 1.3, curve: 1.5, essential: true };
      if (reduce) cam.duration = 0;
      M.map.flyTo(cam);
    }
    setUrl(); track("bars_select", { slug: b.slug, state: b.state });
    if (opts.scroll && phone.matches) stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (!opts.keepFocus) { var h = detail.querySelector(".wbx-name a"); if (h && !phone.matches) h.focus({ preventScroll: true }); }
  }
  function setUrl() {
    var u = new URL(location.href); u.searchParams.delete("bar"); u.searchParams.delete("state");
    if (sel) u.searchParams.set("bar", sel.slug); else if (stateF) u.searchParams.set("state", stateF);
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }

  /* ---- camera ---- */
  function fit(bars, max, ms) {
    if (!M) return;
    var bb = WABarsMap.bounds(bars);
    if (!bb) return;
    var d = reduce ? 0 : ms || 1600;
    if (bb[0][0] === bb[1][0] && bb[0][1] === bb[1][1]) M.map.flyTo({ center: bb[0], zoom: Math.min(12.5, max || 12.5), pitch: 0, bearing: 0, padding: pad(), duration: d });
    else M.map.fitBounds(bb, { padding: pad(), maxZoom: max || 12.5, pitch: 0, bearing: 0, duration: d });
  }
  function fitUS() { if (M) M.map.fitBounds(WABarsMap.US, { padding: pad(), pitch: 0, bearing: 0, duration: reduce ? 0 : 1500 }); }

  function setState(name, move) {
    stateF = name; stateSel.value = name; expanded = false;
    if (here) { here = null; nearBtn.setAttribute("aria-pressed", "false"); if (youMarker) { youMarker.remove(); youMarker = null; } }
    if (sel && (!name || sel.state !== name)) select(null);
    render(); setUrl();
    if (move !== false) name ? fit(shown, 11) : fitUS();
  }

  function near() {
    if (!navigator.geolocation) { count.textContent = "Your browser can\u2019t share a location. Choose a state instead."; return; }
    nearBtn.setAttribute("aria-busy", "true"); count.textContent = "Finding bars near you\u2026";
    navigator.geolocation.getCurrentPosition(function (p) {
      here = { lat: p.coords.latitude, lng: p.coords.longitude };
      BARS.forEach(function (b) { b._mi = miles(here, b); });
      nearBtn.removeAttribute("aria-busy"); nearBtn.setAttribute("aria-pressed", "true");
      stateF = ""; stateSel.value = ""; q = ""; find.value = ""; if (sel) select(null); render(); listView.scrollTop = 0;
      if (M) {
        if (youMarker) youMarker.setLngLat([here.lng, here.lat]); else youMarker = M.marker("wbx-you", [here.lng, here.lat]);
        fit([here].concat(shown.slice(0, 4)), 13);
      }
      track("bars_near", {});
    }, function () { nearBtn.removeAttribute("aria-busy"); count.textContent = "Location is off for this site. Choose a state or search instead."; }, { timeout: 10000, maximumAge: 600000 });
  }

  /* ---- map ---- */
  function initMap() {
    var el = $("wbMap");
    WABarsMap.create(el, { bars: shown, center: [-97, 39], zoom: phone.matches ? 2.4 : 3.3 }).then(function (m) {
      loading.hidden = true;
      if (!m) { stage.classList.add("no-map"); return; }
      M = m; var map = m.map; stage.classList.add("has-map");
      map.getSource("bars").setData(m.features(shown));
      if (sel) { var s = sel; sel = null; select(s, { keepFocus: true }); }
      else if (stateF) fit(shown, 11); else fitUS();
      map.on("click", "bar-cluster", function (e) {
        var f = e.features[0];
        Promise.resolve(map.getSource("bars").getClusterExpansionZoom(f.properties.cluster_id)).then(function (z) { map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.4, 14), duration: reduce ? 0 : 700 }); });
      });
      map.on("click", "bar-dot", function (e) { select(byId[e.features[0].properties.id]); });
      function hover(id) { if (hoverId != null) map.setFeatureState({ source: "bars", id: hoverId }, { hover: false }); hoverId = id; if (id != null) map.setFeatureState({ source: "bars", id: id }, { hover: true }); }
      map.on("mousemove", "bar-dot", function (e) {
        var f = e.features[0], b = byId[f.properties.id]; map.getCanvas().style.cursor = "pointer"; hover(f.id);
        tip.innerHTML = "<strong>" + esc(b.name) + "</strong><span>" + esc(place(b)) + "</span>"; tip.hidden = false;
        tip.style.transform = "translate(" + (e.point.x + 14) + "px," + (e.point.y + 14) + "px)";
      });
      map.on("mousemove", "bar-cluster", function (e) {
        map.getCanvas().style.cursor = "pointer"; var n = e.features[0].properties.point_count;
        tip.innerHTML = "<strong>" + n + " bars</strong><span>Click to zoom in</span>"; tip.hidden = false;
        tip.style.transform = "translate(" + (e.point.x + 14) + "px," + (e.point.y + 14) + "px)";
      });
      ["bar-dot", "bar-cluster"].forEach(function (l) { map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; tip.hidden = true; hover(null); }); });
      list.addEventListener("pointerover", function (e) { var r = e.target.closest(".wbx-row"); hover(r ? +r.getAttribute("data-id") : null); });
      list.addEventListener("pointerleave", function () { hover(null); });
    });
  }

  /* ---- the map follows the list: scrolling the panel frames the state being read (the nearest bars in view, near me) ---- */
  var follow = { key: "", at: 0, t: 0 };
  function rowsInView() {
    var box = listView.getBoundingClientRect(), out = [];
    list.querySelectorAll(".wbx-row").forEach(function (r) { var b = r.getBoundingClientRect(); if (b.bottom > box.top + 30 && b.top < box.bottom - 10) out.push(byId[r.getAttribute("data-id")]); });
    return out.filter(Boolean);
  }
  function followList() {
    if (!M || sel || listView.hidden) return;
    if (listView.scrollTop < 8 && !here && !stateF && !q) { if (follow.key !== "us") { follow.key = "us"; M.map.fitBounds(WABarsMap.US, { padding: pad(), pitch: 0, bearing: 0, duration: reduce ? 0 : 900 }); } return; }
    var v = rowsInView(); if (!v.length) return;
    var lead = v[Math.min(v.length - 1, Math.floor(v.length / 3))];
    var group = here ? v : shown.filter(function (x) { return x.state === lead.state; });
    var key = group.map(function (b) { return b.id; }).join(",");
    if (key === follow.key) return;
    follow.key = key;
    fit(group, here ? 11 : 9.5, 900);
  }
  ["wheel", "touchmove", "pointerdown", "keydown"].forEach(function (ev) { listView.addEventListener(ev, function () { follow.at = Date.now(); }, { passive: true }); });
  listView.addEventListener("scroll", function () {
    if (Date.now() - follow.at > 1500) return;
    clearTimeout(follow.t); follow.t = setTimeout(followList, 160);
  }, { passive: true });

  /* ---- events ---- */
  panel.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("[data-more]")) { expanded = true; render(); return; }
    if (t.closest("[data-clear]")) { q = ""; find.value = ""; setState(""); return; }
    if (t.closest("[data-back]")) { select(null); return; }
    var s = t.closest("[data-step]");
    if (s && sel) { var i = shown.indexOf(sel), n = shown[(i + +s.getAttribute("data-step") + shown.length) % shown.length]; select(n, { keepFocus: true }); var nb = detail.querySelector('[data-step="' + s.getAttribute("data-step") + '"]'); if (nb) nb.focus(); return; }
    var row = t.closest("[data-id]"); if (row && row.tagName === "BUTTON") { select(byId[row.getAttribute("data-id")], { scroll: true }); return; }
    var o = t.closest("[data-out]"); if (o && sel) track("bars_out", { slug: sel.slug, kind: o.getAttribute("data-out") });
    var sh = t.closest("[data-share]");
    if (sh && sel) {
      var u = new URL(pageOf(sel.slug), location.href).href;
      if (navigator.share) navigator.share({ title: sel.name + " \u00b7 America\u2019s Top Whisky Bars", url: u }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { sh.textContent = "Link copied"; setTimeout(function () { sh.textContent = "Share"; }, 1800); });
    }
  });
  $("wbJumps").addEventListener("click", function (e) {
    var j = e.target.closest("[data-jump]"); if (!j) return; var v = j.getAttribute("data-jump");
    if (v === "us") { q = ""; find.value = ""; if (sel) select(null); setState("", false); fitUS(); } else setState(v);
  });
  $("wbZoomIn").addEventListener("click", function () { if (M) M.map.zoomIn({ duration: 300 }); });
  $("wbZoomOut").addEventListener("click", function () { if (M) M.map.zoomOut({ duration: 300 }); });
  var qt = 0;
  find.addEventListener("input", function () {
    clearTimeout(qt); qt = setTimeout(function () {
      q = find.value.trim(); if (sel) select(null); expanded = false; render();
      if (q && shown.length) fit(shown, 12); else if (!q) stateF ? fit(shown, 11) : fitUS();
    }, 160);
  });
  find.addEventListener("keydown", function (e) { if (e.key === "Enter" && shown[0]) { e.preventDefault(); select(shown[0], { scroll: true }); } });
  stateSel.addEventListener("change", function () { setState(stateSel.value); });
  nearBtn.addEventListener("click", function () {
    if (here) { here = null; nearBtn.setAttribute("aria-pressed", "false"); if (youMarker) { youMarker.remove(); youMarker = null; } render(); fitUS(); return; }
    near();
  });
  var heroNear = $("wbNearHero");
  if (heroNear) heroNear.addEventListener("click", function () { stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); near(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sel && !document.querySelector("dialog[open]")) select(null); });
  phone.addEventListener && phone.addEventListener("change", function () { render(); if (M) M.map.resize(); });

  (window.WA && WA.loadJSON ? WA.loadJSON("whisky-bars.json") : fetch("whisky-bars.json").then(function (r) { return r.json(); })).then(function (d) {
    D = d;
    d.states.forEach(function (s) { stSlug[s.name] = s.slug; });
    BARS = d.bars.slice().sort(function (a, b) { return a.state.localeCompare(b.state) || a.city.localeCompare(b.city) || a.name.localeCompare(b.name); });
    BARS.forEach(function (b) { byId[b.id] = b; b._st = stSlug[b.state] || ""; b._k = fold([b.name, b.city, b.state, b.st, b.addr].join(" ")); });
    var st = new Set(BARS.map(function (b) { return b.state; })), extra = ["District of Columbia", "Puerto Rico"].filter(function (s) { return st.has(s); });
    var dd = document.querySelectorAll("#wbStats dd"); if (dd.length === 3) { dd[0].textContent = BARS.length; dd[1].textContent = st.size - extra.length; dd[2].textContent = extra.map(function (s) { return s === "Puerto Rico" ? "Puerto Rico" : "D.C."; }).join(" & ") || "Coast to coast"; }
    stateSel.innerHTML = '<option value="">All states</option>' + Array.from(st).sort().map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + " (" + BARS.filter(function (b) { return b.state === s; }).length + ")</option>"; }).join("");
    var p = new URLSearchParams(location.search), want = p.get("bar"), ws = p.get("state");
    if (ws && st.has(ws)) { stateF = ws; stateSel.value = ws; }
    render();
    var hit = want && (BARS.filter(function (b) { return b.slug === want; })[0] || (/^\d+$/.test(want) ? byId[+want] : null));
    if (hit) { select(hit, { keepFocus: true }); setTimeout(function () { stage.scrollIntoView({ block: "start" }); }, 60); }
    initMap();
  }).catch(function () { count.textContent = "The bars could not load. Check your connection and reload the page."; loading.hidden = true; });
})();
