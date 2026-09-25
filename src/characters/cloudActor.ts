// Runtime driver for Cloud's rig: layered pose blending, action clips with events,
// secondary hair motion, terrain foot IK and sword attachment (back <-> hand).
import * as THREE from 'three/webgpu';
import { buildCloud, type CloudModel } from './cloud';
import { PoseBuffer, sampleClip, SpringBone, solveTwoBone, type Clip, type Pose } from './anim';
import { IDLE, COMBAT, gait, riding, CLIPS } from './cloudAnims';
import { swordGlow } from './sword';

export type BaseMode = 'idle' | 'combat' | 'ride' | 'locomotion';

interface ActiveAction {
  clip: Clip;
  t: number;
  speed: number;
  weight: number;
  fadeIn: number;
  fadeOut: number;
  fired: Set<string>;
  onEvent?: (e: string) => void;
  hold?: boolean; // hold last frame until cleared
}

const SWORD_HAND_POS = new THREE.Vector3(-0.036, -0.06, 0.028);
const SWORD_HAND_ROT = new THREE.Euler(Math.PI / 2, Math.PI / 2, 0, 'XYZ');
const SWORD_BACK_POS = new THREE.Vector3(-0.2, 0.3, -0.14);
const SWORD_BACK_ROT = new THREE.Euler(0, 0, Math.PI - 0.38, 'XYZ');

export class CloudActor {
  readonly model: CloudModel;
  readonly root = new THREE.Group(); // world placement (feet at origin, faces +Z)
  readonly buf: PoseBuffer;
  base: BaseMode = 'idle';
  private baseBlend: Record<BaseMode, number> = { idle: 1, combat: 0, ride: 0, locomotion: 0 };
  speed = 0; // 0 walk .. 1 sprint (locomotion)
  moveAmount = 0; // 0 standing .. 1 moving
  gaitPhase = 0;
  rideSpeed = 0;
  ridePhase = 0;
  lean = 0;
  armed = false;
  actions: ActiveAction[] = [];
  private springs: SpringBone[] = [];
  private breath = 0;
  swordAt: 'back' | 'hand' = 'back';
  private swordBlend = 1;
  groundFn: ((x: number, z: number) => number) | null = null;
  footIK = 0;
  private tmpPose: Pose = { r: {} };
  /** Extra additive yaw applied to hips (e.g. spinning attacks), radians. */
  extraYaw = 0;
  lookYaw = 0;

  constructor(quality: 'low' | 'high' = 'high') {
    this.model = buildCloud(quality);
    this.root.add(this.model.group);
    this.buf = new PoseBuffer(this.model.rig.names);
    const b = this.model.rig.bones;
    this.springs = [
      new SpringBone(b['hairF'], 70, 9, 0.7, 0.35),
      new SpringBone(b['hairL'], 60, 8, 0.8, 0.4),
      new SpringBone(b['hairR'], 60, 8, 0.8, 0.4),
      new SpringBone(b['hairB'], 45, 6, 1.0, 0.5),
    ];
    this.attachSword('back', true);
  }

  get bones() {
    return this.model.rig.bones;
  }

  setBase(mode: BaseMode) {
    this.base = mode;
  }

  play(name: string, opts: { speed?: number; fadeIn?: number; fadeOut?: number; onEvent?: (e: string) => void; hold?: boolean; exclusive?: boolean } = {}) {
    const clip = CLIPS[name];
    if (!clip) throw new Error('no clip ' + name);
    if (opts.exclusive !== false) for (const a of this.actions) a.fadeOut = Math.min(a.fadeOut, 0.08), (a.hold = false), (a.t = Math.max(a.t, a.clip.dur - a.fadeOut));
    const act: ActiveAction = { clip, t: 0, speed: opts.speed ?? 1, weight: 0, fadeIn: opts.fadeIn ?? 0.08, fadeOut: opts.fadeOut ?? 0.18, fired: new Set(), onEvent: opts.onEvent, hold: opts.hold };
    this.actions.push(act);
    return act;
  }

  stopActions(fade = 0.15) {
    for (const a of this.actions) {
      a.hold = false;
      a.fadeOut = fade;
      a.t = Math.max(a.t, a.clip.dur - fade);
    }
  }

  get busy() {
    return this.actions.some((a) => a.t < a.clip.dur - a.fadeOut * 0.5 || a.hold);
  }

  currentAction(): ActiveAction | null {
    return this.actions.length ? this.actions[this.actions.length - 1] : null;
  }

  attachSword(where: 'back' | 'hand', instant = false) {
    const sword = this.model.sword;
    const parent = where === 'hand' ? this.bones['hand.R'] : this.bones['chest'];
    // Keep world transform, then ease into the socket pose.
    parent.updateWorldMatrix(true, false);
    parent.attach(sword);
    this.swordAt = where;
    this.swordBlend = instant ? 1 : 0;
    if (instant) this.snapSword();
  }

  private snapSword() {
    const s = this.model.sword;
    if (this.swordAt === 'hand') {
      s.position.copy(SWORD_HAND_POS);
      s.quaternion.setFromEuler(SWORD_HAND_ROT);
    } else {
      s.position.copy(SWORD_BACK_POS);
      s.quaternion.setFromEuler(SWORD_BACK_ROT);
    }
  }

  update(dt: number) {
    const rig = this.model.rig;
    // --- base layers -------------------------------------------------------
    for (const k of Object.keys(this.baseBlend) as BaseMode[]) {
      const target = k === this.base ? 1 : 0;
      this.baseBlend[k] += (target - this.baseBlend[k]) * (1 - Math.exp(-dt * 10));
    }
    const buf = this.buf;
    buf.clear();
    this.breath += dt;
    // Locomotion phase.
    const cadence = 1.7 + this.speed * 1.2;
    this.gaitPhase = (this.gaitPhase + dt * cadence * Math.max(0.2, this.moveAmount)) % 1;
    const w = this.baseBlend;
    let acc = 0;
    const add = (p: Pose, weight: number) => {
      if (weight < 1e-3) return;
      acc += weight;
      buf.blend(p, weight / acc);
    };
    add(IDLE, w.idle);
    add(COMBAT, w.combat * (1 - this.moveAmount));
    if (w.combat > 0.01 && this.moveAmount > 0.01) add(gait(this.gaitPhase, this.speed * 0.6, true), w.combat * this.moveAmount);
    add(gait(this.gaitPhase, this.speed, this.armed), w.locomotion);
    if (w.ride > 0.01) add(riding(this.ridePhase, this.rideSpeed, this.lean), w.ride);

    // Breathing (additive).
    const br = Math.sin(this.breath * (this.base === 'combat' ? 3.2 : 1.8));
    buf.additive({ r: { chest: [br * 0.018, 0, 0], neck: [-br * 0.01, 0, 0], 'clav.L': [0, 0, br * 0.012], 'clav.R': [0, 0, -br * 0.012] } }, 1);

    // --- actions -----------------------------------------------------------
    for (const a of this.actions) {
      a.t += dt * a.speed;
      const end = a.clip.dur;
      if (a.hold && a.t > end) a.t = end;
      const fin = a.hold ? 1 : Math.min(1, Math.max(0, (end - a.t) / a.fadeOut));
      a.weight = Math.min(1, a.t / a.fadeIn) * fin;
      if (a.clip.events)
        for (const [e, et] of Object.entries(a.clip.events)) {
          if (!a.fired.has(e) && a.t >= et) {
            a.fired.add(e);
            a.onEvent?.(e);
          }
        }
      sampleClip(a.clip, a.t, this.tmpPose);
      buf.blend(this.tmpPose, a.weight);
    }
    this.actions = this.actions.filter((a) => a.hold || a.t < a.clip.dur);

    if (this.extraYaw !== 0) buf.additive({ r: { hips: [0, this.extraYaw, 0] } }, 1);
    if (this.lookYaw !== 0) buf.additive({ r: { neck: [0, this.lookYaw * 0.4, 0], head: [0, this.lookYaw * 0.6, 0] } }, 1);
    buf.apply(rig);
    rig.root.updateMatrixWorld(true);

    // --- sword aim + two-handed grip --------------------------------------------
    if (this.swordAt === 'hand' && buf.swordW > 0.01) this.aimSword(buf.sword, buf.roll, buf.swordW);
    if (this.swordAt === 'hand' && buf.lh > 0.01) this.leftHandOnGrip(buf.lh);

    // --- secondary motion --------------------------------------------------
    for (const s of this.springs) s.update(Math.min(dt, 1 / 30), 0.01 * Math.sin(this.breath * 2.3), 0.008 * Math.sin(this.breath * 1.7));

    // --- foot IK on terrain --------------------------------------------------
    if (this.groundFn && this.footIK > 0.01) this.solveFeet();

    // --- sword socket easing ----------------------------------------------------
    if (this.swordBlend < 1) {
      this.swordBlend = Math.min(1, this.swordBlend + dt * 9);
      const s = this.model.sword;
      const tp = this.swordAt === 'hand' ? SWORD_HAND_POS : SWORD_BACK_POS;
      const tq = new THREE.Quaternion().setFromEuler(this.swordAt === 'hand' ? SWORD_HAND_ROT : SWORD_BACK_ROT);
      s.position.lerp(tp, this.swordBlend);
      s.quaternion.slerp(tq, this.swordBlend);
    }
    void swordGlow;
  }

  private _q1 = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _m = new THREE.Matrix4();
  private aimSword(dirLocal: THREE.Vector3, roll: number, weight: number) {
    const hand = this.bones['hand.R'];
    this.root.getWorldQuaternion(this._q1);
    const D = dirLocal.clone().applyQuaternion(this._q1).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this._q1);
    let ref = up;
    if (Math.abs(D.dot(up)) > 0.95) ref = new THREE.Vector3(0, 0, 1).applyQuaternion(this._q1);
    const E = ref.clone().addScaledVector(D, -D.dot(ref)).normalize().applyAxisAngle(D, roll);
    const X = new THREE.Vector3().crossVectors(E, D).normalize();
    this._m.makeBasis(X, E, D);
    const Q = new THREE.Quaternion().setFromRotationMatrix(this._m);
    hand.parent!.getWorldQuaternion(this._q2);
    const local = this._q2.invert().multiply(Q);
    hand.quaternion.slerp(local, weight);
    hand.updateMatrixWorld(true);
  }

  private leftHandOnGrip(weight: number) {
    const b = this.bones;
    const s = this.model.sword;
    s.updateMatrixWorld(true);
    const target = new THREE.Vector3(0, -0.14, 0).applyMatrix4(s.matrixWorld);
    // Hand bone sits at the wrist; offset back so the fist lands on the grip.
    const elbow = new THREE.Vector3();
    b['farm.L'].getWorldPosition(elbow);
    const pole = elbow.clone().add(new THREE.Vector3(0.3, -0.4, 0).applyQuaternion(this.root.getWorldQuaternion(this._q1)));
    const wristToFist = new THREE.Vector3();
    b['hand.L'].getWorldPosition(wristToFist);
    solveTwoBone(b['uarm.L'], b['farm.L'], b['hand.L'], target.addScaledVector(target.clone().sub(elbow).normalize(), -0.07), pole, weight);
  }

  private _p = new THREE.Vector3();
  private _t = new THREE.Vector3();
  private _pole = new THREE.Vector3();
  private solveFeet() {
    const b = this.bones;
    const g = this.groundFn!;
    const rootY = this.root.position.y;
    const offs: number[] = [];
    for (const s of ['L', 'R']) {
      b['foot.' + s].getWorldPosition(this._p);
      const gy = g(this._p.x, this._p.z);
      // Ankle sits ~0.095 above the sole when flat.
      offs.push(gy + 0.095 - this._p.y);
    }
    // Lower the hips to let the lower foot reach the ground.
    const drop = Math.min(0, Math.min(offs[0], offs[1]) + (rootY - rootY));
    b['hips'].position.y += drop * this.footIK;
    b['hips'].updateMatrixWorld(true);
    ['L', 'R'].forEach((s) => {
      const foot = b['foot.' + s];
      foot.getWorldPosition(this._p);
      const gy = g(this._p.x, this._p.z);
      const want = gy + 0.095;
      // Only push up (or down within reach) when near the ground (planted phase).
      const dy = want - this._p.y;
      if (dy < -0.08) return;
      this._t.copy(this._p);
      this._t.y = this._p.y + dy * this.footIK;
      const knee = b['shin.' + s];
      knee.getWorldPosition(this._pole);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
      this._pole.addScaledVector(fwd, 0.6);
      solveTwoBone(b['thigh.' + s], knee, foot, this._t, this._pole, 1);
    });
  }
}
