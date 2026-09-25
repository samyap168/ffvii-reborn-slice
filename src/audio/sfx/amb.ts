// Ambience textures (seamless loops) and generative ambience grains (birds, frogs).
import { Out, rr, ri, seamless, type Rng, type Sig } from '../dsp';
import {
  fireRoar, crackle, grain, env, xenv, osc, white, pink, brown, svf, mul, addInto, zeros, secs, wander, bell, ad, lp, hp,
  formants, dust, splash,
} from './layers';
import type { Recipe } from './types';

function bubbles(sr: number, r: Rng, n: number, rate: number, fLo: number, fHi: number, gain: number): Sig {
  const o = zeros(n);
  const dur = n / sr;
  const count = Math.round(rate * dur);
  for (let k = 0; k < count; k++) {
    const f0 = rr(r, fLo, fHi);
    const g = grain(sr, f0, f0 * rr(r, 1.3, 2.6), rr(r, 0.015, 0.05), rr(r, 0.004, 0.018));
    addInto(o, g, rr(r, 0.2, 1) * gain, Math.floor(r() * (n - g.length)));
  }
  return o;
}

function streamCh(sr: number, r: Rng, n: number): Sig {
  const a = bubbles(sr, r, n, 130, 380, 1500, 0.35);
  const b = svf(white(n, r), sr, 1800, 0.7, 'bpn');
  const w = wander(sr, n, 6, r), w2 = wander(sr, n, 0.7, r);
  for (let i = 0; i < n; i++) b[i] *= 0.55 + 0.3 * w[i] + 0.15 * w2[i];
  addInto(a, b, 0.3);
  addInto(a, lp(pink(n, r), sr, 500), 0.6);
  return a;
}
export const tex_stream: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 9);
  o.addSt(streamCh(sr, r, o.n), streamCh(sr, r, o.n));
  return seamless(o.clean(), 1).normalize(0.9);
};

function waterfallCh(sr: number, r: Rng, n: number): Sig {
  const a = svf(brown(n, r), sr, 260, 0.6);
  addInto(a, svf(pink(n, r), sr, 900, 0.5, 'bpn'), 0.9);
  addInto(a, hp(white(n, r), sr, 3500), 0.12);
  addInto(a, bubbles(sr, r, n, 320, 300, 1200, 0.25), 1);
  const w = wander(sr, n, 0.5, r), w2 = wander(sr, n, 7, r);
  for (let i = 0; i < n; i++) a[i] *= 0.85 + 0.1 * w[i] + 0.05 * w2[i];
  return a;
}
export const tex_waterfall: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 9);
  o.addSt(waterfallCh(sr, r, o.n), waterfallCh(sr, r, o.n));
  return seamless(o.clean(), 1).normalize(0.9);
};

function lakeCh(sr: number, r: Rng, n: number): Sig {
  const a = zeros(n);
  const dur = n / sr;
  let t = rr(r, 0, 0.8);
  while (t < dur - 1.5) {
    const wd = rr(r, 1.0, 1.8);
    const wn = secs(sr, wd);
    const pk = rr(r, 0.35, 0.55);
    const w = mul(svf(pink(wn, r), sr, xenv(sr, wn, [0, 350, wd * pk, rr(r, 700, 1000), wd, 400]), 0.8, 'bpn'), bell(wn, pk, 1.6));
    addInto(w, mul(lp(brown(wn, r), sr, 180), bell(wn, pk, 1.5)), 0.8);
    addInto(a, w, rr(r, 0.5, 1), Math.round(t * sr));
    const bb = bubbles(sr, r, secs(sr, 0.5), 30, 500, 1300, 0.15);
    addInto(a, bb, 1, Math.round((t + wd * pk) * sr));
    t += rr(r, 1.2, 2.6);
  }
  addInto(a, lp(pink(n, r), sr, 300), 0.08);
  return a;
}
export const tex_lake: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 11);
  o.addSt(lakeCh(sr, r, o.n), lakeCh(sr, r, o.n));
  return seamless(o.clean(), 1).normalize(0.9);
};

function drops(sr: number, r: Rng, n: number, rate: number): Sig {
  const d = dust(sr, n, rate, r, 0.1, 1);
  const a = svf(d, sr, 3800, 0.9, 'bpn');
  addInto(a, svf(d, sr, 1600, 1.2, 'bpn'), 0.6);
  return a;
}
function rainCh(sr: number, r: Rng, n: number, heavy: boolean): Sig {
  const a = drops(sr, r, n, heavy ? 1400 : 220);
  if (!heavy) {
    const pl = bubbles(sr, r, n, 12, 1500, 4000, 0.3);
    addInto(a, pl, 1);
    addInto(a, hp(pink(n, r), sr, 2500), 0.12);
  } else {
    addInto(a, svf(pink(n, r), sr, 1600, 0.4, 'bpn'), 0.9);
    addInto(a, lp(brown(n, r), sr, 380), 0.5);
    addInto(a, hp(white(n, r), sr, 6000), 0.08);
  }
  return a;
}
export const tex_rain_light: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 7);
  o.addSt(rainCh(sr, r, o.n, false), rainCh(sr, r, o.n, false));
  return seamless(o.clean(), 1).normalize(0.9);
};
export const tex_rain_heavy: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 7);
  o.addSt(rainCh(sr, r, o.n, true), rainCh(sr, r, o.n, true));
  return seamless(o.clean(), 1).normalize(0.9);
};

export const tex_insects: Recipe = ({ sr, r }) => {
  const D = 9;
  const o = new Out(sr, D);
  const crickets = ri(r, 4, 6);
  for (let c = 0; c < crickets; c++) {
    const f = rr(r, 3900, 5200);
    const pulseRate = rr(r, 28, 45);
    const perChirp = ri(r, 2, 5);
    const period = rr(r, 0.35, 0.9);
    const g = rr(r, 0.3, 1);
    const pan = rr(r, -0.9, 0.9);
    const pn = secs(sr, 0.018);
    const pulse = mul(osc(sr, pn, f, 'sin'), bell(pn, 0.3, 1));
    addInto(pulse, mul(osc(sr, pn, f * 2.01, 'sin'), bell(pn, 0.3, 1)), 0.15);
    const tr = zeros(o.n);
    let t = rr(r, 0, period);
    while (t < D - 0.2) {
      if (r() > 0.12) for (let k = 0; k < perChirp; k++) addInto(tr, pulse, rr(r, 0.7, 1), Math.round((t + k / pulseRate) * sr));
      t += period * rr(r, 0.9, 1.1);
    }
    o.add(tr, 0, g * 0.5, pan);
  }
  // soft buzz layer (distant cicadas)
  const bz = svf(white(o.n, r), sr, 6200, 2, 'bpn');
  const am = osc(sr, o.n, 95, 'sin'); const sl = wander(sr, o.n, 0.3, r);
  for (let i = 0; i < o.n; i++) bz[i] *= (0.6 + 0.4 * am[i]) * (0.6 + 0.4 * sl[i]);
  o.addWide(bz, 0, 0.12, 0.8);
  return seamless(o.clean(), 1).normalize(0.9);
};

export const tex_fire: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 5);
  const n = o.n;
  const a = fireRoar(sr, r, 5, 2200, 0.7);
  const b = fireRoar(sr, r, 5, 2200, 0.7);
  addInto(a, crackle(sr, r, 5, 300, 3000), 0.3);
  addInto(b, crackle(sr, r, 5, 300, 3000), 0.3);
  o.addSt(a, b);
  void n;
  return seamless(o.clean(), 0.8).normalize(0.9);
};

// ---------------------------------------------------------------- birds
function chirp(sr: number, r: Rng, f0: number, f1: number, dur: number, fmIdx = 0.4, vib = 0, vibRate = 30): Sig {
  const n = secs(sr, dur);
  const f = xenv(sr, n, [0, f0, dur, f1]);
  if (vib) for (let i = 0; i < n; i++) f[i] *= 1 + vib * Math.sin(2 * Math.PI * vibRate * i / sr);
  const m = osc(sr, n, f.map((v) => v * 2) as Sig, 'sin');
  const o = zeros(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { o[i] = Math.sin(2 * Math.PI * ph + fmIdx * m[i]); ph += f[i] / sr; }
  return mul(o, env(sr, n, [0, 0, dur * 0.15, 1, dur * 0.6, 0.7, dur, 0], 1.2));
}
export const bird_phrase: Recipe = ({ sr, r, variant }) => {
  const species = ((variant % 5) + 5) % 5;
  const o = new Out(sr, 2.2);
  switch (species) {
    case 0: { // warbler trill
      const notes = ri(r, 6, 14); const base = rr(r, 3200, 5200); const step = rr(r, 0.045, 0.075);
      const dir = r() < 0.5 ? -1 : 1;
      for (let k = 0; k < notes; k++) {
        const f = base * (1 + dir * 0.02 * k);
        o.add(chirp(sr, r, f * 1.25, f * 0.8, rr(r, 0.03, 0.05), 0.5), k * step, rr(r, 0.6, 1));
      }
      break;
    }
    case 1: { // thrush melodic phrase
      const notes = ri(r, 3, 6); let t = 0;
      const scale = [1, 1.125, 1.26, 1.5, 1.68, 2];
      const base = rr(r, 1500, 2200);
      for (let k = 0; k < notes; k++) {
        const f = base * scale[ri(r, 0, 5)]; const d = rr(r, 0.1, 0.28);
        o.add(chirp(sr, r, f * rr(r, 0.95, 1.05), f * rr(r, 0.9, 1.15), d, 0.25, 0.015, rr(r, 20, 40)), t, rr(r, 0.6, 1));
        t += d + rr(r, 0.03, 0.12);
      }
      break;
    }
    case 2: { // dove coo
      const base = rr(r, 420, 540); let t = 0;
      const pat = [[0.25, 0.9], [0.45, 1.08], [0.3, 1], [0.35, 0.95]];
      for (const [d, m] of pat) {
        const n = secs(sr, d);
        const f = xenv(sr, n, [0, base * m, d * 0.3, base * m * 1.04, d, base * m * 0.95]);
        const s = osc(sr, n, f, 'sin'); addInto(s, osc(sr, n, f.map((v) => v * 2) as Sig, 'sin'), 0.15);
        mul(s, env(sr, n, [0, 0, d * 0.3, 1, d, 0], 1.5));
        o.add(s, t, 0.8); t += d + 0.06;
      }
      break;
    }
    case 3: { // finch chips
      const count = ri(r, 2, 4); const base = rr(r, 4200, 6500);
      for (let k = 0; k < count; k++) o.add(chirp(sr, r, base * 1.4, base * 0.7, 0.035, 0.8), k * rr(r, 0.09, 0.15), 1);
      break;
    }
    case 4: { // distant raptor cry
      const d = rr(r, 0.6, 0.9);
      const s = chirp(sr, r, rr(r, 2600, 3000), rr(r, 1700, 2000), d, 1.2, 0.01, 35);
      const n = s.length; const w = wander(sr, n, 60, r);
      for (let i = 0; i < n; i++) s[i] *= 0.8 + 0.2 * w[i];
      o.add(s, 0, 0.8);
      break;
    }
  }
  return o.clean().trim().normalize(0.9);
};

export const frog_croak: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.6);
  const syl = ri(r, 1, 3);
  const f = rr(r, 28, 45);
  for (let k = 0; k < syl; k++) {
    const d = rr(r, 0.08, 0.14);
    const n = secs(sr, d);
    const pulses = osc(sr, n, f, 'pulse', 0, 0.12);
    const v = formants(pulses, sr, [{ f: rr(r, 450, 650), q: 6, g: 1 }, { f: rr(r, 1300, 1700), q: 8, g: 0.6 }]);
    mul(v, env(sr, n, [0, 0, 0.01, 1, d * 0.7, 0.8, d, 0]));
    o.add(v, k * (d + 0.05), 1);
  }
  return o.clean().trim().normalize(0.9);
};

export { splash, ad };
