# Rendering Integration Review — one cohesive, high-quality dragon

Critical examination of the CURRENT rendered dragon (high tier, smooth skin, post-Phase-2
of the rendering upgrade) plus an implementation-ready, prioritized plan to integrate all
features — body, markings, wings, ears, spikes/sail/feathers/scutes, face — into ONE
creature that earns the Explorer's "top-tier rendering" mission. Evidence renders live in
`testbed/out/exam/` (gitignored); regenerate with the harness pattern in
`testbed/tools/render.mjs`. This is a review + proposal, not an implementation.

## TL;DR (5 bullets)

- **The ears are the #1 problem, and it's both bugs the user reported.** Measured: at age 0
  one ear's bounding box is **4.35 units vs a 2.54 head diameter (~1.7×)** — and even the
  *adult* ear is 1.17× its head. Cause: `generator.js:493` multiplies `earSize` by
  `lerp(1.35, 1.05, age)` *on top of* a head radius that is already baby-inflated
  (R 1.27 baby → 0.72 adult), and `face.js` then multiplies length by another 1.85×.
  They also render as **rigid faceted brown plates with a hard hinge crease**, in colors
  hard-coded to no phenotype.
- **Fix = skinned ears + proportionate scaling (P0).** Give each main ear a 3-bone chain
  (`earL_root → earL_mid → earL_tip`) parented to `skull` in the shared skeleton
  (envelopeRadius 0 so the body field/voxel paths are untouched), skin a single smooth
  ear sheet to it with analytic length-parameter weights, and drive perk/pitch/flare/droop
  + age as *distributed bone rotations* (and root-bone scale for growth) instead of two
  rigid hinges. Cheap tier keeps the current rigid plates (it IS the Bedrock-bones model).
- **The creature does not yet read as ONE animal.** Ears/brows/mouth are hard-coded browns
  on pastel bodies; the CA markings stop dead at the body mesh (spikes/feathers/sail/scutes
  are flat hue-offset colors); the dorsal sail visibly knifes into the back with a raw
  intersection seam; feathers read as white paper fringe; the mouth is a floating brown
  rectangle sticker. A phenotype-driven color pass through `materials.js`/`face.js` +
  sampling body marking color at each feature anchor fixes most of this cheaply.
- **The PBR foundation works — the deferred post-fx is now the gating factor.** ACES + IBL
  + MeshPhysicalMaterial visibly deliver (soft studio light, wet clearcoat eyes, keratin
  spikes), but with no GTAO, no contact shadow, and hard PCF shadows the layered features
  look pasted-on and the dragon floats. Build resume-file Phases 3–4 exactly as specced
  (VSM soft shadows → contact shadow → composer with MSAA/GTAO/bloom/OutputPass).
- **Presentation is broken at boot**: the default camera is an extreme face close-up (the
  baby's eye fills the viewport) with the "Observation Vivarium" placard overlapping the
  ear, and nothing ever auto-frames the creature. Priority order overall:
  **(1) ear scale hotfix → (2) skinned-ear rework → (3) material/marking coherence →
  (4) post-fx stack → (5) presentation/camera → (6) seam/facet geometry polish.**

## Findings

All shots high tier, smooth skin, headless Chrome (SwiftShader) at 1280×900 via a
puppeteer script following `tools/render.mjs`; images in `testbed/out/exam/`.

### F1 — Ear age-scaling is quantitatively broken (user issue #1 confirmed)

Head-framed age strip (`head_age0/03/06/1.png`) + measured bounds (Box3 of `earL` vs
`head.userData.headRadius`), default genome:

| age | head radius R | head Ø | earL bbox (x·y·z) | ear/head Ø |
|---|---|---|---|---|
| 0.0 | 1.271 | 2.54 | 4.35 · 4.16 · 3.05 | **~1.7×** |
| 0.3 | 1.152 | 2.30 | 3.84 · 3.74 · 2.48 | ~1.6× |
| 0.6 | 0.914 | 1.83 | 2.84 · 2.84 · 1.52 | ~1.5× |
| 1.0 | 0.720 | 1.44 | 2.07 · 2.14 · 0.99 | **~1.4×** |

In `head_age0.png` the head is a small pale wedge buried under four huge brown slabs; the
"head-framed" camera is actually framing the *ears*. The compounding chain:

1. `generator.js:493` — `earSize: g.earSize * lerp(1.35, 1.05, s)` (default `earSize` 1.15
   → phenotype 1.55 at age 0). The comment says "bigger vs head on babies" but the ear is
   sized **in units of head radius R**, and R itself is already the baby-cute inflation
   (1.27 → 0.72). The ears get the baby bonus **twice**.
2. `face.js:177` — `earLen = size * length * 1.85` and `baseW = size * width * 0.64`
   (default `earWidth` 1.3). Worked through: baby earLen = 1.55·1.27·1.05·1.85 ≈ **3.8
   world units** on a 2.5-unit head; each ear base is ~1.6 units wide.

Even the adult (1.05× multiplier) ends at 1.17× head diameter — the ears eclipse the head
at *every* age; the baby is just the worst case. **Target ratios** (Toothless-family
reference: ear plate ≈ 0.5–0.85× head diameter): adult earLen ≈ 0.85× head Ø, baby ≈
0.6× head Ø (relatively smaller — the baby head already carries the cuteness; absolute baby
ear stays slightly larger than the adult's because the head is bigger). Concretely:
age multiplier `lerp(1.35, 1.05, s)` → **`lerp(0.70, 1.0, s)`**, face.js length factor
1.85 → **1.35**, and a safety clamp `earLen ≤ 1.1 × head Ø` after all genome multipliers
(the genome allows earSize 1.6 × earLength 2.4 — a legitimate rabbit-ear extreme should
max out near head-sized, not 3×).

### F2 — Ears are rigid hinged plates and read like cardboard (user issue #2 confirmed)

Visible in every head shot (`head_age0.png`, `head_age1.png`, `head_age00_happy.png`,
`wyvern_roar.png`):

- **Hard faceting**: the plates are 7-radial-segment tapered tubes squashed to z-scale
  0.34, so the rim is a chain of visible flat facets and sharp polygonal corners; under
  IBL each facet catches a different value → they read as folded cardboard, not flesh.
- **Hinge crease**: droop/fold is a single rotation at the base→tip joint
  (`face.js applyFaceParams`, `it.tip.rotation.set(fold,0,0)`); the baby's drooped ears
  show a sharp kink mid-ear.
- **Floating inner ear**: the pink inset is a *separate mesh* hovering `baseW*0.28` proud
  of the plate (`face.js:213`). From 3/4 views it detaches into an independent pink
  cat-ear triangle; in `wyvern_roar.png` (head pitched up) the inner plate juts past the
  silhouette and reads as a weird pink tongue/horn near the eye.
- **No deformation with pose/idle**: the rig's ear idle (`rig.js` `earIdle`) rotates the
  same rigid groups; nothing ever bends. Expressive poses (perk/pitch/flare) are pure
  plate rotations, so "sad droop" = tilted boards instead of a soft folding ear.
- **Wrong material**: outer 0x4a3b38 / inner 0x9a5f63 are hard-coded (`materials.js:207-222`)
  — dark brown on a pale-blue body (`head_age1.png`), on a pink wyvern (`wyvern_adult.png`),
  on a cream eastern (`eastern_head.png`). The single most jarring coherence failure.

### F3 — Material/shading coherence: good base, incoherent extremities

What works (visible in `wyvern_adult.png`, `scuted_adult.png`): the ACES+IBL+Physical
foundation gives soft studio light, believable body speculars, wet clearcoat eyes with
real env catchlights, pale keratin spikes, and the CA markings (bold purple patches on
`scuted_adult.png`) survive as vertex colors exactly as designed. Per-part findings:

- **Ears/brows/mouth/frill**: hard-coded colors (F2); the mouth band is a small dark-brown
  **rectangle sticker** floating off the snout (`head_age1.png`, `eastern_head.png`) — at
  the current band width/inset it doesn't read as a mouth line at all from 3/4 views.
- **Markings stop at the body.** Spikes, feathers, scutes, sail, membrane all take flat
  hue-offset derivations of the base hue and know nothing about the CA pattern — in
  `scuted_adult.png` bold purple patches run under scutes that stay uniform grey-lavender.
  The feature grid already stores each feature's surface anchor (`state.*[].pos`), so the
  body's nearest-vertex marking color is samplable at build time.
- **Feathers** (`feathered_adult.png`): a dorsal strip of near-white flat quads — reads as
  paper fringe / a mohawk, not plumage. Needs phenotype tinting (body/marking hue blend),
  per-card hue/length jitter, and slight card curl; sheen alone can't rescue an untextured
  white rectangle.
- **Membrane/sail**: hue family is right, but panels are a single flat tone (`wyvern_adult_back.png`)
  — uniform orange with no thickness/vein variation; transmission only shows when backlit.
  Acceptable pre-post-fx; roughness/color variation across the panel is a cheap later win.
- **Scutes barely register**: at `scutePlating: 1.0` (`scuted_head.png`) the "armour" reads
  as a handful of small pale spikes — the lens plates are too small/low-contrast to survive
  the viewer distance. Needs either bigger lenses, a darker rim tint, or (with C2) marking-
  color contrast; audit `SCUTE_R_BASE`/growth gates in `features.js` while doing C.
- **Marking edges are triangle-quantized**: vertex colors at fieldRes 64 give blocky
  pattern boundaries close-up (`scuted_adult.png` haunch). Acceptable at explorer camera
  distances; true fix is the triplanar/onBeforeCompile stretch goal already noted in
  `research/high-fidelity-rendering.md` §3.

### F4 — Silhouette & geometry

- **Sail↔body intersection seam** (`wyvern_adult_back.png`): the sail quads plunge into
  the back with a raw jagged intersection line along the spine; from the rear it looks
  like orange paper stuck through the skin. Spike cones likewise sit *on* the surface with
  zero root blending — a few visibly hover at grazing angles.
- **Marching-cubes facets** are visible on the snout ridge and haunches at head-framing
  distance (`head_age1.png`, `eastern_head.png`); the body reads smooth at full-body
  distance. GTAO + soft shadows will *increase* facet visibility, so a modest geometry
  answer (below) should land with or before post-fx.
- **Wing structure** (`wyvern_adult.png`): leading-edge finger rods end in ball joints
  that read as toy armature; one rod pokes past the ear silhouette in the folded pose.
  Cosmetic, low priority.
- **Layered vs unified**: spikes/scutes/feathers/sail should STAY layered (they need
  per-feature materials, and rigid nearest-bone skinning already carries them through
  poses — verified in `wyvern_roar.png`). The **ears** are the one part that behaves like
  body (organic, deforming, expression-carrying) yet is built like a feature — that's the
  architectural root of F2.

### F5 — The deferred post-fx is now the visible bottleneck

Everything Phase-3/4 was deferred shows in the renders: single hard-edged shadow, **no
contact occlusion** under belly/feet (the dragon floats on the grey disc), no AO where ears
stack over skull, spikes meet skin, or legs meet body — exactly the cues that would seat
the layered features into the body. Bloom/vignette are polish; **GTAO + VSM + contact
shadow are integration tools**, not decoration. The plan in
`.agents/resume/render-upgrade.md` steps 1–7 is still the right build, unchanged.

### F6 — Presentation (boot framing, placard, backdrop)

`ui_full.png` (untouched boot state): the camera boots at the hard-coded
`(4.5, 3.0, 6.5)` looking at `(0, 1.2, 0)` while the default age-0 dragon is ~7 units
wide — the viewport is INSIDE the baby's face (one giant eye + ear slabs fill the canvas),
and the "Observation Vivarium" placard (`.stagePlate`, absolute top-left of `#stage`)
overlaps the ear. Nothing calls `frameObject()` outside the gallery. The backdrop is a
flat navy + bare grey disc; fine, but a blurred-env sweep + contact shadow (already
specced) is the intended look. The `#hud` hint pill also sits over the ground in every
creature screenshot.

### Grok second opinion

`tools/grok.sh eval` was run on `head_age0.png` and `wyvern_adult_back.png` for a
second-opinion score; the CLI was still grinding at write-time — re-run both commands
(they're one-liners) during implementation and sanity-check against F1–F4. The findings
above stand on the measured ear/head ratios and the cited renders regardless.

## Proposed plan

Prioritized, implementation-ready steps for an Opus coding agent. Each item: what/where/
effort (S/M/L)/impact. Fidelity-tier note at the end of each. Recommended landing order
is the numbering; A is shippable in minutes and should not wait for B.

### A. P0 hotfix — proportionate ear age-scaling (S effort, HUGE impact)

Files: `testbed/src/generator.js` (~line 493), `testbed/src/face.js` (~line 177).

1. `generator.js`: `earSize: g.earSize * lerp(1.35, 1.05, s)` → `g.earSize * lerp(0.70, 1.0, s)`.
2. `face.js buildEars`: `earLen = size * length * 1.85` → `* 1.35`.
3. Add a clamp after both: `earLen = min(earLen, 2.2 * R)` (≈1.1× head Ø) so genome
   extremes (earSize 1.6 × earLength 2.4) stay head-scale.
4. Re-tune `earWidth` factor 0.64 → ~0.52 so the base doesn't wrap the skull.
5. Verify with the head-framed age strip (target ratios in F1: baby ≈ 0.6× head Ø,
   adult ≈ 0.85×) + one `earPairs: 3`, one `earLength: 2.4` extreme.

Tiers: pure parameter change — smooth, voxel, and geo.json all inherit it.

### B. P0 — Skinned-ear rework (M–L effort, HUGE impact)

The ear becomes a first-class deformable part of the creature, like a limb: **own bones in
the shared skeleton, one smooth skinned sheet, expression + age as bone rotations/scale.**
Files: `generator.js` (buildSkeleton + earOpts), `face.js` (buildEars/applyFaceParams),
`rig.js` (binding + idle), `materials.js` (phenotype ear colors — see C).

**B1. Bones (generator.js `buildSkeleton`).** Add per side, parented to `skull`:
`earL_root → earL_mid → earL_tip` (and mirrored R). Root at the current anchor
(`skull-local (±0.62R, 0.55R, -0.10R)`), mid/tip spaced along the current anchor `out`
direction at earLen/3 steps. Set `envelopeRadius: 0` (< rig.js `EPS` 0.012) so:
the implicit field never inflates around them (body/voxel skins unchanged), and they are
excluded from `candBones`, so membranes/spikes can never accidentally rigid-skin to an ear.
The skeleton's fixed-topology invariant ("bone NAME SET identical for every genome/age")
means the 6 ear bones are added for EVERY genome — zero-length/zero-envelope when
`earSize ≈ 0`, exactly like absent limbs today. Trailing pairs (`earPairs` 2–3) do NOT get
chains: keep them as reduced-amplitude followers (see B4) — 6 new bones total, not 18.

**B2. Mesh (face.js `buildEars`).** Replace the two plates + floating inner inset with
**one continuous ear sheet per ear**: the existing `earSegGeometry` profile swept in a
single run (≥ 12 length segments × 10–12 radial, then z-flattened) so there is no base/tip
seam and the rim is smooth. Inner ear becomes a **vertex-color region** on the same sheet
(front-face vertices within the inner mask get the inner tint) — kills the floating inset
and gives a soft blend where inner meets outer. While building, record each vertex's
normalized length parameter `t` (we know it during construction — no nearest-bone search).

**B3. Skinning + binding (face.js → rig.js).** Author skin weights analytically from `t`:
smooth 2-influence blend `root→mid` for t<0.5, `mid→tip` for t>0.5 (e.g. weight =
smoothstep across each half; base ring gets a small skull weight so the root stays seated).
Because `face.js` can't know final skeleton bone order, store name-based provenance:
`mesh.userData.earSkin = { bones: ['earL_root','earL_mid','earL_tip','skull'], indexAttr, weightAttr }`
with indices INTO that local list. In `rig.js upgradeToSkinned`, after `boneIndex` exists:
remap local indices → skeleton indices, build `skinIndex`/`skinWeight`, convert to
`SkinnedMesh`, and — **critical** — re-parent the ear meshes from the faceRig (which gets
`skullBone.attach(head)`) to the dragon root before `bind(skeleton, mesh.matrixWorld)`,
exactly like membranes/features. A skinned ear left under the skull-attached head group
would be double-transformed (once by the bone matrices, once by the parent). Non-smooth
skin modes skip all of this and keep today's rigid groups (they're never skinned).

**B4. Posing (face.js `applyFaceParams` + rig.js).** Same expressive params, new mapping —
distributed rotations instead of two hinges:
- `pitch` (fore/aft): root 60%, mid 30%, tip 10% of the total angle → the ear *sweeps*.
- `flare` (splay, z): root 70%, mid 30%.
- `perk`/`droop` (the fold): a graded +X curl that INCREASES toward the tip
  (root 15%, mid 35%, tip 50% of `fold`), replacing the single tip hinge — a drooped ear
  now curls over smoothly; `earDroop` raises the curl floor as today.
- Trailing pairs: keep their rigid groups but copy the main chain's composed root rotation
  at `PAIR_AMP` amplitude (today's behavior, driven from the bone pose).
When the rig is live, `upgradeToSkinned` stores the bone handles on
`faceRig.userData.ears.items[i].bones` and `applyFaceParams` writes the bone quaternions
directly — the existing ear-idle undo-previous-delta mechanism (`rig.js earIdle`) was
built exactly so the emotion rig can repose ears mid-idle without a fight; it only needs
to collect the ear **root bones** instead of matching `^ear[LR]` group names (the same
quaternion-delta trick works on `THREE.Bone`). Before `upgradeToSkinned` (or in voxel/capsule modes), `applyFaceParams`
falls back to rotating the rigid groups as today — same math, two consumers.

**B5. Age (generator.js phenotype → bones).** Two channels:
- Size: geometry is rebuilt on every age tick anyway, so the corrected A-scaling applies.
  Additionally expose `earAgeScale` as a **root-bone scale** (`earL_root.scale.setScalar`)
  so future continuous-growth animation can grow ears WITHOUT a rebuild (bone scale
  propagates down the chain; the skinned sheet follows) — build the sheet at adult size,
  scale the root down for the current age.
- Pose: today's age-lerped `earNeutral` {perk, pitch, flare} feeds the same B4 mapping —
  baby = forward-curious + heavy tip curl (droop floor), adult = swept-back and straighter.

Tiers: Explorer/high-smooth gets skinned ears; cheap/voxel keeps rigid plates — which is
correct, because the 2-segment rigid ear ports 1:1 to Bedrock bones (`geo.json`). The 6
ear bones join the exported skeleton either way (Bedrock bones are cheap).

Verify: emotion sweep (happy/sad/afraid/curious) head shots at ages 0/0.5/1 — no crease,
no floating inner ear, ears deform smoothly in the `roar` pose and idle.

### C. P1 — Material & marking coherence pass (M effort, HIGH impact)

Files: `materials.js`, `face.js`, `features.js`, `generator.js`.

1. **Phenotype-driven face part colors**: `earOuterMaterial(p)` = body hue, slightly darker/
   desaturated (e.g. HSL(hue, sat·0.8, light·0.75)); `earInnerMaterial(p)` = body hue
   blended 50–60% toward warm rose; `browMaterial(p)` = deep shade of body hue;
   `frillMaterial(p)` = membrane-family tint. Thread `p` via `createFaceRig(opts)` (tier is
   already threaded — add the phenotype color trio to `opts`). This alone makes every
   archetype's ears look grown, not glued.
2. **Extend markings onto features** (`features.js`): at build time, sample the body's
   nearest-vertex CA color at each feature anchor (`state.spikes[i].pos` etc. — a small
   KD-free nearest lookup over the body position attribute is fine at feature counts) and
   set per-feature vertex color (or per-merged-group tint) = mix(featureBase, bodyMarking,
   0.5–0.7). Spikes/scutes/feather bases then continue the pattern across the seam —
   the single biggest "one creature" unifier after the ears.
3. **Feathers**: tint cards from body/marking hue (not near-white); jitter per-card hue
   ±0.02, length ±15%, and add one curl segment; keep sheen.
4. **Mouth**: widen the band slightly, pull it onto the surface (reduce the +z hover),
   and derive its color as a dark multiply of the local skin tone; longer-term replace
   with a crease decal along the snout/jaw seam.
5. **Membrane/sail variation**: cheap radial roughness/color falloff toward panel centers
   (vertex color or a 2-stop gradient), so backlit and front-lit wings both show structure.
Tiers: all of this is factory-level; cheap tier gets the same colors on Standard materials.

### D. P1 — Post-fx stack (M effort, HIGH impact)

Execute `.agents/resume/render-upgrade.md` steps 1–7 verbatim (they are already
implementation-ready and verified against r160): VSM soft shadows (+ membranes cast-only),
256² contact shadow refreshed in `rebuild()`, EffectComposer on an MSAA×4 HalfFloat target
with RenderPass → GTAOPass → UnrealBloomPass(0.25/0.5/0.85) → OutputPass, `renderFrame()`
routing, resize plumbing, `gallery.mjs` switch to `t.renderFrame()`, exposure re-tune.
Order within D: **VSM + contact shadow first** (grounding), then GTAO (seating), bloom last.
Files: `app.js` (+`index.html` tier select already exists). Tiers: high only —
`TIERS.cheap.composer = false` keeps the MC path at plain PCF + no composer. GTAO is the
first thing to drop if iGPU frame time exceeds budget (N8AO half-res as the escape hatch).

### E. P1 — Presentation & camera (S–M effort, MEDIUM-HIGH impact)

Files: `app.js`, `index.html`.

1. **Frame on boot + on archetype/randomize** (not on every age tick — keep the camera
   steady while scrubbing): call the existing `frameObject(currentDragon)` after the first
   `rebuild()` and whenever the genome is replaced wholesale; skip if the user has orbited
   (track a `userMovedCamera` flag from OrbitControls' `start` event).
2. **Hero framing** for screenshots/showcase: camera ~10° below the dragon's eye line,
   target at 0.45× height, slight 3/4 (per research §6) + `controls.autoRotate` turntable
   toggle in the panel.
3. **Placard/hud**: keep the vivarium dressing, but (a) shrink the placard and dock it
   top-RIGHT (the dragon faces +z/left in the default view, so top-left is where heads
   go), and (b) add a `window.__hideChrome` flag that `render.mjs`/screenshot path sets to
   hide `.stagePlate`, `#hud`, and `#stageVignette` for clean captures (today's headless
   hide-UI hack misses all three — every eval render has the placard baked in).
4. **Backdrop**: `scene.background = envTexture` + `backgroundBlurriness 0.6`,
   `backgroundIntensity ~0.3`, darker rough ground disc (0x181d26, roughness 0.95) — as
   already specced in the research doc; land with D so exposure is tuned once.

### F. P2 — Geometry/seam polish (M effort, MEDIUM impact)

Files: `features.js`, `field.js`/`generator.js`.

1. **Spike roots**: sink each cone base ~15% of h below the surface AND add a short base
   flare (cone → cone+torus-ish skirt, or simply widen the bottom ring 1.3×) so GTAO has
   a crevice to shade instead of a floating tangent circle.
2. **Sail seam**: root the sail strip ~0.05 units *inside* the body along -normal and add
   a root fairing row whose color lerps to the sampled body color (C2) so the silhouette
   seam disappears from the rear view (`wyvern_adult_back.png` case).
3. **Facets**: in high tier raise `__fieldRes` 64 → 80–96 for the *displayed* dragon only
   (gallery/thumbnails stay at 64), or add one Taubin smoothing pass over the field mesh;
   measure rebuild time first — it runs on every age tick, budget ≤ ~80 ms.
4. **Wing rods**: taper finger radii toward tips and shrink the joint balls ~40%.
Tiers: high-tier only for res bumps; seam/root fixes are geometry and benefit both.

### Priority/effort summary

| # | Item | Files | Effort | Impact |
|---|---|---|---|---|
| A | Ear scale hotfix + clamp | generator.js, face.js | S | Huge |
| B | Skinned-ear rework | generator.js, face.js, rig.js | M–L | Huge |
| C | Material/marking coherence | materials.js, face.js, features.js | M | High |
| D | Post-fx (VSM→contact→GTAO→bloom) | app.js | M | High |
| E | Presentation/camera/placard | app.js, index.html | S–M | Med-High |
| F | Seams/facets/wing polish | features.js, field.js | M | Medium |

A and B are the user-reported issues and the biggest visual lever; C makes it one
creature; D makes it grounded and premium; E makes the first impression match; F is the
last 10%. B, C, D are independent and can run as parallel worktree tasks; A must land
before B's verification renders mean anything.

## Sources

- `research/high-fidelity-rendering.md` — the verified r160 stack this plan builds on
  (RoomEnvironment/PMREM, MeshPhysicalMaterial channels, GTAO/VSM/contact-shadow specifics).
- `.agents/resume/render-upgrade.md` — Phases 3–4 step list executed verbatim by item D.
- three.js `SkinnedMesh`/`Skeleton` docs (bind matrices, bindMode) —
  https://threejs.org/docs/#api/en/objects/SkinnedMesh
- VSM shadows example — https://threejs.org/examples/webgl_shadowmap_vsm.html ;
  contact shadow — https://threejs.org/examples/webgl_shadow_contact.html ;
  GTAO — https://threejs.org/examples/webgl_postprocessing_gtao.html
- Ear-appeal reference: How to Train Your Dragon "Toothless" head-plate proportions
  (ear/plate ≈ 0.5–0.85× head diameter; expressive posing via graded curl, not hinges).
