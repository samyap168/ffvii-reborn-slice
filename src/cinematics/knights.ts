// The Knights of the Round: 13 procedurally built colossal spectral knights.
// Rigid plate-armour pieces on a bone rig (armour IS rigid), per-knight helmet,
// silhouette, palette, cape and weapon; materialise/dissolve and glow controls.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  uniform,
  vec3,
  float,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  normalize,
  dot,
  pow,
  saturate,
  abs,
  mix,
  smoothstep,
  sin,
  uv,
  mx_noise_float,
  mx_fractal_noise_float,
} from 'three/tsl';
import { buildRig, type Rig, type BoneSpec } from '../characters/rig';
import { PoseBuffer, pose, type Pose, type E3 } from '../characters/anim';
import { U } from '../core/env';

export type WeaponKind = 'greatsword' | 'lance' | 'hammer' | 'twin' | 'halberd' | 'axe' | 'bow' | 'maceShield' | 'scythe' | 'rapier' | 'flail' | 'towerShield' | 'kingsword';
export type HelmKind = 'crest' | 'winged' | 'great' | 'hood' | 'horned' | 'plume' | 'crown' | 'visor' | 'spiked';

export interface KnightDef {
  name: string;
  title: string;
  metal: [number, number, number];
  glow: [number, number, number];
  cape: [number, number, number] | null;
  helm: HelmKind;
  weapon: WeaponKind;
  bulk: number; // 0.85 slim .. 1.3 massive
  pauldron: number;
  tier: 'hero' | 'quick' | 'king';
}

export const KNIGHTS: KnightDef[] = [
  { name: 'Sir Aldric', title: 'The Crimson Blade', metal: [0.62, 0.5, 0.42], glow: [1.0, 0.35, 0.15], cape: [0.55, 0.05, 0.05], helm: 'crest', weapon: 'greatsword', bulk: 1.1, pauldron: 1.2, tier: 'hero' },
  { name: 'Sir Caelum', title: 'The Azure Lancer', metal: [0.6, 0.66, 0.8], glow: [0.35, 0.65, 1.0], cape: [0.08, 0.15, 0.45], helm: 'winged', weapon: 'lance', bulk: 1.0, pauldron: 1.0, tier: 'hero' },
  { name: 'Sir Borun', title: 'The Iron Colossus', metal: [0.35, 0.34, 0.36], glow: [1.0, 0.65, 0.2], cape: null, helm: 'great', weapon: 'hammer', bulk: 1.35, pauldron: 1.45, tier: 'hero' },
  { name: 'The Twins', title: 'Shadows of the Round', metal: [0.3, 0.24, 0.4], glow: [0.75, 0.35, 1.0], cape: [0.12, 0.05, 0.2], helm: 'hood', weapon: 'twin', bulk: 0.85, pauldron: 0.8, tier: 'hero' },
  { name: 'Sir Edris', title: 'The Frost Warden', metal: [0.75, 0.82, 0.9], glow: [0.5, 0.85, 1.0], cape: [0.6, 0.7, 0.8], helm: 'spiked', weapon: 'halberd', bulk: 1.05, pauldron: 1.1, tier: 'quick' },
  { name: 'Sir Varn', title: 'The Storm Herald', metal: [0.45, 0.45, 0.5], glow: [0.9, 0.9, 0.4], cape: [0.2, 0.2, 0.25], helm: 'horned', weapon: 'axe', bulk: 1.15, pauldron: 1.2, tier: 'quick' },
  { name: 'Dame Lyra', title: 'The Verdant Archer', metal: [0.5, 0.6, 0.45], glow: [0.5, 1.0, 0.45], cape: [0.1, 0.3, 0.1], helm: 'plume', weapon: 'bow', bulk: 0.9, pauldron: 0.85, tier: 'quick' },
  { name: 'Sir Halvard', title: 'The Solar Paladin', metal: [0.9, 0.78, 0.5], glow: [1.0, 0.9, 0.6], cape: [0.85, 0.8, 0.7], helm: 'visor', weapon: 'maceShield', bulk: 1.2, pauldron: 1.3, tier: 'quick' },
  { name: 'Sir Mordane', title: 'The Void Reaper', metal: [0.12, 0.1, 0.14], glow: [0.6, 0.2, 1.0], cape: [0.05, 0.02, 0.08], helm: 'hood', weapon: 'scythe', bulk: 0.95, pauldron: 1.0, tier: 'quick' },
  { name: 'Dame Seris', title: 'The Tempest Duelist', metal: [0.7, 0.7, 0.72], glow: [0.6, 1.0, 0.9], cape: [0.3, 0.55, 0.55], helm: 'plume', weapon: 'rapier', bulk: 0.85, pauldron: 0.75, tier: 'quick' },
  { name: 'Sir Ignatius', title: 'The Ember Templar', metal: [0.5, 0.3, 0.2], glow: [1.0, 0.45, 0.1], cape: [0.4, 0.12, 0.02], helm: 'great', weapon: 'flail', bulk: 1.15, pauldron: 1.15, tier: 'quick' },
  { name: 'Sir Quartz', title: 'The Crystal Sentinel', metal: [0.65, 0.6, 0.75], glow: [1.0, 0.6, 0.95], cape: null, helm: 'visor', weapon: 'towerShield', bulk: 1.25, pauldron: 1.2, tier: 'quick' },
  { name: 'The King', title: 'Sovereign of the Round', metal: [1.0, 0.8, 0.42], glow: [1.0, 0.85, 0.5], cape: [0.6, 0.05, 0.1], helm: 'crown', weapon: 'kingsword', bulk: 1.2, pauldron: 1.35, tier: 'king' },
];

const BONES: BoneSpec[] = [
  { name: 'hips', parent: null, pos: [0, 1.0, 0] },
  { name: 'chest', parent: 'hips', pos: [0, 1.32, 0] },
  { name: 'head', parent: 'chest', pos: [0, 1.62, 0.01] },
  { name: 'uarm.L', parent: 'chest', pos: [0.27, 1.52, 0] },
  { name: 'farm.L', parent: 'uarm.L', pos: [0.31, 1.22, 0] },
  { name: 'hand.L', parent: 'farm.L', pos: [0.33, 0.96, 0.02] },
  { name: 'uarm.R', parent: 'chest', pos: [-0.27, 1.52, 0] },
  { name: 'farm.R', parent: 'uarm.R', pos: [-0.31, 1.22, 0] },
  { name: 'hand.R', parent: 'farm.R', pos: [-0.33, 0.96, 0.02] },
  { name: 'thigh.L', parent: 'hips', pos: [0.12, 0.98, 0] },
  { name: 'shin.L', parent: 'thigh.L', pos: [0.13, 0.55, 0.01] },
  { name: 'foot.L', parent: 'shin.L', pos: [0.14, 0.1, 0] },
  { name: 'thigh.R', parent: 'hips', pos: [-0.12, 0.98, 0] },
  { name: 'shin.R', parent: 'thigh.R', pos: [-0.13, 0.55, 0.01] },
  { name: 'foot.R', parent: 'shin.R', pos: [-0.14, 0.1, 0] },
];

// --- geometry helpers --------------------------------------------------------
const G = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d, 2, 2, 2),
  cyl: (rt: number, rb: number, h: number, seg = 18) => new THREE.CylinderGeometry(rt, rb, h, seg, 1),
  sph: (r: number, ws = 20, hs = 14, phiLen = Math.PI * 2, thetaLen = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen),
  cone: (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg),
  torus: (R: number, r: number) => new THREE.TorusGeometry(R, r, 8, 28),
};
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g.index ? g.toNonIndexed() : g;
}
function merge(list: THREE.BufferGeometry[]) {
  const clean = list.map((g) => {
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', g.attributes.position);
    o.setAttribute('normal', g.attributes.normal);
    if (!g.attributes.normal) o.computeVertexNormals();
    return o;
  });
  return mergeGeometries(clean, false)!;
}
function bladeShape(len: number, w: number, tip: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2 * 0.85, len - tip);
  s.lineTo(0, len);
  s.lineTo(-w / 2 * 0.85, len - tip);
  s.lineTo(-w / 2, 0);
  return s;
}
function blade(len: number, w: number, tip: number, thick = 0.02) {
  const g = new THREE.ExtrudeGeometry(bladeShape(len, w, tip), { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.5, bevelSize: w * 0.12, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.computeVertexNormals();
  return g;
}

/** Weapon geometry in hand space: grip at origin, business end along +Y. Returns metal + glow parts. */
function weaponGeo(kind: WeaponKind): { metal: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[]; tipY: number } {
  const metal: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const grip = (len: number, r = 0.022) => metal.push(at(G.cyl(r, r, len), 0, len / 2 - 0.12, 0));
  const guard = (w: number, y: number) => metal.push(at(G.box(w, 0.05, 0.06), 0, y, 0));
  let tipY = 1;
  switch (kind) {
    case 'greatsword':
    case 'kingsword': {
      const big = kind === 'kingsword';
      grip(big ? 0.5 : 0.4);
      guard(big ? 0.6 : 0.44, big ? 0.36 : 0.26);
      const L = big ? 2.4 : 1.7;
      const b = at(blade(L, big ? 0.2 : 0.16, 0.25, 0.03), 0, big ? 0.38 : 0.28, 0);
      metal.push(b);
      glow.push(at(G.box(0.02, L * 0.85, 0.035), 0, (big ? 0.38 : 0.28) + L * 0.45, 0));
      if (big) {
        glow.push(at(G.sph(0.06), 0, 0.36, 0.04));
        metal.push(at(G.torus(0.08, 0.02), 0, 0.36, 0, 0, 0, 0));
      }
      tipY = (big ? 0.38 : 0.28) + L;
      break;
    }
    case 'lance': {
      metal.push(at(G.cyl(0.03, 0.03, 3.0), 0, 0.9, 0));
      metal.push(at(G.cone(0.12, 0.5, 12), 0, 2.6, 0));
      metal.push(at(G.cyl(0.14, 0.05, 0.4), 0, 0.1, 0)); // vamplate
      glow.push(at(G.cone(0.05, 0.9, 8), 0, 2.85, 0));
      tipY = 3.3;
      break;
    }
    case 'hammer': {
      metal.push(at(G.cyl(0.035, 0.035, 1.6), 0, 0.55, 0));
      metal.push(at(G.box(0.7, 0.38, 0.38), 0, 1.4, 0));
      metal.push(at(G.cone(0.14, 0.3), 0.45, 1.4, 0, 0, 0, -Math.PI / 2));
      glow.push(at(G.box(0.72, 0.06, 0.4), 0, 1.4, 0));
      tipY = 1.6;
      break;
    }
    case 'twin':
    case 'rapier': {
      grip(0.2);
      if (kind === 'rapier') metal.push(at(G.torus(0.08, 0.012), 0, 0.1, 0, Math.PI / 2, 0, 0));
      else guard(0.2, 0.1);
      const L = kind === 'rapier' ? 1.2 : 0.95;
      metal.push(at(blade(L, kind === 'rapier' ? 0.035 : 0.07, 0.1, 0.015), 0, 0.12, 0));
      glow.push(at(G.box(0.012, L * 0.9, 0.02), 0, 0.12 + L * 0.47, 0));
      tipY = 0.12 + L;
      break;
    }
    case 'halberd': {
      metal.push(at(G.cyl(0.03, 0.03, 2.6), 0, 0.8, 0));
      metal.push(at(blade(0.5, 0.36, 0.15, 0.03), 0.05, 1.9, 0, 0, 0, -Math.PI / 2));
      metal.push(at(G.cone(0.06, 0.5), 0, 2.35, 0));
      glow.push(at(G.box(0.4, 0.03, 0.04), 0.2, 2.0, 0));
      tipY = 2.6;
      break;
    }
    case 'axe': {
      metal.push(at(G.cyl(0.035, 0.035, 1.5), 0, 0.5, 0));
      const s = new THREE.Shape();
      s.moveTo(0, -0.2);
      s.quadraticCurveTo(0.55, -0.45, 0.6, 0);
      s.quadraticCurveTo(0.55, 0.45, 0, 0.2);
      s.lineTo(0, -0.2);
      const head = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
      head.translate(0, 0, -0.02);
      metal.push(at(head, 0, 1.15, 0));
      metal.push(at(head.clone(), 0, 1.15, 0, 0, Math.PI, 0));
      glow.push(at(G.box(1.1, 0.03, 0.05), 0, 1.15, 0));
      tipY = 1.4;
      break;
    }
    case 'bow': {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.9, 0), new THREE.Vector3(0, 0, 0.55), new THREE.Vector3(0, 0.9, 0));
      metal.push(new THREE.TubeGeometry(curve, 24, 0.03, 8).toNonIndexed());
      glow.push(at(G.cyl(0.006, 0.006, 1.8), 0, 0, 0));
      tipY = 0.9;
      break;
    }
    case 'maceShield': {
      metal.push(at(G.cyl(0.03, 0.03, 0.8), 0, 0.25, 0));
      metal.push(at(G.sph(0.16), 0, 0.72, 0));
      for (let i = 0; i < 6; i++) metal.push(at(G.box(0.04, 0.12, 0.34), 0, 0.72, 0, 0, (i / 6) * Math.PI, 0));
      glow.push(at(G.sph(0.08), 0, 0.72, 0.1));
      tipY = 0.8;
      break;
    }
    case 'scythe': {
      metal.push(at(G.cyl(0.03, 0.035, 2.6), 0, 0.9, 0));
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.6, 0.35, 1.3, -0.1);
      s.quadraticCurveTo(0.6, 0.12, 0, -0.14);
      s.lineTo(0, 0);
      const bl = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
      metal.push(at(bl, 0, 2.15, 0, 0, Math.PI / 2, 0));
      glow.push(at(G.box(0.02, 0.04, 1.2), 0, 2.15, 0.6));
      tipY = 2.2;
      break;
    }
    case 'flail': {
      metal.push(at(G.cyl(0.035, 0.035, 0.6), 0, 0.18, 0));
      for (let i = 0; i < 5; i++) metal.push(at(G.torus(0.04, 0.012), 0, 0.52 + i * 0.09, 0, 0, i % 2 ? Math.PI / 2 : 0, 0));
      metal.push(at(G.sph(0.2, 14, 10), 0, 1.05, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        metal.push(at(G.cone(0.05, 0.18), Math.cos(a) * 0.2, 1.05, Math.sin(a) * 0.2, 0, 0, Math.PI / 2 - a));
      }
      glow.push(at(G.sph(0.12), 0, 1.05, 0));
      tipY = 1.1;
      break;
    }
    case 'towerShield': {
      grip(0.2);
      guard(0.16, 0.1);
      metal.push(at(blade(0.8, 0.09, 0.12, 0.02), 0, 0.12, 0));
      glow.push(at(G.box(0.015, 0.7, 0.025), 0, 0.5, 0));
      tipY = 0.92;
      break;
    }
  }
  return { metal, glow, tipY };
}

function helmGeo(kind: HelmKind): { metal: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const metal: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const y = 1.74;
  metal.push(at(G.sph(0.14), 0, y, 0, 0, 0, 0, 1, 1.12, 1.08));
  // Visor slit glow.
  glow.push(at(G.box(0.16, 0.018, 0.04), 0, y + 0.01, 0.12));
  switch (kind) {
    case 'crest':
      metal.push(at(G.box(0.03, 0.18, 0.34), 0, y + 0.17, -0.02));
      break;
    case 'winged':
      for (const sx of [1, -1]) {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.quadraticCurveTo(0.12 * sx, 0.18, 0.05 * sx, 0.36);
        s.quadraticCurveTo(0.02 * sx, 0.18, 0, 0.05);
        const w = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
        metal.push(at(w, 0.12 * sx, y, -0.08, 0, 0, -0.3 * sx));
      }
      break;
    case 'great':
      metal.push(at(G.cyl(0.155, 0.16, 0.34, 16), 0, y, 0));
      metal.push(at(G.cyl(0.165, 0.165, 0.02, 16), 0, y + 0.17, 0));
      break;
    case 'hood':
      metal.push(at(G.cone(0.2, 0.44, 16), 0, y + 0.08, -0.04, -0.25, 0, 0));
      break;
    case 'horned':
      for (const sx of [1, -1]) metal.push(at(G.cone(0.05, 0.36), 0.2 * sx, y + 0.12, 0, 0, 0, -0.9 * sx));
      break;
    case 'plume': {
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, y + 0.14, 0.02), new THREE.Vector3(0, y + 0.42, -0.1), new THREE.Vector3(0, y + 0.1, -0.5));
      glow.push(new THREE.TubeGeometry(c, 16, 0.04, 8).toNonIndexed());
      break;
    }
    case 'crown':
      metal.push(at(G.cyl(0.17, 0.155, 0.12, 20), 0, y + 0.16, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        metal.push(at(G.cone(0.03, 0.16), Math.sin(a) * 0.16, y + 0.29, Math.cos(a) * 0.16));
        glow.push(at(G.sph(0.018, 8, 6), Math.sin(a) * 0.17, y + 0.2, Math.cos(a) * 0.17));
      }
      break;
    case 'visor':
      metal.push(at(G.cone(0.1, 0.22, 4), 0, y - 0.02, 0.12, Math.PI / 2, Math.PI / 4, 0));
      break;
    case 'spiked':
      for (let i = 0; i < 5; i++) metal.push(at(G.cone(0.03, 0.2), (i - 2) * 0.05, y + 0.2, -0.02 - Math.abs(i - 2) * 0.03, -0.2, 0, (i - 2) * 0.2));
      break;
  }
  return { metal, glow };
}

// --- material -----------------------------------------------------------------
function knightMaterial(def: KnightDef, dissolve: any, energy: any) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const [r, g, b] = def.metal;
  const p = positionLocal;
  const scratches = mx_noise_float(vec3(p.x.mul(30.0), p.y.mul(4.0), p.z.mul(30.0))).mul(0.5).add(0.5);
  m.colorNode = vec3(r, g, b).mul(0.55).mul(float(0.85).add(scratches.mul(0.15)));
  m.metalnessNode = float(1);
  m.roughnessNode = float(0.28).add(scratches.mul(0.12));
  (m as any).clearcoatNode = float(0.4);
  const V = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(saturate(abs(dot(normalWorld, V)))), 2.5);
  const [gr, gg, gb] = def.glow;
  const flow = sin(positionWorld.y.mul(0.8).sub(U.time.mul(4.0))).mul(0.5).add(0.5);
  m.emissiveNode = vec3(gr, gg, gb).mul(fres.mul(2.2).add(flow.mul(0.12))).mul(energy);
  // Materialise from light: noise erosion with a hot edge.
  const n = mx_fractal_noise_float(positionLocal.mul(4.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const edge = saturate(float(1).sub(abs(n.sub(dissolve)).mul(14.0)));
  m.emissiveNode = (m.emissiveNode as any).add(vec3(gr, gg, gb).mul(edge.mul(6.0)).mul(saturate(dissolve.mul(10.0))).mul(saturate(float(1).sub(dissolve).mul(10.0))));
  m.alphaTest = 0.5;
  m.opacityNode = saturate(n.sub(dissolve).mul(30.0).add(0.5));
  return m;
}

/** Gilded trim: the knight's metal pulled toward gold, polished, with a faint inner glow. */
function trimMaterial(def: KnightDef, dissolve: any, energy: any) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const [r, g, b] = def.metal;
  const gold = def.tier === 'king' ? [1.0, 0.78, 0.38] : [0.95, 0.74, 0.4];
  m.colorNode = vec3(r * 0.35 + gold[0] * 0.65, g * 0.35 + gold[1] * 0.65, b * 0.35 + gold[2] * 0.65).mul(0.8);
  m.metalnessNode = float(1);
  m.roughnessNode = float(0.2);
  const V = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(saturate(abs(dot(normalWorld, V)))), 3.0);
  const [gr, gg, gb] = def.glow;
  m.emissiveNode = vec3(gr, gg, gb).mul(fres.mul(1.6).add(0.04)).mul(energy);
  const n = mx_fractal_noise_float(positionLocal.mul(4.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  m.alphaTest = 0.5;
  m.opacityNode = saturate(n.sub(dissolve).mul(30.0).add(0.5));
  return m;
}

function glowMaterial(def: KnightDef, energy: any, dissolve: any) {
  const m = new THREE.MeshBasicNodeMaterial();
  const [gr, gg, gb] = def.glow;
  m.colorNode = vec3(gr, gg, gb).mul(energy.mul(4.0).add(1.0));
  const n = mx_fractal_noise_float(positionLocal.mul(4.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  m.alphaTest = 0.5;
  m.opacityNode = saturate(n.sub(dissolve).mul(30.0).add(0.5));
  m.fog = false;
  return m;
}

function capeMaterial(color: [number, number, number], dissolve: any, energy: any, glow: [number, number, number]) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const u = uv();
  // Cloth ripple.
  m.positionNode = positionLocal.add(vec3(sin(u.y.mul(5.0).sub(U.time.mul(4.0)).add(u.x.mul(2.0))).mul(u.y).mul(0.06), 0, sin(u.y.mul(3.5).sub(U.time.mul(3.0))).mul(u.y).mul(0.12).sub(u.y.mul(u.y).mul(0.25))));
  const weave = mx_noise_float(vec3(u.mul(80.0), 0)).mul(0.5).add(0.5);
  m.colorNode = vec3(...color).mul(float(0.8).add(weave.mul(0.2)));
  m.roughnessNode = float(0.8);
  const trim = smoothstep(0.93, 0.97, u.y);
  m.emissiveNode = vec3(...glow).mul(trim.mul(2.0)).mul(energy);
  const n = mx_fractal_noise_float(vec3(u.mul(5.0), 1.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  m.alphaTest = 0.5;
  m.opacityNode = saturate(n.sub(dissolve).mul(30.0).add(0.5));
  void mix;
  return m;
}

// --- poses ---------------------------------------------------------------------
export const KP: Record<string, Pose> = {
  stand: pose({ 'uarm*': [0.1, 0, -0.25], 'farm*': [-0.3, 0, 0], chest: [0.02, 0, 0] }),
  float: pose({ 'uarm*': [0.2, 0, -0.5], 'farm*': [-0.4, 0, 0], 'thigh*': [-0.15, 0, 0.05], 'shin*': [0.35, 0, 0], 'foot*': [0.5, 0, 0], chest: [-0.05, 0, 0], head: [0.1, 0, 0] }, [0, 0, 0]),
  raise: pose({ chest: [-0.25, 0.1, 0], head: [0.1, 0, 0], 'uarm.R': [-2.9, 0, 0.2], 'farm.R': [-0.6, 0, 0], 'uarm.L': [-2.7, 0, -0.2], 'farm.L': [-0.7, 0, 0], 'thigh.L': [-0.5, 0, 0.1], 'shin.L': [0.6, 0, 0], 'thigh.R': [0.3, 0, -0.1], 'shin.R': [0.4, 0, 0] }),
  strike: pose({ chest: [0.6, -0.1, 0], head: [-0.4, 0, 0], 'uarm.R': [-1.3, 0, 0.1], 'farm.R': [-0.2, 0, 0], 'uarm.L': [-1.2, 0, -0.1], 'farm.L': [-0.25, 0, 0], 'thigh.L': [-0.9, 0, 0.15], 'shin.L': [1.0, 0, 0], 'thigh.R': [0.6, 0, -0.1], 'shin.R': [0.8, 0, 0] }, [0, -0.25, 0.1]),
  thrustBack: pose({ chest: [-0.1, 0.5, 0], 'uarm.R': [0.3, 0.3, 0.4], 'farm.R': [-1.4, 0, 0], 'uarm.L': [-1.3, 0, -0.3], 'farm.L': [-0.3, 0, 0], 'thigh.L': [-0.6, 0, 0.1], 'shin.L': [0.7, 0, 0], 'thigh.R': [0.4, 0, -0.1], 'shin.R': [0.5, 0, 0] }, [0, -0.1, 0]),
  thrust: pose({ chest: [0.35, -0.3, 0], 'uarm.R': [-1.5, 0, 0], 'farm.R': [-0.05, 0, 0], 'uarm.L': [-0.3, 0, -0.8], 'thigh.L': [-1.1, 0, 0.1], 'shin.L': [0.9, 0, 0], 'thigh.R': [0.8, 0, -0.1], 'shin.R': [0.3, 0, 0] }, [0, -0.3, 0.3]),
  slam: pose({ chest: [0.9, 0, 0], head: [-0.6, 0, 0], 'uarm*': [-1.0, 0, -0.1], 'farm*': [-0.1, 0, 0], 'thigh*': [-1.3, 0, 0.3], 'shin*': [1.8, 0, 0], 'foot*': [-0.4, 0, 0] }, [0, -0.45, 0.1]),
  slash1: pose({ chest: [0.2, 0.9, 0], 'uarm.R': [-1.4, 0.5, 1.0], 'farm.R': [-0.2, 0, 0], 'uarm.L': [-1.4, -0.5, -1.0], 'farm.L': [-0.2, 0, 0], 'thigh.L': [-0.7, 0, 0.2], 'shin.L': [0.9, 0, 0], 'thigh.R': [0.4, 0, -0.2] }, [0, -0.2, 0]),
  slash2: pose({ chest: [0.3, -0.9, 0], 'uarm.R': [-1.2, -0.6, -0.3], 'farm.R': [-0.1, 0, 0], 'uarm.L': [-1.2, 0.6, 0.3], 'farm.L': [-0.1, 0, 0], 'thigh.R': [-0.7, 0, -0.2], 'shin.R': [0.9, 0, 0], 'thigh.L': [0.4, 0, 0.2] }, [0, -0.2, 0]),
  aim: pose({ chest: [0, -0.9, 0], head: [0, 0.8, 0], 'uarm.L': [-1.55, 0, 0.35], 'farm.L': [0, 0, 0], 'uarm.R': [-1.5, 0, -0.3], 'farm.R': [-2.2, 0, 0], 'thigh.L': [-0.3, 0, 0.3], 'thigh.R': [0.2, 0, -0.3] }),
  guard: pose({ chest: [0.1, 0, 0], 'uarm.L': [-1.2, -0.4, -0.3], 'farm.L': [-1.2, 0, 0], 'uarm.R': [0.2, 0, 0.3], 'farm.R': [-0.6, 0, 0], 'thigh.L': [-0.5, 0, 0.2], 'shin.L': [0.6, 0, 0], 'thigh.R': [0.35, 0, -0.2], 'shin.R': [0.4, 0, 0] }, [0, -0.12, 0]),
  salute: pose({ chest: [-0.05, 0, 0], head: [0.2, 0, 0], 'uarm.R': [-1.0, 0.6, 0.3], 'farm.R': [-1.6, 0, 0], 'uarm.L': [-1.0, -0.6, -0.3], 'farm.L': [-1.6, 0, 0] }),
  skyraise: pose({ chest: [-0.3, 0, 0], head: [-0.4, 0, 0], 'uarm*': [-3.05, 0, 0.05], 'farm*': [-0.1, 0, 0], 'thigh.L': [-0.3, 0, 0.2], 'thigh.R': [0.25, 0, -0.2], 'shin*': [0.2, 0, 0] }),
};

export class KnightActor {
  readonly root = new THREE.Group();
  readonly rig: Rig;
  readonly def: KnightDef;
  readonly dissolve = uniform(1); // 1 = invisible
  readonly energy = uniform(1);
  private buf: PoseBuffer;
  private from: Pose = KP.float;
  private to: Pose = KP.float;
  private blendT = 1;
  private blendDur = 0.3;
  readonly weapon = new THREE.Group();
  readonly weapon2: THREE.Group | null = null;
  tipLocal = new THREE.Vector3(0, 1, 0);
  readonly scale: number;

  constructor(def: KnightDef, scale = 6) {
    this.def = def;
    this.scale = scale;
    this.rig = buildRig(BONES);
    this.buf = new PoseBuffer(this.rig.names);
    const b = this.rig.bones;
    const mat = knightMaterial(def, this.dissolve, this.energy);
    const gmat = glowMaterial(def, this.energy, this.dissolve);
    const tmat = trimMaterial(def, this.dissolve, this.energy);
    const k = def.bulk,
      pd = def.pauldron;
    const bw = this.rig.bindWorld;
    const attach = (bone: string, metal: THREE.BufferGeometry[], glow: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = []) => {
      const off = bw[bone];
      const group = new THREE.Group();
      group.position.set(-off.x, -off.y, -off.z);
      if (metal.length) {
        const mm = new THREE.Mesh(merge(metal), mat);
        mm.castShadow = true;
        group.add(mm);
      }
      if (glow.length) group.add(new THREE.Mesh(merge(glow), gmat));
      if (trim.length) {
        const tm = new THREE.Mesh(merge(trim), tmat);
        tm.castShadow = true;
        group.add(tm);
      }
      b[bone].add(group);
    };
    // Torso: cuirass, plackart, gorget, back plate.
    const lames: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) lames.push(at(G.cyl((0.2 - i * 0.012) * k, (0.19 - i * 0.012) * k, 0.07, 22), 0, 1.25 - i * 0.065, 0.0, 0.06, 0, 0, 1, 1, 0.8));
    attach(
      'chest',
      [
        at(G.sph(0.22, 24, 16), 0, 1.37, 0.0, 0, 0, 0, 1.2 * k, 1.05, 0.82 * k),
        ...lames,
        at(G.cyl(0.16, 0.2, 0.1, 20), 0, 1.53, 0), // gorget
      ],
      [at(G.box(0.02, 0.2, 0.01), 0, 1.37, 0.205 * k), at(G.torus(0.12, 0.012), 0, 1.4, 0.02, 0, 0, 0)],
      [
        at(G.box(0.024, 0.3, 0.03), 0, 1.36, 0.176 * k, -0.05, 0, 0), // ridge trim
        at(G.torus(0.17, 0.018), 0, 1.575, 0, Math.PI / 2, 0, 0), // gorget rim
        at(G.torus(0.2 * k, 0.014), 0, 1.285, 0, Math.PI / 2, 0, 0, 1, 0.8, 1),
      ],
    );
    // Fauld + tassets on the hips.
    const tassets: THREE.BufferGeometry[] = [at(G.cyl(0.17 * k, 0.21 * k, 0.16, 20), 0, 1.02, 0, 0, 0, 0, 1, 1, 0.8)];
    for (let i = 0; i < 4; i++) tassets.push(at(G.box(0.14 * k, 0.26, 0.03), (i - 1.5) * 0.12 * k, 0.86, 0.16 * k * 0.8, -0.15, 0, 0));
    attach('hips', tassets, [at(G.box(0.3 * k, 0.012, 0.012), 0, 1.1, 0.165 * k)], [
      at(G.torus(0.19 * k, 0.022), 0, 1.09, 0, Math.PI / 2, 0, 0, 1, 0.8, 1),
      at(G.box(0.1, 0.08, 0.04), 0, 1.09, 0.165 * k), // buckle
    ]);
    if (def.cape) {
      // Front tabard hanging from the belt.
      const tg = new THREE.PlaneGeometry(0.2 * k, 0.62, 3, 8);
      tg.translate(0, -0.31, 0);
      const tuv = tg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < tuv.count; i++) tuv.setY(i, (1 - tuv.getY(i)) * 0.45);
      const tab = new THREE.Mesh(tg, capeMaterial(def.cape, this.dissolve, this.energy, def.glow));
      tab.position.set(0, 1.07 - bw['hips'].y, 0.19 * k);
      tab.rotation.x = -0.08;
      b['hips'].add(tab);
    }
    // Head.
    const h = helmGeo(def.helm);
    const hy = 1.74;
    const face = def.helm === 'hood' ? [] : [
      at(G.sph(0.125, 18, 10, Math.PI, Math.PI * 0.5), 0, hy - 0.05, 0.02, Math.PI * 0.62, -Math.PI / 2, 0, 1.05, 1, 1.1), // bevor
    ];
    attach('head', [...h.metal, ...face], h.glow, [
      at(G.torus(0.142, 0.012), 0, hy + 0.035, 0, Math.PI / 2, 0, 0, 1, 1.08, 1),
    ]);
    // Arms.
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const shoulder = bw['uarm.' + s];
      const lamesP: THREE.BufferGeometry[] = [];
      const rims: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const r = (0.155 - i * 0.012) * pd;
        const x = shoulder.x + (0.03 + i * 0.03) * sx,
          y = shoulder.y + 0.03 - i * 0.055;
        lamesP.push(at(G.sph(r, 20, 10, Math.PI * 2, Math.PI * 0.42), x, y, 0, 0, 0, -(0.45 + i * 0.18) * sx, 1.25, 0.62, 1.12));
        // Rim along the cap's open edge, built in the cap's local frame.
        const th = Math.PI * 0.42;
        const rim = G.torus(r * Math.sin(th), 0.012).rotateX(Math.PI / 2).translate(0, r * Math.cos(th), 0);
        rims.push(at(rim, x, y, 0, 0, 0, -(0.45 + i * 0.18) * sx, 1.25, 0.62, 1.12));
      }
      attach('uarm.' + s, [...lamesP, at(G.cyl(0.085, 0.078, 0.26), shoulder.x + 0.02 * sx, 1.36, 0)], [], rims);
      const elbow = bw['farm.' + s];
      attach(
        'farm.' + s,
        [at(G.sph(0.085), elbow.x, elbow.y, 0), at(G.cyl(0.098, 0.07, 0.24), elbow.x + 0.01 * sx, 1.08, 0), at(G.cone(0.035, 0.13), elbow.x, elbow.y, -0.08, -Math.PI / 2, 0, 0)],
        [],
        [at(G.torus(0.096, 0.012), elbow.x + 0.01 * sx, 0.965, 0, Math.PI / 2, 0, 0)],
      );
      const hand = bw['hand.' + s];
      attach('hand.' + s, [at(G.box(0.1, 0.12, 0.1), hand.x, hand.y - 0.05, 0.01), at(G.cyl(0.075, 0.06, 0.1), hand.x, hand.y + 0.03, 0)]);
      // Legs.
      const hipB = bw['thigh.' + s],
        knee = bw['shin.' + s],
        ankle = bw['foot.' + s];
      attach('thigh.' + s, [at(G.cyl(0.13 * k, 0.1 * k, 0.4), hipB.x, 0.76, 0)]);
      attach('shin.' + s, [at(G.sph(0.095), knee.x, knee.y, 0.02, 0, 0, 0, 1, 1, 1.2), at(G.cyl(0.105 * k, 0.08 * k, 0.42), knee.x, 0.32, 0), at(G.cone(0.035, 0.15), knee.x, knee.y, 0.11, Math.PI / 2, 0, 0)], [], [at(G.torus(0.1 * k, 0.012), knee.x, 0.5, 0, Math.PI / 2, 0, 0), at(G.box(0.025, 0.38, 0.03), knee.x, 0.32, 0.1 * k)]);
      attach('foot.' + s, [at(G.box(0.12, 0.08, 0.28), ankle.x, 0.04, 0.05), at(G.cone(0.06, 0.12, 4), ankle.x, 0.04, 0.23, Math.PI / 2, 0, 0)]);
    }
    // Cape.
    if (def.cape) {
      const cg = new THREE.PlaneGeometry(0.62 * k, 1.6, 8, 18);
      cg.translate(0, -0.8, 0);
      const cp = cg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cp.count; i++) cp.setX(i, cp.getX(i) * (1 + (-cp.getY(i) / 1.6) * 0.55));
      // uv.y increases downward for the ripple amount.
      const uvs = cg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uvs.count; i++) uvs.setY(i, 1 - uvs.getY(i));
      const cape = new THREE.Mesh(cg, capeMaterial(def.cape, this.dissolve, this.energy, def.glow));
      cape.position.set(0, 1.52 - bw['chest'].y, -0.2);
      cape.rotation.x = 0.12;
      cape.castShadow = true;
      b['chest'].add(cape);
    }
    // Weapon(s).
    const w = weaponGeo(def.weapon);
    const wm = new THREE.Mesh(merge(w.metal), mat);
    wm.castShadow = true;
    this.weapon.add(wm);
    if (w.glow.length) this.weapon.add(new THREE.Mesh(merge(w.glow), gmat));
    this.tipLocal.set(0, w.tipY, 0);
    // Grip axis along hand +Z when the arm hangs: rotate +Y -> +Z.
    this.weapon.rotation.set(Math.PI / 2, 0, 0);
    this.weapon.position.set(0, -0.06, 0.03);
    b['hand.R'].add(this.weapon);
    if (def.weapon === 'twin') {
      const w2 = this.weapon.clone();
      b['hand.L'].add(w2);
      (this as any).weapon2 = w2;
    }
    if (def.weapon === 'maceShield' || def.weapon === 'towerShield') {
      const tall = def.weapon === 'towerShield';
      const sg = tall ? at(G.box(0.55, 1.1, 0.06), 0, 0, 0) : at(G.cyl(0.32, 0.32, 0.05, 24), 0, 0, 0, Math.PI / 2, 0, 0);
      const boss = at(G.sph(0.08), 0, 0, 0.05);
      const shield = new THREE.Group();
      shield.add(new THREE.Mesh(merge([sg]), mat));
      shield.add(new THREE.Mesh(merge([boss, at(G.torus(tall ? 0.2 : 0.26, 0.015), 0, 0, 0.04)]), gmat));
      shield.position.set(0.05, -0.02, 0.1);
      shield.rotation.set(0, Math.PI / 2, 0);
      b['hand.L'].add(shield);
    }
    if (def.weapon === 'bow') {
      this.weapon.removeFromParent();
      b['hand.L'].add(this.weapon);
      this.weapon.rotation.set(0, 0, 0);
    }
    this.root.add(this.rig.root);
    this.root.scale.setScalar(scale);
    this.setPose(KP.float, 0);
    this.update(0);
  }

  setPose(p: Pose, dur = 0.3) {
    this.from = this.current();
    this.to = p;
    this.blendT = 0;
    this.blendDur = Math.max(1e-3, dur);
  }

  private current(): Pose {
    // Approximate the current blended pose as the target (good enough for chaining).
    return this.to;
  }

  update(dt: number) {
    this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
    const e = this.blendT < 1 ? 1 - Math.pow(1 - this.blendT, 3) : 1;
    this.buf.clear();
    this.buf.blend(this.from, 1);
    this.buf.blend(this.to, e);
    // Idle hover breathing.
    const t = U.time.value;
    this.buf.additive({ r: { chest: [Math.sin(t * 1.3) * 0.02, 0, 0] } }, 1);
    this.buf.apply(this.rig);
    this.root.updateMatrixWorld(true);
  }

  /** World position of the weapon tip. */
  tip(out = new THREE.Vector3()) {
    this.weapon.updateMatrixWorld(true);
    return out.copy(this.tipLocal).applyMatrix4(this.weapon.matrixWorld);
  }
  hand(out = new THREE.Vector3()) {
    return this.rig.bones['hand.R'].getWorldPosition(out);
  }
  chest(out = new THREE.Vector3()) {
    return this.rig.bones['chest'].getWorldPosition(out);
  }
  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.root.position);
    this.root.rotation.y = Math.atan2(d.x, d.z);
  }
}

export type { E3 };
