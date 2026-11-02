/* Buying guides near the end of a story, rating, recipe or the home page: guide stories related to the page, drawn
   as the site's usual story cards, loaded when the section comes close to view. Sponsored pages do not get it. */
(function () {
  'use strict';
  var host = document.getElementById('buyingGuides'); if (!host) return;
  var loaded = false;
  function load() {
    if (loaded) return; loaded = true;
    WA.stories(function (stories) {
      var slug = WA.hashSlug && WA.hashSlug(), current = slug ? stories.find(function (s) { return s.slug === slug; }) : null;
      if (current && WA.isSponsored(current)) { host.remove(); return; }
      var heading = document.querySelector('h1'), words = WACatalog.norm(((heading && heading.textContent) || '') + ' ' + ((current && current.tags) || []).join(' '));
      var terms = host.dataset.meaning === 'off' ? [] : words.split(' ').filter(function (t) { return t.length > 3 && !/^(whisky|whiskey|bottle|stories|ratings|advocate|review|year)$/.test(t); });
      var already = new Set(Array.from(document.querySelectorAll('#next a, #mentions a, #homeStories a')).map(function (a) { return a.getAttribute('href'); }));
      var pool = stories.filter(function (s) { return s.sec === 'guides' && s !== current && !WA.isSponsored(s) && !already.has(WA.storyHref(s)) && !/auction/i.test(s.title); });
      var guides = pool.filter(function (s) { return /value|under|bottles|buy|guide|how to|best|starter|beginners|gift|whisky list/i.test(s.title + ' ' + (s.tags || []).join(' ')); });
      function relevance(s) { var text = WACatalog.norm(s.title + ' ' + (s.tags || []).join(' ')); return terms.reduce(function (n, t) { return n + (text.indexOf(t) >= 0 ? 3 : 0); }, 0) + (/value|under|buy|how to|beginners|gift/i.test(s.title) ? 2 : 0); }
      guides.sort(function (a, b) { return relevance(b) - relevance(a) || (b.d || '').localeCompare(a.d || ''); });
      var grid = host.querySelector('.guide-stories');
      function show(list) { grid.innerHTML = list.slice(0, 3).map(function (s) { return WA.storyCard(s, ''); }).join(''); grid.hidden = !list.length; }
      // Among the buying-advice guides, the ones closest in meaning to this page come first (the search's meaning route, cached per page); the keyword order fills the rest.
      var subject = (((heading && heading.textContent) || '') + ' ' + ((current && current.tags) || []).slice(0, 6).join(' ')).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160);
      // The home page has no one subject, so its guides keep the keyword order.
      if (host.dataset.meaning === 'off' || subject.length < 3 || !window.fetch) { show(guides); return; }
      var settled = false, timer = setTimeout(function () { if (!settled) { settled = true; show(guides); } }, 2500);
      fetch('/api/wa/meaning?q=' + encodeURIComponent(subject), { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (settled) return; settled = true; clearTimeout(timer);
        var bySlug = new Map(guides.map(function (s) { return [s.slug, s]; })), picked = [];
        ((j && j.stories) || []).forEach(function (x) { var s = bySlug.get(x.slug); if (s && picked.indexOf(s) < 0) picked.push(s); });
        guides.forEach(function (s) { if (picked.indexOf(s) < 0) picked.push(s); });
        show(picked);
      }, function () { if (!settled) { settled = true; clearTimeout(timer); show(guides); } });
    });
  }
  if ('IntersectionObserver' in window) { var observer = new IntersectionObserver(function (entries) { if (entries.some(function (e) { return e.isIntersecting; })) { load(); observer.disconnect(); } }, { rootMargin: '1000px' }); observer.observe(host); } else load();
})();
