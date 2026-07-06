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

## The unified bat-wing forelimb (LOCKED 2026-07-05, per user direction)

**One fixed forelimb topology expresses EVERY arm/wing/hand type — only bone lengths, finger development, and membrane amount vary. The skeleton itself never changes** (critical: stable topology is what lets animations survive growth re-bakes and keeps rigging reusable).

### Fixed topology (per side, both forelimbs)
`shoulderGirdle → upperArm → foreArm → wrist → { finger_0 (primary) , finger_1 … finger_3 (additional) }`

- Each finger is a short bone chain (2–3 phalanges). **Fixed max finger count = 4** (name them stably, e.g. `foreL_finger0_00…`); a genome just sets each finger's length (~0 = absent, short = claw/toe, long = wing spar) and claw size.
- **Wing leading edge = the bones from shoulder to the first (primary) fingertip.** The membrane fills behind that leading edge (trailing edge back toward the wrist/elbow and the body flank; bat-style it may also anchor to the hind leg / body).
- The old separate `wingL/wingR` spar bones are REMOVED — the wing *is* the forelimb (finger_0 is the main spar). This also removes the 6-limb "trap" structurally.

### Genome parameters (per forelimb; both sides mirror)
- `armLength` — shoulder→wrist (upper arm + forearm).
- `finger0Length` — primary finger / main wing spar (the leading-edge extension beyond the wrist).
- `fingerCount` or per-finger `fingerLength[i]` (i=1..3) — additional fingers: short ⇒ toes/claws, long ⇒ extra wing spars.
- `fingerSpread` — splay of the fingers.
- `wingMembrane` (0..1) — 0 = bare limb (arm/leg look), low = fringe along the leading edge, high = full sheet. Membrane is spanned per elongated finger, so multiple long fingers ⇒ multiple wing surfaces.
- `clawSize` — talon size at fingertips.
- Hind limbs keep `hindLegLength` + toed feet (`toeCount`, `clawSize`).

### The case table (all from the params above — ratios, not topology)
| Type | armLength | finger0 | other fingers | wingMembrane | walks on front? |
|---|---|---|---|---|---|
| **Vestigial / drake (quadruped walker)** | ≈ hindLeg | short | present (toes + claws) | fringe only | yes — used as a leg/hand |
| **Crawler + flyer** | — | ≈ hindLeg | some | full | yes — folds at wrist, knuckle-walks on the hand (wing midpoint) |
| **Bipedal flyer (wyvern)** | short | long | few / short | full | no |
| **Grasper (T-rex arms)** | short | huge fingers | big fingers | none / little | no — grasps |
| **Multi-wing** | — | several elongated fingers, each membraned | — | full × N | varies |

### Walking / folding (DEFERRED to rigging/pose)
Whether the front appendage bears weight, and the wrist-fold for knuckle-walking crawler-flyers, are **pose/animation** behaviors. Build the correct **rest-pose shape** now (spread); the fold + weight-bearing contact comes with the animation/pose work. Rest pose: put ground-walking forelimbs' hands near y=0; pure flyers hold the wing up/out.

### Membrane skinning
The membrane is a thin **double-sided sheet** spanning the leading-edge bones (arm + finger0, and any other long finger) to the trailing edge (wrist/elbow/body). It is **excluded from the body implicit field** (thin sheets don't voxelize/marching-cube well) and rendered as its own mesh. In **voxel/MC mode**: render the membrane as a thin (1-voxel) cuboid sheet or a flat quad layer — decide in the build; keep it cheap.

### Hind limbs
Stay legs ending in **toed feet with claws** (per earlier direction: "feet = some toes with talons"). Not wings; may anchor the membrane's inner trailing edge.

## Status
Locked (2026-07-05, per user direction). This unified-forelimb spec drives the wing/limb-refactor + membrane build. The brows/mouth face pass (done) was independent.
