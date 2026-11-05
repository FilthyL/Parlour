/** The "pull up a chair" sheet: mode, seats, difficulty and game options. */
import type { GameDef, Level } from '../core/types';
import { settings } from '../settings';
import { icon } from './icons';

export type Mode = 'cpu' | 'local' | 'online';
export interface SetupResult {
  mode: Mode;
  players: number;
  humans: number;
  level: Level;
  name: string;
  names: string[];
  options: Record<string, unknown>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openSetup(g: GameDef, onStart: (r: SetupResult) => void, availableModes: Mode[] = ['cpu']) {
  const m = g.meta;
  const st = settings.get();
  let players = m.players.def;
  let mode: Mode = 'cpu';
  let humans = Math.min(2, m.players.max);
  const opts: Record<string, unknown> = Object.fromEntries((m.options ?? []).map((o) => [o.id, o.default]));
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  const modes: [Mode, string, string, string][] = [
    ['cpu', 'cpu', 'Against the computer', 'You and computer players'],
    ['local', 'users', 'Pass and play', m.realtime ? 'Not for real-time games' : 'Share one device'],
    ['online', 'globe', 'Online room', 'Friends on their own devices'],
  ];
  const render = () => {
    const canLocal = !m.realtime && availableModes.includes('local');
    dlg.innerHTML = `
      <form method="dialog" class="sheet-body">
        <button class="icon-btn close" value="cancel" aria-label="Close">${icon('close')}</button>
        <p class="sheet-family">${esc(m.family)}</p>
        <h2>${esc(m.name)}</h2>
        <p class="sheet-blurb">${esc(m.blurb)}</p>
        <fieldset class="modes"><legend>How do you want to play?</legend>
          ${modes
            .map(([id, ic, label, sub]) => {
              const disabled = !availableModes.includes(id) || (id === 'local' && !canLocal);
              return `<label class="mode ${mode === id ? 'on' : ''} ${disabled ? 'off' : ''}">
                <input type="radio" name="mode" value="${id}" ${mode === id ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                ${icon(ic)}<b>${label}</b><span>${disabled && id !== 'local' ? 'Coming in the next update' : sub}</span></label>`;
            })
            .join('')}
        </fieldset>
        <div class="row">
          <span class="row-label">Players at the table</span>
          ${m.players.min === m.players.max ? `<b class="fixed">${m.players.min}${m.teams ? ' (two teams)' : ''}</b>` : `<div class="stepper"><button type="button" data-step="-1" aria-label="Fewer players">${icon('minus')}</button><output>${players}</output><button type="button" data-step="1" aria-label="More players">${icon('plus')}</button></div>`}
        </div>
        ${mode === 'local' ? `<div class="row"><span class="row-label">People playing on this device</span><div class="stepper"><button type="button" data-hstep="-1">${icon('minus')}</button><output>${humans}</output><button type="button" data-hstep="1">${icon('plus')}</button></div></div>` : ''}
        <div class="row"><span class="row-label">Computer players</span>
          <div class="seg">${(['easy', 'normal', 'hard'] as Level[]).map((l) => `<label class="${st.level === l ? 'on' : ''}"><input type="radio" name="level" value="${l}" ${st.level === l ? 'checked' : ''}>${l[0].toUpperCase() + l.slice(1)}</label>`).join('')}</div>
        </div>
        <div class="row"><label class="row-label" for="pname">Your name</label><input id="pname" class="text" maxlength="14" value="${esc(st.name)}"></div>
        ${(m.options ?? [])
          .map((o) => {
            if (o.type === 'toggle') return `<div class="row"><label class="row-label" for="o-${o.id}">${esc(o.label)}</label><input id="o-${o.id}" type="checkbox" class="switch" data-opt="${o.id}" ${opts[o.id] ? 'checked' : ''}></div>`;
            if (o.type === 'select')
              return `<div class="row"><label class="row-label" for="o-${o.id}">${esc(o.label)}</label><select id="o-${o.id}" class="text" data-opt="${o.id}">${o.choices!.map((c) => `<option value="${c.value}" ${String(c.value) === String(opts[o.id]) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>`;
            return '';
          })
          .join('')}
        <div class="sheet-actions"><button class="btn primary big" value="go">Deal me in</button></div>
      </form>`;
  };
  render();
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const step = t.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (step) {
      players = Math.max(m.players.min, Math.min(m.players.max, players + Number(step)));
      humans = Math.min(humans, players);
      render();
    }
    const hs = t.closest<HTMLElement>('[data-hstep]')?.dataset.hstep;
    if (hs) {
      humans = Math.max(2, Math.min(players, humans + Number(hs)));
      render();
    }
    if (t === dlg) dlg.close('cancel');
  });
  dlg.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'mode') {
      mode = t.value as Mode;
      render();
    } else if (t.name === 'level') {
      settings.set({ level: t.value as Level });
      render();
    } else if (t.dataset.opt) {
      const o = m.options!.find((x) => x.id === t.dataset.opt)!;
      opts[o.id] = o.type === 'toggle' ? t.checked : isNaN(Number(t.value)) ? t.value : Number(t.value);
    }
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'go') {
      const name = ((dlg.querySelector('#pname') as HTMLInputElement | null)?.value || 'You').trim() || 'You';
      settings.set({ name });
      onStart({ mode, players, humans: mode === 'local' ? humans : 1, level: settings.get().level, name, names: [], options: opts });
    }
    dlg.remove();
  });
  dlg.addEventListener('submit', () => {
    const name = (dlg.querySelector('#pname') as HTMLInputElement | null)?.value;
    if (name) settings.set({ name });
  });
  dlg.showModal();
}
