// The world: four kingdoms as nebulae in space, every card floating in its kingdom's cloud, and threads with
// shooting stars wherever an album also belongs to another kingdom. Click a cloud to go in, a card to meet it.
import '../shared/system.css';
import '../shared/card.css';
import '../shared/card-extra.css';
import '../shared/reader.css';
import '../shared/warp.css';
import './world.css';
import * as THREE from 'three';
import { flipCard, penDate, PRIVATE_REVIEW, weekNo } from '../shared/card.ts';
import { loadCatalogue, loadSearch, onRebuild, reducedMotion, reviewText } from '../shared/data.ts';
import { Reader } from '../shared/reader.ts';
import { parseQuery, type Query } from '../shared/search.ts';
import { installTooltips } from '../shared/tooltip.ts';
import type { AlbumOut, Catalogue, KingdomKey } from '../shared/types.ts';
import { STAT_KEYS } from '../shared/types.ts';
import { arrive, cameThrough, loader, warpLinks } from '../shared/warp.ts';
import { CameraRig, type Mode } from './camera.ts';
import { CardField, cardPos, type Card } from './cards.ts';
import { Layers } from './gfx.ts';
import { cloudStars, clouds, CLOUD_R, nebulae as makeNebulae, starShell, type Nebula } from './nebula.ts';
import { Threads } from './threads.ts';
import { U } from './gfx.ts';
import { Music, TRACKS, type SceneKey, type Track } from './music.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const params = new URLSearchParams(location.search);

/* ── arrival: through the warp, its last frame is up before anything else and holds until the world is ready;
   on a reload or a direct visit, the loading screen (the cover) holds instead ── */
let worldReady!: () => void;
const ready = new Promise<void>(r => (worldReady = r));
let bootOn = true;
const arrival = (cameThrough('world') ? (g: () => void) => arrive('world', true, ready, g) : (g: () => void) => loader('world', ready, g))(() => {
  bootOn = false;
  hint();
  const at = params.get('at');
  const c = at ? cardOf(at) : null;
  if (c) setTimeout(() => meet(c), 200);
});
const skipBoot = () => arrival.skip();

/* ── renderer ── */
const canvas = $<HTMLCanvasElement>('gl');
let layers: Layers;
try { layers = new Layers(canvas); }
catch {
  $('err').hidden = false;
  $('err').textContent = 'The world needs WebGL, and this browser has none to give.';
  throw new Error('no webgl');
}
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
const rig = new CameraRig(camera);
const field = new CardField(layers.renderer);
const threads = new Threads();
const shell = starShell();
layers.main.add(shell, field.group, threads.lines, threads.comets);
layers.glow.add(threads.glow);
const resize = () => { layers.fit(camera); placeCard(); };
addEventListener('resize', resize);

/* ── state ── */
let cat: Catalogue;
let nebulae: Nebula[] = [];
const byKey = new Map<KingdomKey, Nebula>();
let cloudLit: number[] = [];
let query: Query | null = null;
let matches: string[] = [];
const cardOf = (id: string) => field.cards.find(c => c.album.id === id) ?? null;
const inCloud = (nb: Nebula | null) => field.cards.filter(c => c.nebula === nb);

/** Rebuild cards and threads so the world matches the catalogue. */
let syncing = Promise.resolve();
function sync(next: Catalogue) {
  syncing = syncing.then(async () => {
    cat = next;
    const focus = rig.card?.album.id;
    await field.set(cat, nebulae);
    threads.set(field.cards, byKey);
    if (focus) {
      const c = cardOf(focus);
      if (c) { rig.card = c; rig.nebula = c.nebula; if (shownFor) showCard(c, true); }
      else go('kingdom', rig.nebula);
    }
    renderLabels();
    applyQuery();
    status();
  });
  return syncing;
}

/* ── music: open space has its own, each kingdom its own; the toggle shows what is playing ── */
const music = new Music();
const soundBtn = $('sound'), soundWord = $('sound-word'), soundTrack = $('sound-track');
const bars = [...soundBtn.querySelectorAll<HTMLElement>('.eq i')];
const sceneFor = (): SceneKey => (rig.mode === 'space' || !rig.nebula ? 'space' : rig.nebula.k.key);
let shownTrack = '';
function soundUI() {
  soundBtn.setAttribute('aria-pressed', String(music.on));
  soundBtn.classList.toggle('off', !music.on);
  soundWord.textContent = music.on ? 'sound' : 'sound off';
  const now = music.nowPlaying, song = music.sceneSong;
  // The card's track can be the scene's own song (Dsco in the indie cloud); then that song is "now playing" too.
  const mine = shownFor ? trackOf(shownFor.album) : null;
  const here = !!now || (!!mine && !!song && mine.url === `/${song.url}` && music.playing);
  const t = now ? `${now.no ? `trk ${pad(now.no)}. ` : ''}${fullStop(now.name)}` : song ? fullStop(song.title) : TRACKS[music.scene];
  soundBtn.classList.toggle('album', here);
  if (t !== shownTrack) {
    shownTrack = t;
    soundTrack.textContent = t;
    soundTrack.dataset.text = t;
    soundTrack.classList.remove('stutter');
    void soundTrack.offsetWidth;
    soundTrack.classList.add('stutter');
  }
  const by = now ? '' : song ? ` by ${song.artist}` : '';
  soundBtn.title = music.on ? `now playing: ${t}${by} (m to mute)` : 'music is off (m to play)';
  notes.querySelector('.n-track')?.classList.toggle('on', here);
}
// First drawn once the catalogue is in (see start), when everything it reads exists.
music.onChange(soundUI);
soundBtn.addEventListener('click', e => { e.stopPropagation(); music.toggle(); });
// Browsers start sound only after a gesture: the first click or key anywhere wakes it.
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => music.wake(), { capture: true });
music.wake();

/* ── kingdom labels ── */
const labelsEl = $('labels');
const labelEls = new Map<Nebula, HTMLElement>();
function renderLabels() {
  for (const nb of nebulae) {
    let el = labelEls.get(nb);
    if (!el) {
      el = document.createElement('div');
      el.className = 'isl';
      el.style.setProperty('--k', nb.k.colour);
      labelsEl.append(el);
      labelEls.set(nb, el);
    }
    el.innerHTML = `<b>${esc(nb.k.name)}</b><i>${String(inCloud(nb).length).padStart(2, '0')}</i><span></span>`;
  }
}
const lv = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight;
  for (const [nb, el] of labelEls) {
    lv.copy(nb.centre); lv.y += CLOUD_R * 0.85;
    lv.project(camera);
    el.classList.toggle('hidden', lv.z > 1);
    el.classList.toggle('hot', nb.litTarget > 0.5);
    el.style.transform = `translate(${((lv.x + 1) / 2) * w}px,${((1 - lv.y) / 2) * h}px) translate(-50%,-100%)`;
  }
  labelsEl.classList.toggle('off', rig.mode !== 'space');
}

/* ── HUD ── */
const statusEl = $('status'), findEl = $('find'), hintEl = $('hint');
const pad = (n: number) => String(n).padStart(2, '0');
const sw = (k: { colour: string }) => `<span class="sw" style="--k:${k.colour}"></span>`;
const DOT = '<span class="dot">·</span>';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function status() {
  if (!cat) return;
  let s = '';
  if (rig.mode === 'space') {
    const sealed = cat.albums.filter(a => a.state === 'sealed').length;
    s = `<b>The world</b>${DOT}${plural(cat.albums.length, 'card')}${sealed ? `${DOT}${sealed} sealed` : ''}${DOT}${plural(nebulae.length, 'kingdom')}${threads.list.length ? `${DOT}${plural(threads.list.length, 'thread')}` : ''}`;
  } else if (rig.nebula) {
    const nb = rig.nebula, here = inCloud(nb);
    s = `${sw(nb.k)}<b>${esc(nb.k.name)}</b>`;
    if (rig.mode === 'card' && rig.card) {
      const c = rig.card;
      s += c.album.state === 'sealed' ? `${DOT}sealed${DOT}not yet heard` : `${DOT}${pad(here.indexOf(c) + 1)} / ${pad(here.length)}`;
      const also = c.album.also.map(k => byKey.get(k)).filter(Boolean) as Nebula[];
      if (also.length) s += `${DOT}also ${also.map(o => `${sw(o.k)}${esc(o.k.name)}`).join(' ')}`;
    } else {
      const out = threads.list.filter(t => t.card.nebula === nb).length, inn = threads.list.filter(t => t.to === nb).length;
      s += `${DOT}${plural(here.length, 'card')}${out ? `${DOT}${out} out` : ''}${inn ? `${DOT}${inn} in` : ''}`;
    }
  }
  statusEl.innerHTML = s;
  if (query && !query.empty) {
    findEl.hidden = false;
    findEl.innerHTML = `find <b>${esc(q.value || params.get('q') || '')}</b>${DOT}${plural(matches.length, 'match', 'matches')}${matches.length ? `${DOT}n next` : ''}`;
  } else findEl.hidden = true;
}

const HINTS: Record<Mode, string> = {
  space: 'drag to look around · scroll to near<br><kbd>1</kbd>–<kbd>4</kbd> or click a cloud · <kbd>/</kbd> find',
  kingdom: 'drag to turn · scroll to near<br>click a card · <kbd>esc</kbd> back',
  card: '<kbd>←</kbd> <kbd>→</kbd> neighbours · <kbd>t</kbd> follow a thread<br><kbd>f</kbd> flip · <kbd>r</kbd> review · <kbd>esc</kbd> back',
};
let hintTimer = 0;
function hint() {
  hintEl.innerHTML = HINTS[rig.mode];
  hintEl.classList.remove('gone');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hintEl.classList.add('gone'), 4200);
}

/* ── going places ── */
function go(mode: Mode, nb: Nebula | null = rig.nebula, c: Card | null = null) {
  if (shownFor && shownFor !== c) hideCard();
  rig.go(mode, nb, c);
  music.setScene(sceneFor());
  status();
  hint();
  canvas.classList.toggle('grab', mode !== 'card');
  document.body.classList.toggle('at-card', mode === 'card');
}
const toKingdom = (nb: Nebula) => go('kingdom', nb);
function meet(c: Card) {
  // Start fetching its track on the way in, so it is ready when the camera lands.
  const tr = trackOf(c.album);
  if (tr) music.preload(tr.url);
  go('card', c.nebula, c);
}
/** The album's track preview, if it has one and isn't sealed. */
function trackOf(a: AlbumOut): Track | null {
  return a.state !== 'sealed' && a.track?.preview ? { id: a.id, url: /^https?:/.test(a.track.preview) ? a.track.preview : `/${a.track.preview}`, name: a.track.name, no: a.track.no } : null;
}
function back() {
  if (reader.isOpen) return reader.close();
  if (rig.mode === 'card') go('kingdom');
  else if (rig.mode === 'kingdom') go('space', null);
}
function neighbour(step: number) {
  if (rig.mode !== 'card' || !rig.card) return;
  const list = inCloud(rig.nebula);
  meet(list[(list.indexOf(rig.card) + step + list.length) % list.length]);
}
/** From a card, ride its thread into the next kingdom it also belongs to. */
let followed = 0;
function follow() {
  if (rig.mode !== 'card' || !rig.card) return;
  const also = rig.card.album.also.map(k => byKey.get(k)).filter(Boolean) as Nebula[];
  if (!also.length) return;
  toKingdom(also[followed++ % also.length]);
}

/* ── the card reveal: the big card takes over from the 3D one in place ── */
const reveal = $('reveal'), holder = $('holder'), caption = $('caption');
let shownFor: Card | null = null;
let flipper: HTMLElement | null = null;
/** Phones: the notes are a sheet along the bottom, and the card sits in the space above it. */
const phone = () => innerWidth <= 960;
const SHEET = 244, TOP = 60;
const cardScale = () => phone()
  ? Math.max(0.55, Math.min(1.25, (innerHeight - SHEET - TOP - 40) / 392, (innerWidth - 56) / 280))
  : Math.max(0.6, Math.min(2, (innerHeight - 210) / 392, (innerWidth * 0.4) / 280));
function cardRight() { return Math.min(130, Math.max(24, innerWidth * 0.07)); }
/** The card's vertical centre in px. */
const cardY = () => phone() ? TOP + (innerHeight - SHEET - TOP) / 2 : innerHeight / 2;
rig.frame = () => {
  const s = cardScale();
  const cx = phone() ? innerWidth / 2 : innerWidth - cardRight() - 140 * s;
  return { height: 392 * s, ndcX: (cx / innerWidth) * 2 - 1, ndcY: 1 - (cardY() / innerHeight) * 2 };
};
rig.beyond = c => threads.list.find(t => t.card === c)?.to.centre ?? null;
function placeCard() {
  const s = cardScale(), right = cardRight();
  reveal.style.setProperty('--s', String(s));
  reveal.style.setProperty('--right', `${right}px`);
  reveal.style.setProperty('--cy', `${cardY()}px`);
  // The liner notes take the open side: from the left margin to a gap short of the card.
  const left = Math.max(32, right), room = innerWidth - right - 280 * s - left - Math.max(48, innerWidth * 0.05);
  notes.style.setProperty('--left', `${left}px`);
  notes.style.setProperty('--w', `${Math.min(460, room)}px`);
  notesRight = left + Math.min(460, room) + 60;
  notes.classList.toggle('cramped', room < 300);
}
function showCard(c: Card, instant = false) {
  shownFor = c;
  const a = c.album;
  reveal.style.setProperty('--k', c.nebula.k.colour);
  placeCard();
  flipper = flipCard(a, { cat });
  const scale = document.createElement('div');
  scale.className = 'scale';
  scale.append(flipper);
  holder.replaceChildren(scale);
  caption.innerHTML = a.state === 'sealed'
    ? `sealed${DOT}week ${a.pack ? weekNo(a.pack) : ''} pack${DOT}not yet heard`
    : `<b>No.${a.no}</b>${DOT}click to flip${DOT}r to read`;
  reveal.hidden = false;
  notes.style.setProperty('--k', c.nebula.k.colour);
  notes.innerHTML = notesHTML(a, c.nebula);
  notes.hidden = false;
  seqCells = [...notes.querySelectorAll<HTMLElement>('.n-seq [data-col]')];
  seqCol = -1;
  notes.classList.toggle('instant', instant);
  trackBar = notes.querySelector<HTMLElement>('.n-track-bar i');
  const tr = trackOf(a);
  if (tr) music.playTrack(tr); else music.stopTrack();
  soundUI();
  if (instant) { reveal.classList.add('in'); notes.classList.add('in'); }
  else requestAnimationFrame(() => requestAnimationFrame(() => { reveal.classList.add('in'); notes.classList.add('in'); }));
}
function hideCard() {
  shownFor = null;
  music.stopTrack();
  reveal.classList.remove('in');
  notes.classList.remove('in');
  reader.close();
}

/* ── liner notes: the open side of the card view, in the album's lowercase-and-full-stop voice ── */
const notes = $('notes');
let seqCells: HTMLElement[] = [], seqCol = -1, trackBar: HTMLElement | null = null;
/** Lowercase with a full stop, the way Velocity : Design : Comfort writes everything. */
const fullStop = (s: string) => `${s.toLowerCase().replace(/\s*:\s*/g, ' : ')}${/[.!?]$/.test(s) ? '' : '.'}`;
function notesHTML(a: AlbumOut, nb: Nebula): string {
  const line = (i: number, html: string, cls = '') => `<div class="n-line ${cls}" style="--i:${i}">${html}</div>`;
  if (a.state === 'sealed') {
    const pack = cat.packs.find(p => p.week === a.pack);
    return line(0, `<p class="n-label"><span class="sw" style="--k:${nb.k.colour}"></span>sealed · ${a.pack ? `week ${weekNo(a.pack)} pack` : 'pack'}</p>`)
      + line(1, `<h2 class="n-title" data-text="sealed.">sealed.</h2>`)
      + line(2, `<p class="n-artist">not heard yet. it opens once it has been heard and rated.</p>`)
      + line(3, `<dl class="n-meta"><dt>pack</dt><dd>${a.pack ?? '—'}${pack?.note ? ` · ${esc(pack.note)}` : ''}</dd><dt>kingdom</dt><dd>${esc(nb.k.name.toLowerCase())}, provisional</dd></dl>`);
  }
  const tier = cat.rarity.find(t => t.key === a.rarity);
  const title = fullStop(a.title);
  // The four stats as a step sequencer: a row each, five steps, a playhead that walks with the music.
  const seq = STAT_KEYS.map(k => {
    const v = a.stats[k] ?? 0;
    return `<div class="n-row"><span>${k}</span><span class="n-steps">${[0, 1, 2, 3, 4].map(i => `<i data-col="${i}" class="${i < v ? 'on' : ''}"></i>`).join('')}</span><b>${a.stats[k] ?? '–'}</b></div>`;
  }).join('');
  const also = a.also.map(k => byKey.get(k)).filter(Boolean) as Nebula[];
  return line(0, `<p class="n-label"><span class="sw" style="--k:${nb.k.colour}"></span>№ ${a.no} · ${esc(nb.k.name.toLowerCase())}${tier ? ` · ${esc(tier.name.toLowerCase())}` : ''}</p>`)
    + line(1, `<h2 class="n-title${title.length > 22 ? ' long' : ''}" data-text="${esc(title)}">${esc(title)}</h2>`)
    + line(2, `<p class="n-artist">${esc(a.artist)}, ${a.year}</p>`)
    + line(3, `<dl class="n-meta"><dt>rating</dt><dd>${a.rating != null ? `${a.rating} / 10` : 'unrated'}</dd><dt>first heard</dt><dd>${a.first ? penDate(a.first) : '—'}</dd>${a.runtime ? `<dt>runtime</dt><dd>${Math.round(a.runtime)} min</dd>` : ''}</dl>`)
    + line(4, `<div class="n-seq">${seq}</div>`)
    + (a.track?.preview ? line(5, `<p class="n-track"><span class="n-track-bar" aria-hidden="true"><i></i></span><span class="n-track-name">${a.track.no ? `trk ${pad(a.track.no)}. ` : ''}${esc(fullStop(a.track.name))}</span><span class="n-track-note">preview</span></p>`) : '')
    + line(5, `<p class="n-excerpt">${esc(PRIVATE_REVIEW)}</p>`)
    + (also.length ? line(6, `<p class="n-threads"><span>threads to</span>${also.map(o => `<button type="button" data-follow="${o.k.key}"><span class="sw" style="--k:${o.k.colour}"></span>${esc(o.k.name.toLowerCase())}</button>`).join('')}</p>`) : '')
    + line(7, `<p class="n-actions"><button type="button" class="n-step" data-action="prev" aria-label="Previous card">‹</button><button type="button" class="n-read" data-action="read">read the review <span aria-hidden="true">→</span></button><button type="button" class="n-flip" data-action="flip">flip</button><button type="button" class="n-step" data-action="next" aria-label="Next card">›</button></p>`);
}
notes.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  const f = t.closest<HTMLElement>('[data-follow]');
  if (f) { const nb = byKey.get(f.dataset.follow as KingdomKey); if (nb) toKingdom(nb); return; }
  const act = t.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (act === 'read') openReader();
  else if (act === 'flip') flip();
  else if (act === 'prev') neighbour(-1);
  else if (act === 'next') neighbour(1);
});
/** Walk the sequencer's playhead with the beat: one step per beat, round the five. */
function pulseNotes() {
  if (trackBar) trackBar.style.transform = `scaleX(${Math.max(0, music.progress()).toFixed(4)})`;
  const col = !music.playing || !shownFor || !music.pulse ? -1 : music.pulse % 5;
  if (col === seqCol) return;
  seqCol = col;
  for (const c of seqCells) c.classList.toggle('hit', Number(c.dataset.col) === col);
}
function flip() {
  if (!flipper || shownFor?.album.state === 'sealed') return;
  flipper.classList.toggle('flipped');
  const f = flipper.classList.contains('flipped');
  flipper.querySelector('.face-back')?.setAttribute('aria-hidden', String(!f));
  flipper.querySelector('.face-front')?.setAttribute('aria-hidden', String(f));
}
holder.addEventListener('click', e => {
  if (swiped) { swiped = false; return; }
  if ((e.target as HTMLElement).closest('[data-action=read]')) openReader();
  else flip();
});
function openReader() { if (shownFor && shownFor.album.state !== 'sealed') { reader.open(shownFor.album); music.muffled(true); } }
const reader = new Reader({
  cat: () => cat,
  openAlbum: id => { const c = cardOf(id); reader.close(); if (c) meet(c); },
  onClose: () => music.muffled(false),
});
installTooltips();

/* ── search ── */
const searchForm = $<HTMLFormElement>('search'), q = $<HTMLInputElement>('q');
q.value = params.get('q') ?? '';
function applyQuery() {
  if (!cat) return;
  query = q.value.trim() ? parseQuery(q.value, cat, reviewText) : null;
  matches = query ? [...cat.albums].sort((a, b) => a.no.localeCompare(b.no)).filter(a => query!.test(a)).map(a => a.id) : [];
  const url = new URL(location.href);
  if (q.value.trim()) url.searchParams.set('q', q.value.trim()); else url.searchParams.delete('q');
  history.replaceState(null, '', url);
  status();
}
q.addEventListener('input', applyQuery);
searchForm.addEventListener('submit', e => { e.preventDefault(); q.blur(); searchForm.hidden = !q.value; nextMatch(); });
function nextMatch() {
  if (!matches.length) return;
  const cur = rig.card ? matches.indexOf(rig.card.album.id) : -1;
  const c = cardOf(matches[(cur + 1) % matches.length]);
  if (c) meet(c);
}

/* ── pointer ── */
const pointer = { x: 0, y: 0, inside: false, touch: false, down: null as null | { x: number; y: number; moved: number } };
/** How far a press may wander and still be a tap: a fingertip shakes more than a mouse. */
const TAP = () => pointer.touch ? 12 : 4;
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverNebula: Nebula | null = null, hoverCard: Card | null = null;
const sphere = new THREE.Sphere();

function pick(t: number) {
  hoverNebula = null; hoverCard = null;
  if (!pointer.inside || pointer.down?.moved || bootOn || rig.flying) return;
  if (rig.mode === 'space') {
    ndc.set((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = Infinity;
    for (const nb of nebulae) {
      sphere.set(nb.centre, CLOUD_R * 1.05);
      const hit = ray.ray.intersectSphere(sphere, lv);
      if (hit) { const d = hit.distanceTo(ray.ray.origin); if (d < best) { best = d; hoverNebula = nb; } }
    }
  } else hoverCard = field.pick(pointer.x, pointer.y, camera, t, shownFor, pointer.touch ? 28 : 0);
}
canvas.addEventListener('pointermove', e => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
  const d = pointer.down;
  if (d) {
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY;
    if (d.moved > TAP() && touches.size < 2) { rig.drag(dx, dy); canvas.classList.toggle('grabbing', rig.mode !== 'card'); }
  }
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
canvas.addEventListener('pointerdown', e => {
  // A tap may come with no move before it (touch), so take the position here too.
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; pointer.touch = e.pointerType !== 'mouse';
  pointer.down = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => {
  const d = pointer.down; pointer.down = null;
  canvas.classList.remove('grabbing');
  rig.release();
  // A tap while the camera is still flying in isn't a miss: ignore it rather than back out to open space.
  if (!d || d.moved > TAP() || bootOn || rig.flying) return;
  pick(rig.time);
  if (rig.mode === 'space') { if (hoverNebula) toKingdom(hoverNebula); return; }
  if (hoverCard) meet(hoverCard);
  else back();
});
// The browser took the touch (a system gesture): treat it as a let-go, not a tap.
canvas.addEventListener('pointercancel', () => { pointer.down = null; canvas.classList.remove('grabbing'); rig.release(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); rig.zoom(e.deltaY); }, { passive: false });
// Touch: two fingers pinch to near or far in a kingdom.
const touches = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size !== 2) return;
  const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinch) rig.zoom((pinch - d) * 4);
  pinch = d;
  if (pointer.down) pointer.down.moved = 99;
});
for (const ev of ['pointerup', 'pointercancel'] as const) canvas.addEventListener(ev, e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; });
// A sideways swipe on the big card moves to the next or previous one instead of flipping it.
let swipe: { x: number; y: number } | null = null, swiped = false;
holder.addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; swiped = false; });
holder.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; neighbour(dx < 0 ? 1 : -1); }
});

/* ── keys ── */
addEventListener('keydown', e => {
  if (bootOn) { skipBoot(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = (e.target as HTMLElement).closest('input,textarea,select');
  if (typing) {
    if (e.key === 'Escape') { q.blur(); if (!q.value) searchForm.hidden = true; }
    return;
  }
  if (reader.isOpen && e.key !== 'Escape') return;
  const k = e.key;
  if (k === 'Escape') back();
  else if (/^[1-9]$/.test(k) && nebulae[Number(k) - 1]) toKingdom(nebulae[Number(k) - 1]);
  else if (k === 'ArrowLeft') neighbour(-1);
  else if (k === 'ArrowRight') neighbour(1);
  else if (k === 'r' || k === 'R') openReader();
  else if (k === 'f' || k === 'F') flip();
  else if (k === 't' || k === 'T') follow();
  else if (k === 'n' || k === 'N') nextMatch();
  else if (k === 'm' || k === 'M') music.toggle();
  else if (k === '/') { e.preventDefault(); searchForm.hidden = false; q.focus(); q.select(); }
  else return;
  e.preventDefault();
});

/* ── boot: the arrival overlay (see the top) takes clicks while it plays; any of them skips it ── */
addEventListener('pointerdown', () => { if (bootOn) skipBoot(); }, { capture: true });
// Back to the binder through the warp, the music fading as the floor comes up.
warpLinks('a[href="/"]', 'binder', () => music.hush());
addEventListener('pageshow', e => { if (e.persisted) music.restore(); });

/* ── perf readout (?fps) ── */
const perf = params.has('fps') ? $('perf') : null;
if (perf) perf.hidden = false;
let fpsFrames = 0, fpsClock = 0;

/* ── the loop ── */
const timer = new THREE.Timer();
const quiet = reducedMotion();
const near = new THREE.Vector3();
const crowded = new Set<Card>();

const sv = new THREE.Vector3();
let notesOpen = false, notesRight = 0;
/** Is the card on screen inside the liner notes' column? */
function behind(c: Card) {
  cardPos(c, rig.time, sv).project(camera);
  return sv.z < 1 && (sv.x + 1) / 2 * innerWidth < notesRight;
}

/** Set every eased target from where we are and what is hovered, searched or shown. */
function targets() {
  notesOpen = notes.classList.contains('in') && !notes.classList.contains('cramped') && !phone();
  const hit = query ? new Set(matches) : null;
  // Cards nearer than twice the focused card's distance would loom larger than it does.
  const reach = rig.card ? cardPos(rig.card, rig.time, near).distanceTo(camera.position) * 2 : 0;
  for (const nb of nebulae) {
    nb.litTarget = rig.mode === 'space' ? (nb === hoverNebula ? 1 : 0) : nb === rig.nebula ? 0.25 : 0;
    nb.lit += (nb.litTarget - nb.lit) * 0.08;
    cloudLit[nb.index] = nb.lit;
  }
  for (const c of field.cards) {
    const match = !!hit?.has(c.album.id), home = rig.mode !== 'space' && c.nebula === rig.nebula;
    c.glowTarget = c === hoverCard ? 1 : match ? 0.75 : home ? 0.18 : 0.05;
    c.dimTarget = hit && !match ? 0.3 : 1;
    const handed = c === shownFor && reveal.classList.contains('in');
    // At a card, anything drifting between the camera and it dissolves out of the way.
    // With some slack either way, so a card bobbing at the edge settles fully in or out instead of flickering.
    if (rig.mode !== 'card' || c === rig.card) crowded.delete(c);
    else {
      const d = cardPos(c, rig.time, near).distanceTo(camera.position);
      if (d < reach) crowded.add(c); else if (d > reach * 1.25) crowded.delete(c);
    }
    // Cards drifting behind the liner notes step back so the words stay clear.
    const behindNotes = notesOpen && c !== rig.card && behind(c);
    c.opacityTarget = handed || crowded.has(c) ? 0 : behindNotes ? 0 : 1;
    c.swayTarget = c === rig.card && rig.mode === 'card' ? 0 : quiet ? 0.2 : 1;
  }
  for (const t of threads.list) {
    const focus = t.card === hoverCard || (rig.mode === 'card' && t.card === rig.card);
    const touches = rig.nebula && (t.card.nebula === rig.nebula || t.to === rig.nebula);
    t.litTarget = focus ? 1 : hit?.has(t.card.album.id) ? 0.7 : rig.mode === 'space' ? 0.3 : touches ? 0.4 : 0.08;
  }
}

function loop(now: number) {
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta()), t = timer.getElapsed();
  U.uTime.value = quiet ? t * 0.3 : t;

  rig.update(dt, U.uTime.value);
  shell.position.copy(camera.position);
  camera.updateMatrixWorld();
  pick(U.uTime.value);
  canvas.classList.toggle('point', !!(hoverNebula || hoverCard));
  targets();
  field.update(dt);
  threads.update(dt);

  // The big card arrives a moment after the camera does.
  if (rig.mode === 'card' && rig.card && !rig.flying && rig.arrived > 0.25 && shownFor !== rig.card) showCard(rig.card);

  placeLabels();
  music.update(now);
  meter();
  if (shownFor) pulseNotes();
  layers.render(camera);

  if (perf) {
    fpsFrames++; fpsClock += dt;
    if (fpsClock > 0.5) {
      const i = layers.renderer.info.render;
      perf.textContent = `${Math.round(fpsFrames / fpsClock)} fps\n${i.calls} calls · ${i.triangles} tris\n${field.cards.length} cards · ${threads.list.length} threads`;
      fpsFrames = 0; fpsClock = 0;
    }
  }
  requestAnimationFrame(loop);
}

/** The toggle's five bars follow the music's spectrum. */
function meter() {
  const lv = music.levels(bars.length);
  bars.forEach((b, i) => { b.style.transform = `scaleY(${(0.18 + lv[i] * 0.95).toFixed(3)})`; });
}

/* ── stress test (?stress=300): synthetic cards across all four kingdoms, a third of them threaded ── */
function stress(c: Catalogue, n: number): Catalogue {
  const keys = c.kingdoms.map(k => k.key);
  const albums: AlbumOut[] = [];
  for (let i = 0; i < n; i++) {
    const src = c.albums[i % c.albums.length], k = keys[i % keys.length];
    const also = i % 3 === 0 ? [keys[(i + 1 + (i % 2)) % keys.length]] : [];
    albums.push({ ...src, id: `${src.id}~${i}`, no: String(i + 1).padStart(3, '0'), kingdom: k, also, state: i % 37 === 5 ? 'sealed' : 'open' });
  }
  return { ...c, albums };
}

/* ── start ── */
async function start() {
  let c: Catalogue;
  try { c = await loadCatalogue(); }
  catch (e) { $('err').hidden = false; $('err').textContent = (e as Error).message; skipBoot(); return; }
  const n = Number(params.get('stress'));
  if (n > 0) c = stress(c, n);
  nebulae = makeNebulae(c.kingdoms);
  for (const nb of nebulae) byKey.set(nb.k.key, nb);
  const cl = clouds(nebulae);
  cloudLit = cl.lit;
  layers.glow.add(...cl.meshes);
  layers.main.add(cloudStars(nebulae));
  resize();
  await sync(c);
  music.setSongs(c.sounds ?? {});
  soundUI();
  requestAnimationFrame(loop);
  worldReady();
  if (q.value) loadSearch().then(applyQuery);
  else loadSearch();
  onRebuild(async () => {
    if (n > 0) return;
    try { const next = await loadCatalogue(); music.setSongs(next.sounds ?? {}); await sync(next); } catch (e) { console.warn(e); }
  });
}
start();

// A handle for poking at the world from the console while developing.
if (import.meta.env.DEV) Object.assign(window, { world: { rig, field, threads, music, nebulae: () => nebulae, meet, go, cardOf } });
