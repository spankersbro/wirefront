// Co-op presence in the Realtime Database: our tank, the ally tanks, join and leave comms (WF-10, moved in WF-34).
import { PRESENCE_HZ_MS, PRESENCE_TIMEOUT_MS, STALE_SWEEP_MS, ANNOUNCE_BATCH_MS, CALLSIGN_ADJ, CALLSIGN_NOUN } from '../config.js';
import { player } from '../state.js';
import { playCommsJoin, playCommsLeave, playCommsAudio } from '../audio.js';
import { showCommsLine } from '../comms.js';
import { scene } from '../scene.js';
import { makeAllyGroup } from '../tanks.js';
/* ════════════════════════ co-op presence (rtdb) ════════════════════════ */
export let rtdb = null, presenceRef = null;
export let serverTimeOffsetMs = 0;
export function serverNow(){ return Date.now() + serverTimeOffsetMs; }
// The anonymous Firebase Auth uid. The RTDB rules only let a player write the entry under their own uid,
// so each account can hold one tank.
export let clientId = null;
export const callsign = CALLSIGN_ADJ[Math.floor(Math.random()*CALLSIGN_ADJ.length)] + ' ' + CALLSIGN_NOUN[Math.floor(Math.random()*CALLSIGN_NOUN.length)];
export const allies = {};
export const alliesColliding = {};
export let lastPresenceSend = 0;
export let lastStaleSweep = 0;
export let alliesReady = false;
export let joinBuffer = [], leaveBuffer = [];
export let announceFlushTimer = null;

// After firebase.initializeApp: sign in anonymously and join the shared room, or play on without co-op.
export function connectPresence(){
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

export function joinRoom(credential){
  clientId = credential.user.uid;
  presenceRef = rtdb.ref(PLAYERS_PATH + '/' + clientId);
  presenceRef.onDisconnect().remove();
  rtdb.ref('.info/serverTimeOffset').on('value', function(snap){ serverTimeOffsetMs = snap.val() || 0; });
  subscribeAllies();
}

// Once per frame: move the ally tanks, send our own position, and sweep stale allies every few seconds.
export function tickPresence(dt){
  updateAllies(dt);
  var presenceNow = performance.now();
  sendPresence(presenceNow);
  if (presenceNow - lastStaleSweep >= STALE_SWEEP_MS){
    lastStaleSweep = presenceNow;
    sweepStaleAllies();
  }
}
export const PLAYERS_PATH = 'rooms/global/players';

export function addAlly(id, data){
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

export function updateAllyTarget(id, data){
  var a = allies[id];
  if (!a){ addAlly(id, data); return; }
  a.targetX = data.x||0; a.targetZ = data.z||0; a.targetYaw = data.yaw||0;
  a.t = data.t || serverNow();
}

// presence writes are throttled to every PRESENCE_HZ_MS, but a tab can vanish
// without onDisconnect firing (crash, force-quit, killed network) and leave a
// frozen tank behind. Sweep out any ally whose last update is stale and drop
// its rtdb entry so every client converges on the same removal.
export function sweepStaleAllies(){
  if (!rtdb) return;
  // Presence t is server time; the rules check staleness against server time too.
  var cutoff = serverNow() - PRESENCE_TIMEOUT_MS;
  for (var id in allies){
    if (allies[id].t < cutoff) rtdb.ref(PLAYERS_PATH + '/' + id).remove().catch(function(){});
  }
}

export function removeAlly(id){
  var a = allies[id];
  if (!a) return;
  scene.remove(a.group);
  delete allies[id];
  delete alliesColliding[id];
}

export function subscribeAllies(){
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

export function queueJoin(name){ joinBuffer.push(name); scheduleAnnounceFlush(); }
export function queueLeave(name){ leaveBuffer.push(name); scheduleAnnounceFlush(); }

export function scheduleAnnounceFlush(){
  if (announceFlushTimer) return;
  announceFlushTimer = setTimeout(flushAnnouncements, ANNOUNCE_BATCH_MS);
}

export function flushAnnouncements(){
  announceFlushTimer = null;
  var joins = joinBuffer, leaves = leaveBuffer;
  joinBuffer = []; leaveBuffer = [];
  if (joins.length) announceBatch(joins, 'join');
  if (leaves.length) announceBatch(leaves, 'leave');
}

export function announceBatch(names, kind){
  var isJoin = kind === 'join';
  var lineText = names.length === 1
    ? names[0] + ' ' + (isJoin ? 'ON GRID' : 'OFFLINE')
    : names.length + ' PILOTS ' + (isJoin ? 'ON GRID' : 'OFFLINE');
  showCommsLine(lineText, kind);
  playCommsAudio(isJoin ? playCommsJoin : playCommsLeave, names.length === 1
    ? names[0] + (isJoin ? ' has entered the field' : ' has left the field')
    : names.length + ' pilots have ' + (isJoin ? 'entered the field' : 'left the field'));
}

export function sendPresence(nowMs){
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

export function updateAllies(dt){
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
