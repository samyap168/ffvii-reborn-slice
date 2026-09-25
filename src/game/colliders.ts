// Circle colliders in a uniform spatial hash (trees, rocks, ruins).
export interface Circle {
  x: number;
  z: number;
  r: number;
}

export class ColliderGrid {
  private cells = new Map<number, Circle[]>();
  constructor(private cell = 16) {}
  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  add(c: Circle) {
    const i0 = Math.floor((c.x - c.r) / this.cell),
      i1 = Math.floor((c.x + c.r) / this.cell);
    const j0 = Math.floor((c.z - c.r) / this.cell),
      j1 = Math.floor((c.z + c.r) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(c);
      }
  }
  /** Push a circle (x,z,r) out of all overlapping colliders. Returns the corrected position. */
  resolve(x: number, z: number, r: number): { x: number; z: number; hit: boolean } {
    let hit = false;
    for (let it = 0; it < 3; it++) {
      const i = Math.floor(x / this.cell),
        j = Math.floor(z / this.cell);
      let moved = false;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const l = this.cells.get(this.key(i + di, j + dj));
          if (!l) continue;
          for (const c of l) {
            const dx = x - c.x,
              dz = z - c.z;
            const d = Math.hypot(dx, dz);
            const min = r + c.r;
            if (d < min && d > 1e-5) {
              x = c.x + (dx / d) * min;
              z = c.z + (dz / d) * min;
              moved = hit = true;
            }
          }
        }
      if (!moved) break;
    }
    return { x, z, hit };
  }
}
