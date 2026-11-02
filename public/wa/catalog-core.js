/* Shared catalogue rules for browser search and pantry matching. No network or DOM dependencies. */
(function (root) {
  'use strict';
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var intent = /^(best|top|great|good|under|below|over|for|a|an|the|with|and|or|of|in|to|me|my|whisky|whiskey|whiskies|bottle|bottles|something|like|rated|points?|pts|dollars?|night|gift|cheap|value|smoky|smoke|peat|peated|peaty|sweet|sherry|sherried|rich|light|bourbon|rye|scotch|irish|japanese|japan|canadian|single|malt|blended|blend|highland|speyside|islay|winter|summer|first|friend|year|years|old|cask|strength|proof|from|that|this|what|which|should|use|worth|price|higher|better|maximum|minimum|up|at|least|someone|who|loves|likes|love|like|manhattan|cocktail|cocktails|drink|drinking|recommend|please)$/;
  var pricePattern = /(?:under|below|less than|up to|max(?:imum)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i;
  var scorePattern = /(?:rated\s+)?(\d{2})\s*(?:points?|pts|\+|or higher|or better|and up)/i;
  function nameTerms(q) {
    return norm(String(q).replace(pricePattern, ' ').replace(/\$\s*\d+(?:\.\d{1,2})?/, ' ').replace(scorePattern, ' ')).split(' ').filter(function (t) { return (/\d/.test(t) || t.length >= 3) && !intent.test(t); });
  }
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var rows = [Array.from({length:b.length + 1}, function (_, i) { return i; })];
    for (var i = 1; i <= a.length; i++) {
      var row = [i];
      for (var j = 1; j <= b.length; j++) {
        row[j] = Math.min(row[j - 1] + 1, rows[i - 1][j] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
      }
      rows.push(row);
    }
    return rows[a.length][b.length];
  }
  function tokens(r) { return r._catalogTokens || (r._catalogTokens = norm(r.n + ' ' + (r.pr || '')).split(' ')); }
  function termScore(t, words) {
    if (words.indexOf(t) >= 0) return 4;
    if (/\d/.test(t)) return 0; // Ages, batch numbers and strength must not become approximate matches.
    if (words.some(function (w) { return t.length >= 3 && w.indexOf(t) === 0; })) return 3;
    return words.some(function (w) { return t.length >= 4 && w.length >= 4 && distance(t, w) <= (t.length > 7 ? 2 : 1); }) ? 1 : 0;
  }
  function nameScore(terms, r) {
    var sum = 0, words = tokens(r);
    for (var i = 0; i < terms.length; i++) { var hit = termScore(terms[i], words); if (!hit) return 0; sum += hit; }
    return sum;
  }
  function understand(raw) {
    var q = String(raw || '').replace(/\bpeety\b/ig, 'peaty').replace(/\bsherryed\b/ig, 'sherried');
    var f = {raw:raw,text:q,terms:nameTerms(q),types:[],price:null,score:null,chars:[]};
    function type(key, cats) { f.types.push({key:key,cats:cats}); }
    if (/\bbourbon\b|\btennessee\b|\bwheated\b/i.test(q)) type('Bourbon', ['Bourbon/Tennessee Whiskey','Bourbon/Tennessee']);
    if (/\brye\b|\bmanhattan\b|\bsazerac\b/i.test(q)) type('Rye', ['Rye Whiskey','Rye Malt']);
    if (/\bscotch\b|\bspeyside\b|\bhighland\b|\bislay\b|\blagavulin\b|\bardbeg\b|\blaphroaig\b|\bmacallan\b/i.test(q)) {
      type('Scotch', /\bblended?\b/i.test(q) ? ['Blended Scotch Whisky','Blended  Scotch Whisky','Blended Malt Scotch Whisky','Blended Grain Scotch Whisky'] : /\bsingle malt\b|\bspeyside\b|\bhighland\b|\bislay\b|\bardbeg\b|\blagavulin\b|\blaphroaig\b|\bmacallan\b/i.test(q) ? ['Single Malt Scotch'] : ['Single Malt Scotch','Single Grain Scotch','Blended Scotch Whisky','Blended  Scotch Whisky','Blended Malt Scotch Whisky','Blended Grain Scotch Whisky']);
    }
    if (/\birish\b|\bpot still\b|\bredbreast\b/i.test(q)) type('Irish', ['Irish','Irish Single Malt','Irish Single Pot Still','Blended Irish Whiskey','Single Grain Irish Whiskey']);
    if (/\bjapan(?:ese)?\b|\byamazaki\b|\bhibiki\b|\bnikka\b/i.test(q)) type('Japanese', ['Japanese Whisky','Japanese Single Malt','Japanese Single Grain','Japanese Blended Malt','Japanese Blended Grain','Japanese Rice Whisky','Blended Japanese Whisky']);
    if (/\bcanad(?:ian|a)\b/i.test(q)) type('Canadian', ['Canadian']);
    if (/american single malt/i.test(q)) type('American single malt', ['American Single Malt','Single Malt American Whiskey','American Malt','American Malt Whiskey']);
    var p = q.match(pricePattern) || q.match(/\$\s*(\d+(?:\.\d{1,2})?)/); if (p) f.price = +p[1];
    var s = q.match(scorePattern); if (s) f.score = +s[1];
    if (/smok|peat|islay|lagavulin|ardbeg|laphroaig|bonfire/i.test(q)) f.chars.push('smoky');
    if (/sherr|sweet|fruit|dessert|winter|christmas|raisin|honey/i.test(q)) f.chars.push('sweet');
    if (/\brich\b|oily|full|chewy|cask strength|\bbig\b/i.test(q)) f.chars.push('rich');
    if (/\blight\b|delicate|floral|summer|easy|gentle|aperitif/i.test(q)) f.chars.push('light');
    if (/value|worth the price|bang for|cheap|budget|affordable/i.test(q) && !p) f.price = 80;
    if (/\bbest\b|\btop\b|\bgreat\b|excellent/i.test(q) && !s) f.score = 90;
    return f;
  }
  function apply(f, rows) {
    var terms = f.terms || [], keys = {smoky:'sm',sweet:'sw',rich:'ri',light:'li'};
    var matches = rows.filter(function (r) {
      return (!terms.length || nameScore(terms, r)) && (!f.types.length || f.types.some(function (t) { return t.cats.indexOf(r.c) >= 0; })) && (!f.price || (r.p > 0 && r.p <= f.price)) && (!f.score || r.s >= f.score);
    });
    function rank(r) { return r.s + (f.chars || []).reduce(function (n,c) { return n + Math.min(3, Number(r[keys[c]]) || 0) * 1.5; }, 0); }
    matches.sort(function (a,b) { return nameScore(terms,b) - nameScore(terms,a) || rank(b) - rank(a) || (b.d || '').localeCompare(a.d || '') || (a.p || 1e9) - (b.p || 1e9); });
    matches.approximate = !!(matches.length && terms.length && terms.some(function (t) { return tokens(matches[0]).indexOf(t) < 0; }));
    return matches;
  }
  var pantry = [
    ['bourbon', /\bbourbon\b|maker.s mark|woodford|buffalo trace|wild turkey|four roses|elijah craig|old forester|knob creek|evan williams/i],
    ['rye', /\brye\b|rittenhouse|sazerac|whistlepig|high west/i], ['scotch', /scotch|johnnie walker|monkey shoulder|glenfiddich|dewar|laphroaig|ardbeg|macallan|talisker|bowmore|highland park/i],
    ['irish', /irish|jameson|redbreast|bushmills|teeling|tullamore/i], ['japanese', /japanese|hibiki|yamazaki|nikka/i],
    ['sweet vermouth', /sweet vermouth|vermouth rosso|carpano|punt e mes/i], ['dry vermouth', /dry vermouth/i],
    ['lemon', /\blemon\b/i], ['lime', /\blime\b/i], ['orange', /\borange(?: juice)?\b/i],
    ['bitters', /\bbitters\b/i], ['simple syrup', /(?:rich )?simple syrup|demerara syrup/i], ['honey', /\bhoney\b/i], ['maple', /\bmaple syrup\b/i],
    ['egg white', /egg white|aquafaba/i], ['mint', /\bmint\b/i], ['ginger', /\bginger(?: juice)?\b/i],
    ['amaro', /\bamaro\b|campari|aperol|fernet|cynar/i], ['coffee', /coffee|espresso/i], ['apple', /apple juice|apple cider/i],
    ['soda', /soda water|club soda|seltzer/i], ['ginger beer', /ginger beer/i], ['ginger ale', /ginger ale/i], ['tonic', /tonic water/i]
  ];
  function validRecipe(r) {
    return !!(r && typeof r.name === 'string' && r.name.trim() && !/^(directions|ingredients|method|instructions|preparation)[:\s]*$/i.test(r.name) && typeof r.slug === 'string' && r.slug && Array.isArray(r.ingredients) && r.ingredients.length >= 2 && r.ingredients.every(function (i) { return typeof i === 'string' && i.trim().length > 0; }) && typeof r.method === 'string' && r.method.trim());
  }
  function missingIngredients(r, selected) {
    return r.ingredients.filter(function (ingredient) {
      if (/\bfor (?:the )?(?:garnish|rim)\b|\boptional\b|^\s*(?:ice|water|salt|sugar)\s*$/i.test(ingredient)) return false;
      var text = ingredient.replace(/^\s*[\d\s./½¼¾⅓⅔⅛]+(?:oz\.?|ounces?|ml|cl|tsp\.?|tbsp\.?|teaspoons?|tablespoons?|dashes?|drops?|cups?|pinch)?\s*/i, '');
      if (/^(?:ice(?: cubes?)?|water|salt|sugar)(?:\s|$)/i.test(text)) return false;
      if (/infused|recipe below/i.test(text) && !/^(?:rich )?simple syrup/i.test(text)) return true;
      if (/liqueur|brandy|ginger beer|ginger ale|tonic/i.test(text)) return !pantry.some(function (c) { return selected.indexOf(c[0]) >= 0 && ['ginger beer','ginger ale','tonic'].indexOf(c[0]) >= 0 && c[1].test(text); });
      // Each ingredient is mapped to its most specific category before consulting the pantry.
      var category = /bitters/i.test(text) ? 'bitters' : /sweet vermouth|vermouth rosso/i.test(text) ? 'sweet vermouth' : /dry vermouth/i.test(text) ? 'dry vermouth' : null;
      if (category) return selected.indexOf(category) < 0;
      return !pantry.some(function (c) { return selected.indexOf(c[0]) >= 0 && c[1].test(text); });
    });
  }
  var api = {norm:norm,nameTerms:nameTerms,nameScore:nameScore,understand:understand,apply:apply,pantry:pantry,validRecipe:validRecipe,missingIngredients:missingIngredients};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WACatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
