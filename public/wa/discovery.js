(function () {
  'use strict';
  var input=document.getElementById('discoveryQuery'), results=document.getElementById('discoveryResults'), status=document.getElementById('discoveryStatus'), more=document.getElementById('discoveryMore'), esc=WAReader.escape;
  var meaningOf=new Map(), storyBySlug=new Map(), ratingBySlug=new Map(), bottleItem=new Map(), producerWords=new Set(); // per search: the stories and bottles /api/wa/meaning matched by meaning
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
  function restore() { var params=new URLSearchParams(location.search); input.value=params.get('q')||''; kind=kinds.includes(params.get('type'))?params.get('type'):'All'; limit=12; sort=['best','new','old','score','price'].includes(params.get('sort'))?params.get('sort'):'best'; exact=false; }
  function navigate(type) { kind=type;limit=12;var url=new URL(location.href);url.searchParams.set('q',input.value.trim());if(kind==='All')url.searchParams.delete('type');else url.searchParams.set('type',kind);if(sort==='best')url.searchParams.delete('sort');else url.searchParams.set('sort',sort);history.pushState(null,'',url);closeSuggest();ask(input.value.trim());render(); }
  function highlight(text,query) { var words=WA.norm(query).split(' ').filter(function (w) { return w.length>2; }); if(!words.length)return esc(text); var pattern=new RegExp('('+words.map(function(w){return w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|')+')','ig');return String(text||'').split(pattern).map(function(s,i){return i%2?'<mark>'+esc(s)+'</mark>':esc(s);}).join(''); }
  // Stories and recipes lead with their photo; bottles show the bottle beside the score. A photo that fails to load leaves the text card.
  var drop="this.closest('.discovery-card').classList.remove('has-cover','has-bottle');this.parentNode.remove()";
  function card(x,q) {
    var pic=x.rating?'<a class="dc-bottle" href="'+esc(x.href)+'" tabindex="-1" aria-hidden="true"><img src="'+esc(WA.bottleSrc(x.rating))+'" alt="" loading="lazy" data-stock="'+esc(WA.shot(x.rating.c))+'" onerror="if(this.dataset.stock&&this.src.indexOf(this.dataset.stock)<0){this.src=this.dataset.stock}else{'+drop+'}"></a>'
      :x.img?'<a class="dc-cover" href="'+esc(x.href)+'" tabindex="-1" aria-hidden="true"><img src="'+esc(String(x.img).replace(/([?&])w=\d+/,'$1w=640'))+'" alt="" loading="lazy" onerror="'+drop+'"></a>':'';
    return '<article class="reader-card discovery-card'+(x.rating?' has-bottle':x.img?' has-cover':'')+'">'+pic+(x.rating?'<span class="score-type result-score" aria-label="'+x.rating.s+' points">'+x.rating.s+'</span>':'')+'<div><p class="mono">'+esc(x.kind)+'</p><h3><a href="'+esc(x.href)+'">'+highlight(x.title,q)+'</a></h3><p>'+esc(x.description||'')+'</p></div></article>'; }
  function meaning(q){ var key=q.toLowerCase().replace(/\s+/g,' ').trim(); if(key.length<3)return null; if(meaningOf.has(key))return meaningOf.get(key); meaningOf.set(key,null);
    fetch('/api/wa/meaning?q='+encodeURIComponent(key),{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(j){ if(!j)return; meaningOf.set(key,{stories:(j.stories||[]).map(function(x){return x.slug;}),bottles:(j.bottles||[]).map(function(x){return x.slug;})}); if(input.value.trim().toLowerCase().replace(/\s+/g,' ')===key)render(); },function(){});
    return null; }
  // Ranking and spelling. Relevance favours the title over the description, whole words over word starts, the exact phrase, then recency.
  var sort='best', exact=false, corrected='', vocab=new Map(), vocabList=[], fixes=new Map(), ratedBy=new Map();
  // Bottle matching is the costly step; the suggestions and the results ask for the same words, so each query is matched once.
  var bottleCache=new Map();
  // Names that start with every typed word come first; the slower typo-tolerant pass runs only when they find fewer than a dozen.
  function bottlesFor(q){ var k=WA.norm(q); if(bottleCache.has(k))return bottleCache.get(k); var f=WA.understand(q), rows=ratings;
    if(f.terms.length){ var quick=ratings.filter(function(r){var h=r._hay||(r._hay=' '+WA.norm(r.n+' '+r.pr));return f.terms.every(function(t){return h.indexOf(' '+t)>=0;});}); if(quick.length>=12)rows=quick; }
    var r=WA.apply(f,rows); if(bottleCache.size>60)bottleCache.clear(); bottleCache.set(k,r); return r; }
  function matches(x,ws){ return ws.every(function(w){return x.hay.indexOf(w)>=0;}); }
  function titleWords(x){ if(!x.tw){x.nt=WA.norm(x.title);x.tw=x.nt.split(' ');} return x.tw; }
  function rel(x,ws,phrase){
    var tw=titleWords(x), t=x.nt, s=0;
    ws.forEach(function(w){ s+=tw.indexOf(w)>=0?6:tw.some(function(v){return v.indexOf(w)===0;})?4:t.indexOf(w)>=0?2:1; });
    if(phrase.length>3&&t.indexOf(phrase)>=0)s+=8; if(t===phrase)s+=20;
    if(x.date){ var years=(Date.now()-Date.parse(x.date))/3.156e10; if(years>=0)s+=Math.max(0,2-years*0.5); }
    return s;
  }
  function arrange(g,ws,phrase){
    var by=sort; if(g.kind!=='Bottle'&&(by==='score'||by==='price'))by='best';
    if(by==='best'){ if(g.kind!=='Bottle')g.items.sort(function(a,b){return rel(b,ws,phrase)-rel(a,ws,phrase)||(b.date||'').localeCompare(a.date||'');}); return; }
    if(by==='new'||by==='old'){ var dir=by==='new'?1:-1; g.items.sort(function(a,b){if(!a.date||!b.date)return a.date?-1:b.date?1:0;return dir*b.date.localeCompare(a.date);}); return; }
    if(by==='score')g.items.sort(function(a,b){return b.rating.s-a.rating.s||(b.date||'').localeCompare(a.date||'');});
    if(by==='price')g.items.sort(function(a,b){var pa=a.rating.p>0?a.rating.p:1e9, pb=b.rating.p>0?b.rating.p:1e9;return pa-pb||b.rating.s-a.rating.s;});
  }
  // The site's own words, counted; a word seen at least twice, or the start of one, is spelled right.
  function words(){
    vocab=new Map(); var add=function(text){WA.norm(text).split(' ').forEach(function(w){if(w.length>=3)vocab.set(w,(vocab.get(w)||0)+1);});};
    index.forEach(function(x){add(x.hay||x.title);}); ratings.forEach(function(r){add(r.n+' '+r.pr);});
    vocabList=Array.from(vocab.keys()).filter(function(w){return vocab.get(w)>=2;}).sort();
  }
  function known(w){ if((vocab.get(w)||0)>=2)return true; var lo=0,hi=vocabList.length; while(lo<hi){var mid=(lo+hi)>>1; if(vocabList[mid]<w)lo=mid+1; else hi=mid;} return lo<vocabList.length&&vocabList[lo].indexOf(w)===0; }
  function correct(w){
    if(w.length<4||/\d/.test(w)||known(w))return w; if(fixes.has(w))return fixes.get(w);
    var max=w.length>7?2:1, best=w, bd=9, bf=0;
    for(var i=0;i<vocabList.length;i++){ var v=vocabList[i]; if(v.length<4||Math.abs(v.length-w.length)>max)continue; var d=WACatalog.distance(w,v); if(d<=max&&(d<bd||(d===bd&&vocab.get(v)>bf))){best=v;bd=d;bf=vocab.get(v);} }
    fixes.set(w,best); return best;
  }
  function fix(q){ return WA.norm(q).split(' ').filter(Boolean).map(correct).join(' '); }
  // Sort: every list by best match or date; bottles also by score and price.
  var bar=document.createElement('div'), sorter=document.createElement('label'); bar.className='discovery-bar'; sorter.className='ds-sort'; sorter.innerHTML='<span>Sort</span><select id="discoverySort"></select>';
  tabs.before(bar); bar.append(tabs,sorter); var sortSel=sorter.querySelector('select');
  function sortOptions(){
    var list=kind==='Producer'?[['best','Best match']]:[['best','Best match'],['new','Newest'],['old','Oldest']];
    if(kind==='All'||kind==='Bottle')list.push(['score','Highest score'],['price','Lowest price']);
    if(!list.some(function(o){return o[0]===sort;}))sort='best';
    sortSel.innerHTML=list.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join(''); sortSel.value=sort;
    sorter.hidden=kind==='Producer'||!input.value.trim();
  }
  sortSel.addEventListener('change',function(){ sort=sortSel.value; limit=12; var url=new URL(location.href); if(sort==='best')url.searchParams.delete('sort');else url.searchParams.set('sort',sort); history.replaceState(null,'',url); render(); WA.track&&WA.track('search_sort',{sort:sort,type:kind}); });
  status.addEventListener('click',function(e){ if(!e.target.closest('.ds-instead'))return; exact=true; render(); });
  // Suggestions while typing: a spelling fix, then producers, bottles, stories and a recipe. Arrow keys move, Enter opens, Escape closes.
  var box=document.createElement('ul'), sugg=[], active=-1, typing=0;
  box.id='discoverySuggest'; box.className='ds-suggest'; box.setAttribute('role','listbox'); box.setAttribute('aria-label','Suggestions'); box.hidden=true; input.after(box);
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list'); input.setAttribute('aria-controls','discoverySuggest'); input.setAttribute('aria-expanded','false'); input.setAttribute('autocomplete','off');
  function closeSuggest(){ box.hidden=true; active=-1; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); }
  function suggest(){
    var q=input.value.trim(), nq=WA.norm(q); if(!ready||nq.length<2)return closeSuggest();
    var fixed=fix(q), ws=fixed.split(' ').filter(Boolean), phrase=ws.join(' '), out=[];
    var starts=function(x){var tw=titleWords(x);return ws.every(function(w){return tw.some(function(v){return v.indexOf(w)===0;});});};
    if(fixed!==nq)out.push({k:'Did you mean',t:fixed,q:fixed});
    index.filter(function(x){return x.kind==='Producer'&&starts(x);}).sort(function(a,b){return (ratedBy.get(b.title)||0)-(ratedBy.get(a.title)||0);}).slice(0,2).forEach(function(x){out.push({k:'Producer',t:x.title,m:(ratedBy.get(x.title)||0)+' ratings',h:x.href});});
    bottlesFor(fixed).slice(0,3).forEach(function(r){out.push({k:'Bottle',t:r.n,m:r.s+' points',h:WA.bottleHref(r.slug)});});
    [['Story',2],['Recipe',1]].forEach(function(o){ index.filter(function(x){return x.kind===o[0]&&starts(x);}).sort(function(a,b){return rel(b,ws,phrase)-rel(a,ws,phrase);}).slice(0,o[1]).forEach(function(x){out.push({k:o[0],t:x.title,m:x.date?String(x.date).slice(0,4):'',h:x.href});}); });
    sugg=out.slice(0,8); active=-1; if(!sugg.length)return closeSuggest();
    box.innerHTML=sugg.map(function(s,i){return '<li id="ds-opt-'+i+'" role="option" aria-selected="false" data-i="'+i+'"><span class="mono">'+esc(s.k)+'</span><span class="t">'+highlight(s.t,phrase)+'</span>'+(s.m?'<span class="m">'+esc(s.m)+'</span>':'')+'</li>';}).join('');
    box.hidden=false; input.setAttribute('aria-expanded','true'); input.removeAttribute('aria-activedescendant');
  }
  function pick(i){ var s=sugg[i]; if(!s)return; closeSuggest(); WA.track&&WA.track('search_suggestion',{kind:s.k,q:input.value.trim()}); if(s.h){location.href=s.h;return;} input.value=s.q; exact=true; navigate(kind); }
  function mark(i){ active=i; Array.prototype.forEach.call(box.children,function(li,n){li.setAttribute('aria-selected',String(n===i));}); if(i>=0)input.setAttribute('aria-activedescendant','ds-opt-'+i);else input.removeAttribute('aria-activedescendant'); }
  input.addEventListener('keydown',function(e){
    if(box.hidden)return;
    if(e.key==='ArrowDown'){e.preventDefault();mark(Math.min(sugg.length-1,active+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();mark(Math.max(-1,active-1));}
    else if(e.key==='Enter'&&active>=0){e.preventDefault();pick(active);}
    else if(e.key==='Escape'){e.preventDefault();closeSuggest();}
  });
  box.addEventListener('mousedown',function(e){var li=e.target.closest('[data-i]');if(li){e.preventDefault();pick(+li.getAttribute('data-i'));}});
  input.addEventListener('blur',function(){setTimeout(closeSuggest,120);});
  // Results follow the typing; the written answer and meaning matches wait for Search.
  input.addEventListener('input',function(){ exact=false; clearTimeout(typing); typing=setTimeout(function(){ suggest(); limit=12; var url=new URL(location.href); url.searchParams.set('q',input.value.trim()); history.replaceState(null,'',url); render({live:true}); },160); });
  function render(opts) {
    if(!ready)return; opts=opts||{};
    // Words as typed first; when they find little and a spelling fix finds more, the fixed words are used and the status says so.
    var q=input.value.trim(), nq=WA.norm(q), fixed=exact?nq:fix(q), words=nq.split(' ').filter(Boolean), used=nq;
    var others=q?index.filter(function(x){return !x.rating&&matches(x,words);}):[], bottles=q?bottlesFor(q):[];
    if(q&&fixed!==nq){ var fw=fixed.split(' '), fo=index.filter(function(x){return !x.rating&&matches(x,fw);}), fb=bottles.length?bottles:bottlesFor(fixed);
      if((others.length<3&&fo.length>others.length)||(!bottles.length&&fb.length)){ if(fo.length>others.length){others=fo;words=fw;} bottles=fb; used=fixed; } }
    corrected=used!==nq?used:'';
    var positions=new Map(bottles.map(function(r,i){return [r.slug,i];})), phrase=words.join(' ');
    var hits=q?others.concat(bottles.map(function(r){return bottleItem.get(r.slug);}).filter(Boolean)):[];
    var groups=kinds.slice(1).map(function(k){return {kind:k,items:hits.filter(function(x){return x.kind===k;})};});
    // By meaning: stories and bottles the words missed come after the word matches; bottles still keep the price, score and style asked for.
    var near=q?(opts.live?(meaningOf.get(q.toLowerCase().replace(/\s+/g,' ').trim())||null):meaning(q)):null, added=0;
    if(near){ var have=new Set(hits.map(function(x){return x.href;})), intent=WA.understand(q); intent.terms=[];
      var addTo=function(kindName,items){var g=groups.find(function(x){return x.kind===kindName;});items.forEach(function(x){if(x&&!have.has(x.href)){have.add(x.href);g.items.push(x);hits.push(x);added++;}});};
      addTo('Story',near.stories.map(function(slug){return storyBySlug.get(slug);}));
      var okBottles=new Set(WA.apply(intent,near.bottles.map(function(slug){return ratingBySlug.get(slug);}).filter(Boolean)).map(function(r){return r.slug;}));
      addTo('Bottle',near.bottles.filter(function(slug){return okBottles.has(slug);}).map(function(slug){return bottleItem.get(slug);}));
      // A search that names no producer ("something smoky for a cold night") is a description: the bottles closest in meaning lead,
      // ahead of bottles that only share a word with it ("Cold Brew"). A name search ("ardbeg 10") keeps the word order.
      var named=WA.nameTerms(q).some(function(t){return producerWords.has(t);});
      if(!named){ var order=new Map(near.bottles.filter(function(slug){return okBottles.has(slug);}).map(function(slug,i){return [WA.bottleHref(slug),i];})), g=groups.find(function(x){return x.kind==='Bottle';});
        g.items.sort(function(a,b){var ia=order.has(a.href)?order.get(a.href):1e6, ib=order.has(b.href)?order.get(b.href):1e6; return ia-ib;}); } }
    groups.forEach(function(g){arrange(g,words,phrase);}); sortOptions();
    tabs.innerHTML=kinds.map(function(k){var n=k==='All'?hits.length:groups.find(function(g){return g.kind===k;}).items.length;return '<button type="button" class="pill" data-type="'+k+'" aria-pressed="'+(kind===k)+'">'+labels[k]+(q?' <span>'+n.toLocaleString()+'</span>':'')+'</button>';}).join('');
    var said=q?hits.length.toLocaleString()+' results for “'+(corrected||q)+'”'+(bottles.approximate?' · Includes close bottle-name matches.':'')+(added?' · Includes '+added.toLocaleString()+' found by meaning.':(bottles.approximate?'':'.')):'Search a bottle, ingredient, producer or subject.';
    status.innerHTML=esc(said)+(corrected?' <button type="button" class="ds-instead">Search for “'+esc(q)+'” instead</button>':'');
    var visible=groups.filter(function(g){return g.items.length&&(kind==='All'||g.kind===kind);});
    if(kind==='All')visible.sort(function(a,b){return Number(b.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}))-Number(a.items.some(function(x){return WA.norm(x.title)===WA.norm(q);}));});
    results.innerHTML=visible.map(function(g){var count=kind==='All'?3:limit;return '<section class="discovery-group"><div class="results-heading"><h2>'+labels[g.kind]+' <span>'+g.items.length.toLocaleString()+'</span></h2>'+(kind==='All'&&g.items.length>count?'<button type="button" class="pill" data-type="'+g.kind+'">View all '+labels[g.kind].toLowerCase()+'</button>':'')+'</div><div class="reader-grid">'+g.items.slice(0,count).map(function(x){return card(x,corrected||q);}).join('')+'</div></section>';}).join('');
    if(q&&!visible.length)results.innerHTML='<div class="reader-empty"><h2>No '+(kind==='All'?'matching content':labels[kind].toLowerCase())+'</h2><p>Try fewer words or another spelling'+(kind==='All'?'.':', or view All results.')+'</p></div>';
    more.hidden=kind==='All'||!visible.length||visible[0].items.length<=limit;
  }
  function load() {
    status.textContent='Loading search…';
    // Stories published from the CMS since the export come from WA.liveStories (site.js) and lead the story list.
    Promise.all(['ratings.json','stories.json','stories-archive.json','cocktails.json'].map(WA.loadJSON).concat([WA.liveStories?WA.liveStories():Promise.resolve(null)])).then(function(sets){
      var fresh=sets[4];if(fresh&&fresh.stories){var drop={};(fresh.removed||[]).concat(fresh.stories.map(function(s){return s.slug;})).forEach(function(k){drop[String(k).toLowerCase()]=1;});sets[1]=fresh.stories.filter(function(s){return (fresh.removed||[]).indexOf(s.slug)<0;}).concat(sets[1].filter(function(s){return !drop[s.slug.toLowerCase()];}));sets[2]=sets[2].filter(function(s){return !drop[s.slug.toLowerCase()];});}
      index=[];storyBySlug=new Map();ratingBySlug=new Map();bottleItem=new Map();var producers=new Set(),seen=new Set();ratings=sets[0].rows.map(function(row){return Object.fromEntries(sets[0].cols.map(function(c,i){return [c,row[i]];}));});
      ratings.forEach(function(r){producers.add(r.pr);ratedBy.set(r.pr,(ratedBy.get(r.pr)||0)+1);var item={kind:'Bottle',title:r.n,href:WA.bottleHref(r.slug),rating:r,date:r.d,description:r.c+' · '+WA.fmt(r.p)+(r.d?' · Reviewed '+r.d.slice(0,4):'')};index.push(item);ratingBySlug.set(r.slug,r);bottleItem.set(r.slug,item);WA.norm(r.pr).split(' ').forEach(function(w){if(w.length>=3&&!/^(the|and|distillery|distilling|distillers|company|spirits|whisky|whiskey|co)$/.test(w))producerWords.add(w);});});
      sets[1].concat(sets[2]).forEach(function(s){if(seen.has(s.slug))return;seen.add(s.slug);var item={kind:'Story',title:s.title,href:WA.storyHref(s),img:s.hero||'',description:s.dek,date:s.d,hay:WA.norm(s.title+' '+s.dek+' '+(s.tags||[]).join(' '))};index.push(item);storyBySlug.set(s.slug,item);});
      sets[3].filter(WACatalog.validRecipe).forEach(function(r){index.push({kind:'Recipe',title:r.name,href:WA.recipeHref(r.slug),img:r.img||'',description:r.ingredients.length+' ingredients · '+r.ingredients.slice(0,2).join(', '),date:r.d,hay:WA.norm(r.name+' '+r.ingredients.join(' '))});});
      producers.forEach(function(name){if(name&&name!=='Unknown producer')index.push({kind:'Producer',title:name,href:WA.producerHref(name),description:'Explore the reviews and portfolio',hay:WA.norm(name)});});words();ready=true;render();
    }).catch(function(){status.textContent='Search could not load. Your query is preserved.';results.innerHTML='<button type="button" class="pill" id="discoveryRetry">Retry search</button>';document.getElementById('discoveryRetry').onclick=load;});
  }
  document.getElementById('discoveryForm').onsubmit=function(e){e.preventDefault();navigate(kind);};
  function choose(e){var b=e.target.closest('[data-type]');if(b){navigate(b.dataset.type);tabs.querySelector('[data-type="'+kind+'"]').focus();}}
  tabs.addEventListener('click',choose);results.addEventListener('click',choose);more.onclick=function(){limit+=12;render();};
  addEventListener('popstate',function(){restore();ask(input.value.trim());render();});restore();ask(input.value.trim());load();
})();
