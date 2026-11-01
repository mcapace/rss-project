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
  var storeButton = document.getElementById('storeBtn'); if (storeButton) { var commerceNote = document.createElement('p'); commerceNote.className = 'muted'; commerceNote.textContent = 'Confirm current price and availability with the retailer.'; storeButton.closest('.actions').after(commerceNote); }
  WA.reader = { notice: notice, pantry: function () { return state.pantry.slice(); }, setPantry: function (items) { return change(function (s) { s.pantry = items; }, 'Pantry saved on this device.'); } };
  var tools = document.querySelector('.mast .tools');
  if (tools) { var link = document.createElement('a'); link.className = 'pill shelf-link'; link.href = 'shelf.html'; link.textContent = 'My Shelf'; tools.appendChild(link); }
  document.querySelectorAll('#waMenu .menu-group').forEach(function (group, i) { if (!i) { var a = document.createElement('a'); a.href = 'shelf.html'; a.textContent = 'My Shelf'; group.appendChild(a); } });
  WA.bindSave = function (button, item) {
    function paint() { var saved = state.shelf.some(function (x) { return x.kind === item.kind && x.slug === item.slug; }); button.textContent = saved ? 'Remove from My Shelf' : 'Save to My Shelf'; button.setAttribute('aria-pressed', String(saved)); }
    button.onclick = function () {
      var existing = state.shelf.find(function (x) { return x.kind === item.kind && x.slug === item.slug; });
      if (change(function (s) { s.shelf = s.shelf.filter(function (x) { return x.kind !== item.kind || x.slug !== item.slug; }); if (!existing) s.shelf.push(item); }, existing ? 'Removed from My Shelf.' : 'Saved on this device.')) {
        if (existing) notice('Removed from My Shelf.', function () { change(function (s) { if (!s.shelf.some(function (x) { return x.kind === existing.kind && x.slug === existing.slug; })) s.shelf.push(existing); }, 'Restored to My Shelf.'); });
      }
    };
    document.addEventListener('wa:shelf', paint); paint();
  };
  function shelf() {
    var root = document.getElementById('readerShelf'); if (!root) return;
    root.replaceChildren();
    if (!state.shelf.length) { root.innerHTML = '<p>Your shelf is empty. Save a bottle, story or recipe to find it here.</p><a class="pill" href="finder.html">Explore ratings</a>'; return; }
    state.shelf.forEach(function (item) {
      var card = document.createElement('article'); card.className = 'reader-card';
      var a = document.createElement('a'); a.textContent = item.title; a.href = item.kind === 'recipe' ? WA.recipeHref(item.slug) : item.kind === 'story' ? WA.storyHref({ slug: item.slug }) : WA.bottleHref(item.slug);
      var h = document.createElement('h2'); h.appendChild(a); card.appendChild(h);
      var kind = document.createElement('p'); kind.textContent = item.kind; card.appendChild(kind);
      var b = document.createElement('button'); b.className = 'pill'; card.appendChild(b); WA.bindSave(b, item); root.appendChild(card);
    });
  }
  document.addEventListener('wa:shelf', shelf); shelf();
  addEventListener('storage', function (e) { if (e.key === core.key || e.key === null) { load(); document.dispatchEvent(new Event('wa:shelf')); } });

  /* Native dialog-like focus containment for the existing menu, search and assistant. */
  function dialog(el, label, trigger, observed) {
    if (!el) return;
    observed = observed || el;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label); el.setAttribute('aria-modal', 'true');
    var last = null, previous = false;
    function opened() { return observed.getAttribute('data-open') === 'true'; }
    function focusables() { return Array.from(el.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')).filter(function (x) { return !x.disabled && x.getClientRects().length; }); }
    new MutationObserver(function () { var on = opened(); if (on && !previous) { last = el.contains(document.activeElement) ? trigger || document.querySelector(el.id === 'waMenu' ? '.burger' : '.search-btn') : document.activeElement; var first = focusables()[0]; if (first) first.focus(); } if (!on && previous && last) last.focus(); previous = on; }).observe(observed, { attributes: true, attributeFilter: ['data-open'] });
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
      wrap.querySelectorAll('[data-size]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-size') === current.size)); });
      wrap.querySelectorAll('[data-rate]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-rate') === current.rate)); });
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
    apply();
  }
})();
