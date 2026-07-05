# Roadmap

## Phase 0 — Kickoff (current)
- [x] Repo, structure, AGENTS.md, README, grok wrapper.
- [ ] Research fan-out (4 tracks below) → `research/`.
- [ ] Feasibility verdict for evolving models in a Minecraft mod.
- [ ] Test-bed tech decision (informed by research).

## Phase 1 — Research (parallel)
1. **Parametric creature modeling** — prior art on generating animal/creature 3D models from parameters (Spore, spline/metaball rigs, box-modeling generators, ML/latent approaches). → `research/parametric-creature-modeling.md`
2. **Rule-based iterative growth** — L-systems, differential/differential-line growth, reaction-diffusion, cellular/morphogenesis models for simulating organic growth as a step function. → `research/rule-based-growth.md`
3. **Minecraft model-generation feasibility** — how entity models/animation work (Blockbench/JSON, GeckoLib), runtime mesh generation on Fabric/NeoForge, memory/CPU/network budget, save/load & sync of a genome. → `research/minecraft-model-generation.md`
4. **Expressive cartoon eyes & brows** — prior art on steerable eye rigs and floating-brow emotion systems that scale onto any face; mapping emotions to eye/brow pose. → `research/expressive-faces.md`

## Phase 2 — Test bed
- Standalone generator + renderer (no Minecraft). Genome → mesh → image.
- Growth loop: iterate the step function, render each stage.
- Evaluation harness: Claude Read + grok vision score each render.
- Human-feedback loop to tune parameters/rules.

## Phase 3 — Generate & tune
- Produce candidate dragons across the trait space.
- Score, gather human feedback, tune rules/genome encoding.
- Lock a genome schema and a growth ruleset that reliably produce good dragons.

## Phase 4 — Mod design
- Design the real mod: genome storage/sync, tick-based growth, taming/feeding/training/breeding hooks, face rig, wild (fixed) vs pet (evolving) split, LOD & budget.
- Choose loader/version, model runtime, and integration path.
