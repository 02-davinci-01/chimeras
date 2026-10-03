// The cards themselves, floating in their kingdom's cloud. Every face is drawn once into one canvas atlas, and
// all the cards draw as two instanced quads: the opaque card, then its glow. Cards face the camera, sway a little,
// and bob; the same bob runs in the thread shader so threads stay pinned to their cards.
import * as THREE from 'three';
import { penDate, weekNo } from '../shared/card.ts';
import type { AlbumOut, Catalogue, Kingdom } from '../shared/types.ts';
import { STAT_KEYS } from '../shared/types.ts';
import { glowColour, U } from './gfx.ts';
import { CLOUD_R, type Nebula } from './nebula.ts';
import { hash, rng, TAU } from './rng.ts';

/** World size of a card: the 280 × 392 Obi card at 0.013 units per pixel. */
export const CARD_W = 280 * 0.013, CARD_H = 392 * 0.013;
const MARGIN = 1.8;
const FINISH: Record<string, number> = { sheen: 1, 'holo-border': 2 };

export interface Card {
  album: AlbumOut;
  nebula: Nebula;
  index: number;
  home: THREE.Vector3;
  seed: number;
  /** Eased per-frame state. */
  glow: number; glowTarget: number;
  dim: number; dimTarget: number;
  opacity: number; opacityTarget: number;
  sway: number; swayTarget: number;
}

/** The bob every card does; mirrored in GLSL below and in threads.ts. */
export const bobY = (seed: number, t: number) => Math.sin(t * 0.5 + seed * TAU) * 0.35;
export const BOB_GLSL = 'sin(uTime * 0.5 + SEED * 6.2831853) * 0.35';

export function cardPos(c: Card, t: number, out: THREE.Vector3) {
  return out.set(c.home.x, c.home.y + bobY(c.seed, t), c.home.z);
}

/* ── placing cards in a cloud: seeded by id, so adding a card never moves the others ── */
export function placeCards(albums: AlbumOut[], neb: Nebula, taken: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const a of albums) {
    const r = rng(`card-${a.id}`);
    let best: THREE.Vector3 | null = null;
    for (let tries = 0; tries < 80 && !best; tries++) {
      const reach = CLOUD_R * (0.55 + Math.min(0.6, tries / 60));
      const u = r() * 2 - 1, ang = r() * TAU, d = reach * Math.cbrt(0.15 + r() * 0.85), s = Math.sqrt(1 - u * u);
      const p = new THREE.Vector3(neb.centre.x + Math.cos(ang) * s * d, neb.centre.y + u * d * 0.5, neb.centre.z + Math.sin(ang) * s * d);
      if ([...taken, ...out].every(q => q.distanceTo(p) > 9.5)) best = p;
    }
    best ??= neb.centre.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(CLOUD_R));
    out.push(best);
  }
  return out;
}

/* ── the atlas ── */
const FONTS = ['18px "Dela Gothic One"', '27px "Reenie Beanie"', 'italic 19px "Instrument Serif"', '11px "Instrument Sans"', '600 11px "Instrument Sans"', '700 11px "Instrument Sans"'];
const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    images.set(src, p);
  }
  return p;
}

const INK = '#161616', INK2 = '#3E3E3B', MUTED = '#6B6B68', RULE = '#EFEFEC', HAIR = '#E0E0DC', PEN = '#141210';

/** One card face, drawn in the card's own 280 × 392 pixel space. A faithful miniature; up close the real card takes over. */
function drawFace(g: CanvasRenderingContext2D, a: AlbumOut, k: Kingdom, cat: Catalogue, img: HTMLImageElement | null) {
  const sealed = a.state === 'sealed';
  g.fillStyle = k.colour; g.fillRect(0, 0, 280, 392);
  g.fillStyle = '#FFFFFF'; g.fillRect(4, 4, 272, 384);
  g.fillStyle = k.colour; g.fillRect(4, 4, 62, 384);

  // The obi: title down the strip, the pen date under it, the foot at the bottom.
  const title = sealed ? 'Sealed' : a.title;
  g.save(); g.translate(35, 18); g.rotate(Math.PI / 2);
  let size = title.length > 22 ? 14 : title.length > 11 ? 16 : 18;
  g.font = `${size}px "Dela Gothic One"`;
  while (g.measureText(title).width > 190 && size > 9) g.font = `${--size}px "Dela Gothic One"`;
  g.fillStyle = k.ink; g.textBaseline = 'middle';
  g.fillText(title, 0, 0);
  const tl = Math.min(190, g.measureText(title).width);
  const date = sealed ? 'not yet' : penDate(a.first);
  if (date) {
    g.translate(tl + 16, 0); g.rotate(0.09);
    g.font = '27px "Reenie Beanie"'; g.fillStyle = PEN; g.globalAlpha = 0.9;
    g.fillText(date, 0, 0);
    g.globalAlpha = 1;
  }
  g.restore();
  const foot = sealed ? `Week ${a.pack ? weekNo(a.pack) : ''}` : `${k.name} ${a.no}`;
  g.save(); g.font = '700 10px "Instrument Sans"';
  const fl = g.measureText(foot).width;
  g.translate(35, 392 - 4 - 12 - 12 - 7 - fl); g.rotate(Math.PI / 2);
  g.fillStyle = k.ink; g.textBaseline = 'middle'; g.fillText(foot, 0, 0);
  g.restore();
  g.fillStyle = k.ink; g.globalAlpha = 0.8;
  for (const [x, w] of [[0, 1], [3, 1], [5, 3], [9, 2], [12, 1], [15, 3], [19, 1], [22, 1]]) g.fillRect(35 - 11.5 + x, 392 - 4 - 12 - 12, w, 12);
  g.globalAlpha = 1;

  // Screws.
  g.strokeStyle = '#CFCFCB'; g.lineWidth = 1;
  for (const [x, y] of [[73.5, 11.5], [265.5, 11.5], [73.5, 380.5], [265.5, 380.5]]) { g.beginPath(); g.arc(x, y, 3, 0, TAU); g.moveTo(x - 1.7, y); g.lineTo(x + 1.7, y); g.stroke(); }

  // Art.
  const ax = 91, ay = 20;
  if (img && !sealed) {
    g.save(); g.beginPath(); g.roundRect(ax, ay, 160, 160, 3); g.clip();
    g.imageSmoothingEnabled = !!a.art.cover; g.drawImage(img, ax, ay, 160, 160);
    g.restore(); g.imageSmoothingEnabled = true;
  } else {
    g.strokeStyle = RULE; g.lineWidth = 1;
    for (let y = ay + 21.5; y < ay + 160; y += 22) { g.beginPath(); g.moveTo(ax, y); g.lineTo(ax + 160, y); g.stroke(); }
    g.setLineDash([3, 3]); g.strokeStyle = '#D6D6D2'; g.strokeRect(ax + 0.5, ay + 0.5, 159, 159); g.setLineDash([]);
  }
  g.fillStyle = INK; g.beginPath(); g.arc(ax + 4, ay + 4, 11, 0, TAU); g.fill();
  g.fillStyle = '#FFFFFF'; g.font = '11px "Dela Gothic One"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A', ax + 4, ay + 4.5); g.textAlign = 'left';

  const tier = cat.rarity.find(t => t.key === a.rarity);
  if (tier && !sealed) {
    const bx = ax + 160 + 6 - 13, by = ay + 160 + 6 - 13;
    g.fillStyle = '#FFFFFF'; g.strokeStyle = '#E4E4E0'; g.beginPath(); g.arc(bx, by, 13, 0, TAU); g.fill(); g.stroke();
    g.save(); g.translate(bx - 7.5, by - 7.5); g.scale(15 / 26, 15 / 26); g.translate(1, 1);
    const sym = new Path2D(tier.symbol);
    g.fillStyle = k.colour; g.strokeStyle = INK; g.lineWidth = 1.4; g.lineJoin = 'round'; g.fill(sym); g.stroke(sym);
    g.restore();
  }

  g.textBaseline = 'alphabetic';
  if (sealed) {
    const pack = cat.packs.find(p => p.week === a.pack);
    g.fillStyle = INK; g.font = 'italic 19px "Instrument Serif"'; g.fillText(`Week ${a.pack ? weekNo(a.pack) : ''} pack`, 82, 207);
    g.fillStyle = MUTED; g.font = '11px "Instrument Sans"'; g.fillText(`Card ${pack ? pack.albums.indexOf(a.id) + 1 : 1} of ${pack?.albums.length ?? 1}`, 82, 223);
  } else {
    g.fillStyle = INK; g.font = 'italic 19px "Instrument Serif"';
    let artist = a.artist;
    while (g.measureText(artist).width > 178 && artist.length > 4) artist = artist.slice(0, -2) + '…';
    g.fillText(artist, 82, 207);
    g.font = '700 11px "Instrument Sans"'; const tn = tier ? tier.name : 'Unrated'; g.fillText(tn, 82, 223);
    g.fillStyle = MUTED; g.font = '11px "Instrument Sans"'; g.fillText(`  ${a.year}, No.${a.no}`, 82 + g.measureText(tn).width + 4, 223);
    const star = new Path2D(cat.starPath), vb = cat.starViewBox.split(/\s+/).map(Number), ss = 9 / (vb[2] || 24);
    STAT_KEYS.forEach((s, i) => {
      const y = 240 + i * 19;
      g.fillStyle = INK2; g.font = '600 11px "Instrument Sans"'; g.fillText(s[0].toUpperCase() + s.slice(1), 82, y + 9);
      g.strokeStyle = RULE; g.lineWidth = 1; g.beginPath(); g.moveTo(82, y + 15.5); g.lineTo(260, y + 15.5); g.stroke();
      for (let j = 0; j < 5; j++) {
        g.save(); g.translate(260 - (5 - j) * 11 + 2, y + 1); g.scale(ss, ss); g.translate(-(vb[0] || 0), -(vb[1] || 0));
        g.strokeStyle = INK; g.lineWidth = 0.8 / ss; g.lineJoin = 'round';
        if (a.stats[s] != null && j < a.stats[s]!) { g.fillStyle = k.colour; g.fill(star); }
        g.stroke(star); g.restore();
      }
    });
    g.fillStyle = INK; g.font = '700 11px "Instrument Sans"'; g.fillText('Read the full review', 82, 333);
    g.fillStyle = k.colour; g.fillRect(82, 336, g.measureText('Read the full review').width, 2);
  }
  // The ridge.
  g.strokeStyle = HAIR; g.lineWidth = 1; g.beginPath(); g.moveTo(96, 372); g.lineTo(104, 356); g.lineTo(236, 356); g.lineTo(244, 372); g.stroke();
}

/* ── shaders ── */
const VERT = /* glsl */`
uniform float uTime; uniform mat3 uCamRot; uniform vec2 uSize; uniform float uMargin; uniform vec2 uCell;
attribute vec3 aCentre; attribute vec2 aCell; attribute float aSeed; attribute vec4 aState; attribute vec3 aTint; attribute float aFinish;
varying vec2 vLocal; varying vec2 vUv; varying vec4 vState; varying vec3 vTint; varying float vFinish; varying float vSeed; varying float vYaw;
void main() {
  float SEED = aSeed;
  vec2 local = position.xy * (uSize + 2.0 * uMargin);
  float sway = aState.w;
  float yaw = sin(uTime * 0.31 + aSeed * 40.0) * 0.28 * sway;
  float roll = sin(uTime * 0.23 + aSeed * 17.0) * 0.06 * sway;
  vec3 q = vec3(local.x * cos(roll) - local.y * sin(roll), local.x * sin(roll) + local.y * cos(roll), 0.0);
  q = vec3(q.x * cos(yaw), q.y, -q.x * sin(yaw));
  vec3 centre = aCentre + vec3(0.0, ${BOB_GLSL}, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(centre + uCamRot * q, 1.0);
  vLocal = local;
  vec2 cuv = local / uSize + 0.5;
  vUv = vec2(aCell.x + cuv.x * uCell.x, aCell.y + (1.0 - cuv.y) * uCell.y);
  vState = aState; vTint = aTint; vFinish = aFinish; vSeed = aSeed; vYaw = yaw;
}`;

const COMMON = /* glsl */`
uniform vec2 uSize; uniform float uTime;
varying vec2 vLocal; varying vec2 vUv; varying vec4 vState; varying vec3 vTint; varying float vFinish; varying float vSeed; varying float vYaw;
float sdCard(vec2 p) {
  vec2 b = uSize * 0.5 - 0.1;
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.1;
}`;

const CARD_FRAG = /* glsl */`
uniform sampler2D tAtlas;
${COMMON}
void main() {
  float d = sdCard(vLocal);
  if (d > 0.0) discard;
  // Dissolve: the card breaks into small squares as it hands over to the big one.
  vec2 cell = floor((vLocal / uSize + 0.5) * vec2(28.0, 39.0));
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233)) + vSeed * 91.0) * 43758.5453);
  if (h > vState.z) discard;
  vec3 c = texture2D(tAtlas, vUv).rgb;
  vec2 uv = vLocal / uSize + 0.5;
  // A faint gloss that slides as the card turns.
  c += smoothstep(0.1, 0.0, abs(uv.x * 0.7 + uv.y - 0.85 - vYaw * 2.0)) * 0.07;
  // Divine: a pearly sheen sweeps across now and then. Rare: the border shimmers.
  if (vFinish == 1.0) {
    float s = fract(uTime * 0.12 + vSeed) * 3.0 - 1.0;
    c += smoothstep(0.12, 0.0, abs(uv.x + uv.y * 0.6 - s)) * mix(vec3(1.0), vTint, 0.35) * 0.45;
  } else if (vFinish == 2.0 && d > -0.06) {
    float hue = uv.y * 4.0 - uTime * 0.6 + vSeed * 6.0;
    c = mix(c, 0.6 + 0.4 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67))), 0.55);
  }
  // Dissolving edge glows in the kingdom colour.
  c += vTint * smoothstep(vState.z - 0.12, vState.z, h) * step(vState.z, 0.999) * 1.5;
  c *= mix(0.16, 1.0, vState.y);
  gl_FragColor = vec4(c, 1.0);
}`;

const GLOW_FRAG = /* glsl */`
${COMMON}
void main() {
  float d = sdCard(vLocal);
  if (d < 0.0) discard;
  float a = (exp(-d * 2.6) * 0.75 + exp(-d * 9.0) * 0.5) * (0.12 + vState.x) * mix(0.3, 1.0, vState.y) * vState.z;
  gl_FragColor = vec4(vTint * a, 1.0);
}`;

export class CardField {
  readonly group = new THREE.Group();
  cards: Card[] = [];
  private geo = new THREE.InstancedBufferGeometry();
  private atlas: THREE.CanvasTexture | null = null;
  private uniforms = {
    uTime: U.uTime, uCamRot: U.uCamRot,
    uSize: { value: new THREE.Vector2(CARD_W, CARD_H) }, uMargin: { value: MARGIN },
    uCell: { value: new THREE.Vector2(1, 1) }, tAtlas: { value: null as THREE.Texture | null },
  };
  private state = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
  private cardMesh: THREE.Mesh;
  private glowMesh: THREE.Mesh;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.geo.index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    this.geo.instanceCount = 0;
    const card = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CARD_FRAG, uniforms: this.uniforms });
    const glow = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: GLOW_FRAG, uniforms: this.uniforms, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.cardMesh = new THREE.Mesh(this.geo, card);
    this.glowMesh = new THREE.Mesh(this.geo, glow);
    for (const m of [this.cardMesh, this.glowMesh]) { m.frustumCulled = false; this.group.add(m); }
    this.cardMesh.renderOrder = 1;
    this.glowMesh.renderOrder = 3;
  }

  /** Rebuild every card and the atlas from the catalogue. Eased state carries over by album id. */
  async set(cat: Catalogue, nebulae: Nebula[]) {
    const old = new Map(this.cards.map(c => [c.album.id, c]));
    const byNo = [...cat.albums].sort((a, b) => a.no.localeCompare(b.no));
    const cards: Card[] = [];
    const taken: THREE.Vector3[] = [];
    for (const nb of nebulae) {
      const list = byNo.filter(a => a.kingdom === nb.k.key);
      const homes = placeCards(list, nb, taken);
      taken.push(...homes);
      list.forEach((a, i) => {
        const o = old.get(a.id);
        cards.push({
          album: a, nebula: nb, index: 0, home: homes[i], seed: (hash(a.id) % 10000) / 10000,
          glow: o?.glow ?? 0, glowTarget: 0, dim: o?.dim ?? 1, dimTarget: 1,
          opacity: o?.opacity ?? 0, opacityTarget: 1, sway: o?.sway ?? 1, swayTarget: 1,
        });
      });
    }
    cards.forEach((c, i) => (c.index = i));

    // Atlas: the smallest power of two that holds every face at up to 256 px wide.
    const n = Math.max(1, cards.length), max = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    let size = 512, cw = 256;
    while (Math.floor(size / cw) * Math.floor(size / Math.ceil(cw * 1.4)) < n) { if (size < max) size *= 2; else cw = Math.floor(cw * 0.85); }
    const ch = Math.ceil(cw * 1.4), cols = Math.floor(size / cw);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    await Promise.all(FONTS.map(f => document.fonts.load(f).catch(() => null)));
    const imgs = await Promise.all(cards.map(c => { const src = c.album.art.cover ?? c.album.art.pixel; return src ? image(`/${src}`) : Promise.resolve(null); }));
    cards.forEach((c, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      g.save(); g.translate(x, y); g.scale(cw / 280, ch / 392);
      drawFace(g, c.album, cat.kingdoms.find(k => k.key === c.album.kingdom)!, cat, imgs[i]);
      g.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;   // v runs down the canvas, like the cell offsets
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas?.dispose();
    this.atlas = tex;
    this.uniforms.tAtlas.value = tex;
    this.uniforms.uCell.value.set(cw / size, ch / size);

    // Instance attributes.
    const N = cards.length;
    const centre = new Float32Array(N * 3), cell = new Float32Array(N * 2), seed = new Float32Array(N), tint = new Float32Array(N * 3), finish = new Float32Array(N);
    cards.forEach((c, i) => {
      centre.set([c.home.x, c.home.y, c.home.z], i * 3);
      cell.set([(i % cols) * cw / size, Math.floor(i / cols) * ch / size], i * 2);
      seed[i] = c.seed;
      const t = glowColour(c.nebula.k.colour, 0.55);
      tint.set([t.r, t.g, t.b], i * 3);
      const f = c.album.state === 'open' ? cat.rarity.find(r => r.key === c.album.rarity)?.finish : undefined;
      finish[i] = (f && FINISH[f]) || 0;
    });
    this.geo.setAttribute('aCentre', new THREE.InstancedBufferAttribute(centre, 3));
    this.geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    this.geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    this.geo.setAttribute('aFinish', new THREE.InstancedBufferAttribute(finish, 1));
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aState', this.state);
    this.geo.instanceCount = N;
    this.cards = cards;
  }

  /** Ease every card toward its targets and upload the state in one go. */
  update(dt: number) {
    const k = Math.min(1, dt * 5), arr = this.state.array as Float32Array;
    for (const c of this.cards) {
      c.glow += (c.glowTarget - c.glow) * k;
      c.dim += (c.dimTarget - c.dim) * k;
      c.opacity += (c.opacityTarget - c.opacity) * Math.min(1, dt * 3.2);
      if (Math.abs(c.opacity - c.opacityTarget) < 0.002) c.opacity = c.opacityTarget;
      c.sway += (c.swayTarget - c.sway) * Math.min(1, dt * 2.5);
      arr.set([c.glow, c.dim, c.opacity, c.sway], c.index * 4);
    }
    this.state.needsUpdate = true;
  }

  /** The card under a screen point: project each centre and test its on-screen rectangle. */
  private v = new THREE.Vector3();
  pick(x: number, y: number, cam: THREE.PerspectiveCamera, t: number, skip?: Card | null): Card | null {
    let best: Card | null = null, bestZ = Infinity;
    const f = 1 / Math.tan((cam.fov * Math.PI) / 360);
    for (const c of this.cards) {
      if (c === skip || c.opacity < 0.5) continue;
      cardPos(c, t, this.v).applyMatrix4(cam.matrixWorldInverse);
      const z = -this.v.z;
      if (z < 0.5 || z > bestZ) continue;
      const sx = (this.v.x * f / cam.aspect / z * 0.5 + 0.5) * innerWidth, sy = (0.5 - this.v.y * f / z * 0.5) * innerHeight;
      const hh = (CARD_H / 2) * f / z * innerHeight / 2 * 1.08, hw = hh * CARD_W / CARD_H;
      if (Math.abs(x - sx) < hw && Math.abs(y - sy) < hh) { best = c; bestZ = z; }
    }
    return best;
  }
}
