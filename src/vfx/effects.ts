// Mesh-based VFX: sword trails, shockwaves, lightning bolts, magic circles,
// beams, ice crystal clusters, plus a pooled dynamic light system.
import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  uv,
  uniform,
  attribute,
  mix,
  smoothstep,
  saturate,
  abs,
  sin,
  cos,
  atan,
  length,
  fract,
  floor,
  pow,
  exp,
  mx_noise_float,
  mx_fractal_noise_float,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
  dot,
  normalize,
  max,
} from 'three/tsl';
import { U } from '../core/env';
import { sstep } from '../core/tsl';

const additiveMat = () => {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  m.fog = false;
  return m;
};

// ---------------------------------------------------------------------------
// Sword trail ribbon
// ---------------------------------------------------------------------------
export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private n = 28;
  private base: THREE.Vector3[] = [];
  private tip: THREE.Vector3[] = [];
  private ages: number[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  active = false;
  readonly color = uniform(new THREE.Color(0.75, 0.9, 1.4));
  readonly intensity = uniform(1);
  private geo: THREE.BufferGeometry;
  constructor() {
    const n = this.n;
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uvs[i * 4] = i / (n - 1);
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = i / (n - 1);
      uvs[i * 4 + 3] = 1;
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    this.geo = g;
    const m = additiveMat();
    const a = attribute('alpha', 'float');
    const along = uv().y; // 0 at base, 1 at tip
    const streak = mx_noise_float(vec3(uv().x.mul(6.0), along.mul(3.0), U.time.mul(4.0))).mul(0.5).add(0.5);
    const edge = pow(along, 1.6);
    m.colorNode = vec4((vec3(this.color as any) as any).mul(this.intensity).mul(a).mul(edge.mul(1.6).add(0.2)).mul(streak.mul(0.6).add(0.6)), 1);
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  push(base: THREE.Vector3, tip: THREE.Vector3) {
    this.base.unshift(base.clone());
    this.tip.unshift(tip.clone());
    this.ages.unshift(0);
    if (this.base.length > this.n) {
      this.base.pop();
      this.tip.pop();
      this.ages.pop();
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
    // Drop old samples.
    while (this.ages.length && this.ages[this.ages.length - 1] > 0.22) {
      this.ages.pop();
      this.base.pop();
      this.tip.pop();
    }
    const n = this.n;
    const L = this.base.length;
    for (let i = 0; i < n; i++) {
      const k = Math.min(i, L - 1);
      const b = L ? this.base[k] : new THREE.Vector3();
      const t = L ? this.tip[k] : new THREE.Vector3();
      this.pos.set([b.x, b.y, b.z, t.x, t.y, t.z], i * 6);
      const age = L ? this.ages[k] / 0.22 : 1;
      const a = i < L ? Math.max(0, 1 - age) * (1 - i / n) : 0;
      this.alpha[i * 2] = a * 0.2;
      this.alpha[i * 2 + 1] = a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = L > 1;
  }
}

// ---------------------------------------------------------------------------
// Transient effects (shockwaves, bolts, circles, beams, crystals)
// ---------------------------------------------------------------------------
interface Transient {
  obj: THREE.Object3D;
  age: number;
  life: number;
  update: (t: number, dt: number) => void;
  dispose?: () => void;
  /** Advance on real time (ignores hit-stop / slow-mo). */
  real?: boolean;
}

const ringGeo = new THREE.RingGeometry(0.85, 1.0, 96, 1).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
const sphereGeo = new THREE.SphereGeometry(1, 48, 24);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
const slashGeo = new THREE.PlaneGeometry(1, 1);

export class Effects {
  readonly group = new THREE.Group();
  private list: Transient[] = [];
  lights: LightPool;

  constructor(scene: THREE.Scene) {
    this.lights = new LightPool(scene, 4);
  }

  private add(t: Transient) {
    this.group.add(t.obj);
    this.list.push(t);
    t.update(0, 0);
  }

  update(dt: number, realDt = dt) {
    for (const t of this.list) {
      const d = t.real ? realDt : dt;
      t.age += d;
      t.update(Math.min(1, t.age / t.life), d);
    }
    const dead = this.list.filter((t) => t.age >= t.life);
    for (const d of dead) {
      this.group.remove(d.obj);
      d.dispose?.();
    }
    this.list = this.list.filter((t) => t.age < t.life);
    this.lights.update(dt);
  }

  /** A bright crescent cut drawn across the impact point along the swing, facing the camera. */
  slashArc(pos: THREE.Vector3, dir: THREE.Vector3, camPos: THREE.Vector3, color: THREE.Color, size: number, life = 0.22) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const p = uv().sub(0.5).mul(2.0);
    // Arc of a circle centred below the quad; thickest mid-sweep, tapering at both tips.
    const d = length(p.sub(vec2(0, -1.25))).sub(1.35);
    const along = p.x.mul(0.5).add(0.5);
    const taper = sstep(0.0, 0.5, along).mul(sstep(1.0, 0.5, along));
    const w = taper.mul(0.3).add(0.015);
    const core = exp(abs(d).div(w).mul(-1.6));
    // Sweep in fast, then burn off from the tail.
    const head = smoothstep(0.0, 0.35, k).mul(1.25);
    const tail = smoothstep(0.3, 1.0, k).mul(1.1);
    const vis = float(1).sub(smoothstep(head.sub(0.12), head, along)).mul(smoothstep(tail.sub(0.1), tail, along));
    const hot = vec3(1, 1, 1).mul(exp(abs(d).div(w).mul(-8.0)).mul(0.8));
    m.colorNode = vec4(vec3(c as any).mul(core).add(hot).mul(vis).mul(3.5), 1);
    // Impact points sit inside the target's hit volume: draw on top.
    m.depthTest = false;
    const mesh = new THREE.Mesh(slashGeo, m);
    const toCam = camPos.clone().sub(pos).normalize();
    const x = dir.clone().addScaledVector(toCam, -dir.dot(toCam));
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(toCam, x).normalize();
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, toCam));
    mesh.position.copy(pos).addScaledVector(toCam, 0.3);
    const sz = Math.max(size, camPos.distanceTo(pos) * 0.075);
    mesh.scale.set(sz * 2.2, sz, 1);
    mesh.renderOrder = 6;
    this.add({ obj: mesh, age: 0, life, real: true, update: (t) => (k.value = t), dispose: () => m.dispose() });
  }

  /** Expanding ground shockwave ring. */
  shockwave(pos: THREE.Vector3, color: THREE.Color, radius: number, life = 0.6, thickness = 1) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const r = length(uv().sub(0.5)).mul(2.0);
    const n = mx_noise_float(vec3(uv().mul(12.0), U.time.mul(2.0))).mul(0.5).add(0.5);
    m.colorNode = vec4((vec3(c as any) as any).mul(float(1).sub(k)).mul(n.mul(0.8).add(0.6)).mul(3.0), 1);
    void r;
    const mesh = new THREE.Mesh(ringGeo, m);
    mesh.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    this.add({
      obj: mesh,
      age: 0,
      life,
      update: (t) => {
        const e = 1 - Math.pow(1 - t, 3);
        mesh.scale.set(radius * e + 0.2, 1, radius * e + 0.2);
        k.value = t;
        (mesh.material as any).opacity = 1;
        mesh.scale.y = thickness;
      },
      dispose: () => m.dispose(),
    });
  }

  /** Expanding energy dome / flash sphere. */
  dome(pos: THREE.Vector3, color: THREE.Color, radius: number, life = 0.5, power = 2) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const V = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(abs(dot(normalWorld, V))), 2.5);
    const n = mx_fractal_noise_float(positionLocal.mul(3.0).add(vec3(0, U.time.mul(2.0), 0)), 3, 2.0, 0.5).mul(0.5).add(0.5);
    m.colorNode = vec4((vec3(c as any) as any).mul(fres.mul(1.5).add(0.15)).mul(float(1).sub(k)).mul(n.add(0.4)).mul(power), 1);
    const mesh = new THREE.Mesh(sphereGeo, m);
    mesh.position.copy(pos);
    this.add({
      obj: mesh,
      age: 0,
      life,
      update: (t) => {
        const e = 1 - Math.pow(1 - t, 4);
        mesh.scale.setScalar(radius * e + 0.05);
        k.value = t;
      },
      dispose: () => m.dispose(),
    });
  }

  /** Jagged lightning bolt from `from` to `to` with branches. */
  lightning(from: THREE.Vector3, to: THREE.Vector3, color = new THREE.Color(0.7, 0.8, 1.6), life = 0.35, width = 0.35, branches = 4) {
    const segs: [THREE.Vector3, THREE.Vector3, number][] = [];
    const build = (a: THREE.Vector3, b: THREE.Vector3, disp: number, depth: number, w: number) => {
      if (depth === 0) {
        segs.push([a, b, w]);
        return;
      }
      const mid = a.clone().lerp(b, 0.5);
      const dir = b.clone().sub(a);
      const perp = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(dir).normalize();
      mid.addScaledVector(perp, (Math.random() - 0.5) * disp);
      build(a, mid, disp * 0.55, depth - 1, w);
      build(mid, b, disp * 0.55, depth - 1, w);
      if (branches > 0 && depth > 2 && Math.random() < 0.28) {
        const bend = mid.clone().add(dir.clone().multiplyScalar(0.3 + Math.random() * 0.3)).add(new THREE.Vector3((Math.random() - 0.5) * disp * 2, -Math.random() * disp, (Math.random() - 0.5) * disp * 2));
        build(mid, bend, disp * 0.5, depth - 2, w * 0.45);
      }
    };
    build(from, to, from.distanceTo(to) * 0.35, 7, width);
    // Camera-facing ribbons, built in the shader via a side vector per vertex.
    const pos: number[] = [];
    const other: number[] = [];
    const side: number[] = [];
    const wid: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const [a, b, w] of segs) {
      for (const [p, o, s] of [
        [a, b, -1],
        [a, b, 1],
        [b, a, -1],
        [b, a, 1],
      ] as [THREE.Vector3, THREE.Vector3, number][]) {
        pos.push(p.x, p.y, p.z);
        other.push(o.x, o.y, o.z);
        side.push(s);
        wid.push(w);
      }
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('other', new THREE.Float32BufferAttribute(other, 3));
    g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('wid', new THREE.Float32BufferAttribute(wid, 1));
    g.setIndex(idx);
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    m.positionNode = Fn(() => {
      const p = positionLocal;
      const o = attribute('other', 'vec3');
      const s = attribute('side', 'float');
      const w = attribute('wid', 'float');
      const dir = normalize(o.sub(p));
      const toCam = normalize(cameraPosition.sub(p));
      const perp = normalize(dir.cross(toCam));
      return p.add(perp.mul(s).mul(w).mul(float(1).sub(k.mul(0.6))));
    })();
    const flick = sin(U.time.mul(90.0)).mul(0.3).add(0.8);
    m.colorNode = vec4((vec3(c as any) as any).mul(float(1).sub(k)).mul(flick).mul(6.0), 1);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.add({ obj: mesh, age: 0, life, update: (t) => (k.value = t), dispose: () => (g.dispose(), m.dispose()) });
  }

  /** Rotating rune circle on the ground (spells, limit, summons). */
  magicCircle(pos: THREE.Vector3, color: THREE.Color, radius: number, life: number, opts: { spin?: number; rise?: number; normal?: THREE.Vector3 } = {}) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const p = uv().sub(0.5).mul(2.0);
    const r = length(p);
    const a = atan(p.y, p.x);
    const spin = uniform(0);
    const ring = (rad: number, w: number) => sstep(w, 0.0, abs(r.sub(rad)));
    const ticks = smoothstep(0.7, 1.0, abs(sin(a.mul(24.0).add(spin)))).mul(ring(0.82, 0.05));
    const runes = smoothstep(0.55, 0.8, mx_noise_float(vec3(floor(a.add(spin.mul(0.5)).mul(10.0)), floor(r.mul(14.0)), 3.0)).mul(0.5).add(0.5)).mul(smoothstep(0.62, 0.66, r)).mul(sstep(0.78, 0.74, r));
    const star = sstep(0.03, 0.0, abs(r.mul(cos(a.mul(3.0).add(spin.negate()).mod(2.094).sub(1.047))).sub(0.55)));
    const inner = ring(0.3, 0.02).add(ring(0.55, 0.015)).add(ring(0.95, 0.02)).add(ring(0.9, 0.008));
    const pattern = saturate(inner.add(ticks).add(runes.mul(0.8)).add(star.mul(sstep(0.56, 0.5, r))));
    const appear = smoothstep(0.0, 0.15, k).mul(sstep(1.0, 0.75, k));
    m.colorNode = vec4((vec3(c as any) as any).mul(pattern).mul(appear).mul(4.0), 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.copy(pos).add(new THREE.Vector3(0, 0.08, 0));
    if (opts.normal) holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), opts.normal);
    holder.scale.setScalar(radius);
    this.add({
      obj: holder,
      age: 0,
      life,
      update: (t, dt) => {
        k.value = t;
        spin.value += dt * (opts.spin ?? 1.2);
        if (opts.rise) holder.position.y += dt * opts.rise;
      },
      dispose: () => (mesh.geometry.dispose(), m.dispose()),
    });
    return holder;
  }

  /** Vertical pillar of light / energy column. */
  pillar(pos: THREE.Vector3, color: THREE.Color, radius: number, height: number, life: number, power = 3) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const v = uv();
    const n = mx_fractal_noise_float(vec3(v.x.mul(8.0), v.y.mul(3.0).sub(U.time.mul(3.0)), 0), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const edgeFade = sstep(1.0, 0.7, v.y).mul(smoothstep(0.0, 0.05, v.y));
    const appear = smoothstep(0.0, 0.1, k).mul(sstep(1.0, 0.6, k));
    m.colorNode = vec4((vec3(c as any) as any).mul(n.add(0.3)).mul(edgeFade).mul(appear).mul(power), 1);
    const mesh = new THREE.Mesh(cylGeo, m);
    mesh.position.copy(pos);
    this.add({
      obj: mesh,
      age: 0,
      life,
      update: (t) => {
        k.value = t;
        const w = radius * (0.4 + Math.min(1, t * 6) * 0.6) * (1 - t * 0.3);
        mesh.scale.set(w, height, w);
      },
      dispose: () => m.dispose(),
    });
  }

  /** Beam between two points (boss breath). Returns handle to update endpoints. */
  beam(color: THREE.Color, radius: number) {
    const c = uniform(color.clone());
    const inten = uniform(1);
    const len = uniform(10);
    const v = uv();
    // Camera-facing falloff: bright along the axis, soft at the silhouette.
    const facing = abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))));
    // Noise density independent of beam length; flows from source to target.
    const along = v.y.mul(len).mul(0.12);
    const n = mx_fractal_noise_float(vec3(v.x.mul(6.0), along.sub(U.time.mul(9.0)), 0), 4, 2.0, 0.5).mul(0.5).add(0.5);
    const ends = smoothstep(0.0, 0.015, v.y).mul(sstep(1.0, 0.985, v.y));
    const coreM = additiveMat();
    const core = pow(facing, 1.6);
    coreM.colorNode = vec4(vec3(c as any).mul(core.mul(n.mul(1.1).add(0.55))).add(vec3(1, 1, 1).mul(pow(facing, 6.0).mul(0.6))).mul(inten).mul(ends).mul(4.0), 1);
    const mesh = new THREE.Mesh(cylGeo, coreM);
    mesh.frustumCulled = false;
    const haloM = additiveMat();
    haloM.colorNode = vec4(vec3(c as any).mul(pow(facing, 3.0).mul(n.mul(0.4).add(0.6)).mul(0.2)).mul(inten).mul(ends).mul(4.0), 1);
    const halo = new THREE.Mesh(cylGeo, haloM);
    halo.frustumCulled = false;
    halo.scale.set(2.0, 1, 2.0);
    mesh.add(halo);
    this.group.add(mesh);
    const up = new THREE.Vector3(0, 1, 0);
    return {
      mesh,
      inten,
      set(a: THREE.Vector3, b: THREE.Vector3, r = radius) {
        const d = b.clone().sub(a);
        const l = d.length();
        mesh.position.copy(a);
        if (l > 1e-6) mesh.quaternion.setFromUnitVectors(up, d.multiplyScalar(1 / l));
        mesh.scale.set(r, Math.max(l, 1e-4), r);
        len.value = l / Math.max(r, 0.05);
      },
      dispose: () => {
        mesh.parent?.remove(mesh);
        coreM.dispose();
        haloM.dispose();
      },
    };
  }

  /** Cluster of ice crystals erupting from the ground. */
  iceCluster(pos: THREE.Vector3, count: number, scale: number, life: number, groundFn: (x: number, z: number) => number) {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.35, 1.6, 0.35);
    g.translate(0, 1.2, 0);
    const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true });
    const k = uniform(0);
    const fres = pow(float(1).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), 2.0);
    m.colorNode = vec3(0.55, 0.8, 1.0);
    m.roughnessNode = float(0.05);
    m.metalnessNode = float(0.1);
    (m as any).clearcoatNode = float(1);
    m.emissiveNode = vec3(0.35, 0.7, 1.6).mul(fres.mul(1.5).add(0.25)).mul(float(1).sub(k.mul(0.5)));
    m.opacityNode = saturate(float(0.85).sub(k.mul(k).mul(0.85)));
    const inst = new THREE.InstancedMesh(g, m, count);
    const dummy = new THREE.Object3D();
    const seeds: { x: number; z: number; s: number; rx: number; rz: number; ry: number; d: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * scale * 1.6;
      seeds.push({ x: pos.x + Math.cos(a) * r, z: pos.z + Math.sin(a) * r, s: scale * (0.5 + Math.random() * 0.8) * (1 - r / (scale * 2.2)), rx: (Math.random() - 0.5) * 0.9, rz: (Math.random() - 0.5) * 0.9, ry: Math.random() * 6, d: Math.random() * 0.12 });
    }
    inst.castShadow = true;
    this.add({
      obj: inst,
      age: 0,
      life,
      update: (t) => {
        k.value = t;
        seeds.forEach((sd, i) => {
          const grow = Math.min(1, Math.max(0, (t * life - sd.d) / 0.18));
          const e = 1 - Math.pow(1 - grow, 3);
          dummy.position.set(sd.x, groundFn(sd.x, sd.z) - 0.3, sd.z);
          dummy.rotation.set(sd.rx, sd.ry, sd.rz);
          dummy.scale.setScalar(Math.max(0.001, sd.s * e * (t > 0.85 ? 1 + (t - 0.85) * 0.8 : 1)));
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
      },
      dispose: () => (g.dispose(), m.dispose()),
    });
  }

  /** Swirling fire sphere (Fire spell core). */
  fireball(pos: THREE.Vector3, radius: number, life: number) {
    const m = additiveMat();
    const k = uniform(0);
    const n = mx_fractal_noise_float(positionLocal.mul(2.5).add(vec3(0, U.time.mul(-3.0), 0)), 4, 2.0, 0.55).mul(0.5).add(0.5);
    const V = normalize(cameraPosition.sub(positionWorld));
    const core = pow(abs(dot(normalWorld, V)), 1.5);
    const col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.85, 0.4), n.mul(core));
    m.colorNode = vec4(col.mul(n.mul(core).mul(2.0).add(0.25)).mul(float(1).sub(k)).mul(2.2), 1);
    const mesh = new THREE.Mesh(sphereGeo, m);
    mesh.position.copy(pos);
    this.add({
      obj: mesh,
      age: 0,
      life,
      update: (t) => {
        k.value = t;
        mesh.scale.setScalar(radius * (0.4 + (1 - Math.pow(1 - t, 3)) * 0.9));
      },
      dispose: () => m.dispose(),
    });
  }

  /** Danger zone on the ground: pulsing ring that fills in until impact. */
  telegraph(pos: THREE.Vector3, radius: number, life: number, color = new THREE.Color(1, 0.25, 0.1)) {
    const m = additiveMat();
    const k = uniform(0);
    const c = uniform(color.clone());
    const p = uv().sub(0.5).mul(2.0);
    const r = length(p);
    const edge = sstep(0.06, 0.0, abs(r.sub(0.94)));
    const fill = float(1).sub(smoothstep(k, k.add(0.02), r)).mul(0.35);
    const pulse = sin(U.time.mul(14.0)).mul(0.25).add(0.75);
    const inside = sstep(1.0, 0.98, r);
    const warn = saturate(edge.add(fill).add(sstep(0.02, 0.0, abs(r.sub(k))).mul(0.8))).mul(inside);
    m.colorNode = vec4((vec3(c as any) as any).mul(warn).mul(pulse).mul(2.5), 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos).add(new THREE.Vector3(0, 0.12, 0));
    mesh.scale.setScalar(radius);
    this.add({ obj: mesh, age: 0, life, update: (t) => (k.value = t), dispose: () => (mesh.geometry.dispose(), m.dispose()) });
  }

  telegraphLine(from: THREE.Vector3, to: THREE.Vector3, width: number, life: number) {
    const m = additiveMat();
    const k = uniform(0);
    const v = uv();
    const edge = sstep(0.1, 0.0, abs(v.x.sub(0.5)).sub(0.4).abs());
    const sweep = float(1).sub(smoothstep(k, k.add(0.03), v.y)).mul(0.3);
    const pulse = sin(U.time.mul(14.0)).mul(0.25).add(0.75);
    m.colorNode = vec4(vec3(1.0, 0.25, 0.1).mul(saturate(edge.add(sweep))).mul(pulse).mul(2.5), 1);
    const len = from.distanceTo(to);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), m);
    mesh.position.copy(from).lerp(to, 0.5).add(new THREE.Vector3(0, 0.15, 0));
    mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(to.x - from.x, to.z - from.z) + Math.PI, 'YXZ');
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-Math.PI / 2, Math.atan2(to.x - from.x, to.z - from.z), 0);
    this.add({ obj: mesh, age: 0, life, update: (t) => (k.value = t), dispose: () => (mesh.geometry.dispose(), m.dispose()) });
  }

  flashLight(pos: THREE.Vector3, color: THREE.Color, intensity: number, distance: number, life: number) {
    this.lights.flash(pos, color, intensity, distance, life);
  }

  void() {
    void vec2;
    void cos;
    void fract;
    void exp;
    void max;
    void discGeo;
  }
}

// ---------------------------------------------------------------------------
// Dynamic lights: fixed number of point lights (constant shader permutation).
// ---------------------------------------------------------------------------
export class LightPool {
  private lights: { l: THREE.PointLight; age: number; life: number; peak: number; follow?: () => THREE.Vector3 }[] = [];
  constructor(scene: THREE.Scene, n: number) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.position.set(0, -1000, 0);
      scene.add(l);
      this.lights.push({ l, age: 1, life: 1, peak: 0 });
    }
  }
  flash(pos: THREE.Vector3, color: THREE.Color, intensity: number, distance: number, life: number, follow?: () => THREE.Vector3) {
    // Reuse the most faded light.
    let best = this.lights[0];
    for (const x of this.lights) if (x.age / x.life > best.age / best.life) best = x;
    best.l.position.copy(pos);
    best.l.color.copy(color);
    best.l.distance = distance;
    best.age = 0;
    best.life = life;
    best.peak = intensity;
    best.follow = follow;
    return best.l;
  }
  update(dt: number) {
    for (const x of this.lights) {
      x.age += dt;
      const t = Math.min(1, x.age / x.life);
      x.l.intensity = x.peak * (t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 1.6));
      if (x.follow && t < 1) x.l.position.copy(x.follow());
    }
  }
}
