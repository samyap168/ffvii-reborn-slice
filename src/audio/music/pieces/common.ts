// Shared accompaniment helpers for compositions.
import type { Bar } from '../piece';
import type { ChanSpec, ChanFx, NoteOpts } from '../instruments';
import { voicing, bassOf, tones, chordsOf } from '../theory';

export const sm = (x: number, a: number, b: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function ch(id: string, stem: string, fx: ChanFx, vol: number, send: number, extra: Partial<ChanSpec> = {}): ChanSpec {
  return { id, stem, fx, vol, send, ...extra };
}

/** Iterate chord segments of a bar: [symbol, startBeat, lengthBeats] */
export function segs(b: Bar, bar: string): [string, number, number][] {
  const cs = chordsOf(bar);
  const len = b.beats / cs.length;
  return cs.map((c, i) => [c, i * len, len]);
}

/** Sustained chord pad for each chord segment of the bar. */
export function padBar(b: Bar, chn: string, inst: string, bar: string, center: number, count: number, vel: number, o: NoteOpts & { legato?: number } = {}): void {
  for (const [c, s, l] of segs(b, bar)) b.note(chn, inst, s, l * (o.legato ?? 1.08), voicing(c, center, count), vel, o);
}
/** Sustained bass note per segment */
export function bassBar(b: Bar, chn: string, inst: string, bar: string, lo: number, vel: number, o: NoteOpts & { legato?: number; octave?: boolean } = {}): void {
  for (const [c, s, l] of segs(b, bar)) {
    const m = bassOf(c, lo);
    b.note(chn, inst, s, l * (o.legato ?? 1.05), o.octave ? [m, m + 12] : m, vel, o);
  }
}
export type ArpShape = 'updown' | 'up' | 'down' | 'roll';
/** Harp/celesta arpeggio across chord tones between lo..hi */
export function arpBar(b: Bar, chn: string, kind: string, bar: string, lo: number, hi: number, step: number, shape: ArpShape, vel: number, accent = 1.2): void {
  for (const [c, s, l] of segs(b, bar)) {
    const T = tones(c, lo, hi);
    if (!T.length) continue;
    const steps = Math.round(l / step);
    const cyc = shape === 'updown' ? [...T, ...T.slice(1, -1).reverse()] : shape === 'down' ? [...T].reverse() : T;
    for (let k = 0; k < steps; k++) {
      let idx = k % cyc.length;
      if (shape === 'roll') idx = Math.min(T.length - 1, k);
      const m = cyc[idx];
      const acc = k === 0 ? accent : 1;
      b.hit(chn, kind, s + k * step, vel * acc * (0.85 + 0.15 * Math.sin(k)), m);
    }
  }
}
/** Repeated note pattern (ostinato) per chord segment; offsets are semitones from the bass */
export function ostBar(b: Bar, chn: string, inst: string, bar: string, lo: number, step: number, offs: number[], vel: number, dur: number, o: NoteOpts = {}, accents: number[] = []): void {
  let k = 0;
  for (const [c, s, l] of segs(b, bar)) {
    const r = bassOf(c, lo);
    const steps = Math.round(l / step);
    for (let j = 0; j < steps; j++, k++) {
      const off = offs[k % offs.length];
      const acc = accents.includes(k % offs.length) ? 1.25 : 1;
      b.note(chn, inst, s + j * step, dur, r + off, vel * acc, o);
    }
  }
}
/** Gallop rhythm (16th-16th-8th) on a chord voicing: "da-da-dum" per beat */
export function gallopBar(b: Bar, chn: string, inst: string, bar: string, center: number, count: number, vel: number, o: NoteOpts = {}): void {
  for (const [c, s, l] of segs(b, bar)) {
    const v = voicing(c, center, count);
    for (let beat = 0; beat < l - 1e-6; beat++) {
      b.note(chn, inst, s + beat, 0.2, v, vel * 0.8, { art: 'stacc', ...o });
      b.note(chn, inst, s + beat + 0.25, 0.2, v, vel * 0.7, { art: 'stacc', ...o });
      b.note(chn, inst, s + beat + 0.5, 0.45, v, vel, { art: 'marc', ...o });
    }
  }
}
/** Voice-led single line through chord tones (horn counter-lines) */
export function counterLine(b: Bar, chn: string, inst: string, bar: string, state: { last: number }, lo: number, hi: number, dur: number, vel: number, o: NoteOpts = {}): void {
  for (const [c, s, l] of segs(b, bar)) {
    const T = tones(c, lo, hi);
    let best = T[0], bd = Infinity;
    for (const m of T) { const d = Math.abs(m - state.last) + (m === state.last ? 1.5 : 0); if (d < bd) { bd = d; best = m; } }
    state.last = best;
    const n = Math.max(1, Math.round(l / dur));
    for (let k = 0; k < n; k++) b.note(chn, inst, s + k * dur, dur * 1.02, best, vel * (k ? 0.85 : 1), o);
  }
}
