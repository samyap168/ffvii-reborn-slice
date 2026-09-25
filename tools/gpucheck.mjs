import { chromium } from 'playwright';
const variants = {
  webgpu: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=swiftshader','--use-webgpu-adapter=swiftshader','--ignore-gpu-blocklist'],
  gl: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
};
for (const [k, args] of Object.entries(variants)) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args, headless: true });
  const p = await b.newPage(); await p.goto('http://localhost:8765/');
  const r = await p.evaluate(async () => {
    const out = {};
    out.hasGPU = !!navigator.gpu;
    if (navigator.gpu) { try { const a = await navigator.gpu.requestAdapter(); out.adapter = !!a; if (a) { const info = a.info || {}; out.info = info.vendor + ' ' + info.architecture; } } catch (e) { out.err = String(e); } }
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); out.webgl2 = !!gl;
    if (gl) { const d = gl.getExtension('WEBGL_debug_renderer_info'); out.glr = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; out.float = !!gl.getExtension('EXT_color_buffer_float'); }
    return out;
  });
  console.log(k, JSON.stringify(r));
  await b.close();
}
