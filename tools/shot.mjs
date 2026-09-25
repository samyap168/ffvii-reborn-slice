// Headless screenshot harness: node tools/shot.mjs "<query>" out.png [waitFrames] [--gl]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [,, query = '', out = 'tools/out/shot.png', wait = '30'] = process.argv;
const useGL = process.argv.includes('--gl');
fs.mkdirSync('tools/out', { recursive: true });
const port = 5180 + Math.floor(Math.random() * 15);
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => { if (String(d).includes('Local')) r(); }));
const args = useGL
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args, headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?${query}${useGL ? '&gl' : ''}`);
try {
  await page.waitForFunction((n) => (window.__frames || 0) >= n, Number(wait), { timeout: 240000, polling: 500 });
} catch (e) { logs.push('[harness] timeout waiting for frames'); }
const info = await page.evaluate(() => ({ frames: window.__frames, backend: window.__game?.backend, extra: window.__shotInfo }));
await page.screenshot({ path: out, timeout: 180000 });
console.log(JSON.stringify(info), 'elapsed', ((Date.now() - t0) / 1000).toFixed(1) + 's');
const seen = new Set();
for (const l of logs) { if (!seen.has(l)) { seen.add(l); console.log(l.slice(0, 600)); } }
await browser.close();
server.kill();
process.exit(0);
