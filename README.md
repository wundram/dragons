# Dragons — a procedural dragon system

A **target-agnostic procedural dragon engine**: each dragon is a compact **genome of traits** over one stable skeleton + body-anchored feature grid, producing a complete, deterministic, breedable, age-evolving creature (body plan, bat-wings, expressive face/ears, spikes/sail/feathers/scutes, coloration). A rule-based growth function advances the model over time so a hatchling visibly grows into an adult; two dragons can breed to combine genomes into a new egg.

**Target apps (priority order):** (1) the **Dragon Explorer** — our flagship standalone showcase app pursuing *top-tier animation & rendering*, with breeding mechanics and dragons doing procedural behaviors (resting, roosting, standing, posturing, begging, playing, walking, running, flying); (2) a standalone game/simulator; (3) a **Minecraft mod** at reduced fidelity (voxel skin + `geo.json`). See `design/mission.md`. The engine keeps **fidelity tiers** so each target scales the skin/animation/shading while sharing the same genome + skeleton.

## Core ideas

- **Genome → model.** A dragon is a small set of parameters (traits). A generator turns the genome + a growth age into a 3D mesh. Nothing stores raw meshes long-term.
- **Growth as iteration.** `state[n+1] = grow(state[n], params, environment)`. Each growth tick applies a rule-based step (think L-systems / differential growth / morphogenesis) to advance the form.
- **Expressive faces.** A reusable eye+brow sub-rig (steerable pupils, floating cartoon brows) layers onto any generated head to give readable emotions — cute, fierce, curious, sleepy.
- **Feasibility by design.** Only tamed **pets** (≤ ~10 per server) use evolving models. Wild dragons use cheap fixed models. Growth is recomputed on ticks, not frames.

## Long-term mod features

Tame · feed · care · train (all shift appearance over time) · breed (combine two genomes → egg/baby) · expressive emotional faces.

## How we work (phases)

1. **Research** prior art: parametric creature modeling, rule-based growth, Minecraft runtime model generation, expressive-eye rigs. → `research/`
2. **Test bed:** a standalone (non-Minecraft) sandbox to try generation approaches, render them, and evaluate with human + grok-vision feedback. → `testbed/`
3. **Generate & tune:** produce candidate dragons, gather feedback, tune the algorithm.
4. **Mod design:** design the real mod around the proven generator. → `design/`

See `docs/roadmap.md` for detail and `AGENTS.md` for the operating rules every contributor follows.

## Tooling

- **grok CLI** — a second model on this machine used to (a) generate art assets/textures and (b) act as a vision evaluator judging renders for geometric correctness and aesthetic quality. See `AGENTS.md §5` and `tools/grok.sh`.
