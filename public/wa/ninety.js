// 90+ Club (ninety.html): the shelf hero, the member grid, the film, the club's stories and the other spirits.
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function group(c) { c = (c || "").toLowerCase(); return /scotch/.test(c) ? "scotch" : /irish/.test(c) ? "irish" : /bourbon|tennessee|rye|american/.test(c) ? "american" : "other"; }
  function price(p) { var n = parseFloat(String(p || "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : Infinity; }
  function shortName(n) { return String(n || "").replace(/,\s*[\d.]+%\s*$/, ""); }
  function href(id) { return "club.html#" + encodeURIComponent(id); }
  function img(src, w) { return /^\/(api|wa)\//.test(src) ? "/_next/image?url=" + encodeURIComponent(src) + "&w=" + w + "&q=75" : src; }
  var GROUPS = [["", "All"], ["scotch", "Scotch"], ["irish", "Irish"], ["american", "American"]];
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (id) { return document.getElementById(id); };
  var state = { g: "", s: 0, sort: "score" };
  var onFilter = function () {};

  function hero(N) {
    $("intro").textContent = N.intro || "";
    $("ninetyKicker").innerHTML = WA.sponsorChip() + "Partner program · Pernod Ricard USA";
    var M = N.members, scores = M.map(function (m) { return m.s; }), prices = M.map(function (m) { return price(m.p); }).filter(isFinite);
    var top = M.slice().sort(function (a, b) { return b.s - a.s; })[0];
    var hi = Math.max.apply(null, scores), lo = Math.min.apply(null, scores);
    $("n9Stats").innerHTML = [
      ["Members", M.length],
      ["Scores", lo + "–" + hi],
      ["Top score", hi, shortName(top.n).replace(/\s*\(.*?\)/, "")],
      ["From", "$" + Math.min.apply(null, prices)]
    ].map(function (s) { return "<div><dt>" + s[0] + "</dt><dd>" + esc(s[1]) + (s[2] ? "<small>" + esc(s[2]) + "</small>" : "") + "</dd></div>"; }).join("");

    // The shelf: every member standing in its score's step, lowest score on the left.
    var steps = {};
    M.forEach(function (m) { (steps[m.s] = steps[m.s] || []).push(m); });
    var keys = Object.keys(steps).map(Number).sort(function (a, b) { return a - b; }), i = 0;
    var shelf = $("n9Shelf");
    shelf.innerHTML = keys.map(function (k) {
      var list = steps[k].sort(function (a, b) { return price(a.p) - price(b.p); });
      return '<div class="n9-step" role="listitem" style="--n:' + list.length + '"><span class="n9-num" aria-hidden="true">' + k + '</span><div class="n9-row">' + list.map(function (m) {
        return '<a class="n9-bottle" href="' + href(m.id) + '" style="--i:' + (i++) + '" data-name="' + esc(shortName(m.n)) + '" data-meta="' + esc(m.s + " points · " + m.p) + '" aria-label="' + esc(shortName(m.n) + ", " + m.s + " points, " + m.p) + '"><img src="' + esc(img(m.img, 256)) + '" alt="" decoding="async"></a>';
      }).join("") + '</div><button type="button" class="n9-score" data-s="' + k + '" aria-label="Show the ' + list.length + " bottle" + (list.length > 1 ? "s" : "") + " that scored " + k + '"><b>' + k + "</b><span>" + list.length + "</span></button></div>";
    }).join("");
    requestAnimationFrame(function () { shelf.classList.add("in"); });

    var tip = $("n9Tip"), hero = shelf.parentNode;
    function show(a) {
      if (!a) { tip.classList.remove("on"); hero.classList.remove("hovering"); return; }
      tip.innerHTML = "<strong>" + a.getAttribute("data-name") + "</strong><span>" + a.getAttribute("data-meta") + "</span>";
      var hb = hero.getBoundingClientRect(), ab = a.getBoundingClientRect(), w = tip.offsetWidth;
      var x = Math.max(12, Math.min(hb.width - w - 12, ab.left - hb.left + ab.width / 2 - w / 2));
      tip.style.transform = "translate(" + x + "px," + (ab.top - hb.top - tip.offsetHeight + 8) + "px)";
      tip.classList.add("on"); hero.classList.add("hovering");
      [].forEach.call(shelf.querySelectorAll(".n9-bottle.lit"), function (b) { b.classList.remove("lit"); }); a.classList.add("lit");
    }
    shelf.addEventListener("pointerover", function (e) { var a = e.target.closest(".n9-bottle"); if (a) show(a); });
    shelf.addEventListener("pointerleave", function () { show(null); [].forEach.call(shelf.querySelectorAll(".lit"), function (b) { b.classList.remove("lit"); }); });
    shelf.addEventListener("focusin", function (e) { var a = e.target.closest(".n9-bottle"); show(a); });
    shelf.addEventListener("focusout", function () { show(null); });
    shelf.addEventListener("click", function (e) {
      var b = e.target.closest(".n9-score"); if (!b) return;
      state.s = +b.getAttribute("data-s"); state.g = ""; onFilter();
      $("members").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    });
    // A warm light that follows the pointer across the panel.
    if (!reduce) hero.addEventListener("pointermove", function (e) { var r = hero.getBoundingClientRect(); hero.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%"); hero.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%"); });

    if (N.video) {
      var film = $("film");
      film.innerHTML = '<button type="button" class="top20-play" data-embed="' + esc(N.video.embed) + '" aria-label="Play ' + esc(N.video.title) + '"><img src="' + esc(N.video.poster) + '" alt="" loading="lazy"><span class="play"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span></button>';
      $("filmTitle").textContent = N.video.title;
      $("n9Film").hidden = false; $("n9Watch").hidden = false;
      if (WA.watchPosters) WA.watchPosters(film);
      film.addEventListener("click", function (e) { var f = e.target.closest(".top20-play"); if (f && !f.classList.contains("playing")) WA.playEmbed(f); });
      $("n9Watch").addEventListener("click", function (e) {
        e.preventDefault();
        $("n9Film").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        var f = film.querySelector(".top20-play"); if (f) setTimeout(function () { WA.playEmbed(f); }, reduce ? 0 : 500);
      });
    }
  }

  function members(N, DATA) {
    // The site's own rating cards (our bottle picture, score, note, Buy where the store has it).
    var list = N.members.map(function (m) { return { m: m, r: DATA ? WA.find(DATA, m.slug) : null }; });
    var present = {}; list.forEach(function (x) { present[group(x.m.c)] = true; });
    function card(x) {
      if (x.r) return WA.bottleCard(x.r);
      var m = x.m;
      return '<article class="bottle has-img"><a class="thumb" href="' + href(m.id) + '"><img src="' + esc(img(m.img, 384)) + '" alt=""></a><div class="top"><div class="score score-type">' + m.s + '<small>points</small></div><div class="cat">' + esc(m.c) + '</div></div><div><h3><a href="' + href(m.id) + '">' + esc(m.n) + '</a></h3></div><div class="foot"><span>' + esc(m.p) + "</span></div></article>";
    }
    function render() {
      var show = list.filter(function (x) { return (!state.g || group(x.m.c) === state.g) && (!state.s || x.m.s === state.s); });
      show.sort(state.sort === "price" ? function (a, b) { return price(a.m.p) - price(b.m.p); } : state.sort === "name" ? function (a, b) { return a.m.n.localeCompare(b.m.n); } : function (a, b) { return b.m.s - a.m.s || price(a.m.p) - price(b.m.p); });
      $("memberGrid").innerHTML = show.map(card).join("");
      var label = state.s ? ", " + state.s + " points" : state.g ? ", " + GROUPS.filter(function (g) { return g[0] === state.g; })[0][1] : "";
      $("membersTitle").textContent = show.length + " bottle" + (show.length === 1 ? "" : "s") + " that scored 90 or higher" + label + ".";
      $("groups").innerHTML = GROUPS.filter(function (g) { return !g[0] || present[g[0]]; }).map(function (g) { return '<button type="button" data-g="' + g[0] + '" aria-pressed="' + (!state.s && g[0] === state.g) + '">' + g[1] + "</button>"; }).join("")
        + (state.s ? '<button type="button" data-g="" class="n9-chip" aria-pressed="true">' + state.s + ' points <span aria-hidden="true">×</span></button>' : "");
      // Every card opens the bottle's 90+ Club page (the club's own page for it, as on the old site).
      document.querySelectorAll("#memberGrid article").forEach(function (a, i) { var x = show[i]; if (!x) return; a.querySelectorAll('a[href^="bottle.html"], a.thumb').forEach(function (l) { l.href = href(x.m.id); }); });
      [].forEach.call(document.querySelectorAll("#n9Shelf .n9-score"), function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-s") === state.s)); });
      if (WA.decorateBuy) WA.decorateBuy($("memberGrid"));
      if (WA.fillNotes) WA.fillNotes($("memberGrid"));
    }
    onFilter = render;
    $("groups").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.g = b.getAttribute("data-g"); state.s = 0; render(); });
    $("n9Sort").addEventListener("change", function () { state.sort = this.value; render(); });
    WA.stickyFilters($("memberBar"));
    render();
  }

  function stories(N) {
    // The club's stories, from the story index (labeled Sponsored like every paid story).
    WA.stories(function () {
      N.stories.forEach(function (slug, order) { WA.storyBySlug(slug, function (st) {
        if (!st) return;
        var el = document.createElement("div");
        el.innerHTML = '<a class="pick-card" href="' + WA.storyHref(st) + '">' + (st.hero ? '<img src="' + st.hero + '" alt="" loading="lazy">' : "") + '<span class="tag">' + (WA.SECTION[st.sec] || "") + " · " + WA.when(st.d) + "</span><h3>" + st.title + '</h3><p class="why">' + (st.dek || "") + "</p></a>";
        var grid = $("storyGrid"), node = el.firstChild; node.setAttribute("data-order", order);
        var after = [].filter.call(grid.children, function (c) { return +c.getAttribute("data-order") > order; })[0];
        grid.insertBefore(node, after || null);
      }); });
    });
  }

  function spirits(N) {
    // Top-shelf spirits: not rated by Whisky Advocate, so no score.
    $("spiritsIntro").textContent = N.spiritsIntro || "";
    $("spiritGrid").innerHTML = N.spirits.map(function (s) { var name = s.n.replace(/,\s*[\d.]+\s*[%$]\s*$/, ""); return '<a class="spirit-card" href="' + href(s.id) + '"><span class="pic"><img src="' + esc(s.img) + '" alt="" loading="lazy"></span><span class="tag">' + esc(s.c) + (s.p ? " · " + esc(s.p) : "") + "</span><strong>" + esc(name) + "</strong></a>"; }).join("");
  }

  WA.ready(function () {
    fetch("ninety.json").then(function (r) { return r.json(); }).then(function (N) {
      hero(N); spirits(N); stories(N);
      WA.archive(function (DATA) { members(N, DATA); });
      document.title = "90+ Club · Whisky Advocate";
      if (WA.setContext) WA.setContext({ kind: "page", title: "the 90+ Club" });
    });
  });
})();
