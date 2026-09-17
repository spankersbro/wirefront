# Roadmap

Where Wirefront is today, and the plan for turning it into a live multiplayer game
with a real "you vs. Gemini" AI opponent. Written 2026-09-17 to pick back up later —
nothing below is built yet except what's listed under "Shipped."

## Shipped

- Single-player wireframe tank combat: Three.js, wave-based enemy tanks (scout/standard/heavy
  variants, distinct colors and stats), heading-up radar, WebAudio sound, touch + keyboard
  controls, lit/shaded obstacles.
- Shared high-score leaderboard via Firestore (`wirefront-49636` GCP/Firebase project),
  append-only security rules, API key restricted to this domain + Firestore/Installations only.
- Hosted at `wirefront.davidirving.dev` (GitHub Pages + Cloudflare).

## Phase 1 — Live co-op presence (not started)

Goal: when multiple people have the page open, they see each other as allies in the same
world, in real time.

- Add **Firebase Realtime Database** to the existing `wirefront-49636` project — Firestore
  is the wrong tool for this (a handful of players broadcasting position ~10x/sec would blow
  through Firestore's free write quota in minutes; RTDB is built for exactly this and stays
  free at this scale).
- One shared global room to start — everyone currently on the page is in the same world, no
  lobby/matchmaking UI needed for v1.
- Each client writes its own `{name, x, z, yaw}` to RTDB at ~8–10Hz. Use RTDB's built-in
  `onDisconnect()` for presence cleanup (no manual heartbeat/timeout logic needed).
- Random callsign generated client-side on join ("SILENT FALCON" etc.), shown as a
  billboarded name-tag sprite above each ally tank.
- Ally tanks render in a distinct ice-blue — must read as unmistakably friendly, not
  confusable with the cyan scout-enemy color already in use.
- **Known limitation of this phase, on purpose:** enemy tanks stay per-player/local. You'll
  see real allies driving around, but your enemies aren't their enemies yet — everyone is
  still fighting their own independent simulation. That's Phase 2.

## Phase 2 — Shared, authoritative world (not started, harder problem)

Goal: everyone in the room fights the *same* enemy tanks and sees the *same* wave state —
what "the world just respawns" actually requires.

- Needs one authoritative source for enemy positions/wave progress (a real server-side
  simulation loop, e.g. on Cloud Run), not each client running its own copy — otherwise 7
  players' simulations drift apart and stop agreeing on what's happening.
- This is the point where "browser game" becomes "actual multiplayer game backend." Bigger
  lift than Phase 1; don't start it until Phase 1's plumbing (RTDB presence, name tags,
  interpolation) is proven out.

## "You vs. Gemini" — making the tagline literally true (not started)

Explicit standing rule for this feature, agreed 2026-09-17: **don't ship an AI opponent
branded "Gemini" unless it's actually calling Gemini.** Re-skinning the existing scripted
heuristic AI with that name would be a false capability claim — the same category of mistake
already caught and corrected once in David's LinkedIn drafts (a false "code's on GitHub"
line). Build it honest or don't use the name.

The honest version, and it's a better feature than the literal ask:

- Gemini is too slow/costly to drive frame-by-frame tank movement, so it doesn't. Every few
  seconds, each active tank asks Gemini for a **tactical** decision only — "flank left,"
  "hold and suppress," "retreat" — based on a short text summary of the fight (relative
  position, health, what's worked against this specific player before). That decision steers
  the existing movement/behavior code; Gemini picks strategy, the game engine still owns
  second-to-second physics.
- Feed it a summary of past outcomes pulled from Firestore ("this player beat heavy tanks by
  flanking left twice") as context on each call. That's genuine adaptive memory — not trained
  weights, but real context-driven behavior change across sessions. Also the most honestly
  marketable part of "you vs. Gemini."
- **Security constraint, non-negotiable:** a Gemini API key cannot be embedded client-side
  the way the Firebase key is — Firebase's key is designed to be public and restricted by
  HTTP referrer; a Gemini key is not, and exposing one in browser JS lets anyone spend against
  the billing account. Calls must go through a small server-side proxy (Cloud Run), same
  pattern already used for OSINT/Crimes. Store the key in Bitwarden per `SECURITY.md`'s
  standing practice, never commit it.
- Real per-call cost, unlike everything shipped so far (Firestore/RTDB/GitHub Pages are all
  free at this scale). Needs its own billing budget alert before it goes live, not bundled
  into the existing shared OSINT/Crimes alert.

## Open decisions for whoever (David or a future session) picks this back up

- [ ] Confirm Phase 1 scope and go ahead — this is the next buildable step, no new
      unresolved questions blocking it.
- [ ] Decide Gemini call frequency and prompt shape before building the proxy — affects cost
      directly.
- [ ] Decide whether Phase 2 (shared world) ships before or after the Gemini tactical AI —
      Gemini-driven tanks are far more interesting once everyone's actually fighting the same
      ones.
- [ ] Add a dedicated billing budget alert for `wirefront-49636` once Gemini calls are live
      (SECURITY.md flags this project currently has none — fine while it's Firestore-only,
      not fine once a paid API is in the loop).
