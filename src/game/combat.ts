// Real-time combat: combo chains with input buffering, heavy charge, dodge
// i-frames, blade sweep hit detection, crits/misses, elements, stagger, ATB,
// MP, Limit gauge and materia spells. Feedback is layered: animation, VFX,
// SFX, hit-stop, camera shake, flashes and damage numbers.
import * as THREE from 'three/webgpu';
import type { Player } from './player';
import type { VFX } from '../vfx/vfx';
import type { HUD } from '../ui/hud';
import type { GameCamera } from './camera';
import type { Input } from '../core/input';
import { clamp, damp, wrapAngle } from '../core/math';
import { swordGlow } from '../characters/sword';
import { PType } from '../vfx/particles';

export type Element = 'none' | 'fire' | 'thunder' | 'ice';

export interface HitInfo {
  damage: number;
  crit: boolean;
  element: Element;
  stagger: number; // stagger build 0..1
  knock: number;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  heavy: boolean;
}

export interface HitResult {
  landed: boolean; // false = miss/evaded
  damage: number;
  weak: boolean;
  staggeredNow: boolean;
}

export interface Target {
  name: string;
  hp: number;
  maxHp: number;
  stagger: number;
  staggered: boolean;
  alive: boolean;
  weakness: Element;
  position: THREE.Vector3;
  radius: number;
  hurtSpheres(): { c: THREE.Vector3; r: number }[];
  lockPoint(): THREE.Vector3;
  takeHit(h: HitInfo): HitResult;
  /** Minimum HP the target may be reduced to (bosses clamp before the finale). */
  hpFloor?: number;
}

const COMBO = ['light1', 'light2', 'light3', 'light4'];
const COMBO_DMG = [1.0, 1.05, 1.35, 1.9];
const COMBO_STAGGER = [0.035, 0.04, 0.06, 0.11];

export const MATERIA = [
  { key: '1', name: 'Fire', color: '#ff6a3c', mp: 12, element: 'fire' as Element },
  { key: '2', name: 'Thunder', color: '#ffe44a', mp: 16, element: 'thunder' as Element },
  { key: '3', name: 'Blizzard', color: '#7fd4ff', mp: 14, element: 'ice' as Element },
  { key: '4', name: 'Cure', color: '#6dff9a', mp: 20, element: 'none' as Element },
];

export interface CombatSound {
  play(name: string, opts?: any): void;
}

export class PlayerCombat {
  hp = 1520;
  maxHp = 1520;
  mp = 180;
  maxMp = 180;
  atb = 1;
  limit = 0;
  str = 118;
  magic = 84;
  targets: Target[] = [];
  lock: Target | null = null;
  lockOn = false;
  active = false; // in a fight
  private combo = 0;
  private comboWindow = 0;
  private buffered: 'light' | 'heavy' | null = null;
  private hitSet = new Set<Target>();
  private swinging = false;
  private swingPower = 1;
  private currentAttack = '';
  private heavyCharge = -1;
  iframe = 0;
  private hurtCooldown = 0;
  private prevTip = new THREE.Vector3();
  private prevBase = new THREE.Vector3();
  private stepBoost = 0;
  private stepDir = new THREE.Vector3();
  limitReady = false;
  onLimit?: () => void;
  onPlayerDown?: () => void;
  /** Multiplier for how fast the limit gauge fills (boss phase 2 raises it). */
  limitRate = 1;
  private castTarget: THREE.Vector3 | null = null;
  private pendingSpell: number = -1;
  private delayed: { t: number; fn: () => void }[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    private player: Player,
    private vfx: VFX,
    private hud: HUD,
    private cam: GameCamera,
    private sfx: CombatSound,
  ) {}

  get cloud() {
    return this.player.cloud;
  }

  swordSegment(base: THREE.Vector3, tip: THREE.Vector3) {
    const s = this.cloud.model.sword;
    s.updateMatrixWorld(true);
    base.set(0, 0.22, 0).applyMatrix4(s.matrixWorld);
    tip.set(0, 1.72, 0).applyMatrix4(s.matrixWorld);
  }

  // ---------------------------------------------------------------------------
  update(dt: number, input: Input) {
    this.delayed = this.delayed.filter((d) => {
      d.t -= dt;
      if (d.t <= 0) {
        d.fn();
        return false;
      }
      return true;
    });
    this.iframe = Math.max(0, this.iframe - dt);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (!this.active) {
      this.lock = null;
      swordGlow.value = damp(swordGlow.value, 0, 3, dt);
      return;
    }
    const cloud = this.cloud;
    const alive = this.targets.filter((t) => t.alive);
    // Lock-on: toggle, auto-pick nearest.
    if (input.wasPressed('KeyQ') || input.wasPressed('Mouse1') && false) this.lockOn = !this.lockOn;
    if (!this.lock || !this.lock.alive) this.lock = this.nearest(alive, 40);
    this.cam.lockTarget = this.lockOn && this.lock ? this.lock.lockPoint() : null;
    this.player.faceYaw = this.lock && (this.lockOn || this.swinging) ? this.yawTo(this.lock.position) : null;

    // ATB fills over time.
    this.atb = Math.min(2, this.atb + dt * 0.12);
    this.comboWindow -= dt;
    if (this.comboWindow < 0 && !cloud.busy) this.combo = 0;

    const busy = cloud.busy;
    // --- inputs ---------------------------------------------------------------
    if (input.wasPressed('Mouse0')) {
      if (busy) this.buffered = 'light';
      else this.lightAttack();
    }
    if (input.wasPressed('Mouse2') && !busy) this.heavyCharge = 0;
    if (this.heavyCharge >= 0) {
      this.heavyCharge += dt;
      swordGlow.value = Math.min(0.6, this.heavyCharge * 0.8);
      if (Math.random() < dt * 30) {
        this.swordSegment(this.prevBase, this.prevTip);
        this.vfx.bladeEmbers(this.prevBase, this.prevTip, new THREE.Color(1.0, 0.8, 0.5), 2);
      }
      if (input.wasReleased('Mouse2') || !input.isDown('Mouse2') || this.heavyCharge > 1.2) {
        this.heavyAttack(clamp(this.heavyCharge / 0.8, 0.4, 1.4));
        this.heavyCharge = -1;
      }
    }
    if (input.wasPressed('Space')) this.dodge(input);
    for (let i = 0; i < 4; i++) if (input.wasPressed('Digit' + (i + 1))) this.cast(i);
    if (input.wasPressed('KeyR') && this.limit >= 1 && !busy) {
      this.onLimit?.();
    }
    if (!busy && this.buffered) {
      const b = this.buffered;
      this.buffered = null;
      if (b === 'light') this.lightAttack();
    }

    // --- active sword sweep -----------------------------------------------------
    if (this.swinging) this.sweep();
    else this.vfx.trail.update(0);
    if (swordGlow.value > 0 && this.heavyCharge < 0 && !this.limitReady) swordGlow.value = damp(swordGlow.value, 0, 4, dt);
    this.limitReady = this.limit >= 1;
  }

  private impulse(v: number) {
    this.player.cloudVel.copy(this.stepDir).multiplyScalar(v);
  }

  private yawTo(p: THREE.Vector3) {
    const c = this.player.cloudPos;
    return Math.atan2(p.x - c.x, p.z - c.z);
  }

  private nearest(list: Target[], maxD: number) {
    let best: Target | null = null,
      bd = maxD;
    for (const t of list) {
      const d = t.position.distanceTo(this.player.cloudPos) - t.radius;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Snap facing + lunge toward the target so attacks connect responsively. */
  private assist(range: number, lunge: number) {
    const t = this.lock ?? this.nearest(this.targets.filter((x) => x.alive), 9);
    if (!t) return;
    const yaw = this.yawTo(t.position);
    this.player.cloudHeading = yaw;
    const d = t.position.distanceTo(this.player.cloudPos) - t.radius;
    if (d > 1.2 && d < range) {
      this.stepDir.set(Math.sin(yaw), 0, Math.cos(yaw));
      this.impulse(Math.min(lunge, (d - 1.0) * 7));
    }
  }

  private lightAttack() {
    const i = this.combo % COMBO.length;
    this.combo++;
    this.comboWindow = 0.9;
    this.currentAttack = COMBO[i];
    this.assist(7, 9 + i * 2);
    this.beginSwing(COMBO_DMG[i], COMBO_STAGGER[i], i === 3);
    this.cloud.play(COMBO[i], {
      speed: 1.18,
      onEvent: (e) => this.swingEvent(e, i === 3 ? 'swing_heavy' : 'swing_light', i),
    });
    if (i === 3) this.combo = 0;
  }

  private heavyAttack(power: number) {
    this.currentAttack = 'heavy';
    this.assist(8, 12);
    this.beginSwing(2.6 * power, 0.22 * power, true);
    this.swingPower = power;
    this.cloud.play('heavy', {
      speed: 1.12,
      onEvent: (e) => {
        this.swingEvent(e, 'swing_heavy', 5);
        if (e === 'impact') this.groundImpact(power);
      },
    });
    this.combo = 0;
  }

  private beginSwing(dmgMul: number, stag: number, heavy: boolean) {
    this.hitSet.clear();
    this.swingMul = dmgMul;
    this.swingStagger = stag;
    this.swingHeavy = heavy;
  }
  private swingMul = 1;
  private swingStagger = 0.05;
  private swingHeavy = false;

  private swingEvent(e: string, whoosh: string, idx: number) {
    if (e === 'trailOn') {
      this.swinging = true;
      this.swordSegment(this.prevBase, this.prevTip);
      this.sfx.play(whoosh, { position: this.player.cloudPos, intensity: this.swingHeavy ? 1 : 0.6 + idx * 0.1 });
    }
    if (e === 'trailOff') this.swinging = false;
    if (e === 'step') {
      const y = this.player.cloudHeading;
      this.stepDir.set(Math.sin(y), 0, Math.cos(y));
      if (this.player.cloudVel.length() < 4) this.impulse(5);
    }
  }

  private sweep() {
    const base = new THREE.Vector3(),
      tip = new THREE.Vector3();
    this.swordSegment(base, tip);
    // Trail samples (interpolate for fast swings).
    for (let k = 1; k <= 3; k++) {
      const u = k / 3;
      this.vfx.trail.push(this.prevBase.clone().lerp(base, u), this.prevTip.clone().lerp(tip, u));
    }
    if (swordGlow.value > 0.2) this.vfx.bladeEmbers(base, tip);
    // Hit test: blade segments at several interpolation steps vs hurt spheres.
    for (const t of this.targets) {
      if (!t.alive || this.hitSet.has(t)) continue;
      let hitPoint: THREE.Vector3 | null = null;
      outer: for (let k = 0; k <= 4; k++) {
        const u = k / 4;
        const a = this.prevBase.clone().lerp(base, u);
        const b = this.prevTip.clone().lerp(tip, u);
        for (const s of t.hurtSpheres()) {
          const cp = closestOnSegment(a, b, s.c);
          if (cp.distanceTo(s.c) < s.r + 0.18) {
            hitPoint = cp.lerp(s.c, 0.35);
            break outer;
          }
        }
      }
      if (hitPoint) {
        this.hitSet.add(t);
        const dir = tip.clone().sub(this.prevTip).normalize();
        this.landHit(t, hitPoint, dir);
      }
    }
    this.prevBase.copy(base);
    this.prevTip.copy(tip);
  }

  private landHit(t: Target, point: THREE.Vector3, dir: THREE.Vector3) {
    const crit = Math.random() < (this.swingHeavy ? 0.2 : 0.12);
    const base = this.str * 4.2 * this.swingMul * (0.92 + Math.random() * 0.16);
    const dmg = Math.round(base * (crit ? 1.8 : 1) * (t.staggered ? 1.6 : 1));
    const res = t.takeHit({ damage: dmg, crit, element: 'none', stagger: this.swingStagger * (crit ? 1.5 : 1), knock: this.swingHeavy ? 1 : 0.3, point, dir, heavy: this.swingHeavy });
    if (!res.landed) {
      this.hud.number(point, 'Miss', 'miss');
      this.sfx.play('miss_whiff', { position: point });
      return;
    }
    const power = this.swingHeavy ? 1.6 : 1;
    this.vfx.hitSparks(point, dir.clone().add(new THREE.Vector3(0, 0.3, 0)).normalize(), power, crit);
    this.vfx.hitStop(crit ? 0.14 : this.swingHeavy ? 0.1 : 0.055);
    this.vfx.shake(crit ? 0.5 : this.swingHeavy ? 0.42 : 0.22);
    if (crit) this.vfx.flash(0.35, new THREE.Color(1, 0.9, 0.7));
    this.cam.fovKick = crit ? -4 : -1.5;
    this.sfx.play(crit ? 'hit_critical' : 'hit_flesh', { position: point, intensity: power });
    this.hud.number(point, String(res.damage), crit ? 'crit' : '');
    if (crit) this.hud.number(point.clone().add(new THREE.Vector3(0, 0.6, 0)), 'CRITICAL', 'tag');
    if (res.staggeredNow) this.onStagger(t, point);
    this.atb = Math.min(2, this.atb + (this.swingHeavy ? 0.22 : 0.09));
    this.addLimit(0.012 * power);
  }

  onStagger(t: Target, point: THREE.Vector3) {
    this.hud.number(point.clone().add(new THREE.Vector3(0, 1.0, 0)), 'STAGGER!', 'tag');
    this.sfx.play('stagger', { position: point });
    this.vfx.fx.shockwave(t.position.clone(), new THREE.Color(1, 0.5, 0.9), 8, 0.6);
    this.vfx.flash(0.4, new THREE.Color(1, 0.7, 0.9));
    this.vfx.slow(0.35, 0.5);
    this.addLimit(0.08);
  }

  private groundImpact(power: number) {
    const f = new THREE.Vector3(Math.sin(this.player.cloudHeading), 0, Math.cos(this.player.cloudHeading));
    const p = this.player.cloudPos.clone().addScaledVector(f, 1.8);
    p.y = this.vfx.groundFn(p.x, p.z);
    this.vfx.fx.shockwave(p, new THREE.Color(1, 0.75, 0.45), 6 * power, 0.55);
    this.vfx.debris(p, Math.round(26 * power), power);
    this.vfx.shake(0.55 * power);
    this.sfx.play('debris_rumble', { position: p, intensity: power });
    // AoE splash damage.
    for (const t of this.targets) {
      if (!t.alive || this.hitSet.has(t)) continue;
      if (t.position.distanceTo(p) < 3.5 + t.radius) {
        this.hitSet.add(t);
        this.landHit(t, t.lockPoint(), f);
      }
    }
  }

  private dodge(input: Input) {
    const c = this.cloud;
    const cur = c.currentAction();
    if (cur && (cur.clip.name === 'dodge' || cur.clip.name === 'knockdown')) return;
    this.heavyCharge = -1;
    this.swinging = false;
    const ax = input.axis();
    const camYaw = this.cam.yaw;
    let yaw: number;
    if (Math.hypot(ax.x, ax.y) > 0.1) {
      const fx = -Math.sin(camYaw),
        fz = -Math.cos(camYaw);
      yaw = Math.atan2(fx * ax.y + fz * ax.x, fz * ax.y - fx * ax.x);
    } else yaw = this.player.cloudHeading + Math.PI;
    this.player.cloudHeading = yaw;
    this.stepDir.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.impulse(24);
    this.iframe = 0.42;
    c.play('dodge', { speed: 1.25, fadeIn: 0.04 });
    this.sfx.play('dodge_roll', { position: this.player.cloudPos });
    this.vfx.dust(this.player.cloudPos, 1.4);
    this.combo = 0;
  }

  canCast(i: number) {
    return this.active && this.atb >= 1 && this.mp >= MATERIA[i].mp && !(i === 3 && this.hp >= this.maxHp);
  }

  private cast(i: number) {
    if (!this.canCast(i) || this.cloud.busy) return;
    const m = MATERIA[i];
    this.mp -= m.mp;
    this.atb -= 1;
    const t = this.lock ?? this.nearest(this.targets.filter((x) => x.alive), 40);
    if (t) this.player.cloudHeading = this.yawTo(t.position);
    this.castTarget = i === 3 ? null : t ? t.lockPoint() : this.player.cloudPos.clone().add(new THREE.Vector3(Math.sin(this.player.cloudHeading) * 10, 1, Math.cos(this.player.cloudHeading) * 10));
    this.pendingSpell = i;
    const hand = this.cloud.bones['hand.L'];
    this.sfx.play('cast_charge', { position: this.player.cloudPos });
    // Charging glow at the hand.
    const color = new THREE.Color(m.color);
    this.vfx.fx.magicCircle(this.player.cloudPos.clone().setY(this.player.cloudPos.y), color, 1.6, 1.2, { spin: 3 });
    this.vfx.fx.lights.flash(this.player.cloudPos.clone().add(new THREE.Vector3(0, 1.4, 0)), color, 30, 6, 0.9, () => hand.getWorldPosition(this.tmp));
    this.cloud.play('cast', {
      speed: 1.25,
      onEvent: (e) => {
        if (e === 'release') this.releaseSpell(t);
      },
    });
    for (let k = 0; k < 20; k++) this.delayed.push({ t: k * 0.025, fn: () => { hand.getWorldPosition(this.tmp); this.vfx.p.spawn({ pos: this.tmp.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), life: 0.5, size: 0.06, color, type: PType.Mote, emissive: 6, orbit: { center: this.tmp.clone(), speed: 3, pull: 1 } }); } });
  }

  private releaseSpell(t: Target | null) {
    const i = this.pendingSpell;
    this.pendingSpell = -1;
    const hand = new THREE.Vector3();
    this.cloud.bones['hand.L'].getWorldPosition(hand);
    const target = t && t.alive ? t.lockPoint() : this.castTarget ?? hand;
    const spellDmg = (mul: number) => Math.round(this.magic * 9 * mul * (0.9 + Math.random() * 0.2));
    const apply = (el: Element, mul: number, stag: number, radius: number, at: THREE.Vector3) => {
      for (const tg of this.targets) {
        if (!tg.alive || tg.position.distanceTo(at) > radius + tg.radius) continue;
        const weak = tg.weakness === el;
        const dmg = Math.round(spellDmg(mul) * (weak ? 2 : 1) * (tg.staggered ? 1.6 : 1));
        const res = tg.takeHit({ damage: dmg, crit: false, element: el, stagger: stag * (weak ? 2.5 : 1), knock: 0.6, point: tg.lockPoint(), dir: tg.position.clone().sub(this.player.cloudPos).normalize(), heavy: true });
        if (res.landed) {
          this.hud.number(tg.lockPoint(), String(res.damage), weak ? 'crit' : '');
          if (weak) this.hud.number(tg.lockPoint().add(new THREE.Vector3(0, 0.7, 0)), 'WEAKNESS', 'tag');
          if (res.staggeredNow) this.onStagger(tg, tg.lockPoint());
          this.addLimit(0.02);
        }
      }
    };
    if (i === 0) {
      // Fire: a fireball flies from the hand and detonates.
      this.sfx.play('fire_cast', { position: hand });
      const from = hand.clone();
      const flight = Math.max(0.15, from.distanceTo(target) / 32);
      const steps = 14;
      for (let k = 0; k < steps; k++)
        this.delayed.push({
          t: (k / steps) * flight,
          fn: () => {
            const p = from.clone().lerp(target, k / steps);
            p.y += Math.sin((k / steps) * Math.PI) * 0.8;
            this.vfx.p.spawn({ pos: p, vel: new THREE.Vector3(0, 0.5, 0), life: 0.35, size: 0.7, sizeEnd: 0.2, color: [1, 0.55, 0.15], type: PType.Flame, emissive: 5, turb: 2 });
            this.vfx.p.spawn({ pos: p, life: 0.15, size: 0.9, color: [1, 0.6, 0.2], type: PType.Glow, emissive: 6 });
            this.vfx.fx.lights.flash(p, new THREE.Color(1, 0.5, 0.15), 60, 12, 0.2);
          },
        });
      this.delayed.push({
        t: flight,
        fn: () => {
          this.vfx.fire(target, 1);
          this.sfx.play('fire_explode', { position: target });
          apply('fire', 1.4, 0.12, 3.5, target);
        },
      });
    } else if (i === 1) {
      this.sfx.play('thunder_cast', { position: hand });
      this.delayed.push({
        t: 0.25,
        fn: () => {
          this.vfx.thunder(target, 3, 1);
          this.sfx.play('thunder_strike', { position: target });
          apply('thunder', 1.6, 0.14, 3, target);
        },
      });
    } else if (i === 2) {
      this.sfx.play('ice_cast', { position: hand });
      this.delayed.push({ t: 0.1, fn: () => { this.vfx.blizzard(target, 1); this.sfx.play('ice_form', { position: target }); apply('ice', 1.0, 0.1, 3.2, target); } });
      this.delayed.push({ t: 1.6, fn: () => { this.vfx.iceShatter(target, 1); this.sfx.play('ice_shatter', { position: target }); apply('ice', 0.7, 0.08, 3.2, target); } });
    } else if (i === 3) {
      this.sfx.play('cure_cast', { position: this.player.cloudPos });
      const p = this.player.cloudPos.clone().add(new THREE.Vector3(0, 1, 0));
      this.vfx.cure(p);
      const heal = Math.min(this.maxHp - this.hp, 620 + Math.round(Math.random() * 80));
      this.hp += heal;
      this.hud.number(p.clone().add(new THREE.Vector3(0, 0.8, 0)), String(heal), 'heal');
    }
  }

  addLimit(v: number) {
    const before = this.limit;
    this.limit = Math.min(1, this.limit + v * this.limitRate);
    if (before < 1 && this.limit >= 1) {
      this.sfx.play('ui_limit_ready', {});
      this.onLimitReady?.();
    }
  }
  onLimitReady?: () => void;

  /** Enemy hits Cloud. Returns true if damage applied. */
  hurt(dmg: number, from: THREE.Vector3, heavy = false): boolean {
    if (this.iframe > 0 || this.hurtCooldown > 0 || this.hp <= 0) return false;
    const d = Math.round(dmg * (0.9 + Math.random() * 0.2));
    this.hp = Math.max(0, this.hp - d);
    this.hurtCooldown = 0.45;
    const p = this.player.cloudPos.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.hud.number(p, String(d), 'player');
    this.cloud.model.flash.value.setRGB(0.6, 0.15, 0.1);
    this.sfx.play('player_hurt', { position: p, intensity: heavy ? 1 : 0.6 });
    this.vfx.hitSparks(p, p.clone().sub(from).setY(0.2).normalize(), heavy ? 1.2 : 0.7, false, new THREE.Color(1, 0.5, 0.4));
    this.vfx.shake(heavy ? 0.6 : 0.35);
    this.vfx.flash(0.15, new THREE.Color(1, 0.4, 0.3));
    this.addLimit((d / this.maxHp) * 1.5);
    this.swinging = false;
    this.heavyCharge = -1;
    // Knockback.
    const away = this.player.cloudPos.clone().sub(from).setY(0).normalize();
    this.player.cloudVel.addScaledVector(away, heavy ? 9 : 4);
    this.player.cloudHeading = Math.atan2(-away.x, -away.z);
    this.cloud.play(heavy ? 'knockdown' : 'hitLight', { fadeIn: 0.03 });
    if (heavy) this.iframe = 1.4;
    if (this.hp <= 0) this.onPlayerDown?.();
    return true;
  }

  get slotsEnabled() {
    return MATERIA.map((_, i) => this.canCast(i));
  }

  tickVisuals(dt: number) {
    const f = this.cloud.model.flash.value;
    f.r = damp(f.r, 0, 10, dt);
    f.g = damp(f.g, 0, 10, dt);
    f.b = damp(f.b, 0, 10, dt);
    void wrapAngle;
  }
}

export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
  return a.clone().addScaledVector(ab, t);
}
