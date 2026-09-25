import * as THREE from 'three/webgpu';
import type { QualitySettings } from './quality';

export interface RendererInfo {
  renderer: THREE.WebGPURenderer;
  backend: 'webgpu' | 'webgl2';
}

/** Older Chromium builds reject the (default) string swizzle three r186 always sends. */
function patchWebGPUCompat() {
  const G = (globalThis as any).GPUTexture;
  if (!G || G.prototype.__ffPatched) return;
  const orig = G.prototype.createView;
  G.prototype.createView = function (desc?: any) {
    if (desc && desc.swizzle === 'rgba') {
      const d = { ...desc };
      delete d.swizzle;
      return orig.call(this, d);
    }
    return orig.call(this, desc);
  };
  G.prototype.__ffPatched = true;
}

export async function createRenderer(canvas: HTMLCanvasElement, q: QualitySettings): Promise<RendererInfo> {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.has('gl') || !('gpu' in navigator);
  patchWebGPUCompat();
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL,
    powerPreference: 'high-performance',
    alpha: false,
  } as any);
  await renderer.init();
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const backend = (renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
