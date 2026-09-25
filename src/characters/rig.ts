// Minimal rig builder: bones with identity bind orientation (world-aligned axes)
// so poses can be authored as intuitive local Euler offsets.
import * as THREE from 'three/webgpu';
import type { Vec3 } from './sdf';

export interface BoneSpec {
  name: string;
  parent: string | null;
  pos: Vec3; // world-space bind position
}

export interface Rig {
  root: THREE.Bone;
  bones: Record<string, THREE.Bone>;
  list: THREE.Bone[];
  names: string[];
  skeleton: THREE.Skeleton;
  rest: Record<string, THREE.Vector3>; // bind local positions
  bindWorld: Record<string, THREE.Vector3>;
}

export function buildRig(specs: BoneSpec[]): Rig {
  const bones: Record<string, THREE.Bone> = {};
  const rest: Record<string, THREE.Vector3> = {};
  const bindWorld: Record<string, THREE.Vector3> = {};
  const list: THREE.Bone[] = [];
  let root: THREE.Bone | null = null;
  for (const s of specs) {
    const b = new THREE.Bone();
    b.name = s.name;
    const world = new THREE.Vector3(...s.pos);
    bindWorld[s.name] = world;
    if (s.parent) {
      const pw = bindWorld[s.parent];
      b.position.copy(world).sub(pw);
      bones[s.parent].add(b);
    } else {
      b.position.copy(world);
      root = b;
    }
    rest[s.name] = b.position.clone();
    bones[s.name] = b;
    list.push(b);
  }
  root!.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  return { root: root!, bones, list, names: specs.map((s) => s.name), skeleton, rest, bindWorld };
}

export const mirrorX = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
