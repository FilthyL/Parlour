/**
 * App shell: hash routing between the lobby and a table, the controllers
 * that connect a Table to a game (vs CPU, pass-and-play), and the deck
 * printing overlay.
 */
import { Runner } from '../core/runner';
import { randomSeed } from '../core/rng';
import type { Action, GameDef, PlayerSlot, Seat, View } from '../core/types';
import { GAMES, gameById } from '../games';
import { printDeck } from '../render/press';
import { Table, type Controller } from '../render/table';
import { settings } from '../settings';
import { mountLobby } from './lobby';
import { openSetup, type SetupResult } from './setup';
import { openSettings } from './settingsDialog';

const CPU_NAMES = ['Ada', 'Bea', 'Cyrus', 'Dario', 'Esme', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jules', 'Kit', 'Lena', 'Milo', 'Nora'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class App {
  private unmount: (() => void) | null = null;
  private printing: HTMLDivElement;

  constructor(private root: HTMLElement) {
    this.printing = document.createElement('div');
    this.printing.className = 'press-overlay';
    this.printing.innerHTML = `<div class="press-card"><div class="press-plate"><i></i></div><p>Printing your deck</p><span class="press-sub">Each deck is reprinted in your browser with its own paper and ink.</span><div class="press-bar"><i></i></div></div>`;
    document.body.appendChild(this.printing);
    window.addEventListener('hashchange', () => this.route());
    this.reprint();
    this.route();
  }

  reprint() {
    const s = settings.get();
    const bar = this.printing.querySelector<HTMLElement>('.press-bar i')!;
    this.printing.classList.add('on');
    printDeck(s.edition, s.deckSeed, (p) => {
      bar.style.transform = `scaleX(${p})`;
      if (p >= 1) this.printing.classList.remove('on');
    }).then(() => this.printing.classList.remove('on'));
  }

  private route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [page, id] = h.split('/');
    if (page === 'play' && id && gameById(id)) {
      if (!this.unmount) this.go('');
      // a table can only be opened through the setup sheet
      setTimeout(() => this.openGame(gameById(id)!), 0);
      return;
    }
    this.showLobby();
  }

  private go(hash: string) {
    if (location.hash.replace(/^#\/?/, '') !== hash) history.replaceState(null, '', '#/' + hash);
  }

  private showLobby() {
    this.unmount?.();
    this.go('');
    this.unmount = mountLobby(this.root, (g) => this.openGame(g), () => openSettings(() => this.reprint()));
  }

  private openGame(g: GameDef) {
    openSetup(g, (r) => this.startGame(g, r), ['cpu', 'local']);
  }

  private startGame(g: GameDef, r: SetupResult) {
    this.unmount?.();
    this.go('table/' + g.meta.id);
    const names = [...CPU_NAMES].sort(() => Math.random() - 0.5);
    const players: PlayerSlot[] = [];
    if (r.mode === 'local') {
      for (let i = 0; i < r.players; i++) players.push(i < r.humans ? { name: i === 0 ? r.name : `Player ${i + 1}`, kind: 'human' } : { name: names.pop()!, kind: 'cpu', level: r.level });
    } else {
      players.push({ name: r.name, kind: 'human' });
      for (let i = 1; i < r.players; i++) players.push({ name: names.pop()!, kind: 'cpu', level: r.level });
    }
    const runner = new Runner({ def: g, players, options: r.options, seed: randomSeed(), pace: () => settings.pace() });
    const leave = () => {
      runner.dispose();
      table.destroy();
      this.unmount = null;
      this.showLobby();
    };
    const ctl = r.mode === 'local' ? passAndPlay(g, runner, players, leave) : vsCpu(g, runner, leave);
    const wrap = document.createElement('div');
    wrap.className = 'table-host';
    this.root.appendChild(wrap);
    const table = new Table(wrap, ctl.controller);
    this.unmount = () => {
      runner.dispose();
      table.destroy();
      ctl.dispose?.();
      wrap.remove();
    };
  }
}

function vsCpu(g: GameDef, runner: Runner, leave: () => void): { controller: Controller; dispose?: () => void } {
  return {
    controller: {
      meta: g.meta,
      label: 'Against the computer',
      view: () => runner.view(0),
      submit: (a: Action) => runner.submit(0, a),
      onChange: (cb) => runner.onChange(cb),
      hold: (p) => runner.hold(p),
      leave,
    },
  };
}

/**
 * Pass and play: the table always shows the view of the local person whose
 * turn it is. When that changes, a curtain covers the table until the next
 * person taps to reveal their cards.
 */
function passAndPlay(g: GameDef, runner: Runner, players: PlayerSlot[], leave: () => void): { controller: Controller; dispose: () => void } {
  const humans = players.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);
  let viewer: Seat = humans[0];
  let curtainFor: Seat | null = null;
  const curtain = document.createElement('div');
  curtain.className = 'curtain';
  document.body.appendChild(curtain);
  const listeners = new Set<() => void>();
  const pick = () => {
    const acting = runner.toAct().filter((s) => humans.includes(s));
    if (acting.length && !acting.includes(viewer)) {
      const next = acting[0];
      if (next !== viewer) {
        viewer = next;
        curtainFor = next;
        curtain.innerHTML = `<div class="curtain-card"><p>Pass the device to</p><h2>${esc(players[next].name)}</h2><button class="btn primary big">I'm ${esc(players[next].name)}: show my cards</button></div>`;
        curtain.classList.add('on');
        curtain.querySelector('button')!.addEventListener('click', () => {
          curtainFor = null;
          curtain.classList.remove('on');
          listeners.forEach((f) => f());
        });
      }
    }
  };
  const off = runner.onChange(() => {
    pick();
    listeners.forEach((f) => f());
  });
  return {
    controller: {
      meta: g.meta,
      label: 'Pass and play',
      view: (): View | null => (curtainFor !== null ? null : runner.view(viewer)),
      submit: (a: Action) => {
        // a "next hand" style action counts for every local player
        if (a.t === 'next' || a.t === 'rematch' || a.t === 'ready') {
          let err: string | undefined;
          for (const h of humans) if (runner.toAct().includes(h)) err = runner.submit(h, a) ?? err;
          return err;
        }
        return runner.submit(viewer, a);
      },
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      hold: (p) => runner.hold(p),
      leave,
    },
    dispose: () => {
      off();
      curtain.remove();
    },
  };
}

export { GAMES };
