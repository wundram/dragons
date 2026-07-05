# Parametric Creature Modeling — Prior Art & Recommendation

Research for the Dragons project (track 1). Goal: find a mesh-generation representation where a single compact **genome** produces a dragon that (a) morphs continuously cute→cool with age, (b) supports breeding by mixing/interpolating two genomes, and (c) is cheap enough for a web testbed and eventually a Minecraft entity. See `AGENTS.md`, `README.md`, `design/cute-to-cool-arc.md`.

## TL;DR (5 bullets)

- **The field splits into five families:** (1) skeleton/rig-driven skinning (Spore, No Man's Sky, runevision, animalclub), (2) implicit-surface/metaball + marching cubes (Spore's skin layer), (3) linear/PCA shape spaces (SMAL/SMPL), (4) curve/segment parametric builders (tube/extrusion generators, L-systems for horns), and (5) ML latent-space 3D generation (DreamFusion/Magic3D). Only the first four are realistic to reimplement in-browser and reconstruct from a compact genome.
- **Spore is the closest architectural precedent to us:** a small editable "genome" (a rig of blocks + attached parts) drives a **metaball skin regenerated in real time** via a marching-cubes-style implicit surface, with limbs/spine as metaball chains and parts (mouths, horns, wings) snapped onto the rig. This proves genome→mesh regeneration at interactive rates but the metaball skinning is the expensive part.
- **The cheapest, most controllable representation is a parametric skeleton + procedural skinned mesh** (runevision's extruded-segment creatures; animalclub's "Skellygen"; the Bournemouth NCCA thesis). A hierarchical bone rig with per-bone thickness profiles gives you allometric scaling "for free," clean limb/tail/neck attachment, and trivial interpolation between two parameter vectors — exactly what breeding and cute→cool aging need.
- **Continuous morphing is a solved sub-problem** three ways that all work in Three.js: (i) **animate skeleton/parameter values** (aging = walking a monotonic parameter path), (ii) **morph targets / blend shapes** (SMPL/SMAL-style linear shape bases; Three.js `morphTargetInfluences`), and (iii) **regenerate geometry each growth tick** (cheap if done on tick, not per-frame, per our feasibility guardrails). We should use parameter animation as the primary mechanism and reserve morph targets for the face rig.
- **Recommendation: a genome → hierarchical bone graph → per-bone generalized-cylinder/box skin**, with horns/spikes/wing-spars as curve-driven `TubeGeometry`/L-system add-ons that "emerge" at growth thresholds, and the eye+brow face as a separate morph-target sub-rig. Keep metaballs/marching cubes as an optional "smooth skin" pass only if the box/tube skin looks too blocky. This maps to a compact serializable genome, interpolates for breeding, scales allometrically for aging, and is O(a few thousand verts) — fine for web and for a ≤10-pet Minecraft budget.

---

## Findings by approach

### 1. Skeleton / rig-driven procedural skinning

The dominant paradigm for parametric creatures: define a **hierarchical bone skeleton** from parameters, then generate a skin around the bones (as a skinned mesh, extruded prisms, or generalized cylinders). Limbs, neck, tail, and head are just bone chains; attachment is a parent-child transform.

- **runevision (Rune Skovbo Johansen), "Procedural creature progress 2021–2024"** — the most directly useful modern reference. Creatures are built from **multi-segmented extruded rectangles** for torso, legs, feet, neck, head, jaw, tail, ears. Two parameter tiers: **503 low-level** params (per-bone length, rotation, skin thickness per direction) driven by **106 high-level** params (torso thickness H/V, tapering, joint placement). Crucially he **explicitly rejected PCA/ML** because it entangled traits and made targeted edits impossible — a strong signal for us to keep *meaningful, hand-authored* parameters. He demonstrates **interpolation between creatures**, i.e. continuous morphing between whole forms. No metaballs — direct mesh gen from bones. This is almost a blueprint for our testbed. ([blog.runevision.com](https://blog.runevision.com/2025/01/procedural-creature-progress-2021-2024.html))
- **animalclub (`pdlla/animalclub`)** — a general-purpose **genetics + procedural 3D animal** library. A `Genome` maps onto a parameterized mesh generator ("**Skellygen**", a parametrizable mesh-generating data structure) built on a base skeleton; phenotypes from the genetics are applied to bones. Breeding is literal DNA crossover: "when breeding two DNAs, 1 bit out of every 2 from each parent is randomly chosen." This is the exact genome→skeleton→mesh + breeding pipeline we want, just in Rust. ([github.com/pdlla/animalclub](https://github.com/pdlla/animalclub))
- **`bunnybones1/threejs-procedural-animal`** — an experimental **Three.js** module that generates a *rigged* animal mesh ready for procedural animation. Direct evidence the skeleton-first approach is viable in-browser today. ([github.com](https://github.com/bunnybones1/threejs-procedural-animal))
- **Bournemouth NCCA MSc thesis, Alex Christo, "Procedural Creature Generation and Animation for Games"** — academic treatment: a rig acts as skeleton; the base body's skeleton dictates **attachment points for limbs**; bones connect at ends. Good source for limb-attachment logic and tagging. ([nccastaff PDF](https://nccastaff.bournemouth.ac.uk/jmacey/MastersProject/MSc22/01/ProceduralCreatureGenerationandAnimationforGames.pdf))
- **No Man's Sky (Hello Games)** — production-scale part-assembly on **shared skeletons/blueprints**. Pipeline is **Template → Accessories → Layering → Scaling**: a few skeleton templates from nature (horse/deer share one rig; shark/dolphin another); accessories (snout type, horns) attach via a **tag system** (legs tag, arms tag) so a leg can't become a head; then per-part scaling for variation. Takeaway for us: **one dragon base rig + tagged attachment slots + scaling** gives huge variety while staying biologically plausible. Weakness for us: NMS mixes discrete *parts* (good for variety, weaker for *continuous* morphing) — we want continuous where possible. ([Kotaku](https://kotaku.com/a-look-at-how-no-mans-skys-procedural-generation-works-1787928446), [Game Developer](https://www.gamedeveloper.com/programming/what-the-code-of-i-no-man-s-sky-i-says-about-procedural-generation), [NMS Wiki](https://nomanssky.fandom.com/wiki/Procedural_generation))
- **`nmagarino/Pudgy-Pals` procedural creature generator** — student project explicitly referencing Spore techniques and robot-construction frameworks; useful implementation reference. ([github.com](https://github.com/nmagarino/Pudgy-Pals-Procedural-Creature-Generator))

**Genome→geometry:** parameter vector sets bone lengths/angles + per-bone skin thickness profile; skin is extruded/lofted along bones. **Limbs/wings/tails/horns:** all bone chains or attachments at tagged slots. **Morphing:** excellent — just interpolate parameters (aging) or crossover them (breeding). **Three.js:** yes, proven (bunnybones module). This family is our spine.

### 2. Implicit surfaces / metaballs + marching cubes (Spore's skin)

- **Spore Creature Creator (Chris Hecker, Maxis/EA, 2008)** — the landmark. The player builds a small "genome": a deformable **spine of blocks** (the torso) plus **limbs and parts** (mouths, eyes, graspers, feet, wings, horns) snapped on. Hecker's system wraps this rig in a **blobby implicit surface (metaballs)**: spherical metaballs placed along limbs and torso, summed into a 4th-order-polynomial implicit field, then **polygonized in real time** (marching-cubes-style) so the skin *regenerates live* as the player deforms the spine or attaches/detaches a limb. He also solved **procedural texture projection, painting, rigging and animation** onto this generated mesh so any creature auto-animates. Presented at GDC 2005 ("Why you should have paid attention in multivariable calculus"). This is the single best precedent for *genome→regenerated mesh at interactive rates*, and proves the whole loop is feasible — but the metaball polygonization + auto-rigging is the heavyweight part. ([chrishecker.com liner notes](https://chrishecker.com/My_Liner_Notes_for_Spore), [RemptonGames breakdown](https://remptongames.com/2022/08/07/how-the-spore-creature-creator-works/), [Development of Spore, Wikipedia](https://en.wikipedia.org/wiki/Development_of_Spore))

**Genome→geometry:** metaball radii/positions parameterized off the rig; when two metaballs approach, their fields sum and surfaces merge — organic blending of limb-into-body for free. **Morphing:** continuous by construction (move/scale metaballs → skin flows). **Horns/wings:** metaball chains taper to points; membranes are harder (thin sheets are the classic metaball weakness — you get sausages, not wings). **Three.js feasibility:** marching cubes exists (see §6) but re-polygonizing a grid every frame is costly; acceptable if run **only on growth ticks** per our guardrails. Verdict: keep as an **optional smoothing pass**, not the base representation.

### 3. Linear / PCA shape spaces (SMAL, SMPL)

- **SMAL — Skinned Multi-Animal Linear model (Zuffi et al., "3D Menagerie", CVPR 2017)** — the first parametric model capturing shape variation across **quadrupeds** (lions, tigers, horses, cows, hippos, dogs). A creature = a template mesh deformed by a **linear combination of PCA shape bases** (shape params) + **joint-angle pose params**. Trained from just 41 scans yet generalizes to unseen animals; you can **sample new shapes, pose, animate, and interpolate** them. It's the animal analogue of **SMPL** (human body). ([smal.is.tue.mpg.de](https://smal.is.tue.mpg.de/), [3D Menagerie / ar5iv](https://ar5iv.labs.arxiv.org/html/1611.07700), [SMPL wiki](https://github.com/Meshcapade/wiki/blob/main/wiki/SMPL.md))

**Genome→geometry:** the shape coefficients *are* a compact genome; mesh = template + Σ(coeff·basis). **Morphing/breeding:** interpolation and averaging in coefficient space are trivial and always produce valid meshes — ideal for aging and breeding. **Why it's not our base:** (a) it needs a **learned basis from a dataset of dragon scans** we don't have; (b) topology is fixed, so it can't *grow new structures* (horns appearing, wing membranes emerging) — it only deforms an existing template; (c) runevision's warning about entangled PCA params applies. **But** the *mechanism* — a template mesh + **linear blend shapes** — is exactly Three.js **morph targets**, which we should reuse for the **face rig** and for continuous "cute↔cool" blends of the *head*. So: don't adopt SMAL wholesale; borrow its blend-shape math where topology is stable.

### 4. Curve / segment parametric builders (tubes, generalized cylinders, L-systems)

For the *appendages* that need to look sharp and grow — horns, spikes, spines, tails, wing spars:

- **Tube/generalized-cylinder along a spline** — sweep a (tapering) cross-section along a Bézier/Catmull-Rom curve. In Three.js this is **`TubeGeometry`** over a `CatmullRomCurve3`, or `ExtrudeGeometry`. A horn = a short curve with radius tapering to a point; a tail = a long curve; a neck = a fat curve. Space-colonization / generalized-cylinder + B-spline pipelines are a documented way to skin branching structures. ([three.js forum: procedural mesh](https://discourse.threejs.org/t/procedural-mesh/22327), [ciphrd space colonization](https://ciphrd.com/2019/09/11/generating-a-3d-growing-tree-using-a-space-colonization-algorithm/))
- **L-systems / space colonization** for **branching** horns, antlers, frills, and spine ridges. The Runions/Prusinkiewicz space-colonization paper and JS ports (Jason Webb) generate organic branching that can be meshed as generalized cylinders. Growth is naturally staged (more iterations = more growth) which maps beautifully onto our **age parameter emerging new structure at thresholds**. ([algorithmicbotany PDF](https://algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf), [Jason Webb, Medium](https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5), [L-system 3D trees in three.js](https://github.com/FrancescoGradi/L-System-Trees))

**Genome→geometry:** curve control points + taper profile + iteration count are all scalar genome entries. **Morphing:** interpolate control points / grow iteration count with age → horn nubs elongate into sharp horns; wing spars extend; tail lengthens. This is the mechanism that delivers the cute→cool "new structures emerge" requirement. **Three.js:** first-class (`TubeGeometry`). Membranes between wing spars = a triangulated sheet spanning the spar curves (skinned quad strip), grown by scaling membrane extent with age.

### 5. ML / latent-space 3D generation

- **DreamFusion (SDS), Magic3D, LatentNeRF, and mesh-diffusion (EdgeRunner, etc.)** — text/image-to-3D via 2D diffusion priors optimizing a NeRF or mesh; a learned **latent space** in principle supports smooth interpolation between creatures. ([stable-dreamfusion](https://github.com/ashawkey/stable-dreamfusion), [Magic3D](https://arxiv.org/pdf/2211.10440), [Text-to-3D survey, CGF 2024](https://onlinelibrary.wiley.com/doi/10.1111/cgf.15061))

**Why it's out for our generator:** per-creature optimization takes minutes–hours on a GPU; outputs are NeRFs or unstructured meshes with **no clean rig, no bones, no controllable "make horns bigger" knob**, and not reconstructable from a *compact* genome. Fundamentally incompatible with our "cheap, serializable genome, ≤10 evolving pets, recompute on tick" guardrails. Possible *offline* use only: generate reference art / texture inspiration to feed the hand-authored parametric system (that's grok's job per AGENTS §5), not runtime generation.

---

## In-browser techniques inventory (Three.js)

| Need | Three.js / JS tool |
|---|---|
| Skinned base body | `SkinnedMesh` + `Skeleton`/`Bone`; or direct BufferGeometry lofted along bones |
| Segment/box body (runevision style) | `BoxGeometry`/extruded rectangles per segment, merged |
| Smooth blobby skin (Spore style) | Marching cubes — `THREE.MarchingCubes` example (Henrik Rydgård / greggman blob); community metaball repos ([takumi0125](https://github.com/takumi0125/threejsMarchingCubesMetaball), [sagzain](https://github.com/sagzain/metaballs-threeJS/), [official example](https://threejs.org/examples/webgl_marchingcubes.html)) |
| Horns/spikes/tail/neck | `TubeGeometry` over `CatmullRomCurve3`, tapered; `ExtrudeGeometry` |
| Branching horns/antlers/frills | L-system / space-colonization in JS → generalized cylinders |
| Continuous cute↔cool head & face | `morphTargetInfluences` (blend shapes, SMPL/SMAL-style linear bases) |
| Aging & breeding blends | interpolate/crossover the parameter vector, regenerate on growth tick |
| Auto-animation | rig the generated skeleton; drive with procedural or clip animation |

Note: Three.js ships marching cubes as an *example* class, not core geometry, but it's readily usable; re-polygonizing every frame is the cost, so gate it to growth ticks.

---

## Recommendation for our project

**Adopt a layered, skeleton-first representation. Concretely:**

1. **Genome (compact, serializable).** A flat vector of *meaningful* named traits (heed runevision's warning against opaque PCA/ML params): body-segment count & thickness profile, head:body ratio, snout length, limb lengths/thickness, neck curve, tail curve/length, horn count/curve/length, spike-ridge density, wing span/membrane extent, plus **aging-rate and cute↔cool-destination biases** per `design/cute-to-cool-arc.md`. This vector is what saves/syncs/breeds.

2. **Genome → hierarchical bone graph.** One canonical **dragon base rig** with tagged attachment slots (à la No Man's Sky), so limbs/wings/horns snap to defined sockets and can't land in the wrong place. Bone lengths/angles come straight from the genome.

3. **Bone graph → skin.** Skin each body bone as a **tapered generalized cylinder / box segment** (runevision + animalclub Skellygen approach) — cheap, gives clean allometric scaling, a few thousand verts. **Optional metaball/marching-cubes pass** (Spore) only if the segment skin reads too blocky for "cute," gated to growth ticks.

4. **Appendages as curve/L-system add-ons.** Horns, spikes, spine ridges, tail, and wing spars are `TubeGeometry`/L-system structures whose **iteration count and length scale with age**, so they **emerge from nubs → sharp adult features** — this is the core cute→cool mechanism. Wing membranes = triangulated sheets spanning the spars, growing in extent with age.

5. **Face as a separate morph-target sub-rig** (per AGENTS §8): eyes + floating brows layered on the head, using **blend shapes** (the SMAL/SMPL mechanism, i.e. Three.js `morphTargetInfluences`) to go from big/low/round (cute) to small/high/sharp (fierce) and to express emotions. Reusable across any generated head.

**Why this satisfies the three constraints:**

- **(a) Continuous cute→cool aging:** aging is a monotonic walk of the parameter vector (allometric scaling of bones/head-ratio) plus threshold-triggered growth of curve/L-system appendages. Every intermediate is a valid mesh because geometry is regenerated from parameters, not hand-authored keyframes.
- **(b) Breeding:** crossover or interpolate two genome vectors (animalclub does exactly this) → a valid child genome → a valid baby mesh. Parameter-space blends can't produce broken topology the way mesh-space blends can.
- **(c) Cheap enough:** segment/tube geometry is a few thousand verts; regenerate **only on growth ticks** and cache the mesh (AGENTS §8). No per-frame marching cubes, no ML inference. Serializable genome → reconstructable mesh, exactly the mandated model. Fits a ≤10-pet Minecraft budget and runs comfortably in a Three.js testbed.

**Build order for the testbed:** start with the runevision-style **skeleton + tapered-segment skin** driven by an age slider and a genome panel (fastest path to a scrubdrawn cute→cool arc), add **tube/L-system horns/wings** next, layer the **morph-target face** third, and only evaluate the **marching-cubes smoothing pass** if grok/Claude vision says the segment skin isn't cute enough.

---

## Sources

- Chris Hecker — *My Liner Notes for Spore* (procedural skinning/metaballs/animation): https://chrishecker.com/My_Liner_Notes_for_Spore
- *How the Spore Creature Creator Works* — RemptonGames: https://remptongames.com/2022/08/07/how-the-spore-creature-creator-works/
- *Development of Spore* — Wikipedia: https://en.wikipedia.org/wiki/Development_of_Spore
- runevision — *Procedural creature progress 2021–2024*: https://blog.runevision.com/2025/01/procedural-creature-progress-2021-2024.html
- `pdlla/animalclub` — genetics + procedural 3D animal library (Skellygen, DNA crossover): https://github.com/pdlla/animalclub
- `bunnybones1/threejs-procedural-animal` — rigged procedural animal in Three.js: https://github.com/bunnybones1/threejs-procedural-animal
- Alex Christo — *Procedural Creature Generation and Animation for Games* (Bournemouth NCCA MSc): https://nccastaff.bournemouth.ac.uk/jmacey/MastersProject/MSc22/01/ProceduralCreatureGenerationandAnimationforGames.pdf
- `nmagarino/Pudgy-Pals-Procedural-Creature-Generator`: https://github.com/nmagarino/Pudgy-Pals-Procedural-Creature-Generator
- No Man's Sky procedural generation — Kotaku: https://kotaku.com/a-look-at-how-no-mans-skys-procedural-generation-works-1787928446
- What the code of No Man's Sky says about procedural generation — Game Developer: https://www.gamedeveloper.com/programming/what-the-code-of-i-no-man-s-sky-i-says-about-procedural-generation
- No Man's Sky Wiki — Procedural generation: https://nomanssky.fandom.com/wiki/Procedural_generation
- SMAL — Skinned Multi-Animal Linear model: https://smal.is.tue.mpg.de/
- Zuffi et al., *3D Menagerie: Modeling the 3D Shape and Pose of Animals* (CVPR 2017): https://ar5iv.labs.arxiv.org/html/1611.07700
- SMPL model wiki (Meshcapade): https://github.com/Meshcapade/wiki/blob/main/wiki/SMPL.md
- Three.js marching cubes example: https://threejs.org/examples/webgl_marchingcubes.html
- `takumi0125/threejsMarchingCubesMetaball`: https://github.com/takumi0125/threejsMarchingCubesMetaball
- `sagzain/metaballs-threeJS`: https://github.com/sagzain/metaballs-threeJS/
- Runions, Lane, Prusinkiewicz — *Modeling Trees with a Space Colonization Algorithm*: https://algorithmicbotany.org/papers/colonization.egwnp2007.large.pdf
- Jason Webb — *Space colonization algorithm in JavaScript*: https://medium.com/@jason.webb/space-colonization-algorithm-in-javascript-6f683b743dc5
- `FrancescoGradi/L-System-Trees` (Three.js L-systems): https://github.com/FrancescoGradi/L-System-Trees
- ciphrd — *Generating a 3D growing tree using space colonization*: https://ciphrd.com/2019/09/11/generating-a-3d-growing-tree-using-a-space-colonization-algorithm/
- Three.js forum — procedural mesh discussion: https://discourse.threejs.org/t/procedural-mesh/22327
- stable-dreamfusion (text/image-to-3D): https://github.com/ashawkey/stable-dreamfusion
- Magic3D: https://arxiv.org/pdf/2211.10440
- Lee et al., *Text-to-3D Shape Generation* survey (CGF 2024): https://onlinelibrary.wiley.com/doi/10.1111/cgf.15061
