/** Online room screens: the host's waiting room and the guest's join sheet. */
import type { LobbyState } from '../net/session';
import { settings } from '../settings';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hue = (name: string) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function joinLink(code: string) {
  return `${location.origin}${location.pathname}${location.search}#join-${code}`;
}

export interface RoomScreen {
  update(): void;
  status(msg: string, tone?: 'info' | 'error'): void;
  close(): void;
}

export function mountRoom(
  host: HTMLElement,
  o: { gameName: string; isHost: boolean; lobby: () => LobbyState | null; mySeat: () => number; onStart?: () => void; onLeave: () => void },
): RoomScreen {
  const el = document.createElement('div');
  el.className = 'room-screen';
  host.appendChild(el);
  let statusMsg = '';
  let statusTone: 'info' | 'error' = 'info';
  const render = () => {
    const l = o.lobby();
    const code = l?.code ?? '·····';
    const seats = l?.seats ?? [];
    const joined = seats.filter((s) => s.kind !== 'open').length;
    el.innerHTML = `<div class="room-card">
      <p class="sheet-family">Online room · ${esc(o.gameName)}</p>
      <h2>Room <span class="room-code">${esc(code)}</span></h2>
      <p class="sheet-blurb">${o.isHost ? 'Send this link to the people you want at the table. Any seat left empty is played by the computer.' : 'You are in. The host starts the game when everyone has arrived.'}</p>
      ${l ? `<div class="share"><input id="room-link" class="text" readonly value="${esc(joinLink(code))}" aria-label="Join link"><button class="btn ghost" data-k="copy">Copy link</button></div>` : ''}
      <ol class="room-seats">${seats
        .map((s, i) => {
          const me = i === o.mySeat();
          const name = s.kind === 'open' ? 'Open seat' : s.name;
          const state = s.kind === 'host' ? 'Host' : s.kind === 'open' ? 'Computer plays if empty' : s.away ? 'Reconnecting…' : 'Connected';
          return `<li class="${s.kind}${me ? ' me' : ''}"><span class="avatar" style="--h:${hue(name)}">${s.kind === 'open' ? icon('cpu') : esc(name.slice(0, 1).toUpperCase())}</span><b>${esc(name)}${me ? ' (you)' : ''}</b><span>${state}</span></li>`;
        })
        .join('')}</ol>
      ${statusMsg ? `<p class="room-status ${statusTone}" role="status">${esc(statusMsg)}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn ghost" data-k="leave">Leave</button>
        ${o.isHost ? `<button class="btn primary big" data-k="start" ${l ? '' : 'disabled'}>Start with ${joined} ${joined === 1 ? 'person' : 'people'}</button>` : '<span class="room-wait">Waiting for the host…</span>'}
      </div>
    </div>`;
  };
  el.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
    if (k === 'leave') o.onLeave();
    if (k === 'start') o.onStart?.();
    if (k === 'copy') {
      const input = el.querySelector<HTMLInputElement>('#room-link')!;
      const done = () => {
        const b = el.querySelector<HTMLButtonElement>('[data-k=copy]');
        if (b) b.textContent = 'Copied';
      };
      navigator.clipboard?.writeText(input.value).then(done, () => {
        input.select();
      });
    }
  });
  render();
  return {
    update: render,
    status(msg, tone = 'info') {
      statusMsg = msg;
      statusTone = tone;
      render();
    },
    close: () => el.remove(),
  };
}

/** Ask a guest for their name before joining a room. */
export function openJoin(code: string, onJoin: (name: string) => void, onCancel: () => void) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.innerHTML = `<form method="dialog" class="sheet-body">
    <button class="icon-btn close" value="cancel" aria-label="Close">${icon('close')}</button>
    <p class="sheet-family">Online room</p>
    <h2>Join room ${esc(code)}</h2>
    <p class="sheet-blurb">You'll take a seat at your friend's table. Your cards stay on your screen only.</p>
    <div class="row"><label class="row-label" for="join-name">Your name</label><input id="join-name" class="text" maxlength="14" value="${esc(settings.get().name === 'You' ? '' : settings.get().name)}" placeholder="Your name" required></div>
    <div class="sheet-actions"><button class="btn primary big" value="go">Take a seat</button></div>
  </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => {
    const name = (dlg.querySelector<HTMLInputElement>('#join-name')!.value || '').trim();
    if (dlg.returnValue === 'go' && name) {
      settings.set({ name });
      onJoin(name);
    } else onCancel();
    dlg.remove();
  });
  dlg.showModal();
}
