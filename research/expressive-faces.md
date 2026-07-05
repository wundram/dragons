# Research: Expressive cartoon eye + brow systems

Prior art for the Dragons face track: how animation/games get readable emotion from
eyes + floating brows, how steerable eyes are built, and how to make the sub-rig
face-agnostic and scalable from cute baby to cool adult (see
`design/cute-to-cool-arc.md`).

## TL;DR (5 bullets)

- **Eyes + brows alone are enough.** Simplified cartoon faces are *more* readable than
  realistic ones (McCloud's "amplification through simplification"; a 2016 study found
  cartoonized faces ~60% more accurately emotion-recognized than real faces). Animation
  practice (Osipa's *Stop Staring*, AnimSchool) treats eyes/lids/brows as the primary
  emotion channel — "eyebrows do the acting," and brow motion should *lead* head/body
  motion so the audience can't miss it.
- **A FACS-lite of ~6 scalar parameters spans the whole classic emotion set.** Human
  brow/eye expression reduces to a handful of FACS action units (AU1 inner-brow-raise,
  AU2 outer-brow-raise, AU4 brow-lower, AU5 upper-lid-raise, AU6/7 squint, AU43 close).
  For a cartoon rig these collapse to: eye openness, squint, pupil position/size, brow
  height, brow angle, brow curve (+ optional asymmetry for "voluntary" emotions like
  curiosity/suspicion).
- **The proven steerable-eye technique for stylized games is a texture/UV trick, not an
  eyeball simulation.** Wind Waker and Twilight Princess render eyes as flat layers
  slightly raised off the face and *slide/scale the pupil texture in UV space* to aim the
  gaze; lids are a tiny sprite/frame animation. Alternative: a (flattened) sphere with a
  geometric pupil driven by `lookAt` — trivially cheap and what we should use in the
  Three.js testbed. Gaze itself is gameplay-expressive (Wind Waker Link's eyes look at
  points of interest as a hint system — perfect for a pet).
- **Floating brows are established practice, not a hack.** Wind Waker's brows/eyes/pupils
  are separate meshes hovering slightly above the face (also dodges z-fighting); anime/
  toon rendering routinely draws brows through hair. Hovering brows detach us from face
  topology entirely: any head just needs two eye anchor points + normals.
- **Cute→cool falls out of *neutral-pose defaults*, not new components.** Kindchenschema:
  big low round wide-open eyes + high neutral brows read "baby"; smaller, higher,
  narrower eyes + lowered, angled brows read "fierce adult." Age remaps the rig's rest
  pose and scale; the emotion parameters stay identical.

## Findings

### 1. Why eyes + brows are enough (minimal-feature emotion)

- Scott McCloud's *Understanding Comics* principle — **amplification through
  simplification** — is the theoretical anchor: stripping a face to essentials
  *amplifies* emotional meaning; a circle + two dots + a line already reads as a face.
  Empirically, simplified/cartoon faces were recognized ~60% more accurately for emotion
  than the real faces they were morphed from (2016 study cited in i-Modes writeup).
- Jason Osipa's *Stop Staring* (the standard facial-rigging text) identifies **eyes,
  brows, and eyelids as the parts of the face most important to communicating
  emotion**, and warns animators spend too much time on brows and not enough on eyes —
  i.e. lids/openness and gaze carry at least as much as brow shape.
- AnimSchool's "Animating Eyebrows": brows should **lead** head/body movement (raise the
  brows *before* the action) so the audience registers the emotional beat; the **inner
  brow sections are more active/expressive than the outer**; and brows should visually
  connect with and match the shape of the eyes ("a line flowing into one another").
  Also: **involuntary emotions (surprise, fear) are symmetric; voluntary/cognitive ones
  (curiosity, doubt, suspicion) are asymmetric** — one raised brow = questioning. This
  motivates a single `browAsym` parameter.
- Pixar practice (e.g. Ratatouille's Remy, Turning Red's curvenet rigs) leans on brows +
  **pupil scaling** for emotion — pupils dilate for cute/appeal, contract to pinpricks
  for fear/shock.

### 2. FACS-lite for cartoon faces

The Facial Action Coding System decomposes expression into action units. The ones that
matter above the nose:

| FACS AU | Meaning | Cartoon-rig equivalent |
|---|---|---|
| AU1 | Inner brow raiser | `browAngle` toward "worried" (inner ends up) |
| AU2 | Outer brow raiser | `browHeight` up + `browCurve` up |
| AU4 | Brow lowerer | `browHeight` down, `browAngle` toward "fierce" (inner ends down) |
| AU5 | Upper lid raiser (wide eyes) | `eyeOpen` > neutral |
| AU6/AU7 | Cheek raise / lid tighten (squint) | `squint` (lower lid rises) |
| AU43 | Eyes closed | `eyeOpen` → 0 |

Classic emotion→AU mappings (iMotions FACS guide): anger ≈ AU4+5+7 (brows down+in, wide
tense eyes), fear/surprise ≈ AU1+2+5 (brows up, eyes wide; fear adds inner-brow-up
worry), sadness ≈ AU1 (inner brows up) + lids drooping, happiness ≈ AU6 (squint from
smiling). So ~6 scalars reproduce the standard set — this is exactly the "few parameters,
wide emotion range" property we want.

Key readability rules distilled from drawing/animation guides:

- **Brow height** = arousal/energy (high = surprise/fear/innocence; low = anger/
  determination/suspicion; flat middle = calm/neutral/unimpressed).
- **Brow inner-end direction** = valence of the tension (inner ends *down* = angry/
  fierce; inner ends *up* = sad/worried/pleading).
- **Brow curvature** = softness (round arc = gentle/happy/innocent; straight/kinked =
  hard, intense, "cool").
- **Eye openness** = arousal (wide = surprise/fear; droopy = sleepy/content; squeezed
  shut = effort/joy).
- **Squint (bottom-lid up)** = smile or scrutiny — combined with brow it disambiguates
  (squint + neutral brow = happy; squint + lowered brow = angry/suspicious).
- **Pupil size** = appeal dial (large = cute/adoring; tiny = shock/fear/menace).
- **Pupil position** = attention; averted-down = shame/guilt, up = pondering.

### 3. Steerable eyes: techniques

Four families of technique, all seen in shipped stylized games:

1. **Sphere (or flattened sphere) with geometric pupil + look-at.** The classic cartoon
   approach: eyeball mesh, pupil/iris as a darker cap; aim with a `lookAt`-style
   constraint at a gaze target. Rigmarole's writeup shows even pupil *scaling* can be
   done with pure skinCluster (game-engine-friendly, no blendshapes). For non-spherical
   squashed eyes, Blender stylized-eye tutorials use a lattice-deformed sphere with a
   tracking bone, or raycast-to-plane instead of naive lookAt (three.js forum reaches the
   same conclusion for squeezed eyes).
2. **Texture/decal eye with UV-offset gaze (the Zelda technique).** Wind Waker: 7 eye
   shapes, 6 eyebrows, 1 pupil texture as **separate meshes raised slightly above the
   face**; gaze = *shifting and scaling the pupil's UV coordinates*, not moving geometry.
   Twilight Princess refines it: two layers — sprite-animated eyelids (4-frame blink
   cycle 1→2→3→4→3→1) with alpha masking a higher-resolution iris layer whose UVs slide
   around for gaze. Cheap, crisp at low resolution, and the mask means lids of any shape
   "clip" the pupil for free.
3. **Dome/parallax shader eyes.** Fire-Face's eye-shader breakdown and UE4 stylized
   pipelines: flat-ish eye with fake refraction/parallax of the iris behind a cornea
   dome. Gorgeous up close; overkill for our view distances.
4. **Billboard/googly eyes.** Fully 2D sprite eyes that face the camera; the "googly
   eyes" toy model (Haslam) even gives pupils physics. Fun for accessories, but
   billboards fight with a 3D head at oblique angles — not recommended as the primary
   system.

**Gaze as behavior:** Wind Waker deliberately gave Link oversized eyes so they could
**track points of interest as a gameplay hint** (Miyamoto/Tezuka wanted a "reason" for
the big eyes; they rejected eye-beams in favor of gaze hints). Luigi's Mansion does the
same. For a dragon *pet*, eyes tracking the owner / food / threats is the single
highest-value idle behavior — it makes the creature feel alive even with zero other
animation.

**Readability at Minecraft distances:** Minecraft entities are few pixels tall on
screen. Practice from the modding scene (Entity Texture Features mod, "Just Expressions"
pack) shows blinking/emotion via **texture swaps** works down to 1×1/1×2-pixel eyes, with
half-closed intermediate frames for smoothness, plus emissive (glowing) eye layers for
visibility. Design implications: high contrast (dark pupil on light sclera), pupil ≥ ~1/3
of eye width, whole eye large relative to head, and expressions driven by *silhouette*
changes (lid line, brow angle) rather than subtle shading. The sclera itself is a
readability feature — it's why gaze direction is visible at all.

### 4. Floating brow systems

- **Precedent.** Wind Waker's brows are separate meshes hovering slightly above the face
  surface (which also solves z-fighting); anime/VTuber pipelines routinely render brows
  as detached layers drawn through hair (standard "brows-through-hair" toon technique).
  So "floating brow objects" is normal stylized practice — nobody reads it as a glitch;
  the brain fuses brow + eye into one feature.
- **Parameterization.** A brow is fully described for expression purposes by:
  **height** above the eye (arousal), **angle** — the tilt of the inner end vs outer end
  (fierce vs worried), and **curvature** (soft arc vs hard bar). Everything the drawing
  guides list (furrowed, arched, flat, raised-one-brow) is a point in this 3-space plus
  an asymmetry offset. Thickness/length are *character/age* traits, not expression
  parameters — set by the genome, not the emotion system.
- **Shape primitive.** A 3-control-point arc (inner, mid, outer) lofted into a flat box
  or capsule is enough: `browAngle` rotates the inner/outer endpoints about the middle,
  `browCurve` lifts/drops the midpoint, `browHeight` translates the whole arc along the
  eye's normal-aligned "up." This mirrors AnimSchool's observation that the inner brow
  is the expressive end — angle acts mostly at the inner point.

### 5. Face-agnostic attachment & cute→cool scaling

- **Attachment contract.** The head generator, whatever mesh it produces, must emit two
  **eye anchors**: position `P`, outward surface normal `N`, head-up vector `U`, and a
  scalar `eyeRadius` (from genome + age). The eye sub-rig is built in a local frame
  (`N` = out, `U` projected ⊥ `N` = up) and **every offset in the rig is expressed in
  units of `eyeRadius`** — brow hover height, pupil travel range, brow length. That one
  rule makes the identical rig sit correctly on a stubby round baby head or a long
  angular adult skull, at any scale. (Wind Waker's raise-above-the-surface offset plays
  the same role — the rig only needs a point + normal, never face topology.)
- **Cute→cool = re-based neutrals.** Kindchenschema research (Lorenz; Glocker et al.;
  design-ratio studies for anthropomorphic characters) pins "cute" to: large deep eyes,
  low on a large round head, wide-open, big pupils. "Cool/fierce" is the inverse:
  relatively smaller eyes set higher, partly lidded, smaller pupils, lowered angled
  brows. Therefore age should modulate the **rest pose**, not the emotion math:
  emotion parameters are *deltas from a neutral pose that itself lerps with age*.
  A baby's neutral = slight surprise (brows up, eyes 100% open, pupils large); an
  adult's neutral = mild anger/confidence (brows lowered ~20%, inner ends a touch down,
  eyes ~85% open, pupils smaller). The same `angry` delta still reads as angry on both —
  it's just fiercer on the adult and adorable on the baby, which is exactly the arc we
  want.
- Asymmetry (`browAsym`) should also scale up slightly with age — cocked-brow skepticism
  is an adult "voluntary emotion" per the AnimSchool symmetric/asymmetric rule; babies
  read best with symmetric expressions.

### 6. Three.js testbed implementation notes

- **Eyes:** flattened `SphereGeometry` (scaled ~0.6 on local Z) per eye + a darker
  pupil cap (small sphere/disc parented to the eyeball). Gaze: keep a `gazeTarget`
  `Object3D`; per frame compute the clamped look direction and set pupil offset —
  either rotate the eyeball with `lookAt` (pure spheres) or, for squashed eyes, slide
  the pupil mesh across the eye surface / raycast to an eye plane (three.js forum
  consensus for non-spherical eyes). Clamp pupil travel to ~±35° so pupils never leave
  the visible eye.
- **Lids:** simplest robust option is a **lid sphere**: a slightly larger clipping
  hemisphere in head color that rotates down over the eye (`eyeOpen` maps to rotation).
  Two of them (upper + lower) give `eyeOpen` *and* `squint` with zero morph targets.
  Alternative: shader/texture eye on a dome with UV-offset pupil and an alpha lid mask
  (the Zelda technique) — better fidelity, slightly more work; a good v2.
- **Brows:** each brow = 3-point `QuadraticBezierCurve3` swept into a thin box/tube
  (`TubeGeometry` or a scaled `BoxGeometry` bent by the three params), positioned
  `browHeight · eyeRadius` above the eye anchor along the local up. Driven directly by
  params each frame — no bones or morphs needed at this poly count.
- **Cost:** ~6 small meshes + 1 vector math pass per dragon per frame; trivially within
  budget for ≤10 pets, and every technique here (UV-shift textures, tiny extra cuboids,
  texture-swap lids) has a direct Minecraft equivalent (geometry: extra cubes on the
  model, like Wind Waker's raised meshes; or texture: ETF-style animated eye layers).
  Avoid morph targets as the *primary* mechanism — Minecraft's cuboid models can't do
  them, and the parametric-mesh approach ports cleanly.

## Recommendation for our project

**Adopt an 8-parameter FACS-lite sub-rig** (per face; brows share params mirrored L/R,
with one asymmetry knob). All lengths in units of `eyeRadius`, all params are deltas
from an age-dependent neutral pose.

| Param | Range | Meaning |
|---|---|---|
| `eyeOpen` | 0–1.25 | 0 closed, 1 neutral-open, >1 wide (AU5/AU43) |
| `squint` | 0–1 | lower lid raise — smile or scrutiny (AU6/7) |
| `pupilX`, `pupilY` | −1–1 | gaze offset across eye (usually driven by look-at target) |
| `pupilSize` | 0.4–1.5 | 1 = neutral; big = cute/adoring, tiny = shock/menace |
| `browHeight` | −1–1 | hover height above eye (AU2 up / AU4 down) |
| `browAngle` | −1–1 | +1 inner ends down (fierce), −1 inner ends up (worried) (AU4/AU1) |
| `browCurve` | 0–1 | 0 straight bar (hard), 1 round arc (soft) |
| `browAsym` | −1–1 | adds ±height to one brow (curious/skeptical) |

**Emotion presets** (deltas from neutral; blend linearly between presets):

| Emotion | eyeOpen | squint | pupilSize | browHeight | browAngle | browCurve | browAsym | pupil |
|---|---|---|---|---|---|---|---|---|
| Happy | 0.8 | 0.5 | 1.1 | +0.3 | 0 | 0.9 | 0 | on target |
| Sad | 0.6 | 0 | 1.0 | −0.1 | −0.8 | 0.6 | 0 | down/averted |
| Angry | 0.9 | 0.4 | 0.7 | −0.7 | +0.9 | 0.1 | 0 | locked on target |
| Surprised | 1.25 | 0 | 0.6→1.2 | +0.9 | 0 | 0.8 | 0 | centered |
| Afraid | 1.2 | 0.2 | 0.5 | +0.7 | −0.6 | 0.5 | 0 | darting/toward threat |
| Curious | 1.05 | 0 | 1.2 | +0.4 | −0.1 | 0.7 | +0.6 | on target, head-tilt |
| Sleepy | 0.25 | 0.1 | 1.0 | −0.3 | −0.2 | 0.8 | 0 | drifting down |
| Content | 0.5 | 0.6 | 1.1 | 0 | 0 | 1.0 | 0 | slow wander |

**Attachment & aging:**

- Generator contract: each head exposes `{P, N, U, eyeRadius}` per eye. Rig builds in
  that local frame; brows float at `(1 + 0.5·browHeight)·eyeRadius` above eye center
  along local up, offset outward along `N` to clear the surface (Wind Waker trick).
- `neutral(age)`: lerp rest pose from baby `{eyeOpen 1.0, pupilSize 1.2, browHeight
  +0.3, browAngle −0.1, browCurve 0.9, eyeRadius/headSize large, eyes low+forward}` to
  adult `{eyeOpen 0.85, pupilSize 0.85, browHeight −0.2, browAngle +0.3, browCurve 0.3,
  eyeRadius/headSize small, eyes higher}`. Genome traits bias the adult endpoint
  (friendly vs fierce adult) per the cute→cool arc. Emotions apply as deltas on top,
  clamped to valid ranges — one emotion table serves every age and every head.
- Behavior default: pupils track a gaze target (owner/food/threat) with clamped travel
  and occasional saccades + ETF-style periodic blinks — the pet reads as alive even idle.
- Testbed v1: flattened-sphere eyes + pupil caps + lid hemispheres + bezier-tube brows,
  driven by these 8 params and an age slider. v2 (optional fidelity pass): Zelda-style
  UV-offset texture eyes — same parameter interface, so the emotion layer never changes.

## Sources

- [Scott McCloud — amplification through simplification (overview)](https://www.ebsco.com/research-starters/literature-and-writing/understanding-comics-invisible-art-scott-mccloud) and [applied discussion + 2016 cartoon-emotion-recognition study](https://www.i-modes.com/amplification-through-simplification-why-i-created-cartoon-images-for-therapy/)
- [Jason Osipa, *Stop Staring: Facial Modeling and Animation Done Right*](https://www.oreilly.com/library/view/stop-staring-facial/9780471789208/) — eyes/brows/lids as the core emotion channel
- [AnimSchool Blog — Animating Eyebrows](https://blog.animschool.edu/2025/03/21/animating-eyebrows/) — brows lead action; inner brow most expressive; symmetric vs asymmetric emotions
- [iMotions — Facial Action Coding System (FACS) visual guidebook](https://imotions.com/blog/learning/research-fundamentals/facial-action-coding-system/) — AU definitions and emotion→AU mappings
- [Jerwood — How to draw cartoon eye expressions](https://jerwoodvisualarts.org/blog/how-to-draw-cartoon-eye-expressions/) and [Clip Studio — facial expression basics](https://tips.clip-studio.com/en-us/articles/10736) — brow angle/height/curve → emotion heuristics
- [Nathan Gordon — Link's Expressions (Wind Waker graphics analysis)](https://medium.com/@gordonnl/links-expressions-eb7beae2c62c) — separate raised eye/brow/pupil meshes; UV-shift + scale pupil gaze; 7 eyes/6 brows/9 mouths
- [Ben Jones — Twilight Princess eyes breakdown](https://www.benjones.us/twilight-princess-eyes-breakdown/) — sprite-animated lids masking a UV-sliding iris layer
- [Kotaku — Link almost had laser eyes in Wind Waker](https://kotaku.com/link-almost-had-laser-eyes-in-wind-waker-1343786081) — gaze-as-gameplay-hint design intent
- [Rigmarole — Rigging spherical eyes with skinCluster](https://rigmarolestudio.com/rigging-spherical-eyes/) — engine-friendly spherical pupil/iris scaling
- [80.lv — Rig flat eyes for stylized characters in Blender](https://80.lv/articles/tutorial-how-to-rig-flat-eyes-for-stylized-3d-characters-in-blender) — lattice-flattened tracked eyes
- [three.js forum — eyes look at mouse cursor](https://discourse.threejs.org/t/make-only-eyes-move-with-look-at-the-mouse-cursor/61166) — lookAt vs raycast-to-plane for squashed eyes
- [Fire-Face — Eye shader breakdown](https://fire-face.com/eyes/) — parallax/fake-refraction dome eyes
- [Alex Haslam — Googly eyes](https://alxhslm.github.io/projects/googly-eyes/) — physics-driven billboard pupils
- [Entity Texture Features (Minecraft mod)](https://github.com/Traben-0/Entity_Texture_Features) and [Just Expressions pack](https://modrinth.com/resourcepack/just-expressions) — blink/emotion texture swaps readable at 1–3 px eye sizes
- [Glocker et al. — Baby schema induces cuteness perception (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3260535/) and [image ratios for cute anthropomorphic characters (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S1875952123000411) — kindchenschema features for the cute→cool neutral-pose shift
- [CGHERO — Pixar's curvenet rigging (Turning Red)](https://cghero.com/articles/new-pixar-rigging-system-curvenet) — pupil scaling as an emotion control
