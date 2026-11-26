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
- **Phase 1 — live co-op presence.** Firebase Realtime Database (`wirefront-49636-default-rtdb`,
  us-central1) added to the same project. One shared global room at `rooms/global/players`;
  each client writes its own `{name, x, z, yaw, t}` at ~9Hz and relies on `onDisconnect()` for
  cleanup — verified with two concurrent clients, both entries appeared and both cleared on
  disconnect. Random two-word callsign generated client-side on join, shown as a billboarded
  name-tag sprite above each ally tank. Allies render in a distinct pale ice-blue
  (`0xcfeeff`), unmistakable against the saturated cyan scout-enemy color. Security rules
  (`database.rules.json`) validate shape and bounds on write, deployed.
  - **Known limitation, on purpose:** enemy tanks stay per-player/local. You'll see real
    allies driving around, but your enemies aren't their enemies yet — everyone is still
    fighting their own independent simulation. That's Phase 2.
- **Phase 1 polish — join/leave comms, tank collision, line readability.** Shipped
  2026-09-21.
  - Join/leave announcements: a small on-screen comms line plus a chime and optional
    text-to-speech (Web Speech API, feature-detected, prefers a female system voice).
    Batched over a ~900ms window and audio/TTS capped to once per 4s, so a burst of
    arrivals reads as one line instead of spamming.
  - Tank-to-tank collision: the local tank can no longer drive through an ally's tank.
    Client-local only — each client resolves against the other's last-known position, no
    server authority — with separation eased in over ~0.15s rather than snapped instantly.
    The first version snapped in one frame and stranded the camera inside another tank's
    mesh when two players spawned on the same point (both start at world origin); fixed
    same day.
  - Brighter wireframe edges globally (canvas glow filter + line width) — readability
    fix, no gameplay change.

- **Tests and CI, 2026-11-25 (WF-11, WF-3).** Playwright e2e tests and GitHub Actions. Tests
  never touch live Firebase: they block it or serve a fake SDK (`tests/fixtures/`).
- **Own-entry presence writes, WF-10.** Each client signs in with Firebase Anonymous Auth and
  writes presence under its uid with a server timestamp. The RTDB rule allows writing only
  your own entry, and deleting someone else's only once it is 15s stale by server time.
  Rule tests run on the emulator: `npm run test:rules` (needs Java 21).

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
- Real per-call cost, unlike everything shipped so far (Firestore/RTDB/GitHub Pages cost
  nothing at this scale, although the project has billing enabled). Needs its own billing budget alert before it goes live, not bundled
  into the existing shared OSINT/Crimes alert.

## Open decisions for whoever (David or a future session) picks this back up

Since 2026-09-23 these are tracked as issues in David's own tracker (project WF). The list
below is a snapshot; the tracker is the live copy.

- [x] Phase 1 shipped 2026-09-21 — RTDB presence, name tags, ice-blue allies, verified with
      two concurrent clients.
- [x] Phase 1 polish shipped 2026-09-21 — join/leave comms, tank collision, brighter lines.
- [ ] Load-test join/leave comms batching with more than 2 concurrent clients — the batching
      and rate-limit math is sound on paper, unverified with a real burst of arrivals.
- [x] Comms mute toggle (WF-4): COMMS button in the HUD or the M key, remembered per browser.
      Mutes the join/leave chime and voice; the comms line still shows.
- [x] Gemini call frequency and prompt shape (WF-7, 2026-11-26): €5/month ceiling, Flash-Lite,
      one call per player every 5s for the whole wave, hard daily cap in the proxy, scripted AI
      as fallback. Details in WF-7.
- [x] Order (WF-8, 2026-11-26): Gemini tactical AI first, Phase 2 after.
- [x] Budget alert for `wirefront-49636`: "Wirefront spend", €5/month, created 2026-11-25
      (WF-9). The project has billing enabled; it is not on the free Spark plan.
