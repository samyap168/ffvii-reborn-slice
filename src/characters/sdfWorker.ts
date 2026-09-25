// Worker: meshes one SDF job and transfers the typed arrays back.
import { meshSdfRaw, type MeshJob } from './sdf';

self.onmessage = (e: MessageEvent<{ id: number; job: MeshJob }>) => {
  const { id, job } = e.data;
  const d = meshSdfRaw(job.model, job.cell, job.opts);
  const buffers = [d.positions, d.normals, d.colors, d.pbr, d.skinIndex, d.skinWeight, d.index].map((a) => a.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ id, d }, buffers);
};
