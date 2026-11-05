import { printDeck } from '../render/press';
import { editionById } from '../render/press/editions';
const params = new URLSearchParams(location.search);
const ed = params.get('ed') ?? 'heritage';
const seed = Number(params.get('seed') ?? 7);
const codes = (params.get('codes') ?? 'back,KH,QS,JD,AS,10C,7H').split(',');
const t0 = performance.now();
document.body.style.setProperty('--w', (params.get('w') ?? '150') + 'px');
if (params.get('nolabel')) document.body.classList.add('nolabel');
const label = document.createElement('div');
label.className = 'label';
const e = editionById(ed);
label.innerHTML = `<b>${e.name}</b><span>${e.blurb}</span>`;
document.body.appendChild(label);
printDeck(ed, seed).then(async (d) => {
  (window as any).__pressMs = performance.now() - t0;
  const loads: Promise<void>[] = [];
  for (const c of codes) {
    const img = document.createElement('img');
    img.src = c === 'back' ? d.back : d.face[c];
    loads.push(img.decode().catch(() => {}));
    document.body.appendChild(img);
  }
  await Promise.all(loads);
  (window as any).__done = true;
});
