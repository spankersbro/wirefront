# Wirefront

A browser vector-tank shooter — a homage to 1980s vector-scope arcade combat games,
built with Three.js. Drive, dodge and fire across a wireframe battlefield; your cannon
points wherever your hull points, so aiming is driving. Wave-based enemy tanks, a
heading-up radar, and a live global leaderboard.

**Play:** https://wirefront.davidirving.dev

## Stack

- Static page, no build step — Three.js (r128, wireframe rendering via `EdgesGeometry`
  plus a void-colored occlusion fill, matching the real hidden-line-removal trick vector
  monitors used) for the 3D world.
- WebAudio for engine hum / fire / explosion sound, synthesized — no audio files.
- Firestore (`firestore.rules` in this repo) for the shared high-score leaderboard —
  append-only, validated document shape, no update/delete allowed.
- Firebase Realtime Database (`database.rules.json`) for live co-op presence — everyone with
  the page open shows up as an ally tank, in real time, in one shared global room.
- Hosted on GitHub Pages, custom domain via `CNAME`.

## Where things live

No build step: `index.html` loads `css/game.css`, the three.js and Firebase scripts from their CDNs, then
`js/main.js` as an ES module, which imports the rest.

| Path | What it holds |
|---|---|
| `js/main.js` | Game core: spawning, shots, game flow, update loops, main loop, boot, the `?e2e` test hooks |
| `js/config.js` | Fixed settings: Firebase config, colours, tank types, world and physics constants |
| `js/state.js` | Shared state: game, player, tanks, shots, particles, obstacles, clock (arrays change in place) |
| `js/scene.js` | three.js scene, camera, renderer, bloom, camera shake |
| `js/world.js` | Lights, grid, obstacles, line of sight, keeping tanks apart |
| `js/tanks.js` | Tank meshes, ally name tags |
| `js/radar.js` | HUD, toasts, the line-of-sight radar |
| `js/input.js` | Keyboard, mouse and touch |
| `js/audio.js` | Engine, effects, comms chime and speech, mute, title music |
| `js/comms.js` | The comms feed lines |
| `js/gemini.js` | Enemy tactics from Gemini via the proxy, scripted fallback |
| `js/title.js` | The ripple wordmark on the title screen |
| `js/net/leaderboard.js`, `js/net/presence.js` | Firestore leaderboard, Realtime Database co-op presence |
| `proxy/` | The Gemini proxy on Cloud Run (own `package.json` and tests) |
| `tests/` | Playwright e2e tests; `tests/rules/` for the Firebase rules |

`npm run lint` runs ESLint and Prettier's check (also in CI); `npm run format` formats `js/` and `css/`.

## Controls

Keyboard: A/D or ◄► to turn, W/S or ▲▼ for throttle, Space to fire.
Touch: left-side stick to drive, right-side pad to fire.
