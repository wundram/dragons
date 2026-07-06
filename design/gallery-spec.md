# Gallery feature spec

The gallery generates **montaged contact sheets of dragons** so human + AI evaluators (Claude Read primary, `tools/grok.sh eval` second opinion) can judge the aging arc, variation patterns, and (later) the rig. It is primarily a **headless render-harness capability** (`testbed/tools/gallery.mjs`, built on the existing `render.mjs` pattern + ImageMagick `montage`). Output: PNG contact sheets in `testbed/out/gallery/` (gitignored); promote keepers to `art/reference/`.

Each dragon is rendered by driving the live testbed page in headless Chrome (set `window.__testbed.genome`, drive the AGE slider, auto-frame, screenshot), exactly as `render.mjs` does. Reuse that machinery.

## The four gallery types

1. **Age strip** — the SAME genome rendered at a series of ages (e.g. 0, 0.2, 0.4, 0.6, 0.8, 1.0) in a horizontal strip. Purpose: judge the cute→cool growth arc — smooth, on-model at every frame, no glitchy intermediates. One row = one dragon aging.

2. **Variation grid** — MANY dragons at a fixed age (default adult, age 1), produced by **randomizing or continuously sweeping one or more seed/genome parameters**. Two sub-modes:
   - *sweep*: vary one named trait linearly across the grid (e.g. `neckLength` low→high), holding others fixed — isolates one trait's effect.
   - *random*: randomize the whole genome (or a named subset) per cell. Purpose: judge variety and that the trait space stays on-model.

3. **Mutation/breeding tree** — start from one root genome; produce a few (e.g. 3) mutated variations; for each of those, a few more; **2–3 iterations deep**. Render as a tree/tiered layout (root on top, generations below). Purpose: judge how variation compounds and whether breeding/mutation stays coherent. (Mutation = jitter genome traits; later this doubles as the breeding-crossover preview.)

4. **Pose sheet** *(DEFERRED until posing exists — Step 2 rig)* — the SAME dragon in a series of **predefined poses** (e.g. idle, walk-contact, rear-up, wings-open, roar/jaw-open, curl-sleep) in a grid. Purpose: judge the RIGGER — deformation quality, no collapsing/candy-wrapper joints, envelopes hold up under motion. Stub the CLI now with a clear `TODO: needs pose API`; wire it once bones can be posed.

## CLI shape (suggested)

```
node gallery.mjs age     --genome '<json>' --ages 0,0.2,...,1        --out ../out/gallery
node gallery.mjs variation --mode sweep --trait neckLength --n 12 --age 1
node gallery.mjs variation --mode random --subset body,head --n 12 --age 1
node gallery.mjs tree    --root '<json>' --fanout 3 --depth 2 --jitter 0.2 --age 1
node gallery.mjs poses   --genome '<json>'   # prints "not yet: needs pose API"
```

Each sub-command: render the cells (reusing render.mjs internals), then `montage` into a labeled contact sheet (title + per-cell captions like age/trait value). Emit the sheet path so the orchestrator can Read it and run `grok.sh eval`.

## Notes
- Use the existing archetype presets (`window.__testbed.ARCHETYPES` / exported `ARCHETYPES`) as convenient roots.
- Keep cells small (~300–400px) and grids capped (e.g. ≤16 cells) so sheets stay readable and fast.
- Deterministic where possible: accept a `--seed` for the random/mutation modes (vary by cell index) so galleries are reproducible.
