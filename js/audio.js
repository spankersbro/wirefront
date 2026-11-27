// Sound: engine hum, effects, comms chime and speech, the comms mute, and the title music (WF-34).
import { ANNOUNCE_MIN_AUDIO_GAP_MS } from './config.js';
import { G } from './state.js';
let speechReady = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
let actx = null,
  engineOsc = null,
  engineGain = null,
  engineFilter = null;
export function ensureAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = actx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 40;
    engineFilter = actx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 220;
    engineFilter.Q.value = 0.3;
    engineGain = actx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(actx.destination);
    engineOsc.start();
  } catch {
    actx = null;
  }
}
export function resumeAudio() {
  if (actx && actx.state === 'suspended') actx.resume();
}

export function playFire() {
  if (!actx) return;
  var t = actx.currentTime;
  var o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
  g.gain.setValueAtTime(0.09, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.15);
}

function noiseBurst(dur, startFreq, gainPeak) {
  if (!actx) return;
  var t = actx.currentTime;
  var bufSize = actx.sampleRate * dur;
  var buf = actx.createBuffer(1, bufSize, actx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  var src = actx.createBufferSource();
  src.buffer = buf;
  var filt = actx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(startFreq, t);
  filt.frequency.exponentialRampToValueAtTime(80, t + dur);
  var g = actx.createGain();
  g.gain.setValueAtTime(gainPeak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(g).connect(actx.destination);
  src.start(t);
}
export function playExplosion() {
  noiseBurst(0.5, 2200, 0.22);
}
export function playHit() {
  noiseBurst(0.35, 900, 0.28);
}
export function playTankCollision() {
  if (!actx) return;
  var t = actx.currentTime;
  var o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.15);
  noiseBurst(0.08, 3000, 0.1);
}
export function playBlip() {
  if (!actx) return;
  var t = actx.currentTime;
  var o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'triangle';
  o.frequency.value = 660;
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.09);
}
export function playCommsJoin() {
  if (!actx) return;
  var t = actx.currentTime;
  var o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(980, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.24);
}
export function playCommsLeave() {
  if (!actx) return;
  var t = actx.currentTime;
  var o = actx.createOscillator(),
    g = actx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(680, t);
  o.frequency.exponentialRampToValueAtTime(300, t + 0.2);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + 0.28);
}
let announceVoice = null;
const FEMALE_VOICE_HINTS = [
  'female',
  'samantha',
  'victoria',
  'karen',
  'tessa',
  'fiona',
  'moira',
  'veena',
  'susan',
  'allison',
  'ava',
  'serena',
  'kate',
  'amy',
  'joanna',
  'salli',
  'kimberly',
  'ivy',
  'zira',
  'google us english',
];
function pickAnnounceVoice() {
  if (!speechReady) return;
  var voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;
  announceVoice =
    voices.find(function (v) {
      var n = v.name.toLowerCase();
      return FEMALE_VOICE_HINTS.some(function (hint) {
        return n.indexOf(hint) > -1;
      });
    }) || null;
}
if (speechReady) {
  pickAnnounceVoice();
  window.speechSynthesis.onvoiceschanged = pickAnnounceVoice;
}

function speakAnnouncement(text) {
  if (!speechReady) return;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    if (announceVoice) u.voice = announceVoice;
    u.rate = 1.05;
    u.pitch = 1.0;
    u.volume = 0.7;
    window.speechSynthesis.speak(u);
  } catch {
    speechReady = false;
  }
}

const COMMS_MUTED_KEY = 'wirefront.commsMuted';
const commsToggle = document.getElementById('commsToggle');
let commsMuted = false;
try {
  commsMuted = localStorage.getItem(COMMS_MUTED_KEY) === '1';
} catch {
  /* storage is optional: private mode or blocked */
}
showCommsMuted();

function showCommsMuted() {
  commsToggle.setAttribute('aria-pressed', String(commsMuted));
}
export function toggleCommsMuted() {
  commsMuted = !commsMuted;
  try {
    localStorage.setItem(COMMS_MUTED_KEY, commsMuted ? '1' : '0');
  } catch {
    /* storage is optional: private mode or blocked */
  }
  if (commsMuted && speechReady) window.speechSynthesis.cancel();
  showCommsMuted();
  if (commsMuted) titleMusic.stop();
  else titleMusic.start();
}
commsToggle.addEventListener('click', function (ev) {
  toggleCommsMuted();
  // A mouse click leaves focus on the button, and Space (fire) would then toggle it again.
  if (ev.detail > 0) commsToggle.blur();
});

export function updateEngineHum(throttleMag) {
  if (!engineGain) return;
  var target = G.state === 'playing' ? 0.012 + throttleMag * 0.035 : 0;
  engineGain.gain.value += (target - engineGain.gain.value) * 0.1;
  engineOsc.frequency.value += (38 + throttleMag * 55 - engineOsc.frequency.value) * 0.08;
  engineFilter.frequency.value += (160 + throttleMag * 180 - engineFilter.frequency.value) * 0.08;
}

/* title music (WF-29) */
// Our own loop, no samples: A minor, F, C, G at 112 bpm. Sawtooth bass in eighths, a square arpeggio in sixteenths,
// a kick on each beat and a noise hat between. Notes are scheduled 120 ms ahead so timer jitter cannot be heard.
export const titleMusic = (function () {
  var STEP = 60 / 112 / 4,
    CHORDS = [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ];
  var onBeat = null,
    timer = null,
    bus = null,
    nextTime = 0,
    step = 0,
    notes = 0,
    wanted = false,
    noise = null;
  function hz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }
  function tone(type, freq, t, dur, vol, cutoff) {
    var o = actx.createOscillator(),
      g = actx.createGain(),
      f = actx.createBiquadFilter();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
    notes++;
  }
  function kick(t) {
    var o = actx.createOscillator(),
      g = actx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.25);
  }
  function hat(t) {
    if (!noise) {
      noise = actx.createBuffer(1, actx.sampleRate * 0.05, actx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = actx.createBufferSource(),
      f = actx.createBiquadFilter(),
      g = actx.createGain();
    src.buffer = noise;
    f.type = 'highpass';
    f.frequency.value = 7000;
    g.gain.value = 0.25;
    src.connect(f).connect(g).connect(bus);
    src.start(t);
  }
  function schedule() {
    // After a stall (shader compile, a throttled tab) skip ahead instead of playing every missed note at once.
    if (nextTime < actx.currentTime) nextTime = actx.currentTime + 0.02;
    while (nextTime < actx.currentTime + 0.12) {
      var s = step % 16,
        chord = CHORDS[Math.floor(step / 16) % 4];
      if (s % 2 === 0) tone('sawtooth', hz(chord[0] - 24 + (s % 4 === 2 ? 12 : 0)), nextTime, STEP * 1.8, 0.5, 700);
      tone('square', hz(chord[s % 3] + 12), nextTime, STEP * 0.9, 0.16, 2600);
      if (s % 4 === 0) kick(nextTime);
      if (s % 4 === 2) hat(nextTime);
      if (s === 0 && onBeat) setTimeout(onBeat, Math.max(0, (nextTime - actx.currentTime) * 1000));
      nextTime += STEP;
      step++;
    }
  }
  function start() {
    if (timer || commsMuted || G.state !== 'title' || !actx) return;
    bus = actx.createGain();
    bus.gain.value = 0.07;
    bus.connect(actx.destination);
    nextTime = actx.currentTime + 0.05;
    step = 0;
    timer = setInterval(schedule, 25);
    schedule();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    var b = bus;
    bus = null;
    b.gain.setTargetAtTime(0, actx.currentTime, 0.05);
    setTimeout(function () {
      b.disconnect();
    }, 400);
  }
  // Browsers block audio until the first click or key press, so the loop starts on the first input on the title.
  function firstInput() {
    if (G.state !== 'title' || wanted) return;
    wanted = true;
    ensureAudio();
    resumeAudio();
    start();
  }
  return {
    // Registered by main.js after the game's own listeners, so Enter and M on the title act first: Enter starts
    // the game (the loop never starts) and M mutes (the loop stays silent). click, not pointerdown: phones only
    // count a click or touchend as the gesture that unlocks audio.
    listenForFirstInput: function () {
      window.addEventListener('keydown', firstInput);
      window.addEventListener('click', firstInput);
    },
    // Called on each bar's downbeat, e.g. to send a ripple through the title wordmark.
    onBar: function (fn) {
      onBeat = fn;
    },
    start: start,
    stop: stop,
    leaveTitle: function () {
      wanted = false;
      stop();
    },
    state: function () {
      return timer ? 'playing' : wanted && commsMuted ? 'muted' : 'off';
    },
    notes: function () {
      return notes;
    },
  };
})();

// Chime plus voice line, unless muted or another voice line played in the last 4 s.
let lastAnnounceAudioAt = -Infinity;
export function playCommsAudio(chime, speech) {
  if (commsMuted) return;
  var now = performance.now();
  if (now - lastAnnounceAudioAt < ANNOUNCE_MIN_AUDIO_GAP_MS) return;
  lastAnnounceAudioAt = now;
  chime();
  speakAnnouncement(speech);
}
