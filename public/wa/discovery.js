(function () {
  'use strict';
  var input = document.getElementById('discoveryQuery'), results = document.getElementById('discoveryResults'), status = document.getElementById('discoveryStatus'), more = document.getElementById('discoveryMore');
  var index = [], limit = 40, ready = false, esc = WAReader.escape;
  input.value = new URLSearchParams(location.search).get('q') || '';
  function get(file) { return fetch('/wa/' + file, {signal: AbortSignal.timeout(15000)}).then(function (r) { if (!r.ok) throw Error(file); return r.json(); }); }
  function render() {
    if (!ready) return;
    var query = input.value.trim(), words = query.toLowerCase().split(/\s+/).filter(Boolean), intent = WA.understand(query);
    var hits = query ? index.filter(function (x) { if (x.kind === 'Bottle') return WA.apply(intent, [x.rating]).length > 0; return words.every(function (w) { return x.hay.indexOf(w) >= 0; }); }) : [];
    status.textContent = query ? hits.length + ' results for “' + query + '” across bottles, stories, recipes and producers.' : 'Enter a name, ingredient or subject to search the collection.';
    var groups = ['Bottle','Story','Recipe','Producer'].map(function (kind) { return {kind:kind,items:hits.filter(function (x) { return x.kind === kind; })}; });
    results.innerHTML = groups.filter(function (g) { return g.items.length; }).map(function (g) { return '<section class="discovery-group"><h2>' + g.kind + ' results (' + g.items.length + ')</h2><div class="reader-grid">' + g.items.slice(0,Math.floor(limit/4)).map(function (x) { return '<article class="reader-card"><p class="mono">' + x.kind + '</p><h3><a href="' + esc(x.href) + '">' + esc(x.title) + '</a></h3><p>' + esc(x.description || '') + '</p></article>'; }).join('') + '</div></section>'; }).join('');
    if (query && !hits.length) results.innerHTML = '<p>No matching content. Try fewer words or another spelling.</p>';
    more.hidden = groups.every(function (g) { return g.items.length <= Math.floor(limit/4); });
  }
  function load() {
    status.textContent = 'Loading the search index…';
    Promise.all([get('ratings.json'),get('stories.json'),get('stories-archive.json'),get('cocktails.json')]).then(function (sets) {
      index = []; var producers = {}, seen = {};
      sets[0].rows.forEach(function (row) { var r = {}; sets[0].cols.forEach(function (c,i) { r[c]=row[i]; }); producers[r.pr]=true; index.push({kind:'Bottle',title:r.n,href:'/wa/'+encodeURIComponent(r.slug),rating:r,description:r.s+' points · '+WA.fmt(r.p),hay:(r.n+' '+r.pr+' '+r.c).toLowerCase()}); });
      sets[1].concat(sets[2]).forEach(function (s) { if (seen[s.slug]) return; seen[s.slug]=true; index.push({kind:'Story',title:s.title,href:'/wa/'+encodeURIComponent(s.slug),description:s.dek,hay:(s.title+' '+s.dek+' '+(s.tags||[]).join(' ')).toLowerCase()}); });
      sets[3].forEach(function (r) { index.push({kind:'Recipe',title:r.name,href:'/wa/recipes/'+encodeURIComponent(r.slug),description:r.ingredients.join(', '),hay:(r.name+' '+r.ingredients.join(' ')).toLowerCase()}); });
      Object.keys(producers).filter(function (n) { return n && n !== 'Unknown producer'; }).forEach(function (name) { index.push({kind:'Producer',title:name,href:'/wa/producers/'+encodeURIComponent(name),hay:name.toLowerCase()}); });
      ready=true; render();
    }).catch(function () { status.textContent='The search index could not load. Your query is preserved.'; results.innerHTML='<button class="pill" id="discoveryRetry">Retry search</button>'; document.getElementById('discoveryRetry').onclick=load; });
  }
  document.getElementById('discoveryForm').onsubmit=function (e) { e.preventDefault(); var url=new URL(location.href); url.searchParams.set('q',input.value.trim()); history.pushState(null,'',url); limit=40; render(); };
  more.onclick=function () { limit+=40; render(); };
  addEventListener('popstate',function () { input.value=new URLSearchParams(location.search).get('q')||'';limit=40;render(); });
  load();
})();
