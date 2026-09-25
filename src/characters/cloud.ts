// Cloud Strife, sculpted from signed-distance primitives: SOLDIER uniform
// (sleeveless knit turtleneck, baggy trousers, belts, heavy boots, gloves,
// silver pauldron), materia bracer, iconic spiky hair and mako-glowing eyes.
import * as THREE from 'three/webgpu';
import { meshSdf, type Prim, type SdfModel, type Vec3, type MaterialDef, type MeshJob } from './sdf';
import { buildRig, type BoneSpec, type Rig, mirrorX, add, scale, lerp3, norm3, sub } from './rig';
import { buildSkinnedGeometry, characterMaterial } from './charmat';
import { makeBusterSword } from './sword';
import { makeEye } from './eyes';
import { uniform, vec3 } from 'three/tsl';

const lin = (r: number, g: number, b: number): Vec3 => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2)];

export const CLOUD_MATS: Record<string, MaterialDef> = {
  skin: { color: lin(0.92, 0.72, 0.6), rough: 0.5, metal: 0, kind: 0 },
  knit: { color: lin(0.17, 0.2, 0.33), rough: 0.9, metal: 0, kind: 1 },
  pants: { color: lin(0.14, 0.17, 0.28), rough: 0.88, metal: 0, kind: 1 },
  leather: { color: lin(0.36, 0.24, 0.15), rough: 0.62, metal: 0, kind: 2 },
  leatherDark: { color: lin(0.2, 0.14, 0.1), rough: 0.55, metal: 0, kind: 2 },
  glove: { color: lin(0.12, 0.1, 0.09), rough: 0.48, metal: 0, kind: 2 },
  sole: { color: lin(0.1, 0.08, 0.07), rough: 0.8, metal: 0, kind: 2 },
  metal: { color: lin(0.78, 0.8, 0.83), rough: 0.26, metal: 1, kind: 3 },
  metalDark: { color: lin(0.36, 0.37, 0.4), rough: 0.35, metal: 1, kind: 3 },
  hair: { color: lin(0.9, 0.68, 0.3), rough: 0.55, metal: 0, kind: 4 },
  brow: { color: lin(0.5, 0.36, 0.18), rough: 0.7, metal: 0, kind: 0 },
  lip: { color: lin(0.8, 0.58, 0.52), rough: 0.4, metal: 0, kind: 0 },
  materiaG: { color: lin(0.25, 1.0, 0.45), rough: 0.1, metal: 0, kind: 7, emissive: 1.4 },
  materiaR: { color: lin(1.0, 0.25, 0.2), rough: 0.1, metal: 0, kind: 7, emissive: 1.2 },
  materiaY: { color: lin(1.0, 0.85, 0.2), rough: 0.1, metal: 0, kind: 7, emissive: 1.0 },
};

// ---------------------------------------------------------------------------
// Skeleton (bind pose: A-pose, arms 34° from vertical, facing +Z, left = +X)
// ---------------------------------------------------------------------------
const armDir = norm3([Math.sin(0.6), -Math.cos(0.6), -0.05]);
const shoulderL: Vec3 = [0.185, 1.415, -0.012];
const elbowL = add(shoulderL, scale(armDir, 0.285));
const wristL = add(elbowL, scale(armDir, 0.255));
const handL = add(wristL, scale(armDir, 0.095));
const hipL: Vec3 = [0.093, 0.94, 0.0];
const kneeL: Vec3 = [0.105, 0.52, 0.012];
const ankleL: Vec3 = [0.112, 0.095, -0.012];
const toeL: Vec3 = [0.114, 0.035, 0.1];

export const CLOUD_BONES: BoneSpec[] = [
  { name: 'hips', parent: null, pos: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 1.09, -0.005] },
  { name: 'chest', parent: 'spine', pos: [0, 1.25, -0.01] },
  { name: 'neck', parent: 'chest', pos: [0, 1.47, -0.01] },
  { name: 'head', parent: 'neck', pos: [0, 1.575, 0.0] },
  { name: 'hairF', parent: 'head', pos: [0, 1.745, 0.05] },
  { name: 'hairL', parent: 'head', pos: [0.07, 1.72, -0.01] },
  { name: 'hairR', parent: 'head', pos: [-0.07, 1.72, -0.01] },
  { name: 'hairB', parent: 'head', pos: [0, 1.73, -0.07] },
  { name: 'clav.L', parent: 'chest', pos: [0.035, 1.42, -0.005] },
  { name: 'uarm.L', parent: 'clav.L', pos: shoulderL },
  { name: 'farm.L', parent: 'uarm.L', pos: elbowL },
  { name: 'hand.L', parent: 'farm.L', pos: wristL },
  { name: 'clav.R', parent: 'chest', pos: [-0.035, 1.42, -0.005] },
  { name: 'uarm.R', parent: 'clav.R', pos: mirrorX(shoulderL) },
  { name: 'farm.R', parent: 'uarm.R', pos: mirrorX(elbowL) },
  { name: 'hand.R', parent: 'farm.R', pos: mirrorX(wristL) },
  { name: 'thigh.L', parent: 'hips', pos: hipL },
  { name: 'shin.L', parent: 'thigh.L', pos: kneeL },
  { name: 'foot.L', parent: 'shin.L', pos: ankleL },
  { name: 'toe.L', parent: 'foot.L', pos: toeL },
  { name: 'thigh.R', parent: 'hips', pos: mirrorX(hipL) },
  { name: 'shin.R', parent: 'thigh.R', pos: mirrorX(kneeL) },
  { name: 'foot.R', parent: 'shin.R', pos: mirrorX(ankleL) },
  { name: 'toe.R', parent: 'foot.R', pos: mirrorX(toeL) },
];
const BONE_NAMES = CLOUD_BONES.map((b) => b.name);

// ---------------------------------------------------------------------------
// Body sculpt
// ---------------------------------------------------------------------------
export function bodyPrims(): Prim[] {
  const P: Prim[] = [];
  const side = (fn: (m: (v: Vec3) => Vec3, s: 'L' | 'R', sx: number) => void) => {
    fn((v) => v, 'L', 1);
    fn(mirrorX, 'R', -1);
  };
  // Pelvis / trousers seat.
  P.push({ type: 'ellipsoid', c: [0, 0.975, -0.01], r: [0.158, 0.115, 0.112], mat: 'pants', bone: 'hips', k: 0.02 });
  P.push({ type: 'ellipsoid', c: [0, 0.92, -0.035], r: [0.15, 0.1, 0.11], mat: 'pants', bone: 'hips', k: 0.05 });
  // Abdomen + ribcage (knit sweater).
  P.push({ type: 'ellipsoid', c: [0, 1.105, 0.0], r: [0.135, 0.13, 0.098], mat: 'knit', bone: 'spine', k: 0.07 });
  P.push({ type: 'ellipsoid', c: [0, 1.29, 0.0], r: [0.185, 0.15, 0.108], mat: 'knit', bone: 'chest', k: 0.07 });
  P.push({ type: 'ellipsoid', c: [0, 1.2, -0.02], r: [0.165, 0.12, 0.09], mat: 'knit', bone: 'spine', bone2: 'chest', k: 0.06 });
  P.push({ type: 'ellipsoid', c: [0, 1.345, -0.035], r: [0.19, 0.11, 0.09], mat: 'knit', bone: 'chest', k: 0.05 });
  side((m) => P.push({ type: 'ellipsoid', c: m([0.07, 1.34, 0.05]), r: [0.095, 0.06, 0.05], rot: [0, 0, 0.12], mat: 'knit', bone: 'chest', k: 0.06 }));
  // Trapezius slope to the neck.
  side((m) => P.push({ type: 'capsule', a: m([0.05, 1.44, -0.02]), b: m([0.16, 1.41, -0.02]), ra: 0.05, rb: 0.045, mat: 'knit', bone: 'chest', k: 0.05 }));
  // Sweater hem sits over the belt line.
  P.push({ type: 'band', c: [0, 1.05, 0.0], r: [0.145, 0.11, 0.108], n: [0, 1, 0], w: 0.018, t: 0.007, mat: 'knit', bone: 'spine', k: 0.004 });
  // High turtleneck collar with folded lip.
  // Open tube: shell of an ellipsoid cut by a horizontal slab.
  P.push({ type: 'band', c: [0, 1.52, -0.004], r: [0.064, 0.3, 0.068], n: [0, 1, 0], off: [0, 1.515, 0], w: 0.06, t: 0.009, mat: 'knit', bone: 'neck', k: 0.03 });
  P.push({ type: 'torus', c: [0, 1.572, -0.004], R: 0.07, r: 0.012, mat: 'knit', bone: 'neck', k: 0.008 });
  P.push({ type: 'torus', c: [0, 1.47, -0.008], R: 0.07, r: 0.012, mat: 'knit', bone: 'neck', k: 0.02 });

  side((m, s) => {
    // Deltoid (bare shoulder).
    P.push({ type: 'sphere', c: m([0.192, 1.4, -0.012]), r: 0.058, mat: 'skin', bone: 'uarm.' + s, k: 0.035 });
    // Upper arm: biceps/triceps.
    P.push({ type: 'capsule', a: m(shoulderL), b: m(elbowL), ra: 0.056, rb: 0.045, mat: 'skin', bone: 'uarm.' + s, k: 0.03 });
    P.push({ type: 'ellipsoid', c: m(lerp3(shoulderL, elbowL, 0.45)), r: [0.049, 0.08, 0.052], rot: [0, 0, s === 'L' ? 0.6 : -0.6], mat: 'skin', bone: 'uarm.' + s, k: 0.03 });
    // Forearm.
    P.push({ type: 'capsule', a: m(elbowL), b: m(wristL), ra: 0.046, rb: 0.034, mat: 'skin', bone: 'farm.' + s, k: 0.028 });
    P.push({ type: 'ellipsoid', c: m(lerp3(elbowL, wristL, 0.28)), r: [0.045, 0.07, 0.042], rot: [0, 0, s === 'L' ? 0.6 : -0.6], mat: 'skin', bone: 'farm.' + s, k: 0.025 });
    // Glove + cuff.
    P.push({ type: 'capsule', a: m(lerp3(elbowL, wristL, 0.42)), b: m(wristL), ra: 0.045, rb: 0.037, mat: 'glove', bone: 'farm.' + s, k: 0.006 });
    P.push({ type: 'torus', c: m(lerp3(elbowL, wristL, 0.44)), R: 0.045, r: 0.008, rot: [0, 0, s === 'L' ? 0.6 : -0.6], mat: 'glove', bone: 'farm.' + s, k: 0.004 });
    // Hand as a relaxed fist.
    const palm = add(wristL, scale(armDir, 0.055));
    P.push({ type: 'ellipsoid', c: m(palm), r: [0.03, 0.05, 0.043], rot: [0, 0, s === 'L' ? 0.6 : -0.6], mat: 'glove', bone: 'hand.' + s, k: 0.015 });
    P.push({ type: 'ellipsoid', c: m(add(add(wristL, scale(armDir, 0.105)), [0, 0, 0.012])), r: [0.03, 0.03, 0.045], rot: [0, 0, s === 'L' ? 0.6 : -0.6], mat: 'glove', bone: 'hand.' + s, k: 0.015 });
    P.push({ type: 'capsule', a: m(add(palm, [0, 0, 0.04])), b: m(add(add(palm, scale(armDir, 0.03)), [-0.005, 0, 0.055])), ra: 0.013, rb: 0.012, mat: 'glove', bone: 'hand.' + s, k: 0.008 }); // thumb

    // Thigh (baggy trousers) + knee.
    P.push({ type: 'capsule', a: m(hipL), b: m(kneeL), ra: 0.095, rb: 0.07, mat: 'pants', bone: 'thigh.' + s, k: 0.05 });
    P.push({ type: 'ellipsoid', c: m(lerp3(hipL, kneeL, 0.42)), r: [0.09, 0.16, 0.095], mat: 'pants', bone: 'thigh.' + s, k: 0.05 });
    P.push({ type: 'capsule', a: m(kneeL), b: m([0.112, 0.3, -0.004]), ra: 0.072, rb: 0.068, mat: 'pants', bone: 'shin.' + s, k: 0.05 });
    P.push({ type: 'ellipsoid', c: m([0.113, 0.36, -0.006]), r: [0.075, 0.045, 0.078], mat: 'pants', bone: 'shin.' + s, k: 0.03 }); // blousing over boot
    // Boots.
    P.push({ type: 'capsule', a: m([0.113, 0.345, -0.008]), b: m([0.113, 0.1, -0.014]), ra: 0.063, rb: 0.056, mat: 'leather', bone: 'shin.' + s, k: 0.012 });
    P.push({ type: 'torus', c: m([0.113, 0.34, -0.008]), R: 0.058, r: 0.013, mat: 'leather', bone: 'shin.' + s, k: 0.006 });
    P.push({ type: 'torus', c: m([0.113, 0.2, -0.01]), R: 0.058, r: 0.008, mat: 'leatherDark', bone: 'shin.' + s, k: 0.004 });
    P.push({ type: 'box', c: m([0.155, 0.2, 0.0]), h: [0.008, 0.012, 0.015], round: 0.004, mat: 'metal', bone: 'shin.' + s, k: 0.003 });
    P.push({ type: 'ellipsoid', c: m([0.113, 0.07, 0.035]), r: [0.056, 0.056, 0.11], mat: 'leather', bone: 'foot.' + s, k: 0.03 });
    P.push({ type: 'ellipsoid', c: m([0.114, 0.05, 0.12]), r: [0.05, 0.042, 0.06], mat: 'leather', bone: 'toe.' + s, k: 0.03 });
    P.push({ type: 'box', c: m([0.113, 0.016, 0.04]), h: [0.056, 0.012, 0.135], round: 0.01, mat: 'sole', bone: 'foot.' + s, k: 0.008 });
  });

  // Belts (two crossing leather belts with buckles).
  P.push({ type: 'band', c: [0, 0.99, -0.006], r: [0.163, 0.11, 0.118], n: [0.05, 1, 0], w: 0.021, t: 0.009, mat: 'leather', bone: 'hips', k: 0.004 });
  P.push({ type: 'band', c: [0, 0.965, -0.006], r: [0.167, 0.12, 0.122], n: [-0.28, 1, 0.05], w: 0.017, t: 0.009, mat: 'leatherDark', bone: 'hips', k: 0.004 });
  P.push({ type: 'box', c: [0.0, 0.993, 0.124], h: [0.032, 0.026, 0.01], round: 0.005, mat: 'metal', bone: 'hips', k: 0.003 });
  P.push({ type: 'box', c: [0.08, 0.955, 0.115], h: [0.022, 0.02, 0.009], round: 0.004, mat: 'metal', bone: 'hips', k: 0.003 });
  // Pauldron strap across the chest (from left shoulder to under the right arm).
  P.push({ type: 'band', c: [0, 1.3, 0.0], r: [0.182, 0.155, 0.117], n: [-0.5, 1, 0.0], off: [0.0, 1.31, 0], w: 0.017, t: 0.008, mat: 'leatherDark', bone: 'chest', k: 0.004 });
  // Silver pauldron on the left shoulder (two layered plates + rivets).
  P.push({ type: 'ellipsoid', c: [0.205, 1.44, -0.012], r: [0.088, 0.048, 0.092], rot: [0, 0, -0.55], mat: 'metal', bone: 'clav.L', k: 0.01 });
  P.push({ type: 'ellipsoid', c: [0.235, 1.395, -0.012], r: [0.072, 0.036, 0.082], rot: [0, 0, -0.75], mat: 'metal', bone: 'uarm.L', k: 0.008 });
  P.push({ type: 'sphere', c: [0.2, 1.487, 0.04], r: 0.007, mat: 'metalDark', bone: 'clav.L', k: 0.002 });
  P.push({ type: 'sphere', c: [0.2, 1.487, -0.06], r: 0.007, mat: 'metalDark', bone: 'clav.L', k: 0.002 });
  // Materia bracer on the right forearm.
  const bA = mirrorX(lerp3(elbowL, wristL, 0.5)),
    bB = mirrorX(lerp3(elbowL, wristL, 0.82));
  P.push({ type: 'capsule', a: bA, b: bB, ra: 0.048, rb: 0.044, mat: 'metalDark', bone: 'farm.R', k: 0.004 });
  const bracerUp = norm3([0, 0.2, 1]);
  const orb = (t: number, mat: string) => {
    const c = add(lerp3(bA, bB, t), scale(bracerUp, 0.045));
    P.push({ type: 'sphere', c, r: 0.0125, mat, bone: 'farm.R', k: 0.002 });
  };
  orb(0.25, 'materiaG');
  orb(0.55, 'materiaR');
  orb(0.85, 'materiaY');
  // Sword mount plate on the back.
  P.push({ type: 'box', c: [0, 1.3, -0.108], h: [0.055, 0.07, 0.012], round: 0.01, rot: [0.08, 0, 0], mat: 'metalDark', bone: 'chest', k: 0.01 });
  void sub;
  return P;
}

// ---------------------------------------------------------------------------
// Head + hair sculpt (higher resolution)
// ---------------------------------------------------------------------------
export const EYE_L: Vec3 = [0.0305, 1.6625, 0.0745];
export const EYE_R: Vec3 = mirrorX(EYE_L);

export function headPrims(): Prim[] {
  const P: Prim[] = [];
  // Neck (hidden inside the collar).
  P.push({ type: 'capsule', a: [0, 1.48, -0.01], b: [0, 1.61, 0.0], ra: 0.047, rb: 0.045, mat: 'skin', bone: 'neck', bone2: 'head', k: 0.02 });
  // Cranium + face.
  P.push({ type: 'ellipsoid', c: [0, 1.685, -0.006], r: [0.08, 0.096, 0.098], mat: 'skin', bone: 'head', k: 0.02 });
  P.push({ type: 'ellipsoid', c: [0, 1.633, 0.028], r: [0.062, 0.068, 0.072], mat: 'skin', bone: 'head', k: 0.035 });
  P.push({ type: 'ellipsoid', c: [0, 1.587, 0.05], r: [0.024, 0.021, 0.027], mat: 'skin', bone: 'head', k: 0.028 }); // chin
  P.push({ type: 'capsule', a: [-0.04, 1.608, 0.012], b: [0.04, 1.608, 0.012], ra: 0.022, rb: 0.022, mat: 'skin', bone: 'head', k: 0.03 }); // jaw width
  for (const sx of [1, -1]) {
    P.push({ type: 'ellipsoid', c: [0.046 * sx, 1.643, 0.066], r: [0.026, 0.017, 0.019], mat: 'skin', bone: 'head', k: 0.02 }); // cheekbones
    P.push({ type: 'ellipsoid', c: [0.081 * sx, 1.656, -0.004], r: [0.011, 0.027, 0.019], rot: [0, 0.35 * sx, 0], mat: 'skin', bone: 'head', k: 0.008 }); // ears
  }
  // Brow ridge + nose.
  P.push({ type: 'capsule', a: [-0.042, 1.683, 0.082], b: [0.042, 1.683, 0.082], ra: 0.011, rb: 0.011, mat: 'skin', bone: 'head', k: 0.02 });
  P.push({ type: 'capsule', a: [0, 1.672, 0.09], b: [0, 1.632, 0.102], ra: 0.006, rb: 0.0095, mat: 'skin', bone: 'head', k: 0.012 });
  P.push({ type: 'sphere', c: [0, 1.629, 0.099], r: 0.0095, mat: 'skin', bone: 'head', k: 0.008 });
  for (const sx of [1, -1]) P.push({ type: 'sphere', c: [0.008 * sx, 1.626, 0.094], r: 0.0065, mat: 'skin', bone: 'head', k: 0.006 });
  // Eye sockets.
  for (const sx of [1, -1]) {
    P.push({ type: 'ellipsoid', op: 'sub', c: [0.031 * sx, 1.663, 0.093], r: [0.0192, 0.0097, 0.011], rot: [0, 0, 0.1 * sx], mat: 'skin', bone: 'head', k: 0.006 });
    // Heavy upper lid over the top of the iris: the steady SOLDIER stare.
    P.push({ type: 'capsule', a: [0.017 * sx, 1.6712, 0.0875], b: [0.045 * sx, 1.6738, 0.0832], ra: 0.0038, rb: 0.003, mat: 'skin', bone: 'head', k: 0.003 });
  }
  // Mouth + lips.
  P.push({ type: 'capsule', op: 'sub', a: [-0.012, 1.601, 0.091], b: [0.012, 1.601, 0.091], ra: 0.0024, rb: 0.0028, mat: 'skin', bone: 'head', k: 0.004 });
  P.push({ type: 'ellipsoid', c: [0, 1.596, 0.086], r: [0.0105, 0.0036, 0.0052], mat: 'lip', bone: 'head', k: 0.006 });
  P.push({ type: 'ellipsoid', c: [0, 1.605, 0.087], r: [0.0115, 0.0026, 0.0045], mat: 'lip', bone: 'head', k: 0.005 });
  // Eyebrows: raised, angled low over the eyes.
  for (const sx of [1, -1]) P.push({ type: 'capsule', a: [0.011 * sx, 1.6785, 0.0955], b: [0.052 * sx, 1.6865, 0.0815], ra: 0.0062, rb: 0.0044, mat: 'brow', bone: 'head', k: 0.003 });

  // Hair cap.
  P.push({ type: 'ellipsoid', c: [0, 1.716, -0.022], r: [0.089, 0.083, 0.098], mat: 'hair', bone: 'head', k: 0.01 });
  P.push({ type: 'ellipsoid', c: [0, 1.668, -0.05], r: [0.083, 0.07, 0.07], mat: 'hair', bone: 'head', k: 0.02 });
  const H: Vec3 = [0, 1.7, -0.01];
  const spike = (base: Vec3, tip: Vec3, r: number, bone: string, bend: Vec3 = [0, 0, 0]) => {
    P.push({ type: 'cone', a: add(H, base), b: add(H, tip), ra: r, rb: 0.0035, bend, mat: 'hair', bone, k: 0.014 });
  };
  // Crown sweeping up and back.
  spike([0.0, 0.07, 0.02], [0.015, 0.215, -0.12], 0.046, 'hairB', [0, 0.035, 0.02]);
  spike([0.045, 0.06, 0.0], [0.13, 0.18, -0.1], 0.043, 'hairB', [0, 0.03, 0.01]);
  spike([-0.045, 0.06, 0.0], [-0.13, 0.17, -0.09], 0.043, 'hairB', [0, 0.03, 0.01]);
  spike([0.0, 0.05, -0.05], [0.0, 0.13, -0.235], 0.05, 'hairB', [0, 0.03, 0]);
  spike([0.05, 0.03, -0.06], [0.14, 0.07, -0.2], 0.045, 'hairB', [0, 0.025, 0]);
  spike([-0.05, 0.03, -0.06], [-0.14, 0.06, -0.195], 0.045, 'hairB', [0, 0.025, 0]);
  spike([0.0, -0.02, -0.08], [0.02, -0.08, -0.2], 0.045, 'hairB', [0, -0.01, 0]);
  spike([0.06, -0.03, -0.06], [0.13, -0.1, -0.16], 0.04, 'hairB');
  spike([-0.06, -0.03, -0.06], [-0.13, -0.1, -0.15], 0.04, 'hairB');
  // Sides.
  spike([0.07, 0.03, 0.0], [0.18, 0.07, -0.06], 0.04, 'hairL', [0, 0.02, 0]);
  spike([0.075, -0.015, 0.01], [0.155, -0.06, -0.03], 0.034, 'hairL');
  spike([-0.07, 0.03, 0.0], [-0.18, 0.07, -0.06], 0.04, 'hairR', [0, 0.02, 0]);
  spike([-0.075, -0.015, 0.01], [-0.155, -0.06, -0.03], 0.034, 'hairR');
  // Up-swept front spikes.
  spike([0.0, 0.08, 0.05], [0.005, 0.195, 0.09], 0.04, 'hairF', [0, 0.01, 0.03]);
  spike([0.038, 0.08, 0.04], [0.09, 0.2, 0.035], 0.038, 'hairF', [0, 0.01, 0.02]);
  spike([-0.038, 0.08, 0.04], [-0.09, 0.195, 0.025], 0.038, 'hairF', [0, 0.01, 0.02]);
  // Bangs falling over the forehead and framing the face.
  spike([0.018, 0.07, 0.06], [0.045, 0.012, 0.128], 0.026, 'hairF', [0, 0.022, 0.015]);
  spike([-0.028, 0.07, 0.06], [-0.055, 0.0, 0.124], 0.026, 'hairF', [0, 0.022, 0.015]);
  spike([0.06, 0.045, 0.05], [0.095, -0.06, 0.085], 0.024, 'hairF', [0.012, 0.02, 0.01]);
  spike([-0.062, 0.045, 0.05], [-0.1, -0.08, 0.085], 0.026, 'hairF', [-0.012, 0.02, 0.01]);
  return P;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
export interface CloudModel {
  group: THREE.Group;
  rig: Rig;
  body: THREE.SkinnedMesh;
  head: THREE.SkinnedMesh;
  sword: THREE.Group;
  flash: any; // uniform vec3: additive emissive (hit flash / limit glow)
  eyes: THREE.Mesh[];
}

export function cloudMeshJobs(quality: 'low' | 'high' = 'high'): MeshJob[] {
  const bodyModel: SdfModel = { prims: bodyPrims(), materials: CLOUD_MATS, bones: BONE_NAMES };
  const headModel: SdfModel = { prims: headPrims(), materials: CLOUD_MATS, bones: BONE_NAMES };
  return [
    { model: bodyModel, cell: quality === 'high' ? 0.0095 : 0.014, opts: { weightSigma: 0.03, smooth: 1 } },
    { model: headModel, cell: quality === 'high' ? 0.0042 : 0.006, opts: { weightSigma: 0.02, smooth: 1 } },
  ];
}

export function buildCloud(quality: 'low' | 'high' = 'high'): CloudModel {
  const rig = buildRig(CLOUD_BONES);
  const [bodyData, headData] = cloudMeshJobs(quality).map((j) => meshSdf(j.model, j.cell, j.opts));
  const flash = uniform(new THREE.Color(0, 0, 0));
  const mat = characterMaterial({ flash: vec3(flash as any) });
  const body = new THREE.SkinnedMesh(buildSkinnedGeometry(bodyData), mat);
  const head = new THREE.SkinnedMesh(buildSkinnedGeometry(headData), mat);
  const group = new THREE.Group();
  group.name = 'cloud';
  group.add(rig.root);
  for (const m of [body, head]) {
    m.bind(rig.skeleton, new THREE.Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }
  // Eyes attached to the head bone.
  const eyes: THREE.Mesh[] = [];
  for (const p of [EYE_L, EYE_R]) {
    const eye = makeEye(0.0132, new THREE.Color(0.35, 0.8, 1.0), { irisSize: 0.92, pupil: 0.3 });
    const hw = rig.bindWorld['head'];
    eye.position.set(p[0] - hw.x, p[1] - hw.y, p[2] - hw.z);
    rig.bones['head'].add(eye);
    eyes.push(eye);
  }
  const sword = makeBusterSword();
  return { group, rig, body, head, sword, flash, eyes };
}
