// The world: lights, the pulsing grid, obstacles, line of sight and keeping tanks apart (moved in WF-34).
import {
  PHOS,
  PHOS_DEEP,
  AMBER,
  CYAN,
  EMBER,
  EMBER_DIM,
  dimColor,
  WORLD_R,
  SPAWN_CLEAR,
  ALLY_BODY_R,
} from './config.js';
import { player, obstacles } from './state.js';
import { playTankCollision } from './audio.js';
import { scene, wireGroup, addShake } from './scene.js';
import { allies, alliesColliding } from './net/presence.js';
/* ════════════════════════ world ════════════════════════ */
const hemiLight = new THREE.HemisphereLight(0x0e3a20, 0x02100a, 0.65);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xcfffe0, 0.85);
sunLight.position.set(70, 110, 50);
scene.add(sunLight);

// Ground grid built from short segments: Chrome's software renderer (SwiftShader, used by headless
// tests) drops a line that runs behind the camera, which hid every line running toward the horizon.
(function groundGrid() {
  var SPACING = 5,
    SEGMENT = 5,
    half = WORLD_R;
  var pts = [];
  for (var k = -half; k <= half; k += SPACING) {
    for (var t = -half; t < half; t += SEGMENT) {
      pts.push(k, 0, t, k, 0, t + SEGMENT);
      pts.push(t, 0, k, t + SEGMENT, 0, k);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: dimColor(PHOS, 0.6) })));
})();

// Tron-style arena wall: two glowing rings at the edge of the playable area.
(function arenaWall() {
  var pts = [];
  for (var i = 0; i <= 160; i++) {
    var a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * WORLD_R, 0, Math.sin(a) * WORLD_R));
  }
  var geo = new THREE.BufferGeometry().setFromPoints(pts);
  var base = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CYAN }));
  var top = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.45 }));
  top.position.y = 2.2;
  scene.add(base);
  scene.add(top);
})();

// A ring of light that sweeps out across the grid from the player every few seconds.
const GRID_PULSE_PERIOD_S = 4.5;
const GRID_PULSE_REACH = 120;
const gridPulse = (function () {
  var pts = [];
  for (var i = 0; i <= 96; i++) {
    var a = (i / 96) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0.02, Math.sin(a)));
  }
  var ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: PHOS, transparent: true, opacity: 0, fog: false }),
  );
  scene.add(ring);
  return ring;
})();

export function updateGridPulse(time) {
  var phase = (time % GRID_PULSE_PERIOD_S) / GRID_PULSE_PERIOD_S;
  var r = 1 + phase * GRID_PULSE_REACH;
  gridPulse.position.set(player.x, 0, player.z);
  gridPulse.scale.set(r, 1, r);
  gridPulse.material.opacity = 0.7 * (1 - phase);
}

// faint deep-space stars
(function stars() {
  var pts = [];
  for (var i = 0; i < 180; i++) {
    var a = Math.random() * Math.PI * 2,
      r = 120 + Math.random() * 260;
    pts.push(Math.cos(a) * r, 6 + Math.random() * 70, Math.sin(a) * r);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  var mat = new THREE.PointsMaterial({ color: PHOS_DEEP, size: 1.4, sizeAttenuation: false });
  scene.add(new THREE.Points(geo, mat));
})();

// volcano silhouette homage, far horizon
(function volcano() {
  var geo = new THREE.ConeGeometry(46, 66, 5);
  var v = wireGroup(geo, EMBER, true, EMBER_DIM);
  v.position.set(-90, 33 - 2, -180);
  scene.add(v);
})();

export function scatterObstacles() {
  obstacles.forEach(function (o) {
    scene.remove(o.mesh);
  });
  obstacles.length = 0;
  var count = 16;
  for (var i = 0; i < count; i++) {
    var ang = Math.random() * Math.PI * 2;
    var rad = SPAWN_CLEAR + Math.random() * (WORLD_R - SPAWN_CLEAR - 10);
    var x = Math.cos(ang) * rad,
      z = Math.sin(ang) * rad;
    var group, r;
    var roll = Math.random();
    if (roll < 0.5) {
      var h = 6 + Math.random() * 7,
        w = h * 0.85;
      group = wireGroup(new THREE.ConeGeometry(w, h, 4), dimColor(PHOS, 0.6), true, dimColor(PHOS, 0.05));
      group.position.set(x, h / 2, z);
      group.rotation.y = Math.random() * Math.PI;
      r = w * 0.8;
    } else if (roll < 0.8) {
      var s = 3.2 + Math.random() * 2.4;
      group = wireGroup(new THREE.BoxGeometry(s, s * 0.8, s), dimColor(AMBER, 0.6), true, dimColor(AMBER, 0.05));
      group.position.set(x, s * 0.4, z);
      group.rotation.y = Math.random() * Math.PI;
      r = s * 0.75;
    } else {
      var rr = 2.6 + Math.random() * 2.0;
      group = wireGroup(new THREE.IcosahedronGeometry(rr, 0), dimColor(CYAN, 0.6), true, dimColor(CYAN, 0.05));
      group.position.set(x, rr * 0.7, z);
      group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      r = rr * 0.85;
    }
    scene.add(group);
    obstacles.push({ mesh: group, x: x, z: z, r: r });
  }
}

// A search spot is 15-30 units from where the tank last saw the player, inside the arena and clear of obstacles
// (a pushed-out tank stays 1.6 units off an obstacle, plus 4 to count as arrived). Given up after SEARCH_SPOT_S
// seconds, so a spot the tank cannot reach (a fast tank circling it) does not hold it for good.
const SEARCH_RADIUS = 30,
  SEARCH_SPOT_S = 8,
  SEARCH_TRIES = 20;
export function pickSearchSpot(e) {
  var x, z;
  for (var attempt = 0; attempt < SEARCH_TRIES; attempt++) {
    var ang = Math.random() * Math.PI * 2,
      rad = SEARCH_RADIUS * (0.5 + Math.random() * 0.5);
    x = e.knownX + Math.cos(ang) * rad;
    z = e.knownZ + Math.sin(ang) * rad;
    var d = Math.sqrt(x * x + z * z),
      max = WORLD_R - 10;
    if (d > max) {
      x *= max / d;
      z *= max / d;
    }
    if (
      !obstacles.some(function (o) {
        return Math.hypot(x - o.x, z - o.z) < o.r + 5.6;
      })
    )
      break;
  }
  // After SEARCH_TRIES misses the last try is used; the timeout moves the tank on from it.
  e.searchSpot = { x: x, z: z, left: SEARCH_SPOT_S };
}

// True when the straight line from (ax, az) to (bx, bz) passes clear of every obstacle (WF-27).
export function hasLineOfSight(ax, az, bx, bz) {
  var lx = bx - ax,
    lz = bz - az,
    len2 = lx * lx + lz * lz;
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    var t = len2 > 0 ? ((o.x - ax) * lx + (o.z - az) * lz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + lx * t - o.x,
      cz = az + lz * t - o.z;
    if (cx * cx + cz * cz < o.r * o.r) return false;
  }
  return true;
}

export function pushOutOfObstacles(pos, bodyR) {
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    var dx = pos.x - o.x,
      dz = pos.z - o.z;
    var minD = o.r + bodyR;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < minD && d > 0.0001) {
      var push = minD - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
  var d0 = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
  if (d0 > WORLD_R - 3) {
    pos.x *= (WORLD_R - 3) / d0;
    pos.z *= (WORLD_R - 3) / d0;
  }
}

const ALLY_PUSH_SPEED = 16; // units/sec — caps how fast overlap resolves so the
// camera eases out instead of snapping in one frame

// keeps the local tank from driving through another player's tank; only
// pushes our own position, since ally positions are network-authoritative
export function pushOutOfAllies(pos, bodyR, dt) {
  for (var id in allies) {
    var a = allies[id];
    var dx = pos.x - a.x,
      dz = pos.z - a.z;
    var minD = ALLY_BODY_R + bodyR;
    var d = Math.sqrt(dx * dx + dz * dz);
    var touching = d < minD;
    if (touching) {
      var nx, nz;
      if (d > 0.0001) {
        nx = dx / d;
        nz = dz / d;
      } else {
        // exactly stacked (e.g. both tanks spawned at world origin) — pick
        // a stable pseudo-random direction so they don't stay glued together
        var ang =
          ((id.split('').reduce(function (s, c) {
            return s + c.charCodeAt(0);
          }, 0) %
            360) *
            Math.PI) /
          180;
        nx = Math.cos(ang);
        nz = Math.sin(ang);
      }
      var step = Math.min(minD - d, ALLY_PUSH_SPEED * dt);
      pos.x += nx * step;
      pos.z += nz * step;
    }
    if (touching && !alliesColliding[id]) {
      playTankCollision();
      addShake(0.25);
    }
    alliesColliding[id] = touching;
  }
}
