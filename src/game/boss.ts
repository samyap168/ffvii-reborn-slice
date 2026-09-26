// Elder Zolom boss: emerges from the lake beside the ruins arena. Telegraphed
// tail slam, bite lunge, sweeping breath beam, tidal surge; phase 2 (enraged)
// adds meteor rain, speed and aggression. Implements Target.
import * as THREE from 'three/webgpu';
import { SerpentActor } from '../characters/serpent';
import type { Target, HitInfo, HitResult, Element } from './combat';
import { clamp, damp, lerp, smoothstep } from '../core/math';
import type { Heightfield } from '../world/heightfield';
import { ARENA, LAKE } from '../world/layout';

export type BossPhase = 'dormant' | 'emerging' | 'p1' | 'enraging' | 'p2' | 'finale' | 'dead';
type Attack = 'none' | 'tail' | 'bite' | 'breath' | 'surge' | 'meteor' | 'stagger' | 'recover';

export interface BossHooks {
  sfx(name: string, pos: THREE.Vector3, opts?: any): void;
  playerPos(): THREE.Vector3;
  hurtPlayer(dmg: number, from: THREE.Vector3, heavy: boolean): boolean;
  playerInvuln(): boolean;
  telegraphCircle(pos: THREE.Vector3, radius: number, seconds: number, color: THREE.Color): void;
  telegraphLine(from: THREE.Vector3, to: THREE.Vector3, width: number, seconds: number): void;
  splash(pos: THREE.Vector3, size: number): void;
  slam(pos: THREE.Vector3, power: number): void;
  meteor(target: THREE.Vector3, delay: number, onImpact: () => void): void;
  beam: { set(a: THREE.Vector3, b: THREE.Vector3, r?: number): void; mesh: THREE.Mesh; inten: any };
  breathFx(pos: THREE.Vector3, dir: THREE.Vector3): void;
  shake(v: number): void;
  onEnrage(): void;
  onFinale(): void;
  onStagger(): void;
}

export class ElderZolom implements Target {
  name = 'Elder Zolom';
  maxHp = 42000;
  hp = 42000;
  stagger = 0;
  staggered = false;
  weakness: Element = 'thunder';
  radius = 2.5;
  hpFloor = 0;
  readonly actor: SerpentActor;
  phase: BossPhase = 'dormant';
  alive = true;
  private t = 0;
  private phaseT = 0;
  private attack: Attack = 'none';
  private atkT = 0;
  private cooldown = 2.5;
  private beamOn = false;
  private beamYaw = 0;
  // Head pose state (world).
  readonly headPos = new THREE.Vector3();
  private headTarget = new THREE.Vector3();
  private headLook = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  /** Where the body leaves the water (moves during surge). */
  readonly anchor: THREE.Vector3;
  private anchorTarget = new THREE.Vector3();
  private telegraphed = new THREE.Vector3();
  private hitDone = false;
  private staggerT = 0;
  private enraged = false;
  private speedMul = 1;
  private emergeY = -18;
  private deathT = 0;
  /** Knights of Round: the director drives the head directly. */
  korMode = false;
  readonly korHead = new THREE.Vector3();
  readonly korLook = new THREE.Vector3();
  korJaw = 0.3;
  private reactOff = new THREE.Vector3();
  private reactVel = new THREE.Vector3();
  /** Knock the head in a direction (KoR strikes). */
  react(dir: THREE.Vector3, power: number) {
    this.reactVel.addScaledVector(dir, power * 14);
    this.actor.flash.value.setRGB(1.5 * power, 1.3 * power, 1.1 * power);
  }

  constructor(
    private hf: Heightfield,
    private hooks: BossHooks,
    quality: 'low' | 'high',
  ) {
    this.actor = new SerpentActor(quality);
    const toLake = new THREE.Vector3(LAKE.x - ARENA.x, 0, LAKE.z - ARENA.z).normalize();
    this.anchor = new THREE.Vector3(ARENA.x, 0, ARENA.z).addScaledVector(toLake, ARENA.radius + 12).setY(LAKE.level);
    this.anchorTarget.copy(this.anchor);
    this.headPos.copy(this.anchor).setY(LAKE.level - 20);
    this.headTarget.copy(this.headPos);
    this.headLook.set(ARENA.x, 30, ARENA.z);
    this.actor.root.visible = false;
    this.layout(0);
  }

  get position() {
    return this.actor.headCenter();
  }
  lockPoint() {
    return this.actor.headCenter().add(new THREE.Vector3(0, 0.3, 0));
  }
  hurtSpheres() {
    const out: { c: THREE.Vector3; r: number }[] = [{ c: this.actor.headCenter(), r: 2.9 }, { c: this.actor.mouth(), r: 1.75 }];
    // Neck segments within reach of the plaza.
    for (let i = 2; i < 18; i += 2) out.push({ c: this.actor.segPos[i].clone(), r: 1.9 });
    return out;
  }

  get toArena() {
    return new THREE.Vector3(ARENA.x - this.anchor.x, 0, ARENA.z - this.anchor.z).normalize();
  }

  awaken() {
    if (this.phase !== 'dormant') return;
    this.phase = 'emerging';
    this.phaseT = 0;
    this.actor.root.visible = true;
  }

  takeHit(h: HitInfo): HitResult {
    if (!this.alive || this.phase === 'dormant' || this.phase === 'emerging' || this.phase === 'enraging') return { landed: false, damage: 0, weak: false, staggeredNow: false };
    const floor = this.hpFloor;
    const dmg = Math.min(h.damage, Math.max(0, this.hp - floor));
    this.hp -= dmg;
    const weak = h.element === this.weakness;
    let staggeredNow = false;
    if (!this.staggered) {
      this.stagger = clamp(this.stagger + h.stagger * 0.55 * (weak ? 1.8 : 1), 0, 1);
      if (this.stagger >= 1) {
        this.staggered = true;
        staggeredNow = true;
        this.startAttack('stagger');
        this.hooks.onStagger();
      }
    }
    this.actor.flash.value.setRGB(0.22, 0.2, 0.18);
    this.hooks.sfx(h.heavy ? 'hit_critical' : 'hit_armor', h.point, { intensity: h.heavy ? 1 : 0.7 });
    // Phase checks.
    if (this.phase === 'p1' && this.hp <= this.maxHp * 0.55) this.beginEnrage();
    if (this.phase === 'p2' && this.hp <= this.maxHp * 0.08 + 1) {
      this.hp = Math.max(this.hp, this.maxHp * 0.08);
      this.phase = 'finale';
      this.hooks.onFinale();
    }
    return { landed: true, damage: dmg, weak, staggeredNow };
  }

  private beginEnrage() {
    this.phase = 'enraging';
    this.phaseT = 0;
    this.stopBeam();
    this.attack = 'none';
    this.staggered = false;
    this.stagger = 0;
    this.hooks.onEnrage();
  }

  /** Called by KoR to finish the fight. */
  kill() {
    this.alive = false;
    this.phase = 'dead';
    this.deathT = 0;
    this.hp = 0;
    this.stopBeam();
  }

  private startAttack(a: Attack) {
    this.attack = a;
    this.atkT = 0;
    this.hitDone = false;
    const p = this.hooks.playerPos();
    this.telegraphed.copy(p);
    if (a === 'tail') {
      this.telegraphed.setY(this.hf.height(p.x, p.z));
      this.hooks.telegraphCircle(this.telegraphed, 5.5, 1.35 / this.speedMul, new THREE.Color(1, 0.25, 0.1));
      this.hooks.sfx('boss_hiss', this.actor.headCenter());
    }
    if (a === 'bite') {
      this.hooks.telegraphLine(this.headPos.clone().setY(ARENA.height), p.clone().setY(ARENA.height), 4.5, 0.9 / this.speedMul);
      this.hooks.sfx('boss_roar', this.actor.headCenter(), { intensity: 0.6 });
    }
    if (a === 'breath') {
      this.hooks.sfx('boss_breath_charge', this.actor.headCenter());
      const to = p.clone().sub(this.anchor);
      this.beamYaw = Math.atan2(to.x, to.z) - 0.75;
    }
    if (a === 'surge') this.hooks.sfx('boss_hiss', this.actor.headCenter());
    if (a === 'meteor') {
      this.hooks.sfx('boss_roar', this.actor.headCenter());
      const n = 7;
      for (let i = 0; i < n; i++) {
        const around = i === 0 ? p.clone() : new THREE.Vector3(ARENA.x + (Math.random() - 0.5) * 60, 0, ARENA.z + (Math.random() - 0.5) * 60);
        if (i > 0 && Math.random() < 0.5) around.lerp(p, 0.6);
        around.y = this.hf.height(around.x, around.z);
        const delay = 1.4 + i * 0.35;
        this.hooks.telegraphCircle(around.clone(), 4, delay, new THREE.Color(1, 0.35, 0.1));
        this.hooks.meteor(around.clone(), delay, () => {
          const pp = this.hooks.playerPos();
          if (pp.distanceTo(around) < 4.2) this.hooks.hurtPlayer(360, around, true);
        });
      }
    }
    if (a === 'stagger') this.hooks.sfx('boss_stagger', this.actor.headCenter());
  }

  private stopBeam() {
    if (this.beamOn) {
      this.hooks.sfx('boss_breath_stop', this.actor.mouth());
      this.beamOn = false;
      this.hooks.beam.mesh.visible = false;
    }
  }

  private chooseAttack() {
    const p = this.hooks.playerPos();
    const d = p.distanceTo(this.anchor);
    const r = Math.random();
    if (this.phase === 'p2' && r < 0.25) return this.startAttack('meteor');
    if (d > 36 || r < 0.28) return this.startAttack('breath');
    if (r < 0.58) return this.startAttack('tail');
    if (r < 0.88) return this.startAttack('bite');
    return this.startAttack('surge');
  }

  update(dt: number) {
    this.t += dt;
    this.phaseT += dt;
    const a = this.actor;
    const p = this.hooks.playerPos();
    const arenaCenter = new THREE.Vector3(ARENA.x, ARENA.height, ARENA.z);
    this.lookTarget.copy(p).setY(p.y + 1.2);
    const toA = this.toArena;
    const side = new THREE.Vector3(toA.z, 0, -toA.x);
    // Default hover pose: head raised over the water edge, weaving.
    const weave = Math.sin(this.t * 0.7) * 3 + Math.sin(this.t * 1.7) * 1;
    const hover = this.anchor.clone().addScaledVector(toA, 34).addScaledVector(side, weave).setY(LAKE.level + 16 + Math.sin(this.t * 1.1) * 1.5);
    let jaw = 0.1 + Math.max(0, Math.sin(this.t * 0.8)) * 0.1;
    let headLerp = 2.5;

    if (this.phase === 'dormant') {
      a.root.visible = false;
      return;
    }
    if (this.korMode && this.phase !== 'dead') {
      this.headTarget.copy(this.korHead);
      this.lookTarget.copy(this.korLook);
      jaw = this.korJaw;
      headLerp = 2.2;
      this.stopBeam();
    } else
    if (this.phase === 'emerging') {
      const k = smoothstep(0.6, 3.2, this.phaseT);
      this.emergeY = lerp(-22, 0, k);
      this.headTarget.copy(hover).setY(lerp(LAKE.level - 14, hover.y + 4, smoothstep(0.8, 3.0, this.phaseT)));
      jaw = this.phaseT > 3.0 && this.phaseT < 5.0 ? 0.95 : 0.2;
      this.lookTarget.copy(this.phaseT < 3.4 ? arenaCenter.clone().setY(40) : p);
      headLerp = 3;
      a.frill = smoothstep(3.0, 3.6, this.phaseT);
      if (this.phaseT > 6.2) {
        this.phase = 'p1';
        this.phaseT = 0;
        this.cooldown = 2.0;
      }
    } else if (this.phase === 'enraging') {
      // Recoil, then roar skyward as the storm breaks.
      this.headTarget.copy(this.anchor).addScaledVector(toA, 4).setY(LAKE.level + 18);
      this.lookTarget.copy(this.headTarget).add(new THREE.Vector3(0, 30, 0)).addScaledVector(toA, 6);
      jaw = this.phaseT > 1.0 ? 1 : 0.3;
      a.frill = 1;
      if (this.phaseT > 4.6) {
        this.phase = 'p2';
        this.phaseT = 0;
        this.enraged = true;
        this.speedMul = 1.45;
        this.cooldown = 1.2;
      }
    } else if (this.phase === 'dead') {
      this.deathT += dt;
      const k = smoothstep(0, 4, this.deathT);
      this.headTarget.copy(this.anchor).addScaledVector(toA, 14 * (1 - k) + 6).setY(lerp(hover.y, LAKE.level - 6, k));
      this.lookTarget.copy(this.headTarget).add(new THREE.Vector3(0, -10, 0)).addScaledVector(toA, 10);
      jaw = 0.6;
      a.dissolve.value = clamp((this.deathT - 3) / 4, 0, 1);
      a.veinGlow.value = damp(a.veinGlow.value, 0, 1, dt);
    } else {
      // Combat phases.
      a.frill = damp(a.frill, this.enraged ? 1 : 0.5, 2, dt);
      this.headTarget.copy(hover);
      if (this.attack === 'none') {
        this.cooldown -= dt * this.speedMul;
        if (this.cooldown <= 0 && this.phase !== 'finale') this.chooseAttack();
        if (this.phase === 'finale') {
          this.cooldown -= 0;
          if (Math.random() < dt * 0.25) this.chooseAttack();
        }
      } else {
        this.atkT += dt * this.speedMul;
        const at = this.atkT;
        switch (this.attack) {
          case 'tail': {
            // Head watches; the tail rises from the water then slams (body curve handles the tail).
            if (at > 1.35 && !this.hitDone) {
              this.hitDone = true;
              this.hooks.slam(this.telegraphed, 1.4);
              this.hooks.splash(this.telegraphed.clone().setY(LAKE.level), 2);
              this.hooks.sfx('boss_tail_slam', this.telegraphed);
              if (p.distanceTo(this.telegraphed) < 6) this.hooks.hurtPlayer(this.enraged ? 420 : 330, this.telegraphed, true);
            }
            if (at > 2.4) this.endAttack(1.8);
            break;
          }
          case 'bite': {
            const target = this.telegraphed.clone().setY(ARENA.height + 1.4);
            if (at < 0.9) {
              // Rear back.
              this.headTarget.copy(hover).addScaledVector(toA, -4).setY(hover.y + 4);
              this.lookTarget.copy(target);
              jaw = 0.4 + at * 0.5;
            } else if (at < 1.3) {
              this.headTarget.copy(target);
              headLerp = 12;
              jaw = at < 1.15 ? 1 : 0.1;
              if (!this.hitDone && at > 1.12) {
                this.hitDone = true;
                this.hooks.sfx('boss_bite', target);
                this.hooks.shake(0.4);
                if (p.distanceTo(this.actor.headCenter()) < 5.2) this.hooks.hurtPlayer(this.enraged ? 380 : 300, this.actor.headCenter(), true);
                this.hooks.slam(target.clone().setY(this.hf.height(target.x, target.z)), 0.6);
              }
            } else {
              this.headTarget.copy(target).setY(ARENA.height + 2);
              headLerp = 2;
              // Lingering head: a punish window.
              if (at > 2.8) this.endAttack(1.4);
            }
            break;
          }
          case 'breath': {
            this.headTarget.copy(hover).setY(hover.y + 3);
            const charge = at < 2.0;
            const sweepU = clamp((at - 2.0) / 2.6, 0, 1);
            const yaw = this.beamYaw + sweepU * 1.5;
            const aimDir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            const aim = this.anchor.clone().addScaledVector(aimDir, 30).setY(ARENA.height);
            this.lookTarget.copy(aim);
            jaw = charge ? 0.35 + at * 0.25 : 1;
            if (charge) this.hooks.breathFx(this.actor.mouth(), new THREE.Vector3());
            else if (sweepU < 1) {
              if (!this.beamOn) {
                this.beamOn = true;
                this.hooks.beam.mesh.visible = true;
                this.hooks.sfx('boss_breath_start', this.actor.mouth());
              }
              const m = this.actor.mouth();
              const end = m.clone().add(aim.clone().sub(m).normalize().multiplyScalar(60));
              const g = this.hf.height(end.x, end.z);
              // Clip the beam where it meets the ground.
              const dir = end.clone().sub(m).normalize();
              let len = 60;
              for (let s = 4; s < 60; s += 1.5) {
                const q = m.clone().addScaledVector(dir, s);
                if (q.y < this.hf.height(q.x, q.z)) {
                  len = s;
                  break;
                }
              }
              const e = m.clone().addScaledVector(dir, len);
              void g;
              this.hooks.beam.set(m, e, this.enraged ? 1.5 : 1.1);
              this.hooks.breathFx(e, dir);
              // Damage along the beam's ground sweep.
              const pp = p.clone().setY(p.y + 1);
              const cp = closest(m, e, pp);
              if (cp.distanceTo(pp) < 2.4) this.hooks.hurtPlayer(this.enraged ? 140 : 110, cp, false);
            } else this.stopBeam();
            if (at > 5.0) {
              this.stopBeam();
              this.endAttack(2.0);
            }
            break;
          }
          case 'surge': {
            // Dive and re-emerge at a new spot along the shore.
            if (at < 1.2) this.headTarget.copy(this.anchor).setY(LAKE.level - 10);
            if (at > 1.2 && !this.hitDone) {
              this.hitDone = true;
              const ang = (Math.random() - 0.5) * 1.4;
              const base = new THREE.Vector3(LAKE.x - ARENA.x, 0, LAKE.z - ARENA.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
              this.anchorTarget.set(ARENA.x, LAKE.level, ARENA.z).addScaledVector(base, ARENA.radius + 12);
              this.anchor.copy(this.anchorTarget);
              this.hooks.splash(this.anchor.clone().addScaledVector(this.toArena, 8), 3.5);
              this.hooks.sfx('water_splash_big', this.anchor);
              this.hooks.shake(0.5);
              const near = this.anchor.clone().addScaledVector(this.toArena, 14).setY(ARENA.height);
              if (p.distanceTo(near) < 9) this.hooks.hurtPlayer(this.enraged ? 300 : 240, near, true);
            }
            if (at > 1.2) this.headTarget.copy(hover);
            if (at > 3.0) this.endAttack(1.5);
            break;
          }
          case 'meteor': {
            this.headTarget.copy(hover).setY(hover.y + 6);
            this.lookTarget.copy(hover).add(new THREE.Vector3(0, 40, 0));
            jaw = at < 1.2 ? 1 : 0.3;
            if (at > 4.5) this.endAttack(2.0);
            break;
          }
          case 'stagger': {
            // Head crashes onto the plaza: free hits.
            this.stopBeam();
            const rest = this.anchor.clone().addScaledVector(toA, 22).setY(ARENA.height + 1.6);
            this.headTarget.copy(rest);
            headLerp = at < 0.6 ? 6 : 2;
            this.lookTarget.copy(rest).addScaledVector(toA, 6).setY(ARENA.height - 1);
            jaw = 0.5 + Math.sin(this.t * 2) * 0.1;
            if (at > 0.5 && !this.hitDone) {
              this.hitDone = true;
              this.hooks.slam(rest.clone().setY(ARENA.height), 1.2);
              this.hooks.sfx('boss_quake', rest);
            }
            this.staggerT = at;
            if (at > 7) {
              this.staggered = false;
              this.stagger = 0;
              this.endAttack(1.0);
            }
            break;
          }
        }
      }
    }
    // Smooth head motion + strike reactions (spring).
    const k = 1 - Math.exp(-dt * headLerp * (this.enraged ? 1.3 : 1));
    this.headPos.lerp(this.headTarget, k);
    this.reactVel.addScaledVector(this.reactOff, -40 * dt);
    this.reactVel.multiplyScalar(Math.exp(-dt * 5));
    this.reactOff.addScaledVector(this.reactVel, dt);
    this.headPos.add(this.reactOff.clone().multiplyScalar(dt * 8));
    this.headLook.lerp(this.lookTarget, 1 - Math.exp(-dt * 4));
    a.jawOpen = damp(a.jawOpen, jaw, 10, dt);
    this.layout(dt);
    // Vein colour/glow by phase.
    const enr = this.enraged || this.phase === 'enraging' ? 1 : 0;
    a.veinColor.value.lerp(enr ? new THREE.Color(1.0, 0.18, 0.05) : new THREE.Color(0.2, 0.9, 1.0), 1 - Math.exp(-dt * 1.5));
    if (this.phase !== 'dead') a.veinGlow.value = damp(a.veinGlow.value, enr ? 1.6 : 0.8, 2, dt);
    a.update(dt);
  }

  private endAttack(cool: number) {
    this.attack = 'none';
    this.cooldown = cool;
    this.stopBeam();
  }

  /** Lay out the body curve from the head back into the lake, with coils. */
  private layout(dt: number) {
    const a = this.actor;
    const toA = this.toArena;
    const side = new THREE.Vector3(toA.z, 0, -toA.x);
    const out = toA.clone().negate();
    const head = this.headPos;
    const w = this.t;
    const neckBack = head.clone().addScaledVector(out, 7).setY(head.y - 3.5);
    const water = this.anchor.clone().addScaledVector(side, Math.sin(w * 0.5) * 2).setY(LAKE.level - 1 + this.emergeY * 0.3);
    const dip = this.anchor.clone().addScaledVector(out, 11).addScaledVector(side, 4 + Math.sin(w * 0.4) * 2).setY(LAKE.level - 5 + this.emergeY * 0.3);
    // Tail hump: rises high during a tail slam telegraph, then crashes on the target.
    let hump = this.anchor.clone().addScaledVector(out, 20).addScaledVector(side, -3).setY(LAKE.level + 2.5 + Math.sin(w * 0.9) * 1.5 + this.emergeY * 0.4);
    let tail = this.anchor.clone().addScaledVector(out, 32).addScaledVector(side, -6).setY(LAKE.level - 5);
    if (this.attack === 'tail') {
      const at = this.atkT;
      const rise = smoothstep(0.0, 1.0, at) * (1 - smoothstep(1.25, 1.4, at));
      const slam = smoothstep(1.2, 1.4, at) * (1 - smoothstep(2.0, 2.4, at));
      const tgt = this.telegraphed;
      hump = hump.clone().lerp(this.anchor.clone().addScaledVector(toA, 6).setY(LAKE.level + 16), rise).lerp(this.anchor.clone().addScaledVector(toA, 8).setY(LAKE.level + 6), slam);
      tail = tail.clone().lerp(hump.clone().add(new THREE.Vector3(0, 6, 0)), rise).lerp(tgt.clone().setY(tgt.y + 0.5), slam);
    }
    const pts = [head, neckBack, water, dip, hump, tail, tail.clone().addScaledVector(out, 4).setY(LAKE.level - 8)];
    pts.forEach((p, i) => a.curvePts[i].copy(p));
    a.headDir.copy(this.headLook).sub(head).normalize();
    void dt;
  }
}

function closest(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return a.clone().addScaledVector(ab, t);
}
