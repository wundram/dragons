# Rigging & Skinning — concrete recommendation

Decides the two open sub-problems for the evolving dragon generator: (1) the **rig** (a skeleton that serves both mesh generation AND animation) and (2) the **skin** (what surface wraps it, and how a *procedurally-generated* mesh follows the bones with no hand-painted weights). Supersedes the open "skin tension" in `docs/roadmap.md` and `design/architecture-synthesis.md` with a buildable plan. Pressure-tested against the placeholder defects in `design/testbed-eval-01.md`.

## TL;DR (the actual call)

- **Rig: one fixed-topology "maximal" skeleton, shared by every dragon at every age.** Backbone (fixed N≈24 vertebrae) + skull + jaw + shoulder/hip girdles + 4 limb chains + tail, with **stable bone names for all**. Genome+age don't add or remove bones — they set each bone's **length and envelope radius**. Snake body plans = limb bones scaled toward zero; quadruped = limb bones grown. This makes the snake→limbed metamorphosis a pure *surface* effect over an unchanging rig, so **keyframe animations survive every growth re-bake** (the single most important constraint).
- **Surface generation: primitive envelopes → one implicit field → two render back-ends. Adopt it — it's right.** Per-bone capsule/ellipsoid, radius = genome×age (hatchling limb radius ≈ 0), summed into a **field**. Testbed = **marching cubes** (smooth, answers the aesthetics question). Minecraft = **greedy-voxelized cuboids** from the *same* field (organic silhouette, blocky surface, bakes straight to `geo.json`). One source of truth, two skins.
- **Deformation binding: do NOT use Pinocchio or Bounded Biharmonic Weights. Derive weights for free from the field.** Because we *build the mesh from the skeleton*, every field sample already knows which bones' envelopes made it. A **softmax over per-bone field contributions** gives smooth blend weights at joints at ~zero cost — no heat-diffusion solve, no quadratic program. The whole point of Pinocchio/BBW is recovering the bone↔mesh relationship for an *arbitrary* mesh; we never lose it, so we never pay to recover it. **MC cuboid path = rigid (one bone per cube); smooth path = field-softmax LBS.**
- **Skin tension — resolved as a false dichotomy.** The envelope field gives the cuboid path an *organic, rounded silhouette* (blocky surface, not larval segments) — that already fixes the eval-01 "caterpillar" defect without smooth meshes. Ship cuboids as the MC path; keep marching cubes as the testbed's beauty reference and the side-by-side cuteness measurement. My prediction: field-voxelized cuboids read "cute enough"; if the head specifically doesn't, bump *only the head's* voxel resolution (hybrid), don't go full custom-mesh in MC.
- **Build order:** (1) fixed-topology skeleton + per-bone allometric growth, rendered as **raw capsule/ellipsoid primitives** (no field yet) — this alone scrubs a valid cute→cool arc and proves snake→limb budding; (2) implicit field + **marching cubes** smooth back-end with field-softmax weights; (3) **voxelized-cuboid** back-end + `geo.json` export (the MC bridge). Face rig, markings, breeding after.

---

## Findings

### Technique verification (corrections to the brief in **bold**)

| Technique | What it actually does | Cost | Verdict for us |
|---|---|---|---|
| **Pinocchio auto-rig** (Baran & Popović 2007) | Packs spheres on the medial surface, embeds a *template* skeleton into that graph by discrete+continuous optimization, then computes skinning weights by solving a **steady-state heat-diffusion** (sparse Laplacian) system per bone over interior voxels. | Offline, ~seconds for a whole rig; weights alone sub-second. | **Don't use.** It solves the *inverse* problem (unknown mesh, unknown bone assignment). We generate the mesh from known bones, so the weights are already known. |
| **Bounded Biharmonic Weights** (Jacobson et al. 2011) | Smooth, non-negative, local, **bounded** weights from bones/cages/points by minimizing a biharmonic (Laplacian²) energy as a **quadratic program** on an FE discretization of the volume. Best-in-class weight quality. | **~minutes**, bind-time precompute only — explicitly "compute once, reuse." | **Don't use at runtime.** Far too slow for a per-growth-tick re-bake; overkill for a stylized creature. |
| **FAST** (Fast Automatic Skinning Transformations, Jacobson et al. SIGGRAPH 2012) | **The brief mis-labels this as an "editor-time weighting tool." It is not a weighting method at all.** It's a **runtime pose *solver***: given a *sparse* set of handle constraints it infers all the *other* bone **transforms** by minimizing ARAP energy in a reduced subspace (local/global solver). Uses *pre-existing* weights (typically BBW). | Real-time — 100 armadillos @ 30 fps, 1 CPU core. | Not relevant. It answers "given a few dragged handles, where do the other bones go?" — we drive every bone directly from genome+age, so there's nothing to infer. |
| **B-Mesh** (Ji et al. 2010) | Skeleton + "key balls" at nodes → auto-generated **quad-dominant base mesh** with clean edge-flow along bones, then subdivided. | Interactive. | Close cousin of our envelope idea, and a real alternative for surface gen. **Rejected as base**: it produces *clean stable quad topology* (nice) but that topology **changes when the skeleton changes**, and re-deriving it every growth bake is more code than marching cubes for no gameplay benefit. Keep as a fallback if MC topology ever cracks. |
| **Convolution / implicit surfaces** (Bloomenthal; convolution-surface line) | Field = kernel convolved along skeleton primitives; iso-surface via marching cubes. Key property: **bulge-free, crease-free** blends, *independent of how the skeleton is split into primitives* — unlike naive metaballs, which bulge where blobs overlap. | Field eval + marching cubes. | **Adopt the *idea*.** Use a convolution-style / smooth-min summed field rather than hard-union metaballs so limb-into-body joins are smooth, not lumpy. |
| **Marching cubes** | Polygonizes an iso-surface from a scalar field sampled on a grid; one lookup-table pass per cell. | ~O(cells). See budget below. | **Adopt** as the testbed smooth back-end and the field's iso-extractor. |
| **LBS vs Dual-Quaternion skinning** (Kavan et al.) | LBS = weighted blend of bone matrices; cheap, ubiquitous, but **candy-wrapper collapse** on twist and joint collapse. **DQS** blends rigid transforms; kills candy-wrapper at **negligible extra cost**, introduces mild **joint bulging**. | Both real-time; DQS ≈ LBS. | **LBS is fine for us** (stylized, gentle joint rotations, Three.js default). Note DQS as a cheap upgrade if adult wing/neck twist shows candy-wrapper. GeckoLib/MC bones are rigid per-cube anyway. |

**Net correction:** of the seven, only **marching cubes**, **convolution-style fields**, and **LBS** are load-bearing for us. Pinocchio/BBW/FAST are all solving problems we designed away by generating the mesh *from* the rig. That is the central simplification in this document.

### Rigging

**One canonical maximal skeleton, fixed bone set, stable names — genome scales it, never restructures it.**

Bone graph (parented transforms, matches `geo.json`/GeckoLib bone tree 1:1):

```
root
└─ pelvis
   ├─ spine.00 … spine.NN            (fixed N≈24; "backbone chain")
   │   └─ (last used) → neck implied by spine curve → skull
   │       └─ jaw
   ├─ shoulderGirdle
   │   ├─ legFL.0 → legFL.1 → footFL   (front-left limb chain)
   │   └─ legFR.0 → legFR.1 → footFR
   ├─ hipGirdle
   │   ├─ legBL.0 → legBL.1 → footBL
   │   └─ legBR.0 → legBR.1 → footBR
   ├─ wingL.0 → wingL.1 → wingL.2      (wing spars = bone chain)
   ├─ wingR.0 → wingR.1 → wingR.2
   └─ tail.00 … tail.MM               (fixed M≈16)
```

- **Fixed topology is deliberate.** Backbone/tail length is a *genome trait*, but we express it by scaling per-segment length (unused tail segments → length ≈ 0), **not** by adding/removing bones. A Chinese/eastern serpentine dragon = long backbone (all vertebrae elongated) + limb chains scaled toward zero radius/length; a wyvern = no front legs (radius≈0) + big wings; a quadruped = all four limbs grown. **The named body "types" are attractor regions in continuous (segment-length, limb-length, limb-radius, wing-size) space** — exactly the parametric-emergent decision, and it drops out of scaling one fixed rig. Breeding = lerp/crossover of those scalars → always a valid pose of the same rig.
- **Genome+age drive it via allometry** (per `research/rule-based-growth.md`): each bone's `length` and `envelopeRadius` = `a · age^b`, with `b<1` for neotenous parts (skull big early) and `b>1` for mature parts (limbs/snout long late). **Limb "budding" from the girdles is the surface consequence of `envelopeRadius` and `length` rising from ≈0** — the bone was always there. This is why the snake-origin idea holds up **and** is safe: the hatchling animates (slithers) on the very same rig the adult walks on, because the leg bones exist at birth; they're just sub-visible. Adding real bones at age thresholds (the naïve reading) would break every animation bound before the threshold — **rejected**.
- **Stability across re-bakes:** the bone *name set is identical for every genome at every age*. Animations authored in Blockbench against `spine.03`, `jaw`, `wingL.1` bind for all dragons forever. Growth re-bakes change cube geometry, never bone names — this is the MC research's "Option B path 2 (fixed topology + runtime deformation)," which it flagged as the safe path.
- **MC mapping:** the skeleton *is* the GeckoLib bone tree. Testbed emits it as Bedrock `geo.json` bones; each bone owns the cubes the voxelizer assigned it.

### Surface generation

**Primitive envelopes → summed field → two back-ends. This is the correct architecture; keep it.**

1. **Envelope per bone.** Capsule (limbs, tail, neck vertebrae, wing spars), ellipsoid (skull, ribcage/thorax, abdomen), radius/half-axes = genome×age traits. Cheap, and directly encodes allometry.
2. **Field.** Sample a smooth-min / convolution-style sum of the envelopes on a grid → scalar field `F(x)`, plus a per-cell **argmax bone id** and the per-bone contribution vector (kept for weighting, below). Smooth-min (not hard union) buys bulge-free limb-into-torso joins — the fix for eval-01's "spindly floating spikes / segmented body."
3. **Back-end A — smooth (testbed):** marching cubes on `F` → triangle mesh for beauty renders and the cuteness eval.
4. **Back-end B — cuboids (Minecraft):** sample `F` on a coarse grid, **greedy-merge** solid runs into axis-aligned boxes (30–120 cubes, matching the MC research budget), each box tagged to the dominant bone → emit `geo.json`. Organic overall shape, blocky surface — the native-MC aesthetic *plus* roundness.

Why this beats the placeholder's stacked tapered cylinders: the field **unifies** neighbouring envelopes into one continuous body instead of visible ring-seam segments (the exact "caterpillar/larval" defect). Why it beats plain metaballs: convolution-style blending doesn't bulge at overlaps. Why not B-Mesh: it gives prettier quad topology but changes topology with the skeleton and needs re-meshing every bake — more code, no player-visible win over marching cubes.

**Appendages (horns, back-spines, wing membranes)** stay as the synthesis already has them: threshold-gated tubes/L-systems over the same rig. Horns are envelopes/tubes anchored to `skull`; back-spines to `spine.*`; **wing membrane = a triangulated sheet spanning the `wingL/R.*` spar bones** (not part of the volumetric field — thin sheets are the classic field/metaball failure). This also anchors eval-01's floating-horn and flat-wing defects to real bones.

### Deformation binding

**The load-bearing simplification: weights come from the field, not from a solver.**

- When we build `F`, each grid cell records `w_b = contribution of bone b's envelope`. For any marching-cubes vertex, interpolate those contributions and take a **softmax** → smooth per-bone blend weights, naturally soft at joints (where two envelopes overlap) and rigid in the middle of a bone. **Cost: a normalize per vertex.** This is "auto-weights from the same voxel field" done right — provenance, not diffusion.
- **Is smooth weighting even worth it?** Two answers, one per back-end:
  - **Minecraft (cuboids): NO — use rigid.** Each cube is parented to its dominant bone (one bone per cube). This is literally how every MC model works, animations look correct, and it's zero-risk. Smooth weights buy nothing on a blocky surface.
  - **Testbed (smooth mesh): YES — use field-softmax LBS.** Rigid per-bone chunks would crack/self-intersect at the neck and limb roots when posed. Field-softmax gives clean bends for free. Standard Three.js `SkinnedMesh` + LBS consumes these weights directly.
- **No runtime heat-diffusion / QP anywhere.** If we ever want higher-quality smooth weights offline (e.g. a hero render), *then* reach for BBW as a one-off — never on a growth tick.

### Compute budget (≤10 pets, recompute on growth ticks, cache)

Assume a dragon fits a grid of ~**48³ voxels** (≈110k cells) for the field; adults with long tails/necks use an anisotropic grid (e.g. 32×32×80) at similar total cell count.

- **Field eval:** ~40–120 envelopes × 110k cells, but each cell only needs nearby envelopes (bucket by bone AABB) → a few M cheap ops. **~2–8 ms JS.**
- **Marching cubes @ 48³:** one LUT pass over 110k cells → typically **3–15k triangles**, **~5–20 ms JS**. At 64³ (~260k cells) budget ~15–50 ms and ~10–25k tris — still fine on a growth tick. (These are *tick* costs, seconds apart, cached — never per-frame.)
- **Voxelize + greedy-merge to cuboids:** coarse grid (~24³) + run-merge → 30–120 boxes, **sub-5 ms**.
- **Weights (field-softmax):** per-vertex normalize — **<1 ms**.
- **Memory:** smooth mesh ~10–25k tris ≈ few hundred KB; cuboid model tens of KB; field grid is transient (freed after extraction). 10 pets × (current+prev bucket for crossfade) ≈ low single-digit MB. Trivial.
- **Caching:** key = `hash(genome) ⊕ quantize(age)` into **~64–128 age buckets** over the arc (per MC research). Re-bake **per bucket**; between buckets **interpolate bone transforms** (length/rotation) and skin the *current* bucket's mesh, with a discrete mesh swap at bucket boundaries (imperceptible at 64+ buckets). Never marching-cube per frame.
- **In-browser verdict:** comfortable. **In-mod verdict:** the mod **skips marching cubes entirely** — it runs only the cheap voxelize→cuboid path (sub-5 ms/pet), so 10 pets re-baking on the same tick is still single-digit ms. The heavy marching cubes lives only in the testbed.

**Cheaper fallback if any of this bites:** drop the field for build-step 1 and render **raw capsule/ellipsoid primitives per bone** (no grid, no marching cubes, instant). That already gives a rounded, non-larval silhouette and a scrubable arc; the field is a *quality* upgrade layered on top, not a prerequisite.

---

## Recommendation (decisive)

**Build the field-unified envelope generator over one fixed-topology skeleton, with weights derived from field provenance. No Pinocchio, no BBW, no FAST at runtime.** Concretely:

**Data structures**
- `Genome` — flat scalar vector (as `architecture-synthesis.md` v0): per-part allometric `(a,b)` for segment lengths, limb length/radius, skull/snout/eye/neck/torso/tail, wing size, horn/spine thresholds, plus colour/marking/mood.
- `Skeleton` — fixed array of named `Bone{ name, parentIdx, restLen, restRot }`; `resolvePose(genome, age)` fills `len`, `worldTransform`, `envelope{type, radius|halfAxes}` per bone. **Names constant for all genomes/ages.**
- `Field` — `{grid dims, F[], dominantBone[], contrib(sparse per cell)}`, transient.
- `SkinBundle` — either `{tris, verts, boneWeights[]}` (smooth) or `{cubes:[{origin,size,uv,boneName}]}` (cuboid).
- `RigBake` cache — `Map<genomeHash⊕ageBucket, SkinBundle>`.

**Build order for the testbed** (each step independently renders + evals):
1. **Fixed-topology skeleton + allometric growth, rendered as raw per-bone capsules/ellipsoids.** Wire the age slider to `resolvePose`. Success = scrub 0→1 shows snake-hatchling → limbed adult with limbs *budding* from girdles (radius rising from 0), no floating parts, animations bind to stable names. This alone retires eval-01 defects #1 (floating horns → anchor to `skull`), #3 (larval body → continuous envelopes), #6 (leg cylinders).
2. **Implicit field + marching-cubes smooth back-end + field-softmax LBS weights.** Success = smooth continuous body, clean limb-into-torso joins, poses without cracking. Run first cuteness eval (Claude Read + `grok.sh eval`).
3. **Voxelized-cuboid back-end + `geo.json` export.** Greedy-merge, one-bone-per-cube rigid. Success = organic-silhouette blocky dragon that loads in Blockbench; **run the cuboid-vs-smooth side-by-side cuteness eval — this is the experiment that formally closes the skin tension.**
4. **Face sub-rig** (8-param eyes+brows + eyelid shell) anchored to `skull`, per `research/expressive-faces.md`. Fixes eval-01 #2 (cross-eyed pupils → converge on look target; baby sclera).
5. **Appendages** (threshold horns/spines as tubes on `skull`/`spine.*`; wing membrane sheet on spars). Fixes #4, #5.
6. **Breeding crossover** control; **markings** (Gray-Scott) last.

**Minecraft bake path:** testbed step 3 already emits the portable artifact. In-mod: genome+age → `resolvePose` → field → voxelize → `geo.json`-equivalent `BakedGeoModel`, cached per age-bucket, per-bone transform lerp between buckets, rigid cube→bone weights, keyframe animations bound to the stable bone names. **The mod never runs marching cubes.** This is exactly the MC research's recommended GeckoLib Option-B path.

**Explicitly DEFER:**
- Marching cubes *in the mod* (testbed-only; only revisit if cuboids fail the cuteness eval **and** a hybrid head doesn't rescue it).
- Dual-quaternion skinning (only if adult twist shows candy-wrapper).
- BBW / any offline high-quality weight solve (only for hero renders, never gameplay).
- B-Mesh quad re-topology (fallback only if MC cuboid topology cracks).
- Per-dragon `DynamicTexture` markings, reaction-diffusion (after silhouette is locked).
- ML/latent anything (permanently out per track 1).

## Risks & fallbacks

- **Cuboid path reads too blocky/un-cute** → the eval may still reject cuboids. Fallback: **hybrid** — raise voxel resolution on the head only (rounded face, blocky body); it's cheap because it's a local grid refinement, and the field already supports it. Full custom-mesh-in-MC stays off the table (MC research: high risk, Vulkan-backend churn).
- **Marching-cubes topology flips between age buckets** cause a visible "pop" at bucket boundaries → increase bucket count (128), and/or crossfade opacity across the swap. Bone-transform interpolation (not vertex morph) is what carries per-frame smoothness, so pops are bounded to bucket edges.
- **Field-softmax weights too soft (rubbery joints)** → sharpen the softmax temperature, or clamp to top-2 bones. Still no solver.
- **Fixed N/M backbone/tail caps too short for an extreme serpentine dragon** → raise the caps (cost is a few always-present near-zero bones); do **not** make counts genome-variable (would break the stable-name guarantee).
- **Greedy-merger produces >120 cubes on a long adult** → coarsen the voxel grid or cap cube count with a merge budget; MC render cost is linear and forgiving at ≤10 pets.

## Sources

- Baran & Popović, *Automatic Rigging and Animation of 3D Characters* (Pinocchio), SIGGRAPH 2007 — https://history.siggraph.org/learning/automatic-rigging-and-animation-of-3d-characters-by-baran-and-popovic/
- Jacobson, Baran, Popović, Sorkine, *Bounded Biharmonic Weights for Real-Time Deformation*, SIGGRAPH 2011 (~minutes, precompute-only QP) — https://igl.ethz.ch/projects/bbw/bounded-biharmonic-weights-siggraph-2011-jacobson-et-al.pdf · CACM version: https://cacm.acm.org/research/bounded-biharmonic-weights-for-real-time-deformation/
- Jacobson, Baran, Kavan, Popović, Sorkine, *Fast Automatic Skinning Transformations* (FAST — runtime ARAP pose solver, NOT a weighter), SIGGRAPH 2012 — https://igl.ethz.ch/projects/fast/fast-automatic-skinning-transformations-siggraph-2012-jacobson-et-al.pdf · code: https://github.com/alecjacobson/FAST
- Ji, Liu, Wang, *B-Mesh: A Modeling System for Base Meshes of 3D Articulated Shapes*, Pacific Graphics / CGF 2010 — https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2010.01805.x · impl: https://github.com/CorentinDumery/BMesh
- Bloomenthal & Shoemake, *Convolution Surfaces* (bulge/crease-free skeleton implicits) — https://www.unchainedgeometry.com/JBloom/pdf/CSurfFinal.pdf · controllable-blend follow-up: https://www.sciencedirect.com/science/article/abs/pii/S0097849322000887
- Kavan et al., *Skinning with Dual Quaternions* (LBS candy-wrapper vs DQS bulge, negligible cost) — https://users.cs.utah.edu/~ladislav/kavan07skinning/kavan07skinning.html · SIGGRAPH 2014 skinning course: https://skinning.org/direct-methods.pdf
- Three.js marching cubes example (in-browser feasibility) — https://threejs.org/examples/webgl_marchingcubes.html
- Prior internal: `design/architecture-synthesis.md`, `design/testbed-eval-01.md`, `research/parametric-creature-modeling.md`, `research/rule-based-growth.md`, `research/minecraft-model-generation.md`, `research/expressive-faces.md`
