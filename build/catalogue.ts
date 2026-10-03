// The build pipeline (SPEC 6.1): load + validate → read Logseq → covers → art → derive → people → write.
import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ArtBaker, writeAtomicSync, type ArtResult } from './art/bake.ts';
import { graphReader, type GraphReader } from './logseq/graph.ts';
import { allText, excerpt, toPlain } from './logseq/text.ts';
import {
  HEADS, STAT_KEYS,
  type AlbumFile, type AlbumOut, type AppConfig, type Catalogue, type Gait, type HeadName, type Kingdom,
  type KingdomKey, type LogseqPage, type PackFile, type PersonOut, type RarityConfig, type StatKey,
} from './types.ts';

export class BuildError extends Error {}

const BASE_DEFAULTS: Record<KingdomKey, { head: HeadName; gait: Gait; tempo: number }> = {
  rock: { head: 'default', gait: 'stride', tempo: 1 },
  electronic: { head: 'cube', gait: 'hop', tempo: 1 },
  hiphop: { head: 'default', gait: 'stride', tempo: 0.8 },
  indie: { head: 'default', gait: 'shuffle', tempo: 1 },
};

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
  graph!: GraphReader;
  private baker!: ArtBaker;
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
    const schemaDir = path.join(this.repo, 'schema');
    this.validateAlbum = this.ajv.compile(this.readJson(path.join(schemaDir, 'album.schema.json')));
    this.validatePack = this.ajv.compile(this.readJson(path.join(schemaDir, 'pack.schema.json')));
    this.graph = graphReader(this.cfg, this.root);
    this.baker = new ArtBaker(this.root, this.cfg, this.log);
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

  /** Steps 3–4: covers and art, for every album or just `ids`. */
  async bakeArt(ids?: string[]) {
    const list = (ids ?? [...this.albums.keys()]).map(id => this.albums.get(id)).filter(Boolean) as AlbumFile[];
    // Download in parallel (network bound), bake one at a time (CPU bound, keeps memory flat).
    await Promise.all(list.map(a => this.baker.ensureCover(a).catch(e => { this.log(`  ! ${(e as Error).message}`); return false; })));
    for (const a of list) this.art.set(a.id, await this.baker.bake(a, this.kingdom(a.kingdom)));
    this.baker.save();
  }

  kingdom(key: string) { return this.kingdoms.find(k => k.key === key) ?? this.kingdoms[0]; }

  /** Trait modules that exist in web/world/traits/ (index.ts and helpers excluded). */
  private traitNames(): Set<string> {
    const dir = path.join(this.repo, 'web', 'world', 'traits');
    if (!fs.existsSync(dir)) return new Set();
    return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts').map(f => f.slice(0, -3)));
  }

  /** Steps 5–6: derive state, rarity, numbers and people. */
  assemble(): { catalogue: Catalogue; search: Record<string, string> } {
    const warnings: string[] = [];
    const warn = (id: string, msg: string) => warnings.push(`${id}: ${msg}`);
    const traits = this.traitNames();
    const tiers = this.rarity.tiers;
    const search: Record<string, string> = {};
    const resolve = (uuid: string) => { const t = this.graph.blockText(uuid); return t == null ? null : toPlain(t); };

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

      const art = this.art.get(a.id) ?? { cover: null, pixel: null, abstract: null, palette: [] };
      if (!art.pixel) warn(a.id, a.cover ? 'cover art is missing (download failed?)' : 'no cover URL');
      if (page) search[a.id] = allText(page.blocks, resolve);

      return {
        id: a.id, no: String(i + 1).padStart(3, '0'), title: a.title, artist: a.artist, year: a.year,
        spotify: a.spotify ?? null, runtime: a.runtime ?? null, kingdom: a.kingdom, added: a.added,
        first: a.first ?? null, pack: a.pack ?? null, state, rating, rarity, stats, art,
        excerpt: page ? excerpt(page.blocks, resolve) : '',
        logseq: { page: page?.name ?? a.logseq.page, url: `logseq://graph/${encodeURIComponent(this.cfg.logseq.graphName)}?page=${encodeURIComponent(page?.name ?? a.logseq.page)}` },
        person: this.person(a, art.palette, traits, m => warn(a.id, m)),
      };
    });

    // Packs ↔ albums agreement.
    for (const p of this.packs.values()) for (const id of p.albums) {
      const a = this.albums.get(id);
      if (!a) warnings.push(`pack ${p.week}: lists "${id}", which has no album file`);
      else if (a.pack !== p.week) warn(id, `listed in pack ${p.week} but its \`pack\` is ${a.pack ?? 'null'}`);
    }
    for (const a of this.albums.values()) if (a.pack && !this.packs.get(a.pack)?.albums.includes(a.id)) warn(a.id, `\`pack\` is ${a.pack} but that pack does not list it`);

    const catalogue: Catalogue = {
      generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      kingdoms: this.kingdoms,
      rarity: tiers,
      starPath: this.rarity.starPath,
      starViewBox: this.rarity.starViewBox,
      graphName: this.cfg.logseq.graphName,
      packs: [...this.packs.values()].sort((a, b) => a.week.localeCompare(b.week)).map(p => ({ week: p.week, made: p.made, note: p.note ?? null, albums: p.albums })),
      albums,
      warnings,
    };
    return { catalogue, search };
  }

  private person(a: AlbumFile, palette: string[], traits: Set<string>, warn: (m: string) => void): PersonOut {
    const p = a.person ?? {};
    const base = p.base ?? a.kingdom;
    const d = BASE_DEFAULTS[base];
    let head = (p.head ?? d.head) as HeadName;
    if (!HEADS.includes(head)) { warn(`unknown head "${p.head}"`); head = d.head; }
    const known = (p.traits ?? []).filter(t => { if (traits.has(t)) return true; warn(`unknown trait "${t}"`); return false; });
    const colour = (v: string | undefined, fallback: string) => {
      if (!v) return fallback;
      const m = /^palette:(\d)$/.exec(v);
      return m ? palette[Number(m[1])] ?? fallback : v.toUpperCase();
    };
    const body = colour(p.colours?.body, palette[0] ?? '#808080');
    const colours: PersonOut['colours'] = {
      body,
      accent: colour(p.colours?.accent, palette[2] ?? body),
      skin: colour(p.colours?.skin, scaleLightness(body, 0.6)),
    };
    for (const [k, v] of Object.entries(p.colours ?? {})) if (!(k in colours)) colours[k] = colour(v, body);
    return {
      brief: p.brief ?? '',
      base,
      build: { height: p.build?.height ?? 1, mass: p.build?.mass ?? 1 },
      head,
      traits: known,
      motion: { gait: p.motion?.gait ?? d.gait, tempo: p.motion?.tempo ?? d.tempo, bpm: p.motion?.bpm ?? null },
      colours,
    };
  }

  /** Step 7: write dist/ atomically. */
  write(out: { catalogue: Catalogue; search: Record<string, string> }) {
    const dist = path.join(this.root, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    writeAtomicSync(path.join(dist, 'catalogue.json'), JSON.stringify(out.catalogue, null, 2) + '\n');
    writeAtomicSync(path.join(dist, 'search.json'), JSON.stringify(out.search) + '\n');
  }

  /** The whole pipeline. */
  async build() {
    this.loadConfig();
    this.loadAll();
    await this.readPages();
    await this.bakeArt();
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

/** Multiply a hex colour's HSL lightness. */
export function scaleLightness(hexColour: string, f: number): string {
  const n = parseInt(hexColour.slice(1), 16);
  let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, dd = max - min;
  let h = 0, s = 0;
  if (dd) {
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h /= 6;
  }
  const L = l * f;
  const q = L < 0.5 ? L * (1 + s) : L + s - L * s, p = 2 * L - q;
  const ch = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  [r, g, b] = s ? [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)] : [L, L, L];
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
