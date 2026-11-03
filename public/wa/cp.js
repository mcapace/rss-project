/* Footer pages (about, contact, privacy, retailers, retailer club, app, newsletters), 2026-11-03.
   The mast height for the sticky bars, the sibling row on phones, the scroll spy for the section bar and the
   privacy contents, the privacy contents open on desktop, the Copy buttons, FAQ deep links, and the newsletter
   count. Nothing here animates and nothing here builds a page link. */
(function () {
  var root = document.documentElement, mast = document.querySelector(".mast");
  function mastH() { return mast ? mast.offsetHeight : 64; }
  function setMast() { root.style.setProperty("--mast-h", mastH() + "px"); }
  setMast(); addEventListener("resize", setMast); addEventListener("load", setMast);
  /* The mast tightens its padding once the page scrolls, which changes only its border box. */
  if (mast && "ResizeObserver" in window) new ResizeObserver(setMast).observe(mast, { box: "border-box" });
  if (mast) mast.addEventListener("transitionend", setMast);

  /* Sibling row: on phones, centre the current page's link inside the row without moving the page. */
  var fam = document.querySelector(".cp-family"), cur = fam && fam.querySelector('[aria-current="page"]');
  function centreFamily() {
    if (!fam || !cur || !matchMedia("(max-width: 700px)").matches) return;
    var left = cur.getBoundingClientRect().left - fam.getBoundingClientRect().left + fam.scrollLeft;
    fam.scrollLeft = left - (fam.clientWidth - cur.offsetWidth) / 2;
  }
  centreFamily(); addEventListener("load", centreFamily);

  /* Scroll spy: the last section whose top has passed the line under the mast and the bar is the current one. */
  [].forEach.call(document.querySelectorAll("nav[data-spy]"), function (nav) {
    var links = [].filter.call(nav.querySelectorAll('a[href^="#"]'), function (a) { return a.getAttribute("href").length > 1; });
    var targets = links.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))); });
    var box = nav.querySelector(".cp-nav-links") || nav.closest(".cp-toc") || nav, last = null;
    function line() { return mastH() + 90; }
    function update() {
      var at = -1, y = line();
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= y + 1) at = i; });
      var a = at >= 0 ? links[at] : null;
      if (a === last) return; last = a;
      links.forEach(function (l) { l.classList.remove("on"); l.removeAttribute("aria-current"); });
      if (!a) return;
      a.classList.add("on"); a.setAttribute("aria-current", "location");
      /* Keep the active link in view by scrolling the list itself, never the window. */
      var ar = a.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (box.scrollWidth > box.clientWidth + 1) {
        var l = ar.left - br.left + box.scrollLeft;
        if (l < box.scrollLeft || l + ar.width > box.scrollLeft + box.clientWidth) box.scrollLeft = l - (box.clientWidth - ar.width) / 2;
      }
      if (box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== "visible") {
        var t = ar.top - br.top + box.scrollTop;
        if (t < box.scrollTop || t + ar.height > box.scrollTop + box.clientHeight) box.scrollTop = t - (box.clientHeight - ar.height) / 2;
      }
    }
    var queued = false;
    function queue() { if (!queued) { queued = true; requestAnimationFrame(function () { queued = false; update(); }); } }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(queue, { rootMargin: "-" + line() + "px 0px -55% 0px" });
      targets.forEach(function (t) { if (t) io.observe(t); });
    }
    addEventListener("scroll", queue, { passive: true }); addEventListener("resize", queue);
    update();
  });

  /* Privacy contents: open beside the text on wide screens, a closed row above it below 1100px. */
  var toc = document.querySelector("details.cp-toc");
  if (toc) {
    var mq = matchMedia("(min-width: 1100px)");
    var sync = function () { toc.open = mq.matches; };
    sync();
    if (mq.addEventListener) mq.addEventListener("change", sync); else if (mq.addListener) mq.addListener(sync);
    toc.addEventListener("click", function (e) { if (!mq.matches && e.target.closest("a")) toc.open = false; });
    toc.addEventListener("toggle", function () { if (mq.matches && !toc.open) toc.open = true; });
  }

  /* Copy buttons for emails and phone numbers. */
  var live = document.querySelector(".cp-live");
  function fallbackCopy(value) {
    var ta = document.createElement("textarea"); ta.value = value; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-copy]"); if (!btn) return;
    var value = btn.getAttribute("data-copy");
    function done() {
      btn.textContent = "Copied"; clearTimeout(btn._cpT);
      btn._cpT = setTimeout(function () { btn.textContent = "Copy"; }, 1600);
      if (live) live.textContent = "Copied " + value;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, function () { fallbackCopy(value); done(); });
    else { fallbackCopy(value); done(); }
  });

  /* FAQ deep links open the question they name. */
  function openHash() {
    var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    var el = document.getElementById(id);
    if (el && el.tagName === "DETAILS" && el.classList.contains("term")) el.open = true;
  }
  openHash(); addEventListener("hashchange", openHash);

  /* Newsletters: how many letters are picked. */
  var picked = document.getElementById("nlPicked");
  if (picked) {
    var boxes = document.querySelectorAll("input[name=lists]");
    var count = function () { var n = 0; [].forEach.call(boxes, function (c) { if (c.checked) n++; }); picked.textContent = n + " of " + boxes.length + " selected"; };
    [].forEach.call(boxes, function (c) { c.addEventListener("change", count); });
    count();
  }
})();
