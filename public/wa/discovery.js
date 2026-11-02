(function () {
  'use strict';
  var input=document.getElementById('discoveryQuery'), results=document.getElementById('discoveryResults'), status=document.getElementById('discoveryStatus'), more=document.getElementById('discoveryMore'), esc=WAReader.escape;
  var meaningOf=new Map(), storyBySlug=new Map(), ratingBySlug=new Map(), bottleItem=new Map(); // per search: the stories and bottles /api/wa/meaning matched by meaning
  var index=[], ratings=[], ready=false, limit=12, kind='All', kinds=['All','Bottle','Story','Recipe','Producer'], labels={All:'All',Bottle:'Bottles',Story:'Stories',Recipe:'Recipes',Producer:'Producers'};
  var tabs=document.createElement('div'); tabs.className='discovery-tabs'; tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Result type'); status.before(tabs);
  // The answer: the question matched by meaning against every rating and story, answered from what was found.
  var panel=document.createElement('section'), asked=''; panel.className='answer search-answer'; panel.setAttribute('aria-label','Answer'); panel.setAttribute('aria-live','polite'); tabs.before(panel);
  function head(note){ return '<div class="answer-head"><span class="facet">Answer</span><span class="mono search-answer-note">'+note+'</span></div>'; }
  function ask(q) {
    if(q===asked)return; asked=q;
    if(q.length<3){panel.removeAttribute('data-show');panel.innerHTML='';return;}
    panel.innerHTML=head('Reading the ratings and stories')+'<div class="answer-body solo"><div class="answer-text"><p class="search-answer-wait" aria-label="Loading"><span></span><span></span><span></span></p></div></div>'; panel.setAttribute('data-show','true');
    fetch('/api/wa/answer?q='+encodeURIComponent(q),{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(j){
      if(q!==asked)return;
      var bottles=(j&&j.bottles)||[], stories=(j&&j.stories)||[];
      if(!j||(!j.answer&&!bottles.length&&!stories.length)){panel.removeAttribute('data-show');panel.innerHTML='';return;}
      var picks=bottles.map(function(b){return '<a class="pick" href="'+esc(WA.bottleHref(b.slug))+'"><span class="sc score-type">'+esc(b.score||'')+'</span><span><span class="nm">'+esc(b.title)+'</span><span class="ct">'+esc(b.why||b.line||b.category)+'</span></span><span class="pr">'+(b.price?esc(WA.fmt(b.price)):'')+'</span></a>';}).join('');
      var reads=stories.map(function(s){return '<a href="'+esc(WA.storyHref(s))+'">'+esc(s.title)+'</a>';}).join('');
      panel.innerHTML=head('From Whisky Advocate ratings and stories')+'<div class="answer-body'+(picks?'':' solo')+'"><div class="answer-text">'+(j.answer?'<p>'+esc(j.answer)+'</p>':'')+(reads?'<p class="mono search-answer-label">Read more</p><div class="src">'+reads+'</div>':'')+'</div>'+(picks?'<div class="answer-picks">'+picks+'</div>':'')+'</div>';
      WA.track&&WA.track('search_answer',{q:q,bottles:bottles.length,stories:stories.length});
    },function(){if(q===asked){panel.removeAttribute('data-show');panel.innerHTML='';}});
  }
  function restore() { var params=new URLSearchParams(location.search); input.value=params.get('q')||''; kind=kinds.includes(params.get('type'))?params.get('type'):'All'; limit=12; }
  function navigate(type) { kind=type;limit=12;var url=new URL(location.href);url.searchParams.set('q',input.value.trim());if(kind==='All')url.searchParams.delete('type');else url.searchParams.set('type',kind);history.pushState(null,'',url);ask(input.value.trim());render(); }
  function highlight(text,query) { var words=WA.norm(query).split(' ').filter(function (w) { return w.length>2; }); if(!words.length)return esc(text); var pattern=new RegExp('('+words.map(function(w){return w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|')+')','ig');return String(text||'').split(pattern).map(function(s,i){return i%2?'<mark>'+esc(s)+'</mark>':esc(s);}).join(''); }
  function card(x,q) { return '<article class="reader-card discovery-card">'+(x.rating?'<span class="score-type result-score" aria-label="'+x.rating.s+' points">'+x.rating.s+'</span>':'')+'<div><p class="mono">'+esc(x.kind)+'</p><h3><a href="'+esc(x.href)+'">'+highlight(x.title,q)+'</a></h3><p>'+esc(x.description||'')+'</p></div></article>'; }
  function meaning(q){ var key=q.toLowerCase().replace(/\s+/g,' ').trim(); if(key.length<3)return null; if(meaningOf.has(key))return meaningOf.get(key); meaningOf.set(key,null);
    fetch('/api/wa/meaning?q='+encodeURIComponent(key),{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(j){ if(!j)return; meaningOf.set(key,{stories:(j.stories||[]).map(function(x){return x.slug;}),bottles:(j.bottles||[]).map(function(x){return x.slug;})}); if(input.value.trim().toLowerCase().replace(/\s+/g,' ')===key)render(); },function(){});
    return null; }
  function render() {
    if(!ready)return;
    var q=input.value.trim(), words=WA.norm(q).split(' ').filter(Boolean), bottles=q?WA.apply(WA.understand(q),ratings):[], positions=new Map(bottles.map(function(r,i){return [r.slug,i];}));
    var hits=q?index.filter(function(x){return x.rating?positions.has(x.rating.slug):words.every(function(w){return x.hay.indexOf(w)>=0;});}):[];
    var groups=kinds.slice(1).map(function(k){var items=hits.filter(function(x){return x.kind===k;});items.sort(function(a,b){if(a.rating)return positions.get(a.rating.slug)-positions.get(b.rating.slug);return Number(WA.norm(b.title)===WA.norm(q))-Number(WA.norm(a.title)===WA.norm(q))||(b.date||'').localeCompare(a.date||'');});return {kind:k,items:items};});
    // By meaning: stories and bottles the words missed come after the word matches; bottles still keep the price, score and style asked for.
    var near=q?meaning(q):null, added=0;
    if(near){ var have=new Set(hits.map(function(x){return x.href;})), intent=WA.understand(q); intent.terms=[];
      var addTo=function(kindName,items){var g=groups.find(function(x){return x.kind===kindName;});items.forEach(function(x){if(x&&!have.has(x.href)){have.add(x.href);g.items.push(x);hits.push(x);added++;}});};
      addTo('Story',near.stories.map(function(slug){return storyBySlug.get(slug);}));
      var okBottles=new Set(WA.apply(intent,near.bottles.map(function(slug){return ratingBySlug.get(slug);}).filter(Boolean)).map(function(r){return r.slug;}));
      addTo('Bottle',near.bottles.filter(function(slug){return okBottles.has(slug);}).map(function(slug){return bottleItem.get(slug);})); }
    tabs.innerHTML=kinds.map(function(k){var n=k==='All'?hits.length:groups.find(function(g){return g.kind===k;}).items.length;return '<button type="button" class="pill" data-type="'+k+'" aria-pressed="'+(kind===k)+'">'+labels[k]+(q?' <span>'+n.toLocaleString()+'</span>':'')+'</button>';}).join('');
    status.textContent=q?hits.length.toLocaleString()+' results for “'+q+'”'+(bottles.approximate?' · Includes close bottle-name matches.':'')+(added?' · Includes '+added.toLocaleString()+' found by meaning.':(bottles.approximate?'':'.')):'Search a bottle, ingredient, producer or subject.';
    var visible=groups.filter(function(g){return g.items.length&&(kind==='All'||g.kind===kind);});
    if(kind==='All')visible.sort(function(a,b){return Number(b.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}))-Number(a.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}));});
    results.innerHTML=visible.map(function(g){var count=kind==='All'?3:limit;return '<section class="discovery-group"><div class="results-heading"><h2>'+labels[g.kind]+' <span>'+g.items.length.toLocaleString()+'</span></h2>'+(kind==='All'&&g.items.length>count?'<button type="button" class="pill" data-type="'+g.kind+'">View all '+labels[g.kind].toLowerCase()+'</button>':'')+'</div><div class="reader-grid">'+g.items.slice(0,count).map(function(x){return card(x,q);}).join('')+'</div></section>';}).join('');
    if(q&&!visible.length)results.innerHTML='<div class="reader-empty"><h2>No '+(kind==='All'?'matching content':labels[kind].toLowerCase())+'</h2><p>Try fewer words or another spelling'+(kind==='All'?'.':', or view All results.')+'</p></div>';
    more.hidden=kind==='All'||!visible.length||visible[0].items.length<=limit;
  }
  function load() {
    status.textContent='Loading search…';
    Promise.all(['ratings.json','stories.json','stories-archive.json','cocktails.json'].map(WA.loadJSON)).then(function(sets){
      index=[];storyBySlug=new Map();ratingBySlug=new Map();bottleItem=new Map();var producers=new Set(),seen=new Set();ratings=sets[0].rows.map(function(row){return Object.fromEntries(sets[0].cols.map(function(c,i){return [c,row[i]];}));});
      ratings.forEach(function(r){producers.add(r.pr);var item={kind:'Bottle',title:r.n,href:WA.bottleHref(r.slug),rating:r,description:r.c+' · '+WA.fmt(r.p)+(r.d?' · Reviewed '+r.d.slice(0,4):'')};index.push(item);ratingBySlug.set(r.slug,r);bottleItem.set(r.slug,item);});
      sets[1].concat(sets[2]).forEach(function(s){if(seen.has(s.slug))return;seen.add(s.slug);var item={kind:'Story',title:s.title,href:WA.storyHref(s),description:s.dek,date:s.d,hay:WA.norm(s.title+' '+s.dek+' '+(s.tags||[]).join(' '))};index.push(item);storyBySlug.set(s.slug,item);});
      sets[3].filter(WACatalog.validRecipe).forEach(function(r){index.push({kind:'Recipe',title:r.name,href:WA.recipeHref(r.slug),description:r.ingredients.length+' ingredients · '+r.ingredients.slice(0,2).join(', '),date:r.d,hay:WA.norm(r.name+' '+r.ingredients.join(' '))});});
      producers.forEach(function(name){if(name&&name!=='Unknown producer')index.push({kind:'Producer',title:name,href:WA.producerHref(name),description:'Explore the reviews and portfolio',hay:WA.norm(name)});});ready=true;render();
    }).catch(function(){status.textContent='Search could not load. Your query is preserved.';results.innerHTML='<button type="button" class="pill" id="discoveryRetry">Retry search</button>';document.getElementById('discoveryRetry').onclick=load;});
  }
  document.getElementById('discoveryForm').onsubmit=function(e){e.preventDefault();navigate(kind);};
  function choose(e){var b=e.target.closest('[data-type]');if(b){navigate(b.dataset.type);tabs.querySelector('[data-type="'+kind+'"]').focus();}}
  tabs.addEventListener('click',choose);results.addEventListener('click',choose);more.onclick=function(){limit+=12;render();};
  addEventListener('popstate',function(){restore();ask(input.value.trim());render();});restore();ask(input.value.trim());load();
})();
