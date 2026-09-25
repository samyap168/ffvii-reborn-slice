// Knights of the Round summon score, driven by cues (all original compositions). D minor -> D major.
import type { PieceDef } from '../piece';
import { mel, bassOf, voicing, tones, chordsOf } from '../theory';
import { ch, sm, padBar, bassBar, arpBar, segs } from './common';

const DMIN_BELLS = [62, 65, 69, 72, 74, 77, 81];

export const KOR_BEGIN: PieceDef = {
  name: 'kor_begin', bpm: 60, bars: 4, loopTo: 0, fadeIn: 1.5, space: 'cathedral',
  channels: [
    ch('drone', 'all', 'none', 0.6, 0.4),
    ch('choirL', 'all', 'choir', 0.45, 0.7, { formantShift: 0.88 }),
    ch('choirH', 'all', 'choir', 0.4, 0.75, { formantShift: 1.1 }),
    ch('bells', 'all', 'none', 0.45, 0.8),
    ch('fx', 'all', 'none', 0.6, 0.6),
  ],
  warm: [['bell', DMIN_BELLS]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const i = b.i;
    const C = ['Dm', 'Dm', 'Bb', 'A'][i];
    b.note('drone', 'drone', 0, 4.4, [26, 38], 0.75, { bright: 0.7 });
    b.note('drone', 'drone', 0, 4.4, bassOf(C, 45), 0.35, { bright: 0.9 });
    if (i === 0 && b.loop === 0) { b.hit('fx', 'gong', 0, 0.5); b.vowel('choirL', 'u', 0, 0.1); b.vowel('choirH', 'o', 0, 0.1); }
    if (i === 2) { b.vowel('choirL', 'o', 0, 2); b.vowel('choirH', 'a', 0, 2); }
    if (i === 0 && b.loop > 0) { b.vowel('choirL', 'u', 0, 3); b.vowel('choirH', 'o', 0, 3); }
    b.note('choirL', 'choir', 0, 4.3, voicing(C, 52, 3), 0.55 + 0.1 * b.loop, { art: 'swell' });
    if (i > 0 || b.loop > 0) b.note('choirH', 'choir', 0, 4.3, voicing(C, 67, 3), 0.5 + 0.08 * i, { art: 'swell' });
    const r = b.p.env.rnd;
    for (let k = 0; k < 2; k++) b.hit('bells', 'bell', Math.floor(r() * 4) + 0.5 * k, 0.2 + r() * 0.1, DMIN_BELLS[Math.floor(r() * DMIN_BELLS.length)]);
    if (i === 3) b.revCym('fx', 4, 0.3);
  },
};

export const KOR_STRUCTURE: PieceDef = {
  name: 'kor_structure', bpm: 60, bars: 4, loopTo: 0, fadeIn: 0.4, space: 'cathedral',
  channels: [
    ch('drone', 'all', 'none', 0.55, 0.4),
    ch('organ', 'all', 'none', 0.55, 0.7),
    ch('brass', 'all', 'brass', 0.6, 0.55),
    ch('tpt', 'high', 'brass', 0.45, 0.55),
    ch('choir', 'all', 'choir', 0.45, 0.7),
    ch('perc', 'all', 'perc', 0.8, 0.45),
    ch('low', 'all', 'strings', 0.5, 0.4),
  ],
  warm: [['timp', [38, 45]]],
  stems: (I, bar, loop) => ({ all: 1, high: sm(loop + bar / 4 + I, 0.8, 1.6) }),
  bar(b) {
    const i = b.i; const L = b.loop;
    const C = ['Dm', 'Bb', 'Gm', 'A'][i];
    const g = Math.min(1, 0.6 + L * 0.15);
    b.note('drone', 'drone', 0, 4.4, [26, 38], 0.7);
    const org = [bassOf(C, 38), ...voicing(C, 57, 3), ...voicing(C, 69, 3)];
    b.note('organ', 'organ', 0, 4.2, org, 0.7 * g, { art: i === 0 && L === 0 ? 'swell' : undefined });
    b.note('brass', 'brass', 0, 4.1, [bassOf(C, 38), ...voicing(C, 55, 4)], 0.85 * g, { art: 'swell' });
    b.note('tpt', 'brass', 1, 3.1, voicing(C, 72, 3), 0.8, { art: 'swell', bright: 1.2 });
    if (i === 0) b.vowel('choir', 'a', 0, 1);
    b.note('choir', 'choir', 0, 4.3, voicing(C, 64, 4), 0.75 * g, { art: i === 0 ? 'swell' : 'sus' });
    b.note('low', 'strings', 0, 4.2, [bassOf(C, 38), bassOf(C, 38) - 12], 0.7, { art: 'legato' });
    b.hit('perc', 'bassdrum', 0, 0.55 * g); b.hit('perc', 'timp', 0, 0.7 * g, bassOf(C, 38));
    if (i === 3) { for (let k = 0; k < 16; k++) b.hit('perc', 'timp', k * 0.25, 0.15 + k * 0.045, 45); b.revCym('perc', 4, 0.45); }
    if (i === 0 && L > 0) b.hit('perc', 'crash', 0, 0.4, L % 2);
  },
};

export const KOR_PORTAL: PieceDef = {
  name: 'kor_portal', bpm: 60, bars: 2, loopTo: 0, fadeIn: 0.05, space: 'cathedral',
  channels: [
    ch('drone', 'all', 'none', 0.55, 0.4),
    ch('choirL', 'all', 'choir', 0.5, 0.7, { formantShift: 0.9 }),
    ch('choirH', 'all', 'choir', 0.5, 0.75, { formantShift: 1.12 }),
    ch('str', 'all', 'strings', 0.4, 0.7),
    ch('bells', 'all', 'none', 0.4, 0.8),
    ch('shim', 'all', 'none', 0.4, 0.8),
  ],
  warm: [['bell', [74, 78, 81, 86]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const C = b.i === 0 ? 'Dadd9' : 'Dsus2';
    if (b.i === 0 && b.loop === 0) { b.vowel('choirL', 'a', 0, 0.1); b.vowel('choirH', 'a', 0, 0.1); }
    b.note('drone', 'drone', 0, 4.4, [26, 38, 45], 0.7, { bright: 1.1 });
    b.note('choirL', 'choir', 0, 4.4, voicing(C, 55, 4), 0.85);
    b.note('choirH', 'choir', 0, 4.4, voicing(C, 72, 4), 0.75);
    b.note('str', 'strings', 0, 4.3, [86, 93], 0.5, { art: 'trem' });
    b.note('shim', 'shimmer', 0, 4.4, [90, 97], 0.4);
    b.hit('bells', 'bell', 0, 0.3, [74, 78, 81, 86][(b.i + b.loop) % 4]);
    b.hit('bells', 'bell', 2, 0.2, [81, 86, 78, 74][(b.i + b.loop) % 4]);
  },
};

// the knights' march (140 bpm)
const KN_CHORDS = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A', 'Bb', 'C', 'Dm', 'Bb', 'Gm', 'A', 'Dm', 'A7'];
const KN_MEL = mel('A4:1.5 D5:.5 F5:1 E5:.5 D5:.5 | E5:1 F5:1 A4:2 | Bb4:1.5 D5:.5 F5:1 G5:1 | E5:1.5 D5:.5 C5:1 E5:1 | F5:1.5 E5:.5 D5:1 A5:1 | G5:1 F5:.5 E5:.5 F5:2 | Bb5:1.5 A5:.5 G5:1 D5:1 | C#5:2 E5:1 A5:1 | D6:2! Bb5:1 F5:1 | C6:2 G5:1 E5:1 | A5:1.5 F5:.5 D5:1 F5:1 | F5:2 D5:1 Bb4:1 | G5:1.5 A5:.5 Bb5:1 D6:1 | C#6:2 A5:2 | D6:3! A5:1 | G5:1 E5:1 C#5:1 A4:1');
const SNARE_MARCH = [0, 0.5, 0.75, 1, 1.5, 2, 2.5, 2.75, 3, 3.5];

export const KOR_KNIGHTS: PieceDef = {
  name: 'kor_knights', bpm: 140, bars: 16, loopTo: 0, stemTc: 0.8, fadeIn: 0.02, space: 'cathedral',
  channels: [
    ch('ost', 'ost', 'ens', 0.55, 0.3),
    ch('bass', 'ost', 'none', 0.5, 0.05),
    ch('choir', 'choir', 'choir', 0.6, 0.55),
    ch('choirLo', 'choir', 'choir', 0.45, 0.5, { formantShift: 0.88 }),
    ch('brass', 'brass', 'brass', 0.55, 0.45, { pan: -0.15 }),
    ch('horns', 'ost', 'brass', 0.45, 0.45, { pan: 0.2 }),
    ch('str16', 'str', 'ens', 0.35, 0.35),
    ch('drums', 'drums', 'perc', 0.85, 0.3),
    ch('perc2', 'perc2', 'perc', 0.7, 0.3),
    ch('glock', 'glock', 'none', 0.3, 0.5),
    ch('hi', 'hi', 'strings', 0.35, 0.45, { vib: 5 }),
  ],
  warm: [['timp', [38, 41, 43, 45, 46, 48]], ['glock', [81, 82, 84, 86, 88, 89, 91, 93, 94, 96, 98]]],
  stems: (I, bar, loop, n) => {
    const E = Math.max(I, Math.min(1, n / 40));
    return { ost: 1, choir: 1, drums: 0.8 + 0.2 * E, brass: 0.45 + 0.55 * sm(E, 0, 0.4), str: sm(E, 0.05, 0.4), perc2: sm(E, 0.35, 0.75), glock: sm(E, 0.6, 1), hi: sm(E, 0.5, 0.9) };
  },
  bar(b) {
    const i = b.i;
    const bar = KN_CHORDS[i];
    const c0 = chordsOf(bar)[0];
    const r = bassOf(c0, 38);
    if (i === 0) { b.vowel('choir', 'a', 0, 0.1); b.vowel('choirLo', 'o', 0, 0.1); }
    // 8th-note low string drive + bass
    for (let k = 0; k < 8; k++) {
      const off = [0, 0, 12, 0, 7, 0, 12, 7][k];
      b.note('ost', 'strings', k * 0.5, 0.42, [r + off - 12, r + off], k % 2 ? 0.55 : 0.72, { art: 'marc' });
      b.note('bass', 'bass', k * 0.5, 0.4, r - 12 + (off === 7 ? 7 : 0), 0.7);
    }
    b.note('horns', 'horn', 0, 4, voicing(c0, 57, 3), 0.6, { art: 'sus' });
    // choir + brass melody
    b.melody('choir', 'choir', KN_MEL, 0, 0.9, { art: 'sus' });
    b.note('choirLo', 'choir', 0, 4.05, voicing(c0, 55, 3), 0.6);
    b.melody('brass', 'brass', KN_MEL, 0, 0.85, { art: 'sus' }, 0);
    b.melody('brass', 'horn', KN_MEL, 0, 0.7, { art: 'sus' }, -12);
    // strings 16ths
    const T = tones(c0, 62, 86);
    for (let k = 0; k < 16; k++) b.note('str16', 'strings', k * 0.25, 0.2, T[Math.min(T.length - 1, [0, 2, 1, 3][k % 4] + (k >> 3))], k % 4 ? 0.4 : 0.55, { art: 'stacc' });
    // high string counter-line (sustained)
    b.note('hi', 'strings', 0, 4.05, voicing(c0, 84, 2), 0.5, { art: 'legato' });
    b.melodyHits('glock', 'glock', KN_MEL, 0, 0.35, 12);
    // march percussion
    SNARE_MARCH.forEach((p, k) => b.hit('drums', 'snare', p, k % 5 === 0 ? 0.65 : 0.4, k % 3));
    b.hit('drums', 'taiko', 0, 0.85, 0); b.hit('drums', 'taiko', 2, 0.75, 1);
    b.hit('drums', 'timp', 0, 0.75, Math.max(38, Math.min(50, r))); b.hit('drums', 'timp', 2, 0.55, Math.max(38, Math.min(50, r + 7 > 50 ? r - 5 : r + 7)));
    if (i % 4 === 0) { b.hit('drums', 'crash', 0, 0.45, (i / 4) % 2); b.hit('drums', 'bassdrum', 0, 0.6); }
    if (i % 4 === 3) for (let k = 0; k < 8; k++) b.hit('drums', 'tom', 2 + k * 0.25, 0.35 + k * 0.06, 2 - Math.floor(k / 3));
    for (let k = 0; k < 4; k++) b.hit('perc2', 'taiko', k + 0.5, 0.45, 3 + (k % 3));
    if (i % 2 === 1) b.hit('perc2', 'crash', 0, 0.3, 1);
    for (const p of [1.5, 3.5]) b.note('perc2', 'brass', p, 0.3, voicing(c0, 64, 3), 0.7, { art: 'stab' });
    b.hit('perc2', 'anvil', 3, 0.1, 0);
  },
};

export const KOR_CHARGE: PieceDef = {
  name: 'kor_final_charge', bpm: 128, bars: 5, loopTo: 4, fadeIn: 0.02, space: 'cathedral',
  channels: [
    ch('str', 'all', 'strings', 0.55, 0.5),
    ch('brass', 'all', 'brass', 0.6, 0.5),
    ch('choir', 'all', 'choir', 0.55, 0.6),
    ch('perc', 'all', 'perc', 0.85, 0.4),
    ch('low', 'all', 'none', 0.6, 0.3),
    ch('fx', 'all', 'none', 0.6, 0.6),
    ch('shim', 'all', 'none', 0.4, 0.7),
  ],
  warm: [['timp', [38, 45]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const i = b.i;
    const spb = b.spb;
    if (i === 0) {
      const beats = 16; // 4 bars of riser (~7.5 s)
      b.vowel('choir', 'o', 0, 0.1); b.vowel('choir', 'a', 8, 4);
      b.note('str', 'strings', 0, beats, [50, 57, 62, 65, 69, 74, 77], 0.9, { art: 'swell', rise: 12 });
      b.note('brass', 'brass', 0, beats, [38, 50, 57, 62, 65], 0.9, { art: 'swell', rise: 7 });
      b.note('choir', 'choir', 0, beats, [57, 62, 65, 69, 74], 0.9, { art: 'swell', rise: 12 });
      b.note('low', 'drone', 0, beats + 0.5, [26, 38], 0.9, { bright: 1.5 });
      b.note('shim', 'shimmer', 0, beats, [86, 93, 98], 0.5, { glide: 12 });
      b.swell('fx', 0, beats, 0.9, 200, 11000);
      b.revCym('fx', beats, 0.7);
      // accelerating snare + timpani roll
      let t = 0; let k = 0;
      while (t < beats - 0.05) {
        const u = t / beats;
        b.hit('perc', 'snare', t, 0.2 + 0.6 * u, k % 3, { hum: 0.002 });
        if (k % 2 === 0) b.hit('perc', 'timp', t, 0.15 + 0.7 * u, 38, { hum: 0.002 });
        t += Math.max(0.0625, 0.5 * Math.pow(1 - u, 1.6)); k++;
      }
      for (let q = 0; q < 4; q++) b.hit('perc', 'taiko', q * 4, 0.5 + q * 0.12, 0);
      void spb;
      return;
    }
    if (i < 4) return; // riser still sounding
    // plateau at the top: sustained, trembling, rolling
    b.note('str', 'strings', 0, 4.1, [62, 69, 74, 77, 81, 86], 0.9, { art: 'trem', bright: 1.4 });
    b.note('brass', 'brass', 0, 4.1, [45, 57, 62, 69, 74], 0.9, { art: 'sus', bright: 1.3 });
    b.note('choir', 'choir', 0, 4.1, [69, 74, 77, 81], 0.9);
    b.note('low', 'drone', 0, 4.4, [26, 38], 0.9, { bright: 1.5 });
    b.note('shim', 'shimmer', 0, 4.2, [98, 105], 0.5);
    for (let k = 0; k < 32; k++) b.hit('perc', 'snare', k * 0.125, 0.6 + 0.1 * (k % 2), k % 3, { hum: 0.002 });
    for (let k = 0; k < 16; k++) b.hit('perc', 'timp', k * 0.25, 0.75, 38, { hum: 0.002 });
  },
};

// after the impact: slow, awe-struck resolution ending in a sustained chord
const RS_CHORDS = ['D A/C#', 'Bm7 Gmaj7', 'G/B Asus4', 'Bbadd9 Cadd9', 'Dadd9'];
const RS_MEL = mel('F#5:2 E5:2 | D5:2 F#5:2 | G5:2 E5:1 D5:1 | F5:2 G5:2');
export const KOR_RESOLVE: PieceDef = {
  name: 'kor_resolve', bpm: (bar, loop) => (bar < 4 ? 54 - (bar === 3 ? 4 : 0) : 46), meter: (bar) => (bar < 4 ? 4 : 8), bars: 5, loopTo: 4, fadeIn: 2.5, space: 'cathedral',
  channels: [
    ch('pad', 'all', 'strings', 0.5, 0.65),
    ch('bass', 'all', 'strings', 0.5, 0.5),
    ch('vln', 'all', 'strings', 0.45, 0.7, { vib: 6 }),
    ch('choir', 'all', 'choir', 0.45, 0.75),
    ch('horn', 'all', 'brass', 0.4, 0.6),
    ch('harp', 'all', 'none', 0.55, 0.6),
    ch('cel', 'all', 'none', 0.35, 0.75),
    ch('perc', 'all', 'none', 0.55, 0.6),
  ],
  warm: [['harp', [50, 54, 57, 59, 61, 62, 64, 66, 67, 69, 71, 73, 74, 76, 78]], ['celesta', [74, 76, 78, 81, 86, 88, 90]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const i = b.i; const L = b.loop;
    const bar = RS_CHORDS[i];
    if (i < 4) {
      if (i === 0) b.vowel('choir', 'o', 0, 0.1);
      if (i === 2) b.vowel('choir', 'a', 0, 4);
      padBar(b, 'pad', 'strings', bar, 62, 4, 0.35 + i * 0.1, { art: 'legato', release: 1.5 });
      bassBar(b, 'bass', 'strings', bar, 38, 0.45 + i * 0.08, { art: 'legato', octave: true });
      padBar(b, 'choir', 'choir', bar, 60, 3, 0.4 + i * 0.12, { release: 1.5 });
      b.melody('vln', 'strings', RS_MEL, 0, 0.55 + i * 0.08, { art: 'legato', release: 1.2 });
      if (i >= 2) b.melody('horn', 'horn', RS_MEL, 0, 0.55, { art: 'sus' }, -12);
      arpBar(b, 'harp', 'harp', bar, 50, 78, 1, 'up', 0.35);
      if (i === 3) { for (let k = 0; k < 12; k++) b.hit('perc', 'timp', 1 + k * 0.25, 0.08 + k * 0.03, 38); b.hit('perc', 'crash', 3.5, 0.12, 1); }
      return;
    }
    // final sustained chord (loops with gentle re-voicing)
    const alt = L % 2 === 1;
    const V = alt ? [50, 57, 64, 66, 69, 74] : [50, 57, 62, 66, 69, 76];
    b.note('vln', 'strings', 0, 8.6, 78, L === 0 ? 0.7 : 0.45, { art: 'legato', release: 3 });
    b.note('pad', 'strings', 0, 8.6, V, 0.45, { art: 'legato', release: 3 });
    b.note('bass', 'strings', 0, 8.6, [26, 38], 0.5, { art: 'legato', release: 3 });
    b.note('choir', 'choir', 0, 8.6, alt ? [62, 66, 69, 76] : [62, 66, 69, 74], 0.6, { release: 3 });
    if (L === 0) { b.hit('perc', 'bell', 0, 0.25, 74); b.hit('perc', 'timp', 0, 0.3, 38); }
    [0, 1.5, 3, 5].forEach((beat, k) => b.hit('cel', 'celesta', beat + (L % 2) * 0.5, 0.25 - k * 0.03, [86, 81, 78, 90][(k + L) % 4]));
  },
};
export { padBar, bassBar, arpBar, segs };
