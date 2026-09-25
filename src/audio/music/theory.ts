// Music theory helpers: note names, chord symbols, voicings and a compact melody notation.

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#4' -> 61, 'Bb3' -> 58 */
export function note(s: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(s.trim());
  if (!m) throw new Error(`bad note ${s}`);
  let pc = PC[m[1].toUpperCase()];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return pc + (parseInt(m[3], 10) + 1) * 12;
}
export function pcOf(s: string): number {
  const m = /^([A-G])([#b]?)/.exec(s);
  if (!m) throw new Error(`bad pitch class ${s}`);
  let pc = PC[m[1]];
  if (m[2] === '#') pc++; else if (m[2] === 'b') pc--;
  return (pc + 12) % 12;
}

export interface NoteEv { b: number; d: number; m: number[]; v: number }

/**
 * Melody notation: whitespace separated tokens `NOTE:DUR`, `r:DUR` (rest), chords `C4+E4+G4:DUR`.
 * Suffix `!` = accent (vel 1.15), `_` = soft (vel 0.75). `|` bar lines are ignored.
 * DUR in beats; may be a fraction like `1/3`.
 */
export function mel(src: string, start = 0): NoteEv[] {
  const out: NoteEv[] = [];
  let b = start;
  for (let tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    let v = 1;
    if (tok.endsWith('!')) { v = 1.15; tok = tok.slice(0, -1); }
    else if (tok.endsWith('_')) { v = 0.75; tok = tok.slice(0, -1); }
    const [n, ds] = tok.split(':');
    let d = 1;
    if (ds) { if (ds.includes('/')) { const [a, c] = ds.split('/'); d = parseFloat(a) / parseFloat(c); } else d = parseFloat(ds); }
    if (n !== 'r') out.push({ b, d, m: n.split('+').map(note), v });
    b += d;
  }
  return out;
}
/** Total length in beats of a melody string. */
export function melLength(src: string): number {
  const e = mel(src);
  let end = 0;
  let b = 0;
  for (let tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    tok = tok.replace(/[!_]$/, '');
    const ds = tok.split(':')[1];
    let d = 1; if (ds) { if (ds.includes('/')) { const [a, c] = ds.split('/'); d = parseFloat(a) / parseFloat(c); } else d = parseFloat(ds); }
    b += d;
  }
  end = b; void e;
  return end;
}
export function transpose(evs: NoteEv[], semis: number): NoteEv[] {
  return evs.map((e) => ({ ...e, m: e.m.map((x) => x + semis) }));
}

const QUAL: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9], dim: [0, 3, 6], '5': [0, 7], aug: [0, 4, 8], '7b9': [0, 4, 7, 10, 13], '9': [0, 4, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17],
  'add#11': [0, 4, 7, 18], '6/9': [0, 4, 7, 9, 14], mM7: [0, 3, 7, 11],
};
export interface Chord { root: number; iv: number[]; bass: number; sym: string }
const chordCache = new Map<string, Chord>();
export function chord(sym: string): Chord {
  const c = chordCache.get(sym);
  if (c) return c;
  const [main, slash] = sym.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main);
  if (!m) throw new Error(`bad chord ${sym}`);
  const root = pcOf(m[1]);
  const iv = QUAL[m[2]];
  if (!iv) throw new Error(`bad chord quality ${sym}`);
  const res = { root, iv, bass: slash ? pcOf(slash) : root, sym };
  chordCache.set(sym, res);
  return res;
}
/** Close voicing of `count` chord tones whose mean is nearest `center` (midi). */
export function voicing(sym: string, center: number, count: number, skipBass = false): number[] {
  const c = chord(sym);
  const pcs = [...new Set(c.iv.map((i) => (c.root + i) % 12))];
  const use = skipBass && pcs.length > 3 ? pcs.filter((p) => p !== c.bass) : pcs;
  const cand: number[] = [];
  for (let m = center - 24; m <= center + 24; m++) if (use.includes(((m % 12) + 12) % 12)) cand.push(m);
  let best: number[] = [], bd = Infinity;
  for (let i = 0; i + count <= cand.length; i++) {
    const s = cand.slice(i, i + count);
    const mean = s.reduce((a, b) => a + b, 0) / count;
    const dd = Math.abs(mean - center);
    if (dd < bd) { bd = dd; best = s; }
  }
  return best;
}
/** Open (spread) voicing: root-position chord spread over two octaves around center. */
export function spread(sym: string, center: number): number[] {
  const c = chord(sym);
  const base = nearest(c.root, center - 12);
  const res = [base];
  for (const i of c.iv.slice(1)) res.push(base + i + (i < 12 ? 12 : 0));
  return res.sort((a, b) => a - b);
}
export function nearest(pc: number, target: number): number {
  let m = Math.round(target);
  for (let d = 0; d < 12; d++) {
    if ((((m + d) % 12) + 12) % 12 === pc) return m + d;
    if ((((m - d) % 12) + 12) % 12 === pc) return m - d;
  }
  return m;
}
/** Bass note of a chord in [lo, lo+11]. */
export function bassOf(sym: string, lo = 36): number {
  const c = chord(sym);
  let m = lo + ((c.bass - lo) % 12 + 12) % 12;
  return m;
}
export function rootOf(sym: string, lo = 36): number {
  const c = chord(sym);
  return lo + ((c.root - lo) % 12 + 12) % 12;
}
/** chord tones (midi) in a range, ascending */
export function tones(sym: string, lo: number, hi: number): number[] {
  const c = chord(sym);
  const pcs = c.iv.map((i) => (c.root + i) % 12);
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}
/**
 * Progression helper: each bar entry may hold several chord symbols separated by spaces,
 * which split the bar evenly.
 */
export function chordAt(bar: string, beat: number, beats: number): string {
  const parts = bar.trim().split(/\s+/);
  const idx = Math.min(parts.length - 1, Math.floor((beat / beats) * parts.length + 1e-6));
  return parts[idx];
}
export function chordsOf(bar: string): string[] { return bar.trim().split(/\s+/); }
