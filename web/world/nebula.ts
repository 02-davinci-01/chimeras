// Space and the four kingdoms. Each kingdom is a nebula of its own colour: a few dozen soft billboards ("puffs")
// cut from one baked noise texture, turning slowly, plus a scatter of stars that live inside the cloud.
// Everything here is one draw call per kind, and the puffs draw into the small glow layer.
import * as THREE from 'three';
import type { Kingdom } from '../shared/types.ts';
import { glowColour, SOFT_POINT_FRAG, U } from './gfx.ts';
import { rng, TAU } from './rng.ts';

export const RING = 100, CLOUD_R = 26;
const ANGLES = [45, 135, 225, 315].map(d => (d * Math.PI) / 180);
const HEIGHTS = [-10, 8, -4, 12];

export interface Nebula {
  k: Kingdom;
  index: number;
  centre: THREE.Vector3;
  colour: THREE.Color;
  /** 0 = resting, 1 = hovered or current; eased. */
  lit: number;
  litTarget: number;
}

export function nebulaCentre(index: number) {
  return new THREE.Vector3(Math.cos(ANGLES[index]) * RING, HEIGHTS[index], Math.sin(ANGLES[index]) * RING);
}

/* ── the puff texture: four variants of soft fractal noise in a 2×2 atlas, baked once ── */
function puffTexture() {
  const S = 128, N = S * 2, data = new Uint8Array(N * N * 4);
  const r = rng('puff');
  const lattice = new Float32Array(64 * 64).map(() => r());
  const vnoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (i: number, j: number) => lattice[((j & 63) << 6) | (i & 63)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  for (let variant = 0; variant < 4; variant++) {
    const ox = (variant & 1) * S, oy = (variant >> 1) * S, seed = variant * 17.3;
    const ridged = variant >= 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      let f = 0, amp = 0.5, fr = 2.2;
      for (let o = 0; o < 5; o++) {
        let n = vnoise(u * fr + seed, v * fr - seed);
        if (ridged) n = 1 - Math.abs(n * 2 - 1);
        f += n * amp; amp *= 0.5; fr *= 2.03;
      }
      const d = Math.sqrt(u * u + v * v);
      const fall = Math.max(0, 1 - d) ** (ridged ? 1.4 : 1.1);
      const a = Math.max(0, Math.min(1, (f - (ridged ? 0.4 : 0.26)) * 2)) * fall;
      const i = ((oy + y) * N + ox + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(a, 1.5) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const PUFF_VERT = /* glsl */`
uniform float uTime; uniform mat3 uCamRot;
attribute vec3 aCentre; attribute vec4 aShape; attribute vec4 aCol; attribute float aOwner;
uniform float uLit[4];
varying vec2 vUv; varying vec4 vCol;
void main() {
  // aShape: width, height, angle, spin. Spin is slow enough that the cloud breathes rather than turns.
  float a = aShape.z + uTime * aShape.w;
  vec2 q = position.xy * aShape.xy;
  q = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  vec3 p = aCentre + uCamRot * vec3(q, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Variant from the low bits of the colour alpha's integer part; uv into the 2×2 atlas.
  float variant = floor(aCol.a);
  vUv = (position.xy + 0.5) * 0.5 + vec2(mod(variant, 2.0), floor(variant / 2.0)) * 0.5;
  // Fade puffs the camera is inside or right in front of, so nothing reads as a flat card up close.
  float size = max(aShape.x, aShape.y);
  float near = smoothstep(size * 0.15, size * 0.9, -mv.z);
  int o = int(aOwner);
  float lit = o == 0 ? uLit[0] : o == 1 ? uLit[1] : o == 2 ? uLit[2] : uLit[3];
  vCol = vec4(aCol.rgb * (0.85 + lit * 0.5), fract(aCol.a) * near);
}`;
const PUFF_FRAG = /* glsl */`
uniform sampler2D tPuff;
varying vec2 vUv; varying vec4 vCol;
void main() { gl_FragColor = vec4(vCol.rgb * texture2D(tPuff, vUv).a * vCol.a, 1.0); }`;

/** Every kingdom's puffs in one mesh, and its dust lanes in another. Lobes give each cloud a shape of its own,
 *  a few hot puffs sit at the core, a second hue drifts through it, and dark dust is subtracted to carve lanes. */
export function clouds(nebulae: Nebula[]) {
  const glow = new PuffSet(), dust = new PuffSet();
  for (const nb of nebulae) {
    const r = rng(`cloud-${nb.k.key}`);
    const hsl = { h: 0, s: 0, l: 0 };
    nb.colour.getHSL(hsl);
    const drift = (r() < 0.5 ? -1 : 1) * (0.03 + r() * 0.035);
    const lobes = Array.from({ length: 3 + Math.floor(r() * 2) }, () => {
      const a = r() * TAU, e = (r() - 0.5) * 1.2, d = 6 + r() * 11;
      return new THREE.Vector3(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d * 0.55, Math.sin(a) * Math.cos(e) * d);
    });
    const g = () => (r() + r() + r() - 1.5) / 1.5;
    const around = (c: THREE.Vector3, spread: number) => c.clone().add(new THREE.Vector3(g() * spread, g() * spread * 0.55, g() * spread)).add(nb.centre);
    for (let j = 0; j < 64; j++) {
      const core = j < 8, lobe = lobes[j % lobes.length];
      const size = core ? 11 + r() * 9 : 18 + r() * 30, stretch = 1 + r() * (core ? 0.4 : 1.8);
      // The kingdom's hue, wandering in lightness; a third of the outer puffs lean toward a neighbouring hue.
      const hue = (hsl.h + (core ? 0 : r() < 0.33 ? drift : (r() - 0.5) * 0.03) + 1) % 1;
      const c = new THREE.Color().setHSL(hue, Math.min(1, hsl.s * (0.85 + r() * 0.3)), core ? 0.56 + r() * 0.1 : 0.32 + r() * 0.22);
      glow.add(nb, core ? around(new THREE.Vector3(), 4.5) : around(lobe, 10 + r() * 8), size * stretch, size, c,
        core ? 0.3 + r() * 0.15 : 0.18 + r() * 0.24, core ? Math.floor(r() * 2) : Math.floor(r() * 4));
    }
    for (let j = 0; j < 16; j++) {
      const size = 12 + r() * 20;
      // Dust takes away the cloud's own colour in proportion, so lanes darken without shifting hue.
      const m = Math.max(nb.colour.r, nb.colour.g, nb.colour.b, 0.01);
      dust.add(nb, around(lobes[j % lobes.length], 8 + r() * 8), size * (1.4 + r() * 1.6), size, nb.colour.clone().multiplyScalar(1 / m), 0.25 + r() * 0.35, 2 + Math.floor(r() * 2));
    }
  }
  const lit = { value: [0, 0, 0, 0] };
  const tex = puffTexture();
  const glowMesh = glow.mesh(lit, tex, { blending: THREE.AdditiveBlending });
  const dustMesh = dust.mesh(lit, tex, {
    blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  dustMesh.renderOrder = 1;
  return { meshes: [glowMesh, dustMesh], lit: lit.value };
}

class PuffSet {
  private centre: number[] = []; private shape: number[] = []; private col: number[] = []; private owner: number[] = [];
  add(nb: Nebula, p: THREE.Vector3, w: number, h: number, c: THREE.Color, strength: number, variant: number) {
    this.centre.push(p.x, p.y, p.z);
    this.shape.push(w, h, (((p.x * 7.13 + p.z * 3.7) % TAU) + TAU) % TAU, ((p.y * 5.3) % 1) * 0.02 - 0.01);
    this.col.push(c.r, c.g, c.b, variant + Math.min(0.999, strength));
    this.owner.push(nb.index);
  }
  mesh(lit: { value: number[] }, tex: THREE.Texture, blend: Partial<THREE.ShaderMaterialParameters>) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(new Float32Array(this.centre), 3));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(this.shape), 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(this.col), 4));
    g.setAttribute('aOwner', new THREE.InstancedBufferAttribute(new Float32Array(this.owner), 1));
    g.instanceCount = this.owner.length;
    const m = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
      uniforms: { uTime: U.uTime, uCamRot: U.uCamRot, tPuff: { value: tex }, uLit: lit },
      transparent: true, depthTest: false, depthWrite: false, ...blend,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }
}

/* ── stars ── */
const STAR_VERT = /* glsl */`
uniform float uTime, uPx;
attribute float aSize; attribute float aTw; attribute vec3 aCol;
varying vec3 vCol; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * 3.0;
  vA = aTw > 0.0 ? 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * aTw + position.x * 0.13), 2.0) : 1.0;
  vCol = aCol;
}`;

function starPoints(pos: Float32Array, size: Float32Array, tw: Float32Array, col: Float32Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aTw', new THREE.BufferAttribute(tw, 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: SOFT_POINT_FRAG, uniforms: { uTime: U.uTime, uPx: U.uPx },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/** 3,000 points in a far shell that follows the camera, so they never parallax; about 5% twinkle. */
export function starShell() {
  const N = 3000, r = rng('stars');
  const pos = new Float32Array(N * 3), size = new Float32Array(N), tw = new Float32Array(N), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = r() * 2 - 1, a = r() * TAU, d = 900 + r() * 600, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * d, u * d, Math.sin(a) * s * d], i * 3);
    size[i] = r() < 0.1 ? 1.5 : 1;
    tw[i] = r() < 0.05 ? 1.5 + r() * 3 : 0;
    const b = 0.3 + Math.pow(r(), 3) * 0.6, warm = r() < 0.2 ? 0.08 : 0;
    col.set([b, b * (1 - warm * 0.5), b * (1 - warm)], i * 3);
  }
  return starPoints(pos, size, tw, col);
}

/** Stars inside the clouds: denser toward each core, tinted between white and the kingdom colour. They parallax. */
export function cloudStars(nebulae: Nebula[]) {
  const per = 160, N = per * nebulae.length;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), tw = new Float32Array(N), col = new Float32Array(N * 3);
  let i = 0;
  for (const nb of nebulae) {
    const r = rng(`cloud-stars-${nb.k.key}`), tint = glowColour(nb.k.colour, 0.7);
    for (let j = 0; j < per; j++, i++) {
      const u = r() * 2 - 1, a = r() * TAU, d = CLOUD_R * 1.25 * Math.pow(r(), 0.8), s = Math.sqrt(1 - u * u);
      pos.set([nb.centre.x + Math.cos(a) * s * d, nb.centre.y + u * d * 0.6, nb.centre.z + Math.sin(a) * s * d], i * 3);
      const big = r() < 0.06;
      size[i] = big ? 2.4 + r() : 1 + r() * 0.6;
      tw[i] = r() < 0.25 ? 0.8 + r() * 2.5 : 0;
      const c = new THREE.Color(1, 1, 1).lerp(tint, 0.3 + r() * 0.5).multiplyScalar(big ? 1 : 0.5 + r() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
  }
  return starPoints(pos, size, tw, col);
}

export function nebulae(kingdoms: Kingdom[]): Nebula[] {
  return kingdoms.slice(0, 4).map((k, index) => ({
    k, index, centre: nebulaCentre(index), colour: glowColour(k.colour, 0.5), lit: 0, litTarget: 0,
  }));
}
