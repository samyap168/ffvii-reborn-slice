// Table of every one-shot sound: recipe + mixing / spatial / variation metadata.
import type { Recipe } from './types';
import * as L from './locomotion';
import * as C from './combat';
import * as M from './magic';
import * as B from './boss';
import * as K from './kor';
import * as A from './amb';

export type BusName = 'sfx' | 'ui' | 'amb';
export interface SfxDef {
  recipe: Recipe;
  /** number of distinct pre-rendered variants */
  variants: number;
  /** level in dB applied to the peak-normalized buffer */
  db: number;
  /** random playback-rate spread (fraction) */
  pv: number;
  /** panner refDistance in meters */
  ref: number;
  rolloff?: number;
  /** reverb send (0..1) */
  send: number;
  bus: BusName;
  /** voice priority: higher survives voice stealing */
  prio: number;
  /** music duck [amount, seconds] applied automatically */
  duck?: [number, number];
  /** what the render cache is keyed by */
  key?: 'surface' | 'variant';
  /** intensity opt affects level & brightness */
  intensity?: boolean;
  /** pre-render at init (common, latency critical) */
  pre?: boolean;
  /** extra slow-motion pitch sensitivity */
  noTimeScale?: boolean;
}

const d = (recipe: Recipe, o: Partial<SfxDef>): SfxDef => ({
  recipe, variants: 3, db: -10, pv: 0.04, ref: 5, send: 0.25, bus: 'sfx', prio: 1, ...o,
});

export const SFX: Record<string, SfxDef> = {
  // locomotion
  chocobo_step: d(L.chocobo_step, { key: 'surface', variants: 4, db: -14, pv: 0.06, ref: 3, send: 0.12, prio: 0, pre: true, intensity: true }),
  chocobo_kweh: d(L.chocobo_kweh, { key: 'variant', variants: 3, db: -8, pv: 0.05, ref: 8, send: 0.3, prio: 2, pre: true }),
  chocobo_warble: d(L.chocobo_warble, { variants: 3, db: -11, pv: 0.05, ref: 6, send: 0.3, prio: 2 }),
  chocobo_wing_flap: d(L.chocobo_wing_flap, { variants: 3, db: -14, pv: 0.08, ref: 4, send: 0.15, prio: 0 }),
  cloud_step: d(L.cloud_step, { key: 'surface', variants: 4, db: -20, pv: 0.07, ref: 2, send: 0.1, prio: 0, pre: true, intensity: true }),
  cloud_land: d(L.cloud_land, { key: 'surface', variants: 2, db: -12, pv: 0.05, ref: 4, send: 0.18, prio: 1, pre: true }),
  cloth_rustle: d(L.cloth_rustle, { variants: 3, db: -21, pv: 0.1, ref: 2, send: 0.08, prio: 0 }),
  mount: d(L.mount, { variants: 2, db: -13, pv: 0.04, ref: 3, send: 0.15, prio: 1 }),
  dismount_jump: d(L.dismount_jump, { variants: 2, db: -14, pv: 0.05, ref: 3, send: 0.15, prio: 1 }),
  // combat
  sword_draw: d(C.sword_draw, { variants: 2, db: -9, pv: 0.03, ref: 4, send: 0.35, prio: 2, pre: true }),
  sword_sheathe: d(C.sword_sheathe, { variants: 2, db: -12, pv: 0.03, ref: 4, send: 0.3, prio: 1 }),
  swing_light: d(C.swing_light, { variants: 4, db: -12, pv: 0.08, ref: 4, send: 0.2, prio: 1, pre: true, intensity: true }),
  swing_heavy: d(C.swing_heavy, { variants: 4, db: -8, pv: 0.06, ref: 5, send: 0.25, prio: 2, pre: true, intensity: true }),
  whoosh_big: d(C.whoosh_big, { variants: 3, db: -8, pv: 0.06, ref: 12, send: 0.35, prio: 2, intensity: true }),
  hit_flesh: d(C.hit_flesh, { variants: 4, db: -6, pv: 0.07, ref: 6, send: 0.25, prio: 2, pre: true, intensity: true }),
  hit_armor: d(C.hit_armor, { variants: 4, db: -6, pv: 0.06, ref: 7, send: 0.28, prio: 2, pre: true, intensity: true }),
  hit_critical: d(C.hit_critical, { variants: 3, db: -3, pv: 0.04, ref: 8, send: 0.35, prio: 3, pre: true, duck: [0.35, 0.5] }),
  miss_whiff: d(C.miss_whiff, { variants: 3, db: -16, pv: 0.08, ref: 3, send: 0.15, prio: 0 }),
  dodge_roll: d(C.dodge_roll, { variants: 3, db: -13, pv: 0.05, ref: 3, send: 0.15, prio: 1, pre: true }),
  guard_block: d(C.guard_block, { variants: 3, db: -6, pv: 0.05, ref: 8, send: 0.35, prio: 2, pre: true }),
  player_hurt: d(C.player_hurt, { variants: 3, db: -8, pv: 0.05, ref: 4, send: 0.2, prio: 3, pre: true }),
  stagger: d(C.stagger, { variants: 2, db: -5, pv: 0.03, ref: 10, send: 0.4, prio: 3, duck: [0.3, 0.6] }),
  enemy_growl: d(C.enemy_growl, { variants: 3, db: -13, pv: 0.07, ref: 12, send: 0.35, prio: 1 }),
  enemy_roar: d(C.enemy_roar, { variants: 3, db: -6, pv: 0.06, ref: 25, send: 0.45, prio: 2 }),
  enemy_attack_swipe: d(C.enemy_attack_swipe, { variants: 3, db: -8, pv: 0.06, ref: 8, send: 0.25, prio: 2 }),
  enemy_hurt: d(C.enemy_hurt, { variants: 4, db: -8, pv: 0.07, ref: 10, send: 0.3, prio: 2, pre: true }),
  enemy_death: d(C.enemy_death, { variants: 2, db: -8, pv: 0.05, ref: 14, send: 0.4, prio: 2 }),
  enemy_dissolve: d(C.enemy_dissolve, { variants: 2, db: -9, pv: 0.03, ref: 12, send: 0.55, prio: 1 }),
  // UI
  ui_move: d(M.ui_move, { variants: 3, db: -24, pv: 0.01, bus: 'ui', send: 0.05, prio: 1, pre: true }),
  ui_confirm: d(M.ui_confirm, { variants: 2, db: -18, pv: 0.005, bus: 'ui', send: 0.12, prio: 2, pre: true }),
  ui_cancel: d(M.ui_cancel, { variants: 2, db: -19, pv: 0.005, bus: 'ui', send: 0.1, prio: 2, pre: true }),
  ui_atb_ready: d(M.ui_atb_ready, { variants: 2, db: -17, pv: 0.005, bus: 'ui', send: 0.15, prio: 2, pre: true }),
  ui_limit_ready: d(M.ui_limit_ready, { variants: 1, db: -12, pv: 0, bus: 'ui', send: 0.3, prio: 3 }),
  ui_menu_open: d(M.ui_menu_open, { variants: 2, db: -18, pv: 0.01, bus: 'ui', send: 0.12, prio: 1 }),
  ui_levelup: d(M.ui_levelup, { variants: 1, db: -12, pv: 0, bus: 'ui', send: 0.3, prio: 3 }),
  // magic
  cast_charge: d(M.cast_charge, { variants: 2, db: -11, pv: 0.03, ref: 6, send: 0.4, prio: 2 }),
  fire_cast: d(M.fire_cast, { variants: 3, db: -8, pv: 0.05, ref: 8, send: 0.35, prio: 2 }),
  fire_explode: d(M.fire_explode, { variants: 3, db: -3, pv: 0.05, ref: 14, send: 0.45, prio: 3, duck: [0.3, 0.6] }),
  thunder_cast: d(M.thunder_cast, { variants: 2, db: -10, pv: 0.04, ref: 8, send: 0.35, prio: 2 }),
  thunder_strike: d(M.thunder_strike, { variants: 3, db: -2, pv: 0.05, ref: 40, send: 0.5, prio: 3, duck: [0.45, 1.2] }),
  ice_cast: d(M.ice_cast, { variants: 2, db: -10, pv: 0.04, ref: 8, send: 0.4, prio: 2 }),
  ice_form: d(M.ice_form, { variants: 2, db: -7, pv: 0.04, ref: 10, send: 0.45, prio: 2 }),
  ice_shatter: d(M.ice_shatter, { variants: 3, db: -5, pv: 0.05, ref: 12, send: 0.45, prio: 3, duck: [0.25, 0.5] }),
  cure_cast: d(M.cure_cast, { variants: 2, db: -9, pv: 0.02, ref: 8, send: 0.5, prio: 2 }),
  // boss
  boss_emerge: d(B.boss_emerge, { variants: 1, db: -1, pv: 0.02, ref: 70, send: 0.5, prio: 4, duck: [0.5, 2.5] }),
  boss_roar: d(B.boss_roar, { variants: 3, db: -1, pv: 0.05, ref: 60, send: 0.55, prio: 4, duck: [0.45, 2.0] }),
  boss_hiss: d(B.boss_hiss, { variants: 2, db: -7, pv: 0.05, ref: 40, send: 0.4, prio: 2 }),
  boss_tail_slam: d(B.boss_tail_slam, { variants: 3, db: -2, pv: 0.05, ref: 50, send: 0.5, prio: 3, duck: [0.35, 0.8] }),
  boss_bite: d(B.boss_bite, { variants: 3, db: -4, pv: 0.05, ref: 40, send: 0.4, prio: 3 }),
  boss_breath_charge: d(B.boss_breath_charge, { variants: 2, db: -5, pv: 0.03, ref: 50, send: 0.45, prio: 3 }),
  boss_quake: d(B.boss_quake, { variants: 2, db: -3, pv: 0.05, ref: 80, send: 0.4, prio: 3 }),
  boss_enrage: d(B.boss_enrage, { variants: 1, db: -1, pv: 0.01, ref: 80, send: 0.55, prio: 4, duck: [0.5, 3.5] }),
  boss_meteor_fall: d(B.boss_meteor_fall, { variants: 2, db: -5, pv: 0.05, ref: 60, send: 0.4, prio: 3 }),
  boss_meteor_impact: d(B.boss_meteor_impact, { variants: 3, db: -1, pv: 0.05, ref: 70, send: 0.5, prio: 4, duck: [0.4, 1.0] }),
  boss_stagger: d(B.boss_stagger, { variants: 2, db: -3, pv: 0.04, ref: 60, send: 0.5, prio: 3 }),
  boss_death: d(B.boss_death, { variants: 1, db: -1, pv: 0.01, ref: 90, send: 0.55, prio: 4, duck: [0.5, 4] }),
  water_splash_big: d(B.water_splash_big, { variants: 3, db: -4, pv: 0.06, ref: 30, send: 0.45, prio: 3 }),
  debris_rumble: d(B.debris_rumble, { variants: 3, db: -6, pv: 0.06, ref: 30, send: 0.4, prio: 2 }),
  // limit / KoR
  heartbeat: d(K.heartbeat, { variants: 3, db: -7, pv: 0.03, ref: 5, send: 0.15, prio: 3 }),
  limit_activate: d(K.limit_activate, { variants: 1, db: -1, pv: 0.01, ref: 20, send: 0.55, prio: 4, duck: [0.4, 1.5] }),
  wind_gust_big: d(K.wind_gust_big, { variants: 3, db: -8, pv: 0.06, ref: 30, send: 0.3, prio: 2 }),
  kor_sky_transform: d(K.kor_sky_transform, { variants: 1, db: -4, pv: 0, ref: 200, send: 0.5, prio: 4 }),
  kor_structure_rise: d(K.kor_structure_rise, { variants: 1, db: -4, pv: 0, ref: 200, send: 0.5, prio: 4 }),
  kor_portal_open: d(K.kor_portal_open, { variants: 1, db: -2, pv: 0, ref: 200, send: 0.55, prio: 4, duck: [0.3, 1.5] }),
  kor_knight_arrive: d(K.kor_knight_arrive, { key: 'variant', variants: 1, db: -3, pv: 0.02, ref: 120, send: 0.5, prio: 4, duck: [0.3, 0.8] }),
  kor_slash: d(K.kor_slash, { key: 'variant', variants: 1, db: -2, pv: 0.02, ref: 120, send: 0.5, prio: 4, duck: [0.35, 0.8] }),
  kor_impact_big: d(K.kor_impact_big, { variants: 3, db: -1, pv: 0.05, ref: 150, send: 0.55, prio: 4, duck: [0.4, 1.0] }),
  kor_lightning: d(K.kor_lightning, { variants: 2, db: -2, pv: 0.04, ref: 150, send: 0.55, prio: 4, duck: [0.45, 1.2] }),
  kor_fire: d(K.kor_fire, { variants: 2, db: -1, pv: 0.04, ref: 150, send: 0.55, prio: 4, duck: [0.4, 1.0] }),
  kor_ice: d(K.kor_ice, { variants: 2, db: -1, pv: 0.04, ref: 150, send: 0.55, prio: 4, duck: [0.35, 1.0] }),
  kor_final_charge: d(K.kor_final_charge, { variants: 1, db: -4, pv: 0, ref: 200, send: 0.5, prio: 5 }),
  kor_final_impact: d(K.kor_final_impact, { variants: 1, db: 0, pv: 0, ref: 300, send: 0.6, prio: 6, duck: [0.9, 4] }),
  aftermath_debris: d(K.aftermath_debris, { variants: 2, db: -10, pv: 0.03, ref: 30, send: 0.45, prio: 1 }),
  aftermath_wind: d(K.aftermath_wind, { variants: 2, db: -12, pv: 0.03, ref: 30, send: 0.3, prio: 1, bus: 'amb' }),
  thunder_distant: d(K.thunder_distant, { variants: 4, db: -7, pv: 0.08, ref: 500, rolloff: 0.6, send: 0.5, prio: 2, bus: 'amb' }),
  // generative ambience grains (internal but playable)
  bird_phrase: d(A.bird_phrase, { key: 'variant', variants: 4, db: -22, pv: 0.06, ref: 15, send: 0.35, prio: 0, bus: 'amb' }),
  frog_croak: d(A.frog_croak, { variants: 5, db: -24, pv: 0.1, ref: 6, send: 0.3, prio: 0, bus: 'amb' }),
};

/** Seamless loop textures used by LOOPS (not directly playable as one-shots). */
export const TEXTURES: Record<string, Recipe> = {
  tex_stream: A.tex_stream,
  tex_waterfall: A.tex_waterfall,
  tex_lake: A.tex_lake,
  tex_rain_light: A.tex_rain_light,
  tex_rain_heavy: A.tex_rain_heavy,
  tex_insects: A.tex_insects,
  tex_fire: A.tex_fire,
};
