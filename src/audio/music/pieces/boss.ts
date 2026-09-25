// Boss (phase 1), enraged phase 2 and Limit Break build (all original compositions).
import type { PieceDef } from '../piece';
import { mel, bassOf, voicing, tones, chordsOf } from '../theory';
import { ch, sm, padBar, bassBar, segs } from './common';

// ------------------------------------------------------------------ BOSS (C minor / phrygian, 112 bpm)
const BO_CHORDS = ['Cm', 'Cm', 'Cm', 'Cm', 'Db', 'Cm', 'Ab', 'Bbm', 'G', 'G', 'Cm', 'Ab', 'Db', 'Cm', 'Fm', 'Db', 'G', 'G'];
/** the boss motif (horns) */
export const BOSS_MOTIF = mel('G3:3 Ab3:1 | G3:2 Eb3:1 F3:1 | Ab3:3 Db4:1 | C4:3 r:1 | Eb4:3 F4:1 | Db4:2 C4:1 Bb3:1 | B3:2 D4:1 F4:1 | Ab4:2! G4:2');
export const BOSS_B = mel('C5:2 Eb5:1 G5:1 | Ab5:3 G5:1 | F5:2 Ab5:1 Db5:1 | Eb5:3 D5:.5 Eb5:.5 | F5:2 Ab5:1 C6:1 | Bb5:2 Ab5:1 F5:1 | G5:2 B4:1 D5:1 | F5:2 Eb5:1 D5:1');
const BO_OST: [number, number, number][] = [[0, 0, 1.2], [1.5, 0, 0.5], [2, 1, 0.9], [3, -5, 0.9]];

export const BOSS: PieceDef = {
  name: 'boss', bpm: 112, bars: 18, loopTo: 2, stemTc: 0.5, fadeIn: 0.05,
  channels: [
    ch('low', 'low', 'brass', 0.6, 0.35),
    ch('lowstr', 'low', 'ens', 0.55, 0.3),
    ch('bass', 'low', 'none', 0.5, 0.05),
    ch('perc', 'perc', 'perc', 0.85, 0.3),
    ch('choir', 'choir', 'choir', 0.6, 0.55, { formantShift: 0.92 }),
    ch('horns', 'horns', 'brass', 0.6, 0.45, { pan: -0.2, vib: 4 }),
    ch('trem', 'str', 'strings', 0.4, 0.45),
    ch('hibr', 'hibrass', 'brass', 0.45, 0.4, { pan: 0.2 }),
    ch('drone', 'low', 'none', 0.5, 0.4),
  ],
  warm: [['timp', [36, 41, 43, 44, 48]]],
  stems: (I) => ({ low: 1, perc: 0.7 + 0.3 * I, choir: 1, horns: 1, str: 0.6 + 0.4 * I, hibrass: sm(I, 0.3, 0.8) }),
  bar(b) {
    const i = b.i;
    const bar = BO_CHORDS[i];
    const c0 = chordsOf(bar)[0];
    const r2 = bassOf(c0, 36);
    if (i < 2) {
      // intro: drone + timpani roll crescendo + gong
      b.note('drone', 'drone', 0, 4.2, [24, 36], 0.7);
      if (i === 0) { b.hit('perc', 'gong', 0, 0.6); b.vowel('choir', 'o', 0, 0.2); }
      for (let k = 0; k < 16; k++) b.hit('perc', 'timp', k * 0.25, 0.12 + (i * 16 + k) * 0.018, 36);
      b.note('lowstr', 'strings', 0, 4.1, [36, 37], 0.5 + 0.2 * i, { art: 'trem' });
      if (i === 1) b.revCym('perc', 4, 0.45);
      return;
    }
    const sectB = i >= 10;
    // low brass / strings / bass ostinato
    for (const [beat, off, d] of BO_OST) {
      b.note('low', 'brass', beat, d, [r2 + off, r2 + off + 12], beat === 0 ? 0.9 : 0.7, { art: 'marc', bright: 0.8 });
      b.note('lowstr', 'strings', beat, d, [r2 + off, r2 + off - 12], 0.7, { art: 'marc' });
      b.note('bass', 'bass', beat, d * 0.9, r2 + off - 12, 0.8);
    }
    b.note('drone', 'drone', 0, 4.2, r2 - 12, 0.45);
    // timpani & taiko
    b.hit('perc', 'timp', 0, 0.85, Math.max(36, r2)); b.hit('perc', 'timp', 2, 0.6, Math.max(36, r2) + 7 > 48 ? Math.max(36, r2) - 5 : Math.max(36, r2) + 7);
    b.hit('perc', 'taiko', 0, 0.9, 0); b.hit('perc', 'taiko', 2.5, 0.7, 1);
    b.hit('perc', 'taiko', 1, 0.4, 3); b.hit('perc', 'taiko', 3, 0.45, 4);
    if (b.I > 0.5) for (const g of [1.75, 3.5, 3.75]) b.hit('perc', 'taiko', g, 0.35, 5);
    b.hit('perc', 'bassdrum', 0, 0.5);
    if (i % 4 === 2) b.hit('perc', 'crash', 0, 0.35, i % 2);
    if (i % 8 === 1) b.hit('perc', 'gong', 0, 0.35);
    // choir
    if (!sectB) {
      if (i % 2 === 0) { b.vowel('choir', 'a', 0, 0.05); b.note('choir', 'choir', 0, 0.5, voicing(c0, 60, 4), 0.9, { art: 'stab' }); }
      b.melody('horns', 'horn', BOSS_MOTIF, 2, 0.85, { art: 'sus' }, 12);
    } else {
      if (i === 10) b.vowel('choir', 'a', 0, 0.4);
      b.melody('choir', 'choir', BOSS_B, 10, 0.85, { art: 'sus' });
      b.melody('choir', 'choir', BOSS_B, 10, 0.55, { art: 'sus' }, -12);
      b.melody('horns', 'horn', BOSS_MOTIF, 10, 0.65, { art: 'sus' });
      b.note('trem', 'strings', 0, 4.05, voicing(c0, 72, 3), 0.55, { art: 'trem' });
    }
    b.note('trem', 'strings', 0, 4.05, [r2 + 36, r2 + 43], 0.35, { art: 'trem', bright: 1.2 });
    // high brass syncopated hits (intensity)
    const v = voicing(c0, 67, 3);
    for (const p of [1.5, 3.5]) b.note('hibr', 'brass', p, 0.4, v, 0.75, { art: 'stab' });
  },
};

// ------------------------------------------------------------------ ENRAGE (C minor, 150 bpm)
const EN_CHORDS = ['Cm', 'Cm', 'Db', 'Cm', 'Ab', 'Bbm', 'G', 'G', 'Cm', 'Ab', 'Db', 'Cm', 'Fm', 'Db', 'G', 'G'];
const EN_OST = [0, 0, 1, 0, 7, 8, 7, 5];
const PHRYG = [60, 61, 63, 65, 67, 68, 70, 72, 73, 75, 77, 79, 80, 82, 84, 85];

export const ENRAGE: PieceDef = {
  name: 'enrage', bpm: 150, bars: 16, loopTo: 0, stemTc: 0.3, fadeIn: 0.01,
  channels: [
    ch('low', 'core', 'brass', 0.55, 0.3),
    ch('lowstr', 'core', 'ens', 0.5, 0.25),
    ch('bass', 'core', 'none', 0.5, 0.05),
    ch('gtr', 'core', 'guitar', 0.8, 0.15),
    ch('war', 'core', 'perc', 0.9, 0.25),
    ch('perc2', 'perc2', 'perc', 0.7, 0.25),
    ch('choir', 'choir', 'choir', 0.65, 0.5, { formantShift: 0.95 }),
    ch('brass', 'core', 'brass', 0.6, 0.4),
    ch('runs', 'core', 'ens', 0.4, 0.35),
    ch('trem', 'core', 'strings', 0.35, 0.45),
  ],
  warm: [['timp', [36, 41, 43, 44, 48]]],
  stems: (I) => ({ core: 1, choir: 0.8 + 0.2 * I, perc2: 0.5 + 0.5 * I }),
  bar(b) {
    const i = b.i;
    const bar = EN_CHORDS[i];
    const c0 = chordsOf(bar)[0];
    const r = bassOf(c0, 36);
    // driving 8th ostinato (low brass + strings + bass)
    EN_OST.forEach((off, k) => {
      b.note('lowstr', 'strings', k * 0.5, 0.42, [r + off, r + off - 12], k % 4 === 0 ? 0.8 : 0.62, { art: 'marc' });
      b.note('bass', 'bass', k * 0.5, 0.4, r + off - 12, 0.8, { bright: 1.3 });
      if (k % 2 === 0) b.note('low', 'brass', k * 0.5, 0.45, [r + off, r + off + 12], 0.75, { art: 'marc' });
    });
    // distorted guitar: 16th palm-muted chugs + open power chords on accents
    for (let k = 0; k < 16; k++) {
      const acc = k === 0 || k === 6 || k === 12;
      if (acc) b.note('gtr', 'guitar', k * 0.25, 1.4, [r + 12, r + 19, r + 24], 0.9);
      else b.note('gtr', 'guitar', k * 0.25, 0.2, [r, r + 7], 0.7, { mute: true });
    }
    // phase-2 motif: the boss motif, now in brass, twice as urgent
    if (i < 8) {
      b.melody('brass', 'brass', BOSS_MOTIF, 0, 0.9, { art: 'marc' }, 12);
      b.melody('brass', 'horn', BOSS_MOTIF, 0, 0.8, { art: 'sus' });
      if (i % 2 === 0) b.vowel('choir', 'a', 0, 0.05);
      b.note('choir', 'choir', 0, 0.45, voicing(c0, 62, 4), 0.95, { art: 'stab' });
      b.note('choir', 'choir', 2.5, 0.45, voicing(c0, 62, 4), 0.8, { art: 'stab' });
    } else {
      b.melody('choir', 'choir', BOSS_B, 8, 0.95, { art: 'sus' });
      b.melody('choir', 'choir', BOSS_B, 8, 0.6, { art: 'sus' }, -12);
      b.melody('brass', 'horn', BOSS_MOTIF, 8, 0.8, { art: 'marc' }, 12);
    }
    b.note('trem', 'strings', 0, 4.05, voicing(c0, 76, 3), 0.55, { art: 'trem' });
    // storm string runs
    if (i % 4 === 3) {
      const up = i % 8 === 3;
      for (let k = 0; k < 16; k++) b.note('runs', 'strings', k * 0.25, 0.22, up ? PHRYG[k] : PHRYG[15 - k] - 12, 0.4 + k * 0.03, { art: 'stacc' });
    }
    // war drums
    for (let k = 0; k < 8; k++) b.hit('war', 'taiko', k * 0.5, k % 2 ? 0.45 : 0.85, k % 2 ? 4 : k % 4);
    b.hit('war', 'snare', 1, 0.7, i % 3); b.hit('war', 'snare', 3, 0.75, (i + 1) % 3);
    b.hit('war', 'timp', 0, 0.9, Math.max(36, r)); b.hit('war', 'bassdrum', 0, 0.6);
    if (i % 2 === 0) b.hit('war', 'crash', 0, 0.5, (i / 2) % 2);
    if (i % 8 === 0) b.hit('war', 'gong', 0, 0.35);
    if (i % 4 === 3) for (let k = 0; k < 8; k++) b.hit('war', 'tom', 2 + k * 0.25, 0.4 + k * 0.06, 2 - Math.floor(k / 3));
    b.hit('perc2', 'anvil', 1.5, 0.2, i % 2); b.hit('perc2', 'anvil', 3.5, 0.15, (i + 1) % 2);
    for (let k = 0; k < 16; k++) if (k % 4) b.hit('perc2', 'taiko', k * 0.25, 0.22, 5);
    for (let k = 0; k < 8; k++) b.hit('perc2', 'hat', k * 0.5 + 0.25, 0.25, k % 3);
  },
};

// ------------------------------------------------------------------ LIMIT (the world holds its breath; D pedal, 60 bpm)
export const LIMIT: PieceDef = {
  name: 'limit', bpm: 60, bars: 3, loopTo: 2, stemTc: 0.5, fadeIn: 0.6, space: 'cathedral',
  channels: [
    ch('drone', 'all', 'none', 0.6, 0.4),
    ch('shim', 'all', 'none', 0.5, 0.7),
    ch('hi', 'all', 'strings', 0.4, 0.65),
    ch('heart', 'all', 'none', 0.8, 0.2),
    ch('fx', 'all', 'none', 0.6, 0.6),
    ch('choir', 'all', 'choir', 0.35, 0.7),
  ],
  stems: () => ({ all: 1 }),
  bar(b) {
    const i = b.i;
    const loop = b.loop;
    if (i === 0) {
      b.note('drone', 'drone', 0, 8.5, [26, 33], 0.7, { bright: 0.8 });
      b.note('shim', 'shimmer', 0, 8.3, [86, 88, 93], 0.45, { glide: 2 });
      b.note('hi', 'strings', 0, 8.3, [81], 0.5, { art: 'swell', rise: 2 });
      b.vowel('choir', 'u', 0, 0.1);
      b.note('choir', 'choir', 0, 8.2, [50, 57, 62], 0.4, { art: 'swell' });
      [0, 1, 2, 3].forEach((beat) => b.hit('heart', 'heart', beat, 0.55 + beat * 0.05));
      b.swell('fx', 0.5, 3.5, 0.5, 300, 5000);
      b.revCym('fx', 4, 0.35);
      return;
    }
    if (i === 1) {
      b.note('hi', 'strings', 0, 4.2, [86, 93], 0.6, { art: 'swell', rise: 1 });
      [0, 0.8, 1.55, 2.25, 2.9, 3.5].forEach((beat, k) => b.hit('heart', 'heart', beat, 0.7 + k * 0.04));
      b.vowel('choir', 'a', 0, 3);
      b.swell('fx', 0, 4, 0.7, 500, 9000);
      b.revCym('fx', 4, 0.5);
      return;
    }
    // plateau: sustain at peak tension
    b.note('drone', 'drone', 0, 4.4, [26, 33, 38], 0.7, { bright: 1.2 });
    b.note('shim', 'shimmer', 0, 4.4, [90, 93, 98], 0.5);
    b.note('hi', 'strings', 0, 4.3, [88, 95], 0.55, { art: 'trem', bright: 1.3 });
    b.note('choir', 'choir', 0, 4.4, [62, 69, 74], 0.45);
    for (let k = 0; k < 8; k++) b.hit('heart', 'heart', k * 0.5, 0.75);
    b.revCym('fx', 4, 0.35 + Math.min(0.2, loop * 0.05));
  },
};
export { padBar, bassBar, segs, tones };
