// LIMIT BREAK -> KNIGHTS OF ROUND. A ~86 s real-time summon: the world holds its
// breath, the sky tears open into a cosmos, thirteen monoliths rise around the
// ruins, a rune circle and dimensional portal form overhead, and thirteen
// colossal knights strike in turn before the King's converging final blow.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, uv, length, atan, sin, cos, abs, saturate, smoothstep, pow, exp, mix, mx_fractal_noise_float, mx_noise_float, positionLocal } from 'three/tsl';
import type { Sequence, Shot, ShotSample } from './director';
import { KnightActor, KNIGHTS, KP } from './knights';
import type { VFX } from '../vfx/vfx';
import type { PostFX } from '../core/post';
import type { ElderZolom } from '../game/boss';
import type { Player } from '../game/player';
import type { World } from '../world/world';
import type { UI } from '../ui/ui';
import { U, PRESET_DAY, PRESET_STORM, PRESET_COSMIC, PRESET_AFTERMATH, lerpPreset } from '../core/env';
import { swordGlow, swordGlowColor } from '../characters/sword';
import { eyeGlow } from '../characters/eyes';
import { PType } from '../vfx/particles';
import { ARENA, LAKE } from '../world/layout';
import { smoothstep as ss, clamp, lerp, easeInOutCubic, easeOutCubic, easeInCubic } from '../core/math';
import { sstep } from '../core/tsl';

export interface KorContext {
  scene: THREE.Scene;
  vfx: VFX;
  post: PostFX;
  boss: ElderZolom;
  player: Player;
  world: World;
  ui: UI;
  audio: any;
  camera: THREE.PerspectiveCamera;
  setTimeScale(s: number): void;
  sfx(name: string, opts?: any): void;
  storm: { value: number; set(v: number): void };
  onFinished(): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// Timeline (seconds from Limit activation).
export const T = {
  limitEnd: 6.6,
  skyStart: 6.6,
  structStart: 14,
  portalStart: 22,
  knightsStart: 27,
  hero: [27, 32.5, 38, 43.5],
  heroDur: 5.5,
  quickStart: 49,
  quickDur: 1.6,
  kingStart: 62,
  charge: 65,
  silence: 70.2,
  impact: 71.6,
  resolve: 72.6,
  revealEnd: 84,
  end: 86,
};

export class KnightsOfRound {
  private knights: KnightActor[] = [];
  private monoliths: THREE.Mesh[] = [];
  private monoGlow = uniform(0);
  private skyCircles: THREE.Object3D[] = [];
  private portal!: THREE.Mesh;
  private portalOpen = uniform(0);
  private beams: any[] = [];
  private swordBeam: any = null;
  private chargeLoop: any = null;
  private group = new THREE.Group();
  private arena = V(ARENA.x, ARENA.height, ARENA.z);
  private toLake = V(LAKE.x - ARENA.x, 0, LAKE.z - ARENA.z).normalize();
  private side = V(this.toLake.z, 0, -this.toLake.x);
  private skyY = 260;
  private cloudPos = new THREE.Vector3();
  private bossHead = new THREE.Vector3();
  private heartT = 0;
  private storm0 = 0;
  private converge = 0;
  private victoryPose = false;
  private flashDone = new Set<string>();
  private kingSword: THREE.Vector3 = new THREE.Vector3();

  constructor(private c: KorContext) {
    c.scene.add(this.group);
    this.knights = KNIGHTS.map((d) => {
      const k = new KnightActor(d, d.tier === 'king' ? 11 : 9);
      k.root.visible = false;
      this.group.add(k.root);
      return k;
    });
    this.buildMonoliths();
    this.buildPortal();
  }

  // ---------------------------------------------------------------------------
  // Structures
  // ---------------------------------------------------------------------------
  private buildMonoliths() {
    const geo = new THREE.BoxGeometry(9, 150, 9, 1, 20, 1);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = (y + 75) / 150;
      const taper = 1 - t * 0.45;
      p.setX(i, p.getX(i) * taper);
      p.setZ(i, p.getZ(i) * taper);
      if (y > 74) p.setY(i, y + 12); // pointed crown
    }
    geo.computeVertexNormals();
    geo.translate(0, 75, 0);
    const m = new THREE.MeshStandardNodeMaterial();
    const lp = positionLocal;
    const n = mx_fractal_noise_float(lp.mul(0.08), 3, 2.0, 0.5).mul(0.5).add(0.5);
    m.colorNode = vec3(0.08, 0.075, 0.09).mul(float(0.7).add(n.mul(0.5)));
    m.roughnessNode = float(0.7);
    const rune = smoothstep(0.92, 0.98, abs(sin(lp.y.mul(0.35).add(sin(lp.x.add(lp.z).mul(0.6)).mul(0.8))))).add(sstep(0.8, 0.0, abs(lp.x)).mul(smoothstep(0.6, 1.0, sin(lp.y.mul(0.08).sub(U.time.mul(2.0))))).mul(0.8));
    m.emissiveNode = vec3(1.0, 0.78, 0.4).mul(rune.mul(this.monoGlow).mul(3.0)).add(vec3(1.0, 0.8, 0.45).mul(smoothstep(140.0, 162.0, lp.y).mul(this.monoGlow).mul(6.0)));
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2 + 0.2;
      const mono = new THREE.Mesh(geo, m);
      mono.position.set(ARENA.x + Math.cos(a) * 175, -170, ARENA.z + Math.sin(a) * 175);
      mono.rotation.y = -a;
      mono.castShadow = false;
      mono.visible = false;
      this.group.add(mono);
      this.monoliths.push(mono);
    }
  }

  private buildPortal() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    m.fog = false;
    const p = uv().sub(0.5).mul(2.0);
    const r = length(p);
    const a = atan(p.y, p.x.add(0.00001));
    const open = this.portalOpen;
    const spiral = a.add(r.mul(-7.0)).add(U.time.mul(1.4));
    const swirl = mx_fractal_noise_float(vec3(cos(spiral).mul(2.0), sin(spiral).mul(2.0), r.mul(3.0).sub(U.time.mul(0.6))), 4, 2.0, 0.55).mul(0.5).add(0.5);
    const rim = exp(abs(r.sub(open.mul(0.92))).mul(-28.0)).mul(3.0);
    const inside = sstep(1.0, 0.0, r.div(open.max(0.001)));
    const core = exp(r.mul(r).mul(-18.0)).mul(open).mul(4.0);
    const col = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.95, 0.8), swirl).mul(swirl.mul(inside).mul(1.8).add(rim)).add(vec3(1.0, 0.95, 0.85).mul(core));
    m.colorNode = vec4(col.mul(saturate(open.mul(3.0))).mul(0.3).clamp(0.0, 8.0), 1);
    this.portal = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), m);
    this.portal.rotation.x = Math.PI / 2;
    this.portal.position.set(ARENA.x, this.skyY - 5, ARENA.z);
    this.portal.visible = false;
    this.portal.renderOrder = 5;
    this.group.add(this.portal);
    void pow;
  }

  // ---------------------------------------------------------------------------
  // Sequence
  // ---------------------------------------------------------------------------
  build(): Sequence {
    const c = this.c;
    const boss = c.boss;
    const player = c.player;
    this.cloudPos.copy(player.cloudPos);
    this.storm0 = c.storm.value;
    const cloud = player.cloud;
    const sky = V(ARENA.x, this.skyY, ARENA.z);
    const events: { t: number; fn: () => void }[] = [];
    const ev = (t: number, fn: () => void) => events.push({ t, fn });
    const heroSpots = [0, 1, 2, 3].map((i) => this.arena.clone().addScaledVector(this.toLake, 8 - i * 1.5).addScaledVector(this.side, (i - 1.5) * 12));

    // Boss is pinned low over the plaza for the duration.
    boss.korMode = true;
    const pinHead = this.arena.clone().addScaledVector(this.toLake, 22).setY(ARENA.height + 16);
    boss.korHead.copy(pinHead);
    boss.korLook.copy(this.cloudPos).setY(this.cloudPos.y + 2);

    // --- LIMIT BREAK -----------------------------------------------------------
    ev(0, () => {
      c.audio?.music.setState('limit', { immediate: true });
      this.chargeLoop = c.audio?.loop('limit_charge', { position: this.cloudPos });
      c.sfx('wind_gust_big', { position: this.cloudPos });
      cloud.stopActions(0.2);
      cloud.play('limitCharge', { hold: true, fadeIn: 0.3 });
      swordGlowColor.value.setRGB(0.55, 0.85, 1.0);
      c.vfx.fx.magicCircle(this.cloudPos.clone(), C(0.5, 0.8, 1.3), 5.5, 6.5, { spin: 1.6 });
      c.vfx.fx.magicCircle(this.cloudPos.clone(), C(0.9, 0.9, 1.2), 2.8, 6.5, { spin: -2.5 });
      c.ui.hideHint();
    });
    ev(5.1, () => {
      cloud.stopActions(0.1);
      cloud.play('summon', { hold: true, fadeIn: 0.12 });
      c.sfx('limit_activate', { position: this.cloudPos });
      this.chargeLoop?.stop(0.3);
    });
    ev(5.5, () => {
      c.ui.showBanner('LIMIT BREAK', 'limit', 2.2);
      c.vfx.flash(0.55, C(0.8, 0.9, 1.0));
      c.vfx.shake(0.8);
      c.vfx.aberration(1.5);
      c.vfx.radialBlur(1.4);
      const tip = this.swordTip();
      this.swordBeam = c.vfx.fx.beam(C(0.45, 0.6, 1.0), 1.0);
      this.swordBeam.set(tip, tip.clone().add(V(0, 420, 0)), 1.4);
      c.vfx.fx.shockwave(this.cloudPos.clone(), C(0.7, 0.85, 1.2), 30, 1.2);
      c.vfx.fx.dome(this.cloudPos.clone().add(V(0, 1, 0)), C(0.6, 0.8, 1.2), 9, 0.8, 2);
    });

    // --- SKY TRANSFORMS ------------------------------------------------------------
    ev(T.skyStart, () => {
      c.audio?.music.cue('kor_begin');
      c.sfx('kor_sky_transform', {});
      c.ui.showBanner('KNIGHTS OF ROUND', 'summon', 3.5);
    });
    ev(T.skyStart + 5.5, () => {
      this.swordBeam?.dispose();
      this.swordBeam = null;
      cloud.stopActions(0.6);
    });

    // --- STRUCTURE ---------------------------------------------------------------------
    ev(T.structStart, () => {
      c.audio?.music.cue('kor_structure');
      c.sfx('kor_structure_rise', {});
      for (const m of this.monoliths) m.visible = true;
      const circle = c.vfx.fx.magicCircle(sky, C(0.13, 0.095, 0.05), 230, T.impact - T.structStart + 1, { spin: 0.12, normal: V(0, -1, 0) });
      const circle2 = c.vfx.fx.magicCircle(sky.clone().add(V(0, -12, 0)), C(0.14, 0.11, 0.07), 150, T.impact - T.structStart + 1, { spin: -0.2, normal: V(0, -1, 0) });
      this.skyCircles.push(circle, circle2);
    });
    for (let i = 0; i < 13; i++)
      ev(T.structStart + 3 + i * 0.25, () => {
        const m = this.monoliths[i];
        const top = m.position.clone().setY(162);
        const b = c.vfx.fx.beam(C(0.5, 0.38, 0.2), 1.0);
        b.set(top, sky, 1.0);
        this.beams.push(b);
      });

    // --- PORTAL ------------------------------------------------------------------------
    ev(T.portalStart, () => {
      c.audio?.music.cue('kor_portal');
      c.sfx('kor_portal_open', {});
      this.portal.visible = true;
      c.vfx.flash(1.4, C(1.0, 0.9, 0.7));
      c.vfx.exposure(0.8);
    });
    for (let i = 0; i < 10; i++)
      ev(T.portalStart + 0.4 + i * 0.35, () => {
        const a = Math.random() * Math.PI * 2;
        const r = 60 + Math.random() * 20;
        c.vfx.fx.lightning(sky.clone().add(V(Math.cos(a) * r, -4, Math.sin(a) * r)), sky.clone().add(V(Math.cos(a + 0.8) * r * 0.6, -30 - Math.random() * 40, Math.sin(a + 0.8) * r * 0.6)), C(1.4, 1.0, 0.6), 0.3, 1.5);
        c.sfx('kor_lightning', { position: sky, volume: 0.5 });
      });

    // --- KNIGHTS ---------------------------------------------------------------------
    ev(T.knightsStart, () => c.audio?.music.cue('kor_knights'));
    this.heroCrimson(ev, T.hero[0], heroSpots[0]);
    this.heroLancer(ev, T.hero[1]);
    this.heroColossus(ev, T.hero[2], heroSpots[1]);
    this.heroTwins(ev, T.hero[3]);
    for (let q = 0; q < 8; q++) this.quickKnight(ev, T.quickStart + q * T.quickDur, 4 + q);
    this.king(ev);

    // --- AFTERMATH ------------------------------------------------------------------------
    ev(T.resolve, () => c.audio?.music.cue('kor_resolve'));
    ev(T.resolve + 0.4, () => c.sfx('aftermath_debris', {}));
    ev(T.resolve + 1.2, () => c.sfx('aftermath_wind', {}));

    const shots = this.shots();
    return {
      name: 'kor',
      duration: T.end,
      shots,
      events,
      letterbox: true,
      blendIn: 0.6,
      blendOut: 2.0,
      skippable: false,
      onUpdate: (t, dt) => this.tick(t, dt),
      onEnd: () => this.finish(),
    };
  }

  private swordTip() {
    const s = this.c.player.cloud.model.sword;
    s.updateMatrixWorld(true);
    return V(0, 1.72, 0).applyMatrix4(s.matrixWorld);
  }

  // ---------------------------------------------------------------------------
  // Knight routines
  // ---------------------------------------------------------------------------
  private boss() {
    return this.c.boss.actor.headCenter();
  }

  private descend(k: KnightActor, from: THREE.Vector3, to: THREE.Vector3, t0: number, dur: number, ev: (t: number, fn: () => void) => void, trail: THREE.Color, meteor = true) {
    ev(t0, () => {
      k.root.visible = true;
      k.root.position.copy(from);
      k.dissolve.value = 1;
      k.setPose(KP.float, 0.01);
      (k as any)._fly = { from: from.clone(), to: to.clone(), t0, dur, trail, meteor };
      this.c.sfx('kor_knight_arrive', { variant: KNIGHTS.indexOf(k.def), position: to });
    });
  }

  private fade(k: KnightActor, t0: number, ev: (t: number, fn: () => void) => void, rise = 20) {
    ev(t0, () => ((k as any)._fade = { t0, rise, y0: k.root.position.y }));
  }

  private heroCrimson(ev: any, t0: number, spot: THREE.Vector3) {
    const k = this.knights[0];
    const land = spot.clone().setY(ARENA.height);
    this.descend(k, V(ARENA.x, this.skyY - 10, ARENA.z), land, t0, 1.4, ev, C(1, 0.4, 0.15));
    ev(t0 + 1.4, () => {
      const c = this.c;
      c.vfx.fx.shockwave(land, C(1, 0.5, 0.2), 22, 0.7);
      c.vfx.debris(land, 40, 2);
      c.vfx.shake(0.9);
      c.sfx('kor_impact_big', { position: land });
      k.lookAt(this.boss());
      k.setPose(KP.raise, 0.8);
    });
    ev(t0 + 2.5, () => k.setPose(KP.strike, 0.18));
    ev(t0 + 2.68, () => this.strike(k, 0, 'fire', 1.8));
    this.fade(k, t0 + 3.6, ev);
  }

  private heroLancer(ev: any, t0: number) {
    const k = this.knights[1];
    const b = () => this.boss();
    const above = V(ARENA.x, this.skyY - 20, ARENA.z).addScaledVector(this.toLake, 20);
    ev(t0, () => {
      k.root.visible = true;
      k.root.position.copy(above);
      k.dissolve.value = 1;
      k.setPose(KP.thrustBack, 0.01);
      this.c.sfx('kor_knight_arrive', { variant: 1, position: above });
      (k as any)._dive = { t0 };
    });
    ev(t0 + 1.3, () => k.setPose(KP.thrust, 0.12));
    ev(t0 + 2.2, () => this.strike(k, 1, 'thunder', 2.0));
    ev(t0 + 2.2, () => {
      const at = b();
      for (let i = 0; i < 4; i++) this.c.vfx.fx.lightning(at.clone().add(V(rnd(-8, 8), 140, rnd(-8, 8))), at.clone().add(V(rnd(-3, 3), -rnd(0, 10), rnd(-3, 3))), C(0.7, 0.85, 1.8), 0.4, 1.4);
      this.c.vfx.fx.pillar(at.clone().setY(ARENA.height), C(0.5, 0.75, 1.5), 7, 160, 1.2, 3);
    });
    this.fade(k, t0 + 3.4, ev, 40);
  }

  private heroColossus(ev: any, t0: number, spot: THREE.Vector3) {
    const k = this.knights[2];
    const land = spot.clone().setY(ARENA.height).addScaledVector(this.side, -6);
    this.descend(k, V(ARENA.x - 20, this.skyY - 10, ARENA.z), land, t0, 1.1, ev, C(1, 0.7, 0.3));
    ev(t0 + 1.1, () => {
      this.c.vfx.fx.shockwave(land, C(1, 0.7, 0.3), 26, 0.9);
      this.c.vfx.debris(land, 50, 2.5);
      this.c.vfx.shake(1.1);
      this.c.sfx('kor_impact_big', { position: land });
      k.lookAt(this.boss());
      k.setPose(KP.raise, 0.7);
    });
    ev(t0 + 2.3, () => k.setPose(KP.slam, 0.15));
    ev(t0 + 2.45, () => {
      const c = this.c;
      const at = land.clone().addScaledVector(this.toLake, 10);
      for (let r = 0; r < 4; r++) c.vfx.fx.shockwave(at, C(1, 0.6, 0.25), 18 + r * 14, 0.7 + r * 0.25);
      c.vfx.fx.magicCircle(at, C(1, 0.55, 0.2), 22, 2.5, { spin: 0.5 });
      c.vfx.debris(at, 80, 3);
      c.vfx.scorchMark(at, 18, 1);
      c.vfx.slow(0.3, 0.45);
      this.strike(k, 2, 'quake', 2.4);
      this.c.boss.react(V(0, 1, 0), 2.5);
    });
    this.fade(k, t0 + 3.5, ev);
  }

  private heroTwins(ev: any, t0: number) {
    const k = this.knights[3];
    ev(t0, () => {
      k.root.visible = true;
      k.dissolve.value = 0.2;
      this.c.sfx('kor_knight_arrive', { variant: 3, position: this.boss() });
    });
    for (let i = 0; i < 9; i++) {
      ev(t0 + 0.3 + i * 0.5, () => {
        const b = this.boss();
        const a = i * 2.4 + 0.5;
        const pos = b.clone().add(V(Math.cos(a) * 16, -6 + (i % 3) * 4, Math.sin(a) * 16));
        // Afterimage trail from old to new position.
        const old = k.root.position.clone();
        for (let s = 0; s < 14; s++) this.c.vfx.p.spawn({ pos: old.clone().lerp(pos, s / 14).add(V(0, 8, 0)), life: 0.35, size: 3.5, sizeEnd: 0.5, color: [0.7, 0.35, 1.0], type: PType.Glow, emissive: 3 });
        k.root.position.copy(pos);
        k.lookAt(b);
        k.setPose(i % 2 ? KP.slash1 : KP.slash2, 0.12);
        this.c.vfx.fx.lightning(pos.clone().add(V(0, 9, 0)), b, C(1.0, 0.4, 1.6), 0.18, 0.8, 0);
        this.strike(k, 3, 'void', 0.7, i === 8);
      });
    }
    this.fade(k, t0 + 5.0, ev, 25);
  }

  private quickKnight(ev: any, t0: number, idx: number) {
    const k = this.knights[idx];
    const a = (idx / 12) * Math.PI * 2 + 1.0;
    ev(t0, () => {
      const b = this.boss();
      const pos = this.arena.clone().addScaledVector(this.toLake, 10).add(V(Math.cos(a) * 22, 0, Math.sin(a) * 22)).setY(ARENA.height + (idx % 2 ? 6 : 0));
      k.root.visible = true;
      k.root.position.copy(pos);
      k.dissolve.value = 1;
      (k as any)._appear = { t0 };
      k.lookAt(b);
      const p = k.def.weapon === 'bow' ? KP.aim : k.def.weapon === 'towerShield' || k.def.weapon === 'maceShield' ? KP.guard : KP.raise;
      k.setPose(p, 0.35);
      this.c.sfx('kor_knight_arrive', { variant: idx, position: pos });
      this.c.vfx.fx.pillar(pos.clone().setY(ARENA.height), new THREE.Color(...k.def.glow), 5, 60, 0.6, 2.5);
    });
    ev(t0 + 0.55, () => k.setPose(k.def.weapon === 'bow' ? KP.aim : k.def.weapon === 'lance' || k.def.weapon === 'rapier' ? KP.thrust : KP.strike, 0.14));
    const elem = ['ice', 'thunder', 'arrows', 'holy', 'void', 'wind', 'fire', 'crystal'][idx - 4];
    ev(t0 + 0.7, () => this.strike(k, idx, elem, 1.1));
    this.fade(k, t0 + 1.25, ev, 12);
  }

  private king(ev: any) {
    const k = this.knights[12];
    const land = this.arena.clone().addScaledVector(this.toLake, -2).setY(ARENA.height);
    // The twelve return as a ring of spectral witnesses.
    ev(T.kingStart, () => {
      for (let i = 0; i < 12; i++) {
        const w = this.knights[i];
        const a = (i / 12) * Math.PI * 2;
        w.root.visible = true;
        w.root.position.set(ARENA.x + Math.cos(a) * 42, ARENA.height + 4 + (i % 2) * 6, ARENA.z + Math.sin(a) * 42);
        w.lookAt(land);
        w.setPose(KP.salute, 0.6);
        (w as any)._fade = null;
        (w as any)._ghost = { t0: T.kingStart, target: 0.35 };
      }
    });
    this.descend(k, V(ARENA.x, this.skyY - 10, ARENA.z), land, T.kingStart + 0.3, 2.6, ev, C(1, 0.85, 0.5), false);
    ev(T.kingStart + 2.9, () => {
      this.c.vfx.fx.shockwave(land, C(1, 0.85, 0.5), 40, 1.2);
      this.c.vfx.fx.dome(land.clone().add(V(0, 4, 0)), C(1, 0.85, 0.5), 25, 1.0, 1.5);
      this.c.vfx.shake(0.8);
      this.c.sfx('kor_impact_big', { position: land });
      k.lookAt(this.boss());
      k.setPose(KP.salute, 0.6);
    });
    ev(T.charge - 0.4, () => k.setPose(KP.skyraise, 1.4));
    ev(T.charge, () => {
      this.c.audio?.music.cue('kor_final_charge');
      this.c.sfx('kor_final_charge', {});
      for (let i = 0; i < 12; i++) {
        const b = this.c.vfx.fx.beam(new THREE.Color(...this.knights[i].def.glow).multiplyScalar(0.45), 0.45);
        (b as any)._from = i;
        this.beams.push(b);
      }
      this.converge = 1;
    });
    ev(T.silence, () => {
      this.c.audio?.music.cue('kor_silence');
      this.c.audio?.dropout(2.4, 2.5);
      this.c.setTimeScale(0.12);
      k.setPose(KP.strike, 1.1);
    });
    ev(T.impact, () => {
      const c = this.c;
      c.setTimeScale(1);
      c.post.whiteout.value = 1;
      c.sfx('kor_final_impact', {});
      c.vfx.shake(1.4);
      const b = this.boss();
      c.vfx.fx.dome(b, C(1, 0.95, 0.85), 120, 2.2, 3);
      for (let r = 0; r < 5; r++) c.vfx.fx.shockwave(this.arena, C(1, 0.9, 0.7), 60 + r * 45, 1.2 + r * 0.4);
      c.vfx.debris(this.arena, 160, 4);
      c.vfx.scorchMark(this.arena.clone().addScaledVector(this.toLake, 10), 40, 1);
      c.boss.kill();
      c.boss.actor.flash.value.setRGB(4, 4, 4);
      for (const kn of this.knights) (kn as any)._fade = { t0: T.impact, rise: 0, y0: kn.root.position.y, fast: true };
      for (const bm of this.beams) bm.dispose();
      this.beams = [];
      this.converge = 0;
      this.portal.visible = false;
      for (const m of this.monoliths) m.visible = false;
      for (const sc of this.skyCircles) sc.visible = false;
      c.player.cloud.setBase('combat');
    });
  }

  /** A knight's blow landing on the serpent: element-specific VFX/SFX + reaction. */
  private strike(k: KnightActor, idx: number, elem: string, power: number, big = true) {
    const c = this.c;
    const at = this.boss();
    const dir = at.clone().sub(k.root.position).setY(0).normalize();
    c.sfx('kor_slash', { variant: idx, position: at });
    c.boss.react(dir.clone().add(V(0, 0.3, 0)).normalize(), power);
    c.vfx.hitSparks(at, dir.clone().negate().add(V(0, 0.5, 0)).normalize(), 2.2 * power, true, new THREE.Color(...k.def.glow).lerp(C(1, 1, 1), 0.4));
    const col = new THREE.Color(...k.def.glow);
    if (big) {
      c.vfx.fx.dome(at, col, 12 * power, 0.5, 2);
      c.vfx.flash(0.5 * power, col.clone().lerp(C(1, 1, 1), 0.5));
      c.vfx.shake(0.5 * power);
      c.vfx.aberration(0.8);
      c.vfx.fx.lights.flash(at, col, 1500 * power, 90, 0.6);
    }
    switch (elem) {
      case 'fire':
        c.vfx.fire(at, 3 * power);
        c.vfx.fx.pillar(at.clone().setY(ARENA.height), C(1, 0.4, 0.1), 9, 90, 1.5, 3);
        break;
      case 'thunder':
        c.vfx.thunder(at, 5, 2);
        break;
      case 'quake':
        c.vfx.debris(at, 60, 3);
        break;
      case 'void': {
        for (let i = 0; i < 40; i++) {
          const o = V(rnd(-10, 10), rnd(-10, 10), rnd(-10, 10));
          c.vfx.p.spawn({ pos: at.clone().add(o), vel: o.clone().multiplyScalar(-3), life: 0.4, size: 0.4, color: [0.6, 0.2, 1.0], type: PType.Mote, emissive: 6 });
        }
        c.vfx.fx.shockwave(at, C(0.6, 0.2, 1.0), 14, 0.4);
        break;
      }
      case 'ice':
        c.vfx.blizzard(at.clone().setY(ARENA.height), 3);
        c.vfx.iceShatter(at, 2.5);
        break;
      case 'arrows':
        for (let i = 0; i < 40; i++) {
          const from = k.hand().add(V(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)));
          c.vfx.p.spawn({ pos: from, vel: at.clone().sub(from).multiplyScalar(4).add(V(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4))), life: 0.28, size: 0.25, color: [0.6, 1.0, 0.5], type: PType.Spark, stretch: 0.08, emissive: 10 });
        }
        c.vfx.fx.dome(at, C(0.5, 1.0, 0.45), 10, 0.5, 2);
        break;
      case 'holy':
        c.vfx.fx.pillar(at.clone().setY(ARENA.height), C(1, 0.95, 0.75), 9, 220, 1.6, 2.2);
        c.vfx.fx.dome(at, C(1, 0.95, 0.8), 18, 0.8, 2.5);
        break;
      case 'wind':
        for (let i = 0; i < 90; i++) {
          const a = Math.random() * Math.PI * 2,
            r = rnd(4, 14);
          c.vfx.p.spawn({ pos: at.clone().add(V(Math.cos(a) * r, rnd(-8, 8), Math.sin(a) * r)), vel: V(0, rnd(4, 12), 0), life: rnd(0.6, 1.2), size: rnd(0.1, 0.3), color: [0.7, 1.0, 0.95], type: PType.Mote, orbit: { center: at.clone(), speed: 18, pull: 2 }, emissive: 4 });
        }
        break;
      case 'crystal':
        c.vfx.iceShatter(at, 3);
        c.vfx.fx.dome(at, C(1, 0.6, 0.95), 14, 0.6, 2);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------
  private tick(t: number, dt: number) {
    const c = this.c;
    this.bossHead.copy(this.boss());
    const cloudP = this.cloudPos;
    // --- Limit charge: the world holds its breath.
    if (t < T.limitEnd) {
      const u = clamp(t / 5.1, 0, 1);
      c.setTimeScale(lerp(1, 0.18, ss(0, 0.8, t)) * (t > 5.1 ? 1 : 1));
      swordGlow.value = Math.max(swordGlow.value, easeInCubic(u));
      eyeGlow.value = 1 + u * 2.5;
      U.windStrength.value = lerp(U.windStrength.value, 2.6, dt * 2);
      c.post.desat.value = 0.75 * ss(0.2, 1.2, t) * (1 - ss(5.2, 5.6, t));
      c.post.vignette.value = 0.22 + 0.4 * u;
      this.chargeLoop?.setParam?.('progress', u);
      c.vfx.limitAura(cloudP.clone().add(V(0, 0.2, 0)), 1 + u * 4);
      if (Math.random() < dt * 30) c.vfx.dust(cloudP.clone().add(V(rnd(-4, 4), 0, rnd(-4, 4))), 0.8, undefined, 2);
      if (Math.random() < dt * 25) {
        const tip = this.swordTip();
        c.vfx.bladeEmbers(this.swordTip().lerp(cloudP.clone().add(V(0, 1.2, 0)), 0.6), tip, C(0.6, 0.85, 1.0), 4);
      }
      this.heartT -= dt;
      if (this.heartT <= 0 && t < 5) {
        this.heartT = lerp(0.95, 0.45, u);
        c.sfx('heartbeat', { intensity: 0.5 + u * 0.5 });
      }
      if (t > 5.1) c.setTimeScale(1);
    }
    if (t >= T.limitEnd && t < T.charge) c.post.vignette.value = lerp(c.post.vignette.value, 0.3, Math.min(1, dt * 1.5));
    // Sword beam follows the tip.
    if (this.swordBeam) {
      const tip = this.swordTip();
      this.swordBeam.set(tip, tip.clone().add(V(0, 420, 0)), 1.4 + Math.sin(t * 30) * 0.2);
      this.swordBeam.inten.value = 0.7 + Math.sin(t * 17) * 0.12;
      if (Math.random() < dt * 20) c.vfx.fx.lightning(tip.clone().add(V(0, rnd(10, 80), 0)), tip.clone().add(V(rnd(-6, 6), rnd(80, 200), rnd(-6, 6))), C(0.7, 0.85, 1.6), 0.15, 0.4, 0);
    }
    // --- Sky: storm -> cosmos (and back to a golden aftermath).
    const cosmic = ss(T.skyStart, T.skyStart + 6, t) * (1 - ss(T.impact, T.impact + 3, t));
    U.cosmic.value = cosmic;
    const after = ss(T.impact, T.impact + 3, t);
    const storm = this.storm0 * (1 - ss(T.skyStart, T.skyStart + 4, t));
    c.storm.set(storm);
    U.storm.value = storm;
    const base = lerpPreset(PRESET_DAY, PRESET_STORM, storm);
    const withCosmic = lerpPreset(base, PRESET_COSMIC, cosmic);
    const preset = lerpPreset(withCosmic, PRESET_AFTERMATH, after);
    c.world.applyPreset(preset);
    if (Math.floor(t * 3) !== Math.floor((t - dt) * 3)) c.world.markEnvDirty();
    // Clouds swirling open into a vortex over the arena.
    U.cloudSpeed.value = 1 + cosmic * 8;
    // --- Monoliths rise.
    if (t > T.structStart) {
      this.monoGlow.value = ss(T.structStart + 2, T.structStart + 6, t) * (1 + this.converge * 1.5);
      this.monoliths.forEach((m, i) => {
        const u = easeOutCubic(ss(T.structStart + i * 0.2, T.structStart + 4 + i * 0.2, t));
        m.position.y = lerp(-170, -12, u);
        if (u > 0.02 && u < 0.98 && Math.random() < dt * 20) c.vfx.debris(m.position.clone().setY(c.world.hf.height(m.position.x, m.position.z)), 3, 3);
      });
    }
    // --- Portal.
    this.portalOpen.value = easeInOutCubic(ss(T.portalStart, T.portalStart + 3.5, t)) * (1 + 0.15 * this.converge);
    if (this.portal.visible) {
      this.portal.rotation.z += dt * 0.2;
      const pr = this.portalOpen.value;
      if (Math.random() < dt * 60 * pr) c.vfx.p.spawn({ pos: V(ARENA.x + rnd(-60, 60) * pr, this.skyY - 6, ARENA.z + rnd(-60, 60) * pr), vel: V(0, -rnd(10, 40), 0), life: 2.5, size: rnd(0.5, 1.5), color: [1, 0.85, 0.5], type: PType.Mote, emissive: 5 });
      // Light shafts from the portal.
      const sp = V(ARENA.x, this.skyY, ARENA.z).project(c.camera);
      if (sp.z < 1) {
        c.post.shaftCenter.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
        c.post.shaftStrength.value = 0.4 * pr;
        c.post.shaftColor.value.setRGB(1, 0.85, 0.6);
      }
    }
    // --- Knights: flights, fades, ghosts.
    for (const k of this.knights) {
      const any = k as any;
      if (any._fly) {
        const f = any._fly;
        const u = clamp((t - f.t0) / f.dur, 0, 1);
        const e = f.meteor ? easeInCubic(u) : easeInOutCubic(u);
        k.root.position.lerpVectors(f.from, f.to, e);
        k.dissolve.value = 1 - ss(0, 0.35, u);
        if (Math.random() < dt * 60 && u < 1) {
          const p = k.chest();
          c.vfx.p.spawn({ pos: p, vel: V(rnd(-2, 2), rnd(5, 15), rnd(-2, 2)), life: 0.8, size: 4, sizeEnd: 1, color: [f.trail.r, f.trail.g, f.trail.b], type: f.meteor ? PType.Flame : PType.Glow, emissive: 4, turb: 3 });
        }
        if (u >= 1) any._fly = null;
      }
      if (any._dive) {
        const d = any._dive;
        const u = clamp((t - d.t0) / 2.2, 0, 1);
        const from = V(ARENA.x, this.skyY - 20, ARENA.z).addScaledVector(this.toLake, 20);
        const to = this.bossHead.clone().add(V(0, 18, 0)).addScaledVector(this.toLake, -12);
        k.root.position.lerpVectors(from, to, easeInCubic(u));
        k.dissolve.value = 1 - ss(0, 0.2, u);
        k.lookAt(this.bossHead);
        k.root.rotation.x = u * 0.7;
        if (Math.random() < dt * 60) c.vfx.p.spawn({ pos: k.chest(), vel: V(0, 20, 0), life: 0.5, size: 5, sizeEnd: 1, color: [0.5, 0.75, 1.3], type: PType.Glow, emissive: 5 });
        if (u >= 1) any._dive = null;
      }
      if (any._appear) {
        const u = clamp((t - any._appear.t0) / 0.3, 0, 1);
        k.dissolve.value = 1 - u;
        if (u >= 1) any._appear = null;
      }
      if (any._ghost) {
        const u = clamp((t - any._ghost.t0) / 1.0, 0, 1);
        k.dissolve.value = lerp(1, any._ghost.target, u);
        k.energy.value = 1 + (this.converge ? 2 : 0);
      }
      if (any._fade) {
        const f = any._fade;
        const u = clamp((t - f.t0) / (f.fast ? 0.25 : 1.2), 0, 1);
        k.dissolve.value = Math.max(k.dissolve.value, u);
        k.root.position.y = f.y0 + easeInCubic(u) * f.rise;
        if (Math.random() < dt * 40 && u < 1) c.vfx.lifestream(k.chest(), 2, 6);
        if (u >= 1) {
          k.root.visible = false;
          any._fade = null;
          any._ghost = null;
        }
      }
      if (k.root.visible) k.update(dt);
    }
    // --- Final charge: everything converges on the King's blade.
    if (this.converge) {
      const king = this.knights[12];
      const tip = king.tip();
      this.kingSword.copy(tip);
      let bi = 0;
      for (const b of this.beams) {
        const from = (b as any)._from;
        if (from !== undefined) b.set(this.knights[from].tip(), tip, 0.45 + Math.sin(t * 20 + bi) * 0.1);
        bi++;
      }
      const k = ss(T.charge, T.silence, t);
      c.post.exposure.value = 1 + k * 0.15;
      c.vfx.baseExposure = 1 + k * 0.1;
      c.post.vignette.value = 0.3 + k * 0.15;
      c.post.ca.value = k * 0.6;
      for (let i = 0; i < 8 * (1 + k * 2); i++) {
        const o = V(rnd(-80, 80), rnd(-20, 120), rnd(-80, 80));
        c.vfx.p.spawn({ pos: tip.clone().add(o), vel: o.clone().multiplyScalar(-1.6), life: 0.6, size: rnd(0.2, 0.7), color: [1, 0.85, 0.55], type: PType.Mote, emissive: 3 });
      }
      c.vfx.fx.lights.flash(tip, C(1, 0.85, 0.5), 400 + k * 900, 140, 0.1);
      king.energy.value = 1 + k * 4;
    }
    // --- Impact aftermath: whiteout fades into dust, debris, embers.
    if (t >= T.impact) {
      const u = (t - T.impact) / 2.6;
      c.post.whiteout.value = Math.max(0, 1 - easeInCubic(clamp(u, 0, 1)) * 1.0);
      c.post.exposure.value = lerp(1.5, 1, clamp(u, 0, 1));
      c.post.vignette.value = lerp(0.62, 0.22, clamp(u * 0.5, 0, 1));
      c.post.ca.value = Math.max(0, 0.6 - u);
      c.vfx.baseExposure = lerp(1.35, 1.0, clamp(u, 0, 1));
      if (t < T.impact + 10) {
        if (Math.random() < dt * 25) c.vfx.p.spawn({ pos: this.arena.clone().add(V(rnd(-50, 50), rnd(20, 60), rnd(-50, 50))), vel: V(rnd(-1, 1), -rnd(5, 12), rnd(-1, 1)), life: 4, size: rnd(0.1, 0.4), color: [0.25, 0.22, 0.2], type: PType.Debris, gravity: 6, spin: rnd(-4, 4), floor: ARENA.height });
        if (Math.random() < dt * 30) c.vfx.p.spawn({ pos: this.arena.clone().add(V(rnd(-40, 40), rnd(0, 20), rnd(-40, 40))), vel: V(rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1)), life: 3, size: 0.06, color: [1, 0.55, 0.2], type: PType.Mote, emissive: 5, turb: 1 });
        if (Math.random() < dt * 12) c.vfx.dust(this.arena.clone().add(V(rnd(-40, 40), 0, rnd(-40, 40))), 4, C(0.5, 0.45, 0.4), 1.5);
      }
      // Lifestream rising from the fallen serpent.
      if (t > T.impact + 2 && Math.random() < dt * 40) c.vfx.lifestream(this.c.boss.actor.segPos[Math.floor(Math.random() * 30)].clone(), 3, 3);
    }
    // Cloud stands in the aftermath.
    if (t > T.impact + 0.5 && !this.victoryPose) {
      this.victoryPose = true;
      c.player.cloud.setBase('idle');
    }
  }

  // ---------------------------------------------------------------------------
  // Camera choreography
  // ---------------------------------------------------------------------------
  private shots(): Shot[] {
    const c = this.c;
    const cp = this.cloudPos.clone();
    const A = this.arena;
    const L = this.toLake;
    const S = this.side;
    const head = () => this.boss();
    const knightP = (i: number) => this.knights[i].chest();
    const sample = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, extra: Partial<ShotSample> = {}): ShotSample => ({ pos, look, fov, ...extra });
    const heroShots = (i: number, t0: number, low: THREE.Vector3): Shot[] => [
      { start: t0, end: t0 + 1.5, fn: (u) => sample(head().add(V(0, -6, 0)).addScaledVector(L, 30).addScaledVector(S, 22 - u * 4).setY(ARENA.height + 3), head().lerp(knightP(i), 0.3 + u * 0.4), 66 - u * 10) },
      { start: t0 + 1.5, end: t0 + 3.3, fn: (u) => sample(low.clone().addScaledVector(L, -6).addScaledVector(S, 10 - u * 3).setY(ARENA.height + 1.2), knightP(i).lerp(head(), 0.4 + u * 0.3), 48 + u * 8, { dof: 0.5, focus: 18, range: 30 }) },
      { start: t0 + 3.3, end: t0 + T.heroDur, fn: (u) => sample(A.clone().addScaledVector(S, -50 - u * 10).addScaledVector(L, 5).setY(ARENA.height + 18 + u * 6), head(), 52) },
    ];
    const shots: Shot[] = [
      // LIMIT: low orbit around Cloud.
      { start: 0, end: 2.2, fn: (u) => { const a = 0.8 + u * 0.6; return sample(cp.clone().add(V(Math.cos(a) * 5, 0.9, Math.sin(a) * 5)), cp.clone().add(V(0, 1.3, 0)), 50, { dof: 1, focus: 5, range: 7, bokeh: 1.5 }); } },
      // Close on the blade and his eyes.
      { start: 2.2, end: 4.4, fn: (u) => { const f = V(Math.sin(c.player.cloudHeading), 0, Math.cos(c.player.cloudHeading)); const r = V(f.z, 0, -f.x); const face = cp.clone().add(V(0, 1.63, 0)); return sample(face.clone().addScaledVector(f, 1.5 - u * 0.4).addScaledVector(r, 1.25).add(V(0, 0.05, 0)), face, 34 - u * 6, { dof: 1, focus: 1.9 - u * 0.4, range: 1.6, bokeh: 1.2 }); } },
      // Pull back and up as the sword rises.
      { start: 4.4, end: 6.6, fn: (u) => { const e = easeOutCubic(u); return sample(cp.clone().add(V(4 + e * 6, 0.6 + e * 3, 4 + e * 6)), cp.clone().add(V(0, 1.6 + e * 20, 0)), 45 + e * 20); } },
      // SKY: along the beam into the heavens, then the vast wide.
      { start: 6.6, end: 10, fn: (u) => sample(cp.clone().add(V(9 + u * 4, 1.5, 9 + u * 4)), cp.clone().add(V(0, 12 + easeInOutCubic(u) * 160, 0)), 62) },
      { start: 10, end: 14, fn: (u) => sample(A.clone().addScaledVector(L, -260 + u * 30).addScaledVector(S, 120).setY(ARENA.height + 60 + u * 20), A.clone().add(V(0, 90, 0)), 55) },
      // STRUCTURE: at the foot of a rising monolith, then a high circling aerial.
      { start: 14, end: 18, fn: (u) => { const m = this.monoliths[0].position; return sample(m.clone().lerp(A, 0.12).setY(c.world.hf.height(m.x, m.z) + 3), m.clone().setY(40 + u * 80), 60); } },
      { start: 18, end: 22, fn: (u) => { const a = u * 0.8 + 2; return sample(A.clone().add(V(Math.cos(a) * 320, 220, Math.sin(a) * 320)), A.clone().add(V(0, 60, 0)), 58); } },
      // PORTAL: looking straight up from the plaza past the serpent.
      { start: 22, end: 27, fn: (u) => sample(A.clone().addScaledVector(L, -6).add(V(0, 1.5, 0)), V(ARENA.x, this.skyY, ARENA.z).addScaledVector(L, 30 * (1 - u)), 75, { roll: 0.15 * u }) },
      ...heroShots(0, T.hero[0], this.arena.clone().addScaledVector(L, 8)),
      // Lancer: dolly from below as he dives.
      { start: T.hero[1], end: T.hero[1] + 2.2, fn: (u) => sample(head().addScaledVector(L, -34).addScaledVector(S, 16).setY(ARENA.height + 2), head().lerp(knightP(1), 0.35 * (1 - u)), 66 - u * 16) },
      { start: T.hero[1] + 2.2, end: T.hero[1] + T.heroDur, fn: (u) => sample(head().addScaledVector(S, -40 - u * 8).setY(ARENA.height + 10), head().add(V(0, 20 * (1 - u), 0)), 55) },
      ...heroShots(2, T.hero[2], this.arena.clone().addScaledVector(L, 6).addScaledVector(S, -6)),
      // Twins: orbit the serpent.
      { start: T.hero[3], end: T.hero[3] + T.heroDur, fn: (u) => { const a = u * 3.5; return sample(head().add(V(Math.cos(a) * 34, 2 + Math.sin(u * 6) * 4, Math.sin(a) * 34)), head(), 50); } },
    ];
    // Quick knights: fast alternating angles.
    for (let q = 0; q < 8; q++) {
      const t0 = T.quickStart + q * T.quickDur;
      const idx = 4 + q;
      const flip = q % 2 ? 1 : -1;
      shots.push({ start: t0, end: t0 + T.quickDur, fn: (u) => sample(knightP(idx).lerp(head(), 0.5).addScaledVector(S, flip * (34 + u * 4)).addScaledVector(L, -12).setY(ARENA.height + 6 + q * 1.5), knightP(idx).lerp(head(), 0.55), 50 - u * 4) });
    }
    // King: majestic descent, then the converging charge, the silent swing and the impact.
    shots.push(
      { start: T.kingStart, end: T.kingStart + 3.2, fn: (u) => sample(A.clone().addScaledVector(L, -40).addScaledVector(S, 8).setY(ARENA.height + 2), knightP(12), 58 - u * 6) },
      { start: T.kingStart + 3.2, end: T.charge, fn: (u) => sample(knightP(12).addScaledVector(L, -24).addScaledVector(S, -14).setY(ARENA.height + 4), knightP(12).add(V(0, 10, 0)), 50) },
      { start: T.charge, end: T.silence, fn: (u) => { const a = 1.4 + u * 1.2; const kp = this.knights[12].root.position; return sample(kp.clone().add(V(Math.cos(a) * (60 - u * 15), 6 + u * 10, Math.sin(a) * (60 - u * 15))), kp.clone().add(V(0, 30 + u * 40, 0)), 62 + u * 8, { roll: -0.05 * u }); } },
      { start: T.silence, end: T.impact, fn: (u) => sample(A.clone().addScaledVector(L, -20).addScaledVector(S, 24).setY(ARENA.height + 0.8), head().lerp(this.knights[12].chest(), 0.4), 70 + u * 10) },
      // Aftermath: dust settles; slow reveal from behind Cloud to the dissolving serpent.
      { start: T.impact, end: T.resolve + 2, fn: (u) => sample(cp.clone().addScaledVector(L, -9).addScaledVector(S, 3).setY(cp.y + 1.6), cp.clone().addScaledVector(L, 30).setY(ARENA.height + 8), 50) },
      {
        start: T.resolve + 2,
        end: T.end,
        blend: 1.5,
        fn: (u) => {
          const e = easeInOutCubic(u);
          const f = L.clone();
          const r = S.clone();
          const pos = cp.clone().addScaledVector(f, -6 - e * 2).addScaledVector(r, 2.5 - e * 1.5).setY(cp.y + 1.9 + e * 0.6);
          return sample(pos, cp.clone().addScaledVector(f, 25).setY(ARENA.height + 5 - e * 3), 48 + e * 8, { dof: 0.4 * (1 - e), focus: 7, range: 10 });
        },
      },
    );
    return shots;
  }

  private finish() {
    const c = this.c;
    c.setTimeScale(1);
    c.post.whiteout.value = 0;
    c.post.desat.value = 0;
    c.post.vignette.value = 0.22;
    c.post.ca.value = 0;
    c.post.shaftColor.value.setRGB(1.0, 0.85, 0.6);
    U.cosmic.value = 0;
    U.cloudSpeed.value = 1;
    U.windStrength.value = 0.55;
    swordGlow.value = 0;
    eyeGlow.value = 1;
    c.boss.korMode = false;
    for (const k of this.knights) k.root.visible = false;
    this.group.removeFromParent();
    c.onFinished();
  }
}

// Suppress unused-import noise for rarely used helpers.
void vec4;
void mx_noise_float;
void cos;
void float;
