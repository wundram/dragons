// field.js — Implicit-surface skin: bone capsule envelopes -> one smooth
// convolution-style (bulge-free) scalar field -> marching cubes -> a single
// continuous organic THREE.BufferGeometry, plus field-softmax skin weights.
//
// STEP 2 of the rigging-and-skinning build order (see
// design/rigging-and-skinning-recommendation.md). Consumes the resolved bone
// tree from generator.js (`group.userData.skeleton`): each bone is a capsule
// envelope `pos`(radius envelopeRadius) -> `tail`(radius rTail); single-point
// bones (skull) have only `pos`+`envelopeRadius`; bones with envelopeRadius<EPS
// are ABSENT and skipped.
//
// HOW THE FIELD / BLEND WORKS
// ---------------------------
// Per bone we use the exact signed distance to a round-cone (tapered capsule)
// `d_i(x)`, negative inside, 0 on the surface. Instead of a hard union
// min(d_i) — which creases — or naive metaballs — which bulge at overlaps — we
// combine with an EXPONENTIAL SMOOTH-MIN:
//
//     F(x) = -ln( Σ_i exp(-k · d_i(x)) ) / k
//
// This is the convolution-style / smooth-min blend the doc calls for: it is
// bulge-free and independent of how the skeleton is split into primitives, so
// limbs melt into the torso without lumps. `k` is the softness knob (smaller =
// more melting). The iso-surface is F(x)=0.
//
// The same exponential is a SOFTMAX, which hands us skin weights for free:
//
//     w_i(x) = exp(-k · d_i(x)) / Σ_j exp(-k · d_j(x))
//
// i.e. the "field-softmax weights, free from provenance" the doc specifies — no
// heat diffusion, no BBW/Pinocchio. We store the top-4 per output vertex.
//
// The field is built by ACCUMULATING Σ exp(-k·d_i) over each bone's local AABB
// only (a bone's contribution is negligible far outside its envelope), so cost
// stays roughly linear in total envelope volume, not bones × cells.

import * as THREE from 'three';

const EPS = 0.012;        // envelopeRadius below this => bone absent (matches generator)
const FAR = 1e3;          // field value for cells no envelope touched (well outside)

// ---------------------------------------------------------------------------
// Signed-distance primitives (scalar, no allocation in the hot loop)
// ---------------------------------------------------------------------------

// Round cone (sphere-swept segment a->b with radii r1->r2). Inigo Quilez form.
function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-9) {                       // degenerate: sphere of the larger radius
    const r = Math.max(r1, r2);
    const dx = px - ax, dy = py - ay, dz = pz - az;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1.0 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  // xp = pa*l2 - ba*y
  const xpx = pax * l2 - bax * y, xpy = pay * l2 - bay * y, xpz = paz * l2 - baz * y;
  const x2 = xpx * xpx + xpy * xpy + xpz * xpz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function sdSphere(px, py, pz, cx, cy, cz, r) {
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

// Signed distance of point (px,py,pz) to envelope `e`.
function sdEnvelope(e, px, py, pz) {
  if (e.sphere) return sdSphere(px, py, pz, e.ax, e.ay, e.az, e.r1);
  return sdRoundCone(px, py, pz, e.ax, e.ay, e.az, e.bx, e.by, e.bz, e.r1, e.r2);
}

// ---------------------------------------------------------------------------
// Build the envelope list from the resolved bone tree.
// ---------------------------------------------------------------------------
// `kinds` selects which bone.kind values become volumetric envelopes (wings are
// excluded — thin sheets are the classic implicit-field failure). Returns
// { envelopes, boneNames } where boneNames[i] is the bone name for envelope i
// (index used by the skin weights).
function buildEnvelopes(bones, kinds, margin) {
  const envelopes = [];
  const boneNames = [];
  for (const b of bones) {
    if (!kinds.has(b.kind)) continue;
    if (b.envelopeRadius < EPS) continue;   // absent
    const idx = boneNames.length;
    boneNames.push(b.name);
    const hasTail = b.tail && b.rTail !== undefined && b.rTail !== null;
    const e = {
      boneIdx: idx,
      sphere: !hasTail,
      ax: b.pos.x, ay: b.pos.y, az: b.pos.z,
      bx: hasTail ? b.tail.x : b.pos.x,
      by: hasTail ? b.tail.y : b.pos.y,
      bz: hasTail ? b.tail.z : b.pos.z,
      r1: b.envelopeRadius,
      r2: hasTail ? Math.max(b.rTail, 1e-3) : b.envelopeRadius,
    };
    // AABB of the capsule, expanded by the blend margin so overlapping joints
    // get each other's contribution (and so the field is safely positive at the
    // AABB boundary, avoiding false zero-crossings there).
    const rmax = Math.max(e.r1, e.r2) + margin;
    e.minX = Math.min(e.ax, e.bx) - rmax; e.maxX = Math.max(e.ax, e.bx) + rmax;
    e.minY = Math.min(e.ay, e.by) - rmax; e.maxY = Math.max(e.ay, e.by) + rmax;
    e.minZ = Math.min(e.az, e.bz) - rmax; e.maxZ = Math.max(e.az, e.bz) + rmax;
    envelopes.push(e);
  }
  return { envelopes, boneNames };
}

// ---------------------------------------------------------------------------
// Marching-cubes tables (Paul Bourke / standard). edgeTable[256], triTable[256][16].
// ---------------------------------------------------------------------------
// Corner order (0..7) and edge order (0..11) follow the classic layout used by
// the tables below; cornerOff / edgeCorner encode it.
const cornerOff = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];
const edgeCorner = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const edgeTable = new Int32Array([
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c, 0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c, 0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c, 0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac, 0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
  0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265, 0x36c, 0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
  0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0xff, 0x3f5, 0x2fc, 0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
  0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x55, 0x15c, 0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
  0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc, 0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
  0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc, 0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
  0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c, 0x15c, 0x55, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
  0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc, 0x2fc, 0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
  0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c, 0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460,
  0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac, 0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c, 0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c, 0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c, 0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x0,
]);

// triTable: 256 rows, each up to 15 edge indices + (-1) terminators.
const triTable = [
  [-1], [0, 8, 3, -1], [0, 1, 9, -1], [1, 8, 3, 9, 8, 1, -1], [1, 2, 10, -1], [0, 8, 3, 1, 2, 10, -1], [9, 2, 10, 0, 2, 9, -1], [2, 8, 3, 2, 10, 8, 10, 9, 8, -1],
  [3, 11, 2, -1], [0, 11, 2, 8, 11, 0, -1], [1, 9, 0, 2, 3, 11, -1], [1, 11, 2, 1, 9, 11, 9, 8, 11, -1], [3, 10, 1, 11, 10, 3, -1], [0, 10, 1, 0, 8, 10, 8, 11, 10, -1], [3, 9, 0, 3, 11, 9, 11, 10, 9, -1], [9, 8, 10, 10, 8, 11, -1],
  [4, 7, 8, -1], [4, 3, 0, 7, 3, 4, -1], [0, 1, 9, 8, 4, 7, -1], [4, 1, 9, 4, 7, 1, 7, 3, 1, -1], [1, 2, 10, 8, 4, 7, -1], [3, 4, 7, 3, 0, 4, 1, 2, 10, -1], [9, 2, 10, 9, 0, 2, 8, 4, 7, -1], [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1],
  [8, 4, 7, 3, 11, 2, -1], [11, 4, 7, 11, 2, 4, 2, 0, 4, -1], [9, 0, 1, 8, 4, 7, 2, 3, 11, -1], [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1], [3, 10, 1, 3, 11, 10, 7, 8, 4, -1], [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1], [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1], [4, 7, 11, 4, 11, 9, 9, 11, 10, -1],
  [9, 5, 4, -1], [9, 5, 4, 0, 8, 3, -1], [0, 5, 4, 1, 5, 0, -1], [8, 5, 4, 8, 3, 5, 3, 1, 5, -1], [1, 2, 10, 9, 5, 4, -1], [3, 0, 8, 1, 2, 10, 4, 9, 5, -1], [5, 2, 10, 5, 4, 2, 4, 0, 2, -1], [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1],
  [9, 5, 4, 2, 3, 11, -1], [0, 11, 2, 0, 8, 11, 4, 9, 5, -1], [0, 5, 4, 0, 1, 5, 2, 3, 11, -1], [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1], [10, 3, 11, 10, 1, 3, 9, 5, 4, -1], [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1], [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1], [5, 4, 8, 5, 8, 10, 10, 8, 11, -1],
  [9, 7, 8, 5, 7, 9, -1], [9, 3, 0, 9, 5, 3, 5, 7, 3, -1], [0, 7, 8, 0, 1, 7, 1, 5, 7, -1], [1, 5, 3, 3, 5, 7, -1], [9, 7, 8, 9, 5, 7, 10, 1, 2, -1], [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3, -1], [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2, -1], [2, 10, 5, 2, 5, 3, 3, 5, 7, -1],
  [7, 9, 5, 7, 8, 9, 3, 11, 2, -1], [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11, -1], [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7, -1], [11, 2, 1, 11, 1, 7, 7, 1, 5, -1], [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11, -1], [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0, -1], [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0, -1], [11, 10, 5, 7, 11, 5, -1],
  [10, 6, 5, -1], [0, 8, 3, 5, 10, 6, -1], [9, 0, 1, 5, 10, 6, -1], [1, 8, 3, 1, 9, 8, 5, 10, 6, -1], [1, 6, 5, 2, 6, 1, -1], [1, 6, 5, 1, 2, 6, 3, 0, 8, -1], [9, 6, 5, 9, 0, 6, 0, 2, 6, -1], [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8, -1],
  [2, 3, 11, 10, 6, 5, -1], [11, 0, 8, 11, 2, 0, 10, 6, 5, -1], [0, 1, 9, 2, 3, 11, 5, 10, 6, -1], [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11, -1], [6, 3, 11, 6, 5, 3, 5, 1, 3, -1], [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6, -1], [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9, -1], [6, 5, 9, 6, 9, 11, 11, 9, 8, -1],
  [5, 10, 6, 4, 7, 8, -1], [4, 3, 0, 4, 7, 3, 6, 5, 10, -1], [1, 9, 0, 5, 10, 6, 8, 4, 7, -1], [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4, -1], [6, 1, 2, 6, 5, 1, 4, 7, 8, -1], [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7, -1], [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6, -1], [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9, -1],
  [3, 11, 2, 7, 8, 4, 10, 6, 5, -1], [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11, -1], [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6, -1], [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6, -1], [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6, -1], [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11, -1], [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7, -1], [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9, -1],
  [10, 4, 9, 6, 4, 10, -1], [4, 10, 6, 4, 9, 10, 0, 8, 3, -1], [10, 0, 1, 10, 6, 0, 6, 4, 0, -1], [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10, -1], [1, 4, 9, 1, 2, 4, 2, 6, 4, -1], [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4, -1], [0, 2, 4, 4, 2, 6, -1], [8, 3, 2, 8, 2, 4, 4, 2, 6, -1],
  [10, 4, 9, 10, 6, 4, 11, 2, 3, -1], [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6, -1], [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10, -1], [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1, -1], [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3, -1], [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1, -1], [3, 11, 6, 3, 6, 0, 0, 6, 4, -1], [6, 4, 8, 11, 6, 8, -1],
  [7, 10, 6, 7, 8, 10, 8, 9, 10, -1], [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10, -1], [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0, -1], [10, 6, 7, 10, 7, 1, 1, 7, 3, -1], [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7, -1], [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9, -1], [7, 8, 0, 7, 0, 6, 6, 0, 2, -1], [7, 3, 2, 6, 7, 2, -1],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7, -1], [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7, -1], [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11, -1], [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1, -1], [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6, -1], [0, 9, 1, 11, 6, 7, -1], [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0, -1], [7, 11, 6, -1],
  [7, 6, 11, -1], [3, 0, 8, 11, 7, 6, -1], [0, 1, 9, 11, 7, 6, -1], [8, 1, 9, 8, 3, 1, 11, 7, 6, -1], [10, 1, 2, 6, 11, 7, -1], [1, 2, 10, 3, 0, 8, 6, 11, 7, -1], [2, 9, 0, 2, 10, 9, 6, 11, 7, -1], [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8, -1],
  [7, 2, 3, 6, 2, 7, -1], [7, 0, 8, 7, 6, 0, 6, 2, 0, -1], [2, 7, 6, 2, 3, 7, 0, 1, 9, -1], [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6, -1], [10, 7, 6, 10, 1, 7, 1, 3, 7, -1], [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8, -1], [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7, -1], [7, 6, 10, 7, 10, 8, 8, 10, 9, -1],
  [6, 8, 4, 11, 8, 6, -1], [3, 6, 11, 3, 0, 6, 0, 4, 6, -1], [8, 6, 11, 8, 4, 6, 9, 0, 1, -1], [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6, -1], [6, 8, 4, 6, 11, 8, 2, 10, 1, -1], [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6, -1], [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9, -1], [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3, -1],
  [8, 2, 3, 8, 4, 2, 4, 6, 2, -1], [0, 4, 2, 4, 6, 2, -1], [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8, -1], [1, 9, 4, 1, 4, 2, 2, 4, 6, -1], [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1, -1], [10, 1, 0, 10, 0, 6, 6, 0, 4, -1], [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3, -1], [10, 9, 4, 6, 10, 4, -1],
  [4, 9, 5, 7, 6, 11, -1], [0, 8, 3, 4, 9, 5, 11, 7, 6, -1], [5, 0, 1, 5, 4, 0, 7, 6, 11, -1], [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5, -1], [9, 5, 4, 10, 1, 2, 7, 6, 11, -1], [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5, -1], [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2, -1], [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6, -1],
  [7, 2, 3, 7, 6, 2, 5, 4, 9, -1], [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7, -1], [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0, -1], [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8, -1], [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7, -1], [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4, -1], [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10, -1], [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10, -1],
  [6, 9, 5, 6, 11, 9, 11, 8, 9, -1], [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5, -1], [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11, -1], [6, 11, 3, 6, 3, 5, 5, 3, 1, -1], [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6, -1], [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10, -1], [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5, -1], [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3, -1],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2, -1], [9, 5, 6, 9, 6, 0, 0, 6, 2, -1], [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8, -1], [1, 5, 6, 2, 1, 6, -1], [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6, -1], [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0, -1], [0, 3, 8, 5, 6, 10, -1], [10, 5, 6, -1],
  [11, 5, 10, 7, 5, 11, -1], [11, 5, 10, 11, 7, 5, 8, 3, 0, -1], [5, 11, 7, 5, 10, 11, 1, 9, 0, -1], [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1, -1], [11, 1, 2, 11, 7, 1, 7, 5, 1, -1], [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11, -1], [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7, -1], [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2, -1],
  [2, 5, 10, 2, 3, 5, 3, 7, 5, -1], [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5, -1], [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2, -1], [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2, -1], [1, 3, 5, 3, 7, 5, -1], [0, 8, 7, 0, 7, 1, 1, 7, 5, -1], [9, 0, 3, 9, 3, 5, 5, 3, 7, -1], [9, 8, 7, 5, 9, 7, -1],
  [5, 8, 4, 5, 10, 8, 10, 11, 8, -1], [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0, -1], [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5, -1], [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4, -1], [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8, -1], [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11, -1], [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5, -1], [9, 4, 5, 2, 11, 3, -1],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4, -1], [5, 10, 2, 5, 2, 4, 4, 2, 0, -1], [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9, -1], [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2, -1], [8, 4, 5, 8, 5, 3, 3, 5, 1, -1], [0, 4, 5, 1, 0, 5, -1], [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5, -1], [9, 4, 5, -1],
  [4, 11, 7, 4, 9, 11, 9, 10, 11, -1], [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11, -1], [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11, -1], [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4, -1], [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2, -1], [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3, -1], [11, 7, 4, 11, 4, 2, 2, 4, 0, -1], [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4, -1],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9, -1], [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7, -1], [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10, -1], [1, 10, 2, 8, 7, 4, -1], [4, 9, 1, 4, 1, 7, 7, 1, 3, -1], [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1, -1], [4, 0, 3, 7, 4, 3, -1], [4, 8, 7, -1],
  [9, 10, 8, 10, 11, 8, -1], [3, 0, 9, 3, 9, 11, 11, 9, 10, -1], [0, 1, 10, 0, 10, 8, 8, 10, 11, -1], [3, 1, 10, 11, 3, 10, -1], [1, 2, 11, 1, 11, 9, 9, 11, 8, -1], [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9, -1], [0, 2, 11, 8, 0, 11, -1], [3, 2, 11, -1],
  [2, 3, 8, 2, 8, 10, 10, 8, 9, -1], [9, 10, 2, 0, 9, 2, -1], [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8, -1], [1, 10, 2, -1], [1, 3, 8, 9, 1, 8, -1], [0, 9, 1, -1], [0, 3, 8, -1], [-1],
];

// ---------------------------------------------------------------------------
// buildFieldMesh(bones, opts) -> { geometry, stats }
// ---------------------------------------------------------------------------
// opts:
//   fieldRes : number  cells along the LONGEST bbox axis (default 64). Other
//                      axes are proportional so voxels stay ~cubic.
//   smoothK  : number  smooth-min / softmax temperature (default 5.5). Smaller
//                      => more melting/blending; larger => sharper joints.
//   topN     : number  skin-weight bones stored per vertex (default 4, max 4).
//   kinds    : Set     bone.kind values to include (default body-volume kinds).
//   pad      : number  fraction to pad the bbox by (default 0.12).
export function buildFieldMesh(bones, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const fieldRes = Math.max(16, Math.round(opts.fieldRes ?? 64));
  const k = opts.smoothK ?? 5.5;
  const topN = Math.min(4, Math.max(1, opts.topN ?? 4));
  const kinds = opts.kinds ?? new Set(['body', 'skull', 'limb', 'foot', 'girdle']);
  const pad = opts.pad ?? 0.12;
  const margin = 2.0 / k;               // blend reach in world units

  const { envelopes, boneNames } = buildEnvelopes(bones, kinds, margin);
  if (envelopes.length === 0) {
    return { geometry: new THREE.BufferGeometry(), stats: { tris: 0, verts: 0, ms: 0, boneNames } };
  }

  // ---- bounding box over all (already margin-expanded) envelope AABBs -------
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const e of envelopes) {
    if (e.minX < minX) minX = e.minX; if (e.maxX > maxX) maxX = e.maxX;
    if (e.minY < minY) minY = e.minY; if (e.maxY > maxY) maxY = e.maxY;
    if (e.minZ < minZ) minZ = e.minZ; if (e.maxZ > maxZ) maxZ = e.maxZ;
  }
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  const px = sx * pad, py = sy * pad, pz = sz * pad;
  minX -= px; maxX += px; minY -= py; maxY += py; minZ -= pz; maxZ += pz;

  // ---- grid sizing: cubic voxels, longest axis == fieldRes cells -----------
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const longest = Math.max(spanX, spanY, spanZ);
  const h = longest / fieldRes;         // voxel size
  const nx = Math.max(2, Math.ceil(spanX / h) + 1);
  const ny = Math.max(2, Math.ceil(spanY / h) + 1);
  const nz = Math.max(2, Math.ceil(spanZ / h) + 1);
  const nyx = nx * ny;
  const nTotal = nx * ny * nz;

  // ---- accumulate S(x) = Σ exp(-k·d_i) over each envelope's local AABB ------
  const S = new Float64Array(nTotal);   // 0 = untouched
  for (const e of envelopes) {
    const i0 = Math.max(0, Math.floor((e.minX - minX) / h));
    const i1 = Math.min(nx - 1, Math.ceil((e.maxX - minX) / h));
    const j0 = Math.max(0, Math.floor((e.minY - minY) / h));
    const j1 = Math.min(ny - 1, Math.ceil((e.maxY - minY) / h));
    const l0 = Math.max(0, Math.floor((e.minZ - minZ) / h));
    const l1 = Math.min(nz - 1, Math.ceil((e.maxZ - minZ) / h));
    for (let l = l0; l <= l1; l++) {
      const wz = minZ + l * h;
      for (let j = j0; j <= j1; j++) {
        const wy = minY + j * h;
        let base = nyx * l + nx * j + i0;
        for (let i = i0; i <= i1; i++, base++) {
          const wx = minX + i * h;
          const d = sdEnvelope(e, wx, wy, wz);
          S[base] += Math.exp(-k * d);
        }
      }
    }
  }

  // ---- convert to the smooth-min field F = -ln(S)/k ------------------------
  const F = new Float32Array(nTotal);
  for (let i = 0; i < nTotal; i++) {
    F[i] = S[i] > 1e-9 ? -Math.log(S[i]) / k : FAR;
  }

  // ---- marching cubes (iso = 0), welding vertices per grid edge ------------
  const positions = [];      // xyz flat
  const indices = [];
  const edgeMap = new Map();  // edgeKey -> vertexIndex
  const gi = (i, j, k2) => nyx * k2 + nx * j + i;   // corner linear index

  const cornerVal = new Float64Array(8);
  const cix = new Int32Array(8), ciy = new Int32Array(8), ciz = new Int32Array(8);

  for (let k2 = 0; k2 < nz - 1; k2++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let cubeindex = 0;
        for (let c = 0; c < 8; c++) {
          const ox = i + cornerOff[c][0], oy = j + cornerOff[c][1], oz = k2 + cornerOff[c][2];
          cix[c] = ox; ciy[c] = oy; ciz[c] = oz;
          const v = F[gi(ox, oy, oz)];
          cornerVal[c] = v;
          if (v < 0) cubeindex |= (1 << c);   // iso = 0; inside = negative
        }
        const edges = edgeTable[cubeindex];
        if (edges === 0) continue;

        const vertOnEdge = new Array(12);
        for (let e = 0; e < 12; e++) {
          if (!(edges & (1 << e))) continue;
          const ca = edgeCorner[e][0], cb = edgeCorner[e][1];
          const ia = gi(cix[ca], ciy[ca], ciz[ca]);
          const ib = gi(cix[cb], ciy[cb], ciz[cb]);
          const key = ia < ib ? ia * nTotal + ib : ib * nTotal + ia;
          let vidx = edgeMap.get(key);
          if (vidx === undefined) {
            const va = cornerVal[ca], vb = cornerVal[cb];
            const denom = va - vb;
            const t = Math.abs(denom) < 1e-9 ? 0.5 : va / denom; // solve F=0 along edge
            const ax = minX + cix[ca] * h, ay = minY + ciy[ca] * h, az = minZ + ciz[ca] * h;
            const bx = minX + cix[cb] * h, by = minY + ciy[cb] * h, bz = minZ + ciz[cb] * h;
            vidx = positions.length / 3;
            positions.push(ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az));
            edgeMap.set(key, vidx);
          }
          vertOnEdge[e] = vidx;
        }
        const tri = triTable[cubeindex];
        for (let t = 0; tri[t] !== -1 && t < tri.length; t += 3) {
          indices.push(vertOnEdge[tri[t]], vertOnEdge[tri[t + 1]], vertOnEdge[tri[t + 2]]);
        }
      }
    }
  }

  const nVerts = positions.length / 3;

  // ---- field-softmax skin weights at each output vertex --------------------
  // w_i = exp(-k·d_i) / Σ, keep the top-N bones. Stored as standard THREE
  // skinIndex/skinWeight attributes (4 each) PLUS geometry.userData.boneNames
  // (index -> bone name) so Step 3 can resolve provenance.
  const skinIndex = new Uint16Array(nVerts * 4);
  const skinWeight = new Float32Array(nVerts * 4);
  const contrib = new Float64Array(envelopes.length);
  for (let v = 0; v < nVerts; v++) {
    const wx = positions[v * 3], wy = positions[v * 3 + 1], wz = positions[v * 3 + 2];
    let sum = 0;
    for (let e = 0; e < envelopes.length; e++) {
      const c = Math.exp(-k * sdEnvelope(envelopes[e], wx, wy, wz));
      contrib[e] = c; sum += c;
    }
    // partial top-N selection
    const off = v * 4;
    for (let n = 0; n < topN; n++) {
      let bi = -1, bc = -1;
      for (let e = 0; e < envelopes.length; e++) {
        if (contrib[e] > bc) { bc = contrib[e]; bi = e; }
      }
      if (bi < 0 || bc <= 0) break;
      skinIndex[off + n] = envelopes[bi].boneIdx;
      skinWeight[off + n] = sum > 0 ? bc / sum : 0;
      contrib[bi] = -1;   // remove so next iteration picks the next best
    }
    // renormalize the kept weights so they sum to 1
    let kept = 0;
    for (let n = 0; n < 4; n++) kept += skinWeight[off + n];
    if (kept > 1e-6) for (let n = 0; n < 4; n++) skinWeight[off + n] /= kept;
    else skinWeight[off] = 1;
  }

  // ---- assemble geometry ----------------------------------------------------
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.computeVertexNormals();
  geometry.userData.boneNames = boneNames;   // skinIndex value -> bone name

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const stats = {
    tris: indices.length / 3, verts: nVerts, ms,
    grid: [nx, ny, nz], voxel: h, envelopes: envelopes.length, boneNames,
  };
  geometry.userData.fieldStats = stats;
  return { geometry, stats };
}
