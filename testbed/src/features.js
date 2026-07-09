// features.js — PHASE 2 of the CA feature system: DISCRETE surface geometry
// (dorsal spikes / ridge, crest sail, feathers, scutes) instanced off the SAME
// body-anchored (u,v) lattice that phase 1 (featureGrid.js) built for markings.
//
// See research/ca-feature-placement.md (THE SPEC), §D "Rendering" and §C genome
// traits. Design invariants this module keeps:
//
//   * SEPARATE, LAYERED, MERGED meshes — features are their own THREE.Group added
//     to the dragon (like the wing membrane), NEVER fed through the implicit field,
//     so the body stays thin/clean and thin features stay crisp in every skin mode.
//   * Each feature is placed at a cell's surface point, oriented by cell.normal
//     (outward) with a backward tilt along cell.tangent, and TAGGED to its cell's
//     stable boneName (userData) — for future animation + geo.json + voxel bake.
//   * DETERMINISTIC + BREEDING-SAFE: every stochastic choice draws from a
//     genome-seeded mulberry32 (patternSeed) — no Math.random / Date.now. Two
//     genomes therefore yield a coherent, reproducible child feature set.
//   * AGE DRIVES EMERGENCE: features are absent/tiny on the baby and grow/sharpen
//     with age via the phenotype age-gates (spikeGrow / featherGrow / scuteGrow),
//     so the cute→cool arc extends to spikes (nubs/absent → grown, sharp).
//   * CELL-SIZE SUPPRESSION: a larger cell `area`/`radius` (fatter body) both
//     lowers a spike's activation (fewer pass threshold) AND widens its lateral-
//     inhibition exclusion radius (wider spacing) — "getting fat suppresses spike
//     growth", implemented explicitly in buildFeatureState().
//
// Split of responsibilities:
//   buildFeatureState(grid, p)      — pure, age-independent SELECTION (which cells
//                                     carry which feature) + per-cell size hints.
//   buildFeatureMeshes(state, p, o) — merged THREE geometry per layer (cones+sail,
//                                     feather cards, scute lenses) OR cheap cube
//                                     stacks when opts.mode === 'voxel'.
//   featureVoxelCubes(state, p)     — world-space {origin,size,boneName} cubes for
//                                     the voxel skin + geo.json (spikes→1–2 cubes,
//                                     sail→thin cuboid run). Bakes to geo.json.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2 } from './featureGrid.js';
import * as MAT from './materials.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const _Y = new THREE.Vector3(0, 1, 0);

// Tuning constants (world units; 1 unit == 1 MC block). Calibrated against the
// trunk cell radii (~0.5 lean .. ~1.3 fat) and spine ring spacing (~0.15–0.3).
const SPIKE_SPACING_BASE = 0.42;  // base lateral-inhibition exclusion distance
const SPIKE_HEIGHT_BASE = 0.55;   // base cone height at spikeAmount~1
const FEATHER_LEN_BASE = 0.55;    // base feather card length at featherLength~1
const SCUTE_R_BASE = 0.26;        // base scute lens radius at scaleSize~1

// ---------------------------------------------------------------------------
// Region / dorsal weighting helpers.
// ---------------------------------------------------------------------------
// Dorsal-ness from the cell's outward-normal.y. bias 0 => strictly the back
// ridge (ny near 1); bias 1 => spreads down onto the flanks/limbs. The spine
// ridge (neck→trunk→tail top sectors) always scores highest.
function dorsalWeight(ny, bias) {
  const lo = lerp(0.5, -0.15, clamp01(bias));
  return clamp01((ny - lo) / (1.02 - lo));
}
// Feather tract weighting: bias 0 = neck/shoulder ruff, bias 1 = tail (+wing-arm,
// once limb sub-rails exist). Dorsal/flank get a moderate coat.
function featherRegionWeight(region, bias) {
  switch (region) {
    case 'neck': return lerp(1.0, 0.3, bias);
    case 'tail': return lerp(0.2, 1.0, bias);
    case 'dorsal': return 0.55;
    case 'flank': return 0.4;
    case 'belly': return 0.12;
    default: return 0;   // head/limb: none for now
  }
}
// Scute plating weighting: belly scutes strongest, flank moderate, a few back plates.
function scuteRegionWeight(region) {
  switch (region) {
    case 'belly': return 1.0;
    case 'flank': return 0.5;
    case 'dorsal': return 0.3;
    case 'tail': return 0.35;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// buildFeatureState(grid, p) -> { spikes, sailCells, feathers, scutes }
// ---------------------------------------------------------------------------
// Pure SELECTION over the lattice from the (age-ramped) phenotype `p`. Which
// cells carry a spike/feather/scute, and per-cell size hints. Age-INDEPENDENT so
// the SAME cells host a feature at every age (features then grow via the age
// gates in buildFeatureMeshes) — stable identity, breeding-safe.
export function buildFeatureState(grid, p) {
  const cells = grid.cells;
  const seed = ((p.patternSeed ?? 0) >>> 0) || 1;

  // ---- SPIKES / dorsal ridge (activator-inhibition, area-suppressed) --------
  const spikeAmount = p.spikeAmount ?? 0;
  const spikeSpacing = p.spikeSpacing ?? 1;
  const spikeBias = p.spikeRegionBias ?? 0.7;
  const spikes = [];
  if (spikeAmount > 0.02) {
    // 1) score every eligible (back-facing, non-head/limb) cell.
    const cand = [];
    for (const c of cells) {
      if (c.region === 'head' || c.region === 'limb') continue;
      const dw = dorsalWeight(c.normal.y, spikeBias);
      if (dw <= 0.001) continue;
      const rng = mulberry32(hash2(seed ^ 0x51de, c.id));
      const jitter = 0.8 + rng() * 0.4;
      // CELL-SIZE SUPPRESSION #1: bigger (fatter) cells lower the activation, so
      // fewer clear the threshold — a fat body grows fewer spikes.
      const areaSup = clamp01(1.18 - c.radius * 0.62);
      const score = spikeAmount * dw * areaSup * jitter;
      if (score < 0.18) continue;
      cand.push({ c, score });
    }
    // 2) greedy blue-noise placement: highest score first, reject any cell within
    //    a physical exclusion radius of an already-accepted spike (lateral
    //    inhibition => even spacing). CELL-SIZE SUPPRESSION #2: the exclusion
    //    radius grows with the cell radius, so a fatter body spaces spikes wider.
    cand.sort((a, b) => b.score - a.score || a.c.id - b.c.id);
    const accepted = [];
    for (const { c, score } of cand) {
      const excl = SPIKE_SPACING_BASE * spikeSpacing * (0.3 + 1.25 * c.radius);
      let ok = true;
      for (const s of accepted) {
        if (s.cell.pos.distanceTo(c.pos) < excl) { ok = false; break; }
      }
      if (!ok) continue;
      accepted.push({ cell: c, score });
    }
    for (const a of accepted) {
      const c = a.cell;
      spikes.push({
        cellId: c.id, boneName: c.boneName, u: c.u ?? 0,
        pos: c.pos, normal: c.normal, tangent: c.tangent, radius: c.radius,
        score: a.score, dorsal: c.normal.y > 0.5,
      });
    }
  }
  // Sail ridge line: the single MOST-dorsal spike per axial ring (u), ordered
  // along the body — the crest sail spans consecutive entries. Picking one per u
  // keeps the fin a clean single ridge instead of zig-zagging across side spikes.
  const bestByU = new Map();
  for (const s of spikes) {
    if (s.normal.y < 0.38) continue;                 // ridge-ish only
    const prev = bestByU.get(s.u);
    if (!prev || s.normal.y > prev.normal.y) bestByU.set(s.u, s);
  }
  const sailCells = [...bestByU.values()].sort((a, b) => a.u - b.u);

  // ---- FEATHERS (region-biased coverage; groomed cards) ---------------------
  const cov = p.featherCoverage ?? 0;
  const featherBias = p.featherRegionBias ?? 0.5;
  const feathers = [];
  if (cov > 0.02) {
    for (const c of cells) {
      const rw = featherRegionWeight(c.region, featherBias);
      if (rw <= 0) continue;
      const rng = mulberry32(hash2(seed ^ 0xfea7, c.id));
      if (rng() > cov * rw) continue;
      feathers.push({
        cellId: c.id, boneName: c.boneName,
        pos: c.pos, normal: c.normal, tangent: c.tangent, radius: c.radius,
        sizeVar: 0.7 + rng() * 0.5,
      });
    }
  }

  // ---- SCUTES / plates (belly + flank + some back plates) -------------------
  const plating = p.scutePlating ?? 0;
  const scutes = [];
  if (plating > 0.02) {
    for (const c of cells) {
      if (c.region === 'head' || c.region === 'limb' || c.region === 'neck') continue;
      const rw = scuteRegionWeight(c.region);
      if (rw <= 0) continue;
      const rng = mulberry32(hash2(seed ^ 0x5c07, c.id));
      if (rng() > plating * rw) continue;
      scutes.push({
        cellId: c.id, boneName: c.boneName,
        pos: c.pos, normal: c.normal, tangent: c.tangent, radius: c.radius,
        sizeVar: 0.75 + rng() * 0.5,
      });
    }
  }

  return { spikes, sailCells, feathers, scutes };
}

// ---------------------------------------------------------------------------
// Materials (built from the phenotype so features tint with the body).
// ---------------------------------------------------------------------------
// Tier-aware PBR factories (materials.js): keratin spikes, transmissive sail,
// sheen feathers, clearcoat scutes. Cheap tier returns the original flat mats.
const spikeMaterial = (p) => MAT.spikeMaterial(p, p.renderTier);
const sailMaterial = (p) => MAT.sailMaterial(p, p.renderTier);
const featherMaterial = (p) => MAT.featherMaterial(p, p.renderTier);
const scuteMaterial = (p) => MAT.scuteMaterial(p, p.renderTier);

// ---------------------------------------------------------------------------
// Small geometry builders.
// ---------------------------------------------------------------------------
// spikeDir = outward normal tilted backward along the rail tangent (toward tail).
function spikeDir(normal, tangent) {
  return normal.clone().addScaledVector(tangent, 0.32).normalize();
}
// height/base-radius for one spike from the phenotype + per-cell hints.
function spikeSize(s, p) {
  const amt = p.spikeAmount ?? 0.4;
  const sharp = p.spikeSharpness ?? 0.6;
  const grow = p.spikeGrow ?? 1;
  // taller on a bigger body + a touch of per-spike score variation.
  const h = SPIKE_HEIGHT_BASE * lerp(0.55, 1.7, amt) * (0.55 + 0.55 * s.radius)
    * (0.7 + 0.5 * clamp01(s.score)) * grow;
  const r = h * lerp(0.55, 0.13, clamp01(sharp));   // sharper => slimmer cone
  return { h, r };
}

function orientAndPlace(geo, dir, pos) {
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, dir);
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
}

// Merge an array of geometries into one mesh (or null if empty).
function mergeToMesh(geos, mat, name) {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// buildFeatureMeshes(state, p, opts) -> THREE.Group('features')
// ---------------------------------------------------------------------------
// opts.mode: 'voxel' renders cheap cube stacks (matching the geo.json bake);
// anything else renders cones / sail sheet / feather cards / scute lenses.
export function buildFeatureMeshes(state, p, opts = {}) {
  const group = new THREE.Group();
  group.name = 'features';
  const voxel = opts.mode === 'voxel';

  const spikeGrow = p.spikeGrow ?? 1;
  const featherGrow = p.featherGrow ?? 1;
  const scuteGrow = p.scuteGrow ?? 1;

  // ============================ SPIKES + SAIL ===============================
  if (voxel) {
    // Cheap cube path (spikes as 1–2 protruding cubes, sail as a thin cuboid run).
    const cubes = featureVoxelCubes(state, p);
    const geos = [];
    const sailGeos = [];
    for (const c of cubes) {
      const g = new THREE.BoxGeometry(c.size[0], c.size[1], c.size[2]);
      g.translate(c.origin[0] + c.size[0] / 2, c.origin[1] + c.size[1] / 2, c.origin[2] + c.size[2] / 2);
      (c.kind === 'sail' ? sailGeos : geos).push(g);
    }
    const spikeMesh = mergeToMesh(geos, spikeMaterial(p), 'spikes');
    if (spikeMesh) {
      spikeMesh.userData.featureCells = state.spikes.map((s) => ({ boneName: s.boneName }));
      group.add(spikeMesh);
    }
    const sailMesh = mergeToMesh(sailGeos, sailMaterial(p), 'sail');
    if (sailMesh) group.add(sailMesh);
  } else if (spikeGrow > 0.02 && state.spikes.length) {
    // Cones oriented to the normal, tilted back; merged into one mesh.
    const geos = [];
    for (const s of state.spikes) {
      const { h, r } = spikeSize(s, p);
      if (h < 1e-3) continue;
      const g = new THREE.ConeGeometry(Math.max(r, 1e-3), h, 7, 1);
      g.translate(0, h / 2, 0);   // base at origin, tip at +h
      orientAndPlace(g, spikeDir(s.normal, s.tangent), s.pos);
      geos.push(g);
    }
    const spikeMesh = mergeToMesh(geos, spikeMaterial(p), 'spikes');
    if (spikeMesh) {
      // Bone tags + placement for future per-bone animation / provenance.
      spikeMesh.userData.featureCells = state.spikes.map((s) => ({
        boneName: s.boneName, pos: s.pos.toArray(), normal: s.normal.toArray(),
      }));
      group.add(spikeMesh);
    }

    // ---- DORSAL SAIL: a double-sided membrane between consecutive dorsal
    // spikes (gated by crestSail). Each pair -> a quad (base_i, tip_i,
    // tip_{i+1}, base_{i+1}); the tips ride partway up the spike so the sail
    // reads as webbing stretched along the ridge. ----------------------------
    const crest = p.crestSail ?? 0;
    if (crest > 0.05 && state.sailCells.length >= 2) {
      const pos = [];
      const push = (v) => pos.push(v.x, v.y, v.z);
      const sc = state.sailCells;
      for (let i = 0; i + 1 < sc.length; i++) {
        const a = sc[i], b = sc[i + 1];
        // don't span big gaps (different body segments) — keep the sail local.
        if (Math.abs((a.u ?? 0) - (b.u ?? 0)) > 4) continue;
        const ha = spikeSize(a, p), hb = spikeSize(b, p);
        const sailH = crest * spikeGrow;
        const baseA = a.pos, baseB = b.pos;
        const tipA = a.pos.clone().addScaledVector(spikeDir(a.normal, a.tangent), ha.h * sailH);
        const tipB = b.pos.clone().addScaledVector(spikeDir(b.normal, b.tangent), hb.h * sailH);
        // two triangles for the quad
        push(baseA); push(tipA); push(tipB);
        push(baseA); push(tipB); push(baseB);
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        const sail = new THREE.Mesh(geo, sailMaterial(p));
        sail.name = 'sail';
        group.add(sail);
      }
    }
  }

  // ============================ FEATHERS ====================================
  if (!voxel && featherGrow > 0.02 && state.feathers.length) {
    const pos = [];
    const push = (v) => pos.push(v.x, v.y, v.z);
    const len0 = FEATHER_LEN_BASE * lerp(0.4, 1.3, clamp01(p.featherLength ?? 0.5));
    const _lat = new THREE.Vector3();
    for (const f of state.feathers) {
      const groom = f.tangent.clone().multiplyScalar(0.9).addScaledVector(f.normal, 0.5).normalize();
      _lat.crossVectors(f.normal, groom).normalize();
      const len = len0 * f.sizeVar * (0.6 + 0.7 * f.radius) * featherGrow;
      const w = len * 0.32;
      const base = f.pos.clone().addScaledVector(f.normal, len * 0.05);
      const tip = f.pos.clone().addScaledVector(groom, len);
      const b0 = base.clone().addScaledVector(_lat, w * 0.5);
      const b1 = base.clone().addScaledVector(_lat, -w * 0.5);
      const t0 = tip.clone().addScaledVector(_lat, w * 0.12);
      const t1 = tip.clone().addScaledVector(_lat, -w * 0.12);
      push(b0); push(b1); push(t1);
      push(b0); push(t1); push(t0);
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, featherMaterial(p));
      mesh.name = 'feathers';
      mesh.userData.featureCells = state.feathers.map((f) => ({ boneName: f.boneName }));
      group.add(mesh);
    }
  }

  // ============================ SCUTES ======================================
  if (!voxel && scuteGrow > 0.02 && state.scutes.length) {
    const pos = [];
    const push = (v) => pos.push(v.x, v.y, v.z);
    const r0 = SCUTE_R_BASE * lerp(0.5, 1.5, clamp01(p.scaleSize ?? 0.5));
    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const SEG = 6;
    for (const sc of state.scutes) {
      // tangent-plane frame
      _a.copy(sc.tangent).addScaledVector(sc.normal, -sc.tangent.dot(sc.normal)).normalize();
      if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0);
      _b.crossVectors(sc.normal, _a).normalize();
      const r = r0 * sc.sizeVar * (0.55 + 0.8 * sc.radius) * scuteGrow;
      // domed lens: apex proud of the surface, rim sitting ON the surface, so the
      // flat-shaded facets catch light and read as a distinct hard plate/scute.
      const rim = sc.pos.clone().addScaledVector(sc.normal, r * 0.05);
      const apex = sc.pos.clone().addScaledVector(sc.normal, r * 0.42);
      for (let k = 0; k < SEG; k++) {
        const a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2;
        const c0 = rim.clone().addScaledVector(_a, Math.cos(a0) * r).addScaledVector(_b, Math.sin(a0) * r);
        const c1 = rim.clone().addScaledVector(_a, Math.cos(a1) * r).addScaledVector(_b, Math.sin(a1) * r);
        push(apex); push(c0); push(c1);
      }
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, scuteMaterial(p));
      mesh.name = 'scutes';
      mesh.userData.featureCells = state.scutes.map((s) => ({ boneName: s.boneName }));
      group.add(mesh);
    }
  }

  return group;
}

// ---------------------------------------------------------------------------
// featureVoxelCubes(state, p) -> [ { origin, size, boneName, kind } ]
// ---------------------------------------------------------------------------
// Cheap voxel/Minecraft degradation of the DISCRETE features, tagged to their
// cell's bone so they bake straight into geo.json under the right dorsal-spine
// bones. Spike -> a short stack of 1–2 shrinking axis-aligned cubes protruding
// along the dominant face normal. Crest sail -> a thin cuboid run between
// consecutive dorsal spikes. Feathers/scutes are omitted here (too costly /
// low-value blocky) — they fold into the per-cube marking tint instead.
//   origin = MIN corner (Bedrock convention), size = positive extents (world).
export function featureVoxelCubes(state, p) {
  const cubes = [];
  const grow = p.spikeGrow ?? 1;
  if (grow <= 0.02) return cubes;

  // snap a normal to its dominant ±axis (voxel cubes protrude axis-aligned).
  const snapAxis = (n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(n.y) || 1, 0);
    if (ax >= az) return new THREE.Vector3(Math.sign(n.x) || 1, 0, 0);
    return new THREE.Vector3(0, 0, Math.sign(n.z) || 1);
  };

  for (const s of state.spikes) {
    const { h } = spikeSize(s, p);
    if (h < 1e-3) continue;
    const dir = snapAxis(s.normal);
    const e0 = Math.max(0.1, Math.min(0.55, s.radius * 0.7));   // base cube edge
    const n = h > e0 * 1.3 ? 2 : 1;                              // 1 or 2 cubes tall
    let edge = e0;
    let along = 0;   // distance of this cube's near face from the surface point
    for (let i = 0; i < n; i++) {
      const center = s.pos.clone().addScaledVector(dir, along + edge * 0.5);
      cubes.push({
        origin: [center.x - edge / 2, center.y - edge / 2, center.z - edge / 2],
        size: [edge, edge, edge],
        boneName: s.boneName, kind: 'spike',
      });
      along += edge;
      edge *= 0.6;   // shrink upward
    }
  }

  // crest sail: a thin cuboid spanning consecutive dorsal spikes (approx.,
  // axis-aligned). Tagged to the leading spike's bone.
  const crest = p.crestSail ?? 0;
  if (crest > 0.1) {
    const sc = state.sailCells;
    for (let i = 0; i + 1 < sc.length; i++) {
      const a = sc[i], b = sc[i + 1];
      if (Math.abs((a.u ?? 0) - (b.u ?? 0)) > 4) continue;
      const ha = spikeSize(a, p).h;
      const lo = new THREE.Vector3(Math.min(a.pos.x, b.pos.x), Math.min(a.pos.y, b.pos.y), Math.min(a.pos.z, b.pos.z));
      const hi = new THREE.Vector3(Math.max(a.pos.x, b.pos.x), Math.max(a.pos.y, b.pos.y), Math.max(a.pos.z, b.pos.z));
      const thick = 0.08;
      const sailH = ha * crest * grow;
      cubes.push({
        origin: [lo.x - thick / 2, lo.y, lo.z],
        size: [thick, (hi.y - lo.y) + sailH, Math.max(0.06, hi.z - lo.z)],
        boneName: a.boneName, kind: 'sail',
      });
    }
  }

  return cubes;
}
