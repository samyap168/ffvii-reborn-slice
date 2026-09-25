// Cinematic director: timeline of camera shots + timed events, blended in/out of
// the gameplay camera so transitions never hard-cut unless a shot asks for it.
import * as THREE from 'three/webgpu';
import type { GameCamera, CineShot } from '../game/camera';
import type { PostFX } from '../core/post';
import { smoothstep, clamp } from '../core/math';

export interface ShotSample extends CineShot {
  focus?: number; // DOF focus distance (m)
  range?: number; // DOF in-focus range
  bokeh?: number;
  dof?: number; // 0..1
}

export interface Shot {
  start: number;
  end: number;
  fn: (u: number, t: number) => ShotSample;
  /** Crossfade duration from previous shot (0 = cut). */
  blend?: number;
}

export interface Sequence {
  name: string;
  duration: number;
  shots: Shot[];
  events?: { t: number; fn: () => void }[];
  blendIn?: number;
  blendOut?: number;
  onUpdate?: (t: number, dt: number) => void;
  onEnd?: () => void;
  letterbox?: boolean;
  skippable?: boolean;
}

export class Director {
  seq: Sequence | null = null;
  t = 0;
  private fired = new Set<number>();
  letterbox = 0;
  private prevSample: ShotSample | null = null;

  constructor(
    private cam: GameCamera,
    private post: PostFX,
  ) {}

  get active() {
    return !!this.seq;
  }

  play(seq: Sequence) {
    this.seq = seq;
    this.t = 0;
    this.fired.clear();
  }

  stop(runEnd = true) {
    const s = this.seq;
    this.seq = null;
    this.cam.cineWeight = 0;
    this.cam.cineShot = null;
    this.post.dofMix.value = 0;
    if (runEnd) s?.onEnd?.();
  }

  skip() {
    const s = this.seq;
    if (!s) return;
    for (let i = 0; i < (s.events?.length ?? 0); i++) if (!this.fired.has(i)) s.events![i].fn();
    this.stop(true);
  }

  update(dt: number) {
    const target = this.seq?.letterbox ? 1 : 0;
    this.letterbox += (target - this.letterbox) * (1 - Math.exp(-dt * 3));
    const s = this.seq;
    if (!s) return;
    this.t += dt;
    const t = this.t;
    s.events?.forEach((e, i) => {
      if (!this.fired.has(i) && t >= e.t) {
        this.fired.add(i);
        e.fn();
      }
    });
    s.onUpdate?.(t, dt);
    if (!this.seq) return; // an event may have stopped us
    // Find current shot (and previous for crossfade).
    let cur: Shot | null = null,
      prev: Shot | null = null;
    for (const sh of s.shots) {
      if (t >= sh.start && t < sh.end) cur = sh;
      if (sh.end <= t) prev = sh;
    }
    if (!cur) cur = s.shots[s.shots.length - 1];
    const u = clamp((t - cur.start) / (cur.end - cur.start), 0, 1);
    let sample = cur.fn(u, t);
    if (cur.blend && prev && t - cur.start < cur.blend) {
      const k = smoothstep(0, 1, (t - cur.start) / cur.blend);
      const ps = prev.fn(1, t);
      sample = blendSample(ps, sample, k);
    }
    this.prevSample = sample;
    const bin = s.blendIn ?? 0,
      bout = s.blendOut ?? 0;
    let w = 1;
    if (bin > 0) w = Math.min(w, smoothstep(0, bin, t));
    if (bout > 0) w = Math.min(w, 1 - smoothstep(s.duration - bout, s.duration, t));
    this.cam.cineShot = sample;
    this.cam.cineWeight = w;
    const p = this.post;
    p.dofMix.value = (sample.dof ?? 0) * w;
    if (sample.focus !== undefined) p.dofFocus.value = sample.focus;
    if (sample.range !== undefined) p.dofRange.value = sample.range;
    if (sample.bokeh !== undefined) p.dofBokeh.value = sample.bokeh;
    if (t >= s.duration) this.stop(true);
  }
}

function blendSample(a: ShotSample, b: ShotSample, k: number): ShotSample {
  return {
    pos: a.pos.clone().lerp(b.pos, k),
    look: a.look.clone().lerp(b.look, k),
    fov: a.fov + (b.fov - a.fov) * k,
    roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * k,
    focus: b.focus,
    range: b.range,
    bokeh: b.bokeh,
    dof: (a.dof ?? 0) + ((b.dof ?? 0) - (a.dof ?? 0)) * k,
  };
}

/** Helper: catmull-rom path through points. */
export function path(pts: THREE.Vector3[]) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return (u: number) => curve.getPoint(clamp(u, 0, 1));
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
