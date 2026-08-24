# Seat Draft

A 10-minute team game for allocating desks. Everyone joins from their phone, plays a
maths sprint, and drafts a seat from a short list of options. Runs in one room with a
big screen: the projector shows the drama, the phones are the controllers.

## Status

All five phases are built and tested. The game is playable end to end.

| Phase | What it does | State |
|---|---|---|
| Setup | Manager lays out the desks; saved between runs | ✅ built |
| Join | Room code, phones join, live roster on the big screen | ✅ built |
| Sprint | 10 timed maths questions, everyone at once | ✅ built |
| Reveal | Leaderboard, then four tiers with the order shuffled inside each | ✅ built |
| Draft | Pick a desk; better tier = more options; the tail is auto-assigned | ✅ built |
| Result | Final map, downloadable as a PNG, plus the leaderboard | ✅ built |

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
| `/simulate` | you, rehearsing | Fill the lobby with up to 19 test players who play the whole game — sprint, draft and all — so you can run it solo before game day. |

Do `/setup` once, then open `/host` on the machine driving the screen. The lobby
shows a QR code — scanning it opens the join page with the room code already filled
in, so nobody types a URL off the projector. The same link works pasted into chat:
`http://<host>/?c=ABCD`. The QR is built server-side from the Host header the
browser used, so it points at wherever the app actually is (LAN IP or domain)
with nothing to configure.

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

## The reveal and the draft

Score sets your **tier**; order **within** your tier is drawn at random. Being fast
gets you more to choose from, but never guarantees you pick first — that randomness
is deliberate, so the same quick people don't take the best desk every quarter.

| Tier | Ranks (of 20) | Desks offered |
|---|---|---|
| 1 | 1–5 | 4 |
| 2 | 6–10 | 3 |
| 3 | 11–15 | 2 |
| 4 | 16–20 | 2 |

Tiers split the room as evenly as four groups allow, so it works for any headcount:
20 → 5/5/5/5, 18 → 5/5/4/4, 6 → 2/2/1/1.

**On your turn** your phone shows your desks and a 15-second countdown while the big
screen highlights them on the map and the room heckles. Tap one to claim it. If the
clock runs out you get one of them anyway, so a phone in someone's pocket never
stalls twenty people — and the host can skip a turn outright.

**The tail is auto-assigned.** With 20 desks for 20 people the last three have nothing
to decide between, so the room doesn't sit through the ceremony. Every spare desk
hands one of them a real choice back: 21 desks means only two are auto-assigned, and
at 23 everybody picks.

**At the end** the map fills in with names — chosen desks in blue, auto-assigned in
purple, window desks outlined — and downloads as a PNG for Slack. *Copy the list*
puts a desk-and-name list on your clipboard.

Override the timers with `DRAFT_SECONDS` and `SPRINT_SECONDS` if your team wants a
different pace.

## Deploying

One Node process, no build step, no database. It runs anywhere Node 18+ runs.

- **Your own server** (an LXC one-liner, Docker, or plain Node + systemd, with optional nginx in
  front): see **[DEPLOY.md](DEPLOY.md)** — the Dockerfile, compose file, systemd
  unit and nginx config are all in the repo.
- **A hosting platform** (Render/Railway/Fly, if you have no server): build
  `npm install`, start `npm start`; the platform's `PORT` is picked up
  automatically. Their ephemeral disks reset `data/layout.json` on redeploy —
  attach a persistent volume if redoing `/setup` each time would annoy you.
- **Off your laptop**: `npm start`, phones go to `http://<your-lan-ip>:3000`.
  No internet needed — but **test in the actual room first**; guest WiFi
  frequently blocks phone-to-laptop traffic.

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
npm test           # 150 tests — boots servers on scratch ports
npm run test:ui    # 95 browser tests (needs: npm i --no-save playwright jsqr)
```

Browser-test tooling is deliberately not in `package.json`: a plain `npm install`
on a deploy host would otherwise pull a browser download into every deploy.

| Suite | Covers |
|---|---|
| `questions` | 5,000 generated questions: distinct options, plausible distractors, no positional tell |
| `protocol` | Joining, validation, host auth, reconnection, the manual-add flow |
| `sprint` | Scoring, ranking, the answer key never reaching a phone, out-of-step answers, mid-sprint reconnect |
| `draft` | Tier maths, the within-tier shuffle actually varying, turn order, illegal picks, the auto-assigned tail |
| `sprint-timeout` / `draft-timeout` | Both deadlines, against servers run with short limits |
| `sim` | A complete game played end to end by rehearsal bots — realistic score spread included |
| `ui` / `ui-sprint` / `ui-draft` | Real Chromium: a full 20-person game from setup to the exported PNG |
| `ui-qr` | The lobby QR decodes back to the join URL, and following it lands in the lobby |
