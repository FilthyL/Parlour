/**
 * Persistent card sprites. Every physical card keeps one DOM element. When
 * a View moves it, the sprite flies from where it is to where it belongs
 * along a lifted arc, flips in 3D when its face becomes known or hidden,
 * and lands with a soft shadow.
 */
import type { CardView } from '../core/types';
import type { Pose, Pt } from './layout';
import { currentDeck } from './press';
import { sfx } from './sound';

interface Sprite {
  id: string;
  el: HTMLDivElement;
  inner: HTMLDivElement;
  front: HTMLDivElement;
  face?: string;
  faceUp: boolean;
  pose?: Pose;
  anim?: Animation;
  flip?: Animation;
}

export interface Target {
  card: CardView;
  pose: Pose;
  zone: string;
  mine: boolean; // in the viewer's own hand
}

const T = (p: Pose, cw: number, ch: number, extra = '') =>
  `translate3d(${(p.x - cw / 2).toFixed(1)}px, ${(p.y - ch / 2).toFixed(1)}px, 0) rotate(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})${extra}`;

export class CardLayer {
  readonly el: HTMLDivElement;
  private sprites = new Map<string, Sprite>();
  selected = new Set<string>();
  cw = 80;
  ch = 116;
  onClick: (id: string, card: CardView) => void = () => {};

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'card-layer';
    host.appendChild(this.el);
  }

  setSize(cw: number, ch: number) {
    this.cw = cw;
    this.ch = ch;
    this.el.style.setProperty('--cw', `${cw}px`);
    this.el.style.setProperty('--ch', `${ch}px`);
  }

  /** Refresh every sprite's art (after a reprint or edition change). */
  refreshArt() {
    const d = currentDeck();
    if (!d) return;
    this.el.style.setProperty('--back', `url("${d.back}")`);
    this.el.style.setProperty('--back-foil', d.backFoil ? `url("${d.backFoil}")` : 'none');
    for (const s of this.sprites.values()) if (s.face) this.paintFace(s, s.face);
  }

  private paintFace(s: Sprite, code: string) {
    const d = currentDeck();
    s.front.style.backgroundImage = d?.face[code] ? `url("${d.face[code]}")` : '';
    const foil = d?.foil[code];
    s.front.style.setProperty('--foil', foil ? `url("${foil}")` : 'none');
    s.front.dataset.code = code;
  }

  private make(id: string, at: Pose): Sprite {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    el.innerHTML = '<div class="lift"><div class="card-3d"><div class="face front"><i class="foil"></i></div><div class="face back"><i class="foil"></i></div></div></div>';
    const inner = el.querySelector('.card-3d') as HTMLDivElement;
    const front = el.querySelector('.front') as HTMLDivElement;
    el.style.transform = T(at, this.cw, this.ch);
    el.style.zIndex = String(at.z);
    this.el.appendChild(el);
    const s: Sprite = { id, el, inner, front, faceUp: false, pose: at };
    inner.style.transform = 'rotateY(180deg)';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = (el as any).__card as CardView | undefined;
      if (card) this.onClick(id, card);
    });
    this.sprites.set(id, s);
    return s;
  }

  has(id: string) {
    return this.sprites.has(id);
  }

  /**
   * Move every sprite to its target.
   * @param spawn where brand-new cards appear from (the deck)
   * @param dealGap ms between consecutive new cards (deal order)
   */
  apply(targets: Target[], spawn: Pt, dealGap: number, pace: number) {
    const seen = new Set<string>();
    // deal order: new cards interleaved round-robin across zones
    const fresh = targets.filter((t) => !this.sprites.has(t.card.id));
    const byZone = new Map<string, Target[]>();
    for (const t of fresh) byZone.set(t.zone, [...(byZone.get(t.zone) ?? []), t]);
    const order: Target[] = [];
    const lists = [...byZone.values()];
    for (let r = 0; lists.some((l) => l.length > r); r++) for (const l of lists) if (l[r]) order.push(l[r]);
    const delayOf = new Map(order.map((t, i) => [t.card.id, i * dealGap]));

    let flights = 0;
    for (const t of targets) {
      seen.add(t.card.id);
      let s = this.sprites.get(t.card.id);
      const isNew = !s;
      if (!s) s = this.make(t.card.id, { x: spawn.x, y: spawn.y, rot: 0, scale: t.pose.scale * 0.92, z: 900 });
      (s.el as any).__card = t.card;
      const c = t.card;
      const cls = s.el.classList;
      cls.toggle('playable', !!c.act);
      cls.toggle('selectable', !!c.sel);
      cls.toggle('mine', t.mine);
      cls.toggle('hi', !!c.hi);
      cls.toggle('dim', !!c.dim);
      if (!c.sel) this.selected.delete(c.id);
      cls.toggle('up', !!c.up || this.selected.has(c.id));
      const delay = isNew ? (delayOf.get(c.id) ?? 0) : 0;
      const moved = !s.pose || Math.abs(s.pose.x - t.pose.x) > 0.5 || Math.abs(s.pose.y - t.pose.y) > 0.5 || Math.abs(s.pose.rot - t.pose.rot) > 0.2 || Math.abs(s.pose.scale - t.pose.scale) > 0.01;
      if (moved) {
        this.fly(s, t.pose, { delay, spin: isNew, pace });
        flights++;
        if (isNew) sfx('slide', { delay, vol: 0.55, throttle: 0 });
      } else s.el.style.zIndex = String(t.pose.z);
      // faces
      if (c.f && c.f !== s.face) {
        s.face = c.f;
        this.paintFace(s, c.f);
      }
      const wantUp = !!c.f;
      if (wantUp !== s.faceUp) this.flipTo(s, wantUp, delay + (moved ? 180 * pace : 0), pace);
    }
    if (flights > 0 && flights <= 2) sfx('place', { vol: 0.35, throttle: 90, delay: 260 * pace });
    // sprites that left the table
    for (const [id, s] of this.sprites) {
      if (seen.has(id)) continue;
      this.sprites.delete(id);
      s.anim?.cancel();
      const a = s.el.animate([{ opacity: 1 }, { opacity: 0, transform: s.el.style.transform + ' scale(0.9)' }], { duration: 220, fill: 'forwards' });
      a.finished.then(() => s.el.remove(), () => s.el.remove());
    }
    return order.length ? order.length * dealGap + 600 * pace : 0;
  }

  private fly(s: Sprite, to: Pose, o: { delay: number; spin: boolean; pace: number }) {
    const cw = this.cw, ch = this.ch;
    if (s.anim) {
      try {
        s.anim.commitStyles();
      } catch {
        /* not rendered yet */
      }
      s.anim.cancel();
    }
    const from = s.el.style.transform;
    const fp = s.pose ?? to;
    const mid: Pose = {
      x: (fp.x + to.x) / 2,
      y: (fp.y + to.y) / 2 - Math.min(ch * 0.35, Math.hypot(to.x - fp.x, to.y - fp.y) * 0.18),
      rot: (fp.rot + to.rot) / 2 + (o.spin ? 180 : 0),
      scale: Math.max(fp.scale, to.scale) * 1.07,
      z: to.z,
    };
    const dur = (o.spin ? 520 : 420) * o.pace;
    s.el.style.zIndex = String(2000 + to.z);
    s.el.classList.add('flying');
    const a = s.el.animate(
      [{ transform: from }, { transform: T(mid, cw, ch), offset: 0.45 }, { transform: T(to, cw, ch, o.spin ? ' rotate(360deg)' : '') }],
      { duration: dur, delay: o.delay, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'backwards' },
    );
    s.anim = a;
    s.pose = to;
    s.el.style.transform = T(to, cw, ch);
    a.finished.then(
      () => {
        if (s.anim !== a) return;
        s.anim = undefined;
        s.el.style.zIndex = String(to.z);
        s.el.classList.remove('flying');
      },
      () => {},
    );
  }

  private flipTo(s: Sprite, up: boolean, delay: number, pace: number) {
    s.faceUp = up;
    s.flip?.cancel();
    const to = up ? 'rotateY(0deg)' : 'rotateY(180deg)';
    const from = up ? 'rotateY(180deg)' : 'rotateY(0deg)';
    s.inner.style.transform = to;
    s.flip = s.inner.animate([{ transform: from }, { transform: `${up ? 'rotateY(90deg)' : 'rotateY(90deg)'} scale(1.04)`, offset: 0.5 }, { transform: to }], {
      duration: 380 * pace,
      delay,
      easing: 'ease-in-out',
      fill: 'backwards',
    });
    if (delay < 2000) sfx('shove', { delay, vol: 0.25, throttle: 60 });
  }

  /** Fly every card to one point face down, then remove them. */
  async gather(to: Pt, pace: number) {
    const list = [...this.sprites.values()];
    if (!list.length) return;
    const anims: Promise<unknown>[] = [];
    list.forEach((s, i) => {
      s.anim?.cancel();
      if (s.faceUp) this.flipTo(s, false, i * 6, pace);
      const p: Pose = { x: to.x, y: to.y, rot: 0, scale: s.pose?.scale ?? 1, z: 50 + i };
      const a = s.el.animate([{ transform: s.el.style.transform }, { transform: T(p, this.cw, this.ch) }], {
        duration: 360 * pace,
        delay: i * 10 * pace,
        easing: 'cubic-bezier(.5,0,.3,1)',
        fill: 'forwards',
      });
      anims.push(a.finished.catch(() => {}));
    });
    sfx('shove', { vol: 0.5 });
    sfx('slide', { vol: 0.5, delay: 120 });
    await Promise.all(anims);
    for (const s of list) s.el.remove();
    this.sprites.clear();
  }

  clear() {
    for (const s of this.sprites.values()) s.el.remove();
    this.sprites.clear();
  }
}
