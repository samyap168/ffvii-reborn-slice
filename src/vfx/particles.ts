// Particle engine: CPU simulation, GPU billboards. Two pools (additive / alpha),
// many shape types rendered procedurally in the fragment shader, soft depth fade.
import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  vec2,
  vec3,
  vec4,
  float,
  uv,
  positionLocal,
  cameraViewMatrix,
  cameraProjectionMatrix,
  modelWorldMatrix,
  mix,
  smoothstep,
  saturate,
  length,
  exp,
  pow,
  abs,
  max,
  min,
  sin,
  cos,
  dot,
  normalize,
  mx_noise_float,
  mx_fractal_noise_float,
  viewportDepthTexture,
  screenUV,
  perspectiveDepthToViewZ,
  cameraNear,
  cameraFar,
  positionView,
  varying,
  fract,
} from 'three/tsl';
import { U } from '../core/env';
import { sstep } from '../core/tsl';

export const enum PType {
  Glow = 0,
  Spark = 1,
  Smoke = 2,
  Flame = 3,
  Shard = 4,
  Feather = 5,
  Petal = 6,
  Mote = 7,
  Debris = 8,
  Snow = 9,
}

export interface PSpawn {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.Color | [number, number, number];
  colorEnd?: THREE.Color | [number, number, number];
  alpha?: number;
  type: PType;
  gravity?: number;
  drag?: number;
  turb?: number;
  spin?: number;
  stretch?: number; // velocity stretch factor (sparks)
  additive?: boolean;
  emissive?: number; // HDR multiplier
  /** Orbit around a point (limit aura): radius shrink etc. */
  orbit?: { center: THREE.Vector3; speed: number; pull: number };
  floor?: number; // bounce on y floor (debris)
}

class Pool {
  readonly cap: number;
  count = 0;
  // Simulation state (SoA)
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  age: Float32Array; life: Float32Array;
  s0: Float32Array; s1: Float32Array;
  c0: Float32Array; c1: Float32Array; // rgb x2
  alpha: Float32Array; emi: Float32Array;
  type: Uint8Array; grav: Float32Array; drag: Float32Array; turb: Float32Array;
  rot: Float32Array; spin: Float32Array; stretch: Float32Array;
  floor: Float32Array;
  orbit: ({ center: THREE.Vector3; speed: number; pull: number } | null)[];
  // GPU attributes
  aPos: THREE.InstancedBufferAttribute;
  aVel: THREE.InstancedBufferAttribute;
  aCol: THREE.InstancedBufferAttribute;
  aMisc: THREE.InstancedBufferAttribute;
  geo: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f();
    this.c0 = new Float32Array(cap * 3); this.c1 = new Float32Array(cap * 3);
    this.alpha = f(); this.emi = f(); this.type = new Uint8Array(cap);
    this.grav = f(); this.drag = f(); this.turb = f(); this.rot = f(); this.spin = f(); this.stretch = f(); this.floor = f();
    this.orbit = new Array(cap).fill(null);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // xyz, size
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // velocity xyz, stretch
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // rgb*emi, alpha
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); // life01, type, rot, seed
    for (const a of [this.aPos, this.aVel, this.aCol, this.aMisc]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iMisc', this.aMisc);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, particleMaterial(additive));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  spawn(s: PSpawn) {
    let i = this.count;
    if (i >= this.cap) {
      // Replace the oldest-relative particle.
      let best = 0,
        bestR = -1;
      for (let k = 0; k < this.cap; k += 7) {
        const r = this.age[k] / this.life[k];
        if (r > bestR) {
          bestR = r;
          best = k;
        }
      }
      i = best;
    } else this.count++;
    this.px[i] = s.pos.x; this.py[i] = s.pos.y; this.pz[i] = s.pos.z;
    this.vx[i] = s.vel?.x ?? 0; this.vy[i] = s.vel?.y ?? 0; this.vz[i] = s.vel?.z ?? 0;
    this.age[i] = 0; this.life[i] = Math.max(0.01, s.life);
    this.s0[i] = s.size; this.s1[i] = s.sizeEnd ?? s.size;
    const c0 = s.color instanceof THREE.Color ? [s.color.r, s.color.g, s.color.b] : s.color;
    const c1raw = s.colorEnd ?? s.color;
    const c1 = c1raw instanceof THREE.Color ? [c1raw.r, c1raw.g, c1raw.b] : c1raw;
    this.c0.set(c0, i * 3); this.c1.set(c1, i * 3);
    this.alpha[i] = s.alpha ?? 1; this.emi[i] = s.emissive ?? 1;
    this.type[i] = s.type; this.grav[i] = s.gravity ?? 0; this.drag[i] = s.drag ?? 0; this.turb[i] = s.turb ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2; this.spin[i] = s.spin ?? 0; this.stretch[i] = s.stretch ?? 0;
    this.floor[i] = s.floor ?? -1e9;
    this.orbit[i] = s.orbit ?? null;
  }

  update(dt: number, time: number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d - this.grav[i] * dt; this.vz[i] *= d;
      const tb = this.turb[i];
      if (tb > 0) {
        const x = this.px[i] * 0.35, y = this.py[i] * 0.35, z = this.pz[i] * 0.35;
        this.vx[i] += Math.sin(y * 1.7 + time * 1.3 + z) * tb * dt;
        this.vy[i] += Math.sin(z * 1.3 + time * 1.1 + x) * tb * dt * 0.6;
        this.vz[i] += Math.sin(x * 1.9 + time * 1.7 + y) * tb * dt;
      }
      const o = this.orbit[i];
      if (o) {
        const dx = this.px[i] - o.center.x, dz = this.pz[i] - o.center.z;
        const r = Math.hypot(dx, dz) || 1e-3;
        // tangential + inward pull
        this.vx[i] += (-dz / r * o.speed - dx / r * o.pull) * dt * 6;
        this.vz[i] += (dx / r * o.speed - dz / r * o.pull) * dt * 6;
      }
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < this.floor[i]) {
        this.py[i] = this.floor[i];
        this.vy[i] *= -0.35;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    // Upload.
    const P = this.aPos.array as Float32Array, V = this.aVel.array as Float32Array, C = this.aCol.array as Float32Array, M = this.aMisc.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const o = i * 4;
      P[o] = this.px[i]; P[o + 1] = this.py[i]; P[o + 2] = this.pz[i];
      P[o + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      V[o] = this.vx[i]; V[o + 1] = this.vy[i]; V[o + 2] = this.vz[i]; V[o + 3] = this.stretch[i];
      const e = this.emi[i];
      C[o] = (this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t) * e;
      C[o + 1] = (this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t) * e;
      C[o + 2] = (this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t) * e;
      C[o + 3] = this.alpha[i];
      M[o] = t; M[o + 1] = this.type[i]; M[o + 2] = this.rot[i]; M[o + 3] = (i * 0.618) % 1;
    }
    for (const a of [this.aPos, this.aVel, this.aCol, this.aMisc]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(4, n * 4));
      a.needsUpdate = true;
    }
    this.geo.instanceCount = n;
  }

  private copy(from: number, to: number) {
    if (from === to) return;
    const arrs1 = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.alpha, this.emi, this.grav, this.drag, this.turb, this.rot, this.spin, this.stretch, this.floor];
    for (const a of arrs1) a[to] = a[from];
    this.type[to] = this.type[from];
    this.orbit[to] = this.orbit[from];
    for (let k = 0; k < 3; k++) {
      this.c0[to * 3 + k] = this.c0[from * 3 + k];
      this.c1[to * 3 + k] = this.c1[from * 3 + k];
    }
  }
}

function particleMaterial(additive: boolean) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  m.fog = !additive;
  const iPos = attribute('iPos', 'vec4');
  const iVel = attribute('iVel', 'vec4');
  const iCol = attribute('iCol', 'vec4');
  const iMisc = attribute('iMisc', 'vec4');
  const vType = varying(float(0), 'pType');
  const vLife = varying(float(0), 'pLife');
  const vSeed = varying(float(0), 'pSeed');
  const vViewZ = varying(float(0), 'pViewZ');

  m.vertexNode = Fn(() => {
    const c = positionLocal.xy;
    const size = iPos.w;
    const rot = iMisc.z;
    const cr = cos(rot),
      sr = sin(rot);
    const rc = vec2(c.x.mul(cr).sub(c.y.mul(sr)), c.x.mul(sr).add(c.y.mul(cr)));
    const viewCenter = cameraViewMatrix.mul(vec4(iPos.xyz, 1.0));
    // Velocity stretch (sparks): align quad with projected velocity.
    const vView = cameraViewMatrix.mul(vec4(iVel.xyz, 0.0)).xy;
    const speed = length(vView);
    const stretchAmt = iVel.w.mul(speed);
    const dir = vView.div(max(speed, 1e-4));
    const perp = vec2(dir.y.negate(), dir.x);
    const stretched = dir.mul(c.x.mul(size.add(stretchAmt))).add(perp.mul(c.y.mul(size)));
    const useStretch = iVel.w.greaterThan(0.0001);
    const off = useStretch.select(stretched, rc.mul(size));
    vType.assign(iMisc.y);
    vLife.assign(iMisc.x);
    vSeed.assign(iMisc.w);
    vViewZ.assign(viewCenter.z);
    return cameraProjectionMatrix.mul(vec4(viewCenter.xy.add(off), viewCenter.z, 1.0));
  })();

  const p = uv().mul(2).sub(1);
  const r = length(p);
  const life = vLife;
  const t = vType;
  const is = (k: number) => saturate(float(1).sub(abs(t.sub(k)).mul(2.0)));
  // Shapes.
  const glow = exp(r.mul(r).mul(-4.5));
  const spark = exp(r.mul(r).mul(-9.0)).mul(1.4).add(exp(abs(p.y).mul(-18.0)).mul(sstep(1.0, 0.2, abs(p.x))).mul(0.6));
  const n = mx_fractal_noise_float(vec3(p.mul(1.6), vSeed.mul(17.0).add(life.mul(1.2))), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const smoke = saturate(sstep(1.0, 0.25, r).mul(n.mul(1.6).sub(0.25)));
  const flameN = mx_noise_float(vec3(p.x.mul(2.5), p.y.mul(2.0).sub(life.mul(6.0)), vSeed.mul(9.0))).mul(0.5).add(0.5);
  const flame = saturate(sstep(1.0, 0.1, r.add(p.y.mul(0.3))).mul(flameN.mul(1.8).sub(0.2)));
  const shard = saturate(float(1).sub(abs(p.x).mul(2.2).add(abs(p.y).mul(1.0)))).mul(4.0).clamp(0, 1);
  const feather = saturate(float(1).sub(abs(p.x).mul(3.2).div(max(float(1).sub(abs(p.y)), 0.05)))).mul(sstep(1.0, 0.8, abs(p.y)));
  const petal = saturate(float(1).sub(length(vec2(p.x.mul(1.8), p.y)))).mul(3.0).clamp(0, 1);
  const twinkle = sin(life.mul(40.0).add(vSeed.mul(60.0))).mul(0.5).add(0.5);
  const mote = exp(r.mul(r).mul(-6.0)).add(exp(abs(p.x).mul(-30.0)).mul(exp(abs(p.y).mul(-4.0))).mul(twinkle)).add(exp(abs(p.y).mul(-30.0)).mul(exp(abs(p.x).mul(-4.0))).mul(twinkle));
  const debris = saturate(sstep(0.9, 0.6, r.add(n.mul(0.3))));
  const snow = exp(r.mul(r).mul(-3.0));
  const shape = glow
    .mul(is(0))
    .add(spark.mul(is(1)))
    .add(smoke.mul(is(2)))
    .add(flame.mul(is(3)))
    .add(shard.mul(is(4)))
    .add(feather.mul(is(5)))
    .add(petal.mul(is(6)))
    .add(mote.mul(is(7)))
    .add(debris.mul(is(8)))
    .add(snow.mul(is(9)));
  // Life fade: quick in, smooth out.
  const fade = smoothstep(0.0, 0.08, life).mul(sstep(1.0, 0.55, life));
  // Soft particles against scene depth.
  const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(screenUV).x, cameraNear, cameraFar);
  const soft = saturate(vViewZ.sub(sceneZ).mul(1.5));
  void positionView;
  let col: any = iCol.rgb;
  // Smoke gets a little sun lighting / darker core.
  const lit = mix(float(0.55), float(1.1), saturate(p.y.negate().mul(0.5).add(0.5).oneMinus())).mul(U.sunIntensity.mul(0.25).add(0.4));
  col = mix(col, col.mul(lit), is(2).add(is(8)));
  // Hot flame core.
  col = col.add(vec3(1.0, 0.8, 0.4).mul(flame.mul(flame).mul(is(3)).mul(iCol.rgb.length().mul(0.3))));
  const a = shape.mul(fade).mul(iCol.a).mul(soft);
  if (additive) {
    m.colorNode = vec4(col.mul(a), 1.0);
  } else {
    m.colorNode = vec4(col, a);
  }
  void mix;
  void pow;
  void min;
  void dot;
  void normalize;
  void fract;
  void modelWorldMatrix;
  void smoothstep;
  return m;
}

export class Particles {
  readonly group = new THREE.Group();
  readonly add: Pool;
  readonly alpha: Pool;
  private time = 0;
  constructor(budget: number) {
    this.add = new Pool(Math.floor(budget * 0.6), true);
    this.alpha = new Pool(Math.floor(budget * 0.4), false);
    this.group.add(this.alpha.mesh, this.add.mesh);
  }
  spawn(s: PSpawn) {
    const additive = s.additive ?? !(s.type === PType.Smoke || s.type === PType.Debris || s.type === PType.Feather || s.type === PType.Petal);
    (additive ? this.add : this.alpha).spawn(s);
  }
  update(dt: number) {
    this.time += dt;
    this.add.update(dt, this.time);
    this.alpha.update(dt, this.time);
  }
  get count() {
    return this.add.count + this.alpha.count;
  }
}
