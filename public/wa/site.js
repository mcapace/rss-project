/* Whisky Advocate concept: shared behaviour. Data is real (320 recent ratings); the "AI" is a deterministic stand-in. */
(function () {
  var DATA = null;
  var fmt = function (n) { return n > 0 ? "$" + Math.round(n).toLocaleString() : "Price n/a"; };
  function charScore(r, c) { return c === "smoky" ? r.sm : c === "sweet" ? r.sw : c === "rich" ? r.ri : r.li; }
  function slugOf(r) { return (r.pr + " " + r.n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  // On the live site every story and rating has its own server-rendered page at /wa/<slug>; elsewhere (the artifact copy) the hash pages.
  var PATHS = !!window.WA_PATHS || /^\/wa\//.test(location.pathname);
  function bottleHref(x) { var r = typeof x === "number" ? (DATA && DATA[x]) : x; var s = r && r.slug ? r.slug : (typeof x === "string" ? x : ""); if (PATHS && s && !/^t20-/i.test(s)) return "/wa/" + encodeURIComponent(s); return "bottle.html#" + (s ? encodeURIComponent(s) : x); }
  function producerHref(name) { return "producer.html#" + encodeURIComponent(name); }
  var value = function (r) { return r.s - 80 - Math.log((r.p > 0 ? r.p : 60) / 30) * 4; };

  window.WA = { data: function () { return DATA; }, fmt: fmt, charScore: charScore, bottleHref: bottleHref, producerHref: producerHref, value: value, slugOf: slugOf };

  // Names that reached the archive with HTML entities ("Jacob&#039;s Pardon") read as text everywhere.
  var ENT = document.createElement("textarea");
  function unentText(v) { if (typeof v !== "string" || v.indexOf("&") < 0) return v; ENT.innerHTML = v; return ENT.value; }
  function unent(o) { if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) o[i] = typeof o[i] === "string" ? unentText(o[i]) : unent(o[i]); } else if (o && typeof o === "object") { for (var k in o) o[k] = typeof o[k] === "string" ? unentText(o[k]) : unent(o[k]); } return o; }
  function loaded(cb) {
    var el = document.getElementById("data");
    if (el) { DATA = JSON.parse(el.textContent); cb(DATA); return; }
    fetch("data.json").then(function (r) { return r.json(); }).then(function (d) { DATA = unent(d); cb(DATA); });
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

  /* The channel is on screen as soon as it loads. Hiding it and blurring it in showed a second design first. */
  function reveal() {}

  /* Page to page is a direct load. A crossfade kept the previous channel on screen. */
  function transitions() {}

  /* The ambient field: the same whisky shader, faint and slow, under every page, so the glass surfaces have something to blur. */
  function ambient() {
    var c = document.getElementById("field"); if (!c || !MOTION) return;
    var gl = initGL(c); if (!gl) return;
    var pointer = { x: 0.5, y: 0.5 }, target = { x: 0.5, y: 0.5 }, running = true;
    addEventListener("pointermove", function (e) { target.x = e.clientX / innerWidth; target.y = e.clientY / innerHeight; }, { passive: true });
    document.addEventListener("visibilitychange", function () { running = !document.hidden; if (running) requestAnimationFrame(frame); });
    var finder = document.body.classList.contains("finder-page");
    function frame(now) { if (!running) return; pointer.x += (target.x - pointer.x) * 0.04; pointer.y += (target.y - pointer.y) * 0.04; gl.render(now * (finder ? 0.85 : 0.6), finder ? 0.12 : 1, pointer, finder ? 1 : 0.55); requestAnimationFrame(frame); }
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

  /* The pour runs in the mast: the whisky video as a faint layer under the glass, on every page. Reduced motion gets the still. */
  function mastPour() {
    var mast = document.querySelector(".mast"); if (!mast || mast.querySelector(".mast-pour")) return;
    var wrap = document.createElement("div"); wrap.className = "mast-pour"; wrap.setAttribute("aria-hidden", "true");
    if (MOTION) { var v = document.createElement("video"); v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "metadata"; v.poster = "img/mast-swirl.jpg"; var src = document.createElement("source"); src.src = "mast-swirl.mp4"; src.type = "video/mp4"; v.appendChild(src); wrap.appendChild(v); var pl = v.play && v.play(); if (pl && pl.catch) pl.catch(function () {}); }
    else { var im = document.createElement("img"); im.src = "img/mast-swirl.jpg"; im.alt = ""; wrap.appendChild(im); }
    mast.insertBefore(wrap, mast.firstChild);
  }
  function mastState() {
    function set() { document.body.setAttribute("data-top", String(scrollY < 24)); }
    addEventListener("scroll", set, { passive: true }); set();
  }


  /* Editorial content: the index of recent stories and, on demand, the bodies. Both come from the CMS export. */
  var STORIES = null, ARTICLES = null;
  var SECTION = { news: "News", features: "Feature", guides: "Guide", cocktails: "Cocktails", travel: "Travel", life: "Whisky Life" };
  function when(d) { if (!d) return ""; var t = new Date(d + "T12:00:00"); return t.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (t.getFullYear() !== new Date().getFullYear() ? ", " + t.getFullYear() : ""); }
  // The index is the last twenty months; the archive back to 2016 loads only where a page needs it (opts.all), and is kept once loaded.
  var STORY_ARCHIVE = null, STORY_ARCHIVE_WAIT = null, STORIES_WAIT = null;
  function stories(cb, opts) {
    var all = opts && opts.all;
    function done() { if (!all) return cb(STORIES); if (STORY_ARCHIVE) return cb(STORIES.concat(STORY_ARCHIVE)); if (!STORY_ARCHIVE_WAIT) STORY_ARCHIVE_WAIT = fetch("stories-archive.json").then(function (r) { return r.ok ? r.json() : []; }, function () { return []; }).then(function (d) { STORY_ARCHIVE = d; return d; }); STORY_ARCHIVE_WAIT.then(function () { cb(STORIES.concat(STORY_ARCHIVE)); }); }
    if (STORIES) return done();
    if (!STORIES_WAIT) STORIES_WAIT = fetch("stories.json").then(function (r) { return r.json(); }).then(function (d) { STORIES = d; return d; });
    STORIES_WAIT.then(done);
  }
  function storyBySlug(slug, cb) { stories(function (recent) { var k = String(slug).toLowerCase(), hit = recent.filter(function (s) { return s.slug.toLowerCase() === k; })[0]; if (hit) return cb(hit, recent); stories(function (all) { cb(all.filter(function (s) { return s.slug.toLowerCase() === k; })[0] || null, all); }, { all: true }); }); }
  var ARTS = {};
  function article(slug, cb) { var k = shardOf(slug); if (ARTS[k]) return cb(ARTS[k][slug] || null); fetch("articles/" + k + ".json").then(function (r) { return r.json(); }).then(function (d) { ARTS[k] = d; cb(d[slug] || null); }, function () { cb(null); }); }
  var GLOSSARY = null;
  function glossary(cb) { if (GLOSSARY) return cb(GLOSSARY); fetch("glossary.json").then(function (r) { return r.json(); }).then(function (d) { GLOSSARY = d; cb(d); }); }
  var SECTION_HREF = { news: "stories.html#news", features: "stories.html#features", guides: "guides.html", cocktails: "cocktails.html", travel: "travel.html", life: "stories.html#life" };
  function initials(name) { return (name || "WA").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(); }
  function storyHref(st) { return (window.WA_PATHS || /^\/wa\//.test(location.pathname)) ? "/wa/" + encodeURIComponent(st.slug) : "story.html#" + st.slug; }
  function storyRow(st) { return '<a href="' + storyHref(st) + '">' + (st.hero ? '<img class="th" src="' + st.hero + '" alt="" loading="lazy">' : '<span class="tag">' + SECTION[st.sec] + '</span>') + '<span><span class="nm">' + st.title + '</span><span class="sub">' + (st.dek || SECTION[st.sec] + " · " + st.by) + '</span></span><span class="when">' + when(st.d) + "</span></a>"; }
  function storyCard(st, cls) { return '<a class="story ' + cls + (st.hero ? " has-img" : "") + '" href="' + storyHref(st) + '">' + (st.hero ? '<img src="' + st.hero + '" alt="" loading="lazy">' : "") + '<span class="tag">' + SECTION[st.sec] + '</span><h3>' + st.title + "</h3><p>" + (st.dek || "") + "</p></a>"; }
  window.WA.stories = stories; window.WA.storyBySlug = storyBySlug; window.WA.storiesAll = function (cb) { stories(cb, { all: true }); }; window.WA.article = article; window.WA.glossary = glossary; window.WA.SECTION_HREF = SECTION_HREF; window.WA.when = when; window.WA.SECTION = SECTION; window.WA.initials = initials; window.WA.storyHref = storyHref; window.WA.storyRow = storyRow; window.WA.storyCard = storyCard;


  /* The whole ratings archive (every published rating, names and numbers) and the notes, sharded by slug, on demand. */
  var ARCHIVE = null, NOTES = {};
  function archive(cb) {
    if (ARCHIVE) return cb(ARCHIVE);
    fetch("ratings.json").then(function (r) { return r.json(); }).then(function (d) {
      ARCHIVE = d.rows.map(function (row) { var o = {}; d.cols.forEach(function (c, i) { o[c] = typeof row[i] === "string" && row[i].indexOf("&") >= 0 ? unentText(row[i]) : row[i]; }); o.t = ""; return o; });
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
  function fillNotes(root) { decorateBuy(root);
    root.querySelectorAll(".bottle[data-slug], .lead-pour[data-slug], .shelf-bottle[data-slug]").forEach(function (card) {
      var p = card.querySelector("p[data-note]"); if (!p || p.textContent) return;
      var slug = card.getAttribute("data-slug");
      note(slug, function (f) { var r = ARCHIVE && ARCHIVE.bySlug[slug.toLowerCase()]; if (r && !r.f) { r.f = f; r.t = f.length > 110 ? f.slice(0, 110).replace(/\s\S*$/, "") + "…" : f; } if (p.hasAttribute("data-full")) p.textContent = !f ? "" : (f.length > 460 ? f.slice(0, 460).replace(/\s\S*$/, "") + "…" : f); else p.textContent = r && r.t ? r.t : (f.length > 110 ? f.slice(0, 110).replace(/\s\S*$/, "") + "…" : f); });
    });
  }
  function hashSlug() { if (window.WA_SLUG) return window.WA_SLUG; var h = (location.hash || "").slice(1); try { h = decodeURIComponent(h); } catch (e) {} return h; }
  // A hash URL (story.html#slug) on the live site becomes the item's own URL without a reload, so links, shares and bookmarks use it.
  function cleanUrl(slug) { if (!PATHS || window.WA_SLUG || !slug || /^t20-/i.test(slug) || !history.replaceState) return; window.WA_SLUG = slug; try { history.replaceState(null, "", "/wa/" + encodeURIComponent(slug)); } catch (e) {} }
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
  window.WA.PATHS = PATHS; window.WA.cleanUrl = cleanUrl; window.WA.archive = archive; window.WA.note = note; window.WA.fillNotes = fillNotes; window.WA.hashSlug = hashSlug; window.WA.find = find;

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

  /* Typos in the words that carry meaning ("peety", "smokey", "sherryed") are corrected before anything is matched. */
  var VOCAB = ["peat", "peaty", "peated", "smoky", "smoke", "smokey", "sherry", "sherried", "sweet", "rich", "light", "fruity", "floral", "spicy", "bourbon", "rye", "scotch", "irish", "japanese", "canadian", "islay", "speyside", "highland", "campbeltown", "lowland", "cheap", "value", "gift", "winter", "summer", "bottle", "whisky", "whiskey", "whiskies", "best", "under", "points", "single", "malt", "blended", "cask", "strength", "manhattan", "cocktail", "night", "friend", "budget"];
  function fixTypos(q) {
    var words = (window.WA.WORDS || []).concat(VOCAB);
    return q.split(/(\s+)/).map(function (tok) {
      var t = tok.toLowerCase().replace(/[^a-z]/g, ""); if (t.length < 4 || /\s/.test(tok)) return tok;
      if (INTENT.test(t) || words.indexOf(t) >= 0) return tok;
      var best = null, bd = 2;
      for (var i = 0; i < words.length; i++) { var w = words[i]; if (Math.abs(w.length - t.length) > 1) continue; var d = edit(t, w, 1); if (d < bd) { bd = d; best = w; } }
      return best ? tok.replace(/[A-Za-z]+/, best) : tok;
    }).join("");
  }
  function understand(raw) {
    var q = fixTypos(raw);
    var f = { types: [], price: null, score: null, chars: [], text: q, raw: raw, terms: nameTerms(q) };
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
      // Unasked-for trophies sink a little: a $7,500 bottle is not the answer to "peaty whisky".
      var reach = (!named && !f.price && r.p) ? (r.p > 1000 ? 5 : r.p > 400 ? 3 : r.p > 200 ? 1 : 0) : 0;
      return { r: r, rank: r.s + fit * 1.5 + ns * 6 + (r.d ? (+r.d.slice(0, 4) - 2013) * 0.15 : 0) - reach };
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
  window.WA.understand = understand; window.WA.apply = apply;
  function askBar() {
    var form = document.getElementById("askForm"); if (!form) return;
    var input = document.getElementById("askInput"), answer = document.getElementById("answer");
    var askedAt = 0;
    function ask(q) {
      if (!q.trim() || !DATA) return;
      askedAt = Date.now(); if (timer) clearTimeout(timer); document.querySelectorAll(".ask-menu").forEach(function (m) { m.setAttribute("data-open", "false"); });
      var f = understand(q);
      if (f.terms.length && !ARCHIVE) { archive(function () { ask(q); }); return; }
      var picks = apply(f, DATA);
      document.getElementById("answerFacets").innerHTML = facetLabels(f).map(function (l) { return '<span class="facet">' + l + "</span>"; }).join("") || '<span class="facet">everything</span>';
      document.getElementById("answerText").innerHTML = answerFor(f, picks);
      document.getElementById("answerPicks").innerHTML = picks.slice(0, 4).map(function (r) { return '<a class="pick" href="' + bottleHref(DATA.indexOf(r)) + '"><span class="sc score-type">' + r.s + '</span><span><span class="nm">' + r.n + '</span><span class="ct">' + r.c + "</span></span><span class=\"pr\">" + fmt(r.p) + "</span></a>"; }).join("");
      if (!answer.querySelector(".answer-close")) { var x = document.createElement("button"); x.type = "button"; x.className = "answer-close"; x.setAttribute("aria-label", "Clear the answer"); x.innerHTML = "&times;"; x.addEventListener("click", clearAnswer); document.getElementById("answerFacets").insertAdjacentElement("afterend", x); }
      answer.setAttribute("data-show", "true");
      setTimeout(function () { if (window.WA.scrollAnswer) window.WA.scrollAnswer(); else answer.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 50);
      if (window.WA.onAsk) window.WA.onAsk(f);
    }
    function clearAnswer() { answer.setAttribute("data-show", "false"); input.value = ""; input.focus(); if (window.WA.onAsk) window.WA.onAsk(null); }
    window.WA.clearAnswer = clearAnswer;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && answer.getAttribute("data-show") === "true") clearAnswer(); });
    form.addEventListener("submit", function (e) { e.preventDefault(); menu.setAttribute("data-open", "false"); ask(input.value); });
    // Predictive: bottles, producers, stories and taste words appear as you type; a tap opens them, Enter asks.
    var menu = document.createElement("div"); menu.className = "ask-menu"; menu.setAttribute("data-open", "false"); form.insertAdjacentElement("afterend", menu);
    var timer = null;
    function suggestFor(q) {
      if (Date.now() - askedAt < 1200) { menu.setAttribute("data-open", "false"); return; }
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
      if (STORIES) { STORIES.filter(function (st) { var hay = norm(st.title + " " + (st.tags || []).join(" ") + " " + (st.q || "")); return terms.every(function (t) { return hay.indexOf(t) >= 0; }); }).slice(0, 2).forEach(function (st) { html += '<a class="row" href="' + storyHref(st) + '"><span class="k">' + SECTION[st.sec] + '</span><span class="nm">' + st.title + "</span></a>"; }); }
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
  function shot(cat) {
    var c = String(cat || "");
    if (/rye/i.test(c)) return "img/bottle-rye.png";
    if (/japan/i.test(c)) return "img/bottle-japanese.png";
    if (/irish|poit/i.test(c)) return "img/bottle-irish.png";
    if (/blend/i.test(c)) return "img/bottle-blended.png";
    if (/scotch|single malt/i.test(c)) return "img/bottle-scotch.png";
    if (/bourbon|tennessee|corn|wheat|white whiskey|canadian|american/i.test(c)) return "img/bottle-bourbon.png";
    return "img/bottle-other.png";
  }
  function bottleSrc(r) { return (r && r.img) ? r.img : shot(r && r.c); }
  function bottleImg(r) {
    var src = bottleSrc(r), fb = shot(r && r.c);
    return '<img src="' + src + '" alt="" loading="lazy"' + (r && r.img ? ' data-stock="' + fb + '" onerror="this.onerror=null;this.src=this.getAttribute(\'data-stock\')"' : "") + ">";
  }
  window.WA.shot = shot; window.WA.bottleSrc = bottleSrc;
  function bottleCard(r, opts) {
    opts = opts || {};
    var idx = DATA.indexOf(r), on = opts.compare && opts.compare.indexOf(idx) >= 0;
    return '<article class="bottle has-img" data-pinned="' + !!on + '" data-slug="' + (r.slug || "") + '"><a class="thumb" href="' + bottleHref(idx) + '">' + bottleImg(r) + '</a><div class="top"><div class="score score-type">' + r.s + "<small>points</small></div><div class=\"cat\">" + r.c + '</div></div><div><h3><a href="' + bottleHref(idx) + '">' + r.n + "</a></h3><p style=\"margin-top:6px\" data-note>" + (r.t || "") + '</p></div><div class="foot"><span>' + fmt(r.p) + (r.a ? " · " + r.a + "%" : "") + "</span>" + (opts.compare ? '<button type="button" data-i="' + idx + '" aria-pressed="' + !!on + '">' + (on ? "Pinned" : "Compare") + "</button>" : '<a href="' + producerHref(r.pr) + '" style="color:var(--ink-3)">' + r.pr + "</a>") + '<span class="buy-slot"></span></div></article>';
  }
  window.WA.bottleCard = bottleCard;
/* The store: ratings matched to products at store.whiskyadvocate.com (shop.json), the catalog itself (store.json). */
var SHOP = null, STORE = null, SHOP_WAIT = [];
function shop(cb) { if (SHOP) return cb(SHOP, STORE); SHOP_WAIT.push(cb); if (SHOP_WAIT.length > 1) return; Promise.all([fetch("shop.json").then(function (r) { return r.json(); }), fetch("store.json").then(function (r) { return r.json(); })]).then(function (a) { SHOP = a[0]; STORE = {}; a[1].forEach(function (p) { STORE[p.h] = p; }); SHOP_WAIT.forEach(function (f) { f(SHOP, STORE); }); SHOP_WAIT = []; }).catch(function () { SHOP = {}; STORE = {}; SHOP_WAIT.forEach(function (f) { f(SHOP, STORE); }); }); }
function productFor(slug) { if (!SHOP || !slug) return null; var h = SHOP[slug]; return h && STORE[h] ? STORE[h] : null; }
function buyHref(p) { return "https://store.whiskyadvocate.com/products/" + p.h + "?utm_source=whiskyadvocate&utm_medium=site&utm_campaign=shop"; }
function buyChip(p, label) { return '<a class="buy-chip" href="' + buyHref(p) + '" target="_blank" rel="noopener">' + (label || (p.p ? "Buy · $" + Math.round(p.p) : "Buy")) + "</a>"; }
/* Every rendered card with a data-slug gets its Buy chip once the catalog is in. */
function decorateBuy(root) { shop(function () { (root || document).querySelectorAll("[data-slug]:not([data-shop])").forEach(function (card) { card.setAttribute("data-shop", "1"); var p = productFor(card.getAttribute("data-slug")); var slot = card.querySelector(".buy-slot"); if (slot) { if (p) slot.innerHTML = buyChip(p); return; } if (!p) return; var foot = card.querySelector(".foot"); if (foot) foot.insertAdjacentHTML("afterbegin", buyChip(p)); }); }); }
/* Anchor text: the first plain mention of each bottle in a story body becomes a link to its rating. */
function linkMentions(holder, picks) {
  var done = 0;
  picks.forEach(function (r) {
    var key = r.n.split(",")[0].replace(/\s*\(.*$/, "").trim(); if (key.length < 8) return;
    var walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode.closest("a, h1, h2, h3, .embed, figure") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    var node; while ((node = walker.nextNode())) { var at = node.data.toLowerCase().indexOf(key.toLowerCase()); if (at < 0) continue; var a = document.createElement("a"); a.href = bottleHref(r); a.className = "mention"; a.textContent = node.data.substr(at, key.length); var after = node.splitText(at); after.data = after.data.substr(key.length); node.parentNode.insertBefore(a, after); done += 1; break; }
  });
  return done;
}
window.WA.shop = shop; window.WA.productFor = productFor; window.WA.buyHref = buyHref; window.WA.buyChip = buyChip; window.WA.decorateBuy = decorateBuy; window.WA.linkMentions = linkMentions;


  /* Flavor compass drawing, reused on the finder and the bottle page */
  function setupCanvas(c) { var d = Math.min(devicePixelRatio || 1, 2); var w = c.clientWidth, h = c.clientHeight; c.width = w * d; c.height = h * d; var g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); return { g: g, w: w, h: h }; }
  function compassPoint(r, cx, cy, rad) {
    var hash = 0; for (var i = 0; i < r.n.length; i++) hash = (hash * 31 + r.n.charCodeAt(i)) % 100003;
    var sx = (Math.min(4, r.sw) - Math.min(4, r.sm)) / 4, sy = (Math.min(4, r.ri) - Math.min(4, r.li)) / 4;
    // The scores sit on a square grid; the square is mapped onto the disc so its corners reach the rim instead of piling against it,
    // and each bottle is scattered inside a small circle around its grid point.
    var ux = sx * Math.sqrt(1 - sy * sy / 2), uy = sy * Math.sqrt(1 - sx * sx / 2), a = (hash % 360) * Math.PI / 180, j = Math.sqrt((Math.floor(hash / 360) % 100) / 100) * rad * 0.1;
    var dx = ux * rad * 0.76 + Math.cos(a) * j, dy = uy * rad * 0.76 + Math.sin(a) * j, len = Math.hypot(dx, dy), lim = rad - 8;
    if (len > lim) { dx *= lim / len; dy *= lim / len; }   // every bottle stays inside the compass
    return { x: cx + dx, y: cy + dy };
  }
  /* Families and their colours, so the maps read by type instead of one wall of amber. */
  var FAMILIES = [["Scotch", /scotch/i, "#c9731d"], ["Bourbon", /bourbon|tennessee/i, "#a4432b"], ["Rye", /rye/i, "#7b4b8f"], ["Irish", /irish/i, "#3f7d5a"], ["Japanese & world", /japan|world|indian|french|taiwan|austral|english|welsh|german|swed|dan|finn|dutch|swiss/i, "#2f7f8f"], ["Canadian", /canad/i, "#b8952a"], ["Other", /./, "#8b7b6a"]];
  function family(c) { for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i][1].test(c || "")) return FAMILIES[i]; return FAMILIES[FAMILIES.length - 1]; }
  function dot(r, alpha) { var hex = family(r.c)[2]; return "rgba(" + parseInt(hex.slice(1, 3), 16) + "," + parseInt(hex.slice(3, 5), 16) + "," + parseInt(hex.slice(5, 7), 16) + "," + alpha + ")"; }
  function legend(el, rows) { if (!el) return; var seen = {}; rows.forEach(function (r) { seen[family(r.c)[0]] = (seen[family(r.c)[0]] || 0) + 1; }); el.innerHTML = FAMILIES.filter(function (f) { return seen[f[0]]; }).map(function (f) { return '<span><i style="background:' + f[2] + '"></i>' + f[0] + "</span>"; }).join(""); }
  function drawCompass(canvas, rows, highlight) {
    var f = setupCanvas(canvas), h = f.g, cx = f.w / 2, cy = f.h / 2, rad = Math.min(f.w, f.h) / 2 - 18, rule = "rgba(23,18,13,0.1)";
    if (rad <= 0) return { points: [], cx: cx, cy: cy, rad: 0 };   // a hidden canvas has no size yet
    h.clearRect(0, 0, f.w, f.h); h.strokeStyle = rule; h.beginPath(); h.arc(cx, cy, rad, 0, Math.PI * 2); h.stroke(); h.beginPath(); h.arc(cx, cy, rad / 2, 0, Math.PI * 2); h.stroke();
    h.beginPath(); h.moveTo(cx - rad, cy); h.lineTo(cx + rad, cy); h.moveTo(cx, cy - rad); h.lineTo(cx, cy + rad); h.stroke();
    var pts = rows.map(function (r) { var p = compassPoint(r, cx, cy, rad); h.beginPath(); h.arc(p.x, p.y, 2.4, 0, Math.PI * 2); h.fillStyle = r === highlight ? "transparent" : dot(r, r.s >= 92 ? 0.85 : 0.28); h.fill(); return { x: p.x, y: p.y, r: r }; });
    // The axis labels go on last, on a paper backing, so the dots never cover them.
    h.font = "10.5px JetBrains Mono, monospace"; h.textBaseline = "middle";
    [["SMOKY", cx - rad - 6, cy, "right"], ["SWEET", cx + rad + 6, cy, "left"], ["LIGHT", cx, cy - rad - 8, "center"], ["RICH", cx, cy + rad + 8, "center"]].forEach(function (l) {
      var tw = h.measureText(l[0]).width, x0 = l[3] === "right" ? l[1] - tw : l[3] === "center" ? l[1] - tw / 2 : l[1];
      x0 = Math.max(2, Math.min(f.w - tw - 2, x0));
      h.fillStyle = "rgba(255, 251, 244, 0.92)"; h.fillRect(x0 - 4, l[2] - 8, tw + 8, 16);
      h.fillStyle = "#8b7b6a"; h.textAlign = "left"; h.fillText(l[0], x0, l[2]);
    });
    h.textBaseline = "alphabetic";
    if (highlight) { var hp = compassPoint(highlight, cx, cy, rad); h.beginPath(); h.arc(hp.x, hp.y, 7, 0, Math.PI * 2); h.fillStyle = "#17120d"; h.fill(); h.beginPath(); h.arc(hp.x, hp.y, 11, 0, Math.PI * 2); h.strokeStyle = "#c9731d"; h.lineWidth = 1.5; h.stroke(); }
    return { points: pts, cx: cx, cy: cy, rad: rad };
  }
  window.WA.drawCompass = drawCompass; window.WA.family = family; window.WA.dot = dot; window.WA.legend = legend; window.WA.FAMILIES = FAMILIES; window.WA.setupCanvas = setupCanvas; window.WA.compassPoint = compassPoint;

  /* Hash routing helpers */
  window.WA.hashIndex = function () { var h = (location.hash || "").replace("#", ""); var i = parseInt(h, 10); return isNaN(i) ? null : i; };
  window.WA.hashName = function () { var h = (location.hash || "").replace("#", ""); return h ? decodeURIComponent(h) : null; };

  window.WA.ready = function (cb) { loaded(function (d) { entrance(); askBar(); reveal(); transitions(); mastPour(); mastState(); ambient(); parallax(); cb(d); }); };
})();

/* Newsletter sign-up: every form on the site posts to the site's own route, which writes to Braze. */
window.WA = window.WA || {};
WA.SIGNUP_URL = (location.hostname === "localhost" || /claude\.ai|claudeusercontent/.test(location.hostname) || location.protocol === "file:") ? "https://rss-project-ten.vercel.app/api/wa/newsletter" : "/api/wa/newsletter";
WA.signup = function (payload, done) {
  fetch(WA.SIGNUP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    .then(function (r) { return r.json().then(function (j) { j.ok = r.ok && j.ok; return j; }); })
    .catch(function () { return { ok: false, error: "The sign-up could not reach the server.", fallback: "https://www.winespectator.com/newsletter/whiskyadvocate" }; })
    .then(done);
};
document.querySelectorAll("form.nl-strip").forEach(function (f) {
  f.addEventListener("submit", function (e) {
    e.preventDefault(); var email = f.querySelector("input[type=email]"), note = f.querySelector(".nl-note"), btn = f.querySelector("button");
    if (!email.validity.valid || !email.value) { note.textContent = "Add your email first."; email.focus(); return; }
    btn.disabled = true; note.textContent = "Signing you up…";
    WA.signup({ email: email.value, lists: (f.getAttribute("data-lists") || "notes,weekend").split(","), source: f.getAttribute("data-source") || location.pathname }, function (res) {
      btn.disabled = false;
      if (res.ok) { note.textContent = "You are in. Welcome."; btn.textContent = "Signed up"; f.setAttribute("data-done", "true"); }
      else note.innerHTML = res.error + (res.fallback ? ' <a href="' + res.fallback + '">Open the sign-up page</a>.' : "");
    });
  });
});

/* The WhiskyFest app: one link that knows where to go. iPhone and iPad go to the App Store, Android to Google Play, everyone else to the app page. */
WA.APP = { ios: "https://apps.apple.com/app/id6796849673", android: "https://play.google.com/store/apps/details?id=com.mshanken.whiskyfest2026", page: "app.html" };
WA.appStore = function () { var ua = navigator.userAgent || ""; if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return WA.APP.ios; if (/Android/.test(ua)) return WA.APP.android; return WA.APP.page; };
document.querySelectorAll("a[data-app-link]").forEach(function (a) { a.href = WA.appStore(); if (a.href !== location.href && /apple|google/.test(a.href)) { a.target = "_blank"; a.rel = "noopener"; } });

/* Ask Whisky Advocate: a chat on every page. The browser finds candidate bottles with its own search, the site's route asks Claude, the answer comes back with the bottles it recommends. */
(function () {
  if (document.getElementById("waChat")) return;
  WA.ASK_URL = (location.hostname === "localhost" || /claude\.ai|claudeusercontent/.test(location.hostname) || location.protocol === "file:") ? "https://rss-project-ten.vercel.app/api/wa/ask" : "/api/wa/ask";
  var turns = [], busy = false;
  var root = document.createElement("div"); root.id = "waChat"; root.setAttribute("data-open", "false");
  root.innerHTML = '<button type="button" class="chat-fab" id="waChatFab" aria-label="Ask Whisky Advocate" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor"/></svg><span>Ask Whisky Advocate</span></button>'
    + '<section class="chat-panel glass" role="dialog" aria-label="Ask Whisky Advocate"><header><div><span class="mono">Ask Whisky Advocate</span><strong>What are you drinking tonight?</strong></div><button type="button" class="chat-close" id="waChatClose" aria-label="Close">&times;</button></header>'
    + '<div class="chat-log" id="waChatLog"><div class="chat-msg bot"><p>Ask me for a bottle, a style, a price, or what to pour for someone. I answer from Whisky Advocate\u2019s own ratings, 8,000 and counting.</p></div><div class="chat-follow" id="waChatSeed"><button type="button">A smoky Islay under $80</button><button type="button">A first bourbon for a friend</button><button type="button">What should I bring to a dinner?</button></div></div>'
    + '<form class="chat-form" id="waChatForm" autocomplete="off"><input id="waChatInput" type="text" placeholder="Ask anything about whisky" aria-label="Your question" maxlength="400"><button type="submit" class="pill solid" id="waChatSend">Ask</button></form></section>';
  document.body.appendChild(root);
  var log = document.getElementById("waChatLog"), input = document.getElementById("waChatInput"), fab = document.getElementById("waChatFab");
  function open(on) { root.setAttribute("data-open", String(on)); fab.setAttribute("aria-expanded", String(on)); if (on) setTimeout(function () { input.focus(); }, 60); }
  fab.addEventListener("click", function () { open(root.getAttribute("data-open") !== "true"); });
  document.getElementById("waChatClose").addEventListener("click", function () { open(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.getAttribute("data-open") === "true") open(false); });
  document.querySelectorAll("[data-open-chat]").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); open(true); }); });
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function add(html, cls) { var d = document.createElement("div"); d.className = "chat-msg " + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function candidates(q) {
    var f = WA.understand ? WA.understand(q) : null; if (!f || !WA.apply) return [];
    var rows = WA.apply(f, WA.data() || []).slice(0, 12);
    return rows.map(function (r) { return { slug: r.slug || "", name: r.n, score: r.s, price: r.p || null, category: r.c, producer: r.pr, note: (r.t || "").slice(0, 240) }; });
  }
  function askIt(q) {
    q = (q || "").trim(); if (!q || busy) return;
    var seed = document.getElementById("waChatSeed"); if (seed) seed.remove();
    add("<p>" + esc(q) + "</p>", "me"); turns.push({ role: "user", text: q });
    var wait = add('<p class="chat-wait"><i></i><i></i><i></i></p>', "bot"); busy = true; document.getElementById("waChatSend").disabled = true; input.value = "";
    var bottles = candidates(q), ctx = WA.context || null;
    if (ctx && ctx.slugs && ctx.slugs.length) { var rows = (WA.data() || []), onPage = ctx.slugs.map(function (sl) { return rows.filter(function (x) { return x.slug === sl; })[0]; }).filter(Boolean); var have = {}; bottles.forEach(function (b) { have[b.slug] = true; }); onPage.forEach(function (x) { if (!have[x.slug]) bottles.unshift(WA.candidate ? WA.candidate(x, "on the page the reader is viewing") : { slug: x.slug, name: x.n, score: x.s, price: x.p > 0 ? x.p : null, category: x.c, producer: x.pr || "" }); }); bottles = bottles.slice(0, 14); }
    var sent = turns.slice(-8); if (ctx && ctx.title && sent.filter(function (t) { return t.role === "user"; }).length === 1) { sent = sent.slice(); sent[sent.length - 1] = { role: "user", text: q + "\n\n(The reader is on " + ctx.kind + " page \"" + ctx.title + "\". " + (ctx.summary || "") + ")" }; }
    fetch(WA.ASK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turns: sent, bottles: bottles, page: document.title }) })
      .then(function (r) { return r.json().then(function (j) { j.ok = r.ok; return j; }); })
      .catch(function () { return { ok: false, error: "The assistant could not be reached." }; })
      .then(function (res) {
        busy = false; document.getElementById("waChatSend").disabled = false; wait.remove();
        if (!res.ok || !res.answer) { add("<p>" + esc(res.error || "Something went wrong. Try again.") + "</p>", "bot"); return; }
        turns.push({ role: "assistant", text: res.answer });
        var bySlug = {}; bottles.forEach(function (b) { bySlug[b.slug] = b; });
        var cards = (res.picks || []).map(function (s) { var b = bySlug[s]; if (!b) return ""; var r = (WA.data() || []).filter(function (x) { return x.slug === s; })[0]; var href = r ? WA.bottleHref(r) : "finder.html"; return '<a class="chat-pick" href="' + href + '"><span class="sc score-type">' + b.score + '</span><span><span class="nm">' + esc(b.name) + '</span><span class="ct">' + esc(b.category) + "</span></span><span class=\"pr\">" + (b.price ? "$" + b.price : "") + "</span></a>"; }).join("");
        var follow = (res.followups || []).map(function (f) { return '<button type="button">' + esc(f) + "</button>"; }).join("");
        add("<p>" + esc(res.answer) + "</p>" + (cards ? '<div class="chat-picks">' + cards + "</div>" : "") + (follow ? '<div class="chat-follow">' + follow + "</div>" : ""), "bot");
        WA.decorateBuy && WA.decorateBuy(log);
      });
  }
  log.addEventListener("click", function (e) { var b = e.target.closest(".chat-follow button"); if (b) askIt(b.textContent); });
  document.getElementById("waChatForm").addEventListener("submit", function (e) { e.preventDefault(); askIt(input.value); });
  WA.askChat = function (q) { open(true); if (q) askIt(q); };
  WA.setContext = function (ctx) { WA.context = ctx; var seed = document.getElementById("waChatSeed"); var strong = document.querySelector("#waChat .chat-panel header strong"); if (strong && ctx && ctx.title) strong.textContent = ctx.kind === "story" ? "Ask about this story, or anything else." : ctx.kind === "bottle" ? "Ask about this bottle, or anything else." : ctx.kind === "producer" ? "Ask about " + ctx.title + ", or anything else." : ctx.kind === "cocktail" ? "Ask about this drink, or anything else." : strong.textContent; };
})();

/* Site search: a magnifier in the mast on every page opens an overlay that searches bottles, stories, producers and cocktails as you type. Slash or Cmd+K opens it too. */
(function () {
  var tools = document.querySelector(".mast .tools"); if (!tools || document.getElementById("waSearch")) return;
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "pill search-btn"; btn.setAttribute("aria-label", "Search the site"); btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Search</span>';
  tools.insertAdjacentElement("afterbegin", btn);
  var ov = document.createElement("div"); ov.id = "waSearch"; ov.setAttribute("data-open", "false");
  ov.innerHTML = '<div class="search-box glass"><form class="search-form" id="waSearchForm" autocomplete="off"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><input id="waSearchInput" type="search" placeholder="Search bottles, stories, producers, cocktails" aria-label="Search"><button type="button" class="search-close" id="waSearchClose" aria-label="Close">&times;</button></form><div class="search-results" id="waSearchResults"><p class="muted">Type a bottle, a distillery, a cocktail or a subject. Enter opens Ratings with your words.</p></div></div>';
  document.body.appendChild(ov);
  var input = document.getElementById("waSearchInput"), results = document.getElementById("waSearchResults"), timer = null, stories = null, cocktails = null;
  function open(on) { ov.setAttribute("data-open", String(on)); document.body.classList.toggle("search-open", on); if (on) { setTimeout(function () { input.focus(); input.select(); }, 40); if (WA.archive) WA.archive(function () { if (input.value) run(input.value); }); if (!stories && WA.storiesAll) WA.storiesAll(function (s) { stories = s; if (input.value) run(input.value); }); if (!cocktails && WA.cocktails) WA.cocktails(function (c) { cocktails = c; }); } }
  btn.addEventListener("click", function () { open(true); });
  document.getElementById("waSearchClose").addEventListener("click", function () { open(false); });
  ov.addEventListener("click", function (e) { if (e.target === ov) open(false); });
  document.addEventListener("keydown", function (e) {
    var typing = /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || "");
    if (e.key === "Escape" && ov.getAttribute("data-open") === "true") { open(false); return; }
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); open(true); }
  });
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mark(text, terms) { var out = esc(text); terms.forEach(function (t) { if (t.length < 3) return; out = out.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i"), "<b>$1</b>"); }); return out; }
  function run(q) {
    q = q.trim(); if (!q) { results.innerHTML = '<p class="muted">Type a bottle, a distillery, a cocktail or a subject. Enter opens Ratings with your words.</p>'; return; }
    var terms = WA.nameTerms(q), low = q.toLowerCase(), groups = [];
    var data = WA.data() || [];
    if (terms.length) {
      var bottles = []; for (var i = 0; i < data.length; i++) { var ns = WA.nameScore(terms, data[i]); if (ns) bottles.push({ r: data[i], ns: ns }); }
      bottles.sort(function (a, b) { return b.ns - a.ns || b.r.s - a.r.s; });
      if (bottles.length) groups.push({ title: "Bottles", more: "finder.html?q=" + encodeURIComponent(q), items: bottles.slice(0, 5).map(function (x) { return '<a href="' + WA.bottleHref(x.r) + '"><span class="sc score-type">' + x.r.s + "</span><span><span class=\"nm\">" + mark(x.r.n, terms) + '</span><span class="ct">' + esc(x.r.c) + (x.r.p ? " · $" + x.r.p : "") + "</span></span></a>"; }) });
      var P = WA.producers(data), ps = Object.keys(P).filter(function (n) { return terms.every(function (t) { return n.toLowerCase().indexOf(t) >= 0; }) || terms.some(function (t) { return n.toLowerCase().indexOf(t) === 0; }); }).sort(function (a, b) { return P[b].n - P[a].n; }).slice(0, 4);
      if (ps.length) groups.push({ title: "Producers", items: ps.map(function (n) { return '<a href="' + WA.producerHref(n) + '"><span class="ct-only">' + mark(n, terms) + "</span><span class=\"ct\">" + P[n].n + " ratings</span></a>"; }) });
    }
    if (stories) {
      var words = low.split(/\s+/).filter(function (w) { return w.length >= 3; });
      var st = stories.map(function (s) { var hay = (s.title + " " + (s.dek || "") + " " + (s.tags || []).join(" ") + " " + (s.q || "")).toLowerCase(); var hit = words.filter(function (w) { return hay.indexOf(w) >= 0; }).length; return hit === words.length && words.length ? { s: s, hit: hit + (s.title.toLowerCase().indexOf(low) >= 0 ? 2 : 0) } : null; }).filter(Boolean).sort(function (a, b) { return b.hit - a.hit || (a.s.d < b.s.d ? 1 : -1); }).slice(0, 5);
      if (st.length) groups.push({ title: "Stories", more: "stories.html", items: st.map(function (x) { return '<a href="' + WA.storyHref(x.s) + '"><span class="ct-only">' + mark(x.s.title, words) + '</span><span class="ct">' + esc(WA.SECTION[x.s.sec] || "") + " · " + WA.when(x.s.d) + "</span></a>"; }) });
    }
    if (cocktails) {
      var cs = cocktails.filter(function (c) { return (c.name || c.title || "").toLowerCase().indexOf(low) >= 0; }).slice(0, 4);
      if (cs.length) groups.push({ title: "Cocktails", items: cs.map(function (c) { return '<a href="cocktail.html#' + encodeURIComponent(c.slug || c.id || "") + '"><span class="ct-only">' + mark(c.name || c.title, [low]) + "</span></a>"; }) });
    }
    results.innerHTML = groups.length ? groups.map(function (g) { return '<section><h4 class="mono">' + g.title + (g.more ? ' <a href="' + g.more + '">All</a>' : "") + "</h4>" + g.items.join("") + "</section>"; }).join("") : '<p class="muted">Nothing by that name. Press Enter to search the ratings for “' + esc(q) + '”.</p>';
  }
  input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { run(input.value); }, 90); });
  document.getElementById("waSearchForm").addEventListener("submit", function (e) { e.preventDefault(); var first = results.querySelector("section a"); if (first && results.querySelectorAll("section").length === 1 && results.querySelectorAll("section a").length === 1) { location.href = first.href; return; } location.href = "finder.html?q=" + encodeURIComponent(input.value.trim()); });
  WA.openSearch = function () { open(true); };
})();

var waAds = document.createElement("script");
waAds.src = "ads.js";
document.body.appendChild(waAds);

/* The menu: five channels stay in the bar, the rest open from the button at the left. */
(function () {
  var mast = document.querySelector(".mast"), nav = document.querySelector(".mast nav");
  if (!mast || !nav || document.getElementById("waMenu")) return;
  var KEEP = ["Ratings", "Stories", "Guides", "Cocktails", "Top 20"];
  nav.querySelectorAll("a").forEach(function (a) { if (KEEP.indexOf(a.textContent.trim()) < 0) a.setAttribute("data-more", ""); });
  var left = document.createElement("div"); left.className = "mast-left";
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "burger"; btn.setAttribute("aria-label", "Menu"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "waMenu");
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  mast.insertBefore(left, nav); left.appendChild(btn); left.appendChild(nav);
  var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  function link(href, text) { return '<a href="' + href + '"' + (href.toLowerCase() === here ? ' aria-current="page"' : "") + '>' + text + "</a>"; }
  var ov = document.createElement("div"); ov.id = "waMenu"; ov.setAttribute("data-open", "false"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Site menu");
  ov.innerHTML = '<div class="menu-sheet"><div class="menu-head"><a href="index.html"><img src="logo.svg" alt="Whisky Advocate" width="620" height="212"></a><button type="button" class="menu-close" aria-label="Close menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>'
    + '<div class="menu-group" data-cols><span class="mono">Read</span>' + [["finder.html", "Ratings"], ["stories.html", "Stories"], ["stories.html#news", "News"], ["stories.html#features", "Features"], ["guides.html", "Guides"], ["cocktails.html", "Cocktails"], ["travel.html", "Travel"], ["top20.html", "Top 20"], ["ninety.html", "90+ Club"], ["video.html", "Video"], ["producers.html", "Producers"], ["industry.html", "Industry"]].map(function (l) { return link(l[0], l[1]); }).join("") + "</div>"
    + '<div class="menu-cols"><div class="menu-group"><span class="mono">Tools</span>' + [["tools.html", "All tools"], ["finder.html", "Ratings search"], ["index.html#scan", "Shelf scan"], ["cocktails.html", "Cocktail cabinet"], ["guides.html#glossaryBand", "Glossary"], ["retailers.html", "Retailers"]].map(function (l) { return link(l[0], l[1]); }).join("") + "</div>"
    + '<div class="menu-group"><span class="mono">Whisky Advocate</span>' + [["index.html#whiskyfest", "WhiskyFest"], ["app.html", "WhiskyFest app"], ["newsletter.html", "Newsletters"], ["https://store.whiskyadvocate.com/", "Store"], ["about.html", "About"], ["contact.html", "Contact"], ["contact.html#advertise", "Advertise"], ["privacy.html", "Privacy"]].map(function (l) { return link(l[0], l[1]); }).join("") + "</div></div>"
    + '<div class="menu-cta"><a class="pill solid" href="https://sub.whiskyadvocate.com/pubs/M5/MAV/WAcom_subscribe_4for22_PC.jsp?cds_page_id=274306&amp;cds_mag_code=MAV">Subscribe to the magazine</a><a class="pill" href="newsletter.html">Newsletters</a></div>'
    + '<div class="menu-social" aria-label="Whisky Advocate on social media"><a href="https://www.instagram.com/whiskyadvocate/" aria-label="Instagram" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a><a href="https://www.facebook.com/WhiskyAdvocate/" aria-label="Facebook" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.5-1.5h1.5V5c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8V11H8v3h2.6v7z"/></svg></a><a href="https://x.com/WhiskyAdvocate" aria-label="X" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3l-7 8 8.2 10h-6.4l-5-6.5L4.6 21h-3l7.5-8.6L1.3 3h6.6l4.5 6z"/></svg></a><a href="https://www.youtube.com/user/WhiskyAdvocate" aria-label="YouTube" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2c-.2-1.4-.9-2.2-2.3-2.4C17.5 5.5 12 5.5 12 5.5s-5.5 0-7.7.3C2.9 6 2.2 6.8 2 8.2 1.7 10 1.7 12 1.7 12s0 2 .3 3.8c.2 1.4.9 2.2 2.3 2.4 2.2.3 7.7.3 7.7.3s5.5 0 7.7-.3c1.4-.2 2.1-1 2.3-2.4.3-1.8.3-3.8.3-3.8s0-2-.3-3.8zM9.9 15.1V8.9l5.5 3.1z"/></svg></a></div></div>';
  document.body.appendChild(ov);
  var last = null;
  function open(on) { ov.setAttribute("data-open", String(on)); btn.setAttribute("aria-expanded", String(on)); document.body.setAttribute("data-menu", String(on)); if (on) { last = document.activeElement; var f = ov.querySelector(".menu-group a"); if (f) f.focus(); } else if (last && last.focus) { last.focus(); } }
  btn.addEventListener("click", function () { open(ov.getAttribute("data-open") !== "true"); });
  ov.querySelector(".menu-close").addEventListener("click", function () { open(false); });
  ov.addEventListener("click", function (e) { if (e.target === ov) open(false); });
  ov.addEventListener("click", function (e) { if (e.target.closest("a")) open(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ov.getAttribute("data-open") === "true") open(false); });
})();

/* Recommendations: the page hands its candidates to /api/wa/recommend and an editor-grade model chooses what belongs beside it. */
(function () {
  var cache = {}, inflight = {};
  window.WA.recommend = function (req, cb) {
    var key = req.kind + ":" + req.slug + ":" + (req.candidates || []).map(function (c) { return c.slug; }).join(",");
    if (cache[key]) return cb(cache[key]);
    if (!req.candidates || !req.candidates.length) return cb(null);
    if (inflight[key]) { inflight[key].push(cb); return; } inflight[key] = [cb]; cb = function (j) { var cbs = inflight[key] || []; delete inflight[key]; cbs.forEach(function (f) { f(j); }); };
    fetch("/api/wa/recommend", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(req) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.picks) cache[key] = j; cb(j && j.picks ? j : null); }, function () { cb(null); });
  };
  window.WA.candidate = function (r, how, note) { return { slug: r.slug, name: r.n, score: r.s, price: r.p > 0 ? r.p : null, category: r.c, producer: r.pr || "", how: how, note: note || "" }; };
  window.WA.withNotes = function (rows, cb) { var left = rows.length, notes = {}; if (!left) return cb(notes); rows.forEach(function (r) { WA.note(r.slug, function (t) { notes[r.slug] = (t || "").replace(/\s+/g, " ").slice(0, 220); if (--left === 0) cb(notes); }); }); };
  window.WA.recCards = function (picks, byslug) { return picks.map(function (p) { var r = byslug[p.slug]; return r ? '<div class="rec">' + WA.bottleCard(r) + (p.why ? '<p class="rec-why">' + p.why + "</p>" : "") + "</div>" : ""; }).join(""); };
})();

/* Measurement: one hook for everything a reader does that the editors will want to count. GA4 loads when a page carries <meta name="ga4" content="G-..."> (or window.WA_GA4); without it events stay in memory for the console. */
(function () {
  var id = (document.querySelector('meta[name="ga4"]') || {}).content || window.WA_GA4 || "";
  WA.events = [];
  WA.track = function (name, data) {
    var payload = Object.assign({ page: location.pathname.split("/").pop() || "index.html", hash: (location.hash || "").slice(1, 120) }, data || {});
    WA.events.push({ name: name, data: payload, at: Date.now() });
    if (window.gtag) window.gtag("event", name, payload);
  };
  if (id && !window.gtag) {
    var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id); document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); }; window.gtag("js", new Date()); window.gtag("config", id, { send_page_view: true });
  }
  // What the pages already do, counted: site search, the ask bar, the chat, the shelf scan, sign-ups, and the picks readers tap.
  document.addEventListener("submit", function (e) {
    var f = e.target; if (!(f instanceof HTMLFormElement)) return;
    if (f.id === "waSearchForm") WA.track("site_search", { q: (document.getElementById("waSearchInput") || {}).value });
    else if (f.id === "askForm") WA.track("ask", { q: (document.getElementById("askInput") || {}).value, context: (WA.context || {}).kind || "" });
    else if (f.id === "waChatForm") WA.track("chat_ask", { q: (document.getElementById("waChatInput") || {}).value, context: (WA.context || {}).kind || "" });
    else if (f.classList.contains("nl-strip") || f.id === "nlForm") WA.track("newsletter_signup", { source: f.getAttribute("data-source") || f.id || "" });
  }, true);
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "scanFile") WA.track("shelf_scan"); }, true);
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a"); if (!a) return;
    if (a.closest(".rec")) WA.track("recommendation_click", { to: a.getAttribute("href"), context: (WA.context || {}).kind || "" });
    else if (a.classList.contains("buy-chip") || /store\.whiskyadvocate\.com/.test(a.href)) WA.track("store_click", { to: a.href.slice(0, 160) });
    else if (/tixr\.com/.test(a.href)) WA.track("tickets_click");
    else if (a.hasAttribute("data-app-link") || /apps\.apple\.com|play\.google\.com/.test(a.href)) WA.track("app_click");
    else if (a.classList.contains("mention")) WA.track("mention_click", { to: a.getAttribute("href") });
  }, true);
})();

/* Sticky filter bars (2026-11-01): WA.stickyFilters(bar) pins a filter row under the mast once you scroll past it.
   The bar needs class "filter-bar"; a sentinel is inserted before it, and the bar gets "stuck" while pinned. Choosing a
   filter while stuck scrolls back to the top of the results so the new list is in view. Static on phones (CSS). */
(function () {
  window.WA = window.WA || {};
  WA.stickyFilters = function (bar) {
    if (!bar) return;
    var mast = document.querySelector(".mast");
    function mastH() { return mast ? mast.offsetHeight : 64; }
    function setVar() { document.documentElement.style.setProperty("--mast-h", mastH() + "px"); }
    setVar(); addEventListener("resize", setVar);
    var sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    bar.parentNode.insertBefore(sentinel, bar);
    var queued = false;
    function check() { queued = false; bar.classList.toggle("stuck", sentinel.getBoundingClientRect().top < mastH() - 1); }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(check); } }
    addEventListener("scroll", queue, { passive: true }); addEventListener("resize", queue);
    if ("ResizeObserver" in window) new ResizeObserver(queue).observe(document.body);
    check();
    bar.addEventListener("click", function (e) {
      if (!e.target.closest("button") || !bar.classList.contains("stuck") || getComputedStyle(bar).position !== "sticky") return;
      requestAnimationFrame(function () {
        var top = sentinel.getBoundingClientRect().top + scrollY - mastH();
        scrollTo({ top: top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
    });
  };
})();

/* Video players (2026-11-01): WA.playEmbed(button) plays a poster button's film on the first click everywhere.
   - JW Player films play in a native <video> started inside the click: the HLS manifest where the browser plays HLS
     (Safari, iOS), else the MP4 rendition from JW's media feed, prefetched on hover, focus, touch or when the poster scrolls
     into view. Their iframe player never autoplayed, so every JW film took two clicks.
   - YouTube: the plain embed with autoplay where that works (Chrome and Edge desktop); on Safari and phones the click is lost
     through the iframe load, so the YouTube player API starts it once ready (the lite-youtube-embed approach). The API is
     preloaded on hover or touch.
   The button is replaced by a div with the same classes plus "playing", so player controls never sit inside a button. */
(function () {
  window.WA = window.WA || {};
  var APPLE_OR_MOBILE = /Apple/.test(navigator.vendor || "") || /Mobi/.test(navigator.userAgent);
  var jw = {}, ytApi = null;
  function embedOf(el) { var h = el && el.closest("[data-embed]"); return h ? h.getAttribute("data-embed") : ""; }
  function jwId(src) { var m = /cdn\.jwplayer\.com\/players\/([A-Za-z0-9]+)-/.exec(src || ""); return m ? m[1] : ""; }
  function ytId(src) { var m = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/.exec(src || ""); return m ? m[1] : ""; }
  function jwSources(id) {
    if (!jw[id]) jw[id] = fetch("https://cdn.jwplayer.com/v2/media/" + id).then(function (r) { return r.json(); }).then(function (d) {
      var srcs = ((d.playlist || [])[0] || {}).sources || [];
      jw[id].mp4 = srcs.filter(function (x) { return x.type === "video/mp4" && x.height; }).sort(function (a, b) { return a.height - b.height; });
      return jw[id].mp4;
    }).catch(function () { jw[id].mp4 = []; return []; });
    return jw[id];
  }
  function loadYT() {
    if (!ytApi) ytApi = new Promise(function (res, rej) {
      if (window.YT && window.YT.Player) return res();
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); res(); };
      var el = document.createElement("script"); el.src = "https://www.youtube.com/iframe_api"; el.async = true; el.onerror = rej; document.head.appendChild(el);
    });
    return ytApi;
  }
  function prefetch(el) {
    var src = embedOf(el); if (!src) return;
    var id = jwId(src);
    if (id) { jwSources(id); return; }
    if (APPLE_OR_MOBILE && ytId(src)) loadYT().catch(function () {});
  }
  ["pointerover", "focusin", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { var b = e.target.closest && e.target.closest(".frame, .top20-play"); if (b && !b.classList.contains("playing")) prefetch(b); }, { passive: true });
  });
  var seen = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { prefetch(en.target); seen.unobserve(en.target); } });
  }, { rootMargin: "200px" }) : null;
  WA.watchPosters = function (root) { if (!seen) return; (root || document).querySelectorAll(".frame:not(.playing), .top20-play:not(.playing)").forEach(function (b) { if (jwId(embedOf(b))) seen.observe(b); }); };
  function iframe(box, src) { box.innerHTML = '<iframe src="' + src + (src.indexOf("?") >= 0 ? "&" : "?") + (ytId(src) ? "autoplay=1&playsinline=1" : "autostart=true") + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe>'; }
  function pickMp4(list, box) {
    var want = Math.max(720, Math.min(1080, Math.ceil((box.offsetWidth || 960) * 9 / 16 * (window.devicePixelRatio || 1))));
    var fit = list.filter(function (x) { return x.height >= want; })[0];
    return (fit || list[list.length - 1]).file;
  }
  WA.playEmbed = function (btn) {
    if (!btn || btn.classList.contains("playing")) return;
    var src = embedOf(btn); if (!src) return;
    var poster = btn.querySelector("img"); poster = poster ? poster.currentSrc || poster.src : "";
    var box = document.createElement("div");
    box.className = btn.className + " playing";
    btn.replaceWith(box);
    if (WA.track) WA.track("video_play", { src: src });
    var id = jwId(src), yid = ytId(src);
    if (id) {
      var v = document.createElement("video");
      v.controls = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; if (poster) v.poster = poster;
      box.appendChild(v);
      var go = function (url) { v.src = url; var p = v.play(); if (p && p.catch) p.catch(function () {}); };
      // A full-quality MP4 first: the adaptive HLS stream opens on its lowest rendition and looks grainy for a few
      // seconds. HLS only when the MP4 list is not in yet and the browser plays HLS (keeps the click on Safari).
      var entry = jwSources(id);
      if (entry.mp4 && entry.mp4.length) { go(pickMp4(entry.mp4, box)); return; }
      if (v.canPlayType("application/vnd.apple.mpegurl")) { go("https://cdn.jwplayer.com/manifests/" + id + ".m3u8"); return; }
      entry.then(function (list) { if (list.length) go(pickMp4(list, box)); else { box.innerHTML = ""; iframe(box, src); } });
      return;
    }
    if (yid && APPLE_OR_MOBILE) {
      var ph = document.createElement("div"); box.appendChild(ph);
      loadYT().then(function () {
        new YT.Player(ph, { width: "100%", height: "100%", videoId: yid, playerVars: { autoplay: 1, playsinline: 1, rel: 0 }, events: { onReady: function (e) { e.target.playVideo(); } } });
      }).catch(function () { iframe(box, src); });
      return;
    }
    iframe(box, src);
  };
})();

/* Sponsored content (2026-11-01). Paid stories carry "sp" in the story index (the export reads the editor's flag in the
   CMS, else the legacy "Sponsored Content" byline or tag), and sponsored.json lists every one, archive included.
   WA.isSponsored(story) answers for one story; the labeler puts a "Sponsored" chip on every link to a paid story
   anywhere on the page (feed rows, cards, picks, the rotator, search, recommendations, video cards), including links
   rendered later, so no feed can show one unlabeled. Inline links inside story text are left alone. */
(function () {
  window.WA = window.WA || {};
  var paid = {}, ready = false, queued = false;
  function key(slug) { try { return decodeURIComponent(String(slug || "")).toLowerCase(); } catch (e) { return String(slug || "").toLowerCase(); } }
  WA.markSponsored = function (slug, by) { if (!slug) return; var k = key(slug); if (!(k in paid) || by) { paid[k] = by || paid[k] || ""; queue(true); } };
  WA.sponsorOf = function (slug) { return paid[key(slug)] || ""; };
  WA.isSponsored = function (st) {
    if (!st) return false;
    if (st.sp) return true;
    if (key(st.slug) in paid) return true;
    return /sponsor/i.test(st.by || "") || (st.tags || []).some(function (t) { return /^\s*sponsored( content)?\s*$/i.test(t); });
  };
  WA.sponsorChip = function () { return '<span class="sp-chip">Sponsored</span>'; };
  var SKIP = ".prose p, .prose li, .prose blockquote, .prose h2, .prose h3, .crumbs, nav, footer, #waMenu, .toc";
  function place(a) {
    var host = a.closest(".video-card") || a;
    if (host.querySelector(".sp-chip")) return;
    var t = host.querySelector(".tag, .ct, .mono");
    if (t && /^\s*sponsored/i.test(t.textContent)) return;
    var at = t || host.querySelector("h3, .nm, strong, .ct-only") || a;
    at.insertAdjacentHTML("afterbegin", WA.sponsorChip());
    host.classList.add("is-sponsored");
  }
  function scan(all) {
    queued = false;
    var links = document.querySelectorAll(all ? 'a[href*="story.html#"], a[href^="/wa/"]' : 'a[href*="story.html#"]:not([data-spc]), a[href^="/wa/"]:not([data-spc])');
    for (var i = 0; i < links.length; i++) {
      var a = links[i]; a.setAttribute("data-spc", "");
      if (a.matches(SKIP) || a.closest(SKIP)) continue;
      var h = a.getAttribute("href"), slug = h.indexOf("story.html#") >= 0 ? h.slice(h.indexOf("#") + 1) : (/^\/wa\/[^/?#.]+$/.test(h) ? h.slice(4) : "");
      if (!slug) continue;
      if (key(slug) in paid) place(a);
    }
  }
  function queue(all) { if (!ready) return; if (all) scan(true); else if (!queued) { queued = true; requestAnimationFrame(function () { scan(false); }); } }
  function start() {
    ready = true;
    if (WA.stories) WA.stories(function (list) { (list || []).forEach(function (st) { if (st.sp) paid[key(st.slug)] = st.spBy || paid[key(st.slug)] || ""; }); scan(true); });
    fetch("sponsored.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) { (list || []).forEach(function (x) { paid[key(x.slug)] = x.by || paid[key(x.slug)] || ""; }); scan(true); }).catch(function () {});
    new MutationObserver(function () { queue(false); }).observe(document.body, { childList: true, subtree: true });
    scan(true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

/* Canvas charts: hover a dot to see the bottle, click it to open the rating. On touch the first tap shows the card and a second tap on the same dot opens it. */
WA.canvasTips = function (canvas, points, html, href) {
  if (!canvas) return;
  if (canvas.__tips) { canvas.__tips.points = points; canvas.__tips.hide(); return; }
  var host = canvas.parentElement; if (getComputedStyle(host).position === "static") host.style.position = "relative";
  var tip = document.createElement("div"), ring = document.createElement("i"), kind = "mouse";
  tip.className = "ctip"; ring.className = "ctip-ring"; ring.setAttribute("aria-hidden", "true");
  host.appendChild(ring); host.appendChild(tip);
  var st = { points: points, cur: null };
  function near(e) {
    var b = canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, best = null, bd = kind === "touch" ? 20 : 12;
    (st.points() || []).forEach(function (p) { var d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = p; } });
    return best;
  }
  function hide() { st.cur = null; tip.style.display = "none"; ring.style.display = "none"; canvas.style.cursor = ""; }
  function show(p) {
    if (!p) { hide(); return; }
    st.cur = p; var ox = canvas.offsetLeft, oy = canvas.offsetTop;
    tip.innerHTML = html(p.r) + (href(p.r) ? '<span class="ctip-go">' + (kind === "touch" ? "Tap again to open" : "Click to open") + "</span>" : "");
    tip.style.display = "block"; ring.style.display = "block"; ring.style.left = (ox + p.x) + "px"; ring.style.top = (oy + p.y) + "px";
    var tw = tip.offsetWidth, th = tip.offsetHeight, left = Math.max(4, Math.min(host.clientWidth - tw - 4, ox + p.x - tw / 2)), top = oy + p.y - th - 14;
    if (top < 4) top = oy + p.y + 16;
    tip.style.left = left + "px"; tip.style.top = top + "px";
    canvas.style.cursor = href(p.r) ? "pointer" : "default";
  }
  canvas.addEventListener("pointerdown", function (e) { kind = e.pointerType || "mouse"; });
  canvas.addEventListener("pointermove", function (e) { if (e.pointerType === "touch") return; kind = "mouse"; show(near(e)); });
  canvas.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") hide(); });
  canvas.addEventListener("click", function (e) {
    var p = near(e); if (!p) { hide(); return; }
    var url = href(p.r);
    if (kind === "touch" && st.cur !== p) { show(p); return; }
    if (url) location.href = url;
  });
  st.hide = hide; canvas.__tips = st;
};
