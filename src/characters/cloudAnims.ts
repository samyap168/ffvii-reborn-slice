// Cloud's animation library. Axes (identity bind, character faces +Z, left = +X):
//  spine/neck/head: +x bends forward, +y twists toward his left, +z leans to his right.
//  arms (L): -x raises forward, +z abducts (out/up), elbow flex = -x on farm.
//  legs: -x swings thigh forward, +x bends knee (shin back), foot +x = toes down.
// Keys with '*' are mirrored onto .R automatically.
import { pose, merge, type Clip, type Pose, type E3 } from './anim';

const P = pose;

// ---------------------------------------------------------------------------
// Static poses
// ---------------------------------------------------------------------------
export const IDLE = P(
  {
    spine: [0.03, 0, 0],
    chest: [0.02, 0, 0],
    neck: [-0.03, 0, 0],
    head: [0.03, 0, 0],
    'uarm*': [0.06, 0.05, -0.5],
    'farm*': [-0.22, 0, 0],
    'hand*': [0.1, 0, 0.1],
    'thigh.L': [-0.03, 0, 0.02],
    'thigh.R': [0.02, 0, -0.04],
    'shin*': [0.06, 0, 0],
    'foot*': [-0.03, 0, 0],
  },
  [0, -0.008, 0],
);

/** Two-handed guard: Buster Sword angled forward, weight low. */
export const COMBAT = P(
  {
    hips: [0, -0.35, 0],
    spine: [0.14, 0.18, 0.02],
    chest: [0.08, 0.14, -0.02],
    neck: [-0.12, 0.12, 0],
    head: [-0.06, 0.08, 0.02],
    'thigh.L': [-0.62, 0.15, 0.16],
    'shin.L': [0.72, 0, 0],
    'foot.L': [-0.12, 0, -0.08],
    'thigh.R': [0.28, -0.2, -0.2],
    'shin.R': [0.55, 0, 0],
    'foot.R': [-0.3, 0, 0],
    'uarm.R': [-0.55, 0.45, 0.12],
    'farm.R': [-1.1, 0.2, 0],
    'hand.R': [0.55, 0.2, 0.25],
    'uarm.L': [-0.72, -0.3, -0.12],
    'farm.L': [-0.95, 0, 0],
    'hand.L': [0.2, 0, -0.2],
  },
  [0, -0.09, 0],
  { sword: [-0.28, -0.32, 0.9], roll: 0.2, lh: 0 },
);

export const RIDE = P(
  {
    spine: [0.18, 0, 0],
    chest: [0.08, 0, 0],
    neck: [-0.16, 0, 0],
    head: [-0.04, 0, 0],
    'thigh*': [-1.15, 0.35, 0.95],
    'shin*': [1.25, 0, -0.55],
    'foot*': [-0.3, 0, 0.2],
    'uarm*': [-0.62, -0.1, -0.28],
    'farm*': [-1.05, 0.15, 0],
    'hand*': [0.25, 0, -0.25],
  },
  [0, 0, 0],
);

export const RIDE_GALLOP = P(
  {
    spine: [0.42, 0, 0],
    chest: [0.2, 0, 0],
    neck: [-0.38, 0, 0],
    head: [-0.14, 0, 0],
    'thigh*': [-1.05, 0.35, 0.95],
    'shin*': [1.45, 0, -0.55],
    'foot*': [-0.25, 0, 0.2],
    'uarm*': [-0.9, -0.15, -0.2],
    'farm*': [-0.8, 0.15, 0],
    'hand*': [0.25, 0, -0.25],
  },
  [0, 0.02, 0.03],
);

// ---------------------------------------------------------------------------
// Procedural gaits
// ---------------------------------------------------------------------------
/** Walk/run pose for phase (0..1) and speed blend (0 walk .. 1 sprint). */
export function gait(phase: number, run: number, armed: boolean): Pose {
  const a = phase * Math.PI * 2;
  const s = Math.sin(a),
    c = Math.cos(a);
  const strideT = 0.34 + run * 0.42;
  const knee = (ph: number) => Math.max(0, Math.sin(ph - 0.9)) * (0.55 + run * 0.9) + 0.08 + run * 0.12;
  const arm = 0.22 + run * 0.55;
  const lean = 0.05 + run * 0.22;
  const r: Record<string, E3> = {
    spine: [lean, -s * 0.06 * (1 + run), 0],
    chest: [lean * 0.4, -s * 0.1 * (1 + run), 0],
    neck: [-lean * 0.9, s * 0.08, 0],
    head: [-lean * 0.3, s * 0.05, 0],
    'thigh.L': [-s * strideT - run * 0.1, 0, 0.02],
    'thigh.R': [s * strideT - run * 0.1, 0, -0.02],
    'shin.L': [knee(a), 0, 0],
    'shin.R': [knee(a + Math.PI), 0, 0],
    'foot.L': [Math.max(-0.3, -c * 0.25) + 0.05, 0, 0],
    'foot.R': [Math.max(-0.3, c * 0.25) + 0.05, 0, 0],
    'uarm.L': [s * arm, 0.1, -0.48 + run * 0.08],
    'uarm.R': [-s * arm, -0.1, 0.48 - run * 0.08],
    'farm.L': [-0.35 - run * 0.9 - Math.max(0, s) * 0.2, 0, 0],
    'farm.R': [-0.35 - run * 0.9 - Math.max(0, -s) * 0.2, 0, 0],
  };
  if (armed) {
    // Sword carried low in the right hand, trailing behind.
    r['uarm.R'] = [0.25 - s * 0.1, -0.2, 0.3];
    r['farm.R'] = [-0.45, 0, 0];
    r['hand.R'] = [1.05, 0.1, 0.2];
  }
  const bob2 = 0;
  void bob2;
  const bob = -Math.abs(Math.cos(a)) * (0.018 + run * 0.035) + 0.01;
  return { r, hips: [0, bob - run * 0.03, 0], sword: armed ? [-0.2, -0.45, -0.87] : undefined, roll: armed ? 1.4 : 0 };
}

/** Riding pose modulated by the chocobo's gait phase & speed. */
export function riding(phase: number, speed: number, lean: number): Pose {
  const base = speed > 0.55 ? RIDE_GALLOP : RIDE;
  const a = phase * Math.PI * 4; // two bounces per stride
  const k = Math.min(1, speed * 1.4);
  const r: Record<string, E3> = {};
  for (const [n, e] of Object.entries(base.r)) r[n] = [e[0], e[1], e[2]];
  const bounce = Math.sin(a) * 0.06 * k;
  r.spine = [r.spine[0] - bounce * 0.8, 0, -lean * 0.35];
  r.chest = [r.chest[0] + bounce * 0.5, 0, -lean * 0.25];
  r.neck = [r.neck[0] + bounce * 0.6, 0, lean * 0.3];
  r['farm.L'] = [r['farm.L'][0] + bounce, r['farm.L'][1], 0];
  r['farm.R'] = [r['farm.R'][0] + bounce, r['farm.R'][1], 0];
  return { r, hips: [0, Math.max(0, Math.sin(a)) * 0.035 * k, 0] };
}

// ---------------------------------------------------------------------------
// Action clips
// ---------------------------------------------------------------------------
const C = (keys: [number, Pose, any?][], dur: number, events?: Record<string, number>, name = 'clip'): Clip => ({
  name,
  dur,
  loop: false,
  keys: keys.map(([t, p, ease]) => ({ t, p, ease })),
  events,
});

const guard = COMBAT;
const withCombatLegs = (upper: Record<string, E3>, hips?: E3, sword?: E3, lh = 0, roll = 0) => merge(guard, P(upper, hips ?? guard.hips, { sword, lh, roll }));

// Light 1: wide right-to-left horizontal slash.
const L1_wind = withCombatLegs({ hips: [0, -0.8, 0], spine: [0.1, -0.35, 0], chest: [0.05, -0.35, 0], 'uarm.R': [-1.15, 0.2, 0.75], 'farm.R': [-0.6, 0, 0], 'hand.R': [0.2, 0.2, 1.0], 'uarm.L': [-0.9, -0.2, -0.3], 'farm.L': [-1.1, 0, 0] }, undefined, [-0.85, 0.25, -0.45], 0, 1.4);
const L1_hit = withCombatLegs({ hips: [0, 0.35, 0], spine: [0.18, 0.45, 0], chest: [0.1, 0.4, 0], 'uarm.R': [-1.35, -0.6, -0.1], 'farm.R': [-0.25, 0, 0], 'hand.R': [0.1, -0.2, 0.3], 'uarm.L': [-0.4, 0, -0.25], 'farm.L': [-0.8, 0, 0] }, undefined, [0.25, -0.05, 0.97], 0, 1.5);
const L1_follow = withCombatLegs({ hips: [0, 0.55, 0], spine: [0.2, 0.6, 0], chest: [0.1, 0.45, 0], 'uarm.R': [-0.9, -0.9, -0.5], 'farm.R': [-0.4, 0, 0], 'hand.R': [0.1, -0.3, -0.2], 'uarm.L': [-0.2, 0, -0.4], 'farm.L': [-0.6, 0, 0] }, undefined, [0.92, -0.25, 0.1], 0, 1.5);
export const LIGHT1 = C([[0, guard], [0.12, L1_wind, 'out'], [0.22, L1_hit, 'snap'], [0.34, L1_follow, 'out'], [0.62, guard, 'inout']], 0.62, { hit: 0.2, trailOn: 0.12, trailOff: 0.3, step: 0.1 }, 'light1');

// Light 2: rising backhand left-to-right.
const L2_wind = withCombatLegs({ hips: [0, 0.6, 0], spine: [0.22, 0.6, 0], chest: [0.1, 0.45, 0], 'uarm.R': [-0.5, -0.9, -0.6], 'farm.R': [-1.3, 0, 0], 'hand.R': [0.7, -0.2, -0.6], 'uarm.L': [-0.3, 0, -0.35] }, undefined, [0.7, -0.62, 0.35], 0, -0.6);
const L2_hit = withCombatLegs({ hips: [0, -0.4, 0], spine: [0.05, -0.4, 0.05], chest: [-0.05, -0.35, 0], 'uarm.R': [-1.9, 0.5, 0.8], 'farm.R': [-0.35, 0, 0], 'hand.R': [0.0, 0.3, 0.6], 'uarm.L': [-0.7, -0.2, -0.4], 'farm.L': [-1.0, 0, 0] }, undefined, [-0.35, 0.55, 0.76], 0, -0.7);
const L2_follow = withCombatLegs({ hips: [0, -0.6, 0], spine: [0.0, -0.55, 0.05], chest: [-0.08, -0.4, 0], 'uarm.R': [-2.3, 0.6, 0.9], 'farm.R': [-0.5, 0, 0], 'hand.R': [-0.2, 0.3, 0.7] }, undefined, [-0.7, 0.7, -0.1], 0, -0.7);
export const LIGHT2 = C([[0, L1_follow], [0.1, L2_wind, 'out'], [0.2, L2_hit, 'snap'], [0.32, L2_follow, 'out'], [0.6, guard, 'inout']], 0.6, { hit: 0.18, trailOn: 0.1, trailOff: 0.3, step: 0.08 }, 'light2');

// Light 3: leaping overhead chop.
const L3_wind = merge(guard, P({ hips: [0, 0, 0], spine: [-0.3, 0, 0], chest: [-0.25, 0, 0], neck: [0.1, 0, 0], 'uarm.R': [-2.8, 0.1, 0.2], 'farm.R': [-0.9, 0, 0], 'hand.R': [0.4, 0, 0], 'uarm.L': [-2.6, -0.1, -0.2], 'farm.L': [-1.0, 0, 0], 'thigh.L': [-0.9, 0, 0.1], 'shin.L': [1.3, 0, 0], 'thigh.R': [-0.2, 0, -0.1], 'shin.R': [1.0, 0, 0] }, [0, 0.15, 0], { sword: [0, 0.55, -0.83], lh: 1, roll: 0 }));
const L3_hit = merge(guard, P({ hips: [0, 0, 0], spine: [0.55, 0, 0], chest: [0.3, 0, 0], neck: [-0.4, 0, 0], 'uarm.R': [-1.2, 0.2, 0.1], 'farm.R': [-0.2, 0, 0], 'hand.R': [0.5, 0, 0], 'uarm.L': [-1.1, -0.2, -0.1], 'farm.L': [-0.3, 0, 0], 'thigh.L': [-0.9, 0, 0.12], 'shin.L': [0.9, 0, 0], 'thigh.R': [0.45, 0, -0.1], 'shin.R': [0.7, 0, 0] }, [0, -0.2, 0.05], { sword: [0, -0.72, 0.7], lh: 1, roll: 0 }));
export const LIGHT3 = C([[0, L2_follow], [0.16, L3_wind, 'out'], [0.27, L3_hit, 'snap'], [0.42, L3_hit], [0.72, guard, 'inout']], 0.72, { hit: 0.26, trailOn: 0.16, trailOff: 0.32, step: 0.05, impact: 0.27 }, 'light3');

// Light 4: spinning finisher (hips yaw handled by the controller for the full spin).
const L4_wind = withCombatLegs({ hips: [0, -1.0, 0], spine: [0.2, -0.4, 0], 'uarm.R': [-1.3, 0.3, 0.9], 'farm.R': [-0.3, 0, 0], 'hand.R': [0, 0.3, 1.0], 'uarm.L': [-0.8, 0, -0.9] }, [0, -0.14, 0], [-0.95, 0.05, -0.3], 0, 1.5);
const L4_mid = withCombatLegs({ hips: [0, 1.4, 0], spine: [0.25, 0.4, 0], 'uarm.R': [-1.5, -0.2, 0.2], 'farm.R': [-0.1, 0, 0], 'hand.R': [0, 0, 0.2], 'uarm.L': [-0.3, 0, -1.1] }, [0, -0.1, 0], [0.1, 0.0, 1.0], 0, 1.5);
const L4_end = withCombatLegs({ hips: [0, 2.6, 0], spine: [0.3, 0.6, 0], 'uarm.R': [-1.0, -0.8, -0.6], 'farm.R': [-0.3, 0, 0], 'hand.R': [0, -0.3, -0.3], 'uarm.L': [-0.3, 0, -0.9] }, [0, -0.16, 0], [0.95, -0.1, 0.2], 0, 1.5);
export const LIGHT4 = C([[0, L2_follow], [0.18, L4_wind, 'out'], [0.34, L4_mid, 'linear'], [0.46, L4_end, 'out'], [0.95, guard, 'inout']], 0.95, { hit: 0.32, hit2: 0.42, trailOn: 0.18, trailOff: 0.5, step: 0.2 }, 'light4');

// Heavy: rear back and slam the ground.
const H_wind = merge(guard, P({ spine: [-0.35, -0.3, 0], chest: [-0.25, -0.2, 0], neck: [0.2, 0, 0], 'uarm.R': [-2.9, 0.4, 0.4], 'farm.R': [-1.2, 0, 0], 'hand.R': [0.6, 0, 0], 'uarm.L': [-2.7, -0.2, -0.3], 'farm.L': [-1.2, 0, 0], 'thigh.L': [-0.7, 0, 0.2], 'shin.L': [0.8, 0, 0], 'thigh.R': [0.5, 0, -0.2], 'shin.R': [0.5, 0, 0] }, [0, -0.05, -0.05], { sword: [0.05, 0.5, -0.86], lh: 1, roll: 0 }));
const H_hit = merge(guard, P({ spine: [0.8, 0.1, 0], chest: [0.35, 0, 0], neck: [-0.6, 0, 0], 'uarm.R': [-0.9, 0.2, 0.1], 'farm.R': [-0.1, 0, 0], 'hand.R': [0.5, 0, 0], 'uarm.L': [-0.85, -0.2, -0.1], 'farm.L': [-0.2, 0, 0], 'thigh.L': [-1.0, 0, 0.25], 'shin.L': [1.25, 0, 0], 'thigh.R': [0.75, 0, -0.2], 'shin.R': [0.9, 0, 0] }, [0, -0.3, 0.12], { sword: [0, -0.9, 0.44], lh: 1, roll: 0 }));
export const HEAVY = C([[0, guard], [0.3, H_wind, 'out'], [0.45, H_wind], [0.56, H_hit, 'snap'], [0.8, H_hit], [1.15, guard, 'inout']], 1.15, { hit: 0.55, impact: 0.56, trailOn: 0.44, trailOff: 0.62 }, 'heavy');

// Dodge roll (translation driven by controller).
const ROLL_TUCK = P({ hips: [0, 0, 0], spine: [1.0, 0, 0], chest: [0.6, 0, 0], neck: [0.5, 0, 0], head: [0.3, 0, 0], 'thigh*': [-1.9, 0, 0.1], 'shin*': [2.2, 0, 0], 'uarm*': [-1.2, 0, -0.3], 'farm*': [-1.6, 0, 0] }, [0, -0.45, 0], { sword: [-0.3, 0.3, -0.9], roll: 1.5 });
export const DODGE = C([[0, guard], [0.1, ROLL_TUCK, 'out'], [0.38, ROLL_TUCK], [0.6, guard, 'inout']], 0.6, { iframeOn: 0.02, iframeOff: 0.42 }, 'dodge');
export const SIDESTEP = C([[0, guard], [0.12, merge(guard, P({ spine: [0.3, 0, 0.3] }, [0, -0.15, 0])), 'out'], [0.4, guard, 'inout']], 0.4, { iframeOn: 0.0, iframeOff: 0.25 }, 'sidestep');

// Hit reactions.
const HIT_BACK = merge(guard, P({ spine: [-0.35, 0.1, 0.1], chest: [-0.25, 0, 0], neck: [0.3, 0, 0], head: [-0.3, 0.2, 0], 'uarm.L': [-0.3, 0, -0.9] }, [0, -0.05, -0.08], { sword: [-0.45, 0.2, 0.85], roll: 0.3 }));
export const HIT_LIGHT = C([[0, guard], [0.06, HIT_BACK, 'snap'], [0.4, guard, 'inout']], 0.4, {}, 'hitLight');
const KNOCK = P({ spine: [-0.9, 0, 0], chest: [-0.4, 0, 0], neck: [0.5, 0, 0], 'uarm*': [-2.2, 0, 0.6], 'farm*': [-0.4, 0, 0], 'thigh*': [-0.9, 0, 0.2], 'shin*': [0.6, 0, 0] }, [0, -0.3, -0.25], { sword: [-0.6, 0.5, -0.6] });
const DOWN = P({ spine: [-1.45, 0, 0], chest: [-0.1, 0, 0], neck: [-0.3, 0, 0], 'uarm*': [-2.6, 0, 0.9], 'farm*': [-0.3, 0, 0], 'thigh*': [-1.3, 0, 0.2], 'shin*': [0.9, 0, 0] }, [0, -0.8, -0.6], { sword: [-0.9, -0.1, 0.3], roll: 1.5 });
export const KNOCKDOWN = C([[0, guard], [0.12, KNOCK, 'snap'], [0.5, DOWN, 'in'], [1.1, DOWN], [1.6, merge(ROLL_TUCK, P({}, [0, -0.35, 0])), 'inout'], [2.0, guard, 'inout']], 2.0, { land: 0.5, iframeOn: 0, iframeOff: 1.8 }, 'knockdown');

// Spell cast: left hand thrust forward, materia glows.
const CAST_CHARGE = merge(guard, P({ spine: [0.05, -0.3, 0], chest: [0, -0.25, 0], 'uarm.L': [-0.4, 0.4, 0.3], 'farm.L': [-2.0, 0, 0], 'hand.L': [-0.2, 0, 0], 'uarm.R': [0.2, -0.3, 0.4], 'farm.R': [-0.5, 0, 0], 'hand.R': [1.0, 0, 0.3] }, undefined, { sword: [-0.25, -0.85, 0.45], roll: 0.2 }));
const CAST_RELEASE = merge(guard, P({ spine: [0.2, 0.25, 0], chest: [0.1, 0.25, 0], 'uarm.L': [-1.5, 0.1, 0.1], 'farm.L': [-0.15, 0, 0], 'hand.L': [-0.9, 0, 0], 'uarm.R': [0.3, -0.3, 0.4], 'farm.R': [-0.5, 0, 0], 'hand.R': [1.0, 0, 0.3] }, [0, -0.12, 0.04], { sword: [-0.3, -0.8, 0.5], roll: 0.2 }));
export const CAST = C([[0, guard], [0.3, CAST_CHARGE, 'out'], [0.5, CAST_CHARGE], [0.6, CAST_RELEASE, 'snap'], [0.9, CAST_RELEASE], [1.25, guard, 'inout']], 1.25, { charge: 0.05, release: 0.6 }, 'cast');

// Sword draw from the back.
const DRAW_REACH = merge(IDLE, P({ spine: [0.05, 0.2, 0], 'uarm.R': [-2.6, -0.3, 0.2], 'farm.R': [-1.9, 0, 0], 'hand.R': [0.3, 0, 0], neck: [0, -0.2, 0] }));
export const DRAW = C([[0, IDLE], [0.28, DRAW_REACH, 'out'], [0.36, DRAW_REACH], [0.72, guard, 'out']], 0.72, { grab: 0.33 }, 'draw');
export const SHEATHE = C([[0, guard], [0.35, DRAW_REACH, 'inout'], [0.42, DRAW_REACH], [0.8, IDLE, 'inout']], 0.8, { release: 0.4 }, 'sheathe');

// Dismount leap (from riding to crouched landing with sword drawn mid-air).
const LEAP = P({ spine: [0.3, 0.2, 0], 'thigh*': [-1.2, 0, 0.3], 'shin*': [1.6, 0, 0], 'uarm.R': [-2.5, -0.3, 0.3], 'farm.R': [-1.5, 0, 0], 'uarm.L': [-0.8, 0, -0.9], 'farm.L': [-0.6, 0, 0] }, [0, 0.1, 0], { sword: [-0.2, 0.7, -0.68] });
const LAND = merge(guard, P({ spine: [0.55, 0.2, 0], chest: [0.2, 0.1, 0], neck: [-0.5, 0, 0], 'thigh.L': [-1.2, 0.1, 0.3], 'shin.L': [1.9, 0, 0], 'thigh.R': [-0.2, -0.2, -0.3], 'shin.R': [1.9, 0, 0], 'foot.R': [0.6, 0, 0], 'uarm.L': [-0.3, 0, -1.0] }, [0, -0.42, 0], { sword: [-0.8, -0.35, -0.5], roll: 1.2 }));
export const DISMOUNT = C([[0, RIDE], [0.2, LEAP, 'out'], [0.62, LEAP], [0.72, LAND, 'snap'], [1.2, LAND], [1.6, guard, 'inout']], 1.6, { grab: 0.3, land: 0.72 }, 'dismount');

// Limit charge: sword raised before the face, head bowed, then eyes up.
const LIMIT_HOLD = P({ hips: [0, 0.3, 0], spine: [0.0, 0.2, 0], chest: [-0.05, 0.1, 0], neck: [0.25, 0, 0], head: [0.2, 0, 0], 'thigh.L': [-0.45, 0.2, 0.2], 'shin.L': [0.5, 0, 0], 'thigh.R': [0.25, -0.2, -0.2], 'shin.R': [0.45, 0, 0], 'uarm.R': [-1.1, 0.5, 0.2], 'farm.R': [-1.5, 0, 0], 'hand.R': [0.0, 0, 0], 'uarm.L': [-1.0, -0.6, -0.1], 'farm.L': [-1.6, 0, 0], 'hand.L': [0, 0, 0] }, [0, -0.1, 0], { sword: [0, 1, 0.12], lh: 1, roll: 1.57 });
const LIMIT_LOOK = merge(LIMIT_HOLD, P({ neck: [-0.15, 0, 0], head: [-0.1, 0, 0] }));
export const LIMIT_CHARGE = C([[0, guard], [0.6, LIMIT_HOLD, 'inout'], [2.5, LIMIT_HOLD], [3.2, LIMIT_LOOK, 'inout'], [4.0, LIMIT_LOOK]], 4.0, {}, 'limitCharge');

// Summon: thrust the sword to the heavens.
const SKY = P({ spine: [-0.25, 0, 0], chest: [-0.2, 0, 0], neck: [-0.35, 0, 0], head: [-0.25, 0, 0], 'uarm.R': [-3.0, 0.2, 0.1], 'farm.R': [-0.15, 0, 0], 'hand.R': [0.2, 0, 0], 'uarm.L': [-0.4, 0, -0.8], 'farm.L': [-0.3, 0, 0], 'thigh.L': [-0.3, 0, 0.18], 'shin.L': [0.25, 0, 0], 'thigh.R': [0.2, 0, -0.18], 'shin.R': [0.2, 0, 0] }, [0, -0.02, 0], { sword: [0, 1, 0.05], roll: 1.57 });
export const SUMMON = C([[0, LIMIT_LOOK], [0.35, merge(LIMIT_LOOK, P({ spine: [0.4, 0, 0] }, [0, -0.2, 0])), 'out'], [0.7, SKY, 'snap'], [3.0, SKY]], 3.0, { raise: 0.7 }, 'summon');

// Victory: twirl the sword, rest it on the shoulder.
const VIC_SPIN = merge(IDLE, P({ 'uarm.R': [-1.3, 0.3, 0.3], 'farm.R': [-0.8, 0, 0], neck: [0.1, 0.2, 0] }, undefined, { sword: [-0.9, 0.1, 0.4], roll: 0 }));
const VIC_REST = merge(IDLE, P({ spine: [-0.03, -0.15, 0], chest: [-0.03, -0.1, 0], neck: [0.05, 0.25, 0], head: [0.05, 0.1, -0.05], 'uarm.R': [-1.1, 0.2, 1.3], 'farm.R': [-2.1, 0, 0], 'hand.R': [0.4, 0, -0.3], 'uarm.L': [0.05, 0, -0.35], 'farm.L': [-0.35, 0, 0], 'thigh.L': [-0.12, 0.1, 0.08], 'thigh.R': [0.05, -0.1, -0.08] }, [0, 0, 0], { sword: [-0.25, 0.45, -0.86], roll: 1.3 }));
export const VICTORY = C([[0, guard], [0.4, VIC_SPIN, 'out'], [1.1, VIC_SPIN], [1.5, VIC_REST, 'out'], [3.5, VIC_REST]], 3.5, { spinStart: 0.4, spinEnd: 1.2 }, 'victory');

export const CLIPS: Record<string, Clip> = {
  light1: LIGHT1,
  light2: LIGHT2,
  light3: LIGHT3,
  light4: LIGHT4,
  heavy: HEAVY,
  dodge: DODGE,
  sidestep: SIDESTEP,
  hitLight: HIT_LIGHT,
  knockdown: KNOCKDOWN,
  cast: CAST,
  draw: DRAW,
  sheathe: SHEATHE,
  dismount: DISMOUNT,
  limitCharge: LIMIT_CHARGE,
  summon: SUMMON,
  victory: VICTORY,
};

export const STATIC_POSES: Record<string, Pose> = { idle: IDLE, combat: COMBAT, ride: RIDE, gallop: RIDE_GALLOP };
