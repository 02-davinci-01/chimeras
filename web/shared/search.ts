// The search grammar (SPEC 9.4), shared by the binder and the world. Terms are case-insensitive and AND together.
import type { AlbumOut, Catalogue, StatKey } from './types.ts';

type Op = ':' | '=' | '>' | '>=' | '<' | '<=';
type Pred = (a: AlbumOut, text: (id: string) => string) => boolean;

const STATS: StatKey[] = ['replay', 'sonic', 'meaning', 'influence'];
const KINGDOM_ALIASES: Record<string, string> = { rock: 'rock', electronic: 'electronic', hiphop: 'hiphop', 'hip-hop': 'hiphop', 'hip hop': 'hiphop', indie: 'indie' };

const cmp = (v: number | null, op: Op, n: number) => {
  if (v == null) return false;
  switch (op) { case ':': case '=': return v === n; case '>': return v > n; case '>=': return v >= n; case '<': return v < n; case '<=': return v <= n; }
};

/** Split a query into terms, keeping "quoted phrases" and key:"quoted values" whole. */
export function tokens(q: string): string[] {
  const out: string[] = [];
  const re = /(\S+?(?:>=|<=|[:=<>]))?"([^"]*)"?|\S+/g;
  for (const m of q.matchAll(re)) out.push(m[2] !== undefined ? (m[1] ?? '') + m[2] : m[0]);
  return out.filter(Boolean);
}

export interface Query { test(a: AlbumOut): boolean; empty: boolean; terms: string[] }

export function parseQuery(q: string, cat: Catalogue, text: (id: string) => string = () => ''): Query {
  const tiers = cat.rarity.map(t => t.key);                     // highest first
  const preds: Pred[] = [];
  const terms = tokens(q.trim().toLowerCase());

  for (const term of terms) {
    const m = /^([a-z-]+)(>=|<=|[:=<>])(.+)$/.exec(term);
    if (!m) {
      if (term === 'sealed' || term === 'open' || term === 'unrated') { preds.push(a => a.state === term); continue; }
      // Plain words: title, artist and the full review. Sealed cards keep their identity hidden.
      preds.push((a, t) => a.state !== 'sealed' && (a.title.toLowerCase().includes(term) || a.artist.toLowerCase().includes(term) || t(a.id).toLowerCase().includes(term)));
      continue;
    }
    const [, key, op, raw] = m as unknown as [string, string, Op, string];
    const num = Number(raw);
    const open = (p: Pred): Pred => (a, t) => a.state !== 'sealed' && p(a, t);
    if (key === 'k' || key === 'kingdom') {
      const k = KINGDOM_ALIASES[raw];
      preds.push(a => a.kingdom === k);
    } else if (key === 'r' || key === 'rarity') {
      const i = tiers.indexOf(raw);
      if (i < 0) { preds.push(() => false); continue; }
      // Lower index = higher tier, so ">=" means index ≤ i.
      preds.push(a => {
        const j = a.rarity ? tiers.indexOf(a.rarity) : -1;
        if (j < 0) return false;
        return op === ':' || op === '=' ? j === i : op === '>=' ? j <= i : op === '>' ? j < i : op === '<=' ? j >= i : j > i;
      });
    } else if ((STATS as string[]).includes(key) && Number.isFinite(num)) {
      preds.push(open(a => cmp(a.stats[key as StatKey], op, num)));
    } else if (key === 'rating' && Number.isFinite(num)) {
      preds.push(open(a => cmp(a.rating, op, num)));
    } else if (key === 'year') {
      const decade = /^(\d{3})0s$/.exec(raw) ?? /^(\d)0s$/.exec(raw);
      if (decade) {
        const start = decade[1].length === 3 ? Number(decade[1]) * 10 : (Number(decade[1]) >= 3 ? 1900 : 2000) + Number(decade[1]) * 10;
        preds.push(open(a => a.year >= start && a.year < start + 10));
      } else if (Number.isFinite(num)) preds.push(open(a => cmp(a.year, op, num)));
    } else if (key === 'first' && Number.isFinite(num)) {
      preds.push(open(a => cmp(a.first ? Number(a.first.slice(0, 4)) : null, op, num)));
    } else if (key === 'artist') {
      preds.push(open(a => a.artist.toLowerCase().includes(raw)));
    } else if (key === 'title') {
      preds.push(open(a => a.title.toLowerCase().includes(raw)));
    } else if (key === 'pack') {
      preds.push(a => (a.pack ?? '').toLowerCase() === raw);
    } else {
      // Unknown key: fall back to a plain-word match on the whole term.
      preds.push((a, t) => a.state !== 'sealed' && (a.title + ' ' + a.artist + ' ' + t(a.id)).toLowerCase().includes(term));
    }
  }
  return { empty: preds.length === 0, terms, test: a => preds.every(p => p(a, text)) };
}

/** Sort orders for the binder. Ties fall back to card number. */
export const SORTS: { key: string; label: string; cmp: (a: AlbumOut, b: AlbumOut, cat: Catalogue) => number }[] = [
  { key: 'no', label: 'Card number', cmp: () => 0 },
  { key: 'rarity', label: 'Rarity', cmp: (a, b, cat) => rank(a, cat) - rank(b, cat) || (b.rating ?? -1) - (a.rating ?? -1) },
  { key: 'year', label: 'Year', cmp: (a, b) => sealedLast(a, b) || b.year - a.year },
  ...STATS.map(s => ({ key: s, label: s[0].toUpperCase() + s.slice(1), cmp: (a: AlbumOut, b: AlbumOut) => sealedLast(a, b) || (b.stats[s] ?? 0) - (a.stats[s] ?? 0) })),
  { key: 'first', label: 'First listened', cmp: (a, b) => sealedLast(a, b) || (b.first ?? '').localeCompare(a.first ?? '') },
];
const sealedLast = (a: AlbumOut, b: AlbumOut) => Number(a.state === 'sealed') - Number(b.state === 'sealed');
const rank = (a: AlbumOut, cat: Catalogue) => a.rarity ? cat.rarity.findIndex(t => t.key === a.rarity) : a.state === 'sealed' ? 99 : 98;

export function sorted(albums: AlbumOut[], key: string, cat: Catalogue): AlbumOut[] {
  const s = SORTS.find(s => s.key === key) ?? SORTS[0];
  return albums.slice().sort((a, b) => s.cmp(a, b, cat) || a.no.localeCompare(b.no));
}
