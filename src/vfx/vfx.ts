// High-level VFX presets + screen-space feedback (flash, exposure, CA, hit-stop, slow-mo).
import * as THREE from 'three/webgpu';
import { Particles, PType } from './particles';
import { Effects, SwordTrail } from './effects';
import type { PostFX } from '../core/post';
import type { GameCamera } from '../game/camera';
import { U } from '../core/env';

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const rv = (s: number) => new THREE.Vector3(rnd(-s, s), rnd(-s, s), rnd(-s, s));

export class VFX {
  readonly group = new THREE.Group();
  readonly p: Particles;
  readonly fx: Effects;
  readonly trail = new SwordTrail();
  // Screen feedback state.
  private flashAmt = 0;
  private exposurePunch = 0;
  private caAmt = 0;
  private radial = 0;
  private desat = 0;
  hitStopTimer = 0;
  slowMo = { scale: 1, timer: 0, hold: 0 };
  groundFn: (x: number, z: number) => number = () => 0;
  private scorch = { x: 0, z: 0, r: 0, a: 0 };

  constructor(
    scene: THREE.Scene,
    budget: number,
    private post: PostFX,
    private cam: GameCamera,
  ) {
    this.p = new Particles(budget);
    this.fx = new Effects(scene);
    this.group.add(this.p.group, this.fx.group, this.trail.mesh);
  }

  // --- screen feedback -------------------------------------------------------
  flash(amount: number, color?: THREE.Color) {
    this.flashAmt = Math.max(this.flashAmt, amount);
    if (color) U.flashColor.value.copy(color);
  }
  exposure(punch: number) {
    this.exposurePunch = Math.max(this.exposurePunch, punch);
  }
  aberration(v: number) {
    this.caAmt = Math.max(this.caAmt, v);
  }
  radialBlur(v: number, center?: THREE.Vector2) {
    this.radial = Math.max(this.radial, v);
    if (center) this.post.radialCenter.value.copy(center);
  }
  hitStop(seconds: number) {
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds);
  }
  slow(scale: number, seconds: number) {
    this.slowMo.scale = Math.min(this.slowMo.scale, scale);
    this.slowMo.timer = Math.max(this.slowMo.timer, seconds);
  }
  shake(v: number) {
    this.cam.addTrauma(v);
  }
  scorchMark(pos: THREE.Vector3, radius: number, amount = 1) {
    this.scorch = { x: pos.x, z: pos.z, r: radius, a: amount };
  }

  /** Time scale to apply to the game (hit-stop / slow motion); call with real dt. */
  timeScale(realDt: number) {
    let s = 1;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= realDt;
      s = 0.03;
    }
    if (this.slowMo.timer > 0) {
      this.slowMo.timer -= realDt;
      s = Math.min(s, this.slowMo.scale);
      if (this.slowMo.timer <= 0) this.slowMo.scale = 1;
    }
    return s;
  }

  update(dt: number, realDt: number) {
    this.p.update(dt);
    this.fx.update(dt);
    this.trail.update(dt);
    const k = Math.exp(-realDt * 7);
    this.flashAmt *= Math.exp(-realDt * 9);
    this.exposurePunch *= Math.exp(-realDt * 5);
    this.caAmt *= k;
    this.radial *= Math.exp(-realDt * 6);
    this.desat *= Math.exp(-realDt * 4);
    U.flash.value = this.flashAmt;
    this.post.flash.value = this.flashAmt * 0.6;
    this.post.exposure.value = this.baseExposure * (1 + this.exposurePunch);
    this.post.ca.value = this.caAmt;
    this.post.radialBlur.value = this.radial;
    this.post.desat.value = this.desat;
    this.scorch.a *= Math.exp(-realDt * 0.05);
    U.scorchCenter.value.set(this.scorch.x, this.scorch.z, this.scorch.r, this.scorch.a);
  }
  baseExposure = 1;

  // --- presets -----------------------------------------------------------------
  hitSparks(pos: THREE.Vector3, dir: THREE.Vector3, power = 1, crit = false, color = C(1.0, 0.85, 0.6)) {
    const n = Math.round((crit ? 60 : 28) * power);
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rnd(4, 14) * power).add(rv(8 * power));
      this.p.spawn({ pos: pos.clone(), vel: v, life: rnd(0.2, 0.55), size: rnd(0.025, 0.06), color, colorEnd: C(1.0, 0.35, 0.1), type: PType.Spark, stretch: 0.045, gravity: 9, drag: 2.5, emissive: crit ? 9 : 6 });
    }
    this.p.spawn({ pos: pos.clone(), life: 0.14, size: crit ? 2.4 : 1.4 * power, sizeEnd: crit ? 3.2 : 1.9, color: crit ? C(1, 0.9, 0.7) : C(0.9, 0.95, 1.0), type: PType.Glow, emissive: crit ? 14 : 7 });
    // Dark impact mist.
    for (let i = 0; i < 6 * power; i++) this.p.spawn({ pos: pos.clone().add(rv(0.3)), vel: dir.clone().multiplyScalar(rnd(1, 3)).add(rv(1.2)), life: rnd(0.5, 1.0), size: rnd(0.3, 0.6), sizeEnd: rnd(0.9, 1.6), color: C(0.12, 0.1, 0.14), alpha: 0.55, type: PType.Smoke, drag: 3 });
    this.fx.flashLight(pos, crit ? C(1, 0.85, 0.6) : C(0.8, 0.9, 1.0), crit ? 90 : 40 * power, crit ? 14 : 9, 0.18);
    if (crit) {
      this.fx.shockwave(pos.clone().setY(this.groundFn(pos.x, pos.z)), C(1, 0.8, 0.5), 4, 0.35);
      this.aberration(0.9);
    }
  }

  dust(pos: THREE.Vector3, amount = 1, color = C(0.45, 0.38, 0.3), up = 0.5) {
    const n = Math.round(6 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.p.spawn({ pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3)), vel: new THREE.Vector3(Math.cos(a) * rnd(0.5, 2) * amount, rnd(0.2, 1.2) * up, Math.sin(a) * rnd(0.5, 2) * amount), life: rnd(0.8, 1.8), size: rnd(0.2, 0.4) * Math.sqrt(amount), sizeEnd: rnd(0.8, 1.5) * Math.sqrt(amount), color, alpha: 0.42, type: PType.Smoke, drag: 2.2, turb: 0.6 });
    }
  }

  grassBits(pos: THREE.Vector3, amount = 1) {
    for (let i = 0; i < 5 * amount; i++) this.p.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.2, 0)), vel: new THREE.Vector3(rnd(-1.5, 1.5), rnd(1, 3), rnd(-1.5, 1.5)), life: rnd(0.8, 1.5), size: rnd(0.03, 0.06), color: C(0.2, 0.35, 0.08), type: PType.Petal, gravity: 5, drag: 1.5, spin: rnd(-6, 6), additive: false });
  }

  splash(pos: THREE.Vector3, size = 1) {
    const y = pos.y;
    for (let i = 0; i < 26 * size; i++) {
      const a = Math.random() * Math.PI * 2,
        s = rnd(1, 4) * size;
      this.p.spawn({ pos: new THREE.Vector3(pos.x, y + 0.1, pos.z), vel: new THREE.Vector3(Math.cos(a) * s, rnd(2.5, 6.5) * Math.sqrt(size), Math.sin(a) * s), life: rnd(0.5, 1.1), size: rnd(0.04, 0.1) * size, color: C(0.8, 0.9, 1.0), type: PType.Mote, gravity: 14, drag: 0.5, emissive: 1.6, additive: true });
    }
    for (let i = 0; i < 6 * size; i++) this.p.spawn({ pos: pos.clone().add(rv(0.4 * size)), vel: new THREE.Vector3(rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1)), life: rnd(0.8, 1.6), size: 0.4 * size, sizeEnd: 1.4 * size, color: C(0.85, 0.9, 0.95), alpha: 0.35, type: PType.Smoke, drag: 2 });
    this.fx.shockwave(new THREE.Vector3(pos.x, y + 0.02, pos.z), C(0.35, 0.45, 0.5), 1.5 * size, 0.8);
  }

  feathers(pos: THREE.Vector3, n = 6) {
    for (let i = 0; i < n; i++) this.p.spawn({ pos: pos.clone().add(rv(0.4)), vel: new THREE.Vector3(rnd(-1.5, 1.5), rnd(0.5, 2.5), rnd(-1.5, 1.5)), life: rnd(2, 3.5), size: rnd(0.06, 0.1), color: C(1.0, 0.78, 0.25), type: PType.Feather, gravity: 0.8, drag: 2.5, turb: 1.5, spin: rnd(-3, 3) });
  }

  debris(pos: THREE.Vector3, n = 20, power = 1) {
    for (let i = 0; i < n; i++) this.p.spawn({ pos: pos.clone().add(rv(0.6)), vel: new THREE.Vector3(rnd(-4, 4) * power, rnd(3, 9) * power, rnd(-4, 4) * power), life: rnd(1.0, 2.2), size: rnd(0.05, 0.18) * power, color: C(0.25, 0.22, 0.2), type: PType.Debris, gravity: 18, drag: 0.3, spin: rnd(-8, 8), floor: this.groundFn(pos.x, pos.z) + 0.05 });
    this.dust(pos, 3 * power, C(0.4, 0.36, 0.32), 1.5);
  }

  fire(pos: THREE.Vector3, power = 1) {
    this.fx.fireball(pos, 1.3 * power, 0.8);
    this.fx.dome(pos, C(1, 0.4, 0.1), 5 * power, 0.45, 0.7);
    for (let i = 0; i < 70 * power; i++) this.p.spawn({ pos: pos.clone().add(rv(0.7 * power)), vel: rv(5 * power).add(new THREE.Vector3(0, rnd(1, 5), 0)), life: rnd(0.4, 1.0), size: rnd(0.4, 0.9) * power, sizeEnd: rnd(0.9, 1.6) * power, color: C(1.0, 0.55, 0.12), colorEnd: C(0.6, 0.08, 0.02), type: PType.Flame, drag: 3, turb: 3, emissive: 4 });
    for (let i = 0; i < 40 * power; i++) this.p.spawn({ pos: pos.clone(), vel: rv(10 * power).add(new THREE.Vector3(0, rnd(2, 8), 0)), life: rnd(0.8, 2.2), size: rnd(0.03, 0.06), color: C(1.0, 0.6, 0.2), colorEnd: C(1, 0.2, 0.05), type: PType.Spark, stretch: 0.03, gravity: 4, drag: 1, turb: 2, emissive: 8 });
    for (let i = 0; i < 14 * power; i++) this.p.spawn({ pos: pos.clone().add(rv(1)), vel: new THREE.Vector3(rnd(-1, 1), rnd(1.5, 3.5), rnd(-1, 1)), life: rnd(2, 3.5), size: rnd(0.7, 1.2), sizeEnd: rnd(2.5, 4), color: C(0.12, 0.1, 0.09), alpha: 0.6, type: PType.Smoke, drag: 1.2, turb: 0.8 });
    this.fx.flashLight(pos, C(1.0, 0.5, 0.15), 260 * power, 26, 1.1);
    this.fx.shockwave(new THREE.Vector3(pos.x, this.groundFn(pos.x, pos.z), pos.z), C(1, 0.45, 0.1), 7 * power, 0.6);
    this.scorchMark(pos, 4.5 * power, 1);
    this.exposure(0.12);
    this.shake(0.45 * power);
  }

  thunder(target: THREE.Vector3, bolts = 3, power = 1) {
    const g = this.groundFn(target.x, target.z);
    for (let b = 0; b < bolts; b++) {
      const off = new THREE.Vector3(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5)).multiplyScalar(b === 0 ? 0 : 1);
      const to = target.clone().add(off).setY(g + (b === 0 ? target.y - g : 0));
      const from = to.clone().add(new THREE.Vector3(rnd(-8, 8), 55, rnd(-8, 8)));
      this.fx.lightning(from, to, C(0.75, 0.82, 1.8), 0.28 + b * 0.05, 0.3 * power);
    }
    for (let i = 0; i < 60 * power; i++) this.p.spawn({ pos: target.clone(), vel: rv(12).add(new THREE.Vector3(0, rnd(2, 8), 0)), life: rnd(0.2, 0.6), size: rnd(0.02, 0.05), color: C(0.8, 0.9, 1.0), colorEnd: C(0.4, 0.5, 1.0), type: PType.Spark, stretch: 0.05, gravity: 8, drag: 2, emissive: 12 });
    this.p.spawn({ pos: target.clone(), life: 0.2, size: 5, sizeEnd: 8, color: C(0.8, 0.85, 1.0), type: PType.Glow, emissive: 10 });
    this.fx.flashLight(target.clone().add(new THREE.Vector3(0, 3, 0)), C(0.7, 0.8, 1.2), 900 * power, 60, 0.35);
    this.fx.shockwave(new THREE.Vector3(target.x, g, target.z), C(0.6, 0.75, 1.5), 6 * power, 0.45);
    this.flash(1.2, C(0.8, 0.85, 1.0));
    this.exposure(0.9);
    this.aberration(1.2);
    this.shake(0.7 * power);
    this.scorchMark(target, 3 * power, 1);
    this.dust(target.clone().setY(g), 2.5, C(0.3, 0.3, 0.33), 1);
  }

  blizzard(target: THREE.Vector3, power = 1) {
    const g = this.groundFn(target.x, target.z);
    const base = new THREE.Vector3(target.x, g, target.z);
    this.fx.magicCircle(base, C(0.4, 0.75, 1.4), 4.5 * power, 1.6, { spin: 2 });
    this.fx.iceCluster(base, Math.round(26 * power), 1.3 * power, 1.9, this.groundFn);
    for (let i = 0; i < 50 * power; i++) this.p.spawn({ pos: base.clone().add(new THREE.Vector3(rnd(-3, 3), rnd(0, 4), rnd(-3, 3))), vel: new THREE.Vector3(rnd(-1, 1), rnd(-0.5, 1.5), rnd(-1, 1)), life: rnd(1, 2.2), size: rnd(0.03, 0.07), color: C(0.8, 0.92, 1.0), type: PType.Snow, drag: 1, turb: 2, emissive: 3 });
    for (let i = 0; i < 12 * power; i++) this.p.spawn({ pos: base.clone().add(rv(2).setY(rnd(0, 1))), vel: new THREE.Vector3(rnd(-1.5, 1.5), rnd(0.2, 0.8), rnd(-1.5, 1.5)), life: rnd(1.5, 2.8), size: rnd(0.8, 1.4), sizeEnd: rnd(2.5, 3.5), color: C(0.7, 0.85, 0.95), alpha: 0.35, type: PType.Smoke, drag: 1.5 });
    this.fx.flashLight(base.clone().add(new THREE.Vector3(0, 2, 0)), C(0.4, 0.7, 1.2), 160 * power, 18, 1.4);
    this.shake(0.35);
  }

  iceShatter(pos: THREE.Vector3, power = 1) {
    for (let i = 0; i < 50 * power; i++) this.p.spawn({ pos: pos.clone().add(rv(1.2)), vel: rv(7).add(new THREE.Vector3(0, rnd(2, 6), 0)), life: rnd(0.6, 1.4), size: rnd(0.06, 0.18), color: C(0.7, 0.9, 1.2), type: PType.Shard, gravity: 14, drag: 0.8, spin: rnd(-10, 10), emissive: 2.5, additive: true });
    this.fx.dome(pos, C(0.5, 0.8, 1.4), 3.5 * power, 0.35, 1.5);
  }

  cure(pos: THREE.Vector3) {
    this.fx.pillar(pos.clone().setY(this.groundFn(pos.x, pos.z)), C(0.35, 1.0, 0.55), 1.3, 5, 1.6, 2);
    this.fx.magicCircle(pos.clone().setY(this.groundFn(pos.x, pos.z)), C(0.4, 1.0, 0.6), 2.2, 1.6, { spin: -1.5 });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 8;
      const r = 0.9;
      this.p.spawn({ pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * r, (i / 60) * 0.5 - 0.8, Math.sin(a) * r)), vel: new THREE.Vector3(0, rnd(1.5, 3), 0), life: rnd(0.9, 1.6), size: rnd(0.04, 0.09), color: C(0.6, 1.0, 0.7), type: PType.Mote, drag: 0.5, orbit: { center: pos.clone(), speed: 2.2, pull: 0.1 }, emissive: 4 });
    }
    this.fx.flashLight(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), C(0.4, 1.0, 0.6), 80, 10, 1.4);
  }

  lifestream(pos: THREE.Vector3, count = 40, radius = 1.2) {
    for (let i = 0; i < count; i++) this.p.spawn({ pos: pos.clone().add(new THREE.Vector3(rnd(-radius, radius), rnd(0, radius), rnd(-radius, radius))), vel: new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.8, 2.4), rnd(-0.3, 0.3)), life: rnd(1.5, 3.5), size: rnd(0.04, 0.12), color: C(0.4, 1.0, 0.75), colorEnd: C(0.3, 0.7, 1.0), type: PType.Mote, turb: 1.2, drag: 0.4, emissive: 5 });
  }

  limitAura(center: THREE.Vector3, intensity = 1) {
    const n = Math.round(4 * intensity);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        r = rnd(1.2, 2.6);
      this.p.spawn({ pos: center.clone().add(new THREE.Vector3(Math.cos(a) * r, rnd(-0.2, 2.2), Math.sin(a) * r)), vel: new THREE.Vector3(0, rnd(0.2, 1.4), 0), life: rnd(1.0, 2.0), size: rnd(0.03, 0.08), color: C(0.6, 0.85, 1.0), colorEnd: C(1.0, 0.5, 0.8), type: PType.Mote, orbit: { center, speed: 3.5 * intensity, pull: 0.5 }, emissive: 6 });
    }
  }

  /** Spawn along a sword blade (limit glow / energy slash). */
  bladeEmbers(a: THREE.Vector3, b: THREE.Vector3, color = C(0.6, 0.85, 1.0), n = 3) {
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, Math.random());
      this.p.spawn({ pos: p, vel: rv(0.6).add(new THREE.Vector3(0, 0.6, 0)), life: rnd(0.3, 0.7), size: rnd(0.02, 0.05), color, type: PType.Mote, emissive: 6, drag: 1 });
    }
  }
}
