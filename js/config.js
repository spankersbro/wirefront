// Fixed settings: Firebase config, colours, tank types, world and physics constants (WF-34).
export const FIREBASE_CONFIG = {
  projectId: 'wirefront-49636',
  appId: '1:690237862698:web:67862d813cd89f90b06453',
  storageBucket: 'wirefront-49636.firebasestorage.app',
  apiKey: 'AIzaSyC0KsurLqS3evck7TspwGh96fvOTGtCCDc',
  authDomain: 'wirefront-49636.firebaseapp.com',
  messagingSenderId: '690237862698',
  databaseURL: 'https://wirefront-49636-default-rtdb.firebaseio.com',
};
export const VOID = 0x030d07;
export const PHOS = 0x3dff7a;
export const PHOS_DEEP = 0x0a3319;
export const AMBER = 0xffb020;
export const WHITE_HOT = 0xeafff1;
export const CYAN = 0x3ce0ff;
// Standard enemy tanks: green tanks disappeared against the green grid (WF-21).
const MAGENTA = 0xff3ddc;
export const EMBER = 0xff5a2a;
export const EMBER_DIM = 0x4a1408;
export const ICE_BLUE = 0xcfeeff;
export const ALLY_VARIANT = { name: 'ally', color: ICE_BLUE, scale: 1.0 };
export const PRESENCE_HZ_MS = 110;
export const PRESENCE_TIMEOUT_MS = 15000;
export const STALE_SWEEP_MS = 3000;
export const ANNOUNCE_BATCH_MS = 900;
export const ANNOUNCE_MIN_AUDIO_GAP_MS = 4000;
export const MAX_COMMS_LINES = 3;
// database.rules.json accepts only names built from these two lists; change both together.
export const CALLSIGN_ADJ = [
  'SILENT',
  'IRON',
  'GHOST',
  'CRIMSON',
  'ARCTIC',
  'LONE',
  'SWIFT',
  'NIGHT',
  'STEEL',
  'VOID',
  'RAPID',
  'GRIM',
  'SOLAR',
  'ROGUE',
  'QUIET',
];
export const CALLSIGN_NOUN = [
  'FALCON',
  'WOLF',
  'VIPER',
  'HORNET',
  'RAVEN',
  'COBRA',
  'SPECTRE',
  'TALON',
  'REAPER',
  'FOX',
  'LYNX',
  'HAWK',
  'JACKAL',
  'CONDOR',
  'MANTIS',
];

export const TANK_VARIANTS = [
  { name: 'scout', color: CYAN, scale: 0.82, speedMul: 1.45, hp: 1, fireMul: 1.2 },
  { name: 'standard', color: MAGENTA, scale: 1.0, speedMul: 1.0, hp: 1, fireMul: 1.0 },
  { name: 'heavy', color: AMBER, scale: 1.3, speedMul: 0.68, hp: 2, fireMul: 0.8 },
];
export function dimColor(hex, factor) {
  var c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return c.getHex();
}

export const WORLD_R = 170;
export const SPAWN_CLEAR = 26;
export const PLAYER_SPEED_FWD = 15;
export const PLAYER_SPEED_REV = 9;
export const PLAYER_TURN_RATE = 1.7;
export const PLAYER_SHOT_SPEED = 62;
export const ENEMY_SHOT_SPEED = 17;
export const FIRE_COOLDOWN = 0.26;
export const HIT_RADIUS_ENEMY = 2.4;
export const PLAYER_BODY_R = 1.1;
export const ALLY_BODY_R = 1.35;
export const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
