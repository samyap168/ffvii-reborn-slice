// CPU heightfield + terrain attribute maps. The same data drives the GPU terrain
// (uploaded as textures) and all gameplay queries (feet, camera, AI, VFX).
import { Simplex, smoothstep, lerp, saturate, clamp, Spline2 } from '../core/math';
import {
  HF_RES,
  HF_CELL,
  HALF,
  LAKE,
  ARENA,
  WATERFALL,
  ROAD,
  TRAIL,
  STREAM,
  UPPER_RIVER,
  streamBedAt,
  upperBedAt,
  RUIN_SITES,
  MONSTER_MEADOW,
} from './layout';

/** Height of the falling water sheet at a given z (ballistic arc from the lip). */
export function waterfallSheetY(z: number): number | null {
  const v = 7.5,
    g = 9.8;
  const dz = z - WATERFALL.z;
  if (dz < 0) return WATERFALL.top;
  const t = dz / v;
  const y = WATERFALL.top - 0.5 * g * t * t;
  return y < WATERFALL.bottom - 2 ? null : y;
}

export type Surface = 'grass' | 'dirt' | 'stone' | 'water' | 'sand';

interface DistField {
  d: Float32Array;
  t: Float32Array;
}

export class Heightfield {
  readonly res = HF_RES;
  readonly heights = new Float32Array(HF_RES * HF_RES);
  readonly normals = new Uint8Array(HF_RES * HF_RES * 4); // xyz packed, w = slope
  readonly splat = new Uint8Array(HF_RES * HF_RES * 4); // r path, g wet, b grass, a flowers
  readonly noise = new Simplex(7);
  road!: DistField;
  trail!: DistField;
  stream!: DistField;
  upper!: DistField;

  generate(onProgress?: (p: number) => void) {
    const N = this.res;
    this.road = this.stampSpline(ROAD, 60);
    this.trail = this.stampSpline(TRAIL, 30);
    this.stream = this.stampSpline(STREAM, 70);
    this.upper = this.stampSpline(UPPER_RIVER, 60);
    onProgress?.(0.1);

    const sitesH = RUIN_SITES.map((s) => this.baseHeight(s.x, s.z));
    const h = this.heights;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * HF_CELL;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * HF_CELL;
        const idx = j * N + i;
        h[idx] = this.composeHeight(x, z, idx, sitesH);
      }
      if (onProgress && (j & 63) === 0) onProgress(0.1 + 0.7 * (j / N));
    }
    this.computeNormals();
    onProgress?.(0.9);
    this.computeSplat();
    onProgress?.(1);
  }

  // --- generation -----------------------------------------------------------

  private stampSpline(spline: Spline2, band: number): DistField {
    const N = this.res;
    const d = new Float32Array(N * N).fill(1e6);
    const t = new Float32Array(N * N);
    const s = spline.samples;
    for (let k = 0; k < s.length - 1; k++) {
      const a = s[k],
        b = s[k + 1];
      const minx = Math.min(a.x, b.x) - band,
        maxx = Math.max(a.x, b.x) + band;
      const minz = Math.min(a.z, b.z) - band,
        maxz = Math.max(a.z, b.z) + band;
      const i0 = clamp(Math.floor((minx + HALF) / HF_CELL), 0, N - 1),
        i1 = clamp(Math.ceil((maxx + HALF) / HF_CELL), 0, N - 1);
      const j0 = clamp(Math.floor((minz + HALF) / HF_CELL), 0, N - 1),
        j1 = clamp(Math.ceil((maxz + HALF) / HF_CELL), 0, N - 1);
      const abx = b.x - a.x,
        abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1e-6;
      const segLen = Math.sqrt(l2);
      for (let j = j0; j <= j1; j++) {
        const z = -HALF + j * HF_CELL;
        for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * HF_CELL;
          let u = ((x - a.x) * abx + (z - a.z) * abz) / l2;
          u = saturate(u);
          const px = a.x + abx * u - x,
            pz = a.z + abz * u - z;
          const dd = Math.sqrt(px * px + pz * pz);
          const idx = j * N + i;
          if (dd < d[idx]) {
            d[idx] = dd;
            t[idx] = (spline.cum[k] + segLen * u) / spline.length;
          }
        }
      }
    }
    return { d, t };
  }

  /** Natural terrain before carving features. */
  baseHeight(x: number, z: number, detail = 1): number {
    const n = this.noise;
    const wx = x + 45 * n.noise2(x / 520, z / 520);
    const wz = z + 45 * n.noise2(x / 520 + 17.3, z / 520 - 9.1);
    let h = 31;
    h += 13 * n.fbm2(wx / 430, wz / 430, 4);
    h += 4.2 * n.fbm2(wx / 115, wz / 115, 3);
    h += 1.1 * detail * n.fbm2(x / 28, z / 28, 2);
    h -= 0.0105 * (-x + z); // valley tilts down toward the south-west
    // Mountain ring, taller to the north: broad massifs + eroded ridges.
    const r = Math.hypot(x * 0.95, z * 1.05) + 110 * n.noise2(x / 380, z / 380);
    const m = smoothstep(470, 980, r);
    if (m > 0) {
      const north = smoothstep(100, -900, z);
      const big = n.fbm2(wx / 650 + 11, wz / 650 - 4, 3) * 0.5 + 0.5;
      const ridge = n.ridged2(wx / 260 + 3.1, wz / 260 - 1.7, 5);
      const mass = Math.pow(m, 1.6) * (70 + 300 * big * (0.55 + 0.75 * north));
      h += mass + m * ridge * (40 + 110 * north) + m * 14 * n.fbm2(x / 70, z / 70, 3);
    }
    // Rolling foothills east and west of the valley.
    const hills = smoothstep(260, 520, Math.abs(x + 30 * n.noise2(z / 200, 5))) * smoothstep(-700, 200, z);
    h += hills * (18 + 22 * n.fbm2(x / 160 + 9, z / 160, 3));
    return h;
  }

  lakeRadius(angle: number) {
    const n = this.noise;
    let R = LAKE.radius + 24 * n.noise2(Math.cos(angle) * 1.4 + 40, Math.sin(angle) * 1.4) + 10 * n.noise2(Math.cos(angle) * 4, Math.sin(angle) * 4 + 7);
    // North shore butts against the waterfall cliff.
    const dz = Math.sin(angle);
    if (dz < -0.05) R = Math.min(R, (WATERFALL.baseZ - 2 - LAKE.z) / dz);
    return R;
  }

  private composeHeight(x: number, z: number, idx: number, sitesH: number[]): number {
    const n = this.noise;
    const roadD = this.road.d[idx];
    const trailD = this.trail.d[idx];
    const detail = smoothstep(2, 10, Math.min(roadD, trailD * 1.6));
    let h = this.baseHeight(x, z, detail);

    // Monster meadow: soften.
    const md = Math.hypot(x - MONSTER_MEADOW.x, z - MONSTER_MEADOW.z);
    if (md < 90) h = lerp(h, h * 0.85 + 0.15 * this.baseHeight(MONSTER_MEADOW.x, MONSTER_MEADOW.z, 0), smoothstep(90, 30, md));

    // Highland shelf north of the lake with a sheer cliff for the waterfall.
    const xm = 1 - smoothstep(170, 360, Math.abs(x - WATERFALL.x) + 40 * n.noise2(z / 90, 3.3));
    if (xm > 0) {
      const cliffJitter = 5 * n.noise2(x / 22, 1.7) + 2 * n.noise2(x / 7, 4.2);
      const shelf = smoothstep(WATERFALL.baseZ + 4 + cliffJitter, WATERFALL.z - 2 + cliffJitter, z);
      const highland = WATERFALL.top + 6 + 10 * n.fbm2(x / 140, z / 140, 3) + smoothstep(-480, -700, z) * 40;
      const target = Math.max(h, highland);
      h = lerp(h, target, shelf * xm);
    }

    // Plunge notch carved into the cliff behind the waterfall sheet.
    const wfx = Math.abs(x - WATERFALL.x);
    if (wfx < 22 && z > WATERFALL.z - 6 && z < WATERFALL.baseZ + 6) {
      const sheetY = waterfallSheetY(z);
      const k = smoothstep(22, 9, wfx);
      if (sheetY !== null) h = Math.min(h, lerp(h, sheetY - 4.5, k));
    }

    // Lake basin.
    const lx = x - LAKE.x,
      lz = z - LAKE.z;
    const ld = Math.hypot(lx, lz);
    if (ld < LAKE.radius + 160) {
      const R = this.lakeRadius(Math.atan2(lz, lx));
      const northness = saturate(-lz / (ld + 1e-3));
      const shoreW = lerp(85, 14, northness);
      if (ld < R) {
        const deep = smoothstep(R, R - 80, ld);
        h = Math.min(h, lerp(LAKE.level + 0.6, 3.5, deep) + 1.2 * n.noise2(x / 40, z / 40));
      } else if (ld < R + shoreW) {
        const k = Math.pow(smoothstep(R, R + shoreW, ld), 0.8);
        const beach = LAKE.level + 0.7;
        if (h > beach) h = lerp(beach, h, k);
      }
    }

    // Upper river gorge feeding the waterfall.
    const ud = this.upper.d[idx];
    if (ud < 60) {
      const bed = upperBedAt(this.upper.t[idx]);
      const k = smoothstep(4, 30, ud);
      const carved = lerp(bed, Math.max(h, bed + 3), k);
      if (ud < 4.5) h = bed;
      else h = Math.min(h, carved + 2 * k);
    }

    // Lake outflow stream valley.
    const sd = this.stream.d[idx];
    if (sd < 70) {
      const bed = streamBedAt(this.stream.t[idx]);
      const w = 6.5 + 2.0 * n.noise2(this.stream.t[idx] * 40, 1);
      const k = smoothstep(w, 40, sd);
      const valley = lerp(bed, h, Math.pow(k, 0.75));
      h = Math.min(h, sd < w ? bed : valley);
    }

    // Roads sit slightly into the ground.
    h -= 0.35 * smoothstep(5, 1.5, roadD) + 0.2 * smoothstep(2.6, 0.8, trailD);

    // Ruins arena plateau right at the lake shore.
    const ad = Math.hypot(x - ARENA.x, z - ARENA.z);
    if (ad < ARENA.radius + 40) {
      const plate = smoothstep(ARENA.radius + 36, ARENA.radius - 2, ad);
      // Keep the lake side as a drop into the water.
      h = lerp(h, ARENA.height, plate);
    }

    // Small pads under the scattered ruins.
    for (let s = 0; s < RUIN_SITES.length; s++) {
      const site = RUIN_SITES[s];
      const dd = Math.hypot(x - site.x, z - site.z);
      if (dd < 26) h = lerp(h, sitesH[s], smoothstep(26, 9, dd));
    }
    return h;
  }

  private computeNormals() {
    const N = this.res;
    const h = this.heights;
    const nm = this.normals;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const hl = h[j * N + Math.max(0, i - 1)],
          hr = h[j * N + Math.min(N - 1, i + 1)];
        const hd = h[Math.max(0, j - 1) * N + i],
          hu = h[Math.min(N - 1, j + 1) * N + i];
        let nx = hl - hr,
          ny = 2 * HF_CELL,
          nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const o = (j * N + i) * 4;
        nm[o] = (nx * 0.5 + 0.5) * 255;
        nm[o + 1] = (ny * 0.5 + 0.5) * 255;
        nm[o + 2] = (nz * 0.5 + 0.5) * 255;
        nm[o + 3] = saturate(1 - ny) * 255;
      }
    }
  }

  private computeSplat() {
    const N = this.res;
    const n = this.noise;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * HF_CELL;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * HF_CELL;
        const idx = j * N + i;
        const o = idx * 4;
        const hh = this.heights[idx];
        const slope = this.normals[o + 3] / 255;
        const roadD = this.road.d[idx] + 1.2 * n.noise2(x / 6, z / 6);
        const trailD = this.trail.d[idx] + 0.8 * n.noise2(x / 5, z / 5);
        const path = Math.max(smoothstep(4.6, 2.2, roadD), 0.85 * smoothstep(2.4, 1.0, trailD));
        const sd = this.stream.d[idx];
        const ud = this.upper.d[idx];
        const lakeWet = smoothstep(LAKE.level + 2.5, LAKE.level + 0.4, hh);
        const wet = Math.max(lakeWet, smoothstep(9, 3, sd), smoothstep(9, 4, ud));
        const ad = Math.hypot(x - ARENA.x, z - ARENA.z);
        const arenaStone = smoothstep(ARENA.radius + 2, ARENA.radius - 3, ad);
        const rock = smoothstep(0.32, 0.5, slope);
        const snow = smoothstep(230, 300, hh + 25 * n.noise2(x / 60, z / 60));
        let grass = 1 - Math.max(path, rock, arenaStone * 0.95, snow, smoothstep(0.4, 0.9, lakeWet));
        grass *= smoothstep(LAKE.level - 0.2, LAKE.level + 0.9, hh);
        grass *= 0.75 + 0.25 * smoothstep(-0.3, 0.4, n.fbm2(x / 70, z / 70, 2));
        const flowers = saturate(smoothstep(0.15, 0.55, n.fbm2(x / 55 + 30, z / 55, 3))) * grass * (1 - wet);
        this.splat[o] = path * 255;
        this.splat[o + 1] = wet * 255;
        this.splat[o + 2] = saturate(grass) * 255;
        this.splat[o + 3] = arenaStone > 0.5 ? 0 : flowers * 255;
      }
    }
  }

  // --- queries --------------------------------------------------------------

  private sampleF(arr: Float32Array, x: number, z: number): number {
    const N = this.res;
    const fx = clamp((x + HALF) / HF_CELL, 0, N - 1.001);
    const fz = clamp((z + HALF) / HF_CELL, 0, N - 1.001);
    const i = Math.floor(fx),
      j = Math.floor(fz);
    const u = fx - i,
      v = fz - j;
    const a = arr[j * N + i],
      b = arr[j * N + i + 1],
      c = arr[(j + 1) * N + i],
      d = arr[(j + 1) * N + i + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  height(x: number, z: number): number {
    return this.sampleF(this.heights, x, z);
  }

  normal(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = 1.0;
    const hl = this.height(x - e, z),
      hr = this.height(x + e, z);
    const hd = this.height(x, z - e),
      hu = this.height(x, z + e);
    let nx = hl - hr,
      ny = 2 * e,
      nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
    return out;
  }

  splatAt(x: number, z: number, channel: number): number {
    const N = this.res;
    const i = clamp(Math.round((x + HALF) / HF_CELL), 0, N - 1);
    const j = clamp(Math.round((z + HALF) / HF_CELL), 0, N - 1);
    return this.splat[(j * N + i) * 4 + channel] / 255;
  }

  /** Water surface height at a point, or -Infinity if dry. */
  waterHeight(x: number, z: number): number {
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (ld < LAKE.radius + 60) return LAKE.level;
    const N = this.res;
    const i = clamp(Math.round((x + HALF) / HF_CELL), 0, N - 1);
    const j = clamp(Math.round((z + HALF) / HF_CELL), 0, N - 1);
    const idx = j * N + i;
    if (this.stream.d[idx] < 12) return streamBedAt(this.stream.t[idx]) + 1.3;
    if (this.upper.d[idx] < 9) return upperBedAt(this.upper.t[idx]) + 1.0;
    return -Infinity;
  }

  surface(x: number, z: number): Surface {
    const h = this.height(x, z);
    if (this.waterHeight(x, z) > h + 0.08) return 'water';
    const ad = Math.hypot(x - ARENA.x, z - ARENA.z);
    if (ad < ARENA.radius) return 'stone';
    for (const s of RUIN_SITES) if (Math.hypot(x - s.x, z - s.z) < 9) return 'stone';
    if (this.splatAt(x, z, 0) > 0.45) return 'dirt';
    const nm = this.normals[(clamp(Math.round((z + HALF) / HF_CELL), 0, this.res - 1) * this.res + clamp(Math.round((x + HALF) / HF_CELL), 0, this.res - 1)) * 4 + 3] / 255;
    if (nm > 0.4) return 'stone';
    if (this.splatAt(x, z, 1) > 0.55) return 'sand';
    return 'grass';
  }

  /** Simple ray march against the heightfield (for camera collision etc). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    let t = 0;
    const step = 0.5;
    while (t < maxDist) {
      const x = ox + dx * t,
        y = oy + dy * t,
        z = oz + dz * t;
      if (y < this.height(x, z)) return t;
      t += step;
    }
    return maxDist;
  }
}
