// Ruinfang field monster AI: grazes, notices Cloud, looks, reacts, roars, then
// fights with telegraphed bites, tentacle whips and pounces. Implements Target.
import * as THREE from 'three/webgpu';
import { MonsterActor, type MonsterState } from '../characters/monster';
import type { Target, HitInfo, HitResult, Element } from './combat';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math';
import type { Heightfield } from '../world/heightfield';
import type { ColliderGrid } from './colliders';

export type Awareness = 'unaware' | 'noticed' | 'hostile' | 'dead';

export interface EnemyHooks {
  sfx(name: string, pos: THREE.Vector3, opts?: any): void;
  attackPlayer(dmg: number, from: THREE.Vector3, heavy: boolean, shape: { center: THREE.Vector3; radius: number }): void;
  footstep(pos: THREE.Vector3, power: number): void;
  onNotice(e: Ruinfang): void;
  onRoar(e: Ruinfang): void;
  onDeath(e: Ruinfang): void;
  vfxDissolve(pos: THREE.Vector3): void;
  vfxSlam(pos: THREE.Vector3, power: number): void;
}

export class Ruinfang implements Target {
  name = 'Ruinfang';
  maxHp = 3600;
  hp = 3600;
  stagger = 0;
  staggered = false;
  weakness: Element = 'fire';
  radius = 1.3;
  readonly actor: MonsterActor;
  awareness: Awareness = 'unaware';
  heading: number;
  private home: THREE.Vector3;
  private wanderTarget = new THREE.Vector3();
  private stateLock = 0; // seconds until AI may choose again
  private cooldown = 1.5;
  private circleDir = 1;
  private staggerTimer = 0;
  private dissolveT = 0;
  private attackCommitted = '';
  private lungeVel = 0;
  playerPos = new THREE.Vector3();
  playerDist = 999;
  enraged = false;

  constructor(
    private hf: Heightfield,
    private grid: ColliderGrid,
    private hooks: EnemyHooks,
    pos: THREE.Vector3,
    heading: number,
    quality: 'low' | 'high',
  ) {
    this.actor = new MonsterActor(quality);
    this.actor.groundFn = (x, z) => this.hf.height(x, z);
    this.home = pos.clone();
    this.heading = heading;
    this.actor.root.position.copy(pos).setY(hf.height(pos.x, pos.z));
    this.actor.root.rotation.y = heading;
    this.actor.setState('graze');
    this.actor.onEvent = (e, p) => this.onActorEvent(e, p);
    this.wanderTarget.copy(pos);
  }

  get alive() {
    return this.awareness !== 'dead';
  }
  get position() {
    return this.actor.root.position;
  }
  hurtSpheres() {
    return this.actor.hurtSpheres();
  }
  lockPoint() {
    return this.actor.point('chest').clone();
  }

  private set(s: MonsterState) {
    this.actor.setState(s);
    if (['roar', 'bite', 'whip', 'pounce', 'hit', 'teleBite', 'teleWhip', 'telePounce', 'death'].includes(s)) this.stateLock = this.actor.stateDuration(s);
  }

  takeHit(h: HitInfo): HitResult {
    if (!this.alive) return { landed: false, damage: 0, weak: false, staggeredNow: false };
    // Evasive hop: small chance to dodge light hits while circling.
    const st = this.actor.state;
    if (!h.heavy && !this.staggered && st === 'stalk' && Math.random() < 0.18) {
      this.lungeVel = -6;
      return { landed: false, damage: 0, weak: false, staggeredNow: false };
    }
    if (this.awareness !== 'hostile') this.becomeHostile(false);
    const floor = (this as any).hpFloor ?? 0;
    const dmg = Math.min(h.damage, Math.max(0, this.hp - floor));
    this.hp -= dmg;
    const weak = h.element !== 'none' && h.element === this.weakness;
    let staggeredNow = false;
    if (!this.staggered) {
      this.stagger = clamp(this.stagger + h.stagger * (weak ? 1.6 : 1), 0, 1);
      if (this.stagger >= 1) {
        this.staggered = true;
        this.staggerTimer = 5;
        staggeredNow = true;
        this.set('stagger');
        this.attackCommitted = '';
      }
    }
    this.actor.flash.value.setRGB(1.2, 1.0, 0.9);
    // Flinch unless mid-attack (heavy hits interrupt telegraphs).
    if (!this.staggered && (h.heavy || !['bite', 'whip', 'pounce'].includes(st)) && !st.startsWith('tele')) this.set('hit');
    else if (h.heavy && st.startsWith('tele')) this.set('hit');
    this.lungeVel = -h.knock * 5;
    this.hooks.sfx(h.heavy ? 'enemy_hurt' : 'hit_flesh', h.point, { intensity: h.heavy ? 1 : 0.6 });
    if (this.hp <= 0) this.die();
    return { landed: true, damage: dmg, weak, staggeredNow };
  }

  private die() {
    this.awareness = 'dead';
    this.set('death');
    this.hooks.sfx('enemy_death', this.position);
    this.hooks.onDeath(this);
  }

  /** Player charged in: skip straight to the roar. */
  provoke() {
    if (this.awareness === 'unaware' || this.awareness === 'noticed') this.becomeHostile(true);
  }

  private becomeHostile(roar: boolean) {
    this.awareness = 'hostile';
    if (roar) {
      this.set('roar');
      this.hooks.onRoar(this);
    }
  }

  private onActorEvent(e: string, p: THREE.Vector3) {
    if (e === 'step') this.hooks.footstep(p, this.actor.speed > 6 ? 1 : 0.5);
    if (e === 'roarPeak') this.hooks.sfx('enemy_roar', this.actor.point('head'));
    if (e === 'biteHit') this.hooks.attackPlayer(this.enraged ? 190 : 150, this.position, false, { center: this.actor.point('jaw'), radius: 1.9 });
    if (e === 'whipHit') {
      this.hooks.sfx('enemy_attack_swipe', this.actor.point('chest'));
      for (const t of ['tentacleL', 'tentacleR'] as const) this.hooks.attackPlayer(this.enraged ? 170 : 130, this.position, false, { center: this.actor.point(t), radius: 2.1 });
    }
    if (e === 'pounceLand') {
      this.hooks.vfxSlam(this.actor.point('chest').setY(this.hf.height(this.position.x, this.position.z)), 1);
      this.hooks.attackPlayer(this.enraged ? 260 : 210, this.position, true, { center: this.actor.point('chest'), radius: 2.8 });
    }
    if (e === 'collapse') this.hooks.vfxSlam(this.position.clone(), 0.8);
  }

  update(dt: number, playerPos: THREE.Vector3, playerMounted: boolean) {
    const a = this.actor;
    this.playerPos.copy(playerPos);
    const toP = playerPos.clone().sub(this.position).setY(0);
    const d = toP.length();
    this.playerDist = d;
    const yawToP = Math.atan2(toP.x, toP.z);
    this.stateLock -= dt;
    this.cooldown -= dt;
    a.flash.value.multiplyScalar(Math.exp(-dt * 12));
    let wantSpeed = 0;
    let faceYaw: number | null = null;

    if (this.awareness === 'dead') {
      if (a.stateTime > 2.4) {
        this.dissolveT += dt / 2.5;
        a.dissolve = clamp(this.dissolveT, 0, 1);
        if (Math.random() < dt * 30 && a.dissolve < 1) this.hooks.vfxDissolve(this.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 1.2, (Math.random() - 0.5) * 2.5)));
      }
      a.speed = 0;
      a.update(dt);
      return;
    }

    if (this.awareness === 'unaware') {
      // Graze and wander slowly around home.
      if (a.state !== 'graze' && a.state !== 'stalk') this.set('graze');
      if (this.wanderTarget.distanceTo(this.position) < 1.5 || a.stateTime > 14) {
        const ang = Math.random() * Math.PI * 2;
        this.wanderTarget.copy(this.home).add(new THREE.Vector3(Math.cos(ang) * 10, 0, Math.sin(ang) * 10));
        this.set(Math.random() < 0.6 ? 'graze' : 'stalk');
      }
      if (a.state === 'stalk') {
        const w = this.wanderTarget.clone().sub(this.position);
        faceYaw = Math.atan2(w.x, w.z);
        wantSpeed = 1.6;
      }
      // Detection: sight cone at range, or very close.
      const fwdDot = Math.cos(wrapAngle(yawToP - this.heading));
      const noticeR = playerMounted ? 60 : 38;
      const hearR = playerMounted ? 36 : 16; // a galloping chocobo is heard from any side
      if ((d < noticeR && fwdDot > -0.2) || d < hearR) {
        this.awareness = 'noticed';
        this.set('alert');
        this.hooks.onNotice(this);
      }
      a.lookTarget = null;
    } else if (this.awareness === 'noticed') {
      // Head snaps up, stares; roars when the player keeps coming.
      a.lookTarget = playerPos.clone().setY(playerPos.y + 1.5);
      faceYaw = yawToP;
      if (a.stateTime > 1.6 && (d < 42 || a.stateTime > 4.5)) this.becomeHostile(true);
      if (d > 90) {
        this.awareness = 'unaware';
        this.set('graze');
      }
    } else {
      // Hostile.
      a.lookTarget = playerPos.clone().setY(playerPos.y + 1.2);
      if (this.staggered) {
        this.staggerTimer -= dt;
        if (this.staggerTimer <= 0) {
          this.staggered = false;
          this.stagger = 0;
          this.set('idle');
          this.stateLock = 0.4;
        }
      } else if (this.stateLock <= 0) {
        this.stagger = Math.max(0, this.stagger - dt * 0.02);
        const st = a.state;
        // Chain telegraphs into their attacks.
        if (st === 'teleBite') {
          this.set('bite');
          this.lungeVel = clamp(d * 3.2, 6, 16);
          faceYaw = yawToP;
        } else if (st === 'teleWhip') this.set('whip');
        else if (st === 'telePounce') {
          this.set('pounce');
          this.lungeVel = clamp(d * 1.6, 6, 14);
        } else if (this.cooldown <= 0 && d < 9.5) {
          const r = Math.random();
          if (d < 3.8) this.set(r < 0.55 ? 'teleBite' : 'teleWhip');
          else if (d < 6.5) this.set(r < 0.5 ? 'teleWhip' : r < 0.8 ? 'teleBite' : 'telePounce');
          else this.set('telePounce');
          this.cooldown = (this.enraged ? 1.0 : 1.8) + Math.random() * 1.2;
          this.hooks.sfx('enemy_growl', this.actor.point('head'));
        } else if (d > 11) {
          if (st !== 'run') this.set('run');
          wantSpeed = 10.5;
          faceYaw = yawToP;
        } else {
          if (st !== 'stalk') {
            this.set('stalk');
            this.circleDir = Math.random() < 0.5 ? 1 : -1;
          }
          // Circle at mid range, drift inward.
          const tang = yawToP + (Math.PI / 2) * this.circleDir;
          faceYaw = yawToP;
          const drift = d > 6 ? 0.8 : -0.2;
          const mv = new THREE.Vector3(Math.sin(tang), 0, Math.cos(tang)).multiplyScalar(2.8).addScaledVector(toP.clone().normalize(), drift * 2.5);
          this.moveBy(mv, dt);
          wantSpeed = 3.2;
          if (a.stateTime > 2.5 && Math.random() < dt) this.circleDir *= -1;
        }
      }
      if (a.state.startsWith('tele')) faceYaw = yawToP;
    }

    // Root motion: lunges and knockback.
    if (Math.abs(this.lungeVel) > 0.05) {
      const dir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      // Don't lunge through the player.
      const allow = this.lungeVel < 0 || d > 1.8;
      if (allow) this.moveBy(dir.multiplyScalar(this.lungeVel), dt);
      this.lungeVel = damp(this.lungeVel, 0, 5, dt);
    }
    if (faceYaw !== null) this.heading = dampAngle(this.heading, faceYaw, a.state.startsWith('tele') ? 6 : 4, dt);
    if (wantSpeed > 0 && a.state !== 'stalk') {
      const dir = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      this.moveBy(dir.multiplyScalar(wantSpeed), dt);
    }
    a.speed = damp(a.speed, wantSpeed, 6, dt);
    a.turnRate = 0;
    this.position.y = damp(this.position.y, this.hf.height(this.position.x, this.position.z), 20, dt);
    a.root.rotation.y = this.heading;
    a.glow.value = damp(a.glow.value, this.awareness === 'hostile' ? (this.enraged ? 1.8 : 1.2) : 0.6, 2, dt);
    a.update(dt);
  }

  private moveBy(v: THREE.Vector3, dt: number) {
    const nx = this.position.x + v.x * dt,
      nz = this.position.z + v.z * dt;
    const r = this.grid.resolve(nx, nz, 1.0);
    // Keep a little distance from the player body.
    const pd = Math.hypot(r.x - this.playerPos.x, r.z - this.playerPos.z);
    if (pd < 1.4) return;
    this.position.x = r.x;
    this.position.z = r.z;
  }
}
