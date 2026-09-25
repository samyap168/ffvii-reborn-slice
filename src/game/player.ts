// Player: Cloud on foot or riding the Golden Chocobo.
import * as THREE from 'three/webgpu';
import { CloudActor } from '../characters/cloudActor';
import { ChocoboActor } from '../characters/chocobo';
import { damp, dampAngle, clamp, wrapAngle } from '../core/math';
import type { Input } from '../core/input';
import type { Heightfield } from '../world/heightfield';
import type { ColliderGrid } from './colliders';
import { LAKE, HALF } from '../world/layout';

export interface PlayerEvents {
  footstep?: (who: 'cloud' | 'chocobo', pos: THREE.Vector3, intensity: number, surface: string) => void;
  mount?: () => void;
  dismount?: () => void;
  land?: (pos: THREE.Vector3, who: 'cloud' | 'chocobo') => void;
  splash?: (pos: THREE.Vector3, size: number) => void;
  kweh?: (pos: THREE.Vector3) => void;
}

export class Player {
  readonly cloud: CloudActor;
  readonly choco: ChocoboActor;
  mounted = true;
  // mount state
  readonly chocoPos = new THREE.Vector3();
  chocoHeading = 0;
  chocoSpeed = 0;
  private chocoVY = 0;
  private chocoAir = false;
  // foot state
  readonly cloudPos = new THREE.Vector3();
  cloudHeading = 0;
  cloudSpeed = 0;
  readonly cloudVel = new THREE.Vector3();
  private cloudVY = 0;
  cloudAir = false;
  /** External control: when set, locomotion input is ignored (combat actions / cinematics). */
  locked = false;
  combat = false;
  /** Facing override while fighting (world yaw) — null for free movement. */
  faceYaw: number | null = null;
  moveScale = 1;
  /** Cinematic autopilot: heading/speed are set externally, physics still integrates. */
  autoDrive = false;
  chocoFollow = true;
  chocoFleeFrom: THREE.Vector3 | null = null;
  events: PlayerEvents = {};
  private stepSurfaceCache = 'grass';
  private dismountT = -1;
  private lastCloudStep = 0;

  constructor(
    private hf: Heightfield,
    private grid: ColliderGrid,
    quality: 'low' | 'high',
  ) {
    this.cloud = new CloudActor(quality);
    this.choco = new ChocoboActor(quality);
    this.choco.groundFn = (x, z) => this.hf.height(x, z);
    this.cloud.groundFn = (x, z) => this.hf.height(x, z);
    this.choco.onFootstep = (side, pos, intensity) => {
      const surf = this.hf.surface(pos.x, pos.z);
      this.events.footstep?.('chocobo', pos, intensity * (0.4 + clamp(this.chocoSpeed / 16, 0, 1) * 0.6), surf);
      if (surf === 'water') this.events.splash?.(pos, 0.6 + intensity);
    };
    this.mountNow();
  }

  get position(): THREE.Vector3 {
    return this.mounted ? this.chocoPos : this.cloudPos;
  }
  get heading() {
    return this.mounted ? this.chocoHeading : this.cloudHeading;
  }

  place(x: number, z: number, heading: number) {
    this.chocoPos.set(x, this.hf.height(x, z), z);
    this.chocoHeading = heading;
    this.cloudPos.copy(this.chocoPos).add(new THREE.Vector3(1.5, 0, 0));
    this.syncChoco();
    this.choco.resetFeet();
  }

  mountNow() {
    this.mounted = true;
    this.choco.saddle.add(this.cloud.root);
    this.cloud.root.position.set(0, -0.93, 0.02);
    this.cloud.root.rotation.set(0, 0, 0);
    this.cloud.setBase('ride');
    this.cloud.footIK = 0;
    this.cloud.armed = false;
  }

  /** Begin the leap off the chocobo; Cloud lands beside it with the sword drawn. */
  dismount(onLand?: () => void, drawSword = true) {
    if (!this.mounted) return;
    this.mounted = false;
    const scene = this.choco.root.parent!;
    scene.attach(this.cloud.root);
    this.cloud.root.getWorldPosition(this.cloudPos);
    const side = new THREE.Vector3(Math.cos(this.chocoHeading), 0, -Math.sin(this.chocoHeading)).multiplyScalar(-1.6);
    const fwd = new THREE.Vector3(Math.sin(this.chocoHeading), 0, Math.cos(this.chocoHeading));
    this.cloudVel.copy(side).multiplyScalar(1.2).addScaledVector(fwd, this.chocoSpeed * 0.6 + 2.0);
    this.cloudVY = 5.5;
    this.cloudAir = true;
    this.cloudHeading = this.chocoHeading;
    this.cloud.root.rotation.set(0, this.cloudHeading, 0);
    this.cloud.setBase('combat');
    this.dismountT = 0;
    this.cloud.play('dismount', {
      fadeIn: 0.05,
      onEvent: (e) => {
        if (e === 'grab' && drawSword) {
          this.cloud.attachSword('hand');
          this.cloud.armed = true;
        }
        if (e === 'land') onLand?.();
      },
    });
    this.events.dismount?.();
    this.choco.kweh = 1;
    this.events.kweh?.(this.chocoPos);
  }

  tryMount(): boolean {
    if (this.mounted || this.combat) return false;
    if (this.cloudPos.distanceTo(this.chocoPos) > 3.5) return false;
    if (this.cloud.swordAt === 'hand') {
      this.cloud.attachSword('back');
      this.cloud.armed = false;
    }
    this.cloud.stopActions(0.1);
    this.mountNow();
    this.events.mount?.();
    this.choco.kweh = 1;
    this.events.kweh?.(this.chocoPos);
    return true;
  }

  update(dt: number, input: Input, camYaw: number) {
    const ax = input.axis();
    const mag = Math.min(1, Math.hypot(ax.x, ax.y));
    // Camera-relative desired direction.
    const fwdX = -Math.sin(camYaw),
      fwdZ = -Math.cos(camYaw);
    const rightX = -fwdZ,
      rightZ = fwdX;
    const dx = fwdX * ax.y - rightX * ax.x,
      dz = fwdZ * ax.y - rightZ * ax.x;
    const wantYaw = Math.atan2(dx, dz);
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

    if (this.mounted) this.updateMounted(dt, this.locked ? 0 : mag, wantYaw, sprint, input);
    else {
      this.updateFoot(dt, this.locked ? 0 : mag, wantYaw, sprint, input);
      this.updateChocoAI(dt);
    }
    this.syncChoco();
    this.choco.update(dt);
    this.cloud.update(dt);
    // Grass bending.
  }

  private groundBlocked(x: number, z: number) {
    if (Math.abs(x) > HALF - 30 || Math.abs(z) > HALF - 30) return true;
    const h = this.hf.height(x, z);
    const w = this.hf.waterHeight(x, z);
    if (w - h > 1.5) return true; // too deep
    return false;
  }

  private updateMounted(dt: number, mag: number, wantYaw: number, sprint: boolean, input: Input) {
    const top = sprint ? 17 : 9.5;
    const target = mag * top * this.moveScale;
    // Turn toward desired heading.
    let turn = 0;
    if (this.autoDrive) {
      // Speed/heading driven externally.
    } else if (mag > 0.1) {
      const d = wrapAngle(wantYaw - this.chocoHeading);
      const rate = 3.6 - clamp(this.chocoSpeed / 17, 0, 1) * 1.5;
      turn = clamp(d * 4, -rate, rate);
      if (Math.abs(d) > 2.4 && this.chocoSpeed > 4) turn *= 0.4;
      this.chocoHeading = wrapAngle(this.chocoHeading + turn * dt);
    }
    this.choco.turnRate = damp(this.choco.turnRate, turn, 6, dt);
    const accel = target > this.chocoSpeed ? (sprint ? 10 : 7) : 14;
    if (!this.autoDrive) this.chocoSpeed = damp(this.chocoSpeed, target, accel / Math.max(4, Math.abs(target - this.chocoSpeed) + 4) * 2.2, dt);
    // Slope & water resistance.
    const fx = Math.sin(this.chocoHeading),
      fz = Math.cos(this.chocoHeading);
    const h0 = this.hf.height(this.chocoPos.x, this.chocoPos.z);
    const h1 = this.hf.height(this.chocoPos.x + fx * 2, this.chocoPos.z + fz * 2);
    const slope = (h1 - h0) / 2;
    if (slope > 0.35) this.chocoSpeed *= 1 - clamp((slope - 0.35) * 2, 0, 0.9) * dt * 6;
    const inWater = this.hf.waterHeight(this.chocoPos.x, this.chocoPos.z) - h0;
    if (inWater > 0.2) this.chocoSpeed = Math.min(this.chocoSpeed, 7);
    let nx = this.chocoPos.x + fx * this.chocoSpeed * dt,
      nz = this.chocoPos.z + fz * this.chocoSpeed * dt;
    if (this.groundBlocked(nx, nz)) {
      nx = this.chocoPos.x;
      nz = this.chocoPos.z;
      this.chocoSpeed *= 0.5;
    }
    const r = this.grid.resolve(nx, nz, 0.7);
    if (r.hit) this.chocoSpeed *= 1 - dt * 3;
    this.chocoPos.x = r.x;
    this.chocoPos.z = r.z;
    // Jump.
    const ground = this.hf.height(this.chocoPos.x, this.chocoPos.z);
    if (!this.locked && input.wasPressed('Space') && !this.chocoAir) {
      this.chocoVY = 7.5;
      this.chocoAir = true;
      this.choco.kweh = 0.8;
      this.events.kweh?.(this.chocoPos);
    }
    if (this.chocoAir) {
      this.chocoVY -= 22 * dt;
      this.chocoPos.y += this.chocoVY * dt;
      if (this.chocoPos.y <= ground) {
        this.chocoPos.y = ground;
        this.chocoAir = false;
        this.events.land?.(this.chocoPos, 'chocobo');
      }
    } else this.chocoPos.y = damp(this.chocoPos.y, ground, 25, dt);
    this.choco.speed = this.chocoAir ? this.chocoSpeed * 0.3 : this.chocoSpeed;
    this.cloud.rideSpeed = clamp(this.chocoSpeed / 17, 0, 1);
    this.cloud.ridePhase = this.choco.phase;
    this.cloud.lean = this.choco.turnRate * 0.3;
    this.cloud.lookYaw = 0;
  }

  private updateFoot(dt: number, mag: number, wantYaw: number, sprint: boolean, input: Input) {
    const c = this.cloud;
    // Dismount leap arc.
    if (this.cloudAir) {
      this.cloudVY -= 20 * dt;
      this.cloudPos.addScaledVector(this.cloudVel, dt);
      this.cloudPos.y += this.cloudVY * dt;
      const g = this.hf.height(this.cloudPos.x, this.cloudPos.z);
      if (this.cloudPos.y <= g) {
        this.cloudPos.y = g;
        this.cloudAir = false;
        this.cloudVel.set(0, 0, 0);
        this.events.land?.(this.cloudPos, 'cloud');
      }
      c.root.position.copy(this.cloudPos);
      c.root.rotation.set(0, this.cloudHeading, 0);
      c.footIK = 0;
      return;
    }
    const busy = c.busy || this.locked;
    const top = this.combat ? (sprint ? 7.5 : 5.2) : sprint ? 8.2 : 6.0;
    const target = busy ? 0 : mag * top * this.moveScale;
    this.cloudSpeed = damp(this.cloudSpeed, target, 10, dt);
    if (!busy && mag > 0.1) {
      const face = this.faceYaw ?? wantYaw;
      this.cloudHeading = dampAngle(this.cloudHeading, face, 12, dt);
    } else if (this.faceYaw !== null && !c.busy) this.cloudHeading = dampAngle(this.cloudHeading, this.faceYaw, 8, dt);
    const moveYaw = mag > 0.1 ? wantYaw : this.cloudHeading;
    const vx = Math.sin(moveYaw) * this.cloudSpeed + this.cloudVel.x,
      vz = Math.cos(moveYaw) * this.cloudSpeed + this.cloudVel.z;
    this.cloudVel.multiplyScalar(Math.exp(-dt * 6));
    let nx = this.cloudPos.x + vx * dt,
      nz = this.cloudPos.z + vz * dt;
    if (this.groundBlocked(nx, nz)) {
      nx = this.cloudPos.x;
      nz = this.cloudPos.z;
    }
    const r = this.grid.resolve(nx, nz, 0.4);
    this.cloudPos.x = r.x;
    this.cloudPos.z = r.z;
    this.cloudPos.y = damp(this.cloudPos.y, this.hf.height(this.cloudPos.x, this.cloudPos.z), 30, dt);
    c.root.position.copy(this.cloudPos);
    c.root.rotation.set(0, this.cloudHeading, 0);
    c.moveAmount = damp(c.moveAmount, clamp(this.cloudSpeed / 3, 0, 1), 10, dt);
    c.speed = clamp((this.cloudSpeed - 2) / 6, 0, 1);
    c.footIK = damp(c.footIK, 1 - c.moveAmount * 0.8, 6, dt);
    // Footsteps from gait phase.
    const ph = c.gaitPhase;
    const stepNow = Math.floor(ph * 2);
    if (c.moveAmount > 0.3 && stepNow !== this.lastCloudStep) {
      this.stepSurfaceCache = this.hf.surface(this.cloudPos.x, this.cloudPos.z);
      this.events.footstep?.('cloud', this.cloudPos, 0.3 + c.speed * 0.5, this.stepSurfaceCache);
      if (this.stepSurfaceCache === 'water') this.events.splash?.(this.cloudPos, 0.4);
    }
    this.lastCloudStep = stepNow;
    if (input.wasPressed('KeyF')) this.tryMount();
  }

  private updateChocoAI(dt: number) {
    // Follow Cloud loosely; keep clear of fights.
    let goal = this.cloudPos.clone();
    let want = 0;
    const toCloud = this.cloudPos.clone().sub(this.chocoPos).setY(0);
    const d = toCloud.length();
    if (this.chocoFleeFrom) {
      const away = this.chocoPos.clone().sub(this.chocoFleeFrom).setY(0);
      if (away.length() < 30) {
        goal = this.chocoFleeFrom.clone().add(away.normalize().multiplyScalar(34));
        want = 9;
      }
    } else if (this.chocoFollow && d > 6) want = d > 20 ? 12 : 4.5;
    if (want > 0) {
      const dir = goal.clone().sub(this.chocoPos).setY(0);
      if (dir.length() > 2) this.chocoHeading = dampAngle(this.chocoHeading, Math.atan2(dir.x, dir.z), 3, dt);
      else want = 0;
    }
    this.chocoSpeed = damp(this.chocoSpeed, want, 3, dt);
    const fx = Math.sin(this.chocoHeading),
      fz = Math.cos(this.chocoHeading);
    let nx = this.chocoPos.x + fx * this.chocoSpeed * dt,
      nz = this.chocoPos.z + fz * this.chocoSpeed * dt;
    if (this.groundBlocked(nx, nz)) {
      nx = this.chocoPos.x;
      nz = this.chocoPos.z;
    }
    const r = this.grid.resolve(nx, nz, 0.7);
    this.chocoPos.set(r.x, damp(this.chocoPos.y, this.hf.height(r.x, r.z), 20, dt), r.z);
    this.choco.speed = this.chocoSpeed;
    this.choco.turnRate = 0;
    this.choco.lookTarget = this.cloudPos.clone().setY(this.cloudPos.y + 1.5);
    void LAKE;
  }

  private syncChoco() {
    this.choco.root.position.copy(this.chocoPos);
    this.choco.root.rotation.set(0, this.chocoHeading, 0);
    if (!this.mounted) this.choco.root.updateMatrixWorld(true);
  }
}
