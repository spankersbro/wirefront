// Wirefront game script (WF-34: moved out of index.html as an ES module; split further step by step).
// three.js and Firebase are CDN globals loaded by index.html before this module runs.
import { ALLY_VARIANT, AMBER, ENEMY_SHOT_SPEED, FIREBASE_CONFIG, FIRE_COOLDOWN, HIT_RADIUS_ENEMY, PHOS, PLAYER_BODY_R, PLAYER_SHOT_SPEED, PLAYER_SPEED_FWD, PLAYER_SPEED_REV, PLAYER_TURN_RATE, TANK_VARIANTS, WHITE_HOT, WORLD_R } from './config.js';
import { G, clock, eShots, enemies, fire, keepOnly, keys, obstacles, pShots, particles, player, touchDrive } from './state.js';
import { ensureAudio, playExplosion, playFire, playHit, resumeAudio, titleMusic, updateEngineHum } from './audio.js';
import { titleRippleFrames } from './title.js';
import { gemini, resetGeminiForNewGame, tacticMoveTarget, updateGeminiTactics, useScriptedTactics } from './gemini.js';
import { blockScoreSaving, connectLeaderboard, renderBoard, showInitialsError } from './net/leaderboard.js';
import { addShake, applyShake, camBaseY, camera, checkBloomFrameRate, composer, forwardOf, renderer, resize, scene } from './scene.js';
import { makeEnemyMesh } from './tanks.js';
import { connectPresence, tickPresence } from './net/presence.js';
import { hasLineOfSight, pickSearchSpot, pushOutOfAllies, pushOutOfObstacles, scatterObstacles, updateGridPulse } from './world.js';
import { damageFlash, drawRadar, hintBar, radarDrawn, showToast, updateHUD } from './radar.js';
import { onStartKey } from './input.js';

var enemiesRemainingInWave = 0;
var enemyIdCounter = 0;



/* ════════════════════════ tank spawning ════════════════════════ */
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


/* ════════════════════════ game flow ════════════════════════ */
onStartKey(startGame);
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

  if (fire.held) firePlayerShot();

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

  applyShake(dt);
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
  tickPresence(dt);
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

  connectPresence();
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
