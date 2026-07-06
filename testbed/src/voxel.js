// voxel.js — Voxelized-cuboid skin: the SAME implicit field as Step 2, sampled
// onto a coarse grid, thresholded at the iso-surface (F=0), greedy-meshed into a
// small set of axis-aligned boxes, each box rigidly tagged to its dominant bone.
//
// STEP 3 of the rigging-and-skinning build order (see
// design/rigging-and-skinning-recommendation.md). This is the Minecraft-native
// back-end: the envelope field gives the cuboid form an ORGANIC, rounded
// silhouette while the surface stays blocky — the whole point of the doc's
// "skin tension" resolution. It bakes straight to Bedrock `geo.json` (geojson.js).
//
// HOW IT WORKS
// ------------
//   1. Reuse field.js: build the per-bone capsule envelopes and the exact same
//      exponential smooth-min field  F(x) = -ln( Σ exp(-k·d_i) ) / k .
//   2. Sample F at each voxel CENTER on a coarse grid (longest axis = voxelRes
//      cells). A voxel is SOLID when its center is inside the surface (F < 0,
//      equivalently Σ exp(-k·d_i) > 1). No log needed.
//   3. Per-cube bone assignment (RIGID one-bone-per-cube weighting): the bone
//      whose envelope contributes most at the voxel center (argmax exp(-k·d_i)
//      = the nearest envelope). This is the doc's field-provenance weighting for
//      the cuboid path — no softmax needed.
//   4. GREEDY-MESH runs of same-bone solid voxels into maximal boxes to keep the
//      cube count low (MC-appropriate 30–150 cubes). Boxes never merge across
//      bones, so cube→bone grouping stays clean for geo.json.
//   5. Emit world-space cubes {origin,size,boneIdx,boneName}; buildVoxelSkin also
//      merges them into one THREE box geometry for rendering.
//
// Optional HYBRID HEAD (behind opts.headRes>1 / window.__voxelHeadRes): the
// skull region is re-voxelized at a finer resolution so the face reads rounder
// while the body stays chunky — the doc's cheap fallback if the head is too
// blocky. Fine grid is aligned to coarse cell boundaries so the two tile without
// seams.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildEnvelopes, sdEnvelope, DEFAULT_BODY_KINDS } from './field.js';

// ---------------------------------------------------------------------------
// Sample the field's solid/bone occupancy over an axis-aligned block of cells.
// Cells are centered: center(i,j,l) = (ox + (i+0.5)*h, ...). A cell is solid
// when Σ exp(-k·d_i) > 1  ⇔  F < 0. `bone` records the dominant (nearest)
// envelope's boneIdx per solid cell.
//   Returns { solid:Uint8Array, bone:Int32Array } indexed idx=(l*ny+j)*nx+i.
// ---------------------------------------------------------------------------
function sampleOccupancy(envelopes, k, ox, oy, oz, h, nx, ny, nz) {
  const N = nx * ny * nz;
  const S = new Float64Array(N);       // Σ exp(-k·d)
  const bestC = new Float64Array(N);   // max per-envelope contribution so far
  const bone = new Int32Array(N).fill(-1);
  const idx = (i, j, l) => (l * ny + j) * nx + i;

  for (const e of envelopes) {
    // Restrict to this envelope's (already margin-expanded) AABB, in cell space.
    const i0 = Math.max(0, Math.floor((e.minX - ox) / h));
    const i1 = Math.min(nx - 1, Math.ceil((e.maxX - ox) / h));
    const j0 = Math.max(0, Math.floor((e.minY - oy) / h));
    const j1 = Math.min(ny - 1, Math.ceil((e.maxY - oy) / h));
    const l0 = Math.max(0, Math.floor((e.minZ - oz) / h));
    const l1 = Math.min(nz - 1, Math.ceil((e.maxZ - oz) / h));
    for (let l = l0; l <= l1; l++) {
      const wz = oz + (l + 0.5) * h;
      for (let j = j0; j <= j1; j++) {
        const wy = oy + (j + 0.5) * h;
        for (let i = i0; i <= i1; i++) {
          const wx = ox + (i + 0.5) * h;
          const c = Math.exp(-k * sdEnvelope(e, wx, wy, wz));
          const s = idx(i, j, l);
          S[s] += c;
          if (c > bestC[s]) { bestC[s] = c; bone[s] = e.boneIdx; }
        }
      }
    }
  }

  const solid = new Uint8Array(N);
  for (let s = 0; s < N; s++) if (S[s] > 1.0) solid[s] = 1;   // F < 0
  return { solid, bone };
}

// Remove barely-attached protruding voxels (a solid cell with fewer than
// `minNbr` solid 6-neighbours). This scrubs the isolated single-cube "warts" and
// 1-wide spikes the greedy mesher leaves on the rounded surface — a cleaner,
// more Minecraft-like blocky form — without touching the bulk body. One pass;
// operates on a snapshot so removals don't cascade within the pass.
function erodeIsolated(solid, nx, ny, nz, minNbr) {
  const idx = (i, j, l) => (l * ny + j) * nx + i;
  const src = solid.slice();
  for (let l = 0; l < nz; l++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s = idx(i, j, l);
        if (!src[s]) continue;
        let n = 0;
        if (i > 0 && src[s - 1]) n++;
        if (i < nx - 1 && src[s + 1]) n++;
        if (j > 0 && src[s - nx]) n++;
        if (j < ny - 1 && src[s + nx]) n++;
        if (l > 0 && src[s - nx * ny]) n++;
        if (l < nz - 1 && src[s + nx * ny]) n++;
        if (n < minNbr) solid[s] = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Greedy 3D box merging over a solid/bone grid. Grows a maximal axis-aligned box
// from each unclaimed solid cell: extend +x while same bone, then +y over the
// whole x-run, then +z over the whole xy-slab. Boxes never span two bones.
//   Returns array of { i,j,l, w,hy,d, bone } in cell/index space.
// ---------------------------------------------------------------------------
function greedyBoxes(solid, bone, nx, ny, nz) {
  const N = nx * ny * nz;
  const claimed = new Uint8Array(N);
  const idx = (i, j, l) => (l * ny + j) * nx + i;
  const free = (i, j, l, b) => {
    const s = idx(i, j, l);
    return solid[s] && !claimed[s] && bone[s] === b;
  };
  const boxes = [];
  for (let l = 0; l < nz; l++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const s = idx(i, j, l);
        if (!solid[s] || claimed[s]) continue;
        const b = bone[s];
        // extend along +x
        let w = 1;
        while (i + w < nx && free(i + w, j, l, b)) w++;
        // extend along +y (entire x-run must match)
        let hy = 1;
        grow_y: while (j + hy < ny) {
          for (let dx = 0; dx < w; dx++) if (!free(i + dx, j + hy, l, b)) break grow_y;
          hy++;
        }
        // extend along +z (entire xy-slab must match)
        let d = 1;
        grow_z: while (l + d < nz) {
          for (let dy = 0; dy < hy; dy++)
            for (let dx = 0; dx < w; dx++)
              if (!free(i + dx, j + dy, l + d, b)) break grow_z;
          d++;
        }
        // claim the whole box
        for (let dz = 0; dz < d; dz++)
          for (let dy = 0; dy < hy; dy++)
            for (let dx = 0; dx < w; dx++)
              claimed[idx(i + dx, j + dy, l + dz)] = 1;
        boxes.push({ i, j, l, w, hy, d, bone: b });
      }
    }
  }
  return boxes;
}

// Convert index-space boxes to world-space cubes { origin, size, boneIdx, boneName }.
function boxesToCubes(boxes, ox, oy, oz, h, boneNames) {
  return boxes.map((bx) => ({
    origin: [ox + bx.i * h, oy + bx.j * h, oz + bx.l * h],
    size: [bx.w * h, bx.hy * h, bx.d * h],
    boneIdx: bx.bone,
    boneName: boneNames[bx.bone] ?? 'root',
  }));
}

// ---------------------------------------------------------------------------
// computeVoxelCubes(bones, opts) -> { cubes, boneNames, stats }
// ---------------------------------------------------------------------------
// Pure data (no THREE objects) — used by both buildVoxelSkin (rendering) and the
// geo.json exporter. opts:
//   voxelRes : longest-axis voxel count (default 24; MC-appropriate ~20–28).
//   smoothK  : field smooth-min / softmax temperature (default 5.5, matches
//              field.js so the voxel silhouette matches the smooth reference).
//   kinds    : bone.kind values to include (default body-volume kinds).
//   pad      : bbox padding fraction (default 0.06).
//   headRes  : head-region resolution MULTIPLIER (default 1 = off). >1 enables a
//              finer, aligned re-voxelization of the skull region (hybrid head).
export function computeVoxelCubes(bones, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const voxelRes = Math.max(6, Math.round(opts.voxelRes ?? 24));
  const k = opts.smoothK ?? 5.5;
  const kinds = opts.kinds ?? DEFAULT_BODY_KINDS;
  const pad = opts.pad ?? 0.06;
  const headMul = Math.max(1, Math.round(opts.headRes ?? 1));
  // Isolated-voxel cleanup: drop solid cells with < minNbr solid neighbours
  // (scrubs surface "warts"/spikes). 0 disables. Default 2.
  const minNbr = opts.cleanup === false ? 0 : (opts.minNeighbors ?? 2);
  const margin = 2.0 / k;               // same blend reach as the smooth field

  const { envelopes, boneNames } = buildEnvelopes(bones, kinds, margin);
  if (envelopes.length === 0) {
    return { cubes: [], boneNames, stats: { cubes: 0, solidVoxels: 0, ms: 0, boneNames } };
  }

  // ---- union bbox over the (margin-expanded) envelope AABBs, small pad -------
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const e of envelopes) {
    if (e.minX < minX) minX = e.minX; if (e.maxX > maxX) maxX = e.maxX;
    if (e.minY < minY) minY = e.minY; if (e.maxY > maxY) maxY = e.maxY;
    if (e.minZ < minZ) minZ = e.minZ; if (e.maxZ > maxZ) maxZ = e.maxZ;
  }
  const px = (maxX - minX) * pad, py = (maxY - minY) * pad, pz = (maxZ - minZ) * pad;
  minX -= px; maxX += px; minY -= py; maxY += py; minZ -= pz; maxZ += pz;

  // ---- cubic voxels, longest axis == voxelRes cells -------------------------
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const h = Math.max(spanX, spanY, spanZ) / voxelRes;
  const nx = Math.max(1, Math.ceil(spanX / h));
  const ny = Math.max(1, Math.ceil(spanY / h));
  const nz = Math.max(1, Math.ceil(spanZ / h));

  // ---- optional hybrid head: snap the skull region to coarse cell lines -----
  let headCells = null;   // { i0,i1, j0,j1, l0,l1 } inclusive coarse-cell range
  if (headMul > 1) {
    const skull = bones.find((b) => b.kind === 'skull' && b.envelopeRadius >= 0.012);
    if (skull) {
      const r = skull.envelopeRadius * 1.35;   // cover skull + a little snout/jaw
      const cx = skull.pos.x, cy = skull.pos.y, cz = skull.pos.z;
      const clampI = (v, n) => Math.max(0, Math.min(n - 1, v));
      headCells = {
        i0: clampI(Math.floor((cx - r - minX) / h), nx),
        i1: clampI(Math.ceil((cx + r - minX) / h), nx),
        j0: clampI(Math.floor((cy - r - minY) / h), ny),
        j1: clampI(Math.ceil((cy + r - minY) / h), ny),
        l0: clampI(Math.floor((cz - r - minZ) / h), nz),
        l1: clampI(Math.ceil((cz + r - minZ) / h), nz),
      };
    }
  }

  // ---- coarse body pass (skipping the head region if hybrid) ----------------
  const { solid, bone } = sampleOccupancy(envelopes, k, minX, minY, minZ, h, nx, ny, nz);
  if (minNbr > 0) erodeIsolated(solid, nx, ny, nz, minNbr);
  if (headCells) {
    const hc = headCells;
    for (let l = hc.l0; l <= hc.l1; l++)
      for (let j = hc.j0; j <= hc.j1; j++)
        for (let i = hc.i0; i <= hc.i1; i++) solid[(l * ny + j) * nx + i] = 0;
  }
  const cubes = boxesToCubes(greedyBoxes(solid, bone, nx, ny, nz), minX, minY, minZ, h, boneNames);
  let solidVoxels = 0;
  for (let s = 0; s < solid.length; s++) solidVoxels += solid[s];

  // ---- fine head pass, aligned to the coarse cells it replaces --------------
  if (headCells) {
    const hc = headCells;
    const fnx = (hc.i1 - hc.i0 + 1) * headMul;
    const fny = (hc.j1 - hc.j0 + 1) * headMul;
    const fnz = (hc.l1 - hc.l0 + 1) * headMul;
    const fh = h / headMul;
    const fox = minX + hc.i0 * h, foy = minY + hc.j0 * h, foz = minZ + hc.l0 * h;
    const fine = sampleOccupancy(envelopes, k, fox, foy, foz, fh, fnx, fny, fnz);
    if (minNbr > 0) erodeIsolated(fine.solid, fnx, fny, fnz, minNbr);
    const fcubes = boxesToCubes(greedyBoxes(fine.solid, fine.bone, fnx, fny, fnz),
      fox, foy, foz, fh, boneNames);
    for (const c of fcubes) cubes.push(c);
    for (let s = 0; s < fine.solid.length; s++) solidVoxels += fine.solid[s];
  }

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const stats = {
    cubes: cubes.length, solidVoxels, ms,
    grid: [nx, ny, nz], voxel: h, envelopes: envelopes.length,
    headHiRes: headMul > 1 && !!headCells ? headMul : 1, boneNames,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
  return { cubes, boneNames, stats };
}

// ---------------------------------------------------------------------------
// buildVoxelSkin(bones, opts) -> { group, cubes, stats }
// ---------------------------------------------------------------------------
// Renders the cubes as ONE merged THREE box geometry (single mesh named 'body',
// shadow-casting). `material` is the body material. Cube→bone mapping is returned
// on `cubes` and mirrored onto group.userData for the geo.json exporter.
export function buildVoxelSkin(bones, opts = {}, material = null) {
  const { cubes, boneNames, stats } = computeVoxelCubes(bones, opts);
  const group = new THREE.Group();
  group.name = 'body';

  if (cubes.length > 0) {
    const geos = [];
    for (const c of cubes) {
      const g = new THREE.BoxGeometry(c.size[0], c.size[1], c.size[2]);
      g.translate(c.origin[0] + c.size[0] / 2, c.origin[1] + c.size[1] / 2, c.origin[2] + c.size[2] / 2);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, material ?? new THREE.MeshStandardMaterial({ color: 0x88aa66 }));
    mesh.name = 'voxelBody';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.userData.voxelCubes = cubes;
  group.userData.voxelStats = stats;
  return { group, cubes, stats };
}
