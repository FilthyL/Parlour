/** Deck & table settings: editions, a fresh print run, felt, cardistry, pace, sound. */
import { randomSeed } from '../core/rng';
import { EDITIONS } from '../render/press/editions';
import { currentDeck, onDeck } from '../render/press';
import { settings, type Settings } from '../settings';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function openSettings(reprint: () => void) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet settings';
  const felts: [Settings['felt'], string][] = [['emerald', 'Emerald'], ['sapphire', 'Sapphire'], ['bordeaux', 'Bordeaux'], ['onyx', 'Onyx']];
  const render = () => {
    const s = settings.get();
    const d = currentDeck();
    dlg.innerHTML = `<form method="dialog" class="sheet-body">
      <button class="icon-btn close" value="cancel" aria-label="Close">${icon('close')}</button>
      <h2>Deck and table</h2>
      <fieldset class="editions"><legend>Deck design</legend>
        ${EDITIONS.map((e) => `<label class="edition ${s.edition === e.id ? 'on' : ''}"><input type="radio" name="edition" value="${e.id}" ${s.edition === e.id ? 'checked' : ''}><b>${esc(e.name)}</b><span>${esc(e.blurb)}</span></label>`).join('')}
      </fieldset>
      <div class="deck-preview">${d ? ['back', 'AS', 'KH', 'QC', 'JD', '10S'].map((c) => `<img alt="" src="${c === 'back' ? d.back : d.face[c] ?? ''}">`).join('') : ''}</div>
      <div class="row"><span class="row-label">Deck no. ${s.deckSeed}</span><button type="button" class="btn ghost" data-k="reprint">${icon('print')} Print a new deck</button></div>
      <div class="row"><span class="row-label">Felt</span><div class="swatches">${felts.map(([id, n]) => `<label class="swatch sw-${id} ${s.felt === id ? 'on' : ''}" title="${n}"><input type="radio" name="felt" value="${id}" ${s.felt === id ? 'checked' : ''} aria-label="${n}"></label>`).join('')}</div></div>
      <div class="row"><span class="row-label">Dealer's cardistry</span><div class="seg">${[[0, 'Off'], [1, 'One'], [2, 'Two'], [3, 'Three']].map(([v, l]) => `<label class="${s.cardistry === v ? 'on' : ''}"><input type="radio" name="cardistry" value="${v}" ${s.cardistry === v ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <div class="row"><span class="row-label">Pace</span><div class="seg">${(['relaxed', 'normal', 'fast'] as const).map((v) => `<label class="${s.pace === v ? 'on' : ''}"><input type="radio" name="pace" value="${v}" ${s.pace === v ? 'checked' : ''}>${v[0].toUpperCase() + v.slice(1)}</label>`).join('')}</div></div>
      <div class="row"><label class="row-label" for="vol">Volume</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}" name="volume"></div>
    </form>`;
  };
  render();
  const off = onDeck(() => render());
  document.body.appendChild(dlg);
  dlg.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'edition') { settings.set({ edition: t.value }); reprint(); }
    if (t.name === 'felt') settings.set({ felt: t.value as Settings['felt'] });
    if (t.name === 'cardistry') settings.set({ cardistry: Number(t.value) as Settings['cardistry'] });
    if (t.name === 'pace') settings.set({ pace: t.value as Settings['pace'] });
    if (t.name === 'volume') settings.set({ volume: Number(t.value) });
    render();
  });
  dlg.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
    if (k === 'reprint') {
      settings.set({ deckSeed: randomSeed() % 100000 });
      reprint();
      render();
    }
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => { off(); dlg.remove(); });
  dlg.showModal();
}
