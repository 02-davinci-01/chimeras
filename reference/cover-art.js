/* REFERENCE ONLY (v2 prototype, browser). Port the core (kmeans, pixelArt, MARKS, abstractArt) to the Node builder: feed it raw RGBA from sharp in an ImageData-shaped object {width,height,data} and draw marks with @napi-rs/canvas or node-canvas. Defaults now 32 grid / 8 colours. Marks used: rock=smear, electronic=grid, hiphop=halftone, indie=strings. */
/* cover-art.js
   Everything here starts from the real cover pixels. Nothing is generated from a hand-set palette.
   pixel    : cover downsampled (area average) to an N×N grid, quantised to the cover's own K colours
              (k-means in OKLab), ordered dither only where a pixel sits between two of those colours.
   abstract : the cover's own colour map (where each colour actually is), redrawn with the kingdom's mark.
   The core functions take ImageData, so the builder can run the same code in Node and bake data URIs. */
(function (global) {
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  function oklab(r, g, b) {
    r = lin(r); g = lin(g); b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  const hex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const css = (rgb, a = 1) => `rgba(${rgb.map(Math.round).join(',')},${a})`;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      img.onload = () => res(img); img.onerror = () => rej(Object.assign(new Error('Cover did not load'), { kind: 'load' }));
      img.src = url;
    });
  }

  // Area-average downsample: halve repeatedly, then one final high-quality draw.
  function downsample(img, n) {
    let src = img, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    while (w / 2 >= n * 2) {
      w = Math.round(w / 2); h = Math.round(h / 2);
      const t = canvas(w, h), x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h); src = t;
    }
    const c = canvas(n), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, n, n);
    try { return x.getImageData(0, 0, n, n); }
    catch (e) { throw Object.assign(new Error('Cover pixels are blocked on this origin'), { kind: 'cors' }); }
  }

  // k-means++ in OKLab. Returns clusters with real-cover colour, share and position.
  function kmeans(data, k, seedKey, iters = 10) {
    const w = data.width, N = w * data.height, px = data.data, L = new Float32Array(N * 3), R = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; R[i * 3] = r; R[i * 3 + 1] = g; R[i * 3 + 2] = b; L.set(oklab(r, g, b), i * 3); }
    const rnd = rng(hash(seedKey)), C = [], D = new Float32Array(N).fill(Infinity), d2 = (i, c) => (L[i * 3] - c[0]) ** 2 + (L[i * 3 + 1] - c[1]) ** 2 + (L[i * 3 + 2] - c[2]) ** 2;
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
    const cl = C.map(lab => ({ lab, rgb: [0, 0, 0], n: 0, cx: 0, cy: 0 }));
    for (let i = 0; i < N; i++) { const c = cl[A[i]]; c.n++; c.rgb[0] += R[i * 3]; c.rgb[1] += R[i * 3 + 1]; c.rgb[2] += R[i * 3 + 2]; c.cx += i % w; c.cy += (i / w) | 0; }
    cl.forEach(c => { if (c.n) { c.rgb = c.rgb.map(v => v / c.n); c.cx /= c.n * w; c.cy /= c.n * w; } c.share = c.n / N; c.hex = hex(c.rgb); c.light = c.lab[0]; });
    return { clusters: cl, assign: A, lab: L, w, h: data.height };
  }

  /* ---------- pixel art ---------- */
  function pixelArt(img, { grid = 32, colours = 8, id = '' } = {}) {
    const q = kmeans(downsample(img, grid), colours, id + ':px'), out = canvas(grid), x = out.getContext('2d'), o = x.createImageData(grid, grid), live = q.clusters.filter(c => c.n);
    for (let i = 0; i < grid * grid; i++) {
      const p = [q.lab[i * 3], q.lab[i * 3 + 1], q.lab[i * 3 + 2]];
      let c1 = null, e1 = Infinity, c2 = null, e2 = Infinity;
      for (const c of live) { const e = Math.hypot(p[0] - c.lab[0], p[1] - c.lab[1], p[2] - c.lab[2]); if (e < e1) { c2 = c1; e2 = e1; c1 = c; e1 = e; } else if (e < e2) { c2 = c; e2 = e; } }
      // Dither only for pixels genuinely between two cover colours; flat areas stay flat.
      const t = c2 ? e1 / (e1 + e2) : 0, mix = Math.max(0, (t - 0.12) / 0.38) * 0.5;
      const th = (BAYER[(((i / grid) | 0) & 3) * 4 + ((i % grid) & 3)] + 0.5) / 16;
      const c = mix > th ? c2 : c1;
      o.data[i * 4] = c.rgb[0]; o.data[i * 4 + 1] = c.rgb[1]; o.data[i * 4 + 2] = c.rgb[2]; o.data[i * 4 + 3] = 255;
    }
    x.putImageData(o, 0, 0);
    return out;
  }

  /* ---------- abstract: the cover's colour map, redrawn with a kingdom mark ---------- */
  const MARKS = {
    // Ambient: the cover's colours top to bottom, as soft stacked fields.
    bands(x, S, q, rnd) {
      // Each band takes the strongest non-background colour in that slice of the cover (if it holds ≥ 18%),
      // and neighbouring bands of the same colour merge into one taller field.
      const bg = dominant(q); x.fillStyle = css(bg.rgb); x.fillRect(0, 0, S, S);
      const rows = 8, m = S * 0.08, bh = (S - 2 * m) / rows, pick = [];
      for (let r = 0; r < rows; r++) {
        const cnt = new Map(), y0 = Math.floor(r / rows * q.h), y1 = Math.floor((r + 1) / rows * q.h); let tot = 0;
        for (let y = y0; y < y1; y++) for (let xx = 0; xx < q.w; xx++) { const c = q.clusters[q.assign[y * q.w + xx]]; cnt.set(c, (cnt.get(c) || 0) + 1); tot++; }
        let best = bg, bn = 0; cnt.forEach((n, c) => { if (c !== bg && n > bn) { bn = n; best = c; } });
        pick.push(bn / tot >= 0.18 ? best : bg);
      }
      x.filter = `blur(${S * 0.02}px)`;
      for (let r = 0; r < rows;) {
        let e = r; while (e + 1 < rows && pick[e + 1] === pick[r]) e++;
        if (pick[r] !== bg) { x.fillStyle = css(pick[r].rgb, 0.94); x.fillRect(m + (rnd() - 0.5) * S * 0.01, m + r * bh + bh * 0.08, S - 2 * m, (e - r + 1) * bh - bh * 0.16); }
        r = e + 1;
      }
      x.filter = 'none';
      grain(x, S, rnd, 0.05);
    },
    // Shoegaze: the cover itself, smeared downward and warped sideways, then buried in grain.
    smear(x, S, q, rnd) {
      const flat = flatMap(q), m = canvas(S), mx = m.getContext('2d');
      x.fillStyle = css(dominant(q).rgb); x.fillRect(0, 0, S, S);
      mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high'; mx.drawImage(flat, 0, 0, S, S);
      for (let k = 1; k <= 14; k++) { mx.globalAlpha = 0.11; mx.drawImage(m, (rnd() - 0.5) * S * 0.02, k * S / 70); }
      mx.globalAlpha = 1;
      const strip = Math.max(2, S / 80);
      for (let y = 0; y < S; y += strip) x.drawImage(m, 0, y, S, strip, Math.sin(y / S * 9 + rnd() * 0.6) * S * 0.025, y, S, strip);
      grain(x, S, rnd, 0.16);
    },
    // Acoustic: bare strings across empty space; a string only shows where the cover has colour.
    strings(x, S, q, rnd) {
      const bg = lightest(q, 0.08); x.fillStyle = css(bg.rgb); x.fillRect(0, 0, S, S);
      const lines = 26, segs = 48, gap = S / lines;
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
      const slip = new Map(); for (let k = 0; k < 3; k++) slip.set(Math.floor(rnd() * n), Math.floor(rnd() * 3) + 1);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const sc = (c - (slip.get(r) || 0) + n) % n;
        if (rnd() < 0.12) { for (let k = 0; k < 4; k++) { const dx = k & 1, dy = k >> 1; x.fillStyle = css(mode(q, (sc + dx / 2) / n, (r + dy / 2) / n, (sc + dx / 2 + 0.5) / n, (r + dy / 2 + 0.5) / n).rgb); x.fillRect(c * cell + dx * cell / 2, r * cell + dy * cell / 2, cell / 2 - gap, cell / 2 - gap); } }
        else { x.fillStyle = css(mode(q, sc / n, r / n, (sc + 1) / n, (r + 1) / n).rgb); x.fillRect(c * cell, r * cell, cell - gap, cell - gap); }
      }
    },
    // Hip hop: halftone. Dot size is how dark the cover is there; dot colour is the cover's colour there.
    halftone(x, S, q, rnd) {
      const bg = lightest(q, 0.08); x.fillStyle = css(bg.rgb); x.fillRect(0, 0, S, S);
      const n = 22, cell = S / n;
      for (let r = 0; r < n + 1; r++) for (let c = 0; c < n + 1; c++) {
        const cx = (c + (r & 1 ? 0.5 : 0)) * cell, cy = (r + 0.5) * cell * 0.92, k = at(q, cx / S, cy / S);
        if (k === bg) continue;
        const rad = cell * 0.5 * (0.35 + 0.85 * Math.min(1, Math.max(0, 1.05 - k.light)));
        x.fillStyle = css(k.rgb); x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
      }
    }
  };
  const at = (q, u, v) => q.clusters[q.assign[Math.min(q.h - 1, Math.max(0, Math.floor(v * q.h))) * q.w + Math.min(q.w - 1, Math.max(0, Math.floor(u * q.w)))]];
  function mode(q, u0, v0, u1, v1) {
    const cnt = new Map(); let best = null, bn = -1;
    for (let y = Math.floor(v0 * q.h); y < Math.max(Math.floor(v0 * q.h) + 1, Math.floor(v1 * q.h)); y++)
      for (let x = Math.floor(u0 * q.w); x < Math.max(Math.floor(u0 * q.w) + 1, Math.floor(u1 * q.w)); x++) {
        const c = q.clusters[q.assign[Math.min(q.h - 1, y) * q.w + Math.min(q.w - 1, x)]], n = (cnt.get(c) || 0) + 1; cnt.set(c, n); if (n > bn) { bn = n; best = c; }
      }
    return best;
  }
  const dominant = q => q.clusters.reduce((a, b) => b.share > a.share ? b : a);
  const lightest = (q, min) => q.clusters.filter(c => c.share >= min).reduce((a, b) => b.light > a.light ? b : a, dominant(q));
  function flatMap(q) { const c = canvas(q.w, q.h), x = c.getContext('2d'), o = x.createImageData(q.w, q.h); for (let i = 0; i < q.w * q.h; i++) { const k = q.clusters[q.assign[i]]; o.data.set([k.rgb[0], k.rgb[1], k.rgb[2], 255], i * 4); } x.putImageData(o, 0, 0); return c; }
  function grain(x, S, rnd, a) { const g = canvas(S), gx = g.getContext('2d'), o = gx.createImageData(S, S); for (let i = 0; i < S * S; i++) { const v = rnd() * 255; o.data[i * 4] = o.data[i * 4 + 1] = o.data[i * 4 + 2] = v; o.data[i * 4 + 3] = a * 255; } gx.putImageData(o, 0, 0); x.drawImage(g, 0, 0); }

  function abstractArt(img, { mark = 'bands', size = 320, id = '' } = {}) {
    const q = kmeans(downsample(img, 48), 6, id + ':abs'), out = canvas(size), x = out.getContext('2d');
    (MARKS[mark] || MARKS.bands)(x, size, q, rng(hash(id + mark)));
    return { canvas: out, palette: q.clusters.filter(c => c.n).sort((a, b) => b.share - a.share).map(c => c.hex) };
  }

  function kingdomOf(album, kingdoms) {
    for (const t of album.tags || []) { const k = kingdoms.find(k => k.tags.includes(t)); if (k) return k; }
    return null;
  }

  const imgCache = new Map();
  async function process(album, opts = {}) {
    if (!imgCache.has(album.cover)) imgCache.set(album.cover, loadImage(album.cover));
    const img = await imgCache.get(album.cover);
    const k = opts.kingdom;
    const abs = abstractArt(img, { mark: k ? k.mark : 'bands', size: opts.size || 320, id: album.id });
    return { img, pixel: pixelArt(img, { grid: opts.grid || 32, colours: opts.colours || 8, id: album.id }), abstract: abs.canvas, palette: abs.palette };
  }

  global.ART = { process, pixelArt, abstractArt, kmeans, kingdomOf, loadImage, hash, rng, MARKS };
})(window);
