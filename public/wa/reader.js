/* Reader tools: durable local saves, discovery, dialog keyboard behavior and preferences. */
(function () {
  'use strict';
  var core = window.WAReader, esc = core.escape, state, readable = true;
  var status = document.createElement('div'); status.className = 'reader-status'; status.setAttribute('role', 'status'); status.hidden = true; document.body.appendChild(status);
  function notice(text, undo) {
    status.replaceChildren(); status.hidden = false; status.appendChild(document.createTextNode(text + ' '));
    if (undo) { var b = document.createElement('button'); b.className = 'pill'; b.textContent = 'Undo'; b.onclick = undo; status.appendChild(b); }
    var close = document.createElement('button'); close.className = 'pill'; close.textContent = 'Dismiss'; close.onclick = function () { status.hidden = true; }; status.appendChild(close);
  }
  function load() { try { state = core.read(localStorage); readable = true; } catch (e) { state = core.empty(); readable = false; notice('Saved items are unavailable in this browser. Existing data has not been overwritten.'); } }
  load();
  function change(update, message) {
    if (!readable) { notice('Storage is unavailable. Enable browser storage and reload to save.'); return false; }
    try { var before = core.read(localStorage), next = JSON.parse(JSON.stringify(before)); update(next); core.write(localStorage, next); state = next; if (message) notice(message); document.dispatchEvent(new Event('wa:shelf')); return true; }
    catch (e) { notice('Could not save. Browser storage may be full or disabled. Your last saved items are unchanged.'); return false; }
  }
  var bottleHeading = document.querySelector('.bottle-heading'), bottleArt = document.querySelector('.bottle-hero .hero-art');
  if (bottleHeading && bottleArt) { var originalPosition = document.createComment('Bottle image position'); bottleArt.before(originalPosition); var phoneLayout = matchMedia('(max-width: 600px)'); function placeBottleArt() { if (phoneLayout.matches) bottleHeading.appendChild(bottleArt); else originalPosition.after(bottleArt); } phoneLayout.addEventListener('change', placeBottleArt); placeBottleArt(); }
  var storeButton = document.getElementById('storeBtn'); if (storeButton) { var commerceNote = document.createElement('p'); commerceNote.className = 'muted'; commerceNote.textContent = 'Confirm current price and availability with the retailer.'; storeButton.closest('.actions').after(commerceNote); }
  WA.reader = { notice: notice, pantry: function () { return state.pantry.slice(); }, setPantry: function (items) { return change(function (s) { s.pantry = items; }, 'Pantry saved on this device.'); } };
  var tools = document.querySelector('.mast .tools');
  if (tools) { var link = document.createElement('a'); link.className = 'pill shelf-link'; link.href = 'shelf.html'; link.textContent = 'My Shelf'; tools.appendChild(link); }
  document.querySelectorAll('#waMenu .menu-group').forEach(function (group, i) { if (!i) { var a = document.createElement('a'); a.href = 'shelf.html'; a.textContent = 'My Shelf'; a.className = 'shelf-menu-link'; group.querySelector('.mono').after(a); } });
  var saveBindings = new Map();
  document.addEventListener('wa:shelf', function () { saveBindings.forEach(function (paint, button) { if (button.isConnected) paint(); else saveBindings.delete(button); }); });
  WA.bindSave = function (button, item) {
    function paint() { var saved = state.shelf.some(function (x) { return x.kind === item.kind && x.slug === item.slug; }); button.textContent = saved ? 'Remove from My Shelf' : 'Save to My Shelf'; button.setAttribute('aria-pressed', String(saved)); }
    button.onclick = function () {
      var existing = state.shelf.find(function (x) { return x.kind === item.kind && x.slug === item.slug; });
      if (change(function (s) { s.shelf = s.shelf.filter(function (x) { return x.kind !== item.kind || x.slug !== item.slug; }); if (!existing) s.shelf.push(Object.assign({ savedAt: Date.now(), status: 'want', notes: '' }, item)); }, existing ? 'Removed from My Shelf.' : 'Saved on this device.')) {
        if (existing) notice('Removed from My Shelf.', function () { change(function (s) { if (!s.shelf.some(function (x) { return x.kind === existing.kind && x.slug === existing.slug; })) s.shelf.push(existing); }, 'Restored to My Shelf.'); });
      }
    };
    saveBindings.set(button, paint); paint();
  };
  var shelfView = { kind: 'all', query: '', order: 'recent', limit: 24 };
  function shelf() {
    var root = document.getElementById('readerShelf'); if (!root) return;
    var query = shelfView.query.toLowerCase();
    var rows = state.shelf.filter(function (x) { return (shelfView.kind === 'all' || x.kind === shelfView.kind || (shelfView.kind === 'owned' && x.kind === 'bottle' && x.status === 'owned') || (shelfView.kind === 'want' && x.kind === 'bottle' && x.status !== 'owned')) && (x.title + ' ' + (x.notes || '')).toLowerCase().includes(query); });
    rows.sort(function (a,b) { return shelfView.order === 'name' ? a.title.localeCompare(b.title) : (b.savedAt || 0) - (a.savedAt || 0); });
    document.getElementById('shelfCount').textContent = rows.length + (rows.length === 1 ? ' saved item' : ' saved items');
    root.replaceChildren();
    if (!rows.length) { root.innerHTML = '<div class="shelf-empty"><span class="mono">Your collection</span><h2>' + (state.shelf.length ? 'No matching saves' : 'Keep the good finds') + '</h2><p>' + (state.shelf.length ? 'Try another search or collection.' : 'Save bottles to try, keep tasting notes, and collect stories and recipes for later.') + '</p><div class="actions"><a class="pill solid" href="finder.html">Find a bottle</a><a class="pill" href="cocktails.html">Explore recipes</a></div></div>'; }
    rows.slice(0,shelfView.limit).forEach(function (item,index) {
      var card = document.createElement('article'); card.className = 'reader-card shelf-card';
      var href = item.kind === 'recipe' ? WA.recipeHref(item.slug) : item.kind === 'story' ? WA.storyHref({ slug: item.slug }) : WA.bottleHref(item.slug);
      card.innerHTML = '<span class="mono">' + esc(item.kind) + '</span><h2><a href="' + esc(href) + '">' + esc(item.title) + '</a></h2>';
      if (item.kind === 'bottle') {
        var label = document.createElement('label'); label.className = 'shelf-status'; label.textContent = 'Collection';
        var select = document.createElement('select'); select.innerHTML = '<option value="want">Want to try</option><option value="owned">On my shelf</option>'; select.value = item.status === 'owned' ? 'owned' : 'want'; label.appendChild(select); card.appendChild(label);
        select.onchange = function () { var value = select.value; change(function (s) { s.shelf.find(function (x) { return x.kind === item.kind && x.slug === item.slug; }).status = value; }, 'Collection updated.'); };
      }
      var detail = document.createElement('details'); detail.className = 'shelf-notes';
      detail.innerHTML = '<summary>' + (item.notes ? 'View your notes' : 'Add a note') + '</summary><label for="shelfNote' + index + '">Your notes</label><textarea id="shelfNote' + index + '" maxlength="2000" rows="3" placeholder="Tasting notes, gift ideas, or what to try next"></textarea><button type="button" class="pill">Save note</button>';
      detail.querySelector('textarea').value = item.notes || '';
      detail.querySelector('button').onclick = function () { var note = detail.querySelector('textarea').value; if (change(function (s) { s.shelf.find(function (x) { return x.kind === item.kind && x.slug === item.slug; }).notes = note; }, 'Note saved on this device.')) { var target = root.querySelectorAll('.shelf-card')[index]; if (target) target.querySelector('summary').focus(); } };
      card.appendChild(detail);
      var b = document.createElement('button'); b.className = 'pill shelf-remove'; card.appendChild(b); WA.bindSave(b, item); root.appendChild(card);
    });
    document.getElementById('shelfMore').hidden = rows.length <= shelfView.limit;
  }
  var shelfControls = document.getElementById('shelfControls');
  if (shelfControls) {
    document.getElementById('shelfQuery').oninput = function (e) { shelfView.query = e.target.value; shelfView.limit = 24; shelf(); };
    document.getElementById('shelfKind').onchange = function (e) { shelfView.kind = e.target.value; shelfView.limit = 24; shelf(); };
    document.getElementById('shelfOrder').onchange = function (e) { shelfView.order = e.target.value; shelf(); };
    document.getElementById('shelfMore').onclick = function () { shelfView.limit += 24; shelf(); };
    document.getElementById('shelfExport').onclick = function () { if (!readable) { notice('Storage is unavailable. Reload before exporting.'); return; } var url = URL.createObjectURL(new Blob([JSON.stringify({ version:1, shelf:state.shelf }, null, 2)], { type:'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'whisky-advocate-shelf.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
    document.getElementById('shelfImport').onchange = function (e) { var file = e.target.files[0]; if (!file) return; if (file.size > 2000000) { notice('Choose a Shelf export smaller than 2 MB.'); e.target.value = ''; return; } file.text().then(function (text) { core.importShelf(text, state); change(function (s) { s.shelf = core.importShelf(text, s).shelf; }, 'Shelf imported. Existing items and notes were kept.'); }).catch(function (err) { notice(err instanceof SyntaxError ? 'Choose a valid My Shelf JSON export.' : err.message); }).finally(function () { e.target.value = ''; }); };
  }
  document.addEventListener('wa:shelf', shelf); shelf();
  addEventListener('storage', function (e) { if (e.key === core.key || e.key === null) { load(); document.dispatchEvent(new Event('wa:shelf')); } });

  /* Native dialog-like focus containment for the existing menu, search and assistant. */
  var modalEntries = [], inertBefore = new Map();
  function modalBackground() {
    var open = modalEntries.filter(function (entry) { return entry.observed.getAttribute('data-open') === 'true'; });
    inertBefore.forEach(function (value, node) { node.inert = value; }); inertBefore.clear();
    document.body.classList.toggle('reader-modal-open', !!open.length);
    if (!open.length) return;
    var active = open[open.length - 1].el;
    Array.from(document.body.children).forEach(function (node) { if (node.contains(active) || node.tagName === 'SCRIPT') return; inertBefore.set(node, node.inert); node.inert = true; });
  }
  function dialog(el, label, trigger, observed) {
    if (!el) return;
    observed = observed || el;
    modalEntries.push({ el: el, observed: observed });
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label); el.setAttribute('aria-modal', 'true');
    var last = null, previous = false;
    function opened() { return observed.getAttribute('data-open') === 'true'; }
    function focusables() { return Array.from(el.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')).filter(function (x) { return !x.disabled && x.getClientRects().length; }); }
    new MutationObserver(function () { var on = opened(); modalBackground(); if (on && !previous) { last = el.contains(document.activeElement) ? trigger || document.querySelector(el.id === 'waMenu' ? '.burger' : '.search-btn') : document.activeElement; var first = focusables()[0]; if (first) first.focus(); } if (!on && previous && last) last.focus(); previous = on; }).observe(observed, { attributes: true, attributeFilter: ['data-open'] });
    el.addEventListener('keydown', function (e) { if (e.key !== 'Tab' || !opened()) return; var list = focusables(), first = list[0], last = list[list.length - 1]; if (!first) { e.preventDefault(); return; } if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } });
  }
  dialog(document.getElementById('waSearch'), 'Search Whisky Advocate'); dialog(document.getElementById('waMenu'), 'Site menu');
  dialog(document.querySelector('.chat-panel'), 'Ask Whisky Advocate', document.getElementById('waChatFab'), document.getElementById('waChat'));
  WA.reader.dialog = dialog;
  var chatLog = document.getElementById('waChatLog'); if (chatLog) { var disclaimer = document.createElement('p'); disclaimer.className = 'muted'; disclaimer.textContent = 'AI suggestions can be wrong. Check the linked reviews and bottle labels.'; chatLog.prepend(disclaimer); chatLog.setAttribute('role','log'); chatLog.setAttribute('aria-live','polite'); }

  var main = document.querySelector('main');
  if (!main) { var first = document.querySelector('body > section, body > .finder, body > .hero'); if (first) { main = document.createElement('main'); first.before(main); var next = first; while (next && next.tagName !== 'FOOTER' && next.tagName !== 'SCRIPT') { var following = next.nextSibling; main.appendChild(next); next = following; } } }
  if (main) { main.id = main.id || 'main-content'; main.tabIndex = -1; var skip = document.createElement('a'); skip.className = 'skip-link'; skip.href = '#' + main.id; skip.textContent = 'Skip to content'; document.body.prepend(skip); }
  document.querySelectorAll('input,select').forEach(function (el) { if (!el.getAttribute('aria-label') && !el.labels.length && el.placeholder) el.setAttribute('aria-label', el.placeholder); });
  function mediaNames() { document.querySelectorAll('.ad[aria-label]:not([role])').forEach(function (el) { el.setAttribute("role","region"); }); document.querySelectorAll('a:has(img)').forEach(function (a) { if (!a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) { var card = a.closest('article'), heading = card && card.querySelector('h2,h3'); a.setAttribute('aria-label', heading ? heading.textContent : 'View content'); } }); }
  mediaNames(); new MutationObserver(mediaNames).observe(document.body, { childList: true, subtree: true });
  function responsiveMedia() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData)) document.querySelectorAll('video[autoplay]:not([controls])').forEach(function (v) { v.pause(); v.removeAttribute('autoplay'); v.preload = 'none'; });
    document.querySelectorAll('img:not([data-reader-media])').forEach(function (im) {
      if (!im.getAttribute('src')) return;
      im.setAttribute('data-reader-media',''); im.decoding = 'async';
      if (im.closest('.editorial-image')) { var fallback = function () { if (im.naturalWidth) return; var parent = im.parentElement; if (!parent) return; im.hidden = true; if (!parent.querySelector('.media-fallback')) { var label = document.createElement('span'); label.className = 'media-fallback'; label.textContent = 'Whisky Advocate'; parent.appendChild(label); } }; im.addEventListener('error', fallback); if (im.complete) fallback(); }
      var url = new URL(im.src,location.href);
      if (url.origin === location.origin && /^\/wa\/img\/.*\.(png|jpe?g|webp)$/i.test(url.pathname) && !im.srcset) {
        im.srcset = [256,384,640,1080].map(function (w) { return '/_next/image?url=' + encodeURIComponent(url.pathname) + '&w=' + w + '&q=75 ' + w + 'w'; }).join(', ');
        im.sizes = '(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 640px';
      }
      if (!im.hasAttribute('loading') && im.getBoundingClientRect().top > innerHeight * 1.5) im.loading = 'lazy';
    });
  }
  responsiveMedia(); new MutationObserver(responsiveMedia).observe(document.body, { childList:true, subtree:true });

  /* Unsupported speech input is omitted; errors and recording state are explicit. */
  document.querySelectorAll('.mic').forEach(function (b) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { b.hidden = true; return; }
    var recognition = new Recognition(), active = false; recognition.lang = 'en-US';
    b.onclick = function () { if (active) { recognition.stop(); return; } try { recognition.start(); } catch (e) { notice('Voice input could not start. You can type your search.'); } };
    recognition.onstart = function () { active = true; b.setAttribute('aria-pressed','true'); b.setAttribute('aria-label','Stop listening'); notice('Listening. Speak your search; tap the microphone to stop.'); };
    recognition.onend = function () { active = false; b.setAttribute('aria-pressed','false'); b.setAttribute('aria-label','Search by voice'); };
    recognition.onerror = function (e) { notice(e.error === 'not-allowed' ? 'Microphone permission was denied. Type your search or allow microphone access in browser settings.' : 'Voice input is unavailable (' + e.error + '). Please type your search.'); };
    recognition.onresult = function (e) { var input = b.closest('form').querySelector('input'); input.value = e.results[0][0].transcript; input.dispatchEvent(new Event('input', { bubbles:true })); notice('Voice search entered. Review it, then submit.'); };
  });

  /* Reading preferences are local and never imply an account or paid audio service. */
  var article = document.getElementById('prose');
  if (article) {
    // An "Aa" pill in the story's action row opens a small card: text size and listening speed, as segmented choices.
    var SIZES = [['1', 'Standard'], ['1.15', 'Large'], ['1.3', 'Larger']], RATES = [['0.8', '0.8×'], ['1', '1×'], ['1.2', '1.2×']];
    var current = { size: String(state.preferences.size || '1'), rate: String(state.preferences.rate || '1') };
    var wrap = document.createElement('div'); wrap.className = 'reader-preferences';
    wrap.innerHTML = '<button type="button" class="pill rp-toggle" aria-expanded="false" aria-controls="rpCard" aria-label="Reading settings"><span aria-hidden="true">Aa</span></button>'
      + '<div class="rp-card glass" id="rpCard" role="group" aria-label="Reading settings" hidden>'
      + '<div class="rp-row"><span class="rp-label">Text size</span><div class="rp-seg" role="radiogroup" aria-label="Text size">' + SIZES.map(function (o, i) { return '<button type="button" role="radio" data-size="' + o[0] + '" aria-label="' + o[1] + '" style="font-size:' + (13 + i * 3) + 'px">A</button>'; }).join('') + '</div></div>'
      + '<div class="rp-row"><span class="rp-label">Listening speed</span><div class="rp-seg" role="radiogroup" aria-label="Listening speed">' + RATES.map(function (o) { return '<button type="button" role="radio" data-rate="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div>'
      + '<p class="rp-note">Saved on this device.</p></div>';
    var row = document.querySelector('.story-head .actions, #listen') ; row = row && (row.classList && row.classList.contains('actions') ? row : row.parentElement);
    if (row) row.appendChild(wrap); else article.before(wrap);
    var toggle = wrap.querySelector('.rp-toggle'), card = wrap.querySelector('.rp-card');
    function paint() {
      wrap.querySelectorAll('[data-size]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-size') === current.size)); b.tabIndex = b.getAttribute('data-size') === current.size ? 0 : -1; });
      wrap.querySelectorAll('[data-rate]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-rate') === current.rate)); b.tabIndex = b.getAttribute('data-rate') === current.rate ? 0 : -1; });
    }
    function apply() { article.style.fontSize = (18 * Number(current.size)) + 'px'; WA.readingRate = Number(current.rate); paint(); }
    function open(on) { card.hidden = !on; toggle.setAttribute('aria-expanded', String(on)); }
    toggle.addEventListener('click', function () { open(card.hidden); });
    document.addEventListener('click', function (e) { if (!card.hidden && !wrap.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !card.hidden) { open(false); toggle.focus(); } });
    card.addEventListener('click', function (e) {
      var b = e.target.closest('[data-size],[data-rate]'); if (!b) return;
      if (b.hasAttribute('data-size')) current.size = b.getAttribute('data-size'); else current.rate = b.getAttribute('data-rate');
      apply(); change(function (s) { s.preferences = { size: current.size, rate: current.rate }; }, ''); // the card itself says the settings stay on this device
    });
    card.addEventListener('keydown', function (e) { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key) || e.target.getAttribute('role') !== 'radio') return; e.preventDefault(); var list = Array.from(e.target.parentElement.querySelectorAll('[role=radio]')), i = list.indexOf(e.target); i = e.key === 'Home' ? 0 : e.key === 'End' ? list.length-1 : (i + (/Left|Up/.test(e.key) ? -1 : 1) + list.length) % list.length; list[i].click(); list[i].focus(); });
    apply();
  }
})();
