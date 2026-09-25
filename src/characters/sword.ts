// The Buster Sword: a massive single-edged broadsword with two holes near the hilt.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { positionLocal, vec3, float, mix, smoothstep, saturate, abs, mx_noise_float, uniform, sin, uv, atan } from 'three/tsl';

export const swordGlow = uniform(0); // 0..1 limit glow
export const swordGlowColor = uniform(new THREE.Color(0.55, 0.85, 1.0));

export function makeBusterSword() {
  const group = new THREE.Group();
  group.name = 'busterSword';

  // Blade.
  const shape = new THREE.Shape();
  shape.moveTo(-0.122, 0.18);
  shape.lineTo(0.128, 0.18);
  shape.lineTo(0.128, 1.5);
  shape.lineTo(-0.122, 1.73);
  shape.lineTo(-0.122, 0.18);
  for (const y of [0.3, 0.405]) {
    const h = new THREE.Path();
    h.absarc(0.0, y, 0.024, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.011, bevelSegments: 3, curveSegments: 24 });
  bladeGeo.translate(0, 0, -0.006);
  bladeGeo.computeVertexNormals();
  const bladeMat = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal;
  const brushed = mx_noise_float(vec3(p.x.mul(6.0), p.y.mul(420.0), p.z.mul(6.0))).mul(0.5).add(0.5);
  const scratches = smoothstep(0.72, 0.9, mx_noise_float(vec3(p.x.mul(40.0), p.y.mul(9.0), 1.0)).mul(0.5).add(0.5));
  const dirt = smoothstep(0.2, 0.8, mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5)).mul(0.25);
  const edge = smoothstep(0.1, 0.14, abs(p.x.sub(0.003))).max(smoothstep(0.004, 0.012, abs(p.z)).oneMinus().mul(0.0));
  const tipEdge = smoothstep(1.45, 1.7, p.y).mul(0.5);
  const edgeMask = saturate(edge.add(tipEdge));
  bladeMat.colorNode = mix(vec3(0.62, 0.63, 0.66), vec3(0.86, 0.87, 0.9), edgeMask).mul(float(1).sub(dirt.mul(0.5)));
  bladeMat.metalnessNode = float(1);
  bladeMat.roughnessNode = mix(float(0.36), float(0.12), edgeMask).add(brushed.mul(0.1)).add(scratches.mul(0.15));
  (bladeMat as any).clearcoatNode = float(0.2);
  // Limit-break energy: rune-like flowing light along the blade.
  const flow = sin(p.y.mul(18.0).sub(swordGlow.mul(0).add(uniformTime().mul(9.0)))).mul(0.5).add(0.5);
  bladeMat.emissiveNode = (vec3(swordGlowColor as any) as any).mul(swordGlow.mul(swordGlow).mul(float(2.0).add(flow.mul(3.0)).add(edgeMask.mul(6.0))));
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.castShadow = true;
  group.add(blade);

  // Guard, grip, pommel.
  const guard = new THREE.BoxGeometry(0.33, 0.065, 0.058, 4, 2, 2);
  guard.translate(0, 0.147, 0);
  const collar = new THREE.CylinderGeometry(0.026, 0.03, 0.05, 16);
  collar.translate(0, 0.095, 0);
  const pommel = new THREE.CylinderGeometry(0.032, 0.026, 0.045, 16);
  pommel.translate(0, -0.2, 0);
  const pommelCap = new THREE.SphereGeometry(0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  pommelCap.rotateX(Math.PI);
  pommelCap.translate(0, -0.222, 0);
  const rivets: THREE.BufferGeometry[] = [];
  for (const x of [-0.13, -0.09, 0.09, 0.13]) {
    const r = new THREE.SphereGeometry(0.009, 8, 6);
    r.translate(x, 0.147, 0.03);
    rivets.push(r);
    const r2 = r.clone();
    r2.translate(0, 0, -0.06);
    rivets.push(r2);
  }
  const fittings = mergeGeometries([guard, collar, pommel, pommelCap, ...rivets].map((g) => g.toNonIndexed()))!;
  const fitMat = new THREE.MeshPhysicalNodeMaterial();
  fitMat.colorNode = vec3(0.3, 0.27, 0.24).mul(float(0.85).add(mx_noise_float(positionLocal.mul(60.0)).mul(0.15)));
  fitMat.metalnessNode = float(1);
  fitMat.roughnessNode = float(0.42);
  const fit = new THREE.Mesh(fittings, fitMat);
  fit.castShadow = true;
  group.add(fit);

  const grip = new THREE.CylinderGeometry(0.018, 0.019, 0.29, 20, 12);
  grip.translate(0, -0.03, 0);
  const gripMat = new THREE.MeshStandardNodeMaterial();
  const ang = atan(positionLocal.z, positionLocal.x);
  const wrap = sin(positionLocal.y.mul(140.0).add(ang.mul(2.0))).mul(0.5).add(0.5);
  gripMat.colorNode = mix(vec3(0.05, 0.035, 0.025), vec3(0.16, 0.1, 0.06), smoothstep(0.3, 0.8, wrap));
  gripMat.roughnessNode = float(0.7);
  const gripMesh = new THREE.Mesh(grip, gripMat);
  gripMesh.castShadow = true;
  group.add(gripMesh);
  void uv;
  return group;
}

// Late-bound time uniform to avoid a circular import on env.ts at module init.
import { U } from '../core/env';
function uniformTime() {
  return U.time;
}
