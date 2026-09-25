// Title, exploration (original adventure theme) and aftermath music.
// All melodies are original compositions.
import type { PieceDef, Bar } from '../piece';
import { mel, transpose, bassOf, voicing, tones, rootOf } from '../theory';
import { ch, sm, padBar, bassBar, arpBar, gallopBar, counterLine, segs } from './common';

// ------------------------------------------------------------------ EXPLORE
// D major, 96 bpm, 48 bars (~2 minutes): Intro | A | A' | B | B' (lift) | A'' (up a tone, E) | Outro
const EX_CHORDS = [
  'D', 'Gmaj7/D', 'D', 'Asus4 A',
  'D', 'F#m/C#', 'Bm', 'Bm/A', 'G', 'D/F#', 'Em7', 'A7sus4 A7',
  'D', 'F#m/C#', 'Bm', 'Bm/A', 'G', 'Gm/Bb', 'D/A A', 'D',
  'Bm', 'G', 'D', 'A/C#', 'Bm', 'G', 'Em7', 'F#sus4 F#',
  'Bm7', 'E/G#', 'A', 'B', 'G#m', 'C#m', 'A', 'Bsus4 B',
  'E', 'G#m/D#', 'C#m', 'C#m/B', 'A', 'Am/C', 'E/B B', 'E',
  'Cmaj7', 'D', 'G', 'Asus4 A',
];
const EX_A = mel('A4:1.5 D5:.5 E5:1 F#5:1 | E5:2 C#5:1 A4:1 | B4:1.5 C#5:.5 D5:1 F#5:1 | E5:3 F#5:.5 G5:.5 | A5:2 G5:1 F#5:1 | F#5:1.5 E5:.5 D5:2 | G5:1 F#5:1 E5:1 D5:1 | E5:3 r:1');
const EX_A2 = mel('A4:1.5 D5:.5 E5:1 F#5:1 | A5:1.5 F#5:.5 E5:1 C#5:1 | D5:1.5 E5:.5 F#5:1 B5:1 | A5:3 B5:.5 C#6:.5 | D6:2! B5:1 G5:1 | Bb5:2 A5:1 G5:1 | F#5:1.5 A5:.5 E5:1.5 D5:.5 | D5:4');
const EX_B = mel('F#5:1 D5:.5 B4:.5 F#5:1 G5:1 | A5:1.5 G5:.5 F#5:1 D5:1 | E5:1 F#5:.5 E5:.5 D5:1 A4:1 | C#5:2 E5:2 | F#5:1 D5:.5 B4:.5 F#5:1 B5:1 | A5:1.5 G5:.5 F#5:1 G5:1 | E5:1.5 F#5:.5 G5:1 B5:1 | B5:2 A#5:1 C#6:1');
const EX_B2 = mel('D5:1.5 E5:.5 F#5:1 A5:1 | G#5:2 E5:1 B4:1 | C#5:1.5 E5:.5 A5:1 C#6:1 | B5:2 A5:1 F#5:1 | G#5:1.5 F#5:.5 G#5:1 B5:1 | C#6:2! B5:1 G#5:1 | A5:1.5 G#5:.5 F#5:1 E5:1 | F#5:1 E5:1 D#5:2');
const EX_A3 = transpose(EX_A2, 2);
// bouncy "riding" counter-melody rhythm (16th positions) and tone-index contour
const BOUNCE_POS = [0, 2, 3, 4, 6, 8, 10, 11, 12, 14];
const BOUNCE_IDX = [0, 2, 1, 3, 2, 4, 3, 2, 5, 3];

function exploreMelody(b: Bar, chn: string, inst: string, vel: number, semis = 0, o = {}): void {
  b.melody(chn, inst, EX_A, 4, vel, o, semis);
  b.melody(chn, inst, EX_A2, 12, vel, o, semis);
  b.melody(chn, inst, EX_B, 20, vel, o, semis);
  b.melody(chn, inst, EX_B2, 28, vel, o, semis);
  b.melody(chn, inst, EX_A3, 36, vel, o, semis);
}
const hornState = { last: 62 };

export const EXPLORE: PieceDef = {
  name: 'explore', bpm: 96, bars: 48, loopTo: 0, stemTc: 1.1, fadeIn: 2.5,
  channels: [
    ch('pad', 'pad', 'strings', 0.55, 0.45),
    ch('bass', 'pad', 'strings', 0.55, 0.3),
    ch('harp', 'harp', 'none', 0.7, 0.4, { pan: -0.15 }),
    ch('flute', 'melody', 'none', 0.62, 0.45, { pan: 0.08 }),
    ch('vln', 'ride_mel', 'strings', 0.5, 0.4, { vib: 6 }),
    ch('rstr', 'ride_str', 'ens', 0.45, 0.3),
    ch('low', 'ride_str', 'ens', 0.55, 0.25),
    ch('horns', 'horns', 'brass', 0.5, 0.45, { pan: -0.25 }),
    ch('bounce', 'counter', 'none', 0.5, 0.3, { pan: 0.3 }),
    ch('perc', 'ride_perc', 'perc', 0.7, 0.25),
  ],
  warm: [['harp', [50, 52, 54, 55, 57, 59, 61, 62, 64, 66, 67, 69, 71, 73, 74, 76, 78, 79, 81]], ['pizz', [50, 52, 54, 55, 57, 59, 61, 62, 64, 66, 67, 69, 71, 73, 74, 76]], ['glock', [74, 76, 78, 79, 81, 83, 85, 86, 88]]],
  stems: (I) => ({
    pad: 0.85 + 0.15 * I, melody: 1, harp: 1 - 0.45 * I,
    ride_str: sm(I, 0.1, 0.6), ride_perc: sm(I, 0.3, 0.8), horns: sm(I, 0.35, 0.9), counter: sm(I, 0.2, 0.7), ride_mel: sm(I, 0.55, 1),
  }),
  bar(b) {
    const bar = EX_CHORDS[b.i];
    const sect = b.i < 4 ? 'intro' : b.i < 12 ? 'A' : b.i < 20 ? 'A2' : b.i < 28 ? 'B' : b.i < 36 ? 'B2' : b.i < 44 ? 'A3' : 'outro';
    const lift = sect === 'B2' || sect === 'A3' ? 1.15 : 1;
    // strings pad + bass
    padBar(b, 'pad', 'strings', bar, 62, 4, 0.5 * lift, { art: 'legato' });
    bassBar(b, 'bass', 'strings', bar, 38, 0.55, { art: 'legato', octave: true });
    // harp rolling eighths
    arpBar(b, 'harp', 'harp', bar, 50, 81, 0.5, 'updown', 0.55);
    // lead
    exploreMelody(b, 'flute', 'flute', 0.85);
    if (sect === 'intro' && b.i >= 2) {
      // a hint on celesta-like harp harmonics
      for (const [c, s] of segs(b, bar)) b.hit('harp', 'celesta', s + 1.5, 0.25, voicing(c, 79, 1)[0]);
    }
    // --- riding layers
    exploreMelody(b, 'vln', 'strings', 0.7, -12, { art: 'legato' });
    gallopBar(b, 'rstr', 'strings', bar, 57, 3, 0.55 * lift);
    for (const [c, s, l] of segs(b, bar)) {
      const r = bassOf(c, 38);
      for (let k = 0; k < l * 2; k++) b.note('low', 'strings', s + k * 0.5, 0.35, [r, r - 12], k % 2 ? 0.45 : 0.62, { art: 'marc' });
    }
    counterLine(b, 'horns', 'horn', bar, hornState, 55, 69, 2, 0.6 * lift, { art: 'sus' });
    // bouncy counter-melody (pizz + glock sparkle)
    for (const [c, s, l] of segs(b, bar)) {
      const T = tones(c, 62, 86);
      const count = Math.round(l * 4);
      BOUNCE_POS.forEach((p, k) => {
        if (p >= count) return;
        const m = T[Math.min(T.length - 1, BOUNCE_IDX[k] + (b.i % 2) )];
        b.hit('bounce', 'pizz', s + p * 0.25, 0.5 * (k % 3 === 0 ? 1.2 : 0.9), m);
        if (k % 3 === 0) b.hit('bounce', 'glock', s + p * 0.25, 0.12, m + 12);
      });
    }
    // percussion
    const phraseEnd = b.i % 4 === 3;
    b.hit('perc', 'timp', 0, 0.5, Math.max(40, Math.min(52, rootOf(bar.split(' ')[0], 40))));
    b.hit('perc', 'taiko', 0, 0.35, 3); b.hit('perc', 'taiko', 2, 0.25, 4);
    b.hit('perc', 'taiko', 1.75, 0.18, 4); b.hit('perc', 'taiko', 3.75, 0.18, 5);
    b.hit('perc', 'snare', 1, 0.16, 0); b.hit('perc', 'snare', 3, 0.18, 1);
    for (let k = 0; k < 16; k++) b.hit('perc', 'shaker', k * 0.25, k % 4 === 0 ? 0.2 : k % 2 ? 0.1 : 0.14, k % 3);
    if (phraseEnd) for (let k = 0; k < 4; k++) b.hit('perc', 'tom', 3 + k * 0.25, 0.3 + k * 0.06, 2 - Math.floor(k * 0.75));
    if (b.i % 8 === 4 || b.i === 0) b.hit('perc', 'crash', 0, 0.25, b.i % 2);
  },
};

// ------------------------------------------------------------------ TITLE
const TI_CHORDS = ['Dmaj7', 'Dmaj7', 'Bm7', 'Bm7', 'Gmaj7', 'Gmaj7', 'Em7', 'A7sus4', 'Dmaj7', 'F#m7', 'Bm7', 'Bm7/A', 'Gmaj7', 'Gm6', 'D/A', 'Asus4 A'];
const TI_MEL = mel('A4:1.5 D5:.5 E5:1 F#5:1 | E5:2 C#5:1 A4:1 | B4:1.5 C#5:.5 D5:1 F#5:1 | E5:4');
export const TITLE: PieceDef = {
  name: 'title', bpm: 66, bars: 16, loopTo: 0, fadeIn: 2,
  channels: [
    ch('harp', 'all', 'none', 1.3, 0.5),
    ch('pad', 'all', 'strings', 0.7, 0.55),
    ch('bass', 'all', 'strings', 0.7, 0.4),
    ch('lead', 'all', 'none', 0.85, 0.55),
    ch('bells', 'all', 'none', 0.5, 0.6),
  ],
  warm: [['harp', [38, 42, 45, 47, 50, 54, 57, 59, 61, 62, 64, 66, 69, 71, 73, 74, 76, 78, 81, 83, 85, 86]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const bar = TI_CHORDS[b.i];
    arpBar(b, 'harp', 'harp', bar, 45, 86, 0.5, 'updown', 0.5);
    padBar(b, 'pad', 'strings', bar, 64, 4, 0.35, { art: 'legato', release: 1.2 });
    bassBar(b, 'bass', 'strings', bar, 38, 0.4, { art: 'legato' });
    if (b.i >= 8 && b.i < 12) b.melody('lead', 'flute', TI_MEL, 8, 0.6);
    if (b.i >= 8 && b.i < 12) b.melodyHits('bells', 'celesta', TI_MEL, 8, 0.35, 12);
    if (b.i % 4 === 3) b.hit('bells', 'bell', 2, 0.12, 86);
  },
};

// ------------------------------------------------------------------ AFTERMATH
const AF_CHORDS = ['Dadd9', 'Bm7', 'Gmaj7', 'Asus4', 'Dadd9', 'F#m7', 'Gmaj7', 'Em7 A7sus4'];
const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93];
export const AFTERMATH: PieceDef = {
  name: 'aftermath', bpm: 52, bars: 8, loopTo: 0, fadeIn: 4, space: 'cathedral',
  channels: [
    ch('choir', 'all', 'choir', 0.4, 0.6, { formantShift: 0.95 }),
    ch('pad', 'all', 'strings', 0.3, 0.6),
    ch('syn', 'all', 'none', 0.5, 0.5),
    ch('bells', 'all', 'none', 0.4, 0.7),
    ch('piano', 'all', 'none', 0.45, 0.6),
  ],
  warm: [['bell', [74, 76, 78, 81, 83, 86]], ['celesta', PENTA], ['piano', [50, 54, 57, 62, 66, 69]]],
  stems: () => ({ all: 1 }),
  bar(b) {
    const bar = AF_CHORDS[b.i];
    if (b.i === 0) b.vowel('choir', 'u', 0, 1);
    padBar(b, 'choir', 'choir', bar, 60, 3, 0.4, { legato: 1.15, release: 2 });
    padBar(b, 'pad', 'strings', bar, 67, 3, 0.25, { art: 'legato', release: 2 });
    for (const [c, s, l] of segs(b, bar)) b.note('syn', 'pad', s, l * 1.1, [bassOf(c, 38), bassOf(c, 38) + 12], 0.45);
    const r = b.p.env.rnd;
    const count = 1 + Math.floor(r() * 2.2);
    for (let k = 0; k < count; k++) b.hit('bells', r() < 0.6 ? 'celesta' : 'bell', Math.floor(r() * 8) / 2, 0.15 + r() * 0.12, PENTA[Math.floor(r() * PENTA.length)]);
    if (b.i % 2 === 0) b.hit('piano', 'piano', 0.5, 0.25, voicing(bar.split(' ')[0], 62, 1)[0]);
  },
};
