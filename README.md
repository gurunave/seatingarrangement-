# Seat Draft

A 10-minute team game for allocating desks. Everyone joins from their phone, plays a
maths sprint, and drafts a seat from a short list of options. Runs in one room with a
big screen: the projector shows the drama, the phones are the controllers.

## Status

Phases 1–2 are built and tested — **setup, join, and the maths sprint**.

| Phase | What it does | State |
|---|---|---|
| Setup | Manager lays out the desks; saved between runs | ✅ built |
| Join | Room code, phones join, live roster on the big screen | ✅ built |
| Sprint | 10 timed maths questions, everyone at once | ✅ built |
| Reveal | Leaderboard ✅ — tiers and the shuffle still to come | 🚧 partial |
| Draft | Pick a desk; better rank = more options; last 3 auto-assigned | ⏳ |
| Result | Final map as a shareable image, plus the leaderboard | ⏳ |

## Running it

```bash
npm install
npm start          # http://localhost:3000
```

Three screens:

| URL | Who | What |
|---|---|---|
| `/setup` | you | Arrange the desks. Saved to `data/layout.json` and reused every run. |
| `/host` | the projector | Room code, live roster, and the controls that drive the game. |
| `/` | everyone's phone | Enter the code and your name. |

Do `/setup` once, then open `/host` on the machine driving the screen and read the
code out. People can also scan/click a prefilled link: `http://<host>/?c=ABCD`.

## The maths sprint

Ten questions, the same set in the same order for everyone, four options each.
Tap an answer and the next question appears. Score is correct answers; ties break
on total elapsed time, so speed only counts once you're right.

- **90 seconds**, shown on both the phone and the big screen. Override with
  `SPRINT_SECONDS` if your team wants longer.
- **Nothing leaks.** The phone is sent four numbers and never told which is right
  until after it commits. The big screen shows how far along each person is, but
  no scores until the sprint ends — there is no answer key on any device.
- **The room never stalls.** It ends when everyone finishes, when the clock runs
  out, or when you press *End sprint now*. Whatever someone has answered by then
  counts; the rest are simply missing.
- **Reconnecting works mid-sprint.** Refresh, lock the phone, drop off WiFi — you
  come back to the same question with the answers you already gave intact.
- **Difficulty ramps** across three bands, from `18 + 8` to `36 × 6`. Distractors
  are near-misses, so the right answer never stands out as the only sane number,
  and the answer is spread evenly across the four slots so tapping the same
  position blind is no strategy at all.

## How the rest of the game works

Score on the maths sprint sets your **tier**; order **within** your tier is random.
Being fast gets you more to choose from, but never guarantees you pick first — that
randomness is deliberate, so the same quick people don't win every quarter.

| Tier | Ranks | Desks offered |
|---|---|---|
| 1 | 1–5 | 4 |
| 2 | 6–10 | 3 |
| 3 | 11–15 | 2 |
| 4 | 16–17 | 2 |
| — | 18–20 | auto-assigned |

## Deploying

One Node process, no build step, no database. It runs anywhere Node runs.

- **Hosted** (recommended): deploy to Render/Railway/Fly. Build `npm install`, start
  `npm start`, and the platform's `PORT` is picked up automatically. Everyone opens
  one URL, on office WiFi or mobile data.
- **Off your laptop**: `npm start`, then have people go to `http://<your-lan-ip>:3000`.
  No internet needed — but **test it in the actual room first**, because guest WiFi
  frequently blocks phone-to-laptop traffic.

Note that hosts with ephemeral disks will reset `data/layout.json` on redeploy. It
takes a minute to redo in `/setup`; if that matters, attach a persistent volume.

## Design notes

- **In-memory rooms.** A restart mid-game means everyone rejoins with the same code.
  That's the right trade for a 10-minute event that happens four times a year.
- **Reconnection is assumed, not exceptional.** Phones lock and WiFi drops, so every
  client stores its identity and walks back in. Dropping off the network never
  removes you from the roster.
- **The host screen holds a token.** A player who guesses the `/host` URL can't kick
  people out of the lobby.
- **No build step, no framework.** For an app that runs four times a year, a
  toolchain is one more thing to break on the morning you need it.

## Tests

```bash
npm test           # 102 tests — boots servers on scratch ports
npm run test:ui    # 58 browser tests (needs: npm i -D playwright)
```

| Suite | Covers |
|---|---|
| `questions` | 5,000 generated questions: distinct options, plausible distractors, no positional tell |
| `protocol` | Joining, validation, host auth, reconnection, the manual-add flow |
| `sprint` | Scoring, ranking, the answer key never reaching a phone, out-of-step answers, mid-sprint reconnect |
| `sprint-timeout` | The sprint's own deadline, against a server run with a short limit |
| `ui` / `ui-sprint` | Real Chromium: the editor, the big screen, and several phones playing at once |
