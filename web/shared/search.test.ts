// Every term in SPEC 9.4 returns what it says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import kingdoms from '../../config/kingdoms.json' with { type: 'json' };
import rarity from '../../config/rarity.json' with { type: 'json' };
import { parseQuery, sorted, tokens } from './search.ts';
import type { AlbumOut, Catalogue } from './types.ts';

const mk = (id: string, o: Partial<AlbumOut> & { s?: [number, number, number, number] }): AlbumOut => ({
  id, no: o.no ?? '001', title: o.title ?? id, artist: o.artist ?? 'Nobody', year: o.year ?? 2000, spotify: null, runtime: null,
  kingdom: o.kingdom ?? 'rock', added: '2026-10-03', first: o.first ?? null, pack: o.pack ?? null, state: o.state ?? 'open',
  rating: o.rating ?? null, rarity: o.rarity ?? null,
  stats: { replay: o.s?.[0] ?? null, sonic: o.s?.[1] ?? null, meaning: o.s?.[2] ?? null, influence: o.s?.[3] ?? null },
  art: { cover: null, pixel: null, abstract: null, palette: [] }, excerpt: '', logseq: { page: id, url: '' }, person: {} as AlbumOut['person'],
});

const albums = [
  mk('kid-a', { no: '001', title: 'Kid A', artist: 'Radiohead', year: 2000, kingdom: 'rock', first: '2023-01-21', rating: 10, rarity: 'divine', s: [5, 5, 5, 5] }),
  mk('yeezus', { no: '002', title: 'Yeezus', artist: 'Kanye West', year: 2013, kingdom: 'hiphop', first: '2022-10-14', rating: 9, rarity: 'rare', s: [4, 5, 4, 5] }),
  mk('souvlaki', { no: '003', title: 'Souvlaki', artist: 'Slowdive', year: 1993, kingdom: 'rock', first: '2024-06-22', rating: 8.5, rarity: 'elite', s: [5, 5, 4, 3] }),
  mk('inventio', { no: '004', title: 'Inventio', artist: 'Murex', year: 2026, kingdom: 'indie', first: '2026-09-27', rating: 7.5, rarity: 'special', s: [4, 4, 3, 2] }),
  mk('discovery', { no: '005', title: 'Discovery', artist: 'Daft Punk', year: 2001, kingdom: 'electronic', first: '2023-06-17', rating: 6, rarity: 'common', s: [2, 3, 1, 2] }),
  mk('carrie', { no: '006', title: 'Carrie & Lowell', artist: 'Sufjan Stevens', year: 2015, kingdom: 'indie', pack: '2026-W40', state: 'sealed' }),
  mk('blank', { no: '007', title: 'Untouched', artist: 'Radiohead', year: 1997, kingdom: 'electronic', state: 'unrated' }),
];
const cat = { kingdoms: kingdoms.kingdoms, rarity: rarity.tiers, albums, packs: [] } as unknown as Catalogue;
const reviews: Record<string, string> = { 'kid-a': 'Everything in its right place, a cold glacier.', souvlaki: 'warm reverb' };
const ids = (q: string) => albums.filter(parseQuery(q, cat, id => reviews[id] ?? '').test).map(a => a.id);

test('plain words: title, artist, review text; AND; case-insensitive', () => {
  assert.deepEqual(ids('kid'), ['kid-a']);
  assert.deepEqual(ids('RADIOHEAD'), ['kid-a', 'blank']);
  assert.deepEqual(ids('glacier'), ['kid-a']);
  assert.deepEqual(ids('radiohead glacier'), ['kid-a']);
  assert.deepEqual(ids('"right place"'), ['kid-a']);
});
test('sealed cards never match on identity', () => {
  assert.deepEqual(ids('carrie'), []);
  assert.deepEqual(ids('artist:sufjan'), []);
});
test('k:', () => {
  assert.deepEqual(ids('k:rock'), ['kid-a', 'souvlaki']);
  assert.deepEqual(ids('k:electronic'), ['discovery', 'blank']);
  assert.deepEqual(ids('k:hiphop'), ['yeezus']);
  assert.deepEqual(ids('k:hip-hop'), ['yeezus']);
  assert.deepEqual(ids('k:indie'), ['inventio', 'carrie']);
});
test('r: and r>=', () => {
  assert.deepEqual(ids('r:divine'), ['kid-a']);
  assert.deepEqual(ids('r>=elite'), ['kid-a', 'yeezus', 'souvlaki']);
  assert.deepEqual(ids('r<special'), ['discovery']);
});
test('stat comparisons', () => {
  assert.deepEqual(ids('replay>=4'), ['kid-a', 'yeezus', 'souvlaki', 'inventio']);
  assert.deepEqual(ids('sonic=5'), ['kid-a', 'yeezus', 'souvlaki']);
  assert.deepEqual(ids('meaning<3'), ['discovery']);
  assert.deepEqual(ids('influence>=4'), ['kid-a', 'yeezus']);
});
test('rating', () => {
  assert.deepEqual(ids('rating>=9'), ['kid-a', 'yeezus']);
});
test('year and decade', () => {
  assert.deepEqual(ids('year<2000'), ['souvlaki', 'blank']);
  assert.deepEqual(ids('year:1990s'), ['souvlaki', 'blank']);
  assert.deepEqual(ids('year:2001'), ['discovery']);
});
test('first:', () => {
  assert.deepEqual(ids('first:2023'), ['kid-a', 'discovery']);
});
test('artist:', () => {
  assert.deepEqual(ids('artist:radiohead'), ['kid-a', 'blank']);
  assert.deepEqual(ids('artist:"daft punk"'), ['discovery']);
});
test('states', () => {
  assert.deepEqual(ids('sealed'), ['carrie']);
  assert.deepEqual(ids('unrated'), ['blank']);
  assert.deepEqual(ids('open').length, 5);
});
test('pack:', () => {
  assert.deepEqual(ids('pack:2026-W40'), ['carrie']);
});
test('combined', () => {
  assert.deepEqual(ids('k:rock r>=rare first:2023'), ['kid-a']);
});
test('tokens keep quoted values whole', () => {
  assert.deepEqual(tokens('artist:"daft punk" "a b" c'), ['artist:daft punk', 'a b', 'c']);
});
test('sort by rarity puts the highest first and sealed last', () => {
  assert.deepEqual(sorted(albums, 'rarity', cat).map(a => a.id), ['kid-a', 'yeezus', 'souvlaki', 'inventio', 'discovery', 'blank', 'carrie']);
});
