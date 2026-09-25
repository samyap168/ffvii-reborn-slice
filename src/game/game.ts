// Top-level game: owns the world, player, camera, director, UI, audio and the
// high-level flow (title -> intro -> explore -> encounter -> combat -> boss ...).
import * as THREE from 'three/webgpu';
import type { QualitySettings } from '../core/quality';
import { PostFX } from '../core/post';
import { World } from '../world/world';
import { U } from '../core/env';
import { Input } from '../core/input';
import { GameCamera } from './camera';
import { Player } from './player';
import { ColliderGrid } from './colliders';
import { Director, path, V, type Sequence } from '../cinematics/director';
import { UI } from '../ui/ui';
import { PLAYER_START, ROAD, LAKE, ARENA } from '../world/layout';
import { damp, clamp, wrapAngle, smoothstep, lerp } from '../core/math';

export type GameState = 'loading' | 'title' | 'intro' | 'explore';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  world!: World;
  post!: PostFX;
  input!: Input;
  cam!: GameCamera;
  player!: Player;
  director!: Director;
  ui = new UI();
  grid = new ColliderGrid(16);
  state: GameState = 'loading';
  time = 0;
  timeScale = 1;
  private autopilot = false;
  private shot2Anchor: THREE.Vector3 | null = null;
  private hintShown = new Set<string>();
  readonly params = new URLSearchParams(location.search);
  frames = 0;
  audio: any = null;

  constructor(
    public renderer: THREE.WebGPURenderer,
    public q: QualitySettings,
    public backend: string,
  ) {
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.2, 12000);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    });
  }

  async load() {
    const prog = (p: number, l: string) => this.ui.setLoading(p, l);
    this.world = new World(this.scene, this.q);
    await this.world.build(this.renderer, this.camera, prog);
    for (const c of this.world.veg.colliders) this.grid.add(c);
    for (const c of this.world.ruins.colliders) this.grid.add(c);
    prog(0.55, 'Summoning Cloud & the Golden Chocobo');
    await tick();
    const cq = this.q.level === 'low' ? 'low' : 'high';
    this.player = new Player(this.world.hf, this.grid, cq);
    this.scene.add(this.player.choco.root);
    this.player.place(PLAYER_START.x, PLAYER_START.z, 1.4);
    prog(0.8, 'Composing the light');
    await tick();
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.q);
    this.input = new Input(this.renderer.domElement);
    this.cam = new GameCamera(this.camera, this.world.hf);
    this.director = new Director(this.cam, this.post);
    this.cam.snapTo(this.player.position);
    this.cam.yaw = Math.PI + this.player.heading;
    this.hookPlayerEvents();
    // Warm up shaders so the first frames don't hitch.
    prog(0.92, 'Compiling shaders');
    await tick();
    try {
      await (this.renderer as any).compileAsync?.(this.scene, this.camera);
    } catch {
      /* ignore */
    }
    prog(1, 'Ready');
  }

  private hookPlayerEvents() {
    const p = this.player;
    p.events.footstep = (who, pos, intensity, surface) => {
      this.audio?.play(who === 'chocobo' ? 'chocobo_step' : 'cloud_step', { position: pos, intensity, surface });
    };
    p.events.kweh = (pos) => this.audio?.play('chocobo_kweh', { position: pos.clone().setY(pos.y + 2) });
    p.events.land = (pos, who) => this.audio?.play(who === 'cloud' ? 'cloud_land' : 'chocobo_step', { position: pos, intensity: 1 });
    p.events.dismount = () => this.audio?.play('dismount_jump', { position: p.chocoPos });
    p.events.mount = () => this.audio?.play('mount', { position: p.chocoPos });
  }

  start() {
    const skip = this.params.get('skip');
    this.ui.hideLoader();
    if (skip === 'explore' || skip === 'intro') {
      this.enterExplore();
      return;
    }
    this.enterTitle();
  }

  // ---------------------------------------------------------------------------
  // Title: slow aerial flyover behind the logo.
  // ---------------------------------------------------------------------------
  private enterTitle() {
    this.state = 'title';
    this.ui.showTitle(true);
    const fly = path([V(-300, 180, 260), V(-140, 150, 60), V(40, 130, -120), V(180, 120, -260)]);
    this.director.play({
      name: 'title',
      duration: 1e9,
      shots: [
        {
          start: 0,
          end: 1e9,
          fn: (_u, t) => {
            const u = (Math.sin(t * 0.02 - 1.2) + 1) / 2;
            return { pos: fly(u), look: V(36, 40, -470), fov: 52 };
          },
        },
      ],
    });
    this.cam.cineWeight = 1;
    const begin = async () => {
      window.removeEventListener('pointerdown', begin);
      this.ui.setTitlePrompt('');
      try {
        await this.audio?.init();
        this.audio?.music.setState('explore', { fade: 3 });
      } catch (e) {
        console.warn('audio init failed', e);
      }
      this.input.requestLock();
      this.ui.showTitle(false);
      this.enterIntro();
    };
    window.addEventListener('pointerdown', begin);
  }

  // ---------------------------------------------------------------------------
  // Intro: establishing shots, reveal Cloud on the chocobo, hand over control.
  // ---------------------------------------------------------------------------
  private enterIntro() {
    this.state = 'intro';
    const p = this.player;
    p.place(PLAYER_START.x, PLAYER_START.z, 1.4);
    this.autopilot = true;
    const chocoPos = () => p.chocoPos.clone();
    const riderHead = () => p.chocoPos.clone().add(V(0, 2.4, 0));
    const side = () => {
      const h = p.chocoHeading;
      return V(Math.cos(h), 0, -Math.sin(h));
    };
    const fwd = () => {
      const h = p.chocoHeading;
      return V(Math.sin(h), 0, Math.cos(h));
    };
    const aerial = path([V(-470, 150, 520), V(-430, 128, 470), V(-400, 110, 430)]);
    const seq: Sequence = {
      name: 'intro',
      duration: 24,
      letterbox: true,
      blendIn: 2.0,
      blendOut: 3.2,
      skippable: true,
      shots: [
        // 1. Vast landscape: lake, waterfall, mountains beyond.
        { start: 0, end: 7, fn: (u) => ({ pos: aerial(u), look: V(-60, 45, -260).lerp(V(0, 40, -330), u), fov: 46, dof: 0 }) },
        // 2. Low over the grass as the chocobo thunders toward and past the lens.
        {
          start: 7,
          end: 12.5,
          blend: 0,
          fn: (u) => {
            if (!this.shot2Anchor) {
              // Place the lens ~38m ahead along the road, just off to the side.
              const c = ROAD.closest(p.chocoPos.x, p.chocoPos.z);
              const a = ROAD.at(Math.min(1, c.t + 38 / ROAD.length));
              const tn = ROAD.tangent(c.t + 38 / ROAD.length);
              this.shot2Anchor = V(a.x - tn.z * 5.5, 0, a.z + tn.x * 5.5);
            }
            const anchor = { x: this.shot2Anchor.x, z: this.shot2Anchor.z };
            const g = this.world.hf.height(anchor.x, anchor.z);
            const pos = V(anchor.x, g + 0.6, anchor.z);
            const look = chocoPos().add(V(0, 1.6, 0));
            return { pos: pos.lerp(pos.clone().add(V(0, 0.4, 0)), u), look, fov: 38 - u * 6, dof: 0.8, focus: pos.distanceTo(look), range: 6, bokeh: 2.2 };
          },
        },
        // 3. Side tracking shot on Cloud: hair and feathers in the wind.
        {
          start: 12.5,
          end: 18.5,
          blend: 0,
          fn: (u) => {
            const s = side().multiplyScalar(-4.8 + u * 0.6);
            const pos = chocoPos().add(s).add(V(0, 1.9 + u * 0.3, 0)).addScaledVector(fwd(), 1.2 - u * 2.2);
            const look = riderHead().addScaledVector(fwd(), 0.8);
            return { pos, look, fov: 34, dof: 1, focus: pos.distanceTo(look), range: 3, bokeh: 2.8 };
          },
        },
        // 4. Crane up and around behind the rider into the gameplay camera.
        {
          start: 18.5,
          end: 24,
          blend: 1.2,
          fn: (u) => {
            const e = smoothstep(0, 1, u);
            const back = fwd().multiplyScalar(-7 - e * 1).add(side().multiplyScalar(2.5 * (1 - e)));
            const pos = chocoPos().add(back).add(V(0, 2.6 + e * 0.8, 0));
            return { pos, look: chocoPos().add(V(0, 2.2, 0)).addScaledVector(fwd(), 6), fov: 50 + e * 8, dof: 0.3 * (1 - e), focus: 7, range: 8 };
          },
        },
      ],
      events: [
        { t: 1.5, fn: () => this.ui.showBanner('FINAL FANTASY <span style="color:#ffd772">VII</span><small>R E B O R N</small>', 'title2', 5) },
        { t: 9.2, fn: () => this.audio?.play('chocobo_kweh', { position: p.chocoPos.clone().setY(p.chocoPos.y + 2) }) },
      ],
      onUpdate: () => {
        const e = Math.min(1, this.director.t / 20);
        this.cam.snapTo(p.position);
        this.cam.yaw = Math.PI + p.chocoHeading;
        this.cam.pitch = 0.2;
        void e;
      },
      onEnd: () => this.enterExplore(),
    };
    this.director.play(seq);
  }

  private enterExplore() {
    this.state = 'explore';
    this.autopilot = false;
    this.player.autoDrive = false;
    this.player.locked = false;
    this.ui.letterbox(0);
    this.cam.adoptCurrentView(this.player.position);
    this.cam.cineWeight = 0;
    this.ui.showHint('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ride · <kbd>Shift</kbd> gallop · <kbd>Space</kbd> jump · <kbd>Mouse</kbd> look', 7);
  }

  // ---------------------------------------------------------------------------
  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 1 / 20) * this.timeScale;
    this.time += dt;
    U.time.value = this.time;
    const input = this.input;
    if (this.director.active && this.director.seq?.skippable && (input.rawPressed('Escape') || input.rawPressed('Enter'))) this.director.skip();

    // Autopilot during the intro: follow the road.
    if (this.autopilot) this.driveAlongRoad(dt);

    const controllable = this.state === 'explore';
    input.enabled = controllable;
    if (controllable && !input.locked && input.wasPressed('Mouse0')) input.requestLock();
    this.player.update(dt, input, this.cam.yaw);

    // Camera follow.
    const p = this.player;
    const tgt = p.mounted ? p.chocoPos.clone().add(V(0, 0.9, 0)) : p.cloudPos.clone();
    this.cam.target.copy(tgt);
    this.cam.height = p.mounted ? 1.7 : 1.45;
    this.cam.targetDistance = p.mounted ? clamp(this.cam.targetDistance, 5.5, 14) : this.cam.targetDistance;
    this.cam.autoFollow = p.mounted && p.chocoSpeed > 3 ? 1.2 : 0;
    this.cam.followYaw = Math.PI + p.chocoHeading;
    this.cam.fovBase = 58 + (p.mounted ? clamp((p.chocoSpeed - 9) / 8, 0, 1) * 10 : 0);
    this.director.update(dt);
    this.cam.update(dt, input, controllable);
    this.ui.letterbox(this.director.letterbox);

    // Grass benders: chocobo feet/body and Cloud.
    const cp = p.chocoPos;
    U.bend0.value.set(cp.x, cp.y, cp.z, 1.3);
    U.bend1.value.set(p.cloudPos.x, p.cloudPos.y, p.cloudPos.z, p.mounted ? 0 : 0.7);
    U.playerPos.value.copy(p.position);

    this.world.update(dt, this.time, this.camera);
    this.updateSunShafts();
    this.audioFrame(dt);
    this.ui.update(dt);
    input.endFrame();
  }

  private driveAlongRoad(dt: number) {
    const p = this.player;
    const c = ROAD.closest(p.chocoPos.x, p.chocoPos.z);
    const ahead = ROAD.at(Math.min(1, c.t + 14 / ROAD.length));
    const want = Math.atan2(ahead.x - p.chocoPos.x, ahead.z - p.chocoPos.z);
    // Fake input: steer by rotating a virtual stick relative to the camera yaw.
    const d = wrapAngle(want - p.chocoHeading);
    p.chocoHeading = wrapAngle(p.chocoHeading + clamp(d * 2, -1.5, 1.5) * dt);
    const t = this.director.t;
    const targetSpeed = t < 7 ? 8 : t < 12.5 ? 15 : t < 18.5 ? 13 : 10;
    p.chocoSpeed = damp(p.chocoSpeed, targetSpeed, 1.5, dt);
    p.locked = true;
    // Let Player.update integrate the motion: emulate forward stick.
    p.autoDrive = true;
  }

  private _v = new THREE.Vector3();
  private updateSunShafts() {
    // Project the sun to screen for the shafts pass.
    const sunWorld = this._v.copy(this.camera.position).addScaledVector(U.sunDir.value, 1000);
    sunWorld.project(this.camera);
    const vis = sunWorld.z < 1 && Math.abs(sunWorld.x) < 1.6 && Math.abs(sunWorld.y) < 1.6 ? 1 : 0;
    this.post.shaftCenter.value.set(sunWorld.x * 0.5 + 0.5, sunWorld.y * 0.5 + 0.5);
    this.post.shaftStrength.value = damp(this.post.shaftStrength.value, 0.45 * vis, 4, 1 / 60);
  }

  private audioFrame(dt: number) {
    const a = this.audio;
    if (!a || !a.ready) return;
    const c = this.camera;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    a.setListener(c.position, f, c.up);
    const nearWater = clamp(1 - Math.abs(Math.hypot(c.position.x - LAKE.x, c.position.z - LAKE.z) - LAKE.radius) / 120, 0, 1);
    a.update(dt, { windStrength: U.windStrength.value, playerSpeed: this.player.mounted ? this.player.chocoSpeed : this.player.cloudSpeed, inCombat: false, weather: U.storm.value, nearWater, timeScale: this.timeScale });
    if (this.state === 'explore') a.music.setIntensity(this.player.mounted ? clamp(this.player.chocoSpeed / 14, 0, 1) : 0.15);
    void lerp;
    void ARENA;
  }

  /** Test hook: step the simulation deterministically without rendering. */
  advance(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }

  render() {
    this.post.render();
    this.frames++;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
