# CA-driven surface-feature placement (spikes, ridges, scales, feathers, markings)

Research + implementation proposal for placing **distributed surface features** on the
procedurally-generated dragon body via a cellular-automaton-like process, integrated with the
existing test-bed generator (`testbed/src/generator.js`, `field.js`, `voxel.js`). Reconciles with
`research/rule-based-growth.md` (which already recommends reaction-diffusion for markings +
threshold-gated L-systems for hero appendages).

## TL;DR (5 bullets)

- **Recommendation: build the CA on a *body-anchored (u,v) tube lattice*, not a free hex mesh on an
  arbitrary surface.** Our body already IS a generalized cylinder along the fixed `spine_00..23` +
  `tail_00..11` bone chain, so index cells by `(rail segment u, angular sector v)`. This is inherently
  **stable and comparable across every genome/age** (the bone name set never changes — the whole point
  of the fixed-topology rig) and it sidesteps the fact that you *cannot* regular-hex-tile a closed
  surface (Euler characteristic forces 12 pentagons — Goldberg/geodesic polyhedra). Hex 6-neighborhood
  is recovered by **staggering alternate rings** (brick offset). The user's "hex grid + fixed anchors +
  variable cell size" instinct is right; anchoring it to the skeleton rails is the refinement that makes
  it robust and breed-able.
- **Use ONE activator–inhibitor CA to drive BOTH discrete features and continuous color.** Discrete
  features (spikes, scutes, feather buds) = *thresholded peaks* of the field; continuous markings =
  the *smooth field value* written to vertex colors. This is exactly how real reptile scales and
  bird/feather placodes pattern (Turing-type lateral inhibition; Manukyan & Milinkovitch 2017 showed
  crocodile head scales are literally a **cellular automaton**). It **subsumes** rule-based-growth's
  Gray-Scott GPU shader for markings — but on the body-anchored graph instead of a screen-space
  texture, so it is serializable (small integer/float grid state) and breed-able.
- **Division of labor (reconciles the two docs):** allometric curves = body shape (existing);
  **L-systems/tubes at named anchor slots = a handful of HERO appendages** (horns, major dorsal crest
  struts, wing claws) — keep rule-based-growth Layer B; **this CA = the *field* of DISTRIBUTED
  features** (spike rows, scutes, scales, feather patches) + coloration. The CA can even *modulate*
  each hero appendage's magnitude at its anchor. The CA does NOT replace the L-systems; it replaces
  the RD screen-shader and adds discrete scatter.
- **Age is the CA clock → cute→cool for free.** Seed a few anchor cells at birth (dorsal-ridge seed,
  tail-tip seed, horn seeds); run `round(age·Gmax)` deterministic generations; spikes emerge, spread
  with lateral inhibition (even spacing = blue-noise), and *sharpen/heighten* with age. Local
  modulators — **cell physical area** (getting fat enlarges cells → raises activation threshold →
  suppresses spikes, exactly the user's example), **surface curvature** (convex crests favor spikes),
  and **body region masks** — gate the rule. Fully deterministic from `(genome, age)` via a genome-
  seeded PRNG (mulberry32), so save/load, network sync and breeding all just carry genome+age.
- **Rendering is layered, never swallowed by the field** (same pattern the wing membrane and face rig
  already use): spikes/feathers/scutes are **separate instanced meshes** attached at cell surface
  points along the bone normal; markings are a **vertex-color / per-cube tint** on the existing body
  mesh. Every layer **degrades to voxel** — a spike becomes a 1–2 voxel protruding cube stack tagged
  to its bone (bakes straight to `geo.json`), a marking becomes a per-cube color. First two build
  steps: (1) `featureGrid.js` — the (u,v) lattice + adjacency from the bones, with a debug dot overlay;
  (2) the CA **markings** pass writing vertex colors (subsuming the RD shader) with genome traits +
  seeded PRNG + breeding.

---

## Findings

### 1. CA vs reaction–diffusion for biological patterning

Turing's 1952 reaction–diffusion (RD) model — two morphogens, a short-range **activator** and a
long-range **inhibitor** — is the canonical explanation for animal-coat patterns (spots, stripes,
labyrinths). The **Gray-Scott** system is the popular discretization, selecting patterns via a
**feed rate `f`** and **kill rate `k`**; it runs cheaply as a ping-pong fragment shader (the approach
rule-based-growth.md recommends). RD is intrinsically **continuous** — it produces smooth concentration
fields, ideal for **color/markings**.

The key modern result for *us*: **discrete biological features are patterned by activator–inhibitor
dynamics running on a discrete cell grid**, i.e. a CA, not a continuous field:

- **Lizard scales ARE a cellular automaton.** Manukyan, Montandon, Fofonjka & Milinkovitch (*Nature*,
  2017, *"A living mesoscopic cellular automaton made of skin scales"*) showed ocellated-lizard skin
  colour develops as a **discrete von Neumann CA on a quasi-hexagonal lattice of scales** — each scale
  flips green↔black as a function of its neighbours' states, tracked over years of growth. Direct
  biological precedent for *discrete features on a discrete body grid* — exactly our spike/scale/marking
  case, and validation of the user's hex-grid instinct.
- **The discrete CA is a coarse-graining of continuous RD — this tells us WHEN to use which.** Fofonjka
  & Milinkovitch (*Nature Communications*, 2021) proved that dropping diffusion by >80% at *scale
  boundaries* (a consequence of 3D skin-thickness variation) makes a continuous Gray-Scott field
  **collapse into scale-by-scale discrete CA switching**. So: continuous RD/smooth-field for
  **continuous** features (color gradients, soft markings, where diffusion crosses freely); a discrete
  hex/graph CA for **discrete** units (scales, spikes, plates, where the unit boundary quantizes state).
  **This is precisely why one grid can serve both** — the smooth channel is the field, the discrete
  features are where the boundary quantizes it. The same paper shows **growth rescales the pattern's
  relative length-scale** (bigger body → finer relative pattern), a direct hook for age-driven marking
  evolution.
- **Feather / follicle spacing** (placodes) is set by a **propagating patterning wave from the dorsal
  midline + BMP lateral inhibition** spacing buds within a tract. That "traveling front + local
  inhibition" is trivially a CA update seeded at the spine, and gives **blue-noise-like spacing of
  spikes/feathers for free** without a separate Poisson-disk pass.

**When a discrete hex/graph CA beats a continuous RD field:** for **DISCRETE, countable, placed**
features — a *row of dorsal spikes*, individual *scutes*, *feather buds* — you want addressable cells
with integer state, spacing via lateral inhibition, and a stable identity per feature (so it can grow,
be re-rendered, and be inherited). For **CONTINUOUS** features — color gradients, blotches, stripes —
a smooth field (RD, or the smooth channel of the same CA) is more natural. **Our design runs both on
one grid:** discrete features are thresholded local maxima; color is the underlying smooth channel.

### 2. Mapping a grid onto our body: anchor rails, not sphere-hex

- **You cannot regular-hex-tile a closed surface.** By Euler's formula a hexagon-only tiling of a
  sphere-topology surface is impossible; you need exactly **12 pentagonal defects** (Goldberg /
  geodesic polyhedra — the soccer-ball/geodesic-dome construction). So a "hex grid on the whole dragon"
  as a single sphere-wrap is mathematically awkward and, worse, **unstable across body shapes**.
- **But the dragon body is a branching tube**, and a tube has a trivial, stable **cylindrical
  parameterization**: arc-length `u` along the axis × angle `v` around the circumference. Our skeleton
  hands us this for free — the `spine_*`/`tail_*` chain IS the `u` axis and each bone's cross-section
  ring IS the `v` circle. Hex adjacency is recovered by **offsetting alternate rings by half a sector**
  (a brick/staggered lattice → 6 neighbours each). Limbs, neck and head are **sub-rails** branching off
  at girdle/skull nodes → the whole thing is a **graph CA over a tree of tubes**.
- **Anchor stability = bone-name stability.** Because the bone name set is identical for every dragon
  at every age (the fixed-topology invariant), cells indexed by `(boneName, sectorIndex)` are the
  **same cell** on two different dragons — so two patterns are directly comparable/combinable for
  breeding, with no geodesic re-parameterization or registration step. This is strictly more robust
  than trying to lay a free hex mesh on each individual's marching-cubes surface.
- **Blue-noise / Poisson-disk** distribution (the standard way to scatter elements evenly on a surface)
  is what the CA's lateral inhibition *produces*, so we get even feature spacing without a separate
  sampler; where we want pure scatter (e.g. small back-scales) a Poisson-disk seeding of the grid is a
  cheap alternative seed.
- **Fallback for off-tube regions (head crest, wing webbing, broad flanks):** where the clean tube
  parameterization degrades, use a **geodesic distance field** — "Geodesics in Heat" (Crane et al.)
  computes distance from anchor bones via two sparse solves. Each surface point's tuple of geodesic
  distances to a few fixed anchors is a **body-region coordinate stable across body shapes**, which is
  the general form of what the tube `(u,v)` gives cheaply on the trunk. We only need this if the tube
  scheme proves insufficient on the head/wings; start with the tube. This mirrors **Spore's
  morphology-independent placement** (Hecker): features are selected by body-region *role/query*
  ("dorsal ridge, shoulder→tail-tip"), not fixed coordinates, so one genome works across body shapes.

### 3. Procedural scale/spike/feather placement in games & graphics

- **Scatter along surface normals with instancing.** The production pattern for scales/spikes/feathers
  is: pick surface points (blue-noise), read the surface **normal + tangent frame**, and **instance** a
  small element oriented to the normal (spike = cone along normal with a backward tilt; feather =
  textured card groomed backward; scute = flattened lens). We already have the per-bone frame and, on
  the smooth mesh, per-vertex normals + `skinIndex`/`boneNames` provenance — everything needed to place
  instances.
- **Fur/feather grooming = guide elements + interpolation.** Dense coats are authored as sparse *guide*
  directions interpolated across the surface. Our CA cells are exactly those guides: a cell's feather
  state + local tangent = one guide; render an instanced card per active cell, denser where coverage is
  high.
- **Spore / No Man's Sky** attach discrete parts/decals onto a **shared rig at tagged sockets** and let
  proportions retarget — the same "stable anchors + parametric magnitude" idea we use for hero
  appendages; the CA extends it to *many small* auto-placed features instead of a few hand-placed ones.
- **Growth over time**: features emerge by ramping instance height/coverage with the CA generation
  count (= age), and by connecting adjacent active dorsal cells into a **sail/crest strip** (same
  double-sided sheet trick as the wing membrane).

### 4. Genome-driven, deterministic, breed-able CA

- **Genome traits + local geometry modulate the rule**, not the topology: activation gain/threshold,
  lateral-inhibition radius (spacing), per-region weights, and color wavelength are genome numbers;
  **cell area** (from `envelopeRadius`), **curvature**, and **region** are read from the resolved bones
  and multiply into the rule. "Fat → big cells → spikes suppressed" falls straight out of an
  area-dependent activation threshold.
- **Determinism/serialization:** the CA is a pure function of `(genome, age)`. All stochastic choices
  draw from a **genome-seeded PRNG** (mulberry32/xoshiro, not `Math.random`) keyed per-cell, so the
  pattern reconstructs identically anywhere from genome+age — matching AGENTS.md §8 (store the genome,
  never the mesh). Cost is tiny (~400–700 cells × a few dozen generations, recomputed only on age
  ticks), well within the ≤10-pets budget.
- **Breeding = blend the pattern *params* + seed, then re-run the CA** (never blend the rendered
  pattern — same lesson as "blend genomes, not meshes"). Because the grid topology is identical across
  dragons, per-cell state blending is *also* well-defined as an option, but param+seed crossover is the
  robust default and stays consistent with how the rest of the genome breeds.
- Neural CA / Lenia (learned local update rules that grow and self-repair shapes) are elegant context
  but need training and are heavier than needed here; noted as inspiration only, matching
  rule-based-growth's stance.

---

## Proposed system for our project

### A. The grid/graph (built on OUR skeleton)

A **graph CA over a tree of tubes**, built each generation from the resolved bone list
(`group.userData.skeleton`). No new bones — the grid is a *surface parameterization derived from the
existing bones*.

**Rails (the `u` axis).** Ordered bone chains:
- `axial` rail = `spine_00 … spine_23` then `tail_00 … tail_11` (36 segments) — the main body tube.
- `neck` is just the first 6 axial segments (`spine_00..05`); no separate rail needed.
- one sub-rail per limb: `foreL`, `foreR`, `hindL`, `hindR` (upperArm/foreArm or upper/lower bones).
- `head` mini-rail: `snout` (+ skull cap sectors).

**Rings and cells (the `v` axis).** For each rail segment (a bone with `pos → tail`, radius
`envelopeRadius → rTail`), build a **ring frame**: axis `t = normalize(tail-pos)`, and two orthogonal
ring axes `n,b`. Place `K(segment)` cells evenly around the ring at the segment midpoint (or 1–2
sub-rings for long bones). **Cell surface point** `= midpoint + (cosθ·n + sinθ·b)·radius`; **cell
normal** `= (cosθ·n + sinθ·b)` (outward). **Stagger** odd rings by `π/K` for hex adjacency.

**Fixed anchor cells** (always the same across dragons — the user's requirement), by bone:

| Anchor | Bone / cell |
|---|---|
| Top of head | `skull`, top sector |
| Snout tip | `snout.tail`, top sector |
| Back-of-neck joint | `spine_05`/`spine_06`, top sector |
| Shoulders | `spine_06` (`shoulderGirdle`), side sectors |
| Mid-back | `spine_13`, top sector (dorsal-ridge seed) |
| Hips | `spine_20` (`hipGirdle`), side sectors |
| Base of tail | `tail_00`, top sector |
| Tip of tail | `tail_11`, top sector (tail-spike seed) |
| Belly midline | trunk bottom sectors (scute seed) |
| Wing knuckles | `foreL/R_wrist` (feather/claw seed) |

**Variable cell size (non-uniform, as the user asked).** `cell.area ≈ (2π·radius/K)·segLen`. `K` can
vary by region (thin neck → fewer sectors; broad trunk → more) so cells stay ~isotropic, and area
rises when a bone fattens (`robustness`/age girth) — the hook for "fat suppresses spikes".

**Stability/comparability.** A cell's identity is `(boneName, ringIndex, sectorIndex)` — identical on
every genome/age. Curvature and area change, cell *identity* does not, so two dragons' grids are in
1:1 correspondence for breeding. Adjacency: within-ring neighbors, next/prev-ring (staggered) neighbors,
and **rail-junction edges** (last trunk ring ↔ first tail ring; girdle rings ↔ limb root rings) so the
CA propagates across the whole body as one graph.

**Data structure (`featureGrid.js`):**
```js
grid = {
  cells: [ { id, rail, boneName, seg, ring, sector,
             pos:Vec3, normal:Vec3, tangent:Vec3,   // surface frame
             area, curvature, region } ],          // region ∈ {dorsal,flank,belly,neck,tail,limb,head}
  adj:   Int32Array[] ,                             // neighbor id lists (hex 6-ish + junctions)
  byAnchor: { midBack:id, tailTip:id, ... },
}
```

### B. The CA / propagation rules

**State per cell** (parallel typed arrays, cheap):
`spike`, `feather`, `scute` (0..1 discrete-feature potentials) and `A`, `I` (activator/inhibitor
morphogens driving color + acting as the shared excitation field). Optional `hue2` weight.

**Seed at birth (age→0).** From the genome, set nonzero `A` at a few anchor cells: `midBack`
(dorsal ridge), `tailTip`, `neckBack`, belly midline (scutes), plus a genome-seeded sprinkle
(mulberry32 keyed by `patternSeed`) of low-amplitude noise for marking variety.

**Update rule (one generation), per cell `c`:** discrete **excitable/activator–inhibitor growth CA**:
```
An = A[c]
       + gAct  * genome.spikeGain * regionW * curvW * areaSuppress
       + gDiff * (mean(A[neighbors]) - A[c])          // short-range spread (activator)
       - gInh  * sum(A[j] for j within R_inhibit)     // long-range lateral inhibition (spacing)
       + noise(seed, c)                               // seeded, tiny
A[c]  = clamp01(An)
spike[c]  = smoothstep( A[c] , spikeThresh(area) )    // threshold → discrete peak
feather[c]= featherMask(region) * smoothstep(A[c], featherThresh)
```
- `regionW` — per-region weight from genome (spikes favor `dorsal`+`tail`; feathers favor
  `neck`/`limb`(wing arm)/`tail`; scutes favor `belly`).
- `curvW` — convex crest cells (high positive mean-curvature, e.g. dorsal midline, elbows) boost
  spikes; concave suppress.
- `areaSuppress = clamp01(1 - (area - a0)/a1)` — **big cells (fat) raise the threshold → fewer/no
  spikes** (the user's explicit example) and enlarge scale size.
- `R_inhibit = genome.spikeSpacing` — lateral-inhibition radius → even, blue-noise spacing.
- **Color/markings** come from the same `A,I` fields (a discrete Gray-Scott step on the grid):
  `markingType` biases inhibition anisotropy (axial vs radial → **stripes vs spots**), `markingScale`
  sets the wavelength (spacing), `markingContrast` the amplitude.

**Propagation over AGE (cute→cool).** Age is the CA clock: run `G = round(age · Gmax ·
featurePlasticity)` generations from the birth seed. Early (baby): few generations → seeds only, soft
pastel, nubby/absent spikes = **cute**. Late (adult): many generations → ridges spread and lock into
spaced peaks, markings sharpen, and each feature's **rendered height/sharpness ramps** with a
per-feature age gate (`spikeGrowthAge`, `featherGrowthAge`) via smoothstep — **features emerge and
sharpen with age**, matching the cute→cool arc table ("nubs/absent → grown, sharp, pronounced";
"markings emerge").

**Determinism.** Pure `runCA(grid, genome, age) → state`. All randomness from `mulberry32(hash(
genome.patternSeed, cell.id))`. Recompute identically anywhere; cache between age ticks (recompute only
when the age bucket or genome changes — same policy as the mesh cache).

### C. Genome traits to add

Grouped like the existing schema (`GENOME_SCHEMA` in `generator.js`). Ranges are `[min,max] default`.

**Spikes / ridges (`group:'Spikes'`)**
- `spikeAmount` `[0,1] 0.4` — overall dorsal/tail spike potential (activation gain).
- `spikeSpacing` `[0.3,3] 1.0` — lateral-inhibition radius; high = sparse, well-separated.
- `spikeSharpness` `[0,1] 0.6` — cone slenderness / tip acuity.
- `spikeGrowthAge` `[0,1] 0.35` — age gate at which spikes emerge & sharpen (cute→cool timing).
- `crestSail` `[0,1] 0.2` — how strongly adjacent dorsal spikes connect into a membrane sail/frill.
- `spikeRegionBias` `[0,1] 0.7` — dorsal-only (0) ↔ spread onto flanks/limbs (1).

**Feathers / coat (`group:'Feathers'`)**
- `featherCoverage` `[0,1] 0.0` — feather vs bare-scale dominance (0 = scaly dragon, 1 = feathered).
- `featherRegionBias` `[0,1] 0.5` — neck/shoulder ruff (0) ↔ wing-arm + tail (1).
- `featherLength` `[0,1] 0.5` — card length.

**Scales / plating (`group:'Scales'`)**
- `scaleSize` `[0,1] 0.5` — base scale/scute size (interacts with cell area).
- `scutePlating` `[0,1] 0.3` — belly/back hard-plate amount (discrete scutes).

**Markings / color (`group:'Markings'`)** — extends existing Color group
- `markingContrast` `[0,1] 0.4` — marking amplitude (0 = plain).
- `markingScale` `[0,1] 0.5` — Turing wavelength; low = big blotches, high = fine speckle.
- `markingType` `[0,1] 0.5` — spots (0) ↔ patches ↔ stripes (1) via inhibition anisotropy.
- `markingHue` `[0,1] 0.0` — secondary marking hue offset from body hue.
- `patternSeed` `[0,65535] 0` `step:1` — per-dragon PRNG seed (uniqueness; breed by inheriting one
  parent's or hashing both).
- `featurePlasticity` `[0.4,2.2] 1.0` — how fast the whole feature CA advances with age (pattern
  analogue of `maturationRate`).

### D. Rendering

**Where it plugs in — `generateDragon()` after the body mesh, before/with `wings`:** build the grid
from `bones`, run the CA, then emit one `features` Group (spikes, crest sail, feathers, scutes) added
to `dragon` in ALL skin modes (like `appendages`/`wings`, so thin features aren't swallowed by the
coarse field), plus apply markings onto the body mesh.

- **Spikes/ridges (smooth & capsule):** per active spike cell, instance a **tapered cone** at
  `cell.pos` oriented to `cell.normal` with a backward tilt along `-t`; height `=
  base·spike[c]·ageGate·spikeSharpnessProfile`. Merge into an `InstancedMesh`/merged geometry
  (`hardMaterial`). A **dorsal ridge** is just the top-sector cells along the axial rail. **Crest
  sail**: when `crestSail>0`, span a double-sided sheet between consecutive active dorsal spike tips
  and the back (reuse the `buildMembraneMesh` triangle-fan trick).
- **Feathers:** per active feather cell, instance a thin tapered **card/strip** groomed backward along
  the tangent; denser where `feather[c]` high. Instanced; length from `featherLength`.
- **Scutes/scales:** high-`scute` cells (belly/back) get a small flattened **lens plate**; general
  scale texture is cheaper as **material variation** (per-vertex roughness/color ripple) than real
  geometry — do plates only where `scutePlating` is high.
- **Color/markings (smooth):** the body mesh already carries per-vertex world positions +
  `skinIndex`/`geometry.userData.boneNames`. For each vertex, find its nearest cell (via its dominant
  bone + angle around that bone's ring), sample the CA color (`A/I` → HSL blend of body hue and
  `markingHue` by `markingContrast`), and write a `color` BufferAttribute; set `material.vertexColors =
  true`. No shader, no extra texture — serializable and breed-able.
- **Degrade to VOXEL mode:**
  - Spike → a short **stack of 1–2 shrinking cubes** protruding one voxel along the dominant face
    normal at the cell, tagged to the cell's bone (bakes to `geo.json` as extra cubes). Ridge = a run
    of such cubes along the dorsal line; crest sail = a 1-voxel-thick cuboid fin.
  - Feather → a flat 1-voxel-thick cuboid card (or fold into color if too costly).
  - Scute/markings → **per-cube color**: `voxel.js` already tags each cube to a dominant bone; look up
    the cube center's nearest CA cell and tint the cube. Blocky but reads, and is native to MC.

### E. Integration points, data structures, phased build order

**New module `testbed/src/featureCA.js`** exporting:
`buildFeatureGrid(bones, p)`, `runFeatureCA(grid, genome, age, env)`,
`buildSpikeMeshes(grid, state, p)`, `buildFeatherMeshes(grid, state, p)`,
`applyMarkingColors(bodyGeometryOrCubes, grid, state, p, skinMode)`, and a small `mulberry32` PRNG +
`hash`.

**`generator.js` edits (surgical, mirrors existing layer pattern):**
1. `GENOME_SCHEMA`: append the traits in §C (harness auto-builds sliders — no UI work).
2. `phenotype()`: add age-driven ramps next to `budWing`: `spikeGrow = smoothstep((e -
   spikeGrowthAge)/window)`, `featherGrow`, `markingContrast*lerp(0.3,1,s)`, and pass genome pattern
   params straight through (they're the adult destination; age drives emergence).
3. `generateDragon()`: after the body mesh is built (smooth/voxel/capsule) and `appendages`/`wings`,
   add:
   ```js
   const grid  = buildFeatureGrid(bones, p);
   const state = runFeatureCA(grid, genome, age, env);
   const features = new THREE.Group(); features.name = 'features';
   buildSpikeMeshes(grid, state, p).forEach(m => features.add(m));
   buildFeatherMeshes(grid, state, p).forEach(m => features.add(m));
   dragon.add(features);
   applyMarkingColors(bodyMesh.geometry /*or cubes*/, grid, state, p, skinMode);
   dragon.userData.featureGrid = grid;   // for debug overlay / geo.json export
   ```
4. Debug: extend the `showRig` overlay (or a `window.__showGrid`) to scatter dots at `cell.pos` for
   visual verification of grid stability.

**Determinism + breeding:** `runFeatureCA` is pure over `(genome, age)`; PRNG seeded from
`genome.patternSeed`. Breeding (future crossover control): blend the numeric pattern traits and pick/
hash `patternSeed` from the two parents — never blend rendered output.

**Phased build order (for the coding agent):**
1. **Grid + debug viz** — `featureGrid.js`: axial (u,v) lattice + adjacency from `spine_*`/`tail_*`,
   with staggered rings and anchor map; dot overlay. Verify anchors land in the same place across
   archetypes and ages. *(smallest, unblocks everything)*
2. **Markings pass** — CA `A/I` channels → per-vertex colors (smooth) + per-cube tint (voxel),
   wired to `markingType/Scale/Contrast/Hue/patternSeed`. This is the highest-value / lowest-risk
   visual and **subsumes the RD shader**; validate breeding blends two patterns sensibly.
3. **Dorsal spikes + crest sail** — activator-inhibitor CA on dorsal/tail sectors → instanced cones +
   age emergence + optional sail; voxel = cube spikes.
4. **Feathers + scutes** — instanced cards / lens plates by region; scale material variation.
5. **Sub-grids (limbs/head), curvature + cell-area modulation, polish** — wire `areaSuppress` (fat
   suppresses spikes), curvature boosts, limb/head rails.

### F. Reconciliation with `research/rule-based-growth.md`

That doc's three-layer hybrid stands; this proposal **refines two of its claims and adds one layer**,
with no silent contradiction:

- **Markings — CHANGED (improved):** rule-based-growth uses a **Gray-Scott GPU ping-pong shader** in
  *screen/texture* space. We keep its *biology* (Turing activator–inhibitor) but move it onto the
  **body-anchored graph CA**. Reason: a screen-space RD texture is **not stably parameterized across a
  growing/re-proportioned rig and is hard to breed** (two individuals' textures don't correspond). The
  graph CA is serializable (small grid state), breed-able (1:1 cell correspondence via stable bone
  names), and unifies color with discrete features. *Recommendation: adopt the graph CA for markings;
  retire the separate Gray-Scott shader.*
- **Hero appendages — UNCHANGED:** horns, the major dorsal crest struts, and wing claws stay
  **threshold-gated parametric L-systems / tubes at named anchor slots** (rule-based-growth Layer B,
  and the existing capsule appendages). The CA governs the *distributed field* of small features, and
  may **modulate** a hero appendage's magnitude at its anchor cell (e.g. dorsal-crest strut height =
  local `spike[c]`), so the two compose rather than compete.
- **Distributed surface features — NEW:** spike rows, scutes, scales, feather coverage — the layer
  neither the allometry engine nor the L-systems covered — are this CA's job.

Net: **allometric curves (shape) + L-systems at anchors (hero parts) + graph CA (distributed features
& color) + face rig.** One coherent, deterministic, serializable, breed-able pipeline.

---

## Sources

**Reaction–diffusion & the biology of scales/feathers as a CA**
- Manukyan, Montandon, Fofonjka & Milinkovitch, *A living mesoscopic cellular automaton made of skin
  scales* (Nature, 2017) — ocellated-lizard colour = von Neumann CA on a hex scale lattice —
  https://www.nature.com/articles/nature22031 (PubMed https://pubmed.ncbi.nlm.nih.gov/28406206/)
- Fofonjka & Milinkovitch, *Reaction-diffusion in a growing 3D domain of skin scales generates a
  discrete cellular automaton* (Nature Communications, 2021) — RD collapses to discrete CA at scale
  boundaries; growth rescales pattern — https://www.nature.com/articles/s41467-021-22525-1
  (PMC https://pmc.ncbi.nlm.nih.gov/articles/PMC8065134/)
- Gray-Scott model & the feed/kill (F/k) phase map (Pearson parameterization / Munafo "xmorphia") —
  https://www.mrob.com/pub/comp/xmorphia/index.html ; intro — https://biologicalmodeling.org/prologue/gray-scott
- BMP lateral inhibition in feather-tract patterning — https://journals.biologists.com/dev/article/125/19/3775/40006/BMPs-mediate-lateral-inhibition-at-successive
- Gap junctions as the long-range inhibitor in feather patterning (PLOS Biology) — https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.3002636
- A.M. Turing, *The Chemical Basis of Morphogenesis* (1952) — the activator–inhibitor foundation.

**Mapping a grid onto a surface / anchor coordinates**
- Goldberg polyhedron / geodesic polyhedra — hex-on-closed-surface needs exactly 12 pentagons —
  https://en.wikipedia.org/wiki/Goldberg_polyhedron ; *The Honeycomb Problem on the Sphere* (arXiv) —
  https://arxiv.org/pdf/math/0211234
- Crane, Weischedel, Wardetzky, *Geodesics in Heat* (ACM TOG 2013) — stable mesh-agnostic distance
  coords — https://dl.acm.org/doi/10.1145/2516971.2516977 ; CGAL Heat Method — https://doc.cgal.org/latest/Heat_method_3/index.html
- Quasi-Isometric Mesh Parameterization Using Heat-Based Geodesics — https://www.mdpi.com/2227-7390/7/8/753
- Surface blue-noise / Poisson-disk sampling: *Feature-preserving Direct Blue Noise Sampling for
  Surface Meshes* — https://diglib.eg.org/items/ea9ec783-2b49-4b79-af0d-ac0cedae1c2c ; *Fast
  Poisson-Disk Samples by Progressive Sample Projection* — https://dl.acm.org/doi/10.1145/3233310 ;
  reference impl — https://github.com/marmakoide/mesh-blue-noise-sampling

**Procedural scale/spike/feather placement in games & graphics**
- Spore rigblocks (parts snapped on a procedural spine) — https://en.wikipedia.org/wiki/Development_of_Spore
- Chris Hecker, *Real-time Motion Retargeting to Highly Varied User-Created Morphologies* (Spore;
  morphology-independent, query-by-role placement) — https://www.chrishecker.com/Real-time_Motion_Retargeting_to_Highly_Varied_User-Created_Morphologies
- Houdini grooming (guides + interpolation + normal-aligned instancing): fur overview —
  https://www.sidefx.com/docs/houdini/fur/index.html ; feather interpolation — https://www.sidefx.com/docs/houdini/feathers/interpolating.html ; normal alignment — https://www.sidefx.com/docs/houdini/feathers/applying.html
- Inigo Quilez, *voronoise* (scale-cell shader primitive) — https://iquilezles.org/articles/voronoise/ ;
  article index — https://iquilezles.org/articles/
- Jason Webb, morphogenesis-resources (differential growth / CA references) — https://github.com/jasonwebb/morphogenesis-resources

**Deterministic, serializable, breed-able CA**
- Mulberry32 — tiny fast deterministic PRNG (seed → identical stream anywhere) — https://www.4rknova.com/blog/2026/03/01/mulberry32-rng
- Hierarchical/root-seed reproducibility for parallel stochastic sims (arXiv 2108.05815) — https://arxiv.org/pdf/2108.05815
- Growing Neural Cellular Automata (Distill, 2020) — learned self-repairing CA (future direction) —
  https://distill.pub/2020/growing-ca/ ; Lenia (continuous CA, arXiv) — https://arxiv.org/pdf/2005.03742

**In-repo**
- `research/rule-based-growth.md` — reconciled above (RD→graph-CA for markings; L-systems retained for
  hero appendages).
- `design/architecture-synthesis.md`, `design/cute-to-cool-arc.md`, `design/limb-and-wing-architecture.md`.
- Code: `testbed/src/generator.js`, `testbed/src/field.js`, `testbed/src/voxel.js`.
