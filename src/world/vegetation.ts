// Procedural trees, bushes and rocks: geometry generated at load, instanced with
// two LODs, wind-animated in the vertex shader, placed from ecological rules.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn,
  vec3,
  vec4,
  float,
  attribute,
  positionLocal,
  positionWorld,
  cameraPosition,
  texture,
  uv,
  sin,
  mix,
  smoothstep,
  saturate,
  normalize,
  dot,
  pow,
  mx_noise_float,
  mx_fractal_noise_float,
  normalWorld,
  cameraViewMatrix,
  instanceIndex,
  hash,
  uint,
  step,
  distance,
  screenCoordinate,
  interleavedGradientNoise,
} from 'three/tsl';
import { RNG, Simplex, smoothstep as ss, clamp } from '../core/math';
import { U } from '../core/env';
import type { Heightfield } from './heightfield';
import { ARENA, RUIN_SITES, LAKE, HALF, PLAYER_START, MONSTER_MEADOW } from './layout';

// ---------------------------------------------------------------------------
// Textures (painted procedurally on canvases)
// ---------------------------------------------------------------------------
function leafTexture(kind: 'broad' | 'needle' | 'bush'): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const rng = new RNG(kind === 'broad' ? 11 : kind === 'needle' ? 23 : 37);
  if (kind === 'needle') {
    // Drooping fir bough: central twig with dense needles.
    for (let b = 0; b < 3; b++) {
      const bx = S * (0.3 + 0.2 * b),
        droop = 0.2 + 0.1 * b;
      g.strokeStyle = 'rgb(60,45,30)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(bx, 6);
      g.quadraticCurveTo(bx + S * 0.05, S * 0.5, bx + S * droop * 0.3, S - 6);
      g.stroke();
      for (let i = 0; i < 260; i++) {
        const t = rng.next();
        const x = bx + S * droop * 0.3 * t * t + (rng.next() - 0.5) * S * (0.35 * (1 - t * 0.5));
        const y = 6 + (S - 12) * t;
        const len = 10 + rng.next() * 14;
        const a = Math.PI * 0.5 + (x > bx ? -0.9 : 0.9) + (rng.next() - 0.5) * 0.5;
        const sh = 40 + rng.next() * 50;
        g.strokeStyle = `rgb(${sh * 0.35 | 0},${(sh + 30) | 0},${sh * 0.45 | 0})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
    }
  } else {
    const n = kind === 'broad' ? 90 : 120;
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(rng.next()) * S * 0.42;
      const a = rng.next() * Math.PI * 2;
      const x = S / 2 + Math.cos(a) * r,
        y = S / 2 + Math.sin(a) * r;
      const len = kind === 'broad' ? 18 + rng.next() * 16 : 10 + rng.next() * 10;
      const wid = len * (kind === 'broad' ? 0.5 : 0.45);
      const rot = rng.next() * Math.PI * 2;
      const light = 0.7 + rng.next() * 0.5;
      const hue = rng.next();
      const rr = (kind === 'broad' ? 40 + hue * 50 : 50 + hue * 40) * light;
      const gg = (kind === 'broad' ? 85 + hue * 45 : 80 + hue * 50) * light;
      const bb = (kind === 'broad' ? 20 + hue * 15 : 25) * light;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
      g.beginPath();
      g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(20,40,10,0.5)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-len / 2, 0);
      g.lineTo(len / 2, 0);
      g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------
interface Branch {
  a: THREE.Vector3;
  b: THREE.Vector3;
  ra: number;
  rb: number;
}

function tubeFromBranches(branches: Branch[], radial: number, swayScale: number, heightRef: number) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  for (const br of branches) {
    const dir = tmp.subVectors(br.b, br.a).clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();
    const len = br.a.distanceTo(br.b);
    for (let e = 0; e < 2; e++) {
      const c = e === 0 ? br.a : br.b;
      const r = e === 0 ? br.ra : br.rb;
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        const n = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side2, Math.sin(ang));
        pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
        nrm.push(n.x, n.y, n.z);
        uvs.push(k / radial, e * len * 0.5);
        sway.push(Math.pow(clamp(c.y / heightRef, 0, 1), 2) * swayScale);
      }
    }
    for (let k = 0; k < radial; k++) {
      const a = base + k,
        b = base + k + 1,
        c = base + radial + 1 + k,
        d = base + radial + 2 + k;
      idx.push(a, c, b, b, c, d);
    }
    base += (radial + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  return g;
}

function cardsGeometry(
  cards: { p: THREE.Vector3; size: number; normal: THREE.Vector3; rot: number; droop?: number }[],
  crownCenter: THREE.Vector3,
  heightRef: number,
  swayScale: number,
) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (const c of cards) {
    const n = c.normal.clone().normalize();
    let t = new THREE.Vector3().crossVectors(n, up);
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0);
    t.normalize();
    let b = new THREE.Vector3().crossVectors(t, n).normalize();
    const cr = Math.cos(c.rot),
      sr = Math.sin(c.rot);
    const t2 = t.clone().multiplyScalar(cr).addScaledVector(b, sr);
    const b2 = b.clone().multiplyScalar(cr).addScaledVector(t, -sr);
    t = t2;
    b = b2;
    const h = c.size / 2;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [cx, cy] of corners) {
      const p = c.p.clone().addScaledVector(t, cx * h).addScaledVector(b, cy * h);
      if (c.droop && cy < 0) p.y -= c.droop * h;
      pos.push(p.x, p.y, p.z);
      // Spherical crown normal for volumetric shading.
      const sn = p.clone().sub(crownCenter).normalize().multiplyScalar(0.75).addScaledVector(n, 0.25).normalize();
      nrm.push(sn.x, sn.y, sn.z);
      uvs.push((cx + 1) / 2, (cy + 1) / 2);
      sway.push(Math.pow(clamp(p.y / heightRef, 0, 1), 1.5) * swayScale);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  return g;
}

interface TreeGeo {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkFar: THREE.BufferGeometry;
  leavesFar: THREE.BufferGeometry;
  height: number;
}

function growBroadleaf(seed: number): TreeGeo {
  const rng = new RNG(seed);
  const branches: Branch[] = [];
  const tips: { p: THREE.Vector3; d: THREE.Vector3; r: number }[] = [];
  const H = rng.range(9, 14);
  const grow = (p: THREE.Vector3, d: THREE.Vector3, len: number, r: number, depth: number) => {
    const segs = depth === 0 ? 5 : 3;
    let cur = p.clone();
    let dir = d.clone();
    for (let s = 0; s < segs; s++) {
      dir.x += rng.range(-0.25, 0.25);
      dir.z += rng.range(-0.25, 0.25);
      dir.y += depth === 0 ? 0.08 : 0.04;
      dir.normalize();
      const next = cur.clone().addScaledVector(dir, len / segs);
      const r1 = r * (1 - ((s + 1) / segs) * 0.45);
      branches.push({ a: cur, b: next, ra: r * (1 - (s / segs) * 0.45), rb: r1 });
      if (depth < 3 && s >= (depth === 0 ? 2 : 0)) {
        const nb = depth === 0 ? 2 : rng.int(1, 2);
        for (let k = 0; k < nb; k++) {
          const ang = rng.range(0, Math.PI * 2);
          const nd = new THREE.Vector3(Math.cos(ang), rng.range(0.25, 0.8), Math.sin(ang)).normalize().lerp(dir, 0.25).normalize();
          grow(next, nd, len * rng.range(0.5, 0.72), r1 * 0.62, depth + 1);
        }
      }
      cur = next;
    }
    if (depth >= 2) tips.push({ p: cur, d: dir, r: len });
  };
  grow(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 1, 0), H * 0.55, rng.range(0.28, 0.42), 0);
  // Root flare.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng.next();
    branches.push({ a: new THREE.Vector3(0, 0.9, 0), b: new THREE.Vector3(Math.cos(a) * 0.9, -0.3, Math.sin(a) * 0.9), ra: 0.22, rb: 0.08 });
  }
  let top = 0;
  for (const b of branches) top = Math.max(top, b.b.y);
  const crown = new THREE.Vector3(0, top * 0.68, 0);
  const cards: any[] = [];
  for (const t of tips) {
    const n = rng.int(5, 8);
    for (let k = 0; k < n; k++) {
      const p = t.p.clone().add(new THREE.Vector3(rng.range(-1.2, 1.2), rng.range(-0.8, 1.0), rng.range(-1.2, 1.2)));
      cards.push({ p, size: rng.range(1.6, 2.6), normal: new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)), rot: rng.range(0, Math.PI * 2) });
    }
  }
  const bark = tubeFromBranches(branches, 7, 0.25, top);
  const leaves = cardsGeometry(cards, crown, top, 1);
  const farBranches = branches.filter((b) => b.ra > 0.1);
  const barkFar = tubeFromBranches(farBranches, 4, 0.25, top);
  const farCards = cards.filter((_, i) => i % 3 === 0).map((c) => ({ ...c, size: c.size * 1.7 }));
  const leavesFar = cardsGeometry(farCards, crown, top, 1);
  return { bark, leaves, barkFar, leavesFar, height: top };
}

function growConifer(seed: number): TreeGeo {
  const rng = new RNG(seed);
  const H = rng.range(12, 20);
  const branches: Branch[] = [{ a: new THREE.Vector3(0, -0.5, 0), b: new THREE.Vector3(0, H, 0), ra: rng.range(0.25, 0.35), rb: 0.03 }];
  const cards: any[] = [];
  const whorls = Math.floor(H * 1.6);
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = H * (0.18 + 0.8 * t);
    const reach = (1 - t) * rng.range(2.4, 3.2) + 0.35;
    const n = Math.max(4, Math.round(8 * (1 - t) + 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + w * 0.7 + rng.range(-0.2, 0.2);
      const dir = new THREE.Vector3(Math.cos(a), -0.25, Math.sin(a));
      const mid = new THREE.Vector3(0, y, 0).addScaledVector(dir, reach * 0.55);
      cards.push({ p: mid, size: reach * 1.25, normal: new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), rot: a + Math.PI / 2, droop: 0.45 });
      cards.push({ p: mid.clone().add(new THREE.Vector3(0, 0.15, 0)), size: reach * 1.1, normal: new THREE.Vector3(-Math.sin(a), 0.2, Math.cos(a)), rot: 0, droop: 0.3 });
      if (reach > 0.8) branches.push({ a: new THREE.Vector3(0, y, 0), b: new THREE.Vector3(0, y, 0).addScaledVector(dir, reach * 0.8), ra: 0.06, rb: 0.02 });
    }
  }
  const crown = new THREE.Vector3(0, H * 0.45, 0);
  const bark = tubeFromBranches(branches, 6, 0.15, H);
  const leaves = cardsGeometry(cards, crown, H, 0.6);
  const barkFar = tubeFromBranches(branches.slice(0, 1), 4, 0.15, H);
  const farCards = cards.filter((_, i) => i % 3 === 0).map((c) => ({ ...c, size: c.size * 1.45 }));
  const leavesFar = cardsGeometry(farCards, crown, H, 0.6);
  return { bark, leaves, barkFar, leavesFar, height: H };
}

function growBush(seed: number): TreeGeo {
  const rng = new RNG(seed);
  const cards: any[] = [];
  const R = rng.range(0.9, 1.6);
  for (let k = 0; k < 26; k++) {
    const a = rng.range(0, Math.PI * 2),
      r = Math.sqrt(rng.next()) * R;
    const p = new THREE.Vector3(Math.cos(a) * r, rng.range(0.2, R * 1.1), Math.sin(a) * r);
    cards.push({ p, size: rng.range(0.9, 1.4), normal: new THREE.Vector3(rng.range(-1, 1), rng.range(0, 1), rng.range(-1, 1)), rot: rng.range(0, 6.28) });
  }
  const crown = new THREE.Vector3(0, R * 0.4, 0);
  const leaves = cardsGeometry(cards, crown, R * 1.4, 0.5);
  const bark = tubeFromBranches([{ a: new THREE.Vector3(0, -0.2, 0), b: new THREE.Vector3(0, R * 0.6, 0), ra: 0.06, rb: 0.03 }], 4, 0, 2);
  const leavesFar = cardsGeometry(
    cards.filter((_, i) => i % 2 === 0).map((c) => ({ ...c, size: c.size * 1.3 })),
    crown,
    R * 1.4,
    0.5,
  );
  return { bark, leaves, barkFar: bark, leavesFar, height: R };
}

export function makeRockGeometry(seed: number, detail = 4): THREE.BufferGeometry {
  const noise = new Simplex(seed);
  const rng = new RNG(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const sx = rng.range(0.8, 1.5),
    sy = rng.range(0.5, 0.9),
    sz = rng.range(0.8, 1.3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const n = noise.fbm3(x * 1.3, y * 1.3, z * 1.3, 4);
    const facet = Math.round(noise.noise3(x * 2.5 + 7, y * 2.5, z * 2.5) * 3) / 3;
    const r = 1 + n * 0.35 + facet * 0.08;
    x *= r * sx;
    y *= r * sy;
    z *= r * sz;
    if (y < -0.25) y = -0.25 + (y + 0.25) * 0.3; // flattened base
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const sway = new Float32Array(p.count);
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  return g;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function windOffset(strength: number) {
  return Fn(() => {
    const s = attribute('sway', 'float');
    const p = positionLocal;
    const phase = mx_noise_float(vec3(p.x.mul(0.02), 0.0, p.z.mul(0.02))).mul(6.0);
    const gust = mx_noise_float(vec3(p.x.mul(0.01).sub(U.windDir.x.mul(U.time).mul(0.15)), U.time.mul(0.1), p.z.mul(0.01).sub(U.windDir.y.mul(U.time).mul(0.15)))).mul(0.5).add(0.6);
    const sway = sin(U.time.mul(1.3).add(phase)).mul(0.5).add(sin(U.time.mul(2.7).add(phase.mul(1.7))).mul(0.2));
    const flutter = sin(U.time.mul(9.0).add(p.x.mul(3.1)).add(p.y.mul(2.3))).mul(0.04);
    const amt = s.mul(U.windStrength).mul(gust).mul(strength);
    return p.add(vec3(U.windDir.x.mul(sway.add(0.6)), flutter, U.windDir.y.mul(sway.add(0.6))).mul(amt));
  })();
}

function barkMaterial(tint: THREE.Color) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.positionNode = windOffset(0.35);
  const p = positionLocal;
  const streak = mx_fractal_noise_float(vec3(uv().x.mul(6.0), uv().y.mul(0.8), 0.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const base = vec3(tint.r, tint.g, tint.b);
  m.colorNode = base.mul(mix(float(0.55), float(1.15), streak)).mul(mix(float(0.8), float(1.0), smoothstep(0.0, 2.0, p.y)));
  m.roughnessNode = float(0.95);
  return m;
}

function leafMaterial(tex: THREE.Texture, tint: THREE.Color, swayStrength: number) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  m.positionNode = windOffset(swayStrength);
  const t = texture(tex, uv());
  const variation = hash(instanceIndex.add(uint(17)));
  const autumn = smoothstep(0.82, 1.0, variation);
  const tintV = mix(vec3(tint.r, tint.g, tint.b), vec3(1.25, 0.75, 0.3), autumn.mul(0.6)).mul(mix(float(0.8), float(1.15), hash(instanceIndex)));
  m.colorNode = t.rgb.mul(tintV);
  // Dither foliage away when the camera brushes through it.
  const nearFade = smoothstep(1.2, 4.0, distance(positionWorld, cameraPosition));
  m.opacityNode = t.a.mul(step(interleavedGradientNoise(screenCoordinate), nearFade));
  m.roughnessNode = float(0.75);
  const viewDir = normalize(positionWorld.sub(cameraPosition));
  const back = pow(saturate(dot(viewDir, U.sunDir)), 4.0);
  const nW = normalWorld;
  const wrap = saturate(dot(nW, U.sunDir).mul(0.5).add(0.5));
  m.emissiveNode = t.rgb.mul(tintV).mul(U.sunColor).mul(back.mul(0.9).add(wrap.mul(0.06))).mul(U.sunIntensity).mul(0.22);
  void vec4;
  void cameraViewMatrix;
  return m;
}

export function rockMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = mx_fractal_noise_float(p.mul(0.6), 4, 2.0, 0.5).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(4.0)).mul(0.5).add(0.5);
  let col: any = mix(vec3(0.14, 0.13, 0.12), vec3(0.34, 0.32, 0.29), n).mul(mix(float(0.85), float(1.1), fine));
  const up = saturate(normalWorld.y);
  const moss = smoothstep(0.55, 0.85, up.add(n.mul(0.3)).sub(0.1));
  col = mix(col, vec3(0.1, 0.16, 0.05).mul(mix(float(0.7), float(1.2), fine)), moss.mul(0.85));
  m.colorNode = col;
  m.roughnessNode = mix(float(0.85), float(0.95), moss);
  const bump = mx_noise_float(p.mul(3.0));
  const bump2 = mx_noise_float(p.mul(3.0).add(11.0));
  const nn = normalize(normalWorld.add(vec3(bump, bump2, bump.sub(bump2)).mul(0.18)));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nn, 0)).xyz);
  return m;
}

// ---------------------------------------------------------------------------
// Placement + LOD management
// ---------------------------------------------------------------------------
interface Species {
  name: string;
  geos: TreeGeo[];
  barkMat: THREE.Material;
  leafMat: THREE.Material;
  instances: { x: number; y: number; z: number; s: number; r: number; v: number }[];
  near: THREE.InstancedMesh[]; // per variant: [bark, leaves] flattened
  far: THREE.InstancedMesh[];
  nearDist: number;
}

export class Vegetation {
  readonly group = new THREE.Group();
  private species: Species[] = [];
  private rocks: THREE.InstancedMesh[] = [];
  private rockLists: THREE.Matrix4[][] = [];
  private tmpV = new THREE.Vector3();
  private timer = 0;
  private dummy = new THREE.Object3D();
  /** Obstacles for gameplay collision (trees & big rocks). */
  readonly colliders: { x: number; z: number; r: number }[] = [];

  constructor(
    private hf: Heightfield,
    treeCount: number,
  ) {
    const broadTex = leafTexture('broad');
    const needleTex = leafTexture('needle');
    const bushTex = leafTexture('bush');

    const broad: Species = {
      name: 'broadleaf',
      geos: [growBroadleaf(3), growBroadleaf(8), growBroadleaf(21)],
      barkMat: barkMaterial(new THREE.Color(0.2, 0.15, 0.1)),
      leafMat: leafMaterial(broadTex, new THREE.Color(0.95, 1.0, 0.85), 1.0),
      instances: [],
      near: [],
      far: [],
      nearDist: 110,
    };
    const conifer: Species = {
      name: 'conifer',
      geos: [growConifer(5), growConifer(14), growConifer(29)],
      barkMat: barkMaterial(new THREE.Color(0.17, 0.12, 0.09)),
      leafMat: leafMaterial(needleTex, new THREE.Color(0.8, 0.95, 0.85), 0.6),
      instances: [],
      near: [],
      far: [],
      nearDist: 130,
    };
    const bush: Species = {
      name: 'bush',
      geos: [growBush(2), growBush(9)],
      barkMat: barkMaterial(new THREE.Color(0.15, 0.12, 0.08)),
      leafMat: leafMaterial(bushTex, new THREE.Color(0.9, 1.0, 0.8), 0.5),
      instances: [],
      near: [],
      far: [],
      nearDist: 70,
    };
    this.species = [broad, conifer, bush];
    this.scatter(treeCount);
    for (const sp of this.species) this.buildMeshes(sp);
    this.scatterRocks();
  }

  private okSite(x: number, z: number, clearPath = 7) {
    const hf = this.hf;
    if (Math.abs(x) > HALF - 20 || Math.abs(z) > HALF - 20) return false;
    const h = hf.height(x, z);
    if (hf.waterHeight(x, z) > h - 0.5) return false;
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.radius + 12) return false;
    if (Math.hypot(x - hf.bridge.cx, z - hf.bridge.cz) < hf.bridge.half + 6) return false;
    for (const s of RUIN_SITES) if (Math.hypot(x - s.x, z - s.z) < 16) return false;
    // Clearings where the camera and the fight need room.
    if (Math.hypot(x - PLAYER_START.x, z - PLAYER_START.z) < 18) return false;
    if (Math.hypot(x - MONSTER_MEADOW.x, z - MONSTER_MEADOW.z) < 24) return false;
    const N = hf.res;
    const i = clamp(Math.round((x + HALF) / 2), 0, N - 1),
      j = clamp(Math.round((z + HALF) / 2), 0, N - 1);
    if (hf.road.d[j * N + i] < clearPath) return false;
    if (hf.trail.d[j * N + i] < clearPath * 0.5) return false;
    const slope = hf.normals[(j * N + i) * 4 + 3] / 255;
    if (slope > 0.42) return false;
    return true;
  }

  private scatter(treeCount: number) {
    const rng = new RNG(99);
    const n = this.hf.noise;
    let placed = 0;
    let tries = 0;
    const [broad, conifer, bush] = this.species;
    while (placed < treeCount && tries < treeCount * 30) {
      tries++;
      const x = rng.range(-HALF + 30, HALF - 30);
      const z = rng.range(-HALF + 30, HALF - 30);
      const forest = n.fbm2(x / 260 + 50, z / 260 - 20, 4) * 0.5 + 0.5;
      const h = this.hf.height(x, z);
      // Keep the central meadows open, forests on hillsides and mountain skirts.
      const meadow = ss(260, 120, Math.hypot(x + 60, z - 120)) * 0.8;
      const lakeClear = ss(LAKE.radius + 50, LAKE.radius + 10, Math.hypot(x - LAKE.x, z - LAKE.z));
      const dens = ss(0.45, 0.72, forest) * (1 - meadow) * (1 - lakeClear) * (h > 330 ? 0 : 1);
      if (rng.next() > dens * 0.9 + 0.012) continue;
      if (!this.okSite(x, z)) continue;
      const alpine = ss(55, 120, h);
      const sp = rng.next() < alpine * 0.9 + 0.12 ? conifer : broad;
      sp.instances.push({ x, y: h, z, s: rng.range(0.75, 1.3), r: rng.range(0, Math.PI * 2), v: rng.int(0, sp.geos.length - 1) });
      this.colliders.push({ x, z, r: 0.6 });
      placed++;
      // Understory bushes around trees.
      if (rng.next() < 0.5) {
        const bx = x + rng.range(-5, 5),
          bz = z + rng.range(-5, 5);
        if (this.okSite(bx, bz, 5)) bush.instances.push({ x: bx, y: this.hf.height(bx, bz), z: bz, s: rng.range(0.7, 1.3), r: rng.range(0, 6.28), v: rng.int(0, 1) });
      }
    }
    // Scattered lone bushes in meadows.
    for (let k = 0; k < treeCount * 0.4; k++) {
      const x = rng.range(-800, 800),
        z = rng.range(-800, 800);
      if (!this.okSite(x, z, 5)) continue;
      bush.instances.push({ x, y: this.hf.height(x, z), z, s: rng.range(0.6, 1.2), r: rng.range(0, 6.28), v: rng.int(0, 1) });
    }
  }

  private buildMeshes(sp: Species) {
    for (let v = 0; v < sp.geos.length; v++) {
      const g = sp.geos[v];
      const count = sp.instances.filter((i) => i.v === v).length + 1;
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
        const m = new THREE.InstancedMesh(geo, mat, count);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = shadow;
        m.receiveShadow = true;
        this.group.add(m);
        return m;
      };
      sp.near.push(mk(g.bark, sp.barkMat, true), mk(g.leaves, sp.leafMat, true));
      sp.far.push(mk(g.barkFar, sp.barkMat, false), mk(g.leavesFar, sp.leafMat, true));
    }
  }

  private scatterRocks() {
    const rng = new RNG(5);
    const variants = [makeRockGeometry(1), makeRockGeometry(2), makeRockGeometry(3), makeRockGeometry(4, 3)];
    const mat = rockMaterial();
    const lists: THREE.Matrix4[][] = variants.map(() => []);
    this.rockLists = lists;
    const d = this.dummy;
    const add = (x: number, z: number, s: number) => {
      const y = this.hf.height(x, z);
      const nrm = this.hf.normal(x, z, { x: 0, y: 0, z: 0 });
      d.position.set(x, y - s * 0.15, z);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nrm.x * 0.6, 1, nrm.z * 0.6).normalize());
      d.rotateY(rng.range(0, 6.28));
      d.scale.set(s * rng.range(0.8, 1.3), s * rng.range(0.7, 1.2), s * rng.range(0.8, 1.3));
      d.updateMatrix();
      lists[rng.int(0, variants.length - 1)].push(d.matrix.clone());
      if (s > 1.2) this.colliders.push({ x, z, r: s * 0.9 });
    };
    const n = this.hf.noise;
    for (let k = 0; k < 2600; k++) {
      const x = rng.range(-HALF + 40, HALF - 40),
        z = rng.range(-HALF + 40, HALF - 40);
      const N = this.hf.res;
      const i = clamp(Math.round((x + HALF) / 2), 0, N - 1),
        j = clamp(Math.round((z + HALF) / 2), 0, N - 1);
      const slope = this.hf.normals[(j * N + i) * 4 + 3] / 255;
      const nearStream = this.hf.stream.d[j * N + i] < 14 && this.hf.stream.d[j * N + i] > 4;
      const rocky = slope > 0.25 || nearStream || n.noise2(x / 90, z / 90) > 0.55;
      if (!rocky && rng.next() > 0.08) continue;
      if (this.hf.road.d[j * N + i] < 6) continue;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.radius + 4) continue;
      const big = slope > 0.3 ? rng.range(1.5, 5.5) : rng.range(0.4, 2.2);
      add(x, z, big);
    }
    variants.forEach((geo, vi) => {
      const list = lists[vi];
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((mm, k) => m.setMatrixAt(k, mm));
      m.count = list.length;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      this.rocks.push(m);
    });
  }

  update(dt: number, cam: THREE.Vector3, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.3;
    const d = this.dummy;
    // Rocks: only nearby ones (distant terrain LOD is too coarse to seat them).
    const rockR2 = 420 * 420;
    this.rocks.forEach((m, vi) => {
      let c = 0;
      for (const mm of this.rockLists[vi]) {
        this.tmpV.setFromMatrixPosition(mm);
        const dx = this.tmpV.x - cam.x,
          dz = this.tmpV.z - cam.z;
        if (dx * dx + dz * dz < rockR2) m.setMatrixAt(c++, mm);
      }
      m.count = c;
      m.instanceMatrix.needsUpdate = true;
    });
    const farDist2 = 1400 * 1400;
    for (const sp of this.species) {
      const counts = sp.geos.map(() => ({ n: 0, f: 0 }));
      const nd2 = sp.nearDist * sp.nearDist;
      for (const inst of sp.instances) {
        const dx = inst.x - cam.x,
          dz = inst.z - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > farDist2) continue;
        d.position.set(inst.x, inst.y, inst.z);
        d.rotation.set(0, inst.r, 0);
        d.scale.setScalar(inst.s);
        d.updateMatrix();
        const c = counts[inst.v];
        if (d2 < nd2) {
          sp.near[inst.v * 2].setMatrixAt(c.n, d.matrix);
          sp.near[inst.v * 2 + 1].setMatrixAt(c.n, d.matrix);
          c.n++;
        } else {
          sp.far[inst.v * 2].setMatrixAt(c.f, d.matrix);
          sp.far[inst.v * 2 + 1].setMatrixAt(c.f, d.matrix);
          c.f++;
        }
      }
      counts.forEach((c, v) => {
        for (const k of [0, 1]) {
          const nm = sp.near[v * 2 + k],
            fm = sp.far[v * 2 + k];
          nm.count = c.n;
          fm.count = c.f;
          nm.instanceMatrix.needsUpdate = true;
          fm.instanceMatrix.needsUpdate = true;
        }
      });
    }
  }
}
