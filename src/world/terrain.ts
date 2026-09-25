// GPU terrain: nested-ring geometry clipmap (single draw call) with CDLOD-style
// geomorphing, heights fetched from the CPU heightfield texture, and a fully
// procedural PBR material (grass/dirt/rock/sand/snow/paving) driven by splat maps.
import * as THREE from 'three/webgpu';
import { sstep } from '../core/tsl';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  ivec2,
  int,
  texture,
  textureLoad,
  attribute,
  positionLocal,
  positionWorld,
  cameraViewMatrix,
  uniform,
  floor,
  fract,
  abs,
  max,
  min,
  mix,
  smoothstep,
  saturate,
  clamp,
  dot,
  normalize,
  sin,
  pow,
  length,
  mx_noise_float,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  step,
  atan,
} from 'three/tsl';
import { HF_RES, HF_CELL, HALF, WORLD_SIZE, LAKE, ARENA } from './layout';
import type { Heightfield } from './heightfield';
import { U } from '../core/env';

export interface TerrainTextures {
  height: THREE.DataTexture;
  normal: THREE.DataTexture;
  splat: THREE.DataTexture;
}

export function makeTerrainTextures(hf: Heightfield): TerrainTextures {
  const height = new THREE.DataTexture(hf.heights, HF_RES, HF_RES, THREE.RedFormat, THREE.FloatType);
  height.minFilter = height.magFilter = THREE.NearestFilter;
  height.generateMipmaps = false;
  height.needsUpdate = true;

  const normal = new THREE.DataTexture(hf.normals, HF_RES, HF_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.magFilter = THREE.LinearFilter;
  normal.generateMipmaps = true;
  normal.needsUpdate = true;

  const splat = new THREE.DataTexture(hf.splat, HF_RES, HF_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  splat.minFilter = THREE.LinearMipmapLinearFilter;
  splat.magFilter = THREE.LinearFilter;
  splat.generateMipmaps = true;
  splat.needsUpdate = true;
  return { height, normal, splat };
}

/** TSL: bilinear height fetch from the float heightfield (valid in vertex stage). */
export function heightSampler(tex: THREE.DataTexture) {
  return Fn(([p]: [any]) => {
    const f: any = clamp(p.add(HALF).div(HF_CELL), 0, HF_RES - 1.001);
    const i: any = floor(f);
    const t: any = f.sub(i);
    const ii = ivec2(int(i.x), int(i.y));
    const a = textureLoad(tex, ii).x;
    const b = textureLoad(tex, ii.add(ivec2(1, 0))).x;
    const c = textureLoad(tex, ii.add(ivec2(0, 1))).x;
    const d = textureLoad(tex, ii.add(ivec2(1, 1))).x;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
  });
}

/** World xz -> texture uv of the heightfield-aligned maps. */
export const worldToHfUV = Fn(([p]: [any]) => p.add(HALF).div(HF_CELL).add(0.5).div(HF_RES));

function buildClipmapGeometry(n: number, levels: number, s0: number) {
  const pos: number[] = [];
  const lod: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (let L = 0; L < levels; L++) {
    const s = s0 * Math.pow(2, L);
    const R = n * s; // half extent
    const inner = L === 0 ? -1 : n / 2; // ring hole half-size in cells
    const cells = n * 2;
    const vid = new Int32Array((cells + 1) * (cells + 1)).fill(-1);
    const get = (i: number, j: number) => {
      const k = j * (cells + 1) + i;
      if (vid[k] < 0) {
        vid[k] = base++;
        pos.push(-R + i * s, 0, -R + j * s);
        lod.push(s, R);
      }
      return vid[k];
    };
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const ci = i - n + 0.5,
          cj = j - n + 0.5;
        if (L > 0 && Math.abs(ci) < inner && Math.abs(cj) < inner) continue;
        const a = get(i, j),
          b = get(i + 1, j),
          c = get(i, j + 1),
          d = get(i + 1, j + 1);
        // Alternate diagonal for nicer shading.
        if ((i + j) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('lod', new THREE.Float32BufferAttribute(lod, 2));
  g.setIndex(idx);
  return { geometry: g, extent: n * s0 * Math.pow(2, levels - 1), snap: s0 * Math.pow(2, levels - 1) * 2 };
}

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly origin = uniform(new THREE.Vector2());
  private snap: number;
  readonly sampleHeight: ReturnType<typeof heightSampler>;

  constructor(
    public hf: Heightfield,
    public tex: TerrainTextures,
    quality: { rings: number; n: number },
  ) {
    const { geometry, snap } = buildClipmapGeometry(quality.n, quality.rings, 1);
    this.snap = snap;
    this.sampleHeight = heightSampler(tex.height);
    const mat = this.buildMaterial();
    this.mesh = new THREE.Mesh(geometry, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
  }

  update(cameraPos: THREE.Vector3) {
    const s = this.snap;
    this.origin.value.set(Math.round(cameraPos.x / s) * s, Math.round(cameraPos.z / s) * s);
  }

  private buildMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial();
    const origin = this.origin;
    const sampleH = this.sampleHeight;
    const { normal: normalTex, splat: splatTex } = this.tex;

    mat.positionNode = Fn(() => {
      const lod = attribute('lod', 'vec2');
      const s = lod.x;
      const R = lod.y;
      const local = positionLocal.xz;
      const d = max(abs(local.x), abs(local.y));
      const alpha = saturate(d.div(R).sub(0.72).div(0.24));
      const p = local.add(origin);
      const g = p.div(s);
      const odd = fract(g.mul(0.5)).mul(2.0);
      const pm = p.sub(odd.mul(s).mul(alpha));
      const h = sampleH(pm);
      return vec3(pm.x, h, pm.y);
    })();

    const wp = positionWorld;
    const uvw = worldToHfUV(wp.xz);
    const splat = texture(splatTex, uvw);
    const macroN = texture(normalTex, uvw).xyz.mul(2).sub(1);

    // Detail normal perturbation (procedural, varies by material).
    const nA = mx_noise_float(vec3(wp.x.mul(0.35), wp.y.mul(0.35), wp.z.mul(0.35)));
    const nB = mx_noise_float(vec3(wp.x.mul(0.35).add(17.1), wp.y.mul(0.35), wp.z.mul(0.35).sub(3.7)));
    const nC = mx_noise_float(vec3(wp.x.mul(2.1), wp.y.mul(2.1), wp.z.mul(2.1)));
    const nD = mx_noise_float(vec3(wp.x.mul(2.1).add(5.3), wp.y.mul(2.1), wp.z.mul(2.1).add(9.9)));

    const slope = saturate(float(1).sub(macroN.y));
    const rockW = smoothstep(0.3, 0.46, slope.add(nA.mul(0.06)));
    const detailStrength = mix(float(0.12), float(0.42), rockW);
    const worldN = normalize(macroN.add(vec3(nA.add(nC.mul(0.5)), 0, nB.add(nD.mul(0.5))).mul(detailStrength)));
    mat.normalNode = normalize(cameraViewMatrix.mul(vec4(worldN, 0)).xyz);

    // --- Albedo layers --------------------------------------------------------
    const macro = mx_fractal_noise_float(vec3(wp.x.mul(0.006), 0.0, wp.z.mul(0.006)), 3, 2.0, 0.5);
    const macro2 = mx_fractal_noise_float(vec3(wp.x.mul(0.03).add(40), 0.0, wp.z.mul(0.03)), 2, 2.0, 0.5);
    const grassLush = vec3(0.105, 0.2, 0.04);
    const grassGold = vec3(0.3, 0.29, 0.1);
    const grassDark = vec3(0.06, 0.12, 0.035);
    let grass: any = mix(grassLush, grassGold, saturate(macro.mul(0.9).add(0.35)));
    grass = mix(grass, grassDark, saturate(macro2.mul(1.2).add(0.1)).mul(0.5));
    grass = grass.mul(float(0.85).add(nC.mul(0.15)));

    const pebble = mx_worley_noise_float(vec3(wp.x.mul(3.0), 0.0, wp.z.mul(3.0)));
    const dirt = mix(vec3(0.2, 0.13, 0.07), vec3(0.34, 0.24, 0.14), saturate(nC.mul(0.5).add(0.5)))
      .mul(float(0.8).add(smoothstep(0.05, 0.25, pebble).mul(0.3)))
      .mul(float(0.9).add(macro2.mul(0.15)));

    const strata = sin(wp.y.mul(1.1).add(nA.mul(5.0)).add(nC)).mul(0.5).add(0.5);
    let rock: any = mix(vec3(0.13, 0.12, 0.11), vec3(0.27, 0.25, 0.22), strata.mul(0.6).add(nC.mul(0.25)).add(0.2));
    rock = rock.mul(float(0.8).add(mx_noise_float(wp.mul(0.9)).mul(0.25)));
    const mossMask = smoothstep(0.55, 0.85, worldN.y).mul(smoothstep(-0.2, 0.3, nA.add(macro2)));
    rock = mix(rock, vec3(0.09, 0.14, 0.04), mossMask.mul(0.8));

    const sand = mix(vec3(0.26, 0.22, 0.16), vec3(0.38, 0.33, 0.24), saturate(nC.mul(0.5).add(0.5)));
    const snow = vec3(0.86, 0.89, 0.94).mul(float(0.92).add(nC.mul(0.08)));

    // Ancient paving slabs on the arena plateau.
    const ap = wp.xz.sub(vec2(ARENA.x, ARENA.z));
    const ar = length(ap);
    const ring = floor(ar.div(2.6));
    const ang = atan(ap.y, ap.x);
    const segs = max(ring.mul(6.0), 6.0);
    const cellA = floor(ang.div(6.28318).mul(segs).add(ring.mul(0.37)));
    const fr = fract(ar.div(2.6));
    const fa = fract(ang.div(6.28318).mul(segs).add(ring.mul(0.37)));
    const gap = smoothstep(0.0, 0.05, fr).mul(sstep(1.0, 0.95, fr)).mul(smoothstep(0.0, 0.04, fa)).mul(sstep(1.0, 0.96, fa));
    const slabTint = fract(sin(ring.mul(12.9898).add(cellA.mul(78.233))).mul(43758.5453));
    let paving: any = mix(vec3(0.33, 0.31, 0.28), vec3(0.5, 0.47, 0.42), slabTint).mul(float(0.85).add(nC.mul(0.15)));
    paving = mix(vec3(0.07, 0.1, 0.04), paving, gap); // moss in the gaps
    const centerSigil = sstep(0.35, 0.0, abs(ar.sub(11.0))).mul(0.5).add(sstep(0.3, 0.0, abs(ar.sub(20.0))).mul(0.4));
    paving = mix(paving, vec3(0.55, 0.52, 0.45), centerSigil);
    const arenaMask = sstep(ARENA.radius + 1, ARENA.radius - 2, ar);

    // --- Blend ----------------------------------------------------------------
    const path = splat.x;
    const wet = splat.y;
    const snowW = smoothstep(250, 320, wp.y.add(nA.mul(40))).mul(sstep(0.62, 0.35, slope));
    let col: any = grass;
    col = mix(col, sand, smoothstep(0.35, 0.8, wet).mul(sstep(LAKE.level + 3.5, LAKE.level + 0.5, wp.y)));
    col = mix(col, dirt, smoothstep(0.25, 0.75, path.add(nC.mul(0.12))));
    col = mix(col, rock, rockW);
    col = mix(col, snow, snowW);
    col = mix(col, paving, arenaMask);
    // Wetness darkens.
    const wetDark = saturate(wet.mul(0.9)).mul(float(1).sub(arenaMask.mul(0.6)));
    col = col.mul(mix(float(1), float(0.55), wetDark.mul(0.8)));
    // Underwater tint & fade.
    const under = sstep(LAKE.level + 0.2, LAKE.level - 2.5, wp.y);
    col = mix(col, col.mul(vec3(0.35, 0.5, 0.48)), under);
    // Burn / scorch marks from spells & boss attacks.
    const sc = U.scorchCenter;
    const scd = length(wp.xz.sub(sc.xy));
    const scorch = float(1).sub(smoothstep(sc.z.mul(0.3), sc.z, scd)).mul(sc.w).mul(float(0.7).add(nA.mul(0.3)));
    col = mix(col, vec3(0.03, 0.025, 0.02), saturate(scorch));

    mat.colorNode = col;
    mat.roughnessNode = saturate(
      mix(float(0.92), float(0.3), wetDark.mul(0.9)).sub(snowW.mul(0.2)).sub(arenaMask.mul(0.1)).sub(step(0.5, under).mul(0.4)),
    );
    mat.metalnessNode = float(0);
    return mat;
  }
}

/** A very distant ring of mountain silhouettes beyond the playable heightfield. */
export function makeFarMountains(noise: { ridged2: (x: number, y: number, o?: number) => number; fbm2: (x: number, y: number, o?: number) => number }) {
  const seg = 512;
  const rings = 6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const r0 = 1500,
    r1 = 5200;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = r0 + (r1 - r0) * t;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      const ridge = noise.ridged2(Math.cos(a) * 3 + t * 2.1, Math.sin(a) * 3 + t * 1.3, 6);
      const north = 0.6 + 0.6 * Math.max(0, -Math.sin(a));
      const prof = Math.sin(Math.PI * Math.min(1, t * 1.25)) ;
      const y = (120 + 780 * ridge * north) * prof + (t < 0.05 ? 0 : 0) - 20;
      pos.push(x, y, z);
      const snow = y > 520 ? 1 : 0;
      col.push(snow, t, 0);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i,
        b = a + 1,
        c = a + seg + 1,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial();
  const snowAmt = smoothstep(420, 620, positionWorld.y.add(mx_noise_float(positionWorld.mul(0.004)).mul(120)));
  mat.colorNode = mix(vec3(0.16, 0.17, 0.17), vec3(0.85, 0.88, 0.93), snowAmt);
  mat.roughnessNode = float(0.95);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.name = 'farMountains';
  void pow;
  void min;
  void dot;
  return m;
}

export { WORLD_SIZE };
