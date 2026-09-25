// Sustained / looping sounds: realtime graphs driven by parameters, plus generative ambience.
import { rr, clamp, makeRng, type Rng } from './dsp';
import type { Engine } from './engine';
import type { BusName } from './sfx/registry';
import type { PlayOpts, V3 } from './types';

export interface LoopInst {
  out: AudioNode;
  direct?: AudioNode;
  setParam(name: string, v: number): void;
  dispose(): void;
  tick?(now: number): void;
  setPosition?(p: V3): void;
}
export interface LoopDef {
  bus: BusName;
  ref: number;
  rolloff?: number;
  send: number;
  create(e: Engine, o: PlayOpts): LoopInst;
}

function src(e: Engine, buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = e.ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.start(e.ctx.currentTime, Math.random() * buf.duration * 0.95);
  return s;
}
function filt(e: Engine, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = e.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
}
function gain(e: Engine, v: number): GainNode { const g = e.ctx.createGain(); g.gain.value = v; return g; }
function set(p: AudioParam, v: number, e: Engine, tc = 0.15): void { p.setTargetAtTime(v, e.ctx.currentTime, tc); }
function kill(nodes: AudioNode[]): void {
  for (const n of nodes) {
    try { if (n instanceof AudioScheduledSourceNode) n.stop(); } catch { /* */ }
    try { n.disconnect(); } catch { /* */ }
  }
}

/** Plain looping texture with optional slow level wander. */
function textureLoop(tex: string, level: number, wobble: number): (e: Engine, o: PlayOpts) => LoopInst {
  return (e, o) => {
    const s = src(e, e.texture(tex), o.pitch ?? 1);
    const g = gain(e, level);
    const lfo = e.ctx.createOscillator(); lfo.frequency.value = rr(Math.random, 0.05, 0.12);
    const lg = gain(e, level * wobble);
    lfo.connect(lg).connect(g.gain); lfo.start();
    s.connect(g);
    return {
      out: g,
      setParam: (n, v) => { if (n === 'pitch') set(s.playbackRate, v, e, 0.1); if (n === 'level' || n === 'intensity') set(g.gain, level * v, e, 0.2); },
      dispose: () => kill([s, g, lfo, lg]),
    };
  };
}

export const LOOPS: Record<string, LoopDef> = {
  amb_wind: {
    bus: 'amb', ref: 10, send: 0.15,
    create(e) {
      const out = gain(e, 1);
      const mk = (type: BiquadFilterType, f: number, q: number, g: number, rate = 1): [BiquadFilterNode, GainNode, AudioBufferSourceNode] => {
        const s = src(e, e.noise, rate); const fl = filt(e, type, f, q); const gg = gain(e, g);
        s.connect(fl).connect(gg).connect(out); return [fl, gg, s];
      };
      const body = mk('lowpass', 380, 0.6, 0);
      const mid = mk('bandpass', 700, 0.8, 0);
      const whistle = mk('bandpass', 1150, 10, 0, 0.9);
      const air = mk('highpass', 3200, 0.6, 0, 1.1);
      const rush = mk('bandpass', 420, 0.5, 0, 0.8);
      const rushHi = mk('bandpass', 1600, 0.7, 0, 1.2);
      let strength = 0.3, rushV = 0, gust = 0, gustT = 0, gustV = 0, last = 0;
      const r: Rng = makeRng(7);
      return {
        out,
        setParam(n, v) { if (n === 'strength') strength = clamp(v); if (n === 'rush') rushV = clamp(v); },
        tick(now) {
          if (now - last < 0.1) return;
          last = now;
          // gust random walk
          if (now > gustT) { gustV = r() * r(); gustT = now + rr(r, 1.5, 5); }
          gust += (gustV - gust) * 0.08;
          const s = strength, g = gust;
          const tc = 0.35;
          set(body[1].gain, 0.35 * s * (0.6 + 0.8 * g) + 0.03, e, tc);
          set(mid[1].gain, 0.3 * s * s * (0.4 + g), e, tc);
          set(mid[0].frequency, 450 + 700 * s * g + 150 * s, e, tc);
          set(whistle[1].gain, 0.12 * Math.max(0, s - 0.35) * (0.3 + g), e, tc);
          set(whistle[0].frequency, 900 + 900 * g * s, e, 0.6);
          set(air[1].gain, 0.06 * s * (0.5 + g) + 0.01, e, tc);
          set(rush[1].gain, 0.5 * rushV * rushV, e, 0.2);
          set(rushHi[1].gain, 0.12 * rushV * rushV * (0.7 + 0.6 * g), e, 0.2);
          set(rush[0].frequency, 300 + 250 * rushV, e, 0.3);
        },
        dispose: () => kill([out, ...body, ...mid, ...whistle, ...air, ...rush, ...rushHi]),
      };
    },
  },
  amb_birds: {
    bus: 'amb', ref: 15, send: 0.1,
    create(e) {
      const out = gain(e, 1);
      const r = makeRng(31);
      let density = 1;
      interface Bird { species: number; pos: V3; until: number; next: number; gain: number; pitch: number }
      const birds: Bird[] = [];
      const weights = [0.3, 0.3, 0.1, 0.22, 0.08];
      const pickSpecies = (): number => { let x = r(); for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; } return 0; };
      const spawn = (now: number): Bird => {
        const species = pickSpecies();
        const a = r() * Math.PI * 2; const d = species === 4 ? rr(r, 80, 160) : rr(r, 12, 60);
        const L = e.listener;
        return { species, pos: { x: L.x + Math.cos(a) * d, y: L.y + rr(r, 3, species === 4 ? 60 : 18), z: L.z + Math.sin(a) * d }, until: now + rr(r, 8, 30), next: now + rr(r, 0.2, 3), gain: rr(r, 0.5, 1), pitch: rr(r, 0.92, 1.1) };
      };
      return {
        out,
        setParam(n, v) { if (n === 'density') density = clamp(v, 0, 2); },
        tick(now) {
          const want = Math.round(1 + 4 * density);
          for (let i = birds.length - 1; i >= 0; i--) if (birds[i].until < now) birds.splice(i, 1);
          while (birds.length < want && density > 0.02) birds.push(spawn(now));
          if (birds.length > want) birds.splice(0, birds.length - want);
          for (const b of birds) {
            if (now < b.next) continue;
            if (density > 0.02) e.play('bird_phrase', { variant: b.species, position: b.pos, volume: b.gain * Math.min(1, density + 0.2), pitch: b.pitch * rr(r, 0.97, 1.03) }, out);
            b.next = now + (b.species === 4 ? rr(r, 8, 20) : rr(r, 1.2, 6)) / Math.max(0.3, density);
          }
        },
        dispose: () => kill([out]),
      };
    },
  },
  amb_insects: {
    bus: 'amb', ref: 8, send: 0.1,
    create(e, o) {
      const out = gain(e, 1);
      const s = src(e, e.texture('tex_insects'));
      const g = gain(e, 0.5);
      s.connect(g).connect(out);
      let water = 0; let next = 0; const r = makeRng(17);
      return {
        out,
        setParam(n, v) { if (n === 'level') set(g.gain, 0.5 * clamp(v, 0, 2), e, 0.5); if (n === 'water') water = clamp(v); },
        tick(now) {
          if (water < 0.05 || now < next) return;
          const L = e.listener; const a = r() * Math.PI * 2; const d = rr(r, 5, 25);
          e.play('frog_croak', { position: { x: L.x + Math.cos(a) * d, y: L.y - 1, z: L.z + Math.sin(a) * d }, volume: water * rr(r, 0.4, 1) }, out);
          next = now + rr(r, 0.4, 3) / (0.3 + water);
        },
        dispose: () => kill([out, s, g]),
      };
      void o;
    },
  },
  amb_stream: { bus: 'amb', ref: 6, send: 0.2, create: textureLoop('tex_stream', 0.8, 0.15) },
  amb_waterfall: { bus: 'amb', ref: 18, rolloff: 0.8, send: 0.35, create: textureLoop('tex_waterfall', 1, 0.08) },
  amb_lake: { bus: 'amb', ref: 10, send: 0.25, create: textureLoop('tex_lake', 0.7, 0.2) },
  amb_rain: {
    bus: 'amb', ref: 10, send: 0.2,
    create(e) {
      const out = gain(e, 1);
      const a = src(e, e.texture('tex_rain_light')); const ga = gain(e, 0);
      const b = src(e, e.texture('tex_rain_heavy')); const gb = gain(e, 0);
      a.connect(ga).connect(out); b.connect(gb).connect(out);
      return {
        out,
        setParam(n, v) {
          if (n !== 'intensity') return;
          const x = clamp(v);
          set(ga.gain, 0.55 * Math.sin(Math.min(1, x * 1.6) * Math.PI / 2) * (1 - 0.4 * x), e, 0.6);
          set(gb.gain, 0.75 * x * x, e, 0.6);
        },
        dispose: () => kill([out, a, ga, b, gb]),
      };
    },
  },
  materia_hum: {
    bus: 'sfx', ref: 3, send: 0.35,
    create(e, o) {
      const ctx = e.ctx;
      const out = gain(e, 0.0);
      const base = 220 * (o.pitch ?? 1);
      const lp = filt(e, 'lowpass', 1800, 0.8);
      const oscs = [1, 1.5, 2.003, 3.01].map((m, i) => {
        const x = ctx.createOscillator(); x.type = i === 0 ? 'sine' : 'triangle'; x.frequency.value = base * m;
        const g = gain(e, [0.5, 0.18, 0.14, 0.05][i]); x.connect(g).connect(lp); x.start(); return [x, g] as const;
      });
      const trem = ctx.createOscillator(); trem.frequency.value = 3.2; const tg = gain(e, 0.12); const amp = gain(e, 0.8);
      trem.connect(tg).connect(amp.gain); trem.start();
      const n = src(e, e.noise); const nf = filt(e, 'bandpass', 2400, 4); const ng = gain(e, 0.06);
      n.connect(nf).connect(ng).connect(amp);
      lp.connect(amp).connect(out);
      set(out.gain, 0.25 * (o.intensity ?? 1), e, 0.2);
      return {
        out,
        setParam(nm, v) {
          if (nm === 'intensity') { const x = clamp(v, 0, 1.5); set(out.gain, 0.25 * x, e, 0.1); set(lp.frequency, 900 + 3000 * x, e, 0.1); set(trem.frequency, 2 + 8 * x, e, 0.2); }
          if (nm === 'pitch') oscs.forEach(([x], i) => set(x.frequency, 220 * v * [1, 1.5, 2.003, 3.01][i], e, 0.1));
        },
        dispose: () => kill([out, lp, trem, tg, amp, n, nf, ng, ...oscs.flat()]),
      };
    },
  },
  boss_breath: {
    bus: 'sfx', ref: 40, send: 0.45,
    create(e) {
      const ctx = e.ctx;
      const out = gain(e, 0.45);
      const f = src(e, e.texture('tex_fire')); const fl = filt(e, 'lowpass', 2500, 0.7); const fg = gain(e, 0.9);
      f.connect(fl).connect(fg).connect(out);
      const growl = ctx.createOscillator(); growl.type = 'sawtooth'; growl.frequency.value = 52;
      const g2 = ctx.createOscillator(); g2.type = 'sawtooth'; g2.frequency.value = 26.3;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(3 * x); }
      shaper.curve = curve;
      const gl = filt(e, 'lowpass', 380, 1.2); const gg = gain(e, 0.25);
      const jitter = src(e, e.noise, 0.05); const jg = gain(e, 6); jitter.connect(jg).connect(growl.frequency);
      growl.connect(shaper); g2.connect(shaper); shaper.connect(gl).connect(gg).connect(out);
      growl.start(); g2.start();
      const hiss = src(e, e.noise, 1.3); const hf = filt(e, 'highpass', 4000, 0.7); const hg = gain(e, 0.2);
      hiss.connect(hf).connect(hg).connect(out);
      return {
        out,
        setParam(n, v) {
          if (n !== 'intensity') return;
          const x = clamp(v, 0, 1.5);
          set(fg.gain, 0.4 + 0.6 * x, e, 0.1); set(fl.frequency, 900 + 3500 * x, e, 0.1); set(gg.gain, 0.1 + 0.25 * x, e, 0.1);
          set(growl.frequency, 45 + 20 * x, e, 0.2); set(hg.gain, 0.1 + 0.2 * x, e, 0.1);
        },
        dispose: () => kill([out, f, fl, fg, growl, g2, shaper, gl, gg, jitter, jg, hiss, hf, hg]),
      };
    },
  },
  limit_charge: {
    bus: 'sfx', ref: 8, send: 0.5,
    create(e) {
      const ctx = e.ctx;
      const out = gain(e, 0.5);
      const sub = ctx.createOscillator(); sub.frequency.value = 55; const sg = gain(e, 0.35); sub.connect(sg).connect(out);
      const lp = filt(e, 'lowpass', 400, 2);
      const saws = [110, 110 * 1.006, 165].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); return o; });
      const sawG = gain(e, 0.12); lp.connect(sawG).connect(out);
      const shim = gain(e, 0);
      const tremO = ctx.createOscillator(); tremO.frequency.value = 5; const tremG = gain(e, 0.5); const shAmp = gain(e, 0.5);
      tremO.connect(tremG).connect(shAmp.gain);
      const tris = [880, 1320, 1760, 2640].map((f) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(shim); return o; });
      shim.connect(shAmp).connect(out);
      const n = src(e, e.noise); const nf = filt(e, 'bandpass', 800, 3); const ng = gain(e, 0.1); n.connect(nf).connect(ng).connect(out);
      const all = [sub, ...saws, ...tris, tremO];
      for (const o of all) o.start();
      const apply = (p: number): void => {
        const x = clamp(p);
        const semis = Math.pow(2, x);
        set(sub.frequency, 55 * (1 + x * 0.5), e, 0.1);
        saws.forEach((o, i) => set(o.frequency, [110, 110.66, 165][i] * Math.pow(2, x * 5 / 12), e, 0.1));
        tris.forEach((o, i) => set(o.frequency, [880, 1320, 1760, 2640][i] * semis, e, 0.1));
        set(lp.frequency, 300 + 5000 * x * x, e, 0.1);
        set(sawG.gain, 0.08 + 0.12 * x, e, 0.1);
        set(shim.gain, 0.03 + 0.09 * x, e, 0.1);
        set(tremO.frequency, 4 + 14 * x, e, 0.1);
        set(nf.frequency, 600 + 6000 * x, e, 0.1);
        set(ng.gain, 0.05 + 0.2 * x, e, 0.1);
        set(sg.gain, 0.25 + 0.2 * x, e, 0.1);
      };
      apply(0);
      return { out, setParam(nm, v) { if (nm === 'progress') apply(v); }, dispose: () => kill([out, sg, lp, sawG, shim, tremG, shAmp, n, nf, ng, ...all]) };
    },
  },
};
