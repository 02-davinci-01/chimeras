// Pixel and abstract art from the real cover pixels. Port of reference/cover-art.js to Node:
// inputs are raw RGBA `{ width, height, data }` from sharp; marks are drawn with @napi-rs/canvas.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

export interface Raw { width: number; height: number; data: Uint8Array | Uint8ClampedArray }

export const hash = (s: string) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const rng = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function oklab(r: number, g: number, b: number): [number, number, number] {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const hex = (rgb: number[]) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const css = (rgb: number[], a = 1) => `rgba(${rgb.map(Math.round).join(',')},${a})`;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Average 2×2 blocks: a 2n×2n image becomes n×n. */
export function halve(src: Raw): Raw {
  const w = src.width >> 1, h = src.height >> 1, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const i = ((y * 2) * src.width + x * 2) * 4 + c, j = i + src.width * 4;
    out[(y * w + x) * 4 + c] = Math.round((src.data[i] + src.data[i + 4] + src.data[j] + src.data[j + 4]) / 4);
  }
  return { width: w, height: h, data: out };
}

export interface Cluster { lab: number[]; rgb: number[]; n: number; share: number; hex: string; light: number }
export interface Quantised { clusters: Cluster[]; assign: Uint8Array; lab: Float32Array; w: number; h: number }

/** Seeded k-means++ in OKLab. Clusters carry their real-cover mean colour and share. */
export function kmeans(data: Raw, k: number, seedKey: string, iters = 10): Quantised {
  const w = data.width, N = w * data.height, px = data.data, L = new Float32Array(N * 3), R = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    R[i * 3] = r; R[i * 3 + 1] = g; R[i * 3 + 2] = b; L.set(oklab(r, g, b), i * 3);
  }
  const rnd = rng(hash(seedKey)), C: number[][] = [], D = new Float32Array(N).fill(Infinity);
  const d2 = (i: number, c: number[]) => (L[i * 3] - c[0]) ** 2 + (L[i * 3 + 1] - c[1]) ** 2 + (L[i * 3 + 2] - c[2]) ** 2;
  const f = Math.floor(rnd() * N); C.push([L[f * 3], L[f * 3 + 1], L[f * 3 + 2]]);
  while (C.length < k) {
    const c = C[C.length - 1]; let sum = 0;
    for (let i = 0; i < N; i++) { const d = d2(i, c); if (d < D[i]) D[i] = d; sum += D[i]; }
    if (sum < 1e-9) break;
    let t = rnd() * sum, j = 0; for (; j < N - 1; j++) { t -= D[j]; if (t <= 0) break; }
    C.push([L[j * 3], L[j * 3 + 1], L[j * 3 + 2]]);
  }
  const A = new Uint8Array(N);
  const assign = () => { for (let i = 0; i < N; i++) { let best = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const d = d2(i, C[c]); if (d < bd) { bd = d; best = c; } } A[i] = best; } };
  for (let it = 0; it < iters; it++) {
    assign();
    const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < N; i++) { const s = S[A[i]]; s[0] += L[i * 3]; s[1] += L[i * 3 + 1]; s[2] += L[i * 3 + 2]; s[3]++; }
    S.forEach((s, c) => { if (s[3]) C[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  assign();
  const cl = C.map(lab => ({ lab, rgb: [0, 0, 0], n: 0, share: 0, hex: '', light: 0 }));
  for (let i = 0; i < N; i++) { const c = cl[A[i]]; c.n++; c.rgb[0] += R[i * 3]; c.rgb[1] += R[i * 3 + 1]; c.rgb[2] += R[i * 3 + 2]; }
  cl.forEach(c => { if (c.n) c.rgb = c.rgb.map(v => v / c.n); c.share = c.n / N; c.hex = hex(c.rgb); c.light = c.lab[0]; });
  return { clusters: cl, assign: A, lab: L, w, h: data.height };
}

/** 32×32 pixel art: quantised to the cover's own colours; Bayer dither only between two of them. */
export function pixelArt(small: Raw, colours: number, id: string): { rgba: Uint8Array; palette: string[] } {
  const grid = small.width, q = kmeans(small, colours, id + ':px'), live = q.clusters.filter(c => c.n), out = new Uint8Array(grid * grid * 4);
  for (let i = 0; i < grid * grid; i++) {
    const p = [q.lab[i * 3], q.lab[i * 3 + 1], q.lab[i * 3 + 2]];
    let c1: Cluster | null = null, e1 = Infinity, c2: Cluster | null = null, e2 = Infinity;
    for (const c of live) {
      const e = Math.hypot(p[0] - c.lab[0], p[1] - c.lab[1], p[2] - c.lab[2]);
      if (e < e1) { c2 = c1; e2 = e1; c1 = c; e1 = e; } else if (e < e2) { c2 = c; e2 = e; }
    }
    const t = c2 ? e1 / (e1 + e2) : 0, mix = Math.max(0, (t - 0.12) / 0.38) * 0.5;
    const th = (BAYER[(((i / grid) | 0) & 3) * 4 + ((i % grid) & 3)] + 0.5) / 16;
    const c = (mix > th ? c2 : c1)!;
    out[i * 4] = Math.round(c.rgb[0]); out[i * 4 + 1] = Math.round(c.rgb[1]); out[i * 4 + 2] = Math.round(c.rgb[2]); out[i * 4 + 3] = 255;
  }
  const palette = live.slice().sort((a, b) => b.share - a.share).map(c => c.hex);
  while (palette.length < colours) palette.push(palette[palette.length - 1] ?? '#808080');
  return { rgba: out, palette };
}

/* ---------- abstract: the cover's colour map, redrawn with a kingdom mark ---------- */
type Ctx = SKRSContext2D;
type Mark = (x: Ctx, S: number, q: Quantised, rnd: () => number) => void;

const at = (q: Quantised, u: number, v: number) => q.clusters[q.assign[Math.min(q.h - 1, Math.max(0, Math.floor(v * q.h))) * q.w + Math.min(q.w - 1, Math.max(0, Math.floor(u * q.w)))]];
function mode(q: Quantised, u0: number, v0: number, u1: number, v1: number) {
  const cnt = new Map<Cluster, number>(); let best = q.clusters[0], bn = -1;
  for (let y = Math.floor(v0 * q.h); y < Math.max(Math.floor(v0 * q.h) + 1, Math.floor(v1 * q.h)); y++)
    for (let x = Math.floor(u0 * q.w); x < Math.max(Math.floor(u0 * q.w) + 1, Math.floor(u1 * q.w)); x++) {
      const c = q.clusters[q.assign[Math.min(q.h - 1, y) * q.w + Math.min(q.w - 1, x)]], n = (cnt.get(c) || 0) + 1;
      cnt.set(c, n); if (n > bn) { bn = n; best = c; }
    }
  return best;
}
const dominant = (q: Quantised) => q.clusters.reduce((a, b) => b.share > a.share ? b : a);
const lightest = (q: Quantised, min: number) => q.clusters.filter(c => c.share >= min).reduce((a, b) => b.light > a.light ? b : a, dominant(q));
function flatMap(q: Quantised): Canvas {
  const c = createCanvas(q.w, q.h), x = c.getContext('2d'), o = x.createImageData(q.w, q.h);
  for (let i = 0; i < q.w * q.h; i++) { const k = q.clusters[q.assign[i]]; o.data[i * 4] = k.rgb[0]; o.data[i * 4 + 1] = k.rgb[1]; o.data[i * 4 + 2] = k.rgb[2]; o.data[i * 4 + 3] = 255; }
  x.putImageData(o, 0, 0); return c;
}
function grain(x: Ctx, S: number, rnd: () => number, a: number) {
  const g = createCanvas(S, S), gx = g.getContext('2d'), o = gx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const v = rnd() * 255; o.data[i * 4] = o.data[i * 4 + 1] = o.data[i * 4 + 2] = v; o.data[i * 4 + 3] = a * 255; }
  gx.putImageData(o, 0, 0); x.drawImage(g, 0, 0);
}
/** Separable box blur, three passes ≈ gaussian. Used instead of ctx.filter, whose support varies in Node. */
function boxBlur(c: Canvas, radius: number) {
  const x = c.getContext('2d'), w = c.width, h = c.height, img = x.getImageData(0, 0, w, h), d = img.data, tmp = new Float32Array(d.length);
  const r = Math.max(1, Math.round(radius)), n = r * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let ch = 0; ch < 4; ch++) {
      let s = 0; for (let k = -r; k <= r; k++) s += d[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + ch];
      for (let xx = 0; xx < w; xx++) {
        tmp[(y * w + xx) * 4 + ch] = s / n;
        s += d[(y * w + Math.min(w - 1, xx + r + 1)) * 4 + ch] - d[(y * w + Math.max(0, xx - r)) * 4 + ch];
      }
    }
    for (let xx = 0; xx < w; xx++) for (let ch = 0; ch < 4; ch++) {
      let s = 0; for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, k)) * w + xx) * 4 + ch];
      for (let y = 0; y < h; y++) {
        d[(y * w + xx) * 4 + ch] = s / n;
        s += tmp[(Math.min(h - 1, y + r + 1) * w + xx) * 4 + ch] - tmp[(Math.max(0, y - r) * w + xx) * 4 + ch];
      }
    }
  }
  x.putImageData(img, 0, 0);
}

export const MARKS: Record<string, Mark> = {
  // Rock: the cover itself, smeared downward and warped sideways, then buried in grain.
  smear(x, S, q, rnd) {
    const flat = flatMap(q), m = createCanvas(S, S), mx = m.getContext('2d');
    x.fillStyle = css(dominant(q).rgb); x.fillRect(0, 0, S, S);
    mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high'; mx.drawImage(flat, 0, 0, S, S);
    boxBlur(m, S / 160);
    const copy = createCanvas(S, S), cx = copy.getContext('2d');
    for (let k = 1; k <= 14; k++) {
      cx.clearRect(0, 0, S, S); cx.drawImage(m, 0, 0);
      mx.globalAlpha = 0.11; mx.drawImage(copy, (rnd() - 0.5) * S * 0.02, k * S / 70);
    }
    mx.globalAlpha = 1;
    const strip = Math.max(2, S / 80);
    for (let y = 0; y < S; y += strip) x.drawImage(m, 0, y, S, strip, Math.sin(y / S * 9 + rnd() * 0.6) * S * 0.025, y, S, strip);
    grain(x, S, rnd, 0.16);
  },
  // Indie: bare strings across empty space; a string only shows where the cover has colour.
  strings(x, S, q, rnd) {
    const bg = lightest(q, 0.08); x.fillStyle = css(bg.rgb); x.fillRect(0, 0, S, S);
    const lines = 26, segs = 48, gap = S / lines;
    x.lineCap = 'round';
    for (let l = 0; l < lines; l++) {
      const y = (l + 0.5) * gap + (rnd() - 0.5) * gap * 0.25;
      for (let s = 0; s < segs; s++) {
        const c = at(q, (s + 0.5) / segs, y / S); if (c === bg) continue;
        x.strokeStyle = css(c.rgb); x.lineWidth = Math.max(1, S / 220 * (1.4 - c.light));
        x.beginPath(); x.moveTo(s * S / segs, y); x.lineTo((s + 1) * S / segs + 0.5, y + (rnd() - 0.5) * 0.8); x.stroke();
      }
    }
  },
  // Electronic: the cover as a quantised cell grid, with a few rows slipped sideways.
  grid(x, S, q, rnd) {
    const n = 12, cell = S / n, gap = Math.max(1, S / 160);
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    const slip = new Map<number, number>(); for (let k = 0; k < 3; k++) slip.set(Math.floor(rnd() * n), Math.floor(rnd() * 3) + 1);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const sc = (c - (slip.get(r) || 0) + n) % n;
      if (rnd() < 0.12) {
        for (let k = 0; k < 4; k++) {
          const dx = k & 1, dy = k >> 1;
          x.fillStyle = css(mode(q, (sc + dx / 2) / n, (r + dy / 2) / n, (sc + dx / 2 + 0.5) / n, (r + dy / 2 + 0.5) / n).rgb);
          x.fillRect(c * cell + dx * cell / 2, r * cell + dy * cell / 2, cell / 2 - gap, cell / 2 - gap);
        }
      } else { x.fillStyle = css(mode(q, sc / n, r / n, (sc + 1) / n, (r + 1) / n).rgb); x.fillRect(c * cell, r * cell, cell - gap, cell - gap); }
    }
  },
  // Hip-hop: halftone. Dot size is how dark the cover is there; dot colour is the cover's colour there.
  halftone(x, S, q) {
    const bg = lightest(q, 0.08); x.fillStyle = css(bg.rgb); x.fillRect(0, 0, S, S);
    const n = 22, cell = S / n;
    for (let r = 0; r < n + 1; r++) for (let c = 0; c < n + 1; c++) {
      const cx = (c + (r & 1 ? 0.5 : 0)) * cell, cy = (r + 0.5) * cell * 0.92, k = at(q, cx / S, cy / S);
      if (k === bg) continue;
      const rad = cell * 0.5 * (0.35 + 0.85 * Math.min(1, Math.max(0, 1.05 - k.light)));
      x.fillStyle = css(k.rgb); x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    }
  },
};

/** Abstract art at S×S from a 48×48 sample, as PNG bytes. */
export function abstractArt(sample: Raw, mark: string, size: number, id: string): Buffer {
  const q = kmeans(sample, 6, id + ':abs'), out = createCanvas(size, size), x = out.getContext('2d');
  (MARKS[mark] ?? MARKS.smear)(x, size, q, rng(hash(id + mark)));
  return out.toBuffer('image/png');
}
