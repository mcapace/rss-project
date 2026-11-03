/* Google Publisher Tags for the NEW Whisky Advocate site (dev), placed in the concept site's ad placeholders.
   2026-11-03: moved off the legacy units (/4054/whiskyadvocate, /4054/whiskyadvocate/homepage) onto the new-site
   tree in Ad Manager, so nothing on the legacy site changes. Each page calls its section unit:
     /4054/whiskyadvocate.new/<section>   (parent "WA New Site", ad unit id 23389499996)
   Position inside the page stays on the pos key-value (top, mid1, mid2, ...), exactly as before. */
(function () {
  var holders = Array.prototype.slice.call(document.querySelectorAll(".ad[data-slot]"));
  if (!holders.length) return;
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;   // ads.js's own URL: sibling files resolve from it on clean URLs

  /* Size rules (2026-11-03). This one table decides what can serve where. Devices go by window width:
       desktop = 1024px and wider · tablet = 768 to 1023px · phone = under 768px.
     Each slot asks Ad Manager for exactly ONE size: the first size in its list that fits the slot's own box
     (a desktop window can still hold a column narrower than 970px). So a desktop page never gets a small banner,
     and no slot gets an ad wider than itself. 468x60 is retired. A slot with no size that fits is left out. */
  var RULES = {
    billboard:  { desktop: ["970x250", "728x90"], tablet: ["728x90"],            phone: ["320x50"] },    // above the nav on every page, homepage billboard
    leader:     { desktop: ["970x90", "728x90"],  tablet: ["728x90", "300x250"], phone: ["320x50"] },    // in-page and in-list leaderboards
    leaderRect: { desktop: ["970x90", "728x90"],  tablet: ["728x90", "300x250"], phone: ["300x250"] },   // story and bottle leaderboard: a rectangle on phones
    rail:       { desktop: ["300x600"],           tablet: ["300x250"],           phone: ["300x250"] },   // side rectangle (finder)
    flip:       { desktop: ["300x600"],           tablet: [],                    phone: [] }             // homepage right-column flip card: desktop only
  };
  function device() { var w = window.innerWidth || document.documentElement.clientWidth; return w >= 1024 ? "desktop" : w >= 768 ? "tablet" : "phone"; }
  function roomFor(el) {
    var p = (el && el.parentElement) || document.body, cs = getComputedStyle(p);
    var r = p.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return Math.min(r > 0 ? r : innerWidth, innerWidth);
  }
  function sizeFor(kind, el) {
    var list = (RULES[kind] || RULES.leader)[device()] || [], room = roomFor(el);
    for (var i = 0; i < list.length; i++) if (+list[i].split("x")[0] <= room) return list[i];
    return null;
  }
  function dims(size) { var p = size.split("x"); return [+p[0], +p[1]]; }

  /* Empty slots collapse (2026-11-03): no on-site house-ad fallback, so every impression shown is one Ad Manager served and counted. */

  var home = /\/wa\/?$/.test(location.pathname) || /\/index\.html$/.test(location.pathname);
  /* Page -> section ad unit. Any page not listed (about, contact, privacy, newsletter, app, tools, globe, ...) uses "general". */
  var NEW_SITE = "/4054/whiskyadvocate.new";
  var SECTIONS = {
    "index.html": "homepage",
    "stories.html": "stories", "story.html": "stories",
    "finder.html": "ratings", "bottle.html": "ratings", "shelf.html": "ratings", "flavor-map.html": "ratings",
    "top20.html": "top20",
    "cocktails.html": "cocktails",
    "guides.html": "guides",
    "travel.html": "travel",
    "video.html": "video",
    "producers.html": "producers", "retailers.html": "producers", "retailer-club.html": "producers", "industry.html": "producers",
    "cocktail.html": "cocktails", "producer.html": "producers",
    "ninety.html": "club", "club.html": "club"
  };
  var pageFile = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  /* The same templates are also served at clean URLs (src/app/wa): /wa/<slug> is a story, or a bottle (body.rating-page);
     /wa/recipes/<slug> is a recipe; /wa/producers/<name> is a producer page. */
  var clean = location.pathname.match(/^\/wa\/(?:(recipes|producers)\/)?([^\/.]+)\/?$/);
  var cleanSection = clean ? (clean[1] === "recipes" ? "cocktails" : clean[1] === "producers" ? "producers" : document.body.classList.contains("rating-page") ? "ratings" : "stories") : null;
  var section = home ? "homepage" : (SECTIONS[pageFile] || cleanSection || "general");
  var path = NEW_SITE + "/" + section;
  var used = {};
  var slots = holders.map(function (el) {
    var hint = el.querySelector("i");
    var mobileRect = hint && /300/.test(hint.textContent);
    var spec;
    if (el.classList.contains("ad-above")) {
      spec = { id: "div-id-for-above", pos: "top", kind: "billboard" };
    } else if (el.classList.contains("ad-mrec")) {
      spec = { id: "div-id-for-midrectangle1", pos: "mid1", kind: "rail" };
    } else if (el.classList.contains("ad-leader")) {
      spec = { id: "div-id-for-midleaderboard1", pos: "mid1", kind: mobileRect ? "leaderRect" : "leader" };
    } else {
      spec = { id: "div-id-for-top", pos: "top", kind: "billboard" };
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

  /* Define a slot at the one size its rule allows here, or leave it out (and hide its holder) when nothing fits. */
  function defineAt(spec) {
    spec.size = sizeFor(spec.kind, spec.el);
    if (!spec.size) { spec.el.classList.add("ad-empty", "ad-none"); return null; }
    spec.slot = googletag.defineSlot(path, [dims(spec.size)], spec.id);
    if (!spec.slot) return null;
    spec.slot.addService(googletag.pubads()).setTargeting("pos", spec.pos);
    spec.el.setAttribute("data-size", spec.size);
    return spec.slot;
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
    var cleanStory = clean && !clean[1] && cleanSection === "stories";
    if (page !== "story.html" && !cleanStory) return finish({ sponsored: "no" });
    var raw = cleanStory ? clean[2] : (location.hash || "").slice(1), slug = "";
    try { slug = decodeURIComponent(raw).toLowerCase(); } catch (e) { slug = raw.toLowerCase(); }
    if (!slug) return finish({ sponsored: "no" });
    setTimeout(function () { finish({ sponsored: "no" }); }, 1500);
    // The exported list, plus the paid stories published from the CMS since the export (/api/wa/latest, cached a minute).
    var listed = function (url, pick) { return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(pick, function () { return []; }); };
    Promise.all([
      listed(new URL("sponsored.json", SCRIPT_SRC).href, function (d) { return d || []; }),
      listed(new URL("/api/wa/latest", SCRIPT_SRC).href, function (d) { return (d && d.sponsored) || []; })
    ]).then(function (lists) {
      var list = lists[1].concat(lists[0]);
      var hit = list.filter(function (x) { return String(x.slug || "").toLowerCase() === slug; })[0];
      finish(hit ? (hit.by ? { sponsored: "yes", sponsor: slugify(hit.by) } : { sponsored: "yes" }) : { sponsored: "no" });
    }).catch(function () { finish({ sponsored: "no" }); });
  }
  var ready = false, pending = [];
  function whenReady(fn) { if (ready) googletag.cmd.push(fn); else pending.push(fn); }

  pageContext(function (ctx) { googletag.cmd.push(function () {
    slots.forEach(defineAt);
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
    slots.forEach(function (slot) { if (slot.slot) googletag.display(slot.id); });
    ready = true; pending.splice(0).forEach(function (fn) { googletag.cmd.push(fn); });
  }); });

  /* Interstitial leaderboards between batches of a list (2026-11-01). A list page calls
     WAAds.seat(container, every, name) after it renders: one leaderboard is seated after every
     "every" items that have more items below them, so each "More" reveals another slot. Each holder
     gets its own GPT slot (div-id-for-midleaderboard2, 3, ... with pos mid2, mid3, ...), defined once;
     re-rendering a list rebuilds its nodes, so a holder that is seated again is refreshed. */
  var extras = {}, extraN = 2;
  function makeHolder(name, n) {
    var el = document.createElement("div");
    el.className = "ad ad-leader ad-inline";
    el.setAttribute("data-slot", "wa_" + name + "_leader_" + n);
    el.setAttribute("aria-label", "Advertisement");
    el.innerHTML = "<span>Advertisement</span><i>970 × 90 desktop · 728 × 90 tablet · 320 × 50 phone</i>";
    return el;
  }
  function defineExtra(holder) {
    var n = extraN++;
    var spec = { id: "div-id-for-midleaderboard" + n, pos: "mid" + n, kind: "leader", el: holder };
    var box = document.createElement("div");
    box.id = spec.id;
    holder.appendChild(box);
    holder._spec = spec;
    whenReady(function () {
      if (defineAt(spec)) googletag.display(spec.id);
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
    adUnit: path,
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

  /* Homepage flip card (2026-11-03). Desktop only, 300x600 only.
     The right-hand "Ask Whisky Advocate" card turns over on its vertical axis to show one 300x600 ad, then turns back.
     Rhythm: the tools face shows for FLIP.TOOLS_MS of on-screen time; then a fresh ad is requested (pos=flip on the
     homepage unit) and the card turns once it has loaded. The ad stays up for FLIP.AD_MS of on-screen time, then the card
     turns back to the tools, and the next turn brings a new ad. The clocks only run while at least half the card is on
     screen, the tab is in front, and nobody is hovering over it or typing in it. "Back to tools" turns it back at once
     and doubles the next wait. An empty reply never turns the card. Reduced-motion users get a crossfade instead.
     TURN_MS, DEPTH and LIFT shape the turn itself (2026-11-03): the card is drawn as a solid slab with visible sides.
     AD_MS is 30s because 30 seconds is Google's minimum for time-based refresh on the web: declare this refresh in
     Ad Manager (Inventory > Inventory rules) before any paid or Ad Exchange demand can reach pos=flip. */
  var FLIP = { TOOLS_MS: 12000, AD_MS: 30000, TURN_MS: 1100, DEPTH: 16, LIFT: 56, ID: "div-id-for-flip" };   // DEPTH: card thickness, LIFT: how far it rises off the page mid-turn (px)
  function setupFlip() {
    if (!home || device() !== "desktop") return;
    var card = document.querySelector(".split-ask");
    if (!card || card.querySelector(".wa-flip-inner")) return;
    var cs = getComputedStyle(card);
    if (card.clientWidth < 316 || !sizeFor("flip", null)) return;   // the ad face has 8px side padding, so a 300px ad needs a 316px card (the card is 330-380px on desktop)

    if (!document.getElementById("wa-flip-css")) {
      var css = document.createElement("style");
      css.id = "wa-flip-css";
      css.textContent = [
        ".wa-flip{background:none!important;box-shadow:none!important;padding:0!important;display:block!important;perspective:1150px;perspective-origin:50% 45%}",
        // The card turns as a solid slab: a lift wrapper rises off the page and settles, the inner turns, two edge strips give it thickness.
        ".wa-flip-lift{position:relative;z-index:1;transform-style:preserve-3d}",
        ".wa-flip.is-turning .wa-flip-lift{animation:waFlipLift " + FLIP.TURN_MS + "ms ease-in-out}",
        "@keyframes waFlipLift{0%,100%{transform:translateZ(0)}50%{transform:translateZ(" + FLIP.LIFT + "px)}}",
        ".wa-flip-inner{display:grid;position:relative;transform-style:preserve-3d;transition:transform " + FLIP.TURN_MS + "ms cubic-bezier(.45,.05,.25,1)}",
        ".wa-flip.is-turning .wa-flip-inner{will-change:transform}",
        ".wa-flip-front,.wa-flip-back{transition:transform .2s ease}",
        // Thickness only exists while turning, so the resting card stays a flat, pixel-sharp layer.
        ".wa-flip.is-turning .wa-flip-front{transform:translateZ(" + FLIP.DEPTH / 2 + "px)}",
        ".wa-flip.is-turning .wa-flip-back{transform:rotateY(180deg) translateZ(" + FLIP.DEPTH / 2 + "px)}",
        ".wa-flip-edge{position:absolute;left:50%;width:" + FLIP.DEPTH + "px;margin-left:-" + FLIP.DEPTH / 2 + "px;top:var(--wa-r,18px);bottom:var(--wa-r,18px);visibility:hidden;pointer-events:none;" +
          "background-color:var(--wa-edge,#1c1814);background-image:linear-gradient(90deg,rgba(0,0,0,.55),rgba(255,246,234,.16) 42%,rgba(255,246,234,.06) 58%,rgba(0,0,0,.6)),repeating-linear-gradient(0deg,rgba(255,246,234,.035) 0 1px,transparent 1px 3px);" +
          "box-shadow:inset 1px 0 rgba(227,164,67,.35),inset -1px 0 rgba(255,246,234,.10)}",
        ".wa-flip-edge.l{transform:rotateY(-90deg) translateZ(var(--wa-half,190px))}",
        ".wa-flip-edge.r{transform:rotateY(90deg) translateZ(var(--wa-half,190px))}",
        ".wa-flip.is-turning .wa-flip-edge{visibility:visible;animation:waFlipEdge " + FLIP.TURN_MS + "ms cubic-bezier(.45,.05,.25,1)}",
        "@keyframes waFlipEdge{0%,100%{filter:brightness(.55)}50%{filter:brightness(1.2)}}",
        // A face darkens as it turns away from the light, and brightens as it comes round.
        ".wa-flip-face::before{content:'';position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;background:rgba(10,8,6,.78);opacity:0}",
        ".wa-flip.is-turning.is-flipped .wa-flip-front::before,.wa-flip.is-turning:not(.is-flipped) .wa-flip-back::before{animation:waFlipShadeOut " + FLIP.TURN_MS + "ms cubic-bezier(.45,.05,.25,1)}",
        ".wa-flip.is-turning.is-flipped .wa-flip-back::before,.wa-flip.is-turning:not(.is-flipped) .wa-flip-front::before{animation:waFlipShadeIn " + FLIP.TURN_MS + "ms cubic-bezier(.45,.05,.25,1)}",
        "@keyframes waFlipShadeOut{from{opacity:0}to{opacity:1}}",
        "@keyframes waFlipShadeIn{from{opacity:1}to{opacity:0}}",
        // The shadow on the page under the card: it drops away and narrows as the card goes edge-on.
        ".wa-flip-shadow{position:absolute;z-index:0;left:7%;right:7%;top:5%;bottom:3%;border-radius:28px;background:rgba(12,9,6,.5);filter:blur(22px);opacity:0;pointer-events:none}",
        ".wa-flip.is-turning .wa-flip-shadow{animation:waFlipShadow " + FLIP.TURN_MS + "ms ease-in-out}",
        "@keyframes waFlipShadow{0%,100%{opacity:0;transform:none}50%{opacity:.8;transform:translateY(30px) scaleX(.3)}}",
        ".wa-flip-front>.mono{color:var(--gold,#e3a443);font-size:11px;letter-spacing:.09em}",   // site.css styles this label as a direct child of .split-ask
        ".wa-flip.is-flipped .wa-flip-inner{transform:rotateY(180deg)}",
        ".wa-flip-face{grid-area:1/1;position:relative;min-width:0;box-sizing:border-box;-webkit-backface-visibility:hidden;backface-visibility:hidden}",
        ".wa-flip-back{transform:rotateY(180deg);display:flex;align-items:center;justify-content:center}",
        ".wa-flip-back-in{display:flex;flex-direction:column;align-items:center;gap:12px}",
        ".wa-flip-label{font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;opacity:.55}",
        ".wa-flip-ad{width:300px;height:600px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.04)}",
        ".wa-flip-return{appearance:none;background:transparent;color:inherit;border:1px solid rgba(255,246,234,.28);border-radius:999px;padding:7px 15px;font:inherit;font-size:12px;letter-spacing:.02em;cursor:pointer;opacity:.85;transition:opacity .2s,border-color .2s}",
        ".wa-flip-return:hover,.wa-flip-return:focus-visible{opacity:1;border-color:rgba(255,246,234,.6)}",
        ".wa-flip-face::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;background:linear-gradient(105deg,transparent 30%,rgba(255,246,234,.14) 50%,transparent 70%);background-size:260% 100%;background-position:130% 0}",
        ".wa-flip.is-turning .wa-flip-face::after{animation:waFlipSheen " + FLIP.TURN_MS + "ms ease-out}",
        "@keyframes waFlipSheen{0%{opacity:0;background-position:130% 0}35%{opacity:1}100%{opacity:0;background-position:-30% 0}}",
        "@media (prefers-reduced-motion:reduce){.wa-flip-inner{transition:none;transform:none!important}.wa-flip-back,.wa-flip.is-turning .wa-flip-front,.wa-flip.is-turning .wa-flip-back{transform:none!important}.wa-flip-lift,.wa-flip-shadow,.wa-flip-edge,.wa-flip-face::before{animation:none!important}.wa-flip-edge,.wa-flip-shadow{display:none}.wa-flip-face{transition:opacity .45s ease,visibility 0s linear .45s}.wa-flip-face::after{display:none}",
        ".wa-flip .wa-flip-back,.wa-flip.is-flipped .wa-flip-front{opacity:0;visibility:hidden}.wa-flip.is-flipped .wa-flip-back,.wa-flip .wa-flip-front{opacity:1;visibility:visible;transition:opacity .45s ease,visibility 0s}}"
      ].join("\n");
      document.head.appendChild(css);
    }

    // Both faces wear the card's own look; the card itself becomes a transparent stage that keeps its place (sticky) in the grid.
    var faceLook = "background-image:" + cs.backgroundImage + ";background-color:" + cs.backgroundColor + ";border-radius:" + cs.borderRadius +
      ";box-shadow:" + cs.boxShadow + ";padding:" + cs.padding + ";color:" + cs.color + ";";
    var inner = document.createElement("div"), front = document.createElement("div"), back = document.createElement("div");
    inner.className = "wa-flip-inner";
    front.className = "wa-flip-face wa-flip-front";
    back.className = "wa-flip-face wa-flip-back";
    front.style.cssText = faceLook + "display:grid;gap:" + cs.gap + ";align-content:start;";
    back.style.cssText = faceLook + "padding-left:8px;padding-right:8px;";
    while (card.firstChild) front.appendChild(card.firstChild);
    back.innerHTML = '<div class="wa-flip-back-in"><span class="wa-flip-label">Advertisement</span><div class="wa-flip-ad"><div id="' + FLIP.ID +
      '"></div></div><button type="button" class="wa-flip-return">Back to tools</button></div>';
    var lift = document.createElement("div"), shadow = document.createElement("div");
    lift.className = "wa-flip-lift"; shadow.className = "wa-flip-shadow";
    inner.appendChild(front); inner.appendChild(back);
    ["l", "r"].forEach(function (side) { var e = document.createElement("div"); e.className = "wa-flip-edge " + side; e.setAttribute("aria-hidden", "true"); inner.appendChild(e); });
    lift.appendChild(inner);
    card.appendChild(shadow); card.appendChild(lift);
    // The edges sit half the card's width out from its centre line and stop where the rounded corners begin; they take the card's own colour.
    inner.style.setProperty("--wa-r", (parseFloat(cs.borderTopLeftRadius) || 0) + "px");
    inner.style.setProperty("--wa-edge", cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "#1c1814");
    function measure() { inner.style.setProperty("--wa-half", inner.offsetWidth / 2 + "px"); }
    measure();
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(inner); else addEventListener("resize", measure);
    card.classList.add("wa-flip");
    setHidden(back, true);

    var st = { face: "tools", tools: 0, ad: 0, inView: false, hover: false, focus: false, loading: false, turning: false, slot: null, last: Date.now() };
    function setHidden(face, hidden) { face.inert = hidden; if (hidden) face.setAttribute("aria-hidden", "true"); else face.removeAttribute("aria-hidden"); }
    function turn(to) {
      if (st.turning || st.face === to) return;
      st.turning = true;
      measure();
      card.classList.add("is-turning");
      card.classList.toggle("is-flipped", to === "ad");
      setHidden(front, to === "ad"); setHidden(back, to !== "ad");
      st.face = to; st.ad = 0; if (to === "tools") st.tools = 0;
      setTimeout(function () { st.turning = false; card.classList.remove("is-turning"); }, FLIP.TURN_MS + 60);
    }
    function requestAd() {
      st.loading = true;
      whenReady(function () {
        if (!st.slot) {
          st.slot = googletag.defineSlot(path, [[300, 600]], FLIP.ID);
          if (!st.slot) { st.loading = false; return; }
          st.slot.addService(googletag.pubads()).setTargeting("pos", "flip");
          googletag.display(FLIP.ID);
        } else {
          googletag.pubads().refresh([st.slot]);
        }
      });
    }
    whenReady(function () {
      var shown = null;
      function show() { if (shown) { clearTimeout(shown); shown = null; st.loading = false; turn("ad"); } }
      googletag.pubads().addEventListener("slotRenderEnded", function (e) {
        if (e.slot !== st.slot) return;
        if (e.isEmpty) { st.loading = false; st.tools = 0; return; }   // nothing to show: stay on the tools, try again next round
        shown = setTimeout(show, 2500);                                  // turn even if the creative's load event never comes
      });
      googletag.pubads().addEventListener("slotOnload", function (e) { if (e.slot === st.slot) show(); });
    });

    back.querySelector(".wa-flip-return").addEventListener("click", function () { turn("tools"); st.tools = -FLIP.TOOLS_MS; });
    card.addEventListener("mouseenter", function () { st.hover = true; });
    card.addEventListener("mouseleave", function () { st.hover = false; });
    card.addEventListener("focusin", function () { st.focus = true; });
    card.addEventListener("focusout", function () { setTimeout(function () { st.focus = card.contains(document.activeElement); }, 0); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { st.inView = es[es.length - 1].intersectionRatio >= 0.5; }, { threshold: [0, 0.5, 1] }).observe(card);
    } else st.inView = true;

    setInterval(function () {
      var now = Date.now(), dt = now - st.last; st.last = now;
      if (device() !== "desktop") { if (st.face === "ad") turn("tools"); return; }
      if (!st.inView || document.hidden || st.hover || st.focus || st.loading || st.turning) return;
      if (st.face === "tools") { st.tools += dt; if (st.tools >= FLIP.TOOLS_MS) requestAd(); }
      else { st.ad += dt; if (st.ad >= FLIP.AD_MS) turn("tools"); }
    }, 250);

    // For checking it by hand: WAAds.flip.show() turns to a fresh ad now, WAAds.flip.hide() turns back.
    window.WAAds.flip = {
      show: function () { if (st.face === "tools" && !st.loading) requestAd(); },
      hide: function () { turn("tools"); },
      state: function () { return { face: st.face, toolsMs: Math.round(st.tools), adMs: Math.round(st.ad), inView: st.inView, paused: st.hover || st.focus } }
    };
  }
  setupFlip();
})();
