// JS-synthesized instrument samples (plucked, struck and percussive instruments),
// rendered lazily per pitch/variant and cached as AudioBuffers.
import {
  Out, makeRng, rr, mtof, ks, modes, white, pink, brown, svf, lp1, mul, ad, env, xenv, osc, addInto, zeros, secs,
  toBuffer, reverse, scale, drive, type Rng, type Sig, TAU,
} from '../dsp';

type Render = (sr: number, r: Rng, key: number) => Out;

/** fast additive partials using a recursive oscillator per partial */
function partials(sr: number, n: number, list: [number, number, number][], attack = 0.001): Sig {
  const o = zeros(n);
  const na = Math.max(1, Math.round(attack * sr));
  for (const [f, a, tau] of list) {
    if (f >= sr * 0.45 || a <= 0) continue;
    const w = TAU * f / sr; const c = 2 * Math.cos(w);
    let s1 = 0, s2 = -Math.sin(w);
    const k = Math.exp(-1 / (tau * sr)); let e = a;
    const len = Math.min(n, Math.ceil(tau * sr * 8));
    for (let i = 0; i < len; i++) {
      const s = c * s1 - s2; s2 = s1; s1 = s;
      o[i] += s * e * (i < na ? i / na : 1);
      e *= k;
    }
  }
  return o;
}

const R: Record<string, Render> = {
  harp: (sr, r, m) => {
    const f = mtof(m); const t60 = Math.max(0.8, 3.2 - (m - 40) * 0.035); const d = Math.min(4.5, t60 + 0.4);
    const o = new Out(sr, d);
    let s = ks(sr, o.n, f, t60, 0.55, r, 0.12);
    addInto(s, ks(sr, o.n, f * 1.0015, t60 * 0.9, 0.45, r, 0.2), 0.5);
    s = svf(s, sr, Math.min(12000, f * 10), 0.6, 'lp');
    addInto(s, partials(sr, o.n, [[f, 0.2, t60 * 0.5]]), 1);
    o.addWide(s, 0, 0.5, 0.15);
    return o.fade(0, 0.05);
  },
  pizz: (sr, r, m) => {
    const f = mtof(m); const o = new Out(sr, 0.9);
    let s = ks(sr, o.n, f, 0.45, 0.25, r, 0.3);
    addInto(s, ks(sr, o.n, f * 1.004, 0.4, 0.2, r, 0.35), 0.6);
    s = svf(s, sr, Math.min(6000, f * 5), 0.8, 'lp');
    addInto(s, svf(s, sr, 250, 2, 'bpn'), 0.4);
    o.addWide(s, 0, 0.6, 0.3);
    return o.fade(0, 0.05);
  },
  piano: (sr, r, m) => {
    const f0 = mtof(m); const d = m < 55 ? 5 : m < 72 ? 4 : 3; const o = new Out(sr, d);
    const B = 0.0003 + Math.max(0, m - 60) * 0.00002;
    const list: [number, number, number][] = [];
    for (let k = 1; k <= 16; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      const amp = Math.pow(k, -1.05) * (k === 1 ? 1 : 0.8) * (1 - 0.3 * Math.sin(k * 0.9));
      const tau = (m < 60 ? 3.2 : 2.4) / (1 + 0.35 * (k - 1)) * Math.pow(2, -(m - 60) / 24);
      for (const det of [0.9994, 1.0006]) list.push([fk * det, amp * 0.5, tau * (det > 1 ? 0.92 : 1)]);
    }
    const s = partials(sr, o.n, list, 0.002);
    // two-stage decay (prompt + aftersound)
    const hammer = mul(lp1(white(secs(sr, 0.03), r), sr, 2500), ad(sr, secs(sr, 0.03), 0.0005, 0.006));
    addInto(s, hammer, 0.25);
    o.addWide(s, 0, 0.35, 0.25);
    return o.fade(0, 0.1);
  },
  celesta: (sr, r, m) => {
    const f = mtof(m); const o = new Out(sr, 2.6);
    const s = partials(sr, o.n, [[f, 1, 1.2], [f * 2, 0.25, 0.4], [f * 3.0, 0.08, 0.2], [f * 4.2, 0.05, 0.08], [f * 1.002, 0.3, 1.0]], 0.0015);
    const click = mul(svf(white(secs(sr, 0.01), r), sr, f * 4, 1, 'bpn'), ad(sr, secs(sr, 0.01), 0.0002, 0.002));
    addInto(s, click, 0.1);
    o.addWide(s, 0, 0.5, 0.2);
    return o.fade(0, 0.05);
  },
  glock: (sr, r, m) => {
    const f = mtof(m); const o = new Out(sr, 2.6);
    const s = partials(sr, o.n, [[f, 1, 1.6], [f * 2.76, 0.4, 0.45], [f * 5.4, 0.2, 0.15], [f * 8.93, 0.1, 0.06]], 0.0008);
    addInto(s, mul(svf(white(secs(sr, 0.008), r), sr, 6000, 0.8, 'bpn'), ad(sr, secs(sr, 0.008), 0.0001, 0.0015)), 0.2);
    o.addWide(s, 0, 0.45, 0.15);
    return o.fade(0, 0.05);
  },
  bell: (sr, r, m) => {
    const f = mtof(m); const o = new Out(sr, 6);
    const set: [number, number, number][] = [[0.5, 0.35, 4], [1, 1, 3], [1.19, 0.45, 2.2], [1.5, 0.35, 1.8], [2, 0.45, 1.4], [2.52, 0.25, 1.0], [2.74, 0.25, 0.9], [3.76, 0.15, 0.6], [5.0, 0.08, 0.4]];
    const list = set.map(([k, a, t]) => [f * k * rr(r, 0.999, 1.001), a, t] as [number, number, number]);
    list.push([f * 1.003, 0.4, 2.8]);
    const s = partials(sr, o.n, list, 0.001);
    addInto(s, mul(svf(white(secs(sr, 0.02), r), sr, f * 3, 1, 'bpn'), ad(sr, secs(sr, 0.02), 0.0002, 0.004)), 0.15);
    o.addWide(s, 0, 0.35, 0.3);
    return o.fade(0, 0.2);
  },
  timp: (sr, r, m) => {
    const f = mtof(m); const d = 3.2; const o = new Out(sr, d);
    const n = o.n;
    const fm = xenv(sr, n, [0, 1.035, 0.06, 1.0, d, 0.998]);
    const s = modes(sr, n, [[f, 1, 1.5], [f * 1.505, 0.55, 0.9], [f * 1.99, 0.35, 0.7], [f * 2.44, 0.22, 0.5], [f * 2.9, 0.14, 0.35], [f * 0.67, 0.2, 0.15]], fm, r, 0.001);
    const mallet = mul(svf(white(secs(sr, 0.06), r), sr, 900, 0.7, 'lp'), ad(sr, secs(sr, 0.06), 0.0005, 0.012));
    addInto(s, mallet, 0.5);
    const boom = mul(osc(sr, n, xenv(sr, n, [0, f * 0.9, 0.1, f * 0.5]), 'sin'), ad(sr, n, 0.002, 0.12));
    addInto(s, boom, 0.4);
    o.addWide(s, 0, 0.5, 0.25);
    return o.fade(0, 0.1);
  },
  taiko: (sr, r, v) => {
    const big = v < 3; const d = big ? 2 : 1.2; const o = new Out(sr, d); const n = o.n;
    const f0 = big ? rr(r, 100, 115) : rr(r, 170, 190), f1 = big ? rr(r, 52, 60) : rr(r, 105, 120);
    const body = mul(osc(sr, n, xenv(sr, n, [0, f0, 0.08, f1, d, f1 * 0.92]), 'sin'), ad(sr, n, 0.0015, big ? 0.38 : 0.22));
    addInto(body, mul(osc(sr, n, f1 * 1.62, 'sin'), ad(sr, n, 0.001, 0.12)), 0.25);
    const skin = mul(svf(white(n, r), sr, big ? 320 : 600, 1, 'bpn'), ad(sr, n, 0.0005, 0.035));
    addInto(body, skin, 0.9);
    const slap = mul(svf(white(n, r), sr, 2500, 0.8, 'hp'), ad(sr, n, 0.0002, 0.008));
    addInto(body, slap, 0.25);
    drive(body, 1.3);
    o.addWide(body, 0, 0.8, 0.2);
    return o.fade(0, 0.05);
  },
  bassdrum: (sr, r) => {
    const d = 3; const o = new Out(sr, d); const n = o.n;
    const s = mul(osc(sr, n, xenv(sr, n, [0, 68, 0.15, 48, d, 45]), 'sin'), ad(sr, n, 0.004, 0.8));
    addInto(s, modes(sr, n, [[92, 0.4, 0.5], [141, 0.25, 0.35], [187, 0.15, 0.25]], undefined, r, 0.003), 1);
    const felt = mul(lp1(lp1(brown(n, r), sr, 300), sr, 300), ad(sr, n, 0.004, 0.08));
    addInto(s, felt, 2.5);
    o.addWide(s, 0, 0.7, 0.3);
    return o.fade(0, 0.2);
  },
  snare: (sr, r, v) => {
    const d = 0.7; const o = new Out(sr, d); const n = o.n;
    const b = modes(sr, n, [[rr(r, 180, 195), 1, 0.07], [rr(r, 320, 340), 0.6, 0.05], [rr(r, 470, 500), 0.3, 0.03]], undefined, r, 0.0005);
    const wires = mul(svf(svf(white(n, r), sr, 1800, 0.7, 'hp'), sr, 7000, 0.7, 'lp'), ad(sr, n, 0.0008, rr(r, 0.1, 0.14)));
    addInto(b, wires, 1.1);
    addInto(b, mul(svf(white(secs(sr, 0.01), r), sr, 4000, 1, 'bpn'), ad(sr, secs(sr, 0.01), 0.0001, 0.0015)), 0.6);
    o.addWide(b, 0, 0.6, 0.3);
    void v;
    return o.fade(0, 0.05);
  },
  tom: (sr, r, v) => {
    const f = [85, 115, 155][v % 3] * rr(r, 0.98, 1.02); const d = 1.2; const o = new Out(sr, d); const n = o.n;
    const s = mul(osc(sr, n, xenv(sr, n, [0, f * 1.35, 0.05, f, d, f * 0.95]), 'sin'), ad(sr, n, 0.0015, 0.3));
    addInto(s, mul(svf(white(n, r), sr, f * 3, 1.2, 'bpn'), ad(sr, n, 0.0005, 0.04)), 0.5);
    o.addWide(s, 0, 0.7, 0.2);
    return o.fade(0, 0.05);
  },
  crash: (sr, r) => {
    const d = 4.5; const o = new Out(sr, d);
    for (const ch of [0, 1]) {
      const n = o.n; const w = white(n, r);
      const s = zeros(n);
      const bands: [number, number, number, number][] = [[400, 1200, 1.6, 0.5], [1200, 4000, 2.2, 0.9], [4000, 9000, 1.6, 0.8], [9000, 16000, 0.9, 0.5]];
      for (const [lo, hi, tau, g] of bands) {
        const b = mul(svf(svf(w, sr, lo, 0.7, 'hp'), sr, hi, 0.7, 'lp'), ad(sr, n, 0.0008, tau));
        addInto(s, b, g);
      }
      for (let k = 0; k < 10; k++) addInto(s, mul(svf(w, sr, rr(r, 500, 7000), 25, 'bpn'), ad(sr, n, 0.001, rr(r, 0.6, 2))), 0.25);
      const hit = mul(svf(w, sr, 3000, 0.6, 'hp'), ad(sr, n, 0.0003, 0.02));
      addInto(s, hit, 0.6);
      if (ch === 0) o.L.set(s); else o.R.set(s);
    }
    return o.fade(0, 0.3);
  },
  revcym: (sr, r) => {
    const c = R.crash(sr, r, 0);
    const len = Math.round(2.4 * sr);
    const o = new Out(sr, 2.4);
    const L = reverse(c.L.subarray(0, len) as Sig), Rr = reverse(c.R.subarray(0, len) as Sig);
    o.addSt(L, Rr);
    // fold in a rising noise sweep for more "suck"
    const n = o.n;
    const sw = mul(svf(pink(n, r), sr, xenv(sr, n, [0, 400, 2.4, 9000]), 1.5, 'bpn'), env(sr, n, [0, 0, 2.38, 1, 2.4, 0], 3));
    o.addWide(sw, 0, 0.5, 0.6);
    return o.fade(0.05, 0.004);
  },
  shaker: (sr, r) => {
    const d = 0.12; const o = new Out(sr, d); const n = o.n;
    const s = mul(svf(white(n, r), sr, 6500, 1, 'bpn'), env(sr, n, [0, 0, 0.012, 1, 0.03, 0.4, 0.05, 0.7, 0.12, 0], 1.5));
    o.addWide(s, 0, 0.6, 0.4);
    return o;
  },
  hat: (sr, r) => {
    const d = 0.25; const o = new Out(sr, d); const n = o.n;
    const w = white(n, r);
    const s = mul(svf(w, sr, 8000, 0.7, 'hp'), ad(sr, n, 0.0003, 0.03));
    addInto(s, mul(svf(w, sr, 10500, 6, 'bpn'), ad(sr, n, 0.0003, 0.05)), 0.5);
    o.addWide(s, 0, 0.6, 0.3);
    return o;
  },
  gong: (sr, r) => {
    const d = 7; const o = new Out(sr, d);
    for (const ch of [0, 1]) {
      const n = o.n; const w = pink(n, r); const s = zeros(n);
      const bloom = env(sr, n, [0, 0.3, 0.4, 1, d, 0], 1.6);
      for (let k = 0; k < 16; k++) {
        const f = 70 * Math.pow(1.23, k) * rr(r, 0.95, 1.05);
        addInto(s, mul(svf(w, sr, f, 40, 'bpn'), ad(sr, n, 0.02, rr(r, 1.2, 3) / (1 + k * 0.08))), 1 / (1 + k * 0.2));
      }
      mul(s, bloom);
      addInto(s, mul(osc(sr, n, xenv(sr, n, [0, 90, 0.2, 60]), 'sin'), ad(sr, n, 0.003, 0.3)), 0.6);
      if (ch === 0) o.L.set(s); else o.R.set(s);
    }
    return o.normalize(0.9).fade(0, 0.3);
  },
  sub: (sr, r) => {
    const d = 3; const o = new Out(sr, d); const n = o.n;
    const s = mul(osc(sr, n, xenv(sr, n, [0, 62, 0.8, 32, d, 28]), 'sin'), ad(sr, n, 0.004, 0.9));
    o.add(s, 0, 0.9);
    void r;
    return o.fade(0, 0.2);
  },
  anvil: (sr, r) => {
    const d = 1.6; const o = new Out(sr, d); const n = o.n;
    const f = rr(r, 850, 950);
    const s = partials(sr, n, [[f, 1, 0.6], [f * 2.71, 0.6, 0.35], [f * 5.1, 0.4, 0.2], [f * 7.3, 0.2, 0.12], [f * 1.003, 0.5, 0.55]]);
    addInto(s, mul(svf(white(secs(sr, 0.01), r), sr, 5000, 1, 'bpn'), ad(sr, secs(sr, 0.01), 0.0001, 0.002)), 0.5);
    o.addWide(s, 0, 0.5, 0.2);
    return o.fade(0, 0.1);
  },
  heart: (sr, r) => {
    const o = new Out(sr, 0.7); const n = secs(sr, 0.35);
    const beat = (at: number, g: number, f: number): void => {
      const s = mul(osc(sr, n, xenv(sr, n, [0, f, 0.06, f * 0.7]), 'sin'), ad(sr, n, 0.004, 0.07));
      addInto(s, mul(lp1(brown(n, r), sr, 150), ad(sr, n, 0.004, 0.04)), 2);
      o.add(s, at, g);
    };
    beat(0, 1, 62); beat(0.22, 0.7, 52);
    return o.normalize(0.9);
  },
  boom: (sr, r) => {
    const d = 2.5; const o = new Out(sr, d); const n = o.n;
    const s = mul(osc(sr, n, xenv(sr, n, [0, 90, 0.2, 38, d, 30]), 'sin'), ad(sr, n, 0.002, 0.6));
    addInto(s, mul(lp1(brown(n, r), sr, 250), ad(sr, n, 0.002, 0.15)), 3);
    drive(s, 1.5);
    o.addWide(s, 0, 0.8, 0.2);
    return o.fade(0, 0.1);
  },
};

export class SampleBank {
  private map = new Map<string, AudioBuffer>();
  private queue: string[] = [];
  constructor(private ctx: BaseAudioContext) {}
  static kinds(): string[] { return Object.keys(R); }
  /** kind + key (midi note for pitched instruments, variant for percussion) */
  get(kind: string, key = 0): AudioBuffer {
    const k = `${kind}:${key}`;
    let b = this.map.get(k);
    if (!b) {
      const fn = R[kind] ?? R.harp;
      const r = makeRng(1000 + key * 7919 + kind.length * 31 + kind.charCodeAt(0));
      const o = fn(this.ctx.sampleRate, r, key);
      b = toBuffer(this.ctx, o);
      this.map.set(k, b);
    }
    return b;
  }
  has(kind: string, key = 0): boolean { return this.map.has(`${kind}:${key}`); }
  warm(kind: string, keys: number[]): void { for (const k of keys) if (!this.has(kind, k)) this.queue.push(`${kind}:${k}`); }
  /** render queued samples for up to budget ms */
  pump(budgetMs: number): boolean {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const s = this.queue.shift()!;
      const i = s.lastIndexOf(':');
      this.get(s.slice(0, i), parseInt(s.slice(i + 1), 10));
    }
    return this.queue.length > 0;
  }
  get pending(): number { return this.queue.length; }
}

export { scale };
