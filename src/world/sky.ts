// Procedural sky dome: artist-driven atmosphere gradient, sun, raymarched cloud
// layer, storm & lightning response, and the Knights of Round "cosmic" takeover.
import * as THREE from 'three/webgpu';
import { sstep } from '../core/tsl';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  positionWorld,
  cameraPosition,
  normalize,
  dot,
  mix,
  smoothstep,
  saturate,
  pow,
  max,
  exp,
  abs,
  fract,
  sin,
  floor,
  length,
  mx_fractal_noise_float,
  mx_noise_float,
  Loop,
  int,
  fog,
} from 'three/tsl';
import { U } from '../core/env';

export const skyColorFn = Fn(([dirIn]: [any]) => {
  const dir: any = normalize(dirIn);
  const y = dir.y;
  const mu = dot(dir, U.sunDir);
  const up = saturate(y);

  // Base gradient.
  const grad = mix(U.horizon, U.zenith, pow(up, 0.5));
  const below = mix(U.horizon.mul(0.9), U.ground, saturate(y.negate().mul(4)));
  let sky: any = y.greaterThan(0).select(grad, below);
  // Horizon haze band + sun-side warmth.
  const haze = exp(abs(y).mul(-9.0));
  sky = mix(sky, U.fogColor.mul(1.05), haze.mul(0.55));
  const sunSide = pow(saturate(mu.mul(0.5).add(0.5)), 3.0);
  sky = sky.add(U.sunColor.mul(sunSide.mul(haze).mul(0.25)));
  // Mie glow and sun disk.
  const glow = pow(saturate(mu), 12.0).mul(0.35).add(pow(saturate(mu), 180.0).mul(1.6));
  sky = sky.add(U.sunColor.mul(glow).mul(U.sunIntensity.mul(0.35)));
  const disk = smoothstep(0.99955, 0.99975, mu);
  sky = sky.add(U.sunColor.mul(disk).mul(U.sunIntensity.mul(18.0)).mul(float(1).sub(U.storm)));

  // --- Clouds: two-layer pseudo-volumetric slab ------------------------------
  const cloudMask = smoothstep(0.0, 0.08, y);
  const t = float(2200).div(max(y, 0.02));
  const cp = dir.xz.mul(t).add(cameraPosition.xz);
  const wind = U.windDir.mul(U.time.mul(U.cloudSpeed).mul(6.0));
  const q = cp.add(wind).mul(0.00042);
  const shape = mx_fractal_noise_float(vec3(q.x, q.y, U.time.mul(0.002)), 5, 2.03, 0.5).mul(0.5).add(0.5);
  const cover = mix(float(0.62), float(0.2), U.cloudCover);
  const dens = smoothstep(cover, cover.add(0.28), shape);
  // Light probe toward the sun for self-shadowing.
  const q2 = q.add(U.sunDir.xz.mul(0.035));
  const shape2 = mx_fractal_noise_float(vec3(q2.x, q2.y, U.time.mul(0.002)), 4, 2.03, 0.5).mul(0.5).add(0.5);
  const shadow = saturate(shape2.sub(shape).mul(3.5).add(0.45));
  const litCol = U.sunColor.mul(U.sunIntensity.mul(0.55)).add(U.zenith.mul(0.4));
  const darkCol = mix(U.zenith.mul(0.55).add(U.horizon.mul(0.25)), vec3(0.05, 0.05, 0.07), U.storm.mul(0.8));
  let cloudCol: any = mix(litCol, darkCol, shadow);
  // Silver lining when near the sun.
  cloudCol = cloudCol.add(U.sunColor.mul(pow(saturate(mu), 8.0).mul(float(1).sub(dens)).mul(2.5)));
  // Lightning inside the clouds.
  cloudCol = cloudCol.add(U.flashColor.mul(U.flash.mul(2.5)).mul(shape));
  const cloudFade = cloudMask.mul(smoothstep(0.0, 0.25, y).mul(0.6).add(0.4));
  // Horizon haze over distant clouds.
  cloudCol = mix(cloudCol, U.fogColor, haze.mul(0.7));
  sky = mix(sky, cloudCol, dens.mul(cloudFade).mul(0.95));

  // Wispy high cirrus.
  const ci = mx_fractal_noise_float(vec3(q.x.mul(0.35).add(3.3), q.y.mul(1.4), 1.7), 3, 2.0, 0.5);
  sky = sky.add(U.sunColor.mul(smoothstep(0.25, 0.7, ci).mul(0.12).mul(cloudMask)).mul(float(1).sub(U.storm)));

  // Storm darkening + flash.
  sky = mix(sky, sky.mul(0.35), U.storm.mul(0.6));
  sky = sky.add(U.flashColor.mul(U.flash.mul(0.6)));

  // --- Cosmic takeover (Knights of Round) -------------------------------------
  const cos = U.cosmic;
  const n1 = mx_fractal_noise_float(dir.mul(2.2).add(vec3(0, U.time.mul(0.01), 0)), 5, 2.0, 0.55).mul(0.5).add(0.5);
  const n2 = mx_fractal_noise_float(dir.mul(5.0).add(vec3(3.1, 0, U.time.mul(0.02))), 4, 2.0, 0.5).mul(0.5).add(0.5);
  let nebula: any = mix(vec3(0.02, 0.005, 0.04), vec3(0.28, 0.08, 0.35), smoothstep(0.35, 0.8, n1));
  nebula = nebula.add(vec3(1.0, 0.6, 0.2).mul(smoothstep(0.62, 0.95, n2.mul(n1).mul(1.6))).mul(0.9));
  // Stars.
  const sd = dir.mul(420.0);
  const cell: any = floor(sd);
  const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const fp = fract(sd).sub(0.5);
  const star = sstep(0.08, 0.0, length(fp)).mul(smoothstep(0.985, 1.0, h)).mul(4.0);
  nebula = nebula.add(vec3(1.0, 0.95, 0.85).mul(star));
  // Golden radial halo around the zenith portal.
  const zen = saturate(y);
  const halo = pow(zen, 6.0).mul(1.5);
  const rings = sstep(0.02, 0.0, abs(fract(zen.mul(18.0).sub(U.time.mul(0.3))).sub(0.5)).sub(0.46)).mul(pow(zen, 3.0));
  nebula = nebula.add(vec3(1.0, 0.7, 0.3).mul(halo.add(rings.mul(0.6))));
  sky = mix(sky, nebula, cos);

  return sky;
});

export function makeSky() {
  const geo = new THREE.SphereGeometry(9000, 64, 32);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  mat.fog = false;
  mat.colorNode = skyColorFn(positionWorld.sub(cameraPosition));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  // Keep centered on the camera.
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
  };
  void vec2;
  void vec4;
  void Loop;
  void int;
  void mx_noise_float;
  return mesh;
}

/** Aerial perspective / height fog applied to every lit material via scene.fogNode. */
export const makeFogNode = () => {
  const v = positionWorld.sub(cameraPosition);
  const dist = length(v);
  const dir = v.div(max(dist, 0.001));
  const avgY = positionWorld.y.add(cameraPosition.y).mul(0.5);
  const heightK = exp(max(avgY.sub(18.0), 0.0).mul(U.fogHeight.negate()));
  const amount = saturate(float(1).sub(exp(dist.mul(U.fogDensity).mul(heightK).negate())));
  const mu = saturate(dot(dir, U.sunDir));
  let col: any = mix(U.fogColor, U.sunColor.mul(1.25), pow(mu, 6.0).mul(0.5));
  // Distant fog picks up the sky gradient so mountains melt into the horizon.
  col = mix(col, mix(U.horizon, U.zenith, saturate(dir.y.mul(2.0))), smoothstep(0.6, 1.0, amount).mul(0.3));
  col = col.add(U.flashColor.mul(U.flash.mul(0.35)));
  return fog(col, amount);
};
