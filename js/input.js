// Keyboard, mouse and touch input (moved in WF-34).
import { G, keys, touchDrive, fire } from './state.js';
import { ensureAudio, resumeAudio, toggleCommsMuted } from './audio.js';
import { canvas } from './scene.js';
/* ════════════════════════ input ════════════════════════ */
// Enter on the title or the final game-over screen starts a game; main.js registers how.
export let startHandler = function () {};
export function onStartKey(fn) {
  startHandler = fn;
}
window.addEventListener('keydown', function (ev) {
  keys[ev.key.toLowerCase()] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(ev.key.toLowerCase()) > -1) ev.preventDefault();
  if (ev.key === ' ') fire.held = true;
  var withModifier = ev.ctrlKey || ev.metaKey || ev.altKey;
  if (ev.key.toLowerCase() === 'm' && !ev.repeat && !withModifier && ev.target.tagName !== 'INPUT') toggleCommsMuted();
  if (ev.key === 'Enter') {
    if (G.state === 'title') startHandler();
    else if (G.state === 'gameover-final') startHandler();
  }
  ensureAudio();
  resumeAudio();
});
window.addEventListener('keyup', function (ev) {
  keys[ev.key.toLowerCase()] = false;
  if (ev.key === ' ') fire.held = false;
});
canvas.addEventListener('mousedown', function () {
  ensureAudio();
  resumeAudio();
  fire.held = true;
});
window.addEventListener('mouseup', function () {
  fire.held = false;
});

export const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

export const joyZone = document.getElementById('joyZone');
export const joyNub = document.getElementById('joyNub');
export let joyId = null,
  joyCenter = { x: 0, y: 0 };
joyZone.addEventListener(
  'touchstart',
  function (ev) {
    ensureAudio();
    resumeAudio();
    var t = ev.changedTouches[0];
    joyId = t.identifier;
    var r = joyZone.getBoundingClientRect();
    joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    ev.preventDefault();
  },
  { passive: false },
);
joyZone.addEventListener(
  'touchmove',
  function (ev) {
    for (var i = 0; i < ev.changedTouches.length; i++) {
      var t = ev.changedTouches[i];
      if (t.identifier !== joyId) continue;
      var dx = t.clientX - joyCenter.x,
        dy = t.clientY - joyCenter.y;
      var max = 42;
      var d = Math.min(Math.sqrt(dx * dx + dy * dy), max);
      var ang = Math.atan2(dy, dx);
      var nx = Math.cos(ang) * d,
        ny = Math.sin(ang) * d;
      joyNub.style.transform = 'translate(calc(-50% + ' + nx + 'px), calc(-50% + ' + ny + 'px))';
      touchDrive.turn = -nx / max;
      touchDrive.throttle = -ny / max;
    }
    ev.preventDefault();
  },
  { passive: false },
);
export function endJoy(ev) {
  for (var i = 0; i < ev.changedTouches.length; i++) {
    if (ev.changedTouches[i].identifier === joyId) {
      joyId = null;
      touchDrive.turn = 0;
      touchDrive.throttle = 0;
      joyNub.style.transform = 'translate(-50%,-50%)';
    }
  }
}
joyZone.addEventListener('touchend', endJoy);
joyZone.addEventListener('touchcancel', endJoy);

export const fireBtn = document.getElementById('fireBtn');
fireBtn.addEventListener(
  'touchstart',
  function (ev) {
    ensureAudio();
    resumeAudio();
    fire.held = true;
    ev.preventDefault();
  },
  { passive: false },
);
fireBtn.addEventListener(
  'touchend',
  function (ev) {
    fire.held = false;
    ev.preventDefault();
  },
  { passive: false },
);
