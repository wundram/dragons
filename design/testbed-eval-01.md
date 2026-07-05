# Test-bed evaluation #01 — placeholder generator

First visual verification of the merged Three.js harness, rendered **headless** (Chrome extension was unavailable) via `testbed/tools/render.mjs`, scored by Claude Read (primary) + `tools/grok.sh eval` (second opinion). Renders in `testbed/out/` (gitignored).

## Verdict: harness + cute→cool arc WORK. Placeholder is crude but proves the architecture.

- The **Age slider drives a real, correct cute→cool transformation.** Age 0 = big round head, huge eyes, stubby round body (cute). Age 1 = longer snout & body, four legs, emerged back-spikes and membrane wings, expressive face (cool direction). Bounding box grows [3.2, 2.8, 5.0] → [5.7, 4.3, 7.9].
- The **face rig renders** at adult scale: white sclera + black pupils + brow bars, readable as eyes.
- The **feature-emergence mechanic works**: spikes and wings are absent/tiny young and appear with age.
- The end-to-end **eval loop works**: page → headless render → Claude Read + grok vision score. This is now the canonical eval path (`testbed/tools/render.mjs`, see its header).

## Grok second-opinion scores (1–10)

| | geometry | style | expressiveness | appeal |
|---|---|---|---|---|
| Baby (age 0) | 4 | 3 | 4 | 2 |
| Adult (age 1) | 4 | 5 | 2 | 2 |

Note: grok's vision is coarser than Claude's here (it works off a text description; it missed the baby's body/legs and mislabeled colors). Treat it as a **second** opinion; Claude Read is primary (per AGENTS.md §5). Where the two agree, confidence is high.

## Prioritized defect backlog (feeds Phase 2)

Both evaluators independently converged on these. Ordered by impact:

1. **Detached "floating bar" horns on the baby (P0 — clear glitch).** At age 0 the horns render at full size and float above/behind the head, disconnected. Fix: gate horn size/emergence to age (nubs or absent young) and anchor to the head bone. *Both Claude and grok flagged this as the #1 baby defect.*
2. **Cross-eyed / misaligned pupils (P0 — kills expressiveness).** Adult pupils point in different directions and read "derpy," not intentional. Baby eyes are featureless black balls (no visible sclera/pupil). Fix: converge pupils on a look target; give the baby visible sclera + large pupil for cuteness. (Directly implements the track-4 face spec: age remaps the neutral rest pose.)
3. **Segmented body reads "caterpillar/larval," not muscular (P1 — the skin tension, live).** Grok explicitly called the stacked tapered cylinders with ring seams a "caterpillar/worm." This is real data on the box-per-bone vs tapered-skin question: the current tapered-segment skin needs either smoothing (subdivision/marching-cubes) or a redesign to read as a torso. **Evaluate a smoothed pass and a cuboid mode side-by-side.**
4. **Flat placeholder wings & spindly floating spikes (P1).** Wings are flat triangles with jagged edges; back-spikes are thin cylinders, some floating/unrooted. Fix: give wings a membrane between structured spars; root spikes with volume and attach to the spine bone.
5. **Flat-capped tube snout, no mouth/jaw/nostrils (P1).** Snout is an extruded cylinder with an octagonal flat cap. Fix: taper/round the snout tip and add a simple mouth line + nostrils.
6. **Featureless leg cylinders, no feet/claws; belly is an odd protruding white sphere (P2).** Cosmetic; address after silhouette.
7. **Faceting / low-poly hard edges (P2).** Acceptable for a placeholder; revisit with the skin decision.

## Harness polish items (Phase 2)

- `--hideui` letterboxes the canvas (app CSS grid reserves the panel column). Make the app reflow the canvas to full window when the panel is hidden, so clean creature-only shots don't need cropping.
- Add a "look target" so pupils converge; expose emotion presets to the render harness (flag exists, wire it to the app's dropdown reliably).

## What this unblocks

The architecture from `design/architecture-synthesis.md` is validated end-to-end in a runnable sandbox. Phase 2 is now: **replace the placeholder internals with the real skeleton + allometric growth + tagged-slot appendages**, working the P0/P1 backlog above, and run the **dual-skin (cuboid vs smoothed) side-by-side** to resolve the skin tension with real renders.
