// featureGrid.js — the body-anchored (u,v) feature lattice + the marking CA.
//
// PHASE 1 of the CA feature system (see research/ca-feature-placement.md — THE
// SPEC). This module owns two things:
//
//   1. buildFeatureGrid(bones)  — a graph CA lattice derived DETERMINISTICALLY
//      from the fixed-topology skeleton (`group.userData.skeleton`). Cells are
//      keyed to the stable spine_00..23 / tail_00..11 (+ head) bones as
//      (rail segment u  ×  angular sector v), staggered ring-to-ring for hex-like
//      6-neighbour adjacency. Each cell carries a STABLE identity
//      (boneName, ring, sector), a world surface position + outward normal + a
//      tangent frame, an approximate cell area, and a body-region tag. Because the
//      bone NAME SET never changes, cell N is "the same cell" on every genome and
//      every age — so patterns are directly comparable / breed-able, and the grid
//      reconstructs identically anywhere.
//
//   2. runMarkingCA(grid, genome, age) — an activator–inhibitor cellular automaton
//      (a discrete Young/Turing "short-range activation, long-range inhibition"
//      relaxation) run on the lattice graph. It produces a smooth COLOR channel per
//      cell (spots ↔ stripes via kernel anisotropy). Age is the CA clock: the
//      number of generations grows with age, so markings EMERGE and STRENGTHEN as
//      the dragon matures (cute → cool). Fully deterministic from (genome, age)
//      via a genome-seeded mulberry32 PRNG — no Math.random / Date.now — so it is
//      serializable and breeding-safe.
//
// Applying the CA output:
//   - applyMarkingColors(geometry, grid, state, p)  — writes a per-vertex `color`
//     BufferAttribute on the smooth marching-cubes body mesh (nearest-cells
//     interpolation). The caller flips material.vertexColors on.
//   - markingColorForPoint(x,y,z, grid, state, p)   — per-point tint used for the
//     voxel per-cube path (voxel.js opts.cubeTint).
//   - buildGridOverlay(grid)  — a THREE.Points debug cloud at cell centres, tinted
//     by region, toggled by window.__showGrid (mirrors window.__showRig).
//
// TODO(phase2): DISCRETE surface geometry (dorsal spikes, crest sail, feathers,
// scutes) is NOT built here yet. It will read THIS SAME grid + a thresholded
// activator channel from runMarkingCA (a peak channel per cell). Clear hooks are
// marked `// TODO(phase2)` below.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + a small integer hash. All stochastic choices
// in the CA draw from these seeded from genome.patternSeed — never Math.random.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// hash two ints -> 32-bit uint (for per-cell seeds keyed by (patternSeed, cellId)).
export function hash2(a, b) {
  let h = (a >>> 0) ^ Math.imul((b >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

// Region -> debug overlay colour (also used to bias phase-2 feature weights).
export const REGION_COLORS = {
  dorsal: 0xff5a4d, flank: 0x63d16b, belly: 0x4d8bff,
  neck: 0xffd23f, tail: 0xd65cff, head: 0x38d6d6, limb: 0xeeeeee,
};

// Sector counts per rail. Constant-K within a rail keeps within-ring adjacency
// trivial; cell AREA still varies (thin neck/tail -> small cells) because radius
// and segment length vary, giving the "variable cell size" the spec asks for.
// Cross-rail / cross-K junctions use nearest-in-3D adjacency so differing K is fine.
// Denser rings => finer cells => crisper, harder-edged spots/stripes (the coarse
// ~12-sector grid read as soft watercolour). Kept even so the odd-ring brick
// stagger (π/K) still lands halfway for hex adjacency. The axial rail already has
// 36 rings along u, so raising K sharpens the circumferential (spot/stripe) detail
// most. Spike placement (features.js) rejects by PHYSICAL radius, not cell count,
// so denser cells do not change spike spacing (re-verified).
const K_AXIAL = 22;
const K_SKULL = 18;
const K_SNOUT = 14;

const EPS = 0.012;

// ---------------------------------------------------------------------------
// buildFeatureGrid(bones, opts) -> grid
// ---------------------------------------------------------------------------
// grid = {
//   cells: [ { id, rail, ringInRail, sector, boneName, u,            // u = global
//              pos:Vec3, normal:Vec3, tangent:Vec3, radius, segLen, area,
//              region, theta } ],
//   adj:      Array<number[]>,   // neighbour cell-id lists (hex 6-ish + junctions)
//   byAnchor: { midBack, tailBase, tailTip, neckBack, hipsL/R, shouldersL/R,
//               headTop, snoutTip, bellyMid },
//   K, rails
// }
export function buildFeatureGrid(bones, opts = {}) {
  const byName = {};
  for (const b of bones) byName[b.name] = b;

  const cells = [];
  const _up = new THREE.Vector3(0, 1, 0);
  const _z = new THREE.Vector3(0, 0, 1);

  // Build one ring of K cells at a bone's `pos`, oriented by pos->tail (or the
  // provided axis). Returns the array of created cell ids (in sector order).
  const addRing = (opts2) => {
    const { bone, rail, ringInRail, K, radiusScale = 1.0, stagger = 0 } = opts2;
    const pos = bone.pos;
    // ring axis: prefer pos->tail; fall back to parent->pos for single-point bones.
    let axis;
    if (bone.tail) axis = bone.tail.clone().sub(pos);
    else if (bone.parent && byName[bone.parent]) axis = pos.clone().sub(byName[bone.parent].pos);
    else axis = _z.clone();
    if (axis.lengthSq() < 1e-9) axis = _z.clone();
    axis.normalize();
    // stable dorsal reference: world-up projected perpendicular to the axis. n
    // points "up" (dorsal) so sector 0-ish is the back; degenerate (vertical
    // axis) falls back to world-Z.
    let n = _up.clone().sub(axis.clone().multiplyScalar(_up.dot(axis)));
    if (n.lengthSq() < 1e-6) n = _z.clone().sub(axis.clone().multiplyScalar(_z.dot(axis)));
    n.normalize();
    const bx = new THREE.Vector3().crossVectors(axis, n).normalize();
    const radius = Math.max(EPS, bone.envelopeRadius) * radiusScale;
    const segLen = bone.length ?? radius;
    const area = (2 * Math.PI * radius / K) * Math.max(radius, segLen);
    const ids = [];
    for (let s = 0; s < K; s++) {
      const theta = (2 * Math.PI * s) / K + stagger;
      const ct = Math.cos(theta), st = Math.sin(theta);
      const nrm = n.clone().multiplyScalar(ct).add(bx.clone().multiplyScalar(st)).normalize();
      const p = pos.clone().add(nrm.clone().multiplyScalar(radius));
      // tangent along the rail axis (feather/scale grooming direction, phase 2).
      const tangent = axis.clone();
      const region = classifyRegion(rail, ringInRail, nrm);
      const id = cells.length;
      cells.push({
        id, rail, ringInRail, sector: s, boneName: bone.name,
        pos: p, normal: nrm, tangent, radius, segLen, area, region, theta,
      });
      ids.push(id);
    }
    return ids;
  };

  // ---- AXIAL rail: spine_00..spine_23 then tail_00..tail_11 (one long tube) ---
  const axialRings = [];   // array of id-arrays, one per ring, in u order
  let u = 0;
  const axialBones = [];
  for (let i = 0; i < 24; i++) axialBones.push(byName[`spine_${String(i).padStart(2, '0')}`]);
  for (let j = 0; j < 12; j++) axialBones.push(byName[`tail_${String(j).padStart(2, '0')}`]);
  axialBones.forEach((bone, r) => {
    if (!bone) return;
    const ids = addRing({ bone, rail: 'axial', ringInRail: r, K: K_AXIAL,
      stagger: (r % 2) ? Math.PI / K_AXIAL : 0 });   // brick-offset odd rings -> hex
    for (const id of ids) cells[id].u = u;
    axialRings.push(ids);
    u++;
  });

  // ---- HEAD rail: skull + snout (mini-rail; junctions to spine_00). ----------
  const headRings = [];
  const skull = byName['skull'];
  if (skull) {
    const ids = addRing({ bone: skull, rail: 'head', ringInRail: 0, K: K_SKULL, radiusScale: 0.98 });
    headRings.push(ids);
  }
  const snout = byName['snout'];
  if (snout) {
    const ids = addRing({ bone: snout, rail: 'head', ringInRail: 1, K: K_SNOUT });
    headRings.push(ids);
  }
  // TODO(phase2): add limb sub-rails (foreL/R, hindL/R upper/lower bones) and a
  // belly-scute sub-lattice as additional rings + junction edges here, reusing
  // addRing(). Region 'limb' is already reserved in REGION_COLORS. Kept out of
  // phase 1 so the trunk grid stays robust and cheap.

  // ---- adjacency ------------------------------------------------------------
  const adj = cells.map(() => []);
  const link = (a, b) => {
    if (a === b) return;
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  };
  // within-ring ring neighbours (sector +-1), and cross-ring nearest-2 (staggered
  // -> two neighbours in each adjacent ring => hex-like 6-neighbourhood).
  const ringNeighbours = (ringsArr) => {
    for (let r = 0; r < ringsArr.length; r++) {
      const ring = ringsArr[r];
      const K = ring.length;
      for (let s = 0; s < K; s++) link(ring[s], ring[(s + 1) % K]);
      if (r + 1 < ringsArr.length) linkNearest(ring, ringsArr[r + 1], 2);
    }
  };
  const linkNearest = (ringA, ringB, count) => {
    for (const a of ringA) {
      const pa = cells[a].pos;
      const sorted = ringB.slice().sort((x, y) =>
        pa.distanceToSquared(cells[x].pos) - pa.distanceToSquared(cells[y].pos));
      for (let n = 0; n < Math.min(count, sorted.length); n++) link(a, sorted[n]);
    }
  };
  ringNeighbours(axialRings);
  ringNeighbours(headRings);
  // junction: head skull ring <-> spine_00 ring (nearest-2 both ways).
  if (headRings.length && axialRings.length) linkNearest(headRings[0], axialRings[0], 2);

  // ---- anchor cells (stable named seeds; scanned by extremal normal) ---------
  const topOf = (ring) => ring.reduce((best, id) =>
    cells[id].normal.y > cells[best].normal.y ? id : best, ring[0]);
  const botOf = (ring) => ring.reduce((best, id) =>
    cells[id].normal.y < cells[best].normal.y ? id : best, ring[0]);
  const sideOf = (ring, sign) => ring.reduce((best, id) =>
    sign * cells[id].normal.x > sign * cells[best].normal.x ? id : best, ring[0]);
  const A = {};
  const axRing = (r) => axialRings[r] || axialRings[axialRings.length - 1];
  A.neckBack = topOf(axRing(5));
  A.shouldersL = sideOf(axRing(6), -1); A.shouldersR = sideOf(axRing(6), 1);
  A.midBack = topOf(axRing(13));
  A.bellyMid = botOf(axRing(13));
  A.hipsL = sideOf(axRing(20), -1); A.hipsR = sideOf(axRing(20), 1);
  A.tailBase = topOf(axRing(24));
  A.tailTip = topOf(axRing(axialRings.length - 1));
  if (headRings.length) A.headTop = topOf(headRings[0]);
  if (headRings.length > 1) A.snoutTip = topOf(headRings[1]);

  return { cells, adj, byAnchor: A, K: K_AXIAL,
    rails: { axial: axialRings, head: headRings } };
}

function classifyRegion(rail, ringInRail, normal) {
  if (rail === 'head') return 'head';
  if (rail === 'tail') return 'tail';
  // axial: neck is the first 6 rings; else split by the outward normal's up/down.
  if (ringInRail < 6) return 'neck';
  if (ringInRail >= 24) return 'tail';
  if (normal.y > 0.45) return 'dorsal';
  if (normal.y < -0.45) return 'belly';
  return 'flank';
}

// ---------------------------------------------------------------------------
// Anisotropic neighbourhood precompute (for spots vs stripes).
// ---------------------------------------------------------------------------
// Weighted BFS from each cell gathering cells within an accumulated cost <= R.
// Circumferential edges (same ring: |Δring| == 0) cost 1; axial edges (different
// ring) cost `axCost`. For SPOTS axCost≈1 (isotropic disc). For STRIPES axCost is
// large so the inhibitor field spreads mostly AROUND the body -> the pattern
// varies circumferentially and is uniform along the axis => longitudinal stripes.
function neighbourhood(grid, start, R, axCost) {
  const { cells, adj } = grid;
  const dist = new Map();
  dist.set(start, 0);
  // simple Dijkstra (tiny graphs) — costs are small integers-ish.
  const frontier = [[0, start]];
  const out = [];
  while (frontier.length) {
    // pop min
    let mi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[mi][0]) mi = i;
    const [d, c] = frontier.splice(mi, 1)[0];
    if (d > dist.get(c)) continue;
    out.push(c);
    for (const nb of adj[c]) {
      const sameRing = cells[nb].rail === cells[c].rail && cells[nb].ringInRail === cells[c].ringInRail;
      const w = sameRing ? 1 : axCost;
      const nd = d + w;
      if (nd <= R && (!dist.has(nb) || nd < dist.get(nb))) {
        dist.set(nb, nd);
        frontier.push([nd, nb]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// runMarkingCA(grid, genome, age, env) -> { color:Float32Array, peak:Float32Array }
// ---------------------------------------------------------------------------
// The activator–inhibitor colour CA. Pure function of (genome, age): the seed and
// every stochastic value come from mulberry32(hash2(patternSeed, cellId)); the
// generation count grows with age so the pattern emerges & sharpens as the dragon
// matures. `color` in [0,1] is the marking mask (0 = base body colour, 1 = full
// marking). `peak` is a thresholded activator channel reserved for phase-2
// discrete features (spike/scute placement) — NOT consumed yet.
export function runMarkingCA(grid, genome, age = 0, env = {}) {
  const g = genome || {};
  const n = grid.cells.length;
  const color = new Float32Array(n);
  const peak = new Float32Array(n);
  if (n === 0) return { color, peak };

  const seed = ((g.patternSeed ?? 0) >>> 0) || 1;
  const contrast = g.markingContrast ?? 0.4;
  const scale = clamp01(g.markingScale ?? 0.5);
  const type = clamp01(g.markingType ?? 0.5);       // 0 spots .. 1 stripes
  const plasticity = g.featurePlasticity ?? 1.0;

  // wavelength: high markingScale => fine speckle => small inhibitor radius.
  const R1 = 1;                                       // activator radius (hops)
  const R2 = Math.round(lerp(4, 2, scale));          // inhibitor radius (hops)
  const axCost = lerp(1.0, 3.0, type);               // stripe anisotropy

  // Age is the CA clock. G generations from the seed; 0 at birth -> plain baby.
  const Gmax = 42;
  const a = clamp01(age);
  const G = Math.max(0, Math.round(a * Gmax * clamp01(plasticity / 2.2)));

  // seeded initial concentrations: SMALL symmetry-breaking noise centred at 0.5.
  // Small (not full-range) so that at age 0 (G=0) the field is ~uniform => a plain
  // pastel baby with no coherent markings; the CA then AMPLIFIES this noise into
  // spaced spots/stripes as generations (age) accumulate => markings emerge.
  const conc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const rng = mulberry32(hash2(seed, i));
    conc[i] = 0.5 + (rng() - 0.5) * 0.16;
  }

  // precompute activator / inhibitor neighbourhoods (depend only on grid + params)
  const actN = new Array(n);
  const inhN = new Array(n);
  for (let i = 0; i < n; i++) {
    actN[i] = neighbourhood(grid, i, R1, 1.0);
    inhN[i] = neighbourhood(grid, i, R2, axCost);
  }

  // Young/Turing relaxation: short-range activation - long-range inhibition,
  // contrast-enhanced each generation. Converges to spaced spots / bands (a
  // blue-noise-like distribution) in a few dozen iterations.
  const amp = 3.2;
  const rate = 0.55;
  const next = new Float32Array(n);
  for (let gen = 0; gen < G; gen++) {
    for (let i = 0; i < n; i++) {
      let as = 0, ac = 0;
      const A = actN[i];
      for (let k = 0; k < A.length; k++) { as += conc[A[k]]; ac++; }
      let is = 0, ic = 0;
      const I = inhN[i];
      for (let k = 0; k < I.length; k++) { is += conc[I[k]]; ic++; }
      const w = (as / ac) - (is / ic);              // activator - inhibitor
      const target = clamp01(0.5 + amp * w);
      next[i] = clamp01(conc[i] + rate * (target - conc[i]));
    }
    conc.set(next);
  }

  // Map converged concentration to the marking mask + a peak channel. `contrast`
  // (already age-ramped by phenotype) sharpens the mask around 0.5. Steeper than
  // before so each cell reads as a near-solid spot/stripe (hard edges, not a wash).
  const sharp = lerp(2.4, 11.0, clamp01(contrast));
  for (let i = 0; i < n; i++) {
    const v = clamp01(0.5 + (conc[i] - 0.5) * sharp);
    color[i] = v;
    // TODO(phase2): `peak` = thresholded activator maxima for discrete features.
    // A cell is a feature seed when its concentration is a strong local maximum.
    peak[i] = smoothstep((conc[i] - 0.72) / 0.28);
  }
  return { color, peak };
}

// ---------------------------------------------------------------------------
// Colour helpers — combine body base colour + marking colour by the mask.
// ---------------------------------------------------------------------------
function baseAndMarkColors(p) {
  const base = new THREE.Color().setHSL(p.hue, p.sat, p.light);
  // marking hue offset from body hue; a touch darker so it reads on the body.
  const mh = ((p.hue + (p.markingHue ?? 0.0)) % 1 + 1) % 1;
  const mark = new THREE.Color().setHSL(mh, clamp01(p.sat * 1.05), clamp01(p.light * 0.62));
  return { base, mark };
}

// Build a small acceleration structure: cell positions as flat array for nearest
// lookups. (Grids are ~450 cells; brute-force nearest is fine for a one-time bake.)
function cellPositions(grid) {
  const n = grid.cells.length;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = grid.cells[i].pos;
    arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
  }
  return arr;
}

// Edge-hardening for the sampled mask: steepen values around 0.5 so the boundary
// between marking and base is crisp (hard-edged spots/stripes) instead of a soft
// gradient. >1 = harder edges; combined with the denser grid this kills the
// watercolour wash while the small residual slope still anti-aliases the mesh.
const MASK_EDGE = 3.4;
function hardenMask(m) { return clamp01(0.5 + (m - 0.5) * MASK_EDGE); }

// Interpolated marking value at an arbitrary point via inverse-distance blend of
// the K nearest cells, STRONGLY biased to the nearest (1/d^4) so each cell reads
// as a distinct spot with a crisp boundary rather than a smeared blend, then
// edge-hardened. The small blend still avoids raw blocky per-cell aliasing.
function sampleMask(x, y, z, grid, color, cellPos, K = 3) {
  const n = grid.cells.length;
  // find K nearest (tiny K, tiny n -> partial selection is cheap)
  const idx = new Int32Array(K).fill(-1);
  const d2 = new Float64Array(K).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const dx = x - cellPos[i * 3], dy = y - cellPos[i * 3 + 1], dz = z - cellPos[i * 3 + 2];
    const dd = dx * dx + dy * dy + dz * dz;
    // insertion into the K-best
    if (dd < d2[K - 1]) {
      let s = K - 1;
      while (s > 0 && d2[s - 1] > dd) { d2[s] = d2[s - 1]; idx[s] = idx[s - 1]; s--; }
      d2[s] = dd; idx[s] = i;
    }
  }
  let wsum = 0, msum = 0;
  for (let k = 0; k < K; k++) {
    if (idx[k] < 0) continue;
    const dd = d2[k] + 1e-4;
    const w = 1 / (dd * dd);          // 1/d^4 -> hard bias to the nearest cell
    wsum += w; msum += w * color[idx[k]];
  }
  return wsum > 0 ? hardenMask(msum / wsum) : 0;
}

// ---------------------------------------------------------------------------
// applyMarkingColors(geometry, grid, state, p) — per-vertex colours on the smooth
// marching-cubes body mesh. Sets a `color` BufferAttribute; the caller must flip
// material.vertexColors = true (and set material.color white so the vertex colour
// is the final albedo). No shader, no texture — serializable & breed-able.
// ---------------------------------------------------------------------------
export function applyMarkingColors(geometry, grid, state, p) {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return;
  const nv = posAttr.count;
  const { base, mark } = baseAndMarkColors(p);
  const contrast = clamp01(p.markingContrast ?? 0.0);
  const cellPos = cellPositions(grid);
  const colors = new Float32Array(nv * 3);
  const c = new THREE.Color();
  for (let v = 0; v < nv; v++) {
    const x = posAttr.getX(v), y = posAttr.getY(v), z = posAttr.getZ(v);
    const m = sampleMask(x, y, z, grid, state.color, cellPos) * contrast;
    c.copy(base).lerp(mark, m);
    colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

// Per-point tint (voxel per-cube path). Returns a THREE.Color for a world point.
export function markingColorForPoint(x, y, z, grid, state, p, cellPos, out = new THREE.Color()) {
  const { base, mark } = baseAndMarkColors(p);
  const contrast = clamp01(p.markingContrast ?? 0.0);
  const m = sampleMask(x, y, z, grid, state.color, cellPos) * contrast;
  return out.copy(base).lerp(mark, m);
}
// expose the position-cache builder for the voxel tint closure.
export { cellPositions };

// ---------------------------------------------------------------------------
// buildGridOverlay(grid) — debug THREE.Points cloud at cell centres, tinted by
// region. Toggled by window.__showGrid (mirrors window.__showRig). Lets us verify
// the lattice sits on the body and that anchor identities are stable.
// ---------------------------------------------------------------------------
export function buildGridOverlay(grid) {
  const n = grid.cells.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  const anchorIds = new Set(Object.values(grid.byAnchor));
  for (let i = 0; i < n; i++) {
    const cell = grid.cells[i];
    // nudge dots a hair outward so they float just above the surface.
    const p = cell.pos.clone().add(cell.normal.clone().multiplyScalar(cell.radius * 0.06));
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    // anchors render white so they stand out; others by region.
    if (anchorIds.has(i)) c.setRGB(1, 1, 1);
    else c.setHex(REGION_COLORS[cell.region] ?? 0xffffff);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.075, vertexColors: true, sizeAttenuation: true,
    depthTest: false, transparent: true, opacity: 0.95,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'gridDebug';
  pts.renderOrder = 998;
  return pts;
}
