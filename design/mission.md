# Mission (updated 2026-07-09)

## What we're building
A **procedural dragon system**: one genome over one stable skeleton + body-anchored feature grid produces a complete, deterministic, breedable, age-evolving creature (body plan, bat-wings, expressive face/ears, spikes/sail/feathers/scutes, coloration). The creature engine is **target-agnostic**; it feeds multiple apps.

## Target apps (in priority order)
1. **Dragon Explorer (FIRST target — the flagship).** A standalone app to *show what our dragons can be*. It is where we pursue **top-tier animation and rendering** — the aspirational showcase. Even if later targets must reduce fidelity/complexity, the Explorer runs the full-quality path. Scope:
   - **Breeding mechanics** — combine two dragons' genomes into an egg/baby; explore inheritance; family trees.
   - **Living dragons** — watch dragons do **procedurally generated behaviors and movements**: resting, roosting, standing, posturing, begging, playing, walking, running, flying — with smooth transitions and idle variety.
   - **High-fidelity rendering** — materials, lighting/environment, shadows, post-processing that make the creatures look their best.
2. **Standalone video game / simulator.** A game or life-sim built on the same engine (taming, care, training, ecosystems). Likely full or near-full fidelity.
3. **Minecraft mod.** A downstream target at **reduced fidelity** (voxel skin, simplified/baked animation, ≤~10 evolving pets). Still a real goal, but no longer the primary lens — the engine already has the voxel/`geo.json` path for it.

## Fidelity tiers (design principle)
Keep the engine layered so each target picks its tier — like we already do for skin (smooth marching-cubes for Explorer ↔ voxel cuboids for Minecraft):
- **Explorer tier:** full-res mesh, rich procedural skeletal animation + secondary motion + IK, PBR/rendering polish.
- **Reduced tier (MC/perf):** voxel skin, simplified/baked animation on the same stable bones, cheap shading.
The **stable skeleton + genome + feature grid stay identical across tiers**; only the skin, animation richness, and shading scale down.

## Immediate implication
The Explorer needs **motion**. The rig has bones + field-softmax skin weights but nothing poses it yet. So the next capability is a **procedural animation + behavior system** (skeletal posing on our bones → gaits/IK/secondary motion → a behavior state machine over the list above) plus a **rendering upgrade**, and the **breeding UI/mechanics**. See `docs/roadmap.md` Phase 3.

## Non-goals for now
Networking/multiplayer, the actual Minecraft mod code (stays downstream), monetization. The Explorer is a local showcase app first.
