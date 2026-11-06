# Parlour

A card room in the browser: 22 classic card games, with standard rules and
player counts, against computer opponents or with friends passing one device.
The dealer performs cardistry before every deal, the cards are an original
flow-field deck printed in your browser, and the sounds are real card and
chip recordings.

*"Parlour" is a working title. Rename the site in [`src/brand.ts`](src/brand.ts).*

## Games

| Family | Games |
| --- | --- |
| Poker | Texas Hold'em (2–9), Omaha (2–9, pot limit), Five Card Draw (2–6) |
| Casino | Blackjack (1–7 vs dealer), Baccarat (1–7, Punto Banco) |
| Trick-taking | Hearts (4), Spades (4, partners), Euchre (4, partners), Oh Hell (3–7), Whist (4, partners) |
| Rummy | Gin Rummy (2), Rummy (2–6) |
| Shedding | Crazy Eights (2–7), President (4–7), Cheat (3–8), Sevens (3–8) |
| Family | Go Fish (2–6), Old Maid (2–6) |
| Classic | Cribbage (2), Golf (2–4) |
| Duel | War (2), Egyptian Rat Screw (2–6, real-time) |

Every game has CPU players at three levels (easy, normal, hard) and full
rules in the in-game rules drawer. Three ways to play:

- **Against the computer**: you plus CPU players.
- **Pass and play**: several people share one device, with a privacy curtain
  between turns (every game except Egyptian Rat Screw, which is real-time).
- **Online room**: the host opens a room and sends the join link; friends play
  from their own devices over WebRTC (PeerJS). Empty seats are played by the
  computer, and a player who drops out is covered by the computer until they
  rejoin. Add `?net=local` to the URL to test rooms between tabs of one
  browser.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed local address. Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Plays every game to the end with CPU players and checks the rules (Vitest) |
| `npm run build` | Typechecks and builds the static site into `dist/` |
| `npm run plates` | Re-separates the source card art into ink plates (`public/press/plates`) |
| `npm run glyphs` | Re-extracts the Bodoni rank glyphs used on the card indices |
| `npm run hosted` | Builds, then writes `dist/parlour.html` for hosts that wrap pages in their own skeleton |

## Deploying

Pushes to `main` run `.github/workflows/pages.yml`, which tests, builds and
publishes to GitHub Pages. In the repository settings, under **Pages**, set the
source to **GitHub Actions** once.

## How it works

- **Games** (`src/games/*`) are pure logic over JSON state: `create`, `toAct`,
  `act`, timed `step`s, a `cpu` move chooser, and a `view` for each seat. A view
  only contains what that seat may see, so hidden cards never leave the game.
- **Runner** (`src/core/runner.ts`) drives a game, schedules CPU moves and
  timed steps, and pauses while the table animates. The same code runs the
  headless test simulator.
- **Table** (`src/render/table.ts`) renders any view. Cards are persistent
  sprites that fly on arcs and flip in 3D, chips sweep to the pot, seats show
  speech bubbles, and the HUD has rules, log, bet slider and keyboard keys.
- **Cardistry** (`src/render/cardistry.ts`): 22 techniques (5 shuffles, 5 cuts,
  12 flourishes) with captions and sounds, a few performed before each deal.
- **The card press** (`src/render/press/*`): each face is composed in a Web
  Worker. Pips and court letters are obstacles in a small potential-flow solve
  (SOR on the stream function), drawn as hairline streamlines with a soft band
  around each pip; backs are smooth concentric contour bands. A classic edition
  reprints public-domain traditional art from separated ink plates.

## Credits

- Classic court art: *Vector Playing Cards* by Byron Knoll, public domain.
- Sounds: *Casino Audio* by Kenney (kenney.nl), CC0.
- Fonts: Bodoni Moda and Schibsted Grotesk, SIL Open Font License.
