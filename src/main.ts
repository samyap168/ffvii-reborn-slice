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
  renderer.setAnimationLoop((ts?: number) => {
    timer.update(ts);
    const fixed = (window as any).__fixedDt as number | undefined;
    game.update(fixed ?? timer.getDelta());
    game.render();
    (window as any).__frames = ++frames;
  });
  console.log('[boot] backend', backend);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:#f66;z-index:999;white-space:pre-wrap">${String(e?.stack || e)}</pre>`);
});
