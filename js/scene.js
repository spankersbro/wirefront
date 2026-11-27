// The three.js scene, camera, renderer and the bloom glow (WF-20), moved in WF-34.
import { VOID, dimColor, reduceMotion } from './config.js';
export const canvas = document.getElementById('scene');
export const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
export const scene = new THREE.Scene();
scene.background = new THREE.Color(VOID);
scene.fog = new THREE.Fog(VOID, 90, 300);

export const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 500);
export const camBaseY = 1.55;

export let composer = null,
  bloomPass = null,
  composerUsesDevicePixels = false;
// Automated browsers (the test suite) render in software, where bloom is very slow; ?bloom opts in.
const bloomWanted = !navigator.webdriver || new URLSearchParams(location.search).has('bloom');
const bloomScriptsLoaded = [
  'CopyShader',
  'LuminosityHighPassShader',
  'EffectComposer',
  'RenderPass',
  'ShaderPass',
  'UnrealBloomPass',
].every(function (name) {
  return THREE[name] !== undefined;
});
if (bloomWanted && bloomScriptsLoaded) {
  try {
    composer = makeBloomComposer();
  } catch (e) {
    console.warn('Wirefront: bloom setup failed, using the CSS glow.', e);
    composer = null;
  }
}
if (!composer) document.body.classList.add('no-bloom');

function makeBloomComposer() {
  // The composer renders into its own target, which has no antialiasing; on WebGL2 give it a multisampled one.
  var target;
  if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) {
    var dpr = renderer.getPixelRatio();
    target = new THREE.WebGLMultisampleRenderTarget(
      Math.floor(window.innerWidth * dpr),
      Math.floor(window.innerHeight * dpr),
      { format: THREE.RGBAFormat },
    );
    composerUsesDevicePixels = true;
  }
  var c = new THREE.EffectComposer(renderer, target);
  c.addPass(new THREE.RenderPass(scene, camera));
  // strength, radius, threshold: a strong, tight glow on lines; the near-black faces stay dark.
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.25, 0.45, 0.08);
  c.addPass(bloomPass);
  return c;
}

function dropBloom() {
  bloomPass.dispose();
  composer.renderTarget1.dispose();
  composer.renderTarget2.dispose();
  composer = null;
  document.body.classList.add('no-bloom');
}

// Bloom costs GPU time. If the first stretch of play runs slower than about 45fps, turn it off.
const BLOOM_CHECK_FRAMES = 120;
const BLOOM_MIN_FPS = 45;
const bloomCheck = { frames: 0, seconds: 0 };
export function checkBloomFrameRate(dt) {
  if (!composer || bloomCheck.frames >= BLOOM_CHECK_FRAMES) return;
  bloomCheck.frames += 1;
  bloomCheck.seconds += dt;
  if (bloomCheck.frames === BLOOM_CHECK_FRAMES && bloomCheck.seconds / BLOOM_CHECK_FRAMES > 1 / BLOOM_MIN_FPS)
    dropBloom();
}

export function resize() {
  var w = window.innerWidth,
    h = window.innerHeight;
  renderer.setSize(w, h);
  if (composer) {
    var scale = composerUsesDevicePixels ? renderer.getPixelRatio() : 1;
    composer.setSize(Math.floor(w * scale), Math.floor(h * scale));
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

export function forwardOf(yaw) {
  return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
}

export function wireGroup(geometry, edgeColor, fillOcclusion, fillColor) {
  var g = new THREE.Group();
  if (fillOcclusion !== false) {
    var fillMat = new THREE.MeshLambertMaterial({
      color: fillColor !== undefined ? fillColor : dimColor(edgeColor, 0.4),
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    var fill = new THREE.Mesh(geometry, fillMat);
    fill.renderOrder = 0;
    g.add(fill);
  }
  var edges = new THREE.EdgesGeometry(geometry);
  var lineMat = new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 2 });
  var lines = new THREE.LineSegments(edges, lineMat);
  lines.renderOrder = 1;
  g.add(lines);
  return g;
}

// Camera shake from hits and collisions; off with reduced motion.
let shakeMag = 0;
export function addShake(m) {
  if (!reduceMotion) shakeMag = Math.min(shakeMag + m, 1.4);
}
export function applyShake(dt) {
  if (shakeMag > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeMag;
    camera.position.y += (Math.random() - 0.5) * shakeMag * 0.6;
    camera.rotation.z = (Math.random() - 0.5) * shakeMag * 0.05;
    shakeMag *= Math.pow(0.002, dt);
  } else {
    shakeMag = 0;
    camera.rotation.z = 0;
  }
}
