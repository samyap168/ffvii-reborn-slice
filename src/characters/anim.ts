// Procedural/keyframed animation core: poses as local Euler offsets on an
// identity-bind rig, smooth cubic clip sampling, quaternion layer blending,
// two-bone IK and spring-driven secondary motion.
import * as THREE from 'three/webgpu';
import type { Rig } from './rig';

export type E3 = [number, number, number];
export interface Pose {
  r: Record<string, E3>; // bone -> euler (XYZ, radians) relative to bind
  hips?: E3; // root translation offset (m)
  /** Blade direction in character space (+Z fwd, +X left, +Y up); overrides the hand orientation. */
  sword?: E3;
  /** Blade roll around its axis (radians). */
  roll?: number;
  /** Left hand on the grip (0..1). */
  lh?: number;
}

export const mirrorE = (e: E3): E3 => [e[0], -e[1], -e[2]];

/** Build a pose; keys ending in '*' are applied to both .L and mirrored .R. */
export function pose(def: Record<string, E3>, hips?: E3, extra?: { sword?: E3; roll?: number; lh?: number }): Pose {
  const r: Record<string, E3> = {};
  for (const [k, v] of Object.entries(def)) {
    if (k.endsWith('*')) {
      const base = k.slice(0, -1);
      r[base + '.L'] = v;
      r[base + '.R'] = mirrorE(v);
    } else r[k] = v;
  }
  return { r, hips, ...extra };
}

/** Merge poses (later overrides earlier). */
export function merge(...ps: Pose[]): Pose {
  const r: Record<string, E3> = {};
  let hips: E3 | undefined;
  let sword: E3 | undefined;
  let roll: number | undefined;
  let lh: number | undefined;
  for (const p of ps) {
    Object.assign(r, p.r);
    if (p.hips) hips = p.hips;
    if (p.sword) sword = p.sword;
    if (p.roll !== undefined) roll = p.roll;
    if (p.lh !== undefined) lh = p.lh;
  }
  return { r, hips, sword, roll, lh };
}

export function mirrorPose(p: Pose): Pose {
  const r: Record<string, E3> = {};
  for (const [k, v] of Object.entries(p.r)) {
    let nk = k;
    if (k.endsWith('.L')) nk = k.slice(0, -2) + '.R';
    else if (k.endsWith('.R')) nk = k.slice(0, -2) + '.L';
    r[nk] = mirrorE(v);
  }
  return { r, hips: p.hips ? [-p.hips[0], p.hips[1], p.hips[2]] : undefined };
}

export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'snap' | 'hold' | 'back';
export interface Key {
  t: number;
  p: Pose;
  ease?: Ease; // easing INTO this key
}
export interface Clip {
  name: string;
  dur: number;
  loop: boolean;
  keys: Key[];
  /** Named events (seconds) fired when crossed: e.g. { hit: 0.32 } */
  events?: Record<string, number>;
}

const easeFn = (e: Ease | undefined, t: number) => {
  switch (e) {
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'inout':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'snap':
      return 1 - Math.pow(1 - t, 6);
    case 'hold':
      return t < 1 ? 0 : 1;
    case 'back': {
      const s = 1.8;
      return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }
    default:
      return t;
  }
};

const getE = (p: Pose, b: string): E3 => p.r[b] ?? [0, 0, 0];

/** Sample a clip at time t (seconds). Smooth Catmull-Rom between keys, with per-key easing. */
export function sampleClip(c: Clip, t: number, out: Pose = { r: {} }): Pose {
  const keys = c.keys;
  if (c.loop) t = ((t % c.dur) + c.dur) % c.dur;
  else t = Math.max(0, Math.min(c.dur, t));
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k1 = keys[i];
  const k2 = keys[Math.min(keys.length - 1, i + 1)];
  if (k1 === k2 || k2.t <= k1.t) {
    return copyPose(k1.p, out);
  }
  const k0 = keys[Math.max(0, i - 1)];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = easeFn(k2.ease, (t - k1.t) / (k2.t - k1.t));
  const bones = new Set<string>([...Object.keys(k1.p.r), ...Object.keys(k2.p.r)]);
  out.r = {};
  const smooth = k2.ease === undefined || k2.ease === 'inout' || k2.ease === 'linear';
  for (const b of bones) {
    const a = getE(k1.p, b),
      bb = getE(k2.p, b);
    const r: E3 = [0, 0, 0];
    if (smooth) {
      const p0 = getE(k0.p, b),
        p3 = getE(k3.p, b);
      for (let q = 0; q < 3; q++) r[q] = catmull(p0[q], a[q], bb[q], p3[q], u);
    } else for (let q = 0; q < 3; q++) r[q] = a[q] + (bb[q] - a[q]) * u;
    out.r[b] = r;
  }
  const ha = k1.p.hips ?? [0, 0, 0],
    hb = k2.p.hips ?? [0, 0, 0];
  out.hips = [ha[0] + (hb[0] - ha[0]) * u, ha[1] + (hb[1] - ha[1]) * u, ha[2] + (hb[2] - ha[2]) * u];
  // Blade direction: slerp-like normalized lerp through the arc.
  if (k1.p.sword || k2.p.sword) {
    const sa = k1.p.sword ?? k2.p.sword!,
      sb = k2.p.sword ?? k1.p.sword!;
    const v = new THREE.Vector3(...sa).normalize();
    const w = new THREE.Vector3(...sb).normalize();
    const ang = v.angleTo(w);
    if (ang > 1e-4) {
      const axis = new THREE.Vector3().crossVectors(v, w);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      axis.normalize();
      v.applyAxisAngle(axis, ang * u);
    }
    out.sword = [v.x, v.y, v.z];
  } else out.sword = undefined;
  out.roll = (k1.p.roll ?? 0) + ((k2.p.roll ?? 0) - (k1.p.roll ?? 0)) * u;
  out.lh = (k1.p.lh ?? 0) + ((k2.p.lh ?? 0) - (k1.p.lh ?? 0)) * u;
  return out;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t,
    t3 = t2 * t;
  // Tension-reduced Catmull-Rom to limit overshoot.
  const m1 = (p2 - p0) * 0.35,
    m2 = (p3 - p1) * 0.35;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}

function copyPose(p: Pose, out: Pose): Pose {
  out.r = {};
  for (const [k, v] of Object.entries(p.r)) out.r[k] = [v[0], v[1], v[2]];
  out.hips = p.hips ? [...p.hips] : [0, 0, 0];
  out.sword = p.sword ? [...p.sword] : undefined;
  out.roll = p.roll ?? 0;
  out.lh = p.lh ?? 0;
  return out;
}

// ---------------------------------------------------------------------------
// Blending into a quaternion buffer
// ---------------------------------------------------------------------------
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class PoseBuffer {
  q: Record<string, THREE.Quaternion> = {};
  hips = new THREE.Vector3();
  weight: Record<string, number> = {};
  sword = new THREE.Vector3(0, 0, 1);
  swordW = 0;
  roll = 0;
  lh = 0;
  constructor(public names: string[]) {
    for (const n of names) {
      this.q[n] = new THREE.Quaternion();
      this.weight[n] = 0;
    }
  }
  clear() {
    for (const n of this.names) {
      this.q[n].identity();
      this.weight[n] = 0;
    }
    this.hips.set(0, 0, 0);
    this.swordW = 0;
    this.roll = 0;
    this.lh = 0;
  }
  /** Blend a pose on top with weight w (0..1), optionally masked to a bone set. */
  blend(p: Pose, w: number, mask?: Set<string>) {
    if (w <= 0) return;
    for (const n of this.names) {
      if (mask && !mask.has(n)) continue;
      const e = p.r[n];
      if (!e) {
        this.q[n].slerp(_q.identity(), w);
        continue;
      }
      _e.set(e[0], e[1], e[2], 'XYZ');
      _q.setFromEuler(_e);
      this.q[n].slerp(_q, w);
    }
    if (p.hips && (!mask || mask.has('hips'))) {
      this.hips.x += (p.hips[0] - this.hips.x) * w;
      this.hips.y += (p.hips[1] - this.hips.y) * w;
      this.hips.z += (p.hips[2] - this.hips.z) * w;
    }
    // Sword aim: blend direction; a pose without aim fades the override out.
    if (p.sword) {
      const t = new THREE.Vector3(...p.sword).normalize();
      if (this.swordW <= 0) this.sword.copy(t);
      else this.sword.lerp(t, w).normalize();
      this.swordW += (1 - this.swordW) * w;
    } else this.swordW *= 1 - w;
    this.roll += ((p.roll ?? 0) - this.roll) * w;
    this.lh += ((p.lh ?? 0) - this.lh) * w;
  }
  /** Add an additive pose (small offsets), scaled by w. */
  additive(p: Pose, w: number) {
    for (const [n, e] of Object.entries(p.r)) {
      const q = this.q[n];
      if (!q) continue;
      _e.set(e[0] * w, e[1] * w, e[2] * w, 'XYZ');
      _q.setFromEuler(_e);
      q.multiply(_q);
    }
    if (p.hips) {
      this.hips.x += p.hips[0] * w;
      this.hips.y += p.hips[1] * w;
      this.hips.z += p.hips[2] * w;
    }
  }
  apply(rig: Rig) {
    for (const n of this.names) {
      const b = rig.bones[n];
      if (b) b.quaternion.copy(this.q[n]);
    }
    const root = rig.bones[rig.names[0]];
    root.position.copy(rig.rest[rig.names[0]]).add(this.hips);
  }
}

// ---------------------------------------------------------------------------
// Two-bone IK (world space), rotations written onto bones' local quaternions.
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _t = new THREE.Vector3(),
  _pole = new THREE.Vector3(),
  _tmp = new THREE.Vector3(),
  _qa = new THREE.Quaternion(),
  _qb = new THREE.Quaternion(),
  _qp = new THREE.Quaternion();

/**
 * Solve upper/lower bone so that `end` bone's origin reaches `target`, bending toward `pole`.
 * weight blends between current FK and IK result.
 */
export function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  if (weight <= 0) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b),
    l2 = _b.distanceTo(_c);
  _t.copy(target);
  const d = Math.min(_a.distanceTo(_t), (l1 + l2) * 0.999);
  // Desired mid-joint position.
  const dir = _tmp.subVectors(_t, _a).normalize();
  _t.copy(_a).addScaledVector(dir, d);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const angA = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // Plane normal from pole.
  _pole.subVectors(pole, _a);
  const bendAxis = new THREE.Vector3().crossVectors(dir, _pole).normalize();
  if (bendAxis.lengthSq() < 1e-6) bendAxis.set(1, 0, 0);
  const midDir = dir.clone().applyAxisAngle(bendAxis, angA);
  const midPos = _a.clone().addScaledVector(midDir, l1);

  // Rotate upper so its child moves from _b to midPos.
  const curUp = _b.clone().sub(_a).normalize();
  _qa.setFromUnitVectors(curUp, midDir);
  applyWorldRotation(upper, _qa, weight);
  upper.updateWorldMatrix(false, true);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const curLow = _c.clone().sub(_b).normalize();
  const wantLow = _t.clone().sub(_b).normalize();
  _qb.setFromUnitVectors(curLow, wantLow);
  applyWorldRotation(lower, _qb, weight);
  lower.updateWorldMatrix(false, true);
  void midPos;
}

/** Pre-multiply a bone's world rotation by q (converted into its local frame). */
export function applyWorldRotation(bone: THREE.Bone, q: THREE.Quaternion, weight = 1) {
  const parent = bone.parent!;
  parent.getWorldQuaternion(_qp);
  const boneWorld = _qp.clone().multiply(bone.quaternion);
  const target = q.clone().multiply(boneWorld);
  const local = _qp.clone().invert().multiply(target);
  bone.quaternion.slerp(local, weight);
}

// ---------------------------------------------------------------------------
// Secondary motion: damped angular spring driven by the parent's acceleration.
// ---------------------------------------------------------------------------
export class SpringBone {
  private prevPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  angle = new THREE.Vector2(); // rotation around local x, z
  angVel = new THREE.Vector2();
  private init = false;
  constructor(
    public bone: THREE.Bone,
    public stiffness = 60,
    public damping = 8,
    public gain = 0.8,
    public limit = 0.6,
  ) {}
  update(dt: number, windX = 0, windZ = 0) {
    if (dt <= 0) return;
    const p = new THREE.Vector3();
    this.bone.getWorldPosition(p);
    if (!this.init) {
      this.prevPos.copy(p);
      this.init = true;
    }
    this.vel.subVectors(p, this.prevPos).divideScalar(dt);
    const acc = this.vel.clone().sub(this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.vel);
    this.prevPos.copy(p);
    // Acceleration in parent-local space.
    const qInv = new THREE.Quaternion();
    this.bone.parent!.getWorldQuaternion(qInv);
    qInv.invert();
    acc.applyQuaternion(qInv).clampLength(0, 60);
    const vLocal = this.vel.clone().applyQuaternion(qInv);
    // Force: tilt opposite to acceleration (x rotation from z accel, z rotation from x accel).
    const fx = acc.z * 0.012 * this.gain + vLocal.z * 0.02 * this.gain + windZ;
    const fz = -acc.x * 0.012 * this.gain - vLocal.x * 0.02 * this.gain - windX;
    this.angVel.x += (fx * this.stiffness * 0.1 - this.angle.x * this.stiffness - this.angVel.x * this.damping) * dt;
    this.angVel.y += (fz * this.stiffness * 0.1 - this.angle.y * this.stiffness - this.angVel.y * this.damping) * dt;
    this.angle.x += this.angVel.x * dt;
    this.angle.y += this.angVel.y * dt;
    this.angle.x = Math.max(-this.limit, Math.min(this.limit, this.angle.x));
    this.angle.y = Math.max(-this.limit, Math.min(this.limit, this.angle.y));
    _e.set(this.angle.x, 0, this.angle.y, 'XYZ');
    _q.setFromEuler(_e);
    this.bone.quaternion.multiply(_q);
  }
}
