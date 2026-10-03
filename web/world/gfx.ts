// Rendering in two layers, so the world stays cheap. The nebulae and the glow of the threads are soft, so they draw
// into a small offscreen target (half the CSS size, about a sixteenth of the pixels on a retina screen) and stretch
// back up with linear filtering, which blurs them for free. Stars, cards and the crisp threads draw at full size on top.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

export const SPACE = new THREE.Color('#050507');

/** Uniforms every world material shares by reference. */
export const U = {
  uTime: { value: 0 },
  uPx: { value: 1 },            // device pixels per CSS pixel, for point sizes
  uCamRot: { value: new THREE.Matrix3() },
};

const COMPOSITE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// A soft shoulder instead of a hard clip, so stacked clouds glow into white rather than flattening.
const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tGlow; uniform float uGain;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tGlow, vUv).rgb * uGain;
  c = 1.0 - exp(-c);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Layers {
  readonly renderer: THREE.WebGLRenderer;
  /** The soft layer: nebulae and thread glow. */
  readonly glow = new THREE.Scene();
  /** The sharp layer: stars, threads, cards. */
  readonly main = new THREE.Scene();
  readonly target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(SPACE, 1);
    this.renderer.autoClear = false;
    const float = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: { tGlow: { value: this.target.texture }, uGain: { value: float ? 1 : 1.6 } },
      // Opaque pass, drawn first: additive onto the cleared space, and everything after draws over it.
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -10;
    this.main.add(this.quad);
  }

  fit(cam: THREE.PerspectiveCamera) {
    const px = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(px);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.target.setSize(Math.ceil(innerWidth / 2), Math.ceil(innerHeight / 2));
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    U.uPx.value = px;
  }

  render(cam: THREE.PerspectiveCamera) {
    U.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.glow, cam);
    r.setRenderTarget(null);
    r.setClearColor(SPACE, 1);
    r.clear();
    r.render(this.main, cam);
  }
}

/** A soft round point, for stars and comet heads. */
export const SOFT_POINT_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = exp(-r * 5.0) + 0.6 * smoothstep(1.0, 0.0, r) * step(r, 0.08);
  gl_FragColor = vec4(vCol * a * vA, 1.0);
}`;

/** A kingdom colour lifted so even the dark ones glow when added. */
export function glowColour(hex: string, light = 0.58) {
  const c = new THREE.Color(hex), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.05), Math.max(hsl.l, light));
}
