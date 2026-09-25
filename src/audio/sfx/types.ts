import type { Out, Rng } from '../dsp';
import type { Surface } from './layers';

export interface RP {
  sr: number;
  r: Rng;
  variant: number;
  surface: Surface;
}
export type Recipe = (p: RP) => Out;
