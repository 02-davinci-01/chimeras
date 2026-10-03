// The world's soundtrack. Each scene (open space, and each kingdom) loops a song from sounds/, as config/sounds.json
// names them, levelled by their measured loudness; a scene without one falls back to a generative loop played live in
// WebAudio (glitch pop after Sweet Trip's Velocity : Design : Comfort for space, a loop in its genre for a kingdom).
// Scenes crossfade as the camera moves. Meeting a card plays the album's own track over them, the scene ducking out
// of the way. The reader muffles whatever is playing. Songs stream through <audio> elements, so nothing big sits
// decoded in memory.
import { store } from '../shared/data.ts';
import type { SceneKey, SongOut } from '../shared/types.ts';

export type { SceneKey };

/** The generative loops' names, in the album's own colon form. */
export const TRACKS: Record<SceneKey, string> = {
  space: 'drift : design : comfort.',
  rock: 'fuzz : wall : tide.',
  electronic: 'grid : glitch : bloom.',
  hiphop: 'dust : loop : swing.',
  indie: 'jangle : sun : static.',
};

const KEY = 'world.sound';
const VOLUME = 0.6;
/** Where a typical master (about −9 LUFS) sits: an album's track at TRACK_LEVEL, scene songs a little under it. */
const TRACK_LEVEL = 0.42, SONG_LEVEL = 0.34;
const songLevel = (lufs: number) => Math.min(1.2, SONG_LEVEL * 10 ** ((-9 - lufs) / 20));

export interface Track { id: string; url: string; name: string; no: number | null }
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;
/** Euclidean rhythm: k hits spread over n steps. */
const euclid = (k: number, n: number, rot = 0) => Array.from({ length: n }, (_, i) => ((i + rot) * k) % n < k);

/* ── voices: small synths that build their nodes per note and let them go ── */

class Kit {
  noise: AudioBuffer;
  crush: WaveShaperNode;
  fuzz: WaveShaperNode;
  constructor(readonly ctx: AudioContext) {
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // A staircase transfer curve: amplitude bitcrush, the glitch voice.
    this.crush = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) c[i] = Math.round((i / (c.length - 1) * 2 - 1) * 6) / 6;
    this.crush.curve = c;
    this.fuzz = ctx.createWaveShaper();
    const f = new Float32Array(1024);
    for (let i = 0; i < f.length; i++) { const x = i / (f.length - 1) * 2 - 1; f[i] = Math.tanh(x * 3.2) * 0.8; }
    this.fuzz.curve = f;
    this.fuzz.oversample = '2x';
  }

  private amp(t: number, peak: number, a: number, d: number, dest: AudioNode) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest);
    return g;
  }
  private osc(type: OscillatorType, f: number, t: number, len: number, dest: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(t + len + 0.05);
    return o;
  }
  private noiseSrc(t: number, len: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.connect(dest);
    s.start(t, Math.random() * 1.5, len + 0.05);
    return s;
  }
  private filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dest);
    return b;
  }

  /** Slow detuned-saw chord under a low-pass. */
  pad(notes: number[], t: number, len: number, dest: AudioNode, { gain = 0.05, cut = 1100, type = 'sawtooth' as OscillatorType, a = 1.2 } = {}) {
    const lp = this.filter('lowpass', cut, 0.4, dest);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setValueAtTime(gain, t + Math.max(a, len - 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 1.6);
    g.connect(lp);
    for (const m of notes) for (const dt of [-7, 7]) this.osc(type, hz(m), t, len + 1.6, g, dt);
  }
  /** FM bell: a sine with a fading inharmonic modulator. */
  bell(m: number, t: number, dest: AudioNode, { gain = 0.08, len = 1.4, ratio = 3.5, index = 2.4 } = {}) {
    const f = hz(m), out = this.amp(t, gain, 0.005, len, dest);
    const car = this.osc('sine', f, t, len, out);
    const mod = this.ctx.createOscillator(), mg = this.ctx.createGain();
    mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + len * 0.6);
    mod.connect(mg).connect(car.frequency);
    mod.start(t); mod.stop(t + len + 0.05);
  }
  /** FM electric piano: a tine that softens. */
  keys(notes: number[], t: number, len: number, dest: AudioNode, gain = 0.045) {
    for (const m of notes) this.bell(m, t + Math.random() * 0.012, dest, { gain, len, ratio: 1, index: 1.6 });
  }
  /** A plucked string: bright saw closing down fast. */
  pluck(m: number, t: number, dest: AudioNode, { gain = 0.07, len = 0.9, bright = 3200 } = {}) {
    const out = this.amp(t, gain, 0.003, len, dest);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + len * 0.5);
    lp.connect(out);
    this.osc('sawtooth', hz(m), t, len, lp, -4);
    this.osc('square', hz(m), t, len, lp, 5);
  }
  /** Square blip through the crusher. */
  blip(m: number, t: number, dest: AudioNode, gain = 0.035, len = 0.09) {
    const out = this.amp(t, gain, 0.002, len, dest);
    const sh = this.ctx.createWaveShaper(); sh.curve = this.crush.curve; sh.connect(out);
    this.osc('square', hz(m), t, len, sh);
  }
  bass(m: number, t: number, len: number, dest: AudioNode, gain = 0.12) {
    const out = this.amp(t, gain, 0.01, len, dest);
    const lp = this.filter('lowpass', 420, 0.7, out);
    this.osc('sine', hz(m), t, len, lp);
    this.osc('triangle', hz(m + 12), t, len, this.amp(t, 0.25, 0.01, len, lp));
  }
  kick(t: number, dest: AudioNode, gain = 0.5) {
    const out = this.amp(t, gain, 0.002, 0.42, dest);
    const o = this.osc('sine', 130, t, 0.45, out);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  }
  snare(t: number, dest: AudioNode, gain = 0.18, tone = 1900) {
    this.noiseSrc(t, 0.22, this.filter('bandpass', tone, 0.8, this.amp(t, gain, 0.001, 0.2, dest)));
    this.osc('triangle', 185, t, 0.1, this.amp(t, gain * 0.6, 0.001, 0.08, dest));
  }
  hat(t: number, dest: AudioNode, gain = 0.05, len = 0.045) {
    this.noiseSrc(t, len, this.filter('highpass', 7200, 0.6, this.amp(t, gain, 0.001, len, dest)));
  }
  /** A two-millisecond tick: the IDM grain. */
  click(t: number, dest: AudioNode, gain = 0.06) {
    const out = this.amp(t, gain, 0.0005, 0.012, dest);
    this.osc('square', 2400 + Math.random() * 5000, t, 0.015, out);
  }
  /** A slow wash of filtered noise, for cymbals and air. */
  wash(t: number, len: number, dest: AudioNode, gain = 0.03, f = 5000) {
    this.noiseSrc(t, len, this.filter('bandpass', f, 0.5, this.amp(t, gain, len * 0.2, len * 0.8, dest)));
  }
}

/* ── scenes: a step clock and what each step plays ── */

interface Scene {
  bpm: number;
  /** Sixteenths. */
  steps: number;
  swing?: number;
  /** Reverb send, and a trim so every scene sits at about the same loudness. */
  send: number;
  level: number;
  play(k: Kit, step: number, t: number, out: AudioNode, sec16: number): void;
  /** A continuous bed (crackle, drone) built once while the scene runs. */
  bed?(k: Kit, out: AudioNode): () => void;
}

const SPACE_CHORDS = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 61], [45, 52, 57, 59, 64]];
const ROCK_CHORDS = [[40, 47, 52, 54, 59], [37, 44, 49, 51, 56], [33, 40, 45, 47, 52], [35, 42, 47, 49, 54]];
const IDM_CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 55, 59, 62, 64], [52, 55, 59, 62, 66]];
const HH_CHORDS = [[50, 53, 57, 60, 64], [43, 53, 57, 59, 64], [48, 52, 55, 59, 62], [45, 49, 55, 60, 64]];
const INDIE_CHORDS = [[43, 50, 55, 59, 62, 67], [42, 50, 54, 57, 62, 66], [40, 47, 52, 55, 59, 64], [36, 48, 52, 55, 60, 64]];

const SCENES: Record<SceneKey, Scene> = {
  // Open space: a dreamy pad, a bell that wanders and sometimes stutters into a crushed buffer-repeat.
  space: {
    bpm: 76, steps: 128, send: 0.55, level: 1.2,
    play(k, s, t, out, q) {
      const bar = Math.floor(s / 16), chord = SPACE_CHORDS[Math.floor(bar / 2) % 4];
      if (s % 32 === 0) { k.pad(chord, t, q * 32, out, { gain: 0.035, cut: 1300 }); k.bass(chord[0] - 12, t, q * 30, out, 0.07); }
      if (s % 2 === 0 && chance(0.5)) {
        const m = pick(chord) + 24;
        if (chance(0.14)) for (let i = 0; i < 6; i++) k.blip(m + (i > 3 ? 12 : 0), t + i * q / 2, out, 0.022 * (1 - i / 7), q / 2.5);
        else k.bell(m, t, out, { gain: 0.05, len: 1.8 });
      }
      if (chance(0.22)) k.click(t, out, 0.03);
      if (s % 64 === 60) k.wash(t, q * 8, out, 0.02, 3000);
    },
  },
  // Rock: a shoegaze wall, half-time drums deep in the reverb, a glide lead that bends.
  rock: {
    bpm: 82, steps: 64, send: 0.6, level: 0.42,
    play(k, s, t, out, q) {
      const chord = ROCK_CHORDS[Math.floor(s / 16) % 4];
      if (s % 16 === 0) {
        const g = k.ctx.createGain(); g.gain.value = 0.55;
        const sh = k.ctx.createWaveShaper(); sh.curve = k.fuzz.curve;
        const lp = k.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
        sh.connect(lp).connect(g).connect(out);
        k.pad(chord, t, q * 16, sh, { gain: 0.08, cut: 3000, a: 0.25 });
        setTimeout(() => g.disconnect(), (t - k.ctx.currentTime + q * 16 + 3) * 1000);
        k.bass(chord[0], t, q * 15, out, 0.11);
        if (s % 64 === 0) k.wash(t, q * 16, out, 0.035, 6000);
      }
      if (s % 16 === 0 || s % 16 === 10) k.kick(t, out, 0.42);
      if (s % 16 === 8) k.snare(t, out, 0.16, 1500);
      if (s % 2 === 0) k.hat(t, out, 0.018, 0.08);
      if (s % 8 === 4 && chance(0.4)) {
        const m = pick(chord.slice(2)) + 12;
        k.pluck(m, t, out, { gain: 0.035, len: q * 7, bright: 1800 });
      }
    },
  },
  // Electronic: IDM. Euclidean kicks and hats with ratchets, a crushed blip line, glassy stabs, a stutter every four bars.
  electronic: {
    bpm: 124, steps: 64, send: 0.35, level: 0.92,
    play(k, s, t, out, q) {
      const i = s % 16, bar = Math.floor(s / 16), chord = IDM_CHORDS[bar % 4];
      const stutter = bar % 4 === 3 && i >= 12;
      if (stutter) { for (let r = 0; r < 3; r++) k.hat(t + r * q / 3, out, 0.04 * (1 - r / 4), 0.02); k.blip(chord[1] + 24, t, out, 0.02, q / 3); return; }
      if (euclid(4, 16)[i] || (i === 14 && chance(0.3))) { k.kick(t, out, 0.4); k.bass(chord[0] - 24, t, q * 1.6, out, 0.09); }
      if (i === 4 || i === 12) k.snare(t, out, 0.1, 2600);
      if (euclid(11, 16, bar)[i]) {
        if (chance(0.15)) for (let r = 0; r < 3; r++) k.hat(t + r * q / 3, out, 0.035, 0.02);
        else k.hat(t, out, 0.02 + Math.random() * 0.03);
      }
      if (euclid(7, 16, 2)[i]) k.blip(pick(chord) + (chance(0.3) ? 24 : 12), t, out, 0.026, q * 0.8);
      if (i === 0 || (i === 10 && chance(0.5))) for (const m of chord.slice(1, 4)) k.bell(m + 12, t, out, { gain: 0.022, len: 0.6, ratio: 2, index: 1.2 });
      if (chance(0.18)) k.click(t + q / 2, out, 0.04);
    },
  },
  // Hip-hop: a boom-bap loop, swung, with dusty electric piano, a round bass and vinyl crackle.
  hiphop: {
    bpm: 86, steps: 64, swing: 0.58, send: 0.22, level: 1.1,
    play(k, s, t, out, q) {
      const i = s % 16, chord = HH_CHORDS[Math.floor(s / 16) % 4];
      if (i === 0) k.keys(chord, t, q * 10, out, 0.04);
      if (i === 7 && chance(0.6)) k.keys(chord.slice(2), t, q * 4, out, 0.03);
      if (i === 0 || i === 7 || i === 10) { k.kick(t, out, 0.5); k.bass(chord[0] - 12, t, q * (i === 0 ? 5 : 2.5), out, 0.13); }
      if (i === 4 || i === 12) k.snare(t, out, 0.2, 1700);
      if (i % 2 === 0) k.hat(t, out, i % 4 === 2 ? 0.035 : 0.02, 0.05);
    },
    bed(k, out) {
      const src = k.ctx.createBufferSource();
      src.buffer = k.noise; src.loop = true;
      const bp = k.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.5;
      const g = k.ctx.createGain(); g.gain.value = 0.006;
      src.connect(bp).connect(g).connect(out); src.start();
      const pops = setInterval(() => { if (chance(0.5)) k.click(k.ctx.currentTime + 0.05, out, 0.025); }, 180);
      return () => { clearInterval(pops); src.stop(); g.disconnect(); };
    },
  },
  // Indie: jangling arpeggios over a light kit, a walking bass and a shaker.
  indie: {
    bpm: 106, steps: 64, send: 0.3, level: 1.3,
    play(k, s, t, out, q) {
      const i = s % 16, chord = INDIE_CHORDS[Math.floor(s / 16) % 4];
      const order = [1, 3, 5, 3, 2, 4, 5, 4];
      if (i % 2 === 0) k.pluck(chord[order[(i / 2) % 8]] + 12, t, out, { gain: 0.05, len: 0.7, bright: 3800 });
      if (i === 6 || i === 14) k.pluck(chord[5] + 12, t + q / 2, out, { gain: 0.025, len: 0.4 });
      if (i === 0 || i === 8) { k.kick(t, out, 0.34); k.bass(chord[0] - 12 + (i === 8 ? 7 : 0), t, q * 7, out, 0.1); }
      if (i === 4 || i === 12) k.snare(t, out, 0.1, 2300);
      k.hat(t, out, i % 4 === 2 ? 0.028 : 0.012, 0.03);
      if (i === 0 && s % 64 === 0) k.pad(chord.slice(1, 4).map(m => m + 12), t, q * 60, out, { gain: 0.014, cut: 1600, type: 'triangle' });
    },
  },
};

/* ── the engine ── */

/** A streamed song: one <audio> element, wired once into the graph through its own gain. */
interface Stream { el: HTMLAudioElement; gain: GainNode | null; off: number }
interface Synth { fade: GainNode; send: GainNode; step: number; next: number; stopBed?: () => void }
interface Running { key: SceneKey; song?: Stream; synth?: Synth }
interface Playing { t: Track; s: Stream; tail: boolean }

export class Music {
  on = store.get(KEY, true);
  scene: SceneKey = 'space';
  private songs: Partial<Record<SceneKey, SongOut>> = {};
  private ctx: AudioContext | null = null;
  private kit!: Kit;
  private input!: GainNode;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private verb!: ConvolverNode;
  private analyser!: AnalyserNode;
  private bins = new Uint8Array(32);
  /** Everything the scenes make, so a track can duck it as one. */
  private scenes!: GainNode;
  private running: Running[] = [];
  private streams = new Map<string, Stream>();
  /** The track asked for (the card we're at), what is actually sounding, and whether it has played out. */
  private wanted: Track | null = null;
  private track: Playing | null = null;
  private done = false;
  private unduck = 0;
  private paused: HTMLAudioElement[] = [];
  private listeners = new Set<() => void>();
  // Beat detection: a jump in low-end energy on a lightly smoothed analyser of its own.
  private beatAn!: AnalyserNode;
  private beatBins = new Uint8Array(32);
  private low = 0;
  private lastBeat = 0;
  private beats = 0;

  /** Call from a user gesture (or try early; browsers may refuse until one comes). */
  wake() {
    if (!this.on) return;
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') this.ctx!.resume().then(() => this.emit()).catch(() => {});
    if (!this.running.some(r => r.key === this.scene)) this.start(this.scene);
    if (this.wanted && !this.track && !this.done) this.startTrack(this.wanted);
  }
  get playing() { return !!this.ctx && this.ctx.state === 'running' && this.on; }

  /** The songs from the catalogue. A scene already playing switches to its new song (or loop) at once. */
  setSongs(songs: Partial<Record<SceneKey, SongOut>>) {
    const was = this.songs;
    this.songs = songs;
    // Only the scene you're in buffers now; the rest wait until you head their way (whole songs are heavy on a phone).
    for (const [k, s] of Object.entries(songs)) this.stream(`/${s.url}`, k === this.scene);
    if (!this.ctx) return;
    for (const r of [...this.running]) if (r.key === this.scene && was[r.key]?.url !== songs[r.key]?.url) { this.stop(r, 1.2); this.start(r.key); }
    this.emit();
  }
  /** The song for the scene now, if it has one. */
  get sceneSong(): SongOut | null { return this.songs[this.scene] ?? null; }

  toggle(on = !this.on) {
    this.on = on;
    store.set(KEY, on);
    if (on) {
      this.wake();
      this.master?.gain.setTargetAtTime(VOLUME, this.ctx!.currentTime, 0.4);
    } else if (this.ctx) {
      const ctx = this.ctx;
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => {
        if (this.on) return;
        this.running.forEach(r => this.stop(r, 0));
        this.endTrack(0);
        this.scenes.gain.cancelScheduledValues(ctx.currentTime);
        this.scenes.gain.setValueAtTime(1, ctx.currentTime);
        ctx.suspend();
      }, 700);
    }
    this.emit();
  }

  setScene(key: SceneKey) {
    if (key === this.scene) return;
    this.scene = key;
    this.emit();
    if (!this.playing) return;
    for (const r of [...this.running]) if (r.key !== key) this.stop(r, 2.4);
    this.start(key);
  }

  /** Start buffering a song or clip ahead of time (on the way to a card), so it is ready when the camera lands. */
  preload(url: string) { this.stream(url); }

  /** Play an album's track: the scene ducks out, the track fades in, and when it ends the scene comes back. */
  playTrack(t: Track) {
    clearTimeout(this.unduck);
    if (this.wanted?.id === t.id) return;
    this.wanted = t; this.done = false;
    this.preload(t.url);
    if (this.playing) this.startTrack(t);
    this.emit();
  }

  /** Leave the card: the track fades and, unless another one starts straight away, the scene returns. */
  stopTrack() {
    if (!this.wanted) return;
    this.wanted = null;
    this.endTrack(0.8);
    this.emit();
    if (!this.ctx) return;
    clearTimeout(this.unduck);
    this.unduck = window.setTimeout(() => this.duck(false), 350);
  }

  /** The album track now sounding, for the toggle and the notes. */
  get nowPlaying(): Track | null { return this.playing && this.track && !this.done ? this.track.t : null; }
  /** How far through the track, 0..1, or −1 when none is sounding. */
  progress(): number {
    const el = this.track?.s.el;
    return el && el.duration ? Math.min(1, el.currentTime / el.duration) : -1;
  }

  /** Once a frame: read the spectrum, fade a clip's tail, and count beats. */
  update(now: number) {
    if (!this.playing) return;
    this.analyser.getByteFrequencyData(this.bins);
    const p = this.track;
    if (p && !p.tail && p.s.el.duration && p.s.el.duration - p.s.el.currentTime < 2.6) {
      p.tail = true;
      p.s.gain?.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.6);
    }
    this.beatAn.getByteFrequencyData(this.beatBins);
    const e = (this.beatBins[0] + this.beatBins[1] + this.beatBins[2]) / 3;
    if (e - this.low > 14 && now - this.lastBeat > 300) { this.beats++; this.lastBeat = now; }
    this.low = e;
  }
  /** Counts up once per detected beat. */
  get pulse() { return this.beats; }

  /** Fade everything out for leaving the page, without changing the setting; `restore` brings it back. */
  hush(sec = 0.6) { if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, sec / 3); }
  restore() { if (this.ctx && this.on) this.master.gain.setTargetAtTime(VOLUME, this.ctx.currentTime, 0.4); }

  /** Muffle for reading: the music goes behind a wall. */
  muffled(on: boolean) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 520 : 18000, this.ctx.currentTime, on ? 0.25 : 0.5);
  }

  /** 0..1 levels for a small meter, from this frame's spectrum. */
  levels(n: number): number[] {
    if (!this.playing) return Array(n).fill(0);
    // Roughly log-spaced bins, so the bass doesn't take every bar.
    return Array.from({ length: n }, (_, i) => this.bins[Math.round(1 + i * i * 0.9)] / 255);
  }

  onChange(fn: () => void) { this.listeners.add(fn); }
  private emit() { this.listeners.forEach(f => f()); }

  private build() {
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.kit = new Kit(ctx);
    this.input = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.3;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.8);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 64; this.analyser.smoothingTimeConstant = 0.82;
    this.input.connect(this.muffle).connect(this.master).connect(comp).connect(ctx.destination);
    comp.connect(this.analyser);
    this.beatAn = ctx.createAnalyser(); this.beatAn.fftSize = 64; this.beatAn.smoothingTimeConstant = 0.3;
    comp.connect(this.beatAn);
    this.scenes = ctx.createGain();
    this.scenes.connect(this.input);
    // A dark hall for the generative loops: decaying stereo noise, smoothed so it doesn't hiss.
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * (1 - i / len) ** 2.6; }
    }
    this.verb.buffer = ir;
    this.verb.connect(this.scenes);
    window.setInterval(() => this.tick(), 40);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || !this.on) return;
      if (document.hidden) {
        this.paused = [...this.streams.values()].map(s => s.el).filter(el => !el.paused);
        this.paused.forEach(el => el.pause());
        this.ctx.suspend();
      } else this.ctx.resume().then(() => {
        this.paused.forEach(el => el.play().catch(() => {}));
        for (const r of this.running) if (r.synth) r.synth.next = Math.max(r.synth.next, this.ctx!.currentTime + 0.05);
      });
    });
  }

  private stream(url: string, eager = true): Stream {
    let s = this.streams.get(url);
    if (!s) {
      const el = new Audio();
      // Anonymous CORS, so Apple's previews can feed the Web Audio graph (the level meter) on the public site.
      el.crossOrigin = 'anonymous';
      el.preload = eager ? 'auto' : 'metadata'; el.src = url;
      s = { el, gain: null, off: 0 };
      this.streams.set(url, s);
    } else if (eager) s.el.preload = 'auto';
    return s;
  }
  /** Bring a stream up to `level` into `dest`. */
  private fadeIn(s: Stream, level: number, sec: number, dest: AudioNode, loop: boolean) {
    const ctx = this.ctx!;
    if (!s.gain) {
      s.gain = ctx.createGain(); s.gain.gain.value = 0;
      ctx.createMediaElementSource(s.el).connect(s.gain);
    }
    s.gain.disconnect(); s.gain.connect(dest);
    clearTimeout(s.off);
    s.el.loop = loop;
    s.el.play().catch(e => console.warn('music:', s.el.src, e));
    s.gain.gain.cancelScheduledValues(ctx.currentTime);
    s.gain.gain.setTargetAtTime(level, ctx.currentTime, sec / 3);
  }
  /** Fade a stream out and pause it, keeping its place unless `rewind`. */
  private fadeOut(s: Stream, sec: number, rewind = false) {
    if (!s.gain || !this.ctx) { s.el.pause(); return; }
    s.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    s.gain.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, sec / 4));
    clearTimeout(s.off);
    s.off = window.setTimeout(() => { s.el.pause(); if (rewind) s.el.currentTime = 0; }, sec * 1000 + 250);
  }

  private startTrack(t: Track) {
    this.endTrack(0.8);
    // The card's track is the song already looping here (Dsco in the indie cloud): let it carry on.
    if (this.sceneSong && `/${this.sceneSong.url}` === t.url) return;
    this.duck(true);
    const s = this.stream(t.url);
    s.el.currentTime = 0;
    this.fadeIn(s, TRACK_LEVEL, 1.4, this.input, false);
    const p: Playing = { t, s, tail: false };
    this.track = p;
    // The track ran out while we lingered (or wouldn't load): the scene comes back.
    const over = () => {
      if (this.track !== p) return;
      this.track = null; this.done = true;
      this.duck(false);
      this.emit();
    };
    s.el.onended = over;
    s.el.onerror = over;
  }

  private endTrack(fade: number) {
    const p = this.track;
    if (!p) return;
    this.track = null;
    p.s.el.onended = p.s.el.onerror = null;
    this.fadeOut(p.s, fade, true);
  }

  private duck(on: boolean) {
    if (!this.ctx) return;
    const g = this.scenes.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(on ? 0 : 1, now, on ? 0.3 : 0.9);
  }

  private start(key: SceneKey) {
    const song = this.songs[key];
    if (song) {
      const s = this.stream(`/${song.url}`);
      this.fadeIn(s, songLevel(song.lufs), 2.2, this.scenes, true);
      this.running.push({ key, song: s });
      return;
    }
    const ctx = this.ctx!, now = ctx.currentTime;
    const fade = ctx.createGain(), send = ctx.createGain();
    fade.gain.setValueAtTime(0.0001, now);
    fade.gain.exponentialRampToValueAtTime(SCENES[key].level, now + 2.2);
    send.gain.value = SCENES[key].send;
    fade.connect(this.scenes); fade.connect(send).connect(this.verb);
    const synth: Synth = { fade, send, step: 0, next: now + 0.08 };
    synth.stopBed = SCENES[key].bed?.(this.kit, fade);
    this.running.push({ key, synth });
  }

  private stop(r: Running, fadeOut: number) {
    this.running = this.running.filter(x => x !== r);
    if (r.song) return this.fadeOut(r.song, fadeOut);
    const ctx = this.ctx!, sy = r.synth!;
    sy.fade.gain.cancelScheduledValues(ctx.currentTime);
    sy.fade.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, fadeOut / 4));
    setTimeout(() => { sy.stopBed?.(); sy.fade.disconnect(); sy.send.disconnect(); }, (fadeOut + 4) * 1000);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.18;
    for (const r of this.running) {
      const sy = r.synth;
      if (!sy) continue;
      const sc = SCENES[r.key], q = 60 / sc.bpm / 4;
      // Fell behind (a stalled tab): skip ahead rather than play a pile of notes at once.
      if (sy.next < ctx.currentTime - 0.2) sy.next = ctx.currentTime + 0.02;
      while (sy.next < ahead) {
        const st = sy.step % sc.steps;
        sc.play(this.kit, st, sy.next, sy.fade, q);
        const sw = sc.swing ?? 0.5;
        sy.next += q * 2 * (st % 2 === 0 ? sw : 1 - sw);
        sy.step++;
      }
    }
  }
}
