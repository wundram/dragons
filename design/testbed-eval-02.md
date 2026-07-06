# Test-bed evaluation #02 — Steps 1–2 (skeleton + implicit field, SMOOTH skin)

Evaluated the merged Step-1 (fixed skeleton + allometric growth) and Step-2 (implicit field + marching cubes) via the new gallery generator (`testbed/tools/gallery.mjs`) — age strips, a 12-cell random variation grid, and a wyvern mutation tree — plus hero shots. Scored by Claude Read (primary) + `tools/grok.sh eval` (second opinion). Galleries in `testbed/out/gallery2/` (gitignored).

## Verdict: major step up. Architecture is validated; now it's tuning.

- **"Same-ish" is solved.** The parametric-emergent genome yields genuinely distinct body plans — limbless serpentine snakes, wing-budding wyverns, four-legged quadrupeds, long-bodied eastern dragons — from one shared 59-bone skeleton.
- **"Larval/segmented" is solved.** The Step-2 implicit field produces one continuous organic body; limbs melt into the torso. Grok geometry score rose 4 → 7 vs eval-01.
- **Cute→cool aging reads well.** The wyvern age strip is a smooth, on-model progression: big-headed huge-eyed round baby → snout emerges → wings bud (~age 0.6) → leaner saturated adult.
- **Breeding tree works.** Root → 3 children → 9 grandchildren shows coherent family resemblance with real divergence — validates genome crossover/mutation as the breeding mechanic.
- **Perf is comfortable.** Field + marching cubes ≈ 5–37 ms/regenerate (fieldRes 64), 2–10k tris.

## Cross-validated tuning backlog (feeds the tuning phase)

Ordered by impact; items 1–2 flagged by every evaluator across both eval rounds.

1. **Brows read as floating sticks/antennae (P0).** The thick dark bar brows don't integrate. Fix: replace with proper soft *arched* brow shapes per the face-research spec (`research/expressive-faces.md`), sitting closer to the eyes; reduce prominence on the big baby head.
2. **No mouth (P1).** Face lacks a mouth/jaw line — hurts expressiveness and "dragon" read. Add a simple mouth line / lower-jaw seam (the skeleton already has a `jaw` bone to hang it on).
3. **`robustness` range too wide (P1).** Random sampling produces beach-ball bodies with tiny heads (variation #1/#3/#11, tree g2.2). Clamp the trait range and/or soften its allometric exponent so girth stays in a believable band.
4. **Low-poly facets on the smooth mesh (P2).** Marching cubes at fieldRes 64 shows facets. Options: smoother vertex normals, modest res bump, or a light Laplacian smoothing pass — balance against perf.
5. **Hind-leg absorption at high `smoothK` (P2).** A robust quadruped's short legs get largely swallowed by the belly (Step-2 agent flagged; `smoothK` tunable). Consider per-region smoothK or slightly longer/thicker default legs.
6. **Wing membranes missing (feature, deferred).** Wings are bare spar capsules; they read as thin antennae at adult. Membrane sheet between spars is a later step.
7. **Square-viewport auto-frame crops the body (harness P2).** `render.mjs --hideui` at square aspect frames too tight (grok mistook a hero baby for a "disembodied head"). Fit to horizontal FOV / add margin for non-16:9 sizes.

## Notes
- Face rig correctly stays a separate layered object (not swallowed by the field); eyes with catch-lights read as cute — the brows are the weak part, not the eyes.
- The tuning items are exactly the human+AI-feedback loop from the project plan; none are architectural. Address during the tuning phase after Step 3.
