// The way between the binder and the world, after the cover of Sweet Trip's Velocity : Design : Comfort: a blue grid
// floor running to a horizon, a rainbow fan, glitch bars. Going out, the binder's sheet tips back into the floor and
// the sky goes from blue to black; arriving, the camera lifts off the floor into space. Coming home it runs backwards:
// the floor rises up to face you and turns back into paper. Drawn on one 2D canvas, so it costs nothing at rest.
import { reducedMotion, store } from './data.ts';

export type Dest = 'world' | 'binder';
const KEY = 'warp';
const PAPER: RGB = [251, 251, 250], BLACK: RGB = [5, 5, 7], SKY: RGB = [59, 61, 168], GRIDBLUE: RGB = [91, 134, 214], PALE: RGB = [196, 205, 255], INK: RGB = [18, 18, 22];
const RAINBOW = ['#E8473B', '#F28C2B', '#F5D13A', '#5DBB4C', '#33B6D9', '#3D63C9', '#8C55C8', '#F06FB0'];
export const WORDS: Record<Dest, { title: string; line: string }> = {
  world: { title: 'the world.', line: 'trk 02. drift : thread : listen.' },
  binder: { title: 'the binder.', line: 'trk 01. keep : sort : comfort.' },
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** 0→1 as t goes from a to b. */
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const out = (x: number) => 1 - (1 - x) ** 3;

/** One frame of the scene. Everything is a number so a timeline can ease between them. */
interface Frame {
  /** How far the overlay covers the page. */
  alpha: number;
  /** Floor tilt in degrees: 0 faces you like a sheet, 88 lies flat to the horizon. */
  tilt: number;
  /** Horizon offset as a fraction of the height: positive looks up, so the floor sinks out of view. */
  look: number;
  sky: RGB; floor: RGB; line: RGB; lineA: number;
  spacing: number;
  /** Floor travel, px per second toward you. */
  speed: number;
  fan: number; horizon: number; bars: number;
  text: RGB; textA: number; glitch: boolean;
  /** The loading screen's extras: cover clouds in the sky, haze toward the horizon, the fan kept to the right half. */
  clouds?: number; haze?: number; fanSide?: boolean;
}

/** A soft cumulus, drawn once: overlapping puffs, lit from above, shaded blue-grey underneath. */
function cloudSprite(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const n = 7 + Math.floor(Math.random() * 6);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = w * (0.14 + t * 0.72) + (Math.random() - 0.5) * w * 0.08;
    const r = h * (0.22 + Math.sin(Math.PI * t) * 0.24) * (0.8 + Math.random() * 0.4);
    const y = h * 0.66 - Math.sin(Math.PI * t) * h * 0.2 - Math.random() * h * 0.08 + (pass ? -r * 0.12 : r * 0.1);
    const grad = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
    if (pass === 0) { grad.addColorStop(0, 'rgba(176,186,214,.85)'); grad.addColorStop(1, 'rgba(176,186,214,0)'); }
    else { grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(0.6, 'rgba(246,248,255,.7)'); grad.addColorStop(1, 'rgba(240,244,255,0)'); }
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}

class Scene {
  el = document.createElement('div');
  cv = document.createElement('canvas');
  /** In front of the fan: the glitch bars. */
  fg = document.createElement('canvas');
  fgx = this.fg.getContext('2d')!;
  g = this.cv.getContext('2d')!;
  fan = document.createElement('div');
  type = document.createElement('div');
  scroll = 0;
  bars: { y: number; h: number; x: number; w: number; c: string; until: number }[] = [];
  clouds: { img: HTMLCanvasElement; x: number; y: number; s: number }[] = [];
  constructor(dest: Dest, words?: { title: string; line: string }) {
    this.el.className = 'warp';
    this.el.setAttribute('aria-hidden', 'true');
    this.fan.className = 'warp-fan';
    this.fan.style.background = `repeating-conic-gradient(from 0deg,${RAINBOW.map((c, i) => `${c} ${i * 4.5}deg ${(i + 1) * 4.5}deg`).join(',')})`;
    this.type.className = 'warp-type';
    const w = words ?? WORDS[dest];
    this.type.innerHTML = `<b data-text="${w.title}">${w.title}</b><span>${w.line}</span>`;
    this.el.append(this.cv, this.fan, this.fg, this.type);
    document.body.append(this.el);
    this.fit();
    addEventListener('resize', this.fit);
  }
  fit = () => {
    const r = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.cv, this.fg]) { c.width = innerWidth * r; c.height = innerHeight * r; }
    this.g.setTransform(r, 0, 0, r, 0, 0);
    this.fgx.setTransform(r, 0, 0, r, 0, 0);
  }

  draw(f: Frame, dt: number, now: number) {
    const { g } = this, W = innerWidth, H = innerHeight;
    this.el.style.opacity = String(f.alpha);
    this.scroll += f.speed * dt;
    const th = (f.tilt * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    const p = Math.max(420, H * 0.62);                // perspective distance
    const cx = W / 2, cy = H / 2 + f.look * H;
    const base = H / 2;                                // floor's near edge sits at the bottom of the screen
    const proj = (u: number, s: number) => { const z = -s * sin, k = p / (p - z); return [cx + u * k, cy + (base - s * cos) * k, k] as const; };
    const hy = sin > 0.02 ? cy - (p * cos) / sin : -1e5; // the horizon's screen y

    const top = Math.max(0, Math.min(H, hy));
    if (f.haze) {
      const sg = g.createLinearGradient(0, 0, 0, Math.max(1, top));
      sg.addColorStop(0, css(f.sky)); sg.addColorStop(1, css(mix(f.sky, PALE, f.haze)));
      g.fillStyle = sg;
    } else g.fillStyle = css(f.sky);
    g.fillRect(0, 0, W, H);
    if (f.clouds) this.drawClouds(f.clouds, top, dt);
    g.fillStyle = css(f.floor);
    g.fillRect(0, top, W, H - top);

    // Rows of constant depth; they thin out and fade toward the horizon.
    g.lineWidth = 1;
    const sp = f.spacing, off = ((this.scroll % sp) + sp) % sp;
    let lastY = Infinity;
    for (let i = 0; i < 2000; i++) {
      const s = i * sp - off;
      if (s < -sp) continue;
      const [, y, k] = proj(0, Math.max(s, 0));
      if (y < -2) break;
      if (lastY - y < 1.6) break;
      lastY = y;
      if (y > H + 2) continue;
      g.strokeStyle = css(f.line, f.lineA * Math.min(1, k * 1.4));
      g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke();
    }
    // Columns run from the near edge to the vanishing point.
    const reach = W * 4, cols = Math.ceil(reach / sp);
    const far = sin > 0.02 ? 60000 : H / Math.max(cos, 0.01);
    for (let j = -cols; j <= cols; j++) {
      const u = j * sp + 0.5;
      const [x0, y0] = proj(u, 0), [x1, y1] = proj(u, far);
      if ((x0 < -50 && x1 < -50) || (x0 > W + 50 && x1 > W + 50)) continue;
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, css(f.line, f.lineA));
      grad.addColorStop(1, css(f.line, sin > 0.02 ? 0 : f.lineA));
      g.strokeStyle = grad;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    if (f.horizon > 0 && hy > -10 && hy < H + 10) {
      const hg = g.createLinearGradient(0, 0, W, 0);
      hg.addColorStop(0, css(PALE, 0)); hg.addColorStop(0.5, css(PALE, f.horizon)); hg.addColorStop(1, css(PALE, 0));
      g.fillStyle = hg; g.fillRect(0, Math.round(hy) - 1, W, 2);
      g.fillStyle = css(PALE, f.horizon * 0.12); g.fillRect(0, Math.round(hy) - 14, W, 28);
    }

    // Glitch bars: slabs of colour that slip sideways for a frame or two, then vanish.
    if (f.bars > 0 && Math.random() < f.bars * 0.6) {
      const pal = [...RAINBOW, css(f.sky), css(PAPER), css(BLACK), css(SKY)];
      for (let i = 0; i < 1 + Math.floor(Math.random() * 3 * f.bars); i++) {
        const h = 2 + Math.random() ** 2 * H * 0.12;
        this.bars.push({ y: Math.random() * H, h, x: (Math.random() - 0.3) * W * 0.5, w: W * (0.3 + Math.random() * 0.9), c: pal[Math.floor(Math.random() * pal.length)], until: now + 40 + Math.random() * 110 });
      }
    }
    this.bars = this.bars.filter(b => b.until > now);
    const fx = this.fgx;
    fx.clearRect(0, 0, W, H);
    for (const b of this.bars) { fx.fillStyle = b.c; fx.fillRect(b.x, b.y, b.w, b.h); }

    // The rainbow fan opens from the vanishing point.
    this.fan.classList.toggle('side', !!f.fanSide);
    this.fan.style.opacity = String(f.fan);
    this.fan.style.transform = `translate(-50%,-50%) translate(${cx}px,${Math.max(-H, Math.min(2 * H, hy))}px) scale(${0.25 + f.fan * 1.1}) rotate(${this.scroll * 0.004}deg)`;

    this.type.style.color = css(f.text);
    this.type.style.opacity = String(f.textA);
    this.type.classList.toggle('glitch', f.glitch);
  }
  /** Clouds drift left across the sky, smaller and slower toward the horizon, and wrap round. */
  private drawClouds(a: number, horizon: number, dt: number) {
    const { g } = this, W = innerWidth;
    if (!this.clouds.length) for (let i = 0; i < 9; i++) {
      const s = 0.35 + Math.random() * 0.75;
      this.clouds.push({ img: cloudSprite(420, 180), x: Math.random() * W * 1.3 - W * 0.15, y: Math.random(), s });
    }
    g.save();
    g.beginPath(); g.rect(0, 0, W, horizon); g.clip();
    for (const c of [...this.clouds].sort((p, q) => p.s - q.s)) {
      c.x -= dt * 14 * c.s;
      const w = 420 * c.s * Math.max(0.6, W / 1400), h = 180 * c.s * Math.max(0.6, W / 1400);
      if (c.x < -w) c.x = W + Math.random() * 120;
      // Bigger clouds sit higher, the far small ones settle toward the horizon.
      const y = horizon * (0.08 + (1 - c.s) * 0.62 + c.y * 0.12) - h * 0.5;
      g.globalAlpha = a * (0.55 + c.s * 0.45);
      g.drawImage(c.img, c.x, y, w, h);
    }
    g.restore();
  }
  remove() { this.el.remove(); removeEventListener('resize', this.fit); }
}

/** Run a timeline: `at(t)` gives the frame for t in [0, dur] ms. Returns a stop. */
function run(scene: Scene, dur: number, at: (t: number) => Frame, done?: () => void) {
  const t0 = performance.now();
  let last = t0, stopped = false;
  const step = (now: number) => {
    if (stopped) return;
    const t = Math.min(dur, now - t0);
    scene.draw(at(t), (now - last) / 1000, now);
    last = now;
    if (t < dur) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
  return () => { stopped = true; };
}

/* ── the four timelines ── */

/** Binder → world, going out: the sheet tips back into the floor, the sky turns from VDC blue to black. */
function toWorld(t: number): Frame {
  const tip = io(span(t, 140, 700)), dusk = span(t, 380, 860), blue = span(t, 160, 440);
  return {
    alpha: out(span(t, 0, 170)),
    tilt: tip * 88, look: 0,
    sky: dusk > 0 ? mix(SKY, BLACK, io(dusk)) : mix(PAPER, SKY, io(blue)),
    floor: mix(PAPER, BLACK, io(span(t, 420, 860))),
    line: mix(GRIDBLUE, PALE, span(t, 450, 800)), lineA: 0.55 - 0.38 * span(t, 780, 1000),
    spacing: 40 + tip * 24,
    speed: 2600 * io(span(t, 300, 760)) * (1 - 0.85 * span(t, 780, 1000)),
    fan: Math.sin(Math.PI * span(t, 430, 900)) * 0.78,
    horizon: span(t, 600, 900) * 0.55,
    bars: Math.max(span(t, 40, 120) * (1 - span(t, 260, 360)), Math.sin(Math.PI * span(t, 700, 900)) * 0.6),
    text: mix(INK, [244, 244, 242], span(t, 300, 520)), textA: out(span(t, 120, 320)),
    glitch: t < 340 || (t > 720 && t < 860),
  };
}

/** World, arriving: from the floor at the horizon, the camera looks up into space and the overlay lets go. */
function intoWorld(fromWarp: boolean) {
  const lead = fromWarp ? 0 : 520;
  return (t: number): Frame => {
    const lift = io(span(t, lead + 380, lead + 1150));
    return {
      alpha: 1 - io(span(t, lead + 600, lead + 1200)),
      tilt: 88 + lift * 2, look: lift * 0.75,
      sky: BLACK, floor: BLACK, line: PALE,
      lineA: 0.17 * (fromWarp ? 1 : out(span(t, 60, 480))) * (1 - lift * 0.6),
      spacing: 64,
      speed: 180 + 1400 * lift,
      fan: 0,
      horizon: 0.55 * (fromWarp ? 1 : out(span(t, 0, 420))) + Math.sin(Math.PI * span(t, lead + 300, lead + 800)) * 0.45,
      bars: Math.sin(Math.PI * span(t, lead + 420, lead + 760)) * 0.7,
      text: [244, 244, 242], textA: (fromWarp ? 1 : out(span(t, 120, 420))) * (1 - span(t, lead + 520, lead + 720)),
      glitch: (!fromWarp && t < 420) || (t > lead + 420 && t < lead + 720),
    };
  };
}

/** World → binder, going out: the camera looks back down at the floor, which rises up to face you and turns to paper. */
function toBinder(t: number): Frame {
  const down = io(span(t, 60, 420)), rise = io(span(t, 360, 860)), dawn = span(t, 380, 640), day = span(t, 600, 880);
  return {
    alpha: out(span(t, 0, 200)),
    tilt: 90 - down * 2 - rise * 88, look: (1 - down) * 0.75,
    sky: day > 0 ? mix(SKY, PAPER, io(day)) : mix(BLACK, SKY, io(dawn)),
    floor: mix(BLACK, PAPER, io(span(t, 480, 880))),
    line: t > 640 ? mix(GRIDBLUE, INK, io(span(t, 640, 900))) : mix(PALE, GRIDBLUE, span(t, 400, 640)),
    lineA: 0.2 + 0.3 * span(t, 200, 500) - 0.45 * io(span(t, 600, 900)),
    spacing: 64 - 40 * rise,
    speed: -2200 * Math.sin(Math.PI * span(t, 200, 860)),
    fan: Math.sin(Math.PI * span(t, 380, 760)) * 0.75,
    horizon: 0.5 * (1 - span(t, 600, 800)),
    bars: Math.max(Math.sin(Math.PI * span(t, 0, 260)) * 0.8, Math.sin(Math.PI * span(t, 780, 950)) * 0.4),
    text: mix([244, 244, 242], INK, span(t, 560, 760)), textA: out(span(t, 100, 300)),
    glitch: t < 320 || t > 800,
  };
}

/** Binder, arriving: the paper with its grid fades off the page as the ink comes in. */
function intoBinder(t: number): Frame {
  return {
    alpha: 1 - io(span(t, 180, 620)), tilt: 0, look: 0,
    sky: PAPER, floor: PAPER, line: INK, lineA: 0.05, spacing: 24, speed: 0,
    fan: 0, horizon: 0, bars: Math.sin(Math.PI * span(t, 40, 260)) * 0.5,
    text: INK, textA: 1 - span(t, 120, 300), glitch: t < 300,
  };
}

/* ── sound: a short riser or fall, only if the world's music is on ── */

function whoosh(dest: Dest) {
  if (!store.get('world.sound', true) || reducedMotion()) return;
  let ctx: AudioContext;
  try { ctx = new AudioContext(); } catch { return; }
  const t = ctx.currentTime + 0.02, up = dest === 'world';
  const master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination);
  const n = ctx.sampleRate;
  const buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(up ? 300 : 5200, t);
  bp.frequency.exponentialRampToValueAtTime(up ? 5600 : 260, t + 0.85);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.6); ng.gain.exponentialRampToValueAtTime(0.001, t + 1);
  src.connect(bp).connect(ng).connect(master); src.start(t); src.stop(t + 1.05);
  // A stutter of crushed blips climbing (or falling) on thirty-seconds.
  const notes = up ? [72, 74, 76, 79, 81, 84, 86, 91] : [91, 86, 84, 81, 79, 76, 74, 72];
  notes.forEach((m, i) => {
    const at = t + 0.12 + i * 0.075, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 440 * 2 ** ((m - 69) / 12);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.06, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(master); o.start(at); o.stop(at + 0.08);
  });
  setTimeout(() => ctx.close(), 1600);
}

/* ── public ── */

let leaving = false;

/** Leave for `href` through the warp. */
export function warpTo(href: string, dest: Dest, before?: () => void) {
  if (leaving) return;
  leaving = true;
  before?.();
  try { sessionStorage.setItem(KEY, JSON.stringify({ dest, at: Date.now() })); } catch { /* private mode */ }
  if (reducedMotion()) { location.href = href; return; }
  whoosh(dest);
  const scene = new Scene(dest);
  document.documentElement.classList.add('warping');
  const dur = dest === 'world' ? 1000 : 950;
  run(scene, dur, dest === 'world' ? toWorld : toBinder, () => { location.href = href; });
}

/** Did we just come through the warp to `dest`? Consumes the note either way. */
export function cameThrough(dest: Dest): boolean {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!v) return false;
    const n = JSON.parse(v) as { dest: Dest; at: number };
    return n.dest === dest && Date.now() - n.at < 6000;
  } catch { return false; }
}

/** Play the arrival. The world plays it on every load (it is the boot); the binder only after a warp. The first
 * frame shows at once and holds until `ready` settles, so it picks up exactly where the last page left off.
 * `letGo` runs once, when the page underneath should come alive; `skip()` cuts the whole thing short. */
export function arrive(dest: Dest, fromWarp: boolean, ready: Promise<unknown>, letGo?: () => void) {
  let released = false, dead = false, stop = () => {}, timer = 0;
  const release = () => { if (!released) { released = true; scene.el.style.pointerEvents = 'none'; letGo?.(); } };
  const scene = new Scene(dest);
  const at = dest === 'binder' ? intoBinder : intoWorld(fromWarp);
  const dur = dest === 'binder' ? 640 : fromWarp ? 1250 : 1770;
  const end = () => { if (!dead) { dead = true; scene.remove(); } };
  if (reducedMotion()) { ready.finally(() => { end(); release(); }); return { skip: () => { end(); release(); } }; }
  scene.draw(at(0), 0, performance.now());
  ready.finally(() => {
    if (dead) return;
    stop = run(scene, dur, at, end);
    timer = window.setTimeout(release, dest === 'binder' ? 120 : (fromWarp ? 0 : 520) + 600);
  });
  const skip = () => {
    if (dead) return;
    dead = true;
    stop(); clearTimeout(timer);
    scene.el.style.transition = 'opacity .35s cubic-bezier(.45,0,.55,1)';
    scene.el.style.opacity = '0';
    setTimeout(() => scene.remove(), 400);
    release();
  };
  return { skip };
}

/* ── the loading screen: the cover itself, holding while the page loads ── */

const DREAM = { title: "It's all a dream,\nA dream in death", line: 'drl 136. loading : catalogue : comfort.' };
const SKYHI: RGB = [46, 48, 150];

/** The cover at rest: blue sky and clouds, the white floor gliding toward you, the fan turning on the right. */
function cover(t: number): Frame {
  return {
    alpha: 1, tilt: 88, look: 0.04,
    sky: SKYHI, haze: 0.42, clouds: out(span(t, 0, 500)),
    floor: PAPER, line: GRIDBLUE, lineA: 0.6, spacing: 64, speed: 140,
    fan: 0.78 * out(span(t, 120, 900)), fanSide: true, horizon: 0.25,
    bars: Math.sin(Math.PI * span(t, 0, 260)) * 0.7,
    text: [250, 250, 252], textA: out(span(t, 80, 300)), glitch: t < 420,
  };
}
/** Leaving the cover for the world: dusk falls, the fan sweeps shut, then the camera looks up into space. */
function coverToWorld(t: number): Frame {
  const dusk = io(span(t, 0, 520)), lift = io(span(t, 520, 1250));
  return {
    alpha: 1 - io(span(t, 760, 1300)), tilt: 88 + lift * 2, look: 0.04 + lift * 0.72,
    sky: mix(SKYHI, BLACK, dusk), haze: 0.42 * (1 - dusk), clouds: 1 - out(span(t, 0, 420)),
    floor: mix(PAPER, BLACK, dusk), line: mix(GRIDBLUE, PALE, dusk), lineA: 0.6 - 0.43 * dusk, spacing: 64,
    speed: 140 + 2200 * Math.sin(Math.PI * span(t, 100, 700)),
    fan: 0.78 * (1 - out(span(t, 120, 560))) + Math.sin(Math.PI * span(t, 120, 520)) * 0.2, fanSide: t < 220, horizon: 0.25 + 0.4 * dusk,
    bars: Math.sin(Math.PI * span(t, 0, 300)) * 0.6 + Math.sin(Math.PI * span(t, 560, 860)) * 0.6,
    text: [250, 250, 252], textA: 1 - span(t, 300, 560), glitch: t > 240 && t < 560,
  };
}
/** Leaving the cover for the binder: the floor rises up to face you and turns to paper, then lifts off. */
function coverToBinder(t: number): Frame {
  const rise = io(span(t, 80, 760)), day = io(span(t, 200, 700));
  return {
    alpha: 1 - io(span(t, 820, 1200)), tilt: 88 * (1 - rise), look: 0.04 * (1 - rise),
    sky: mix(SKYHI, PAPER, day), haze: 0.42 * (1 - day), clouds: 1 - out(span(t, 0, 380)),
    floor: PAPER, line: mix(GRIDBLUE, INK, io(span(t, 400, 800))), lineA: 0.6 - 0.55 * io(span(t, 300, 800)), spacing: 64 - 40 * rise,
    speed: -900 * Math.sin(Math.PI * span(t, 0, 760)),
    fan: 0.78 * (1 - out(span(t, 60, 500))), fanSide: true, horizon: 0.25 * (1 - rise),
    bars: Math.sin(Math.PI * span(t, 0, 280)) * 0.6 + Math.sin(Math.PI * span(t, 760, 980)) * 0.3,
    text: mix([250, 250, 252], INK, span(t, 260, 600)), textA: 1 - span(t, 520, 800), glitch: t > 400 && t < 800,
  };
}

/** The loading screen, shown on any load that didn't come through the warp. It holds the cover for at least
 * `minHold` ms and until `ready` settles, then turns into the page. `letGo` runs once, as the page comes alive. */
export function loader(dest: Dest, ready: Promise<unknown>, letGo?: () => void, minHold = 1900) {
  let released = false, dead = false, readyAt = Infinity, outAt = Infinity;
  const release = () => { if (!released) { released = true; scene.el.style.pointerEvents = 'none'; letGo?.(); } };
  const scene = new Scene(dest, DREAM);
  scene.type.classList.add('dream');
  const bar = document.createElement('i');
  bar.className = 'warp-progress';
  scene.type.append(bar);
  const end = () => { if (!dead) { dead = true; scene.remove(); } };
  if (reducedMotion()) { ready.finally(() => { end(); release(); }); return { skip: () => { end(); release(); } }; }
  const exit = dest === 'world' ? coverToWorld : coverToBinder, exitDur = dest === 'world' ? 1300 : 1200;
  const t0 = performance.now();
  ready.finally(() => { readyAt = performance.now(); });
  let last = t0, shown = 0;
  const step = (now: number) => {
    if (dead) return;
    const t = now - t0;
    // Honest-ish progress: creeps toward 90% while waiting, fills when ready.
    const target = readyAt < Infinity ? 1 : 0.9 * (1 - Math.exp(-t / 1400));
    shown += (target - shown) * 0.08;
    bar.style.transform = `scaleX(${shown.toFixed(3)})`;
    if (outAt === Infinity && readyAt < Infinity && t > minHold) outAt = t;
    const f = outAt === Infinity ? cover(t) : exit(t - outAt);
    scene.draw(f, (now - last) / 1000, now);
    last = now;
    if (outAt < Infinity && t - outAt > (dest === 'world' ? 560 : 420)) release();
    if (outAt < Infinity && t - outAt >= exitDur) { release(); end(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  const skip = () => {
    if (dead) return;
    // Skipping still waits for the page; it just stops holding the cover.
    minHold = 0;
    ready.finally(() => { if (outAt === Infinity) outAt = performance.now() - t0; });
  };
  return { skip };
}

/** Send same-origin links to `dest` through the warp. */
export function warpLinks(selector: string, dest: Dest, before?: () => void) {
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(selector);
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    warpTo(a.href, dest, before);
  });
}

// Back/forward restores a page from cache mid-warp: clear the overlay.
addEventListener('pageshow', e => {
  if (!e.persisted) return;
  leaving = false;
  document.documentElement.classList.remove('warping');
  document.querySelectorAll('.warp').forEach(el => el.remove());
});

// Freeze any timeline at t ms, for tuning from the console: warpFrame('toWorld', 500).
if (import.meta.env.DEV) {
  const lines: Record<string, [Dest, (t: number) => Frame, boolean?]> = {
    toWorld: ['world', toWorld], intoWorld: ['world', intoWorld(true)], intoWorldDirect: ['world', intoWorld(false)], toBinder: ['binder', toBinder], intoBinder: ['binder', intoBinder],
    cover: ['world', cover, true], coverToWorld: ['world', coverToWorld, true], coverToBinder: ['binder', coverToBinder, true],
  };
  Object.assign(window, {
    warpFrame(name: string, t: number) {
      document.querySelectorAll('.warp').forEach(el => el.remove());
      const [dest, at, dream] = lines[name];
      const s = new Scene(dest, dream ? DREAM : undefined);
      if (dream) s.type.classList.add('dream');
      for (let x = 0; x <= t; x += 16) s.draw(at(x), 0.016, 0);
      s.bars = [];
      s.draw(at(t), 0, 1e9);
    },
  });
}
