/* Shared, dependency-free reader state. Kept separate so persistence and filtering can be tested. */
(function (root) {
  'use strict';
  var key = 'wa.reader.v1';
  function empty() { return { version: 1, shelf: [], pantry: [], preferences: {} }; }
  function read(storage) {
    var raw = storage.getItem(key); if (!raw) return empty();
    var value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Array.isArray(value.shelf) || !Array.isArray(value.pantry) || !value.preferences || typeof value.preferences !== 'object' || !value.shelf.every(function (x) { return x && ['bottle','story','recipe'].includes(x.kind) && typeof x.slug === 'string' && typeof x.title === 'string'; }) || !value.pantry.every(function (x) { return typeof x === 'string'; })) throw Error('Saved data could not be read.');
    return value;
  }
  function write(storage, value) { storage.setItem(key, JSON.stringify(value)); }
  function importShelf(text, current) {
    if (text.length > 2000000) throw Error('Choose a Shelf export smaller than 2 MB.');
    var value = JSON.parse(text);
    if (!value || value.version !== 1 || !Array.isArray(value.shelf) || value.shelf.length > 5000) throw Error('Choose a valid My Shelf export.');
    var incoming = value.shelf.map(function (item) {
      if (!item || !['bottle','story','recipe'].includes(item.kind) || typeof item.slug !== 'string' || !item.slug || item.slug.length > 500 || /[\x00-\x1f]/.test(item.slug) || typeof item.title !== 'string' || item.title.length > 1000) throw Error('An item in this export is invalid.');
      return { kind: item.kind, slug: item.slug, title: item.title, savedAt: Number.isFinite(item.savedAt) ? item.savedAt : Date.now(), status: item.status === 'owned' ? 'owned' : 'want', notes: typeof item.notes === 'string' ? item.notes.slice(0, 2000) : '' };
    });
    var next = JSON.parse(JSON.stringify(current)), keys = new Set(next.shelf.map(function (x) { return x.kind + ':' + x.slug; }));
    incoming.forEach(function (item) { var id = item.kind + ':' + item.slug; if (!keys.has(id)) { next.shelf.push(item); keys.add(id); } });
    return next;
  }
  function matches(r, price, score) { return (!price || (r.p > 0 && r.p <= price)) && (!score || r.s >= score); }
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  var api = { key: key, read: read, write: write, empty: empty, matches: matches, escape: escape, importShelf: importShelf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
