/* A bar or state page of America's Top Whisky Bars (rendered by src/lib/wa/bars.ts): Share, and outbound clicks counted. */
(function () {
  var track = function (name, data) { if (window.WA && WA.track) WA.track(name, data); };
  var slug = location.pathname.split("/").pop();
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-out]"); if (o) track("bars_out", { slug: slug, kind: o.getAttribute("data-out") });
    var s = e.target.closest("[data-share]"); if (!s) return;
    var title = document.querySelector("h1") ? document.querySelector("h1").textContent : document.title;
    if (navigator.share) navigator.share({ title: title + " \u00b7 America\u2019s Top Whisky Bars", url: location.href }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { s.textContent = "Link copied"; setTimeout(function () { s.textContent = "Share"; }, 1800); });
  });
})();
