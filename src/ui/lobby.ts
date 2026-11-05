/** The lobby: the dealer's live performance as the hero, then the game shelf. */
import { BRAND } from '../brand';
import { FAMILIES, GAMES } from '../games';
import type { GameDef } from '../core/types';
import { perform, SHUFFLES, CUTS, FLOURISHES, TECHNIQUE_COUNT, type Performance } from '../render/cardistry';
import { currentDeck, onDeck } from '../render/press';
import { unlockAudio } from '../render/sound';
import { settings } from '../settings';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mountLobby(host: HTMLElement, open: (g: GameDef) => void, openSettings: () => void) {
  const el = document.createElement('div');
  el.className = 'lobby';
  const families = FAMILIES.map((f) => ({ ...f, games: GAMES.filter((g) => g.meta.family === f.id) })).filter((f) => f.games.length);
  el.innerHTML = `
    <header class="lobby-top">
      <span class="wordmark">${esc(BRAND.name)}</span>
      <button class="icon-btn" data-k="settings" aria-label="Deck and table settings">${icon('gear')}</button>
    </header>
    <section class="hero">
      <div class="hero-copy">
        <h1>${esc(BRAND.name)}</h1>
        <p class="tagline">${esc(BRAND.tagline)}</p>
        <p class="lede">${esc(BRAND.lede)}</p>
        <div class="hero-cta">
          <button class="btn primary" data-k="first">${icon('play')} Play ${esc(GAMES[0].meta.name)}</button>
          <a class="btn ghost" href="#shelf">See all ${GAMES.length === 1 ? 'games' : GAMES.length + ' games'}</a>
        </div>
      </div>
      <div class="hero-stage">
        <div class="mat"><div class="mat-ring"></div></div>
        <p class="hero-caption" aria-live="polite"></p>
        <p class="hero-note">The dealer knows ${TECHNIQUE_COUNT} flourishes and works a few into every deal.</p>
      </div>
    </section>
    <main id="shelf" class="shelf">
      ${families
        .map(
          (f) => `<section class="family">
          <div class="family-head"><h2>${esc(f.id)}</h2><p>${esc(f.blurb)}</p></div>
          <div class="tiles">${f.games.map((g) => tile(g)).join('')}</div>
        </section>`,
        )
        .join('')}
    </main>
    <footer class="lobby-foot">
      <p>Card art and design: an original flow-field deck printed in your browser. Sounds: Kenney Casino Audio (CC0).</p>
    </footer>`;
  host.appendChild(el);

  el.addEventListener('click', (e) => {
    unlockAudio();
    const t = e.target as HTMLElement;
    const k = t.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (k === 'settings') return openSettings();
    if (k === 'first') return open(GAMES[0]);
    const id = t.closest<HTMLElement>('[data-game]')?.dataset.game;
    const g = GAMES.find((x) => x.meta.id === id);
    if (g) open(g);
  });

  const paintFans = () => {
    const d = currentDeck();
    if (!d) return;
    el.querySelectorAll<HTMLImageElement>('img[data-code]').forEach((img) => {
      const u = d.face[img.dataset.code!];
      if (u && img.src !== u) img.src = u;
    });
  };
  paintFans();
  const offDeck = onDeck(paintFans);

  // ---- the hero performance: cycles through every technique
  const mat = el.querySelector<HTMLDivElement>('.mat')!;
  const cap = el.querySelector<HTMLParagraphElement>('.hero-caption')!;
  const names = [...Object.keys(SHUFFLES), ...Object.keys(FLOURISHES), ...Object.keys(CUTS)];
  let idx = Math.floor(Math.random() * names.length);
  let alive = true;
  let visible = true;
  let show: Performance | null = null;
  const loop = async () => {
    while (alive) {
      if (!visible || !currentDeck()?.back || document.hidden) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      const r = mat.getBoundingClientRect();
      const cw = Math.max(54, Math.min(r.width * 0.16, 96));
      show = perform(mat, {
        x: r.width / 2,
        y: r.height * 0.56,
        cw,
        ch: cw * (581 / 400),
        count: 1,
        pace: settings.pace() * 1.1,
        n: 22,
        only: names[idx++ % names.length],
        onName: (n) => {
          if (n) cap.textContent = n;
        },
      });
      await show.done;
      await new Promise((r) => setTimeout(r, 650));
    }
  };
  const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0.2 });
  io.observe(mat);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) loop();
  else cap.textContent = 'Motion is reduced, so the dealer is resting.';

  return () => {
    alive = false;
    show?.skip();
    io.disconnect();
    offDeck();
    el.remove();
  };
}

function tile(g: GameDef) {
  const m = g.meta;
  const players = m.players.min === m.players.max ? `${m.players.min} players` : `${m.players.min}–${m.players.max} players`;
  const n = m.hero.length;
  const fan = m.hero
    .map((c, i) => {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0;
      return `<img data-code="${c}" alt="" style="--r:${(t * 34).toFixed(1)}deg;--x:${(t * 64).toFixed(1)}%;--i:${i}" loading="lazy">`;
    })
    .join('');
  return `<button class="tile" data-game="${m.id}">
    <span class="fan" aria-hidden="true">${fan}</span>
    <span class="tile-text">
      <b>${esc(m.name)}</b>
      <span class="tile-blurb">${esc(m.blurb)}</span>
      <span class="tile-meta">${players}${m.length ? ` · ${esc(m.length)}` : ''}${m.teams ? ' · partners' : ''}${m.realtime ? ' · real-time' : ''}</span>
    </span>
  </button>`;
}
