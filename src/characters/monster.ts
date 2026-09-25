// The Ruinfang: an original FFVII-style predator. Hunched, heavy-shouldered
// quadruped with a bone-plated spine, a long skull-like head with four mako
// eyes, shoulder whip-tentacles ending in glowing barbs, and a segmented tail.
// Procedural behaviour poses + four-legged foot-planting gait with IK.
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { meshSdf, type Prim, type MaterialDef, type Vec3 } from './sdf';
import { buildRig, type BoneSpec, type Rig, mirrorX, add, lerp3 } from './rig';
import { buildSkinnedGeometry, characterMaterial } from './charmat';
import { makeEye } from './eyes';
import { SpringBone, solveTwoBone } from './anim';
import { damp, clamp, smoothstep, lerp } from '../core/math';

export type MonsterState = 'graze' | 'idle' | 'alert' | 'roar' | 'stalk' | 'run' | 'teleBite' | 'bite' | 'teleWhip' | 'whip' | 'telePounce' | 'pounce' | 'hit' | 'stagger' | 'death';

const lin = (r: number, g: number, b: number): Vec3 => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];

const MATS: Record<string, MaterialDef> = {
  hide: { color: lin(0.24, 0.2, 0.3), rough: 0.78, metal: 0, kind: 6 },
  hideDark: { color: lin(0.13, 0.11, 0.17), rough: 0.7, metal: 0, kind: 6 },
  belly: { color: lin(0.48, 0.42, 0.44), rough: 0.7, metal: 0, kind: 0 },
  bone: { color: lin(0.78, 0.72, 0.6), rough: 0.45, metal: 0, kind: 8 },
  boneDark: { color: lin(0.35, 0.3, 0.26), rough: 0.4, metal: 0, kind: 8 },
  tooth: { color: lin(0.92, 0.9, 0.82), rough: 0.25, metal: 0, kind: 8 },
  mouth: { color: lin(0.35, 0.06, 0.1), rough: 0.35, metal: 0, kind: 0 },
  claw: { color: lin(0.12, 0.1, 0.1), rough: 0.3, metal: 0, kind: 8 },
  vein: { color: lin(0.3, 0.95, 1.0), rough: 0.4, metal: 0, kind: 7, emissive: 1.4 },
  barb: { color: lin(0.35, 1.0, 0.95), rough: 0.2, metal: 0, kind: 7, emissive: 2.2 },
};

// Joints (world bind, faces +Z, left = +X).
const shoulder: Vec3 = [0.34, 1.28, 0.32];
const elbow: Vec3 = [0.38, 0.72, 0.16];
const wrist: Vec3 = [0.38, 0.14, 0.34];
const hip: Vec3 = [0.3, 1.16, -0.95];
const knee: Vec3 = [0.34, 0.74, -0.66];
const hock: Vec3 = [0.34, 0.46, -1.16];
const hpaw: Vec3 = [0.34, 0.1, -1.02];

export const MONSTER_BONES: BoneSpec[] = [
  { name: 'pelvis', parent: null, pos: [0, 1.18, -0.9] },
  { name: 'spine', parent: 'pelvis', pos: [0, 1.3, -0.35] },
  { name: 'chest', parent: 'spine', pos: [0, 1.42, 0.18] },
  { name: 'neck', parent: 'chest', pos: [0, 1.52, 0.66] },
  { name: 'head', parent: 'neck', pos: [0, 1.48, 1.1] },
  { name: 'jaw', parent: 'head', pos: [0, 1.36, 1.3] },
  { name: 'tail1', parent: 'pelvis', pos: [0, 1.24, -1.3] },
  { name: 'tail2', parent: 'tail1', pos: [0, 1.12, -1.9] },
  { name: 'tail3', parent: 'tail2', pos: [0, 0.98, -2.5] },
  { name: 'tent1.L', parent: 'chest', pos: [0.28, 1.74, 0.34] },
  { name: 'tent2.L', parent: 'tent1.L', pos: [0.55, 2.12, -0.12] },
  { name: 'tent3.L', parent: 'tent2.L', pos: [0.72, 2.28, -0.78] },
  { name: 'tent1.R', parent: 'chest', pos: [-0.28, 1.74, 0.34] },
  { name: 'tent2.R', parent: 'tent1.R', pos: [-0.55, 2.12, -0.12] },
  { name: 'tent3.R', parent: 'tent2.R', pos: [-0.72, 2.28, -0.78] },
  { name: 'fUp.L', parent: 'chest', pos: shoulder },
  { name: 'fLo.L', parent: 'fUp.L', pos: elbow },
  { name: 'fPaw.L', parent: 'fLo.L', pos: wrist },
  { name: 'fUp.R', parent: 'chest', pos: mirrorX(shoulder) },
  { name: 'fLo.R', parent: 'fUp.R', pos: mirrorX(elbow) },
  { name: 'fPaw.R', parent: 'fLo.R', pos: mirrorX(wrist) },
  { name: 'hTh.L', parent: 'pelvis', pos: hip },
  { name: 'hSh.L', parent: 'hTh.L', pos: knee },
  { name: 'hMt.L', parent: 'hSh.L', pos: hock },
  { name: 'hPaw.L', parent: 'hMt.L', pos: hpaw },
  { name: 'hTh.R', parent: 'pelvis', pos: mirrorX(hip) },
  { name: 'hSh.R', parent: 'hTh.R', pos: mirrorX(knee) },
  { name: 'hMt.R', parent: 'hSh.R', pos: mirrorX(hock) },
  { name: 'hPaw.R', parent: 'hMt.R', pos: mirrorX(hpaw) },
];
const NAMES = MONSTER_BONES.map((b) => b.name);

function bodyPrims(): Prim[] {
  const P: Prim[] = [];
  // Torso: heavy hunched shoulders, lean waist, lower rump.
  P.push({ type: 'ellipsoid', c: [0, 1.16, -0.88], r: [0.34, 0.33, 0.46], mat: 'hide', bone: 'pelvis', k: 0.12 });
  P.push({ type: 'ellipsoid', c: [0, 1.12, -0.32], r: [0.28, 0.27, 0.45], mat: 'hide', bone: 'spine', k: 0.16 });
  P.push({ type: 'ellipsoid', c: [0, 0.98, -0.3], r: [0.24, 0.16, 0.42], mat: 'belly', bone: 'spine', k: 0.14 });
  P.push({ type: 'ellipsoid', c: [0, 1.36, 0.2], r: [0.45, 0.46, 0.52], mat: 'hide', bone: 'chest', k: 0.18 });
  P.push({ type: 'ellipsoid', c: [0, 1.66, 0.02], r: [0.38, 0.26, 0.46], mat: 'hideDark', bone: 'chest', k: 0.16 }); // hump
  P.push({ type: 'ellipsoid', c: [0, 1.12, 0.36], r: [0.3, 0.24, 0.3], mat: 'belly', bone: 'chest', k: 0.14 }); // brisket
  // Neck.
  P.push({ type: 'capsule', a: [0, 1.52, 0.4], b: [0, 1.5, 1.0], ra: 0.3, rb: 0.21, mat: 'hide', bone: 'neck', k: 0.12 });
  P.push({ type: 'ellipsoid', c: [0, 1.36, 0.82], r: [0.2, 0.14, 0.28], mat: 'belly', bone: 'neck', k: 0.1 });
  // Spine plates (bone ridge) + side plates over the shoulders.
  const plates: [Vec3, number, string, number][] = [
    [[0, 1.86, 0.28], 0.22, 'chest', -0.5],
    [[0, 1.9, 0.02], 0.26, 'chest', -0.3],
    [[0, 1.86, -0.22], 0.24, 'chest', -0.1],
    [[0, 1.58, -0.46], 0.18, 'spine', 0.1],
    [[0, 1.46, -0.72], 0.16, 'pelvis', 0.25],
    [[0, 1.46, -0.98], 0.14, 'pelvis', 0.35],
    [[0, 1.66, 0.6], 0.14, 'neck', -0.8],
  ];
  for (const [c, s, bone, tilt] of plates) {
    P.push({ type: 'ellipsoid', c, r: [0.045, s * 0.7, s * 0.8], rot: [tilt, 0, 0], mat: 'bone', bone, k: 0.04 });
    P.push({ type: 'cone', a: add(c, [0, s * 0.3, -s * 0.2]), b: add(c, [0, s * 1.2, -s * 0.9]), ra: 0.05, rb: 0.008, mat: 'bone', bone, k: 0.03 });
  }
  for (const sx of [1, -1]) {
    const m = (v: Vec3): Vec3 => (sx > 0 ? v : mirrorX(v));
    const s = sx > 0 ? 'L' : 'R';
    P.push({ type: 'ellipsoid', c: m([0.4, 1.52, 0.24]), r: [0.05, 0.2, 0.28], rot: [0, 0, -0.7 * sx], mat: 'bone', bone: 'chest', k: 0.06 }); // shoulder plate
    // Glowing vein markings along the flanks (painted).
    P.push({ type: 'capsule', op: 'paint', a: m([0.44, 1.3, 0.45]), b: m([0.36, 1.12, -0.6]), ra: 0.03, rb: 0.02, mat: 'vein', bone: 'chest' });
    P.push({ type: 'capsule', op: 'paint', a: m([0.44, 1.4, 0.1]), b: m([0.3, 1.22, -0.95]), ra: 0.025, rb: 0.02, mat: 'vein', bone: 'spine' });
    // Tentacles from the shoulders.
    P.push({ type: 'ellipsoid', c: m([0.28, 1.74, 0.34]), r: [0.14, 0.12, 0.14], mat: 'boneDark', bone: 'tent1.' + s, k: 0.06 });
    P.push({ type: 'capsule', a: m([0.28, 1.74, 0.34]), b: m([0.55, 2.12, -0.12]), ra: 0.1, rb: 0.075, mat: 'hide', bone: 'tent1.' + s, k: 0.05 });
    P.push({ type: 'capsule', a: m([0.55, 2.12, -0.12]), b: m([0.72, 2.28, -0.78]), ra: 0.075, rb: 0.05, mat: 'hide', bone: 'tent2.' + s, k: 0.04 });
    P.push({ type: 'capsule', a: m([0.72, 2.28, -0.78]), b: m([0.8, 2.25, -1.45]), ra: 0.05, rb: 0.03, mat: 'hideDark', bone: 'tent3.' + s, k: 0.03 });
    P.push({ type: 'cone', a: m([0.8, 2.25, -1.4]), b: m([0.84, 2.2, -1.85]), ra: 0.075, rb: 0.006, mat: 'barb', bone: 'tent3.' + s, k: 0.02 });
    for (const [bx, by, bz] of [[0.05, 0.05, -1.55], [-0.05, 0.02, -1.6]] as Vec3[]) P.push({ type: 'cone', a: m([0.8 + bx * 0.2, 2.24, -1.5]), b: m([0.8 + bx * 2, 2.24 + by * 3, bz]), ra: 0.03, rb: 0.004, mat: 'barb', bone: 'tent3.' + s, k: 0.01 });
    // Front leg: muscular upper, lean forearm, broad paw with claws.
    P.push({ type: 'capsule', a: m(shoulder), b: m(elbow), ra: 0.2, rb: 0.13, mat: 'hide', bone: 'fUp.' + s, k: 0.1 });
    P.push({ type: 'ellipsoid', c: m(lerp3(shoulder, elbow, 0.35)), r: [0.17, 0.26, 0.2], mat: 'hide', bone: 'fUp.' + s, k: 0.08 });
    P.push({ type: 'capsule', a: m(elbow), b: m(wrist), ra: 0.12, rb: 0.08, mat: 'hide', bone: 'fLo.' + s, k: 0.05 });
    P.push({ type: 'ellipsoid', c: m(add(wrist, [0, -0.05, 0.08])), r: [0.1, 0.06, 0.15], mat: 'hideDark', bone: 'fPaw.' + s, k: 0.05 });
    for (const dx of [-0.06, 0, 0.06]) P.push({ type: 'cone', a: m(add(wrist, [dx, -0.05, 0.18])), b: m(add(wrist, [dx * 1.3, -0.13, 0.3])), ra: 0.028, rb: 0.004, mat: 'claw', bone: 'fPaw.' + s, k: 0.01 });
    P.push({ type: 'cone', a: m(add(elbow, [0, 0.02, -0.02])), b: m(add(elbow, [0.02, 0.12, -0.2])), ra: 0.05, rb: 0.006, mat: 'bone', bone: 'fLo.' + s, k: 0.02 }); // elbow spur
    // Hind leg.
    P.push({ type: 'ellipsoid', c: m(lerp3(hip, knee, 0.45)), r: [0.21, 0.34, 0.28], rot: [0.5, 0, 0], mat: 'hide', bone: 'hTh.' + s, k: 0.12 });
    P.push({ type: 'capsule', a: m(knee), b: m(hock), ra: 0.13, rb: 0.08, mat: 'hide', bone: 'hSh.' + s, k: 0.06 });
    P.push({ type: 'capsule', a: m(hock), b: m(hpaw), ra: 0.08, rb: 0.07, mat: 'hideDark', bone: 'hMt.' + s, k: 0.04 });
    P.push({ type: 'ellipsoid', c: m(add(hpaw, [0, -0.02, 0.08])), r: [0.09, 0.055, 0.14], mat: 'hideDark', bone: 'hPaw.' + s, k: 0.04 });
    for (const dx of [-0.05, 0, 0.05]) P.push({ type: 'cone', a: m(add(hpaw, [dx, -0.03, 0.17])), b: m(add(hpaw, [dx * 1.3, -0.09, 0.27])), ra: 0.024, rb: 0.004, mat: 'claw', bone: 'hPaw.' + s, k: 0.01 });
    P.push({ type: 'cone', a: m(hock), b: m(add(hock, [0, 0.05, -0.22])), ra: 0.045, rb: 0.005, mat: 'bone', bone: 'hMt.' + s, k: 0.02 });
  }
  // Tail with bone spikes.
  P.push({ type: 'capsule', a: [0, 1.24, -1.25], b: [0, 1.12, -1.9], ra: 0.16, rb: 0.1, mat: 'hide', bone: 'tail1', k: 0.08 });
  P.push({ type: 'capsule', a: [0, 1.12, -1.9], b: [0, 0.98, -2.5], ra: 0.1, rb: 0.06, mat: 'hide', bone: 'tail2', k: 0.05 });
  P.push({ type: 'capsule', a: [0, 0.98, -2.5], b: [0, 0.86, -3.1], ra: 0.06, rb: 0.02, mat: 'hideDark', bone: 'tail3', k: 0.04 });
  P.push({ type: 'cone', a: [0, 0.86, -3.05], b: [0, 0.84, -3.5], ra: 0.08, rb: 0.005, mat: 'bone', bone: 'tail3', k: 0.02 });
  for (const [z, bone] of [[-1.6, 'tail1'], [-2.2, 'tail2'], [-2.8, 'tail3']] as [number, string][]) {
    const y = 1.24 + (z + 1.25) * 0.2;
    P.push({ type: 'cone', a: [0, y + 0.06, z], b: [0, y + 0.26, z - 0.16], ra: 0.05, rb: 0.006, mat: 'bone', bone, k: 0.02 });
  }
  return P;
}

function headPrims(): Prim[] {
  const P: Prim[] = [];
  P.push({ type: 'capsule', a: [0, 1.5, 0.85], b: [0, 1.5, 1.08], ra: 0.22, rb: 0.2, mat: 'hide', bone: 'neck', bone2: 'head', k: 0.06 });
  // Long skull.
  P.push({ type: 'ellipsoid', c: [0, 1.54, 1.2], r: [0.22, 0.19, 0.3], mat: 'hide', bone: 'head', k: 0.06 });
  P.push({ type: 'ellipsoid', c: [0, 1.5, 1.52], r: [0.15, 0.12, 0.3], mat: 'hide', bone: 'head', k: 0.08 }); // snout
  P.push({ type: 'ellipsoid', c: [0, 1.62, 1.3], r: [0.07, 0.035, 0.26], rot: [-0.15, 0, 0], mat: 'bone', bone: 'head', k: 0.05 }); // skull ridge
  for (const sx of [1, -1]) {
    // Brow crests sweeping back into horns.
    P.push({ type: 'cone', a: [0.12 * sx, 1.64, 1.38], b: [0.26 * sx, 1.78, 0.86], ra: 0.05, rb: 0.01, bend: [0.03 * sx, 0.05, 0], mat: 'bone', bone: 'head', k: 0.03 });
    P.push({ type: 'cone', a: [0.18 * sx, 1.56, 1.1], b: [0.36 * sx, 1.62, 0.72], ra: 0.05, rb: 0.008, mat: 'boneDark', bone: 'head', k: 0.03 });
    // Eye sockets (two per side).
    P.push({ type: 'sphere', op: 'sub', c: [0.15 * sx, 1.585, 1.43], r: 0.045, mat: 'hide', bone: 'head', k: 0.015 });
    P.push({ type: 'sphere', op: 'sub', c: [0.18 * sx, 1.555, 1.3], r: 0.035, mat: 'hide', bone: 'head', k: 0.012 });
    // Cheek bones.
    P.push({ type: 'ellipsoid', c: [0.17 * sx, 1.45, 1.25], r: [0.06, 0.07, 0.16], mat: 'hideDark', bone: 'head', k: 0.04 });
    // Upper teeth.
    for (let t = 0; t < 5; t++) {
      const z = 1.78 - t * 0.075;
      const x = (0.07 + t * 0.018) * sx;
      P.push({ type: 'cone', a: [x, 1.43, z], b: [x, 1.38 - (t === 1 ? 0.04 : 0), z + 0.01], ra: 0.015, rb: 0.002, mat: 'tooth', bone: 'head', k: 0.005 });
    }
    // Vein glow on the snout.
    P.push({ type: 'capsule', op: 'paint', a: [0.1 * sx, 1.54, 1.72], b: [0.19 * sx, 1.56, 1.2], ra: 0.012, rb: 0.012, mat: 'vein', bone: 'head' });
  }
  // Mouth cavity under the upper jaw.
  P.push({ type: 'ellipsoid', op: 'sub', c: [0, 1.4, 1.52], r: [0.11, 0.05, 0.3], mat: 'mouth', bone: 'head', k: 0.02 });
  // Lower jaw.
  P.push({ type: 'ellipsoid', c: [0, 1.33, 1.46], r: [0.12, 0.06, 0.3], mat: 'hide', bone: 'jaw', k: 0.03 });
  P.push({ type: 'ellipsoid', op: 'sub', c: [0, 1.37, 1.5], r: [0.09, 0.035, 0.27], mat: 'mouth', bone: 'jaw', k: 0.015 });
  for (const sx of [1, -1])
    for (let t = 0; t < 4; t++) {
      const z = 1.72 - t * 0.08;
      const x = (0.065 + t * 0.016) * sx;
      P.push({ type: 'cone', a: [x, 1.36, z], b: [x, 1.405, z - 0.005], ra: 0.012, rb: 0.002, mat: 'tooth', bone: 'jaw', k: 0.004 });
    }
  return P;
}

interface Leg {
  up: string;
  lo: string;
  end: string;
  thigh?: string;
  home: THREE.Vector3; // root-local
  off: number; // gait phase offset
  planted: boolean;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  lift: number; // extra lift for special poses (root-local y)
  front: boolean;
}

type PoseR = Record<string, [number, number, number]>;

const ONE_SHOT: Partial<Record<MonsterState, number>> = { roar: 2.2, teleBite: 0.6, bite: 0.5, teleWhip: 0.7, whip: 0.6, telePounce: 0.7, pounce: 0.95, hit: 0.35, death: 2.5 };

export class MonsterActor {
  readonly root = new THREE.Group();
  readonly rig: Rig;
  groundFn: (x: number, z: number) => number = () => 0;
  speed = 0;
  turnRate = 0;
  lookTarget: THREE.Vector3 | null = null;
  readonly flash = uniform(new THREE.Color(0, 0, 0));
  readonly glow = uniform(0.6);
  private dissolveU = uniform(0);
  private teleGlow = 0;
  private eyeGlowU = uniform(1.5);
  onEvent?: (e: 'step' | 'biteHit' | 'whipHit' | 'pounceLand' | 'roarPeak' | 'collapse', pos: THREE.Vector3) => void;
  private _state: MonsterState = 'idle';
  private prevState: MonsterState = 'idle';
  stateTime = 0;
  private blend = 1; // 0..1 from previous to current state pose
  private fired = new Set<string>();
  private legs: Leg[] = [];
  private phase = 0;
  private t = 0;
  private springs: SpringBone[] = [];
  private look = new THREE.Vector2();

  constructor(quality: 'low' | 'high' = 'high') {
    this.rig = buildRig(MONSTER_BONES);
    const body = meshSdf({ prims: bodyPrims(), materials: MATS, bones: NAMES }, quality === 'high' ? 0.015 : 0.02, { weightSigma: 0.06, smooth: 1 });
    const head = meshSdf({ prims: headPrims(), materials: MATS, bones: NAMES }, quality === 'high' ? 0.0075 : 0.011, { weightSigma: 0.03, smooth: 1 });
    const mat = characterMaterial({ flash: vec3(this.flash as any), emissiveScale: this.glow, dissolve: this.dissolveU });
    const group = new THREE.Group();
    group.add(this.rig.root);
    for (const d of [body, head]) {
      const m = new THREE.SkinnedMesh(buildSkinnedGeometry(d), mat);
      m.bind(this.rig.skeleton, new THREE.Matrix4());
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    const hw = this.rig.bindWorld['head'];
    for (const [x, y, z, r] of [
      [0.148, 1.585, 1.415, 0.032],
      [0.176, 1.555, 1.29, 0.024],
    ])
      for (const sx of [1, -1]) {
        const e = makeEye(r, new THREE.Color(0.3, 1.0, 1.0), { slit: true, irisSize: 1.1, glow: this.eyeGlowU });
        e.position.set(x * sx - hw.x, y - hw.y, z - hw.z);
        e.rotation.y = 0.75 * sx;
        this.rig.bones['head'].add(e);
      }
    this.root.add(group);
    const b = this.rig.bones;
    this.springs = [
      new SpringBone(b['tent2.L'], 35, 4, 1.2, 0.6),
      new SpringBone(b['tent3.L'], 25, 3, 1.5, 0.8),
      new SpringBone(b['tent2.R'], 35, 4, 1.2, 0.6),
      new SpringBone(b['tent3.R'], 25, 3, 1.5, 0.8),
      new SpringBone(b['tail2'], 30, 4, 1.0, 0.5),
      new SpringBone(b['tail3'], 22, 3, 1.3, 0.7),
    ];
    const mk = (up: string, lo: string, end: string, home: Vec3, off: number, front: boolean, thigh?: string): Leg => ({ up, lo, end, thigh, home: new THREE.Vector3(...home), off, planted: true, pos: new THREE.Vector3(), from: new THREE.Vector3(), lift: 0, front });
    this.legs = [
      mk('fUp.L', 'fLo.L', 'fPaw.L', [0.38, 0.14, 0.34], 0.0, true),
      mk('fUp.R', 'fLo.R', 'fPaw.R', [-0.38, 0.14, 0.34], 0.5, true),
      mk('hSh.L', 'hMt.L', 'hPaw.L', [0.34, 0.1, -1.02], 0.5, false, 'hTh.L'),
      mk('hSh.R', 'hMt.R', 'hPaw.R', [-0.34, 0.1, -1.02], 0.0, false, 'hTh.R'),
    ];
  }

  get state() {
    return this._state;
  }
  set dissolve(v: number) {
    this.dissolveU.value = v;
  }
  get dissolve() {
    return this.dissolveU.value;
  }

  stateDuration(s: MonsterState) {
    return ONE_SHOT[s] ?? 0;
  }

  setState(s: MonsterState) {
    if (s === this._state && !ONE_SHOT[s]) return;
    this.prevState = this._state;
    this._state = s;
    this.stateTime = 0;
    this.blend = 0;
    this.fired.clear();
  }

  private placeFeet() {
    this.root.updateMatrixWorld(true);
    for (const l of this.legs) {
      l.pos.copy(l.home).applyMatrix4(this.root.matrixWorld);
      l.pos.y = this.groundFn(l.pos.x, l.pos.z) + 0.1;
      l.planted = true;
    }
  }
  private feetInit = false;

  private event(e: 'step' | 'biteHit' | 'whipHit' | 'pounceLand' | 'roarPeak' | 'collapse', at: number, pos: () => THREE.Vector3) {
    if (!this.fired.has(e) && this.stateTime >= at) {
      this.fired.add(e);
      this.onEvent?.(e, pos());
    }
  }

  point(name: 'jaw' | 'tentacleL' | 'tentacleR' | 'chest' | 'head'): THREE.Vector3 {
    const b = this.rig.bones;
    const v = new THREE.Vector3();
    if (name === 'jaw') return v.set(0, -0.05, 0.4).applyMatrix4(b['jaw'].matrixWorld);
    if (name === 'head') return b['head'].getWorldPosition(v);
    if (name === 'chest') return b['chest'].getWorldPosition(v);
    return v.set(0, 0, -0.8).applyMatrix4(b[name === 'tentacleL' ? 'tent3.L' : 'tent3.R'].matrixWorld);
  }

  hurtSpheres() {
    const b = this.rig.bones;
    const p = (n: string, x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(b[n].matrixWorld);
    return [
      { c: p('head', 0, 0.02, 0.25), r: 0.34 },
      { c: p('neck', 0, 0, 0.1), r: 0.36 },
      { c: p('chest', 0, 0.05, 0.05), r: 0.62 },
      { c: p('spine', 0, -0.1, 0), r: 0.46 },
      { c: p('pelvis', 0, -0.02, 0.02), r: 0.48 },
    ];
  }

  /** Target bone rotations + body offsets for a state at time t. */
  private statePose(s: MonsterState, t: number): { r: PoseR; lift: number; drop: number; pitch: number; roll: number; yaw: number; jaw: number; frontLift: number; tuck: number; lunge: number } {
    const br = Math.sin(this.t * 2.2);
    const r: PoseR = {};
    let drop = 0,
      pitch = 0,
      roll = 0,
      yaw = 0,
      jaw = 0.05 + Math.max(0, br) * 0.03,
      frontLift = 0,
      tuck = 0,
      lunge = 0;
    const tentIdle = (amp: number, up: number) => {
      for (const [s2, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
        const w = Math.sin(this.t * 1.3 + sx) * amp;
        r['tent1.' + s2] = [-up + w * 0.3, w * 0.4 * sx, 0];
        r['tent2.' + s2] = [w * 0.4, 0, Math.sin(this.t * 1.7 + sx * 2) * amp * 0.5];
        r['tent3.' + s2] = [w * 0.5, 0, 0];
      }
    };
    const tail = (amp: number, lift: number) => {
      r.tail1 = [-lift, Math.sin(this.t * 1.6) * amp, 0];
      r.tail2 = [-lift * 0.5, Math.sin(this.t * 1.6 - 0.8) * amp, 0];
      r.tail3 = [0, Math.sin(this.t * 1.6 - 1.6) * amp, 0];
    };
    r.chest = [0.02 * br, 0, 0];
    switch (s) {
      case 'graze': {
        const nib = Math.max(0, Math.sin(this.t * 3.1)) * 0.12;
        const lift = smoothstep(0.85, 1, Math.sin(this.t * 0.35)) * 0.8;
        r.chest = [0.12 * (1 - lift), 0, 0];
        r.neck = [0.62 - lift * 0.7, Math.sin(this.t * 0.5) * 0.25, 0];
        r.head = [0.55 - lift * 0.6 + nib, 0, 0];
        jaw = nib * 1.5;
        drop = 0.03;
        tentIdle(0.35, -0.35);
        tail(0.35, -0.1);
        break;
      }
      case 'idle':
      case 'alert': {
        const tense = s === 'alert' ? 1 : 0;
        r.neck = [-0.1 - tense * 0.3, 0, 0];
        r.head = [0.05 + tense * 0.05, 0, 0];
        tentIdle(0.25 - tense * 0.12, 0.2 + tense * 0.6);
        tail(0.25 - tense * 0.15, 0.2 + tense * 0.3);
        drop = tense * 0.06;
        jaw = tense * 0.12 + 0.04;
        break;
      }
      case 'roar': {
        const rear = smoothstep(0.0, 0.45, t) * (1 - smoothstep(1.55, 1.85, t));
        const back = smoothstep(0.35, 0.8, t) * (1 - smoothstep(1.0, 1.35, t));
        const fwd = smoothstep(1.0, 1.35, t) * (1 - smoothstep(1.9, 2.2, t));
        pitch = -0.5 * rear;
        drop = 0.18 * rear;
        frontLift = 0.9 * rear;
        r.chest = [-0.25 * rear, 0, 0];
        r.neck = [-0.7 * back + 0.5 * fwd, 0, 0];
        r.head = [-0.6 * back + 0.35 * fwd, 0, Math.sin(t * 20) * 0.05 * fwd];
        jaw = 0.25 * back + 0.95 * fwd + 0.6 * back;
        for (const [s2, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
          r['tent1.' + s2] = [-1.1 * (back + fwd), 0.5 * sx * fwd, 0.6 * sx * (back + fwd)];
          r['tent2.' + s2] = [-0.4, 0, 0.3 * sx];
          r['tent3.' + s2] = [-0.3, 0, 0];
        }
        tail(0.5, 0.6 * rear);
        break;
      }
      case 'stalk': {
        drop = 0.2;
        r.chest = [0.16, 0, 0];
        r.neck = [0.35, 0, 0];
        r.head = [-0.2, 0, 0];
        tentIdle(0.3, 0.45);
        tail(0.2, -0.05);
        jaw = 0.1;
        break;
      }
      case 'run': {
        const a = this.phase * Math.PI * 2;
        r.spine = [Math.sin(a) * 0.18, 0, 0];
        r.chest = [-Math.sin(a) * 0.12 + 0.05, 0, 0];
        r.neck = [0.2 + Math.sin(a + 1) * 0.1, 0, 0];
        r.head = [-0.15, 0, 0];
        for (const [s2] of [['L'], ['R']]) {
          r['tent1.' + s2] = [0.6, 0, 0];
          r['tent2.' + s2] = [0.3, 0, 0];
        }
        tail(0.1, 0.1);
        jaw = 0.3;
        drop = 0.05;
        break;
      }
      case 'teleBite': {
        const k = smoothstep(0, 0.5, t);
        drop = 0.26 * k;
        pitch = 0.08 * k;
        lunge = -0.25 * k;
        r.chest = [0.15 * k, 0, 0];
        r.neck = [-0.45 * k, 0, 0];
        r.head = [-0.2 * k, 0, 0];
        jaw = 0.8 * k;
        tentIdle(0.15, 0.7 * k);
        tail(0.6 * k, 0.3);
        break;
      }
      case 'bite': {
        const snap = smoothstep(0.0, 0.15, t);
        const rec = smoothstep(0.25, 0.5, t);
        drop = 0.26 - 0.2 * snap + 0.1 * rec;
        lunge = 0.45 * snap * (1 - rec);
        pitch = 0.12 * snap * (1 - rec);
        r.neck = [0.35 * snap * (1 - rec), 0, 0];
        r.head = [0.2 * snap * (1 - rec), 0, 0];
        jaw = t < 0.12 ? 0.9 : Math.max(0, 0.05 + 0.2 * rec);
        tentIdle(0.2, 0.3);
        tail(0.3, 0.2);
        break;
      }
      case 'teleWhip': {
        const k = smoothstep(0, 0.55, t);
        drop = 0.1 * k;
        r.chest = [-0.1 * k, 0, 0];
        r.neck = [-0.2 * k, 0, 0];
        jaw = 0.4 * k;
        for (const [s2, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
          const coil = Math.sin(this.t * 7 + sx) * 0.12;
          r['tent1.' + s2] = [-1.25 * k, 0.2 * sx * k, 0.25 * sx * k];
          r['tent2.' + s2] = [-0.9 * k + coil, 0, 0];
          r['tent3.' + s2] = [-0.8 * k - coil, 0, 0];
        }
        tail(0.3, 0.4 * k);
        break;
      }
      case 'whip': {
        const lash = smoothstep(0.0, 0.22, t);
        const rec = smoothstep(0.3, 0.6, t);
        lunge = 0.2 * lash * (1 - rec);
        r.chest = [0.12 * lash * (1 - rec), 0, 0];
        jaw = 0.5 * (1 - rec);
        for (const [s2, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
          const a = lerp(-1.25, 1.2, lash) * (1 - rec) + 0.2 * rec;
          r['tent1.' + s2] = [a, (-0.5 + lash * 0.9) * sx * (1 - rec), 0.25 * sx];
          r['tent2.' + s2] = [lerp(-0.9, 0.7, lash) * (1 - rec), 0, 0];
          r['tent3.' + s2] = [lerp(-0.8, 0.6, lash) * (1 - rec), 0, 0];
        }
        tail(0.4, 0.2);
        break;
      }
      case 'telePounce': {
        const k = smoothstep(0, 0.4, t);
        drop = 0.4 * k;
        pitch = 0.1 * k;
        yaw = Math.sin(this.t * 18) * 0.06 * k;
        r.pelvis = [0, Math.sin(this.t * 18) * 0.12 * k, 0];
        r.chest = [0.1 * k, 0, 0];
        r.neck = [0.2 * k, 0, 0];
        r.head = [-0.3 * k, 0, 0];
        jaw = 0.4 * k;
        tentIdle(0.1, 0.9 * k);
        tail(1.2 * k, 0.4 * k);
        break;
      }
      case 'pounce': {
        const u = Math.min(1, t / 0.75);
        const arc = Math.sin(u * Math.PI);
        drop = 0.4 * (1 - smoothstep(0, 0.12, t)) - arc * 1.6 + smoothstep(0.75, 0.85, t) * 0.25 * (1 - smoothstep(0.85, 0.95, t));
        pitch = -0.35 * Math.cos(u * Math.PI) * (t < 0.75 ? 1 : 0);
        tuck = arc;
        frontLift = arc * 0.4;
        r.neck = [-0.2, 0, 0];
        r.head = [0.1, 0, 0];
        jaw = 0.9 * (t < 0.8 ? 1 : 0.2);
        tentIdle(0.1, 0.9);
        tail(0.2, 0.5);
        break;
      }
      case 'hit': {
        const k = Math.sin(Math.min(1, t / 0.35) * Math.PI);
        r.neck = [-0.45 * k, 0.2 * k, 0];
        r.head = [-0.35 * k, 0.15 * k, 0.1 * k];
        r.chest = [-0.1 * k, 0, 0];
        drop = 0.05 * k;
        lunge = -0.12 * k;
        jaw = 0.6 * k;
        tentIdle(0.3, 0.3);
        tail(0.3, 0.1);
        break;
      }
      case 'stagger': {
        const k = smoothstep(0, 0.5, t);
        const loll = Math.sin(this.t * 1.4);
        drop = 0.5 * k;
        pitch = 0.18 * k;
        roll = loll * 0.06 * k;
        r.chest = [0.25 * k, 0, 0];
        r.neck = [0.55 * k, loll * 0.3, 0];
        r.head = [0.35 * k, loll * 0.3, loll * 0.25];
        jaw = 0.45 * k;
        for (const s2 of ['L', 'R']) {
          r['tent1.' + s2] = [0.9 * k, 0, 0];
          r['tent2.' + s2] = [0.7 * k, 0, 0];
          r['tent3.' + s2] = [0.5 * k, 0, 0];
        }
        tail(0.05, -0.3);
        break;
      }
      case 'death': {
        const rear = smoothstep(0, 0.5, t) * (1 - smoothstep(0.6, 1.0, t));
        const fall = smoothstep(0.7, 1.5, t);
        pitch = -0.3 * rear;
        frontLift = 0.5 * rear;
        drop = 0.1 * rear + 0.72 * fall;
        roll = 1.35 * fall;
        r.neck = [-0.6 * rear + 0.2 * fall, 0.4 * fall, 0];
        r.head = [-0.4 * rear, 0.3 * fall, 0];
        jaw = 0.9 * rear + 0.35 * fall;
        for (const s2 of ['L', 'R']) {
          r['tent1.' + s2] = [-0.8 * rear + 1.0 * fall, 0, 0.5 * fall];
          r['tent2.' + s2] = [0.5 * fall, 0, 0];
        }
        tail(0.05 * (1 - fall), 0);
        break;
      }
    }
    return { r, lift: 0, drop, pitch, roll, yaw, jaw, frontLift, tuck, lunge };
  }

  update(dt: number) {
    this.t += dt;
    this.stateTime += dt;
    this.blend = Math.min(1, this.blend + dt / 0.22);
    if (!this.feetInit) {
      this.placeFeet();
      this.feetInit = true;
    }
    const s = this._state;
    const t = this.stateTime;
    const b = this.rig.bones;
    // Events.
    if (s === 'roar') this.event('roarPeak', 0.8, () => this.point('head'));
    if (s === 'bite') this.event('biteHit', 0.16, () => this.point('jaw'));
    if (s === 'whip') this.event('whipHit', 0.22, () => this.point('chest'));
    if (s === 'pounce') this.event('pounceLand', 0.78, () => this.point('chest'));
    if (s === 'death') this.event('collapse', 1.45, () => this.point('chest'));
    if (s === 'roar' && t > 1.75 && !this.fired.has('slam')) {
      this.fired.add('slam');
      this.onEvent?.('step', this.point('chest').setY(this.root.position.y));
    }

    // Pose = blend(prev, current).
    const cur = this.statePose(s, t);
    const prv = this.blend < 1 ? this.statePose(this.prevState, 99) : cur;
    const k = this.blend * this.blend * (3 - 2 * this.blend);
    const mixN = (a: number, c: number) => a + (c - a) * k;
    for (const n of NAMES) b[n].quaternion.identity();
    b['pelvis'].position.copy(this.rig.rest['pelvis']);
    const bones = new Set([...Object.keys(cur.r), ...Object.keys(prv.r)]);
    const e = new THREE.Euler();
    for (const n of bones) {
      const a = prv.r[n] ?? [0, 0, 0],
        c = cur.r[n] ?? [0, 0, 0];
      e.set(mixN(a[0], c[0]), mixN(a[1], c[1]), mixN(a[2], c[2]));
      b[n].quaternion.setFromEuler(e);
    }
    const drop = mixN(prv.drop, cur.drop),
      pitch = mixN(prv.pitch, cur.pitch),
      roll = mixN(prv.roll, cur.roll),
      yaw = mixN(prv.yaw, cur.yaw),
      frontLift = mixN(prv.frontLift, cur.frontLift),
      tuck = mixN(prv.tuck, cur.tuck),
      lunge = mixN(prv.lunge, cur.lunge);
    b['jaw'].rotation.x = mixN(prv.jaw, cur.jaw) * 0.7;

    // Locomotion body motion.
    const loco = s === 'stalk' || s === 'run' || s === 'graze' || s === 'idle' || s === 'alert';
    const freq = this.speed < 0.2 || !loco ? 0 : s === 'run' ? 1.5 + this.speed * 0.08 : 0.7 + this.speed * 0.28;
    this.phase = (this.phase + dt * freq) % 1;
    const run = clamp(this.speed / 11, 0, 1);
    const bob = freq > 0 ? Math.cos(this.phase * Math.PI * (s === 'run' ? 2 : 4)) * (0.02 + run * 0.08) : 0;
    const pel = b['pelvis'];
    pel.position.y += -drop + bob + Math.sin(this.t * 2.2) * 0.01;
    pel.position.z += lunge;
    const baseRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch + run * 0.04, yaw, roll));
    pel.quaternion.premultiply(baseRot);
    // Head tracking (additive on neck/head).
    if (this.lookTarget && s !== 'death' && s !== 'graze' && s !== 'stagger') {
      this.root.updateMatrixWorld(true);
      const hp = new THREE.Vector3();
      b['neck'].getWorldPosition(hp);
      const to = this.lookTarget.clone().sub(hp).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert());
      this.look.x = damp(this.look.x, clamp(Math.atan2(to.x, to.z), -1.0, 1.0), 5, dt);
      this.look.y = damp(this.look.y, clamp(-Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.5, 0.5), 5, dt);
    } else {
      this.look.x = damp(this.look.x, 0, 3, dt);
      this.look.y = damp(this.look.y, 0, 3, dt);
    }
    b['neck'].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.y * 0.5, this.look.x * 0.5, 0)));
    b['head'].quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.y * 0.5, this.look.x * 0.5, 0)));
    this.root.updateMatrixWorld(true);
    this.solveLegs(dt, freq, run, s, frontLift, tuck);
    for (const sp of this.springs) sp.update(Math.min(dt, 1 / 30));
    // Glow: telegraphs flare.
    const tele = s.startsWith('tele') ? 1 : 0;
    this.teleGlow = damp(this.teleGlow, tele, 8, dt);
    this.eyeGlowU.value = (1.2 + this.teleGlow * 2.5) * (s === 'death' ? Math.max(0, 1 - t / 1.5) : 1) * (0.5 + this.glow.value * 0.6);
    (this as any)._glowBoost = this.teleGlow;
  }

  private solveLegs(dt: number, freq: number, run: number, s: MonsterState, frontLift: number, tuck: number) {
    const b = this.rig.bones;
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const stride = this.speed / Math.max(freq, 0.01);
    const stance = s === 'run' ? 0.42 : 0.62;
    const gallopOff = [0.0, 0.1, 0.55, 0.65];
    const dead = s === 'death' && this.stateTime > 0.9;
    this.legs.forEach((l, i) => {
      if (dead) return; // limp FK when collapsed
      const home = l.home.clone().applyMatrix4(this.root.matrixWorld);
      home.y = this.groundFn(home.x, home.z) + 0.1;
      const off = s === 'run' ? gallopOff[i] : l.off;
      const ph = (this.phase + off) % 1;
      if (freq > 0) {
        if (ph < stance) {
          if (!l.planted) {
            l.planted = true;
            if (run > 0.2 || i < 2) this.onEvent?.('step', l.pos.clone());
          }
        } else {
          if (l.planted) {
            l.planted = false;
            l.from.copy(l.pos);
          }
          const u = (ph - stance) / (1 - stance);
          const land = home.clone().addScaledVector(fwd, stride * stance * 0.5);
          land.y = this.groundFn(land.x, land.z) + 0.1;
          const ee = u * u * (3 - 2 * u);
          l.pos.lerpVectors(l.from, land, ee);
          l.pos.y += Math.sin(u * Math.PI) * (0.18 + run * 0.3);
        }
      } else {
        // Re-plant when drifted (turning in place, lunges).
        if (l.pos.distanceTo(home) > 0.45) {
          l.pos.lerp(home, Math.min(1, dt * 8));
          l.pos.y += 0.05;
        }
      }
      const target = l.pos.clone();
      const lift = (l.front ? frontLift : frontLift * 0.1) + tuck * (l.front ? 0.5 : 0.7);
      if (lift > 0.001) {
        const body = new THREE.Vector3();
        b[l.up].getWorldPosition(body);
        target.lerp(body.clone().addScaledVector(fwd, l.front ? 0.35 : -0.1).add(new THREE.Vector3(0, -0.45, 0)), Math.min(1, lift));
      }
      if (l.thigh) {
        const hipP = new THREE.Vector3();
        b[l.thigh].getWorldPosition(hipP);
        const fore = target.clone().sub(hipP).dot(fwd);
        b[l.thigh].rotation.x = clamp(-fore * 0.7 - 0.1, -0.8, 0.8);
        b[l.thigh].updateMatrixWorld(true);
      }
      const pole = new THREE.Vector3();
      b[l.lo].getWorldPosition(pole);
      pole.addScaledVector(fwd, -0.9);
      solveTwoBone(b[l.up], b[l.lo], b[l.end], target, pole, 1);
      // Paw flat to the ground in stance, curled in swing.
      const paw = b[l.end];
      const pq = new THREE.Quaternion();
      paw.parent!.getWorldQuaternion(pq);
      const want = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(l.planted ? 0 : 0.6, 0, 0)));
      paw.quaternion.copy(pq.invert().multiply(want));
    });
    if (dead) {
      for (const l of this.legs) {
        b[l.up].rotation.x = l.front ? -0.6 : 0.2;
        b[l.lo].rotation.x = l.front ? 0.8 : -0.4;
      }
    }
  }
}
