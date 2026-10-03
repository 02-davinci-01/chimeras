import '../shared/card.css';
import '../shared/card-extra.css';
import kingdoms from '../../config/kingdoms.json';
import rarity from '../../config/rarity.json';
import { cardElement } from '../shared/card.ts';
import type { AlbumOut, Catalogue } from '../shared/types.ts';

const cat = {
  generated: '', graphName: 'music', warnings: [],
  kingdoms: kingdoms.kingdoms, rarity: rarity.tiers, starPath: rarity.starPath, starViewBox: rarity.starViewBox,
  packs: [{ week: '2026-W40', made: '2026-09-28', note: null, albums: ['x', 'sealed', 'y', 'z'] }],
  albums: [],
} as unknown as Catalogue;

const album = (o: Partial<AlbumOut> & { s?: number[]; art?: string }): AlbumOut => ({
  id: o.id ?? 'a', no: o.no ?? '001', title: o.title ?? '', artist: o.artist ?? '', year: o.year ?? 2000,
  spotify: null, runtime: null, kingdom: o.kingdom ?? 'rock', added: '2026-10-02', first: o.first ?? null, pack: o.pack ?? null,
  state: o.state ?? 'open', rating: o.rating ?? null, rarity: o.rarity ?? null,
  stats: { replay: o.s?.[0] ?? null, sonic: o.s?.[1] ?? null, meaning: o.s?.[2] ?? null, influence: o.s?.[3] ?? null },
  art: { pixel: o.art ? `placeholder-art/${o.art}` : null, abstract: o.art ? `placeholder-art/${o.art}` : null, palette: [] },
  excerpt: o.excerpt ?? '', logseq: { page: '', url: '' }, person: {} as AlbumOut['person'],
});

const promises = album({ title: 'Promises', artist: 'Floating Points, Pharoah Sanders', year: 2021, no: '004', kingdom: 'electronic', first: '2021-04-02', rarity: 'divine', s: [5, 5, 5, 4], art: 'art2.png' });
const loveless = album({ title: 'loveless', artist: 'my bloody valentine', year: 1991, no: '017', kingdom: 'rock', first: '2023-11-14', rarity: 'rare', s: [4, 5, 4, 5], art: 'art1.png', excerpt: '[First lines of the review from the Logseq page, clamped to six lines. Placeholder text.]' });
const madvillainy = album({ title: 'Madvillainy', artist: 'Madvillain', year: 2004, no: '032', kingdom: 'hiphop', first: '2022-07-09', rarity: 'elite', s: [5, 4, 3, 5], art: 'art3.png' });
const crumbling = album({ title: 'Crumbling', artist: 'Mid-Air Thief', year: 2018, no: '041', kingdom: 'indie', first: '2019-12-30', rarity: 'special', s: [4, 4, 2, 5], art: 'art4.png' });
const sealed = album({ id: 'sealed', kingdom: 'indie', state: 'sealed', pack: '2026-W40' });
const unrated = album({ title: 'Carrie & Lowell', artist: 'Sufjan Stevens', year: 2015, no: '050', kingdom: 'indie', first: '2026-10-01', state: 'unrated', art: 'art4.png' });
const common = album({ title: 'Some Album', artist: 'Someone', year: 1999, no: '051', kingdom: 'electronic', first: '2020-02-02', rarity: 'common', s: [2, 3, 1, 2], art: 'art2.png' });

const ctx = { cat, base: '.' };
const put = (id: string, ...els: HTMLElement[]) => document.getElementById(id)!.append(...els);
put('fronts', ...[promises, loveless, madvillainy, crumbling].map(a => cardElement(a, ctx)));
put('backs', cardElement(loveless, ctx, 'back'), cardElement(sealed, ctx));
put('extra', cardElement(unrated, ctx), cardElement(common, ctx), cardElement(unrated, ctx, 'back'));

// ?real: the actual catalogue, front and back, read straight from dist/ through Vite's /@fs.
if (location.search.includes('real')) {
  const repo = __REPO__;
  fetch(`/@fs${repo}/dist/catalogue.json`).then(r => r.json()).then((real: Catalogue) => {
    document.querySelector('main')!.innerHTML = '<div class="row" id="real"></div>';
    const c = { cat: real, base: `/@fs${repo}` };
    put('real', ...real.albums.flatMap(a => [cardElement(a, c), cardElement(a, c, 'back')]));
  });
}
