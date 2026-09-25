// Small TSL helpers shared across shaders.
import { smoothstep, float } from 'three/tsl';

/** smoothstep that tolerates reversed edges (a > b), which GPU drivers treat as undefined. */
export const sstep = (a: number, b: number, x: any): any => (a <= b ? smoothstep(a, b, x) : float(1).sub(smoothstep(b, a, x)));
