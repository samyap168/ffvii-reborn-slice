// GPU grass: every blade is generated in the vertex shader from instanceIndex
// (stratified jitter per world-aligned patch), placed on the heightfield,
// masked by the splat map, animated by travelling wind gusts and pushed aside
// by characters. Two rings (dense near / sparse far) in two draw calls.
import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uint,
  instanceIndex,
  positionLocal,
  positionWorld,
  cameraPosition,
  cameraViewMatrix,
  texture,
  uniform,
  hash,
  sin,
  cos,
  mix,
  smoothstep,
  saturate,
  normalize,
  length,
  max,
  pow,
  dot,
  varying,
  mx_noise_float,
  floor,
  faceDirection,
  step,
} from 'three/tsl';
import { U } from '../core/env';
import { worldToHfUV, type Terrain } from './terrain';
import { sstep } from '../core/tsl';

function bladeGeometry(segments: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < segments; k++) {
    const y = k / segments;
    const w = 1 - Math.pow(y, 1.4) * 0.85;
    pos.push(-0.5 * w, y, 0, 0.5 * w, y, 0);
  }
  pos.push(0, 1, 0);
  for (let k = 0; k < segments - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, segments * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export interface GrassRingOpts {
  patch: number; // patch size (m)
  grid: number; // patches per side
  perSide: number; // blades per patch side
  widthScale: number;
  heightScale: number;
  innerRadius: number; // skip blades inside this radius (handled by the near ring)
  outerRadius: number;
  segments: number;
}

export class GrassField {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; origin: any; opts: GrassRingOpts }[] = [];

  constructor(
    private terrain: Terrain,
    density: number,
    radius: number,
  ) {
    const nearR = Math.min(34, radius * 0.55);
    const nearPatch = 8;
    const nearGrid = Math.ceil((nearR * 2) / nearPatch) + 1;
    const nearPerSide = Math.max(8, Math.round(Math.sqrt(density * nearPatch * nearPatch)));
    this.addRing({ patch: nearPatch, grid: nearGrid, perSide: nearPerSide, widthScale: 1, heightScale: 1, innerRadius: 0, outerRadius: nearR, segments: 5 });
    const farPatch = 16;
    const farGrid = Math.ceil((radius * 2) / farPatch) + 1;
    const farPerSide = Math.max(6, Math.round(Math.sqrt(density * 0.16 * farPatch * farPatch)));
    this.addRing({ patch: farPatch, grid: farGrid, perSide: farPerSide, widthScale: 2.3, heightScale: 1.05, innerRadius: nearR - 4, outerRadius: radius, segments: 3 });
  }

  private addRing(o: GrassRingOpts) {
    const geo = bladeGeometry(o.segments);
    const perPatch = o.perSide * o.perSide;
    geo.instanceCount = perPatch * o.grid * o.grid;
    const origin = uniform(new THREE.Vector2());
    const mat = this.material(o, origin, perPatch);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'grass';
    this.group.add(mesh);
    this.rings.push({ mesh, origin, opts: o });
  }

  update(cam: THREE.Vector3) {
    for (const r of this.rings) {
      const P = r.opts.patch;
      r.origin.value.set(Math.floor(cam.x / P) * P, Math.floor(cam.z / P) * P);
    }
  }

  private material(o: GrassRingOpts, origin: any, perPatch: number) {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const sampleH = this.terrain.sampleHeight;
    const splatTex = this.terrain.tex.splat;
    const P = o.patch,
      G = o.grid,
      K = o.perSide;

    const vT = varying(float(0), 'vGrassT');
    const vRand = varying(float(0), 'vGrassR');
    const vGust = varying(float(0), 'vGrassGust');
    const vDry = varying(float(0), 'vGrassDry');
    const vFacing = varying(vec3(0, 0, 1), 'vGrassFacing');

    mat.positionNode = Fn(() => {
      const id = instanceIndex;
      const blade = id.mod(uint(perPatch));
      const patch = id.div(uint(perPatch));
      const pxI = patch.mod(uint(G));
      const pzI = patch.div(uint(G));
      const patchOrigin = origin.add(vec2(float(pxI), float(pzI)).sub(float(G / 2)).mul(P));
      const key = uint(floor(patchOrigin.x.div(P)).add(8192.0)).mul(uint(7919)).add(uint(floor(patchOrigin.y.div(P)).add(8192.0)).mul(uint(104729)));
      const seed = blade.add(key.mul(uint(perPatch)));
      const r0 = hash(seed);
      const r1 = hash(seed.add(uint(1013)));
      const r2 = hash(seed.add(uint(2027)));
      const r3 = hash(seed.add(uint(3041)));
      const r4 = hash(seed.add(uint(4057)));
      const bi = blade.mod(uint(K));
      const bj = blade.div(uint(K));
      const cell = float(P / K);
      const xz = patchOrigin.add(vec2(float(bi).add(r0), float(bj).add(r1)).mul(cell));

      const camXZ = cameraPosition.xz;
      const dist = length(xz.sub(camXZ));
      const splat = texture(splatTex, worldToHfUV(xz)).level(float(0) as any);
      const density = splat.z;
      const fadeOut = sstep(o.outerRadius, o.outerRadius * 0.72, dist);
      const fadeIn = o.innerRadius > 0 ? smoothstep(o.innerRadius, o.innerRadius + 6, dist) : float(1);
      const keep = step(r2, density.mul(1.15)).mul(fadeOut).mul(fadeIn);

      // Patchy tall grass via low-frequency noise.
      const tall = mx_noise_float(vec3(xz.x.mul(0.035), 0.0, xz.y.mul(0.035))).mul(0.5).add(0.5);
      const hgt = mix(float(0.22), float(0.6), r3).mul(mix(float(0.5), float(1.35), tall)).mul(o.heightScale).mul(keep).mul(smoothstep(0.1, 0.5, density).mul(0.6).add(0.4));
      const width = float(0.04).mul(mix(float(0.6), float(1.35), r4)).mul(o.widthScale);
      const yaw = r4.mul(6.2831).add(r0.mul(3.0));
      const facing = vec2(cos(yaw), sin(yaw));
      const side = vec2(facing.y.negate(), facing.x);

      const t = positionLocal.y;
      const lx = positionLocal.x;

      // Wind: large travelling gusts + per-blade flutter.
      const wdir = U.windDir;
      const scroll = wdir.mul(U.time.mul(float(3.2).add(U.windStrength.mul(4.0))));
      const gust = mx_noise_float(vec3(xz.sub(scroll).mul(0.045), U.time.mul(0.12))).mul(0.5).add(0.5);
      const gustSharp = smoothstep(0.35, 0.85, gust);
      const flutter = sin(U.time.mul(mix(float(3.0), float(5.5), r1)).add(r0.mul(6.28)).add(dot(xz, wdir).mul(0.6))).mul(0.12);
      const wind = U.windStrength.mul(gustSharp.mul(0.75).add(0.18)).add(flutter.mul(U.windStrength));
      const curl = mix(float(0.12), float(0.42), r2);
      let off: any = facing.mul(curl).add(wdir.mul(wind)).mul(t.mul(t)).mul(hgt);

      // Characters push the grass aside.
      const bend = (b: any) => {
        const d = xz.sub(b.xz);
        const l = max(length(d), 0.001);
        const push = saturate(float(1).sub(l.div(b.w)));
        return d.div(l).mul(push.mul(push)).mul(1.4);
      };
      const pushV = bend(U.bend0).add(bend(U.bend1)).add(bend(U.bend2)).add(bend(U.bend3));
      off = off.add(pushV.mul(pow(t, 1.3)).mul(hgt));
      const pushAmt = length(pushV);

      const bentLen = length(off);
      const yy = t.mul(hgt).mul(float(1).sub(saturate(bentLen.div(max(hgt, 0.01))).mul(0.45))).mul(float(1).sub(saturate(pushAmt).mul(0.35)));
      const ground: any = sampleH(xz);
      const wxz = xz.add(side.mul(lx).mul(width)).add(off);

      vT.assign(t);
      vRand.assign(r3);
      vGust.assign(gustSharp.mul(U.windStrength));
      vDry.assign(mx_noise_float(vec3(xz.x.mul(0.011), 5.0, xz.y.mul(0.011))).mul(0.5).add(0.5).add(r1.mul(0.25)));
      vFacing.assign(normalize(vec3(side.x, 0.0, side.y)));
      return vec3(wxz.x, ground.add(yy).sub(0.03), wxz.y);
    })();

    // Normals: blend blade normal with up for soft, field-like shading.
    const n = normalize(mix(vFacing.mul(faceDirection), vec3(0, 1, 0), 0.62));
    mat.normalNode = normalize(cameraViewMatrix.mul(vec4(n, 0)).xyz);

    const lush = vec3(0.07, 0.15, 0.025);
    const golden = vec3(0.22, 0.2, 0.065);
    const baseDark = vec3(0.025, 0.05, 0.012);
    const tipCol: any = mix(lush, golden, saturate(vDry.sub(0.35).mul(1.4)));
    let col: any = mix(baseDark, tipCol, smoothstep(0.0, 0.85, vT));
    col = col.mul(mix(float(0.8), float(1.2), vRand));
    col = col.add(vec3(0.06, 0.07, 0.02).mul(vGust).mul(vT)); // wind sheen
    mat.colorNode = col;
    mat.roughnessNode = float(0.88);
    // Translucency when backlit by the sun.
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const back = pow(saturate(dot(viewDir, U.sunDir)), 3.0);
    mat.emissiveNode = tipCol.mul(U.sunColor).mul(back.mul(vT).mul(0.3).mul(U.sunIntensity).mul(0.18));
    return mat;
  }
}
