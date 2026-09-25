// Public entry point of the procedural audio + dynamic music system.
import { Engine } from './engine';
import { SFX } from './sfx/registry';
import { LOOPS } from './loops';
import { CUES } from './music/director';
import type { V3, Surface, PlayOpts, LoopHandle, MusicState, MusicDirector, UpdateState } from './types';

export type { V3, Surface, PlayOpts, LoopHandle, MusicState, MusicDirector, UpdateState };
export { Engine };

/** All one-shot sound names accepted by play(). */
export const SOUND_NAMES: readonly string[] = Object.keys(SFX);
/** All loop names accepted by loop() (any one-shot name can also be looped). */
export const LOOP_NAMES: readonly string[] = Object.keys(LOOPS);
/** All music cue names accepted by music.cue(). */
export const MUSIC_CUES: readonly string[] = CUES;

/** Loop handle that can be created before init() and binds once the engine exists. */
class LazyLoop implements LoopHandle {
  real: LoopHandle | null = null;
  private pos: V3 | null = null;
  private params = new Map<string, number>();
  private vol: [number, number] | null = null;
  stopped = false;
  constructor(readonly name: string, readonly opts: PlayOpts) {}
  bind(e: Engine): void {
    if (this.stopped || this.real) return;
    this.real = e.loop(this.name, this.pos ? { ...this.opts, position: this.pos } : this.opts);
    for (const [k, v] of this.params) this.real.setParam(k, v);
    if (this.vol) this.real.setVolume(this.vol[0], this.vol[1]);
  }
  setPosition(p: V3): void { if (this.real) this.real.setPosition(p); else this.pos = { x: p.x, y: p.y, z: p.z }; }
  setParam(name: string, value: number): void { if (this.real) this.real.setParam(name, value); else this.params.set(name, value); }
  setVolume(v: number, ramp?: number): void { if (this.real) this.real.setVolume(v, ramp); else this.vol = [v, ramp ?? 0.1]; }
  stop(fade?: number): void { this.stopped = true; if (this.real) this.real.stop(fade); }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private eng: Engine | null = null;
  private initPromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _ready = false;
  private lazyLoops: LazyLoop[] = [];
  private pendingState: { s: MusicState; opts?: { fade?: number; immediate?: boolean } } | null = null;
  private pendingIntensity = 0;
  private pendingVolumes: { master?: number; music?: number; sfx?: number; ambience?: number; ui?: number } = {};
  private warned = new Set<string>();
  private shadowState: MusicState = 'silence';
  readonly music: MusicDirector;

  constructor() {
    const self = this;
    this.music = {
      setState(s, opts) { if (self.eng) self.eng.music.setState(s, opts); else { self.pendingState = { s, opts }; self.shadowState = s; } },
      get state() { return self.eng ? self.eng.music.state : self.shadowState; },
      setIntensity(v) { if (self.eng) self.eng.music.setIntensity(v); else self.pendingIntensity = v; },
      cue(name) { if (self.eng) self.eng.music.cue(name); else if (!CUES.includes(name)) self.warnOnce(`cue ${name}`); },
      duck(a, s) { if (self.eng) self.eng.music.duck(a, s); },
    };
  }

  get ready(): boolean { return this._ready; }
  /** Underlying engine (advanced use / tooling). */
  get engine(): Engine | null { return this.eng; }

  /** Call from a user gesture. Creates/resumes the AudioContext, builds buses, pre-renders common sounds. */
  init(): Promise<void> {
    if (this.initPromise) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.initPromise;
    }
    this.initPromise = (async () => {
      const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = W.AudioContext ?? W.webkitAudioContext;
      if (!Ctor) { console.warn('[audio] Web Audio not supported'); return; }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // resume() may never settle without a user gesture: don't let init hang on it
      await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
      const eng = new Engine(ctx);
      this.eng = eng;
      // latency-critical one-shots within a time budget; everything else renders in the background
      eng.prerender(650);
      eng.music.warmCommon();
      eng.music.warmPiece('title');
      eng.music.warmPiece('explore');
      this.timer = setInterval(() => { try { eng.tick(); } catch (e) { console.warn('[audio] tick', e); } }, 25);
      this.backgroundPump();
      eng.setVolumes(this.pendingVolumes);
      eng.music.setIntensity(this.pendingIntensity);
      if (this.pendingState) eng.music.setState(this.pendingState.s, this.pendingState.opts);
      for (const l of this.lazyLoops) l.bind(eng);
      this.lazyLoops = [];
      this._ready = true;
      const resumeOnGesture = (): void => { if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined); };
      window.addEventListener('pointerdown', resumeOnGesture, { passive: true });
      window.addEventListener('keydown', resumeOnGesture, { passive: true });
    })();
    return this.initPromise;
  }

  private backgroundPump(): void {
    const eng = this.eng;
    if (!eng) return;
    const step = (): void => {
      this.idleTimer = null;
      eng.pump(6);
      if (eng.pendingJobs > 0 || eng.music.env.samples.pending > 0) this.idleTimer = setTimeout(step, 40);
    };
    this.idleTimer = setTimeout(step, 100);
  }

  private warnOnce(k: string): void {
    if (this.warned.has(k)) return;
    this.warned.add(k);
    console.warn(`[audio] unknown ${k}`);
  }

  setListener(pos: V3, forward: V3, up: V3): void { this.eng?.setListener(pos, forward, up); }

  update(dt: number, s: UpdateState): void { if (this.eng && this._ready) this.eng.update(dt, s); }

  play(name: string, opts?: PlayOpts): void {
    if (!SFX[name]) { this.warnOnce(`sound "${name}"`); return; }
    if (!this.eng) return;
    try { this.eng.play(name, opts ?? {}); } catch (e) { this.warnOnce(`play error ${name}: ${String(e)}`); }
  }

  loop(name: string, opts?: PlayOpts): LoopHandle {
    if (!LOOPS[name] && !SFX[name]) {
      this.warnOnce(`loop "${name}"`);
      return { setPosition() { /* */ }, setParam() { /* */ }, setVolume() { /* */ }, stop() { /* */ } };
    }
    if (this.eng) return this.eng.loop(name, opts ?? {});
    const l = new LazyLoop(name, opts ?? {});
    this.lazyLoops.push(l);
    return l;
  }

  setTimeScale(s: number): void { this.eng?.setTimeScale(s); }
  dropout(seconds: number, fadeIn?: number): void { this.eng?.dropout(seconds, fadeIn); }
  setVolumes(v: { master?: number; music?: number; sfx?: number; ambience?: number; ui?: number }): void {
    Object.assign(this.pendingVolumes, v);
    this.eng?.setVolumes(v);
  }
  suspend(): void { void this.ctx?.suspend().catch(() => undefined); }
  resume(): void { void this.ctx?.resume().catch(() => undefined); }
}
