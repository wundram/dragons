# Design decision: strict tetrapod — wings are a forelimb expression

**Rule: a dragon has at most FOUR limbs, from two girdles (shoulder + hip). Wings are NOT a separate fifth/sixth limb pair — they are one expression of the FORELIMB pair. The front pair is *either* legs/arms *or* wings, never both.**

## Why (the "wings AND arms trap")
The heraldic western dragon has four legs *plus* a separate wing pair = **six limbs (hexapod)**. No real tetrapod vertebrate has this; it requires an extra limb girdle and makes the skeleton hard to build, weight, and animate. We deliberately avoid it. Keeping strictly to a tetrapod bauplan (like a wyvern, a bird, or a bat) means:
- one shoulder girdle drives the front pair, one hip girdle the back pair;
- clean, reusable rigging and animation;
- anatomically grounded, so proportions read as a real creature.

## How the body plans fall out (parametric-emergent, tetrapod)
The FRONT pair has a **type**, the BACK pair is legs (or reduced). Suggested genome: replace the current independent `foreLimbDev` + `wingDev` with a **forelimb mode** (continuous or categorical) so wings and forelegs are mutually exclusive at the shoulder:

| Archetype | Front pair (shoulder) | Back pair (hip) | Notes |
|---|---|---|---|
| **Snake** | reduced/absent | reduced/absent | limbless serpentine |
| **Wyvern** | **wings** | strong legs | the natural default flyer (bird/bat plan) |
| **Quadruped / drake** | **legs/arms** | strong legs | walker; **no wings** (was the trap — fix it) |
| **Eastern** | small legs | small legs | elongated, mostly legless-looking; optional tiny wings only if they replace the forelimbs |

Implementation sketch: a `forelimbMode` trait (e.g. 0 = reduced, → leg, → wing) or a `forelimbIsWing` blend that routes the shoulder-girdle bones to either a leg chain or a wing-spar chain. `wingDev` becomes "how developed the forewing is" *within* wing mode, not an independent extra limb. Remove the separate always-present wing bones as a 3rd pair; the wing spars hang off the **shoulder girdle / forelimb root**.

## Consequences for the current build
- The Step-1 skeleton currently has forelimbs, hindlimbs, AND separate wing spars — so the **quadruped archetype carries both legs and wings (the trap)**. Fix during the wing-skinning work: fold wings into the forelimb slot; make quadruped a wingless drake; keep wyvern = wings-as-forelimbs.
- **Wing membrane still to do:** wings are currently bare spar capsules (no membrane). When we skin them (a sheet/membrane between the spars, excluded from the body field), do it under this tetrapod rule — the membrane spans the forelimb-wing, not a separate appendage.

## Status
Locked (2026-07-05, per user direction). Applies to the wing-skinning + limb-refactor task; the brows/mouth face pass is independent and proceeds first.
