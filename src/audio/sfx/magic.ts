// UI and magic sounds.
import { Out, rr, ri, mtof, type Rng, type Sig } from '../dsp';
import {
  chime, sparkle, whoosh, burst, subBoom, fireRoar, crackle, zap, thunder, creak, clack, crunch, thump,
  env, xenv, osc, white, pink, svf, mul, addInto, zeros, secs, wander, bell, ad, drive, lp, hp,
} from './layers';
import { fm } from '../dsp';
import type { Recipe } from './types';

// ------------------------------------------------------------------ UI
export const ui_move: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.09);
  const f = rr(r, 2050, 2300);
  const n = secs(sr, 0.07);
  const b = mul(osc(sr, n, xenv(sr, n, [0, f * 1.06, 0.01, f, 0.07, f]), 'sin'), ad(sr, n, 0.001, 0.012));
  o.add(b, 0, 0.8);
  o.add(osc(sr, n, f * 2, 'sin').map((v, i) => v * Math.exp(-i / (0.005 * sr))) as Sig, 0, 0.15);
  o.add(burst(sr, r, 0.01, 6000, 1, 0.0002, 0.0012), 0, 0.3);
  return o.clean().normalize(0.95);
};

export const ui_confirm: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.7);
  o.add(chime(sr, r, mtof(88), 0.6, 0.22, 'chime'), 0, 0.6, -0.1);
  o.add(chime(sr, r, mtof(95), 0.6, 0.3, 'chime'), 0.055, 0.7, 0.1);
  const n = secs(sr, 0.3);
  o.add(mul(osc(sr, n, mtof(76), 'tri'), ad(sr, n, 0.002, 0.06)), 0, 0.25);
  return o.clean().normalize(0.95);
};

export const ui_cancel: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.5);
  const a = chime(sr, r, mtof(81), 0.4, 0.14, 'soft');
  const b = chime(sr, r, mtof(76), 0.45, 0.18, 'soft');
  o.add(lp(a, sr, 3500), 0, 0.7, 0.1);
  o.add(lp(b, sr, 3000), 0.06, 0.75, -0.1);
  return o.clean().normalize(0.95);
};

export const ui_atb_ready: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.8);
  const n = secs(sr, 0.12);
  o.add(mul(osc(sr, n, xenv(sr, n, [0, 700, 0.07, 1500, 0.12, 1550]), 'sin'), env(sr, n, [0, 0, 0.005, 1, 0.12, 0])), 0, 0.5);
  o.add(chime(sr, r, mtof(96), 0.7, 0.35, 'chime'), 0.07, 0.6);
  o.add(chime(sr, r, mtof(103), 0.6, 0.25, 'glass'), 0.09, 0.2);
  return o.clean().normalize(0.95);
};

export const ui_limit_ready: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.2);
  const notes = [86, 90, 93, 98, 100, 105];
  notes.forEach((m, k) => o.add(chime(sr, r, mtof(m), 1.4, 0.7, 'glass'), k * 0.045, 0.35, (k / 5) * 1.2 - 0.6));
  const n = secs(sr, 1.9);
  const sh = zeros(n);
  for (const m of [98, 105, 110]) {
    const s = osc(sr, n, mtof(m), 'sin', r());
    const tr = osc(sr, n, xenv(sr, n, [0, 9, 1.9, 16]), 'sin', r());
    for (let i = 0; i < n; i++) s[i] *= 0.5 + 0.5 * tr[i];
    addInto(sh, s, 0.2);
  }
  mul(sh, env(sr, n, [0, 0, 0.3, 1, 1.9, 0], 1.6));
  o.addWide(sh, 0.1, 0.5, 0.7);
  o.addWide(sparkle(sr, r, 1.6, 30, 4000, 9000, 1.3), 0.05, 0.3, 0.9);
  return o.clean().normalize(0.95);
};

export const ui_menu_open: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 0.8);
  o.addWide(whoosh(sr, r, { dur: 0.22, f0: 1200, f1: 2500, fMid: 4200, q: 1.5, peakAt: 0.6, pow: 2 }), 0, 0.45, 0.5);
  for (const [m, t] of [[79, 0.08], [86, 0.1], [95, 0.12]] as const) o.add(chime(sr, r, mtof(m), 0.6, 0.3, 'chime'), t, 0.35);
  return o.clean().normalize(0.95);
};

export const ui_levelup: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 2.4);
  const arp = [79, 84, 88, 91, 96];
  arp.forEach((m, k) => {
    o.add(chime(sr, r, mtof(m), 1.4, 0.55, 'chime'), k * 0.075, 0.45, -0.5 + k * 0.25);
    o.add(chime(sr, r, mtof(m + 12), 1.0, 0.35, 'glass'), k * 0.075 + 0.01, 0.12);
  });
  const t = arp.length * 0.075 + 0.05;
  for (const m of [84, 88, 91, 96, 100]) o.add(chime(sr, r, mtof(m), 1.8, 0.9, 'bell'), t, 0.2, rr(r, -0.6, 0.6));
  o.addWide(sparkle(sr, r, 1.6, 36, 3500, 9000, 1.4), t, 0.3, 0.9);
  return o.clean().normalize(0.95);
};

// ------------------------------------------------------------------ magic
export const cast_charge: Recipe = ({ sr, r }) => {
  const d = 1.7;
  const o = new Out(sr, d + 0.2);
  const n = secs(sr, d);
  const base = rr(r, 200, 240);
  const f = xenv(sr, n, [0, base, d, base * 2]);
  const hum = zeros(n);
  for (const [m, g] of [[1, 1], [1.5, 0.5], [2.003, 0.45], [3.01, 0.2]] as const) addInto(hum, osc(sr, n, f.map((v) => v * m) as Sig, 'sin', r()), g);
  const trem = osc(sr, n, xenv(sr, n, [0, 4, d, 16]), 'sin');
  for (let i = 0; i < n; i++) hum[i] *= 0.7 + 0.3 * trem[i];
  mul(hum, env(sr, n, [0, 0, d * 0.85, 1, d, 0], 1.8));
  o.addWide(hum, 0, 0.6, 0.4);
  const sw = mul(svf(white(n, r), sr, xenv(sr, n, [0, 500, d, 5000]), 3, 'bpn'), env(sr, n, [0, 0, d * 0.9, 1, d, 0], 2));
  const pan = osc(sr, n, 1.3, 'sin');
  const swL = sw.map((v, i) => v * (0.5 + 0.5 * pan[i])) as Sig, swR = sw.map((v, i) => v * (0.5 - 0.5 * pan[i])) as Sig;
  o.addSt(swL, swR, 0, 0.5);
  o.addWide(sparkle(sr, r, d * 0.6, 20, 3000, 7000, 1.5), d * 0.4, 0.3, 0.9);
  return o.clean().normalize(0.95);
};

export const fire_cast: Recipe = ({ sr, r }) => {
  const d = 0.9;
  const o = new Out(sr, d + 0.3);
  const n = secs(sr, d);
  const roar = mul(svf(fireRoar(sr, r, d, 3000, 0.8), sr, xenv(sr, n, [0, 300, 0.2, 2800, d, 900]), 0.8, 'lp'), env(sr, n, [0, 0, 0.12, 1, d, 0], 1.8));
  o.addWide(roar, 0, 0.9, 0.5);
  o.addWide(whoosh(sr, r, { dur: 0.5, f0: 400, f1: 1200, fMid: 2200, q: 0.8, peakAt: 0.4, low: 0.5 }), 0, 0.6, 0.4);
  o.addWide(crackle(sr, r, d, env(sr, n, [0, 50, 0.2, 500, d, 80]), 3200), 0.05, 0.4, 0.7);
  return o.clean().normalize(0.95);
};

export const fire_explode: Recipe = ({ sr, r }) => {
  const d = 2.8;
  const o = new Out(sr, d);
  o.add(subBoom(sr, 95, 32, 1.4, 0.3), 0, 1.1);
  o.add(mul(lp(white(secs(sr, 0.5), r), sr, 700, 0.8), ad(sr, secs(sr, 0.5), 0.003, 0.07)), 0, 1.2);
  const n = secs(sr, 1.8);
  const roar = mul(fireRoar(sr, r, 1.8, 2600, 0.8), env(sr, n, [0, 0, 0.02, 1, 0.5, 0.5, 1.8, 0], 1.8));
  drive(roar, 1.4);
  o.addWide(roar, 0.005, 0.9, 0.6);
  const nt = secs(sr, d);
  o.addWide(crackle(sr, r, d, env(sr, nt, [0, 600, 0.3, 300, d, 5]), 2800), 0.05, 0.45, 0.8);
  o.addWide(burst(sr, r, 0.2, 3000, 0.6, 0.0005, 0.03), 0, 0.5, 0.4);
  return o.clean().normalize(0.95);
};

export const thunder_cast: Recipe = ({ sr, r }) => {
  const d = 1.0;
  const o = new Out(sr, d + 0.2);
  const n = secs(sr, d);
  const z = mul(zap(sr, r, d, 160, 700), env(sr, n, [0, 0, d * 0.8, 1, d, 0], 1.5));
  o.addWide(z, 0, 0.5, 0.4);
  o.addWide(crackle(sr, r, d, env(sr, n, [0, 30, d, 1500]), 5000, 0.9), 0, 0.6, 0.8);
  const hum = mul(osc(sr, n, 120, 'saw'), env(sr, n, [0, 0, d * 0.9, 1, d, 0]));
  o.add(lp(hum, sr, 900), 0, 0.2);
  return o.clean().normalize(0.95);
};

export const thunder_strike: Recipe = ({ sr, r }) => {
  const d = 6.5;
  const o = new Out(sr, d);
  const n = secs(sr, 0.12);
  const snap = mul(osc(sr, n, xenv(sr, n, [0, 3500, 0.12, 180]), 'saw'), ad(sr, n, 0.0005, 0.03));
  o.add(snap, 0, 0.5);
  o.addWide(thunder(sr, r, d - 0.1, 0.02), 0.005, 1, 0.5);
  o.add(subBoom(sr, 70, 28, 2.5, 0.6), 0.01, 0.9);
  o.addWide(crackle(sr, r, 0.8, env(sr, secs(sr, 0.8), [0, 2500, 0.8, 0]), 5500), 0, 0.35, 0.8);
  return o.clean().normalize(0.97);
};

export const ice_cast: Recipe = ({ sr, r }) => {
  const d = 1.2;
  const o = new Out(sr, d + 0.6);
  const scale = [0, 2, 4, 7, 9];
  for (let k = 0; k < 8; k++) {
    const m = 84 + scale[ri(r, 0, 4)] + 12 * ri(r, 0, 1);
    o.add(chime(sr, r, mtof(m), 1.2, 0.5, 'glass'), rr(r, 0, 0.6), 0.2, rr(r, -0.8, 0.8));
  }
  const n = secs(sr, d);
  const sw = mul(svf(white(n, r), sr, xenv(sr, n, [0, 2500, d, 11000]), 2, 'bpn'), bell(n, 0.5, 1.5));
  o.addWide(sw, 0, 0.5, 0.8);
  o.addWide(whoosh(sr, r, { dur: 0.7, f0: 1500, f1: 3000, fMid: 5000, q: 1.2, peakAt: 0.5, bright: 1.5 }), 0, 0.4, 0.6);
  return o.clean().normalize(0.95);
};

export const ice_form: Recipe = ({ sr, r }) => {
  const d = 1.5;
  const o = new Out(sr, d + 0.8);
  // accelerating crystalline ticks
  let t = 0;
  while (t < d) {
    const u = t / d;
    o.add(clack(sr, r, rr(r, 3000, 8000), 0.04), t, rr(r, 0.15, 0.4) * (0.4 + u), rr(r, -0.7, 0.7));
    t += rr(r, 0.02, 0.07) * (1.2 - u);
  }
  o.addWide(creak(sr, r, d, 60, 220, 2600, 14), 0, 0.5, 0.4);
  const n = secs(sr, d);
  for (let k = 0; k < 10; k++) {
    const f0 = rr(r, 1500, 3000);
    const g = mul(osc(sr, secs(sr, 0.15), xenv(sr, secs(sr, 0.15), [0, f0, 0.15, f0 * 1.6]), 'sin'), ad(sr, secs(sr, 0.15), 0.003, 0.04));
    o.add(g, rr(r, 0.1, d), 0.2, rr(r, -0.6, 0.6));
  }
  o.add(crunch(sr, r, d, 700, 200, 0.4), 0, 0.3);
  o.add(chime(sr, r, mtof(95), 1.2, 0.5, 'glass'), d - 0.05, 0.35);
  void n;
  return o.clean().normalize(0.95);
};

export const ice_shatter: Recipe = ({ sr, r }) => {
  const o = new Out(sr, 1.8);
  o.addWide(mul(hp(white(secs(sr, 0.3), r), sr, 3500), ad(sr, secs(sr, 0.3), 0.0003, 0.04)), 0, 0.8, 0.5);
  for (let k = 0; k < 45; k++) {
    const early = k < 20;
    const at = early ? rr(r, 0, 0.08) : rr(r, 0.1, 1.3) * Math.pow(r(), 0.6);
    o.add(chime(sr, r, rr(r, 2200, 10000), 0.4, rr(r, 0.03, 0.15), 'glass'), at, rr(r, 0.1, 0.35) * (early ? 1 : 0.5), rr(r, -0.9, 0.9));
  }
  o.add(thump(sr, 180, 70, 0.2, 0.04, 0.4, r), 0, 0.6);
  o.addWide(crunch(sr, r, 0.3, 2500, 1500, 0.2), 0, 0.5, 0.5);
  return o.clean().normalize(0.95);
};

export const cure_cast: Recipe = ({ sr, r }) => {
  const d = 2.3;
  const o = new Out(sr, d + 0.5);
  const root = 77;
  const arp = [0, 4, 7, 12, 16, 19, 24];
  arp.forEach((iv, k) => o.add(chime(sr, r, mtof(root + iv), 1.6, 0.8, 'chime'), 0.05 + k * 0.09, 0.35, -0.6 + k * 0.2));
  const n = secs(sr, d);
  const pad = zeros(n);
  for (const iv of [-12, -5, 0, 4, 7]) addInto(pad, osc(sr, n, mtof(root + iv) * rr(r, 0.998, 1.002), 'tri', r()), 0.2);
  mul(pad, env(sr, n, [0, 0, 0.6, 1, 1.5, 0.7, d, 0], 1.4));
  o.addWide(lp(pad, sr, 2500), 0, 0.5, 0.6);
  o.addWide(sparkle(sr, r, d, 40, 2500, 7000, 1.3), 0.1, 0.35, 0.9);
  const air = mul(svf(white(n, r), sr, xenv(sr, n, [0, 1500, d, 6000]), 1.5, 'bpn'), bell(n, 0.4, 1.4));
  o.addWide(air, 0, 0.25, 0.8);
  return o.clean().normalize(0.95);
};

export { pink, wander, fm, drive, zeros, type Rng };
