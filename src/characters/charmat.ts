// Shared character material: per-vertex PBR attributes from the SDF mesher plus
// procedural micro-detail by material kind (knit, leather, metal, hair, feather...).
import * as THREE from 'three/webgpu';
import {
  attribute,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  saturate,
  sin,
  abs,
  normalize,
  normalView,
  mx_noise_float,
  mx_fractal_noise_float,
  positionWorld,
  cameraPosition,
  dot,
  pow,
  normalWorld,
  equal,
  select,
  uniform,
  cameraViewMatrix,
  max,
  fract,
} from 'three/tsl';
import { U } from '../core/env';
import type { MeshData } from './sdf';

export function buildSkinnedGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(d.pbr, 4));
  g.setAttribute('rest', new THREE.BufferAttribute(d.positions.slice(), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(d.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

export interface CharMatOpts {
  /** Additional emissive driven externally (limit glow, hit flash). */
  flash?: any;
  rimColor?: THREE.Color;
  shells?: boolean;
}

export function characterMaterial(opts: CharMatOpts = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const col = attribute('color', 'vec3');
  const pbr = attribute('pbr', 'vec4');
  const rest = attribute('rest', 'vec3');
  const kind = pbr.z;
  // Triangular partition of unity over material kinds: interpolated kinds blend smoothly.
  const is = (k: number) => saturate(float(1).sub(abs(kind.sub(k))));

  const nFine = mx_noise_float(rest.mul(55.0));
  const nMid = mx_noise_float(rest.mul(14.0));
  const nLow = mx_fractal_noise_float(rest.mul(4.0), 3, 2.0, 0.5);

  // Knit ribs (vertical ribbing around the body).
  const rib = sin(rest.x.mul(220.0).add(rest.z.mul(160.0)).add(nMid.mul(1.5))).mul(0.5).add(0.5);
  const knitShade = mix(float(0.78), float(1.08), rib).mul(float(0.92).add(nFine.mul(0.08)));
  // Leather wrinkles & wear.
  const leather = float(0.85).add(nMid.mul(0.1)).add(smoothstep(0.3, 0.8, nLow).mul(0.18));
  // Brushed metal.
  const brushed = float(0.9).add(mx_noise_float(vec3(rest.x.mul(3.0), rest.y.mul(300.0), rest.z.mul(3.0))).mul(0.08));
  // Hair strands: darker roots, lighter tips.
  const strand = mx_noise_float(vec3(rest.x.mul(180.0), rest.y.mul(12.0), rest.z.mul(180.0))).mul(0.5).add(0.5);
  const hairShade = mix(float(0.7), float(1.18), strand);
  // Feathers: overlapping barbs.
  const barb = fract(rest.y.mul(38.0).add(sin(rest.x.mul(50.0)).mul(0.3)).add(nMid.mul(0.4)));
  const featherShade = mix(float(0.72), float(1.1), smoothstep(0.0, 0.8, barb)).mul(float(0.9).add(nFine.mul(0.1)));
  // Scales / chitin: cell pattern.
  const scale = smoothstep(0.1, 0.45, abs(sin(rest.x.mul(60.0).add(sin(rest.y.mul(60.0)).mul(0.8))).mul(sin(rest.y.mul(60.0).add(rest.z.mul(40.0))))));
  const scaleShade = mix(float(0.55), float(1.1), scale);
  // Skin: subtle blotchiness.
  const skinShade = float(0.95).add(nMid.mul(0.05));

  let shade: any = skinShade.mul(is(0));
  shade = shade.add(knitShade.mul(is(1)));
  shade = shade.add(leather.mul(is(2)));
  shade = shade.add(brushed.mul(is(3)));
  shade = shade.add(hairShade.mul(is(4)));
  shade = shade.add(featherShade.mul(is(5)));
  shade = shade.add(scaleShade.mul(is(6)));
  shade = shade.add(float(1).mul(is(7).add(is(8)).add(is(9))));
  m.colorNode = col.mul(shade);

  let rough: any = pbr.x;
  rough = rough.add(nMid.mul(0.06)).add(is(3).mul(nFine.mul(0.08)));
  m.roughnessNode = saturate(rough);
  m.metalnessNode = pbr.y;

  // Micro normal perturbation per kind.
  const bumpAmt = is(1).mul(0.25).add(is(2).mul(0.18)).add(is(4).mul(0.3)).add(is(5).mul(0.25)).add(is(6).mul(0.5)).add(is(0).mul(0.04)).add(is(8).mul(0.2));
  const bx = mx_noise_float(rest.mul(70.0));
  const bz = mx_noise_float(rest.mul(70.0).add(13.0));
  const ribN = sin(rest.x.mul(220.0).add(rest.z.mul(160.0))).mul(is(1)).mul(0.6);
  const nW = normalize(normalWorld.add(vec3(bx.add(ribN), bz.mul(0.5), bz.sub(ribN)).mul(bumpAmt)));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);

  // Sheen for cloth/feathers/hair, clearcoat for metal.
  (m as any).sheenNode = is(1).mul(0.25).add(is(5).mul(0.5)).add(is(4).mul(0.2));
  (m as any).sheenColorNode = mix(col.mul(2.0).add(vec3(0.02, 0.025, 0.04)), col.mul(1.3).add(0.05), is(5).add(is(4)));
  (m as any).sheenRoughnessNode = float(0.45);
  (m as any).clearcoatNode = is(3).mul(0.6).add(is(9)).add(is(6).mul(0.4));
  (m as any).clearcoatRoughnessNode = float(0.15);

  // Rim light + emissive + subsurface-ish skin/feather wrap.
  const V = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(float(1).sub(saturate(dot(normalWorld, V))), 3.0);
  const back = pow(saturate(dot(V.negate(), U.sunDir)), 2.0);
  const sss = is(0).mul(0.3).add(is(5).mul(0.25)).add(is(4).mul(0.25));
  let emi: any = col.mul(pbr.w).mul(2.0);
  emi = emi.add(col.mul(U.sunColor).mul(rim.mul(back).mul(sss).mul(U.sunIntensity).mul(0.6)));
  emi = emi.add(vec3(0.5, 0.6, 0.8).mul(rim.mul(0.04)));
  if (opts.flash) emi = emi.add(opts.flash);
  m.emissiveNode = emi;
  void normalView;
  void equal;
  void select;
  void uniform;
  void max;
  return m;
}
