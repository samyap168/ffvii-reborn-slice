// Core audio engine: buses, master limiter, shared reverbs, voice management,
// pre-render cache, positional audio, loops and automatic global ambience.
// Works on any BaseAudioContext so the same graph can be rendered offline for tests.
import { Out, makeRng, rr, clamp, dbToGain, toBuffer, pink, seamless, type Rng } from './dsp';
import { makeImpulse, type Space } from './reverb';
import { SFX, TEXTURES, type SfxDef, type BusName } from './sfx/registry';
import type { Recipe } from './sfx/types';
import type { V3, PlayOpts, LoopHandle, Surface, UpdateState } from './types';
import { LOOPS, type LoopInst } from './loops';
import { Director } from './music/director';

const MAX_VOICES = 48;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Click-free parameter move. */
export function ramp(p: AudioParam, v: number, t: number, tc = 0.03): void {
  p.cancelScheduledValues(t);
  p.setTargetAtTime(v, t, Math.max(0.001, tc));
}

/** Pair of convolvers (valley + cathedral) with crossfadable sends; the idle one is created lazily
 *  and detached after its tail to save CPU. */
export class ReverbUnit {
  readonly input: GainNode;
  readonly out: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly convs: Partial<Record<Space, ConvolverNode>> = {};
  private readonly sends: Partial<Record<Space, GainNode>> = {};
  private timers: Partial<Record<Space, ReturnType<typeof setTimeout>>> = {};
  private space: Space;
  constructor(private ctx: BaseAudioContext, private irs: { valley: AudioBuffer; cathedral: AudioBuffer }, dest: AudioNode, space: Space, returnGain = 1, private offline = false) {
    this.input = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 70;
    this.out = ctx.createGain(); this.out.gain.value = returnGain;
    this.input.connect(this.hp);
    this.space = space;
    this.attach(space).gain.value = space === 'cathedral' ? 1.1 : 1;
    this.out.connect(dest);
  }
  private attach(k: Space): GainNode {
    const t = this.timers[k]; if (t) { clearTimeout(t); delete this.timers[k]; }
    let g = this.sends[k];
    if (!g) {
      g = this.ctx.createGain(); g.gain.value = 0;
      const c = this.ctx.createConvolver(); c.normalize = false; c.buffer = this.irs[k];
      this.hp.connect(g).connect(c).connect(this.out);
      this.sends[k] = g; this.convs[k] = c;
    }
    return g;
  }
  private detach(k: Space): void {
    const g = this.sends[k], c = this.convs[k];
    if (!g || !c) return;
    try { this.hp.disconnect(g); g.disconnect(); c.disconnect(); } catch { /* */ }
    delete this.sends[k]; delete this.convs[k];
  }
  setSpace(space: Space, t: number, tc: number): void {
    this.space = space;
    const other: Space = space === 'valley' ? 'cathedral' : 'valley';
    ramp(this.attach(space).gain, space === 'cathedral' ? 1.1 : 1, t, tc);
    const og = this.sends[other];
    if (og) {
      ramp(og.gain, 0, t, tc);
      if (!this.offline) {
        const tail = (this.convs[other]?.buffer?.duration ?? 8) + tc * 6 + 0.5;
        const old = this.timers[other]; if (old) clearTimeout(old);
        this.timers[other] = setTimeout(() => { delete this.timers[other]; if (this.space !== other) this.detach(other); }, tail * 1000);
      }
    }
  }
  dispose(): void {
    for (const t of Object.values(this.timers)) if (t) clearTimeout(t);
    this.detach('valley'); this.detach('cathedral');
    for (const n of [this.input, this.hp, this.out]) { try { n.disconnect(); } catch { /* */ } }
  }
}

export class Bus {
  readonly input: GainNode;
  readonly wet: GainNode;
  readonly filter: BiquadFilterNode;
  readonly duck: GainNode;
  readonly vol: GainNode;
  private readonly wetDuck: GainNode;
  private readonly wetVol: GainNode;
  constructor(private ctx: BaseAudioContext, dest: AudioNode, reverbIn: AudioNode, level: number) {
    void this.ctx;
    this.input = ctx.createGain();
    this.wet = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = 0.5;
    this.duck = ctx.createGain(); this.vol = ctx.createGain(); this.vol.gain.value = level;
    this.wetDuck = ctx.createGain(); this.wetVol = ctx.createGain(); this.wetVol.gain.value = level;
    this.input.connect(this.filter).connect(this.duck).connect(this.vol).connect(dest);
    this.wet.connect(this.wetDuck).connect(this.wetVol).connect(reverbIn);
  }
  setVolume(v: number, t: number, tc = 0.05): void { ramp(this.vol.gain, v, t, tc); ramp(this.wetVol.gain, v, t, tc); }
  setDuck(v: number, t: number, tc: number): void {
    this.duck.gain.setTargetAtTime(v, t, tc); this.wetDuck.gain.setTargetAtTime(v, t, tc);
  }
  duckParams(): AudioParam[] { return [this.duck.gain, this.wetDuck.gain]; }
  setWetDest(node: AudioNode): void { this.wetVol.disconnect(); this.wetVol.connect(node); }
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  nodes: AudioNode[];
  start: number;
  end: number;
  vol: number;
  prio: number;
  rate: number;
  ts: boolean;
  done: boolean;
}

export interface EngineOptions { offline?: boolean }

export class Engine {
  readonly ctx: BaseAudioContext;
  readonly sr: number;
  readonly offline: boolean;
  readonly master: GainNode;
  private readonly dropGain: GainNode;
  private readonly comp: DynamicsCompressorNode;
  readonly preLimit: GainNode;
  readonly reverbIn: GainNode;
  private world: ReverbUnit;
  private readonly irs: { valley: AudioBuffer; cathedral: AudioBuffer };
  private space: Space = 'valley';
  readonly buses: Record<BusName | 'music', Bus>;
  readonly music: Director;
  /** shared stereo pink-noise loop buffer (wind, breath, risers) */
  readonly noise: AudioBuffer;
  private readonly cache = new Map<string, AudioBuffer[]>();
  private readonly lastPick = new Map<string, number>();
  private readonly jobs: { key: string; run: () => void }[] = [];
  private readonly queued = new Set<string>();
  private readonly voices: Voice[] = [];
  private readonly loops = new Set<ActiveLoop>();
  private readonly warned = new Set<string>();
  private readonly rng: Rng = makeRng(12345);
  private tsPitch = 1;
  private timeScale = 1;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerPos: V3 = { x: 0, y: 0, z: 0 };
  private amb: { wind: ActiveLoop; birds: ActiveLoop; insects: ActiveLoop; rain: ActiveLoop } | null = null;
  private thunderTimer = 8;
  private volumes = { master: 1, music: 1, sfx: 1, ambience: 1, ui: 1 };
  private dropUntil = 0;

  constructor(ctx: BaseAudioContext, opts: EngineOptions = {}) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.offline = !!opts.offline;
    const t = ctx.currentTime;
    // master chain: master -> dropout -> compressor -> makeup trim -> soft clip -> destination
    this.master = ctx.createGain();
    this.dropGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.setValueAtTime(-5, t);
    this.comp.knee.setValueAtTime(4, t);
    this.comp.ratio.setValueAtTime(10, t);
    this.comp.attack.setValueAtTime(0.003, t);
    this.comp.release.setValueAtTime(0.22, t);
    this.preLimit = ctx.createGain();
    const trim = ctx.createGain(); trim.gain.value = 0.733; // compensates the compressor's automatic makeup gain
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none';
    const post = ctx.createGain(); post.gain.value = 1;
    this.master.connect(this.dropGain).connect(this.preLimit).connect(this.comp).connect(trim).connect(pre).connect(clip).connect(post).connect(ctx.destination);

    // one shared convolution reverb (valley / cosmic cathedral crossfade); swapped out on hard stops
    this.irs = { valley: makeImpulse(ctx, 'valley'), cathedral: makeImpulse(ctx, 'cathedral') };
    this.reverbIn = ctx.createGain();
    this.world = new ReverbUnit(ctx, this.irs, this.master, 'valley', 1, this.offline);
    this.reverbIn.connect(this.world.input);

    this.buses = {
      music: new Bus(ctx, this.master, this.reverbIn, 0.55),
      sfx: new Bus(ctx, this.master, this.reverbIn, 1),
      ui: new Bus(ctx, this.master, this.reverbIn, 0.9),
      amb: new Bus(ctx, this.master, this.reverbIn, 0.8),
    };
    // shared noise
    const r = makeRng(99);
    const no = new Out(this.sr, 6.5);
    no.addSt(pink(no.n, r), pink(no.n, r), 0, 1.6);
    this.noise = toBuffer(ctx, seamless(no, 0.5));
    this.music = new Director(this);
  }

  // ----------------------------------------------------------------- render cache
  private cacheKey(name: string, def: SfxDef, surface: Surface, variant: number): string {
    if (def.key === 'surface') return `${name}|${surface}`;
    if (def.key === 'variant') return `${name}|v${variant}`;
    return name;
  }
  private renderInto(key: string, recipe: Recipe, surface: Surface, variant: number, count: number): AudioBuffer[] {
    let list = this.cache.get(key);
    if (!list) { list = []; this.cache.set(key, list); }
    while (list.length < count) {
      const idx = list.length;
      const r = makeRng(hashStr(`${key}#${idx}`));
      let o: Out;
      try { o = recipe({ sr: this.sr, r, variant, surface }); } catch (e) { console.warn('[audio] render failed', key, e); o = new Out(this.sr, 0.05); }
      list.push(toBuffer(this.ctx, o));
    }
    return list;
  }
  /** Get (rendering synchronously if needed) a random variant buffer for a sound. */
  buffer(name: string, surface: Surface = 'grass', variant = 0, pickIdx?: number): AudioBuffer | null {
    const def = SFX[name];
    if (!def) return null;
    const key = this.cacheKey(name, def, surface, variant);
    let list = this.cache.get(key);
    if (!list || list.length === 0) {
      list = this.renderInto(key, def.recipe, surface, variant, 1);
      if (def.variants > 1) this.enqueue(key, () => this.renderInto(key, def.recipe, surface, variant, def.variants));
    }
    let i: number;
    if (pickIdx !== undefined) i = ((pickIdx % list.length) + list.length) % list.length;
    else {
      i = Math.floor(this.rng() * list.length);
      if (list.length > 1 && i === this.lastPick.get(key)) i = (i + 1) % list.length;
    }
    this.lastPick.set(key, i);
    return list[i];
  }
  texture(name: string): AudioBuffer {
    const key = `tex:${name}`;
    const list = this.cache.get(key);
    if (list && list[0]) return list[0];
    const rec = TEXTURES[name];
    return this.renderInto(key, rec, 'grass', 0, 1)[0];
  }
  private enqueue(key: string, run: () => void): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.jobs.push({ key, run });
    this.schedulePump();
  }
  private schedulePump(): void {
    if (this.pumpTimer !== null || this.offline) return;
    this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump(10); }, 16);
  }
  /** Run queued background renders for up to `budgetMs`. */
  pump(budgetMs: number): void {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budgetMs) {
      const j = this.jobs.shift()!;
      j.run();
    }
    if (this.jobs.length) this.schedulePump();
  }
  get pendingJobs(): number { return this.jobs.length; }
  /** Pre-render latency-critical sounds within a time budget; queue everything else. */
  prerender(budgetMs: number): void {
    const t0 = performance.now();
    const surfaces: Surface[] = ['grass', 'dirt', 'stone', 'water', 'sand'];
    const all: [string, SfxDef][] = Object.entries(SFX);
    const pre = all.filter(([, d]) => d.pre), rest = all.filter(([, d]) => !d.pre);
    const plan = (name: string, def: SfxDef): { key: string; s: Surface; v: number }[] => {
      if (def.key === 'surface') return surfaces.map((s) => ({ key: `${name}|${s}`, s, v: 0 }));
      if (def.key === 'variant') {
        const n = name === 'chocobo_kweh' ? 2 : name === 'bird_phrase' ? 5 : 13;
        return Array.from({ length: n }, (_, v) => ({ key: `${name}|v${v}`, s: 'grass' as Surface, v }));
      }
      return [{ key: name, s: 'grass', v: 0 }];
    };
    for (const [name, def] of pre) {
      for (const p of plan(name, def)) {
        if (performance.now() - t0 < budgetMs) this.renderInto(p.key, def.recipe, p.s, p.v, Math.min(2, def.variants));
        this.enqueue(p.key, () => this.renderInto(p.key, def.recipe, p.s, p.v, def.variants));
      }
    }
    for (const tex of Object.keys(TEXTURES)) this.enqueue(`tex:${tex}`, () => this.texture(tex));
    for (const [name, def] of rest) for (const p of plan(name, def)) this.enqueue(p.key, () => this.renderInto(p.key, def.recipe, p.s, p.v, def.variants));
  }

  // ----------------------------------------------------------------- voices
  private warnOnce(name: string, what: string): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    console.warn(`[audio] unknown ${what} "${name}"`);
  }
  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].done || this.voices[i].end < now - 0.1) this.voices.splice(i, 1);
  }
  private steal(now: number): void {
    this.reap(now);
    while (this.voices.length >= MAX_VOICES) {
      let worst = -1, ws = Infinity;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        const life = Math.max(0.01, v.end - v.start);
        const remain = clamp((v.end - now) / life, 0, 1);
        const score = v.prio * 2 + v.vol * (0.3 + remain);
        if (score < ws) { ws = score; worst = i; }
      }
      if (worst < 0) break;
      const v = this.voices.splice(worst, 1)[0];
      this.killVoice(v, now, 0.03);
    }
  }
  private killVoice(v: Voice, now: number, fade: number): void {
    if (v.done) return;
    v.done = true;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + fade);
      v.src.stop(now + fade + 0.01);
    } catch { /* already stopped */ }
  }
  makePanner(ref: number, rolloff = 1): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 20000;
    p.coneInnerAngle = 360; p.coneOuterAngle = 360;
    return p;
  }
  setPannerPos(p: PannerNode, pos: V3, smooth = false): void {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      if (smooth) { p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03); }
      else { p.positionX.setValueAtTime(pos.x, t); p.positionY.setValueAtTime(pos.y, t); p.positionZ.setValueAtTime(pos.z, t); }
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  }
  private distanceGain(pos: V3, ref: number, rolloff: number): number {
    const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
    const d = Math.max(ref, Math.sqrt(dx * dx + dy * dy + dz * dz));
    return ref / (ref + rolloff * (d - ref));
  }

  play(name: string, opts: PlayOpts = {}, dest?: AudioNode): void {
    const def = SFX[name];
    if (!def) { this.warnOnce(name, 'sound'); return; }
    const buf = this.buffer(name, opts.surface ?? 'grass', opts.variant ?? 0, def.key ? undefined : opts.variant);
    if (!buf) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = now + Math.max(0, opts.delay ?? 0);
    this.steal(now);
    const inten = clamp(opts.intensity ?? 1, 0, 1.5);
    const r = this.rng;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const base = Math.max(0.1, (opts.pitch ?? 1) * (1 + (r() * 2 - 1) * def.pv) * (def.intensity ? 1.04 - 0.06 * inten : 1));
    const ts = !def.noTimeScale && def.bus !== 'ui';
    src.playbackRate.value = base * (ts ? this.tsPitch : 1);
    const vol = dbToGain(def.db) * Math.max(0, opts.volume ?? 1) * (def.intensity ? 0.4 + 0.6 * Math.min(1, inten) : 1) * dbToGain(rr(r, -1.2, 1.2));
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const bright = def.intensity ? 0.25 + 0.75 * Math.min(1, inten) : 1;
    f.frequency.value = Math.min(20000, rr(r, 9000, 20000) * bright + 600);
    f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g);
    const bus = this.buses[def.bus];
    const send = ctx.createGain();
    const nodes: AudioNode[] = [src, f, g, send];
    let sendAmt = def.send;
    if (opts.position && def.bus !== 'ui') {
      const pan = this.makePanner(def.ref, def.rolloff ?? 1);
      this.setPannerPos(pan, opts.position);
      g.connect(pan).connect(dest ?? bus.input);
      nodes.push(pan);
      const dg = this.distanceGain(opts.position, def.ref, def.rolloff ?? 1);
      sendAmt *= Math.sqrt(dg) * 1.2; // far sounds keep more of their reverb
    } else {
      g.connect(dest ?? bus.input);
    }
    send.gain.value = sendAmt;
    g.connect(send).connect(bus.wet);
    const dur = buf.duration / src.playbackRate.value;
    const v: Voice = { src, gain: g, nodes, start: t, end: t + dur, vol, prio: def.prio, rate: base, ts, done: false };
    src.onended = () => { v.done = true; for (const n of nodes) { try { n.disconnect(); } catch { /* */ } } };
    src.start(t);
    this.voices.push(v);
    if (def.duck && !dest) {
      const amt = clamp(def.duck[0] * Math.min(1, (opts.volume ?? 1) * (opts.position ? this.distanceGain(opts.position, def.ref, 1) * 2 : 1)), 0, 0.95);
      if (amt > 0.05) this.music.duck(amt, def.duck[1], t);
    }
  }
  get activeVoices(): number { this.reap(this.ctx.currentTime); return this.voices.length; }

  // ----------------------------------------------------------------- loops
  loop(name: string, opts: PlayOpts = {}): LoopHandle {
    const ld = LOOPS[name];
    let inst: LoopInst | null = null;
    let bus: BusName = 'sfx';
    let ref = 6, send = 0.3, rolloff = 1;
    if (ld) {
      inst = ld.create(this, opts);
      bus = ld.bus; ref = ld.ref; send = ld.send; rolloff = ld.rolloff ?? 1;
    } else if (SFX[name]) {
      const def = SFX[name];
      const buf = this.buffer(name, opts.surface ?? 'grass', opts.variant ?? 0)!;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.playbackRate.value = opts.pitch ?? 1;
      src.start(this.ctx.currentTime, rr(this.rng, 0, buf.duration * 0.9));
      bus = def.bus; ref = def.ref; send = def.send;
      inst = { out: src, setParam: (n, v) => { if (n === 'pitch') ramp(src.playbackRate, v, this.ctx.currentTime, 0.05); }, dispose: () => { try { src.stop(); } catch { /* */ } src.disconnect(); } };
    } else {
      this.warnOnce(name, 'loop');
      return { setPosition() { /* */ }, setParam() { /* */ }, setVolume() { /* */ }, stop() { /* */ } };
    }
    const al = new ActiveLoop(this, inst, this.buses[bus], opts, ref, rolloff, send, bus !== 'ui');
    this.loops.add(al);
    return al;
  }
  /** @internal */ removeLoop(l: ActiveLoop): void { this.loops.delete(l); }
  get listener(): V3 { return this.listenerPos; }

  // ----------------------------------------------------------------- global controls
  setListener(pos: V3, fwd: V3, up: V3): void {
    this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.01); l.positionY.setTargetAtTime(pos.y, t, 0.01); l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.01); l.forwardY.setTargetAtTime(fwd.y, t, 0.01); l.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01); l.upY.setTargetAtTime(up.y, t, 0.01); l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      const ll = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      ll.setPosition(pos.x, pos.y, pos.z); ll.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }
  setSpace(space: Space, seconds = 3): void {
    if (space === this.space) return;
    this.space = space;
    const t = this.ctx.currentTime; const tc = Math.max(0.05, seconds / 3);
    this.world.setSpace(space, t, tc);
  }
  /** Kill all reverb tails instantly (hard stops) by swapping in a fresh reverb unit. */
  resetMusicReverb(): void {
    const old = this.world;
    const t = this.ctx.currentTime;
    old.out.gain.cancelScheduledValues(t);
    old.out.gain.setValueAtTime(old.out.gain.value, t);
    old.out.gain.linearRampToValueAtTime(0, t + 0.02);
    this.world = new ReverbUnit(this.ctx, this.irs, this.master, this.space, 1, this.offline);
    this.reverbIn.disconnect();
    this.reverbIn.connect(this.world.input);
    if (this.offline) old.input.disconnect(); else setTimeout(() => old.dispose(), 200);
  }
  setTimeScale(s: number): void {
    s = clamp(s, 0.05, 1);
    if (Math.abs(s - this.timeScale) < 0.001) return;
    this.timeScale = s;
    const t = this.ctx.currentTime;
    this.tsPitch = 1 - (1 - s) * 0.22;
    const cutoff = s >= 0.999 ? 20000 : clamp(20000 * Math.pow(s, 1.5), 1100, 20000);
    for (const b of [this.buses.sfx, this.buses.amb]) ramp(b.filter.frequency, cutoff, t, 0.08);
    ramp(this.buses.music.filter.frequency, s >= 0.999 ? 20000 : clamp(20000 * Math.pow(s, 0.8), 3500, 20000), t, 0.1);
    ramp(this.reverbIn.gain, 1 + (1 - s) * 1.4, t, 0.1);
    for (const v of this.voices) if (!v.done && v.ts) ramp(v.src.playbackRate, v.rate * this.tsPitch, t, 0.08);
  }
  dropout(seconds: number, fadeIn = 2): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = this.dropGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0006, t + 0.015);
    g.setValueAtTime(0.0006, t + Math.max(0.02, seconds));
    g.exponentialRampToValueAtTime(0.02, t + seconds + fadeIn * 0.35);
    g.linearRampToValueAtTime(1, t + seconds + Math.max(0.05, fadeIn));
    this.dropUntil = t + seconds + fadeIn;
    // tinnitus ring (bypasses the dropout gain)
    const o1 = ctx.createOscillator(); o1.frequency.value = 7040 + rr(this.rng, -150, 150);
    const o2 = ctx.createOscillator(); o2.frequency.value = o1.frequency.value * 1.0045;
    const trem = ctx.createOscillator(); trem.frequency.value = 0.4; const tg = ctx.createGain(); tg.gain.value = 0.004;
    const tin = ctx.createGain(); tin.gain.value = 0;
    const lvl = 0.018;
    const end = t + seconds + fadeIn * 1.2 + 1.5;
    tin.gain.setValueAtTime(0, t);
    tin.gain.linearRampToValueAtTime(lvl, t + 0.08);
    tin.gain.setTargetAtTime(lvl * 0.55, t + 0.3, seconds * 0.6 + 0.3);
    tin.gain.setTargetAtTime(0, t + seconds, Math.max(0.3, fadeIn * 0.5));
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    trem.connect(tg).connect(tin.gain);
    o1.connect(tin); o2.connect(g2).connect(tin);
    tin.connect(this.preLimit);
    for (const o of [o1, o2, trem]) { o.start(t); o.stop(end); }
    o1.onended = () => { for (const n of [o1, o2, trem, tg, tin, g2]) n.disconnect(); };
  }
  get droppedOut(): boolean { return this.ctx.currentTime < this.dropUntil; }
  setVolumes(v: { master?: number; music?: number; sfx?: number; ambience?: number; ui?: number }): void {
    Object.assign(this.volumes, Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')));
    const t = this.ctx.currentTime;
    ramp(this.master.gain, clamp(this.volumes.master, 0, 2), t, 0.05);
    this.buses.music.setVolume(0.55 * clamp(this.volumes.music, 0, 2), t);
    this.buses.sfx.setVolume(clamp(this.volumes.sfx, 0, 2), t);
    this.buses.ui.setVolume(0.9 * clamp(this.volumes.ui ?? this.volumes.sfx, 0, 2) * clamp(this.volumes.sfx, 0, 2), t);
    this.buses.amb.setVolume(0.8 * clamp(this.volumes.ambience, 0, 2), t);
  }

  /** Music scheduler tick (called every ~25 ms in realtime; manually in offline tests). */
  tick(): void {
    const now = this.ctx.currentTime;
    this.music.tick(now);
    for (const l of this.loops) l.tick(now);
  }

  // ----------------------------------------------------------------- automatic global ambience
  update(dt: number, s: UpdateState): void {
    if (!this.amb) {
      this.amb = {
        wind: this.loop('amb_wind', {}) as ActiveLoop,
        birds: this.loop('amb_birds', {}) as ActiveLoop,
        insects: this.loop('amb_insects', { volume: 0.7 }) as ActiveLoop,
        rain: this.loop('amb_rain', { volume: 1 }) as ActiveLoop,
      };
      this.amb.rain.setParam('intensity', 0);
    }
    const w = clamp(s.weather);
    this.amb.wind.setParam('strength', clamp(s.windStrength * 0.75 + w * 0.45));
    this.amb.wind.setParam('rush', clamp(s.playerSpeed / 14));
    this.amb.birds.setParam('density', Math.pow(1 - w, 1.5) * (s.inCombat ? 0.2 : 1));
    this.amb.insects.setParam('level', (1 - w * 0.85) * (s.inCombat ? 0.45 : 1));
    this.amb.insects.setParam('water', clamp(s.nearWater));
    this.amb.rain.setParam('intensity', clamp((w - 0.2) / 0.8));
    if (w > 0.6) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        const r = this.rng;
        const a = r() * Math.PI * 2, dist = rr(r, 500, 1600);
        const p = this.listenerPos;
        this.play('thunder_distant', { position: { x: p.x + Math.cos(a) * dist, y: p.y + rr(r, 150, 400), z: p.z + Math.sin(a) * dist }, volume: 0.6 + 0.6 * w });
        this.thunderTimer = rr(r, 6, 22) * (1.7 - w);
      }
    } else this.thunderTimer = Math.max(this.thunderTimer, 4);
    if (Math.abs(s.timeScale - this.timeScale) > 0.001) this.setTimeScale(s.timeScale);
  }
}

export class ActiveLoop implements LoopHandle {
  readonly gain: GainNode;
  private readonly send: GainNode;
  private panner: PannerNode | null = null;
  private stopped = false;
  constructor(private eng: Engine, readonly inst: LoopInst, readonly bus: Bus, opts: PlayOpts, private ref: number, private rolloff: number, sendAmt: number, spatial: boolean) {
    const ctx = eng.ctx;
    const t = ctx.currentTime;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0, t);
    this.gain.gain.setTargetAtTime(Math.max(0, opts.volume ?? 1), t, 0.12);
    inst.out.connect(this.gain);
    this.send = ctx.createGain(); this.send.gain.value = sendAmt;
    if (opts.position && spatial) {
      this.panner = eng.makePanner(ref, rolloff);
      eng.setPannerPos(this.panner, opts.position);
      this.gain.connect(this.panner).connect(bus.input);
    } else this.gain.connect(bus.input);
    this.gain.connect(this.send).connect(bus.wet);
    if (inst.direct) inst.direct.connect(bus.input);
  }
  setPosition(p: V3): void {
    if (this.stopped) return;
    if (!this.panner) {
      // late upgrade to positional
      const ctx = this.eng.ctx;
      this.panner = this.eng.makePanner(this.ref, this.rolloff);
      this.gain.disconnect();
      this.gain.connect(this.panner).connect(this.bus.input);
      this.gain.connect(this.send);
      void ctx;
    }
    this.eng.setPannerPos(this.panner, p, true);
    if (this.inst.setPosition) this.inst.setPosition(p);
  }
  setParam(name: string, value: number): void { if (!this.stopped && isFinite(value)) this.inst.setParam(name, value); }
  setVolume(v: number, rampS = 0.1): void {
    if (this.stopped) return;
    ramp(this.gain.gain, Math.max(0, v), this.eng.ctx.currentTime, Math.max(0.005, rampS / 3));
  }
  stop(fade = 0.5): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.eng.ctx.currentTime;
    const f = Math.max(0.02, fade);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + f);
    this.eng.removeLoop(this);
    const kill = () => {
      this.inst.dispose();
      for (const n of [this.gain, this.send, this.panner]) if (n) { try { n.disconnect(); } catch { /* */ } }
    };
    if (this.eng.offline) kill.call(this); else setTimeout(kill, (f + 0.1) * 1000);
  }
  tick(now: number): void { if (!this.stopped && this.inst.tick) this.inst.tick(now); }
}

function softClipCurve(): Float32Array<ArrayBuffer> {
  // input is pre-scaled by 0.5, so curve index x in [-1,1] represents signal 2x
  const n = 4096; const c = new Float32Array(n);
  const knee = 0.82;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const s = x * 2; const a = Math.abs(s);
    const y = a < knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(s) * y * 0.985;
  }
  return c;
}
