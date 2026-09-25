// The Elder Zolom: a ~50 m lake serpent. Body = 64-bone skinned tube laid along a
// live spline that arcs out of the water; head = SDF sculpt with horns, frill,
// four eyes, fangs and a hinged jaw. Emissive veins shift cyan -> crimson (enrage).
import * as THREE from 'three/webgpu';
import {
  attribute,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  mix,
  smoothstep,
  saturate,
  abs,
  sin,
  fract,
  pow,
  dot,
  normalize,
  normalWorld,
  positionWorld,
  cameraPosition,
  cameraViewMatrix,
  mx_noise_float,
  mx_fractal_noise_float,
} from 'three/tsl';
import { meshSdf, type Prim, type MaterialDef, type Vec3, type MeshJob } from './sdf';
import { buildRig, type BoneSpec, type Rig } from './rig';
import { buildSkinnedGeometry, characterMaterial } from './charmat';
import { makeEye } from './eyes';
import { U } from '../core/env';
import { sstep } from '../core/tsl';

const SEGS = 64;
export const SERPENT_LENGTH = 64;
const RINGS_PER_SEG = 4;
const RADIAL = 36;

const lin = (r: number, g: number, b: number): Vec3 => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];

/** Body radius profile along u (0 = head end, 1 = tail tip). */
export function serpentRadius(u: number) {
  const neck = 1.45 + 0.55 * smoothstepJS(0, 0.1, u);
  const taper = 1 - smoothstepJS(0.35, 1.0, u) * 0.86;
  return neck * taper * 2.0;
}
function smoothstepJS(a: number, b: number, v: number) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function bodyGeometry() {
  const rings = SEGS * RINGS_PER_SEG;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const z = -u * SERPENT_LENGTH;
    const R = serpentRadius(u);
    const segF = u * (SEGS - 1);
    const s0 = Math.floor(segF),
      s1 = Math.min(SEGS - 1, s0 + 1);
    const w1 = segF - s0;
    for (let k = 0; k <= RADIAL; k++) {
      const a = (k / RADIAL) * Math.PI * 2; // 0 = top
      let x = Math.sin(a),
        y = Math.cos(a);
      // Flattened belly, dorsal ridge.
      if (y < -0.3) y = -0.3 + (y + 0.3) * 0.55;
      const ridge = Math.pow(Math.max(0, y), 16) * 0.28;
      const rr = R * (1 + ridge);
      pos.push(x * rr, y * rr * 0.92, z);
      const n = new THREE.Vector3(x, y, 0).normalize();
      nrm.push(n.x, n.y, n.z);
      uvs.push(u, k / RADIAL);
      si.push(s0, s1, 0, 0);
      sw.push(1 - w1, w1, 0, 0);
    }
  }
  for (let r = 0; r < rings; r++)
    for (let k = 0; k < RADIAL; k++) {
      const a = r * (RADIAL + 1) + k,
        b = a + 1,
        c = a + RADIAL + 1,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  // Tail cap + neck cap (neck hidden inside head).
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function bodyMaterial(veinColor: any, veinGlow: any, flash: any, dissolve: any) {
  const m = new THREE.MeshStandardNodeMaterial();
  const v = uv();
  const u = v.x.mul(SERPENT_LENGTH); // meters along body
  const around = v.y;
  const top = abs(around.sub(0.5)).mul(2.0); // 1 at top (a=0/1), 0 at belly (0.5)
  const belly = sstep(0.35, 0.12, top);
  // Scales: overlapping shingles in offset rows. t runs 0 (tucked under the
  // previous scale) -> 1 (raised free edge); the edge curves back like a shield.
  const sx = u.mul(1.6);
  const sy = around.mul(44.0).add(fract(sx.floor().mul(0.5)));
  const qy = fract(sy).sub(0.5);
  const t = fract(sx.add(qy.mul(qy).mul(1.8)));
  const crease = sstep(0.3, 0.0, t); // shadow under the overlapping edge
  const seam = smoothstep(0.4, 0.5, abs(qy)).mul(smoothstep(0.1, 0.5, t));
  const keel = sstep(0.06, 0.0, abs(qy)).mul(smoothstep(0.3, 0.8, t)).mul(0.35);
  const scaleEdge = saturate(crease.add(seam.mul(0.7)));
  const n = mx_fractal_noise_float(vec3(u.mul(0.3), around.mul(6.0), 0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const dark = vec3(0.005, 0.016, 0.014);
  const mid = vec3(0.014, 0.05, 0.04);
  let col: any = mix(dark, mid, n.mul(0.7).add(top.mul(0.3)));
  // Banding pattern down the back.
  const band = smoothstep(0.55, 0.9, sin(u.mul(0.9).add(n.mul(2.0))).mul(0.5).add(0.5)).mul(smoothstep(0.6, 0.95, top));
  col = mix(col, vec3(0.04, 0.035, 0.015), band.mul(0.7));
  col = col.mul(mix(float(1.0), float(0.45), scaleEdge)).mul(float(0.85).add(t.mul(0.3)).add(keel));
  // Belly plates.
  const plate = smoothstep(0.85, 0.98, fract(u.mul(0.9)));
  const bellyCol = mix(vec3(0.16, 0.13, 0.08), vec3(0.05, 0.04, 0.025), plate);
  col = mix(col, bellyCol, belly);
  m.colorNode = col;
  m.roughnessNode = mix(float(0.62), float(0.8), belly).add(scaleEdge.mul(0.15));
  m.metalnessNode = float(0.02);

  // Wet sheen near water line + normal bump per scale.
  const bump = vec2(t.sub(0.55).mul(1.2), qy.mul(0.9)).mul(float(1).sub(crease.mul(0.7)));
  const nn = normalize(normalWorld.add(vec3(bump.x, bump.y, bump.x.negate()).mul(0.25)));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nn, 0)).xyz);
  // Veins: glowing cracks between scales (enrage makes them blaze).
  const vein = sstep(0.07, 0.0, t).mul(float(1).sub(seam)).mul(smoothstep(0.62, 0.85, mx_noise_float(vec3(u.mul(0.25), around.mul(3.0), U.time.mul(0.2))).mul(0.5).add(0.5)));
  const pulse = sin(u.mul(0.6).sub(U.time.mul(3.0))).mul(0.3).add(0.7);
  const V = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(float(1).sub(saturate(dot(normalWorld, V))), 3.0);
  m.emissiveNode = (vec3(veinColor as any) as any).mul(vein.mul(pulse).mul(veinGlow).mul(2.0)).add(vec3(0.1, 0.3, 0.26).mul(rim).mul(U.sunIntensity.mul(0.35))).add(vec3(flash as any));
  // Dissolve for the finale.
  const dn = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
  m.alphaTestNode = float(0.5);
  m.opacityNode = smoothstep(dissolve, dissolve.add(0.02), dn.mul(0.98).add(0.01));
  return m;
}

// ---------------------------------------------------------------------------
// Head sculpt (SDF), local frame: faces +Z, origin at neck joint.
// ---------------------------------------------------------------------------
const HEAD_MATS: Record<string, MaterialDef> = {
  scale: { color: lin(0.12, 0.26, 0.22), rough: 0.58, metal: 0.05, kind: 6 },
  scaleDark: { color: lin(0.06, 0.12, 0.11), rough: 0.62, metal: 0.05, kind: 6 },
  belly: { color: lin(0.45, 0.4, 0.3), rough: 0.55, metal: 0, kind: 8 },
  horn: { color: lin(0.34, 0.3, 0.25), rough: 0.45, metal: 0, kind: 8 },
  hornDark: { color: lin(0.2, 0.17, 0.14), rough: 0.4, metal: 0, kind: 8 },
  fang: { color: lin(0.92, 0.9, 0.82), rough: 0.25, metal: 0, kind: 8 },
  mouth: { color: lin(0.35, 0.05, 0.08), rough: 0.35, metal: 0, kind: 0 },
  frill: { color: lin(0.1, 0.3, 0.3), rough: 0.5, metal: 0, kind: 5 },
};

export const HEAD_BONES: BoneSpec[] = [
  { name: 'head', parent: null, pos: [0, 0, 0] },
  { name: 'jaw', parent: 'head', pos: [0, -0.5, 0.6] },
  { name: 'frillL', parent: 'head', pos: [1.0, 0.7, -0.2] },
  { name: 'frillR', parent: 'head', pos: [-1.0, 0.7, -0.2] },
];

function headPrims(): Prim[] {
  const P: Prim[] = [];
  // Skull.
  P.push({ type: 'ellipsoid', c: [0, 0.2, 1.1], r: [1.15, 0.85, 2.0], mat: 'scale', bone: 'head', k: 0.3 });
  P.push({ type: 'ellipsoid', c: [0, -0.02, 2.9], r: [0.78, 0.5, 1.7], mat: 'scale', bone: 'head', k: 0.4 }); // snout
  P.push({ type: 'ellipsoid', c: [0, -0.2, 0.2], r: [1.35, 1.1, 1.2], mat: 'scale', bone: 'head', k: 0.4 }); // neck blend
  // Brow ridges + eye bumps.
  for (const sx of [1, -1]) {
    P.push({ type: 'capsule', a: [0.5 * sx, 0.8, 2.3], b: [1.0 * sx, 0.95, 0.7], ra: 0.32, rb: 0.42, mat: 'scaleDark', bone: 'head', k: 0.2 });
    P.push({ type: 'sphere', op: 'sub', c: [0.92 * sx, 0.5, 1.9], r: 0.24, mat: 'scale', bone: 'head', k: 0.08 });
    P.push({ type: 'sphere', op: 'sub', c: [1.06 * sx, 0.42, 1.3], r: 0.18, mat: 'scale', bone: 'head', k: 0.06 });
    // Horns sweeping back.
    P.push({ type: 'cone', a: [0.8 * sx, 1.2, 0.7], b: [1.6 * sx, 2.4, -2.4], ra: 0.42, rb: 0.05, bend: [0.3 * sx, 0.8, 0.2], mat: 'horn', bone: 'head', k: 0.15 });
    P.push({ type: 'cone', a: [1.1 * sx, 0.3, 0.3], b: [2.2 * sx, 0.6, -1.4], ra: 0.28, rb: 0.03, bend: [0.4 * sx, 0.3, 0], mat: 'hornDark', bone: 'head', k: 0.1 });
    // Cheek plates.
    P.push({ type: 'ellipsoid', c: [1.0 * sx, -0.35, 1.0], r: [0.4, 0.55, 0.9], rot: [0, 0.3 * sx, 0], mat: 'scaleDark', bone: 'head', k: 0.2 });
    // Nostrils.
    P.push({ type: 'sphere', op: 'sub', c: [0.3 * sx, 0.3, 4.3], r: 0.12, mat: 'scale', bone: 'head', k: 0.06 });
    // Frill spines + membrane.
    for (let f = 0; f < 4; f++) {
      const ang = -0.3 + f * 0.42;
      P.push({ type: 'cone', a: [0.9 * sx, 0.6, -0.1], b: [(1.4 + 1.6 * Math.cos(ang)) * sx, 0.6 + 1.9 * Math.sin(ang + 0.6), -1.2 - f * 0.1], ra: 0.14, rb: 0.03, mat: 'hornDark', bone: 'frill' + (sx > 0 ? 'L' : 'R'), k: 0.08 });
    }
    P.push({ type: 'ellipsoid', c: [1.9 * sx, 1.3, -1.0], r: [0.1, 1.3, 1.1], rot: [0.2, 0.4 * sx, -0.5 * sx], mat: 'frill', bone: 'frill' + (sx > 0 ? 'L' : 'R'), k: 0.15 });
  }
  // Crown horn.
  P.push({ type: 'cone', a: [0, 1.2, 0.9], b: [0, 2.6, -1.3], ra: 0.35, rb: 0.04, bend: [0, 0.6, 0.3], mat: 'horn', bone: 'head', k: 0.15 });
  // Upper jaw underside (mouth roof) and fangs.
  P.push({ type: 'ellipsoid', op: 'sub', c: [0, -0.42, 2.6], r: [0.7, 0.24, 1.8], mat: 'mouth', bone: 'head', k: 0.1 });
  for (const sx of [1, -1]) {
    P.push({ type: 'cone', a: [0.45 * sx, -0.3, 3.9], b: [0.42 * sx, -0.95, 4.0], ra: 0.1, rb: 0.01, mat: 'fang', bone: 'head', k: 0.04 });
    for (let t = 0; t < 4; t++) P.push({ type: 'cone', a: [(0.6 - t * 0.02) * sx, -0.3, 3.4 - t * 0.35], b: [(0.58 - t * 0.02) * sx, -0.62, 3.4 - t * 0.35], ra: 0.06, rb: 0.008, mat: 'fang', bone: 'head', k: 0.02 });
  }
  // Lower jaw on its own bone.
  P.push({ type: 'ellipsoid', c: [0, -0.68, 2.5], r: [0.8, 0.3, 1.9], mat: 'belly', bone: 'jaw', k: 0.15 });
  P.push({ type: 'ellipsoid', op: 'sub', c: [0, -0.48, 2.6], r: [0.62, 0.18, 1.7], mat: 'mouth', bone: 'jaw', k: 0.08 });
  for (const sx of [1, -1]) P.push({ type: 'cone', a: [0.45 * sx, -0.55, 3.7], b: [0.42 * sx, -0.1, 3.75], ra: 0.08, rb: 0.01, mat: 'fang', bone: 'jaw', k: 0.03 });
  // Throat / belly plates under the head.
  P.push({ type: 'ellipsoid', c: [0, -0.8, 0.6], r: [1.0, 0.5, 1.1], mat: 'belly', bone: 'jaw', bone2: 'head', k: 0.3 });
  return P;
}

export class SerpentActor {
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  readonly body: THREE.SkinnedMesh;
  readonly headRig: Rig;
  readonly headGroup = new THREE.Group();
  readonly veinColor = uniform(new THREE.Color(0.2, 0.9, 1.0));
  readonly veinGlow = uniform(0.3);
  readonly flash = uniform(new THREE.Color(0, 0, 0));
  readonly dissolve = uniform(0);
  readonly eyeGlow = uniform(1.2);
  jawOpen = 0;
  frill = 0; // 0 folded .. 1 flared
  private eyes: THREE.Mesh[] = [];
  /** Control points of the body curve (world). Index 0 = head neck joint. */
  readonly curvePts: THREE.Vector3[];
  headDir = new THREE.Vector3(0, 0, 1);
  headUp = new THREE.Vector3(0, 1, 0);
  private curve: THREE.CatmullRomCurve3;
  segPos: THREE.Vector3[] = [];

  constructor(quality: 'low' | 'high' = 'high') {
    // Body skeleton: flat list, placed each frame.
    const specs: THREE.Bone[] = [];
    for (let i = 0; i < SEGS; i++) {
      const b = new THREE.Bone();
      b.name = 'seg' + i;
      b.position.set(0, 0, -(i / (SEGS - 1)) * SERPENT_LENGTH);
      this.root.add(b);
      specs.push(b);
      this.bones.push(b);
    }
    this.root.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(specs);
    this.body = new THREE.SkinnedMesh(bodyGeometry(), bodyMaterial(this.veinColor, this.veinGlow, this.flash, this.dissolve));
    this.body.bind(skel, new THREE.Matrix4());
    this.body.frustumCulled = false;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);

    // Head.
    this.headRig = buildRig(HEAD_BONES);
    const [data] = serpentMeshJobs(quality).map((j) => meshSdf(j.model, j.cell, j.opts));
    const hm = new THREE.SkinnedMesh(buildSkinnedGeometry(data), characterMaterial({ flash: vec3(this.flash as any) }));
    hm.bind(this.headRig.skeleton, new THREE.Matrix4());
    hm.frustumCulled = false;
    hm.castShadow = true;
    this.headGroup.add(this.headRig.root);
    this.headGroup.add(hm);
    for (const [x, y, z, r] of [
      [0.9, 0.52, 1.84, 0.15],
      [1.03, 0.44, 1.26, 0.11],
    ]) {
      for (const sx of [1, -1]) {
        const e = makeEye(r, new THREE.Color(1.0, 0.75, 0.2), { slit: true, irisSize: 1.2 });
        e.position.set(x * sx, y, z);
        e.rotation.y = 0.9 * sx;
        this.headRig.bones['head'].add(e);
        this.eyes.push(e);
      }
    }
    this.headGroup.scale.setScalar(1.75);
    this.root.add(this.headGroup);
    this.curvePts = [0, 1, 2, 3, 4, 5, 6].map(() => new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.curvePts, false, 'centripetal');
    for (let i = 0; i < SEGS; i++) this.segPos.push(new THREE.Vector3());
  }

  /** Lay the body along the current control points and orient the head. */
  update(dt: number) {
    this.curve.points = this.curvePts;
    this.curve.updateArcLengths();
    const len = this.curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const tmpT = new THREE.Vector3();
    let prevSide = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < SEGS; i++) {
      const s = (i / (SEGS - 1)) * SERPENT_LENGTH;
      const u = Math.min(1, s / len);
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).negate(); // body bind runs along -Z (head -> tail); tangent points head-ward
      const side = new THREE.Vector3().crossVectors(up, t);
      if (side.lengthSq() < 1e-4) side.copy(prevSide);
      side.normalize();
      prevSide = side;
      const nUp = new THREE.Vector3().crossVectors(t, side).normalize();
      m.makeBasis(side, nUp, t);
      const b = this.bones[i];
      b.position.copy(p);
      b.quaternion.setFromRotationMatrix(m);

      this.segPos[i].copy(p);
    }
    this.root.updateMatrixWorld(true);
    // Head: at the neck point, facing headDir.
    const hp = this.curvePts[0];
    const f = this.headDir.clone().normalize();
    const sd = new THREE.Vector3().crossVectors(this.headUp, f).normalize();
    const hu = new THREE.Vector3().crossVectors(f, sd).normalize();
    m.makeBasis(sd, hu, f);
    this.headGroup.position.copy(hp);
    this.headGroup.quaternion.setFromRotationMatrix(m);
    const hb = this.headRig.bones;
    hb['jaw'].rotation.x = this.jawOpen * 0.75;
    hb['frillL'].rotation.set(0, -0.3 + this.frill * 0.5, -0.2 * (1 - this.frill));
    hb['frillR'].rotation.set(0, 0.3 - this.frill * 0.5, 0.2 * (1 - this.frill));
    for (const e of this.eyes) ((e.material as any).emissiveIntensity = this.eyeGlow.value);
    this.headGroup.updateMatrixWorld(true);
    const fl = this.flash.value;
    fl.multiplyScalar(Math.exp(-dt * 10));
    void len;
  }

  /** World-space point of the mouth (for beams / bites). */
  mouth(out = new THREE.Vector3()) {
    return out.set(0, -0.35, 4.1).applyMatrix4(this.headGroup.matrixWorld);
  }
  headCenter(out = new THREE.Vector3()) {
    return out.set(0, 0.3, 1.6).applyMatrix4(this.headGroup.matrixWorld);
  }
}

export { SEGS as SERPENT_SEGS };
void attribute;
void float;

export function serpentMeshJobs(quality: 'low' | 'high' = 'high'): MeshJob[] {
  return [{ model: { prims: headPrims(), materials: HEAD_MATS, bones: HEAD_BONES.map((b) => b.name) }, cell: quality === 'high' ? 0.045 : 0.065, opts: { weightSigma: 0.25, smooth: 1 } }];
}
