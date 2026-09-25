// Parallel SDF meshing: fans mesh jobs out to Web Workers while the main
// thread builds the world, then primes meshSdf's cache with the results.
// Any failure simply falls back to meshing synchronously on demand.
import { meshJobKey, primeMesh, type MeshData, type MeshJob } from './sdf';

/** Starts meshing all groups (in priority order); returns one promise per group. */
export function prefetchMeshes(groups: MeshJob[][]): Promise<void>[] {
  const jobs = groups.flatMap((g, gi) => g.map((job) => ({ job, gi, key: meshJobKey(job) })));
  const pending = groups.map((g) => g.length);
  const resolvers: (() => void)[] = [];
  const out = groups.map((_, gi) => new Promise<void>((r) => (resolvers[gi] = r)));
  const done = (gi: number) => {
    if (--pending[gi] <= 0) resolvers[gi]();
  };
  const failAll = () => resolvers.forEach((r) => r());
  groups.forEach((g, gi) => g.length === 0 && resolvers[gi]());
  if (typeof Worker === 'undefined' || jobs.length === 0) {
    failAll();
    return out;
  }
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const n = Math.min(jobs.length, cores, 6);
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./sdfWorker.ts', import.meta.url), { type: 'module' }));
  } catch {
    for (const w of workers) w.terminate();
    failAll();
    return out;
  }
  const queue = jobs.slice();
  for (const w of workers) {
    const next = () => {
      const item = queue.shift();
      if (!item) return w.terminate();
      w.onmessage = (e: MessageEvent<{ id: number; d: MeshData }>) => {
        primeMesh(item.key, e.data.d);
        done(item.gi);
        next();
      };
      w.onerror = () => {
        // Give up on this worker; its job (and the rest) mesh on demand.
        done(item.gi);
        w.terminate();
        failAll();
      };
      w.postMessage({ id: 0, job: item.job });
    };
    next();
  }
  return out;
}
