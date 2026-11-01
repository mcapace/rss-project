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
  function matches(r, price, score) { return (!price || (r.p > 0 && r.p <= price)) && (!score || r.s >= score); }
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  var api = { key: key, read: read, write: write, empty: empty, matches: matches, escape: escape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WAReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
