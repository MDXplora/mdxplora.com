// A two-dimensional Lennard-Jones fluid.
//
// Reduced units throughout (sigma = epsilon = mass = 1). Velocity Verlet with a
// weak velocity-rescaling thermostat, periodic boundaries, and a cell list so
// each step costs time proportional to the number of particles. Used live
// behind the home page hero and, with a fixed seed, for the link preview images.

export const CUTOFF = 2.5;
/** Neighbours closer than this are drawn joined. */
export const BOND = 1.25;
/**
 * Just below the critical temperature of the 2D fluid truncated at 2.5 sigma
 * (about 0.46), near its critical density, so droplets nucleate and grow.
 */
export const TEMPERATURE = 0.45;
export const DENSITY = 0.35;
/** A cluster of at least this many atoms is drawn as a droplet rather than vapour. */
export const DROPLET = 10;

const DT = 0.004;
const MAX_FORCE = 80;
const CUT2 = CUTOFF * CUTOFF;

export type Random = () => number;

/** A small, fast, seedable generator (mulberry32), so a fixed seed gives the same fluid every build. */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LJFluid {
  readonly n: number;
  readonly lx: number;
  readonly ly: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  // Cells at least one cutoff wide, so neighbours are in the 3 x 3 block.
  private readonly cx: number;
  private readonly cy: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  /** A soft repulsive probe, in sigma, or null for none. */
  probe: { x: number; y: number } | null = null;

  constructor(lx: number, ly: number, n: number, random: Random = Math.random) {
    this.lx = Math.max(lx, 3 * CUTOFF);
    this.ly = Math.max(ly, 3 * CUTOFF);
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.cx = Math.max(3, Math.floor(this.lx / CUTOFF));
    this.cy = Math.max(3, Math.floor(this.ly / CUTOFF));
    this.head = new Int32Array(this.cx * this.cy);
    this.next = new Int32Array(n);

    const gaussian = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
    // A jittered lattice, so no two particles start overlapping.
    const cols = Math.ceil(Math.sqrt((n * this.lx) / this.ly));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      this.x[i] = ((i % cols) + 0.5 + (random() - 0.5) * 0.3) * (this.lx / cols);
      this.y[i] = (Math.floor(i / cols) + 0.5 + (random() - 0.5) * 0.3) * (this.ly / rows);
      this.vx[i] = gaussian() * Math.sqrt(TEMPERATURE);
      this.vy[i] = gaussian() * Math.sqrt(TEMPERATURE);
    }
    this.removeDrift();
    this.forces();
  }

  /** Advances the fluid by `steps` time steps. */
  step(steps = 1) {
    const { n, x, y, vx, vy, fx, fy, lx, ly } = this;
    const half = 0.5 * DT;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        vx[i] += half * fx[i];
        vy[i] += half * fy[i];
        x[i] = (((x[i] + DT * vx[i]) % lx) + lx) % lx;
        y[i] = (((y[i] + DT * vy[i]) % ly) + ly) % ly;
      }
      this.forces();
      let kinetic = 0;
      for (let i = 0; i < n; i++) {
        vx[i] += half * fx[i];
        vy[i] += half * fy[i];
        kinetic += vx[i] * vx[i] + vy[i] * vy[i];
      }
      // Weak coupling to the target temperature (2 degrees of freedom each).
      const current = kinetic / (2 * n);
      const scale = Math.sqrt(1 + 0.02 * (TEMPERATURE / Math.max(current, 1e-6) - 1));
      for (let i = 0; i < n; i++) {
        vx[i] *= scale;
        vy[i] *= scale;
      }
    }
  }

  /**
   * Calls visit(i, j, r2) for every pair closer than BOND that does not cross
   * the periodic edge (the pairs worth drawing), and returns, for each atom,
   * how many atoms are in its cluster: atoms joined by bonds, across the edge
   * too. One pass over the pairs does both.
   */
  bonds(visit: (i: number, j: number, r2: number) => void = () => {}): Int32Array {
    const { n, x, y } = this;
    const bond2 = BOND * BOND;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const root = (i: number) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    this.bin();
    this.pairs((i, j, _dx, _dy, r2) => {
      if (r2 > bond2) return;
      const a = root(i);
      const b = root(j);
      if (a !== b) parent[a] = b;
      if (Math.abs(x[i] - x[j]) > BOND || Math.abs(y[i] - y[j]) > BOND) return;
      visit(i, j, r2);
    });
    const count = new Int32Array(n);
    for (let i = 0; i < n; i++) count[root(i)]++;
    const size = new Int32Array(n);
    for (let i = 0; i < n; i++) size[i] = count[root(i)];
    return size;
  }

  private removeDrift() {
    const { n, vx, vy } = this;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += vx[i];
      sy += vy[i];
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= sx / n;
      vy[i] -= sy / n;
    }
  }

  private bin() {
    const { n, x, y, lx, ly, cx, cy, head, next } = this;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const c = Math.min(cx - 1, Math.floor((x[i] / lx) * cx)) + cx * Math.min(cy - 1, Math.floor((y[i] / ly) * cy));
      next[i] = head[c];
      head[c] = i;
    }
  }

  // Calls visit(i, j, dx, dy, r2) once for every pair closer than the cutoff.
  private pairs(visit: (i: number, j: number, dx: number, dy: number, r2: number) => void) {
    const { x, y, lx, ly, cx, cy, head, next } = this;
    for (let a = 0; a < cx; a++) {
      for (let b = 0; b < cy; b++) {
        for (let i = head[a + cx * b]; i >= 0; i = next[i]) {
          for (let da = -1; da <= 1; da++) {
            for (let db = -1; db <= 1; db++) {
              const c = ((a + da + cx) % cx) + cx * ((b + db + cy) % cy);
              for (let j = head[c]; j >= 0; j = next[j]) {
                if (j <= i) continue;
                let dx = x[i] - x[j];
                let dy = y[i] - y[j];
                dx -= lx * Math.round(dx / lx);
                dy -= ly * Math.round(dy / ly);
                const r2 = dx * dx + dy * dy;
                if (r2 < CUT2 && r2 > 1e-6) visit(i, j, dx, dy, r2);
              }
            }
          }
        }
      }
    }
  }

  private forces() {
    const { n, x, y, fx, fy, lx, ly, probe } = this;
    fx.fill(0);
    fy.fill(0);
    this.bin();
    this.pairs((i, j, dx, dy, r2) => {
      const inv2 = 1 / r2;
      const inv6 = inv2 * inv2 * inv2;
      const f = Math.min(MAX_FORCE, 24 * inv2 * inv6 * (2 * inv6 - 1));
      fx[i] += f * dx;
      fy[i] += f * dy;
      fx[j] -= f * dx;
      fy[j] -= f * dy;
    });
    if (!probe) return;
    for (let i = 0; i < n; i++) {
      let dx = x[i] - probe.x;
      let dy = y[i] - probe.y;
      dx -= lx * Math.round(dx / lx);
      dy -= ly * Math.round(dy / ly);
      const r2 = dx * dx + dy * dy;
      if (r2 < 36) {
        const g = 12 * Math.exp(-r2 / 8);
        fx[i] += g * dx;
        fy[i] += g * dy;
      }
    }
  }
}
