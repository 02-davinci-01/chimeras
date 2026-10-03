// The build pipeline (SPEC 6.1): load + validate → read Logseq → covers → art → derive → write.
import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ArtBaker, writeAtomicSync, type ArtResult } from './art/bake.ts';
import { graphReader, type GraphReader } from './logseq/graph.ts';
import { Previews } from './previews.ts';
import {
  STAT_KEYS,
  type AlbumFile, type AlbumOut, type AppConfig, type Catalogue, type Kingdom,
  type LogseqPage, type PackFile, type RarityConfig, type SceneKey, type SongConfig, type SongOut, type StatKey,
} from './types.ts';

export class BuildError extends Error {}

interface PageInfo { page: LogseqPage | null; mtime: number }

export interface BuildOptions {
  root: string;                    // where albums/, packs/, covers/, art/, dist/ live
  configDir?: string;              // config/ to read; falls back to <repo>/config per file
  log?: (s: string) => void;
}

export class Builder {
  readonly root: string;
  private repo = path.resolve(import.meta.dirname, '..');
  private log: (s: string) => void;
  cfg!: AppConfig;
  kingdoms!: Kingdom[];
  rarity!: RarityConfig;
  songs: Partial<Record<SceneKey, SongConfig>> = {};
  graph!: GraphReader;
  private baker!: ArtBaker;
  private previews!: Previews;
  private ajv = new Ajv2020({ allErrors: false, strict: false });
  private validateAlbum!: ReturnType<Ajv2020['compile']>;
  private validatePack!: ReturnType<Ajv2020['compile']>;
  private albums = new Map<string, AlbumFile>();
  private packs = new Map<string, PackFile>();
  private pages = new Map<string, PageInfo>();     // page name (lower) → parsed page
  private art = new Map<string, ArtResult>();

  constructor(private opts: BuildOptions) {
    this.root = path.resolve(opts.root);
    this.log = opts.log ?? (s => console.log(s));
    (addFormats as unknown as (a: Ajv2020) => void)(this.ajv);
  }

  private configFile(name: string) {
    const own = path.join(this.opts.configDir ?? path.join(this.root, 'config'), name);
    return fs.existsSync(own) ? own : path.join(this.repo, 'config', name);
  }

  private readJson<T>(file: string): T {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new BuildError(`${path.relative(this.root, file) || file}: invalid JSON (${(e as Error).message})`); }
  }

  /** Step 1a: config, schemas, graph reader. */
  loadConfig() {
    this.cfg = this.readJson<AppConfig>(this.configFile('catalogue.config.json'));
    if (this.cfg.server.host !== '127.0.0.1') throw new BuildError('config: server.host must stay 127.0.0.1');
    this.kingdoms = this.readJson<{ kingdoms: Kingdom[] }>(this.configFile('kingdoms.json')).kingdoms;
    this.rarity = this.readJson<RarityConfig>(this.configFile('rarity.json'));
    const sounds = this.configFile('sounds.json');
    this.songs = fs.existsSync(sounds) ? this.readJson<{ scenes: Partial<Record<SceneKey, SongConfig>> }>(sounds).scenes : {};
    const schemaDir = path.join(this.repo, 'schema');
    this.validateAlbum = this.ajv.compile(this.readJson(path.join(schemaDir, 'album.schema.json')));
    this.validatePack = this.ajv.compile(this.readJson(path.join(schemaDir, 'pack.schema.json')));
    this.graph = graphReader(this.cfg, this.root);
    this.baker = new ArtBaker(this.root, this.cfg, this.log);
    this.previews = new Previews(this.root, this.log, path.join(this.root, 'sounds'));
  }

  /** Step 1b: one album file. Throws on the first invalid file. */
  loadAlbum(file: string) {
    const a = this.readJson<AlbumFile>(file);
    const rel = path.relative(this.root, file);
    if (!this.validateAlbum(a)) throw new BuildError(`${rel}: ${this.ajv.errorsText(this.validateAlbum.errors, { dataVar: 'album' })}`);
    if (`${a.id}.json` !== path.basename(file)) throw new BuildError(`${rel}: id "${a.id}" must match the file name`);
    this.albums.set(a.id, a);
    return a;
  }

  loadPack(file: string) {
    const p = this.readJson<PackFile>(file);
    const rel = path.relative(this.root, file);
    if (!this.validatePack(p)) throw new BuildError(`${rel}: ${this.ajv.errorsText(this.validatePack.errors, { dataVar: 'pack' })}`);
    if (`${p.week}.json` !== path.basename(file)) throw new BuildError(`${rel}: week "${p.week}" must match the file name`);
    this.packs.set(p.week, p);
  }

  removeAlbum(id: string) { this.albums.delete(id); this.art.delete(id); }
  removePack(week: string) { this.packs.delete(week); }

  loadAll() {
    this.albums.clear(); this.packs.clear();
    const files = (dir: string) => {
      const d = path.join(this.root, dir);
      return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => path.join(d, f)) : [];
    };
    for (const f of files('albums')) this.loadAlbum(f);
    for (const f of files('packs')) this.loadPack(f);
  }

  /** Step 2: (re)read pages. With `only`, just those page names. */
  async readPages(only?: string[]) {
    try { await this.graph.index(); }
    catch (e) { throw new BuildError(`Logseq graph unreadable: ${(e as Error).message}`); }
    const wanted = only ?? [...this.albums.values()].map(a => a.logseq.page);
    for (const name of wanted) this.pages.set(name.toLowerCase(), { page: await this.graph.read(name), mtime: Date.now() });
  }

  /** Steps 3–4: covers and art, for every album or just `ids`. A full pass also clears out what removed albums left. */
  async bakeArt(ids?: string[]) {
    const list = (ids ?? [...this.albums.keys()]).map(id => this.albums.get(id)).filter(Boolean) as AlbumFile[];
    // Download in parallel (network bound), bake one at a time (CPU bound, keeps memory flat).
    await Promise.all(list.map(a => this.baker.ensureCover(a).catch(e => { this.log(`  ! ${(e as Error).message}`); return false; })));
    for (const a of list) this.art.set(a.id, await this.baker.bake(a, this.kingdom(a.kingdom)));
    if (!ids) this.baker.prune(new Set(this.albums.keys()));
    this.baker.save();
  }

  /** Step 4b: track previews, for every album or just `ids`. A miss is a warning, never a failed build. */
  async fetchPreviews(ids?: string[]) {
    const list = (ids ?? [...this.albums.keys()]).map(id => this.albums.get(id)).filter(Boolean) as AlbumFile[];
    await Promise.all(list.map(a => this.previews.ensure(a).catch(e => this.log(`  ! ${(e as Error).message}`))));
    if (!ids) this.previews.prune(new Set(this.albums.keys()));
    this.previews.save();
  }

  kingdom(key: string) { return this.kingdoms.find(k => k.key === key) ?? this.kingdoms[0]; }

  /** Steps 5–6: derive state, rarity, numbers and threads. */
  assemble(): { catalogue: Catalogue; search: Record<string, string> } {
    const warnings: string[] = [];
    const warn = (id: string, msg: string) => warnings.push(`${id}: ${msg}`);
    const tiers = this.rarity.tiers;
    const search: Record<string, string> = {};

    const ordered = [...this.albums.values()].sort((a, b) => a.added.localeCompare(b.added) || a.id.localeCompare(b.id));
    const albums: AlbumOut[] = ordered.map((a, i) => {
      const info = this.pages.get(a.logseq.page.toLowerCase());
      const page = info?.page ?? null;
      const props = page?.properties ?? {};
      if (!page) warn(a.id, `no Logseq page named "${a.logseq.page}"`);

      let rating: number | null = null;
      if (props.rating) {
        const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*10)?$/.exec(props.rating);
        const v = m ? Number(m[1]) : NaN;
        if (Number.isFinite(v) && v >= 0 && v <= 10) rating = v;
        else warn(a.id, `rating:: "${props.rating}" is not a number from 0 to 10`);
      }
      const stats = {} as Record<StatKey, number | null>;
      for (const k of STAT_KEYS) {
        stats[k] = null;
        const raw = props[k];
        if (!raw) { if (page && rating != null) warn(a.id, `page has no \`${k}::\` property`); continue; }
        const m = /^(\d+)(?:\s*\/\s*5)?$/.exec(raw);
        const v = m ? Number(m[1]) : NaN;
        if (Number.isInteger(v) && v >= 1 && v <= 5) stats[k] = v;
        else warn(a.id, `${k}:: "${raw}" is not a whole number from 1 to 5`);
      }

      const state = rating != null ? 'open' : a.pack ? 'sealed' : 'unrated';
      let rarity: string | null = null;
      if (state === 'open') {
        const override = props.rarity?.toLowerCase();
        if (override && !tiers.some(t => t.key === override)) warn(a.id, `rarity:: "${props.rarity}" is not a tier (${tiers.map(t => t.key).join(', ')})`);
        rarity = override && tiers.some(t => t.key === override) ? override : tiers.find(t => rating! >= t.rule.minRating)?.key ?? tiers[tiers.length - 1].key;
      }

      const alsoOf = (x: AlbumFile) => {
        if (x.also?.includes(x.kingdom)) warn(x.id, `\`also\` repeats its own kingdom (${x.kingdom})`);
        return (x.also ?? []).filter(k => k !== x.kingdom);
      };
      const art = this.art.get(a.id) ?? { cover: null, pixel: null, abstract: null, palette: [] };
      if (!art.pixel) warn(a.id, a.cover ? 'cover art is missing (download failed?)' : 'no cover URL');
      const pv = this.previews.result(a);
      if (pv && !pv.file) warn(a.id, `no preview for track "${a.track}" (not found, or offline)`);

      return {
        id: a.id, no: String(i + 1).padStart(3, '0'), title: a.title, artist: a.artist, year: a.year,
        spotify: a.spotify ?? null, runtime: a.runtime ?? null, kingdom: a.kingdom, also: alsoOf(a), added: a.added,
        first: a.first ?? null, pack: a.pack ?? null, state, rating, rarity, stats, art,
        track: pv ? { name: pv.name, no: pv.no, preview: pv.file } : null,
        // Reviews are private: no excerpt, no link into the graph.
        excerpt: '',
        logseq: { page: page?.name ?? a.logseq.page },
      };
    });

    // Packs ↔ albums agreement.
    for (const p of this.packs.values()) for (const id of p.albums) {
      const a = this.albums.get(id);
      if (!a) warnings.push(`pack ${p.week}: lists "${id}", which has no album file`);
      else if (a.pack !== p.week) warn(id, `listed in pack ${p.week} but its \`pack\` is ${a.pack ?? 'null'}`);
    }
    for (const a of this.albums.values()) if (a.pack && !this.packs.get(a.pack)?.albums.includes(a.id)) warn(a.id, `\`pack\` is ${a.pack} but that pack does not list it`);

    const sounds: Partial<Record<SceneKey, SongOut>> = {};
    for (const [key, s] of Object.entries(this.songs) as [SceneKey, SongConfig][]) {
      if (!fs.existsSync(path.join(this.root, 'sounds', s.file))) { warnings.push(`sounds: ${key} song "${s.file}" is not in sounds/`); continue; }
      sounds[key] = { url: `sounds/${encodeURIComponent(s.file)}`, title: s.title, artist: s.artist, lufs: s.lufs };
    }

    const catalogue: Catalogue = {
      generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      sounds,
      kingdoms: this.kingdoms,
      rarity: tiers,
      starPath: this.rarity.starPath,
      starViewBox: this.rarity.starViewBox,
      packs: [...this.packs.values()].sort((a, b) => a.week.localeCompare(b.week)).map(p => ({ week: p.week, made: p.made, note: p.note ?? null, albums: p.albums })),
      albums,
      warnings,
    };
    return { catalogue, search };
  }

  /** Step 7: write dist/ atomically. */
  write(out: { catalogue: Catalogue; search: Record<string, string> }) {
    const dist = path.join(this.root, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    writeAtomicSync(path.join(dist, 'catalogue.json'), JSON.stringify(out.catalogue, null, 2) + '\n');
    writeAtomicSync(path.join(dist, 'search.json'), JSON.stringify(out.search) + '\n');
  }

  /**
   * The public snapshot in site/, committed so a host can serve it without the Logseq graph: the catalogue, the art,
   * and an empty search index. Previews stream from Apple. The songs in sounds/ stay local (they're whole commercial
   * tracks), so every scene plays its generative loop. Build warnings stay local too.
   */
  async exportSite(cat: Catalogue) {
    const site = path.join(this.root, 'site');
    fs.rmSync(site, { recursive: true, force: true });
    fs.mkdirSync(path.join(site, 'art'), { recursive: true });
    const albums = await Promise.all(cat.albums.map(async a => {
      const src = this.albums.get(a.id)!;
      for (const f of [a.art.cover, a.art.pixel, a.art.abstract]) if (f) fs.copyFileSync(path.join(this.root, f), path.join(site, f));
      const pv = await this.previews.remote(src);
      return { ...a, track: pv ? { name: pv.name, no: pv.no, preview: pv.file } : null };
    }));
    this.previews.save();
    const out: Catalogue = { ...cat, sounds: {}, albums, warnings: [] };
    fs.writeFileSync(path.join(site, 'catalogue.json'), JSON.stringify(out) + '\n');
    fs.writeFileSync(path.join(site, 'search.json'), '{}\n');
    const missing = albums.filter(a => a.track && !a.track.preview).map(a => a.id);
    this.log(`site/: ${albums.length} albums${missing.length ? ` (no Apple preview: ${missing.join(', ')})` : ''}`);
  }

  /** The whole pipeline. */
  async build() {
    this.loadConfig();
    this.loadAll();
    await this.readPages();
    await this.bakeArt();
    await this.fetchPreviews();
    const out = this.assemble();
    this.write(out);
    return out;
  }

  /** Watch-mode entry points. */
  albumIds() { return [...this.albums.keys()]; }
  album(id: string) { return this.albums.get(id); }
  albumsForPage(name: string) { return [...this.albums.values()].filter(a => a.logseq.page.toLowerCase() === name.toLowerCase()); }
  pageNames() { return [...new Set([...this.albums.values()].map(a => a.logseq.page))]; }
}

