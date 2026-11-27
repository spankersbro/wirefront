// Enemy tactics: Gemini through the proxy (WF-24/25/32/33), the scripted AI otherwise (moved in WF-34).
import { WHITE_HOT } from './config.js';
import { G, player, enemies, clock } from './state.js';
import { playCommsJoin, playCommsAudio } from './audio.js';
import { showCommsLine } from './comms.js';
/* ════════ enemy tactics: Gemini via the proxy (WF-24/25), scripted 'advance' otherwise ════════ */
export const GEMINI_PROXY_URL = 'https://wirefront-gemini-proxy-690237862698.europe-west1.run.app/tactics';
export const GEMINI_ASK_EVERY_S = 5;
export const GEMINI_REQUEST_TIMEOUT_MS = 6000;
// Tanks count as Gemini-driven only while Gemini's last orders are this fresh.
export const GEMINI_ORDERS_FRESH_S = 12;
// A request still open after this long is given up (a sign-in token that never arrives has no timeout).
export const GEMINI_GIVE_UP_AFTER_S = 10;
export const TACTIC_WORDS = { flank_left:'flank left', flank_right:'flank right', hold_and_suppress:'hold and suppress', advance:'advance', retreat:'retreat' };
// Tuned by eye in play, not measured. ADVANCE_STOP is the scripted AI's old stop distance.
export const FLANK_RADIUS = 24, FLANK_SWING = 0.9, HOLD_RANGE = 45, RETREAT_RANGE = 55, ADVANCE_STOP = 16;
// requestNumber: only the latest request may act; an older one finishing late (after a give-up or a new game) is ignored.
export const gemini = { inFlight:false, lastAskAt:-Infinity, lastOrdersAt:-Infinity, playerHits:0, tanksLost:0, requestNumber:0, voicedThisWave:false,
               seenNow:true, sighting:{ x:0, z:0, yaw:0, at:0 }, gameTime:0 };
// lastAskAt survives a new game on purpose: the proxy answers 'too-soon' to calls under 4s apart.
export function resetGeminiForNewGame(){
  gemini.requestNumber += 1;
  gemini.inFlight = false;
  gemini.lastOrdersAt = -Infinity;
  gemini.playerHits = 0;
  gemini.tanksLost = 0;
}
export const radarLabel = document.getElementById('radarLabel');

// The point a tank drives towards for its tactic, or null to stay put. Relative to where it last saw the player.
export function tacticMoveTarget(e, dist){
  var px = e.knownX, pz = e.knownZ;
  if (e.tactic === 'flank_left' || e.tactic === 'flank_right'){
    var bearing = Math.atan2(e.x-px, e.z-pz) + (e.tactic === 'flank_left' ? FLANK_SWING : -FLANK_SWING);
    return { x: px + Math.sin(bearing)*FLANK_RADIUS, z: pz + Math.cos(bearing)*FLANK_RADIUS };
  }
  if (e.tactic === 'hold_and_suppress') return dist > HOLD_RANGE ? { x:px, z:pz } : null;
  if (e.tactic === 'retreat') return dist < RETREAT_RANGE ? { x: e.x + (e.x-px), z: e.z + (e.z-pz) } : null;
  return dist > ADVANCE_STOP ? { x:px, z:pz } : null;
}

export function setGeminiMarker(e, on){
  if (on && !e.geminiMarker){
    var marker = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.32)),
      new THREE.LineBasicMaterial({ color: WHITE_HOT }));
    marker.position.y = 2.4;
    e.mesh.add(marker);
    e.geminiMarker = marker;
  }
  if (e.geminiMarker) e.geminiMarker.visible = on;
}

export function useScriptedTactics(){
  enemies.forEach(function(e){
    if (e.tacticSource !== 'gemini') return;
    e.tactic = 'advance';
    e.tacticSource = 'scripted';
    setGeminiMarker(e, false);
  });
  gemini.lastOrdersAt = -Infinity;
}

export function currentUser(){
  // firebase.auth() throws every frame if initializeApp failed; then there is simply no Gemini.
  try {
    return (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || null;
  } catch (error){
    return null;
  }
}

export function setRadarLabel(text){
  if (radarLabel.textContent !== text) radarLabel.textContent = text;
}

export function updateGeminiTactics(nowS){
  var geminiDriving = nowS - gemini.lastOrdersAt < GEMINI_ORDERS_FRESH_S;
  if (!geminiDriving && gemini.lastOrdersAt !== -Infinity) useScriptedTactics();
  // Only claim Gemini while a live tank actually follows its orders (a new wave or game starts scripted).
  var anyGeminiTank = enemies.some(function(e){ return e.alive && e.tacticSource === 'gemini'; });
  setRadarLabel(anyGeminiTank ? 'Scan · AI Gemini' : 'Scan · AI scripted');
  if (G.state !== 'playing' || document.visibilityState !== 'visible') return;
  if (gemini.inFlight && nowS - gemini.lastAskAt < GEMINI_GIVE_UP_AFTER_S) return;
  if (nowS - gemini.lastAskAt < GEMINI_ASK_EVERY_S) return;
  var alive = enemies.filter(function(e){ return e.alive; });
  var user = currentUser();
  if (!alive.length || !user) return;
  gemini.lastAskAt = nowS;
  askGeminiForTactics(user, alive.slice(0, 10));
}

export function askGeminiForTactics(user, tanks){
  var sighting = gemini.sighting;
  var summary = {
    wave: G.wave,
    // player.yaw grows without bound while turning; the proxy rejects |yaw| > 100.
    // Only what the tanks know (WF-33): positions and heading from the last sighting, and how old it is.
    player: { yaw: Math.atan2(Math.sin(sighting.yaw), Math.cos(sighting.yaw)), lives: Math.max(G.lives, 0),
              seen: gemini.seenNow, lastSeenS: Math.min(Math.max(gemini.gameTime - sighting.at, 0), 3600) },
    tanks: tanks.map(function(e){
      return { id: e.id, variant: e.variant.name, dx: e.x - sighting.x, dz: e.z - sighting.z, hp: Math.max(e.hp, 0) };
    }),
    sinceLastOrders: { kills: Math.min(gemini.playerHits, 99), losses: Math.min(gemini.tanksLost, 99) },
  };
  gemini.inFlight = true;
  var requestNumber = ++gemini.requestNumber;
  function isLatest(){ return requestNumber === gemini.requestNumber; }
  user.getIdToken().then(function(token){
    // Superseded while waiting for the token: do not send, so Gemini is not billed for an old summary.
    if (!isLatest()) throw new Error('superseded');
    return fetch(GEMINI_PROXY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(summary),
      signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
    });
  }).then(function(response){ return response.json(); })
    .then(function(answer){
      // A late answer from the last game would wrongly clear hits counted in the new one. No e2e test reaches
      // this: it needs a hit within the 6s fetch timeout after Retry.
      if (!isLatest()) return;
      // The counts reached Gemini only if it answered; otherwise they go out again with the next request.
      if (answer && answer.source === 'gemini'){
        gemini.playerHits = Math.max(gemini.playerHits - summary.sinceLastOrders.kills, 0);
        gemini.tanksLost = Math.max(gemini.tanksLost - summary.sinceLastOrders.losses, 0);
      }
      applyGeminiAnswer(answer);
    })
    // Proxy unreachable or slow: the tanks keep their current tactics and go scripted once orders go stale.
    .catch(function(){})
    .then(function(){ if (isLatest()) gemini.inFlight = false; });
}

export function applyGeminiAnswer(answer){
  // Not while the tab is hidden: the order would be spoken, then dropped as stale on return.
  if (!answer || G.state !== 'playing' || document.visibilityState !== 'visible') return;
  if (answer.source !== 'gemini'){
    // 'too-soon' only means we asked early; any other reason means no Gemini for now.
    if (answer.reason !== 'too-soon') useScriptedTactics();
    return;
  }
  var changed = {}, applied = 0;
  (answer.orders || []).forEach(function(order){
    var e = enemies.find(function(x){ return x.alive && x.id === order.id; });
    if (!e || !TACTIC_WORDS[order.tactic]) return;
    if (e.tactic !== order.tactic || e.tacticSource !== 'gemini') changed[order.tactic] = (changed[order.tactic] || 0) + 1;
    e.tactic = order.tactic;
    e.tacticSource = 'gemini';
    setGeminiMarker(e, true);
    applied += 1;
  });
  // Orders for tanks that are gone (an earlier wave or game) or no orders at all leave the tanks scripted.
  if (!applied) return;
  gemini.lastOrdersAt = clock.elapsedTime;
  announceGeminiOrders(changed);
}

// Shows the most common new order, e.g. "GEMINI: 3 TANKS FLANK LEFT". The voice speaks once per wave only (WF-32):
// a voice line on every order change was too much in play.
export function announceGeminiOrders(changed){
  var tactic = null;
  Object.keys(changed).forEach(function(t){ if (!tactic || changed[t] > changed[tactic]) tactic = t; });
  if (!tactic) return;
  var count = changed[tactic], words = TACTIC_WORDS[tactic];
  showCommsLine('GEMINI: ' + count + (count === 1 ? ' TANK ' : ' TANKS ') + words.toUpperCase(), 'gemini');
  if (gemini.voicedThisWave) return;
  // Marked even when muted or the 4 s audio gap swallows it: one try per wave, no catch-up later in the wave.
  gemini.voicedThisWave = true;
  var controlled = enemies.filter(function(e){ return e.alive && e.tacticSource === 'gemini'; }).length;
  playCommsAudio(playCommsJoin, 'Gemini controls ' + (controlled === 1 ? 'a tank' : controlled + ' tanks'));
}
