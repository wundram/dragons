# Design principle: the cute→cool growth arc

**A dragon starts as a cute baby and grows into a cool, more aggressive-looking adult.** This is the emotional spine of the whole system and a hard constraint on the generator and growth function.

## What this means mechanically

The growth step function is not just "get bigger." As `age` advances, the generator must shift a bundle of **neotenous (baby-cute) features** toward **mature (cool/fierce) features**:

| Feature | Baby (cute) | Adult (cool) |
|---|---|---|
| Head : body ratio | large head | proportionate / smaller head |
| Eye size & position | huge, low, forward | smaller, higher, sharper |
| Snout | short, stubby | longer, defined |
| Limbs | short, chubby | longer, leaner, muscular |
| Horns / spikes / spines | nubs or absent | grown, sharp, pronounced |
| Wings | tiny, non-functional | large, defined membranes |
| Body curve | round, soft | angular, dynamic (serpentine/heroic) |
| Texture / color | soft, pastel-leaning | saturated, harder edges, markings emerge |
| Brow / eye expression default | wide, innocent | narrowed, confident/fierce (still expressive) |

Individual **genome traits** bias *where on the cute↔cool spectrum a given adult lands* and *how fast* the transition happens (e.g. a dragon that stays rounder/friendlier vs one that becomes very angular), but the **direction of travel with age is always cute → cool.**

## Implications for other tracks

- **Growth research (track 2):** the step function should support monotonic "aging" parameters that interpolate/allometrically scale features, plus rule-based emergence of new structures (horns, spikes, wing membranes) at growth thresholds. Allometric (non-uniform) scaling is central — babies aren't just small adults.
- **Parametric modeling (track 1):** the mesh generator must expose these features as continuously tunable so a single genome renders correctly at any age.
- **Faces (track 4):** the eye+brow rig must read "cute/innocent" at baby scale and "confident/fierce" at adult scale using the same components (bigger/lower/rounder eyes → smaller/higher/sharper; brow neutral pose shifts).
- **Testbed:** must expose an **age slider** so we can scrub the full arc and evaluate that every intermediate frame looks good and on-model, and a **genome/trait panel** to vary the destination.

## Success test

Scrub the age slider from 0→1 on a fixed genome: the silhouette should read unmistakably "cute baby" at the start and "cool adult dragon" at the end, with no broken/glitchy intermediate frames, and the face expressive throughout.
