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
- [ ] **Real generator:** replace placeholder internals with skeleton + tagged attachment slots + allometric growth curves (from `design/architecture-synthesis.md`). Build order: skeleton + per-bone skin w/ age → tube/L-system horns & wings → face sub-rig → markings.
- [ ] **Resolve the skin tension:** implement dual skin modes (box-per-bone cuboid vs tapered/smoothed) and compare with human + grok-vision feedback.
- [ ] Work the P0/P1 defect backlog in `design/testbed-eval-01.md` (floating baby horns, cross-eyed pupils, larval body, flat wings, tube snout).
- [ ] Genome crossover control (breed two genomes → offspring) to test breeding early.
- [ ] `geo.json` export path (alongside glTF) to keep the Minecraft bridge honest.
- [ ] Human-feedback loop to tune parameters/rules.

## Phase 3 — Generate & tune
- Produce candidate dragons across the trait space.
- Score, gather human feedback, tune rules/genome encoding.
- Lock a genome schema and a growth ruleset that reliably produce good dragons.

## Phase 4 — Mod design
- Design the real mod: genome storage/sync, tick-based growth, taming/feeding/training/breeding hooks, face rig, wild (fixed) vs pet (evolving) split, LOD & budget.
- Choose loader/version, model runtime, and integration path.
