import * as THREE from 'three/webgpu';
import { getQuality } from './core/quality';
import { createRenderer } from './core/renderer';
import { PostFX } from './core/post';
import { World } from './world/world';
import { U } from './core/env';

async function boot() {
  const q = getQuality();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const { renderer, backend } = await createRenderer(canvas, q);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.2, 12000);
  const world = new World(scene, q);
  await world.build(renderer, camera, (p, l) => console.log('[load]', (p * 100).toFixed(0), l));
  const post = new PostFX(renderer, scene, camera, q);

  const params = new URLSearchParams(location.search);
  const camP = (params.get('cam') || '-590,60,420,-0.6,-0.1').split(',').map(Number);
  camera.position.set(camP[0], camP[1], camP[2]);
  camera.rotation.set(camP[4], camP[3], 0, 'YXZ');
  if (params.has('camg')) {
    const g = params.get('camg')!.split(',').map(Number);
    camera.position.set(g[0], world.hf.height(g[0], g[1]) + g[2], g[1]);
    camera.rotation.set(g[4], g[3], 0, 'YXZ');
  }

  (window as any).__game = { renderer, scene, camera, world, post, backend, U };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  const clock = new THREE.Clock();
  let t = 0;
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    t += dt;
    U.time.value = t;
    world.update(dt, t, camera);
    if (params.has('nopost')) renderer.render(scene, camera);
    else post.render();
    frames++;
    (window as any).__frames = frames;
  });
  console.log('[boot] backend', backend);
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:#f66;z-index:9">${String(e?.stack || e)}</pre>`);
});
