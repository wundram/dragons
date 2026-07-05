# Dragons — procedurally-grown dragon pets for Minecraft

A Minecraft mod that adds **dragon pets with procedurally generated, evolving 3D models**. Instead of a fixed model, each dragon is described by a compact **genome of traits**; a rule-based growth function advances the model over time so a hatchling visibly grows into an adult, shaped by care, feeding, training, and environment. Two dragons can breed to combine genomes into a new egg.

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
