// Gameplay camera: orbit follow with smoothing, terrain collision, lock-on
// framing, trauma-based shake, FOV kicks; cinematic shots can take over and
// hand control back smoothly.
import * as THREE from 'three/webgpu';
import { damp, dampAngle, clamp, Simplex, lerp } from '../core/math';
import type { Input } from '../core/input';
import type { Heightfield } from '../world/heightfield';

export interface CineShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

export class GameCamera {
  yaw = 0;
  pitch = 0.18;
  distance = 6.5;
  targetDistance = 6.5;
  height = 1.6;
  readonly target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private trauma = 0;
  private noise = new Simplex(99);
  private t = 0;
  fovBase = 58;
  fovKick = 0;
  lockTarget: THREE.Vector3 | null = null;
  /** 0 = gameplay, 1 = cinematic shot fully in control. */
  cineWeight = 0;
  cineShot: CineShot | null = null;
  private lastGame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 58 };
  shakeScale = 1;
  autoFollow = 0; // tendency to swing behind the player's heading (riding)
  followYaw = 0;
  roll = 0;

  constructor(
    public camera: THREE.PerspectiveCamera,
    private hf: Heightfield,
  ) {}

  addTrauma(v: number) {
    this.trauma = Math.min(1.2, this.trauma + v);
  }

  snapTo(target: THREE.Vector3) {
    this.target.copy(target);
    this.smoothTarget.copy(target);
  }

  update(dt: number, input: Input, controllable: boolean) {
    this.t += dt;
    if (controllable) {
      const sens = 0.0023 * input.sensitivity;
      this.yaw -= input.mouseDX * sens;
      this.pitch += input.mouseDY * sens * (input.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -0.5, 1.1);
      if (input.wheel) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.8, 3.2, 14);
      // Gentle auto-follow behind the mount when the mouse is idle.
      if (this.autoFollow > 0 && Math.abs(input.mouseDX) < 1) this.yaw = dampAngle(this.yaw, this.followYaw, this.autoFollow, dt);
    }
    this.distance = damp(this.distance, this.targetDistance, 4, dt);

    // Smoothed follow target (vertical lag feels nicer on bumps).
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, 14, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, 14, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 7, dt);

    let yaw = this.yaw,
      pitch = this.pitch;
    const focus = this.smoothTarget.clone();
    focus.y += this.height;
    if (this.lockTarget) {
      // Frame both the player and the target: look from behind the player toward the enemy.
      const to = this.lockTarget.clone().sub(focus);
      const wantYaw = Math.atan2(-to.x, -to.z);
      this.yaw = dampAngle(this.yaw, wantYaw + 0.35, 5, dt);
      yaw = this.yaw;
      const flat = Math.hypot(to.x, to.z);
      const wantPitch = clamp(0.12 - Math.atan2(to.y, flat) * 0.5, -0.1, 0.6);
      this.pitch = damp(this.pitch, wantPitch, 3, dt);
      pitch = this.pitch;
      focus.lerp(this.lockTarget.clone().setY(focus.y), clamp(0.28 - flat * 0.004, 0.05, 0.3));
    }

    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let dist = this.distance;
    // Terrain collision: pull in if the ground blocks the view.
    const hitT = this.hf.raycast(focus.x, focus.y, focus.z, dir.x, dir.y, dir.z, dist);
    if (hitT < dist) dist = Math.max(1.2, hitT - 0.4);
    const pos = focus.clone().addScaledVector(dir, dist);
    const gy = this.hf.height(pos.x, pos.z) + 0.5;
    if (pos.y < gy) pos.y = gy;

    // Shake.
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma * this.shakeScale;
    const nx = this.noise.noise2(this.t * 22, 0) * sh * 0.35;
    const ny = this.noise.noise2(0, this.t * 22) * sh * 0.25;
    const nr = this.noise.noise2(this.t * 18, 7) * sh * 0.05;

    const cam = this.camera;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(focus);
    cam.rotateX(ny * 0.1);
    cam.rotateY(nx * 0.1);
    cam.rotateZ(nr + this.roll);
    this.fovKick = damp(this.fovKick, 0, 3, dt);
    const fov = this.fovBase + this.fovKick;
    this.lastGame.pos.copy(cam.position);
    this.lastGame.quat.copy(cam.quaternion);
    this.lastGame.fov = fov;

    // Cinematic blend.
    if (this.cineShot && this.cineWeight > 0) {
      const s = this.cineShot;
      const w = this.cineWeight;
      const m = new THREE.Matrix4().lookAt(s.pos, s.look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      if (s.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.roll));
      const shakeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(ny * 0.1, nx * 0.1, nr));
      q.multiply(shakeQ);
      cam.position.lerpVectors(this.lastGame.pos, s.pos, w);
      cam.quaternion.slerpQuaternions(this.lastGame.quat, q, w);
      cam.fov = lerp(fov, s.fov, w);
    } else cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  /** Align gameplay orbit to the current camera so handing back control has no pop. */
  adoptCurrentView(focus: THREE.Vector3) {
    const off = this.camera.position.clone().sub(focus.clone().setY(focus.y + this.height));
    const d = off.length();
    this.yaw = Math.atan2(off.x, off.z);
    this.pitch = clamp(Math.asin(clamp(off.y / d, -1, 1)), -0.4, 1.0);
    this.distance = clamp(d, 3, 14);
  }
}
