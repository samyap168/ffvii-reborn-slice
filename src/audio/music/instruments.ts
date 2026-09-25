// Realtime synthesized orchestral/hybrid instruments and per-piece mixer channels.
import { mtof, clamp } from '../dsp';
import type { SampleBank } from './samples';

export interface MusicEnv {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  samples: SampleBank;
  organ: PeriodicWave;
  rnd: () => number;
}

export type ChanFx = 'none' | 'strings' | 'ens' | 'choir' | 'brass' | 'guitar' | 'perc';
export interface ChanSpec { id: string; stem: string; fx: ChanFx; vol: number; send: number; pan?: number; vib?: number; formantShift?: number }

const VOWELS: Record<string, [number, number, number, number]> = {
  a: [760, 1180, 2600, 3300],
  o: [500, 850, 2500, 3200],
  u: [350, 700, 2450, 3150],
  e: [520, 1750, 2550, 3350],
  i: [330, 2150, 2900, 3500],
};

let curveCache: Float32Array<ArrayBuffer> | null = null;
function driveCurve(): Float32Array<ArrayBuffer> {
  if (curveCache) return curveCache;
  const n = 2048; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
  return (curveCache = c);
}
let hardCache: Float32Array<ArrayBuffer> | null = null;
function hardCurve(): Float32Array<ArrayBuffer> {
  if (hardCache) return hardCache;
  const n = 2048; const c = new Float32Array(n);
  const o = Math.tanh(0.1);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (Math.tanh(5 * x + 0.1) - o) * 0.9; }
  return (hardCache = c);
}

/** A mixer channel inside a piece: input -> fx -> level (stem gain) -> piece bus (+ reverb send). */
export class Channel {
  readonly input: GainNode;
  readonly out: GainNode;
  readonly send: GainNode;
  readonly vib: GainNode | null = null;
  readonly vib2: GainNode | null = null;
  /** choir breath-noise input (shared band-pass) */
  readonly breath: GainNode | null = null;
  private readonly nodes: AudioNode[] = [];
  private formantFilters: BiquadFilterNode[] = [];
  private readonly shift: number;
  stemGain = 0;
  target = 0;
  constructor(readonly env: MusicEnv, readonly spec: ChanSpec, dest: AudioNode, wet: AudioNode) {
    const ctx = env.ctx;
    this.shift = spec.formantShift ?? 1;
    this.input = ctx.createGain();
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.send = ctx.createGain(); this.send.gain.value = spec.send;
    let tail: AudioNode = this.input;
    const add = <T extends AudioNode>(n: T): T => { this.nodes.push(n); return n; };
    switch (spec.fx) {
      case 'strings': {
        // stereo chorus ensemble
        const merge = add(ctx.createGain());
        this.input.connect(merge);
        // static (unmodulated) ensemble taps: lets idle channels go silent and cost nothing
        for (const [dt, pan] of [[0.013, -0.7], [0.019, 0.7]] as const) {
          const d = add(ctx.createDelay(0.05)); d.delayTime.value = dt;
          const p = add(ctx.createStereoPanner()); p.pan.value = pan;
          const g = add(ctx.createGain()); g.gain.value = 0.55;
          this.input.connect(d).connect(g).connect(p).connect(merge);
        }
        const shelf = add(ctx.createBiquadFilter()); shelf.type = 'highshelf'; shelf.frequency.value = 5500; shelf.gain.value = -4;
        const body = add(ctx.createBiquadFilter()); body.type = 'peaking'; body.frequency.value = 350; body.Q.value = 0.8; body.gain.value = 1.5;
        merge.connect(shelf).connect(body);
        tail = body;
        break;
      }
      case 'ens': {
        // cheap static ensemble widening (fixed delays, no modulation)
        const merge = add(ctx.createGain());
        this.input.connect(merge);
        for (const [dt, pan] of [[0.011, -0.75], [0.017, 0.75]] as const) {
          const d = add(ctx.createDelay(0.05)); d.delayTime.value = dt;
          const p = add(ctx.createStereoPanner()); p.pan.value = pan;
          const g = add(ctx.createGain()); g.gain.value = 0.5;
          this.input.connect(d).connect(g).connect(p).connect(merge);
        }
        const shelf = add(ctx.createBiquadFilter()); shelf.type = 'highshelf'; shelf.frequency.value = 5500; shelf.gain.value = -4;
        merge.connect(shelf);
        tail = shelf;
        break;
      }
      case 'choir': {
        const sum = add(ctx.createGain());
        const V = VOWELS.a;
        const qs = [7, 9, 12, 14], gs = [1, 0.62, 0.3, 0.16];
        for (let k = 0; k < 4; k++) {
          const b = add(ctx.createBiquadFilter()); b.type = 'bandpass'; b.frequency.value = V[k] * this.shift; b.Q.value = qs[k];
          const g = add(ctx.createGain()); g.gain.value = gs[k] * 2.2;
          this.input.connect(b).connect(g).connect(sum);
          this.formantFilters.push(b);
        }
        const dry = add(ctx.createBiquadFilter()); dry.type = 'lowpass'; dry.frequency.value = 500; const dg = add(ctx.createGain()); dg.gain.value = 0.25;
        this.input.connect(dry).connect(dg).connect(sum);
        // chorus for ensemble width
        const d = add(ctx.createDelay(0.05)); d.delayTime.value = 0.017;
        const p1 = add(ctx.createStereoPanner()); p1.pan.value = 0.6; const p0 = add(ctx.createStereoPanner()); p0.pan.value = -0.4;
        const out = add(ctx.createGain());
        sum.connect(p0).connect(out); sum.connect(d).connect(p1).connect(out);
        const br = add(ctx.createGain());
        const bf = add(ctx.createBiquadFilter()); bf.type = 'bandpass'; bf.frequency.value = 2600 * this.shift; bf.Q.value = 0.9;
        br.connect(bf).connect(out);
        (this as { breath: GainNode | null }).breath = br;
        tail = out;
        break;
      }
      case 'brass': {
        const sh = add(ctx.createWaveShaper()); sh.curve = driveCurve();
        const pre = add(ctx.createGain()); pre.gain.value = 0.9;
        const pk = add(ctx.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 1300; pk.Q.value = 0.9; pk.gain.value = 2;
        const post = add(ctx.createGain()); post.gain.value = 1.0;
        this.input.connect(pre).connect(sh).connect(pk).connect(post);
        tail = post;
        break;
      }
      case 'guitar': {
        const pre = add(ctx.createGain()); pre.gain.value = 5;
        const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 100;
        const sh = add(ctx.createWaveShaper()); sh.curve = hardCurve(); sh.oversample = '4x';
        const pk = add(ctx.createBiquadFilter()); pk.type = 'peaking'; pk.frequency.value = 850; pk.Q.value = 1; pk.gain.value = 4;
        const cab = add(ctx.createBiquadFilter()); cab.type = 'lowpass'; cab.frequency.value = 4200; cab.Q.value = 0.9;
        const cab2 = add(ctx.createBiquadFilter()); cab2.type = 'lowpass'; cab2.frequency.value = 6500; cab2.Q.value = 0.6;
        const post = add(ctx.createGain()); post.gain.value = 0.16;
        const dcb = add(ctx.createBiquadFilter()); dcb.type = 'highpass'; dcb.frequency.value = 40;
        this.input.connect(pre).connect(hp).connect(sh).connect(dcb).connect(pk).connect(cab).connect(cab2).connect(post);
        // double-tracked width
        const d = add(ctx.createDelay(0.05)); d.delayTime.value = 0.021;
        const pl = add(ctx.createStereoPanner()); pl.pan.value = -0.75; const pr = add(ctx.createStereoPanner()); pr.pan.value = 0.75;
        const out = add(ctx.createGain());
        post.connect(pl).connect(out); post.connect(d).connect(pr).connect(out);
        tail = out;
        break;
      }
      default: break;
    }
    if (spec.pan) {
      const p = add(ctx.createStereoPanner()); p.pan.value = spec.pan;
      tail.connect(p); tail = p;
    }
    tail.connect(this.out);
    this.out.connect(dest);
    this.out.connect(this.send).connect(wet);
    // vibrato LFOs (two slightly different rates so voices don't move in lockstep)
    const vd = spec.vib ?? (spec.fx === 'choir' ? 11 : 0);
    if (vd > 0) {
      const mk = (rate: number): GainNode => {
        const o = add(ctx.createOscillator()); o.frequency.value = rate;
        const g = ctx.createGain(); g.gain.value = vd; o.connect(g); o.start(); this.nodes.push(g); return g;
      };
      this.vib = mk(spec.fx === 'choir' ? 5.3 : 5.1);
      this.vib2 = mk(spec.fx === 'choir' ? 5.9 : 5.7);
    }
  }
  setVowel(v: keyof typeof VOWELS, t: number, glide = 0.4): void {
    const V = VOWELS[v];
    this.formantFilters.forEach((f, k) => f.frequency.setTargetAtTime(V[k] * this.shift, t, glide / 3));
  }
  setLevel(g: number, t: number, tc: number): void {
    this.target = g;
    this.out.gain.setTargetAtTime(g * this.spec.vol, t, tc);
  }
  dispose(): void {
    for (const n of this.nodes) {
      try { if (n instanceof AudioScheduledSourceNode) n.stop(); } catch { /* */ }
      try { n.disconnect(); } catch { /* */ }
    }
    for (const n of [this.input, this.out, this.send]) { try { n.disconnect(); } catch { /* */ } }
  }
}

export type Art = 'legato' | 'swell' | 'marc' | 'stacc' | 'trem' | 'stab' | 'sus';
export interface NoteOpts { art?: Art; pan?: number; glide?: number; bright?: number; detune?: number; vowel?: string; mute?: boolean; release?: number; /** semitones of upward pitch drift over the note */ rise?: number }

/** switch an AudioParam to k-rate (per 128-sample block) automation where supported: much cheaper */
export function kr(p: AudioParam): void {
  try { (p as AudioParam & { automationRate: AutomationRate }).automationRate = 'k-rate'; } catch { /* unsupported */ }
}

function cleanup(src: AudioScheduledSourceNode, nodes: AudioNode[], vibs: [GainNode | null, AudioParam][]): void {
  src.onended = () => {
    for (const [v, p] of vibs) if (v) { try { v.disconnect(p); } catch { /* */ } }
    for (const n of nodes) { try { n.disconnect(); } catch { /* */ } }
  };
}

function envelope(p: AudioParam, t: number, dur: number, atk: number, peak: number, sus: number, decTc: number, rel: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + atk);
  if (sus !== peak) p.setTargetAtTime(sus, t + atk, decTc);
  const off = Math.max(t + atk, t + dur);
  p.setTargetAtTime(0, off, rel / 4);
  return off + rel * 1.8;
}

/** Bowed string ensemble. `midi` may be a chord (voices share one filter/envelope: used for short articulations). */
export function strings(ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const art = o.art ?? 'legato';
  const list = typeof midi === 'number' ? [midi] : midi;
  const f = mtof(list.reduce((a, b) => a + b, 0) / list.length);
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.8; kr(flt.frequency); kr(flt.Q);
  const short = art === 'stacc' || art === 'marc';
  const bright = clamp(f * (2.2 + 4 * vel) * (o.bright ?? 1) + 900 * vel, 400, 16000);
  const atk = art === 'legato' ? 0.16 + 0.3 * (1 - vel) : art === 'swell' ? Math.max(0.2, dur * 0.65) : art === 'marc' ? 0.02 : art === 'stacc' ? 0.005 : 0.07;
  const rel = art === 'stacc' ? 0.08 : art === 'marc' ? 0.22 : o.release ?? 0.55;
  flt.frequency.setValueAtTime(Math.min(bright, f * 1.4), t);
  flt.frequency.linearRampToValueAtTime(bright, t + atk * 1.2 + 0.01);
  if (short) flt.frequency.setTargetAtTime(bright * 0.6, t + atk + 0.02, 0.08);
  const peak = vel * 0.1 * (list.length > 1 ? 1 / Math.sqrt(list.length) * 1.2 : 1);
  const sus = art === 'marc' ? peak * 0.55 : art === 'stacc' ? peak * 0.3 : peak;
  const end = envelope(g.gain, t, dur, atk, peak, sus, art === 'stacc' ? 0.04 : 0.12, rel);
  const nodes: AudioNode[] = [g, flt];
  const vibs: [GainNode | null, AudioParam][] = [];
  let first: OscillatorNode | null = null;
  const perPitch = short && list.length > 1 ? [0] : short ? [-6, 7] : [-8, 8];
  list.forEach((m, j) => {
    const fm = mtof(m);
    perPitch.forEach((dt, i) => {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; kr(osc.frequency); kr(osc.detune);
      osc.frequency.value = fm;
      const dtv = dt + (ch.env.rnd() - 0.5) * (list.length > 1 && short ? 16 : 6) + (o.detune ?? 0);
      osc.detune.value = dtv;
      if (o.rise) { osc.detune.setValueAtTime(dtv, t); osc.detune.linearRampToValueAtTime(dtv + o.rise * 100, t + dur); }
      if (o.glide) { osc.frequency.setValueAtTime(mtof(o.glide), t); osc.frequency.exponentialRampToValueAtTime(fm, t + 0.12); }
      osc.connect(flt);
      if (!short) { const v = (i + j) % 2 ? ch.vib2 : ch.vib; if (v) { v.connect(osc.detune); vibs.push([v, osc.detune]); } }
      osc.start(t); osc.stop(end);
      nodes.push(osc);
      if (!first) first = osc;
    });
  });
  if (art === 'trem') {
    const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 11 + ch.env.rnd() * 3;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    const tg = ctx.createGain(); tg.gain.value = 0.5;
    lfo.connect(lg).connect(tg.gain);
    flt.connect(tg).connect(g);
    lfo.start(t); lfo.stop(end);
    nodes.push(lfo, lg, tg);
  } else flt.connect(g);
  g.connect(ch.input);
  cleanup(first!, nodes, vibs);
}

/** Brass section / french horns */
export function brass(ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o: NoteOpts = {}, horn = false): void {
  const ctx = ch.env.ctx; const art = o.art ?? 'sus';
  const list = typeof midi === 'number' ? [midi] : midi;
  const f = mtof(list.reduce((a, b) => a + b, 0) / list.length);
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = horn ? 0.9 : 1.4; kr(flt.frequency); kr(flt.Q);
  const stab = art === 'stab';
  const atk = stab ? 0.012 : art === 'marc' ? 0.03 : art === 'swell' ? Math.max(0.2, dur * 0.7) : horn ? 0.09 : 0.055;
  const b = o.bright ?? 1;
  const peakF = clamp(f * (horn ? 2.2 + 3 * vel : 3 + 8 * vel) * b, 300, 15000);
  const susF = clamp(f * (horn ? 1.7 + 1.6 * vel : 2.2 + 4 * vel) * b, 250, 12000);
  flt.frequency.setValueAtTime(f * 1.1, t);
  flt.frequency.linearRampToValueAtTime(peakF, t + atk * 1.2 + 0.01);
  flt.frequency.setTargetAtTime(stab ? f * 1.3 : susF, t + atk * 1.2 + 0.01, stab ? 0.08 : 0.25);
  const peak = vel * (horn ? 0.085 : 0.056) * (list.length > 1 ? 1.3 / Math.sqrt(list.length) : 1);
  const rel = stab ? 0.12 : o.release ?? (horn ? 0.35 : 0.22);
  const d = stab ? Math.min(dur, 0.18) : dur;
  const end = envelope(g.gain, t, d, atk, peak, stab ? peak * 0.35 : art === 'marc' ? peak * 0.6 : peak * 0.85, stab ? 0.06 : 0.2, rel);
  const nodes: AudioNode[] = [g, flt];
  const vibs: [GainNode | null, AudioParam][] = [];
  const chordMode = list.length > 1;
  const types: OscillatorType[] = chordMode ? ['sawtooth'] : horn ? ['sawtooth', 'triangle'] : ['sawtooth', 'sawtooth'];
  const dets = chordMode ? [0] : horn ? [-4, 4] : [-6, 5];
  let first: OscillatorNode | null = null;
  const voices: [OscillatorType, number, number][] = [];
  for (const m of list) types.forEach((ty, i) => voices.push([ty, dets[i] + (chordMode ? (ch.env.rnd() - 0.5) * 14 : 0), mtof(m)]));
  voices.forEach(([ty, dt0, fv], i) => {
    const osc = ctx.createOscillator(); osc.type = ty; kr(osc.frequency); kr(osc.detune);
    osc.frequency.value = fv;
    const dt = dt0 + (ch.env.rnd() - 0.5) * 4;
    if (!stab && art !== 'swell') { osc.detune.setValueAtTime(dt - 30, t); osc.detune.linearRampToValueAtTime(dt, t + 0.07); }
    else osc.detune.value = dt;
    if (o.rise) { osc.detune.setValueAtTime(dt, t + 0.08); osc.detune.linearRampToValueAtTime(dt + o.rise * 100, t + dur); }
    osc.connect(flt);
    if (!stab) { const v = i % 2 ? ch.vib2 : ch.vib; if (v) { v.connect(osc.detune); vibs.push([v, osc.detune]); } }
    osc.start(t); osc.stop(end);
    nodes.push(osc);
    if (!first) first = osc;
  });
  flt.connect(g).connect(ch.input);
  cleanup(first!, nodes, vibs);
}
export const horn = (ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o: NoteOpts = {}): void => brass(ch, t, dur, midi, vel, o, true);

/** Choir voice (routes into a formant-filter channel) */
export function choir(ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const art = o.art ?? 'sus';
  const list = typeof midi === 'number' ? [midi] : midi;
  const g = ctx.createGain(); g.gain.value = 0;
  const stab = art === 'stab';
  const atk = stab ? 0.015 : art === 'swell' ? Math.max(0.3, dur * 0.75) : 0.28 + 0.35 * (1 - vel);
  const peak = vel * 0.1 * (list.length > 1 ? 1.2 / Math.sqrt(list.length) : 1);
  const end = envelope(g.gain, t, stab ? Math.min(dur, 0.25) : dur, atk, peak, stab ? peak * 0.4 : peak, stab ? 0.1 : 0.3, stab ? 0.25 : o.release ?? 0.8);
  const nodes: AudioNode[] = [g];
  const vibs: [GainNode | null, AudioParam][] = [];
  let first: OscillatorNode | null = null;
  const dets = list.length > 1 ? [-9, 9] : [-13, 0, 12];
  for (let q = 0; q < list.length * dets.length; q++) {
    const i = q % dets.length; const f = mtof(list[Math.floor(q / dets.length)]);
    const osc = ctx.createOscillator(); osc.type = i === 1 ? 'square' : 'sawtooth'; kr(osc.frequency); kr(osc.detune);
    osc.frequency.value = f;
    const dtc = dets[i] + (ch.env.rnd() - 0.5) * 8;
    osc.detune.value = dtc;
    if (o.rise) { osc.detune.setValueAtTime(dtc, t); osc.detune.linearRampToValueAtTime(dtc + o.rise * 100, t + dur); }
    osc.connect(g);
    const v = i % 2 ? ch.vib2 : ch.vib; if (v && !stab) { v.connect(osc.detune); vibs.push([v, osc.detune]); }
    osc.start(t); osc.stop(end);
    nodes.push(osc);
    if (!first) first = osc;
  }
  // breath noise (shared band-pass on the channel)
  if (!stab && ch.breath) {
    const n = ctx.createBufferSource(); n.buffer = ch.env.noise; n.loop = true;
    const ng = ctx.createGain(); ng.gain.value = 0;
    envelope(ng.gain, t, dur, atk, peak * 0.5, peak * 0.3, 0.3, o.release ?? 0.8);
    n.connect(ng).connect(ch.breath);
    n.start(t, ch.env.rnd() * 5); n.stop(end);
    nodes.push(n, ng);
  }
  g.connect(ch.input);
  cleanup(first!, nodes, vibs);
}

/** Flute / ocarina lead with breath and delayed vibrato */
export function flute(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}, ocarina = false): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const atk = o.glide ? 0.03 : 0.06;
  const peak = vel * 0.2;
  const end = envelope(g.gain, t, dur, atk, peak, peak * 0.9, 0.3, o.release ?? 0.18);
  const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f;
  const tri = ctx.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
  const h2 = ctx.createOscillator(); h2.type = 'sine'; h2.frequency.value = f * 2;
  for (const x of [s, tri, h2]) { kr(x.frequency); kr(x.detune); }
  if (o.glide) for (const [osc, m] of [[s, 1], [tri, 1], [h2, 2]] as const) { osc.frequency.setValueAtTime(mtof(o.glide) * m, t); osc.frequency.exponentialRampToValueAtTime(f * m, t + 0.07); }
  const tg = ctx.createGain(); tg.gain.value = ocarina ? 0.08 : 0.28;
  const hg = ctx.createGain(); hg.gain.value = ocarina ? 0.05 : 0.12;
  const vib = ctx.createOscillator(); vib.frequency.value = 5 + ch.env.rnd() * 0.6;
  const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(dur > 0.5 ? 14 : 3, t + Math.min(0.6, dur * 0.7));
  vib.connect(vg); vg.connect(s.detune); vg.connect(tri.detune); vg.connect(h2.detune);
  s.connect(g); tri.connect(tg).connect(g); h2.connect(hg).connect(g);
  const n = ctx.createBufferSource(); n.buffer = ch.env.noise; n.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = Math.min(9000, f * 2.2); nf.Q.value = 1.4;
  const ng = ctx.createGain();
  const bl = ocarina ? 0.06 : 0.1;
  ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(bl * 2.2 * vel, t + 0.02); ng.gain.setTargetAtTime(bl * 0.35 * vel, t + 0.03, 0.06);
  ng.gain.setTargetAtTime(0, t + dur, 0.05);
  n.connect(nf).connect(ng).connect(ch.input);
  g.connect(ch.input);
  for (const x of [s, tri, h2, vib]) { x.start(t); x.stop(end); }
  n.start(t, ch.env.rnd() * 5); n.stop(end);
  cleanup(s, [g, s, tri, h2, tg, hg, vib, vg, n, nf, ng], []);
}
export const ocarina = (ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void => flute(ch, t, dur, midi, vel, o, true);

/** Electric-ish synth bass with plucky filter envelope and sub */
export function bass(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 2.5; kr(flt.frequency);
  const top = 250 + 2200 * vel * (o.bright ?? 1);
  flt.frequency.setValueAtTime(top, t); flt.frequency.setTargetAtTime(180 + f, t + 0.005, 0.09);
  const end = envelope(g.gain, t, dur, 0.004, vel * 0.16, vel * 0.1, 0.12, o.release ?? 0.07);
  const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f;
  const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = f; b.detune.value = -9;
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
  const bg = ctx.createGain(); bg.gain.value = 0.5; const sg = ctx.createGain(); sg.gain.value = 1.1;
  a.connect(flt); b.connect(bg).connect(flt); flt.connect(g); sub.connect(sg).connect(g);
  g.connect(ch.input);
  for (const x of [a, b, sub]) { x.start(t); x.stop(end); }
  cleanup(a, [g, flt, a, b, sub, bg, sg], []);
}

/** Distorted guitar-ish layer (routes into a 'guitar' channel with amp/cab) */
export function guitar(ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx;
  const list = typeof midi === 'number' ? [midi] : midi;
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 1; kr(flt.frequency);
  const mute = !!o.mute;
  flt.frequency.setValueAtTime(mute ? 1400 : 6000, t);
  flt.frequency.setTargetAtTime(mute ? 700 : 2800, t + 0.01, mute ? 0.05 : 0.4);
  const d = mute ? Math.min(dur, 0.14) : dur;
  const end = envelope(g.gain, t, d, 0.003, vel * 0.22, vel * (mute ? 0.06 : 0.16), mute ? 0.04 : 0.6, mute ? 0.05 : 0.15);
  const oscs: OscillatorNode[] = [];
  for (const m of list) for (const dt of mute ? [0] : [-7, 8]) {
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = mtof(m); a.detune.value = dt + (ch.env.rnd() - 0.5) * 6;
    a.connect(flt); a.start(t); a.stop(end); oscs.push(a);
  }
  flt.connect(g).connect(ch.input);
  cleanup(oscs[0], [g, flt, ...oscs], []);
}

/** Pipe organ (additive periodic wave + 16' sub) */
export function organ(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const end = envelope(g.gain, t, dur, o.art === 'swell' ? dur * 0.6 : 0.07, vel * 0.1, vel * 0.1, 0.1, o.release ?? 0.35);
  const a = ctx.createOscillator(); a.setPeriodicWave(ch.env.organ); a.frequency.value = f;
  const b = ctx.createOscillator(); b.setPeriodicWave(ch.env.organ); b.frequency.value = f; b.detune.value = 4;
  const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f / 2;
  const sg = ctx.createGain(); sg.gain.value = 0.5; const bg = ctx.createGain(); bg.gain.value = 0.6;
  a.connect(g); b.connect(bg).connect(g); s.connect(sg).connect(g);
  g.connect(ch.input);
  for (const x of [a, b, s]) { x.start(t); x.stop(end); }
  cleanup(a, [g, a, b, s, sg, bg], []);
}

/** Soft synth pad */
export function pad(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 0.7; kr(flt.frequency);
  flt.frequency.setValueAtTime(400, t); flt.frequency.linearRampToValueAtTime(700 + 1500 * vel * (o.bright ?? 1), t + dur * 0.5);
  const end = envelope(g.gain, t, dur, Math.min(1.5, dur * 0.4), vel * 0.07, vel * 0.07, 0.5, o.release ?? 2);
  const nodes: AudioNode[] = [g, flt];
  let first: OscillatorNode | null = null;
  for (const [ty, dt] of [['sawtooth', -11], ['sawtooth', 10], ['triangle', 0]] as const) {
    const x = ctx.createOscillator(); x.type = ty; x.frequency.value = f; x.detune.value = dt;
    const p = ctx.createStereoPanner(); p.pan.value = dt / 14;
    x.connect(p).connect(flt); x.start(t); x.stop(end); nodes.push(x, p); if (!first) first = x;
  }
  flt.connect(g).connect(ch.input);
  cleanup(first!, nodes, []);
}

/** Deep drone with slowly wandering filter */
export function drone(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 3; kr(flt.frequency);
  const b = o.bright ?? 1;
  flt.frequency.setValueAtTime(120 * b, t);
  for (let k = 1; k <= Math.ceil(dur / 2); k++) flt.frequency.setTargetAtTime((140 + ch.env.rnd() * 380) * b, t + (k - 1) * 2, 0.8);
  const end = envelope(g.gain, t, dur, Math.min(2.5, dur * 0.4), vel * 0.18, vel * 0.18, 0.5, o.release ?? 3);
  const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f;
  const c = ctx.createOscillator(); c.type = 'sawtooth'; c.frequency.value = f * 1.004;
  const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f / 2;
  const sg = ctx.createGain(); sg.gain.value = 0.7;
  a.connect(flt); c.connect(flt); flt.connect(g); s.connect(sg).connect(g);
  g.connect(ch.input);
  for (const x of [a, c, s]) { x.start(t); x.stop(end); }
  cleanup(a, [g, flt, a, c, s, sg], []);
}

/** High shimmering tremolo tones */
export function shimmer(ch: Channel, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}): void {
  const ctx = ch.env.ctx; const f = mtof(midi);
  const g = ctx.createGain(); g.gain.value = 0;
  const end = envelope(g.gain, t, dur, Math.min(1.5, dur * 0.5), vel * 0.06, vel * 0.06, 0.5, o.release ?? 1.5);
  const tr = ctx.createOscillator(); tr.frequency.value = 6 + ch.env.rnd() * 4;
  const tg = ctx.createGain(); tg.gain.value = 0.45; const amp = ctx.createGain(); amp.gain.value = 0.55;
  tr.connect(tg).connect(amp.gain);
  const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = f;
  const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2.001;
  if (o.glide) { a.detune.setValueAtTime(0, t); a.detune.linearRampToValueAtTime(o.glide * 100, t + dur); b.detune.setValueAtTime(0, t); b.detune.linearRampToValueAtTime(o.glide * 100, t + dur); }
  const bg = ctx.createGain(); bg.gain.value = 0.3;
  a.connect(amp); b.connect(bg).connect(amp); amp.connect(g).connect(ch.input);
  for (const x of [a, b, tr]) { x.start(t); x.stop(end); }
  cleanup(a, [g, tr, tg, amp, a, b, bg], []);
}

/** Play a JS-rendered sample (harp, piano, percussion...) */
export function sample(ch: Channel, t: number, kind: string, key: number, vel: number, o: { rate?: number; pan?: number; dur?: number } = {}): void {
  const ctx = ch.env.ctx;
  const buf = ch.env.samples.get(kind, key);
  const s = ctx.createBufferSource(); s.buffer = buf;
  s.playbackRate.value = (o.rate ?? 1) * (1 + (ch.env.rnd() - 0.5) * 0.008);
  const g = ctx.createGain(); g.gain.value = vel;
  let tail: AudioNode = g;
  s.connect(g);
  const nodes: AudioNode[] = [s, g];
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); tail = p; nodes.push(p); }
  tail.connect(ch.input);
  s.start(t);
  if (o.dur) { g.gain.setValueAtTime(vel, t + o.dur); g.gain.setTargetAtTime(0, t + o.dur, 0.08); s.stop(t + o.dur + 0.5); }
  s.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* */ } } };
}

/** Noise riser / swell (band-passed noise sweeping upward, ends at t+dur) */
export function noiseSwell(ch: Channel, t: number, dur: number, vel: number, f0 = 300, f1 = 8000, q = 1.4): void {
  const ctx = ch.env.ctx;
  const s = ctx.createBufferSource(); s.buffer = ch.env.noise; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.5, t + dur);
  g.gain.setValueAtTime(vel * 0.5, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  s.connect(f).connect(g).connect(ch.input);
  s.start(t, ch.env.rnd() * 4); s.stop(t + dur + 0.1);
  s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
}

export type InstFn = (ch: Channel, t: number, dur: number, midi: number, vel: number, o?: NoteOpts) => void;
export type ChordFn = (ch: Channel, t: number, dur: number, midi: number | number[], vel: number, o?: NoteOpts) => void;
export const INST: Record<string, InstFn> = { strings, brass, horn, choir, flute, ocarina, bass, guitar, organ, pad, drone, shimmer };
/** instruments that can render a chord through one shared filter/envelope */
export const CHORD_INST: Record<string, ChordFn> = { strings, brass, horn, choir, guitar };

export function makeOrganWave(ctx: BaseAudioContext): PeriodicWave {
  const N = 17;
  const real = new Float32Array(N), imag = new Float32Array(N);
  const h: Record<number, number> = { 1: 1, 2: 0.75, 3: 0.4, 4: 0.5, 5: 0.12, 6: 0.28, 8: 0.3, 10: 0.08, 12: 0.12, 16: 0.08 };
  for (const [k, a] of Object.entries(h)) imag[+k] = a;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}
