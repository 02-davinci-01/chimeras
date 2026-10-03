// Threads: when an album also belongs to another kingdom, a thread runs from its card into that kingdom's cloud.
// Each thread is three curved strands that leave the card together and fan apart as they arrive, then a few short
// tendrils that spread through the far cloud. Now and then a shooting star runs the length of it and breaks into
// sparks along the tendrils. All of it is evaluated in the vertex shader from three control points, so threads cost
// nothing on the CPU and stay pinned to their bobbing cards. One draw for the lines, one for the comets, and the same
// lines again into the glow layer for a soft halo.
import * as THREE from 'three';
import { BOB_GLSL, type Card } from './cards.ts';
import { glowColour, SOFT_POINT_FRAG, U } from './gfx.ts';
import { CLOUD_R, type Nebula } from './nebula.ts';
import { rng, TAU } from './rng.ts';

export interface Thread {
  card: Card;
  to: Nebula;
  index: number;
  lit: number;
  litTarget: number;
}

const SEGMENTS = 56, TENDRIL_SEGMENTS = 18, STRANDS = 3, TENDRILS = 4;
/** Comet timing runs 0 → 1 along the strands and 1 → 1.5 along the tendrils. */
const TENDRIL_SPAN = 0.5;

const HEAD = /* glsl */`
uniform float uTime; uniform sampler2D tLit; uniform float uThreads;
attribute vec3 aP0, aP1, aP2; attribute vec4 aInfo; attribute vec3 aColA, aColB;
float threadLit(float idx) { return texture2D(tLit, vec2((idx + 0.5) / uThreads, 0.5)).r; }
float head(vec4 info) { return fract(uTime * info.y + info.x) * 4.0 - 0.3; }
vec3 bez(float s, float seed) {
  vec3 p0 = aP0;
  float SEED = seed;
  if (seed >= 0.0) p0.y += ${BOB_GLSL};
  float r = 1.0 - s;
  return r * r * p0 + 2.0 * r * s * aP1 + s * s * aP2;
}`;

const LINE_VERT = /* glsl */`
${HEAD}
attribute vec4 aS;   // geometry s, timing s, strand alpha, thread index
attribute float aSeed;
varying vec3 vCol; varying float vA;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(bez(aS.x, aSeed), 1.0);
  float lit = threadLit(aS.w);
  float ts = aS.y;
  float h = head(aInfo);
  float d = h - ts;
  float trail = d >= 0.0 ? exp(-d * 9.0) : exp(d * 60.0);
  // Fade in off the card, fade out into the far cloud, and fade the tendrils toward their tips.
  float ends = smoothstep(0.0, 0.06, ts) * (ts <= 1.0 ? 1.0 - 0.55 * smoothstep(0.7, 1.0, ts) : 0.45 * (1.0 - smoothstep(1.0, 1.0 + ${TENDRIL_SPAN.toFixed(2)}, ts)));
  float base = mix(0.16, 0.6, lit);
  vA = aS.z * ends * (base + trail * mix(0.55, 1.2, lit));
  vCol = mix(aColA, aColB, smoothstep(0.1, 0.95, min(ts, 1.0))) + trail * 0.35;
}`;
const LINE_FRAG = /* glsl */`
uniform float uGain;
varying vec3 vCol; varying float vA;
void main() { gl_FragColor = vec4(vCol * vA * uGain, 1.0); }`;

const COMET_VERT = /* glsl */`
${HEAD}
uniform float uPx;
attribute vec3 aRange;   // timing start, timing end, thread index
attribute float aSeed;
varying vec3 vCol; varying float vA;
void main() {
  float h = head(aInfo);
  float s = (h - aRange.x) / (aRange.y - aRange.x);
  float on = step(0.0, s) * step(s, 1.0);
  s = clamp(s, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(bez(s, aSeed), 1.0);
  float lit = threadLit(aRange.z);
  bool tendril = aRange.x >= 1.0;
  float fade = tendril ? 1.0 - s : smoothstep(0.0, 0.08, s);
  gl_PointSize = on * uPx * (tendril ? 5.0 : 9.0) * (0.7 + 0.5 * lit) * mix(1.0, 0.6, s * float(tendril));
  vA = fade * mix(0.6, 1.0, lit);
  vCol = mix(vec3(1.0), mix(aColA, aColB, s), 0.35);
}`;

export class Threads {
  readonly lines: THREE.LineSegments;
  readonly glow: THREE.LineSegments;
  readonly comets: THREE.Points;
  list: Thread[] = [];
  private litTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  private uniforms = { uTime: U.uTime, uPx: U.uPx, tLit: { value: this.litTex as THREE.Texture }, uThreads: { value: 1 } };

  constructor() {
    const mk = (gain: number) => new THREE.ShaderMaterial({
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: { ...this.uniforms, uGain: { value: gain } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), mk(1));
    this.glow = new THREE.LineSegments(new THREE.BufferGeometry(), mk(2.2));
    (this.glow.material as THREE.ShaderMaterial).depthTest = false;
    this.comets = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      vertexShader: COMET_VERT, fragmentShader: SOFT_POINT_FRAG, uniforms: this.uniforms,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    for (const o of [this.lines, this.glow, this.comets]) o.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.glow.renderOrder = 2;   // after the dust lanes, so lanes never cut a thread
    this.comets.renderOrder = 4;
  }

  /** Rebuild from the cards. `nebulae` by kingdom key. */
  set(cards: Card[], byKey: Map<string, Nebula>) {
    const old = new Map(this.list.map(t => [`${t.card.album.id}>${t.to.k.key}`, t]));
    const list: Thread[] = [];
    for (const c of cards) for (const key of c.album.also) {
      const to = byKey.get(key);
      if (!to || to === c.nebula) continue;
      const o = old.get(`${c.album.id}>${key}`);
      list.push({ card: c, to, index: list.length, lit: o?.lit ?? 0, litTarget: 0 });
    }
    this.list = list;

    const L: Record<string, number[]> = { aP0: [], aP1: [], aP2: [], aInfo: [], aColA: [], aColB: [], aS: [], aSeed: [] };
    const C: Record<string, number[]> = { aP0: [], aP1: [], aP2: [], aInfo: [], aColA: [], aColB: [], aRange: [], aSeed: [] };
    const v3 = (o: number[], v: THREE.Vector3) => o.push(v.x, v.y, v.z);
    const colour = (o: number[], c: THREE.Color) => o.push(c.r, c.g, c.b);

    for (const t of list) {
      const r = rng(`thread-${t.card.album.id}-${t.to.k.key}`);
      const S = t.card.home;
      const dir = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize();
      // Land on the near side of the far cloud, a little inside it.
      const toward = S.clone().sub(t.to.centre).normalize();
      const E = t.to.centre.clone().addScaledVector(toward.lerp(dir, 0.5).normalize(), CLOUD_R * 0.45);
      const len = S.distanceTo(E);
      const side = new THREE.Vector3().crossVectors(E.clone().sub(S), new THREE.Vector3(0, 1, 0)).normalize();
      const lift = len * (0.16 + r() * 0.1), sway = (r() - 0.5) * len * 0.22;
      const mid = S.clone().lerp(E, 0.5).add(new THREE.Vector3(0, lift, 0)).addScaledVector(side, sway);
      const info = [r(), 0.07 + r() * 0.05, 0, 0];      // phase, speed: a shooting star every 8–14 s, about a quarter of that in flight
      const colA = glowColour(t.card.nebula.k.colour, 0.6), colB = glowColour(t.to.k.colour, 0.6);
      const seed = t.card.seed;

      const strand = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, n: number, t0: number, t1: number, alpha: number, bob: boolean) => {
        for (let i = 0; i < n; i++) for (const k of [i, i + 1]) {
          const s = k / n;
          v3(L.aP0, p0); v3(L.aP1, p1); v3(L.aP2, p2); L.aInfo.push(...info); colour(L.aColA, colA); colour(L.aColB, colB);
          L.aS.push(s, t0 + (t1 - t0) * s, alpha, t.index); L.aSeed.push(bob ? seed : -1);
        }
      };
      const comet = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, t0: number, t1: number, bob: boolean) => {
        v3(C.aP0, p0); v3(C.aP1, p1); v3(C.aP2, p2); C.aInfo.push(...info); colour(C.aColA, colA); colour(C.aColB, colB);
        C.aRange.push(t0, t1, t.index); C.aSeed.push(bob ? seed : -1);
      };

      // Three strands, together at the card and fanned at the far end.
      const ends: THREE.Vector3[] = [];
      for (let k = 0; k < STRANDS; k++) {
        const fan = k === 0 ? new THREE.Vector3() : new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(9);
        const end = E.clone().add(fan);
        const ctrl = mid.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(k === 0 ? 0 : len * 0.06));
        strand(S, ctrl, end, SEGMENTS, 0, 1, k === 0 ? 1 : 0.5, true);
        if (k === 0) comet(S, ctrl, end, 0, 1, true);
        ends.push(end);
      }
      // Tendrils: short arcs that spread from where the strands land.
      for (let k = 0; k < TENDRILS; k++) {
        const from = ends[k % ends.length];
        const a = r() * TAU, e = (r() - 0.5) * 1.2, d = 6 + r() * 8;
        const to = from.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) * 0.6, Math.sin(a) * Math.cos(e)).multiplyScalar(d));
        const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(d * 0.5));
        const span = TENDRIL_SPAN * (0.6 + r() * 0.4);
        strand(from, ctrl, to, TENDRIL_SEGMENTS, 1, 1 + span, 0.8, false);
        comet(from, ctrl, to, 1, 1 + span, false);
      }
    }

    const geo = (src: Record<string, number[]>, sizes: Record<string, number>) => {
      const g = new THREE.BufferGeometry();
      const n = src.aSeed.length;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      for (const [name, size] of Object.entries(sizes)) g.setAttribute(name, new THREE.Float32BufferAttribute(src[name], size));
      return g;
    };
    const lineSizes = { aP0: 3, aP1: 3, aP2: 3, aInfo: 4, aColA: 3, aColB: 3, aS: 4, aSeed: 1 };
    const lineGeo = geo(L, lineSizes);
    this.lines.geometry.dispose();
    this.lines.geometry = lineGeo;
    this.glow.geometry = lineGeo;
    this.comets.geometry.dispose();
    this.comets.geometry = geo(C, { aP0: 3, aP1: 3, aP2: 3, aInfo: 4, aColA: 3, aColB: 3, aRange: 3, aSeed: 1 });

    this.litTex.dispose();
    this.litTex = new THREE.DataTexture(new Uint8Array(Math.max(1, list.length) * 4), Math.max(1, list.length), 1, THREE.RGBAFormat);
    this.litTex.magFilter = this.litTex.minFilter = THREE.NearestFilter;
    this.uniforms.tLit.value = this.litTex;
    this.uniforms.uThreads.value = Math.max(1, list.length);
    this.litTex.needsUpdate = true;
  }

  update(dt: number) {
    const k = Math.min(1, dt * 4), data = this.litTex.image.data as Uint8Array;
    for (const t of this.list) {
      t.lit += (t.litTarget - t.lit) * k;
      data[t.index * 4] = Math.round(t.lit * 255);
    }
    this.litTex.needsUpdate = true;
  }
}
