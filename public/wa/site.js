/* Whisky Advocate concept: shared behaviour. Data is real (320 recent ratings); the "AI" is a deterministic stand-in. */
(function () {
  var DATA = null;
  var fmt = function (n) { return n > 0 ? "$" + Math.round(n).toLocaleString() : "Price n/a"; };
  function charScore(r, c) { return c === "smoky" ? r.sm : c === "sweet" ? r.sw : c === "rich" ? r.ri : r.li; }
  function slugOf(r) { return (r.pr + " " + r.n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function bottleHref(x) { var r = typeof x === "number" ? (DATA && DATA[x]) : x; return "bottle.html#" + (r && r.slug ? encodeURIComponent(r.slug) : x); }
  function producerHref(name) { return "producer.html#" + encodeURIComponent(name); }
  var value = function (r) { return r.s - 80 - Math.log((r.p > 0 ? r.p : 60) / 30) * 4; };

  window.WA = { data: function () { return DATA; }, fmt: fmt, charScore: charScore, bottleHref: bottleHref, producerHref: producerHref, value: value, slugOf: slugOf };

  function loaded(cb) {
    var el = document.getElementById("data");
    if (el) { DATA = JSON.parse(el.textContent); cb(DATA); return; }
    fetch("data.json").then(function (r) { return r.json(); }).then(function (d) { DATA = d; cb(d); });
  }

  /* Entrance, home only: a quiet loader, then a layered scene with a WebGL whisky field under it.
     The scene plays itself in for the first moments and then belongs to the scroll. */
  var MOTION = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function seg(p, a, b) { return clamp01((p - a) / (b - a)); }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

  function initGL(canvas) {
    var gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false }); if (!gl) return null;
    var VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
    var FS = [
      "precision highp float;uniform vec2 u_res;uniform float u_time;uniform vec2 u_pointer;uniform float u_progress;uniform float u_intro;",
      "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
      "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}",
      "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}",
      "void main(){vec2 uv=gl_FragCoord.xy/u_res;vec2 p=uv;p.x*=u_res.x/u_res.y;float t=u_time*.04;",
      "float flow=t*(1.+(1.-u_progress)*1.2);",
      "vec2 q=vec2(fbm(p*1.5+vec2(0.,flow)),fbm(p*1.5+vec2(5.2,flow*.8)));",
      "vec2 r=vec2(fbm(p*1.5+2.*q+vec2(1.7,9.2)+.15*t),fbm(p*1.5+2.*q+vec2(8.3,2.8)-.12*t));",
      "float f=fbm(p*1.5+2.4*r);",
      "vec2 m=u_pointer;m.x*=u_res.x/u_res.y;float d=length(p-m);f+=.035*exp(-d*d*5.)*sin(d*22.-u_time*1.8);",
      "vec3 paper=vec3(.969,.953,.925);vec3 amber=vec3(.788,.451,.114);vec3 gold=vec3(.89,.643,.263);vec3 cask=vec3(.31,.165,.063);",
      "float liquid=smoothstep(.38,.78,f);vec3 col=mix(gold,amber,smoothstep(.45,.8,f));col=mix(col,cask,smoothstep(.76,.95,f)*.5);",
      "float hi=pow(max(0.,1.-abs(f-.64)*9.),3.);col+=hi*.22;",
      "float top=smoothstep(.0,.55,uv.y);float strength=(.26+.2*(1.-u_progress))*u_intro*mix(1.,top,.7);",
      "vec3 o=mix(paper,col,liquid*strength);gl_FragColor=vec4(o,1.);}"
    ].join("\n");
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { return null; } return s; }
    var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS); if (!v || !f) return null;
    var prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ["u_res", "u_time", "u_pointer", "u_progress", "u_intro"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var w = 0, h = 0;
    return { render: function (now, P, pointer, intro) {
      var cw = Math.max(1, Math.round(canvas.clientWidth * 0.5)), ch = Math.max(1, Math.round(canvas.clientHeight * 0.5));
      if (cw !== w || ch !== h) { w = cw; h = ch; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      gl.uniform2f(U.u_res, w, h); gl.uniform1f(U.u_time, now / 1000); gl.uniform2f(U.u_pointer, pointer.x, 1 - pointer.y); gl.uniform1f(U.u_progress, P); gl.uniform1f(U.u_intro, intro);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } };
  }

  function entrance() {
    var stage = document.getElementById("stage"); if (!stage) return;
    document.body.classList.add("has-stage");
    var q = function (sel) { return stage.querySelector(sel); };
    var sheet = q(".layer.sheet"), video = q("video"), copy = q(".scene-copy");
    var gl = MOTION ? initGL(document.getElementById("gl")) : null;
    var pointer = { x: 0.5, y: 0.5 }, target = { x: 0.5, y: 0.5 };
    addEventListener("pointermove", function (e) { target.x = e.clientX / innerWidth; target.y = e.clientY / innerHeight; }, { passive: true });
    if (video && innerHeight > innerWidth) { var src = video.querySelector("source"); src.src = "pour-portrait.mp4"; video.load(); }
    if (video && MOTION) { var pl = video.play(); if (pl && pl.catch) pl.catch(function () {}); }
    var t0 = performance.now();
    function frame(now) {
      pointer.x += (target.x - pointer.x) * 0.06; pointer.y += (target.y - pointer.y) * 0.06;
      var intro = MOTION ? easeOut(clamp01((now - t0) / 1600)) : 1, px = pointer.x - 0.5;
      sheet.style.transform = "translate3d(" + (px * -6) + "px," + (-100 * (1 - intro)) + "%,0)";
      if (intro > 0.3 && copy.getAttribute("data-on") !== "true") copy.setAttribute("data-on", "true");
      if (intro > 0.5 && stage.getAttribute("data-landing") !== "true") stage.setAttribute("data-landing", "true");
      if (gl) gl.render(now, 0.4, pointer, intro);
      if (stage.getBoundingClientRect().bottom > 0) requestAnimationFrame(frame); else setTimeout(function () { requestAnimationFrame(frame); }, 400);
    }
    requestAnimationFrame(frame);
  }

  /* Motion everywhere: rows and cards rise into place as they enter; headline accents sweep amber. */
  function reveal() {
    if (!MOTION) return; document.body.classList.add("motion");
    var items = [];
    document.querySelectorAll(".band").forEach(function (band) {
      var kids = [].slice.call(band.children); kids.forEach(function (k) { items.push(k); });
      band.querySelectorAll(".grid > *, .stories > *, .lenses > *, .trade-grid > *, .picks3 > *, .scan > *, .stat-row > *").forEach(function (el, i) { el.style.setProperty("--stagger", (i % 8) * 70 + "ms"); items.push(el); });
    });
    items.forEach(function (el) { if (!el.classList.contains("reveal")) el.classList.add("reveal"); });
    if (!("IntersectionObserver" in window)) { items.forEach(function (el) { el.setAttribute("data-in", "true"); }); return; }
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { e.target.setAttribute("data-in", "true"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* Page to page: cross-document view transitions where the browser has them, a short fade elsewhere. */
  function transitions() {
    if (!MOTION || ("startViewTransition" in document)) return;
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]"); if (!a || a.target || e.metaKey || e.ctrlKey || e.button) return;
      var href = a.getAttribute("href"); if (!/^[a-z-]+\.html/.test(href) || href.split("#")[0] === location.pathname.split("/").pop()) return;
      e.preventDefault(); document.body.classList.add("leaving"); setTimeout(function () { location.href = href; }, 170);
    });
    addEventListener("pageshow", function () { document.body.classList.remove("leaving"); });
  }

  /* The ambient field: the same whisky shader, faint and slow, under every page, so the glass surfaces have something to blur. */
  function ambient() {
    var c = document.getElementById("field"); if (!c || !MOTION) return;
    var gl = initGL(c); if (!gl) return;
    var pointer = { x: 0.5, y: 0.5 }, target = { x: 0.5, y: 0.5 }, running = true;
    addEventListener("pointermove", function (e) { target.x = e.clientX / innerWidth; target.y = e.clientY / innerHeight; }, { passive: true });
    document.addEventListener("visibilitychange", function () { running = !document.hidden; if (running) requestAnimationFrame(frame); });
    function frame(now) { if (!running) return; pointer.x += (target.x - pointer.x) * 0.04; pointer.y += (target.y - pointer.y) * 0.04; gl.render(now * 0.6, 1, pointer, 0.55); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }
  /* Pictures drift a little against the scroll, so the page reads in layers. */
  function parallax() {
    if (!MOTION) return;
    var items = [].slice.call(document.querySelectorAll(".story.has-img img, .pick-card img, .place img, .story-hero img, .recipe-card img, .recipe .art img"));
    if (!items.length) return;
    var ticking = false;
    function run() { ticking = false; var h = innerHeight; items.forEach(function (im) { var r = im.getBoundingClientRect(); if (r.bottom < 0 || r.top > h) return; var t = (r.top + r.height / 2 - h / 2) / h; im.style.transform = "translate3d(0," + (t * -14).toFixed(1) + "px,0) scale(1.06)"; }); }
    addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true }); run();
    new MutationObserver(function () { items = [].slice.call(document.querySelectorAll(".story.has-img img, .pick-card img, .place img, .story-hero img, .recipe-card img, .recipe .art img")); run(); }).observe(document.body, { childList: true, subtree: true });
  }

  function mastState() {
    function set() { document.body.setAttribute("data-top", String(scrollY < 24)); }
    addEventListener("scroll", set, { passive: true }); set();
  }


  /* Editorial content: the index of recent stories and, on demand, the bodies. Both come from the CMS export. */
  var STORIES = null, ARTICLES = null;
  var SECTION = { news: "News", features: "Feature", guides: "Guide", cocktails: "Cocktails", travel: "Travel", life: "Whisky Life" };
  function when(d) { if (!d) return ""; var t = new Date(d + "T12:00:00"); return t.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (t.getFullYear() !== new Date().getFullYear() ? ", " + t.getFullYear() : ""); }
  function stories(cb) { if (STORIES) return cb(STORIES); fetch("stories.json").then(function (r) { return r.json(); }).then(function (d) { STORIES = d; cb(d); }); }
  var ARTS = {};
  function article(slug, cb) { var k = shardOf(slug); if (ARTS[k]) return cb(ARTS[k][slug] || null); fetch("articles/" + k + ".json").then(function (r) { return r.json(); }).then(function (d) { ARTS[k] = d; cb(d[slug] || null); }, function () { cb(null); }); }
  var GLOSSARY = null;
  function glossary(cb) { if (GLOSSARY) return cb(GLOSSARY); fetch("glossary.json").then(function (r) { return r.json(); }).then(function (d) { GLOSSARY = d; cb(d); }); }
  var SECTION_HREF = { news: "stories.html#news", features: "stories.html#features", guides: "guides.html", cocktails: "cocktails.html", travel: "travel.html", life: "stories.html#life" };
  function initials(name) { return (name || "WA").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(); }
  function storyHref(st) { return "story.html#" + st.slug; }
  function storyRow(st) { return '<a href="' + storyHref(st) + '">' + (st.hero ? '<img class="th" src="' + st.hero + '" alt="" loading="lazy">' : '<span class="tag">' + SECTION[st.sec] + '</span>') + '<span><span class="nm">' + st.title + '</span><span class="sub">' + (st.dek || SECTION[st.sec] + " · " + st.by) + '</span></span><span class="when">' + when(st.d) + "</span></a>"; }
  function storyCard(st, cls) { return '<a class="story ' + cls + (st.hero ? " has-img" : "") + '" href="' + storyHref(st) + '">' + (st.hero ? '<img src="' + st.hero + '" alt="" loading="lazy">' : "") + '<span class="tag">' + SECTION[st.sec] + '</span><h3>' + st.title + "</h3><p>" + (st.dek || "") + "</p></a>"; }
  window.WA.stories = stories; window.WA.article = article; window.WA.glossary = glossary; window.WA.SECTION_HREF = SECTION_HREF; window.WA.when = when; window.WA.SECTION = SECTION; window.WA.initials = initials; window.WA.storyHref = storyHref; window.WA.storyRow = storyRow; window.WA.storyCard = storyCard;


  /* The whole ratings archive (every published rating, names and numbers) and the notes, sharded by slug, on demand. */
  var ARCHIVE = null, NOTES = {};
  function archive(cb) {
    if (ARCHIVE) return cb(ARCHIVE);
    fetch("ratings.json").then(function (r) { return r.json(); }).then(function (d) {
      ARCHIVE = d.rows.map(function (row) { var o = {}; d.cols.forEach(function (c, i) { o[c] = row[i]; }); o.t = ""; return o; });
      ARCHIVE.words = d.words || []; window.WA.WORDS = ARCHIVE.words;
      var bySlug = {}; ARCHIVE.forEach(function (r) { bySlug[r.slug.toLowerCase()] = r; });
      ARCHIVE.bySlug = bySlug; DATA = ARCHIVE; cb(ARCHIVE);
    });
  }
  function shardOf(slug) { var h = 0; for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0; return String(h % 64).padStart(2, "0"); }
  function note(slug, cb) {
    var k = shardOf(slug); if (NOTES[k]) return cb(NOTES[k][slug] || "");
    fetch("notes/" + k + ".json").then(function (r) { return r.json(); }).then(function (d) { NOTES[k] = d; cb(d[slug] || ""); }, function () { cb(""); });
  }
  /* Cards rendered from the archive carry no note; fill them in once their shard arrives. */
  function fillNotes(root) {
    root.querySelectorAll(".bottle[data-slug]").forEach(function (card) {
      var p = card.querySelector("p[data-note]"); if (!p || p.textContent) return;
      var slug = card.getAttribute("data-slug");
      note(slug, function (f) { var r = ARCHIVE && ARCHIVE.bySlug[slug.toLowerCase()]; if (r && !r.f) { r.f = f; r.t = f.length > 110 ? f.slice(0, 110).replace(/\s\S*$/, "") : f; } p.textContent = r ? r.t : f.slice(0, 110); });
    });
  }
  function hashSlug() { var h = (location.hash || "").slice(1); try { h = decodeURIComponent(h); } catch (e) {} return h; }
  function find(data, slug) { if (!slug) return null; if (data.bySlug) return data.bySlug[slug.toLowerCase()] || null; var l = slug.toLowerCase(); for (var i = 0; i < data.length; i++) if (data[i].slug && data[i].slug.toLowerCase() === l) return data[i]; var n = parseInt(slug, 10); return isNaN(n) ? null : data[n] || null; }
  var COCKTAILS = null, TOP20 = null;
  function cocktails(cb) { if (COCKTAILS) return cb(COCKTAILS); fetch("cocktails.json").then(function (r) { return r.json(); }).then(function (d) { COCKTAILS = d; cb(d); }); }
  function top20(cb) { if (TOP20) return cb(TOP20); fetch("top20.json").then(function (r) { return r.json(); }).then(function (d) { TOP20 = d; cb(d); }); }
  /* Producers, summarised from the archive: count, best, average, main category, country from the categories. */
  var COUNTRY = { "Single Malt Scotch": "Scotland", "Blended Scotch Whisky": "Scotland", "Blended Malt Scotch Whisky": "Scotland", "Single Grain Scotch": "Scotland", "Blended Grain Scotch": "Scotland", "Bourbon/Tennessee Whiskey": "United States", "Rye Whiskey": "United States", "Single Malt American Whiskey": "United States", "American Whiskey": "United States", "Wheat Whiskey": "United States", "Irish Single Malt": "Ireland", "Blended Irish Whiskey": "Ireland", "Irish Single Pot Still": "Ireland", "Irish": "Ireland", "Irish Grain": "Ireland", "Japanese Whisky": "Japan", "Canadian": "Canada" };
  function producers(data) {
    var P = {};
    data.forEach(function (r) { if (r.pr === "Unknown producer") return; var p = P[r.pr] || (P[r.pr] = { name: r.pr, n: 0, best: 0, sum: 0, cats: {}, rows: [] }); p.n++; p.sum += r.s; if (r.s > p.best) p.best = r.s; p.cats[r.c] = (p.cats[r.c] || 0) + 1; p.rows.push(r); });
    Object.keys(P).forEach(function (k) { var p = P[k]; p.avg = p.sum / p.n; p.cat = Object.keys(p.cats).sort(function (a, b) { return p.cats[b] - p.cats[a]; })[0]; p.country = COUNTRY[p.cat] || "Elsewhere"; });
    return P;
  }
  /* Read the amount off the front of a printed ingredient: "1 1/2 oz. rye" -> 1.5, "oz", "rye". */
  var FRAC = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  function amount(i) {
    var s = i.replace(/\u00a0/g, " "), m, n = 0, any = false;
    while ((m = s.match(/^\s*(?:(\d+)\s*[\/⁄]\s*(\d+)|([½¼¾⅓⅔⅛])|(\d+(?:\.\d+)?))(?=[\s\d½¼¾⅓⅔⅛\/⁄]|$)/))) { if (m[1]) n += +m[1] / +m[2]; else if (m[3]) n += FRAC[m[3]]; else n += +m[4]; s = s.slice(m[0].length); any = true; }
    if (!any) return null;
    var u = s.match(/^\s*(oz\.?|ounces?|dash(?:es)?|parts?|cups?|tsps?\.?|tbsps?\.?|teaspoons?|tablespoons?|barspoons?|drops?|splash(?:es)?|ml|sprigs?|slices?|leaves|cubes?|wedges?|pinch(?:es)?|bottles?|cans?)\b\.?/i);
    return { n: n, unit: u ? u[1].replace(/\.$/, "") : "", rest: (u ? s.slice(u[0].length) : s).replace(/^[\s.]+/, "") };
  }
  function fmtAmount(x) { var w = Math.floor(x + 1e-6), f = x - w, F = f < 0.1 ? "" : f < 0.2 ? "⅛" : f < 0.3 ? "¼" : f < 0.4 ? "⅓" : f < 0.6 ? "½" : f < 0.7 ? "⅔" : f < 0.9 ? "¾" : ""; if (f >= 0.9) { w += 1; F = ""; } return (w || !F ? w : "") + F; }
  window.WA.hasWord = function (r, i) { return ((r.w || 0) & (1 << i)) !== 0; };
  window.WA.amount = amount; window.WA.fmtAmount = fmtAmount;
  window.WA.producers = producers; window.WA.COUNTRY = COUNTRY;
  window.WA.cocktails = cocktails; window.WA.top20 = top20;
  window.WA.archive = archive; window.WA.note = note; window.WA.fillNotes = fillNotes; window.WA.hashSlug = hashSlug; window.WA.find = find;

  /* Query understanding */
  var TYPES = [
    { key: "Bourbon", match: /bourbon|kentucky|wheated/i, cats: ["Bourbon/Tennessee Whiskey"] },
    { key: "Rye", match: /\brye\b|manhattan|sazerac/i, cats: ["Rye Whiskey"] },
    { key: "Single malt Scotch", match: /single malt|speyside|highland|islay|scotch|lagavulin|ardbeg|laphroaig|macallan/i, cats: ["Single Malt Scotch"] },
    { key: "Blended Scotch", match: /blended scotch|blend\b/i, cats: ["Blended Scotch Whisky", "Blended Malt Scotch Whisky"] },
    { key: "Irish", match: /irish|pot still|redbreast/i, cats: ["Irish Single Malt", "Blended Irish Whiskey", "Irish", "Irish Single Pot Still"] },
    { key: "Japanese", match: /japan|yamazaki|hibiki|nikka/i, cats: ["Japanese Whisky"] },
    { key: "Canadian", match: /canad/i, cats: ["Canadian"] },
    { key: "American single malt", match: /american single malt/i, cats: ["Single Malt American Whiskey"] },
  ];
  /* Names: typo-tolerant matching of what was typed against bottle and producer names. */
  function norm(s) { return String(s || "").toLowerCase().replace(/[\u2019']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  var INTENT = /^(best|top|great|good|under|below|over|for|a|an|the|with|and|or|of|in|to|me|my|whisky|whiskey|whiskies|bottle|bottles|something|like|rated|points?|pts|dollars?|night|gift|cheap|value|smoky|smoke|peat|peated|peaty|sweet|sherry|sherried|rich|light|bourbon|rye|scotch|irish|japanese|japan|canadian|single|malt|blended|blend|highland|speyside|islay|winter|summer|first|friend|year|years|old|cask|strength|proof|from|that|this|what|which|should|use|worth|price)$/;
  function nameTerms(q) { return norm(q).split(" ").filter(function (t) { return t.length >= 3 && !INTENT.test(t) && !/^\d+$/.test(t); }); }
  function edit(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur = [], i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) { cur[0] = i; var rowMin = i; for (j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < rowMin) rowMin = cur[j]; } if (rowMin > max) return max + 1; prev = cur.slice(); }
    return prev[b.length];
  }
  function tokensOf(r) { if (!r._tk) r._tk = norm(r.n + " " + r.pr).split(" "); return r._tk; }
  function termHit(term, r) {
    var best = 0, toks = tokensOf(r);
    for (var i = 0; i < toks.length; i++) { var t = toks[i]; if (t === term) return 3; if (t.indexOf(term) === 0 || (term.length >= 4 && term.indexOf(t) === 0 && t.length >= 4)) { best = Math.max(best, 2); continue; } if (best < 1 && t.length >= 4 && edit(term, t, term.length > 6 ? 2 : 1) <= (term.length > 6 ? 2 : 1)) best = 1; }
    return best;
  }
  function nameScore(terms, r) { var total = 0; for (var i = 0; i < terms.length; i++) { var h = termHit(terms[i], r); if (!h) return 0; total += h; } return total; }
  window.WA.nameTerms = nameTerms; window.WA.nameScore = nameScore; window.WA.norm = norm;

  function understand(q) {
    var f = { types: [], price: null, score: null, chars: [], text: q, terms: nameTerms(q) };
    TYPES.forEach(function (t) { if (t.match.test(q)) f.types.push(t); });
    var m = q.match(/(?:under|below|less than|up to|max(?:imum)?)\s*\$?\s*(\d{2,4})/i) || q.match(/\$\s*(\d{2,4})/); if (m) f.price = +m[1];
    var s = q.match(/(\d{2})\s*(?:points?|pts|\+|or higher|or better|and up)/i); if (s) f.score = +s[1];
    if (/smok|peat|islay|lagavulin|ardbeg|laphroaig|bonfire/i.test(q)) f.chars.push("smoky");
    if (/sherr|sweet|fruit|dessert|winter|christmas|raisin|honey/i.test(q)) f.chars.push("sweet");
    if (/rich|oily|full|chewy|cask strength|big/i.test(q)) f.chars.push("rich");
    if (/light|delicate|floral|summer|easy|gentle|aperitif/i.test(q)) f.chars.push("light");
    if (/value|worth the price|bang for|cheap|budget|affordable/i.test(q) && !f.price) f.price = 80;
    if (/best|top|great|excellent/i.test(q) && !f.score) f.score = 90;
    return f;
  }
  function apply(f, rows) {
    var named = f.terms && f.terms.length ? f.terms : null;
    var out = rows.map(function (r) {
      var ns = named ? nameScore(named, r) : 0; if (named && !ns) return null;
      if (!named || ns < 2) { if (f.types.length && !f.types.some(function (t) { return t.cats.indexOf(r.c) >= 0; })) return null; }
      if (f.price && r.p > f.price) return null;
      if (f.score && r.s < f.score) return null;
      var fit = f.chars.reduce(function (acc, c) { return acc + Math.min(3, charScore(r, c)); }, 0);
      return { r: r, rank: r.s + fit * 1.5 + ns * 6 + (r.d ? (+r.d.slice(0, 4) - 2013) * 0.15 : 0) };
    }).filter(Boolean);
    // A typed name that matches nothing exactly still finds its nearest spellings.
    if (named && !out.length) { out = rows.map(function (r) { var best = 0; named.forEach(function (t) { best += termHit(t, r); }); return best ? { r: r, rank: r.s + best * 6 } : null; }).filter(Boolean); }
    return out.sort(function (a, b) { return b.rank - a.rank || a.r.p - b.r.p; }).map(function (x) { return x.r; });
  }
  function facetLabels(f) {
    var out = []; (f.terms || []).forEach(function (t) { out.push("“" + t + "”"); }); f.types.forEach(function (t) { out.push(t.key); });
    if (f.price) out.push("under " + fmt(f.price)); if (f.score) out.push(f.score + "+ points"); f.chars.forEach(function (c) { out.push(c); });
    return out;
  }
  function answerFor(f, picks) {
    if (!picks.length) return "<p>Nothing in the archive matches all of that at once. Loosen the budget or the score and the picks come back.</p>";
    var top = picks[0], avg = Math.round(picks.slice(0, 8).reduce(function (a, r) { return a + r.p; }, 0) / Math.min(8, picks.length));
    if (f.terms && f.terms.length) {
      var byPr = {}; picks.forEach(function (r) { byPr[r.pr] = (byPr[r.pr] || 0) + 1; });
      var house = Object.keys(byPr).sort(function (a, b) { return byPr[b] - byPr[a]; })[0], share = byPr[house] / picks.length;
      var best = picks.slice().sort(function (a, b) { return b.s - a.s || (b.d || "").localeCompare(a.d || ""); })[0], newest = picks.slice().sort(function (a, b) { return (b.d || "").localeCompare(a.d || ""); })[0];
      var priced = picks.filter(function (r) { return r.p > 0; }), cheapest = priced.slice().sort(function (a, b) { return a.p - b.p; })[0];
      var t = "";
      if (share >= 0.5 && byPr[house] > 1) t += "<p><strong>" + house + "</strong>: " + byPr[house] + " ratings in the archive" + (newest && newest.d ? ", the latest " + newest.n + " in " + newest.d.slice(0, 4) : "") + ". The panel's highest mark is " + best.s + " for " + best.n + (best.p > 0 ? " at " + fmt(best.p) : "") + "." + (cheapest ? " The most affordable is " + cheapest.n + " at " + fmt(cheapest.p) + "." : "") + "</p>";
      else t += "<p>" + picks.length + (picks.length === 1 ? " bottle" : " bottles") + " named like that. Highest: <strong>" + best.n + "</strong>, " + best.s + " points" + (best.p > 0 ? " at " + fmt(best.p) : "") + ".</p>";
      t += "<p>" + (top.t || "") + "</p>";
      t += '<div class="src">' + (share >= 0.5 && byPr[house] > 1 ? '<a href="' + producerHref(house) + '">' + house + " portfolio</a>" : "") + '<a href="' + bottleHref(DATA.indexOf(best)) + '">' + best.n + '</a><a href="finder.html">All ratings</a></div>';
      return t;
    }
    var what = f.types.length ? f.types.map(function (t) { return t.key.toLowerCase(); }).join(" or ") : "whisky";
    var tone = f.chars.length ? " leaning " + f.chars.join(" and ") : "";
    var text = "<p>For " + what + tone + (f.price ? " under " + fmt(f.price) : "") + ", start with <strong>" + top.n + "</strong>: " + top.s + " points at " + fmt(top.p) + ". " + (top.t ? top.t.replace(/\s+$/, "") + "." : "") + "</p>";
    text += "<p>" + picks.length + " bottles match. The ones beside this average " + fmt(avg) + ". Each score opens the bottle page with the full note.</p>";
    text += '<div class="src"><a href="finder.html">Whisky Finder</a><a href="' + bottleHref(DATA.indexOf(top)) + '">' + top.n + '</a><a href="stories.html">Related stories</a></div>';
    return text;
  }
  function askBar() {
    var form = document.getElementById("askForm"); if (!form) return;
    var input = document.getElementById("askInput"), answer = document.getElementById("answer");
    function ask(q) {
      if (!q.trim() || !DATA) return;
      var f = understand(q);
      if (f.terms.length && !ARCHIVE) { archive(function () { ask(q); }); return; }
      var picks = apply(f, DATA);
      document.getElementById("answerFacets").innerHTML = facetLabels(f).map(function (l) { return '<span class="facet">' + l + "</span>"; }).join("") || '<span class="facet">everything</span>';
      document.getElementById("answerText").innerHTML = answerFor(f, picks);
      document.getElementById("answerPicks").innerHTML = picks.slice(0, 4).map(function (r) { return '<a class="pick" href="' + bottleHref(DATA.indexOf(r)) + '"><span class="sc score-type">' + r.s + '</span><span><span class="nm">' + r.n + '</span><span class="ct">' + r.c + "</span></span><span class=\"pr\">" + fmt(r.p) + "</span></a>"; }).join("");
      answer.setAttribute("data-show", "true");
      setTimeout(function () { if (window.WA.scrollAnswer) window.WA.scrollAnswer(); else answer.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 50);
      if (window.WA.onAsk) window.WA.onAsk(f);
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); menu.setAttribute("data-open", "false"); ask(input.value); });
    // Predictive: bottles, producers, stories and taste words appear as you type; a tap opens them, Enter asks.
    var menu = document.createElement("div"); menu.className = "ask-menu"; menu.setAttribute("data-open", "false"); form.insertAdjacentElement("afterend", menu);
    var timer = null;
    function suggestFor(q) {
      var terms = nameTerms(q); if (!terms.length) { menu.setAttribute("data-open", "false"); return; }
      var rows = DATA || [], scored = [];
      for (var i = 0; i < rows.length; i++) { var ns = nameScore(terms, rows[i]); if (ns) scored.push({ r: rows[i], ns: ns }); }
      scored.sort(function (a, b) { return b.ns - a.ns || b.r.s - a.r.s || (b.r.d || "").localeCompare(a.r.d || ""); });
      var houses = {}; scored.forEach(function (x) { if (terms.every(function (t) { return norm(x.r.pr).split(" ").some(function (tok) { return tok.indexOf(t) === 0 || edit(t, tok, 1) <= 1; }); })) houses[x.r.pr] = (houses[x.r.pr] || 0) + 1; });
      var houseList = Object.keys(houses).sort(function (a, b) { return houses[b] - houses[a]; }).slice(0, 2);
      var words = (window.WA.WORDS || []).filter(function (w) { return terms.some(function (t) { return w.indexOf(t) === 0; }); }).slice(0, 2);
      var html = '<button type="button" class="row ask-row" data-ask="' + q.replace(/"/g, "&quot;") + '"><span class="k">Ask</span><span class="nm">' + q.replace(/</g, "&lt;") + "</span></button>";
      houseList.forEach(function (h) { html += '<a class="row" href="' + producerHref(h) + '"><span class="k">Producer</span><span class="nm">' + h + '</span><span class="meta">' + houses[h] + " ratings</span></a>"; });
      scored.slice(0, 5).forEach(function (x) { html += '<a class="row" href="' + bottleHref(x.r) + '"><b class="score-type">' + x.r.s + '</b><span class="nm">' + x.r.n + '</span><span class="meta">' + (x.r.d ? x.r.d.slice(0, 4) : "") + "</span></a>"; });
      words.forEach(function (w) { html += '<a class="row" href="finder.html#word=' + encodeURIComponent(w) + '"><span class="k">Taste</span><span class="nm">' + w + "</span></a>"; });
      if (STORIES) { STORIES.filter(function (st) { return terms.every(function (t) { return norm(st.title).indexOf(t) >= 0; }); }).slice(0, 2).forEach(function (st) { html += '<a class="row" href="' + storyHref(st) + '"><span class="k">' + SECTION[st.sec] + '</span><span class="nm">' + st.title + "</span></a>"; }); }
      menu.innerHTML = html; menu.setAttribute("data-open", "true");
    }
    input.addEventListener("input", function () { var q = input.value; clearTimeout(timer); if (nameTerms(q).length === 0) { menu.setAttribute("data-open", "false"); return; } timer = setTimeout(function () { if (!ARCHIVE) { archive(function () { suggestFor(input.value); }); if (!STORIES) stories(function () {}); } else suggestFor(q); }, 90); });
    input.addEventListener("focus", function () { if (nameTerms(input.value).length) suggestFor(input.value); });
    input.addEventListener("keydown", function (e) { if (e.key === "Escape") menu.setAttribute("data-open", "false"); });
    menu.addEventListener("click", function (e) { var b = e.target.closest(".ask-row"); if (b) { e.preventDefault(); menu.setAttribute("data-open", "false"); ask(b.getAttribute("data-ask")); } });
    document.addEventListener("click", function (e) { if (!e.target.closest(".ask")) menu.setAttribute("data-open", "false"); });
    var sug = document.getElementById("suggest"); if (sug) sug.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; input.value = b.textContent; ask(b.textContent); });
    var mic = form.querySelector(".mic"); if (mic) mic.addEventListener("click", function () { input.placeholder = "Listening… say what you're in the mood for"; input.focus(); setTimeout(function () { input.placeholder = "A sherried Speyside under $90 for a winter night"; }, 2500); });
    window.WA.ask = ask;
  }

  /* Bottle card markup, shared */
  function bottleCard(r, opts) {
    opts = opts || {};
    var idx = DATA.indexOf(r), on = opts.compare && opts.compare.indexOf(idx) >= 0;
    return '<article class="bottle' + (r.img ? " has-img" : "") + '" data-pinned="' + !!on + '" data-slug="' + (r.slug || "") + '">' + (r.img ? '<a class="thumb" href="' + bottleHref(idx) + '"><img src="' + r.img + '" alt="" loading="lazy"></a>' : "") + '<div class="top"><div class="score score-type">' + r.s + "<small>points</small></div><div class=\"cat\">" + r.c + '</div></div><div><h3><a href="' + bottleHref(idx) + '">' + r.n + "</a></h3><p style=\"margin-top:6px\" data-note>" + (r.t || "") + '</p></div><div class="foot"><span>' + fmt(r.p) + (r.a ? " · " + r.a + "%" : "") + "</span>" + (opts.compare ? '<button type="button" data-i="' + idx + '" aria-pressed="' + !!on + '">' + (on ? "Pinned" : "Compare") + "</button>" : '<a href="' + producerHref(r.pr) + '" style="color:var(--ink-3)">' + r.pr + "</a>") + "</div></article>";
  }
  window.WA.bottleCard = bottleCard;

  /* Flavor compass drawing, reused on the finder and the bottle page */
  function setupCanvas(c) { var d = Math.min(devicePixelRatio || 1, 2); var w = c.clientWidth, h = c.clientHeight; c.width = w * d; c.height = h * d; var g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); return { g: g, w: w, h: h }; }
  function compassPoint(r, cx, cy, rad) {
    var hash = 0; for (var i = 0; i < r.n.length; i++) hash = (hash * 31 + r.n.charCodeAt(i)) % 1000;
    var sx = (Math.min(4, r.sw) - Math.min(4, r.sm)) / 4, sy = (Math.min(4, r.ri) - Math.min(4, r.li)) / 4;
    return { x: cx + sx * rad * 0.8 + ((hash % 17) - 8) * 1.6, y: cy + sy * rad * 0.8 + ((hash % 13) - 6) * 1.6 };
  }
  function drawCompass(canvas, rows, highlight) {
    var f = setupCanvas(canvas), h = f.g, cx = f.w / 2, cy = f.h / 2, rad = Math.min(f.w, f.h) / 2 - 18, rule = "rgba(23,18,13,0.1)";
    h.clearRect(0, 0, f.w, f.h); h.strokeStyle = rule; h.beginPath(); h.arc(cx, cy, rad, 0, Math.PI * 2); h.stroke(); h.beginPath(); h.arc(cx, cy, rad / 2, 0, Math.PI * 2); h.stroke();
    h.beginPath(); h.moveTo(cx - rad, cy); h.lineTo(cx + rad, cy); h.moveTo(cx, cy - rad); h.lineTo(cx, cy + rad); h.stroke();
    h.fillStyle = "#8b7b6a"; h.font = "10.5px JetBrains Mono, monospace"; h.fillText("SMOKY", cx - rad - 2, cy - 6); h.fillText("SWEET", cx + rad - 40, cy - 6); h.fillText("LIGHT", cx + 4, cy - rad + 12); h.fillText("RICH", cx + 4, cy + rad - 4);
    var pts = rows.map(function (r) { var p = compassPoint(r, cx, cy, rad); h.beginPath(); h.arc(p.x, p.y, 3, 0, Math.PI * 2); h.fillStyle = r === highlight ? "transparent" : r.s >= 92 ? "#c9731d" : "rgba(201,115,29,0.3)"; h.fill(); return { x: p.x, y: p.y, r: r }; });
    if (highlight) { var hp = compassPoint(highlight, cx, cy, rad); h.beginPath(); h.arc(hp.x, hp.y, 7, 0, Math.PI * 2); h.fillStyle = "#17120d"; h.fill(); h.beginPath(); h.arc(hp.x, hp.y, 11, 0, Math.PI * 2); h.strokeStyle = "#c9731d"; h.lineWidth = 1.5; h.stroke(); }
    return { points: pts, cx: cx, cy: cy, rad: rad };
  }
  window.WA.drawCompass = drawCompass; window.WA.setupCanvas = setupCanvas; window.WA.compassPoint = compassPoint;

  /* Hash routing helpers */
  window.WA.hashIndex = function () { var h = (location.hash || "").replace("#", ""); var i = parseInt(h, 10); return isNaN(i) ? null : i; };
  window.WA.hashName = function () { var h = (location.hash || "").replace("#", ""); return h ? decodeURIComponent(h) : null; };

  window.WA.ready = function (cb) { loaded(function (d) { entrance(); askBar(); reveal(); transitions(); mastState(); ambient(); parallax(); cb(d); }); };
})();

var waAds = document.createElement("script");
waAds.src = "ads.js";
document.body.appendChild(waAds);
