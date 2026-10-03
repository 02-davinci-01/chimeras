// The binder (SPEC 9): header, kingdom chips, sort, pack shelf, the card grid, the enlarged card and the reader.
import '../shared/card.css';
import '../shared/card-extra.css';
import '../shared/reader.css';
import './binder.css';
import { cardElement, flipCard } from '../shared/card.ts';
import { loadCatalogue, loadSearch, onRebuild, reducedMotion, reviewText, store } from '../shared/data.ts';
import { Reader } from '../shared/reader.ts';
import { parseQuery, sorted, SORTS } from '../shared/search.ts';
import type { AlbumOut, Catalogue } from '../shared/types.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $('grid'), shelf = $('shelf'), chips = $('chips'), stage = $('stage'), holder = $('holder');
const qInput = $<HTMLInputElement>('q'), sortSel = $<HTMLSelectElement>('sort'), hideBox = $<HTMLInputElement>('hide');

let cat: Catalogue;
const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? '',
  kingdoms: new Set<string>(),
  sort: store.get('binder.sort', 'no'),
  hide: store.get('binder.hide', false),
};
let order: AlbumOut[] = [];                       // current sort, all cards
let matches = new Set<string>();                  // ids matching search + chips
const slots = new Map<string, HTMLElement>();     // id → grid slot
const SEEN = 'binder.seen';                       // ids whose reveal has played
const seen = new Set<string>(store.get<string[]>(SEEN, []));
const card = (a: AlbumOut, face: 'front' | 'back' = 'front') => cardElement(a, { cat }, face);
/** An opened album that came out of a pack and hasn't had its reveal yet shows sealed until it is opened here. */
const awaitingReveal = (a: AlbumOut) => a.state === 'open' && !!a.pack && !seen.has(a.id);
const asSealed = (a: AlbumOut): AlbumOut => ({ ...a, state: 'sealed' });

const reader = new Reader({
  cat: () => cat,
  openAlbum: id => { const a = byId(id); if (!a) return; if (stageAlbum) showInStage(a, 0); else openStage(a); reader.open(a); },
  onClose: () => stage.classList.remove('reading'),
});
const byId = (id: string) => cat.albums.find(a => a.id === id);

/* ───────────── rendering ───────────── */

function renderHeader() {
  const sealed = cat.albums.filter(a => a.state === 'sealed').length;
  $('count').textContent = `${cat.albums.length} album${cat.albums.length === 1 ? '' : 's'}${sealed ? `, ${sealed} sealed` : ''}`;
  chips.innerHTML = '';
  for (const k of cat.kingdoms) {
    const n = cat.albums.filter(a => a.kingdom === k.key).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.style.setProperty('--k', k.colour);
    b.setAttribute('aria-pressed', String(state.kingdoms.has(k.key)));
    b.innerHTML = `${k.name} <span class="n">${n}</span>`;
    b.onclick = () => { state.kingdoms.has(k.key) ? state.kingdoms.delete(k.key) : state.kingdoms.add(k.key); renderHeader(); applyFilter(); };
    chips.append(b);
  }
  chips.classList.toggle('filtering', state.kingdoms.size > 0);
}

function renderGrid(entering = false) {
  order = sorted(cat.albums, state.sort, cat);
  const big = order.length > 400;
  const keep = new Set(order.map(a => a.id));
  for (const [id, s] of slots) if (!keep.has(id)) { s.remove(); slots.delete(id); }
  order.forEach((a, i) => {
    let slot = slots.get(a.id);
    const fresh = awaitingReveal(a) ? asSealed(a) : a;
    const el = card(fresh);
    el.tabIndex = -1;
    el.classList.toggle('to-reveal', fresh !== a);
    if (!slot) { slot = document.createElement('div'); slot.className = 'slot'; slots.set(a.id, slot); }
    slot.replaceChildren(el);
    slot.dataset.id = a.id;
    slot.style.setProperty('--i', String(Math.min(i, 24)));
    slot.classList.toggle('big-grid', big);
    grid.append(slot);                             // append in order (moves existing nodes)
  });
  if (entering && !reducedMotion()) { grid.classList.add('entering'); setTimeout(() => grid.classList.remove('entering'), 1600); }
  applyFilter();
  setRoving(rovingId && slots.has(rovingId) ? rovingId : order[0]?.id);
}

function applyFilter() {
  const query = parseQuery(state.q, cat, reviewText);
  matches = new Set(cat.albums.filter(a => (state.kingdoms.size === 0 || state.kingdoms.has(a.kingdom)) && query.test(a)).map(a => a.id));
  for (const [id, slot] of slots) slot.classList.toggle('dim', !matches.has(id));
  grid.classList.toggle('hide-dim', state.hide);
  const none = matches.size === 0 && cat.albums.length > 0;
  $('empty').hidden = !none;
  $('empty-q').textContent = state.q ? `“${state.q}”` : 'these filters';
  const world = $<HTMLAnchorElement>('world');
  world.href = state.q ? `/world?q=${encodeURIComponent(state.q)}` : '/world';
  const url = new URL(location.href);
  if (state.q) url.searchParams.set('q', state.q); else url.searchParams.delete('q');
  history.replaceState(null, '', url);
}

/* Pack shelf: this week's pack fanned; older packs with sealed cards left in one "Still sealed" stack. */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function renderShelf() {
  const sealedIn = (week: string) => cat.albums.filter(a => a.pack === week && a.state === 'sealed');
  const week = isoWeek();
  const current = cat.packs.find(p => p.week === week);
  const currentCards = current ? sealedIn(current.week) : [];
  const older = cat.packs.filter(p => p.week < week).flatMap(p => sealedIn(p.week));
  shelf.replaceChildren();
  shelf.hidden = !currentCards.length && !older.length;
  if (currentCards.length) shelf.append(pileElement(currentCards, 'fan', `<b>Week ${Number(week.slice(-2))} pack</b> ${currentCards.length} sealed${current?.note ? ` · ${current.note}` : ''}`));
  if (older.length) shelf.append(pileElement(older, 'stack', `<b>Still sealed</b> from older packs`));
}

function pileElement(cards: AlbumOut[], kind: 'fan' | 'stack', label: string) {
  const wrap = document.createElement('div');
  wrap.className = 'pack';
  wrap.innerHTML = `<p class="pack-label">${label}</p>`;
  const pile = document.createElement('div');
  pile.className = kind;
  const els = cards.map(a => { const el = card(a); el.tabIndex = 0; el.dataset.id = a.id; pile.append(el); return el; });
  if (kind === 'stack') { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = String(cards.length); pile.append(badge); }
  const ANGLES = [-6, 0, 6, 12];
  const layout = (mode: 'rest' | 'spread' | 'laid') => {
    const n = els.length;
    pile.style.width = mode === 'laid' ? `${n * 280 + (n - 1) * 24}px` : `${280 + (kind === 'fan' ? 90 : 12)}px`;
    els.forEach((el, i) => {
      el.style.zIndex = String(i + 1);
      if (mode === 'laid') el.style.transform = `translateX(${i * 304}px)`;
      else if (kind === 'stack') el.style.transform = `translate(${i * (mode === 'spread' ? 6 : 3)}px, ${i * (mode === 'spread' ? -4 : -2)}px) rotate(${(i % 2 ? 1 : -1) * (mode === 'spread' ? 2 : 1)}deg)`;
      else el.style.transform = `translateX(${i * (mode === 'spread' ? 46 : 22)}px) rotate(${ANGLES[i % 4] * (mode === 'spread' ? 1.25 : 1)}deg)`;
    });
  };
  let laid = false;
  layout('rest');
  pile.addEventListener('pointerenter', () => !laid && layout('spread'));
  pile.addEventListener('pointerleave', () => !laid && layout('rest'));
  pile.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (laid && el) return openStage(byId(el.dataset.id!)!, el);
    laid = !laid;
    pile.classList.toggle('laid', laid);
    layout(laid ? 'laid' : 'rest');
  });
  pile.addEventListener('keydown', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (e.key === 'Enter' && el) { e.preventDefault(); if (!laid) { laid = true; pile.classList.add('laid'); layout('laid'); } else openStage(byId(el.dataset.id!)!, el); }
  });
  wrap.append(pile);
  return wrap;
}

/* ───────────── grid focus (arrow keys, roving tabindex) ───────────── */

let rovingId: string | undefined;
function setRoving(id: string | undefined, focus = false) {
  if (!id) return;
  slots.get(rovingId ?? '')?.firstElementChild?.setAttribute('tabindex', '-1');
  rovingId = id;
  const el = slots.get(id)?.firstElementChild as HTMLElement | null;
  if (!el) return;
  el.tabIndex = 0;
  if (focus) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
}
const visibleOrder = () => order.filter(a => !(state.hide && !matches.has(a.id)));
grid.addEventListener('keydown', e => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('.slot')?.dataset.id;
  if (!id) return;
  const list = visibleOrder(), i = list.findIndex(a => a.id === id);
  const els = list.map(a => slots.get(a.id)!);
  const top = els[0]?.offsetTop ?? 0, cols = Math.max(1, els.filter(s => s.offsetTop === top).length);
  const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: list.length - 1 - i };
  if (e.key in step) { e.preventDefault(); const j = Math.max(0, Math.min(list.length - 1, i + step[e.key])); setRoving(list[j].id, true); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStage(byId(id)!, slots.get(id)!.firstElementChild as HTMLElement); }
});
grid.addEventListener('click', e => {
  const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
  if (!slot) return;
  const a = byId(slot.dataset.id!)!;
  setRoving(a.id);
  if ((e.target as HTMLElement).closest('[data-action=read]') && a.state !== 'sealed' && !awaitingReveal(a)) { reader.open(a); return; }
  openStage(a, slot.firstElementChild as HTMLElement);
});

/* ───────────── enlarged card ───────────── */

let stageAlbum: AlbumOut | null = null;
let tiltEl: HTMLElement | null = null;
let flipper: HTMLElement | null = null;
let busy = false;
const scale = () => innerHeight >= 784 + 96 && innerWidth >= 600 ? 2 : innerHeight >= 588 + 72 && innerWidth >= 460 ? 1.5 : 1;

function buildStageCard(a: AlbumOut, reveal: boolean) {
  const tilt = document.createElement('div');
  tilt.className = 'tilt';
  let f: HTMLElement;
  if (reveal) {
    // Sealed face in front, the real front behind it; the flip is the reveal.
    f = document.createElement('div');
    f.className = 'flipper';
    const s = card(asSealed(a)); s.classList.add('face', 'face-front');
    const r = card(a); r.classList.add('face', 'face-back');
    f.append(s, r);
  } else f = flipCard(a, { cat });
  tilt.append(f);
  holder.replaceChildren(tilt);
  tiltEl = tilt; flipper = f;
  stage.style.setProperty('--k', cat.kingdoms.find(k => k.key === a.kingdom)!.colour);
  stage.className = `stage${stage.classList.contains('shown') ? ' shown' : ''}${a.rarity ? ` rarity-${a.rarity}` : ''}${reader.isOpen ? ' reading' : ''}`;
  holder.classList.add('enlarged');
}

function playReveal(a: AlbumOut) {
  seen.add(a.id); store.set(SEEN, [...seen]);
  const done = () => {
    if (stageAlbum?.id !== a.id) return;
    buildStageCard(a, false);
    holder.style.transform = `scale(${scale()})`;
    const front = flipper!.querySelector<HTMLElement>('.face-front')!;
    if (!reducedMotion()) { front.classList.add('writing'); setTimeout(() => front.classList.remove('writing'), 700); }
  };
  if (reducedMotion()) return done();
  setTimeout(() => { flipper?.classList.add('flipped'); setTimeout(done, 620); }, 380);
  renderGrid();                                    // the grid slot opens too
}

function openStage(a: AlbumOut, from?: HTMLElement) {
  if (busy) return;
  const reveal = awaitingReveal(a);
  stageAlbum = a;
  buildStageCard(a, reveal);
  stage.hidden = false;
  document.body.style.overflow = 'hidden';
  const S = scale();
  const src = from?.getBoundingClientRect();
  if (src && !reducedMotion()) {
    const dx = src.left + src.width / 2 - innerWidth / 2, dy = src.top + src.height / 2 - innerHeight / 2;
    const fromSlot = from!.closest('.slot');
    fromSlot?.classList.add('away');
    busy = true;
    const anim = holder.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1)` }, { transform: `scale(${S})` }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => { busy = false; if (reveal) playReveal(a); };
  } else if (reveal) playReveal(a);
  holder.style.transform = `scale(${S})`;
  requestAnimationFrame(() => stage.classList.add('shown'));
  stage.focus?.();
}

function closeStage() {
  if (!stageAlbum || busy) return;
  reader.close();
  const a = stageAlbum;
  stageAlbum = null;
  stage.classList.remove('shown');
  const slot = slots.get(a.id);
  const r = slot?.getBoundingClientRect();
  const onScreen = r && r.bottom > 0 && r.top < innerHeight && !slot!.classList.contains('dim');
  const finish = () => {
    stage.hidden = true; holder.replaceChildren(); holder.style.transform = '';
    document.body.style.overflow = '';
    slots.forEach(s => s.classList.remove('away'));
    busy = false;
    setRoving(a.id, true);
  };
  if (onScreen && !reducedMotion()) {
    busy = true;
    tiltEl?.style.setProperty('transform', 'none');
    flipper?.classList.remove('flipped');
    const dx = r!.left + r!.width / 2 - innerWidth / 2, dy = r!.top + r!.height / 2 - innerHeight / 2;
    holder.animate([{ transform: getComputedStyle(holder).transform }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], { duration: 440, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).onfinish = finish;
  } else if (!reducedMotion()) {
    busy = true;
    holder.animate([{ opacity: 1 }, { opacity: 0, transform: `${getComputedStyle(holder).transform} translateY(12px)` }], { duration: 260, easing: 'ease-in', fill: 'forwards' }).onfinish = finish;
  } else finish();
}

/** ←/→: next card in the current order (matching cards when a search is active). */
function step(dir: 1 | -1) {
  if (!stageAlbum || busy) return;
  const list = (state.q || state.kingdoms.size) ? order.filter(a => matches.has(a.id)) : order;
  const i = list.findIndex(a => a.id === stageAlbum!.id);
  const next = list[(i + dir + list.length) % list.length];
  if (!next || next.id === stageAlbum.id) return;
  showInStage(next, dir);
}

function showInStage(a: AlbumOut, dir: 1 | -1 | 0) {
  slots.forEach(s => s.classList.remove('away'));
  slots.get(a.id)?.classList.add('away');
  const S = scale();
  const swap = () => {
    stageAlbum = a;
    const reveal = awaitingReveal(a);
    buildStageCard(a, reveal);
    if (reader.isOpen && a.state !== 'sealed' && !reveal) reader.open(a);
    if (reveal) playReveal(a);
  };
  if (reducedMotion() || dir === 0) { swap(); holder.style.transform = `scale(${S})`; return; }
  busy = true;
  holder.animate([{ transform: `scale(${S})`, opacity: 1 }, { transform: `translateX(${-dir * 60}px) scale(${S * 0.97})`, opacity: 0 }], { duration: 170, easing: 'ease-in' }).onfinish = () => {
    swap();
    holder.animate([{ transform: `translateX(${dir * 60}px) scale(${S * 0.97})`, opacity: 0 }, { transform: `scale(${S})`, opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => { busy = false; };
    holder.style.transform = `scale(${S})`;
  };
}

function flip() {
  if (!flipper || !stageAlbum || stageAlbum.state === 'sealed' || busy || awaitingReveal(stageAlbum)) return;
  flipper.classList.toggle('flipped');
  const back = flipper.querySelector('.face-back'), front = flipper.querySelector('.face-front');
  const flipped = flipper.classList.contains('flipped');
  back?.setAttribute('aria-hidden', String(!flipped));
  front?.setAttribute('aria-hidden', String(flipped));
}

holder.addEventListener('click', e => {
  if ((e.target as HTMLElement).closest('[data-action=read]')) { if (stageAlbum && stageAlbum.state !== 'sealed') { stage.classList.add('reading'); reader.open(stageAlbum); } return; }
  flip();
});
stage.addEventListener('click', e => { if ((e.target as HTMLElement).hasAttribute('data-close')) { if (reader.isOpen) reader.close(); else closeStage(); } });

// Tilt toward the pointer, up to ±8°, eased.
let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
stage.addEventListener('pointermove', e => {
  if (reducedMotion() || e.pointerType === 'touch') return;
  const r = holder.getBoundingClientRect();
  const nx = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), ny = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2);
  tx = Math.max(-1, Math.min(1, nx)) * 8; ty = Math.max(-1, Math.min(1, ny)) * -8;
  if (!raf) raf = requestAnimationFrame(tick);
});
stage.addEventListener('pointerleave', () => { tx = ty = 0; if (!raf) raf = requestAnimationFrame(tick); });
function tick() {
  cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
  if (tiltEl) tiltEl.style.transform = `rotateY(${cx.toFixed(2)}deg) rotateX(${cy.toFixed(2)}deg)`;
  raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.02 ? requestAnimationFrame(tick) : 0;
}

/* ───────────── keys ───────────── */

document.addEventListener('keydown', e => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); qInput.focus(); qInput.select(); return; }
  if (e.key === 'Escape') {
    if (e.target === qInput) { if (qInput.value) { qInput.value = ''; onQuery(); } else qInput.blur(); return; }
    if (reader.isOpen) { reader.close(); return; }
    if (stageAlbum) { closeStage(); return; }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'r') {
    const a = stageAlbum ?? (rovingId && document.activeElement?.closest('.slot') ? byId(rovingId) : undefined);
    if (a && a.state !== 'sealed' && !awaitingReveal(a)) { if (stageAlbum) stage.classList.add('reading'); reader.open(a); }
    return;
  }
  if (!stageAlbum) return;
  if (k === 'f') { e.preventDefault(); flip(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});

/* ───────────── controls ───────────── */

let qTimer = 0;
function onQuery() {
  state.q = qInput.value;
  // Plain words also search full reviews; fetch them on first use, then filter again.
  if (/(^|\s)[^:<>=\s]+(\s|$)/.test(state.q)) loadSearch().then(applyFilter);
  applyFilter();
}
qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = window.setTimeout(onQuery, 40); });
sortSel.innerHTML = SORTS.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
sortSel.addEventListener('change', () => { state.sort = sortSel.value; store.set('binder.sort', state.sort); flipGrid(() => renderGrid()); });
hideBox.addEventListener('change', () => { state.hide = hideBox.checked; store.set('binder.hide', state.hide); flipGrid(applyFilter); });

/** Animate grid reflow (FLIP) when sort or hiding changes the layout. */
function flipGrid(change: () => void) {
  if (reducedMotion()) return change();
  const before = new Map([...slots].map(([id, s]) => [id, s.getBoundingClientRect()]));
  change();
  for (const [id, s] of slots) {
    const a = before.get(id), b = s.getBoundingClientRect();
    if (!a || !b.width || (a.left === b.left && a.top === b.top)) continue;
    s.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

/* ───────────── boot ───────────── */

async function boot() {
  cat = await loadCatalogue();
  qInput.value = state.q;
  sortSel.value = SORTS.some(s => s.key === state.sort) ? state.sort : 'no';
  hideBox.checked = state.hide;
  if (state.q) await loadSearch();
  renderHeader();
  renderShelf();
  renderGrid(true);
  // Deep link: #<id> opens that card.
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && byId(hash)) openStage(byId(hash)!, slots.get(hash)?.firstElementChild as HTMLElement);
  if (cat.warnings.length) console.info(`catalogue: ${cat.warnings.length} build warnings`, cat.warnings);
}

onRebuild(async () => {
  cat = await loadCatalogue();
  renderHeader();
  renderShelf();
  renderGrid();
  if (stageAlbum) { const a = byId(stageAlbum.id); if (a) { stageAlbum = a; buildStageCard(a, false); } else closeStage(); }
  if (reader.isOpen && reader.current) { const a = byId(reader.current.id); if (a) reader.open(a); }
});

boot().catch(err => {
  grid.innerHTML = `<p class="no-match">${String(err.message ?? err)}</p>`;
});

// Keep the enlarged scale right when the window changes size.
addEventListener('resize', () => { if (stageAlbum && !busy) holder.style.transform = `scale(${scale()})`; });
