/* America's Top Whisky Bars: the shared map (MapLibre GL with OpenFreeMap tiles, restyled in the site's cask palette).
   Used by whisky-bars.js (the full map) and whisky-bar.js (a bar's street and a state's bars). WABarsMap.create resolves
   to null when WebGL or the library is unavailable; the pages keep their own fallback. */
(function () {
  var LIB = "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl";
  var STYLE = "https://tiles.openfreemap.org/styles/dark";
  var FONT = ["Noto Sans Regular"];
  var lib = null, style = null;

  function webgl() { try { var c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); } catch (e) { return false; } }
  function load() {
    if (lib) return lib;
    lib = new Promise(function (ok, no) {
      if (window.maplibregl) return ok(window.maplibregl);
      var css = document.createElement("link"); css.rel = "stylesheet"; css.href = LIB + ".css"; document.head.appendChild(css);
      var s = document.createElement("script"); s.src = LIB + ".js"; s.async = true; s.crossOrigin = "anonymous";
      s.onload = function () { window.maplibregl ? ok(window.maplibregl) : no(Error("maplibre")); };
      s.onerror = function () { lib = null; no(Error("maplibre")); };
      document.head.appendChild(s);
    });
    return lib;
  }

  /* The dark basemap recolored: cask-brown land, near-black water, roads as faint amber threads, cream labels, 3D buildings close in. */
  function restyle(st) {
    st.layers = st.layers.filter(function (l) { return !/oneway|aeroway/.test(l.id); }).map(function (l) {
      var p = l.paint = l.paint || {}, id = l.id;
      if (l.type === "background") p["background-color"] = "#140d08";
      else if (id === "water") p["fill-color"] = "#090807";
      else if (id === "waterway") p["line-color"] = "#0d0b09";
      else if (/landcover|landuse/.test(id)) { p["fill-color"] = "#1b130c"; p["fill-opacity"] = 0.55; }
      else if (id === "building") { p["fill-color"] = "#21170e"; p["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1]; }
      else if (l.type === "line" && /motorway/.test(id)) p["line-color"] = /casing/.test(id) ? "#120b07" : "#5a3d1c";
      else if (l.type === "line" && /major/.test(id)) p["line-color"] = /casing/.test(id) ? "#120b07" : "#3f2b16";
      else if (l.type === "line" && /highway|road|railway/.test(id)) p["line-color"] = "#2b1e12";
      else if (/boundary_state/.test(id)) { p["line-color"] = "rgba(255,226,186,0.2)"; }
      else if (/boundary_country/.test(id)) { p["line-color"] = "rgba(255,226,186,0.32)"; }
      if (l.type === "symbol" && l.layout && l.layout["text-field"]) {
        p["text-color"] = /place_(city|town|state)/.test(id) ? "#e9dcc8" : /water/.test(id) ? "#6b6155" : "#a8977f";
        p["text-halo-color"] = "#0b0704"; p["text-halo-width"] = 1.4; p["text-halo-blur"] = 0.4;
        if (id === "place_state") { p["text-color"] = "rgba(233,220,200,0.45)"; l.layout["text-letter-spacing"] = 0.18; l.layout["text-transform"] = "uppercase"; }
      }
      return l;
    });
    var at = st.layers.findIndex(function (l) { return l.type === "symbol"; });
    st.layers.splice(at < 0 ? st.layers.length : at, 0, { id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14.5,
      paint: { "fill-extrusion-color": "#2c1e11", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.5, 0.85] } });
    return st;
  }
  function getStyle() {
    if (!style) style = fetch(STYLE).then(function (r) { if (!r.ok) throw Error("style"); return r.json(); }).then(restyle).catch(function (e) { style = null; throw e; });
    return style.then(function (s) { return JSON.parse(JSON.stringify(s)); });
  }

  function features(bars) {
    return { type: "FeatureCollection", features: bars.filter(function (b) { return b.lat != null && b.lng != null; }).map(function (b) {
      return { type: "Feature", id: b.id, geometry: { type: "Point", coordinates: [b.lng, b.lat] }, properties: { id: b.id, name: b.name, place: b.city + (b.st ? ", " + b.st : "") } };
    }) };
  }

  function addBars(map, bars, cluster) {
    map.addSource("bars", { type: "geojson", data: features(bars), cluster: cluster, clusterRadius: 46, clusterMaxZoom: 12, promoteId: "id" });
    if (cluster) {
      map.addLayer({ id: "bar-cluster-glow", type: "circle", source: "bars", filter: ["has", "point_count"], paint: { "circle-color": "rgba(243,181,90,0.28)", "circle-blur": 0.7, "circle-radius": ["step", ["get", "point_count"], 24, 5, 30, 12, 38] } });
      map.addLayer({ id: "bar-cluster", type: "circle", source: "bars", filter: ["has", "point_count"], paint: { "circle-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffd08a", "#f3b55a"], "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 12, 23], "circle-stroke-color": "rgba(255,246,234,0.7)", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "bar-cluster-count", type: "symbol", source: "bars", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": "#1a1008" } });
    }
    var single = ["!", ["has", "point_count"]];
    map.addLayer({ id: "bar-glow", type: "circle", source: "bars", filter: single, paint: { "circle-color": "rgba(243,181,90,0.4)", "circle-blur": 1, "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 14, 16] } });
    map.addLayer({ id: "bar-dot", type: "circle", source: "bars", filter: single, paint: {
      "circle-color": ["case", ["boolean", ["feature-state", "on"], false], "#fff6ea", ["boolean", ["feature-state", "hover"], false], "#ffe1ad", "#f3b55a"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["boolean", ["feature-state", "on"], false], 6.5, 4.5], 14, ["case", ["boolean", ["feature-state", "on"], false], 10, 7.5]],
      "circle-stroke-color": "#1a1008", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "bar-label", type: "symbol", source: "bars", filter: single, minzoom: 10.5, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12.5, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true, "text-max-width": 10 }, paint: { "text-color": "#fff1dc", "text-halo-color": "#0b0704", "text-halo-width": 1.6 } });
  }

  function marker(gl, cls, lngLat, map) {
    var el = document.createElement("div"); el.className = cls; el.setAttribute("aria-hidden", "true"); el.innerHTML = "<i></i>";
    return new gl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
  }

  /* opts: { bars, cluster, center, zoom, bounds, pitch, interactive, padding } */
  function create(el, opts) {
    if (!webgl()) return Promise.resolve(null);
    return Promise.all([load(), getStyle()]).then(function (r) {
      var gl = r[0], st = r[1];
      return new Promise(function (ok) {
        var map = new gl.Map({ container: el, style: st, center: opts.center || [-97, 38.5], zoom: opts.zoom || 3.4, pitch: opts.pitch || 0, minZoom: 1.6, maxZoom: 18,
          attributionControl: { compact: true }, cooperativeGestures: opts.cooperative !== false, dragRotate: !!opts.rotate, pitchWithRotate: !!opts.rotate, fadeDuration: 150, interactive: opts.interactive !== false });
        map.touchZoomRotate.disableRotation && !opts.rotate && map.touchZoomRotate.disableRotation();
        if (opts.bounds) map.fitBounds(opts.bounds, { padding: opts.padding || 40, duration: 0, maxZoom: opts.maxZoom || 14 });
        map.on("load", function () { addBars(map, opts.bars || [], opts.cluster !== false); ok({ gl: gl, map: map, features: features, marker: function (cls, ll) { return marker(gl, cls, ll, map); } }); });
        map.on("error", function () {});
      });
    }).catch(function () { return null; });
  }

  function bounds(bars) {
    var b = null;
    bars.forEach(function (x) { if (x.lat == null) return; if (!b) b = [[x.lng, x.lat], [x.lng, x.lat]]; else { b[0][0] = Math.min(b[0][0], x.lng); b[0][1] = Math.min(b[0][1], x.lat); b[1][0] = Math.max(b[1][0], x.lng); b[1][1] = Math.max(b[1][1], x.lat); } });
    return b;
  }

  window.WABarsMap = { create: create, load: load, bounds: bounds, webgl: webgl, US: [[-124.8, 24.4], [-66.9, 49.4]] };
})();
