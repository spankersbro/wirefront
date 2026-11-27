// The HUD, toasts and the line-of-sight radar (WF-27, moved in WF-34).
import { PHOS, WORLD_R, reduceMotion } from './config.js';
import { G, player, enemies, obstacles } from './state.js';
import { hasLineOfSight } from './world.js';
/* ════════════════════════ HUD / radar ════════════════════════ */
export const scoreVal = document.getElementById('scoreVal');
export const waveVal = document.getElementById('waveVal');
export const livesRow = document.getElementById('livesRow');
export const hintBar = document.getElementById('hintBar');
export const toastEl = document.getElementById('toast');
export const damageFlash = document.getElementById('damageFlash');
export const radarCv = document.getElementById('radar');
export const radarCx = radarCv.getContext('2d');
export const radarDpr = Math.min(window.devicePixelRatio || 1, 2);
radarCv.width = 132 * radarDpr;
radarCv.height = 132 * radarDpr;
radarCx.scale(radarDpr, radarDpr);

export function updateHUD() {
  scoreVal.textContent = G.score;
  waveVal.textContent = G.wave;
  livesRow.innerHTML = '';
  for (var i = 0; i < 3; i++) {
    var d = document.createElement('div');
    d.className = 'life-glyph' + (i < G.lives ? '' : ' spent');
    livesRow.appendChild(d);
  }
}

export let toastTimer = null;
export function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastEl.classList.remove('show');
  }, 1500);
}

export let radarSweep = 0;
export const RADAR_SWEEP_RAD_PER_S = reduceMotion ? 0.6 : 2.0;
// A ping fades out over one turn of the sweep, just as the sweep comes round to refresh it.
export const RADAR_PING_FADE_S = (Math.PI * 2) / RADAR_SWEEP_RAD_PER_S;
// Radar time advances with the sweep (frame time, capped like the sweep), so a ping fades per sweep turn even when frames are slow.
export let radarTime = 0;
// What the radar drew in its last frame, in canvas px; read by the e2e probe.
export let radarDrawn = { blips: [], obstacles: [] };

// Heading-up radar position of a world point, relative to the radar centre: ahead is up.
export function radarPoint(x, z, R) {
  var dx = x - player.x,
    dz = z - player.z;
  var rel = Math.atan2(-dx, -dz) - player.yaw;
  var scaled = Math.min(Math.sqrt(dx * dx + dz * dz) / WORLD_R, 1) * R;
  return { x: -Math.sin(rel) * scaled, y: -Math.cos(rel) * scaled };
}

export function drawRadar(dt) {
  var R = 66;
  radarDrawn = { blips: [], obstacles: [] };
  radarCx.clearRect(0, 0, 132, 132);
  radarCx.save();
  radarCx.translate(66, 66);

  radarSweep = (radarSweep + RADAR_SWEEP_RAD_PER_S * dt) % (Math.PI * 2);
  radarTime += dt;
  radarCx.strokeStyle = 'rgba(61,255,122,.18)';
  radarCx.lineWidth = 1;
  for (var ring = 1; ring <= 2; ring++) {
    radarCx.beginPath();
    radarCx.arc(0, 0, (R * ring) / 2, 0, Math.PI * 2);
    radarCx.stroke();
  }

  // Terrain: obstacles are always shown, as outlines at their real size (at least 1.5 px).
  radarCx.strokeStyle = 'rgba(255,176,32,.7)';
  obstacles.forEach(function (o) {
    var p = radarPoint(o.x, o.z, R);
    var r = Math.max((o.r * R) / WORLD_R, 1.5);
    radarCx.beginPath();
    radarCx.arc(p.x, p.y, r, 0, Math.PI * 2);
    radarCx.stroke();
    radarDrawn.obstacles.push({ x: 66 + p.x, y: 66 + p.y, r: r });
  });

  radarCx.save();
  radarCx.rotate(radarSweep);
  var sweepGrad = radarCx.createLinearGradient(0, 0, R, 0);
  sweepGrad.addColorStop(0, 'rgba(61,255,122,.35)');
  sweepGrad.addColorStop(1, 'rgba(61,255,122,0)');
  radarCx.fillStyle = sweepGrad;
  radarCx.beginPath();
  radarCx.moveTo(0, 0);
  radarCx.arc(0, 0, R, -0.18, 0.18);
  radarCx.closePath();
  radarCx.fill();
  radarCx.restore();

  // A tank is pinged where it is when the sweep line crosses its blip, if the player can see it; the ping then stays
  // put and fades. Crossing is judged on the angle between blip and sweep, so it holds while the player turns either way.
  enemies.forEach(function (e) {
    if (!e.alive) return;
    var p = radarPoint(e.x, e.z, R);
    var gap = (((Math.atan2(p.y, p.x) - radarSweep) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    var crossed = e.radarGap !== undefined && Math.abs(gap - e.radarGap) > Math.PI;
    e.radarGap = gap;
    if (crossed && hasLineOfSight(player.x, player.z, e.x, e.z)) e.ping = { x: e.x, z: e.z, at: radarTime };
    if (!e.ping) return;
    var alpha = 1 - (radarTime - e.ping.at) / RADAR_PING_FADE_S;
    if (alpha <= 0) return;
    var at = radarPoint(e.ping.x, e.ping.z, R);
    var blipColor = '#' + new THREE.Color(e.variant ? e.variant.color : PHOS).getHexString();
    radarCx.globalAlpha = alpha;
    radarCx.fillStyle = blipColor;
    radarCx.shadowColor = blipColor;
    radarCx.shadowBlur = 4;
    radarCx.fillRect(at.x - 2, at.y - 2, 4, 4);
    radarDrawn.blips.push({ id: e.id, x: 66 + at.x, y: 66 + at.y, alpha: alpha });
  });
  radarCx.globalAlpha = 1;
  radarCx.shadowBlur = 0;

  radarCx.fillStyle = '#eafff1';
  radarCx.beginPath();
  radarCx.moveTo(0, -6);
  radarCx.lineTo(4, 4);
  radarCx.lineTo(-4, 4);
  radarCx.closePath();
  radarCx.fill();

  radarCx.restore();
}
