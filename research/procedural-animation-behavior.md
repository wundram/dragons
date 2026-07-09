# Procedural Animation & Behavior for the Dragon Explorer

Implementation-ready proposal for making the generated dragons **move**: skeletal posing on the existing fixed-topology rig, morphology-adaptive locomotion (walk/run for legged plans, undulation for the snake, flapping flight for wings), secondary spring motion, and a behavior state machine covering **resting, roosting, standing, posturing, begging, playing, walking, running, flying** with smooth transitions and idle variety. Targets the code in `testbed/src/` (`generator.js` skeleton, `field.js` skin weights, `features.js`/`face.js` layered meshes, `app.js` loop).

## TL;DR (5 bullets)

- **Make the rig live with ~zero new math:** build a `THREE.Bone` tree from `group.userData.skeleton` (world `pos` → local translations), swap the body `Mesh` for a `SkinnedMesh` — the geometry **already carries `skinIndex`/`skinWeight`** from the field-softmax pass; `Skeleton.bones` just has to be ordered to match `geometry.userData.boneNames`. Bind once in the rest pose (`skeleton.calculateInverses()`), then drive bone quaternions **manually every frame** (no `AnimationMixer` for procedural layers). Layered meshes (head/face group, finger/toe capsules, features, wing membrane) follow via `bone.attach(...)` or rigid one-bone skin weights on the same skeleton. One critical subtlety: **re-root the animation hierarchy at the pelvis (`spine_20`)** with head-ward bones pivoting at their trunk-side joints — skinning only uses world-matrix × bind-inverse, so re-parenting is free and it makes "bend the neck" bend the *neck*, not the whole trunk.
- **Solve varying morphology the Spore way, scaled down:** behaviors are authored as **morphology-independent goals** ("foot at X", "look at Y", "spine curve C") and realized by per-body-plan procedural controllers + analytic two-bone IK, exactly the architecture of Hecker et al.'s Spore retargeting (SIGGRAPH 2008) and Ubisoft's IK Rig (GDC 2016). At bake time derive **continuous body-plan descriptors** from the skeleton (`hindLeg`, `foreLeg`, `wing`, `serpent`, `graspArm` ∈ [0,1]); controllers are *weighted by descriptors*, so quadruped→snake is a continuous blend, mirroring the generator's "archetypes are attractor regions" philosophy.
- **Locomotion = phase-oscillator gait engine + IK feet; the snake is a first-class citizen:** a global gait phase drives per-leg footfall offsets from a gait table (lateral-sequence walk, trot, gallop, biped hop), stance feet **pinned to the ground plane**, swing feet on arcs to predicted landings, legs solved with analytic 2-bone IK (upper/lower → foot). The limbless plan uses **lateral undulation** — a traveling sine wave of local yaw down `spine_00..23`/`tail_00..11` (`θᵢ = A(sᵢ)·sin(k·sᵢ − ωt)`) — and the same wave at low amplitude gives every dragon tail sway and the eastern dragon its "swimming-in-air" flight. Wings flap on a wingbeat oscillator with per-joint phase lag (shoulder leads, finger0 spar lags, membrane trails via springs), blending flap↔glide.
- **Layered pipeline + two-level behavior brain:** per frame: rest pose → **behavior posture targets** → **locomotion/flight controllers** → **gaze/head-look** → **breathing** → **spring-damper secondary motion** (tail tip, ears, barbels, membrane trailing edge) → face rig. Behaviors are a small FSM (per Anguelov's AI/animation separation-of-concerns): behavior states emit a declarative `MotorGoal` (stance, speed, head target, wing mode, pose overlays, face emotion); the motor layer realizes it and cross-fades pose layers over 0.3–0.8 s. Idle variety and behavior choice come from a **seeded PRNG** (genome hash ⊕ seed) → deterministic, replayable showcase.
- **Fidelity tiers on the same bones:** Explorer runs the full runtime stack (IK, springs, FSM). The MC tier **bakes** the same controllers headless — sample per-bone rotations at ~12 Hz per (behavior × body-plan class) into keyframe clips bound to the stable bone names → GeckoLib/Bedrock animation JSON; no runtime IK in the mod. **Build order:** (0) SkinnedMesh conversion + manual pose API + pose-sheet gallery, (1) walk gait + undulation, (2) flight + springs, (3) behavior FSM + gaze/breathing/idle, (4) MC bake.

---

## Findings

### 1. Runtime `SkinnedMesh` from a generated skeleton (Three.js mechanics)

Three.js supports fully programmatic skinned meshes; the docs' `SkinnedMesh` page shows exactly our situation — hand-built geometry, hand-built `skinIndex`/`skinWeight` attributes, a `Bone` hierarchy, `new Skeleton(bones)`, `mesh.add(rootBone)`, `mesh.bind(skeleton)`. Key facts verified:

- **Bind matrices are computed for us.** `Skeleton.calculateInverses()` fills `boneInverses` from the bones' *current* world matrices; `SkinnedMesh.bind(skeleton)` calls it when the inverses array is empty. So: build the bone tree in the generator's rest pose, add it under the mesh, bind once, *then* start rotating. ([Skeleton docs](https://threejs.org/docs/pages/Skeleton.html), [SkinnedMesh docs](https://threejs.org/docs/pages/SkinnedMesh.html))
- **`skinIndex` is an index into `Skeleton.bones`**, not a name lookup. Our field pass writes envelope indices (`skinIndex[v] = envelopes[bi].boneIdx`, `field.js:348`) with the name mapping in `geometry.userData.boneNames`. Therefore `Skeleton.bones[i]` for `i < boneNames.length` **must be the bone named `boneNames[i]`**; non-envelope bones (fingers, toes, claws, girdle stubs with r≈0) are appended after. No attribute rewrite needed.
- **Skinning is hierarchy-agnostic.** The GPU path is `Σ wᵢ · boneMatrixᵢ · bindInverseᵢ · v`; only *world* matrices matter. This is what licenses re-rooting the animation hierarchy (below) without touching weights, and why a bone's rest *origin* can be placed anywhere (the bind inverse absorbs it).
- **`AnimationMixer` vs manual updates:** the mixer is a clip player. Every procedural-animation Three.js example (walk IK threads on the forum, the wiggle-bone/IK write-up) drives `bone.quaternion`/`bone.position` directly per frame and lets the normal `updateMatrixWorld` pass feed the skeleton's bone texture. Manual is the right base; the mixer becomes useful later only to *play baked clips* (MC-tier preview) and for `AnimationUtils`-style crossfade of baked poses. ([three.js forum — walk IK](https://discourse.threejs.org/t/help-with-walk-animation-using-ik-solver/17753), [wiggle bones + IK in Three.js](https://www.balazsfarago.dev/blog/wiggle-bone-inverse-kinematics))
- **Gotchas:** set `mesh.frustumCulled = false` or recompute a generous bounding sphere (posed vertices leave the rest-pose bounds); normalize weights (field.js already does); `SkinnedMesh` uses a float bone texture — ~100 bones is nothing; `Object3D.attach()` (not `add`) preserves world transform when parenting existing layered meshes under bones.
- **IK solvers available:** three.js ships `CCDIKSolver` (addon, works on SkinnedMesh) and there is `THREE.IK` (FABRIK). For 2-segment legs, **analytic two-bone IK** (law of cosines + pole vector) is simpler, exact, oscillation-free and is the standard for foot placement (ozz-animation's foot-IK sample: two-bone IK on hip/knee/ankle + aim IK for the ankle + downward raycast per foot). CCD is only worth it for the neck, and even there a simple "distribute aim rotation along the chain with falloff" is more stable than CCD. ([CCDIKSolver docs](https://threejs.org/docs/pages/CCDIKSolver.html), [ozz foot IK sample](https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/), [THREE.IK](https://github.com/jsantell/THREE.IK))

### 2. Prior art: procedural animation for *varying* morphology

- **Spore — the direct blueprint.** Hecker et al., *Real-time Motion Retargeting to Highly Varied User-Created Morphologies* (SIGGRAPH 2008): animations are authored against **no specific skeleton** — they record *goals* in a morphology-independent form (which "capability" moves, where end-effectors go relative to body frames, style curves), and at runtime the goals are resolved per-creature by an IK solver over whatever limbs the creature actually has. This is exactly our problem (genome-varying limb configurations, animations authored once), just smaller: we have ONE fixed bone name set, so "generalized" collapses to "parameterized by measured limb lengths/presence" — far easier than Spore's arbitrary graphs. ([paper page](https://www.chrishecker.com/Real-time_Motion_Retargeting_to_Highly_Varied_User-Created_Morphologies), [ACM](https://dl.acm.org/doi/10.1145/1360612.1360626))
- **IK Rig (Bereznyak, GDC 2016).** Ubisoft's runtime rig: motions are stored as compact goal trajectories on a simplified rig and re-solved by IK on any target skeleton at runtime, enabling terrain adaptation, prop interaction, and cross-skeleton reuse "at runtime with full artistic control". Validates the "authored goals + runtime IK" split for production quality. ([GDC Vault](https://www.gdcvault.com/play/1023279/IK-Rig-Procedural-Pose), [talk video](https://www.youtube.com/watch?v=KLjTU0yKS00))
- **Overgrowth (Rosen, GDC 2014).** Whole-game character animation from ~13 keyframes: sparse hand-authored *poses* + smart interpolation (cubic ease, overshoot), physics springs for secondary motion, procedural walk from two poses mirrored + phase. Lesson for us: **each behavior needs only 1–3 authored key poses** (in joint space, on the stable bone names) — the liveliness comes from the interpolation, springs, and layered noise, not from dense clips. ([GDC Vault](https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach), [summary](https://www.gameanim.com/2018/03/04/indie-approach-procedural-animation/))
- **Rain World (Jakobsson & Therrien, GDC 2016).** Creatures are "limbs + rules for using them" — no animation sheets at all; bodies are constraint-connected points, limbs individually IK'd to procedurally chosen grips. Proof that pure-procedural creatures can feel *more* alive than clip-driven ones; also a warning: they spent heavy iteration on tuning. We hedge by keeping authored key poses in the loop (Overgrowth-style) rather than going 100 % emergent. ([GDC Vault](https://www.gdcvault.com/play/1023475/Animation-Bootcamp-Rainworld-Animation), [video](https://www.youtube.com/watch?v=sVntwsrjNe4))

### 3. Gait generation & foot placement (legged plans)

- **Gait = phase offsets + duty factor.** Quadruped gaits are fully described by per-leg phase offsets of footfall within a cycle and the stance fraction (duty factor): lateral-sequence walk `LH 0, LF 0.25, RH 0.5, RF 0.75` at duty ≈ 0.65–0.75; trot = diagonal pairs `(LH,RF) 0 / (RH,LF) 0.5` duty ≈ 0.5; gallop = grouped ~`0, 0.1, 0.5, 0.6` duty ≈ 0.3–0.4; biped walk/run = `0 / 0.5`. Classical animal-gait references and the CMU footfall-optimization thesis give the tables and transition speeds; the UBC SIGGRAPH 2011 quadruped controller demonstrates walk→trot→gallop as parameter changes on one controller. Stride frequency scales with speed (`speed = strideLen × stepRate`, cap stepRate, then grow strideLen). ([Animator Notebook quadruped gaits](https://www.animatornotebook.com/learn/quadrupeds-gaits), [CMU CS-17-111](http://reports-archive.adm.cs.cmu.edu/anon/2017/CMU-CS-17-111.pdf), [Coros et al. 2011](https://www.cs.ubc.ca/~van/papers/2011-TOG-quadruped/paper.pdf))
- **Foot placement:** industry-standard runtime recipe — per leg: raycast down from the hip/ankle to find ground point+normal, plant the stance foot there (world-pinned, no slide), swing foot follows a lifted arc from lift-off point to a predicted landing (`hip projection + v·T_stance/2`, Raibert heuristic), solve hip–knee–ankle with two-bone IK, align foot to ground normal, and lower the pelvis so the *shortest* leg reaches (never stretch legs straight). ([ozz foot-IK](https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/), [foot-planting write-up](http://peyman-mass.blogspot.com/2015/06/foot-placement-using-foot-ik.html))
- Body-level motion is derived, not authored: pelvis/chest height = f(average stance-foot support), vertical bob at 2× step frequency, lateral sway toward the support diagonal, spine yaw "advance" of the shoulder girdle relative to hips during walk. This is the "physics drive the body after feet are decided" pattern from procedural-quadruped literature. ([trig-based procedural quadruped paper](https://arxiv.org/pdf/1404.2053))

### 4. Serpentine locomotion (the snake case)

Lateral undulation — the canonical snake gait — is a **traveling wave of lateral bending** propagating head→tail; snake-robot control implements it directly as per-joint sine references `θᵢ(t) = A sin(ωt − iβ) + γ` (the "serpenoid" curve): amplitude `A` sets waveform width, phase step `β` sets wavelength along the body, `γ` biases for turning. Forward speed is proportional to wave speed times a ground-interaction factor (in a stylized renderer: a tuned slip constant; anisotropic friction is what makes real snakes advance). Games implement the same thing as either per-joint sines or "the whole body follows a lagged path spline" (path-history steering). Both are cheap; per-joint sines fit our vertebra chain directly, and the spline-follow variant is the natural upgrade for sharp turns (body follows where the head went). ([snake locomotion overview](https://userweb.ucs.louisiana.edu/~brm2286/locomotn.htm), [underwater snake-robot gait study](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4679098/), [procedural snake rig write-up](https://www.joleanes.com/snake.html))

### 5. Flapping flight

Vertebrate wingbeat kinematics for animation: the cycle is **not** a rigid hinge — within one beat the wing flaps (shoulder), sweeps (fore/aft), and folds (wrist/finger flexion on the upstroke); stroke-plane tilts with flight speed (more vertical when cruising fast, more inclined/hovering-like when slow). Practical game implementations drive it with phase-shifted trig on the joint chain: shoulder leads, elbow/wrist lag ~60–90°, tip lags most — the lag alone produces the characteristic whip. Downstroke is the powered (slower, larger-amplitude, membrane taut) half; upstroke folds the wrist to reduce area. Larger flyers alternate **flap bursts with glides** (wings spread, slight dihedral, no oscillation) — an easy two-state blend. Body heave/pitch couples to the beat (rises on downstroke). ([Animator Notebook bird flight](https://www.animatornotebook.com/learn/bird-flight), [aerodynamics-based real-time bird animation](https://www.researchgate.net/publication/250274157_Real-time_Animation_of_Bird_Flight_Based_on_Aerodynamics), [procedural flapping test](https://bubblepins.com/blog/procedural-animation-my-flapping-wing-test))

### 6. Secondary / passive motion (springs)

The universal cheap solution is a **per-joint damped spring** (or Verlet point chain) driven by the primary pose: the animated pose provides the *target*, the spring state lags it. VRM's spring-bone spec, Unity's Dynamic Bone / open-source JigglePhysics, and Blender wiggle bones all converge on the same math: `vel += (target − cur)·stiffness·dt; vel *= damp; cur += vel·dt`, per joint, with max-angle clamping for stability; Verlet integration if you want the point-chain formulation (better energy behavior, same cost). Stability rules: clamp `dt`, clamp deflection, use exponential damping (`vel *= exp(−d·dt)`) so big frames don't explode. This covers tail tip lag, ear flop, barbels, dewlap, and the wing-membrane trailing edge for a few hundred floating-point ops per dragon. ([VRM spring-bone system](https://deepwiki.com/saturday06/VRM-Addon-for-Blender/4.2-spring-bone-physics-system), [JigglePhysics (Unity, Verlet)](https://github.com/naelstrof/JigglePhysics), [jiggle-physics implementation guide](https://www.wayline.io/blog/jiggle-physics-implementation-guide), [wiggle bone in Three.js](https://www.balazsfarago.dev/blog/wiggle-bone-inverse-kinematics))

### 7. Behavior architecture (FSM + layers + blending)

- **Separate the brain from the body.** Anguelov's *Separation of Concerns Architecture for AI and Animation* (Game AI Pro 2): AI/behavior decides *what* (goals/parameters), an animation controller decides *how* (poses); they communicate through a narrow declarative interface. This prevents behaviors from directly poking bones and keeps controllers reusable across body plans — precisely what our morphology adaptation needs. ([chapter PDF](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter12_Separation_of_Concerns_Architecture_for_AI_and_Animation.pdf))
- **State machines for discrete modes, continuous blends within a mode.** Best practice across engines: an FSM manages discrete states (rest / stand / locomote / fly), each state internally blends continuously (walk↔run by speed, flap↔glide by airspeed); transitions are cross-fades (~0.25 s typical; longer for big posture changes), with **phase-synchronized** blending between cyclic states (walk→run keeps gait phase) and immediate blending for non-cyclic ones. Layers/masks put independent motion on top: gaze/head on a neck mask, breathing additive on the trunk, face independent. ([state-machine patterns](https://mocaponline.com/blogs/mocap-news/animation-state-machine-design-patterns), [blend trees guide](https://mocaponline.com/blogs/mocap-news/animation-blend-tree-guide), [Animancer layers](https://kybernetik.com.au/animancer/docs/manual/blending/layers/))
- **Idle variety** = a base idle loop + randomly scheduled micro-actions (weight shift, look-around, stretch, scratch) blended additively — cheap and dramatically improves "aliveness"; the scheduling should be seeded for determinism in our case.

---

## Proposed system for our project

### A. Rig instantiation — `SkinnedDragon` (new module `testbed/src/anim/rig.js`)

`upgradeToSkinned(dragonGroup)` runs once after `generateDragon()` and converts the static group into an animatable rig. Steps:

1. **Build the `THREE.Bone` tree** from `userData.skeleton`, **re-rooted at the pelvis**:
   - Animation root = `spine_20` (`HIP_IDX` — the hip vertebra; hind limbs and tail anchor here). Its `Bone` sits at world `P[20]`.
   - **Tail-ward** (`spine_21..23`, `tail_00..11`, `hipGirdle`, hind-limb chains): stored parenting, bone origin = stored `pos` (capsule head). Rotating `tail_03` pivots at its head and carries the rest of the tail — correct as-is.
   - **Head-ward** (`spine_19` down to `spine_00`, then `skull → snout/jaw`, `shoulderGirdle` + fore-limb chains under `spine_06`): parent order reversed (`spine_20 → spine_19 → … → spine_00 → skull`), and each reversed vertebra bone's origin is placed at its capsule's **trunk-side end** (`spine_i` bone origin = `P[i+1]`). Rationale: capsule *i*'s skin is weighted to bone `spine_i`; pivoting that bone at `P[i+1]` makes "rotate `spine_i`" swing the head-side of the body about the joint while the trunk stays put — i.e. neck bends bend the neck. **Skinning is unaffected by any of this** because the bind inverses (computed after assembly, in rest pose) absorb both parenting and origin choice; the stored `userData.skeleton` (used by geo.json export and the feature grid) is untouched.
   - Local `Bone.position` = own origin − parent origin (parent space); local rotations identity — matching the current translation-only rest state.
2. **Order `Skeleton.bones`** as `geometry.userData.boneNames` (so existing `skinIndex` values are valid), append all non-envelope bones after, `boneByName` map exposed.
3. **Swap body mesh → `SkinnedMesh`** (same geometry/material), `add(rootBone)`, `bind(skeleton)` in rest pose, `frustumCulled = false`.
4. **Attach layered meshes:**
   - `head` group (face rig, tusks, barbels): `skullBone.attach(head)` — the whole expressive face rides the skull bone; `setDragonFace` keeps working unchanged.
   - Finger/toe/claw capsules (`appendages` group): each capsule already corresponds to exactly one bone → `bone.attach(mesh)` per capsule (store `boneName` in each capsule's `userData` at build time — one-line generator change in `renderBoneCapsule` callers).
   - **Features** (spikes/sail/feathers/scutes — merged meshes with `userData.featureCells[].boneName`): rebuild the merged geometry with **rigid skin attributes** (each feature's vertex range gets `skinWeight = 1` to its tagged bone) and render as `SkinnedMesh` on the same skeleton. Requires `features.js` to record per-feature vertex ranges while merging (small change). Fallback if deferred: leave features unskinned (they'll float on big poses) — acceptable for phase 0 only.
   - **Wing membrane:** the sheet is generated by interpolating between known control points (`socket/elbow/wrist/tips/hipAnchor`, `generator.js` wing spec). Record the interpolation as skinning: each membrane vertex gets weights = its **construction lerp coefficients** over the bones owning those control points (`foreX_upperArm/_foreArm/_wrist/_finger*`, `hipGirdle`) — the same "provenance, not solver" trick as the body field. `SkinnedMesh` on the shared skeleton. The trailing edge additionally gets spring lag (layer 5).
5. Return an **`AnimRig`** handle: `{ skeleton, boneByName, restPose (per-bone rest quaternion + restDir), setLocalQuat(name,q), aimBone(name, worldDir, twist), resetPose(), dispose() }`.

**Joint-space convention (important):** rest local rotations are identity, so bone axes are *not* aligned to bone direction. Every controller works with per-joint **`restDir`** (unit `tail − pos` in parent space, precomputed): a "swing" pose is `q = setFromUnitVectors(restDir, desiredDir)`, twist is a rotation about `restDir`. The pose API exposes `aim(name, dirParentSpace)` and `swingTwist(name, swing, twist)` so behavior code never touches raw axes.

### B. Animation pipeline — ordered layers over a shared `PoseBuffer`

`AnimationController.update(dt)` (fixed 60 Hz accumulator; render interpolation optional) composes layers into a `PoseBuffer` (per-bone quaternion + weight, plus root pos/yaw on the dragon `Group`), then writes bones once:

| # | Layer | Writes | Notes |
|---|---|---|---|
| 0 | Rest pose | all | identity quats (the generator's built pose) |
| 1 | Behavior posture | spine, limbs, wings, tail | slerp toward the state's authored key pose(s) |
| 2 | Locomotion (gait ∥ undulation ∥ flight) | limbs + spine + root motion | weighted by body-plan descriptors & behavior |
| 3 | Gaze / head-look | last 4 neck vertebrae + skull | aim distributed with falloff (0.12/0.18/0.25/0.45), clamped ±60° yaw ±40° pitch |
| 4 | Breathing | trunk vertebrae + skull | additive sine ±0.5–1° pitch across `spine_08..18` + root-height bob, 0.15–0.6 Hz by behavior |
| 5 | Secondary springs | tail_04..11, ears, barbels, membrane trailing joints, dewlap | damped springs chasing the layer-4 output |
| 6 | Face | face rig params | drives existing `setDragonFace` (emotion per behavior) + saccades/blinks |

Blending: layers 1–2 crossfade by per-layer weight during behavior transitions (0.3–0.8 s smoothstep); cyclic→cyclic transitions carry the gait phase (walk→run keeps footfall continuity). Layers 3–5 are always-on (weights modulated by behavior, e.g. resting lowers gaze range and spring stiffness).

### C. Morphology adaptation — `BodyPlan` descriptors (`anim/plan.js`)

Computed once per bake from skeleton + phenotype (pure, deterministic):

```js
{
  hindLeg,   // clamp01(hind leg length / standing torso height)
  foreLeg,   // forelimb-as-leg score: armLength high, membrane low, fingers short
  wing,      // finger0 length × wingMembrane × budWing
  graspArm,  // long fingers + low membrane + short arm (T-rex grasper)
  serpent,   // 1 − max(hindLeg, foreLeg)·k  → 1 for the limbless snake
  stance,    // argmax label: 'quadruped' | 'biped' | 'serpent' (+ knuckleWalk flag
             //   when wing>0 && foreLeg mid — crawler-flyer walks on wrists)
  standHeight, strideLen, stepRate0, footHome[leg], poleDir[leg], wristPivot[side]
}
```

Controllers consume the *continuous* values: undulation amplitude scales with `serpent`; the gait engine activates per leg (a wyvern runs biped gait on hind legs only; a drake runs quadruped; the crawler-flyer substitutes the wrist/knuckle as the fore contact point per `limb-and-wing-architecture.md`); flight uses flapping when `wing` is high and full-body undulation ("cloud-swimming") when an eastern/snake plan flies. Mid-genome bodies get mixtures automatically — no case explosion, and it matches the generator's continuous-attractor design.

### D. The controllers

- **Gait engine (`anim/gait.js`):** global phase `φ += stepRate·dt`; per-leg phase = `φ + offset[gait][leg]`; gait table `{walk, trot, gallop, bipedWalk, bipedRun}` with duty factors (0.7/0.5/0.35/0.62/0.4). Stance: foot world-pinned at its plant point (flat stage `y=0` now; raycast later). Swing: cubic arc lift-off→landing, landing = `footHome projected ahead by v·T_stance/2`. Two-bone analytic IK (`upper`,`lower` → `foot` target; pole = `poleDir`, knees back-fore / elbows back), ankle aim so the foot sole stays flat. Body: pelvis height from support feet (crouch to the shortest reach), 2×-frequency bob, lateral sway, shoulder-vs-hip counter-yaw, neck stabilization (head counter-rotates half the trunk motion). Turning: root yaw rate + inside-leg stride shortening.
- **Undulation (`anim/undulate.js`):** per-vertebra local yaw `θᵢ = A·env(sᵢ)·sin(2π(sᵢ/λ) − ωt) + turnBias`, `sᵢ` = normalized arc position over `spine_00..tail_11`, envelope small at neck → max mid-body/tail. Ground locomotion: root advances `v = c·ω·λ·A` along heading (tuned slip constant `c`); the same module at small `A` runs as the ever-present **tail-sway idle** for every dragon, and as full-body flight for `serpent` flyers (vertical wave component added, `env` shifted tail-ward).
- **Flight (`anim/flight.js`):** wingbeat phase `ψ`; joint targets = trig with per-joint lag (shoulder swing = primary flap ± sweep; wrist/finger0 fold on upstroke, extend on downstroke; downstroke occupies ~60 % of the cycle). Sub-modes blended by a continuous `flightState`: **takeoff** (crouch → leap impulse + max amplitude/frequency), **cruise flap**, **glide** (spread + dihedral, ψ frozen), **hover/flare** (steep stroke plane, body pitched up ~40°, used for landing and for `begging`-in-air showpieces), **land** (flare + hind-leg reach + touchdown crossfade into stand). Body heave/pitch coupled to ψ; root follows a behavior-supplied path (circles/figure-8s over the stage). Membrane billow: trailing-edge spring row + a small cyclic bulge scalar passed to the membrane material/vertices later (optional polish).
- **Gaze (`anim/gaze.js`):** target = camera, a wander point, or another dragon; per-frame damped aim of skull + falloff distribution over `spine_00..03`; saccade timer for eye rig (`pupilX/pupilY`), blink scheduler (`eyeOpen` dips), both seeded.
- **Springs (`anim/springs.js`):** per-chain damped angular springs (target = pre-spring pose): tail chain (stiffness rising toward the root, so the tip lags ~0.15–0.3 s), ear pivots (uses the existing ear pose params as the *target*, spring adds flop), barbels, membrane trailing joints. `vel += (target⊖cur)·k·dt; vel *= exp(−d·dt); cur = cur ⊕ vel·dt`, deflection clamped (≤ 35°). Verlet point-chain upgrade only if the angular version reads too stiff on the tail.

### E. Behavior FSM (`anim/behaviors.js`)

Two levels, per the separation-of-concerns pattern:

- **Behavior layer** (the brain): states = the 9 behaviors + `takeoff/land` connective states. Autonomous mode picks the next state by seeded weighted choice with min/max dwell times and a legal-transition graph (`rest ↔ stand ↔ {posture, beg, play, walk}`, `walk ↔ run`, `stand → takeoff → fly → land → stand`, `roost` entered from `land` or `stand`). Scripted mode (UI/gallery) sets states directly. Each state emits a **`MotorGoal`**: `{ stanceMode, speed, pathOrTarget, wingMode, poseOverlay(s), faceEmotion, gazeMode, breathRate, springMood }`.
- **Motor layer**: maps `MotorGoal` → layer weights/parameters and runs the pipeline. Transitions crossfade layer 1–2 weights over the state pair's blend time; cyclic pairs sync phase.

Per-behavior realization (all on the stable bone names; key poses authored once in joint space and scaled by `BodyPlan`):

| Behavior | Realization |
|---|---|
| **standing** | neutral stance key pose (legs from IK at `standHeight`), weight-shift micro-action every 4–10 s (pelvis lateral offset + re-plant one foot), gaze active, breathing 0.25 Hz. Snake: coiled-neutral pose (spine spiral) + slow wave idle. |
| **resting** | lie-down transition (pelvis to ground, legs folded key pose, spine lateral curl, tail wraps body — a parametric spiral over tail bones), head lowered; breathing 0.15 Hz amplitude ×2; gaze range narrowed; occasional ear flick / head reposition micro-actions; eyes half-close via face rig. |
| **roosting** | perch pose on the stage prop (feet gripped via toe-curl pose, body upright, wings cloaked = folded key pose with membrane slack), head tucks back 30 % of the time; one-leg variant as a micro-action for birds-like plans. |
| **posturing** | display key pose: chest raised (front IK extends / neck S-curve), wings half-spread (flight layer at ψ frozen, amplitude 0.5), sail/spike bones erect if present, ears perked (`earPerk` → 1), tail raised & slow-lashing (undulation A up, ω down), jaw slightly open, brows down (`browAngle`) — reads "impressive/threat". |
| **begging** | sit-back key pose (pelvis low over hind feet, torso up ~45°), forelimbs raised (grasper arms paddle in small circles — timed sine overlay), head toward camera/user target with max gaze weight, mouth ajar + high brows + wide pupils (cute preset), fast tail wag = undulation on tail only, high ω low λ. |
| **playing** | loop of scheduled micro-sequences: play-bow (front lowered via fore IK, rear up, tail wag), pounce (crouch → ballistic hop of the root with legs tucked, land recovery), tail-chase (walk gait at max turn bias for 1–2 turns). Sequence chosen seeded; face = excited preset. |
| **walking** | gait engine, `speed` 0.3–0.7 of max, gait per plan (quadruped lateral walk / biped walk / serpent undulation), gaze wanders. |
| **running** | gait table switch (trot→gallop or biped run or fast undulation: A↑ ω↑), stride lengthens, spine flex-extend overlay for gallop (dorsal wave on `spine_08..20`), breathing fast. |
| **flying** | flight controller; behavior supplies a path (orbit / lazy-8 / ascend-glide-descend), alternates cruise-flap and glide by seeded timer; serpent plans use cloud-swimming; ends with `land`. |

**Determinism:** every stochastic choice (behavior selection, micro-action timers, saccades, wander targets) draws from `mulberry32(hash(genome) ⊕ sessionSeed)`; with a fixed seed the whole performance replays exactly — needed for the gallery, A/B evals, and MC clip baking.

### F. Public API & integration (`anim/controller.js`, wiring in `app.js`)

```js
import { createAnimatedDragon } from './anim/controller.js';

// after generateDragon():
const animDragon = createAnimatedDragon(dragonGroup, {
  seed: 1234, autonomous: true, quality: 'explorer',
});
// render loop (app.js animate()):
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  animDragon.update(Math.min(clock.getDelta(), 0.1));
  controls.update();
  renderer.render(scene, camera);
}
// controls / gallery / harness:
animDragon.setBehavior('fly');            // scripted override
animDragon.setBehavior(null);             // back to autonomous
animDragon.pose.apply('posture_display'); // static key pose (pose-sheet gallery)
animDragon.rig.aimBone('skull', dir);     // low-level access
animDragon.getState();                    // { behavior, phase, ... } — survives rebuilds
```

- **Rebuild handling:** `rebuild()` in `app.js` regenerates the group on any slider change. The controller's *state* (`behavior`, gait phase `φ`, spring states, PRNG cursor) lives in a plain object keyed by bone names; on rebuild, `createAnimatedDragon(next, { resume: prev.getState() })` re-attaches seamlessly — bone names are identical for every genome/age, which is the whole point of the fixed topology. The age slider therefore scrubs a *moving* dragon.
- **Headless harness:** `update(dt)` is renderer-independent (only needs the group), so the existing screenshot/gallery harness can step time and render pose sheets or turntable GIFs for grok/Read evaluation.
- **Perf:** ~110 bones × quaternion ops + 4 analytic IK solves + ~30 spring joints ≈ well under 0.1 ms/frame/dragon on CPU; skinning is GPU. Dozens of simultaneous Explorer dragons are fine.

### G. Fidelity tiers

- **Explorer tier (runtime):** everything above, full IK/springs/FSM, marching-cubes skin.
- **Reduced tier (MC / perf):** a **bake pipeline** (`anim/bake.js`): for each (behavior × body-plan class {quadruped, biped, serpent, grasper}) run the controllers headless with a fixed seed, sample every bone's local rotation at 12–15 Hz for one loop (or a one-shot for transitions), quantize, and emit Bedrock/GeckoLib animation JSON keyed on the stable bone names. The mod plays clips only — no runtime IK/springs (springs and foot IK are *baked into* the samples). Rotations-only clips retarget across genomes within a class; residual foot slide is acceptable at voxel fidelity (option: bake 2–3 size buckets per class). A `quality: 'reduced'` mode in the Explorer plays the baked clips through `AnimationMixer` for previewing exactly what the mod will show.

### H. Phased build order (each phase renders + evals before the next)

1. **Phase 0 — SkinnedMesh + pose API + pose sheet.** `rig.js` (bone tree, re-rooting, bind, layered-mesh attach incl. membrane provenance weights), `PoseBuffer`, `aim/swingTwist` helpers, ~6 authored key poses (stand, lie, sit-beg, display, wing-fold, crouch). Deliverable: **pose-sheet gallery** (archetype × pose grid via the existing gallery harness) + a "wiggle test" (sinusoid on every joint) to validate weights/joints. *Success gate:* no skin tearing/candy-wrapper at ±40° bends on all 5 archetypes; grok/Read eval of the sheet.
2. **Phase 1 — Ground locomotion.** `plan.js`, `gait.js` (walk first: quadruped + biped), `undulate.js` (snake walk + universal tail idle), root motion + turning on the stage. *Gate:* no foot slide at 3 speeds; snake advances believably; mid-genome blend looks continuous.
3. **Phase 2 — Flight + secondary motion.** `flight.js` (takeoff/cruise/glide/land), `springs.js` (tail/ears/barbels/membrane). *Gate:* wyvern circuit take-off→orbit→glide→land without pops; membrane never inverts.
4. **Phase 3 — Behavior FSM + idle layers.** `behaviors.js`, `gaze.js`, breathing, micro-actions, autonomous mode + UI behavior picker; run/gallop; posturing/begging/playing/resting/roosting realized. *Gate:* 3-minute unattended "day in the life" capture reads alive; transitions smooth; deterministic replay.
5. **Phase 4 — MC bake.** `bake.js` → animation JSON; reduced-tier preview via `AnimationMixer`.

### I. Risks & fallbacks

- **Field-softmax weights too soft/rubbery at big joint bends** (first real stress test of the skinning): sharpen softmax temperature or clamp to top-2 bones in `field.js`; DQS only if candy-wrapper twist appears (three.js needs a shader patch for DQS — avoid unless forced).
- **Re-rooting bugs (off-by-one pivots)** — mitigated by the phase-0 wiggle test per joint; the joint-pivot rule is specified above precisely so it can be unit-tested (rotate `spine_03` → only head-side vertices move).
- **Merged feature meshes lack per-feature vertex ranges** → small `features.js` change; fallback: rebuild features as instanced meshes parented per bone.
- **IK pops when a limb shrinks mid-scrub (age slider)** → `BodyPlan` recomputes per rebuild and controller weights lerp over 0.3 s after resume.
- **Undulation ground-speed looks skatey** → switch to path-history steering (body follows the head's recorded path) — slightly more state, strictly better turns.
- **CCD-style neck solutions oscillate** → we deliberately use falloff aim distribution, not CCD; keep `CCDIKSolver` out of the hot path.
- **Behavior tuning time-sink (the Rain World lesson)** → keep authored key poses as the backbone (Overgrowth lesson: a handful of poses + good interpolation beats emergent everything); tune with seeded replays + grok/Read GIF evals.

## Sources

- Hecker et al., *Real-time Motion Retargeting to Highly Varied User-Created Morphologies* (Spore), SIGGRAPH 2008 — https://www.chrishecker.com/Real-time_Motion_Retargeting_to_Highly_Varied_User-Created_Morphologies · https://dl.acm.org/doi/10.1145/1360612.1360626
- Bereznyak, *IK Rig: Procedural Pose Animation*, GDC 2016 — https://www.gdcvault.com/play/1023279/IK-Rig-Procedural-Pose · https://www.youtube.com/watch?v=KLjTU0yKS00
- Rosen, *Animation Bootcamp: An Indie Approach to Procedural Animation* (Overgrowth), GDC 2014 — https://www.gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach · https://www.gameanim.com/2018/03/04/indie-approach-procedural-animation/
- Jakobsson & Therrien, *The Rain World Animation Process*, GDC 2016 — https://www.gdcvault.com/play/1023475/Animation-Bootcamp-Rainworld-Animation · https://www.youtube.com/watch?v=sVntwsrjNe4
- three.js docs: SkinnedMesh — https://threejs.org/docs/pages/SkinnedMesh.html · Skeleton (`calculateInverses`) — https://threejs.org/docs/pages/Skeleton.html · CCDIKSolver — https://threejs.org/docs/pages/CCDIKSolver.html
- three.js forum, walk animation with IK on SkinnedMesh — https://discourse.threejs.org/t/help-with-walk-animation-using-ik-solver/17753 · THREE.IK (FABRIK) — https://github.com/jsantell/THREE.IK · wiggle bone + IK in Three.js — https://www.balazsfarago.dev/blog/wiggle-bone-inverse-kinematics
- ozz-animation foot-IK sample (two-bone IK + raycast + pelvis correction) — https://guillaumeblanc.github.io/ozz-animation/samples/foot_ik/ · foot-planting write-up — http://peyman-mass.blogspot.com/2015/06/foot-placement-using-foot-ik.html
- Animator Notebook, *A Guide to Quadrupeds' Gaits* — https://www.animatornotebook.com/learn/quadrupeds-gaits · *Bird flight analysis for animation* — https://www.animatornotebook.com/learn/bird-flight
- Su, *Optimizing Footfall Patterns for Gait Transitions*, CMU-CS-17-111 — http://reports-archive.adm.cs.cmu.edu/anon/2017/CMU-CS-17-111.pdf
- Coros et al., *Locomotion Skills for Simulated Quadrupeds*, SIGGRAPH 2011 — https://www.cs.ubc.ca/~van/papers/2011-TOG-quadruped/paper.pdf · trig-based procedural quadruped animation — https://arxiv.org/pdf/1404.2053
- Snake lateral undulation: locomotion overview — https://userweb.ucs.louisiana.edu/~brm2286/locomotn.htm · serpenoid gait study — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4679098/ · procedural snake rig — https://www.joleanes.com/snake.html
- Wu & Popović-lineage aerodynamic bird animation — https://www.researchgate.net/publication/250274157_Real-time_Animation_of_Bird_Flight_Based_on_Aerodynamics · procedural flapping-wing test — https://bubblepins.com/blog/procedural-animation-my-flapping-wing-test
- Spring/jiggle secondary motion: VRM spring bones — https://deepwiki.com/saturday06/VRM-Addon-for-Blender/4.2-spring-bone-physics-system · JigglePhysics (Verlet, Unity) — https://github.com/naelstrof/JigglePhysics · implementation guide — https://www.wayline.io/blog/jiggle-physics-implementation-guide
- Anguelov, *Separation of Concerns Architecture for AI and Animation*, Game AI Pro 2 — http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter12_Separation_of_Concerns_Architecture_for_AI_and_Animation.pdf
- Animation state machines / blending / layers: patterns guide — https://mocaponline.com/blogs/mocap-news/animation-state-machine-design-patterns · blend trees — https://mocaponline.com/blogs/mocap-news/animation-blend-tree-guide · Animancer layers — https://kybernetik.com.au/animancer/docs/manual/blending/layers/
- Prior internal: `design/mission.md`, `design/rigging-and-skinning-recommendation.md`, `design/limb-and-wing-architecture.md`, `testbed/src/{generator,field,features,face,app}.js`
