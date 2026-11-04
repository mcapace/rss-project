/* One 90+ Club bottle (club.html#<id>): the partner page the old site had for each member and spirit, rebuilt.
   Sponsored template: the item, its note, Buy where the store has it, and only other club items; no other recommendations.
   The bottle stands on a dark stage under its score; Previous and Next walk the club in score order without a reload. */
(function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function plain(n) { return String(n || "").replace(/,\s*[\d.]+\s*[%$]\s*$/, ""); }
  function abv(n) { var m = String(n || "").match(/([\d.]+)\s*%\s*$/); return m ? m[1] + "%" : ""; }
  function price(p) { var n = parseFloat(String(p || "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : Infinity; }
  function img(src, w) { return /^\/(api|wa)\//.test(src) ? "/_next/image?url=" + encodeURIComponent(src) + "&w=" + w + "&q=75" : src; }
  function href(x) { return "club.html#" + encodeURIComponent(x.id); }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  var $ = function (id) { return document.getElementById(id); };
  // The pictures carry uneven transparent margins: measure the bottle's own rows so it is sized by itself and stands on the plinth.
  function seat(im) {
    var top = 0, bottom = 1;
    try {
      var h = 160, w = Math.max(1, Math.round(h * im.naturalWidth / im.naturalHeight)), c = document.createElement("canvas"); c.width = w; c.height = h;
      var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data, rows = [];
      for (var y = 0; y < h; y++) { var on = false; for (var i = 0; i < w && !on; i++) on = d[(y * w + i) * 4 + 3] > 24; rows.push(on); }
      var a = rows.indexOf(true), b = rows.lastIndexOf(true);
      if (a >= 0) { top = a / h; bottom = (b + 1) / h; }
    } catch (e) {}
    var span = Math.max(0.2, bottom - top);
    im.style.setProperty("--span", span.toFixed(3)); im.style.setProperty("--foot", (1 - bottom).toFixed(3));
    im.classList.add("seated");
  }
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  WA.ready(function () { WA.archive(function (DATA) {
    fetch("ninety.json").then(function (r) { return r.json(); }).then(function (N) {
      var members = N.members.map(function (m) { return Object.assign({ member: true }, m); }).sort(function (a, b) { return b.s - a.s || price(a.p) - price(b.p); });
      var all = members.concat(N.spirits.map(function (s) { return Object.assign({ member: false }, s); }));

      function rank(it) {
        var above = members.filter(function (m) { return m.s > it.s; }).length, tied = members.filter(function (m) { return m.s === it.s; }).length;
        if (!above) return tied > 1 ? "Ties for the top score in the club" : "The highest score in the club";
        return (tied > 1 ? "Ties for " : "") + ordinal(above + 1) + " of " + members.length + " in the club";
      }

      function render(first) {
        var want = decodeURIComponent((location.hash || "").slice(1)).toLowerCase();
        var i = -1;
        all.some(function (x, j) { if ((x.id || "").toLowerCase() === want || (x.slug || "").toLowerCase() === want) { i = j; return true; } });
        if (i < 0) { location.replace("ninety.html"); return; }
        var it = all[i], r = it.slug ? WA.find(DATA, it.slug) : null, name = plain(it.n);
        document.title = name + " · 90+ Club · Whisky Advocate";
        $("crumbName").textContent = name;
        var stage = $("clStage");
        stage.classList.remove("in"); stage.classList.toggle("is-spirit", !it.member);
        var pic = $("pic"); pic.alt = name; pic.src = img(it.img, 640);
        $("bigNum").textContent = it.member ? it.s : (it.c || "");
        $("kicker").innerHTML = WA.sponsorChip() + "90+ Club · " + esc(it.member ? "Member" : "Top-shelf spirit") + " · Pernod Ricard USA";
        $("name").textContent = name;
        var sc = $("score");
        if (it.s) { sc.innerHTML = '<b class="score-type">' + esc(it.s) + '</b><span>points<small>' + esc(rank(it)) + "</small></span>"; sc.hidden = false; }
        else { sc.hidden = true; sc.innerHTML = ""; }
        var facts = [];
        if (it.p) facts.push(["Price", it.p]);
        if (abv(it.n)) facts.push(["ABV", abv(it.n)]);
        if (it.c) facts.push(["Style", it.c]);
        if (it.issue) facts.push(["Rated", it.issue]);
        $("facts").innerHTML = facts.map(function (f) { return "<div><dt>" + f[0] + "</dt><dd>" + esc(f[1]) + "</dd></div>"; }).join("");
        var note = it.desc || (r && r.t) || "";
        $("note").textContent = note; $("noteWrap").hidden = !note;
        $("noteBy").textContent = it.reviewer ? "Tasting note by " + it.reviewer + (it.issue ? ", " + it.issue : "") : it.member ? "" : "From the producer";
        if (!it.desc && r && WA.note) WA.note(r.slug, function (t) { if (t && all[i] === it) { $("note").textContent = t; $("noteWrap").hidden = false; } });
        var actions = $("actions");
        actions.innerHTML = r ? '<a class="pill n9-ghost" href="' + WA.bottleHref(r) + '">The full rating</a>' : "";
        WA.shop(function () { var p = it.slug ? WA.productFor(it.slug) : null; if (p && all[i] === it) actions.insertAdjacentHTML("afterbegin", '<a class="pill amber" href="' + WA.buyHref(p) + '" target="_blank" rel="noopener">Buy at the store' + (p.p ? " · $" + Math.round(p.p) : "") + "</a>"); });
        var prev = all[(i - 1 + all.length) % all.length], next = all[(i + 1) % all.length];
        $("prev").href = href(prev); $("prev").innerHTML = '<span aria-hidden="true">←</span><span class="cl-arrow-name">' + esc(plain(prev.n)) + '</span>'; $("prev").setAttribute("aria-label", "Previous: " + plain(prev.n));
        $("next").href = href(next); $("next").innerHTML = '<span class="cl-arrow-name">' + esc(plain(next.n)) + '</span><span aria-hidden="true">→</span>'; $("next").setAttribute("aria-label", "Next: " + plain(next.n));
        $("pos").textContent = (it.member ? "Member " + (i + 1) + " of " + members.length : "Spirit " + (i - members.length + 1) + " of " + (all.length - members.length));
        $("more").innerHTML = all.filter(function (x) { return x !== it; }).map(function (x) {
          return '<a class="spirit-card" href="' + href(x) + '"><span class="pic"><img src="' + esc(img(x.img, 384)) + '" alt="" loading="lazy"></span><span class="tag">' + (x.s ? '<b class="score-type">' + esc(x.s) + "</b> · " : "") + esc(x.c) + (x.p ? " · " + esc(x.p) : "") + "</span><strong>" + esc(plain(x.n)) + "</strong></a>";
        }).join("");
        [prev, next].forEach(function (x) { var im = new Image(); im.src = img(x.img, 640); });
        if (!first) window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        if (WA.track && !first) WA.track("club_view", { id: it.id });
        pic.classList.remove("seated");
        var show = function () { if (pic.naturalWidth) seat(pic); requestAnimationFrame(function () { stage.classList.add("in"); }); };
        if (pic.complete && pic.naturalWidth) show(); else { pic.onload = pic.onerror = show; }
      }

      addEventListener("hashchange", function () { render(false); });
      addEventListener("keydown", function (e) {
        if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || /input|textarea|select/i.test((e.target.tagName || ""))) return;
        if (e.key === "ArrowLeft") $("prev").click(); else if (e.key === "ArrowRight") $("next").click();
      });
      render(true);
    });
  }); });
})();
