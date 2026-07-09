# Roadmap

## Locked decisions (2026-07-05)
- **Test bed = pure web / Three.js.** Browser generation + render, live sliders for human feedback, glTF export. Evaluated via Claude-in-Chrome screenshots + grok vision.
- **MC target = NeoForge (leaning).** Reevaluate after research track 3 compares NeoForge vs Fabric for runtime-mesh entities.
- **Art arc = cute→cool via growth.** Dragons START as cute babies and GROW INTO cooler, more aggressive-looking adults. The cute→cool transformation is driven by the growth step over age — not a fixed trait. Faces stay cartoonish/expressive at every age. See `design/cute-to-cool-arc.md`.

## Phase 0 — Kickoff
- [x] Repo, structure, AGENTS.md, README, grok wrapper.
- [x] Key decisions locked (above).
- [x] Research fan-out (4 tracks) → `research/` — all four complete and converged.
- [x] Feasibility verdict: **GREEN LIGHT** — runtime evolving meshes are low-risk at ≤10 pets; NeoForge confirmed. See `design/architecture-synthesis.md`.
- [x] Synthesis of the four tracks → `design/architecture-synthesis.md`.
- [~] Test-bed harness scaffold (Three.js) — build agent in progress; merge & verify pending.

**Open question carried into Phase 2 — the "skin tension":** box-per-bone cuboids (cheap, MC-native) vs tapered/smoothed skin (cuter). Test bed will run dual skin modes and resolve it with human + grok-vision feedback. Do not hard-commit the skin representation yet.

## Phase 1 — Research (parallel)
1. **Parametric creature modeling** — prior art on generating animal/creature 3D models from parameters (Spore, spline/metaball rigs, box-modeling generators, ML/latent approaches). → `research/parametric-creature-modeling.md`
2. **Rule-based iterative growth** — L-systems, differential/differential-line growth, reaction-diffusion, cellular/morphogenesis models for simulating organic growth as a step function. → `research/rule-based-growth.md`
3. **Minecraft model-generation feasibility** — how entity models/animation work (Blockbench/JSON, GeckoLib), runtime mesh generation on Fabric/NeoForge, memory/CPU/network budget, save/load & sync of a genome. → `research/minecraft-model-generation.md`
4. **Expressive cartoon eyes & brows** — prior art on steerable eye rigs and floating-brow emotion systems that scale onto any face; mapping emotions to eye/brow pose. → `research/expressive-faces.md`

## Phase 2 — Test bed
- [x] Standalone Three.js harness merged to `main` (viewer, auto-sliders, age scrub, glTF/PNG export). See `testbed/`.
- [x] Headless render/eval harness (`testbed/tools/render.mjs`) — drives the page in headless Chrome, scrubs age, auto-frames, writes PNGs. Canonical eval path (Chrome extension not required).
- [x] Eval loop proven: page → render → Claude Read + `tools/grok.sh eval`. First eval in `design/testbed-eval-01.md`.
- [x] Cute→cool arc verified on the placeholder (age slider drives a real transformation).
- Rigging + skinning decided → `design/rigging-and-skinning-recommendation.md`: ONE fixed-topology skeleton (stable bone names; genome+age only scale bone length + envelope radius), primitive-envelope surface feeding an implicit field with TWO backends (marching-cubes smooth for testbed, greedy-voxelized cuboids for MC/geo.json), weights free via field-softmax (no Pinocchio/BBW). Skin tension dissolved: cuboids get an organic silhouette from the field.
- Body plans = **parametric-emergent** (DECIDED): limbs/wings/neck/body are continuous traits; snake/wyvern/quadruped/eastern are attractor presets. Snake-origin growth: limb budding = envelope radius rising from ~0 with age.

  **Build order (autonomous) — DONE:**
  - [x] **Step 1** — fixed-topology 59-bone skeleton + allometric growth, raw capsules, parametric-emergent genome, 4 archetypes.
  - [x] **Gallery** — `testbed/tools/gallery.mjs`: age strip, variation grid, mutation tree (pose sheet stubbed → wire now that weights exist). See `design/gallery-spec.md`.
  - [x] **Step 2** — implicit field (smooth-min of per-bone capsules) + marching cubes + field-softmax skin weights (standard `skinIndex`/`skinWeight`). Fixes the "larval" body.
  - [x] **Step 3** — voxelized-cuboid backend + Bedrock `geo.json` export (validated GeckoLib model, `testbed/samples/`). Skin tension resolved: field-rounded cuboids are MC-native and recognizable.
  - Evaluations: `design/testbed-eval-02.md` (Steps 1–2), smooth-vs-voxel comparison confirms the cuboid path is shippable for MC.

## Phase 2.5 — Tuning & polish (next)
- [ ] **Cross-validated tuning backlog** (`design/testbed-eval-02.md`): P0 brows→soft arched shapes; P1 add mouth/jaw line; P1 clamp `robustness` beach-balls; facets; hind-leg absorption (`smoothK`); voxel warty underside; square-viewport framing.
- [ ] **Wire the pose-sheet gallery** — weights now exist; add a pose API + `poses` gallery mode to evaluate the rig under motion.
- [x] **Face pass**: soft arched brows (fixed the "floating sticks") + parametric mouth (`mouthOpen`/`mouthCurve`, wired to emotions). Teeth/tongue/fangs deferred.
- [x] **Bat-wing forelimb refactor + membrane** — strict tetrapod (`design/limb-and-wing-architecture.md`); archetypes snake/drake/wyvern/crawlerFlyer/grasper/eastern; proportion-tuned (big wings, chunky grasper, tamer robustness).
- [x] **Expressive ears + optional face features** — ear rig (structural + `earPerk`/`earPitch`/`earFlare`, wired to emotions incl. new `afraid`/`sad`, age cute→cool); optional tusks/frill/barbels/brow-mods. `research/expressive-ears-and-features.md`.
- [x] **CA feature system — phase 1** — `testbed/src/featureGrid.js` (stable (u,v) anchor lattice + `window.__showGrid` overlay) + activator–inhibitor CA markings → vertex colors / voxel tint; genome-driven, age-emergent, breeding-safe. `research/ca-feature-placement.md`.
- [x] **CA feature system — phase 2** — discrete geometry off the grid (`testbed/src/features.js`): spikes/ridges (blue-noise spaced, cell-size suppression), dorsal sail, feathers, scutes; age-emergent; voxel spike cubes bake into `geo.json`.
- [x] **Polish**: bigger flap-like Toothless ears (still expressive/age-scaled); crisper markings via denser grid (K_AXIAL 12→22, ~824 cells) + hardened mask edge; spikes re-verified (spacing/suppression intact); ~36ms/regenerate.
- [ ] **Remaining polish**: teeth/tongue/fangs on the jaw hook; feather/scute drama; ear micro-behavior (idle twitches).
- [ ] **Wire the pose-sheet gallery** — weights exist; add a pose API + `poses` gallery mode; also unlocks the dramatic wing-spread rest pose.
- [ ] Genome crossover control (breed two genomes → egg/baby) — mutation tree is the first step.
- [ ] Human-in-the-loop tuning pass with the galleries.

## Phase 3 — Dragon Explorer (NEW flagship target; see `design/mission.md`)
The test bed graduates into the **Dragon Explorer** app. Pursue **top-tier animation & rendering** here (fidelity can be reduced for downstream targets later). Three tracks:

### 3a. Procedural animation + behavior (the foundation — dragons must MOVE)
- **Skeletal animation** on the existing stable bones + field-softmax skin weights: pose API, procedural gaits (walk/run), flight, IK (foot placement, look-at), secondary motion (wings/membrane, ears, tail).
- **Behavior state machine** over: resting, roosting, standing, posturing, begging, playing, walking, running, flying — with smooth transitions + idle variety.
- Unlocks the deferred **pose-sheet gallery** and the dramatic spread-wing pose.
- Research: `research/procedural-animation-behavior.md`.
- [x] **Phase 0 (foundation) DONE** — `testbed/src/rig.js` (Bone tree from `userData.skeleton`, pelvis re-rooting, body→`SkinnedMesh` bound to existing skin weights; layered wings/ears/spikes/face follow bones) + `testbed/src/poses.js` (pose API + POSES: idle/stand/rear-up/wings-open/roar/curl-sleep/walk-contact) + `gallery.mjs poses` sheet + gentle breathing/tail-sway idle. Verified across wyvern/drake/snake. Voxel degrades gracefully (unposed).
- [ ] Next: gaits/IK (walk/run, morphology-adaptive) → flapping flight + spring secondary motion → behavior FSM (the 9 behaviors).

### 3b. High-fidelity rendering upgrade
- Research: `research/high-fidelity-rendering.md`.
- [x] **Phase 1+2 DONE** — `testbed/src/materials.js`: ACES tone-map + sRGB color mgmt + `RoomEnvironment` IBL + `MeshPhysicalMaterial` per part (clearcoat body/eyes, `sheen` feathers, keratin spikes) + **hero thin-walled transmission wing membranes/sail** (glow backlit) + light rebalance + soft shadows. `window.__renderTier` high/cheap switch (+ UI), single `renderFrame()` seam. Markings + skinning preserved.
- [ ] **Phase 3 (deferred, `.agents/resume/render-upgrade.md`)** — EffectComposer post stack (GTAO + UnrealBloom + OutputPass, MSAA/HalfFloat), VSM soft shadows + contact shadow, route `renderFrame()`/gallery through the composer.

### 3c. Breeding mechanics + Explorer UX
- Two-parent genome crossover → egg/baby; inheritance view; family tree. (Genome already supports it; mutation-tree gallery is the first step.)
- Explorer app shell: pick/breed/watch dragons; camera; behavior selector.

### Remaining creature polish (parallel, low priority)
- Teeth/tongue/fangs on the jaw hook; feather/scute drama; ear micro-behavior.

## Phase 4 — Downstream targets (later, reduced fidelity)
- Standalone game/simulator on the same engine.
- Minecraft mod: genome→NBT sync, tick-based growth, taming/feeding/training/breeding hooks, wild (fixed) vs pet (evolving) split, LOD & budget, baked animation on the stable bones. (Voxel skin + `geo.json` path already exists.)
