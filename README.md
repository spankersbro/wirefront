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
- Hosted on GitHub Pages, custom domain via `CNAME`.

## Controls

Keyboard: A/D or ◄► to turn, W/S or ▲▼ for throttle, Space to fire.
Touch: left-side stick to drive, right-side pad to fire.
