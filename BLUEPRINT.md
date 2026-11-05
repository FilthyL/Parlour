# Blueprint — the card-room site (working title: **Parlour**)

> The site name is a placeholder. It lives in one constant (`src/brand.ts`) so it
> can be renamed in a single edit.

## 1. What we are building

A static website with **22 classic card games**. Each one follows its standard
rules and player limits. You can play every game:

| Mode | How it works |
| --- | --- |
| **Against the computer** | You plus CPU opponents. Easy / Normal / Hard. |
| **Pass and play** | Several people share one device. A privacy curtain covers the table between turns. |
| **Online room** | The host makes a room code. Friends join from their own devices (peer-to-peer over WebRTC, no server to run). Empty seats are filled by CPUs. |

The look is the point: a felt-and-lacquer card room, cards that look printed
on real stock, and a dealer that performs **cardistry** (riffle, bridge, fans,
cuts, spring) before every deal.

## 2. Game catalogue (standard rules, standard player counts)

| # | Game | Family | Players | Deck | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Blackjack | Casino | 1–7 vs dealer | 6-deck shoe | S17, 3:2 blackjack, double, split ×3, insurance |
| 2 | Baccarat (Punto Banco) | Casino | 1–7 | 8-deck shoe | Player / Banker (5 % commission) / Tie 8:1, full tableau |
| 3 | Texas Hold'em | Poker | 2–9 | 52 | No-limit, blinds, side pots, rising blinds |
| 4 | Omaha | Poker | 2–9 | 52 | Pot-limit, exactly 2 hole + 3 board |
| 5 | Five Card Draw | Poker | 2–6 | 52 | No-limit, draw up to 3 (4 with an Ace) |
| 6 | Hearts | Trick-taking | 4 | 52 | Passing rotation, broken hearts, moon shot, to 100 |
| 7 | Spades | Trick-taking | 4 (2 teams) | 52 | Bids, nil, bags, to 500 |
| 8 | Euchre | Trick-taking | 4 (2 teams) | 24 (9–A) | Bowers, order up, going alone, to 10 |
| 9 | Oh Hell | Trick-taking | 3–7 | 52 | 1 → max → 1 cards, exact bids, dealer's hook |
| 10 | Whist | Trick-taking | 4 (2 teams) | 52 | Trump turned, odd tricks, to 7 |
| 11 | Gin Rummy | Rummy | 2 | 52 | Knock ≤ 10, gin, undercut, lay-offs, to 100 |
| 12 | Rummy | Rummy | 2–6 | 52 | Sets / runs, lay-offs, rummy doubles, to 100 |
| 13 | Crazy Eights | Shedding | 2–7 | 52 | Eights wild, draw until playable, to 100 |
| 14 | President | Climbing | 4–7 | 52 | Sets, 2s high, card exchange, ranks |
| 15 | Cheat | Bluffing | 3–8 | 52 | Face-down claims, call "Cheat!" |
| 16 | Sevens (Fan Tan) | Layout | 3–8 | 52 | Build suits out from the 7s |
| 17 | Go Fish | Family | 2–6 | 52 | Ask, fish, books |
| 18 | Old Maid | Family | 2–6 | 51 | Pairs, pick from neighbour, avoid the Old Maid |
| 19 | Cribbage | Classic | 2 | 52 | Crib, pegging, 15s, nobs, animated board, to 121 |
| 20 | Golf (six-card) | Classic | 2–4 | 52 | 2×3 grid, column pairs cancel, 9 holes |
| 21 | War | Duel | 2 | 52 | Battles, 3-down-1-up wars |
| 22 | Egyptian Rat Screw | Slap (real-time) | 2–6 | 52 | Face-card challenges, doubles and sandwiches |

Pass and play is offered for every turn-based game. Egyptian Rat Screw is real-time, so it offers CPU and online only.

## 3. Architecture

```
src/
  brand.ts              site name + copy in one place
  core/
    cards.ts            Card model, decks, shoes, ranks, helpers
    rng.ts              seeded RNG (mulberry32) — reproducible deals/tests
    types.ts            GameDef / View / Zone / Action contracts
    runner.ts           GameRunner: state machine driver, CPU scheduling, timed steps
    util/               poker evaluator, meld finder, trick helpers, cribbage scorer
  games/<game>.ts       one module per game: create / toAct / act / step / cpu / view
  games/index.ts        registry + metadata (families, player limits, rules text)
  render/
    press/              ★ card "press": plate separation reprint + paper + foil (Web Worker)
    backs.ts            ★ seeded guilloche card-back generator
    cardLayer.ts        persistent card sprites, FLIP flights, 3D flips, z-order
    layout.ts           seat ellipse + zone geometry (fan, row, stack, trick, grid)
    cardistry.ts        dealer flourish choreography (WAAPI)
    chips.ts            chip stacks
    table.ts            renders a View: seats, zones, chips, HUD, prompts
  net/
    transport.ts        PeerJS (WebRTC) + BroadcastChannel (same-device test) transports
    host.ts / client.ts host-authoritative session, per-seat views
  ui/
    app.ts router       #/ (lobby), #/play/<game>, #/join/<code>
    lobby.ts            hero performance + game shelf
    setup.ts            mode/players/difficulty sheet
    room.ts             online lobby
    settings.ts         felt, ink edition, back, speed, sound
    sound.ts            WebAudio synthesized snaps, riffles, chips (no audio files)
  styles/               tokens + components
scripts/
  separate-plates.mjs   ★ build-time ink separation of the public-domain card art
```

### Game contract (host-authoritative, view-based)

Each game is pure logic over a JSON state:

- `create(cfg)` makes the initial state for the seats, options and seeded RNG.
- `toAct(s)` returns the seats that may act now. Several can act at once (passing, challenges, slaps).
- `act(s, seat, action)` checks the action and changes the state. It returns an error string if the move is illegal.
- `step(s)` with `auto(s)` handles timed automatic progress: dealer play, trick collection, timed challenge windows.
- `cpu(s, seat, level)` returns the CPU's chosen action, or `null` to wait (real-time games).
- `view(s, viewer)` returns **only what that seat may see**: zones of cards (face-down cards carry no face), seats, buttons, prompts and scoreboards.

The renderer only knows `View`. The network only sends `View`s, so hidden
information never leaves the host, and every game is multiplayer-ready
without any per-game networking code.

### Online protocol

```
client → host : hello{name} · act{action} · chat{text}
host → client : welcome{seat} · lobby{seats} · view{View, seq} · chat · bye
```

Peer ID = `parlour-<6-char code>`. Share link `#/join/<code>`. If someone
drops out, a CPU takes their seat. When they rejoin under the same name,
they get the seat back.

## 4. Design system

Subject: a private card room. Its world is felt, lacquered rails, engraved
tuck boxes, banknote guilloche and foil stamping.

| Token | Hex | Role |
| --- | --- | --- |
| Ink Navy | `#0E1A2B` | page ground (not black) |
| Felt | `#0F4D3A` | the table (themeable: emerald, sapphire, bordeaux, onyx) |
| Bone | `#F3EBDD` | text on dark, card stock |
| Foil Gold | `#C9A45C` | engraved rules, frames, highlights |
| Lacquer Red | `#B3262E` | primary action, red suits |
| Smoke | `#8A93A6` | secondary text |

- **Type**: *Bodoni Moda* for display (engraved, tuck-box elegance) and *Schibsted Grotesk* for the interface (sturdy, tabular numerals). Sentence case, and no all-caps eyebrows.
- **Layout**: the lobby opens with a live dealer performance as the hero. Below it, a "shelf" of games grouped by family, each tile a small fanned hand that shows the game's key cards. The table is a full-bleed oval: viewer at the bottom, opponents around the rail, dealer mat at the top.
- **Principles**:
  1. Tactile realism. Cards have weight, shadow, a paper finish and 3D flips.
  2. Engraving is structure. Guilloche frames mark panels, never decoration for its own sake.
  3. The dealer's cardistry is the one orchestrated moment. Everything else stays quiet and responds to the player.
- **Quality floor**: responsive to phones, keyboard focus, `prefers-reduced-motion` (flourishes shortened), and a colour-blind-safe suit contrast.

## 5. ★ The card press — making every deck one of a kind

The face art is Byron Knoll's public-domain *Vector Playing Cards*. Rather
than showing those images as they are, the site **reprints** them.

1. **Separation (build time, `scripts/separate-plates.mjs`)**. Each SVG is rasterised at 2× and every pixel is classified to its nearest printing ink in CIE-Lab: paper, black, red, blue, yellow. The binary plates are box-downsampled back to 1×, which gives anti-aliased *coverage* maps. The four plates are packed losslessly into one RGB PNG per card: the top half holds red/blue/black, the bottom half holds yellow and the card mask.
2. **Reprint (runtime, Web Worker)**. For each pixel:
   - Generate **paper** from seeded fBm value noise plus directional fibre streaks on an ivory base.
   - Print the plates in press order (yellow/foil → blue → red → black) with **multiply** blending in the edition's custom inks.
   - Give each plate a seeded sub-pixel **misregistration** offset (≤ 0.35 px, sampled bilinearly) and low-frequency **ink density** noise.
   - Emboss an **air-cushion linen finish**: a dimple height-field is lit from the top-left using finite-difference normals.
   - Turn the gold plate into a **foil mask**. CSS sweeps a metallic highlight across it as the card tilts or the pointer moves.
3. **Editions**: Heritage, Noir, Riviera and Royal recolour the court cards completely. Each comes from one palette definition.
4. **Seeded uniqueness**: the deck seed drives paper grain, misregistration, ink density and the **guilloche back**. "Print a new deck" gives you a deck nobody else has.

### Guilloche backs (`render/backs.ts`)

Real security engraving, done procedurally. There's a central rosette of layered hypotrochoids `x = (R−r)cos t + d cos((R−r)t/r)`, a meshed epitrochoid ring, wave-line borders, and a 180° rotational symmetry like real backs. Line counts, ratios and phases all come from the seed. It's drawn once per deck to an image and reused by every card sprite.

## 6. Cardistry choreography (`render/cardistry.ts`)

Before each deal, the dealer mat performs this sequence. Durations scale with the speed setting, and the whole thing shortens under reduced motion.

1. **Gather**: every card on the table flies back to the dealer.
2. **Riffle shuffle**: the deck splits into two packets that tilt in and interleave with staggered drops and a riffle sound.
3. **Bridge**: the packets arch and cascade together.
4. **Signature flourish**, one chosen per deal:
   - *Fan*: a 180° fan opens and closes.
   - *Charlier cut*: a one-handed pivot cut.
   - *Ribbon spread and turnover*: a wave of flips across the felt.
   - *Spring*: cards arc from one hand to the other.
   - *Sybil-style cascade*: three packets lift and recombine.
5. **Deal**: cards fly to each seat in true deal order, each with a flick spin and a card-snap sound.

## 7. Milestones (each one is a commit)

1. Blueprint
2. Scaffold: Vite + TypeScript, fonts, tokens, brand
3. Card press (separation script, plates, reprint worker) and guilloche backs
4. Core engine (cards, RNG, types, runner) and a test harness
5. Renderer: card layer, layout, table, HUD, sound, settings
6. Lobby, setup sheet, routing
7. Cardistry
8. Games 1–22, one commit each, each with an all-CPU simulation test
9. Pass and play
10. Online rooms (PeerJS and BroadcastChannel)
11. Polish pass from screenshots: phone layout, accessibility, reduced motion
12. README and GitHub Pages deploy workflow

## 8. Testing

- **Simulation tests** (Vitest): every game plays hundreds of all-CPU games with fixed seeds to completion. They check for no exceptions, no illegal CPU moves, that each game ends, and that cards are conserved.
- **Privacy test**: no `View` ever exposes the face of a card hidden from that seat.
- **Browser smoke test** (Playwright): open each game, play some turns and screenshot the table on desktop and on a phone.

## 9. Credits and licences

- Card face art: *Vector Playing Cards* by Byron Knoll, public domain (via `notpeter/Vector-Playing-Cards`).
- Fonts: Bodoni Moda and Schibsted Grotesk (SIL Open Font License), bundled through Fontsource.
- PeerJS (MIT) for WebRTC rooms.
- Everything else (backs, felt, chips, sounds, layout, games) is original to this project.
