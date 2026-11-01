/* Contextual guides near the end of a reading journey. Uses the existing cached story index. */
(function () {
  'use strict';
  var host = document.getElementById('buyingGuides'); if (!host) return;
  var loaded = false;
  function load() {
    if (loaded) return; loaded = true;
    WA.stories(function (stories) {
      var current = stories.find(function (s) { return s.slug === WA.hashSlug(); });
      if (current && WA.isSponsored(current)) { host.remove(); return; }
      var ctx = WA.context || {}, terms = WACatalog.norm((ctx.title || document.querySelector('h1')?.textContent || '') + ' ' + (current?.tags || []).join(' ')).split(' ').filter(function (t) { return t.length > 3 && !/^(whisky|whiskey|bottle|stories|ratings|advocate|review|year)$/.test(t); });
      var already = new Set(Array.from(document.querySelectorAll('#next a, #mentions a, #homeStories a')).map(function (a) { return a.getAttribute('href'); }));
      var guides = stories.filter(function (s) { return s.sec === 'guides' && s !== current && !WA.isSponsored(s) && !already.has(WA.storyHref(s)) && /value|under|bottles|buy|guide|how to|best|starter|beginners|gift|whisky list/i.test(s.title + ' ' + (s.tags || []).join(' ')) && !/auction/i.test(s.title); });
      function relevance(s) { var words = WACatalog.norm(s.title + ' ' + (s.tags || []).join(' ')); return terms.reduce(function (n,t) { return n + (words.includes(t) ? 3 : 0); },0) + (/value|under|buy|how to|beginners|gift/i.test(s.title) ? 2 : 0); }
      guides.sort(function (a,b) { return relevance(b)-relevance(a) || (b.d || '').localeCompare(a.d || ''); });
      var grid = host.querySelector('.guide-stories'); grid.innerHTML = guides.slice(0,3).map(function (s) { return WA.editorialCard(s, terms.some(function (t) { return WACatalog.norm(s.title + ' ' + (s.tags || []).join(' ')).includes(t); }) ? 'Related to this page' : 'Buying advice'); }).join(''); grid.hidden = !guides.length;
    });
  }
  if ('IntersectionObserver' in window) { var observer = new IntersectionObserver(function (entries) { if (entries.some(function (e) { return e.isIntersecting; })) { load(); observer.disconnect(); } }, { rootMargin:'1000px' }); observer.observe(host); } else load();
})();
