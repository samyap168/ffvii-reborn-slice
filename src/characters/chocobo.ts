// The Golden Chocobo: SDF-sculpted bird with saddle, rig, and a procedural
// foot-planting gait (world-locked stance feet, arcing swings, head stabilisation).
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { meshSdf, type Prim, type MaterialDef, type Vec3, type MeshJob } from './sdf';
import { buildRig, type BoneSpec, type Rig, mirrorX, add, lerp3 } from './rig';
import { buildSkinnedGeometry, characterMaterial } from './charmat';
import { makeEye } from './eyes';
import { SpringBone, solveTwoBone } from './anim';
import { damp, clamp } from '../core/math';

const lin = (r: number, g: number, b: number): Vec3 => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];

const MATS: Record<string, MaterialDef> = {
  gold: { color: lin(0.98, 0.72, 0.16), rough: 0.5, metal: 0.3, kind: 5 },
  goldLight: { color: lin(1.0, 0.84, 0.42), rough: 0.55, metal: 0.15, kind: 5 },
  goldDeep: { color: lin(0.88, 0.52, 0.08), rough: 0.45, metal: 0.4, kind: 5 },
  beak: { color: lin(0.96, 0.62, 0.2), rough: 0.32, metal: 0, kind: 8 },
  scale: { color: lin(0.92, 0.6, 0.22), rough: 0.45, metal: 0, kind: 6 },
  claw: { color: lin(0.2, 0.16, 0.13), rough: 0.3, metal: 0, kind: 8 },
  saddle: { color: lin(0.42, 0.24, 0.13), rough: 0.55, metal: 0, kind: 2 },
  blanket: { color: lin(0.62, 0.1, 0.1), rough: 0.85, metal: 0, kind: 1 },
  trim: { color: lin(0.85, 0.72, 0.35), rough: 0.3, metal: 1, kind: 3 },
  strap: { color: lin(0.25, 0.15, 0.09), rough: 0.55, metal: 0, kind: 2 },
};

const hip: Vec3 = [0.2, 1.14, -0.08];
const knee: Vec3 = [0.23, 0.86, 0.16];
const hock: Vec3 = [0.235, 0.5, -0.12];
const ball: Vec3 = [0.24, 0.07, 0.03];

export const CHOCO_BONES: BoneSpec[] = [
  { name: 'pelvis', parent: null, pos: [0, 1.28, -0.12] },
  { name: 'body', parent: 'pelvis', pos: [0, 1.32, 0.22] },
  { name: 'saddle', parent: 'body', pos: [0, 1.62, -0.06] },
  { name: 'neck1', parent: 'body', pos: [0, 1.48, 0.44] },
  { name: 'neck2', parent: 'neck1', pos: [0, 1.74, 0.54] },
  { name: 'neck3', parent: 'neck2', pos: [0, 1.98, 0.6] },
  { name: 'head', parent: 'neck3', pos: [0, 2.12, 0.66] },
  { name: 'jaw', parent: 'head', pos: [0, 2.09, 0.8] },
  { name: 'crest', parent: 'head', pos: [0, 2.24, 0.6] },
  { name: 'tail', parent: 'pelvis', pos: [0, 1.36, -0.55] },
  { name: 'tail2', parent: 'tail', pos: [0, 1.42, -0.85] },
  { name: 'wing.L', parent: 'body', pos: [0.32, 1.48, 0.2] },
  { name: 'wingtip.L', parent: 'wing.L', pos: [0.4, 1.38, -0.2] },
  { name: 'wing.R', parent: 'body', pos: [-0.32, 1.48, 0.2] },
  { name: 'wingtip.R', parent: 'wing.R', pos: [-0.4, 1.38, -0.2] },
  { name: 'thigh.L', parent: 'pelvis', pos: hip },
  { name: 'shin.L', parent: 'thigh.L', pos: knee },
  { name: 'tarsus.L', parent: 'shin.L', pos: hock },
  { name: 'foot.L', parent: 'tarsus.L', pos: ball },
  { name: 'thigh.R', parent: 'pelvis', pos: mirrorX(hip) },
  { name: 'shin.R', parent: 'thigh.R', pos: mirrorX(knee) },
  { name: 'tarsus.R', parent: 'shin.R', pos: mirrorX(hock) },
  { name: 'foot.R', parent: 'tarsus.R', pos: mirrorX(ball) },
];
const NAMES = CHOCO_BONES.map((b) => b.name);

function bodyPrims(): Prim[] {
  const P: Prim[] = [];
  P.push({ type: 'ellipsoid', c: [0, 1.28, -0.2], r: [0.34, 0.33, 0.42], mat: 'gold', bone: 'pelvis', k: 0.1 });
  P.push({ type: 'ellipsoid', c: [0, 1.34, 0.2], r: [0.35, 0.37, 0.38], mat: 'gold', bone: 'body', k: 0.15 });
  P.push({ type: 'ellipsoid', c: [0, 1.1, 0.06], r: [0.29, 0.2, 0.42], mat: 'goldLight', bone: 'body', bone2: 'pelvis', k: 0.12 });
  // Chest ruff.
  P.push({ type: 'ellipsoid', c: [0, 1.5, 0.42], r: [0.26, 0.24, 0.2], mat: 'goldLight', bone: 'neck1', k: 0.1 });
  // Neck.
  P.push({ type: 'capsule', a: [0, 1.48, 0.44], b: [0, 1.74, 0.54], ra: 0.16, rb: 0.12, mat: 'gold', bone: 'neck1', k: 0.08 });
  P.push({ type: 'capsule', a: [0, 1.74, 0.54], b: [0, 1.98, 0.6], ra: 0.12, rb: 0.1, mat: 'gold', bone: 'neck2', k: 0.06 });
  P.push({ type: 'capsule', a: [0, 1.98, 0.6], b: [0, 2.1, 0.66], ra: 0.1, rb: 0.1, mat: 'gold', bone: 'neck3', k: 0.06 });
  // Tail fan.
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.28;
    P.push({ type: 'ellipsoid', c: [Math.sin(a) * 0.22, 1.43 + Math.abs(a) * -0.05, -0.78 - Math.cos(a) * 0.12], r: [0.09, 0.035, 0.32], rot: [-0.45, a, 0], mat: i === 2 ? 'goldDeep' : 'gold', bone: 'tail2', k: 0.05 });
  }
  P.push({ type: 'ellipsoid', c: [0, 1.36, -0.58], r: [0.2, 0.16, 0.22], mat: 'gold', bone: 'tail', k: 0.1 });
  // Wings folded against the body.
  for (const sx of [1, -1]) {
    const s = sx > 0 ? 'L' : 'R';
    P.push({ type: 'ellipsoid', c: [0.31 * sx, 1.38, 0.05], r: [0.07, 0.2, 0.36], rot: [0.2, 0, 0.25 * sx], mat: 'goldDeep', bone: 'wing.' + s, k: 0.05 });
    for (let f = 0; f < 3; f++)
      P.push({ type: 'ellipsoid', c: [0.35 * sx, 1.3 - f * 0.05, -0.18 - f * 0.08], r: [0.035, 0.08, 0.22], rot: [0.5 + f * 0.1, 0, 0.3 * sx], mat: 'goldDeep', bone: 'wingtip.' + s, k: 0.03 });
    // Legs.
    const m = (v: Vec3): Vec3 => (sx > 0 ? v : mirrorX(v));
    P.push({ type: 'ellipsoid', c: m(lerp3(hip, knee, 0.45)), r: [0.14, 0.24, 0.17], rot: [-0.5, 0, 0], mat: 'gold', bone: 'thigh.' + s, k: 0.08 });
    P.push({ type: 'capsule', a: m(knee), b: m(hock), ra: 0.11, rb: 0.065, mat: 'gold', bone: 'shin.' + s, k: 0.05 });
    P.push({ type: 'ellipsoid', c: m(add(hock, [0, 0.04, 0])), r: [0.07, 0.08, 0.07], mat: 'goldLight', bone: 'shin.' + s, k: 0.04 }); // feather cuff
    P.push({ type: 'capsule', a: m(hock), b: m(ball), ra: 0.052, rb: 0.045, mat: 'scale', bone: 'tarsus.' + s, k: 0.02 });
    // Toes + claws.
    const toes: Vec3[] = [
      [0.0, -0.035, 0.21],
      [0.085, -0.04, 0.17],
      [-0.08, -0.04, 0.17],
      [0.0, -0.03, -0.12],
    ];
    for (const t of toes) {
      const end = add(ball, t);
      P.push({ type: 'capsule', a: m(ball), b: m(end), ra: 0.04, rb: 0.022, mat: 'scale', bone: 'foot.' + s, k: 0.02 });
      const dir = [t[0], 0, t[2]];
      const l = Math.hypot(dir[0], dir[2]);
      P.push({ type: 'cone', a: m(end), b: m(add(end, [(dir[0] / l) * 0.06, -0.025, (dir[2] / l) * 0.06])), ra: 0.02, rb: 0.003, mat: 'claw', bone: 'foot.' + s, k: 0.005 });
    }
  }
  // Saddle: blanket + leather seat + girth strap.
  P.push({ type: 'band', c: [0, 1.34, 0.02], r: [0.355, 0.37, 0.5], n: [0, 0.2, 1], off: [0, 1.5, -0.05], w: 0.2, t: 0.012, mat: 'blanket', bone: 'body', bone2: 'pelvis', k: 0.01 });
  P.push({ type: 'ellipsoid', c: [0, 1.62, -0.06], r: [0.2, 0.06, 0.22], mat: 'saddle', bone: 'body', k: 0.03 });
  P.push({ type: 'ellipsoid', c: [0, 1.66, 0.13], r: [0.1, 0.07, 0.06], mat: 'saddle', bone: 'body', k: 0.03 }); // pommel
  P.push({ type: 'ellipsoid', c: [0, 1.66, -0.25], r: [0.16, 0.06, 0.05], mat: 'saddle', bone: 'body', k: 0.03 }); // cantle
  P.push({ type: 'band', c: [0, 1.32, 0.0], r: [0.36, 0.375, 0.5], n: [0, 0.05, 1], off: [0, 1.3, 0.02], w: 0.035, t: 0.012, mat: 'strap', bone: 'body', k: 0.006 });
  P.push({ type: 'torus', c: [0, 1.66, 0.13], R: 0.07, r: 0.012, rot: [1.2, 0, 0], mat: 'trim', bone: 'body', k: 0.004 });
  return P;
}

function headPrims(): Prim[] {
  const P: Prim[] = [];
  P.push({ type: 'capsule', a: [0, 1.95, 0.59], b: [0, 2.1, 0.66], ra: 0.1, rb: 0.105, mat: 'gold', bone: 'neck3', bone2: 'head', k: 0.05 });
  P.push({ type: 'ellipsoid', c: [0, 2.13, 0.69], r: [0.115, 0.12, 0.155], mat: 'gold', bone: 'head', k: 0.05 });
  for (const sx of [1, -1]) P.push({ type: 'ellipsoid', c: [0.07 * sx, 2.09, 0.72], r: [0.06, 0.055, 0.08], mat: 'goldLight', bone: 'head', k: 0.04 }); // cheeks
  // Upper beak (hooked) and lower mandible on the jaw bone.
  P.push({ type: 'cone', a: [0, 2.14, 0.8], b: [0, 2.06, 1.03], ra: 0.07, rb: 0.012, bend: [0, 0.03, 0.01], mat: 'beak', bone: 'head', k: 0.03 });
  P.push({ type: 'ellipsoid', c: [0, 2.12, 0.86], r: [0.06, 0.045, 0.09], mat: 'beak', bone: 'head', k: 0.03 });
  P.push({ type: 'cone', a: [0, 2.075, 0.8], b: [0, 2.045, 0.96], ra: 0.052, rb: 0.01, mat: 'beak', bone: 'jaw', k: 0.01 });
  for (const sx of [1, -1]) P.push({ type: 'sphere', op: 'sub', c: [0.078 * sx, 2.16, 0.775], r: 0.03, mat: 'gold', bone: 'head', k: 0.012 }); // eye sockets
  // Crest plumes.
  const crest = (base: Vec3, tip: Vec3, r: number, bend: Vec3) => P.push({ type: 'cone', a: base, b: tip, ra: r, rb: 0.006, bend, mat: 'goldDeep', bone: 'crest', k: 0.03 });
  crest([0, 2.24, 0.66], [0, 2.44, 0.5], 0.05, [0, 0.03, 0.04]);
  crest([0.04, 2.23, 0.62], [0.09, 2.39, 0.44], 0.04, [0, 0.03, 0.03]);
  crest([-0.04, 2.23, 0.62], [-0.09, 2.39, 0.44], 0.04, [0, 0.03, 0.03]);
  crest([0, 2.22, 0.58], [0, 2.32, 0.36], 0.045, [0, 0.03, 0]);
  // Halter strap around the beak base.
  P.push({ type: 'torus', c: [0, 2.11, 0.82], R: 0.068, r: 0.01, rot: [1.35, 0, 0], mat: 'strap', bone: 'head', k: 0.004 });
  return P;
}

export class ChocoboActor {
  readonly root = new THREE.Group();
  readonly rig: Rig;
  readonly flash = uniform(new THREE.Color(0, 0, 0));
  readonly saddle: THREE.Bone;
  private springs: SpringBone[];
  // gait state
  speed = 0; // m/s
  maxSpeed = 16;
  phase = 0;
  turnRate = 0;
  accel = 0;
  private prevSpeed = 0;
  private feet: { planted: boolean; pos: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  groundFn: (x: number, z: number) => number = () => 0;
  onFootstep?: (side: 0 | 1, pos: THREE.Vector3, intensity: number) => void;
  private t = 0;
  private headLook = new THREE.Vector2();
  lookTarget: THREE.Vector3 | null = null;
  kweh = 0; // beak open amount
  private bodyPitch = 0;
  private bodyRoll = 0;
  private wingFlap = 0;
  idleTimer = 0;

  constructor(quality: 'low' | 'high' = 'high') {
    this.rig = buildRig(CHOCO_BONES);
    const [body, head] = chocoboMeshJobs(quality).map((j) => meshSdf(j.model, j.cell, j.opts));
    const mat = characterMaterial({ flash: vec3(this.flash as any) });
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
    for (const sx of [1, -1]) {
      const eye = makeEye(0.03, new THREE.Color(0.25, 0.5, 0.9), { irisSize: 0.95, pupil: 0.5 });
      const hw = this.rig.bindWorld['head'];
      eye.position.set(0.074 * sx - hw.x, 2.16 - hw.y, 0.77 - hw.z);
      eye.rotation.y = 0.45 * sx;
      this.rig.bones['head'].add(eye);
    }
    this.root.add(group);
    this.saddle = this.rig.bones['saddle'];
    const b = this.rig.bones;
    this.springs = [new SpringBone(b['crest'], 40, 5, 1.4, 0.6), new SpringBone(b['tail2'], 30, 4, 1.2, 0.5), new SpringBone(b['wingtip.L'], 60, 7, 0.5, 0.3), new SpringBone(b['wingtip.R'], 60, 7, 0.5, 0.3)];
    for (let i = 0; i < 2; i++) this.feet.push({ planted: true, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0 });
  }

  /** Snap feet to the current stance (call after teleporting). */
  resetFeet() {
    this.root.updateMatrixWorld(true);
    const b = this.rig.bones;
    ['L', 'R'].forEach((s, i) => {
      b['foot.' + s].getWorldPosition(this.feet[i].pos);
      this.feet[i].pos.y = this.groundFn(this.feet[i].pos.x, this.feet[i].pos.z) + 0.07;
      this.feet[i].planted = true;
    });
  }

  update(dt: number) {
    this.t += dt;
    const b = this.rig.bones;
    const s01 = clamp(this.speed / this.maxSpeed, 0, 1);
    this.accel = damp(this.accel, (this.speed - this.prevSpeed) / Math.max(dt, 1e-3), 6, dt);
    this.prevSpeed = this.speed;
    // Stride frequency grows sub-linearly with speed (longer strides when fast).
    const freq = this.speed < 0.2 ? 0 : 0.9 + Math.sqrt(this.speed) * 0.42;
    this.phase = (this.phase + dt * freq) % 1;

    // Reset pose.
    for (const n of NAMES) b[n].quaternion.identity();
    b['pelvis'].position.copy(this.rig.rest['pelvis']);

    // Body motion.
    const run = s01;
    const bob = Math.cos(this.phase * Math.PI * 4) * (0.025 + run * 0.06) * (freq > 0 ? 1 : 0);
    const idleBreath = Math.sin(this.t * 1.6) * 0.012 * (1 - run);
    this.bodyPitch = damp(this.bodyPitch, 0.12 * run + clamp(this.accel * 0.015, -0.12, 0.15), 5, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(-this.turnRate * 0.12 * (0.3 + run), -0.35, 0.35), 5, dt);
    b['pelvis'].position.y += bob - run * 0.08 + idleBreath;
    b['pelvis'].rotation.set(this.bodyPitch * 0.6, Math.sin(this.phase * Math.PI * 2) * 0.05 * run, this.bodyRoll + Math.sin(this.phase * Math.PI * 2) * 0.03 * run);
    b['body'].rotation.set(this.bodyPitch * 0.4, 0, 0);

    // Neck: counter-bob so the head stays stable (bird head stabilisation), crane when idle.
    const neckFwd = run * 0.5;
    const idleLook = Math.sin(this.t * 0.4) * 0.3 * (1 - run);
    this.idleTimer += dt;
    b['neck1'].rotation.set(neckFwd * 0.6 - this.bodyPitch * 0.5 - bob * 1.5, idleLook * 0.3, 0);
    b['neck2'].rotation.set(neckFwd * 0.2 + bob * 1.2, idleLook * 0.3, -this.bodyRoll * 0.5);
    b['neck3'].rotation.set(-neckFwd * 0.5 + bob * 1.8, idleLook * 0.4, -this.bodyRoll * 0.5);
    let hx = -neckFwd * 0.35 - bob * 1.2,
      hy = idleLook * 0.5;
    if (this.lookTarget) {
      const hp = new THREE.Vector3();
      b['head'].getWorldPosition(hp);
      const toT = this.lookTarget.clone().sub(hp);
      const inv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      toT.applyQuaternion(inv);
      this.headLook.x = damp(this.headLook.x, clamp(Math.atan2(toT.x, toT.z), -1.2, 1.2), 4, dt);
      this.headLook.y = damp(this.headLook.y, clamp(-Math.atan2(toT.y, Math.hypot(toT.x, toT.z)), -0.6, 0.6), 4, dt);
      hy += this.headLook.x;
      hx += this.headLook.y;
    }
    b['head'].rotation.set(hx, hy, 0);
    b['jaw'].rotation.x = this.kweh * 0.5;
    this.kweh = damp(this.kweh, 0, 6, dt);

    // Wings: tucked, partial flaps at high speed for balance.
    this.wingFlap = damp(this.wingFlap, run > 0.75 ? 1 : Math.abs(this.turnRate) > 1.2 ? 0.6 : 0, 3, dt);
    const flap = Math.sin(this.t * 14) * this.wingFlap;
    b['wing.L'].rotation.set(0, 0, 0.15 * this.wingFlap + flap * 0.35);
    b['wing.R'].rotation.set(0, 0, -0.15 * this.wingFlap - flap * 0.35);
    b['tail'].rotation.set(-0.1 * run + Math.sin(this.t * 2) * 0.05, Math.sin(this.phase * Math.PI * 2) * 0.12 * run - this.turnRate * 0.1, 0);

    // Thighs: rotate with the stride; legs solved by IK below.
    this.root.updateMatrixWorld(true);
    this.legs(dt, run, freq);

    for (const s of this.springs) s.update(Math.min(dt, 1 / 30));
  }

  private _hip = new THREE.Vector3();
  private _tgt = new THREE.Vector3();
  private _pole = new THREE.Vector3();
  private legs(dt: number, run: number, freq: number) {
    const b = this.rig.bones;
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const vel = fwd.clone().multiplyScalar(this.speed);
    const stanceFrac = 0.62 - run * 0.2; // fraction of cycle a foot is on the ground
    const stride = this.speed / Math.max(freq, 0.01);
    ['L', 'R'].forEach((s, i) => {
      const foot = this.feet[i];
      const ph = (this.phase + i * 0.5) % 1;
      const home = new THREE.Vector3();
      this.rig.bones['thigh.' + s].getWorldPosition(this._hip);
      home.copy(this._hip).addScaledVector(side, (i === 0 ? 1 : -1) * 0.05);
      const moving = freq > 0;
      if (!moving) {
        // Idle: re-plant feet near home if they drifted.
        const want = home.clone().addScaledVector(fwd, 0.08);
        want.y = this.groundFn(want.x, want.z) + 0.07;
        if (foot.pos.distanceTo(want) > 0.35 && !this.feet[1 - i].planted === false) {
          foot.from.copy(foot.pos);
          foot.to.copy(want);
          foot.planted = false;
          foot.t = 0;
        }
        if (!foot.planted) {
          foot.t = Math.min(1, foot.t + dt * 4);
          foot.pos.lerpVectors(foot.from, foot.to, foot.t);
          foot.pos.y += Math.sin(foot.t * Math.PI) * 0.15;
          if (foot.t >= 1) {
            foot.planted = true;
            this.onFootstep?.(i as 0 | 1, foot.pos, 0.35);
          }
        }
      } else if (ph < stanceFrac) {
        if (!foot.planted) {
          foot.planted = true;
          this.onFootstep?.(i as 0 | 1, foot.pos, 0.4 + run * 0.6);
        }
        // Planted: stays locked in world (no foot sliding).
      } else {
        if (foot.planted) {
          foot.planted = false;
          foot.from.copy(foot.pos);
        }
        const u = (ph - stanceFrac) / (1 - stanceFrac);
        // Predict the landing point half a stride ahead of the hip.
        const land = home.clone().addScaledVector(fwd, stride * stanceFrac * 0.5 + 0.1).addScaledVector(vel, 0.05);
        land.y = this.groundFn(land.x, land.z) + 0.07;
        foot.to.copy(land);
        const e = u * u * (3 - 2 * u);
        foot.pos.lerpVectors(foot.from, foot.to, e);
        foot.pos.y += Math.sin(u * Math.PI) * (0.25 + run * 0.35);
      }
      // Thigh swing follows foot fore/aft offset.
      const rel = foot.pos.clone().sub(this._hip);
      const fore = rel.dot(fwd);
      b['thigh.' + s].rotation.x = clamp(-fore * 0.8, -0.9, 0.9);
      b['thigh.' + s].updateMatrixWorld(true);
      // IK: shin + tarsus reach the ball of the foot; hock bends backwards.
      this._tgt.copy(foot.pos);
      b['shin.' + s].getWorldPosition(this._pole);
      this._pole.addScaledVector(fwd, -0.8).y -= 0.2;
      solveTwoBone(b['shin.' + s], b['tarsus.' + s], b['foot.' + s], this._tgt, this._pole, 1);
      // Toes: flat on stance, curled in swing.
      const footB = b['foot.' + s];
      const curl = foot.planted ? 0 : 0.7;
      const worldQ = new THREE.Quaternion();
      footB.parent!.getWorldQuaternion(worldQ);
      const want = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(curl, 0, 0)));
      footB.quaternion.copy(worldQ.invert().multiply(want));
    });
  }

  springsUpdate() {}
}

export function chocoboMeshJobs(quality: 'low' | 'high' = 'high'): MeshJob[] {
  return [
    { model: { prims: bodyPrims(), materials: MATS, bones: NAMES }, cell: quality === 'high' ? 0.0125 : 0.018, opts: { weightSigma: 0.06, smooth: 1 } },
    { model: { prims: headPrims(), materials: MATS, bones: NAMES }, cell: quality === 'high' ? 0.0065 : 0.009, opts: { weightSigma: 0.035, smooth: 1 } },
  ];
}
