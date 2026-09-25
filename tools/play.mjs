// Scripted play harness: node tools/play.mjs "<query>" '<json steps>' [--gl]
// steps: ["click"], ["advance", secs], ["shot", "name.png"], ["eval", "js"], ["key", "KeyW", "down"|"up"], ["wait", ms]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,, query = '', stepsJson = '[]'] = process.argv;
const useGL = process.argv.includes('--gl');
fs.mkdirSync('tools/out', { recursive: true });
const port = Number(process.env.PORT || 5173);
const args = useGL
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args, headless: true });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 960), height: Number(process.env.H || 540) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?${query}${useGL ? '&gl' : ''}`);
await page.waitForFunction(() => (window.__frames || 0) >= 2, null, { timeout: 300000, polling: 500 });
// Freeze real-time stepping: frames render with dt=0 unless we advance.
await page.evaluate(() => { window.__fixedDt = 0; });
for (const st of JSON.parse(stepsJson)) {
  const [op, a, b] = st;
  if (op === 'click') await page.mouse.click(400, 300);
  else if (op === 'advance') await page.evaluate((s) => window.__game.advance(s), a);
  else if (op === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(a)));
  else if (op === 'key') { if (b === 'up') await page.keyboard.up(a); else await page.keyboard.down(a); }
  else if (op === 'wait') await page.waitForTimeout(a);
  else if (op === 'shot') {
    const f0 = await page.evaluate(() => window.__frames);
    await page.waitForFunction((f) => window.__frames >= f + 2, f0, { timeout: 600000, polling: 200 });
    await page.screenshot({ path: 'tools/out/' + a, timeout: 180000 });
    console.log('shot', a, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
const seen = new Set();
for (const l of logs) { if (!seen.has(l) && !/vite|CERT|404|Clock|PCF/.test(l)) { seen.add(l); console.log(l.slice(0, 500)); } }
await browser.close();
process.exit(0);
