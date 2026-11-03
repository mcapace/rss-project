/* Live Whisky Advocate Google Publisher Tags, placed in the concept site's ad placeholders.
   Homepage uses /4054/whiskyadvocate/homepage. Every other page uses /4054/whiskyadvocate. */
(function () {
  var holders = Array.prototype.slice.call(document.querySelectorAll(".ad[data-slot]"));
  if (!holders.length) return;

  /* New house ads on this site only (2026-11-03). When Ad Manager answers a slot with one of the company's
     house orders, or leaves it empty, the slot shows one of the HTML5 house ads in house-ads/ instead
     (built by scripts/house-ads/build.mjs). Paid line items are left alone, and nothing changes in Ad Manager.
     A house reply keeps the size Ad Manager chose; an empty slot takes the largest house size its size
     mapping allows at this width. Each slot on a page shows a different campaign; WhiskyFest leads until
     the night itself and drops out after it. */
  var house = (function () {
    var HOUSE_ORDERS = { "190702776": 1, "2520850047": 1, "2120544666": 1, "190772856": 1, "169230336": 1 };   // WA, WS, CA, Market Watch, SND house orders
    var SIZES = { "970x250": 1, "300x600": 1, "300x250": 1, "970x90": 1, "728x90": 1, "468x60": 1, "320x50": 1 };
    var base = (document.currentScript && document.currentScript.src) ? new URL("house-ads/", document.currentScript.src).href : "/wa/house-ads/";
    var day = new Date().toISOString().slice(0, 10);
    var order = ["notes", "subscribe", "weekend", "cocktails", "podcast", "ratingsflash"];
    if (day <= "2026-11-20") order.unshift("whiskyfest");
    var start = Math.floor(Math.random() * order.length), n = 0;
    var MAPS = {
      top: [[1024, ["970x250", "970x90"]], [768, ["728x90", "468x60"]], [0, ["320x50"]]],
      leader: [[1024, ["970x90"]], [768, ["728x90", "468x60"]], [0, ["320x50"]]],
      leaderRect: [[1024, ["970x90"]], [768, ["728x90", "468x60"]], [0, ["300x250"]]],
      rail: [[1024, ["300x600", "300x250"]], [0, ["300x250"]]]
    };
    function fit(map, room) {
      var w = innerWidth, rows = MAPS[map] || MAPS.top;
      for (var i = 0; i < rows.length; i++) if (w >= rows[i][0]) {
        var pick = rows[i][1].filter(function (s) { return +s.split("x")[0] <= room; })[0];
        return pick || null;
      }
      return null;
    }
    function take(event, box, holder) {
      var old = holder.querySelector("iframe.house-ad");
      if (old) old.parentNode.removeChild(old);
      box.style.display = "";
      var isHouse = !event.isEmpty && HOUSE_ORDERS[String(event.campaignId)];
      if (!isHouse && !event.isEmpty) return false;
      var spec = holder._spec || slots.filter(function (s) { return s.el === holder; })[0];
      var size = isHouse && event.size && SIZES[event.size[0] + "x" + event.size[1]] ? event.size[0] + "x" + event.size[1] : fit(spec && spec.map, (holder.parentElement || holder).clientWidth || innerWidth);
      if (!size) return false;
      var wh = size.split("x"), campaign = order[(start + n++) % order.length];
      var frame = document.createElement("iframe");
      frame.className = "house-ad";
      frame.src = base + campaign + "/" + size + "/index.html";
      frame.width = wh[0]; frame.height = wh[1];
      frame.title = "Advertisement";
      frame.setAttribute("scrolling", "no");
      frame.setAttribute("loading", "lazy");
      frame.style.cssText = "border:0;display:block;width:" + wh[0] + "px;height:" + wh[1] + "px;max-width:100%";
      box.style.display = "none";
      holder.appendChild(frame);
      holder.classList.remove("ad-empty");
      holder.classList.add("ad-filled", "ad-house");
      holder.setAttribute("data-house", campaign);
      return true;
    }
    return { take: take };
  })();

  var home = /\/wa\/?$/.test(location.pathname) || /\/index\.html$/.test(location.pathname);
  var path = home ? "/4054/whiskyadvocate/homepage" : "/4054/whiskyadvocate";
  var used = {};
  var slots = holders.map(function (el) {
    var hint = el.querySelector("i");
    var mobileRect = hint && /300/.test(hint.textContent);
    var spec;
    if (el.classList.contains("ad-above")) {
      spec = { id: "div-id-for-above", pos: "top", map: "top", sizes: [[970, 250], [970, 90], [728, 90], [468, 60], [320, 50]] };
    } else if (el.classList.contains("ad-mrec")) {
      spec = { id: "div-id-for-midrectangle1", pos: "mid1", map: "rail", sizes: [[300, 600], [300, 250]] };
    } else if (el.classList.contains("ad-leader")) {
      spec = mobileRect
        ? { id: "div-id-for-midleaderboard1", pos: "mid1", map: "leaderRect", sizes: [[970, 90], [728, 90], [468, 60], [320, 50], [300, 250]] }
        : { id: "div-id-for-midleaderboard1", pos: "mid1", map: "leader", sizes: [[970, 90], [728, 90], [468, 60], [320, 50]] };
    } else {
      spec = { id: "div-id-for-top", pos: "top", map: "top", sizes: [[970, 250], [970, 90], [728, 90], [468, 60], [320, 50]] };
    }
    if (used[spec.id]) return null;
    used[spec.id] = true;
    if (hint) hint.hidden = true;
    var box = document.createElement("div");
    box.id = spec.id;
    el.appendChild(box);
    spec.el = el;
    return spec;
  }).filter(Boolean);
  if (!slots.length) return;

  window.googletag = window.googletag || { cmd: [] };
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
  document.head.appendChild(script);

  function mapping(kind) {
    var builder = googletag.sizeMapping();
    if (kind === "top") {
      return builder.addSize([1024, 0], [[970, 250], [970, 90]]).addSize([768, 0], [[728, 90], [468, 60]]).addSize([330, 0], [320, 50]).build();
    }
    if (kind === "leader") {
      return builder.addSize([1024, 0], [970, 90]).addSize([768, 0], [[728, 90], [468, 60]]).addSize([330, 0], [320, 50]).build();
    }
    if (kind === "leaderRect") {
      return builder.addSize([1024, 0], [970, 90]).addSize([768, 0], [[728, 90], [468, 60]]).addSize([330, 0], [300, 250]).build();
    }
    return builder.addSize([1024, 0], [[300, 600], [300, 250]]).addSize([768, 0], [300, 250]).addSize([330, 0], [300, 250]).build();
  }

  /* Sponsored pages (2026-11-01): page-level key-values so Ad Manager can keep competing brands off paid content.
     sponsored = "yes" | "no" on every page; sponsor = the advertiser (lowercase, hyphenated) when the CMS names one.
     A story is sponsored when it is in sponsored.json (the story export's list, the same rule as the site's labels);
     the 90+ Club page is Pernod Ricard USA's partner page. Ads wait for the answer, at most 1.5 seconds, so the first request carries it. */
  function slugify(t) { return String(t || "").replace(/['\u2019]/g, "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  function pageContext(cb) {
    var page = (location.pathname.split("/").pop() || "index.html").toLowerCase(), done = false;
    function finish(ctx) { if (done) return; done = true; window.WAAds = window.WAAds || {}; window.WAAds.context = ctx; cb(ctx); }
    if (page === "ninety.html" || page === "club.html") return finish({ sponsored: "yes", sponsor: "pernod-ricard-usa" });   // every 90+ Club member brand is Pernod Ricard USA's
    if (page !== "story.html") return finish({ sponsored: "no" });
    var slug = "";
    try { slug = decodeURIComponent((location.hash || "").slice(1)).toLowerCase(); } catch (e) { slug = (location.hash || "").slice(1).toLowerCase(); }
    if (!slug) return finish({ sponsored: "no" });
    setTimeout(function () { finish({ sponsored: "no" }); }, 1500);
    fetch("sponsored.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var hit = (list || []).filter(function (x) { return String(x.slug || "").toLowerCase() === slug; })[0];
      finish(hit ? (hit.by ? { sponsored: "yes", sponsor: slugify(hit.by) } : { sponsored: "yes" }) : { sponsored: "no" });
    }).catch(function () { finish({ sponsored: "no" }); });
  }
  var ready = false, pending = [];
  function whenReady(fn) { if (ready) googletag.cmd.push(fn); else pending.push(fn); }

  pageContext(function (ctx) { googletag.cmd.push(function () {
    slots.forEach(function (slot) {
      googletag.defineSlot(path, slot.sizes, slot.id).defineSizeMapping(mapping(slot.map)).addService(googletag.pubads()).setTargeting("pos", slot.pos);
    });
    if (home) googletag.pubads().setTargeting("s1", "homepage");
    googletag.pubads().setTargeting("sponsored", ctx.sponsored);
    if (ctx.sponsor) googletag.pubads().setTargeting("sponsor", ctx.sponsor);
    googletag.pubads().setTargeting("test", "");
    googletag.pubads().enableSingleRequest();
    googletag.pubads().collapseEmptyDivs();
    googletag.pubads().addEventListener("slotRenderEnded", function (event) {
      var box = document.getElementById(event.slot.getSlotElementId());
      var holder = box && box.parentElement;
      if (!holder || !holder.classList.contains("ad")) return;
      var size = event.size;
      if (house.take(event, box, holder)) return;
      if (event.isEmpty || !size || size[0] === 0 || size[1] === 0) {
        holder.classList.add("ad-empty");
        return;
      }
      holder.classList.add("ad-filled");
      box.style.width = size[0] + "px";
      box.style.height = size[1] + "px";
      box.style.overflow = "hidden";
    });
    googletag.enableServices();
    slots.forEach(function (slot) { googletag.display(slot.id); });
    ready = true; pending.splice(0).forEach(function (fn) { googletag.cmd.push(fn); });
  }); });

  /* Interstitial leaderboards between batches of a list (2026-11-01). A list page calls
     WAAds.seat(container, every, name) after it renders: one leaderboard is seated after every
     `every` items that have more items below them, so each "More" reveals another slot. Each holder
     gets its own GPT slot (div-id-for-midleaderboard2, 3, ... with pos mid2, mid3, ...), defined once;
     re-rendering a list rebuilds its nodes, so a holder that is seated again is refreshed. */
  var extras = {}, extraN = 2;
  function makeHolder(name, n) {
    var el = document.createElement("div");
    el.className = "ad ad-leader ad-inline";
    el.setAttribute("data-slot", "wa_" + name + "_leader_" + n);
    el.setAttribute("aria-label", "Advertisement");
    el.innerHTML = "<span>Advertisement</span><i>728 × 90 leaderboard · 320 × 50 mobile</i>";
    return el;
  }
  function defineExtra(holder) {
    var n = extraN++;
    var spec = { id: "div-id-for-midleaderboard" + n, pos: "mid" + n, map: "leader", sizes: [[970, 90], [728, 90], [468, 60], [320, 50]], el: holder };
    var box = document.createElement("div");
    box.id = spec.id;
    holder.appendChild(box);
    holder._spec = spec;
    whenReady(function () {
      spec.slot = googletag.defineSlot(path, spec.sizes, spec.id).defineSizeMapping(mapping(spec.map)).addService(googletag.pubads()).setTargeting("pos", spec.pos);
      googletag.display(spec.id);
    });
  }
  function refreshExtra(holder) {
    whenReady(function () { if (holder._spec.slot) googletag.pubads().refresh([holder._spec.slot]); });
  }
  /* A grid's slot lands after whole rows: the cadence is rounded up to a multiple of the column count, so a five-column
     grid gets a leaderboard every 15 cards, never two cards into a row. When a resize changes the column count the
     lists are seated again. */
  var seated = {};
  function columnsOf(container) {
    var cs = getComputedStyle(container);
    if (cs.display !== "grid") return 1;
    var tracks = cs.gridTemplateColumns.split(" ").filter(function (t) { return t && t !== "0px"; });
    return Math.max(1, tracks.length);
  }
  var resizeTimer;
  addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      Object.keys(seated).forEach(function (name) { var s = seated[name]; if (document.contains(s.container) && columnsOf(s.container) !== s.cols) WAAds.seat(s.container, s.every, name); });
    }, 200);
  });
  window.WAAds = {
    context: window.WAAds && window.WAAds.context,
    seat: function (container, every, name) {
      if (!container || !every) return;
      var cols = columnsOf(container);
      seated[name] = { container: container, every: every, cols: cols };
      every = Math.ceil(every / cols) * cols;
      var pool = extras[name] || (extras[name] = []);
      pool.forEach(function (h) { if (h.parentNode) h.parentNode.removeChild(h); });
      Array.prototype.slice.call(container.querySelectorAll(".ad.ad-inline")).forEach(function (el) { if (pool.indexOf(el) < 0) el.parentNode.removeChild(el); });
      var items = Array.prototype.filter.call(container.children, function (c) { return !c.classList.contains("ad"); });
      var k = 0;
      for (var i = every; i < items.length; i += every, k++) {
        var h = pool[k];
        if (!h) { h = makeHolder(name, k + 2); pool.push(h); }
        container.insertBefore(h, items[i]);
        if (h._spec) refreshExtra(h); else defineExtra(h);
      }
    }
  };
})();
