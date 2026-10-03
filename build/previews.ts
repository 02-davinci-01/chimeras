// Track previews: what the world plays when you meet a card. A song in sounds/ whose file name holds the album's
// `track` wins (the whole song); otherwise a 30-second clip found through Apple's public search API, downloaded once
// into previews/<id>.m4a so the world plays it locally. Cached by the track asked for.
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomicSync } from './art/bake.ts';
import type { AlbumFile } from './types.ts';

interface CacheEntry { want: string; name: string; no: number | null; url: string }
export interface PreviewResult { name: string; no: number | null; file: string | null }

const API = 'https://itunes.apple.com';
/** Compare names loosely: no case, accents, punctuation or bracketed edition notes. */
export const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*[([].*?[)\]]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

interface ITunesItem { wrapperType: string; collectionId: number; collectionName: string; artistName: string; trackName?: string; trackNumber?: number; discNumber?: number; previewUrl?: string }

export class Previews {
  private cache: Record<string, CacheEntry>;
  private cacheFile: string;
  private dir: string;
  constructor(root: string, private log: (s: string) => void, private sounds: string) {
    this.dir = path.join(root, 'previews');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cacheFile = path.join(this.dir, '.cache.json');
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { this.cache = {}; }
  }

  private rel = (id: string) => `previews/${id}.m4a`;
  private file = (id: string) => path.join(this.dir, `${id}.m4a`);

  /** What the catalogue says about an album's track, from the cache alone. */
  result(a: AlbumFile): PreviewResult | null {
    if (!a.track) return null;
    const own = this.local(a.track);
    if (own) return { name: a.track, no: this.cache[a.id]?.want === a.track ? this.cache[a.id].no : null, file: `sounds/${encodeURIComponent(own)}` };
    const hit = this.cache[a.id];
    if (!hit || hit.want !== a.track || !fs.existsSync(this.file(a.id))) return { name: a.track, no: null, file: null };
    return { name: hit.name, no: hit.no, file: this.rel(a.id) };
  }

  /** Find and download the clip if it isn't here yet. Throws with a reason when it can't be had. */
  async ensure(a: AlbumFile) {
    if (!a.track || this.local(a.track)) return;
    const hit = this.cache[a.id];
    if (hit && hit.want === a.track && fs.existsSync(this.file(a.id))) return;
    const t = await this.find(a);
    const res = await fetch(t.previewUrl!);
    if (!res.ok) throw new Error(`${a.id}: preview download failed (HTTP ${res.status})`);
    fs.writeFileSync(this.file(a.id) + '.tmp', Buffer.from(await res.arrayBuffer()));
    fs.renameSync(this.file(a.id) + '.tmp', this.file(a.id));
    this.cache[a.id] = { want: a.track, name: t.trackName!, no: t.trackNumber ?? null, url: t.previewUrl! };
    this.log(`  track  ${a.id} · ${t.trackName}`);
  }

  /** A file in sounds/ named for this track, matched on whole words ("In the Fog II" is not "In the Fog I"). */
  local(track: string): string | null {
    const want = ` ${norm(track)} `;
    try { return fs.readdirSync(this.sounds).find(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f) && ` ${norm(f.replace(/\.[^.]+$/, ''))} `.includes(want)) ?? null; }
    catch { return null; }
  }

  /** Drop the clips and cache entries of albums that are gone. */
  prune(ids: Set<string>) {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.startsWith('.') || ids.has(f.replace(/\.m4a$/, ''))) continue;
      fs.rmSync(path.join(this.dir, f));
      this.log(`  prune  previews/${f}`);
    }
    for (const id of Object.keys(this.cache)) if (!ids.has(id)) delete this.cache[id];
  }

  save() { writeAtomicSync(this.cacheFile, JSON.stringify(this.cache, null, 2) + '\n'); }

  private async get(url: string): Promise<ITunesItem[]> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Apple search: HTTP ${res.status}`);
    return ((await res.json()) as { results: ITunesItem[] }).results;
  }

  /** The album on Apple Music, then the track on it; failing that, the track by the artist anywhere. */
  private async find(a: AlbumFile): Promise<ITunesItem> {
    const artist = norm(a.artist), title = norm(a.title), want = norm(a.track!);
    // Same artist, in any word order ("Tujiko Noriko" is "Noriko Tujiko" on Apple).
    const words = (s: string) => new Set(norm(s).split(' '));
    const sameArtist = (name: string) => { const x = norm(name); if (x.includes(artist) || artist.includes(x)) return true; const w = words(name); return [...words(a.artist)].every(t => w.has(t)); };
    const byName = (items: ITunesItem[]) =>
      items.find(i => norm(i.trackName ?? '') === want) ?? items.find(i => norm(i.trackName ?? '').startsWith(want)) ?? items.find(i => norm(i.trackName ?? '').includes(want));
    const albums = await this.get(`${API}/search?entity=album&limit=15&term=${encodeURIComponent(`${a.artist} ${a.title}`)}`);
    const ranked = albums
      .filter(x => sameArtist(x.artistName))
      .sort((x, y) => Number(norm(y.collectionName) === title) - Number(norm(x.collectionName) === title));
    for (const al of ranked.slice(0, 3)) {
      const songs = (await this.get(`${API}/lookup?entity=song&id=${al.collectionId}`)).filter(i => i.wrapperType === 'track' && i.previewUrl);
      const t = byName(songs);
      if (t) return t;
    }
    const songs = (await this.get(`${API}/search?entity=song&limit=25&term=${encodeURIComponent(`${a.artist} ${a.track}`)}`))
      .filter(i => i.previewUrl && sameArtist(i.artistName));
    const t = byName(songs);
    if (t) return t;
    throw new Error(`${a.id}: no preview found for "${a.track}"`);
  }
}
