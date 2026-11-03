/* Videos in story prose. The CMS stores a video as <figure data-embed="video"><a href="(YouTube or Vimeo link)">…</a><figcaption>…</figcaption></figure>.
   upgrade(root) turns each one into a click-to-play player: the video's still (YouTube) or a poster with the caption (Vimeo)
   behind a play button, and the provider's privacy-enhanced player only after the click, so nothing else is fetched from
   YouTube or Vimeo before the reader asks for it. The link stays under the player. A link it does not recognise stays a link.
   videoFor() holds the same rules as src/lib/cms/video.ts (the editor's embedFor); a unit test checks that they agree. */
(function (root) {
  'use strict';
  var YOUTUBE_ID = /^[\w-]{6,}$/;
  function videoFor(url) {
    var parsed;
    try { parsed = new URL(String(url == null ? '' : url).trim()); } catch { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    var host = parsed.hostname.toLowerCase().replace(/^www\./, ''), id, m;
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0];
      else { m = parsed.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/); id = parsed.searchParams.get('v') || (m ? m[1] : ''); }
      if (!YOUTUBE_ID.test(id)) return null;
      return { provider: 'youtube', id: id, short: host !== 'youtu.be' && /^\/shorts\//.test(parsed.pathname), embed: 'https://www.youtube-nocookie.com/embed/' + id, watch: 'https://www.youtube.com/watch?v=' + id, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      m = parsed.pathname.match(/(\d{6,})/);
      if (!m) return null;
      return { provider: 'vimeo', id: m[1], short: false, embed: 'https://player.vimeo.com/video/' + m[1], watch: 'https://vimeo.com/' + m[1], thumb: null };
    }
    return null;
  }
  /** The player's address once the reader has pressed play. */
  function playerSrc(v) { return v.provider === 'youtube' ? v.embed + '?autoplay=1&rel=0' : v.embed + '?autoplay=1&dnt=1'; }
  var NAME = { youtube: 'YouTube', vimeo: 'Vimeo' };

  function upgradeOne(fig, doc) {
    if (fig.getAttribute('data-video-ready')) return false;
    var link = fig.querySelector('a[href]'), v = link && videoFor(link.getAttribute('href'));
    if (!v) return false;
    fig.setAttribute('data-video-ready', 'true');
    var cap = fig.querySelector('figcaption'), caption = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : '';
    var titleEl = doc.getElementById('title'), label = caption || (link.getAttribute('title') || '').trim() || (titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '') || NAME[v.provider] + ' video';
    fig.classList.add('wa-video');
    fig.setAttribute('data-provider', v.provider);
    if (v.short) fig.setAttribute('data-short', 'true');
    var frame = doc.createElement('div'); frame.className = 'wa-video-frame';
    var btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'wa-video-play'; btn.setAttribute('aria-label', 'Play video: ' + label);
    var poster = doc.createElement('span'); poster.className = 'wa-video-poster'; poster.setAttribute('aria-hidden', 'true');
    var mark = doc.createElement('span'); mark.className = 'wa-video-brand'; mark.textContent = NAME[v.provider]; poster.appendChild(mark);
    var words = doc.createElement('span'); words.className = 'wa-video-words'; words.textContent = label; poster.appendChild(words);
    btn.appendChild(poster);
    if (v.thumb) {
      var img = doc.createElement('img'); img.className = 'wa-video-thumb'; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', function () { img.remove(); fig.classList.remove('has-thumb'); });
      img.src = v.thumb; btn.appendChild(img); fig.classList.add('has-thumb');
    }
    var icon = doc.createElement('span'); icon.className = 'wa-video-icon'; icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
    btn.appendChild(icon);
    frame.appendChild(btn);
    btn.addEventListener('click', function () {
      var f = doc.createElement('iframe');
      f.src = playerSrc(v); f.title = 'Video: ' + label; f.loading = 'lazy';
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      f.setAttribute('allowfullscreen', ''); f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.replaceChildren(f); fig.classList.add('is-playing');
      try { f.focus(); } catch { /* focus is a courtesy */ }
    });
    // The figure reads: player, caption, then the provider's link for anyone who would rather watch there.
    fig.insertBefore(frame, fig.firstChild);
    link.className = (link.className ? link.className + ' ' : '') + 'wa-video-link';
    link.textContent = 'Watch on ' + NAME[v.provider];
    link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    fig.appendChild(link);
    if (cap) fig.insertBefore(cap, link);
    return true;
  }
  /** Upgrade every video figure under root (default: each .prose on the page). Safe to call again; returns how many it upgraded. */
  function upgrade(scope) {
    var doc = (scope && scope.ownerDocument) || root.document; if (!doc) return 0;
    var figs = (scope || doc).querySelectorAll(scope ? 'figure[data-embed="video"]' : '.prose figure[data-embed="video"]'), n = 0;
    Array.prototype.forEach.call(figs, function (fig) { if (upgradeOne(fig, doc)) n++; });
    return n;
  }
  var api = { videoFor: videoFor, playerSrc: playerSrc, upgrade: upgrade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAVideo = api;
  // Prose the server rendered (a site page's story section) is upgraded once the page is parsed; story.html calls
  // upgrade(prose) again after it fills the prose itself.
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { upgrade(); }); else upgrade(); }
})(typeof window !== 'undefined' ? window : globalThis);
