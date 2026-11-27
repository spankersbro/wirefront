// Wirefront game script (WF-34: moved out of index.html as an ES module; split further step by step).
// three.js and Firebase are CDN globals loaded by index.html before this module runs.
import { ALLY_BODY_R, ALLY_VARIANT, AMBER, ANNOUNCE_BATCH_MS, CALLSIGN_ADJ, CALLSIGN_NOUN, CYAN, EMBER, EMBER_DIM, ENEMY_SHOT_SPEED, FIREBASE_CONFIG, FIRE_COOLDOWN, HIT_RADIUS_ENEMY, ICE_BLUE, PHOS, PHOS_DEEP, PLAYER_BODY_R, PLAYER_SHOT_SPEED, PLAYER_SPEED_FWD, PLAYER_SPEED_REV, PLAYER_TURN_RATE, PRESENCE_HZ_MS, PRESENCE_TIMEOUT_MS, SPAWN_CLEAR, STALE_SWEEP_MS, TANK_VARIANTS, VOID, WHITE_HOT, WORLD_R, dimColor, reduceMotion } from './config.js';
import { G, clock, eShots, enemies, keepOnly, keys, obstacles, pShots, particles, player, touchDrive } from './state.js';
import { ensureAudio, playBlip, playCommsAudio, playCommsJoin, playCommsLeave, playExplosion, playFire, playHit, playTankCollision, resumeAudio, titleMusic, toggleCommsMuted, updateEngineHum } from './audio.js';
import { titleRippleFrames } from './title.js';
import { showCommsLine } from './comms.js';
import { gemini, resetGeminiForNewGame, tacticMoveTarget, updateGeminiTactics, useScriptedTactics } from './gemini.js';

var enemiesRemainingInWave = 0;
var enemyIdCounter = 0;
var fireHeld = false;


var rtdb = null, presenceRef = null;
var serverTimeOffsetMs = 0;
function serverNow(){ return Date.now() + serverTimeOffsetMs; }
// The anonymous Firebase Auth uid. The RTDB rules only let a player write the entry under their own uid,
// so each account can hold one tank.
var clientId = null;
var callsign = CALLSIGN_ADJ[Math.floor(Math.random()*CALLSIGN_ADJ.length)] + ' ' + CALLSIGN_NOUN[Math.floor(Math.random()*CALLSIGN_NOUN.length)];
var allies = {};
var alliesColliding = {};
var lastPresenceSend = 0;
var lastStaleSweep = 0;
var alliesReady = false;
var joinBuffer = [], leaveBuffer = [];
var announceFlushTimer = null;

/* ════════════════════════ three.js setup ════════════════════════ */
var canvas = document.getElementById('scene');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
var scene = new THREE.Scene();
scene.background = new THREE.Color(VOID);
scene.fog = new THREE.Fog(VOID, 90, 300);

var camera = new THREE.PerspectiveCamera(72, 1, 0.1, 500);
var camBaseY = 1.55;

var composer = null, bloomPass = null, composerUsesDevicePixels = false;
// Automated browsers (the test suite) render in software, where bloom is very slow; ?bloom opts in.
var bloomWanted = !navigator.webdriver || new URLSearchParams(location.search).has('bloom');
var bloomScriptsLoaded = ['CopyShader','LuminosityHighPassShader','EffectComposer','RenderPass','ShaderPass','UnrealBloomPass']
  .every(function(name){ return THREE[name] !== undefined; });
if (bloomWanted && bloomScriptsLoaded){
  try{
    composer = makeBloomComposer();
  }catch(e){
    console.warn('Wirefront: bloom setup failed, using the CSS glow.', e);
    composer = null;
  }
}
if (!composer) document.body.classList.add('no-bloom');

function makeBloomComposer(){
  // The composer renders into its own target, which has no antialiasing; on WebGL2 give it a multisampled one.
  var target;
  if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget){
    var dpr = renderer.getPixelRatio();
    target = new THREE.WebGLMultisampleRenderTarget(Math.floor(window.innerWidth*dpr), Math.floor(window.innerHeight*dpr), { format: THREE.RGBAFormat });
    composerUsesDevicePixels = true;
  }
  var c = new THREE.EffectComposer(renderer, target);
  c.addPass(new THREE.RenderPass(scene, camera));
  // strength, radius, threshold: a strong, tight glow on lines; the near-black faces stay dark.
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.25, 0.45, 0.08);
  c.addPass(bloomPass);
  return c;
}

function dropBloom(){
  bloomPass.dispose();
  composer.renderTarget1.dispose();
  composer.renderTarget2.dispose();
  composer = null;
  document.body.classList.add('no-bloom');
}

// Bloom costs GPU time. If the first stretch of play runs slower than about 45fps, turn it off.
var BLOOM_CHECK_FRAMES = 120;
var BLOOM_MIN_FPS = 45;
var bloomCheck = { frames: 0, seconds: 0 };
function checkBloomFrameRate(dt){
  if (!composer || bloomCheck.frames >= BLOOM_CHECK_FRAMES) return;
  bloomCheck.frames += 1;
  bloomCheck.seconds += dt;
  if (bloomCheck.frames === BLOOM_CHECK_FRAMES && bloomCheck.seconds / BLOOM_CHECK_FRAMES > 1 / BLOOM_MIN_FPS) dropBloom();
}

function resize(){
  var w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  if (composer){
    var scale = composerUsesDevicePixels ? renderer.getPixelRatio() : 1;
    composer.setSize(Math.floor(w*scale), Math.floor(h*scale));
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function forwardOf(yaw){
  return new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(0, yaw, 0));
}

function wireGroup(geometry, edgeColor, fillOcclusion, fillColor){
  var g = new THREE.Group();
  if (fillOcclusion !== false){
    var fillMat = new THREE.MeshLambertMaterial({
      color: fillColor !== undefined ? fillColor : dimColor(edgeColor, 0.4),
      flatShading: true,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
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

/* ════════════════════════ world ════════════════════════ */
var hemiLight = new THREE.HemisphereLight(0x0e3a20, 0x02100a, 0.65);
scene.add(hemiLight);
var sunLight = new THREE.DirectionalLight(0xcfffe0, 0.85);
sunLight.position.set(70, 110, 50);
scene.add(sunLight);

// Ground grid built from short segments: Chrome's software renderer (SwiftShader, used by headless
// tests) drops a line that runs behind the camera, which hid every line running toward the horizon.
(function groundGrid(){
  var SPACING = 5, SEGMENT = 5, half = WORLD_R;
  var pts = [];
  for (var k = -half; k <= half; k += SPACING){
    for (var t = -half; t < half; t += SEGMENT){
      pts.push(k, 0, t, k, 0, t+SEGMENT);
      pts.push(t, 0, k, t+SEGMENT, 0, k);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: dimColor(PHOS, 0.6) })));
})();

// Tron-style arena wall: two glowing rings at the edge of the playable area.
(function arenaWall(){
  var pts = [];
  for (var i=0;i<=160;i++){
    var a = i/160*Math.PI*2;
    pts.push(new THREE.Vector3(Math.cos(a)*WORLD_R, 0, Math.sin(a)*WORLD_R));
  }
  var geo = new THREE.BufferGeometry().setFromPoints(pts);
  var base = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CYAN }));
  var top = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.45 }));
  top.position.y = 2.2;
  scene.add(base);
  scene.add(top);
})();

// A ring of light that sweeps out across the grid from the player every few seconds.
var GRID_PULSE_PERIOD_S = 4.5;
var GRID_PULSE_REACH = 120;
var gridPulse = (function(){
  var pts = [];
  for (var i=0;i<=96;i++){
    var a = i/96*Math.PI*2;
    pts.push(new THREE.Vector3(Math.cos(a), 0.02, Math.sin(a)));
  }
  var ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: PHOS, transparent: true, opacity: 0, fog: false }));
  scene.add(ring);
  return ring;
})();

function updateGridPulse(time){
  var phase = (time % GRID_PULSE_PERIOD_S) / GRID_PULSE_PERIOD_S;
  var r = 1 + phase*GRID_PULSE_REACH;
  gridPulse.position.set(player.x, 0, player.z);
  gridPulse.scale.set(r, 1, r);
  gridPulse.material.opacity = 0.7*(1-phase);
}

// faint deep-space stars
(function stars(){
  var pts = [];
  for (var i=0;i<180;i++){
    var a = Math.random()*Math.PI*2, r = 120+Math.random()*260;
    pts.push(Math.cos(a)*r, 6+Math.random()*70, Math.sin(a)*r);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  var mat = new THREE.PointsMaterial({ color: PHOS_DEEP, size: 1.4, sizeAttenuation:false });
  scene.add(new THREE.Points(geo, mat));
})();

// volcano silhouette homage, far horizon
(function volcano(){
  var geo = new THREE.ConeGeometry(46, 66, 5);
  var v = wireGroup(geo, EMBER, true, EMBER_DIM);
  v.position.set(-90, 33-2, -180);
  scene.add(v);
})();

function scatterObstacles(){
  obstacles.forEach(function(o){ scene.remove(o.mesh); });
  obstacles.length = 0;
  var count = 16;
  for (var i=0;i<count;i++){
    var ang = Math.random()*Math.PI*2;
    var rad = SPAWN_CLEAR + Math.random()*(WORLD_R-SPAWN_CLEAR-10);
    var x = Math.cos(ang)*rad, z = Math.sin(ang)*rad;
    var group, r;
    var roll = Math.random();
    if (roll < 0.5){
      var h = 6+Math.random()*7, w = h*0.85;
      group = wireGroup(new THREE.ConeGeometry(w, h, 4), dimColor(PHOS, 0.6), true, dimColor(PHOS, 0.05));
      group.position.set(x, h/2, z);
      group.rotation.y = Math.random()*Math.PI;
      r = w*0.8;
    } else if (roll < 0.8){
      var s = 3.2+Math.random()*2.4;
      group = wireGroup(new THREE.BoxGeometry(s, s*0.8, s), dimColor(AMBER, 0.6), true, dimColor(AMBER, 0.05));
      group.position.set(x, s*0.4, z);
      group.rotation.y = Math.random()*Math.PI;
      r = s*0.75;
    } else {
      var rr = 2.6+Math.random()*2.0;
      group = wireGroup(new THREE.IcosahedronGeometry(rr, 0), dimColor(CYAN, 0.6), true, dimColor(CYAN, 0.05));
      group.position.set(x, rr*0.7, z);
      group.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
      r = rr*0.85;
    }
    scene.add(group);
    obstacles.push({ mesh: group, x:x, z:z, r:r });
  }
}

// A search spot is 15-30 units from where the tank last saw the player, inside the arena and clear of obstacles
// (a pushed-out tank stays 1.6 units off an obstacle, plus 4 to count as arrived). Given up after SEARCH_SPOT_S
// seconds, so a spot the tank cannot reach (a fast tank circling it) does not hold it for good.
var SEARCH_RADIUS = 30, SEARCH_SPOT_S = 8, SEARCH_TRIES = 20;
function pickSearchSpot(e){
  var x, z;
  for (var attempt = 0; attempt < SEARCH_TRIES; attempt++){
    var ang = Math.random()*Math.PI*2, rad = SEARCH_RADIUS*(0.5 + Math.random()*0.5);
    x = e.knownX + Math.cos(ang)*rad; z = e.knownZ + Math.sin(ang)*rad;
    var d = Math.sqrt(x*x + z*z), max = WORLD_R - 10;
    if (d > max){ x *= max/d; z *= max/d; }
    if (!obstacles.some(function(o){ return Math.hypot(x-o.x, z-o.z) < o.r + 5.6; })) break;
  }
  // After SEARCH_TRIES misses the last try is used; the timeout moves the tank on from it.
  e.searchSpot = { x: x, z: z, left: SEARCH_SPOT_S };
}

// True when the straight line from (ax, az) to (bx, bz) passes clear of every obstacle (WF-27).
function hasLineOfSight(ax, az, bx, bz){
  var lx = bx-ax, lz = bz-az, len2 = lx*lx+lz*lz;
  for (var i=0;i<obstacles.length;i++){
    var o = obstacles[i];
    var t = len2 > 0 ? ((o.x-ax)*lx + (o.z-az)*lz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + lx*t - o.x, cz = az + lz*t - o.z;
    if (cx*cx + cz*cz < o.r*o.r) return false;
  }
  return true;
}

function pushOutOfObstacles(pos, bodyR){
  for (var i=0;i<obstacles.length;i++){
    var o = obstacles[i];
    var dx = pos.x-o.x, dz = pos.z-o.z;
    var minD = o.r+bodyR;
    var d = Math.sqrt(dx*dx+dz*dz);
    if (d < minD && d > 0.0001){
      var push = (minD-d);
      pos.x += (dx/d)*push;
      pos.z += (dz/d)*push;
    }
  }
  var d0 = Math.sqrt(pos.x*pos.x+pos.z*pos.z);
  if (d0 > WORLD_R-3){
    pos.x *= (WORLD_R-3)/d0; pos.z *= (WORLD_R-3)/d0;
  }
}

var ALLY_PUSH_SPEED = 16; // units/sec — caps how fast overlap resolves so the
                           // camera eases out instead of snapping in one frame

// keeps the local tank from driving through another player's tank; only
// pushes our own position, since ally positions are network-authoritative
function pushOutOfAllies(pos, bodyR, dt){
  for (var id in allies){
    var a = allies[id];
    var dx = pos.x-a.x, dz = pos.z-a.z;
    var minD = ALLY_BODY_R+bodyR;
    var d = Math.sqrt(dx*dx+dz*dz);
    var touching = d < minD;
    if (touching){
      var nx, nz;
      if (d > 0.0001){
        nx = dx/d; nz = dz/d;
      } else {
        // exactly stacked (e.g. both tanks spawned at world origin) — pick
        // a stable pseudo-random direction so they don't stay glued together
        var ang = (id.split('').reduce(function(s,c){ return s+c.charCodeAt(0); },0) % 360) * Math.PI/180;
        nx = Math.cos(ang); nz = Math.sin(ang);
      }
      var step = Math.min(minD-d, ALLY_PUSH_SPEED*dt);
      pos.x += nx*step;
      pos.z += nz*step;
    }
    if (touching && !alliesColliding[id]){
      playTankCollision();
      addShake(0.25);
    }
    alliesColliding[id] = touching;
  }
}

/* ════════════════════════ enemy tanks ════════════════════════ */
// Side profile (x forward, y up) extruded across the tank's width; the result points down -z like the camera.
function profileGeometry(points, width){
  var shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (var i=1;i<points.length;i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  var geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width/2);
  geo.rotateY(Math.PI/2);
  return geo;
}

function lightStrip(points, color){
  var geo = new THREE.BufferGeometry().setFromPoints(points.map(function(p){ return new THREE.Vector3(p[0], p[1], p[2]); }));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color }));
}

// WF-21: low, sleek Tron-style tank. Dark faces, bright edges, white-hot light strips for the bloom to catch.
function makeEnemyMesh(variant){
  var c = variant.color, cDim = dimColor(c, 0.12);
  var glow = new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55).getHex();
  var g = new THREE.Group();

  var hull = wireGroup(profileGeometry([[-1.5,0.15],[1.45,0.15],[1.85,0.42],[1.0,0.78],[-1.25,0.74],[-1.55,0.42]], 1.9), c, true, cDim);
  g.add(hull);

  [-1.12, 1.12].forEach(function(sx){
    var pod = wireGroup(profileGeometry([[-1.6,0.05],[1.6,0.05],[1.78,0.3],[1.5,0.55],[-1.5,0.55],[-1.75,0.3]], 0.34), c, true, cDim);
    pod.position.x = sx;
    g.add(pod);
    g.add(lightStrip([[sx + Math.sign(sx)*0.18, 0.3, 1.7], [sx + Math.sign(sx)*0.18, 0.3, -1.72]], glow));
  });
  // Rises to 0.72 at the front so the crossbar sits just above the sloped hull top.
  g.add(lightStrip([[-0.96, 0.6, 1.3], [-0.96, 0.72, -1.2], [0.96, 0.72, -1.2], [0.96, 0.6, 1.3]], glow));

  var turret = wireGroup(new THREE.CylinderGeometry(0.55, 0.82, 0.42, 6), c, true, cDim);
  turret.position.set(0, 0.97, 0.15);
  g.add(turret);
  var ring = [];
  for (var i=0;i<=6;i++){
    var a = i/6*Math.PI*2;
    // CylinderGeometry puts its corners at (sin, cos); match it so the ring follows the turret's hexagon.
    ring.push([Math.sin(a)*0.84, 0.79, 0.15 + Math.cos(a)*0.84]);
  }
  g.add(lightStrip(ring, glow));

  var heavy = variant.name === 'heavy', scout = variant.name === 'scout';
  var barrelLen = heavy ? 2.0 : 2.4;
  var barrelR = heavy ? 0.11 : (scout ? 0.055 : 0.075);
  (heavy ? [-0.22, 0.22] : [0]).forEach(function(bx){
    var barrel = wireGroup(new THREE.CylinderGeometry(barrelR, barrelR*1.2, barrelLen, 8), c, true, cDim);
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(bx, 1.0, -0.45-barrelLen/2);
    g.add(barrel);
  });

  if (scout){
    [-0.55, 0.55].forEach(function(fx){
      var fin = wireGroup(profileGeometry([[-1.45,0.72],[-0.8,0.72],[-1.3,1.25]], 0.06), c, true, cDim);
      fin.position.x = fx;
      g.add(fin);
    });
  }

  g.scale.setScalar(variant.scale);
  return g;
}

function makeNameTag(text){
  var cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  var cx = cv.getContext('2d');
  cx.font = "700 30px 'Orbitron', sans-serif";
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.shadowColor = '#' + new THREE.Color(ICE_BLUE).getHexString();
  cx.shadowBlur = 10;
  cx.fillStyle = '#eafff1';
  cx.fillText(text, 128, 32);
  var tex = new THREE.CanvasTexture(cv);
  var mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.2, 1.05, 1);
  sprite.position.y = 2.6;
  return sprite;
}

function makeAllyGroup(name){
  var g = new THREE.Group();
  g.add(makeEnemyMesh(ALLY_VARIANT));
  g.add(makeNameTag(name));
  return g;
}

function pickVariant(){
  var roll = Math.random();
  if (G.wave >= 3 && roll < 0.2) return TANK_VARIANTS[2];
  if (roll < 0.45) return TANK_VARIANTS[0];
  return TANK_VARIANTS[1];
}

function spawnEnemy(){
  var ang = Math.random()*Math.PI*2;
  var rad = 46 + Math.random()*(WORLD_R-60);
  var x = Math.cos(ang)*rad, z = Math.sin(ang)*rad;
  var variant = pickVariant();
  var mesh = makeEnemyMesh(variant);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  var speed = (3.2 + Math.random()*1.2 + (G.wave-1)*0.35) * variant.speedMul;
  // 't' + at most 7 digits: the proxy accepts ids of 1-8 characters [a-z0-9] and rejects the whole request otherwise.
  enemyIdCounter = enemyIdCounter % 9999999 + 1;
  enemies.push({
    id: 't' + enemyIdCounter, tactic: 'advance', tacticSource: 'scripted', geminiMarker: null,
    // Where the tank last saw the player. A new tank knows where the player is when it arrives.
    knownX: player.x, knownZ: player.z, searchSpot: null, ping: null,
    mesh: mesh, x:x, z:z, yaw:0, hp:variant.hp, variant:variant,
    speed: Math.min(speed, 8.5),
    fireCd: (1.5+Math.random()*2) / variant.fireMul,
    alive: true
  });
}

function spawnWave(n){
  enemies.forEach(function(e){ scene.remove(e.mesh); });
  enemies.length = 0;
  scatterObstacles();
  var count = Math.min(3+Math.floor((n-1)*1.3), 10);
  for (var i=0;i<count;i++) spawnEnemy();
  enemiesRemainingInWave = count;
  // New tanks arrive knowing where the player is, like their own knownX/knownZ.
  setTeamSighting(player.x, player.z, player.yaw);
  gemini.voicedThisWave = false;
  showToast('WAVE ' + n);
}

/* ════════════════════════ shots & particles ════════════════════════ */
function makeShotMesh(color, len){
  var geo = new THREE.CylinderGeometry(0.05,0.05,len,5);
  var mat = new THREE.MeshBasicMaterial({ color: color });
  var m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI/2;
  return m;
}

function firePlayerShot(){
  var now = performance.now()/1000;
  if (now - G.lastFire < FIRE_COOLDOWN) return;
  G.lastFire = now;
  var fwd = forwardOf(player.yaw);
  var mesh = makeShotMesh(WHITE_HOT, 1.4);
  var sx = player.x+fwd.x*2.0, sz = player.z+fwd.z*2.0;
  mesh.position.set(sx, camBaseY-0.15, sz);
  mesh.lookAt(sx+fwd.x, camBaseY-0.15, sz+fwd.z);
  scene.add(mesh);
  pShots.push({ mesh:mesh, x:sx, z:sz, vx:fwd.x*PLAYER_SHOT_SPEED, vz:fwd.z*PLAYER_SHOT_SPEED, life:2.2 });
  playFire();
}

function fireEnemyShot(e){
  var dx = player.x-e.x, dz = player.z-e.z;
  var d = Math.sqrt(dx*dx+dz*dz) || 1;
  var vx = dx/d*ENEMY_SHOT_SPEED, vz = dz/d*ENEMY_SHOT_SPEED;
  var mesh = makeShotMesh(e.variant ? e.variant.color : AMBER, 0.9);
  mesh.position.set(e.x, 1.1, e.z);
  mesh.lookAt(e.x+vx, 1.1, e.z+vz);
  scene.add(mesh);
  eShots.push({ mesh:mesh, x:e.x, z:e.z, vx:vx, vz:vz, life:4.5 });
}

function spawnParticles(x, y, z, color, count){
  for (var i=0;i<count;i++){
    var geo = new THREE.BoxGeometry(0.18,0.18,0.18);
    var mat = new THREE.MeshBasicMaterial({ color: color, transparent:true, opacity:1 });
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    scene.add(m);
    var a = Math.random()*Math.PI*2, up = Math.random()*Math.PI/2;
    var sp = 4+Math.random()*7;
    particles.push({
      mesh:m,
      vx: Math.cos(a)*Math.cos(up)*sp,
      vy: Math.sin(up)*sp + 2,
      vz: Math.sin(a)*Math.cos(up)*sp,
      life: 0.5+Math.random()*0.5, maxLife: 1
    });
  }
}

/* ════════════════════════ camera shake ════════════════════════ */
var shakeMag = 0;
function addShake(m){ if (!reduceMotion) shakeMag = Math.min(shakeMag+m, 1.4); }

/* ════════════════════════ HUD / radar ════════════════════════ */
var scoreVal = document.getElementById('scoreVal');
var waveVal = document.getElementById('waveVal');
var livesRow = document.getElementById('livesRow');
var hintBar = document.getElementById('hintBar');
var toastEl = document.getElementById('toast');
var damageFlash = document.getElementById('damageFlash');
var radarCv = document.getElementById('radar');
var radarCx = radarCv.getContext('2d');
var radarDpr = Math.min(window.devicePixelRatio||1, 2);
radarCv.width = 132*radarDpr; radarCv.height = 132*radarDpr;
radarCx.scale(radarDpr, radarDpr);

function updateHUD(){
  scoreVal.textContent = G.score;
  waveVal.textContent = G.wave;
  livesRow.innerHTML = '';
  for (var i=0;i<3;i++){
    var d = document.createElement('div');
    d.className = 'life-glyph' + (i < G.lives ? '' : ' spent');
    livesRow.appendChild(d);
  }
}

var toastTimer = null;
function showToast(text){
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 1500);
}

var radarSweep = 0;
var RADAR_SWEEP_RAD_PER_S = reduceMotion ? 0.6 : 2.0;
// A ping fades out over one turn of the sweep, just as the sweep comes round to refresh it.
var RADAR_PING_FADE_S = Math.PI*2 / RADAR_SWEEP_RAD_PER_S;
// Radar time advances with the sweep (frame time, capped like the sweep), so a ping fades per sweep turn even when frames are slow.
var radarTime = 0;
// What the radar drew in its last frame, in canvas px; read by the e2e probe.
var radarDrawn = { blips: [], obstacles: [] };

// Heading-up radar position of a world point, relative to the radar centre: ahead is up.
function radarPoint(x, z, R){
  var dx = x-player.x, dz = z-player.z;
  var rel = Math.atan2(-dx,-dz) - player.yaw;
  var scaled = Math.min(Math.sqrt(dx*dx+dz*dz)/WORLD_R, 1) * R;
  return { x: -Math.sin(rel)*scaled, y: -Math.cos(rel)*scaled };
}

function drawRadar(dt){
  var R = 66;
  radarDrawn = { blips: [], obstacles: [] };
  radarCx.clearRect(0,0,132,132);
  radarCx.save();
  radarCx.translate(66,66);

  radarSweep = (radarSweep + RADAR_SWEEP_RAD_PER_S * dt) % (Math.PI*2);
  radarTime += dt;
  radarCx.strokeStyle = 'rgba(61,255,122,.18)';
  radarCx.lineWidth = 1;
  for (var ring=1; ring<=2; ring++){ radarCx.beginPath(); radarCx.arc(0,0,R*ring/2,0,Math.PI*2); radarCx.stroke(); }

  // Terrain: obstacles are always shown, as outlines at their real size (at least 1.5 px).
  radarCx.strokeStyle = 'rgba(255,176,32,.7)';
  obstacles.forEach(function(o){
    var p = radarPoint(o.x, o.z, R);
    var r = Math.max(o.r * R / WORLD_R, 1.5);
    radarCx.beginPath(); radarCx.arc(p.x, p.y, r, 0, Math.PI*2); radarCx.stroke();
    radarDrawn.obstacles.push({ x: 66 + p.x, y: 66 + p.y, r: r });
  });

  radarCx.save();
  radarCx.rotate(radarSweep);
  var sweepGrad = radarCx.createLinearGradient(0,0,R,0);
  sweepGrad.addColorStop(0, 'rgba(61,255,122,.35)');
  sweepGrad.addColorStop(1, 'rgba(61,255,122,0)');
  radarCx.fillStyle = sweepGrad;
  radarCx.beginPath();
  radarCx.moveTo(0,0);
  radarCx.arc(0,0,R,-0.18,0.18);
  radarCx.closePath();
  radarCx.fill();
  radarCx.restore();

  // A tank is pinged where it is when the sweep line crosses its blip, if the player can see it; the ping then stays
  // put and fades. Crossing is judged on the angle between blip and sweep, so it holds while the player turns either way.
  enemies.forEach(function(e){
    if (!e.alive) return;
    var p = radarPoint(e.x, e.z, R);
    var gap = ((Math.atan2(p.y, p.x) - radarSweep) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
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
    radarCx.shadowColor = blipColor; radarCx.shadowBlur = 4;
    radarCx.fillRect(at.x-2, at.y-2, 4, 4);
    radarDrawn.blips.push({ id: e.id, x: 66 + at.x, y: 66 + at.y, alpha: alpha });
  });
  radarCx.globalAlpha = 1;
  radarCx.shadowBlur = 0;

  radarCx.fillStyle = '#eafff1';
  radarCx.beginPath();
  radarCx.moveTo(0,-6); radarCx.lineTo(4,4); radarCx.lineTo(-4,4);
  radarCx.closePath(); radarCx.fill();

  radarCx.restore();
}

/* ════════════════════════ input ════════════════════════ */
window.addEventListener('keydown', function(ev){
  keys[ev.key.toLowerCase()] = true;
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].indexOf(ev.key.toLowerCase()) > -1) ev.preventDefault();
  if (ev.key === ' ') fireHeld = true;
  var withModifier = ev.ctrlKey || ev.metaKey || ev.altKey;
  if (ev.key.toLowerCase() === 'm' && !ev.repeat && !withModifier && ev.target.tagName !== 'INPUT') toggleCommsMuted();
  if (ev.key === 'Enter'){
    if (G.state === 'title') startGame();
    else if (G.state === 'gameover-final') startGame();
  }
  ensureAudio(); resumeAudio();
});
window.addEventListener('keyup', function(ev){
  keys[ev.key.toLowerCase()] = false;
  if (ev.key === ' ') fireHeld = false;
});
canvas.addEventListener('mousedown', function(){ ensureAudio(); resumeAudio(); fireHeld = true; });
window.addEventListener('mouseup', function(){ fireHeld = false; });

var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

var joyZone = document.getElementById('joyZone');
var joyNub = document.getElementById('joyNub');
var joyId = null, joyCenter = {x:0,y:0};
joyZone.addEventListener('touchstart', function(ev){
  ensureAudio(); resumeAudio();
  var t = ev.changedTouches[0];
  joyId = t.identifier;
  var r = joyZone.getBoundingClientRect();
  joyCenter = { x:r.left+r.width/2, y:r.top+r.height/2 };
  ev.preventDefault();
}, {passive:false});
joyZone.addEventListener('touchmove', function(ev){
  for (var i=0;i<ev.changedTouches.length;i++){
    var t = ev.changedTouches[i];
    if (t.identifier !== joyId) continue;
    var dx = t.clientX-joyCenter.x, dy = t.clientY-joyCenter.y;
    var max = 42;
    var d = Math.min(Math.sqrt(dx*dx+dy*dy), max);
    var ang = Math.atan2(dy,dx);
    var nx = Math.cos(ang)*d, ny = Math.sin(ang)*d;
    joyNub.style.transform = 'translate(calc(-50% + '+nx+'px), calc(-50% + '+ny+'px))';
    touchDrive.turn = -nx/max;
    touchDrive.throttle = -ny/max;
  }
  ev.preventDefault();
}, {passive:false});
function endJoy(ev){
  for (var i=0;i<ev.changedTouches.length;i++){
    if (ev.changedTouches[i].identifier === joyId){
      joyId = null; touchDrive.turn = 0; touchDrive.throttle = 0;
      joyNub.style.transform = 'translate(-50%,-50%)';
    }
  }
}
joyZone.addEventListener('touchend', endJoy);
joyZone.addEventListener('touchcancel', endJoy);

var fireBtn = document.getElementById('fireBtn');
fireBtn.addEventListener('touchstart', function(ev){ ensureAudio(); resumeAudio(); fireHeld = true; ev.preventDefault(); }, {passive:false});
fireBtn.addEventListener('touchend', function(ev){ fireHeld = false; ev.preventDefault(); }, {passive:false});

/* ════════════════════════ game flow ════════════════════════ */
var titleOverlay = document.getElementById('titleOverlay');
var gameOverOverlay = document.getElementById('gameOverOverlay');
var initialsStep = document.getElementById('initialsStep');

function resetPlayer(){
  player.x = 0; player.z = 0; player.yaw = 0;
  player.turnVel = 0; player.throttleVel = 0;
  G.invuln = 1.5;
}

function startGame(){
  titleMusic.leaveTitle();
  ensureAudio(); resumeAudio();
  G.score = 0; G.wave = 1; G.lives = 3;
  resetPlayer();
  resetGeminiForNewGame();
  pShots.forEach(function(s){ scene.remove(s.mesh); }); pShots.length = 0;
  eShots.forEach(function(s){ scene.remove(s.mesh); }); eShots.length = 0;
  particles.forEach(function(p){ scene.remove(p.mesh); }); particles.length = 0;
  spawnWave(1);
  G.state = 'playing';
  titleOverlay.hidden = true;
  gameOverOverlay.hidden = true;
  updateHUD();
}

function nextWave(){
  G.wave += 1;
  G.score += 500;
  spawnWave(G.wave);
}

function playerHit(){
  if (G.invuln > 0) return;
  G.lives -= 1;
  gemini.playerHits += 1;
  G.invuln = 2.0;
  playHit();
  addShake(0.9);
  damageFlash.classList.add('hit');
  setTimeout(function(){ damageFlash.classList.remove('hit'); }, 130);
  updateHUD();
  if (G.lives <= 0){
    gameOver();
  } else {
    resetPlayer();
  }
}

function gameOver(){
  G.state = 'gameover';
  useScriptedTactics();
  document.getElementById('finalScore').textContent = G.score;
  document.getElementById('finalWave').textContent = 'Reached wave ' + G.wave;
  initialsStep.style.display = '';
  showInitialsError(false);
  gameOverOverlay.hidden = false;
  renderBoard(document.getElementById('goBoard'));
  var inp = document.getElementById('initials');
  inp.value = 'ACE';
  setTimeout(function(){ inp.focus(); inp.select(); }, 60);
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);

/* ════════════════════════ update loops ════════════════════════ */
function updatePlayer(dt){
  var turnInput = ((keys['a']||keys['arrowleft']) ? 1:0) - ((keys['d']||keys['arrowright']) ? 1:0);
  var throttleInput = ((keys['w']||keys['arrowup']) ? 1:0) - ((keys['s']||keys['arrowdown']) ? 1:0);
  if (touchDrive.turn) turnInput = touchDrive.turn;
  if (touchDrive.throttle) throttleInput = touchDrive.throttle;
  turnInput = Math.max(-1, Math.min(1, turnInput));
  throttleInput = Math.max(-1, Math.min(1, throttleInput));

  // ease raw on/off input toward a smoothed velocity so driving ramps
  // instead of snapping to full turn/speed the instant a key is pressed
  var turnEase = 1 - Math.pow(0.001, dt / 0.22);
  var throttleEase = 1 - Math.pow(0.001, dt / 0.32);
  player.turnVel += (turnInput - player.turnVel) * turnEase;
  player.throttleVel += (throttleInput - player.throttleVel) * throttleEase;

  player.yaw += player.turnVel * PLAYER_TURN_RATE * dt;
  var spd = player.throttleVel >= 0 ? PLAYER_SPEED_FWD : PLAYER_SPEED_REV;
  var fwd = forwardOf(player.yaw);
  player.x += fwd.x * player.throttleVel * spd * dt;
  player.z += fwd.z * player.throttleVel * spd * dt;
  pushOutOfObstacles(player, PLAYER_BODY_R);
  pushOutOfAllies(player, PLAYER_BODY_R, dt);

  if (G.invuln > 0) G.invuln = Math.max(0, G.invuln - dt);

  if (fireHeld) firePlayerShot();

  updateEngineHum(Math.abs(player.throttleVel));

  if (!G.hintFaded && (Math.abs(turnInput) > 0.05 || Math.abs(throttleInput) > 0.05)){
    G.hintFaded = true;
    hintBar.classList.add('hidden');
  }
}

function updateCamera(dt, time){
  camera.position.x = player.x;
  camera.position.z = player.z;
  camera.position.y = camBaseY + Math.sin(time*8)*0.02*Math.abs(player.throttleVel);
  camera.rotation.set(0, player.yaw, 0);

  if (shakeMag > 0.001){
    camera.position.x += (Math.random()-0.5)*shakeMag;
    camera.position.y += (Math.random()-0.5)*shakeMag*0.6;
    camera.rotation.z = (Math.random()-0.5)*shakeMag*0.05;
    shakeMag *= Math.pow(0.002, dt);
  } else {
    shakeMag = 0;
    camera.rotation.z = 0;
  }
}

function updateEnemies(dt){
  var anyTankSees = false;
  // Game time, not wall-clock time: a hidden tab freezes the game, so the sighting must not age then.
  gemini.gameTime += dt;
  enemies.forEach(function(e){
    if (!e.alive) return;
    // Same rule as the player's radar: a tank only knows where the player is while it can see the player.
    var seesPlayer = hasLineOfSight(e.x, e.z, player.x, player.z);
    if (seesPlayer){ e.knownX = player.x; e.knownZ = player.z; anyTankSees = true; }
    var dx = e.knownX-e.x, dz = e.knownZ-e.z;
    var dist = Math.sqrt(dx*dx+dz*dz);
    // Without a move target the tank turns to face where it last saw the player; with one it turns towards the target.
    var moveTo = tacticMoveTarget(e, dist);
    // Lost the player with nowhere left to go: search spots near the last sighting instead of parking for good.
    // Whatever the tactic, a searching tank drives to its spot, then picks the next, until it sees the player again.
    if (seesPlayer) e.searchSpot = null;
    else if (e.searchSpot || !moveTo){
      if (e.searchSpot) e.searchSpot.left -= dt;
      if (!e.searchSpot || e.searchSpot.left <= 0 || Math.hypot(e.searchSpot.x-e.x, e.searchSpot.z-e.z) < 4) pickSearchSpot(e);
      moveTo = { x: e.searchSpot.x, z: e.searchSpot.z };
    }
    var aimX = moveTo ? moveTo.x - e.x : dx, aimZ = moveTo ? moveTo.z - e.z : dz;
    var steerYaw = Math.atan2(-aimX, -aimZ);
    var steerDiff = ((steerYaw - e.yaw + Math.PI*3) % (Math.PI*2)) - Math.PI;
    var turnRate = 1.1;
    if (Math.abs(steerDiff) > 0.03) e.yaw += Math.sign(steerDiff)*Math.min(Math.abs(steerDiff), turnRate*dt);
    var targetYaw = Math.atan2(-dx,-dz);
    var diff = ((targetYaw - e.yaw + Math.PI*3) % (Math.PI*2)) - Math.PI;

    if (moveTo){
      var fwd = forwardOf(e.yaw);
      e.x += fwd.x*e.speed*dt;
      e.z += fwd.z*e.speed*dt;
      var tmp = {x:e.x, z:e.z};
      pushOutOfObstacles(tmp, 1.6);
      e.x = tmp.x; e.z = tmp.z;
    }

    e.fireCd -= dt;
    if (seesPlayer && e.fireCd <= 0 && dist < 70 && Math.abs(diff) < 0.6){
      fireEnemyShot(e);
      e.fireCd = 2.2 + Math.random()*2 - Math.min(G.wave*0.12, 1.4);
      // Tuned by eye: holding tanks fire about 40% more often, the point of suppressing.
      if (e.tactic === 'hold_and_suppress') e.fireCd *= 0.7;
    }

    e.mesh.position.set(e.x, 0, e.z);
    e.mesh.rotation.y = e.yaw;
    if (e.geminiMarker) e.geminiMarker.rotation.y += dt*2.5;
  });
  // What the enemy side knows, for Gemini (WF-33): one sighting shared by all tanks, as if by radio.
  gemini.seenNow = anyTankSees;
  if (anyTankSees) setTeamSighting(player.x, player.z, player.yaw);
}

function setTeamSighting(x, z, yaw){
  gemini.sighting = { x: x, z: z, yaw: yaw, at: gemini.gameTime };
}

function updateShots(dt){
  keepOnly(pShots, function(s){
    s.x += s.vx*dt; s.z += s.vz*dt; s.life -= dt;
    s.mesh.position.x = s.x; s.mesh.position.z = s.z;
    var hitSomething = false;

    enemies.forEach(function(e){
      if (!e.alive) return;
      var dx = s.x-e.x, dz = s.z-e.z;
      if (Math.sqrt(dx*dx+dz*dz) < HIT_RADIUS_ENEMY){
        hitSomething = true;
        e.hp -= 1;
        if (e.hp > 0){
          spawnParticles(e.x, 1.1, e.z, WHITE_HOT, 5);
          playHit();
          return;
        }
        e.alive = false;
        gemini.tanksLost += 1;
        scene.remove(e.mesh);
        spawnParticles(e.x, 1, e.z, e.variant ? e.variant.color : PHOS, 16);
        playExplosion();
        addShake(0.35);
        G.score += 150;
        updateHUD();
        enemiesRemainingInWave -= 1;
        if (enemiesRemainingInWave <= 0){
          setTimeout(nextWave, 900);
        }
      }
    });

    for (var i=0;i<obstacles.length && !hitSomething;i++){
      var o = obstacles[i];
      var dx2 = s.x-o.x, dz2 = s.z-o.z;
      if (Math.sqrt(dx2*dx2+dz2*dz2) < o.r){
        hitSomething = true;
        spawnParticles(s.x, 1, s.z, AMBER, 8);
        playHit();
      }
    }

    var keep = s.life > 0 && !hitSomething;
    if (!keep) scene.remove(s.mesh);
    return keep;
  });

  keepOnly(eShots, function(s){
    s.x += s.vx*dt; s.z += s.vz*dt; s.life -= dt;
    s.mesh.position.x = s.x; s.mesh.position.z = s.z;
    var dx = s.x-player.x, dz = s.z-player.z;
    var hit = Math.sqrt(dx*dx+dz*dz) < 1.6;
    if (hit) playerHit();
    var keep = s.life > 0 && !hit;
    if (!keep) scene.remove(s.mesh);
    return keep;
  });
}

function updateParticles(dt){
  keepOnly(particles, function(p){
    p.life -= dt;
    p.vy -= 9*dt;
    p.mesh.position.x += p.vx*dt;
    p.mesh.position.y += p.vy*dt;
    p.mesh.position.z += p.vz*dt;
    p.mesh.material.opacity = Math.max(0, p.life/p.maxLife);
    var keep = p.life > 0 && p.mesh.position.y > -1;
    if (!keep) scene.remove(p.mesh);
    return keep;
  });
}

/* ════════════════════════ leaderboard (db) ════════════════════════ */
var db = null;
var topScores = [];
// Set by the ?e2e hooks that change the game: a tab that used one never saves a score.
var scoreSavingBlocked = false;
function blockScoreSaving(){ scoreSavingBlocked = true; }
var lbInitialsStep = document.getElementById('initialsStep');
var lbGameOverOverlay = document.getElementById('gameOverOverlay');
// After firebase.initializeApp: read the shared top ten, or show the board as offline.
function connectLeaderboard(){
  try{
    db = firebase.firestore();
    subscribeLeaderboard();
  }catch(e){
    db = null;
    renderBoard(document.getElementById('titleBoard'));
  }
}
function renderBoard(el){
  if (!db){
    el.innerHTML = '<div class="empty-board">Offline — scores not saved this session</div>';
    return;
  }
  if (!topScores.length){
    el.innerHTML = '<div class="empty-board">No runs recorded yet. Be the first.</div>';
    return;
  }
  var rows = topScores.map(function(s, i){
    return '<tr><td>'+(i+1)+'</td><td>'+escapeHtml(s.initials||'???')+'</td><td>'+(s.score||0)+'</td></tr>';
  }).join('');
  el.innerHTML = '<table class="scores">'+rows+'</table>';
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

// firestore.rules refuses the same list; change both together.
var BLOCKED_INITIALS = ['ASS','CNT','CUM','DIC','DIK','FAG','FCK','FKN','FKU','FUC','FUK','FUQ','FUT','HH','KKK','KYS','KZ','NIG','SEX','SHT','SS','TIT'];
var initialsError = document.getElementById('initialsError');

function showInitialsError(show){
  initialsError.hidden = !show;
  document.getElementById('initials').setAttribute('aria-invalid', String(show));
}

function submitScore(){
  var raw = document.getElementById('initials').value || 'ACE';
  var initials = raw.toUpperCase().replace(/[^A-Z]/g,'').slice(0,3) || 'ACE';
  if (BLOCKED_INITIALS.indexOf(initials) > -1){ showInitialsError(true); return; }
  playBlip();
  if (db && !scoreSavingBlocked){
    db.collection('scores').add({ initials: initials, score: G.score, wave: G.wave, ts: Date.now() }).catch(function(){});
  }
  lbInitialsStep.style.display = 'none';
}
document.getElementById('submitScoreBtn').addEventListener('click', submitScore);
document.getElementById('initials').addEventListener('keydown', function(ev){
  if (ev.key === 'Enter'){ ev.preventDefault(); submitScore(); }
});
document.getElementById('initials').addEventListener('input', function(ev){
  ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);
  showInitialsError(false);
});


function subscribeLeaderboard(){
  if (!db) return;
  db.collection('scores').orderBy('score','desc').limit(10).onSnapshot(function(snap){
    topScores = snap.docs.map(function(d){ return d.data(); });
    renderBoard(document.getElementById('titleBoard'));
    if (!lbGameOverOverlay.hidden) renderBoard(document.getElementById('goBoard'));
  }, function(){ /* leave topScores as-is */ });
}


/* ════════════════════════ co-op presence (rtdb) ════════════════════════ */
var PLAYERS_PATH = 'rooms/global/players';

function addAlly(id, data){
  var name = String(data.name || '???').slice(0,24) || '???';
  var group = makeAllyGroup(name);
  scene.add(group);
  allies[id] = {
    group: group, name: name,
    x: data.x||0, z: data.z||0, yaw: data.yaw||0,
    targetX: data.x||0, targetZ: data.z||0, targetYaw: data.yaw||0,
    t: data.t || serverNow()
  };
}

function updateAllyTarget(id, data){
  var a = allies[id];
  if (!a){ addAlly(id, data); return; }
  a.targetX = data.x||0; a.targetZ = data.z||0; a.targetYaw = data.yaw||0;
  a.t = data.t || serverNow();
}

// presence writes are throttled to every PRESENCE_HZ_MS, but a tab can vanish
// without onDisconnect firing (crash, force-quit, killed network) and leave a
// frozen tank behind. Sweep out any ally whose last update is stale and drop
// its rtdb entry so every client converges on the same removal.
function sweepStaleAllies(){
  if (!rtdb) return;
  // Presence t is server time; the rules check staleness against server time too.
  var cutoff = serverNow() - PRESENCE_TIMEOUT_MS;
  for (var id in allies){
    if (allies[id].t < cutoff) rtdb.ref(PLAYERS_PATH + '/' + id).remove().catch(function(){});
  }
}

function removeAlly(id){
  var a = allies[id];
  if (!a) return;
  scene.remove(a.group);
  delete allies[id];
  delete alliesColliding[id];
}

function subscribeAllies(){
  var ref = rtdb.ref(PLAYERS_PATH);
  // 'child_added' fires once per existing player the instant we subscribe,
  // then again for every future arrival — the one-time 'value' below tells
  // us when that initial backlog is done, so only later ones get announced.
  ref.on('child_added', function(snap){
    if (snap.key === clientId || allies[snap.key]) return;
    addAlly(snap.key, snap.val() || {});
    if (alliesReady) queueJoin(allies[snap.key].name);
  });
  ref.on('child_changed', function(snap){
    if (snap.key === clientId) return;
    updateAllyTarget(snap.key, snap.val() || {});
  });
  ref.on('child_removed', function(snap){
    if (snap.key === clientId || !allies[snap.key]) return;
    var name = allies[snap.key].name;
    removeAlly(snap.key);
    if (alliesReady) queueLeave(name);
  });
  ref.once('value', function(){ alliesReady = true; });
}

/* ── join/leave announcements: batched so a burst of arrivals reads as
   one line and one sound/voice line, never one per player ── */

function queueJoin(name){ joinBuffer.push(name); scheduleAnnounceFlush(); }
function queueLeave(name){ leaveBuffer.push(name); scheduleAnnounceFlush(); }

function scheduleAnnounceFlush(){
  if (announceFlushTimer) return;
  announceFlushTimer = setTimeout(flushAnnouncements, ANNOUNCE_BATCH_MS);
}

function flushAnnouncements(){
  announceFlushTimer = null;
  var joins = joinBuffer, leaves = leaveBuffer;
  joinBuffer = []; leaveBuffer = [];
  if (joins.length) announceBatch(joins, 'join');
  if (leaves.length) announceBatch(leaves, 'leave');
}

function announceBatch(names, kind){
  var isJoin = kind === 'join';
  var lineText = names.length === 1
    ? names[0] + ' ' + (isJoin ? 'ON GRID' : 'OFFLINE')
    : names.length + ' PILOTS ' + (isJoin ? 'ON GRID' : 'OFFLINE');
  showCommsLine(lineText, kind);
  playCommsAudio(isJoin ? playCommsJoin : playCommsLeave, names.length === 1
    ? names[0] + (isJoin ? ' has entered the field' : ' has left the field')
    : names.length + ' pilots have ' + (isJoin ? 'entered the field' : 'left the field'));
}

function sendPresence(nowMs){
  if (!presenceRef) return;
  if (nowMs - lastPresenceSend < PRESENCE_HZ_MS) return;
  lastPresenceSend = nowMs;
  presenceRef.set({
    name: callsign,
    x: Math.round(player.x*100)/100,
    z: Math.round(player.z*100)/100,
    yaw: Math.round(player.yaw*100)/100,
    t: firebase.database.ServerValue.TIMESTAMP
  });
}

function updateAllies(dt){
  var lerpT = 1 - Math.pow(0.001, dt/0.15);
  for (var id in allies){
    var a = allies[id];
    a.x += (a.targetX - a.x) * lerpT;
    a.z += (a.targetZ - a.z) * lerpT;
    var diff = ((a.targetYaw - a.yaw + Math.PI*3) % (Math.PI*2)) - Math.PI;
    a.yaw += diff * lerpT;
    a.group.position.set(a.x, 0, a.z);
    a.group.rotation.y = a.yaw;
  }
}

/* ════════════════════════ main loop ════════════════════════ */
function animate(){
  requestAnimationFrame(animate);
  var dt = Math.min(clock.getDelta(), 0.05);
  var time = clock.elapsedTime;

  if (G.state === 'playing'){
    checkBloomFrameRate(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateShots(dt);
    updateParticles(dt);
  } else {
    updateEngineHum(0);
  }
  updateCamera(dt, time);
  updateAllies(dt);
  var presenceNow = performance.now();
  sendPresence(presenceNow);
  if (presenceNow - lastStaleSweep >= STALE_SWEEP_MS){
    lastStaleSweep = presenceNow;
    sweepStaleAllies();
  }
  drawRadar(dt);
  updateGridPulse(time);
  updateGeminiTactics(time);
  if (composer) composer.render(); else renderer.render(scene, camera);
}

/* ════════════════════════ boot ════════════════════════ */

function boot(){
  resize();
  updateHUD();
  animate();

  try{
    firebase.initializeApp(FIREBASE_CONFIG);
  }catch(e){ /* the leaderboard and presence fall back to offline */ }
  connectLeaderboard();

  try{
    rtdb = firebase.database();
    // Session persistence gives each tab its own anonymous uid, so two tabs are two tanks, not one shared entry.
    var auth = firebase.auth();
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).then(function(){
      return auth.signInAnonymously();
    }).then(joinRoom, function(error){
      console.warn('Wirefront: anonymous sign-in failed, playing without co-op presence.', error);
    });
  }catch(e){
    rtdb = null;
  }
}

function joinRoom(credential){
  clientId = credential.user.uid;
  presenceRef = rtdb.ref(PLAYERS_PATH + '/' + clientId);
  presenceRef.onDisconnect().remove();
  rtdb.ref('.info/serverTimeOffset').on('value', function(snap){ serverTimeOffsetMs = snap.val() || 0; });
  subscribeAllies();
}

// ?e2e&showcase lines up every tank variant in front of the camera, for tests and design reviews (WF-21).
var testParams = new URLSearchParams(location.search);
if (testParams.has('e2e') && testParams.has('showcase')){
  titleOverlay.hidden = true;
  G.state = 'showcase';
  [TANK_VARIANTS[0], TANK_VARIANTS[1], TANK_VARIANTS[2], ALLY_VARIANT].forEach(function(variant, i){
    var mesh = makeEnemyMesh(variant);
    mesh.position.set(-6.6 + i*4.4, 0, -9.5);
    mesh.rotation.y = Math.PI + 0.6;
    scene.add(mesh);
  });
}

// Read-only state for the Playwright suite (WF-11). Only with ?e2e, so normal players get no global.
if (testParams.has('e2e')){
  window.__wirefrontProbe = function(){
    return {
      state: G.state, x: player.x, z: player.z, yaw: player.yaw, playerShots: pShots.length, bloom: !!composer, geminiInFlight: gemini.inFlight,
      enemyShots: eShots.length, radar: radarDrawn,
      titleMusic: { state: titleMusic.state(), notes: titleMusic.notes() }, titleRippleFrames: titleRippleFrames,
      enemies: enemies.filter(function(e){ return e.alive; }).map(function(e){
        return { id: e.id, tactic: e.tactic, source: e.tacticSource, marker: !!(e.geminiMarker && e.geminiMarker.visible),
          x: e.x, z: e.z, lastSeen: { x: e.knownX, z: e.knownZ }, searchSpot: e.searchSpot && { x: e.searchSpot.x, z: e.searchSpot.z }, dist: Math.hypot(e.x - player.x, e.z - player.z), bearing: Math.atan2(e.x - player.x, e.z - player.z) };
      }),
    };
  };
  // The e2e hooks that change state. Anyone can add ?e2e, so a tab that used one never saves a score to the leaderboard.
  // Starts the next wave the way clearing a wave does (WF-25 tests).
  window.__wirefrontNextWave = function(){ blockScoreSaving(); nextWave(); };
  // Puts the player at (0, 0) facing -z and replaces the obstacles and tanks with the given ones (WF-27 tests).
  // spec: { obstacles: [{x, z, r}], enemies: [{x, z, yaw?, speed?, tactic?, lastSeen?: {x, z}}], teamLastSeen?: {x, z, yaw} }.
  // Returns the tank ids.
  window.__wirefrontArrange = function(spec){
    blockScoreSaving();
    player.x = 0; player.z = 0; player.yaw = 0; player.turnVel = 0; player.throttleVel = 0;
    obstacles.forEach(function(o){ scene.remove(o.mesh); });
    obstacles.length = 0;
    spec.obstacles.forEach(function(o){ obstacles.push({ mesh: new THREE.Group(), x: o.x, z: o.z, r: o.r }); });
    enemies.forEach(function(e){ scene.remove(e.mesh); });
    enemies.length = 0;
    var ids = spec.enemies.map(function(t){
      spawnEnemy();
      var e = enemies[enemies.length - 1];
      e.x = t.x; e.z = t.z; e.yaw = t.yaw || 0;
      if (t.speed !== undefined) e.speed = t.speed;
      if (t.lastSeen){ e.knownX = t.lastSeen.x; e.knownZ = t.lastSeen.z; }
      if (t.tactic) e.tactic = t.tactic;
      e.mesh.position.set(e.x, 0, e.z);
      enemiesRemainingInWave = enemies.length;
      return e.id;
    });
    var seen = spec.teamLastSeen || { x: player.x, z: player.z, yaw: player.yaw };
    setTeamSighting(seen.x, seen.z, seen.yaw || 0);
    return ids;
  };
}

boot();
