import * as THREE from 'three/webgpu';
import { getQuality } from './core/quality';
import { createRenderer } from './core/renderer';
import { Game } from './game/game';

async function boot() {
  const q = getQuality();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { renderer, backend } = await createRenderer(canvas, q);
  const params = new URLSearchParams(location.search);
  if (params.has('view')) {
    const { runViewer } = await import('./viewer');
    await runViewer(renderer, params.get('view')!, params);
    (window as any).__game = { renderer, backend };
    return;
  }
  const game = new Game(renderer, q, backend);
  (window as any).__game = game;
  await game.load();
  try {
    // Resolved at build time; absent module -> no audio (keeps the build green).
    const mods = import.meta.glob('./audio/index.ts');
    const loader = mods['./audio/index.ts'];
    if (loader) {
      const mod: any = await loader();
      game.audio = new mod.AudioSystem();
    }
  } catch (e) {
    console.warn('audio unavailable', e);
  }
  game.start();
  const timer = new THREE.Timer();
  let frames = 0;
  const perf = new FrameGovernor(renderer, q.pixelRatio, q.adaptive, params.has('fps'));
  renderer.setAnimationLoop((ts?: number) => {
    timer.update(ts);
    const fixed = (window as any).__fixedDt as number | undefined;
    const dt = fixed ?? timer.getDelta();
    if (fixed === undefined) perf.frame(dt);
    // Motion blur (opt-in) represents a 1/60 s shutter regardless of frame rate.
    game.post.mbStrength.value = 0.5 * Math.min(1, Math.max(0.2, 1 / 60 / Math.max(dt, 1e-3)));
    game.update(dt);
    game.render();
    (window as any).__frames = ++frames;
  });
  console.log('[boot] backend', backend);
}

/**
 * Holds the frame rate by scaling render resolution: drops quickly when frames
 * run long, climbs back slowly when there is headroom. Optional FPS readout.
 */
class FrameGovernor {
  private ratio: number;
  private acc = 0;
  private n = 0;
  private cool = 2.5; // ignore the first seconds (shader warm-up hitches)
  private el: HTMLDivElement | null = null;
  constructor(
    private renderer: THREE.WebGPURenderer,
    private base: number,
    private adaptive: boolean,
    showFps: boolean,
  ) {
    this.ratio = base;
    if (showFps) {
      this.el = document.createElement('div');
      this.el.style.cssText = 'position:fixed;right:10px;top:8px;z-index:99;font:12px/1.3 monospace;color:#cfe;background:rgba(0,0,0,.5);padding:4px 8px;border-radius:4px;pointer-events:none';
      document.body.appendChild(this.el);
    }
  }
  frame(dt: number) {
    this.acc += dt;
    this.n++;
    this.cool -= dt;
    if (this.acc < 0.5) return;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    if (this.el) this.el.textContent = `${(1 / avg).toFixed(0)} fps · ${(avg * 1000).toFixed(1)} ms · res ${Math.round((this.ratio / this.base) * 100)}%`;
    if (!this.adaptive || this.cool > 0) return;
    let next = this.ratio;
    if (avg > 1 / 52) next = Math.max(this.base * 0.5, this.ratio * (avg > 1 / 35 ? 0.8 : 0.9));
    else if (avg < 1 / 68) next = Math.min(this.base, this.ratio * 1.06);
    if (Math.abs(next - this.ratio) > 1e-3) {
      this.cool = next < this.ratio ? 1 : 2;
      this.ratio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:#f66;z-index:999;white-space:pre-wrap">${String(e?.stack || e)}</pre>`);
});
