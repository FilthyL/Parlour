/**
 * The table: renders a View (plate, seats, cards, chips, HUD), runs the
 * dealer's cardistry on every fresh deal, plays the sounds, and turns clicks
 * into actions for whatever controller is driving it (local runner,
 * pass-and-play, or an online room).
 */
import type { Action, Button, GameMeta, View, Zone } from '../core/types';
import { settings } from '../settings';
import { CardLayer, type Target } from './cardLayer';
import { ChipLayer, type ChipTarget } from './chips';
import { perform, type Performance } from './cardistry';
import { anchorPt, computeGeo, zoneBox, zonePoses, type Geo, type Pt } from './layout';
import { plateSVG } from './plate';
import { currentDeck, onDeck } from './press';
import { sfx, unlockAudio } from './sound';
import { icon } from '../ui/icons';

export interface Controller {
  meta: GameMeta;
  label: string;
  view(): View | null;
  submit(a: Action): string | undefined;
  onChange(cb: () => void): () => void;
  hold?<T>(p: Promise<T>): Promise<T>;
  /** messages that arrive later (online errors, players joining or leaving) */
  onToast?(cb: (msg: string) => void): () => void;
  leave(): void;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hue = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Table {
  readonly root: HTMLDivElement;
  private cards: CardLayer;
  private chips: ChipLayer;
  private seatLayer: HTMLDivElement;
  private slotLayer: HTMLDivElement;
  private caption: HTMLDivElement;
  private hudTitle: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private actionBar: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private drawer: HTMLDivElement;
  private tableEl: HTMLDivElement;
  private geo: Geo | null = null;
  private lastDeal = -1;
  private lastFx = -1;
  private busy = false;
  private pending = false;
  private view: View | null = null;
  private show: Performance | null = null;
  private betValue = 0;
  private actionH = 76;
  private bannerKey = '';
  private offs: (() => void)[] = [];
  private pegEl: HTMLDivElement | null = null;
  /** the viewer's hand extents, so their plaque can step out of the way */
  private handBox: { left: number; top: number } | null = null;

  constructor(host: HTMLElement, private ctl: Controller) {
    const r = document.createElement('div');
    r.className = 'table-root';
    r.dataset.surface = settings.get().surface;
    r.innerHTML = `
      <div class="room"></div>
      <div class="tbl"></div>
      <div class="slot-layer"></div>
      <div class="seat-layer"></div>
      <div class="caption" aria-live="polite"></div>
      <header class="hud-top">
        <button class="icon-btn" data-k="leave" aria-label="Back to the lobby">${icon('back')}</button>
        <div class="hud-title"></div>
        <div class="hud-icons">
          <button class="icon-btn" data-k="rules" aria-label="Rules">${icon('book')}</button>
          <button class="icon-btn" data-k="log" aria-label="Hand history">${icon('list')}</button>
          <button class="icon-btn" data-k="sound" aria-label="Sound">${icon(settings.get().muted ? 'mute' : 'sound')}</button>
        </div>
      </header>
      <div class="prompt"></div>
      <div class="banner" role="status"></div>
      <footer class="action-bar"></footer>
      <aside class="drawer" aria-hidden="true"></aside>
      <div class="toast" role="alert"></div>`;
    host.appendChild(r);
    this.root = r;
    this.tableEl = r.querySelector('.tbl')!;
    this.slotLayer = r.querySelector('.slot-layer')!;
    this.seatLayer = r.querySelector('.seat-layer')!;
    this.chips = new ChipLayer(r);
    this.cards = new CardLayer(r);
    // keep HUD above the card layer
    r.append(r.querySelector('.caption')!, r.querySelector('.hud-top')!, r.querySelector('.prompt')!, r.querySelector('.banner')!, r.querySelector('.action-bar')!, r.querySelector('.drawer')!, r.querySelector('.toast')!);
    this.caption = r.querySelector('.caption')!;
    this.hudTitle = r.querySelector('.hud-title')!;
    this.promptEl = r.querySelector('.prompt')!;
    this.bannerEl = r.querySelector('.banner')!;
    this.actionBar = r.querySelector('.action-bar')!;
    this.toastEl = r.querySelector('.toast')!;
    this.drawer = r.querySelector('.drawer')!;
    this.cards.onClick = (id, card) => this.cardClick(id, card);

    r.querySelector('.hud-top')!.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest('button')?.dataset.k;
      if (k === 'leave') this.ctl.leave();
      if (k === 'rules') this.openDrawer('rules');
      if (k === 'log') this.openDrawer('log');
      if (k === 'sound') {
        settings.set({ muted: !settings.get().muted });
        (e.target as HTMLElement).closest('button')!.innerHTML = icon(settings.get().muted ? 'mute' : 'sound');
      }
    });
    r.addEventListener('pointerdown', unlockAudio, { once: true });
    r.addEventListener('pointermove', (e) => {
      r.style.setProperty('--mx', (e.clientX / r.clientWidth).toFixed(3));
      r.style.setProperty('--my', (e.clientY / r.clientHeight).toFixed(3));
    });
    r.addEventListener('click', (e) => {
      if (this.show && !(e.target as HTMLElement).closest('.hud-top,.action-bar,.drawer')) this.show.skip();
    });
    const onKey = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    const ro = new ResizeObserver(() => this.view && !this.busy && this.draw(this.view, false));
    ro.observe(r);
    this.offs.push(() => ro.disconnect());
    this.offs.push(onDeck(() => this.cards.refreshArt()));
    this.offs.push(settings.on((s) => (r.dataset.surface = s.surface)));
    this.offs.push(ctl.onChange(() => this.update()));
    if (ctl.onToast) this.offs.push(ctl.onToast((m) => this.toast(m)));
    this.cards.refreshArt();
    this.update();
  }

  destroy() {
    this.offs.forEach((f) => f());
    this.show?.skip();
    this.root.remove();
  }

  // ---------------------------------------------------------------- flow

  private update() {
    const v = this.ctl.view();
    if (!v) return;
    if (this.busy) {
      this.pending = true;
      return;
    }
    if (v.deal !== this.lastDeal) {
      const first = this.lastDeal === -1;
      this.lastDeal = v.deal;
      this.busy = true;
      const p = this.dealSequence(v, first);
      (this.ctl.hold ? this.ctl.hold(p) : p).finally(() => {
        this.busy = false;
        if (this.pending) {
          this.pending = false;
          this.update();
        }
      });
      return;
    }
    this.draw(v, false);
  }

  private async dealSequence(v: View, first: boolean) {
    const pace = settings.pace();
    this.view = v;
    // lay out the new table (seats, HUD) first, without cards
    this.layout(v);
    this.drawSeats(v);
    this.drawHud(v, true);
    const deckZone = v.zones.find((z) => z.deck);
    const deckPt = deckZone && this.geo ? anchorPt(this.geo, deckZone.at).p : { x: this.root.clientWidth / 2, y: this.root.clientHeight * 0.3 };
    this.chips.apply(
      (v.chips ?? []).filter((c) => c.id !== 'pot').map((c) => ({ id: c.id, at: this.chipPt(c.at), amount: c.amount })),
      { winners: [], pace },
    );
    await this.cards.gather(deckPt, pace);
    const count = settings.get().cardistry;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (count > 0 && currentDeck()?.back && this.geo) {
      if (first) sfx('open', { vol: 0.7 });
      this.show = perform(this.root, {
        x: this.geo.cx,
        y: this.geo.cy - this.geo.ry * 0.08,
        park: { x: deckPt.x, y: deckPt.y, scale: 0.82 },
        cw: this.geo.cw,
        ch: this.geo.ch,
        count: reduce ? 1 : first ? Math.max(count, 2) : count,
        pace,
        onName: (n) => this.setCaption(n),
      });
      await this.show.done;
      this.show = null;
    }
    const dealMs = this.draw(v, true);
    await sleep(dealMs);
  }

  private setCaption(name: string) {
    this.caption.textContent = name;
    this.caption.classList.toggle('on', !!name);
    if (this.geo) {
      this.caption.style.transform = `translate(${this.geo.cx}px, ${this.geo.cy + this.geo.ry * 0.36}px)`;
    }
  }

  // ---------------------------------------------------------------- drawing

  private layout(v: View) {
    const W = this.root.clientWidth, H = this.root.clientHeight;
    const g = computeGeo(W, H, v.seats.length, v.viewer, { topPad: 58, actionH: this.actionH });
    this.geo = g;
    this.cards.setSize(g.cw, g.ch);
    this.root.style.setProperty('--cw', `${g.cw}px`);
    this.root.style.setProperty('--ch', `${g.ch}px`);
    const pl = g.plate;
    Object.assign(this.tableEl.style, { left: `${pl.x}px`, top: `${pl.y}px`, width: `${pl.w}px`, height: `${pl.h}px` });
    const key = `${Math.round(pl.w)}x${Math.round(pl.h)}`;
    if (this.tableEl.dataset.key !== key) {
      this.tableEl.dataset.key = key;
      this.tableEl.innerHTML = plateSVG(pl.w, pl.h);
    }
    const me = g.seats[v.viewer];
    if (me) this.root.style.setProperty('--prompt-y', `${me.hand.y - g.ch * me.handScale * 0.5 - 44}px`);
  }

  private chipPt(a: View['zones'][number]['at']): Pt {
    const g = this.geo!;
    const { p, seat } = anchorPt(g, a);
    if (seat && 'slot' in a && a.slot === 'bet' && seat.k === 0) return { x: p.x, y: p.y };
    return p;
  }

  /** Draw everything; returns how long the deal animation will take (ms). */
  private draw(v: View, dealing: boolean): number {
    this.view = v;
    this.layout(v);
    const g = this.geo!;
    const pace = settings.pace();
    // cards
    const targets: Target[] = [];
    for (const z of v.zones) {
      const mine = 'seat' in z.at && z.at.seat === v.viewer && z.at.slot === 'hand';
      for (const { card, pose } of zonePoses(g, z)) targets.push({ card, pose, zone: z.id, mine });
    }
    const deckZone = v.zones.find((z) => z.deck);
    const spawn = deckZone ? anchorPt(g, deckZone.at).p : { x: g.cx, y: g.cy - g.ry * 0.6 };
    const dealMs = this.cards.apply(targets, spawn, dealing ? 105 * pace : 70 * pace, pace);
    const mine = targets.filter((t) => t.mine);
    this.handBox = mine.length
      ? { left: Math.min(...mine.map((t) => t.pose.x - (g.cw * t.pose.scale) / 2)), top: Math.min(...mine.map((t) => t.pose.y - (g.ch * t.pose.scale) / 2)) }
      : null;
    this.drawSlots(v);
    this.drawSeats(v);
    // chips
    const chipTargets: ChipTarget[] = (v.chips ?? []).map((c) => ({ id: c.id, at: this.chipPt(c.at), amount: c.amount, label: c.label }));
    const winners = v.seats.map((s, i) => (s.win ? g.seats[i].plaque : null)).filter(Boolean) as Pt[];
    this.chips.apply(chipTargets, { winners, pace });
    this.drawHud(v, dealing);
    this.drawPegboard(v);
    this.playFx(v);
    return dealMs;
  }

  /** Cribbage board: two lanes per player (1–60 up, 61–120 down), holes in fives. */
  private drawPegboard(v: View) {
    const g = this.geo!;
    if (!v.peg) {
      this.pegEl?.remove();
      this.pegEl = null;
      return;
    }
    const lanes = [[12, 28], [52, 68]];
    const yA = (k: number) => 300 - ((k - 1) * 4.4 + Math.floor((k - 1) / 5) * 3.2);
    const yB = (k: number) => 300 - ((120 - k) * 4.4 + Math.floor((120 - k) / 5) * 3.2);
    const pos = (p: number, sc: number): [number, number] => {
      if (sc <= 0) return [lanes[p][0], 312];
      if (sc >= v.peg!.target) return [40, 12];
      return sc <= 60 ? [lanes[p][0], yA(sc)] : [lanes[p][1], yB(sc)];
    };
    if (!this.pegEl) {
      const holes: string[] = [];
      for (const p of [0, 1]) for (let k = 1; k <= 120; k++) {
        const [x, y] = k <= 60 ? [lanes[p][0], yA(k)] : [lanes[p][1], yB(k)];
        holes.push(`<circle cx="${x}" cy="${y.toFixed(1)}" r="1.15"/>`);
      }
      const el = document.createElement('div');
      el.className = 'pegboard';
      el.innerHTML = `<svg viewBox="0 0 80 324" aria-label="Cribbage board">
        <rect x="1" y="1" width="78" height="322" rx="20" style="fill:var(--panel);stroke:var(--hair)"/>
        <g style="fill:var(--ink-3)" opacity=".55">${holes.join('')}<circle cx="40" cy="12" r="2"/></g>
        <text x="40" y="320" text-anchor="middle" font-size="6" style="fill:var(--ink-3);font-family:var(--type);font-weight:700">121</text>
        ${[0, 1].map((p) => `<g class="peg" id="pb${p}"><circle r="2.4" fill="${p ? '#d6286e' : '#2343e8'}" opacity=".4"/></g><g class="peg" id="pf${p}"><circle r="3" fill="${p ? '#d6286e' : '#2343e8'}" stroke="#fff" stroke-width=".8"/></g>`).join('')}
      </svg>`;
      this.root.insertBefore(el, this.seatLayer);
      this.pegEl = el;
    }
    const h = Math.min(g.ry * 1.45, 420);
    Object.assign(this.pegEl.style, { left: `${g.portrait ? 12 : g.cx - g.rx * 0.82 - h * 0.12}px`, top: `${g.cy - h / 2}px`, height: `${h}px`, width: `${(h * 80) / 324}px` });
    for (const p of [0, 1]) {
      const [fx2, fy] = pos(p, v.peg.scores[p]);
      const [bx, by] = pos(p, v.peg.prev[p]);
      (this.pegEl.querySelector(`#pf${p}`) as SVGGElement).style.transform = `translate(${fx2}px, ${fy}px)`;
      (this.pegEl.querySelector(`#pb${p}`) as SVGGElement).style.transform = `translate(${bx}px, ${by}px)`;
    }
  }

  private drawSlots(v: View) {
    const g = this.geo!;
    const html: string[] = [];
    for (const z of v.zones) {
      if (z.slots) {
        const b = zoneBox(g, z);
        const used = new Set(z.cards.map((c, i) => c.pos ?? i));
        for (let i = 0; i < b.slots; i++) {
          if (used.has(i)) continue;
          html.push(`<i class="slot" style="left:${b.x + i * b.gap}px;top:${b.y}px;width:${b.cw}px;height:${b.ch}px"></i>`);
        }
      }
      if (z.label || z.act || (z.lay === 'stack' && z.count)) {
        const b = zoneBox(g, z);
        const lab = z.label ?? (z.count ? String(z.count) : '');
        if (z.act) html.push(`<button class="zone-hit" data-zone="${esc(z.id)}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px" aria-label="${esc(z.label ?? z.id)}"></button>`);
        if (lab && z.cards.length) html.push(`<span class="zone-label" style="left:${b.x + b.w / 2}px;top:${b.y + b.h + 4}px">${esc(lab)}</span>`);
      }
    }
    this.slotLayer.innerHTML = html.join('');
    this.slotLayer.querySelectorAll<HTMLButtonElement>('.zone-hit').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const z = this.view?.zones.find((q) => q.id === b.dataset.zone);
        if (z?.act) this.send(z.needSel ? { ...z.act, cards: [...this.cards.selected] } : z.act);
      }),
    );
  }

  private drawSeats(v: View) {
    const g = this.geo!;
    const out: string[] = [];
    v.seats.forEach((s, i) => {
      const sg = g.seats[i];
      if (!sg) return;
      let p = sg.plaque;
      // a wide hand would run under your plaque: lift it above the cards
      if (sg.k === 0 && this.handBox && this.handBox.left < p.x + 80) p = { x: p.x, y: this.handBox.top - 28 };
      const badges = (s.badges ?? []).map((b) => `<i class="badge b-${b.toLowerCase()}">${esc(b)}</i>`).join('');
      const chips = s.chips != null ? `<span class="chips">${icon('chip')}${fmt(s.chips)}</span>` : '';
      const score = s.score ? `<span class="score">${esc(s.score)}</span>` : '';
      const sub = s.sub ? `<span class="sub">${esc(s.sub)}</span>` : '';
      const top = p.y < g.cy - g.ry * 0.3;
      const cls = ['seat', sg.k === 0 ? 'me' : '', s.active ? 'active' : '', s.out ? 'out' : '', s.win ? 'win' : '', top ? 'top' : '', top && p.x > g.cx + g.rx * 0.2 ? 'right' : ''].filter(Boolean).join(' ');
      out.push(`<div class="${cls}" style="transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)">
        ${s.say ? `<div class="bubble">${esc(s.say)}</div>` : ''}
        <div class="plaque">
          <div class="avatar" style="--h:${hue(s.name)}">${esc(s.name.slice(0, 1).toUpperCase())}${s.cpu ? '<i class="cpu-dot" title="Computer"></i>' : ''}</div>
          <div class="who"><b>${esc(s.name)}</b>${chips}${score}${sub}</div>
          ${badges ? `<div class="badges">${badges}</div>` : ''}
        </div>
      </div>`);
    });
    this.seatLayer.innerHTML = out.join('');
  }

  private drawHud(v: View, dealing: boolean) {
    const myTurn = !dealing && (v.buttons.length > 0 || !!v.bet);
    const waiting = !dealing && !myTurn && v.prompt ? ` · ${v.prompt}` : '';
    this.hudTitle.innerHTML = `<b>${esc(this.ctl.meta.name)}</b><span>${esc((v.status ?? this.ctl.label) + waiting)}</span>`;
    this.promptEl.classList.remove('on');
    // banner
    const key = v.banner ? v.banner.title + (v.banner.lines ?? []).join('|') : '';
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      if (v.banner) {
        this.bannerEl.innerHTML = `<div class="banner-card tone-${v.banner.tone ?? 'info'}"><h2>${esc(v.banner.title)}</h2>${(v.banner.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
        this.bannerEl.classList.add('on');
        if (v.banner.tone === 'win') sfx('win', { delay: 250 });
      } else this.bannerEl.classList.remove('on');
    }
    this.drawActions(v, dealing);
    if (this.drawer.classList.contains('open') && this.drawer.dataset.kind === 'log') this.openDrawer('log', true);
  }

  private drawActions(v: View, dealing: boolean) {
    const bar = this.actionBar;
    if (dealing || (!v.buttons.length && !v.bet)) {
      bar.innerHTML = '';
      bar.classList.remove('on');
      return;
    }
    bar.classList.add('on');
    const sel = this.cards.selected.size;
    const btn = (b: Button, i: number) => {
      const ok = !b.needSel || (sel >= b.needSel[0] && sel <= b.needSel[1]);
      return `<button class="btn ${b.kind ?? ''}" data-i="${i}" ${ok ? '' : 'disabled'}>${esc(b.label)}${b.key ? `<kbd>${esc(b.key.toUpperCase())}</kbd>` : ''}</button>`;
    };
    let bet = '';
    if (v.bet) {
      const b = v.bet;
      if (this.betValue < b.min || this.betValue > b.max) this.betValue = b.min;
      bet = `<div class="bet-ctl">
        <div class="presets">${b.presets.map((p, i) => `<button class="chip-btn" data-p="${i}">${esc(p.label)}</button>`).join('')}</div>
        <div class="bet-row">
          <input type="range" min="${b.min}" max="${b.max}" step="${b.step}" value="${this.betValue}" aria-label="Bet amount">
          <button class="btn primary bet-go" data-bet="1">${esc(b.verb)} <span class="amt">${fmt(this.betValue)}</span><kbd>R</kbd></button>
        </div>
      </div>`;
    }
    const prompt = v.prompt ? `<p class="bar-prompt">${esc(v.prompt)}</p>` : '';
    bar.innerHTML = `${prompt}<div class="bar-row">${bet}<div class="btns">${v.buttons.map(btn).join('')}</div></div>`;
    bar.querySelectorAll<HTMLButtonElement>('.btns .btn').forEach((el) =>
      el.addEventListener('click', () => {
        const b = v.buttons[Number(el.dataset.i)];
        this.send(b.needSel ? { ...b.a, cards: [...this.cards.selected] } : b.a);
      }),
    );
    // reserve the bar's real height so the player's hand always sits above it
    const need = bar.offsetHeight + 18;
    if (need > this.actionH + 4) {
      this.actionH = need;
      requestAnimationFrame(() => this.view && !this.busy && this.draw(this.view, false));
    }
    if (v.bet) {
      const range = bar.querySelector<HTMLInputElement>('input[type=range]')!;
      const amt = bar.querySelector<HTMLSpanElement>('.bet-go .amt')!;
      range.addEventListener('input', () => {
        this.betValue = Number(range.value);
        amt.textContent = fmt(this.betValue);
        sfx('chip', { vol: 0.25, throttle: 70 });
      });
      bar.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((el) =>
        el.addEventListener('click', () => {
          this.betValue = v.bet!.presets[Number(el.dataset.p)].amount;
          range.value = String(this.betValue);
          amt.textContent = fmt(this.betValue);
          sfx('chip', { vol: 0.4 });
        }),
      );
      bar.querySelector('.bet-go')!.addEventListener('click', () => this.send({ t: v.bet!.t, amount: this.betValue }));
    }
  }

  private playFx(v: View) {
    const list = v.fx ?? [];
    if (this.lastFx < 0) {
      this.lastFx = list.length ? list[list.length - 1].n : 0;
      return;
    }
    for (const e of list) {
      if (e.n <= this.lastFx) continue;
      this.lastFx = e.n;
      switch (e.k) {
        case 'chips': sfx('chip', { vol: 0.8 }); sfx('chip', { vol: 0.5, delay: 70 }); break;
        case 'allin': sfx('chips', { vol: 0.9 }); sfx('collide', { vol: 0.8, delay: 160 }); break;
        case 'fold': sfx('shove', { vol: 0.6 }); break;
        case 'check': sfx('place', { vol: 0.5, rate: 0.55 }); sfx('place', { vol: 0.45, rate: 0.6, delay: 110 }); break;
        case 'flop': sfx('slide', { vol: 0.7 }); sfx('slide', { vol: 0.6, delay: 90 }); sfx('fan', { vol: 0.5, delay: 260 }); break;
        case 'street': sfx('place', { vol: 0.7, delay: 120 }); break;
        case 'flip': sfx('fan', { vol: 0.5 }); break;
        case 'draw': sfx('slide', { vol: 0.6 }); break;
        case 'win': sfx('win'); break;
      }
    }
  }

  // ---------------------------------------------------------------- input

  private cardClick(id: string, card: { act?: Action; sel?: boolean }) {
    if (card.act) return this.send(card.act);
    if (card.sel) {
      if (this.cards.selected.has(id)) this.cards.selected.delete(id);
      else this.cards.selected.add(id);
      sfx('slide', { vol: 0.35, rate: 1.4 });
      if (this.view) this.draw(this.view, false);
    }
  }

  private send(a: Action) {
    unlockAudio();
    const err = this.ctl.submit(a);
    if (err) this.toast(err);
    else this.cards.selected.clear();
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout((this.toastEl as any).__t);
    (this.toastEl as any).__t = setTimeout(() => this.toastEl.classList.remove('on'), 2400);
  }

  private key(e: KeyboardEvent) {
    if (!this.view || e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape' && this.drawer.classList.contains('open')) return this.closeDrawer();
    const k = e.key.toLowerCase();
    const b = this.view.buttons.find((x) => x.key === k);
    if (b) {
      e.preventDefault();
      this.send(b.needSel ? { ...b.a, cards: [...this.cards.selected] } : b.a);
    } else if (k === 'r' && this.view.bet) this.send({ t: this.view.bet.t, amount: this.betValue });
    else if (k === ' ' && this.show) this.show.skip();
  }

  private openDrawer(kind: 'rules' | 'log', refresh = false) {
    const d = this.drawer;
    if (!refresh && d.classList.contains('open') && d.dataset.kind === kind) return this.closeDrawer();
    d.dataset.kind = kind;
    const close = `<button class="icon-btn close" aria-label="Close">${icon('close')}</button>`;
    if (kind === 'rules') {
      d.innerHTML = `${close}<h2>How to play ${esc(this.ctl.meta.name)}</h2>${this.ctl.meta.rules.map(([h, b]) => `<h3>${esc(h)}</h3><p>${b}</p>`).join('')}`;
    } else {
      const log = this.view?.log ?? [];
      d.innerHTML = `${close}<h2>Table log</h2><ol class="log">${log.map((l) => `<li>${esc(l)}</li>`).reverse().join('')}</ol>`;
    }
    d.querySelector('.close')!.addEventListener('click', () => this.closeDrawer());
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
  }

  private closeDrawer() {
    this.drawer.classList.remove('open');
    this.drawer.setAttribute('aria-hidden', 'true');
  }
}

export type { Zone };
