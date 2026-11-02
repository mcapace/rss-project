(function () {
  'use strict';
  var input=document.getElementById('discoveryQuery'), results=document.getElementById('discoveryResults'), status=document.getElementById('discoveryStatus'), more=document.getElementById('discoveryMore'), esc=WAReader.escape;
  var index=[], ratings=[], ready=false, limit=12, kind='All', kinds=['All','Bottle','Story','Recipe','Producer'], labels={All:'All',Bottle:'Bottles',Story:'Stories',Recipe:'Recipes',Producer:'Producers'};
  var tabs=document.createElement('div'); tabs.className='discovery-tabs'; tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Result type'); status.before(tabs);
  function restore() { var params=new URLSearchParams(location.search); input.value=params.get('q')||''; kind=kinds.includes(params.get('type'))?params.get('type'):'All'; limit=12; }
  function navigate(type) { kind=type;limit=12;var url=new URL(location.href);url.searchParams.set('q',input.value.trim());if(kind==='All')url.searchParams.delete('type');else url.searchParams.set('type',kind);history.pushState(null,'',url);render(); }
  function highlight(text,query) { var words=WA.norm(query).split(' ').filter(function (w) { return w.length>2; }); if(!words.length)return esc(text); var pattern=new RegExp('('+words.map(function(w){return w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|')+')','ig');return String(text||'').split(pattern).map(function(s,i){return i%2?'<mark>'+esc(s)+'</mark>':esc(s);}).join(''); }
  function card(x,q) { return '<article class="reader-card discovery-card">'+(x.rating?'<span class="score-type result-score" aria-label="'+x.rating.s+' points">'+x.rating.s+'</span>':'')+'<div><p class="mono">'+esc(x.kind)+'</p><h3><a href="'+esc(x.href)+'">'+highlight(x.title,q)+'</a></h3><p>'+esc(x.description||'')+'</p></div></article>'; }
  function render() {
    if(!ready)return;
    var q=input.value.trim(), words=WA.norm(q).split(' ').filter(Boolean), bottles=q?WA.apply(WA.understand(q),ratings):[], positions=new Map(bottles.map(function(r,i){return [r.slug,i];}));
    var hits=q?index.filter(function(x){return x.rating?positions.has(x.rating.slug):words.every(function(w){return x.hay.indexOf(w)>=0;});}):[];
    var groups=kinds.slice(1).map(function(k){var items=hits.filter(function(x){return x.kind===k;});items.sort(function(a,b){if(a.rating)return positions.get(a.rating.slug)-positions.get(b.rating.slug);return Number(WA.norm(b.title)===WA.norm(q))-Number(WA.norm(a.title)===WA.norm(q))||(b.date||'').localeCompare(a.date||'');});return {kind:k,items:items};});
    tabs.innerHTML=kinds.map(function(k){var n=k==='All'?hits.length:groups.find(function(g){return g.kind===k;}).items.length;return '<button type="button" class="pill" data-type="'+k+'" aria-pressed="'+(kind===k)+'">'+labels[k]+(q?' <span>'+n.toLocaleString()+'</span>':'')+'</button>';}).join('');
    status.textContent=q?hits.length.toLocaleString()+' results for “'+q+'”'+(bottles.approximate?' · Includes close bottle-name matches.':'.'):'Search a bottle, ingredient, producer or subject.';
    var visible=groups.filter(function(g){return g.items.length&&(kind==='All'||g.kind===kind);});
    if(kind==='All')visible.sort(function(a,b){return Number(b.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}))-Number(a.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}));});
    results.innerHTML=visible.map(function(g){var count=kind==='All'?3:limit;return '<section class="discovery-group"><div class="results-heading"><h2>'+labels[g.kind]+' <span>'+g.items.length.toLocaleString()+'</span></h2>'+(kind==='All'&&g.items.length>count?'<button type="button" class="pill" data-type="'+g.kind+'">View all '+labels[g.kind].toLowerCase()+'</button>':'')+'</div><div class="reader-grid">'+g.items.slice(0,count).map(function(x){return card(x,q);}).join('')+'</div></section>';}).join('');
    if(q&&!visible.length)results.innerHTML='<div class="reader-empty"><h2>No '+(kind==='All'?'matching content':labels[kind].toLowerCase())+'</h2><p>Try fewer words or another spelling'+(kind==='All'?'.':', or view All results.')+'</p></div>';
    more.hidden=kind==='All'||!visible.length||visible[0].items.length<=limit;
  }
  function load() {
    status.textContent='Loading search…';
    Promise.all(['ratings.json','stories.json','stories-archive.json','cocktails.json'].map(WA.loadJSON)).then(function(sets){
      index=[];var producers=new Set(),seen=new Set();ratings=sets[0].rows.map(function(row){return Object.fromEntries(sets[0].cols.map(function(c,i){return [c,row[i]];}));});
      ratings.forEach(function(r){producers.add(r.pr);index.push({kind:'Bottle',title:r.n,href:WA.bottleHref(r.slug),rating:r,description:r.c+' · '+WA.fmt(r.p)+(r.d?' · Reviewed '+r.d.slice(0,4):'')});});
      sets[1].concat(sets[2]).forEach(function(s){if(seen.has(s.slug))return;seen.add(s.slug);index.push({kind:'Story',title:s.title,href:WA.storyHref(s),description:s.dek,date:s.d,hay:WA.norm(s.title+' '+s.dek+' '+(s.tags||[]).join(' '))});});
      sets[3].filter(WACatalog.validRecipe).forEach(function(r){index.push({kind:'Recipe',title:r.name,href:WA.recipeHref(r.slug),description:r.ingredients.length+' ingredients · '+r.ingredients.slice(0,2).join(', '),date:r.d,hay:WA.norm(r.name+' '+r.ingredients.join(' '))});});
      producers.forEach(function(name){if(name&&name!=='Unknown producer')index.push({kind:'Producer',title:name,href:WA.producerHref(name),description:'Explore the reviews and portfolio',hay:WA.norm(name)});});ready=true;render();
    }).catch(function(){status.textContent='Search could not load. Your query is preserved.';results.innerHTML='<button type="button" class="pill" id="discoveryRetry">Retry search</button>';document.getElementById('discoveryRetry').onclick=load;});
  }
  document.getElementById('discoveryForm').onsubmit=function(e){e.preventDefault();navigate(kind);};
  function choose(e){var b=e.target.closest('[data-type]');if(b){navigate(b.dataset.type);tabs.querySelector('[data-type="'+kind+'"]').focus();}}
  tabs.addEventListener('click',choose);results.addEventListener('click',choose);more.onclick=function(){limit+=12;render();};
  addEventListener('popstate',function(){restore();render();});restore();load();
})();
