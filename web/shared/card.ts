// The Obi card (SPEC 8). Markup mirrors design/card-reference.html exactly; card.css is the reference stylesheet.
import type { AlbumOut, Catalogue } from './types.ts';
import { STAT_KEYS } from './types.ts';

export type Face = 'front' | 'back';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const BARCODE = '<svg width="23" height="12" viewBox="0 0 23 12" aria-hidden="true">'
  + [[0, 1], [3, 1], [5, 3], [9, 2], [12, 1], [15, 3], [19, 1], [22, 1]].map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="12" fill="currentColor"/>`).join('')
  + '</svg>';
const SCREW = (pos: string) => `<svg class="screw ${pos}" viewBox="0 0 7 7" aria-hidden="true"><circle cx="3.5" cy="3.5" r="3" fill="none" stroke="#CFCFCB"/><line x1="1.8" y1="3.5" x2="5.2" y2="3.5" stroke="#CFCFCB"/></svg>`;
const SCREWS = ['tl', 'tr', 'bl', 'br'].map(SCREW).join('');
const RIDGE = '<div class="ridge"><svg viewBox="0 0 188 20" preserveAspectRatio="none" aria-hidden="true"><path d="M14 20 L24 2 H164 L174 20" fill="none" stroke="#E0E0DC"/><circle cx="52" cy="12" r="3.5" fill="none" stroke="#D9D9D5"/><circle cx="136" cy="12" r="3.5" fill="none" stroke="#D9D9D5"/><rect x="84" y="8" width="7" height="7" fill="none" stroke="#D9D9D5"/><rect x="97" y="8" width="7" height="7" fill="none" stroke="#D9D9D5"/></svg></div>';
/** Shown wherever the full review would be: reviews live only in Vedant's Logseq graph. */
export const PRIVATE_REVIEW = 'reviews stay local at my logseq for they are personal :p';
const LINK = '<button class="review-link" type="button" data-action="read">Read the full review</button>';

/** Hover explanations (data-tip) for the card's small marks. */
const TIER_NOTES: Record<string, string> = {
  divine: 'A perfect 10. A pearly sheen sweeps the card.',
  rare: 'Rated 9 or more. Holographic border.',
  elite: 'Rated 8 or more. Etched border.',
  special: 'Rated 7 or more. Foil title on the strip.',
  common: 'Rated below 7. Matte, no finish.',
};
const STAT_NOTES: Record<string, string> = {
  replay: 'how often it pulls you back',
  sonic: 'how it sounds: production, texture, space',
  meaning: 'what it says, and what it meant to you',
  influence: 'how far its echo carries',
};
const MARK_NOTES: Record<string, string> = { smear: 'smeared and warped', grid: 'cut into a slipping grid', halftone: 'printed as halftone dots', strings: 'strung as threads' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const tip = (title: string, body = '') => ` data-tip="${esc(title)}"${body ? ` data-tip-body="${esc(body)}"` : ''}`;

/** DD.MM.YY, as hand-written on the strip. */
export const penDate = (iso: string | null) => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '';
export const weekNo = (week: string) => String(Number(week.slice(-2)));

export interface CardContext {
  cat: Catalogue;
  /** Where art lives; '' for the server root. */
  base?: string;
}

/** Long titles wrap early (and very long ones shrink) so the date keeps its room. Reference titles are all short. */
const titleClass = (t: string) => t.length > 22 ? 'obi-title longer' : t.length > 11 ? 'obi-title long' : 'obi-title';

function obi(title: string, date: string, foot: string, dateTip = '', footTip = '') {
  return `<div class="obi"><div class="${titleClass(title)}">${esc(title)}</div><div class="obi-date"${dateTip}>${esc(date)}</div><div class="obi-foot"${footTip}><span>${esc(foot)}</span>${BARCODE}</div></div>`;
}

function stars(n: number | null, starPath: string, viewBox: string) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<svg class="star${n != null && i <= n ? ' on' : ''}" viewBox="${viewBox}" aria-hidden="true"><path d="${starPath}"/></svg>`;
  return s;
}

/** Inner HTML of one face (the `<article class="card">` itself is made by `cardElement`). */
export function faceHTML(a: AlbumOut, face: Face, ctx: CardContext): string {
  const { cat } = ctx, base = ctx.base ?? '';
  const k = cat.kingdoms.find(k => k.key === a.kingdom)!;

  if (a.state === 'sealed') {
    const pack = cat.packs.find(p => p.week === a.pack);
    const n = pack ? pack.albums.indexOf(a.id) + 1 : 1, of = pack?.albums.length ?? 1;
    const wk = a.pack ? weekNo(a.pack) : '';
    return obi('Sealed', 'not yet', `Week ${wk}`)
      + `\n<div class="body">${SCREWS}<div class="art blank"><div class="side">A</div></div>\n`
      + `<div><div class="artist">Week ${wk} pack</div><div class="meta">Card ${n} of ${of}</div></div>${RIDGE}</div>`;
  }

  const strip = obi(a.title, penDate(a.first), `${k.name} ${a.no}`,
    a.first ? tip('First listened', longDate(a.first)) : '',
    tip(`${k.name} · card ${a.no}`, `Card ${Number(a.no)} of ${cat.albums.length || '?'} in the catalogue.`));
  if (face === 'back') {
    const img = a.art.abstract ? `<img src="${base}/${a.art.abstract}" alt="Abstract art of ${esc(a.title)}" loading="lazy" decoding="async">` : '';
    const text = esc(PRIVATE_REVIEW);
    return strip
      + `\n<div class="body">${SCREWS}<div class="art${img ? '' : ' blank'}">${img}<div class="side"${tip('Side B · abstract', `The cover's own colours, ${MARK_NOTES[k.mark] ?? 'redrawn'}: the ${k.name.toLowerCase()} mark.`)}>B</div></div>\n`
      + `<p class="excerpt private" style="margin:2px 0 0">${text}</p>\n${LINK}${RIDGE}</div>`;
  }

  const tier = cat.rarity.find(t => t.key === a.rarity);
  const tierTip = tier ? tip(`${tier.name}${a.rating != null ? ` · ${a.rating}/10` : ''}`, `${TIER_NOTES[tier.key] ?? ''}${a.rating != null && a.rarity && tier.rule.minRating > a.rating ? ' Set by hand.' : ''}`) : '';
  const badge = tier ? `<div class="rarity-badge"${tierTip}><svg class="sym" width="15" height="15" viewBox="-1 -1 26 26" aria-label="${tier.name}"><path d="${tier.symbol}"/></svg></div>` : '';
  const front = a.art.cover ?? a.art.pixel;
  const img = front ? `<img${a.art.cover ? ' class="cover"' : ''} src="${base}/${front}" alt="Cover of ${esc(a.title)}" decoding="async">` : '';
  const statRows = STAT_KEYS.map(s => `<div class="stat"${tip(`${s[0].toUpperCase() + s.slice(1)}${a.stats[s] != null ? ` · ${a.stats[s]} of 5` : ''}`, STAT_NOTES[s][0].toUpperCase() + STAT_NOTES[s].slice(1) + '.')}><span>${s[0].toUpperCase() + s.slice(1)}</span><div class="stars">${stars(a.stats[s], cat.starPath, cat.starViewBox)}</div></div>`).join('');
  return strip
    + `\n<div class="body">${SCREWS}<div class="art${img ? '' : ' blank'}">${img}<div class="side"${tip('Side A · the cover')}>A</div>${badge}</div>\n`
    + `<div><div class="artist">${esc(a.artist)}</div><div class="meta"><b>${tier ? tier.name : 'Unrated'}</b>  ${a.year}, No.${a.no}</div></div>\n`
    + `<div class="stats">${statRows}</div>${LINK}${RIDGE}</div>`;
}

export function finishClass(a: AlbumOut, cat: Catalogue): string {
  if (a.state !== 'open') return '';
  const f = cat.rarity.find(t => t.key === a.rarity)?.finish;
  return f && f !== 'matte' ? `f-${f}` : '';
}

export function cardLabel(a: AlbumOut, face: Face = 'front') {
  if (a.state === 'sealed') return 'Sealed card';
  return face === 'back' ? `${a.title}, back` : `${a.title} by ${a.artist}`;
}

/** One card face as an element. */
export function cardElement(a: AlbumOut, ctx: CardContext, face: Face = 'front', tag = 'article'): HTMLElement {
  const el = document.createElement(tag);
  el.className = ['card', finishClass(a, ctx.cat)].filter(Boolean).join(' ');
  el.dataset.kingdom = a.kingdom;
  el.dataset.id = a.id;
  el.dataset.state = a.state;
  el.setAttribute('aria-label', cardLabel(a, face));
  el.innerHTML = faceHTML(a, face, ctx);
  return el;
}

/** Both faces in a flipper, for the enlarged view and the world's reveal panel. */
export function flipCard(a: AlbumOut, ctx: CardContext): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flipper';
  wrap.dataset.id = a.id;
  const front = cardElement(a, ctx, 'front'); front.classList.add('face', 'face-front');
  wrap.append(front);
  if (a.state !== 'sealed') { const back = cardElement(a, ctx, 'back'); back.classList.add('face', 'face-back'); back.setAttribute('aria-hidden', 'true'); wrap.append(back); }
  return wrap;
}
