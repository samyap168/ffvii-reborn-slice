# src/audio — procedural audio + dynamic music

Everything is synthesized at runtime: no samples, no downloads. The only dependency is the browser's Web Audio API.

## Quick use

```ts
import { AudioSystem } from './audio';
const audio = new AudioSystem();
await audio.init();                       // call from the first user gesture
audio.music.setState('explore');
audio.music.setIntensity(riding ? 1 : 0);
audio.play('chocobo_step', { position, surface: 'grass', intensity: 0.8 });
const fall = audio.loop('amb_waterfall', { position: fallPos });
// every frame:
audio.setListener(camPos, camForward, camUp);
audio.update(dt, { windStrength, playerSpeed, inCombat, weather, nearWater, timeScale });
```

`update()` runs the global ambience itself (wind, birds, insects/frogs, rain, distant thunder when `weather > 0.6`) and applies `timeScale`.
The game only needs to create the positional water loops (`amb_stream`, `amb_waterfall`, `amb_lake`).
`loop()` and `music.setState()` can be called before `init()`. They are queued and applied once the engine exists.

## Architecture

```
voices/loops -> [bus: sfx | ui | amb | music]  -> master -> dropout gain -> compressor -> trim -> soft clip -> out
                  (each bus: slow-mo lowpass, duck, volume)
                  wet sends -> shared ReverbUnit (valley IR 3.6 s / "cosmic cathedral" IR 7 s, crossfaded by state)
```

- `dsp.ts` is an offline JS DSP kit: polyBLEP oscillators, a TPT state-variable filter, noise, envelopes, Karplus-Strong, modal synthesis, formants and seamless loops. Recipes built from it render into `AudioBuffer`s on any context.
- `sfx/*` holds one recipe per sound, and `sfx/registry.ts` sets each sound's level, variants, spatial range, reverb send, priority and auto-duck.
  - Latency-critical sounds are pre-rendered at `init()` within a time budget. Everything else renders in background chunks, or synchronously on first use.
  - Each sound keeps 1–4 genuinely different renders (different seeds). Every play also randomizes pitch, level and a lowpass, and never repeats the previous variant.
- `engine.ts` contains:
  - buses and the master limiter;
  - a 48-voice cap that steals the lowest priority × level × remaining-life voice;
  - HRTF panners using the inverse distance model with per-sound `refDistance`. Far sounds keep proportionally more reverb;
  - loops, listener handling, slow motion, dropout with tinnitus, volumes, and auto-ambience.
- `loops.ts` holds realtime graphs: wind with gusts and riding rush, generative birds (virtual singers at fixed positions), insects plus frogs, water textures, rain, materia hum, boss breath and the limit charge.
- `music/`
  - `director.ts`: a lookahead scheduler (25 ms tick, ~120 ms lookahead, 1.5 s when the tab is hidden). Each piece has a tempo map (bpm and meter per bar). It quantizes state changes to the next beat or bar (never more than 2.5 s away), crossfades, plays transition stingers, handles cues and ducks the music.
  - `piece.ts`: the Bar API and the per-piece player. Stems are driven by intensity.
  - `instruments.ts`: realtime instruments (string ensemble, brass/horns, formant choir, flute/ocarina, synth bass, distorted guitar with amp/cab, organ, pad, drone, shimmer).
  - `samples.ts`: JS-rendered plucked and struck instruments (harp, pizzicato, piano, celesta, glockenspiel, tubular bell, timpani) and the percussion kit (taiko, gran cassa, snare, toms, crash, reverse cymbal, shaker, hat, tam-tam, anvil, sub boom).
  - `pieces/*`: the compositions, all original.

## Music states

| state | content |
|---|---|
| `silence` | nothing |
| `title` | D major, 66 bpm. Harp, strings, and a flute/celesta hint of the explore theme. |
| `explore` | D major, 96 bpm, 48 bars (~2 min), with a lift to E major. Form: Intro, A, A′, B, B′, A″, Outro. Intensity 0 = pad, harp, flute. Intensity 1 adds gallop strings, low string drive, a horn counter-line, a bouncy pizzicato/glockenspiel counter-melody, percussion and violins doubling the tune. |
| `encounter` | Tension loop: tremolo cluster, heartbeat, rising harmonic, timpani. |
| `battle` | E minor, 152 bpm. Octave bass ostinato, brass stabs, 16th strings, horn/trumpet lead, taiko/snare/toms. Intensity adds brass, hats and extra percussion. |
| `boss` | C phrygian, 112 bpm, half-time. Low-brass ostinato, timpani/taiko, choir hits, horn motif. |
| `enrage` | Same key and motif as the boss, at 150 bpm, with distorted guitar chugs, war drums, choir chant, storm string runs and anvils. |
| `limit` | D pedal drone, rising shimmer, accelerating heartbeat, reverse swells, strings rising for ~8 s, then a sustained plateau. |
| `kor` | Driven by cues (below). Uses the cathedral reverb. |
| `victory` | Bb major fanfare (~7 s, triplet pickup), then a gentle 3/4 loop for flute, harp and pizzicato. |
| `aftermath` | Choir "oo" pad, strings, piano, sparse bells. |

`setState(s, { immediate: true })` switches within about 30 ms. `fade` overrides the crossfade time.

## Cues (`music.cue(name)`)

| cue | effect |
|---|---|
| `boss_reveal` | Huge orchestral hit (brass, strings, timpani, gong, taiko) plus a choir swell. |
| `stagger` | Short brass/percussion hit. |
| `enrage_hit` | Massive hit with guitar, then a reverse swell into the phase-2 downbeat. It switches the state to `enrage`. Calling `setState('enrage')` from `boss` does the same. |
| `kor_begin` | Drones, choir swell and bells. |
| `kor_structure` | Organ and brass chord build with timpani rolls. |
| `kor_portal` | Huge hit, then a sustained D-major choir. |
| `kor_knights` | 140 bpm choir and orchestra march. It intensifies on its own over time; `setIntensity` 0..1 also works. |
| `kor_final_charge` | 7.5 s converging riser (strings/choir/brass pitch rising, accelerating snare and timpani rolls, cymbal swell), then a plateau. |
| `kor_silence` | Hard stop of all music and all reverb tails. |
| `kor_resolve` | ~20 s awe-struck progression (D–A/C#–Bm7–G–G/B–Asus4–Bb–C) ending on a sustained Dadd9. |

## Sound names (`play`)

- **Locomotion:** chocobo_step*, chocobo_kweh (variant 1 = happy warble), chocobo_warble, chocobo_wing_flap, cloud_step*, cloud_land*, cloth_rustle, mount, dismount_jump. Names marked * depend on `surface`.
- **Combat:** sword_draw, sword_sheathe, swing_light, swing_heavy, whoosh_big, hit_flesh, hit_armor, hit_critical, miss_whiff, dodge_roll, guard_block, player_hurt, stagger, enemy_growl, enemy_roar, enemy_attack_swipe, enemy_hurt, enemy_death, enemy_dissolve.
  - `intensity` affects level and brightness on steps, swings, whoosh_big and hits.
- **UI:** ui_move, ui_confirm, ui_cancel, ui_atb_ready, ui_limit_ready, ui_menu_open, ui_levelup.
- **Magic:** cast_charge, fire_cast, fire_explode, thunder_cast, thunder_strike, ice_cast, ice_form, ice_shatter, cure_cast.
- **Boss:** boss_emerge, boss_roar, boss_hiss, boss_tail_slam, boss_bite, boss_breath_charge, boss_quake, boss_enrage, boss_meteor_fall, boss_meteor_impact, boss_stagger, boss_death, water_splash_big, debris_rumble.
- **Limit/KoR:** heartbeat, limit_activate, wind_gust_big, kor_sky_transform, kor_structure_rise, kor_portal_open.
  - `variant` 0..12 selects the design for kor_knight_arrive (metal/fire/thunder/crystal cycle, 12 = all) and for kor_slash (heavy blade, spear, hammer quake, twin flurry, fire, lightning, ice, wind, holy, void, axe, arrow volley, colossal).
  - Also: kor_impact_big, kor_lightning, kor_fire, kor_ice, kor_final_charge, kor_final_impact, aftermath_debris, aftermath_wind, thunder_distant.
- **Internal ambience grains (also playable):** bird_phrase (variant = species 0..4), frog_croak.

Sounds with an auto music duck: hit_critical, stagger, fire_explode, thunder_strike, ice_shatter, all big boss and KoR impacts, and limit_activate.

## Loops (`loop`)

| loop | parameters |
|---|---|
| amb_wind | `strength`, `rush` |
| amb_birds | `density` |
| amb_insects | `level`, `water` (frogs) |
| amb_stream, amb_waterfall, amb_lake | `level`, `pitch` |
| amb_rain | `intensity` |
| materia_hum | `intensity`, `pitch` |
| boss_breath | `intensity` |
| limit_charge | `progress` 0..1 |

Any one-shot name can also be looped: its rendered buffer repeats, with a `pitch` parameter.

## API additions (optional, backwards compatible)

- `setVolumes({ ui })`
- `AudioSystem.engine`: the underlying `Engine`
- `SOUND_NAMES`, `LOOP_NAMES`, `MUSIC_CUES` exports
- `Engine` export: construct on an `OfflineAudioContext` with `{ offline: true }` and drive `tick()` yourself for offline rendering.

## Testing

`node tools/audio/render.mjs [--sfx|--music|--loops|--init] [--only name] [--no-wav]`

This starts Vite on port 5199 and opens `tools/audio/test.html` in headless Chromium. It renders every sound, loop and music scenario through the real engine graph with `OfflineAudioContext`, writes WAVs and `analysis.json` to `tools/out/audio/`, and prints:

- peak
- momentary / active RMS
- spectral centroid
- flags: clipping, silence, DC, NaN, clicks

Open `/tools/audio/test.html` under `npm run dev` to audition everything live.
