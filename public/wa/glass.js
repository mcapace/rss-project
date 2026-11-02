/* The pour: a Glencairn glass drawn in a WebGL fragment shader, for ratings without a bottle photograph.
   The liquid's colour comes from the style and, once known, the bottle's flavor profile; light follows the pointer
   (or the phone's tilt) and the surface moves gently. WA.glass(host, category) returns { color, flavor } or null. */
(function () {
  'use strict';
  var FS = [
    'precision highp float;',
    'uniform vec2 u_res; uniform float u_t; uniform vec3 u_liq; uniform vec2 u_light; uniform float u_fill;',
    'float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }',
    'float sdEll(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }',
    'float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }',
    // Glencairn: a wide bowl closing to a narrow chimney with a slight flare at the lip, on a short heel and a solid base.
    'float neckW(float y) { return 0.152 - 0.024 * smoothstep(0.0, 0.29, y) + 0.012 * smoothstep(0.29, 0.38, y); }',
    'float outer(vec2 p) {',
    '  float bowl = sdEll(p - vec2(0.0, -0.16), vec2(0.275, 0.27));',
    '  float neck = max(abs(p.x) - neckW(p.y), abs(p.y - 0.18) - 0.2);',
    '  float heel = sdBox(p - vec2(0.0, -0.445), vec2(0.075, 0.045));',
    '  float base = sdBox(p - vec2(0.0, -0.5), vec2(0.19, 0.016)) - 0.012;',
    '  return smin(smin(smin(bowl, neck, 0.08), heel, 0.06), base, 0.035);',
    '}',
    'float inner(vec2 p) {',
    '  float bowl = sdEll(p - vec2(0.0, -0.16), vec2(0.259, 0.254));',
    '  float neck = max(abs(p.x) - (neckW(p.y) - 0.013), abs(p.y - 0.25) - 0.2);',
    '  return max(smin(bowl, neck, 0.07), -(p.y + 0.405));',
    '}',
    'float halfWidth(float y) { float e = 1.0 - pow((y + 0.16) / 0.254, 2.0); return max(0.259 * sqrt(max(e, 0.0)), y > -0.02 ? neckW(y) - 0.013 : 0.0); }',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y * 1.2; p.y -= 0.07;',
    '  vec3 bg = mix(vec3(0.918, 0.878, 0.81), vec3(0.985, 0.97, 0.945), smoothstep(-0.1, 1.05, uv.y));',
    '  vec2 lp = p - vec2(u_light.x * 0.35 - 0.1, 0.42);',
    '  bg += 0.045 * exp(-dot(lp, lp) * 3.0);',
    '  vec3 col = bg;',
    '  float sh = exp(-pow((p.x + 0.02 - u_light.x * -0.06) / 0.3, 2.0) - pow((p.y + 0.527) / 0.022, 2.0));',
    '  col *= 1.0 - 0.3 * sh;',
    '  vec2 cp = p - vec2(0.17 + u_light.x * 0.1, -0.527);',
    '  col += u_liq * vec3(1.0, 0.8, 0.55) * 0.42 * exp(-pow(cp.x / 0.17, 2.0) - pow(cp.y / 0.016, 2.0)) * (0.85 + 0.15 * sin(u_t * 1.4 + p.x * 26.0));',
    '  float o = outer(p), i = inner(p);',
    '  if (o < 0.0) {',
    '    float rim = exp(-abs(o) * 160.0);',
    '    vec3 g = bg * 0.965 + 0.022;',
    '    float tilt = u_light.y * 0.035 + sin(u_t * 0.8) * 0.008;',
    '    float surf = u_fill + tilt * p.x + 0.004 * sin(p.x * 21.0 + u_t * 1.5) + 0.0025 * sin(p.x * 39.0 - u_t * 2.1);',
    '    if (i < 0.0 && p.y < surf) {',
    '      float hw = halfWidth(p.y), th = 2.0 * sqrt(max(hw * hw - p.x * p.x, 0.0));',
    '      g = bg * exp(-(1.0 - u_liq) * (th * 3.6 + 0.12));',
    '      g += u_liq * 0.16 * exp(-pow(p.x / 0.15, 2.0) - pow((p.y + 0.33) / 0.1, 2.0));',
    '      g += u_liq * 0.045 * smoothstep(0.35, 1.0, sin(p.x * 11.0 + u_t * 0.5 + sin(p.y * 7.0 + u_t * 0.7) * 1.6));',
    '      float top = exp(-pow((p.y - surf + 0.011) / 0.011, 2.0));',
    '      g = mix(g, g * 1.18 + vec3(0.05, 0.035, 0.02), top * 0.7);',
    '      g += vec3(1.0, 0.96, 0.88) * 0.32 * exp(-pow((p.y - surf) / 0.003, 2.0));',
    '    } else if (i < 0.0) {',
    '      g = bg * 0.99 + 0.006;',
    '    } else {',
    '      g = g * vec3(0.95, 0.94, 0.92);',
    '      if (p.y < -0.405) { g = bg * mix(vec3(1.0), u_liq, 0.12) * 0.99 + 0.012; g += 0.05 * smoothstep(0.0, 0.08, abs(p.x)) * (1.0 - smoothstep(0.08, 0.2, abs(p.x))); }',
    '    }',
    '    g *= 1.0 - 0.3 * rim;',
    '    float hw2 = max(halfWidth(clamp(p.y, -0.4, 0.37)), 0.11);',
    '    float s1 = exp(-pow((p.x / hw2 - (-0.64 + u_light.x * 0.1)) / 0.075, 2.0)) * smoothstep(-0.4, -0.25, p.y) * smoothstep(0.37, 0.22, p.y);',
    '    float s2 = exp(-pow((p.x / hw2 - (0.72 + u_light.x * 0.05)) / 0.05, 2.0)) * smoothstep(-0.36, -0.2, p.y) * smoothstep(0.12, -0.04, p.y);',
    '    float s3 = exp(-pow((p.x - (-0.1 + u_light.x * 0.05)) / 0.035, 2.0)) * smoothstep(-0.522, -0.512, p.y) * smoothstep(-0.476, -0.49, p.y);',
    '    g += vec3(1.0) * (0.42 * s1 + 0.2 * s2 + 0.38 * s3);',
    '    col = mix(col, g, smoothstep(0.0, -0.0025, o));',
    '  }',
    '  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function make(host, rgb) {
    var canvas = document.createElement('canvas'); canvas.className = 'pour'; canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return null;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ['u_res', 'u_t', 'u_liq', 'u_light', 'u_fill'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    host.appendChild(canvas);
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, liq = rgb.slice(), want = rgb.slice(), light = [0, 0], aim = [0, 0], fill = reduce ? -0.2 : -0.42, seen = true, raf = 0, t0 = performance.now();
    function size() { var r = host.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(r.width * d)); canvas.height = Math.max(1, Math.round(r.height * d)); gl.viewport(0, 0, canvas.width, canvas.height); }
    function draw(now) {
      raf = 0;
      var t = (now - t0) / 1000, ease = reduce ? 1 : 0.06, moving = false;
      for (var k = 0; k < 3; k++) liq[k] += (want[k] - liq[k]) * (reduce ? 1 : 0.05);
      light[0] += (aim[0] - light[0]) * ease; light[1] += (aim[1] - light[1]) * ease;
      fill += (-0.2 - fill) * (reduce ? 1 : 0.03);
      gl.uniform2f(U.u_res, canvas.width, canvas.height); gl.uniform1f(U.u_t, reduce ? 0 : t); gl.uniform3f(U.u_liq, liq[0], liq[1], liq[2]); gl.uniform2f(U.u_light, light[0], light[1]); gl.uniform1f(U.u_fill, fill);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      moving = !reduce && seen && !document.hidden;
      if (moving) raf = requestAnimationFrame(draw);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    size(); kick();
    if (window.ResizeObserver) new ResizeObserver(function () { size(); kick(); }).observe(host);
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { seen = e[0].isIntersecting; if (seen) kick(); }).observe(host);
    document.addEventListener('visibilitychange', kick);
    addEventListener('pointermove', function (e) { var r = host.getBoundingClientRect(); aim[0] = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 1.5))); aim[1] = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 1.5))); if (reduce) kick(); }, { passive: true });
    addEventListener('deviceorientation', function (e) { if (e.gamma == null) return; aim[0] = Math.max(-1, Math.min(1, e.gamma / 35)); aim[1] = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 45)); }, { passive: true });
    return { canvas: canvas, color: function (c) { want = c.slice(); kick(); } };
  }

  // Liquid transmittance (0-1 per channel) by style, deepened by sherry and oak, paled by a light, fresh or coastal profile.
  function colour(category, flavor) {
    var c = String(category || '');
    var base = /bourbon|tennessee/i.test(c) ? [0.9, 0.58, 0.26] : /rye/i.test(c) ? [0.9, 0.56, 0.27] : /japan/i.test(c) ? [0.95, 0.76, 0.4] : /irish/i.test(c) ? [0.95, 0.78, 0.42] : /scotch|malt/i.test(c) ? [0.94, 0.72, 0.34] : /rum|brandy|cognac|armagnac/i.test(c) ? [0.86, 0.5, 0.22] : [0.93, 0.7, 0.34];
    if (!flavor || !flavor.axes) return base;
    var ax = flavor.axes, deep = Math.max(0, (ax.dried_fruit || 0) - 4) * 0.04 + Math.max(0, (ax.oak || 0) - 5) * 0.025, pale = Math.max(0, (ax.fresh_fruit || 0) + (ax.floral || 0) + (ax.maritime || 0) + (ax.smoke || 0) * 0.5 - 9) * 0.01;
    return [Math.min(0.97, base[0] - deep * 0.4 + pale * 0.2), Math.min(0.88, base[1] - deep * 1.1 + pale * 0.8), Math.min(0.58, base[2] - deep * 0.7 + pale * 0.7)];
  }

  window.WA = window.WA || {};
  window.WA.glass = function (host, category, flavor) { var g = make(host, colour(category, flavor)); if (g) g.flavor = function (f) { g.color(colour(category, f)); }; return g; };
  window.WA.glassColour = colour;
})();
