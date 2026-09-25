// Stylised eyes with glowing mako irises (the SOLDIER tell).
import * as THREE from 'three/webgpu';
import { sstep } from '../core/tsl';
import { positionLocal, normalize, vec3, float, mix, smoothstep, acos, atan, sin, uniform, saturate } from 'three/tsl';

export const eyeGlow = uniform(1.0);

export function makeEye(radius: number, iris: THREE.Color, opts: { pupil?: number; irisSize?: number; slit?: boolean } = {}) {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const m = new THREE.MeshPhysicalNodeMaterial();
  const n = normalize(positionLocal);
  const theta = acos(n.z.clamp(-1, 1));
  const phi = atan(n.y, n.x);
  const irisR = opts.irisSize ?? 0.62;
  const pupilR = opts.pupil ?? 0.24;
  const irisMask = sstep(irisR + 0.04, irisR - 0.02, theta);
  const pupilMask = opts.slit
    ? sstep(0.08, 0.03, n.x.abs()).mul(sstep(irisR, irisR * 0.5, theta))
    : sstep(pupilR + 0.03, pupilR - 0.02, theta);
  const streaks = sin(phi.mul(22.0)).mul(0.5).add(0.5);
  const irisCol = mix(vec3(iris.r * 0.4, iris.g * 0.4, iris.b * 0.4), vec3(iris.r, iris.g, iris.b), saturate(theta.div(irisR)).mul(0.6).add(streaks.mul(0.3)));
  const sclera = vec3(0.78, 0.76, 0.74);
  let col: any = mix(sclera, irisCol, irisMask);
  col = mix(col, vec3(0.01, 0.01, 0.015), pupilMask);
  m.colorNode = col;
  m.roughnessNode = float(0.1);
  (m as any).clearcoatNode = float(1);
  (m as any).clearcoatRoughnessNode = float(0.02);
  m.emissiveNode = irisCol.mul(irisMask.mul(float(1).sub(pupilMask))).mul(eyeGlow).mul(1.6);
  const eye = new THREE.Mesh(geo, m);
  eye.name = 'eye';
  return eye;
}
