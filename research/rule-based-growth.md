# Rule-based / iterative-step models for simulating organic growth

Research for the Dragons project's growth function `state[n+1] = grow(state[n], params, environment)`.
Goal: a cheap, deterministic, serializable growth step that drives a **monotonic cute→cool aging arc**
with **emergent features** (horns, spines, wings), expressible in JS/Three.js.

## TL;DR (5 bullets)

- **Don't grow the mesh; grow the *parameters*.** The robust, cheap, reproducible design is a pure
  function `grow(genome, age, env) → shapeParams`, then a stateless mesh generator renders those params.
  Age is the loop variable; the "iteration" is really evaluating growth curves at `age = n·Δ`. This is
  deterministic, serializable (store genome + age, never meshes), and recomputes identically anywhere.
- **Allometry is the core mechanic, not scaling.** Real biology grows body parts at *different power-law
  rates* (head grows slower than body → juveniles are big-headed = "cute"). Model each feature with its
  own allometric curve `size = a · age^b`; picking `b<1` vs `b>1` per part *is* the cute→cool shift.
  Babies are literally not small adults — exactly our hard constraint.
- **L-systems are the right tool for the branching/segmented emergent parts** — horns, spines, tail
  frills, wing-finger membranes. Use **parametric + stochastic** L-systems where the derivation
  *depth/step-count is a function of age*, so structures visibly extend, branch, and sharpen as the
  dragon matures. Per-genome random seed gives variety without storing geometry.
- **Reaction-diffusion (Gray-Scott) and differential growth handle surfaces, not skeleton** — skin
  markings/spots/stripes that "emerge" with age, plus organic membrane/frill wrinkling. Gray-Scott runs
  cheaply as a ping-pong fragment shader in Three.js and is exactly how animal-coat patterns are modeled.
- **Recommendation:** a hybrid — **allometric growth curves** drive continuous proportions (the smooth
  cute→cool interpolation), **threshold-triggered parametric L-systems** grow the emergent hard parts at
  age gates, and **reaction-diffusion textures** bring in markings late. Environment/care modulate the
  curve coefficients and thresholds, not the topology. All of it is a few hundred lines of deterministic
  JS + one RD shader.

---

## Findings by technique

### 1. L-systems (parametric / stochastic / context-sensitive)

An L-system is a **parallel string-rewriting grammar**: an axiom string is rewritten every iteration by
production rules, then the final string is interpreted geometrically (turtle graphics) into a branching
structure. They are the canonical tool for growing plants and any recursive/segmented organic form
(Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants*).

Variants relevant to us:

- **Parametric L-systems** attach numeric parameters to symbols (e.g. `F(len,width)`), so rules can
  express *continuous* growth — segment length, taper, branch angle all vary smoothly. Rules can be
  guarded by conditions on those parameters (Hanan 1992 thesis; Prusinkiewicz). This is what lets a horn
  grow *longer and sharper* over time rather than just adding discrete segments.
- **Stochastic L-systems** choose among production rules probabilistically, giving natural variety. Seed
  the RNG from the genome so each dragon's horns/spines are unique but *reproducible* from the genome.
- **Context-sensitive L-systems** let a rule fire based on neighboring symbols — useful for
  hormone/signal propagation along a structure (e.g. spikes get larger toward the tail base), and for
  making feature emergence propagate down a spine rather than appear everywhere at once.

**Key trick for aging:** make the **number of derivation steps (or a continuous "growth parameter") a
function of `age`.** More iterations → more branching/extension → the structure literally grows. Because
the derivation is deterministic given (axiom, rules, seed, step-count), you recompute the exact same horn
at any age from the genome. This directly serves emergent features: horns/spines/wing-fingers start as
1-symbol nubs and extend/branch as age crosses thresholds.

Cost is trivial for the small structures we need (a horn is a handful of segments), and it maps cleanly
to a mesh: each turtle segment becomes a tapered tube/prism.

### 2. Differential growth & reaction-diffusion (surfaces, patterns, deformation)

Two related "grow a surface / grow a pattern" families:

- **Differential (line/mesh) growth:** a polyline or mesh made of nodes connected by springs. Each step:
  push apart overlapping nodes (repulsion), pull along edges (spring), and **insert new nodes where edges
  stretch past a length threshold** (growth). The manifold buckles and folds into brain-coral / ruffled-
  edge forms. Great for organic frill/membrane edges (wing trailing edge, crest ruffles). Node-graph
  update is awkward on GPU and can be unstable at scale (nshelton's notes), so keep it to small 1D edges,
  not whole-body meshes.

- **Reaction-diffusion (Gray-Scott / Turing patterns):** two virtual chemicals U and V diffuse and react
  on a grid; a feed rate `f` and kill rate `k` select the emergent pattern — spots, stripes, labyrinths,
  "leopard/giraffe" coats. This is Turing's 1952 model for animal-coat pigmentation and is the standard
  way to generate organic skin markings. It runs as a **ping-pong fragment shader** in Three.js
  (render-to-texture, two float textures swapped each frame): cheap, GPU-friendly, real-time. Several
  ready Three.js implementations exist (colejd, amandaghassaei, jasonwebb playground).

For us these govern the **texture/markings layer** of the cute→cool arc ("markings emerge" in the design
table) and optionally the wrinkling of membranes — *not* the skeleton/proportions. Growing the RD domain
over time, or ramping `f`/`k` with age, makes soft baby skin sharpen into patterned adult hide.

### 3. Allometric growth & morphogenesis (the proportion engine)

**Ontogenetic allometry**: body parts change size *relative to the whole* during growth, each following
a power law `y = a · x^b` (x = body size/age). If `b = 1` the part scales isometrically (stays
proportional); `b < 1` it grows relatively *slower* (ends up smaller — like the human head/eyes, the
source of "cute"); `b > 1` it grows relatively *faster* (limbs, snout — the source of "cool/lean").

- **Neoteny** = retaining juvenile proportions; the classic result is that juvenile skulls have big
  neurocrania, big eyes, short faces — precisely the "cute baby" column of our design table. Adults get
  prognathism (longer snout), longer limbs — our "cool adult" column. So the cute→cool arc *is* a set of
  differing allometric exponents per body part. (Nature *Sci Reports* 2024 multi-scaling allometry;
  Grokipedia neoteny; Study.com allometric growth.)
- **Morphogen scaling models** (e.g. axolotl-limb-regeneration tissue-growth model) show how a signal
  gradient can keep growth *proportional* or deliberately *disproportional* — conceptual backing for
  driving per-part growth from a shared "age/size" signal.

**How to express "aging" concretely:**
- **Continuous features → interpolation via allometric curves.** For each proportion (head:body, eye
  size, snout length, limb length, body roundness) define `value(age) = lerp(babyVal, adultVal, ease(age^b))`,
  with per-feature exponent/easing `b`. Different `b` per feature = non-uniform (allometric) growth, so
  the silhouette re-proportions, it doesn't just uniformly scale.
- **Emergent features → threshold gates.** Horns/wings "appear" when `age > t_feature`; blend in with a
  smoothstep over a small window so nothing pops. The feature's own post-threshold growth uses its own
  curve (or an L-system step-count). This matches the design's "rule-based emergence of new structures at
  growth thresholds."
- Monotonicity is free: make every curve and every threshold ramp non-decreasing in age → guaranteed
  cute→cool with no regressions, satisfying the success test (scrub 0→1, always on-model).

### 4. Cellular automata / agent-based growth & "grow a creature" prior art

- **Karl Sims, *Evolved Virtual Creatures* (1994):** creature bodies encoded as a **directed graph
  genotype** that is "grown" into a phenotype of connected cuboid limbs; genes are recursive so one graph
  node can generate repeated segments (segmented tails, limbs). Evolved via GA against a fitness task.
  Takeaway for us: a **compact recursive genome that unfolds into a body** is proven and powerful; we
  borrow the genotype→phenotype "growth" idea (not the physics/evolution).
- **Neural Cellular Automata (e.g. *Growing/Regenerating Soft Robots through NCA*):** a learned local
  update rule grows and *regenerates* a shape from a seed cell. Elegant and robust to damage, but needs
  training and is heavier than we need for 10 pets; noted as inspiration, not a build path.
- **Spore (2008):** despite reputation, Spore creatures are **not** procedurally grown — the player sets
  spine segment count/bend and drags parts onto a **shared skeleton/rig**; procedural *animation* adapts
  to whatever limbs exist. Lesson: a **flexible shared rig + parametric spine + attachable parts** scales
  to endless morphologies cheaply and animates automatically. Very close to what we want for a dragon
  (serpentine spine + attachable horns/wings/limbs).
- **No Man's Sky:** creatures assembled from artist **descriptor-tagged part banks** on **shared rigs**;
  as height changes, proportions and animation retarget. Lesson: **shared rig + proportion parameters**
  is the production-proven way to get variety and free animation; pairs naturally with allometric
  proportion curves.
- **Digital morphogenesis / differential growth art** (Nervous System, Jason Webb, Andy Lomas "Cellular
  Forms") — agent/particle systems that accrete cells step-by-step into organic forms; beautiful but
  compute-heavy and hard to control toward a *specific* target silhouette. Good for one-off assets, not a
  steerable per-frame pet.

### 5. Designing the growth step: cheap, incremental, deterministic, serializable

Principles synthesized from the above and our feasibility guardrails (AGENTS.md §8):

- **Pure function of (genome, age, env).** `grow` must have no hidden state. Then `state[n]` is just
  `age = n·Δ`; nothing needs to be carried between ticks except the scalar age. This is the cheapest and
  most reproducible design and makes save/load, breeding, and network sync trivial (send genome + age).
- **Serialize the genome, never the mesh.** Genome = the curve coefficients, thresholds, L-system
  seeds/rules-choice, and RD params. Rebuild the mesh on demand. Matches "reconstructable from a compact
  genome, not stored as raw meshes."
- **Recompute on growth ticks, cache between them.** Only re-evaluate proportions + regenerate affected
  parts when age crosses a tick or a threshold; cache the built mesh and reuse every frame (guardrail:
  don't recompute per frame).
- **Incremental where possible.** Continuous proportions are just cheap curve evals. L-system structures
  only need rebuilding when their step-count changes (i.e. at thresholds), so most ticks touch only a few
  numbers.
- **Determinism via seeded RNG.** Any stochastic choice (L-system rules, RD seed, marking placement)
  draws from a PRNG seeded from the genome, so "random" variety is fixed per dragon and reproduces
  exactly. (JS: use a small seedable PRNG like mulberry32/xoshiro, not `Math.random`.)
- **Environment/care as curve modulators, not topology.** Feeding/care/training/biome should nudge
  *coefficients* and *thresholds* within genome-bounded ranges — e.g. good care → slightly larger adult
  size, earlier wing emergence, more saturated markings; a "fierce" training regime → higher snout/limb
  exponent, sharper horns; cold biome → thicker body curve. Keep env as multipliers on `a`, `b`, and
  `t_feature` so it *cannot* break the mesh or the monotonic direction — it only shifts *where on the
  cute↔cool spectrum* and *how fast*, exactly as the design doc specifies.

---

## Recommendation for our project

Adopt a **three-layer hybrid growth step**, all pure functions of `(genome, age, env)`:

**Layer A — Allometric proportion engine (the smooth cute→cool spine).**
For each continuous proportion in the design table (head:body, eye size/position, snout length, limb
length/leanness, body roundness, wing size) store a genome triple `{babyVal, adultVal, exponent b}`.
Evaluate `p = lerp(babyVal, adultVal, smoothstep(age^b))`. Differing `b` per feature gives true
allometry (big-headed big-eyed baby → lean long-snouted adult). All monotonic in age ⇒ guaranteed
cute→cool with no glitchy intermediate. This is the backbone and is ~pure arithmetic.

**Layer B — Threshold-gated parametric+stochastic L-systems (emergent hard parts).**
Horns, dorsal spines, tail frill, wing-finger struts each have an age threshold `t` and, past it, a
parametric L-system whose **derivation step-count = f(age)** so the part visibly extends/branches and its
segment taper sharpens. Blend in over a smoothstep window at `t` to avoid pops. Seed each L-system's
stochastic choices from the genome for unique-but-reproducible geometry. Turtle output → tapered
tube/prism segments merged onto the shared rig. Cheap (handful of segments), rebuilt only when
step-count changes.

**Layer C — Reaction-diffusion / differential-edge surface layer (markings & ruffles).**
A Gray-Scott ping-pong shader (existing Three.js implementations to adapt) generates the skin
marking mask; ramp feed/kill and domain contrast with age so soft baby skin gains saturated adult
markings ("markings emerge"). Optionally a small differential-growth polyline ruffles wing/crest edges.
Runs on GPU, decoupled from the tick loop.

**Body plan / rig:** follow Spore / No Man's Sky — a **parametric serpentine spine** (segment count +
bend from genome) as a **shared rig**, with Layer-B parts attached at named sockets and Layer-A
proportions retargeting the rig. This gives free-ish animation and endless variety at low cost, and fits
the ≤10-pets budget.

**Genome shape (serializable):** `{ spine:{segments,bend}, proportions:[{baby,adult,b}...],
features:[{type,threshold,lsysRules,seed}...], pattern:{feed,kill,seed}, envSensitivity:{...} }`. Store
genome + current age only; recompute everything. Breeding = crossover/blend of two genomes.

**Environment/care:** multiply Layer-A exponents/targets, Layer-B thresholds, and Layer-C contrast by
env-derived factors bounded by `envSensitivity`, so care shifts destination and pace but never breaks
topology or reverses the arc.

This gives a deterministic, incremental, serializable step that is a few hundred lines of JS plus one RD
shader, satisfies the monotonic cute→cool + emergent-features constraint, and is straightforward to scrub
with the testbed's age slider.

---

## Sources

**L-systems**
- Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants* / Algorithmic Botany papers — https://algorithmicbotany.org/papers/
- Hanan, *Parametric L-systems and their application to the modelling and visualization of plants* (1992 PhD) — https://algorithmicbotany.org/papers/hanan.dis1992.html
- ACM entry: Parametric L-systems and plant modelling — https://dl.acm.org/doi/10.5555/920650
- *L-systems in Geometric Modeling* (arXiv survey) — https://arxiv.org/pdf/1008.1664
- *Inverse Procedural Modeling of Branching Structures by Inferring L-Systems* (ACM TOG) — https://dl.acm.org/doi/fullHtml/10.1145/3394105
- CMSC 425 lecture notes: Procedural Generation: L-Systems — https://www.cs.umd.edu/class/fall2018/cmsc425/Lects/lect13-L-systems.pdf
- Interactive L-systems explainer — https://jsantell.com/l-systems/

**Differential growth & reaction-diffusion**
- N. Shelton, *Growth Algorithms* (differential growth, DLA, voxel reaction-diffusion, GPU notes) — https://nshelton.github.io/home/growth/
- Gray–Scott reaction-diffusion, Three.js/WebGL implementations:
  - colejd/Reaction-Diffusion-ThreeJS — https://github.com/colejd/Reaction-Diffusion-ThreeJS
  - amandaghassaei/ReactionDiffusionShader — https://github.com/amandaghassaei/ReactionDiffusionShader
  - Jason Webb, Reaction-Diffusion Playground — https://jasonwebb.github.io/reaction-diffusion-playground/
  - Mike Bostock, Gray–Scott (Observable) — https://observablehq.com/@mbostock/gray-scott-reaction-diffusion
- *Pattern formation in the Gray–Scott model* (ScienceDirect) — https://www.sciencedirect.com/science/article/abs/pii/S1468121803000208
- *Turing patterns from differential growth* (code) — https://github.com/chrisk27/growingdifgrow-trial
- *Turing patterns & tissue growth in long-bone development* (arXiv) — https://arxiv.org/pdf/1309.0226

**Allometry / morphogenesis / neoteny**
- *Multi-scaling allometry in human development, mammalian morphology, and tree growth* (Nature Sci. Reports 2024) — https://www.nature.com/articles/s41598-024-69199-5
- Neoteny overview — https://grokipedia.com/page/Neoteny
- Allometric growth (definition & examples) — https://study.com/academy/lesson/allometric-growth-definition-example.html
- *Static morphogen scaling enables proportional growth* (axolotl limb, bioRxiv) — https://www.biorxiv.org/content/10.1101/2025.02.14.638295.full.pdf
- *Allometry of cell types during animal growth and degrowth* — https://journals.biologists.com/dev/article/151/4/dev202790/344017/

**Agent-based / creature growth prior art**
- Karl Sims, *Evolved Virtual Creatures* (1994) — https://www.karlsims.com/evolved-virtual-creatures.html ; Wikipedia — https://en.wikipedia.org/wiki/Karl_Sims
- *Regenerating Soft Robots through Neural Cellular Automata* (arXiv) — https://arxiv.org/pdf/2102.02579
- Christo, *Procedural Creature Generation and Animation for Games* (MSc, covers Spore & No Man's Sky) — https://nccastaff.bournemouth.ac.uk/jmacey/MastersProject/MSc22/01/ProceduralCreatureGenerationandAnimationforGames.pdf
- *A Look At How No Man's Sky's Procedural Generation Works* (Kotaku) — https://kotaku.com/a-look-at-how-no-mans-skys-procedural-generation-works-1787928446
