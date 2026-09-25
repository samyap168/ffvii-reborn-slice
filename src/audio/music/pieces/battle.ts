// Encounter tension loop, battle theme and victory fanfare (all original compositions).
import type { PieceDef } from '../piece';
import { mel, bassOf, voicing, tones, rootOf, chordsOf } from '../theory';
import { ch, sm, padBar, bassBar, arpBar, ostBar, segs } from './common';

// ------------------------------------------------------------------ ENCOUNTER
export const ENCOUNTER: PieceDef = {
  name: 'encounter', bpm: 92, bars: 4, loopTo: 0, stemTc: 0.4, fadeIn: 0.4,
  channels: [
    ch('low', 'low', 'ens', 0.7, 0.3),
    ch('hi', 'hi', 'strings', 0.4, 0.5),
    ch('perc', 'perc', 'none', 0.8, 0.3),
    ch('brass', 'low', 'brass', 0.5, 0.4),
  ],
  warm: [['timp', [40, 47]]],
  stems: (I) => ({ low: 1, hi: 0.6 + 0.4 * I, perc: 1 }),
  bar(b) {
    const i = b.i;
    b.note('low', 'strings', 0, 4.1, [40, 41, 47], 0.55 + 0.15 * (i % 2) + 0.15 * b.I, { art: 'trem' });
    b.note('hi', 'strings', 0, 4.2, i < 2 ? [83] : [83, 84], 0.35 + 0.1 * i, { art: 'swell', bright: 1.3 });
    b.hit('perc', 'heart', 0, 0.55 + 0.1 * b.I); b.hit('perc', 'heart', 2, 0.5 + 0.1 * b.I);
    if (i % 2 === 0) { b.hit('perc', 'timp', 0, 0.45, 40); b.note('brass', 'horn', 0, 1.5, [28, 40], 0.5, { art: 'marc' }); }
    if (i === 3) {
      for (let k = 0; k < 8; k++) b.hit('perc', 'timp', 2 + k * 0.25, 0.15 + k * 0.05, 40);
      b.revCym('perc', 4, 0.35);
    }
    if (b.I > 0.5) for (let k = 0; k < 4; k++) b.hit('perc', 'taiko', k + 0.5, 0.12, 4);
  },
};

// ------------------------------------------------------------------ BATTLE (E minor, 152 bpm)
const BA_CHORDS = [
  'Em', 'Em',
  'Em', 'Em', 'C', 'D', 'Em', 'Em', 'Am', 'B7',
  'Em', 'Em', 'C', 'D', 'G', 'D/F#', 'Am', 'B7',
  'C', 'D', 'Bm', 'Em', 'C', 'D', 'B', 'B7',
  'Em', 'Em', 'F', 'Em', 'Em', 'Em', 'F', 'B7',
];
const BA_A = mel('B4:1.5 E5:.5 G5:1 F#5:.5 E5:.5 | D5:1 E5:1 B4:2 | C5:1.5 E5:.5 G5:1 A5:1 | F#5:1.5 E5:.5 D5:1 F#5:1 | G5:1.5 F#5:.5 E5:1 B5:1 | A5:1 G5:.5 F#5:.5 G5:2 | C6:1.5 B5:.5 A5:1 E5:1 | D#5:1 E5:.5 F#5:.5 B5:2');
const BA_A2 = mel('E5:1.5 G5:.5 B5:1 A5:.5 G5:.5 | F#5:1 G5:1 E5:2 | E5:1.5 G5:.5 C6:1 B5:1 | A5:1.5 G5:.5 F#5:1 A5:1 | B5:1.5 A5:.5 G5:1 D6:1 | C6:1 B5:.5 A5:.5 A5:2 | C6:1.5 B5:.5 A5:1 C6:1 | B5:3 r:1');
const BA_B = mel('E5:2 G5:2 | F#5:2 A5:2 | B5:3 A5:.5 G5:.5 | E5:4 | E5:2 G5:2 | A5:2 F#5:2 | D#5:2 F#5:2 | B5:3 r:1');
const BA_C = mel('E3:1.5 F3:.5 G3:1 B3:1 | E4:2 D4:1 B3:1 | F3:1.5 G3:.5 A3:1 C4:1 | B3:4 | E3:1.5 F3:.5 G3:1 B3:1 | E4:2 F4:1 G4:1 | F4:1.5 E4:.5 D4:1 C4:1 | B3:2 D#4:2');
const STAB16 = [0, 3, 6, 10, 12];

export const BATTLE: PieceDef = {
  name: 'battle', bpm: 152, bars: 34, loopTo: 2, stemTc: 0.35, fadeIn: 0.02,
  channels: [
    ch('ost', 'ost', 'ens', 0.6, 0.2),
    ch('bass', 'ost', 'none', 0.55, 0.05),
    ch('str16', 'str', 'ens', 0.35, 0.3),
    ch('lead', 'lead', 'brass', 0.55, 0.4, { pan: -0.15 }),
    ch('vln', 'lead', 'strings', 0.45, 0.4, { pan: 0.15, vib: 6 }),
    ch('brass', 'brass', 'brass', 0.5, 0.35, { pan: 0.1 }),
    ch('drums', 'drums', 'perc', 0.85, 0.2),
    ch('perc2', 'perc2', 'perc', 0.7, 0.2),
  ],
  warm: [['timp', [40, 43, 45, 47, 48, 50, 52]]],
  stems: (I) => ({ ost: 1, lead: 1, drums: 0.75 + 0.25 * I, str: 0.45 + 0.55 * sm(I, 0, 0.6), brass: sm(I, 0.15, 0.6), perc2: sm(I, 0.4, 0.9) }),
  bar(b) {
    const i = b.i;
    const bar = BA_CHORDS[i];
    const c0 = chordsOf(bar)[0];
    const minor = /m(?!aj)/.test(c0);
    const riff = minor ? [0, 0, 12, 0, 10, 0, 7, 3] : [0, 0, 12, 0, 10, 0, 7, 4];
    ostBar(b, 'ost', 'strings', bar, 40, 0.5, riff, 0.7, 0.45, { art: 'marc' }, [0, 2]);
    ostBar(b, 'bass', 'bass', bar, 28, 0.5, riff.map((x) => (x === 12 ? 0 : x)), 0.75, 0.4);
    const sect = i < 2 ? 'intro' : i < 10 ? 'A' : i < 18 ? 'A2' : i < 26 ? 'B' : 'C';
    // upper string 16ths
    if (sect !== 'intro') {
      const T = tones(c0, 64, 84);
      const pat = [2, 1, 0, 1];
      for (let k = 0; k < 16; k++) b.note('str16', 'strings', k * 0.25, 0.2, T[Math.min(T.length - 1, pat[k % 4] + (k >= 8 ? 1 : 0))], k % 4 === 0 ? 0.55 : 0.4, { art: 'stacc' });
    }
    // melody
    if (sect === 'A') { b.melody('lead', 'horn', BA_A, 2, 0.8, { art: 'sus' }); b.melody('vln', 'strings', BA_A, 2, 0.7, { art: 'legato' }, 12); }
    if (sect === 'A2') { b.melody('lead', 'brass', BA_A2, 10, 0.8, { art: 'sus' }); b.melody('vln', 'strings', BA_A2, 10, 0.72, { art: 'legato' }); }
    if (sect === 'B') {
      b.melody('lead', 'brass', BA_B, 18, 0.9, { art: 'sus' });
      b.melody('vln', 'strings', BA_B, 18, 0.75, { art: 'legato' }, 12);
      padBar(b, 'brass', 'horn', bar, 60, 3, 0.6, { art: 'marc' });
    }
    if (sect === 'C') {
      b.melody('lead', 'brass', BA_C, 26, 0.9, { art: 'marc' });
      if (i % 2 === 1) {
        const sc = [64, 66, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89];
        for (let k = 0; k < 8; k++) b.note('vln', 'strings', 2 + k * 0.25, 0.22, sc[k * 2], 0.45 + k * 0.04, { art: 'stacc' });
      }
    }
    // brass stabs
    if (sect !== 'B') {
      const v = voicing(c0, 62, 4);
      for (const p of STAB16) b.note('brass', 'brass', p * 0.25, 0.25, v, p === 0 ? 0.85 : 0.7, { art: 'stab' });
    }
    // drums
    b.hit('drums', 'taiko', 0, 0.8, 0); b.hit('drums', 'taiko', 2, 0.7, 1);
    b.hit('drums', 'taiko', 1.5, 0.45, 3); b.hit('drums', 'taiko', 3.5, 0.45, 4);
    b.hit('drums', 'snare', 1, 0.6, i % 3); b.hit('drums', 'snare', 3, 0.65, (i + 1) % 3);
    b.hit('drums', 'timp', 0, 0.55, Math.max(40, Math.min(52, rootOf(c0, 40))));
    if (sect !== 'intro' && (i - 2) % 8 === 0) { b.hit('drums', 'crash', 0, 0.45, i % 2); b.hit('drums', 'bassdrum', 0, 0.6); }
    if (i % 4 === 1) {
      const toms = [2, 2, 1, 1, 0, 0, 0, 0];
      for (let k = 0; k < 8; k++) b.hit('drums', 'tom', 2 + k * 0.25, 0.35 + k * 0.05, toms[k]);
    }
    // perc2 (intensity layer)
    for (let k = 0; k < 8; k++) b.hit('perc2', 'hat', k * 0.5 + 0.5 * (k % 2), k % 2 ? 0.25 : 0.18, k % 3);
    for (const g of [0.75, 1.75, 2.75, 3.25]) b.hit('perc2', 'snare', g, 0.15, 3);
    b.hit('perc2', 'taiko', 0.75, 0.35, 4); b.hit('perc2', 'taiko', 2.75, 0.35, 5);
    if (i % 2 === 0) b.hit('perc2', 'crash', 0, 0.22, 1);
  },
};

// ------------------------------------------------------------------ VICTORY (Bb major)
const VI_FAN = mel('r:3 F4:1/3 G4:1/3 A4:1/3 | Bb4:1.5! D5:.5 F5:1 Eb5:1/3 F5:1/3 G5:1/3 | G5:1.5 Eb5:.5 F5:1/3 G5:1/3 A5:1/3 F5:1 | Bb5:4!');
const VI_CH = ['Bb', 'Bb', 'Eb F', 'Bb'];
const PV_CH = ['Bb', 'Gm', 'Eb', 'F', 'Bb/D', 'Eb', 'Cm7', 'F7', 'Bb', 'Gm', 'Eb', 'F', 'Gm', 'Eb', 'Cm7 F7', 'Bb'];
const PV_MEL = mel('F5:1.5 D5:.5 Bb4:1 | G5:2 F5:1 | Eb5:1 G5:1 Bb5:1 | A5:2 F5:1 | F5:1.5 D5:.5 F5:1 | G5:1 Bb5:1 G5:1 | Eb5:1.5 D5:.5 C5:1 | A4:2 C5:1 | D5:1.5 F5:.5 Bb5:1 | Bb5:2 A5:1 | G5:1 Bb5:1 Eb6:1 | C6:2 A5:1 | Bb5:1.5 A5:.5 G5:1 | G5:1 F5:1 Eb5:1 | Eb5:1 D5:.5 C5:.5 C5:1 | Bb4:3');

export const VICTORY: PieceDef = {
  name: 'victory', bpm: (bar) => (bar < 4 ? 138 : 96), meter: (bar) => (bar < 4 ? 4 : 3), bars: 20, loopTo: 4, fadeIn: 0.01,
  channels: [
    ch('tpt', 'all', 'brass', 0.6, 0.4, { pan: 0.1 }),
    ch('horns', 'all', 'brass', 0.55, 0.45, { pan: -0.2 }),
    ch('str', 'all', 'strings', 0.5, 0.45, { vib: 5 }),
    ch('low', 'all', 'ens', 0.5, 0.3),
    ch('perc', 'all', 'perc', 0.8, 0.35),
    ch('flute', 'all', 'none', 0.55, 0.45),
    ch('harp', 'all', 'none', 0.6, 0.45),
    ch('pizz', 'all', 'none', 0.5, 0.35),
    ch('pad', 'all', 'strings', 0.35, 0.5),
    ch('cel', 'all', 'none', 0.3, 0.5),
  ],
  warm: [['timp', [41, 46, 53]], ['harp', [46, 50, 53, 55, 58, 60, 62, 63, 65, 67, 70, 72, 74, 75, 77, 79, 82]], ['pizz', [34, 36, 39, 41, 43, 46, 50, 53, 55, 58, 62]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const i = b.i;
    if (i < 4) {
      const bar = VI_CH[i];
      b.melody('tpt', 'brass', VI_FAN, 0, 0.95, { art: 'sus', bright: 1.2 });
      b.melody('str', 'strings', VI_FAN, 0, 0.7, { art: 'marc' }, 12);
      if (i === 0) {
        const v = [46, 50, 53, 58, 62];
        b.note('horns', 'horn', 0, 0.9, v, 0.9, { art: 'marc' });
        b.note('low', 'strings', 0, 0.8, [34, 46], 0.85, { art: 'marc' });
        b.hit('perc', 'timp', 0, 0.9, 46); b.hit('perc', 'crash', 0, 0.55, 0); b.hit('perc', 'bassdrum', 0, 0.7);
        for (let k = 0; k < 8; k++) b.hit('perc', 'timp', 1 + k * 0.25, 0.25 + k * 0.05, k % 2 ? 41 : 46);
        b.hit('perc', 'snare', 3, 0.4, 0); b.hit('perc', 'snare', 3 + 1 / 3, 0.45, 1); b.hit('perc', 'snare', 3 + 2 / 3, 0.5, 2);
      } else if (i < 3) {
        padBar(b, 'horns', 'horn', bar, 60, 4, 0.75, { art: 'sus' });
        bassBar(b, 'low', 'strings', bar, 34, 0.75, { art: 'marc', octave: true });
        for (const [c, s] of segs(b, bar)) b.hit('perc', 'timp', s, 0.7, bassOf(c, 41));
        b.hit('perc', 'snare', 2, 0.35, 1);
        if (i === 2) { const sc = [65, 67, 69, 70, 72, 74, 75, 77]; sc.forEach((m, k) => b.note('str', 'strings', 2 + k * 0.25, 0.22, m + 12, 0.45, { art: 'stacc' })); }
      } else {
        b.note('horns', 'horn', 0, 4, [58, 62, 65, 70], 0.9, { art: 'sus' });
        b.note('tpt', 'brass', 0, 4, [65, 70, 74], 0.7, { art: 'sus' });
        b.note('low', 'strings', 0, 4, [34, 46], 0.8, { art: 'legato' });
        b.note('str', 'strings', 0, 4, [70, 74, 77, 82], 0.6, { art: 'trem' });
        b.hit('perc', 'crash', 0, 0.6, 1); b.hit('perc', 'bassdrum', 0, 0.7);
        for (let k = 0; k < 12; k++) b.hit('perc', 'timp', k * 0.25, 0.3 + k * 0.04, 46);
        b.hit('perc', 'timp', 3, 0.9, 46);
      }
      return;
    }
    // post-victory gentle waltz
    const j = i - 4;
    const bar = PV_CH[j];
    b.melody('flute', 'flute', PV_MEL, 4, 0.75);
    if (j >= 8) b.melodyHits('cel', 'celesta', PV_MEL, 4, 0.3, 12);
    arpBar(b, 'harp', 'harp', bar, 53, 82, 0.5, 'up', 0.4, 1.1);
    for (const [c, s, l] of segs(b, bar)) {
      b.hit('pizz', 'pizz', s, 0.6, bassOf(c, 34));
      const v = voicing(c, 60, 3);
      for (let k = 1; k < l; k++) for (const m of v) b.hit('pizz', 'pizz', s + k, 0.3, m);
    }
    padBar(b, 'pad', 'strings', bar, 65, 3, 0.35, { art: 'legato' });
    if (j % 4 === 0) b.hit('perc', 'bell', 0, 0.06, 82);
  },
};
