import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5198', '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-proxy-server'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:5198/tools/audio/test.html');
await p.waitForFunction(() => !!window.audioTest);
const piece = process.argv[2] || 'kor_knights';
const r = await p.evaluate(async ([piece, list]) => {
  const { PIECES } = await import('/src/audio/music/director.ts');
  const E = (await import('/src/audio/engine.ts')).Engine;
  const def = PIECES[piece];
  const orig = def.stems;
  const stems = [...new Set(def.channels.map(c => c.stem))];
  const out = {};
  for (const mute of (list ? list.split(',') : ['none', ...stems, 'ALL'])) {
    def.stems = (...a) => { const g = orig(...a); for (const k of Object.keys(g)) if (k === mute || mute.startsWith('ALL')) g[k] = 0; return g; };
    const dur = 12;
    const ctx = new OfflineAudioContext(2, 48000 * dur, 48000);
    const e = new E(ctx, { offline: true });
    e.music.setIntensity(1);
    e.music.setState(piece === 'kor_knights' ? 'kor' : piece, { immediate: true });
    if (piece === 'kor_knights') e.music.cue('kor_knights');
    e.tick();
    let t = 0.05;
    const STEP = mute === 'ALL_coarse' ? 0.4 : 0.05; const sched = () => { if (t >= dur - 0.01) return; const tt = t; ctx.suspend(tt).then(() => { e.tick(); t = tt + STEP; sched(); ctx.resume(); }); };
    sched();
    const t0 = performance.now(); await ctx.startRendering(); out[mute] = Math.round(performance.now() - t0);
  }
  def.stems = orig;
  return out;
}, [piece, process.argv[3]]);
console.log(piece, r);
await b.close(); vite.kill(); process.exit(0);
