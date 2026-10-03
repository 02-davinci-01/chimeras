// Cover download and art baking (SPEC 6.3), cached by cover hash + algorithm version + kingdom.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { AlbumFile, AppConfig, Kingdom } from '../types.ts';
import { abstractArt, halve, pixelArt, type Raw } from './core.ts';

/** Bump when the art output changes, so every album re-bakes. 2: the cover and abstract art went to WebP. */
export const ART_VERSION = 2;

interface CacheEntry { cover: string; version: number; kingdom: string; palette: string[] }
type Cache = Record<string, CacheEntry>;

export interface ArtResult { cover: string | null; pixel: string | null; abstract: string | null; palette: string[] }

export class ArtBaker {
  private cache: Cache;
  private cacheFile: string;
  constructor(private root: string, private cfg: AppConfig, private log: (s: string) => void) {
    fs.mkdirSync(path.join(root, 'covers'), { recursive: true });
    fs.mkdirSync(path.join(root, 'art'), { recursive: true });
    this.cacheFile = path.join(root, 'art', '.cache.json');
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { this.cache = {}; }
  }

  coverPath(id: string) { return path.join(this.root, 'covers', `${id}.jpg`); }

  /** Download the cover once. Returns false when there is no cover to be had. */
  async ensureCover(album: AlbumFile): Promise<boolean> {
    const file = this.coverPath(album.id);
    if (fs.existsSync(file)) return true;
    if (!album.cover) return false;
    const res = await fetch(album.cover);
    if (!res.ok) throw new Error(`${album.id}: cover download failed (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const size = this.cfg.art.coverSize;
    await sharp(buf).resize(size, size, { fit: 'cover' }).jpeg({ quality: 92 }).toFile(file + '.tmp');
    fs.renameSync(file + '.tmp', file);
    this.log(`  cover  ${album.id}`);
    return true;
  }

  async bake(album: AlbumFile, kingdom: Kingdom): Promise<ArtResult> {
    const cover = this.coverPath(album.id);
    if (!fs.existsSync(cover)) return { cover: null, pixel: null, abstract: null, palette: [] };
    const coverHash = crypto.createHash('sha1').update(fs.readFileSync(cover)).digest('hex');
    // The pages get WebP: the covers at half the JPEG's weight, the grainy abstract art at a fifth of the PNG's.
    // covers/ keeps the downloaded JPEG as the source everything is baked from.
    const coverRel = `art/${album.id}.cover.webp`, pixelRel = `art/${album.id}.pixel.png`, absRel = `art/${album.id}.abstract.webp`;
    const hit = this.cache[album.id];
    const fresh = hit && hit.cover === coverHash && hit.version === ART_VERSION && hit.kingdom === kingdom.key
      && [coverRel, pixelRel, absRel].every(f => fs.existsSync(path.join(this.root, f)));
    if (fresh) return { cover: coverRel, pixel: pixelRel, abstract: absRel, palette: hit.palette };

    const { pixelGrid: grid, pixelColours: colours, abstractSize } = this.cfg.art;
    const raw = async (n: number): Promise<Raw> => {
      const { data, info } = await sharp(cover).removeAlpha().ensureAlpha().resize(n, n, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data: new Uint8Array(data) };
    };
    // Area-average down to the grid: resize to 2× with sharp, then average 2×2 blocks.
    const px = pixelArt(halve(await raw(grid * 2)), colours, album.id);
    await writeAtomic(path.join(this.root, pixelRel), await sharp(Buffer.from(px.rgba), { raw: { width: grid, height: grid, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
    await writeAtomic(path.join(this.root, absRel), await sharp(abstractArt(halve(await raw(96)), kingdom.mark, abstractSize, album.id)).webp({ quality: 88, effort: 6 }).toBuffer());
    await writeAtomic(path.join(this.root, coverRel), await sharp(cover).webp({ quality: 82, effort: 6 }).toBuffer());

    this.cache[album.id] = { cover: coverHash, version: ART_VERSION, kingdom: kingdom.key, palette: px.palette };
    this.log(`  art    ${album.id}`);
    return { cover: coverRel, pixel: pixelRel, abstract: absRel, palette: px.palette };
  }

  /** Drop the covers, art and cache entries of albums that are gone, and art left over from older versions. */
  prune(ids: Set<string>) {
    const keep = (f: string) => {
      const m = /^(.+?)\.(cover\.webp|pixel\.png|abstract\.webp|jpg)$/.exec(f);
      return !!m && ids.has(m[1]);
    };
    for (const dir of ['art', 'covers']) for (const f of fs.readdirSync(path.join(this.root, dir))) {
      if (f.startsWith('.') || keep(f)) continue;
      fs.rmSync(path.join(this.root, dir, f));
      this.log(`  prune  ${dir}/${f}`);
    }
    for (const id of Object.keys(this.cache)) if (!ids.has(id)) delete this.cache[id];
  }

  save() { writeAtomicSync(this.cacheFile, JSON.stringify(this.cache, null, 2) + '\n'); }
}

async function writeAtomic(file: string, data: Buffer) {
  await fs.promises.writeFile(file + '.tmp', data);
  await fs.promises.rename(file + '.tmp', file);
}
export function writeAtomicSync(file: string, data: string) {
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
}
