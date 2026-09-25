// Melee combat & creature sounds.
import { Out, rr, ri, type Sig, type Rng, mtof, decorrelate } from '../dsp';
import {
  whoosh, thump, subBoom, burst, metal, rockCrack, creak, creature, sparkle, chime, clack, rustle, crunch,
  env, xenv, osc, white, pink, svf, mul, addInto, zeros, secs, wander, formants, scale, bell, ad, drive, norm, lp, hp,
} from './layers';
import type { Recipe } from './types';

/** Noise scraped through high-Q metal resonances (blade sliding in/out of scabbard). */
function scrape(sr: number, r: Rng, dur: number, f0: number, rise: number, bright: number): Sig {
  const n = secs(sr, dur);
  const ex = white(n, r);
  const w = wander(sr, n, 70, r), w2 = wander(sr, n, 9, r);
  const e = env(sr, n, [0, 0, dur * 0.12, 1, dur * 0.8, 0.8, dur, 0]);
  for (let i = 0; i < n; i++) ex[i] *= e[i] * (0.55 + 0.45 * w[i]) * (0.8 + 0.2 * w2[i]);
  const fr = xenv(sr, n, [0, 1, dur, rise]);
  const ratios = [1, 1.52, 2.23, 2.87, 3.61, 4.4, 5.3];
  const bank = ratios.map((m, k) => ({ f: fr.map((x) => x * f0 * m) as Sig, q: 35 + k * 6, g: (k > 2 ? bright : 1) / (1 + k * 0.35) }));
  const a = formants(ex, sr, bank);
  addInto(a, svf(ex, sr, fr.map((x) => x * 6000) as Sig, 1.4, 'bpn'), 0.25 * bright);
  return a;
}

export const sword_draw: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.2);
  o.add(creak(sr, r, 0.15, 60, 40, 800), 0, 0.25);
  const sc = scrape(sr, r, 0.42, rr(r, 820, 950), 1.18, 1);
  o.addWide(sc, 0.04, 0.9, 0.25);
  const f0 = rr(r, 880, 1000);
  const ring = metal(sr, r, f0, 2.0, 0.75, 1.1, 10);
  o.addWide(ring, 0.44, 0.7, 0.35);
  o.add(metal(sr, r, f0 * 3.3, 1.2, 0.3, 1, 5), 0.44, 0.3, 0.2);
  o.add(burst(sr, r, 0.05, 6500, 1, 0.0005, 0.006), 0.44, 0.4);
  o.addWide(whoosh(sr, r, { dur: 0.5, f0: 160, f1: 220, fMid: 700, q: 0.8, low: 0.8, peakAt: 0.35 }), 0.42, 0.5, 0.4);
  return o.clean().normalize(0.95);
};

export const sword_sheathe: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.1);
  const sc = scrape(sr, r, 0.32, rr(r, 950, 1050), 0.86, 0.8);
  o.addWide(sc, 0, 0.8, 0.25);
  const t = 0.3;
  o.add(thump(sr, 170, 80, 0.25, 0.04, 0.5, r), t, 0.9);
  o.add(clack(sr, r, rr(r, 650, 800), 0.12), t, 0.6);
  o.add(metal(sr, r, rr(r, 380, 440), 0.7, 0.18, 0.7, 7), t, 0.35);
  o.add(creak(sr, r, 0.2, 45, 30, 700), t + 0.05, 0.2);
  return o.clean().normalize(0.95);
};

export const swing_light: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.42);
  const d = rr(r, 0.24, 0.32);
  o.addWide(whoosh(sr, r, { dur: d, f0: rr(r, 450, 600), f1: rr(r, 600, 800), fMid: rr(r, 1900, 2600), q: 1.3, peakAt: rr(r, 0.4, 0.55), tone: 0.25, pow: 1.8 }), 0.01, 1, 0.35);
  return o.clean().normalize(0.95);
};

export const swing_heavy: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.8);
  const d = rr(r, 0.5, 0.62);
  o.addWide(whoosh(sr, r, { dur: d, f0: 180, f1: 260, fMid: rr(r, 950, 1300), q: 0.95, low: 1.0, tone: 0.6, peakAt: 0.5, pow: 1.6 }), 0.02, 1, 0.35);
  o.addWide(whoosh(sr, r, { dur: d * 0.8, f0: 700, f1: 900, fMid: 3000, q: 1.6, peakAt: 0.6, pow: 2.5 }), 0.06, 0.25, 0.6);
  const n = secs(sr, d);
  o.add(mul(osc(sr, n, xenv(sr, n, [0, 55, d * 0.5, 75, d, 50]), 'sin'), bell(n, 0.5, 2)), 0.02, 0.35);
  return o.clean().normalize(0.95);
};

export const whoosh_big: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.3);
  const d = rr(r, 0.95, 1.15);
  o.add(whoosh(sr, r, { dur: d, f0: 140, f1: 200, fMid: 750, q: 0.7, low: 1.3, peakAt: 0.5, pow: 1.4 }), 0, 0.8, -0.6);
  o.add(whoosh(sr, r, { dur: d, f0: 150, f1: 210, fMid: 820, q: 0.7, low: 1.0, peakAt: 0.55, pow: 1.4 }), 0.05, 0.8, 0.6);
  o.addWide(whoosh(sr, r, { dur: d * 0.7, f0: 600, f1: 900, fMid: 2600, q: 1.2, peakAt: 0.55, pow: 2 }), 0.15, 0.3, 0.8);
  return o.clean().normalize(0.95);
};

export const hit_flesh: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.55);
  o.add(thump(sr, rr(r, 110, 140), 50, 0.3, rr(r, 0.04, 0.06), 0.4, r), 0, 1);
  const n = secs(sr, 0.12);
  const sq = mul(svf(white(n, r), sr, rr(r, 550, 900), 1.4, 'bpn'), env(sr, n, [0, 0, 0.003, 1, 0.12, 0], 2));
  const w = wander(sr, n, 110, r); for (let i = 0; i < n; i++) sq[i] *= 0.5 + 0.5 * w[i];
  o.addWide(sq, 0.002, 0.9, 0.3);
  o.add(burst(sr, r, 0.03, 2600, 0.9, 0.0003, 0.004), 0, 0.6);
  o.add(burst(sr, r, 0.08, 280, 0.8, 0.001, 0.025, 'pink'), 0, 0.9);
  o.add(burst(sr, r, 0.05, 4500, 0.7, 0.0005, 0.008), 0.001, 0.25);
  return o.clean().normalize(0.95);
};

export const hit_armor: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.8);
  o.add(burst(sr, r, 0.02, 5200, 0.8, 0.0002, 0.0025), 0, 0.8);
  o.addWide(rockCrack(sr, r, 0.25, rr(r, 1300, 1900)), 0, 0.9, 0.3);
  o.add(metal(sr, r, rr(r, 1900, 2500), 0.6, 0.12, 1, 6), 0.001, 0.35, rr(r, -0.3, 0.3));
  o.add(thump(sr, 160, 70, 0.25, 0.035, 0.3, r), 0, 0.8);
  for (let k = 0; k < 5; k++) o.add(clack(sr, r, rr(r, 1800, 4200), 0.05), rr(r, 0.03, 0.3), rr(r, 0.08, 0.2), rr(r, -0.7, 0.7));
  return o.clean().normalize(0.95);
};

export const hit_critical: Recipe = (p) => {
  const { sr, r } = p;
  const o = new Out(sr, 1.6);
  o.mix(hit_flesh(p), 0, 0.8);
  o.addWide(metal(sr, r, rr(r, 1700, 2000), 1.4, 0.5, 1.3, 10), 0.0, 0.55, 0.4);
  o.add(subBoom(sr, 130, 32, 1.2, 0.35), 0, 1.1);
  o.addWide(rockCrack(sr, r, 0.3, 2200), 0, 0.7, 0.4);
  o.add(burst(sr, r, 0.02, 7000, 0.7, 0.0002, 0.002), 0, 0.8);
  o.addWide(sparkle(sr, r, 0.7, 18, 4000, 9000, 1.2), 0.02, 0.18, 0.8);
  o.addWide(whoosh(sr, r, { dur: 0.5, f0: 1200, f1: 400, fMid: 2400, q: 1, peakAt: 0.2, pow: 2 }), 0.03, 0.3, 0.6);
  return o.clean().normalize(0.95);
};

export const miss_whiff: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.3);
  o.addWide(whoosh(sr, r, { dur: rr(r, 0.18, 0.24), f0: 900, f1: 1300, fMid: rr(r, 2800, 3600), q: 2, peakAt: 0.5, bright: 1.5, pow: 2 }), 0, 1, 0.3);
  return o.clean().normalize(0.95);
};

export const dodge_roll: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.8);
  o.addWide(rustle(sr, r, 0.5, 0.5, 1.6), 0, 0.7, 0.5);
  o.addWide(whoosh(sr, r, { dur: 0.35, f0: 300, f1: 400, fMid: 900, q: 0.9, peakAt: 0.4, low: 0.4 }), 0, 0.7, 0.4);
  o.add(thump(sr, 95, 50, 0.2, 0.045, 0.3, r), 0.16, 0.6);
  o.addWide(rustle(sr, r, 0.25, 1.1, 1.4), 0.2, 0.5, 0.4);
  o.add(crunch(sr, r, 0.2, 1400, 600, 0.3), 0.35, 0.4);
  return o.clean().normalize(0.95);
};

export const guard_block: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.3);
  o.add(burst(sr, r, 0.02, 6000, 0.7, 0.0002, 0.002), 0, 1);
  o.addWide(metal(sr, r, rr(r, 600, 760), 1.3, 0.45, 1.1, 10), 0, 0.85, 0.3);
  o.add(metal(sr, r, rr(r, 360, 420), 1.0, 0.3, 0.8, 7), 0, 0.45);
  o.add(thump(sr, 190, 90, 0.2, 0.03, 0.5, r), 0, 0.7);
  o.addWide(sparkle(sr, r, 0.4, 14, 3000, 7500, 0.9), 0.005, 0.2, 0.8);
  return o.clean().normalize(0.95);
};

export const player_hurt: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.6);
  o.add(thump(sr, 120, 55, 0.25, 0.04, 0.5, r), 0, 0.9);
  o.add(burst(sr, r, 0.1, 800, 1, 0.001, 0.02, 'pink'), 0, 0.6);
  const g = creature(sr, r, {
    dur: 0.24, f0: [0, rr(r, 140, 160), 0.05, rr(r, 165, 185), 0.24, 110], amp: [0, 0, 0.015, 1, 0.12, 0.6, 0.24, 0],
    formant: [0, 1.0, 0.24, 0.9], size: 1.0, vowel: 'u', rough: 0.35, breath: 0.45, layers: 1, drive: 1.2, jitter: 0.02,
  });
  o.add(g, 0.025, 0.55);
  return o.clean().normalize(0.95);
};

export const stagger: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.5);
  const a = zeros(secs(sr, 1.4));
  for (let k = 0; k < 26; k++) {
    const at = k < 12 ? rr(r, 0, 0.08) : rr(r, 0.1, 0.9);
    const f = rr(r, 1800, 7000);
    addInto(a, chime(sr, r, f, 0.5, rr(r, 0.05, 0.2), 'glass'), rr(r, 0.1, 0.4) * (k < 12 ? 1 : 0.5), secs(sr, at));
  }
  o.addWide(a, 0, 0.8, 0.7);
  o.addWide(burst(sr, r, 0.2, 5000, 0.6, 0.0005, 0.04), 0, 0.6, 0.5);
  o.add(subBoom(sr, 95, 38, 0.9, 0.25), 0, 1.0);
  o.add(rockCrack(sr, r, 0.2, 2600), 0, 0.5);
  return o.clean().normalize(0.95);
};

export const enemy_growl: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.5);
  const d = rr(r, 1.1, 1.4);
  const g = creature(sr, r, {
    dur: d, f0: [0, rr(r, 65, 80), d * 0.3, rr(r, 85, 100), d * 0.8, 80, d, 68],
    amp: [0, 0, 0.15, 0.8, d * 0.5, 1, d * 0.85, 0.6, d, 0], formant: [0, 0.7, d * 0.5, 0.85, d, 0.7],
    size: 0.75, vowel: 'o', rough: 0.65, sub: 0.5, breath: 0.45, drive: 1.6, layers: 2,
  });
  o.addWide(g, 0, 1, 0.25);
  return o.clean().normalize(0.95);
};

export const enemy_roar: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.5);
  const d = rr(r, 1.9, 2.3);
  const pk = rr(r, 0.9, 1.25);
  const g = creature(sr, r, {
    dur: d, f0: [0, 105 * pk, 0.25, 185 * pk, d * 0.4, 215 * pk, d * 0.72, 160 * pk, d, 85 * pk],
    amp: [0, 0, 0.07, 0.75, 0.3, 1, d * 0.7, 0.85, d, 0], formant: [0, 0.7, 0.35, 1.05, d * 0.7, 1.0, d, 0.72],
    size: 0.85, vowel: 'a', rough: 0.55, sub: 0.6, breath: 0.6, drive: 2.2, layers: 3,
  });
  o.addWide(g, 0, 1, 0.3);
  const chest = lp(g, sr, 180, 1.2);
  o.add(chest, 0, 1.2);
  return o.clean().normalize(0.95);
};

export const enemy_attack_swipe: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.7);
  o.addWide(whoosh(sr, r, { dur: 0.35, f0: 380, f1: 520, fMid: 1600, q: 1.1, peakAt: 0.55, low: 0.4 }), 0, 0.9, 0.3);
  let t = rr(r, 0.16, 0.2);
  for (let k = 0; k < ri(r, 3, 4); k++) {
    o.add(burst(sr, r, 0.03, rr(r, 3000, 5500), 1.2, 0.0005, 0.008), t, rr(r, 0.4, 0.7), rr(r, -0.4, 0.4));
    t += rr(r, 0.01, 0.018);
  }
  const s = creature(sr, r, {
    dur: 0.35, f0: [0, 170, 0.1, 220, 0.35, 150], amp: [0, 0, 0.03, 1, 0.2, 0.6, 0.35, 0], formant: [0, 0.9, 0.35, 0.8],
    size: 0.9, vowel: 'a', rough: 0.7, sub: 0.3, breath: 0.7, drive: 1.8, layers: 2,
  });
  o.add(s, 0.05, 0.5);
  return o.clean().normalize(0.95);
};

export const enemy_hurt: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.6);
  const d = rr(r, 0.38, 0.48);
  const pk = rr(r, 0.9, 1.15);
  const g = creature(sr, r, {
    dur: d, f0: [0, 360 * pk, 0.06, 520 * pk, d * 0.6, 380 * pk, d, 250 * pk], amp: [0, 0, 0.012, 1, d * 0.4, 0.7, d, 0],
    formant: [0, 1.1, d, 0.9], size: 1.1, vowel: 'e', rough: 0.3, breath: 0.35, drive: 1.4, layers: 2, jitter: 0.03,
  });
  o.addWide(g, 0.005, 1, 0.2);
  o.add(thump(sr, 140, 70, 0.12, 0.025, 0.3, r), 0, 0.3);
  return o.clean().normalize(0.95);
};

export const enemy_death: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.8);
  const d = rr(r, 1.6, 1.9);
  const g = creature(sr, r, {
    dur: d, f0: [0, 150, 0.3, 185, d * 0.6, 120, d, 62], amp: [0, 0, 0.08, 0.9, 0.4, 1, d * 0.7, 0.55, d, 0],
    formant: [0, 0.95, 0.5, 1.0, d, 0.65], size: 0.85, vowel: 'o', rough: 0.6, sub: 0.5, breath: 0.6, drive: 1.7, layers: 2,
  });
  o.addWide(g, 0, 0.9, 0.25);
  const f = d - 0.25;
  o.add(thump(sr, 85, 38, 0.6, 0.11, 0.3, r), f, 1);
  o.addWide(crunch(sr, r, 0.35, 1200, 700, 0.5), f, 0.5, 0.5);
  o.add(thump(sr, 75, 36, 0.5, 0.08, 0.2, r), f + rr(r, 0.2, 0.3), 0.6);
  o.addWide(rustle(sr, r, 0.4, 0.9, 1.5), f + 0.05, 0.3, 0.5);
  return o.clean().normalize(0.95);
};

export const enemy_dissolve: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 3.4);
  // ethereal rising chord (Lydian-ish shimmer), arpeggiated upward
  const root = 57 + ri(r, 0, 4);
  const chordI = [0, 7, 11, 14, 18, 21, 26];
  chordI.forEach((iv, k) => {
    const f = mtof(root + iv + 12);
    o.add(chime(sr, r, f, 2.6, 1.1, 'glass'), 0.1 + k * rr(r, 0.1, 0.15), 0.3, (k % 2 ? 0.5 : -0.5) * (k / 6));
  });
  // sustained rising pad (sines with slow glide up)
  const n = secs(sr, 3.2);
  const pad = zeros(n);
  for (const iv of [0, 7, 14, 19]) {
    const f = xenv(sr, n, [0, mtof(root + iv), 3.2, mtof(root + iv + 7)]);
    const s = osc(sr, n, f, 'sin', r());
    const trem = osc(sr, n, 5 + iv * 0.2, 'sin', r());
    for (let i = 0; i < n; i++) s[i] *= 0.8 + 0.2 * trem[i];
    addInto(pad, s, 0.25);
  }
  mul(pad, env(sr, n, [0, 0, 0.8, 1, 2.2, 0.7, 3.2, 0], 1.5));
  o.addWide(pad, 0, 0.35, 0.6);
  // airy swell rising
  const air = mul(svf(white(n, r), sr, xenv(sr, n, [0, 700, 3.2, 7000]), 2, 'bpn'), env(sr, n, [0, 0, 1.2, 1, 3.2, 0], 1.5));
  o.addWide(air, 0, 0.4, 0.8);
  o.addWide(sparkle(sr, r, 3.0, 70, 2200, 5500, 1.9), 0.1, 0.35, 0.9);
  return o.clean().normalize(0.9);
};

export { pink, hp, bell, ad, norm, decorrelate };
