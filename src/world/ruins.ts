// Ancient Cetra-style ruins: procedural columns, arches, walls, stairs, altar and
// materia crystal. Geometry is merged per material for very few draw calls.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  vec3,
  vec4,
  float,
  positionWorld,
  normalWorld,
  cameraViewMatrix,
  mix,
  smoothstep,
  saturate,
  normalize,
  mx_noise_float,
  mx_fractal_noise_float,
  sin,
  abs,
  fract,
  attribute,
  uniform,
} from 'three/tsl';
import { RNG, Simplex } from '../core/math';
import { U } from '../core/env';
import { ARENA, RUIN_SITES, LAKE } from './layout';
import type { Heightfield } from './heightfield';

const noise = new Simplex(4242);

/** Chip & weather a geometry's vertices (world-scale noise). */
function weather(g: THREE.BufferGeometry, amount: number, seed: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const d = noise.fbm3(x * 0.9 + seed, y * 0.9, z * 0.9, 3) * amount;
    // Displace radially from the local origin so coincident vertices of
    // different faces move together (no cracks along hard edges).
    const l = Math.hypot(x, y, z) || 1;
    p.setXYZ(i, x + (x / l) * d, y + (y / l) * d, z + (z / l) * d);
  }
  g.computeVertexNormals();
  return g;
}

function addGlyphAttr(g: THREE.BufferGeometry, v: number) {
  const count = g.attributes.position.count;
  g.setAttribute('glyph', new THREE.Float32BufferAttribute(new Float32Array(count).fill(v), 1));
  return g;
}

function column(h: number, r: number, broken: boolean, rng: RNG): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const plinth = new THREE.BoxGeometry(r * 2.8, 0.6, r * 2.8, 2, 1, 2);
  plinth.translate(0, 0.3, 0);
  parts.push(plinth);
  const base = new THREE.CylinderGeometry(r * 1.2, r * 1.3, 0.4, 20, 1);
  base.translate(0, 0.8, 0);
  parts.push(base);
  const shaftH = broken ? h * rng.range(0.25, 0.75) : h;
  const shaft = new THREE.CylinderGeometry(r * 0.92, r, shaftH, 20, Math.max(2, Math.round(shaftH * 1.5)), false);
  // Flutes + entasis + broken top.
  const p = shaft.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const a = Math.atan2(z, x);
    const flute = 1 - 0.06 * Math.pow(Math.abs(Math.cos(a * 10)), 0.6);
    const ent = 1 + 0.04 * Math.sin(((y / shaftH) + 0.5) * Math.PI);
    x *= flute * ent;
    z *= flute * ent;
    if (broken && y > shaftH / 2 - 0.01) y += noise.noise2(x * 3 + 5, z * 3) * 0.45 - 0.2;
    p.setXYZ(i, x, y, z);
  }
  shaft.computeVertexNormals();
  shaft.translate(0, 1.0 + shaftH / 2, 0);
  parts.push(weather(shaft, 0.05, rng.next() * 10));
  if (!broken) {
    const cap = new THREE.CylinderGeometry(r * 1.35, r * 0.95, 0.6, 20, 1);
    cap.translate(0, 1.0 + shaftH + 0.3, 0);
    parts.push(cap);
    const abacus = new THREE.BoxGeometry(r * 3, 0.5, r * 3, 2, 1, 2);
    abacus.translate(0, 1.0 + shaftH + 0.85, 0);
    parts.push(weather(abacus, 0.06, rng.next() * 10));
  }
  return parts.map((g) => g.toNonIndexed());
}

function block(w: number, h: number, d: number, rng: RNG, chip = 0.08) {
  const b = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w * 2)), Math.max(1, Math.round(h * 2)), Math.max(1, Math.round(d * 2)));
  return weather(b, chip, rng.next() * 50).toNonIndexed();
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

export function stoneMaterial(glyphPulse: any) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const big = mx_fractal_noise_float(p.mul(0.25), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(3.5)).mul(0.5).add(0.5);
  let col: any = mix(vec3(0.36, 0.33, 0.28), vec3(0.62, 0.58, 0.5), big).mul(mix(float(0.82), float(1.08), fine));
  // Rain streaks.
  const streak = mx_noise_float(vec3(p.x.mul(1.4), p.y.mul(0.08), p.z.mul(1.4))).mul(0.5).add(0.5);
  col = col.mul(mix(float(1.0), float(0.72), smoothstep(0.55, 0.8, streak)));
  const up = saturate(normalWorld.y);
  const moss = smoothstep(0.5, 0.9, up.add(big.mul(0.4)).sub(0.15)).add(smoothstep(0.62, 0.8, mx_noise_float(p.mul(0.5))).mul(0.4));
  col = mix(col, vec3(0.08, 0.14, 0.04).mul(mix(float(0.7), float(1.2), fine)), saturate(moss).mul(0.85));
  m.colorNode = col;
  m.roughnessNode = float(0.9);
  const b1 = mx_noise_float(p.mul(2.2));
  const b2 = mx_noise_float(p.mul(2.2).add(9.0));
  const nn = normalize(normalWorld.add(vec3(b1, b2.mul(0.5), b2.sub(b1)).mul(0.14)));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nn, 0)).xyz);
  // Faint Cetra glyphs etched into some stones: glowing lines.
  const g = attribute('glyph', 'float');
  const lines = smoothstep(0.93, 0.985, abs(sin(p.y.mul(3.1).add(sin(p.x.mul(1.7).add(p.z.mul(1.3))).mul(1.6)))));
  const cells = smoothstep(0.45, 0.5, fract(p.x.mul(0.8).add(p.z.mul(0.8))).sub(0.5).abs().oneMinus().mul(fine));
  const glyph = lines.mul(cells.add(0.3)).mul(g);
  m.emissiveNode = vec3(0.25, 0.95, 0.75).mul(glyph).mul(glyphPulse);
  return m;
}

function crystalMaterial(intensity: any) {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: false });
  const p = positionWorld;
  const swirl = mx_fractal_noise_float(vec3(p.x.mul(1.5), p.y.mul(1.5).sub(U.time.mul(0.6)), p.z.mul(1.5)), 3, 2.0, 0.5).mul(0.5).add(0.5);
  m.colorNode = vec3(0.1, 0.5, 0.25);
  m.roughnessNode = float(0.08);
  m.metalnessNode = float(0.1);
  (m as any).clearcoatNode = float(1);
  m.emissiveNode = mix(vec3(0.05, 0.6, 0.3), vec3(0.6, 1.6, 0.9), swirl).mul(intensity);
  return m;
}

export class Ruins {
  readonly group = new THREE.Group();
  readonly colliders: { x: number; z: number; r: number }[] = [];
  readonly glyphPulse = uniform(0.35);
  readonly crystalGlow = uniform(1.2);
  crystal!: THREE.Mesh;
  crystalLight!: THREE.PointLight;
  /** Points of interest used by cinematics. */
  readonly poi = {
    gate: new THREE.Vector3(),
    altar: new THREE.Vector3(),
    lakeEdge: new THREE.Vector3(),
  };
  /** Fallen/standing column pieces that can be knocked into debris. */
  readonly columnTops: THREE.Vector3[] = [];

  constructor(private hf: Heightfield) {
    const rng = new RNG(777);
    const stone: THREE.BufferGeometry[] = [];
    const glyphStone: THREE.BufferGeometry[] = [];
    const A = ARENA;
    const baseY = A.height;

    // Outer colonnade.
    const nCols = 18;
    for (let i = 0; i < nCols; i++) {
      const a = (i / nCols) * Math.PI * 2;
      // Leave the lake-facing side open.
      const toLake = Math.atan2(LAKE.z - A.z, LAKE.x - A.x);
      const da = Math.atan2(Math.sin(a - toLake), Math.cos(a - toLake));
      if (Math.abs(da) < 0.5) continue;
      const r = A.radius - 5;
      const x = A.x + Math.cos(a) * r,
        z = A.z + Math.sin(a) * r;
      const broken = rng.next() < 0.45;
      const h = rng.range(9, 11);
      const parts = column(h, 0.85, broken, rng);
      for (const g of parts) stone.push(place(g, x, baseY - 0.2, z, rng.range(0, 6.28)));
      this.colliders.push({ x, z, r: 1.4 });
      this.columnTops.push(new THREE.Vector3(x, baseY + (broken ? 5 : h + 1), z));
      // Fallen drums next to broken columns.
      if (broken && rng.next() < 0.7) {
        const drums = rng.int(1, 3);
        const fa = rng.range(0, 6.28);
        for (let k = 0; k < drums; k++) {
          const d = new THREE.CylinderGeometry(0.8, 0.85, 1.6, 18, 1).toNonIndexed();
          weather(d, 0.06, rng.next() * 20);
          const dx = x + Math.cos(fa) * (2.2 + k * 1.7),
            dz = z + Math.sin(fa) * (2.2 + k * 1.7);
          stone.push(place(d, dx, baseY + 0.65, dz, fa, 0, Math.PI / 2 + rng.range(-0.1, 0.1)));
        }
      }
    }

    // Architrave fragments linking some standing columns.
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = A.radius - 5;
      const lintel = block(6.2, 1.1, 1.8, rng, 0.07);
      addGlyphAttr(lintel, rng.next() < 0.5 ? 1 : 0);
      glyphStone.push(place(lintel, A.x + Math.cos(a) * r, baseY + 0.55, A.z + Math.sin(a) * r, -a + Math.PI / 2, rng.range(-0.1, 0.1), rng.range(-0.15, 0.15)));
    }

    // Inner ring of low glyph pillars.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = A.x + Math.cos(a) * 20,
        z = A.z + Math.sin(a) * 20;
      const obel = block(1.5, rng.range(3.5, 5.5), 1.5, rng, 0.08);
      obel.translate(0, 0, 0);
      addGlyphAttr(obel, 1);
      const hh = (obel.boundingBox ?? (obel.computeBoundingBox(), obel.boundingBox!)).max.y;
      glyphStone.push(place(obel, x, baseY + hh, z, a));
      this.colliders.push({ x, z, r: 1.3 });
    }

    // Central dais with stairs and the materia altar.
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.CylinderGeometry(8.5 - k * 2.3, 8.8 - k * 2.3, 0.55, 40, 1).toNonIndexed();
      weather(ring, 0.04, k * 3);
      addGlyphAttr(ring, k === 2 ? 1 : 0);
      glyphStone.push(place(ring, A.x, baseY + 0.27 + k * 0.55, A.z));
    }
    const altar = block(2.2, 1.4, 1.4, rng, 0.04);
    addGlyphAttr(altar, 1);
    glyphStone.push(place(altar, A.x, baseY + 1.65 + 0.7, A.z, 0.4));
    this.poi.altar.set(A.x, baseY + 1.65, A.z);
    this.colliders.push({ x: A.x, z: A.z, r: 3.0 });

    // Grand gate arch on the road side.
    const gateA = Math.atan2(-78 - A.z, 160 - A.x);
    const gx = A.x + Math.cos(gateA) * (A.radius + 1),
      gz = A.z + Math.sin(gateA) * (A.radius + 1);
    this.poi.gate.set(gx, baseY, gz);
    this.buildArch(stone, glyphStone, gx, baseY, gz, gateA + Math.PI / 2, 12, 16, rng);

    // Steps down into the lake.
    const la = Math.atan2(LAKE.z - A.z, LAKE.x - A.x);
    for (let k = 0; k < 7; k++) {
      const st = block(14, 0.5, 1.6, rng, 0.05);
      const r = A.radius - 3 + k * 1.5;
      stone.push(place(st, A.x + Math.cos(la) * r, baseY - 0.3 - k * 0.5, A.z + Math.sin(la) * r, -la + Math.PI / 2));
    }
    this.poi.lakeEdge.set(A.x + Math.cos(la) * (A.radius + 30), LAKE.level, A.z + Math.sin(la) * (A.radius + 30));

    // Rubble.
    for (let k = 0; k < 70; k++) {
      const a = rng.range(0, 6.28),
        r = rng.range(8, A.radius + 6);
      const s = rng.range(0.3, 1.3);
      const b = block(s * rng.range(0.8, 1.6), s * rng.range(0.5, 1.0), s * rng.range(0.8, 1.4), rng, 0.1);
      const x = A.x + Math.cos(a) * r,
        z = A.z + Math.sin(a) * r;
      stone.push(place(b, x, this.hf.height(x, z) + s * 0.2, z, rng.range(0, 6.28), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)));
    }

    this.buildBridge(stone, glyphStone, rng);

    // Scattered ruin sites across the world.
    for (const site of RUIN_SITES) this.buildSite(site, stone, glyphStone, rng);

    const allStone = stone.map((g) => addGlyphAttr(stripAttrs(g), 0)).concat(glyphStone.map((g) => stripAttrs(g, true)));
    const merged = mergeGeometries(allStone, false)!;
    const mat = stoneMaterial(this.glyphPulse);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'ruins';
    this.group.add(mesh);

    // Materia crystal above the altar.
    const cg = new THREE.OctahedronGeometry(0.9, 0);
    cg.scale(0.8, 1.6, 0.8);
    this.crystal = new THREE.Mesh(cg, crystalMaterial(this.crystalGlow));
    this.crystal.position.set(A.x, baseY + 4.6, A.z);
    this.crystal.castShadow = false;
    this.group.add(this.crystal);
    this.crystalLight = new THREE.PointLight(0x66ffaa, 40, 22, 2);
    this.crystalLight.position.copy(this.crystal.position);
    this.group.add(this.crystalLight);
  }

  private buildArch(stone: THREE.BufferGeometry[], glyph: THREE.BufferGeometry[], x: number, y: number, z: number, rot: number, span: number, height: number, rng: RNG) {
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const pierW = 2.6;
    for (const side of [-1, 1]) {
      const px = x + c * side * (span / 2 + pierW / 2),
        pz = z + s * side * (span / 2 + pierW / 2);
      let yy = y;
      for (let k = 0; k < 6; k++) {
        const hgt = height / 8;
        const b = block(pierW + rng.range(-0.1, 0.1), hgt, 2.6, rng, 0.06);
        stone.push(place(b, px, yy + hgt / 2, pz, -rot));
        yy += hgt;
      }
      this.colliders.push({ x: px, z: pz, r: 2.0 });
    }
    // Voussoirs.
    const R = span / 2 + pierW / 2;
    const n = 15;
    const springY = y + (height / 8) * 6;
    for (let k = 0; k <= n; k++) {
      if (k === 7 && rng.next() < 0.0) continue;
      const a = Math.PI - (k / n) * Math.PI;
      const bx = x + c * Math.cos(a) * R,
        bz = z + s * Math.cos(a) * R;
      const by = springY + Math.sin(a) * R * 0.75;
      const b = block(1.3, 2.2, 2.6, rng, 0.05);
      addGlyphAttr(b, k === 7 ? 1 : 0);
      glyph.push(place(b, bx, by, bz, -rot, 0, a - Math.PI / 2));
    }
  }

  private buildBridge(stone: THREE.BufferGeometry[], glyph: THREE.BufferGeometry[], rng: RNG) {
    const b = this.hf.bridge;
    const rot = Math.atan2(b.tz, b.tx);
    const at = (s: number, l: number) => ({ x: b.cx + b.tx * s - b.tz * l, z: b.cz + b.tz * s + b.tx * l });
    const deck = (s: number) => this.hf.bridgeDeck(b.cx + b.tx * s, b.cz + b.tz * s);
    // Deck slabs following the hump.
    const seg = 14;
    for (let k = 0; k < seg; k++) {
      const s0 = -b.half + (k / seg) * b.half * 2,
        s1 = -b.half + ((k + 1) / seg) * b.half * 2;
      const sm = (s0 + s1) / 2;
      const y = deck(sm);
      const slope = Math.atan2(deck(s1) - deck(s0), s1 - s0);
      const slab = block(s1 - s0 + 0.15, 1.1, b.width * 2 + 0.4, rng, 0.05);
      const p = at(sm, 0);
      stone.push(place(slab, p.x, y - 0.55, p.z, -rot, 0, slope));
      // Parapets (some blocks missing).
      for (const side of [-1, 1]) {
        if (rng.next() < 0.18) continue;
        const pw = block(s1 - s0 - 0.1, rng.range(0.6, 0.95), 0.45, rng, 0.07);
        const q = at(sm, side * (b.width + 0.05));
        stone.push(place(pw, q.x, y + 0.4, q.z, -rot, 0, slope));
      }
    }
    // Piers and arches spanning the gorge.
    const piers = [-14, 0, 14];
    for (const ps of piers) {
      const p = at(ps, 0);
      const top = deck(ps) - 1.1;
      const bottom = this.hf.terrainHeight(p.x, p.z) - 1.5;
      const h = top - bottom;
      const pier = block(3.0, h, b.width * 2 + 0.2, rng, 0.08);
      addGlyphAttr(pier, 0);
      stone.push(place(pier, p.x, bottom + h / 2, p.z, -rot));
      const cut = block(3.4, 0.9, b.width * 2 + 0.8, rng, 0.06);
      stone.push(place(cut, p.x, bottom + 2.2, p.z, -rot));
      this.colliders.push({ x: p.x, z: p.z, r: 2.2 });
    }
    // Arch voussoirs between piers.
    for (let a = 0; a < piers.length - 1; a++) {
      const s0 = piers[a] + 1.5,
        s1 = piers[a + 1] - 1.5;
      const span = s1 - s0;
      const n = 11;
      for (let k = 0; k <= n; k++) {
        const ang = (k / n) * Math.PI;
        const s = (s0 + s1) / 2 - Math.cos(ang) * span / 2;
        const spring = deck((s0 + s1) / 2) - 1.1 - span * 0.5;
        const y = spring + Math.sin(ang) * span * 0.45;
        const v = block(1.1, 1.6, b.width * 2, rng, 0.05);
        addGlyphAttr(v, k === Math.floor(n / 2) ? 1 : 0);
        const p = at(s, 0);
        glyph.push(place(v, p.x, y, p.z, -rot, 0, ang - Math.PI / 2));
      }
    }
    void LAKE;
  }

  private buildSite(site: (typeof RUIN_SITES)[number], stone: THREE.BufferGeometry[], glyph: THREE.BufferGeometry[], rng: RNG) {
    const y = this.hf.height(site.x, site.z);
    const c = Math.cos(site.rot),
      s = Math.sin(site.rot);
    const at = (lx: number, lz: number) => ({ x: site.x + c * lx - s * lz, z: site.z + s * lx + c * lz });
    switch (site.kind) {
      case 'pillars': {
        for (let i = 0; i < 6; i++) {
          const p = at((i % 3) * 5 - 5, Math.floor(i / 3) * 7 - 3.5);
          const parts = column(rng.range(6, 8), 0.6, rng.next() < 0.6, rng);
          for (const g of parts) stone.push(place(g, p.x, this.hf.height(p.x, p.z) - 0.3, p.z, rng.range(0, 6)));
          this.colliders.push({ x: p.x, z: p.z, r: 1.0 });
        }
        break;
      }
      case 'arch': {
        this.buildArch(stone, glyph, site.x, y - 0.4, site.z, site.rot, 6, 9, rng);
        break;
      }
      case 'wall': {
        for (let k = 0; k < 9; k++) {
          const rows = rng.int(1, 4);
          for (let r = 0; r < rows; r++) {
            const p = at(k * 2.1 - 9, 0);
            const b = block(2.0, 1.0, 1.2, rng, 0.08);
            stone.push(place(b, p.x, this.hf.height(p.x, p.z) + 0.3 + r * 1.0, p.z, -site.rot + rng.range(-0.05, 0.05)));
          }
          const p = at(k * 2.1 - 9, 0);
          this.colliders.push({ x: p.x, z: p.z, r: 1.2 });
        }
        break;
      }
      case 'tower': {
        const R = 4.5;
        for (let ring = 0; ring < 12; ring++) {
          const n = 12;
          for (let k = 0; k < n; k++) {
            if (ring > 5 && rng.next() < (ring - 5) / 7) continue;
            const a = (k / n) * Math.PI * 2 + (ring % 2) * 0.26;
            const b = block(2.3, 1.1, 1.1, rng, 0.07);
            stone.push(place(b, site.x + Math.cos(a) * R, y - 0.2 + ring * 1.1 + 0.55, site.z + Math.sin(a) * R, -a + Math.PI / 2));
          }
        }
        this.colliders.push({ x: site.x, z: site.z, r: R + 1 });
        break;
      }
      case 'shrine': {
        const base = block(7, 0.8, 7, rng, 0.05);
        stone.push(place(base, site.x, y + 0.2, site.z, site.rot));
        const ob = block(1.4, 5.5, 1.4, rng, 0.06);
        addGlyphAttr(ob, 1);
        glyph.push(place(ob, site.x, y + 3.5, site.z, site.rot));
        for (const [lx, lz] of [
          [-2.8, -2.8],
          [2.8, -2.8],
          [-2.8, 2.8],
          [2.8, 2.8],
        ]) {
          const p = at(lx, lz);
          const b = block(0.8, rng.range(1.2, 2.4), 0.8, rng, 0.08);
          stone.push(place(b, p.x, y + 1.2, p.z, site.rot));
        }
        this.colliders.push({ x: site.x, z: site.z, r: 4 });
        break;
      }
    }
  }

  update(dt: number, t: number) {
    this.crystal.rotation.y += dt * 0.6;
    this.crystal.position.y = ARENA.height + 4.6 + Math.sin(t * 1.3) * 0.25;
    this.crystalLight.position.copy(this.crystal.position);
    this.crystalLight.intensity = 30 * this.crystalGlow.value * (0.85 + 0.15 * Math.sin(t * 3.1));
  }
}

function stripAttrs(g: THREE.BufferGeometry, keepGlyph = false) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  out.setAttribute('normal', g.attributes.normal);
  if (keepGlyph && g.attributes.glyph) out.setAttribute('glyph', g.attributes.glyph);
  else out.setAttribute('glyph', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return out;
}
