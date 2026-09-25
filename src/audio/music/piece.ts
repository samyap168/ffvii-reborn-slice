// Piece definitions, bar scheduling API and the per-piece player (lookahead event queue).
import { Channel, INST, CHORD_INST, sample, noiseSwell, type ChanSpec, type MusicEnv, type NoteOpts } from './instruments';
import type { NoteEv } from './theory';
import type { Space } from '../reverb';

export interface PieceDef {
  name: string;
  bpm: number | ((bar: number, loop: number) => number);
  meter?: number | ((bar: number) => number);
  /** bars before looping */
  bars: number;
  /** bar to loop back to (default 0); -1 = do not loop (piece ends and rings out) */
  loopTo?: number;
  channels: ChanSpec[];
  /** stem gains 0..1 for the given intensity */
  stems(I: number, bar: number, loop: number, n: number): Record<string, number>;
  bar(b: Bar): void;
  /** smoothing time-constant for stem changes */
  stemTc?: number;
  fadeIn?: number;
  space?: Space;
  /** pitched samples to pre-render: [kind, midi[]] */
  warm?: [string, number[]][];
}

export interface Ev { t: number; fn: (t: number) => void }

export class Bar {
  constructor(
    readonly p: PiecePlayer,
    readonly i: number,
    readonly n: number,
    readonly loop: number,
    readonly t0: number,
    readonly spb: number,
    readonly beats: number,
    readonly I: number,
  ) {}
  t(beat: number): number { return this.t0 + beat * this.spb; }
  on(ch: string): boolean { const c = this.p.channels.get(ch); return !!c && (c.target > 0.004 || c.stemGain > 0.004); }
  at(beat: number, fn: (t: number) => void): void { this.p.push(this.t(beat), fn); }
  /** schedule an instrument note (dur in beats). midi may be a chord array. */
  note(ch: string, inst: string, beat: number, dur: number, midi: number | number[], vel: number, o: NoteOpts & { hum?: number } = {}): void {
    const c = this.p.channels.get(ch);
    if (!c || !this.on(ch)) return;
    const fn = INST[inst];
    if (!fn) return;
    const list = typeof midi === 'number' ? [midi] : midi;
    const rnd = this.p.env.rnd;
    const hum = o.hum ?? 0.007;
    const cf = CHORD_INST[inst];
    if (cf && list.length > 1 && (o.art === 'stacc' || o.art === 'marc' || o.art === 'stab' || o.mute || inst === 'guitar')) {
      const t = this.t(beat) + (rnd() - 0.5) * 2 * hum;
      const v = Math.max(0.02, vel * (1 + (rnd() - 0.5) * 0.1));
      const d = Math.max(0.03, dur * this.spb);
      this.p.push(t, (tt) => cf(c, tt, d, list, v, o));
      return;
    }
    for (const m of list) {
      const t = this.t(beat) + (rnd() - 0.5) * 2 * hum;
      const v = Math.max(0.02, vel * (1 + (rnd() - 0.5) * 0.1));
      const d = Math.max(0.03, dur * this.spb);
      this.p.push(t, (tt) => fn(c, tt, d, m, v, o));
    }
  }
  /** sampled one-shot */
  hit(ch: string, kind: string, beat: number, vel: number, key = 0, o: { rate?: number; pan?: number; dur?: number; hum?: number } = {}): void {
    const c = this.p.channels.get(ch);
    if (!c || !this.on(ch)) return;
    const rnd = this.p.env.rnd;
    const t = this.t(beat) + (rnd() - 0.5) * 2 * (o.hum ?? 0.004);
    const v = vel * (1 + (rnd() - 0.5) * 0.12);
    const d = o.dur !== undefined ? o.dur * this.spb : undefined;
    this.p.push(t, (tt) => sample(c, tt, kind, key, v, { rate: o.rate, pan: o.pan, dur: d }));
  }
  /** play all events of a melody that fall in this bar; `evs` beats are relative to `startBar`. */
  melody(ch: string, inst: string, evs: NoteEv[], startBar: number, vel: number, o: NoteOpts & { hum?: number } = {}, semis = 0, legato = 1): void {
    const off = (this.i - startBar) * this.beats;
    for (const e of evs) {
      if (e.b < off - 1e-6 || e.b >= off + this.beats - 1e-6) continue;
      this.note(ch, inst, e.b - off, e.d * legato, e.m.map((m) => m + semis), vel * e.v, o);
    }
  }
  /** plucked/struck sample melody (harp, celesta, pizz...) */
  melodyHits(ch: string, kind: string, evs: NoteEv[], startBar: number, vel: number, semis = 0): void {
    const off = (this.i - startBar) * this.beats;
    for (const e of evs) {
      if (e.b < off - 1e-6 || e.b >= off + this.beats - 1e-6) continue;
      for (const m of e.m) this.hit(ch, kind, e.b - off, vel * e.v, m + semis);
    }
  }
  vowel(ch: string, v: 'a' | 'o' | 'u' | 'e' | 'i', beat: number, glide = 0.5): void {
    const c = this.p.channels.get(ch);
    if (c) this.p.push(this.t(beat), (tt) => c.setVowel(v, tt, glide));
  }
  swell(ch: string, beat: number, durBeats: number, vel: number, f0 = 300, f1 = 8000): void {
    const c = this.p.channels.get(ch);
    if (!c || !this.on(ch)) return;
    const d = durBeats * this.spb;
    this.p.push(this.t(beat), (tt) => noiseSwell(c, tt, d, vel, f0, f1));
  }
  /** reversed cymbal that peaks exactly at `beat` */
  revCym(ch: string, beat: number, vel: number): void {
    const c = this.p.channels.get(ch);
    if (!c || !this.on(ch)) return;
    const buf = this.p.env.samples.get('revcym', 0);
    const t = this.t(beat) - buf.duration;
    this.p.push(t, (tt) => sample(c, tt, 'revcym', 0, vel));
  }
}

export class PiecePlayer {
  readonly channels = new Map<string, Channel>();
  readonly out: GainNode;
  readonly wet: GainNode;
  private queue: Ev[] = [];
  private barIdx = 0;
  private n = 0;
  private loop = 0;
  private nextBar: number;
  private grid: { t0: number; spb: number; beats: number; i: number }[] = [];
  stopAt = Infinity;
  ended = false;
  disposed = false;
  private intensity = 0;
  private lastStem = -1;
  constructor(readonly env: MusicEnv, readonly def: PieceDef, readonly start: number, dest: AudioNode, wetDest: AudioNode, fadeIn: number, readonly state: string) {
    const ctx = env.ctx;
    this.out = ctx.createGain();
    this.wet = ctx.createGain();
    const fi = Math.max(0.005, fadeIn);
    for (const g of [this.out, this.wet]) {
      g.gain.setValueAtTime(0, Math.max(ctx.currentTime, start - 0.005));
      g.gain.linearRampToValueAtTime(1, start + fi);
    }
    this.out.connect(dest);
    this.wet.connect(wetDest);
    for (const spec of def.channels) this.channels.set(spec.id, new Channel(env, spec, this.out, this.wet));
    this.nextBar = start;
    for (const [k, list] of def.warm ?? []) env.samples.warm(k, list);
  }
  push(t: number, fn: (t: number) => void): void { this.queue.push({ t, fn }); }
  private bpmAt(i: number): number { const b = this.def.bpm; return typeof b === 'number' ? b : b(i, this.loop); }
  private meterAt(i: number): number { const m = this.def.meter ?? 4; return typeof m === 'number' ? m : m(i); }
  setIntensity(v: number): void { this.intensity = v; }
  get currentBar(): number { return this.barIdx; }
  get loops(): number { return this.loop; }
  get barsPlayed(): number { return this.n; }
  /** first bar start time */
  get startTime(): number { return this.start; }
  private genBar(): void {
    const def = this.def;
    if (def.bars <= 0) { this.nextBar = Infinity; return; }
    const i = this.barIdx;
    const spb = 60 / this.bpmAt(i);
    const beats = this.meterAt(i);
    const t0 = this.nextBar;
    this.grid.push({ t0, spb, beats, i });
    if (this.grid.length > 4) this.grid.shift();
    this.applyStems(t0, true);
    const b = new Bar(this, i, this.n, this.loop, t0, spb, beats, this.intensity);
    const before = this.queue.length;
    try { def.bar(b); } catch (e) { console.warn('[music] bar error', def.name, i, e); }
    if (this.queue.length !== before) this.queue.sort((a, c) => a.t - c.t);
    this.nextBar = t0 + beats * spb;
    this.n++;
    this.barIdx++;
    if (this.barIdx >= def.bars) {
      if ((def.loopTo ?? 0) < 0) { this.ended = true; this.nextBar = Infinity; }
      else { this.barIdx = def.loopTo ?? 0; this.loop++; }
    }
  }
  applyStems(t: number, force = false): void {
    const now = this.env.ctx.currentTime;
    if (!force && now - this.lastStem < 0.1) return;
    this.lastStem = now;
    const g = this.def.stems(this.intensity, this.barIdx, this.loop, this.n);
    const tc = this.def.stemTc ?? 0.6;
    for (const c of this.channels.values()) {
      const v = Math.max(0, Math.min(1.5, g[c.spec.stem] ?? 0));
      if (Math.abs(v - c.target) > 0.004 || c.stemGain < 0) {
        c.setLevel(v, Math.max(now, Math.min(t, now + 0.05)), c.stemGain < 0 ? 0.01 : tc);
      }
      c.stemGain = c.stemGain < 0 ? v : c.stemGain + (v - c.stemGain) * 0.5;
    }
  }
  /** initialise channel levels at the start time */
  primeStems(): void {
    const g = this.def.stems(this.intensity, 0, 0, 0);
    for (const c of this.channels.values()) {
      const v = Math.max(0, Math.min(1.5, g[c.spec.stem] ?? 0));
      c.target = v; c.stemGain = v;
      c.out.gain.setValueAtTime(v * c.spec.vol, Math.max(this.env.ctx.currentTime, this.start - 0.01));
    }
  }
  tick(now: number, horizon: number): void {
    if (this.disposed) return;
    if (this.start > now + horizon + 0.3) return;
    while (!this.ended && this.nextBar < now + horizon + 0.3 && this.nextBar < this.stopAt) this.genBar();
    this.applyStems(now);
    const q = this.queue;
    let k = 0;
    while (k < q.length && q[k].t < now + horizon) {
      const ev = q[k++];
      if (ev.t >= this.stopAt) continue;
      if (ev.t < now - 0.2) continue; // badly late (throttled tab): drop
      try { ev.fn(Math.max(ev.t, now + 0.003)); } catch (e) { console.warn('[music] event error', e); }
    }
    if (k) q.splice(0, k);
  }
  /** next beat/bar boundary after time x (using the generated grid, extrapolating) */
  nextGrid(x: number, unit: 'beat' | 'bar'): number {
    if (!this.grid.length) return Math.max(x, this.start);
    if (x < this.start) return this.start;
    for (const g of this.grid) {
      const end = g.t0 + g.beats * g.spb;
      if (x >= g.t0 - 1e-4 && x < end) {
        if (unit === 'bar') return x <= g.t0 + 1e-4 ? g.t0 : end;
        const k = Math.ceil((x - g.t0) / g.spb - 1e-4);
        return g.t0 + k * g.spb;
      }
    }
    const g = this.grid[this.grid.length - 1];
    const end = g.t0 + g.beats * g.spb;
    if (x < g.t0) return g.t0;
    const barLen = g.beats * g.spb;
    if (unit === 'bar') return end + Math.ceil((x - end) / barLen - 1e-4) * barLen;
    return end + Math.ceil((x - end) / g.spb - 1e-4) * g.spb;
  }
  get beatDur(): number { const g = this.grid[this.grid.length - 1]; return g ? g.spb : 60 / this.bpmAt(0); }
  stop(at: number, fade: number): void {
    const ctx = this.env.ctx;
    at = Math.max(ctx.currentTime, at);
    if (at >= this.stopAt) return;
    this.stopAt = at;
    const f = Math.max(0.01, fade);
    for (const g of [this.out, this.wet]) {
      g.gain.cancelScheduledValues(at);
      g.gain.setTargetAtTime(0, at, f / 4);
    }
  }
  /** cancel a pending stop (if it has not happened yet) */
  unstop(): boolean {
    const now = this.env.ctx.currentTime;
    if (this.stopAt === Infinity) return true;
    if (this.stopAt <= now + 0.02) return false;
    this.stopAt = Infinity;
    for (const g of [this.out, this.wet]) { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(1, now, 0.05); }
    return true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.channels.values()) c.dispose();
    try { this.out.disconnect(); this.wet.disconnect(); } catch { /* */ }
    this.queue = [];
  }
}
