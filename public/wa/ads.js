/* Live Whisky Advocate Google Publisher Tags, placed in the concept site's ad placeholders.
   Homepage uses /4054/whiskyadvocate/homepage. Every other page uses /4054/whiskyadvocate. */
(function () {
  var holders = Array.prototype.slice.call(document.querySelectorAll(".ad[data-slot]"));
  if (!holders.length) return;

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

  googletag.cmd.push(function () {
    slots.forEach(function (slot) {
      googletag.defineSlot(path, slot.sizes, slot.id).defineSizeMapping(mapping(slot.map)).addService(googletag.pubads()).setTargeting("pos", slot.pos);
    });
    if (home) googletag.pubads().setTargeting("s1", "homepage");
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
    slots.forEach(function (slot) { googletag.display(slot.id); });
  });
})();
