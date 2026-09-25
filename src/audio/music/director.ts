// Music director: lookahead scheduler, state machine with quantized transitions,
// crossfades, transition stingers, cues and ducking.
import type { Engine } from '../engine';
import type { MusicDirector, MusicState } from '../types';
import { makeRng, clamp } from '../dsp';
import { PiecePlayer, Bar, type PieceDef } from './piece';
import { SampleBank } from './samples';
import { makeOrganWave, type MusicEnv } from './instruments';
import { ch } from './pieces/common';
import { EXPLORE, TITLE, AFTERMATH } from './pieces/explore';
import { ENCOUNTER, BATTLE, VICTORY } from './pieces/battle';
import { BOSS, ENRAGE, LIMIT } from './pieces/boss';
import { KOR_BEGIN, KOR_STRUCTURE, KOR_PORTAL, KOR_KNIGHTS, KOR_CHARGE, KOR_RESOLVE } from './pieces/kor';

export const PIECES: Record<string, PieceDef> = {
  title: TITLE, explore: EXPLORE, aftermath: AFTERMATH, encounter: ENCOUNTER, battle: BATTLE, victory: VICTORY,
  boss: BOSS, enrage: ENRAGE, limit: LIMIT, kor: KOR_BEGIN,
  kor_begin: KOR_BEGIN, kor_structure: KOR_STRUCTURE, kor_portal: KOR_PORTAL, kor_knights: KOR_KNIGHTS, kor_final_charge: KOR_CHARGE, kor_resolve: KOR_RESOLVE,
};
type Quant = 'bar' | 'beat' | 'now';
const QUANT: Record<MusicState, Quant> = {
  silence: 'beat', title: 'bar', explore: 'bar', encounter: 'beat', battle: 'beat', boss: 'beat', enrage: 'beat',
  limit: 'beat', kor: 'beat', victory: 'beat', aftermath: 'bar',
};
const FADE: Record<MusicState, number> = {
  silence: 1.5, title: 2, explore: 2.5, encounter: 0.8, battle: 0.25, boss: 0.5, enrage: 0.15, limit: 1.0, kor: 1.5, victory: 0.15, aftermath: 3,
};
export const CUES = ['boss_reveal', 'stagger', 'enrage_hit', 'kor_begin', 'kor_structure', 'kor_portal', 'kor_knights', 'kor_final_charge', 'kor_silence', 'kor_resolve'];

const FX_DEF: PieceDef = {
  name: 'fx', bpm: 60, bars: 0,
  channels: [
    ch('brass', 'all', 'brass', 0.6, 0.45), ch('horn', 'all', 'brass', 0.55, 0.45), ch('str', 'all', 'strings', 0.5, 0.45),
    ch('choir', 'all', 'choir', 0.55, 0.6), ch('perc', 'all', 'perc', 0.9, 0.4), ch('gtr', 'all', 'guitar', 0.8, 0.2),
    ch('low', 'all', 'none', 0.6, 0.2), ch('fx', 'all', 'none', 0.6, 0.5),
  ],
  stems: () => ({ all: 1 }),
  bar() { /* stingers only */ },
};

export class Director implements MusicDirector {
  readonly env: MusicEnv;
  private _state: MusicState = 'silence';
  private players: PiecePlayer[] = [];
  private cur: PiecePlayer | null = null;
  private fxp: PiecePlayer | null = null;
  private fxUsed = 0;
  private target = 0;
  private I = 0;
  private lastTick = -1;
  private duckEnd = 0;
  private duckAmt = 0;
  private warned = new Set<string>();
  private lastEnrageHit = -100;

  constructor(private eng: Engine) {
    const ctx = eng.ctx;
    this.env = { ctx, noise: eng.noise, samples: new SampleBank(ctx), organ: makeOrganWave(ctx), rnd: makeRng(4242) };
  }
  /** stinger player, created lazily and released when idle */
  private get fx(): PiecePlayer {
    this.fxUsed = this.eng.ctx.currentTime;
    if (!this.fxp) this.fxp = this.makeFx();
    return this.fxp;
  }
  get state(): MusicState { return this._state; }
  /** currently audible piece name (debug / tests) */
  get pieceName(): string { return this.cur?.def.name ?? 'none'; }

  private makeFx(): PiecePlayer {
    const m = this.eng.buses.music;
    const p = new PiecePlayer(this.env, FX_DEF, this.eng.ctx.currentTime, m.input, m.wet, 0.01, 'fx');
    p.primeStems();
    return p;
  }
  private fxBar(t: number): Bar { return new Bar(this.fx, 0, 0, 0, t, 1, 4, this.I); }

  /** pre-render the shared percussion kit in the background */
  warmCommon(): void {
    const s = this.env.samples;
    s.warm('taiko', [0, 1, 3, 4, 5]); s.warm('snare', [0, 1, 2, 3]); s.warm('tom', [0, 1, 2]); s.warm('crash', [0, 1]);
    s.warm('shaker', [0, 1, 2]); s.warm('hat', [0, 1, 2]); s.warm('revcym', [0]); s.warm('heart', [0]); s.warm('bassdrum', [0]);
    s.warm('timp', [36, 38, 40, 41, 43, 45, 46, 47, 48, 50, 52]); s.warm('gong', [0]); s.warm('boom', [0]); s.warm('anvil', [0, 1]);
  }
  warmPiece(state: string): void {
    const def = PIECES[state];
    if (def) for (const [k, list] of def.warm ?? []) this.env.samples.warm(k, list);
  }

  // ------------------------------------------------------------------ public API
  setIntensity(v: number): void { this.target = clamp(isFinite(v) ? v : 0); }

  setState(s: MusicState, opts: { fade?: number; immediate?: boolean } = {}): void {
    if (!(s in QUANT)) { this.warnOnce(`state:${s}`); return; }
    const now = this.eng.ctx.currentTime;
    const live = this.live(now);
    if (s === this._state && live && (live.state === s || s === 'kor')) { live.unstop(); this.cur = live; return; }
    if (s === 'silence' && this._state === 'silence') return;
    const prev = this._state;
    if (s === 'enrage' && prev === 'boss' && now - this.lastEnrageHit > 3 && !opts.immediate) { this.enrageHit(); return; }
    this._state = s;
    const def = s === 'silence' ? null : PIECES[s];
    const at = this.switchTo(def, s, opts.immediate ? 'now' : QUANT[s], opts.fade ?? FADE[s]);
    this.stinger(prev, s, at);
    this.eng.setSpace(def?.space ?? (s === 'kor' ? 'cathedral' : 'valley'), s === 'kor' || s === 'limit' ? 2 : 4);
  }

  cue(name: string): void {
    const now = this.eng.ctx.currentTime;
    const t = now + 0.02;
    switch (name) {
      case 'boss_reveal': this.hitHuge(t, false); this.duck(0.2, 0.4, now); break;
      case 'stagger': this.hitSmall(t); break;
      case 'enrage_hit': if (now - this.lastEnrageHit > 1) this.enrageHit(); break;
      case 'kor_begin': this.korSwitch('kor_begin', 'beat', 1.5); this.fxBar(t).hit('perc', 'gong', 0, 0.4); break;
      case 'kor_structure': this.korSwitch('kor_structure', 'beat', 1.5); break;
      case 'kor_portal': this.portalHit(t); this.korSwitch('kor_portal', 'now', 0.4); break;
      case 'kor_knights': {
        const at = this.korSwitch('kor_knights', 'beat', 0.3);
        const b = this.fxBar(at);
        b.hit('perc', 'crash', 0, 0.6, 0); b.hit('perc', 'taiko', 0, 0.9, 0); b.hit('perc', 'boom', 0, 0.6);
        b.note('brass', 'brass', 0, 0.5, [50, 57, 62, 65, 69], 0.9, { art: 'stab' });
        break;
      }
      case 'kor_final_charge': this.korSwitch('kor_final_charge', 'beat', 0.2); break;
      case 'kor_silence': this.hardStop(); this._state = 'kor'; break;
      case 'kor_resolve': this.korSwitch('kor_resolve', 'now', 0.5); break;
      default: this.warnOnce(`cue:${name}`);
    }
  }

  duck(amount: number, seconds: number, at?: number): void {
    const now = this.eng.ctx.currentTime;
    const t = Math.max(now, at ?? now);
    amount = clamp(amount, 0, 0.98);
    if (amount <= 0.001 || !isFinite(seconds)) return;
    const end = t + Math.max(0.05, seconds);
    if (amount < this.duckAmt && end <= this.duckEnd) return;
    this.duckAmt = Math.max(amount, this.duckEnd > t ? this.duckAmt * 0.5 : 0);
    this.duckEnd = end;
    for (const p of this.eng.buses.music.duckParams()) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(1 - amount, t, 0.012);
      p.setTargetAtTime(1, t + seconds * 0.35, Math.max(0.05, seconds * 0.22));
    }
  }

  // ------------------------------------------------------------------ scheduling
  tick(now: number): void {
    const dt = this.lastTick < 0 ? 0 : Math.min(0.5, now - this.lastTick);
    this.lastTick = now;
    this.I += (this.target - this.I) * (1 - Math.exp(-dt / 0.35));
    const hidden = typeof document !== 'undefined' && document.hidden;
    const horizon = this.eng.offline ? 0.15 : hidden ? 1.5 : 0.12;
    for (const p of this.players) { p.setIntensity(this.I); p.tick(now, horizon); }
    if (this.fxp) {
      this.fxp.setIntensity(this.I);
      this.fxp.tick(now, horizon);
      if (now - this.fxUsed > 14) { this.fxp.dispose(); this.fxp = null; }
    }
    if (now > this.duckEnd) this.duckAmt = 0;
    // retire finished players
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.stopAt + 9 < now || (p.ended && p.stopAt === Infinity && this.cur !== p && now > p.startTime + 600)) {
        p.dispose();
        this.players.splice(i, 1);
      }
    }
    if (!this.eng.offline) this.env.samples.pump(3);
  }

  private live(now: number): PiecePlayer | null {
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.disposed || p.startTime > now + 0.005) continue;
      if (p.stopAt === Infinity || p.stopAt > now + 0.02) return p;
    }
    return null;
  }
  private dropPending(now: number): void {
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.startTime > now + 0.005) { p.dispose(); this.players.splice(i, 1); }
    }
  }
  /** Stop the live piece at a musical boundary and start `def` there. Returns the switch time. */
  private switchTo(def: PieceDef | null, state: string, quant: Quant, fade: number, startAt?: number): number {
    const now = this.eng.ctx.currentTime;
    this.dropPending(now);
    const live = this.live(now);
    let at = now + 0.03;
    if (startAt !== undefined) at = startAt;
    else if (live && quant !== 'now') {
      live.unstop();
      let q = live.nextGrid(now + 0.06, quant);
      if (q - now > 2.5 && quant === 'bar') q = live.nextGrid(now + 0.06, 'beat');
      if (q - now > 2.5) q = now + 0.05;
      at = q;
    }
    if (live) { live.unstop(); live.stop(at, fade); }
    if (def) {
      const p = new PiecePlayer(this.env, def, at, this.eng.buses.music.input, this.eng.buses.music.wet, def.fadeIn ?? 0.05, state);
      p.setIntensity(this.I);
      p.primeStems();
      this.players.push(p);
      this.cur = p;
    } else this.cur = null;
    return at;
  }
  private korSwitch(piece: string, quant: Quant, fade: number): number {
    const now = this.eng.ctx.currentTime;
    this._state = 'kor';
    this.eng.setSpace('cathedral', 2);
    const live = this.live(now);
    if (live && live.def === PIECES[piece]) return now;
    return this.switchTo(PIECES[piece], 'kor', quant, fade);
  }
  private hardStop(): void {
    const now = this.eng.ctx.currentTime;
    for (const p of this.players) { p.unstop(); p.stop(now, 0.015); }
    this.dropPending(now);
    this.cur = null;
    if (this.fxp) { this.fxp.stop(now, 0.015); this.players.push(this.fxp); this.fxp = null; }
    this.eng.resetMusicReverb();
  }

  // ------------------------------------------------------------------ stingers
  private stinger(from: MusicState, to: MusicState, at: number): void {
    const now = this.eng.ctx.currentTime;
    const b = this.fxBar(at);
    if (to === 'battle' && from !== 'boss' && from !== 'enrage' && from !== 'battle') {
      if (at - now > 0.35) for (let k = 0; k < 6; k++) b.note('str', 'strings', -0.3 + k * 0.05, 0.06, 52 + k * 3, 0.4 + k * 0.08, { art: 'stacc' });
      b.hit('perc', 'crash', 0, 0.55, 1); b.hit('perc', 'taiko', 0, 0.9, 0); b.hit('perc', 'boom', 0, 0.45);
      b.note('brass', 'brass', 0, 0.4, [52, 59, 64, 67, 71], 0.95, { art: 'stab' });
      b.note('horn', 'horn', 0, 0.6, [40, 52], 0.9, { art: 'marc' });
    } else if (to === 'encounter') {
      b.hit('perc', 'boom', 0, 0.5); b.hit('perc', 'sub', 0, 0.4);
      b.note('str', 'strings', 0, 1.2, [40, 41, 46], 0.8, { art: 'marc' });
      for (let k = 0; k < 6; k++) b.hit('perc', 'timp', k * 0.07, 0.25 + k * 0.05, 40);
    } else if (to === 'boss' && from !== 'enrage') {
      b.hit('perc', 'gong', 0, 0.5); b.hit('perc', 'boom', 0, 0.6);
    } else if (to === 'limit') {
      b.hit('perc', 'sub', 0, 0.5);
      b.note('str', 'strings', 0, 1.5, [86], 0.4, { art: 'swell' });
    } else if (to === 'aftermath' || (to === 'explore' && (from === 'victory' || from === 'kor'))) {
      /* musical fade only */
    }
  }
  private hitHuge(t: number, enraged: boolean): void {
    const b = this.fxBar(t);
    b.note('brass', 'brass', 0, 0.6, [48, 55, 60, 63, 67], 1, { art: 'stab' });
    b.note('horn', 'horn', 0, 1.3, [36, 48, 55, 60], 1, { art: 'marc' });
    b.note('str', 'strings', 0, 0.7, [36, 48, 60, 63, 67, 72], 0.95, { art: 'marc' });
    b.hit('perc', 'timp', 0, 1, 36); b.hit('perc', 'bassdrum', 0, 1); b.hit('perc', 'crash', 0, 0.7, 0);
    b.hit('perc', 'taiko', 0, 1, 0); b.hit('perc', 'boom', 0, 0.9); b.hit('perc', 'gong', 0.02, 0.55);
    b.vowel('choir', 'a', 0, 0.05);
    b.note('choir', 'choir', 0, 0.35, [48, 55, 60, 63, 67, 72], 1, { art: 'stab' });
    b.note('choir', 'choir', 0.05, 2.6, [60, 63, 67, 72], 0.85, { art: 'sus', release: 1.8 });
    b.note('low', 'drone', 0, 3, [24, 36], 0.8);
    if (enraged) {
      b.note('gtr', 'guitar', 0, 2.2, [36, 43, 48], 1);
      b.hit('perc', 'anvil', 0, 0.35, 0);
    }
  }
  private hitSmall(t: number): void {
    const b = this.fxBar(t);
    b.note('brass', 'brass', 0, 0.3, [55, 61, 66, 67], 0.85, { art: 'stab' });
    b.note('str', 'strings', 0, 0.25, [79, 85, 86], 0.6, { art: 'stacc' });
    b.hit('perc', 'snare', 0, 0.8, 0); b.hit('perc', 'timp', 0, 0.7, 43); b.hit('perc', 'taiko', 0, 0.7, 3);
    b.hit('perc', 'crash', 0, 0.2, 1);
  }
  private portalHit(t: number): void {
    const b = this.fxBar(t);
    b.note('brass', 'brass', 0, 0.8, [50, 57, 62, 66, 69, 74], 1, { art: 'stab' });
    b.note('horn', 'horn', 0, 2, [38, 50, 57, 62], 1, { art: 'marc' });
    b.note('str', 'strings', 0, 1, [38, 50, 62, 66, 69, 74, 78], 0.95, { art: 'marc' });
    b.hit('perc', 'timp', 0, 1, 38); b.hit('perc', 'bassdrum', 0, 1); b.hit('perc', 'crash', 0, 0.8, 1);
    b.hit('perc', 'gong', 0, 0.7); b.hit('perc', 'boom', 0, 1); b.hit('perc', 'taiko', 0, 1, 0);
    b.vowel('choir', 'a', 0, 0.05);
    b.note('choir', 'choir', 0, 0.4, [50, 57, 62, 66, 69, 74], 1, { art: 'stab' });
  }
  private enrageHit(): void {
    const now = this.eng.ctx.currentTime;
    this.lastEnrageHit = now;
    const t = now + 0.02;
    this.dropPending(now);
    const live = this.live(now);
    if (live) { live.unstop(); live.stop(t, 0.06); }
    this.hitHuge(t, true);
    this.duck(0.15, 0.3, now);
    // reverse swell rising into the phase-two downbeat
    const rev = this.env.samples.get('revcym', 0);
    const down = t + Math.max(2.0, rev.duration);
    const b = this.fxBar(t);
    b.hit('fx', 'revcym', down - t - rev.duration, 0.8);
    b.swell('fx', 1.0, down - t - 1.0, 0.7, 250, 9000);
    b.note('str', 'strings', 0.9, down - t - 0.9, [48, 55, 60, 63, 72], 0.8, { art: 'swell', rise: 1 });
    b.note('choir', 'choir', 1.0, down - t - 1.0, [60, 63, 67, 72], 0.8, { art: 'swell' });
    const db = this.fxBar(down);
    db.hit('perc', 'boom', 0, 0.9); db.hit('perc', 'crash', 0, 0.7, 0); db.hit('perc', 'taiko', 0, 1, 0);
    this._state = 'enrage';
    this.switchTo(ENRAGE, 'enrage', 'now', 0.05, down);
  }

  private warnOnce(k: string): void {
    if (this.warned.has(k)) return;
    this.warned.add(k);
    console.warn(`[music] unknown ${k}`);
  }
}
