// Shared game state: the game, the player, the tanks, shots, particles and obstacles (WF-34).
// Arrays are only changed in place (keepOnly, length = 0), because other modules hold the same array.
export const G = {
  state: 'title',
  score: 0,
  wave: 1,
  lives: 3,
  invuln: 0,
  lastFire: -10,
  hintFaded: false,
};
export const keys = {};
export const touchDrive = { active: false, throttle: 0, turn: 0 };
export const fire = { held: false };

export const player = { x: 0, z: 0, yaw: 0, turnVel: 0, throttleVel: 0 };
export const enemies = [];
export const pShots = [];
export const eShots = [];
export const particles = [];
export const obstacles = [];
// Keeps the items the callback returns true for, in place: other modules hold the same array.
export function keepOnly(list, keep) {
  var kept = list.filter(keep);
  list.length = 0;
  Array.prototype.push.apply(list, kept);
}

// The game clock. three.js is a CDN global loaded before the modules.
export const clock = new THREE.Clock();
