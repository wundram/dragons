# Architecture synthesis (Phase 1 → Phase 2)

Synthesis of the four research tracks (`research/parametric-creature-modeling.md`, `research/rule-based-growth.md`, `research/minecraft-model-generation.md`, `research/expressive-faces.md`). The four agents worked independently and **converged on one coherent design**. This doc is the decision record that drives the test bed and the eventual mod.

## The convergent architecture

```
genome (compact trait vector, serializable)
   │
   ├─ grow(genome, age, env)  ── pure function; age is the ONLY carried state ──┐
   │                                                                            ▼
   │                                                            resolved parameters @ this age
   ▼                                                                            │
canonical dragon SKELETON (fixed bone topology, stable bone names)             │
   + tagged ATTACHMENT SLOTS (head, horns, back-spines, wing-spars, tail-tip)  │
   │                                                                            │
   ├─ per-bone SKIN  ◄── swappable representation (see "the skin tension")──────┤
   ├─ APPENDAGES: horns/spikes/wing-spars via threshold-gated parametric L-systems / tubes
   ├─ MARKINGS: reaction-diffusion (Gray-Scott) texture, optional
   └─ FACE SUB-RIG: 8-param steerable eyes + floating brows (face-agnostic contract)
```

### 1. Genome → skeleton, not genome → mesh
A dragon is a **compact genome of meaningful, hand-authored traits** (not a PCA/ML latent — `runevision` explicitly rejected latents because they entangle traits). The genome maps to a **single canonical bone rig** with **tagged attachment slots** (No Man's Sky style), and each bone is skinned. This is the shared backbone across all tracks.

### 2. Grow the parameters, not the mesh
`grow(genome, age, env)` is a **pure function**; **age is the only state carried forward**, so growth is deterministic, serializable, and fully reconstructable from the genome alone (guardrail §8). No mesh is ever stored long-term.

- **Allometry is the core cute→cool mechanic:** per-part **power laws** (`exponent < 1` → big-headed, big-eyed, stubby juvenile = CUTE; `exponent > 1` → lean, long-snouted, long-limbed adult = COOL) give true non-uniform scaling and a **free monotonic cute→cool arc** from a single number (age).
- **Emergent structures:** horns, back-spines, and wing membranes appear at **age thresholds** via parametric+stochastic L-systems whose iteration count / length scale with age — the "structures emerge as it matures" effect.
- **Environment/care** modulate **coefficients and thresholds only, never topology** — so a well-fed vs neglected dragon differs in proportion/feature emphasis but is always a valid mesh.

### 3. Breeding = genome crossover
Because the genome is a small trait vector, breeding is **crossover / interpolation of two genomes** (with mutation). This always yields a valid genome → valid mesh — unlike blending meshes directly. Egg/baby = child genome rendered at age≈0.

### 4. Faces: an 8-parameter, age-invariant rig
Reusable eye+brow sub-rig, **face-agnostic contract**: the generator emits, per eye, `{position, normal, up, eyeRadius}`; all rig offsets are in `eyeRadius` units so it fits **any head at any scale**. Params: `eyeOpen, squint, pupilX, pupilY, pupilSize, browHeight, browAngle, browCurve (+ browAsym)`. **Age remaps only the neutral rest pose** (baby: wide eyes, big pupils, high round brows → adult: narrower, smaller pupils, lowered angular brows); the **8-emotion preset table (happy/sad/angry/surprised/afraid/curious/sleepy/content) is expressed as deltas from that rest pose, so one table serves every age.** Ports to Minecraft cuboids + texture layers (no morph targets required).

## Minecraft feasibility — GREEN LIGHT

- **Verdict:** runtime evolving meshes are realistic and **low-risk at our scale**. Vanilla entity models are already built in code (`MeshDefinition → LayerDefinition.bakeRoot() → ModelPart`), so re-baking a genome-derived skeleton on growth ticks for **≤10 pets** costs **sub-millisecond CPU and kilobytes of RAM**.
- **Loader = NeoForge (confirmed).** Geometry mechanism is loader-neutral; NeoForge adds data attachments (genome), structured render events, current render-state docs, and the right content-mod ecosystem. Keep the generator loader-free as insurance.
- **Runtime architecture:** genome + age synced via `SynchedEntityData`; **client** deterministically expands to a **cached GeckoLib `BakedGeoModel` per (genome, age-bucket)**, with **per-bone scale lerp between buckets** for smooth growth; **stable bone names** so keyframe animations survive re-bakes; age-scaled hitbox via `refreshDimensions()`.
- **Avoid:** raw `VertexConsumer` triangle meshes (you own lighting/culling/skinning; MC 26.2 Vulkan backend raises risk) and glTF import into MC (MCglTF is stale).
- **Testbed→MC bridge:** the interchange format is **Bedrock `geo.json`** (GeckoLib/Blockbench native), **glTF stays evaluation-only.**

## The skin tension (the one thing to resolve empirically)

| | Box-per-bone cuboids | Tapered segments / marching-cubes smoothing |
|---|---|---|
| MC portability | native (`geo.json`), cheap, low-risk | needs raw meshes → high MC risk |
| "Cute" roundness | blocky | rounder/softer, better for baby cuteness |
| Verdict source | track 3 (Minecraft) | tracks 1 & 2 (aesthetics) |

**Resolution:** the **skeleton + slots + growth + faces are identical** in both; only the *skin renderer* differs. The test bed will support **dual skin modes** (box-per-bone AND tapered/smoothed) over the same skeleton, and we'll use human + grok-vision feedback to measure **how much cuteness the cuboid mode actually costs.** If cuboids read "cute enough," we get the cheap low-risk MC path for free. If not, we consider a gated marching-cubes smoothing pass on ticks, or a hybrid (cuboid body, rounded head). **This is a primary question Phase 2 exists to answer** — do not hard-commit the skin representation yet.

## Draft genome schema v0 (to refine in the test bed)

Proportion/allometry traits (each with a growth exponent): `headSize, snoutLength, eyeSize, neckLength, torsoLength, torsoRoundness, tailLength, limbLength, limbThickness`. Feature traits (threshold + magnitude): `hornSize, hornStyle, backSpineAmount, wingSize, wingSpan, clawSize`. Appearance: `colorHue, colorSat, markingType (RD seed), markingContrast`. Personality/expression bias: `defaultMood, browThickness`. Growth-rate traits: `maturationRate`, per-cluster rate modifiers. Face rig params are runtime/animated, not genome (except bias). Cute↔cool *destination* emerges from the adult-age allometric targets.

## Immediate next steps (Phase 2)

1. Merge the `testbed-harness` worktree → `main`; visually verify (Claude screenshot + `grok.sh eval`).
2. Replace the placeholder generator with the **skeleton + tagged-slots** generator; wire the **allometric age curves** so the age slider drives a real cute→cool arc. Build order (per track 1): skeleton + per-bone skin w/ age slider → tube/L-system horns & wings → face sub-rig → (optional) markings, (optional) smoothing.
3. Implement **dual skin modes** and a side-by-side cuteness eval to resolve the skin tension.
4. Add a **genome crossover** control (breed two genomes → offspring) to test breeding early.
5. Add a `geo.json` export path (alongside glTF) to keep the MC bridge honest.
6. When the generator reliably produces good dragons across the arc, schedule the **1-week NeoForge spike** (hardcoded genome, 10s growth re-bake, one animation surviving re-bakes) to de-risk Phase 4.
