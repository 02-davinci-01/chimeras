// One floating annotation for every [data-tip] element: a title line and an optional note, drawn like a callout.
const el = document.createElement('div');
el.className = 'tip';
el.setAttribute('role', 'tooltip');
el.innerHTML = '<span class="tip-title"></span><span class="tip-body"></span>';
let target: HTMLElement | null = null;
let timer = 0;

function place(t: HTMLElement) {
  const r = t.getBoundingClientRect();
  el.querySelector('.tip-title')!.textContent = t.dataset.tip ?? '';
  el.querySelector('.tip-body')!.textContent = t.dataset.tipBody ?? '';
  el.classList.toggle('has-body', !!t.dataset.tipBody);
  el.style.left = '0px'; el.style.top = '0px';
  const w = el.offsetWidth, h = el.offsetHeight;
  const below = r.top - h - 12 < 8;
  const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const y = below ? r.bottom + 10 : r.top - h - 10;
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.style.setProperty('--arrow', `${Math.max(10, Math.min(w - 10, r.left + r.width / 2 - x))}px`);
  el.classList.toggle('below', below);
}

export function installTooltips(root: Document | HTMLElement = document) {
  if (!el.isConnected) document.body.append(el);
  root.addEventListener('pointerover', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t === target) return;
    clearTimeout(timer);
    target = t;
    if (!t) { el.classList.remove('on'); return; }
    timer = window.setTimeout(() => { if (target === t) { place(t); el.classList.add('on'); } }, el.classList.contains('on') ? 0 : 160);
  });
  document.documentElement.addEventListener('pointerleave', () => { target = null; clearTimeout(timer); el.classList.remove('on'); });
  addEventListener('scroll', () => { el.classList.remove('on'); target = null; }, { passive: true, capture: true });
  addEventListener('pointerdown', () => { el.classList.remove('on'); target = null; });
}
