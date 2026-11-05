/** Casino chip stacks that grow, slide into the pot and fly to the winner. */
import type { Pt } from './layout';
import { sfx } from './sound';

const DENOMS = [
  { v: 1000, cls: 'c1000' },
  { v: 500, cls: 'c500' },
  { v: 100, cls: 'c100' },
  { v: 25, cls: 'c25' },
  { v: 5, cls: 'c5' },
  { v: 1, cls: 'c1' },
];

function breakdown(amount: number) {
  const out: string[] = [];
  let a = amount;
  for (const d of DENOMS) {
    let k = Math.floor(a / d.v);
    a -= k * d.v;
    k = Math.min(k, 12);
    for (let i = 0; i < k; i++) out.push(d.cls);
  }
  return out.slice(0, 24);
}

interface StackEl {
  el: HTMLDivElement;
  amount: number;
  at: Pt;
}

export interface ChipTarget {
  id: string;
  at: Pt;
  amount: number;
  label?: string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export class ChipLayer {
  readonly el: HTMLDivElement;
  private stacks = new Map<string, StackEl>();

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'chip-layer';
    host.appendChild(this.el);
  }

  private paint(s: StackEl, amount: number, label?: string) {
    const chips = breakdown(amount);
    // up to three columns of chips, like a dealer would stack them
    const cols: string[][] = [[], [], []];
    const groups = new Map<string, number>();
    chips.forEach((c) => groups.set(c, (groups.get(c) ?? 0) + 1));
    let ci = 0;
    for (const [c, k] of groups) {
      for (let i = 0; i < k; i++) cols[ci % 3].push(c);
      ci++;
    }
    const html = cols
      .filter((c) => c.length)
      .map((col) => `<div class="chip-col">${col.map((c, i) => `<i class="chip ${c}" style="--i:${i}"></i>`).join('')}</div>`)
      .join('');
    s.el.innerHTML = `<div class="chip-cols">${html}</div><div class="chip-amt">${label ?? fmt(amount)}</div>`;
    s.amount = amount;
  }

  apply(targets: ChipTarget[], opts: { potFrom?: Map<string, Pt>; winners: Pt[]; pace: number }) {
    const keep = new Set(targets.map((t) => t.id));
    const pot = targets.find((t) => t.id === 'pot');
    for (const t of targets) {
      let s = this.stacks.get(t.id);
      if (!s) {
        const el = document.createElement('div');
        el.className = 'chip-stack';
        this.el.appendChild(el);
        s = { el, amount: 0, at: t.at };
        this.stacks.set(t.id, s);
        el.style.transform = `translate(${t.at.x}px, ${t.at.y}px)`;
        const from = opts.potFrom?.get(t.id);
        if (from) el.animate([{ transform: `translate(${from.x}px, ${from.y}px) scale(.6)`, opacity: 0 }, { transform: `translate(${t.at.x}px, ${t.at.y}px)`, opacity: 1 }], { duration: 380 * opts.pace, easing: 'cubic-bezier(.2,.8,.3,1)' });
        else el.animate([{ opacity: 0, transform: `translate(${t.at.x}px, ${t.at.y}px) scale(.6)` }, { opacity: 1, transform: `translate(${t.at.x}px, ${t.at.y}px)` }], { duration: 260 * opts.pace });
      }
      if (s.amount !== t.amount) {
        if (t.amount > s.amount && s.amount > 0) s.el.animate([{ transform: `translate(${t.at.x}px, ${t.at.y}px) scale(1.12)` }, { transform: `translate(${t.at.x}px, ${t.at.y}px)` }], { duration: 240 });
        this.paint(s, t.amount, t.label);
      } else if (t.label) {
        const amt = s.el.querySelector('.chip-amt');
        if (amt && amt.textContent !== t.label) amt.textContent = t.label;
      }
      if (s.at.x !== t.at.x || s.at.y !== t.at.y) {
        s.el.style.transition = `transform ${300 * opts.pace}ms cubic-bezier(.2,.8,.3,1)`;
        s.at = t.at;
      }
      s.el.style.transform = `translate(${t.at.x}px, ${t.at.y}px)`;
    }
    for (const [id, s] of this.stacks) {
      if (keep.has(id)) continue;
      this.stacks.delete(id);
      // bets sweep into the pot; the pot flies to the winner(s)
      const dest = id === 'pot' ? opts.winners[0] : pot?.at ?? opts.winners[0];
      if (dest) {
        sfx(id === 'pot' ? 'handle' : 'chips', { vol: 0.7 });
        const a = s.el.animate([{ transform: `translate(${s.at.x}px, ${s.at.y}px)`, opacity: 1 }, { transform: `translate(${dest.x}px, ${dest.y}px) scale(.8)`, opacity: id === 'pot' ? 0 : 0.2 }], {
          duration: (id === 'pot' ? 700 : 420) * opts.pace,
          delay: id === 'pot' ? 350 * opts.pace : 0,
          easing: 'cubic-bezier(.5,0,.3,1)',
          fill: 'forwards',
        });
        a.finished.then(() => s.el.remove(), () => s.el.remove());
      } else s.el.remove();
    }
  }

  clear() {
    this.el.innerHTML = '';
    this.stacks.clear();
  }
}
