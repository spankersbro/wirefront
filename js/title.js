// The title screen's WIREFRONT wordmark, drawn with the ripple shader (WF-29, moved in WF-34).
import { reduceMotion } from './config.js';
import { titleMusic } from './audio.js';
/* ════════ title screen: ripple wordmark and synth loop (WF-29) ════════ */
// The ripple shader from the Ripple Type side project, in the game's phosphor green instead of black and white:
// hatched lines inside the letters, and a dot field whose density rises and falls with the same wave.
export let titleRippleFrames = 0;
export const titleRipple = (function () {
  var canvas = document.getElementById('titleRipple');
  var gl = canvas.getContext('webgl');
  if (!gl) return { fire: function () {} };
  document.getElementById('titleOverlay').classList.add('title-gl');
  var VERT =
    'attribute vec2 aPosition; varying vec2 vUV; void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }';
  var FRAG = [
    // Phones with true 16-bit mediump break the hash and the time; use highp where the GPU has it.
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUV; uniform sampler2D uTexture; uniform vec2 uResolution; uniform float uTime;',
    'uniform vec2 uRippleOrigin[6]; uniform float uRippleStart[6];',
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'void main(){',
    '  vec2 uv = vUV; vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);',
    '  vec2 disp = vec2(0.0); float field = 0.0;',
    '  vec2 adiff = (uv - vec2(0.5)) * aspect; float adist = length(adiff); vec2 adir = adiff / max(adist, 0.0001);',
    '  float awave = sin(adist * 20.0 - uTime * 1.1); float afall = exp(-adist * 1.3);',
    '  disp += adir * awave * afall * 0.010; field += awave * afall;',
    '  for (int i = 0; i < 6; i++){',
    '    float age = uTime - uRippleStart[i];',
    '    if (age < 0.0 || age > 3.4) continue;',
    '    vec2 diff = (uv - uRippleOrigin[i]) * aspect; float dist = length(diff); vec2 dir = diff / max(dist, 0.0001);',
    '    float envelope = smoothstep(0.0, 0.12, age) * exp(-age * 1.05);',
    '    float wave = sin(dist * 24.0 - age * 9.0); float falloff = exp(-dist * 2.2);',
    '    disp += dir * wave * envelope * falloff * 0.035; field += wave * envelope * falloff;',
    '  }',
    '  vec2 dispUV = disp / aspect;',
    '  float mask = texture2D(uTexture, uv - dispUV).a;',
    '  float warp = dispUV.y * 1.6 + 0.01 * sin(uv.x * 50.0 + uTime * 0.35);',
    '  float tri = abs(fract((uv.y + warp) * 90.0) - 0.5) * 2.0;',
    '  float lineVal = 1.0 - smoothstep(0.38, 0.52, tri);',
    '  vec2 px = gl_FragCoord.xy; float spacing = 6.0; vec2 cell = floor(px / spacing);',
    '  float rnd = hash21(cell); vec2 within = fract(px / spacing) - 0.5;',
    '  float density = 0.16 + 0.22 * clamp(field, -1.0, 1.0);',
    '  float dotR = mix(0.16, 0.30, hash21(cell + 11.0));',
    '  float dotShape = (1.0 - smoothstep(dotR, dotR + 0.18, length(within))) * step(1.0 - density, rnd);',
    '  vec3 phosphor = vec3(0.24, 1.0, 0.48);',
    '  vec3 col = phosphor * lineVal * mask + phosphor * 0.55 * dotShape * (1.0 - mask);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');
  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }
  var program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    document.getElementById('titleOverlay').classList.remove('title-gl');
    return { fire: function () {} };
  }
  gl.useProgram(program);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var aPosition = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  var uTime = gl.getUniformLocation(program, 'uTime'),
    uRes = gl.getUniformLocation(program, 'uResolution');
  var uOrigin = gl.getUniformLocation(program, 'uRippleOrigin[0]'),
    uStart = gl.getUniformLocation(program, 'uRippleStart[0]');
  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var text = document.createElement('canvas'),
    tctx = text.getContext('2d');
  function drawText() {
    var w = text.width,
      h = text.height,
      size = h * 0.62;
    tctx.clearRect(0, 0, w, h);
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.fillStyle = '#fff';
    do {
      tctx.font = '900 ' + size + 'px Orbitron, "Segoe UI", sans-serif';
      size -= 2;
    } while (tctx.measureText('WIREFRONT').width > w * 0.94 && size > 10);
    tctx.fillText('WIREFRONT', w / 2, h / 2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, text);
  }
  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = text.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = text.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    drawText();
  }
  var origins = new Float32Array(12),
    starts = new Float32Array(6).fill(-9999),
    next = 0,
    t0 = performance.now();
  // Wraps after 100 periods of the ambient wave (2*pi/1.1 s each), so the wave never jumps and floats stay small.
  var WRAP_S = (100 * 2 * Math.PI) / 1.1;
  // With reduced motion the wordmark stands still: no clock, no ripples.
  function now() {
    return reduceMotion ? 0 : ((performance.now() - t0) / 1000) % WRAP_S;
  }
  function fire(x, y) {
    if (reduceMotion) return;
    origins[next * 2] = x;
    origins[next * 2 + 1] = y;
    starts[next] = now();
    next = (next + 1) % 6;
  }
  canvas.addEventListener('pointerdown', function (e) {
    var r = canvas.getBoundingClientRect();
    fire((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  });
  window.addEventListener('resize', size);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawText);
  size();
  var titleOverlayEl = document.getElementById('titleOverlay');
  (function frame() {
    requestAnimationFrame(frame);
    if (titleOverlayEl.hidden) return;
    if (canvas.width !== Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2))) size();
    gl.uniform1f(uTime, now());
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2fv(uOrigin, origins);
    gl.uniform1fv(uStart, starts);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    titleRippleFrames++;
  })();
  fire(0.5, 0.5);
  return {
    fire: function () {
      fire(0.5 + (Math.random() - 0.5) * 0.4, 0.5 + (Math.random() - 0.5) * 0.3);
    },
  };
})();
titleMusic.onBar(titleRipple.fire);
