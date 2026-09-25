#!/usr/bin/env node
// Offline audio render + analysis.
// Starts a Vite dev server, opens tools/audio/test.html in headless Chromium, renders every SFX,
// loop and music state/cue through the real engine graph with OfflineAudioContext, writes WAVs to
// tools/out/audio/ and prints peak / RMS / spectral centroid with clipping, silence, DC, NaN flags.
//
// usage: node tools/audio/render.mjs [--only substr] [--no-wav] [--sfx] [--music] [--loops] [--port 5199]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = resolve(root, 'tools/out/audio');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const port = parseInt(val('--port', '5199'), 10);
const only = val('--only', '');
const wav = !flag('--no-wav');
const doAll = !flag('--sfx') && !flag('--music') && !flag('--loops') && !flag('--init');
const doSfx = doAll || flag('--sfx');
const doMusic = doAll || flag('--music');
const doLoops = doAll || flag('--loops');
const doInit = doAll || flag('--init');

const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let viteOut = '';
vite.stdout.on('data', (d) => { viteOut += d; });
vite.stderr.on('data', (d) => { viteOut += d; });
const url = `http://127.0.0.1:${port}/tools/audio/test.html`;
async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite did not start:\n' + viteOut);
}

const rows = [];
function fmt(n, w, d = 1) { return (typeof n === 'number' ? n.toFixed(d) : String(n)).padStart(w); }
function flags(s) {
  const f = [];
  if (s.nan) f.push('NaN');
  if (s.peak > 0.99) f.push('CLIP');
  if (s.silent) f.push('SILENT');
  if (Math.abs(s.dc) > 0.01) f.push('DC');
  if (s.clicks > 3) f.push(`clicks:${s.clicks}`);
  return f.join(' ');
}
function report(name, res) {
  const s = res.stats;
  rows.push({ name, ...s, recipeMs: res.recipeMs, renderMs: res.info?.renderMs, maxVoices: res.info?.maxVoices });
  console.log(`${name.padEnd(34)} ${fmt(s.dur, 6)}s  peak ${fmt(s.peakDb, 6)} dB  mom ${fmt(s.momDb, 6)}  act ${fmt(s.activeRmsDb, 6)}  cent ${fmt(s.centroid, 6, 0)} Hz  ${res.recipeMs !== undefined ? fmt(res.recipeMs, 4, 0) + 'ms' : ''}  ${flags(s)}`);
  if (res.wav) writeFileSync(resolve(outDir, `${name}.wav`), Buffer.from(res.wav, 'base64'));
}

try {
  await waitServer();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('  [page]', m.text()); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.audioTest, null, { timeout: 30000 });
  const meta = await page.evaluate(() => ({ sounds: window.audioTest.SOUND_NAMES, loops: window.audioTest.LOOP_NAMES }));
  const want = (n) => !only || n.includes(only);
  page.setDefaultTimeout(240000);

  if (doInit) {
    const r = await page.evaluate(() => window.audioTest.initTiming());
    console.log(`init(): ${r.initMs} ms (background jobs queued: ${r.pendingJobs})`);
  }

  if (doSfx) {
    console.log('\n== SFX ==');
    for (const name of meta.sounds) {
      if (!want(name)) continue;
      const variants = [];
      if (name === 'chocobo_step' || name === 'cloud_step' || name === 'cloud_land') for (const s of ['grass', 'stone', 'water', 'dirt', 'sand']) variants.push({ tag: `${name}__${s}`, opts: { surface: s } });
      else if (name === 'kor_slash' || name === 'kor_knight_arrive') for (let v = 0; v < 13; v++) variants.push({ tag: `${name}__${v}`, opts: { variant: v } });
      else if (name === 'chocobo_kweh') { variants.push({ tag: name, opts: {} }); variants.push({ tag: `${name}__happy`, opts: { variant: 1 } }); }
      else if (name === 'bird_phrase') for (let v = 0; v < 5; v++) variants.push({ tag: `${name}__${v}`, opts: { variant: v } });
      else if (name === 'swing_light' || name === 'hit_flesh') { variants.push({ tag: name, opts: {} }); variants.push({ tag: `${name}__soft`, opts: { intensity: 0.2 } }); }
      else variants.push({ tag: name, opts: {} });
      for (const v of variants) {
        const res = await page.evaluate(([n, o, w]) => window.audioTest.renderSfx(n, o, w), [name, v.opts, wav]);
        report(v.tag, res);
      }
    }
  }

  if (doLoops) {
    console.log('\n== LOOPS ==');
    const L = [
      ['amb_wind', { strength: 0.8, rush: 0.5 }], ['amb_birds', { density: 1 }], ['amb_insects', { level: 1, water: 1 }],
      ['amb_stream', {}], ['amb_waterfall', {}], ['amb_lake', {}], ['amb_rain', { intensity: 0.4 }], ['amb_rain', { intensity: 1 }],
      ['materia_hum', { intensity: 1 }], ['boss_breath', { intensity: 1 }], ['limit_charge', { progress: 0 }],
    ];
    for (const [name, params] of L) {
      const tag = `loop_${name}${params.intensity === 1 && name === 'amb_rain' ? '_heavy' : ''}`;
      if (!want(tag)) continue;
      const res = await page.evaluate(([n, p, w]) => window.audioTest.renderLoop(n, p, 12, w), [name, params, wav]);
      report(tag, res);
    }
    for (const w of [0, 1]) {
      const tag = `ambience_auto_weather${w}`;
      if (!want(tag)) continue;
      const res = await page.evaluate(([x, ww]) => window.audioTest.renderAmbience(20, x, ww), [w, wav]);
      report(tag, res);
    }
  }

  if (doMusic) {
    console.log('\n== MUSIC ==');
    const M = [
      ['music_title', 22, [{ t: 0, state: 'title' }]],
      ['music_explore_calm', 22, [{ t: 0, state: 'explore', intensity: 0 }]],
      ['music_explore_ride', 22, [{ t: 0, state: 'explore', intensity: 1 }]],
      ['music_explore_walk_to_ride', 30, [{ t: 0, state: 'explore', intensity: 0 }, { t: 12, intensity: 1 }]],
      ['music_encounter', 12, [{ t: 0, state: 'encounter' }]],
      ['music_battle_low', 20, [{ t: 0, state: 'battle', intensity: 0.2 }]],
      ['music_battle_high', 20, [{ t: 0, state: 'battle', intensity: 1 }]],
      ['music_boss', 22, [{ t: 0, state: 'boss', intensity: 0.5 }, { t: 3, cue: 'boss_reveal' }]],
      ['music_enrage', 22, [{ t: 0, state: 'boss', intensity: 1 }, { t: 3, cue: 'enrage_hit' }, { t: 4, state: 'enrage' }]],
      ['music_enrage_direct', 20, [{ t: 0, state: 'enrage', intensity: 1, immediate: true }]],
      ['music_limit', 16, [{ t: 0, state: 'battle', intensity: 0.6 }, { t: 2, state: 'limit' }]],
      ['music_victory', 22, [{ t: 0, state: 'battle', intensity: 0.8 }, { t: 2, state: 'victory' }]],
      ['music_aftermath', 22, [{ t: 0, state: 'aftermath' }]],
      ['music_transitions', 34, [{ t: 0, state: 'explore', intensity: 0.3 }, { t: 6, state: 'encounter' }, { t: 11, state: 'battle' }, { t: 20, state: 'victory' }, { t: 29, state: 'explore' }]],
      ['music_stagger_cue', 8, [{ t: 0, state: 'battle', intensity: 0.5 }, { t: 3, cue: 'stagger' }]],
      ['music_kor_begin', 20, [{ t: 0, cue: 'kor_begin' }]],
      ['music_kor_structure', 20, [{ t: 0, cue: 'kor_begin' }, { t: 2, cue: 'kor_structure' }]],
      ['music_kor_portal', 14, [{ t: 0, cue: 'kor_structure' }, { t: 3, cue: 'kor_portal' }]],
      ['music_kor_knights', 22, [{ t: 0, cue: 'kor_knights', intensity: 0.3 }, { t: 12, intensity: 1 }]],
      ['music_kor_final_charge', 14, [{ t: 0, cue: 'kor_knights', intensity: 1 }, { t: 2, cue: 'kor_final_charge' }, { t: 11.5, cue: 'kor_silence' }]],
      ['music_kor_resolve', 26, [{ t: 0, cue: 'kor_resolve' }]],
      ['music_kor_full_sequence', 78, [
        { t: 0, state: 'boss', intensity: 1 }, { t: 1, state: 'limit' }, { t: 7, cue: 'kor_begin' }, { t: 15, cue: 'kor_structure' },
        { t: 23, cue: 'kor_portal' }, { t: 28, cue: 'kor_knights', intensity: 0.2 }, { t: 40, intensity: 1 }, { t: 50, cue: 'kor_final_charge' },
        { t: 58, cue: 'kor_silence', sfx: 'kor_final_impact', dropout: [2.5, 3] }, { t: 60.5, cue: 'kor_resolve' },
      ]],
      ['scenario_slowmo', 8, [{ t: 0, state: 'battle', intensity: 0.7 }, { t: 1, sfx: 'swing_heavy' }, { t: 2, timeScale: 0.25 }, { t: 2.2, sfx: 'hit_critical' }, { t: 5, timeScale: 1 }, { t: 5.5, sfx: 'hit_critical' }]],
      ['scenario_dropout', 10, [{ t: 0, state: 'battle', intensity: 0.7 }, { t: 2, sfx: 'kor_impact_big', dropout: [3, 3] }]],
    ];
    for (const [tag, dur, steps] of M) {
      if (!want(tag)) continue;
      const res = await page.evaluate(([d, s, w]) => window.audioTest.renderMusic(d, s, w), [dur, steps, wav]);
      report(tag, res);
    }
  }

  writeFileSync(resolve(outDir, 'analysis.json'), JSON.stringify(rows, null, 1));
  const bad = rows.filter((r) => r.nan || r.peak > 0.99 || r.silent || Math.abs(r.dc) > 0.01);
  console.log(`\n${rows.length} renders, ${bad.length} flagged: ${bad.map((r) => r.name).join(', ') || 'none'}`);
  console.log(`WAVs + analysis.json in ${outDir}`);
  await browser.close();
} finally {
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300);
}
