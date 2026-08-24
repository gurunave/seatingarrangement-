# Seat Draft

A 10-minute team game for allocating desks. Everyone joins from their phone, plays a
maths sprint, and drafts a seat from a short list of options. Runs in one room with a
big screen: the projector shows the drama, the phones are the controllers.

## Status

Phase 1 of 5 is built and tested — **room setup and the join flow**.

| Phase | What it does | State |
|---|---|---|
| Setup | Manager lays out the desks; saved between runs | ✅ built |
| Join | Room code, phones join, live roster on the big screen | ✅ built |
| Sprint | 10 timed maths questions, everyone at once | ⏳ next |
| Reveal | Leaderboard, split into 4 tiers, shuffled within each tier | ⏳ |
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

## How the game will work

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
npm test           # 45 protocol tests — boots a server on a scratch port
npm run test:ui    # 34 browser tests (needs: npm i -D playwright)
```

The protocol suite covers joining, validation, host auth, reconnection, and the
manual-add flow. The UI suite drives real Chromium pages — the setup editor, the big
screen, and several phones at once — including refresh-recovery and duplicate names.
