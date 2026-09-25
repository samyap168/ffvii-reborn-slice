// Elder Zolom boss sounds: huge serpent vocalizations, water and ground impacts.
import { Out, rr, ri, type Rng, type Sig } from '../dsp';
import {
  creature, splash, subBoom, thump, explosion, rockCrack, debris, rumble, whoosh, burst, clack, riser, fireRoar, crackle,
  env, xenv, osc, white, pink, brown, svf, mul, addInto, zeros, secs, wander, bell, ad, drive, lp, hp,
} from './layers';
import type { Recipe } from './types';

function serpentRoar(sr: number, r: Rng, d: number, pitch: number, anger = 1): Sig {
  const v = creature(sr, r, {
    dur: d,
    f0: [0, 42 * pitch, d * 0.15, 66 * pitch, d * 0.5, 74 * pitch * anger, d * 0.8, 58 * pitch, d, 36 * pitch],
    amp: [0, 0, d * 0.06, 0.7, d * 0.2, 1, d * 0.75, 0.85, d, 0],
    formant: [0, 0.55, d * 0.25, 0.85, d * 0.7, 0.8, d, 0.6],
    size: 0.55, vowel: 'a', rough: 0.72, sub: 0.9, breath: 0.85, drive: 2.4 + anger * 0.4, layers: 3, hiss: 0.3, jitter: 0.06,
  });
  // sub-bass throat resonance following the contour
  const n = secs(sr, d);
  const f = xenv(sr, n, [0, 30 * pitch, d * 0.5, 38 * pitch, d, 24 * pitch]);
  const sub = mul(osc(sr, n, f, 'sin'), env(sr, n, [0, 0, d * 0.1, 1, d * 0.75, 0.8, d, 0], 1.4));
  addInto(v, sub, 0.7);
  return v;
}

export const boss_roar: Recipe = ({ sr, r }) => {
  const d = rr(r, 3.0, 3.5);
  const o = new Out(sr, d + 0.9);
  o.addWide(serpentRoar(sr, r, d, rr(r, 0.9, 1.1)), 0, 1, 0.35);
  const n = secs(sr, 0.9);
  const hiss = mul(svf(white(n, r), sr, 5500, 0.9, 'bpn'), env(sr, n, [0, 0, 0.15, 1, 0.9, 0], 1.5));
  o.addWide(hiss, d - 0.3, 0.35, 0.6);
  return o.clean().normalize(0.97);
};

export const boss_hiss: Recipe = ({ sr, r }) => {
  const d = rr(r, 1.5, 2.0);
  const o = new Out(sr, d + 0.1);
  const n = secs(sr, d);
  const h = svf(white(n, r), sr, xenv(sr, n, [0, 4500, d * 0.5, 6000, d, 4000]), 1.1, 'bpn');
  addInto(h, svf(white(n, r), sr, 8500, 1.2, 'bpn'), 0.6);
  const rat = wander(sr, n, 32, r);
  for (let i = 0; i < n; i++) h[i] *= 0.7 + 0.3 * rat[i];
  mul(h, env(sr, n, [0, 0, 0.25, 1, d * 0.7, 0.8, d, 0], 1.5));
  o.addWide(h, 0, 1, 0.5);
  const breath = mul(lp(pink(n, r), sr, 600), env(sr, n, [0, 0, 0.3, 1, d, 0], 1.5));
  o.add(breath, 0, 0.5);
  return o.clean().normalize(0.95);
};

export const boss_tail_slam: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 3.2);
  o.addWide(whoosh(sr, r, { dur: 0.55, f0: 110, f1: 150, fMid: 500, q: 0.7, low: 1.5, peakAt: 0.8, pow: 1.4 }), 0, 0.6, 0.5);
  const t = 0.45;
  o.add(thump(sr, 75, 26, 1.2, 0.2, 0.6, r), t, 1.2);
  o.addWide(explosion(sr, r, 1.6, 1.4), t, 0.7, 0.4);
  o.addWide(rockCrack(sr, r, 0.35, 1100), t, 0.6, 0.5);
  o.addWide(debris(sr, r, 2.2, 40, 0.5), t + 0.08, 0.5, 0.8);
  return o.clean().normalize(0.97);
};

export const boss_bite: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.1);
  o.addWide(whoosh(sr, r, { dur: 0.25, f0: 300, f1: 500, fMid: 1200, q: 0.9, low: 0.8, peakAt: 0.8 }), 0, 0.6, 0.4);
  const t = 0.2;
  o.add(clack(sr, r, rr(r, 1100, 1300), 0.14), t, 1);
  o.add(clack(sr, r, rr(r, 1700, 2000), 0.12), t + 0.006, 0.8);
  o.add(burst(sr, r, 0.03, 3500, 0.8, 0.0003, 0.004), t, 0.8);
  o.add(thump(sr, 110, 45, 0.3, 0.05, 0.3, r), t, 0.8);
  o.add(creature(sr, r, {
    dur: 0.5, f0: [0, 70, 0.1, 95, 0.5, 60], amp: [0, 0, 0.04, 1, 0.3, 0.5, 0.5, 0], formant: [0, 0.6, 0.5, 0.55],
    size: 0.6, vowel: 'a', rough: 0.8, sub: 0.7, breath: 0.8, drive: 2, layers: 2, hiss: 0.3,
  }), t + 0.02, 0.45);
  return o.clean().normalize(0.95);
};

export const boss_breath_charge: Recipe = ({ sr, r }) => {
  const d = 2.3;
  const o = new Out(sr, d + 0.2);
  const n = secs(sr, d);
  const inhale = mul(svf(pink(n, r), sr, xenv(sr, n, [0, 500, d, 2500]), 1.2, 'bpn'), env(sr, n, [0, 0, d * 0.95, 1, d, 0], 2.5));
  o.addWide(inhale, 0, 0.8, 0.5);
  o.addWide(riser(sr, r, d, 55, 190, 5, 200, 4000), 0, 0.5, 0.4);
  o.add(creature(sr, r, {
    dur: d, f0: [0, 40, d, 70], amp: [0, 0, d * 0.9, 1, d, 0], formant: [0, 0.5, d, 0.8], size: 0.55, vowel: 'o',
    rough: 0.8, sub: 0.8, breath: 0.9, drive: 2, layers: 2,
  }), 0, 0.5);
  o.addWide(crackle(sr, r, d, env(sr, n, [0, 0, d, 900]), 3500), 0, 0.3, 0.8);
  return o.clean().normalize(0.95);
};

export const boss_quake: Recipe = ({ sr, r }) => {
  const d = rr(r, 3.2, 3.8);
  const o = new Out(sr, d);
  o.addWide(rumble(sr, r, d, 85, 4, 0.2, 0.5), 0, 1.4, 0.4);
  o.add(subBoom(sr, 40, 25, d, 1.2), 0, 0.6);
  for (let k = 0; k < 6; k++) o.add(rockCrack(sr, r, 0.25, rr(r, 700, 1500)), rr(r, 0.2, d - 0.5), rr(r, 0.2, 0.45), rr(r, -0.8, 0.8));
  o.addWide(debris(sr, r, d, 14, 0), 0.3, 0.35, 0.8);
  return o.clean().normalize(0.95);
};

export const boss_enrage: Recipe = ({ sr, r }) => {
  const d = 4.6;
  const o = new Out(sr, d);
  // tearing / ripping
  const nt = secs(sr, 1.8);
  const tear = svf(white(nt, r), sr, xenv(sr, nt, [0, 800, 1.8, 3500]), 1.2, 'bpn');
  const am = wander(sr, nt, 55, r);
  for (let i = 0; i < nt; i++) tear[i] *= Math.max(0, am[i] + 0.2);
  mul(tear, env(sr, nt, [0, 0, 1.2, 1, 1.8, 0], 1.5));
  addInto(tear, crackle(sr, r, 1.8, env(sr, nt, [0, 200, 1.6, 3500, 1.8, 0]), 2600), 0.5);
  o.addWide(tear, 0, 0.7, 0.6);
  o.addWide(serpentRoar(sr, r, 3.0, 1.2, 1.25), 0.7, 0.95, 0.4);
  o.addWide(riser(sr, r, 2.2, 70, 320, 6, 300, 7000), 1.3, 0.5, 0.5);
  o.add(subBoom(sr, 80, 25, 1.2, 0.4), 3.3, 1);
  o.addWide(explosion(sr, r, 1.3, 1.2), 3.3, 0.5, 0.5);
  return o.clean().normalize(0.98);
};

export const boss_meteor_fall: Recipe = ({ sr, r }) => {
  const d = 3.2;
  const o = new Out(sr, d);
  const n = secs(sr, d);
  const f = xenv(sr, n, [0, rr(r, 2200, 2600), d, rr(r, 380, 480)]);
  const w = osc(sr, n, f, 'sin');
  addInto(w, osc(sr, n, f.map((v) => v * 2.01) as Sig, 'sin'), 0.2);
  const vib = osc(sr, n, 7, 'sin');
  for (let i = 0; i < n; i++) w[i] *= 0.8 + 0.2 * vib[i];
  mul(w, env(sr, n, [0, 0, 0.8, 0.5, d, 1], 1.5));
  o.addWide(w, 0, 0.3, 0.3);
  const roar = mul(svf(fireRoar(sr, r, d, 3000, 0.7), sr, xenv(sr, n, [0, 400, d, 3000]), 0.8, 'lp'), env(sr, n, [0, 0, d, 1], 2.2));
  o.addWide(roar, 0, 1, 0.5);
  o.addWide(crackle(sr, r, d, env(sr, n, [0, 50, d, 900]), 3000), 0, 0.3, 0.8);
  return o.clean().normalize(0.95);
};

export const boss_meteor_impact: Recipe = ({ sr, r }) => {
  const d = 4.2;
  const o = new Out(sr, d);
  o.addWide(explosion(sr, r, 2.6, 2.4), 0, 1, 0.5);
  o.add(subBoom(sr, 65, 22, 2.5, 0.6), 0, 0.8);
  o.addWide(rockCrack(sr, r, 0.4, 1000), 0, 0.7, 0.4);
  o.addWide(debris(sr, r, 3.4, 45, 0.6), 0.1, 0.55, 0.9);
  o.addWide(crackle(sr, r, d, env(sr, secs(sr, d), [0, 600, d, 10]), 2800), 0.1, 0.3, 0.8);
  return o.clean().normalize(0.98);
};

export const boss_stagger: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.2);
  o.addWide(creature(sr, r, {
    dur: 1.3, f0: [0, 85, 0.15, 135, 0.6, 110, 1.3, 55], amp: [0, 0, 0.04, 1, 0.5, 0.7, 1.3, 0], formant: [0, 0.65, 0.3, 0.9, 1.3, 0.6],
    size: 0.6, vowel: 'e', rough: 0.6, sub: 0.7, breath: 0.7, drive: 2.2, layers: 3, hiss: 0.2,
  }), 0, 0.9, 0.3);
  o.add(thump(sr, 70, 30, 0.9, 0.15, 0.5, r), 0.05, 0.9);
  o.addWide(splash(sr, r, 1.4, 1.4), 0.1, 0.4, 0.6);
  return o.clean().normalize(0.97);
};

export const boss_death: Recipe = ({ sr, r }) => {
  const d = 8.5;
  const o = new Out(sr, d);
  const v = creature(sr, r, {
    dur: 4.6, f0: [0, 70, 0.5, 95, 1.6, 85, 2.8, 55, 3.8, 40, 4.6, 26], amp: [0, 0, 0.1, 0.9, 0.8, 1, 2.5, 0.8, 3.2, 0.4, 3.5, 0.6, 4.6, 0],
    formant: [0, 0.6, 1, 0.85, 3, 0.6, 4.6, 0.45], size: 0.55, vowel: 'a', rough: 0.75, sub: 0.9, breath: 0.9, drive: 2.3, layers: 3, hiss: 0.25, jitter: 0.08,
  });
  o.addWide(v, 0, 1, 0.35);
  const t = 4.0;
  o.add(thump(sr, 60, 22, 2.0, 0.35, 0.8, r), t, 1.3);
  o.addWide(splash(sr, r, 3, 3.5), t + 0.05, 0.9, 0.9);
  o.addWide(debris(sr, r, 3.5, 30, 0.8), t + 0.2, 0.5, 0.8);
  o.add(thump(sr, 55, 24, 1.2, 0.2, 0.3, r), t + 0.7, 0.6);
  const nh = secs(sr, 2.5);
  const exhale = mul(svf(pink(nh, r), sr, 1200, 0.7, 'bpn'), env(sr, nh, [0, 0, 0.4, 1, 2.5, 0], 1.5));
  o.addWide(exhale, 5.8, 0.3, 0.6);
  return o.clean().normalize(0.98);
};

export const boss_emerge: Recipe = ({ sr, r }) => {
  const d = 6.5;
  const o = new Out(sr, d);
  const nb = secs(sr, 0.8);
  const build = mul(lp(brown(nb, r), sr, 120), env(sr, nb, [0, 0, 0.75, 1, 0.8, 0.6], 2));
  o.add(build, 0, 1.2);
  const t = 0.6;
  o.addWide(splash(sr, r, 3, 3.8), t, 1, 1);
  o.addWide(splash(sr, r, 2.4, 3), t + 0.04, 0.6, 0.8);
  o.add(subBoom(sr, 70, 24, 2.5, 0.6), t, 1.1);
  const nw = secs(sr, 4.5);
  const rush = mul(lp(pink(nw, r), sr, 1600, 0.6), env(sr, nw, [0, 0, 0.15, 1, 1.5, 0.6, 4.5, 0], 1.6));
  o.addWide(rush, t, 0.7, 0.9);
  // rain-down of water
  for (let k = 0; k < 40; k++) {
    const at = t + rr(r, 0.8, 4.5);
    o.add(splash(sr, r, rr(r, 0.1, 0.8), rr(r, 0.2, 0.5)), at, rr(r, 0.05, 0.2), rr(r, -1, 1));
  }
  o.addWide(serpentRoar(sr, r, 3.4, 1.0), t + 0.4, 0.95, 0.4);
  return o.clean().normalize(0.98);
};

export const water_splash_big: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 3.4);
  o.addWide(splash(sr, r, 2.5, 2.6), 0, 1, 0.9);
  o.add(thump(sr, 120, 45, 0.6, 0.12, 0.2, r), 0, 0.6);
  for (let k = 0; k < 22; k++) o.add(splash(sr, r, rr(r, 0.1, 0.6), rr(r, 0.2, 0.4)), rr(r, 0.5, 2.8), rr(r, 0.05, 0.2), rr(r, -1, 1));
  return o.clean().normalize(0.95);
};

export const debris_rumble: Recipe = ({ sr, r }) => {
  const d = rr(r, 3.2, 3.8);
  const o = new Out(sr, d);
  o.addWide(debris(sr, r, d, 55, 0.7), 0, 1, 0.9);
  o.add(rumble(sr, r, d, 110, 3, 0.1, 0.4), 0, 0.6);
  return o.clean().normalize(0.95);
};

export { ri, zeros, bell, ad, drive, hp };
