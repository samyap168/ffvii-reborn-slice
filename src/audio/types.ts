export interface V3 { x: number; y: number; z: number }
export type Surface = 'grass' | 'dirt' | 'stone' | 'water' | 'sand';
export interface PlayOpts {
  position?: V3;
  volume?: number;
  pitch?: number;
  intensity?: number;
  surface?: Surface;
  variant?: number;
  delay?: number;
}
export interface LoopHandle {
  setPosition(p: V3): void;
  setParam(name: string, value: number): void;
  setVolume(v: number, ramp?: number): void;
  stop(fade?: number): void;
}
export type MusicState =
  | 'silence' | 'title' | 'explore' | 'encounter' | 'battle' | 'boss' | 'enrage' | 'limit' | 'kor' | 'victory' | 'aftermath';
export interface MusicDirector {
  setState(s: MusicState, opts?: { fade?: number; immediate?: boolean }): void;
  readonly state: MusicState;
  setIntensity(v: number): void;
  cue(name: string): void;
  duck(amount: number, seconds: number): void;
}
export interface UpdateState {
  windStrength: number;
  playerSpeed: number;
  inCombat: boolean;
  weather: number;
  nearWater: number;
  timeScale: number;
}
