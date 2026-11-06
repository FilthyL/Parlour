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
import { joinRoom, normaliseCode, openRoom } from '../net/transport';
import { ClientRoom, HostRoom } from '../net/session';
import { mountRoom, openJoin } from './room';

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
    // plain hashes only (#holdem opens that game's setup, #join-ABCDE joins a room)
    const raw = location.hash.replace(/^#\/?/, '');
    if (raw.startsWith('join-')) {
      const code = normaliseCode(raw.slice(5));
      this.showLobby();
      setTimeout(() => this.join(code), 0);
      return;
    }
    const id = raw.replace(/^(play|table)[-/]/, '');
    if (id && gameById(id)) {
      if (!this.unmount) this.go('');
      // a table can only be opened through the setup sheet
      setTimeout(() => this.openGame(gameById(id)!), 0);
      return;
    }
    this.showLobby();
  }

  private go(hash: string) {
    const want = hash ? '#' + hash : '';
    if (location.hash !== want) {
      try {
        history.replaceState(null, '', want || location.pathname + location.search);
      } catch {
        /* sandboxed hosts may refuse; routing is a convenience */
      }
    }
  }

  private showLobby() {
    this.unmount?.();
    this.go('');
    this.unmount = mountLobby(this.root, (g) => this.openGame(g), () => openSettings(() => this.reprint()));
  }

  private openGame(g: GameDef) {
    openSetup(g, (r) => (r.mode === 'online' ? this.host(g, r) : this.startGame(g, r)), ['cpu', 'local', 'online']);
  }

  /** Host an online room for this game. */
  private async host(g: GameDef, r: SetupResult) {
    this.unmount?.();
    this.unmount = null;
    let room: HostRoom | null = null;
    let closeTable: (() => void) | null = null;
    const screen = mountRoom(this.root, { gameName: g.meta.name, isHost: true, lobby: () => room?.lobby() ?? null, mySeat: () => 0, onLeave: () => leave(), onStart: () => start() });
    screen.status('Opening a room…');
    const leave = () => {
      room?.close();
      closeTable?.();
      screen.close();
      this.unmount = null;
      this.showLobby();
    };
    const start = () => {
      if (!room) return;
      room.start();
      screen.close();
      closeTable = mountTable(this, room.controller(leave), () => {});
      this.unmount = () => {
        room?.close();
        closeTable?.();
      };
    };
    this.unmount = () => {
      room?.close();
      screen.close();
    };
    try {
      const t = await openRoom();
      room = new HostRoom(t, g, { players: r.players, options: r.options, level: r.level, name: r.name });
      room.onLobby(() => screen.update());
      screen.status('');
    } catch (e: any) {
      screen.status(`Couldn't open a room (${e?.message ?? e}). Online rooms need a site that allows peer-to-peer connections, such as the GitHub Pages version.`, 'error');
    }
  }

  /** Join someone else's room. */
  private join(code: string) {
    openJoin(
      code,
      async (name) => {
        this.unmount?.();
        this.unmount = null;
        let client: ClientRoom | null = null;
        let closeTable: (() => void) | null = null;
        const leave = () => {
          client?.close();
          closeTable?.();
          screen.close();
          this.unmount = null;
          this.go('');
          this.showLobby();
        };
        const screen = mountRoom(this.root, { gameName: 'Joining…', isHost: false, lobby: () => client?.lobby ?? null, mySeat: () => client?.seat ?? -1, onLeave: () => leave() });
        screen.status(`Connecting to room ${code}…`);
        this.unmount = () => leave();
        try {
          const t = await joinRoom(code);
          client = new ClientRoom(t, code, name);
          client.on(() => {
            if (!client) return;
            if (client.status === 'full') return screen.status('That room is full or the game has already started.', 'error');
            if (client.status === 'closed' && !closeTable) return screen.status('The host closed the room.', 'error');
            if (client.status === 'playing' && !closeTable && client.game) {
              screen.close();
              closeTable = mountTable(this, client.controller(leave), () => {});
              return;
            }
            screen.status('');
            screen.update();
          });
        } catch (e: any) {
          screen.status(`Couldn't reach room ${code} (${e?.message ?? e}). Check the code, and that the host still has the room open.`, 'error');
        }
      },
      () => this.go(''),
    );
  }

  private startGame(g: GameDef, r: SetupResult) {
    this.unmount?.();
    this.go(g.meta.id);
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

// ---------------------------------------------------------------- online rooms
function mountTable(app: App, ctl: Controller, onLeave: () => void) {
  void app;
  const wrap = document.createElement('div');
  wrap.className = 'table-host';
  document.getElementById('app')!.appendChild(wrap);
  const table = new Table(wrap, ctl);
  return () => {
    table.destroy();
    wrap.remove();
    onLeave();
  };
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
