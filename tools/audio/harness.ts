// Test harness: live preview UI + offline rendering entry points used by render.mjs.
import { AudioSystem, Engine, SOUND_NAMES, LOOP_NAMES, MUSIC_CUES } from '/src/audio/index.ts';
import type { PlayOpts, MusicState } from '/src/audio/index.ts';

const SR = 48000;
const STATES: MusicState[] = ['title', 'explore', 'encounter', 'battle', 'boss', 'enrage', 'limit', 'kor', 'victory', 'aftermath', 'silence'];

// ------------------------------------------------------------------ analysis
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len; const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export interface Stats { momDb: number; peak: number; peakDb: number; rmsDb: number; activeRmsDb: number; centroid: number; dc: number; clip: number; nan: number; silent: boolean; dur: number; clicks: number }
function analyse(buf: AudioBuffer): Stats {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  let peak = 0, sum = 0, dc = 0, clip = 0, nan = 0;
  const n = L.length;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    if (!isFinite(a) || !isFinite(b)) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m > 0.99) clip++;
    sum += (a * a + b * b) / 2; dc += (a + b) / 2;
  }
  // active RMS: blocks of 50ms above -60 dBFS
  const blk = Math.round(0.05 * buf.sampleRate); let asum = 0, acount = 0;
  for (let s = 0; s + blk <= n; s += blk) {
    let e = 0; for (let i = s; i < s + blk; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2;
    e /= blk; if (e > 1e-6) { asum += e; acount++; }
  }
  // max momentary loudness (400 ms window, 100 ms hop)
  const win = Math.round(0.4 * buf.sampleRate), hop = Math.round(0.1 * buf.sampleRate);
  let mom = 0;
  for (let s = 0; s + win <= n; s += hop) {
    let e = 0; for (let i = s; i < s + win; i += 2) e += (L[i] * L[i] + R[i] * R[i]);
    e /= win; if (e > mom) mom = e;
  }
  // crude click detector: large sample-to-sample jumps relative to local level
  let clicks = 0;
  for (let i = 2; i < n; i++) {
    const d2 = Math.abs(L[i] - 2 * L[i - 1] + L[i - 2]);
    if (d2 > 0.5) clicks++;
  }
  // spectral centroid
  const N = 2048; let cw = 0, ew = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= n; s += 4096) {
    let e = 0;
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re[i] = (L[s + i] + R[s + i]) * 0.5 * w; im[i] = 0; e += re[i] * re[i]; }
    if (e < 1e-8) continue;
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * k * buf.sampleRate / N; den += m; }
    if (den > 0) { cw += (num / den) * e; ew += e; }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return {
    momDb: 10 * Math.log10(Math.max(1e-12, mom)), peak, peakDb: 20 * Math.log10(Math.max(1e-9, peak)), rmsDb: 20 * Math.log10(Math.max(1e-9, rms)),
    activeRmsDb: acount ? 10 * Math.log10(asum / acount) : -120, centroid: ew ? cw / ew : 0, dc: dc / Math.max(1, n),
    clip, nan, silent: peak < 1e-4, dur: buf.duration, clicks,
  };
}
function wavB64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels, n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i] || 0)); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  const bytes = new Uint8Array(data.buffer);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

// ------------------------------------------------------------------ offline render drivers
type Action = { t: number; do: (e: Engine) => void };
async function renderScript(dur: number, actions: Action[], opts: { wav?: boolean; update?: boolean } = {}): Promise<{ stats: Stats; wav?: string; ms: number; info: Record<string, unknown> }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const t0 = performance.now();
  const eng = new Engine(ctx, { offline: true });
  const info: Record<string, unknown> = { engineMs: Math.round(performance.now() - t0) };
  const step = 0.05;
  const queue = [...actions].sort((a, b) => a.t - b.t);
  let maxVoices = 0;
  const run = (t: number): void => {
    while (queue.length && queue[0].t <= t + 1e-6) queue.shift()!.do(eng);
    if (opts.update) eng.update(step, { windStrength: 0.4, playerSpeed: 0, inCombat: false, weather: 0, nearWater: 0, timeScale: 1 });
    eng.tick();
    maxVoices = Math.max(maxVoices, eng.activeVoices);
  };
  run(0);
  let t = step;
  const sched = (): void => {
    if (t >= dur - 0.01) return;
    const tt = t;
    ctx.suspend(tt).then(() => { run(tt); t = tt + step; sched(); void ctx.resume(); });
  };
  sched();
  const tr = performance.now();
  const buf = await ctx.startRendering();
  info.renderMs = Math.round(performance.now() - tr);
  info.maxVoices = maxVoices;
  const stats = analyse(buf);
  return { stats, wav: opts.wav ? wavB64(buf) : undefined, ms: Math.round(performance.now() - t0), info };
}

async function renderSfx(name: string, opts: PlayOpts = {}, wav = true): Promise<unknown> {
  // measure recipe cost and duration with a throwaway context
  const probe = new OfflineAudioContext(2, 128, SR);
  const pe = new Engine(probe, { offline: true });
  const tr = performance.now();
  const b = pe.buffer(name, opts.surface ?? 'grass', opts.variant ?? 0);
  const recipeMs = Math.round(performance.now() - tr);
  if (!b) throw new Error(`no buffer for ${name}`);
  const dur = Math.min(24, b.duration / (opts.pitch ?? 1) + 3.2);
  const res = await renderScript(dur, [{ t: 0, do: (e) => e.play(name, { ...opts, delay: 0.05 }) }], { wav });
  return { ...res, recipeMs, bufDur: b.duration };
}

async function renderLoop(name: string, params: Record<string, number>, dur: number, wav = true, opts: PlayOpts = {}): Promise<unknown> {
  let h: ReturnType<Engine['loop']> | null = null;
  return renderScript(dur, [
    { t: 0, do: (e) => { h = e.loop(name, opts); for (const [k, v] of Object.entries(params)) h.setParam(k, v); } },
    { t: dur * 0.5, do: () => { if (params.progress !== undefined) h?.setParam('progress', 1); } },
    { t: dur - 0.8, do: () => h?.stop(0.6) },
  ], { wav });
}

type MusicStep = { t: number; state?: MusicState; cue?: string; intensity?: number; immediate?: boolean; sfx?: string; dropout?: [number, number]; timeScale?: number };
async function renderMusic(dur: number, steps: MusicStep[], wav = true): Promise<unknown> {
  return renderScript(dur, steps.map((s) => ({
    t: s.t,
    do: (e: Engine) => {
      if (s.intensity !== undefined) e.music.setIntensity(s.intensity);
      if (s.state) e.music.setState(s.state, { immediate: s.immediate });
      if (s.cue) e.music.cue(s.cue);
      if (s.sfx) e.play(s.sfx);
      if (s.dropout) e.dropout(s.dropout[0], s.dropout[1]);
      if (s.timeScale !== undefined) e.setTimeScale(s.timeScale);
    },
  })), { wav });
}

async function renderAmbience(dur: number, weather: number, wav = true): Promise<unknown> {
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const eng = new Engine(ctx, { offline: true });
  const step = 0.05; let t = 0;
  const run = (): void => { eng.update(step, { windStrength: 0.5, playerSpeed: t > dur / 2 ? 14 : 0, inCombat: false, weather, nearWater: 0.6, timeScale: 1 }); eng.tick(); };
  run();
  const sched = (): void => { t += step; if (t >= dur - 0.01) return; const tt = t; ctx.suspend(tt).then(() => { run(); sched(); void ctx.resume(); }); };
  sched();
  const buf = await ctx.startRendering();
  return { stats: analyse(buf), wav: wav ? wavB64(buf) : undefined };
}

async function initTiming(): Promise<unknown> {
  const sys = new AudioSystem();
  const t0 = performance.now();
  await sys.init();
  const ms = performance.now() - t0;
  const pending = sys.engine?.pendingJobs;
  sys.suspend();
  return { initMs: Math.round(ms), pendingJobs: pending };
}

const api = { renderSfx, renderLoop, renderMusic, renderAmbience, initTiming, SOUND_NAMES, LOOP_NAMES, MUSIC_CUES, STATES };
(window as unknown as { audioTest: typeof api }).audioTest = api;

// ------------------------------------------------------------------ live preview UI
const sys = new AudioSystem();
const ui = document.getElementById('ui')!;
const section = (title: string, names: readonly string[], fn: (n: string) => void): void => {
  const h = document.createElement('h2'); h.textContent = title; ui.appendChild(h);
  for (const n of names) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => fn(n); ui.appendChild(b); }
};
document.getElementById('init')!.onclick = async () => {
  await sys.init();
  document.getElementById('status')!.textContent = 'Audio ready.';
  setInterval(() => {
    const w = parseFloat((document.getElementById('weather') as HTMLInputElement).value);
    const ts = parseFloat((document.getElementById('ts') as HTMLInputElement).value);
    sys.setListener({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    sys.update(0.05, { windStrength: 0.4, playerSpeed: 0, inCombat: false, weather: w, nearWater: 0.3, timeScale: ts });
  }, 50);
};
(document.getElementById('inten') as HTMLInputElement).oninput = (e) => sys.music.setIntensity(parseFloat((e.target as HTMLInputElement).value));
section('Music states', STATES, (s) => sys.music.setState(s as MusicState));
section('Music cues', MUSIC_CUES, (c) => sys.music.cue(c));
section('Sounds', SOUND_NAMES, (n) => sys.play(n, { variant: Math.floor(Math.random() * 13), surface: (['grass', 'dirt', 'stone', 'water', 'sand'] as const)[Math.floor(Math.random() * 5)] }));
const loops = new Map<string, ReturnType<AudioSystem['loop']>>();
section('Loops (toggle)', LOOP_NAMES, (n) => {
  const h = loops.get(n);
  if (h) { h.stop(0.5); loops.delete(n); return; }
  const l = sys.loop(n, { position: { x: 6, y: 0, z: -4 } }); l.setParam('progress', 0.5); l.setParam('intensity', 0.7); l.setParam('strength', 0.7); loops.set(n, l);
});
section('Extras', ['dropout 3s', 'slow-mo 0.3'], (n) => { if (n.startsWith('dropout')) sys.dropout(3, 3); else sys.setTimeScale(0.3); });
