// Signed-distance-field sculpting + Surface Nets meshing + automatic skin weights.
// Characters and creatures are authored as lists of smooth-blended primitives,
// each bound to a bone and carrying a material. The mesher produces a smooth,
// closed, skinnable mesh with per-vertex material attributes.

export type Vec3 = [number, number, number];

export interface MaterialDef {
  color: Vec3; // linear RGB
  rough: number;
  metal: number;
  /** 0 skin, 1 cloth/knit, 2 leather, 3 metal, 4 hair, 5 feather, 6 scale/chitin, 7 emissive, 8 horn/bone, 9 eye */
  kind: number;
  emissive?: number;
  sheen?: number;
}

interface PrimBase {
  op?: 'add' | 'sub' | 'paint';
  k?: number; // smooth blend radius
  mat: string;
  bone: string;
  bone2?: string; // optional linear blend along a capsule toward a second bone
}

export type Prim =
  | (PrimBase & { type: 'sphere'; c: Vec3; r: number })
  | (PrimBase & { type: 'ellipsoid'; c: Vec3; r: Vec3; rot?: Vec3 })
  | (PrimBase & { type: 'capsule'; a: Vec3; b: Vec3; ra: number; rb: number })
  | (PrimBase & { type: 'box'; c: Vec3; h: Vec3; round: number; rot?: Vec3 })
  | (PrimBase & { type: 'torus'; c: Vec3; R: number; r: number; rot?: Vec3 })
  | (PrimBase & { type: 'cone'; a: Vec3; b: Vec3; ra: number; rb: number; bend?: Vec3 })
  /** A strap/belt hugging an ellipsoid: shell of thickness t, cut by a slab (plane through c with normal n, half-width w). */
  | (PrimBase & { type: 'band'; c: Vec3; r: Vec3; n: Vec3; w: number; t: number; off?: Vec3 });

interface Compiled {
  p: Prim;
  op: 0 | 1 | 2;
  k: number;
  min: Vec3;
  max: Vec3;
  inv: Float64Array | null; // inverse rotation matrix (3x3) for rotated prims
  eval: (x: number, y: number, z: number) => number;
  mat: number;
  bone: number;
  bone2: number;
  // capsule axis for bone2 blending
  ax?: Vec3;
  bx?: Vec3;
}

function rotMatrix(rot: Vec3): Float64Array {
  const [x, y, z] = rot;
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  // R = Ry * Rx * Rz  (YXZ order) -> we store the inverse (transpose)
  const m = new Float64Array(9);
  const r00 = cy * cz + sy * sx * sz,
    r01 = -cy * sz + sy * sx * cz,
    r02 = sy * cx;
  const r10 = cx * sz,
    r11 = cx * cz,
    r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz,
    r21 = sy * sz + cy * sx * cz,
    r22 = cy * cx;
  // transpose
  m[0] = r00;
  m[1] = r10;
  m[2] = r20;
  m[3] = r01;
  m[4] = r11;
  m[5] = r21;
  m[6] = r02;
  m[7] = r12;
  m[8] = r22;
  return m;
}

function sdCapsule(x: number, y: number, z: number, a: Vec3, b: Vec3, ra: number, rb: number) {
  // Round cone (capsule with varying radius).
  const bax = b[0] - a[0],
    bay = b[1] - a[1],
    baz = b[2] - a[2];
  const pax = x - a[0],
    pay = y - a[1],
    paz = z - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const qx = pax * l2 - bax * yy,
    qy = pay * l2 - bay * yy,
    qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
}

function compile(p: Prim, matIndex: Map<string, number>, boneIndex: Map<string, number>): Compiled {
  const op = p.op === 'sub' ? 1 : p.op === 'paint' ? 2 : 0;
  const k = p.k ?? 0.0;
  let min: Vec3 = [0, 0, 0],
    max: Vec3 = [0, 0, 0];
  let inv: Float64Array | null = null;
  let evalFn: (x: number, y: number, z: number) => number;
  switch (p.type) {
    case 'sphere': {
      const [cx, cy, cz] = p.c,
        r = p.r;
      evalFn = (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
      min = [cx - r, cy - r, cz - r];
      max = [cx + r, cy + r, cz + r];
      break;
    }
    case 'ellipsoid': {
      const [cx, cy, cz] = p.c;
      const [rx, ry, rz] = p.r;
      if (p.rot) inv = rotMatrix(p.rot);
      const m = inv;
      evalFn = (x, y, z) => {
        let dx = x - cx,
          dy = y - cy,
          dz = z - cz;
        if (m) {
          const tx = m[0] * dx + m[1] * dy + m[2] * dz;
          const ty = m[3] * dx + m[4] * dy + m[5] * dz;
          const tz = m[6] * dx + m[7] * dy + m[8] * dz;
          dx = tx;
          dy = ty;
          dz = tz;
        }
        const k0 = Math.hypot(dx / rx, dy / ry, dz / rz);
        const k1 = Math.hypot(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz));
        return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
      };
      const R = Math.max(rx, ry, rz);
      min = [cx - R, cy - R, cz - R];
      max = [cx + R, cy + R, cz + R];
      break;
    }
    case 'capsule':
    case 'cone': {
      const { a, ra, rb } = p;
      let b = p.b;
      evalFn = (x, y, z) => sdCapsule(x, y, z, a, b, ra, rb);
      if (p.type === 'cone' && p.bend) {
        // Curved spike: two round-cone segments through a bent midpoint.
        const mid: Vec3 = [(a[0] + b[0]) / 2 + p.bend[0], (a[1] + b[1]) / 2 + p.bend[1], (a[2] + b[2]) / 2 + p.bend[2]];
        const rm = (ra + rb) / 2;
        const bb = b;
        evalFn = (x, y, z) => Math.min(sdCapsule(x, y, z, a, mid, ra, rm), sdCapsule(x, y, z, mid, bb, rm, rb));
        b = bb;
      }
      const R = Math.max(ra, rb) + (p.type === 'cone' && p.bend ? Math.hypot(...p.bend) : 0);
      min = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
      max = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
      break;
    }
    case 'box': {
      const [cx, cy, cz] = p.c;
      const [hx, hy, hz] = p.h;
      const rd = p.round;
      if (p.rot) inv = rotMatrix(p.rot);
      const m = inv;
      evalFn = (x, y, z) => {
        let dx = x - cx,
          dy = y - cy,
          dz = z - cz;
        if (m) {
          const tx = m[0] * dx + m[1] * dy + m[2] * dz;
          const ty = m[3] * dx + m[4] * dy + m[5] * dz;
          const tz = m[6] * dx + m[7] * dy + m[8] * dz;
          dx = tx;
          dy = ty;
          dz = tz;
        }
        const qx = Math.abs(dx) - hx + rd,
          qy = Math.abs(dy) - hy + rd,
          qz = Math.abs(dz) - hz + rd;
        const ox = Math.max(qx, 0),
          oy = Math.max(qy, 0),
          oz = Math.max(qz, 0);
        return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - rd;
      };
      const R = Math.hypot(hx, hy, hz);
      min = [cx - R, cy - R, cz - R];
      max = [cx + R, cy + R, cz + R];
      break;
    }
    case 'band': {
      const [cx, cy, cz] = p.c;
      const [rx, ry, rz] = p.r;
      const nl = Math.hypot(...p.n);
      const nx = p.n[0] / nl,
        ny = p.n[1] / nl,
        nz = p.n[2] / nl;
      const o = p.off ?? p.c;
      const t = p.t,
        w = p.w;
      evalFn = (x, y, z) => {
        const dx = x - cx,
          dy = y - cy,
          dz = z - cz;
        const k0 = Math.hypot(dx / rx, dy / ry, dz / rz);
        const k1 = Math.hypot(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz));
        const e = k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
        const shell = Math.abs(e - t) - t;
        const slab = Math.abs((x - o[0]) * nx + (y - o[1]) * ny + (z - o[2]) * nz) - w;
        return Math.max(shell, slab);
      };
      const R = Math.max(rx, ry, rz) + t * 2;
      min = [cx - R, cy - R, cz - R];
      max = [cx + R, cy + R, cz + R];
      break;
    }
    case 'torus': {
      const [cx, cy, cz] = p.c;
      const { R, r } = p;
      if (p.rot) inv = rotMatrix(p.rot);
      const m = inv;
      evalFn = (x, y, z) => {
        let dx = x - cx,
          dy = y - cy,
          dz = z - cz;
        if (m) {
          const tx = m[0] * dx + m[1] * dy + m[2] * dz;
          const ty = m[3] * dx + m[4] * dy + m[5] * dz;
          const tz = m[6] * dx + m[7] * dy + m[8] * dz;
          dx = tx;
          dy = ty;
          dz = tz;
        }
        const q = Math.hypot(dx, dz) - R;
        return Math.hypot(q, dy) - r;
      };
      const E = R + r;
      min = [cx - E, cy - E, cz - E];
      max = [cx + E, cy + E, cz + E];
      break;
    }
  }
  if (!matIndex.has(p.mat)) throw new Error('unknown material ' + p.mat);
  if (!boneIndex.has(p.bone)) throw new Error('unknown bone ' + p.bone);
  const c: Compiled = {
    p,
    op,
    k,
    min,
    max,
    inv,
    eval: evalFn!,
    mat: matIndex.get(p.mat)!,
    bone: boneIndex.get(p.bone)!,
    bone2: p.bone2 ? boneIndex.get(p.bone2)! : -1,
  };
  if (p.type === 'capsule' && p.bone2) {
    c.ax = p.a;
    c.bx = p.b;
  }
  return c;
}

const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

function boxDist(x: number, y: number, z: number, mn: Vec3, mx: Vec3) {
  const dx = Math.max(mn[0] - x, 0, x - mx[0]);
  const dy = Math.max(mn[1] - y, 0, y - mx[1]);
  const dz = Math.max(mn[2] - z, 0, z - mx[2]);
  return Math.hypot(dx, dy, dz);
}

export interface SdfModel {
  prims: Prim[];
  materials: Record<string, MaterialDef>;
  bones: string[];
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array; // rgb
  pbr: Float32Array; // rough, metal, kind, emissive
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
}

export class SdfEvaluator {
  readonly comp: Compiled[];
  readonly mats: MaterialDef[];
  constructor(model: SdfModel) {
    const matIndex = new Map<string, number>();
    const mats: MaterialDef[] = [];
    for (const [name, m] of Object.entries(model.materials)) {
      matIndex.set(name, mats.length);
      mats.push(m);
    }
    const boneIndex = new Map<string, number>();
    model.bones.forEach((b, i) => boneIndex.set(b, i));
    this.comp = model.prims.map((p) => compile(p, matIndex, boneIndex));
    this.mats = mats;
    this.buildBuckets();
  }

  // Spatial buckets: each lists (in authoring order) the primitives whose
  // bounds, expanded by blend radius + margin, overlap the bucket.
  private bMin: Vec3 = [0, 0, 0];
  private bSize = 0.2;
  private bN: Vec3 = [1, 1, 1];
  private buckets: Compiled[][] = [];
  private readonly margin = 0.25;
  private buildBuckets() {
    const bb = this.bounds();
    const ext = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
    this.bSize = Math.max(0.05, ext / 40);
    for (let a = 0; a < 3; a++) {
      this.bMin[a] = bb.min[a] - this.margin;
      this.bN[a] = Math.max(1, Math.ceil((bb.max[a] - bb.min[a] + this.margin * 2) / this.bSize));
    }
    const [nx, ny, nz] = this.bN;
    this.buckets = Array.from({ length: nx * ny * nz }, () => []);
    for (const c of this.comp) {
      const m = c.k + this.margin;
      const i0 = Math.max(0, Math.floor((c.min[0] - m - this.bMin[0]) / this.bSize)),
        i1 = Math.min(nx - 1, Math.floor((c.max[0] + m - this.bMin[0]) / this.bSize));
      const j0 = Math.max(0, Math.floor((c.min[1] - m - this.bMin[1]) / this.bSize)),
        j1 = Math.min(ny - 1, Math.floor((c.max[1] + m - this.bMin[1]) / this.bSize));
      const k0 = Math.max(0, Math.floor((c.min[2] - m - this.bMin[2]) / this.bSize)),
        k1 = Math.min(nz - 1, Math.floor((c.max[2] + m - this.bMin[2]) / this.bSize));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.buckets[(k * ny + j) * nx + i].push(c);
    }
  }

  listAt(x: number, y: number, z: number): Compiled[] | null {
    const i = Math.floor((x - this.bMin[0]) / this.bSize),
      j = Math.floor((y - this.bMin[1]) / this.bSize),
      k = Math.floor((z - this.bMin[2]) / this.bSize);
    if (i < 0 || j < 0 || k < 0 || i >= this.bN[0] || j >= this.bN[1] || k >= this.bN[2]) return null;
    return this.buckets[(k * this.bN[1] + j) * this.bN[0] + i];
  }

  dist(x: number, y: number, z: number): number {
    let d = this.margin * 1.5;
    const comp = this.listAt(x, y, z);
    if (!comp || comp.length === 0) return this.margin * 1.5;
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i];
      if (c.op === 2) continue;
      if (c.op === 0) {
        const bd = boxDist(x, y, z, c.min, c.max);
        if (bd >= d + c.k) continue;
        d = smin(d, c.eval(x, y, z), c.k);
      } else {
        const bd = boxDist(x, y, z, c.min, c.max);
        if (bd > c.k) continue;
        d = smax(d, -c.eval(x, y, z), c.k);
      }
    }
    return d;
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [1e9, 1e9, 1e9],
      max: Vec3 = [-1e9, -1e9, -1e9];
    for (const c of this.comp) {
      if (c.op !== 0) continue;
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], c.min[a] - c.k);
        max[a] = Math.max(max[a], c.max[a] + c.k);
      }
    }
    return { min, max };
  }
}

/** Surface Nets meshing of the model; returns skinnable mesh data. */
export type MeshOpts = { weightSigma?: number; smooth?: number; region?: { min: Vec3; max: Vec3 } };
export interface MeshJob {
  model: SdfModel;
  cell: number;
  opts?: MeshOpts;
}

// Meshes pre-built off the main thread (see sdfPool.ts), keyed by their inputs.
const meshCache = new Map<string, MeshData>();
export const meshJobKey = (j: MeshJob) => JSON.stringify([j.cell, j.opts ?? {}, j.model]);
export function primeMesh(key: string, data: MeshData) {
  meshCache.set(key, data);
}

/** Mesh an SDF model, using a pre-built result when one matches exactly. */
export function meshSdf(model: SdfModel, cell: number, opts: MeshOpts = {}): MeshData {
  const key = meshJobKey({ model, cell, opts });
  const hit = meshCache.get(key);
  if (hit) {
    meshCache.delete(key);
    return hit;
  }
  return meshSdfRaw(model, cell, opts);
}

export function meshSdfRaw(model: SdfModel, cell: number, opts: MeshOpts = {}): MeshData {
  const ev = new SdfEvaluator(model);
  const b = opts.region ?? ev.bounds();
  const pad = cell * 2;
  const ox = b.min[0] - pad,
    oy = b.min[1] - pad,
    oz = b.min[2] - pad;
  const nx = Math.ceil((b.max[0] - b.min[0] + pad * 2) / cell) + 1;
  const ny = Math.ceil((b.max[1] - b.min[1] + pad * 2) / cell) + 1;
  const nz = Math.ceil((b.max[2] - b.min[2] + pad * 2) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const I = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // Coarse-to-fine: evaluate on a coarse lattice first to skip empty regions.
  const blk = 4;
  for (let k0 = 0; k0 < nz; k0 += blk)
    for (let j0 = 0; j0 < ny; j0 += blk)
      for (let i0 = 0; i0 < nx; i0 += blk) {
        const cx = ox + (i0 + blk / 2) * cell,
          cy = oy + (j0 + blk / 2) * cell,
          cz = oz + (k0 + blk / 2) * cell;
        const dc = ev.dist(cx, cy, cz);
        const reach = blk * cell * 0.9;
        const far = Math.abs(dc) > reach + cell;
        for (let k = k0; k < Math.min(nz, k0 + blk); k++)
          for (let j = j0; j < Math.min(ny, j0 + blk); j++)
            for (let i = i0; i < Math.min(nx, i0 + blk); i++) {
              field[I(i, j, k)] = far ? dc : ev.dist(ox + i * cell, oy + j * cell, oz + k * cell);
            }
      }

  // Vertex per surface cell.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const C = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const verts: number[] = [];
  const corner = new Float32Array(8);
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cornerOff = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const o = cornerOff[c];
          corner[c] = field[I(i + o[0], j + o[1], k + o[2])];
          if (corner[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [a, bb] of edges) {
          const da = corner[a],
            db = corner[bb];
          if (da < 0 === db < 0) continue;
          const t = da / (da - db);
          const oa = cornerOff[a],
            ob = cornerOff[bb];
          sx += oa[0] + (ob[0] - oa[0]) * t;
          sy += oa[1] + (ob[1] - oa[1]) * t;
          sz += oa[2] + (ob[2] - oa[2]) * t;
          n++;
        }
        cellVert[C(i, j, k)] = verts.length / 3;
        verts.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
      }

  // Quads for each sign-changing edge.
  const idx: number[] = [];
  const quad = (a: number, b2: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, b2, c, b2, d, c);
    else idx.push(a, c, b2, b2, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const d0 = field[I(i, j, k)],
          d1 = field[I(i + 1, j, k)];
        if (d0 < 0 === d1 < 0) continue;
        quad(cellVert[C(i, j - 1, k - 1)], cellVert[C(i, j, k - 1)], cellVert[C(i, j - 1, k)], cellVert[C(i, j, k)], d0 < 0);
      }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const d0 = field[I(i, j, k)],
          d1 = field[I(i, j + 1, k)];
        if (d0 < 0 === d1 < 0) continue;
        quad(cellVert[C(i - 1, j, k - 1)], cellVert[C(i - 1, j, k)], cellVert[C(i, j, k - 1)], cellVert[C(i, j, k)], d0 < 0);
      }
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const d0 = field[I(i, j, k)],
          d1 = field[I(i, j, k + 1)];
        if (d0 < 0 === d1 < 0) continue;
        quad(cellVert[C(i - 1, j - 1, k)], cellVert[C(i, j - 1, k)], cellVert[C(i - 1, j, k)], cellVert[C(i, j, k)], d0 < 0);
      }

  const vc = verts.length / 3;
  const pos = new Float32Array(verts);

  // Project vertices onto the surface (one Newton step) and compute gradient normals.
  const nrm = new Float32Array(vc * 3);
  const e = cell * 0.25;
  const grad = (x: number, y: number, z: number, out: Float32Array, o: number) => {
    const gx = ev.dist(x + e, y, z) - ev.dist(x - e, y, z);
    const gy = ev.dist(x, y + e, z) - ev.dist(x, y - e, z);
    const gz = ev.dist(x, y, z + e) - ev.dist(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[o] = gx / l;
    out[o + 1] = gy / l;
    out[o + 2] = gz / l;
  };
  for (let v = 0; v < vc; v++) {
    const o = v * 3;
    const x = pos[o],
      y = pos[o + 1],
      z = pos[o + 2];
    grad(x, y, z, nrm, o);
    const d = ev.dist(x, y, z);
    pos[o] = x - nrm[o] * d;
    pos[o + 1] = y - nrm[o + 1] * d;
    pos[o + 2] = z - nrm[o + 2] * d;
    grad(pos[o], pos[o + 1], pos[o + 2], nrm, o);
  }

  // Materials + skin weights from per-primitive proximity.
  const colors = new Float32Array(vc * 3);
  const pbr = new Float32Array(vc * 4);
  const skinIndex = new Uint16Array(vc * 4);
  const skinWeight = new Float32Array(vc * 4);
  const sigma = opts.weightSigma ?? 0.035;
  const boneW = new Float32Array(model.bones.length);
  const comp = ev.comp;
  for (let v = 0; v < vc; v++) {
    const o = v * 3;
    const x = pos[o],
      y = pos[o + 1],
      z = pos[o + 2];
    let best = 1e9,
      bestMat = 0;
    boneW.fill(0);
    for (const c of ev.listAt(x, y, z) ?? comp) {
      if (c.op === 1) continue;
      const bd = boxDist(x, y, z, c.min, c.max);
      if (c.op === 2) {
        if (bd > 0.001) continue;
        const d = c.eval(x, y, z);
        if (d < 0) bestMat = c.mat, (best = -1e9);
        continue;
      }
      if (bd > sigma * 6 && bd > best + 0.02) continue;
      const d = c.eval(x, y, z);
      if (d < best && best > -1e8) {
        best = d;
        bestMat = c.mat;
      }
      const w = Math.exp(-Math.max(d, 0) / sigma) * (d < sigma * 6 ? 1 : 0);
      if (w <= 1e-4) continue;
      if (c.bone2 >= 0 && c.ax && c.bx) {
        const ax = c.ax,
          bx = c.bx;
        const abx = bx[0] - ax[0],
          aby = bx[1] - ax[1],
          abz = bx[2] - ax[2];
        const t = Math.min(1, Math.max(0, ((x - ax[0]) * abx + (y - ax[1]) * aby + (z - ax[2]) * abz) / (abx * abx + aby * aby + abz * abz)));
        const tt = t * t * (3 - 2 * t);
        boneW[c.bone] += w * (1 - tt);
        boneW[c.bone2] += w * tt;
      } else boneW[c.bone] += w;
    }
    // Top 4 bones.
    const top: [number, number][] = [];
    for (let bi = 0; bi < boneW.length; bi++) if (boneW[bi] > 0) top.push([bi, boneW[bi]]);
    top.sort((a, b2) => b2[1] - a[1]);
    let sum = 0;
    for (let q = 0; q < 4 && q < top.length; q++) sum += top[q][1];
    if (sum <= 0) {
      skinIndex[v * 4] = 0;
      skinWeight[v * 4] = 1;
    } else
      for (let q = 0; q < 4; q++) {
        if (q < top.length) {
          skinIndex[v * 4 + q] = top[q][0];
          skinWeight[v * 4 + q] = top[q][1] / sum;
        }
      }
    const m = ev.mats[bestMat];
    colors[o] = m.color[0];
    colors[o + 1] = m.color[1];
    colors[o + 2] = m.color[2];
    pbr[v * 4] = m.rough;
    pbr[v * 4 + 1] = m.metal;
    pbr[v * 4 + 2] = m.kind;
    pbr[v * 4 + 3] = m.emissive ?? 0;
  }

  // Optional tangential Laplacian smoothing (keeps silhouettes, removes stair-steps).
  const smoothIters = opts.smooth ?? 1;
  if (smoothIters > 0) {
    const nb: number[][] = Array.from({ length: vc }, () => []);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t],
        b2 = idx[t + 1],
        c = idx[t + 2];
      nb[a].push(b2, c);
      nb[b2].push(a, c);
      nb[c].push(a, b2);
    }
    const tmp = new Float32Array(pos.length);
    for (let it = 0; it < smoothIters; it++) {
      for (let v = 0; v < vc; v++) {
        const o = v * 3;
        const list = nb[v];
        if (!list.length) {
          tmp[o] = pos[o];
          tmp[o + 1] = pos[o + 1];
          tmp[o + 2] = pos[o + 2];
          continue;
        }
        let ax = 0,
          ay = 0,
          az = 0;
        for (const q of list) {
          ax += pos[q * 3];
          ay += pos[q * 3 + 1];
          az += pos[q * 3 + 2];
        }
        ax /= list.length;
        ay /= list.length;
        az /= list.length;
        let dx = ax - pos[o],
          dy = ay - pos[o + 1],
          dz = az - pos[o + 2];
        const nd = dx * nrm[o] + dy * nrm[o + 1] + dz * nrm[o + 2];
        dx -= nd * nrm[o];
        dy -= nd * nrm[o + 1];
        dz -= nd * nrm[o + 2];
        tmp[o] = pos[o] + dx * 0.5;
        tmp[o + 1] = pos[o + 1] + dy * 0.5;
        tmp[o + 2] = pos[o + 2] + dz * 0.5;
      }
      pos.set(tmp);
    }
  }

  return { positions: pos, normals: nrm, colors, pbr, skinIndex, skinWeight, index: new Uint32Array(idx) };
}
