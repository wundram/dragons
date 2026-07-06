// geojson.js — Bedrock / Blockbench `geometry.*` exporter for the voxel-cuboid
// skin. This is the Minecraft bridge artifact (the doc's "testbed→MC interchange
// format"): GeckoLib and Blockbench both load Bedrock `geo.json` natively, so the
// voxelized dragon opens in Blockbench for inspection and drops into a
// NeoForge/GeckoLib mod with zero custom importer.
//
// WHAT IT EMITS
// -------------
// One `minecraft:geometry` entry whose `bones` are the STABLE skeleton bone names.
// Backbone/head: spine_00.., tail_00.., skull, snout, jaw. Girdles: shoulderGirdle,
// hipGirdle. The UNIFIED bat-wing forelimb (per side foreL/foreR): _upperArm,
// _foreArm, _wrist, _finger{0..3}_{00,01,02} + _finger{0..3}_claw. Hind legs
// (hindL/hindR): _upper, _lower, _foot, _toe{0..3}, _toe{0..3}_claw. There are NO
// separate wing bones — the wing IS the forelimb (finger0 = primary spar); the
// membrane is a separate render mesh, not a bone. Every skeleton bone is emitted
// (even absent/zero-radius ones) so the bone tree + parent chain is identical for
// every genome/age — keyframe animations authored against these names survive
// every growth re-bake. Cubes from computeVoxelCubes() (body-volume kinds: body/
// skull/limb/foot/girdle) attach under their dominant bone as `{origin,size,uv}`;
// thin fingers/toes/claws carry no cubes but still appear as pivot bones.
//
// MODEL SCALE / COORDINATES (documented convention)
// -------------------------------------------------
//   * Minecraft uses 16 pixels per block. We map 1 TESTBED UNIT = 1 BLOCK = 16 px
//     (PIXELS_PER_UNIT = 16). So an adult (~2.7 units tall, ~9 long) becomes a
//     ~2.7-block-tall, ~9-block mount-sized dragon; a hatchling ~1 block — a
//     sensible pet→mount growth arc. Change PIXELS_PER_UNIT to rescale globally.
//   * Axes: Bedrock model space is Y-up, +X right, +Z south, same as the testbed.
//     We lift the whole model so the lowest cube sits at y=0 (feet on ground),
//     matching the testbed's feet-to-ground. `origin` is each cube's MIN corner
//     (Bedrock convention); `size` is positive px extents.
//   * UVs are placeholder single-texel box mapping (uv:[0,0] on a 16×16 sheet):
//     a flat tint pending the parametric texture atlas (research/minecraft-
//     model-generation.md §5). Structure is valid geo.json; retexture in
//     Blockbench or via the atlas step.
//   * FACE is intentionally omitted from the geo.json for now (documented): the
//     eyes/brows stay a separate layered sub-rig (face.js) / future GeoLayer, not
//     part of the volumetric cuboid body.

import { computeVoxelCubes } from './voxel.js';

export const PIXELS_PER_UNIT = 16;   // 1 testbed unit = 1 MC block = 16 px

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------
// buildGeoJSON(bones, opts) -> { json (object), stats }
// ---------------------------------------------------------------------------
// opts: { identifier?, voxelRes?, smoothK?, headRes?, textureSize? } plus any
// computeVoxelCubes opts. Returns the geometry object and a small summary.
export function buildGeoJSON(bones, opts = {}) {
  const S = opts.pixelsPerUnit ?? PIXELS_PER_UNIT;
  const identifier = opts.identifier ?? 'geometry.dragon';
  const tex = opts.textureSize ?? 16;

  const { cubes, boneNames, stats } = computeVoxelCubes(bones, opts);

  // Feet-to-ground: lift so the lowest cube corner is at y = 0.
  let yFeet = Infinity;
  for (const c of cubes) yFeet = Math.min(yFeet, c.origin[1]);
  if (!isFinite(yFeet)) yFeet = 0;

  // Group cubes by their assigned bone name.
  const cubesByBone = new Map();
  for (const c of cubes) {
    if (!cubesByBone.has(c.boneName)) cubesByBone.set(c.boneName, []);
    cubesByBone.get(c.boneName).push({
      origin: [r4(c.origin[0] * S), r4((c.origin[1] - yFeet) * S), r4(c.origin[2] * S)],
      size: [r4(c.size[0] * S), r4(c.size[1] * S), r4(c.size[2] * S)],
      uv: [0, 0],
    });
  }

  // Emit EVERY skeleton bone (stable tree), attaching cubes where assigned.
  const geoBones = [];
  for (const b of bones) {
    const entry = {
      name: b.name,
      pivot: [r4(b.pos.x * S), r4((b.pos.y - yFeet) * S), r4(b.pos.z * S)],
    };
    if (b.parent) entry.parent = b.parent;
    const cs = cubesByBone.get(b.name);
    if (cs && cs.length) entry.cubes = cs;
    geoBones.push(entry);
  }

  // Visible bounds (in blocks) for the description block.
  let miX = Infinity, miY = Infinity, miZ = Infinity, maX = -Infinity, maY = -Infinity, maZ = -Infinity;
  for (const c of cubes) {
    const o = c.origin, s = c.size;
    miX = Math.min(miX, o[0]); miY = Math.min(miY, o[1] - yFeet); miZ = Math.min(miZ, o[2]);
    maX = Math.max(maX, o[0] + s[0]); maY = Math.max(maY, o[1] - yFeet + s[1]); maZ = Math.max(maZ, o[2] + s[2]);
  }
  if (!isFinite(miX)) { miX = miY = miZ = maX = maY = maZ = 0; }
  const bw = Math.max(maX - miX, maZ - miZ);
  const bh = maY - miY;

  const json = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier,
          texture_width: tex,
          texture_height: tex,
          visible_bounds_width: r4(bw),
          visible_bounds_height: r4(bh),
          visible_bounds_offset: [r4((miX + maX) / 2), r4((miY + maY) / 2), r4((miZ + maZ) / 2)],
        },
        bones: geoBones,
      },
    ],
  };

  const summary = {
    identifier,
    bones: geoBones.length,
    bonesWithCubes: cubesByBone.size,
    cubes: cubes.length,
    pixelsPerUnit: S,
    boundsBlocks: { min: [r4(miX), r4(miY), r4(miZ)], max: [r4(maX), r4(maY), r4(maZ)] },
    voxelGrid: stats.grid,
    headHiRes: stats.headHiRes,
  };
  return { json, summary };
}

// Resolve the bone list from a dragon Group (userData.skeleton) or a raw array.
function resolveBones(src) {
  if (Array.isArray(src)) return src;
  if (src && src.userData && Array.isArray(src.userData.skeleton)) return src.userData.skeleton;
  throw new Error('exportGeoJSON: expected a dragon Group (userData.skeleton) or a bones array');
}

// ---------------------------------------------------------------------------
// exportGeoJSON(dragonOrBones, opts) -> JSON string
// ---------------------------------------------------------------------------
// The public one-call export. Recomputes the voxel cubes from the skeleton (so it
// works regardless of the current on-screen skin mode) and returns pretty JSON.
// `opts.summary === true` returns { json: string, summary } instead of a string.
export function exportGeoJSON(dragonOrBones, opts = {}) {
  const bones = resolveBones(dragonOrBones);
  // Default the voxel resolution from the same global the renderer uses.
  const voxelRes = opts.voxelRes
    ?? (typeof window !== 'undefined' ? window.__voxelRes : undefined) ?? 24;
  const headRes = opts.headRes
    ?? (typeof window !== 'undefined' ? window.__voxelHeadRes : undefined) ?? 1;
  const { json, summary } = buildGeoJSON(bones, { ...opts, voxelRes, headRes });
  const str = JSON.stringify(json, null, 2);
  return opts.summary ? { json: str, summary } : str;
}
