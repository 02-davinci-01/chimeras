// The binder (SPEC 9), in the house style: masthead, kingdom spectrum, the sheet (filters, search, packs, grid),
// the plate (enlarged card with its annotations) and the reader.
import '../shared/system.css';
import '../shared/card.css';
import '../shared/card-extra.css';
import '../shared/reader.css';
import '../shared/warp.css';
import './binder.css';
import { cardElement, flipCard, penDate } from '../shared/card.ts';
import { loadCatalogue, loadSearch, onRebuild, reducedMotion, reviewText, store } from '../shared/data.ts';
import { Reader } from '../shared/reader.ts';
import { parseQuery, sorted, SORTS } from '../shared/search.ts';
import { installTooltips } from '../shared/tooltip.ts';
import type { AlbumOut, Catalogue } from '../shared/types.ts';
import { STAT_KEYS } from '../shared/types.ts';
import { arrive, cameThrough, loader, warpLinks } from '../shared/warp.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $('grid'), shelf = $('shelf'), seg = $('kingdoms'), plate = $('stage'), holder = $('holder'), info = $('plate-info');
const qInput = $<HTMLInputElement>('q'), sortSel = $<HTMLSelectElement>('sort'), hideBox = $<HTMLInputElement>('hide');
const EASE = 'cubic-bezier(.16,1,.3,1)';

let cat: Catalogue;
const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? '',
  kingdom: params.get('k') ?? 'all',
  sort: store.get('binder.sort', 'no'),
  hide: store.get('binder.hide', false),
};
let order: AlbumOut[] = [];                       // current sort, all cards
let matches = new Set<string>();                  // ids matching the search
const slots = new Map<string, HTMLElement>();     // id → grid slot
const SEEN = 'binder.seen';                       // ids whose reveal has played
const seen = new Set<string>(store.get<string[]>(SEEN, []));
const card = (a: AlbumOut, face: 'front' | 'back' = 'front') => cardElement(a, { cat }, face);
const byId = (id: string) => cat.albums.find(a => a.id === id);
const kingdomOf = (a: AlbumOut) => cat.kingdoms.find(k => k.key === a.kingdom)!;
/** An opened album that came out of a pack and hasn't had its reveal yet shows sealed until it is opened here. */
const awaitingReveal = (a: AlbumOut) => a.state === 'open' && !!a.pack && !seen.has(a.id);
const asSealed = (a: AlbumOut): AlbumOut => ({ ...a, state: 'sealed' });
const inKingdom = (a: AlbumOut) => state.kingdom === 'all' || a.kingdom === state.kingdom;
const shown = (a: AlbumOut) => inKingdom(a) && (!state.hide || matches.has(a.id));
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const reader = new Reader({
  cat: () => cat,
  openAlbum: id => { const a = byId(id); if (!a) return; if (plateAlbum) showInPlate(a, 0); else openPlate(a); setReading(true); reader.open(a); },
  onClose: () => setReading(false),
});

/* ───────────── masthead ───────────── */

function roman(n: number): string {
  if (n <= 0) return '0';
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}

function renderMasthead() {
  const sealed = cat.albums.filter(a => a.state === 'sealed').length;
  const heard = cat.albums.filter(a => a.state !== 'sealed' && a.first).sort((a, b) => b.first!.localeCompare(a.first!));
  const latest = heard[0];
  $('roman').textContent = `${roman(cat.albums.length)} / ${roman(cat.kingdoms.length)}`;
  $('rail-count').textContent = `${String(cat.albums.length).padStart(3, '0')} albums`;
  const when = new Date(cat.generated);
  $('meta').innerHTML = [
    ['albums', `${cat.albums.length}`],
    ['sealed', sealed ? `${sealed}, waiting` : 'none'],
    ['kingdoms', cat.kingdoms.map(k => k.name.toLowerCase()).join(' · ')],
    ['latest', latest ? `<a href="#${latest.id}" data-open="${latest.id}">${esc(latest.title)}</a> — ${esc(latest.artist)}, ${penDate(latest.first)}` : '—'],
    ['updated', `${when.toDateString().slice(4).toLowerCase()} <span style="color:var(--faint)">· ${when.toTimeString().slice(0, 5)}</span>`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const hand = $('hand');
  const three = heard.slice(0, 3).reverse();
  hand.style.setProperty('--glow', three.length ? kingdomOf(three[three.length - 1]).colour : '#999');
  hand.innerHTML = '<div class="orbit"></div><span class="orbit-label">latest pressings</span>';
  const h = document.createElement('div');
  h.className = 'hand';
  for (const a of three) { const c = card(a); c.dataset.open = a.id; h.append(c); }
  hand.append(h);
  if (latest) hand.insertAdjacentHTML('beforeend', `<p class="hand-caption">last heard · ${penDate(latest.first)}</p>`);

  const bar = $('spectrum-bar'), legend = $('spectrum-legend');
  bar.innerHTML = ''; legend.innerHTML = '';
  for (const k of cat.kingdoms) {
    const n = cat.albums.filter(a => a.kingdom === k.key).length;
    const pct = Math.round(n / Math.max(1, cat.albums.length) * 100);
    const s = document.createElement('span');
    s.style.setProperty('--k', k.colour); s.style.setProperty('--n', String(Math.max(n, 0.0001)));
    s.dataset.tip = `${k.name} · ${n}`; s.dataset.tipBody = `${pct}% of the catalogue. Click to show only ${k.name.toLowerCase()}.`;
    s.dataset.kingdom = k.key; s.style.cursor = 'pointer';
    s.onclick = () => setKingdom(state.kingdom === k.key ? 'all' : k.key);
    bar.append(s);
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.kingdom = k.key;
    b.style.setProperty('--k', k.colour);
    b.innerHTML = `${k.name} <i>${String(n).padStart(2, '0')} · ${pct}%</i>`;
    b.onclick = () => setKingdom(state.kingdom === k.key ? 'all' : k.key);
    legend.append(b);
  }
}

/* ───────────── sheet: controls ───────────── */

function renderSeg() {
  const opts = [{ key: 'all', name: 'All', colour: '', n: cat.albums.length }, ...cat.kingdoms.map(k => ({ key: k.key, name: k.name, colour: k.colour, n: cat.albums.filter(a => a.kingdom === k.key).length }))];
  seg.innerHTML = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.kingdom = o.key;
    if (o.colour) b.style.setProperty('--k', o.colour);
    b.innerHTML = `${o.colour ? '<span class="sw"></span>' : ''}${o.name}<span class="n">${String(o.n).padStart(2, '0')}</span>`;
    b.onclick = () => setKingdom(o.key);
    seg.append(b);
  }
  syncKingdomUI();
}

function syncKingdomUI() {
  seg.querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kingdom === state.kingdom)));
  $('spectrum-bar').querySelectorAll<HTMLElement>('span').forEach(s => s.classList.toggle('off', state.kingdom !== 'all' && s.dataset.kingdom !== state.kingdom));
  $('spectrum-legend').querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kingdom === state.kingdom)));
}

function setKingdom(k: string) {
  if (k === state.kingdom) return;
  state.kingdom = k;
  syncKingdomUI();
  relayout(applyFilter);
  if (k !== 'all' && grid.getBoundingClientRect().top > innerHeight * 0.7) seg.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/* ───────────── sheet: grid ───────────── */

function renderGrid() {
  order = sorted(cat.albums, state.sort, cat);
  const big = order.length > 400;
  const keep = new Set(order.map(a => a.id));
  for (const [id, s] of slots) if (!keep.has(id)) { s.remove(); slots.delete(id); }
  order.forEach(a => {
    let slot = slots.get(a.id);
    const pending = awaitingReveal(a);
    const el = card(pending ? asSealed(a) : a);
    el.tabIndex = -1;
    if (!slot) { slot = document.createElement('div'); slot.className = 'slot'; slots.set(a.id, slot); reveal.observe(slot); }
    const cap = a.state === 'sealed' || pending
      ? `<span>№ ${a.no}</span><b>sealed · wk ${a.pack ? Number(a.pack.slice(-2)) : '—'}</b>`
      : `<span>№ ${a.no} / ${a.year}</span><b>${a.first ? `heard ${penDate(a.first)}` : a.rating != null ? 'heard' : 'unheard'}</b>`;
    slot.replaceChildren(el);
    slot.insertAdjacentHTML('beforeend', `<div class="caption">${cap}</div>`);
    slot.dataset.id = a.id;
    slot.classList.toggle('to-reveal', pending);
    slot.classList.toggle('big-grid', big);
    grid.append(slot);                               // in sort order (moves existing nodes)
  });
  applyFilter();
  setRoving(rovingId && slots.has(rovingId) ? rovingId : order[0]?.id);
}

function applyFilter() {
  const query = parseQuery(state.q, cat, reviewText);
  matches = new Set(cat.albums.filter(a => query.test(a)).map(a => a.id));
  let showing = 0;
  for (const a of order) {
    const slot = slots.get(a.id)!;
    const vis = shown(a);
    slot.classList.toggle('gone', !vis);
    slot.classList.toggle('dim', vis && !query.empty && !matches.has(a.id));
    if (vis) showing++;
  }
  const hits = order.filter(a => inKingdom(a) && matches.has(a.id)).length;
  const count = $('search-count');
  count.textContent = query.empty ? '' : `${hits} match${hits === 1 ? '' : 'es'}`;
  count.classList.toggle('on', !query.empty);
  $('empty').hidden = showing > 0 && (query.empty || hits > 0);
  $('empty-q').textContent = state.q ? `“${state.q}”` : 'this filter';
  const kName = state.kingdom === 'all' ? 'all kingdoms' : cat.kingdoms.find(k => k.key === state.kingdom)?.name.toLowerCase();
  $('tb-showing').textContent = `${kName} · ${showing} card${showing === 1 ? '' : 's'}`;
  $('tb-sort').textContent = (SORTS.find(s => s.key === state.sort) ?? SORTS[0]).label.toLowerCase();
  $('tc-note').innerHTML = `${showing} of ${cat.albums.length} on the sheet<br>${query.empty ? 'no search' : `searching “${esc(state.q)}”`}`;
  // Share the view with the world.
  const q = [state.kingdom !== 'all' ? `k:${state.kingdom}` : '', state.q].filter(Boolean).join(' ');
  for (const id of ['world', 'dock-world']) $<HTMLAnchorElement>(id).href = q ? `/world?q=${encodeURIComponent(q)}` : '/world';
  const url = new URL(location.href);
  state.q ? url.searchParams.set('q', state.q) : url.searchParams.delete('q');
  state.kingdom !== 'all' ? url.searchParams.set('k', state.kingdom) : url.searchParams.delete('k');
  history.replaceState(null, '', url);
}

/** Animate a change to which cards are on the sheet: leavers fade out where they stood, the rest glide to
 *  their new places, newcomers ink in. */
function relayout(change: () => void) {
  if (reducedMotion()) return change();
  grid.querySelectorAll('.ghost').forEach(g => g.remove());
  const gr = grid.getBoundingClientRect();
  const before = new Map<string, DOMRect>();
  for (const [id, s] of slots) if (!s.classList.contains('gone')) before.set(id, s.getBoundingClientRect());
  for (const s of slots.values()) s.getAnimations().forEach(a => a.cancel());
  change();
  let enter = 0, move = 0;
  for (const [id, s] of slots) {
    const was = before.get(id), now = !s.classList.contains('gone');
    if (was && !now) {
      const ghost = s.cloneNode(true) as HTMLElement;
      ghost.classList.remove('gone', 'ink', 'away'); ghost.classList.add('ghost');
      ghost.style.left = `${was.left - gr.left}px`; ghost.style.top = `${was.top - gr.top}px`;
      grid.append(ghost);
      ghost.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(.92) translateY(12px)', filter: 'blur(6px)' }],
        { duration: 380, easing: EASE, fill: 'forwards' }).onfinish = () => ghost.remove();
    } else if (was && now) {
      const r = s.getBoundingClientRect();
      const dx = was.left - r.left, dy = was.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) s.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 700, delay: Math.min(move++, 12) * 22, easing: EASE, fill: 'backwards' });
    } else if (!was && now) {
      s.classList.add('in');
      s.animate([{ opacity: 0, transform: 'scale(.94) translateY(16px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 620, delay: 200 + Math.min(enter++, 16) * 60, easing: EASE, fill: 'backwards' });
    }
  }
}

// Slots ink in as they scroll into view, a few at a time.
let inkBatch = 0, inkTimer = 0;
const reveal = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const s = e.target as HTMLElement;
    reveal.unobserve(s);
    s.classList.add('ink');
    const delay = (inkBatch++) * 70;
    clearTimeout(inkTimer); inkTimer = window.setTimeout(() => { inkBatch = 0; }, 300);
    setTimeout(() => s.classList.add('in'), reducedMotion() ? 0 : delay + 20);
  }
}, { rootMargin: '0px 0px -40px 0px' });

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
  if (currentCards.length) shelf.append(pileElement(currentCards, 'fan', `<span class="label">this week</span><b>Week ${Number(week.slice(-2))} pack</b><span class="label">${currentCards.length} sealed${current?.note ? ` · ${esc(current.note)}` : ''}</span>`));
  if (older.length) shelf.append(pileElement(older, 'stack', `<span class="label">older packs</span><b>Still sealed</b>`));
}

function pileElement(cards: AlbumOut[], kind: 'fan' | 'stack', label: string) {
  const wrap = document.createElement('div');
  wrap.className = 'pack';
  wrap.innerHTML = `<p class="pack-label">${label}</p>`;
  const pile = document.createElement('div');
  pile.className = kind;
  const els = cards.map(a => { const el = card(a); el.tabIndex = 0; pile.append(el); return el; });
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
  const lay = () => { laid = !laid; pile.classList.toggle('laid', laid); layout(laid ? 'laid' : 'rest'); };
  pile.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (laid && el) return openPlate(byId(el.dataset.id!)!, el);
    lay();
  });
  pile.addEventListener('keydown', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (e.key === 'Enter' && el) { e.preventDefault(); if (!laid) lay(); else openPlate(byId(el.dataset.id!)!, el); }
  });
  wrap.append(pile);
  return wrap;
}

/* ───────────── grid focus (arrow keys, roving tabindex) ───────────── */

let rovingId: string | undefined;
function setRoving(id: string | undefined, focus = false) {
  if (!id) return;
  slots.get(rovingId ?? '')?.querySelector('.card')?.setAttribute('tabindex', '-1');
  rovingId = id;
  const el = slots.get(id)?.querySelector<HTMLElement>('.card');
  if (!el) return;
  el.tabIndex = 0;
  if (focus) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
}
const visibleOrder = () => order.filter(shown);
grid.addEventListener('keydown', e => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('.slot')?.dataset.id;
  if (!id) return;
  const list = visibleOrder(), i = list.findIndex(a => a.id === id);
  const els = list.map(a => slots.get(a.id)!);
  const top = els[0]?.offsetTop ?? 0, cols = Math.max(1, els.filter(s => s.offsetTop === top).length);
  const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: list.length - 1 - i };
  if (e.key in step) { e.preventDefault(); const j = Math.max(0, Math.min(list.length - 1, i + step[e.key])); setRoving(list[j].id, true); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlate(byId(id)!, slots.get(id)!.querySelector('.card') as HTMLElement); }
});
grid.addEventListener('click', e => {
  const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
  if (!slot || slot.classList.contains('ghost') || !(e.target as HTMLElement).closest('.card')) return;
  const a = byId(slot.dataset.id!)!;
  setRoving(a.id);
  const c = slot.querySelector<HTMLElement>('.card')!;
  openPlate(a, c);
  if ((e.target as HTMLElement).closest('[data-action=read]') && a.state !== 'sealed' && !awaitingReveal(a)) setTimeout(openReader, 680);
});
document.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
  if (!t || plateAlbum) return;
  e.preventDefault();
  const a = byId(t.dataset.open!);
  if (a) openPlate(a, t.classList.contains('card') ? t : undefined);
});

/* ───────────── the plate (enlarged card) ───────────── */

let plateAlbum: AlbumOut | null = null;
let tiltEl: HTMLElement | null = null;
let flipper: HTMLElement | null = null;
let busy = false;
let sourceEl: HTMLElement | null = null;
let closeQueued = false;                          // Esc pressed while the card was still flying in
/** Mark the plate idle again, running a close that was asked for meanwhile. */
const settle = () => { busy = false; if (closeQueued) { closeQueued = false; closePlate(); } };
const scale = () => innerHeight >= 784 + 110 && innerWidth >= 700 ? 2 : innerHeight >= 588 + 80 && innerWidth >= 480 ? 1.5 : 1;
/** Where the card's centre sits (px from the left): left of centre to leave room for the notes, or centred. */
function centreX() {
  if (plate.classList.contains('reading') && innerWidth > 1000) return Math.max(150 * scale(), (innerWidth - 600) / 2);
  return innerWidth > 1080 ? innerWidth * 0.38 : innerWidth / 2;
}
function layoutPlate() {
  plate.style.setProperty('--cx', `${centreX()}px`);
  plate.style.setProperty('--s', String(scale()));
}

function setReading(on: boolean) {
  if (!plateAlbum) return;
  const from = holder.getBoundingClientRect();
  plate.classList.toggle('reading', on);
  layoutPlate();
  const to = holder.getBoundingClientRect();
  if (!reducedMotion() && Math.abs(from.left - to.left) > 1) holder.animate([{ translate: `${from.left - to.left}px 0` }, { translate: '0 0' }], { duration: 600, easing: EASE });
}

function infoHTML(a: AlbumOut) {
  const k = kingdomOf(a);
  if (a.state === 'sealed' || awaitingReveal(a)) {
    const pack = cat.packs.find(p => p.week === a.pack);
    return `<div class="pi-label"><span class="sw"></span><span class="label">sealed · ${a.pack ?? ''}</span></div>
      <h2 class="pi-title">Sealed</h2><p class="pi-sealed">${a.state === 'sealed' ? 'Not heard yet. It opens once it has been heard and rated.' : 'Heard. Opening…'}</p>
      <dl class="pi-meta"><dt>pack</dt><dd>${a.pack ?? '—'}${pack?.note ? ` · ${esc(pack.note)}` : ''}</dd><dt>card</dt><dd>${pack ? pack.albums.indexOf(a.id) + 1 : 1} of ${pack?.albums.length ?? 1}</dd><dt>kingdom</dt><dd>${k.name.toLowerCase()}, provisional</dd></dl>
      <div class="pi-keys"><span><kbd>←</kbd><kbd>→</kbd> next</span><span><kbd>esc</kbd> close</span></div>`;
  }
  const tier = cat.rarity.find(t => t.key === a.rarity);
  const sym = tier ? `<svg width="14" height="14" viewBox="-1 -1 26 26" aria-hidden="true"><path d="${tier.symbol}"/></svg>` : '';
  const stats = STAT_KEYS.map((s, j) => {
    const v = a.stats[s] ?? 0;
    return `<div class="pi-stat"><span>${s}</span><span class="pi-bar">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= v ? 'on' : ''}" style="--j:${j * 5 + i}"></i>`).join('')}</span><b>${a.stats[s] ?? '–'}</b></div>`;
  }).join('');
  return `<div class="pi-label"><span class="sw"></span><span class="label">plate № ${a.no} · ${k.name}</span></div>
    <h2 class="pi-title">${esc(a.title)}</h2>
    <p class="pi-artist">${esc(a.artist)}</p>
    <dl class="pi-meta">
      <dt>rating</dt><dd>${a.rating != null ? `${a.rating} / 10` : 'unrated'}</dd>
      <dt>rarity</dt><dd>${sym}${tier ? tier.name : '—'}</dd>
      <dt>released</dt><dd>${a.year}</dd>
      <dt>first heard</dt><dd>${a.first ? penDate(a.first) : '—'}</dd>
      ${a.pack ? `<dt>pack</dt><dd>${a.pack}</dd>` : ''}
    </dl>
    <div class="pi-stats">${stats}</div>
    <button class="pi-read" type="button" data-action="read">read the review <span aria-hidden="true">→</span></button>
    <div class="pi-keys"><span><kbd>F</kbd> flip</span><span><kbd>R</kbd> read</span><span><kbd>←</kbd><kbd>→</kbd> next</span><span><kbd>esc</kbd> close</span></div>`;
}

function buildPlateCard(a: AlbumOut, reveal: boolean) {
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
  holder.classList.add('enlarged');
  tiltEl = tilt; flipper = f;
  plate.style.setProperty('--k', kingdomOf(a).colour);
  plate.classList.remove('rarity-divine', 'rarity-rare');
  if (a.rarity && !reveal) plate.classList.add(`rarity-${a.rarity}`);
  info.innerHTML = infoHTML(a);
}

function playReveal(a: AlbumOut) {
  seen.add(a.id); store.set(SEEN, [...seen]);
  const done = () => {
    if (plateAlbum?.id !== a.id) return;
    buildPlateCard(a, false);
    const front = flipper!.querySelector<HTMLElement>('.face-front')!;
    if (!reducedMotion()) { front.classList.add('writing'); setTimeout(() => front.classList.remove('writing'), 700); }
    renderGrid();
    hideSource(a.id);
  };
  if (reducedMotion()) return done();
  setTimeout(() => { flipper?.classList.add('flipped'); setTimeout(done, 620); }, 420);
}

function hideSource(id: string) { slots.forEach(s => s.classList.toggle('away', s.dataset.id === id)); }

function openPlate(a: AlbumOut, from?: HTMLElement) {
  if (busy || plateAlbum) return;
  holder.getAnimations().forEach(x => x.cancel());
  const reveal = awaitingReveal(a);
  plateAlbum = a;
  sourceEl = from ?? null;
  buildPlateCard(a, reveal);
  plate.hidden = false;
  plate.classList.remove('reading');
  layoutPlate();
  document.documentElement.style.overflow = 'hidden';
  const S = scale();
  holder.style.transform = `scale(${S})`;
  const src = from?.getBoundingClientRect();
  if (src && src.width && !reducedMotion()) {
    const cx = holder.offsetLeft + 140, cy = holder.offsetTop + 196;
    const dx = src.left + src.width / 2 - cx, dy = src.top + src.height / 2 - cy;
    // Cards in the hand are rotated; start from their angle so the lift is continuous.
    const m = new DOMMatrix(getComputedStyle(from!).transform === 'none' ? undefined : getComputedStyle(from!).transform);
    const r0 = from!.closest('.hand,.fan,.stack') ? Math.atan2(m.b, m.a) * 180 / Math.PI : 0;
    const s0 = from!.offsetWidth ? Math.hypot(m.a, m.b) : 1;
    if (from!.closest('.slot')) hideSource(a.id); else from!.style.visibility = 'hidden';
    busy = true;
    holder.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(${r0}deg) scale(${s0})` }, { transform: `scale(${S})` }], { duration: 640, easing: EASE })
      .onfinish = () => { busy = false; if (reveal && !closeQueued) playReveal(a); settle(); };
  } else if (reveal) playReveal(a);
  requestAnimationFrame(() => plate.classList.add('shown'));
}

function closePlate() {
  if (!plateAlbum) return;
  if (busy) { closeQueued = true; return; }
  reader.close();
  const a = plateAlbum;
  plateAlbum = null;
  plate.classList.remove('shown', 'reading');
  layoutPlate();
  const target = slots.get(a.id)?.querySelector<HTMLElement>('.card') ?? null;
  const slot = slots.get(a.id);
  const r = target?.getBoundingClientRect();
  const onScreen = !!(r && r.width && r.bottom > 0 && r.top < innerHeight && slot && !slot.classList.contains('gone') && !slot.classList.contains('dim'));
  const finish = () => {
    holder.getAnimations().forEach(x => x.cancel());   // a finished fill-forwards animation would pin the next card here
    plate.hidden = true; holder.replaceChildren(); holder.style.transform = '';
    document.documentElement.style.overflow = '';
    slots.forEach(s => s.classList.remove('away'));
    if (sourceEl) sourceEl.style.visibility = '';
    sourceEl = null;
    busy = false;
    setRoving(a.id, onScreen);
  };
  if (reducedMotion()) return finish();
  busy = true;
  if (tiltEl) tiltEl.style.transform = 'none';
  flipper?.classList.remove('flipped');
  const now = getComputedStyle(holder).transform;
  if (onScreen) {
    const cx = holder.offsetLeft + 140, cy = holder.offsetTop + 196;
    const dx = r!.left + r!.width / 2 - cx, dy = r!.top + r!.height / 2 - cy;
    holder.animate([{ transform: now }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], { duration: 520, easing: EASE, fill: 'forwards' }).onfinish = finish;
  } else {
    holder.animate([{ transform: now, opacity: 1 }, { transform: `${now} translateY(14px)`, opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).onfinish = finish;
  }
}

/** ←/→: next card in the current order, among the cards on the sheet (matching ones while searching). */
function step(dir: 1 | -1) {
  if (!plateAlbum || busy) return;
  const query = parseQuery(state.q, cat, reviewText);
  const list = order.filter(a => shown(a) && (query.empty || matches.has(a.id)));
  const i = list.findIndex(a => a.id === plateAlbum!.id);
  const next = list[(i + dir + list.length) % list.length];
  if (!next || next.id === plateAlbum.id) return;
  showInPlate(next, dir);
}

function showInPlate(a: AlbumOut, dir: 1 | -1 | 0) {
  hideSource(a.id);
  if (sourceEl) { sourceEl.style.visibility = ''; sourceEl = null; }
  const S = scale();
  const swap = () => {
    plateAlbum = a;
    const reveal = awaitingReveal(a);
    buildPlateCard(a, reveal);
    if (reader.isOpen && a.state !== 'sealed' && !reveal) reader.open(a);
    if (reveal) playReveal(a);
  };
  holder.getAnimations().forEach(x => x.cancel());
  holder.style.transform = `scale(${S})`;
  if (reducedMotion() || dir === 0) return swap();
  busy = true;
  holder.animate([{ transform: `scale(${S})`, opacity: 1, filter: 'blur(0)' }, { transform: `translateX(${-dir * 70}px) scale(${S * 0.97})`, opacity: 0, filter: 'blur(4px)' }], { duration: 180, easing: 'ease-in' }).onfinish = () => {
    swap();
    holder.animate([{ transform: `translateX(${dir * 70}px) scale(${S * 0.97})`, opacity: 0, filter: 'blur(4px)' }, { transform: `scale(${S})`, opacity: 1, filter: 'blur(0)' }], { duration: 380, easing: EASE }).onfinish = settle;
  };
}

function flip() {
  if (!flipper || !plateAlbum || plateAlbum.state === 'sealed' || busy || awaitingReveal(plateAlbum)) return;
  flipper.classList.toggle('flipped');
  const flipped = flipper.classList.contains('flipped');
  flipper.querySelector('.face-back')?.setAttribute('aria-hidden', String(!flipped));
  flipper.querySelector('.face-front')?.setAttribute('aria-hidden', String(flipped));
}

function openReader() {
  if (!plateAlbum || plateAlbum.state === 'sealed' || awaitingReveal(plateAlbum)) return;
  setReading(true);
  reader.open(plateAlbum);
}

holder.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-action=read]')) openReader(); else flip(); });
info.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-action=read]')) openReader(); });
plate.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-close]')) { if (reader.isOpen) reader.close(); else closePlate(); } });

// Tilt toward the pointer, up to ±8°, eased.
let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
plate.addEventListener('pointermove', e => {
  if (reducedMotion() || e.pointerType === 'touch') return;
  const r = holder.getBoundingClientRect();
  const nx = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), ny = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2);
  tx = Math.max(-1, Math.min(1, nx)) * 8; ty = Math.max(-1, Math.min(1, ny)) * -8;
  if (!raf) raf = requestAnimationFrame(tick);
});
plate.addEventListener('pointerleave', () => { tx = ty = 0; if (!raf) raf = requestAnimationFrame(tick); });
function tick() {
  cx += (tx - cx) * 0.1; cy += (ty - cy) * 0.1;
  if (tiltEl) tiltEl.style.transform = `rotateY(${cx.toFixed(2)}deg) rotateX(${cy.toFixed(2)}deg)`;
  raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.02 ? requestAnimationFrame(tick) : 0;
}

/* ───────────── keys ───────────── */

document.addEventListener('keydown', e => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !plateAlbum) { e.preventDefault(); qInput.focus(); qInput.select(); return; }
  if (e.key === 'Escape') {
    if (e.target === qInput) { if (qInput.value) { qInput.value = ''; onQuery(); } else qInput.blur(); return; }
    if (reader.isOpen) { reader.close(); return; }
    if (plateAlbum) { closePlate(); return; }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'r') {
    if (plateAlbum) return openReader();
    const a = rovingId && document.activeElement?.closest('.slot') ? byId(rovingId) : undefined;
    if (a && a.state !== 'sealed' && !awaitingReveal(a)) { openPlate(a, slots.get(a.id)?.querySelector('.card') as HTMLElement); setTimeout(openReader, 680); }
    return;
  }
  if (!plateAlbum) return;
  if (k === 'f') { e.preventDefault(); flip(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});

/* ───────────── controls ───────────── */

let qTimer = 0;
function onQuery() {
  state.q = qInput.value;
  const run = () => (state.hide ? relayout(applyFilter) : applyFilter());
  // Plain words also search full reviews where a build includes them (a public build doesn't): fetch on first use.
  if (/(^|\s)[^:<>=\s]+(\s|$)/.test(state.q)) loadSearch().then(run);
  run();
}
qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = window.setTimeout(onQuery, 60); });
sortSel.innerHTML = SORTS.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
sortSel.addEventListener('change', () => { state.sort = sortSel.value; store.set('binder.sort', state.sort); relayout(renderGrid); });
hideBox.addEventListener('change', () => { state.hide = hideBox.checked; store.set('binder.hide', state.hide); relayout(applyFilter); });

/* ───────────── boot ───────────── */

/** Make an element skip like a scratched disc for a moment. */
function glitch(el: Element | null, ms = 620) {
  if (!el || reducedMotion()) return;
  el.classList.add('glitch');
  setTimeout(() => el.classList.remove('glitch'), ms);
}

function inkIn() {
  const els = document.querySelectorAll<HTMLElement>('.ink:not(.slot)');
  requestAnimationFrame(() => els.forEach(el => el.classList.add('in')));
  setTimeout(() => glitch(document.querySelector('.title-word'), 560), 380);
  // The title band stutters and its rainbow fan opens the first time it comes into view.
  const tc = document.querySelector('.title-card');
  if (tc) new IntersectionObserver((es, o) => {
    if (es[0].intersectionRatio < 0.6) return;
    tc.classList.add('lit');
    glitch(tc.querySelector('.tc-word'));
    o.disconnect();
  }, { threshold: 0.6 }).observe(tc);
}

/** Set while the loading screen is up: the ink waits for it to lift. */
let holdInk = false;

async function boot() {
  cat = await loadCatalogue();
  installTooltips();
  qInput.value = state.q;
  sortSel.value = SORTS.some(s => s.key === state.sort) ? state.sort : 'no';
  hideBox.checked = state.hide;
  if (state.kingdom !== 'all' && !cat.kingdoms.some(k => k.key === state.kingdom)) state.kingdom = 'all';
  if (state.q) await loadSearch();
  renderMasthead();
  renderSeg();
  renderShelf();
  renderGrid();
  if (!holdInk) inkIn();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && byId(hash)) openPlate(byId(hash)!);
  if (cat.warnings.length) console.info(`catalogue: ${cat.warnings.length} build warnings`, cat.warnings);
}

onRebuild(async () => {
  cat = await loadCatalogue();
  renderMasthead();
  renderSeg();
  renderShelf();
  renderGrid();
  if (plateAlbum) { const a = byId(plateAlbum.id); if (a) { plateAlbum = a; buildPlateCard(a, false); hideSource(a.id); } else closePlate(); }
  if (reader.isOpen && reader.current) { const a = byId(reader.current.id); if (a) reader.open(a); }
});

const booted = boot();
booted.catch(err => { grid.innerHTML = `<p class="no-match">${esc(String(err.message ?? err))}</p>`; });
// Home from the world: the paper the warp ended on lifts off as the ink comes in. Any other load gets the
// loading screen, which turns into that same paper; a click or key cuts its hold short.
if (cameThrough('binder')) arrive('binder', true, booted);
else {
  holdInk = true;
  const l = loader('binder', booted, () => inkIn());
  for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, l.skip, { once: true, capture: true });
}
warpLinks('a[href^="/world"]', 'world', () => { if (plateAlbum) closePlate(); });

addEventListener('resize', () => { if (plateAlbum && !busy) { layoutPlate(); holder.style.transform = `scale(${scale()})`; } });
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > innerHeight * 0.5), { passive: true });
