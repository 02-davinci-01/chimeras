// Camera and controls. The viewer always floats: space → kingdom → card, each a live pose that the camera eases
// into along an arc that rises above the straight line. At a card the camera stops exactly where the 3D card
// sits under the big DOM card, so one can hand over to the other.
import * as THREE from 'three';
import { CARD_H, cardPos, type Card } from './cards.ts';
import type { Nebula } from './nebula.ts';
import { easeInOutCubic } from './rng.ts';

export type Mode = 'space' | 'kingdom' | 'card';
const D = Math.PI / 180;
const SPACE_R = 300, SPACE_EL = 22 * D, SPACE_SPIN = 0.018;
const K_R = 64, K_RMIN = 26, K_RMAX = 120, K_EL = 16 * D, K_ELMIN = -40 * D, K_ELMAX = 70 * D, K_SPIN = 0.04, IDLE = 4;

interface Pose { pos: THREE.Vector3; target: THREE.Vector3 }

/** Where the big card sits on screen: its height in px and its centre in NDC (y is 0 unless a phone lifts it). */
export interface CardFrame { height: number; ndcX: number; ndcY?: number }

export class CameraRig {
  mode: Mode = 'space';
  nebula: Nebula | null = null;
  card: Card | null = null;
  /** Seconds since the last flight landed, for the card reveal. */
  arrived = 0;
  time = 0;
  frame: () => CardFrame = () => ({ height: 400, ndcX: 0 });
  /** A point the card view should keep on the empty side of the screen: where the card's thread goes. */
  beyond: (c: Card) => THREE.Vector3 | null = () => null;
  private spaceAz = -0.6;
  private k = { az: 0, el: K_EL, r: K_R, idle: IDLE };
  /** Direction from the card to the camera, fixed when the flight starts. */
  private toCam = new THREE.Vector3(0, 0, 1);
  private flight: { from: Pose; t: number; dur: number; lift: number } | null = null;
  private pose: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private lookTarget = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(readonly cam: THREE.PerspectiveCamera) {
    this.desired(this.pose);
    this.apply(this.pose);
  }

  get flying() { return this.flight !== null; }

  go(mode: Mode, nebula: Nebula | null = this.nebula, card: Card | null = null) {
    const from: Pose = { pos: this.cam.position.clone(), target: this.lookTarget.clone() };
    const prev = this.mode;
    this.mode = mode; this.nebula = nebula; this.card = card;
    if (mode === 'kingdom' && nebula) {
      // Arrive from the side we're already on, so the flight never swings round the cloud.
      const c = nebula.centre, p = this.cam.position;
      if (prev === 'space') { this.k.r = K_R; this.k.el = K_EL; }
      else this.k.el = THREE.MathUtils.clamp(Math.asin((p.y - c.y) / Math.max(1, p.distanceTo(c))), K_ELMIN, K_ELMAX);
      this.k.az = Math.atan2(p.z - c.z, p.x - c.x);
      this.k.idle = 0;
    }
    if (mode === 'card' && card && nebula) {
      const p = cardPos(card, this.time, this.v);
      const far = this.beyond(card);
      const fromCam = this.cam.position.clone().sub(p).setY(0).normalize();
      if (far) {
        // Stand so the thread runs off across the open side of the screen, away from the big card, and recedes.
        const u = far.clone().sub(p).setY(0).normalize();
        // Standing on +side (u turned a quarter about y) puts the thread on screen right; on −side, screen left.
        const side = new THREE.Vector3(-u.z, 0, u.x);
        const ndcX = this.frame().ndcX;
        if (ndcX > 0.05 || (Math.abs(ndcX) <= 0.05 && side.dot(fromCam) < 0)) side.negate();
        // About 32° off the line to the far cloud: it sits in the open half of the frame with the thread running into it.
        this.toCam.copy(side.multiplyScalar(0.53).addScaledVector(u, -0.85)).setY(0.1).normalize();
      } else {
        // Face the card from our side, leaning toward the outside of the cloud so its core fills the background.
        const out = p.clone().sub(nebula.centre).setY(0).normalize();
        this.toCam.copy(fromCam.lerp(out, 0.35)).setY(0.12).normalize();
      }
    }
    if (mode === 'space') this.spaceAz = Math.atan2(this.cam.position.z, this.cam.position.x);
    const dur = (prev === 'space') !== (mode === 'space') ? 1.7 : 1.15;
    const to = this.desired({ pos: new THREE.Vector3(), target: new THREE.Vector3() });
    this.flight = { from, t: 0, dur, lift: Math.min(40, from.pos.distanceTo(to.pos) * 0.14) };
    this.arrived = 0;
  }

  /** Drag in the kingdom view: azimuth and elevation. */
  drag(dx: number, dy: number) {
    if (this.mode !== 'kingdom' || this.flight) return;
    this.k.az += dx * 0.005;
    this.k.el = THREE.MathUtils.clamp(this.k.el + dy * 0.004, K_ELMIN, K_ELMAX);
    this.k.idle = 0;
  }
  zoom(dy: number) {
    if (this.mode !== 'kingdom') return;
    this.k.r = THREE.MathUtils.clamp(this.k.r * Math.exp(dy * 0.0012), K_RMIN, K_RMAX);
    this.k.idle = 0;
  }

  private desired(out: Pose): Pose {
    if (this.mode === 'space' || !this.nebula) {
      out.pos.set(Math.cos(this.spaceAz) * Math.cos(SPACE_EL) * SPACE_R, Math.sin(SPACE_EL) * SPACE_R, Math.sin(this.spaceAz) * Math.cos(SPACE_EL) * SPACE_R);
      out.target.set(0, 0, 0);
      return out;
    }
    const c = this.nebula.centre;
    if (this.mode === 'kingdom' || !this.card) {
      const { az, el, r } = this.k;
      out.pos.set(c.x + Math.cos(az) * Math.cos(el) * r, c.y + Math.sin(el) * r, c.z + Math.sin(az) * Math.cos(el) * r);
      out.target.copy(c);
      return out;
    }
    // Card: back off until the card is as tall on screen as the big card, then slide sideways so it sits under it.
    const p = cardPos(this.card, this.time, this.v), f = this.frame();
    const tanH = Math.tan((this.cam.fov * D) / 2);
    const d = (CARD_H * innerHeight) / (2 * f.height * tanH);
    const right = new THREE.Vector3().crossVectors(this.toCam, new THREE.Vector3(0, 1, 0)).negate().normalize();
    const ox = f.ndcX * d * tanH * this.cam.aspect, oy = (f.ndcY ?? 0) * d * tanH;
    const up = new THREE.Vector3().crossVectors(this.toCam, right).normalize();
    out.pos.copy(p).addScaledVector(this.toCam, d).addScaledVector(right, -ox).addScaledVector(up, -oy);
    out.target.copy(out.pos).addScaledVector(this.toCam, -d);
    return out;
  }

  update(dt: number, t: number) {
    this.time = t;
    if (this.mode === 'space') this.spaceAz += SPACE_SPIN * dt;
    if (this.mode === 'kingdom') {
      this.k.idle += dt;
      if (this.k.idle > IDLE) this.k.az += K_SPIN * dt * Math.min(1, (this.k.idle - IDLE) / 2);
    }
    this.desired(this.pose);
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = easeInOutCubic(f.t);
      this.pose.pos.lerpVectors(f.from.pos, this.pose.pos, e);
      this.pose.pos.y += Math.sin(Math.PI * f.t) * f.lift;
      this.pose.target.lerpVectors(f.from.target, this.pose.target, e);
      if (f.t >= 1) this.flight = null;
    } else this.arrived += dt;
    this.apply(this.pose);
  }

  private apply(p: Pose) {
    this.cam.position.copy(p.pos);
    this.lookTarget.copy(p.target);
    this.cam.lookAt(p.target);
  }
}
