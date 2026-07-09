# Research: Expressive ears + optional facial features (tusks, frills, barbels, heavy brows, nostrils)

Prior art and an implementation-ready proposal for adding **emotive ears** and a set of
**genome-optional facial features** to the dragon face. Builds directly on
`research/expressive-faces.md` (the 8-param eye+brow+mouth rig), the cute→cool arc
(`design/cute-to-cool-arc.md`), and the existing code in `testbed/src/face.js` /
`testbed/src/generator.js`.

## TL;DR (5 bullets)

- **Ears are the highest-leverage cuteness feature we don't have.** Toothless reads as a
  pet largely because of his "ear plates"/ear nubs, which "constantly perk and drop to
  signal emotions and opinions just like cats or dogs" — DreamWorks gave the Night Fury
  extra rigging "around its eyes, ears, and mouth" (4,000+ controls) precisely because
  ears carry emotion. The live-action remake even built an articulated-ear-plate puppet
  for on-set interaction. Same trick in Zootopia (Judy's ears up = happy, drooped =
  sad/nervous). We should add ears **before** any other new feature.
- **The animal ear-pose vocabulary is small and universal:** pricked/forward = alert,
  curious, happy; pinned flat back = fear or anger; splayed sideways ("airplane ears")
  = unease/annoyance; drooped = sad, sleepy, submissive. That's **3 pose scalars**
  (`earPerk`, `earPitch`, `earFlare`) layered on structural genome traits (size, length,
  width, floppiness, pointedness, pair count) — a perfect fit for our params-as-deltas
  emotion system.
- **Rig ears as a 2-segment rotation chain, not morphs.** Production practice for game
  ears is a 2-joint chain (base + tip); the VTuber ecosystem (VNyan tail/ears, Live2D
  animal-ear rigs) drives the same chain from brow parameters (brows up → ears up) plus
  idle wiggle. Rotation-only posing means zero geometry regeneration per frame **and a
  1:1 port to Minecraft Bedrock bones** — better than the brow's rebuild-on-change
  approach.
- **Recommended optional features, each one bone-attached layered mesh:** tusks/fangs
  (jaw — small up-tusks are cute-goofy, long sabers are fierce), frills/fringe crest
  (skull rear + neck — soft axolotl fringe is cute, spiky webbed frill is cool, and a
  `frillFlare` display doubles as threat/excitement expression, like the frilled
  lizard), barbels/whiskers (snout tip — eastern-dragon wisdom, mostly static), heavy
  droopy brows (a structural thickness/sag modifier on the existing brow), and nostrils
  (snout tip, with a cheap flare pulse for angry/surprised).
- **Recommendation:** extend `face.js` with an ear sub-rig driven by 3 new expressive
  params in `EMOTIONS`/`applyFaceParams`, extend `generator.js` with ~12 new genome
  traits (all defaulting to "current look" or "absent"), keep every feature a separate
  layered object over smooth/voxel skin, and build in phases: **ears first**, then
  tusks+nostrils, then frills+barbels+brow weight.

## Findings

### 1. Why ears carry so much emotion

- **The animal signal set is culturally pre-learned.** Every pet owner already decodes
  cat/dog ears: ears forward = "happy, curious, alert, confident"; ears flattened back =
  "fear, anger, or aggression"; ears splayed horizontally ("airplane ears") =
  overstimulated/uneasy (Hill's Pet, Cats.com, Chewy guides). Dogs: erect-forward =
  alert/interested; flattened = fearful/submissive, or slicked back just before
  aggression. So an audience needs **zero training** to read ear poses — unlike brows,
  which are a human-face convention we transplant, ears are the *native* emotion channel
  of the animal kingdom.
- **Ears are silhouette-level signals.** Ear pose changes the head's outline, which
  survives tiny on-screen sizes and low-poly/voxel rendering far better than any facial
  detail — exactly our Minecraft constraint. (This is the same "expressions must be
  silhouette changes" rule the eye research reached for lids/brows.)
- **Animation leans on this hard ("Expressive Ears" is a named trope).** Zootopia:
  Judy Hopps' ears stand up when happy, droop when sad or annoyed; Nick's ears droop
  when nervous. TV Tropes catalogs it across the medium. Ears also serve as *secondary
  action* — they lead or trail head motion, adding life without touching the face.
- **Toothless is the proof for dragons specifically.** His design merges a feline body,
  Stitch's face, and axolotl-like head appendages; the ear nubs "constantly perking and
  dropping" are cited by fans and the filmmakers alike as the key pet-like emotional
  device. The Night Fury rig had "much more rigging around its eyes, ears and mouth"
  than other dragons (4,000+ controls). For the 2025 live-action production, the
  practical Toothless puppet had **articulated ear plates** so actors got real emotional
  interaction on set. Also useful: Toothless has *multiple pairs* of head appendages —
  one main expressive pair plus smaller trailing plates — which reads distinctly
  "dragon" rather than "cat with scales."

### 2. How to rig cheap, readable ears

- **2-joint chain is the production baseline.** Polycount's animal-ear-rig consensus:
  a simple base→tip joint chain covers most ear acting; blendshapes only matter for
  subtle folds. For our poly count, a base pivot (whole-ear rotation) + a tip pivot
  (droop/fold of the outer half) is enough to express perk, pin, splay, and droop.
- **Drive ears from the emotion system, synced to brows.** The VTuber ecosystem
  (VNyan-Tail-Ears, Live2D animal-ear tutorials) converged on: ears **raise with brow
  raise, lower with brow lower**, tilt with the head, and get random micro-wiggles
  (min/max random interval, wiggle amount/speed) plus a wiggle on blink. This is a
  cheap "alive" layer we can copy directly: emotion sets the ear pose, a behavior tick
  adds twitches.
- **Pose space.** Everything the animal guides describe decomposes into three
  rotations at the base + one bend:
  - **erectness** (up ↔ folded down): base roll toward the skull + tip-segment droop;
  - **swivel** (forward ↔ pinned back): yaw about the ear's vertical axis;
  - **splay** (tight ↔ airplane-horizontal): roll outward about the head's forward axis.
  Asymmetry (one ear swiveled toward a sound) is the same "voluntary emotion" cue as
  the cocked brow — worth a single optional asymmetry knob, adult-biased.
- **Cute→cool scaling.** Kindchenschema again: proportionally big, soft, slightly
  droopy rounded ears read baby (puppy/kitten ears are oversized and floppy before the
  cartilage stiffens — real neoteny, not just a cartoon convention); smaller, sharper,
  swept-back ears read sleek adult. So, exactly like the eye rig: **age remaps the ear's
  neutral pose and proportions** (size relative to head, droop, pointedness, sweep), and
  the emotion deltas stay identical at every age.

### 3. Optional dragon facial features — prior art and cute/cool bias

| Feature | Real/animation reference | Cute end | Cool end |
|---|---|---|---|
| **Tusks/fangs** | Boar/bulldog underbite tusks; saber-cat fangs | Small *upward* tusks poking over the lip = goofy underbite snaggletooth (bulldog charm) | Long downward sabers / many visible fangs = predator |
| **Frill / fringe / crest** | Frilled lizard (frill erects as a threat/communication display — flare = "I'm big now"); axolotl external gill fringe (the very thing that makes axolotls — and partly Toothless — cute) | Soft, rounded, fleshy fringe (axolotl gills) | Tall spiky webbed crest, flared wide |
| **Barbels / whiskers** | Chinese lóng: catfish-like barbels at the snout, cow ears, deer antlers — the classic composite; dragon whiskers read "wise elder" | Two tiny chin/snout nubs | Long flowing tendrils (eastern elegance — "cool" in the graceful register, not the fierce one) |
| **Heavy droopy brows** | Bloodhound / Old English sheepdog brow folds; grandpa-eyebrow trope | Thick, heavy, outer-end-sagging brows = gentle, sleepy, endearing | Thin, sharp, low ridged brows = hawk-like intensity (our current brow, weighted down by genome) |
| **Nostrils** | Every cartoon bull/dragon "nostril flare" beat | Big round nostrils on a stubby snout (pig-like = cute) | Narrow slits, smoke-ready, flaring when angry |

Notes:
- The frilled lizard gives us a rare gift: a frill is **both** a static genome ornament
  and a legitimate *expression* (flare on anger/surprise/excitement, droop when calm) —
  it's the body-language equivalent of a puffed chest, backed by real biology.
- The Chinese-dragon composite legitimizes mixing features freely: real dragon
  iconography is *already* a grab-bag of mammal ears + antlers + barbels + frills, so a
  genome that toggles features independently is on-model, not chaotic.
- Tusks tie into the existing `makeMouth` TODO in `face.js` (sampling the lower-lip
  arc as a gum line for teeth/fangs/tusks) — the attachment surface is already planned.

### 4. Staying layered and Minecraft-safe

All new features follow the same contract the eyes/brows/mouth already obey: **separate
meshes in the `head` group, positioned from bone frames, hovering slightly proud of the
skin surface**, never part of the implicit field — so smooth mode can't swallow them and
voxel mode just renders them over the cubes. Every feature below is posed by **rotations
and uniform scales only** (no morph targets, no per-frame geometry rebuilds), which maps
1:1 onto Bedrock geo.json bones + rotation animations for the eventual Minecraft port
(ears = 2 cuboids on 2 bones; tusks/barbels/frill petals = 1 cuboid/bone each). The
existing brow rebuilds geometry when `browCurve` changes; for ears we can do better and
avoid regeneration entirely (two-segment chain), which is also why the ear is the right
feature to build first.

## Proposed additions for our project

### A. Ears (build first)

**Structure.** Each ear is a small hierarchy inside the face rig (names stable, like
`eyeL`/`browL`):

```
earL (Group)            — pivot ON the skull surface; poses via rotation only
├── base (Mesh)         — lower ~55% of the ear: curved tapered petal (taperedTube
│                          along a short bezier, radius tapering tip-ward; flattened
│                          scale.z ≈ 0.45 so it reads as a leaf/plate, not a horn)
└── tip  (Group @ 55% up the base curve)
    └── tipMesh (Mesh)  — outer ~45%, tapering to a soft point
```

Reuse `taperedTube()` from `face.js` (the brow helper) for both segments. Inner-ear
detail: optional second, slightly smaller tube in a darker/pinker tint parented inside
`base`, offset forward — one extra mesh, big readability win when the ear faces the
camera. For `earPairs` > 1 (Toothless look), clone the hierarchy 1–2 more times,
cascading down/back along the skull at ~70% and ~50% scale; **only the main pair gets
full expression amplitude, trailing pairs follow at 0.5× / 0.25×** (automatic
overlapping action, one line of code).

**Attachment contract** (mirrors the eye-anchor pattern). The generator computes two
ear anchors from the `skull` bone in head-local space and passes them in `opts.ears`:

```js
// generator.js, next to the mouth placement code (~line 862)
ears: {
  anchors: [-1, 1].map(side => ({
    pos:  V(side * R * 0.62, R * 0.55, -R * 0.10),  // upper-rear-side of skull sphere
    out:  V(side * 0.75, 0.62, -0.22).normalize(),  // base direction: up-out-slightly-back
    up:   V(0, 1, 0),
  })),
  size: p.earSize * R,          // all ear lengths in units of this
  length: p.earLength, width: p.earWidth,
  droop: p.earDroop, pointed: p.earPointed, pairs: p.earPairs,
  neutral: p.earNeutral,        // age-lerped rest pose {perk, pitch, flare}
}
```

In smooth mode nudge `pos` outward ~4% like the eyes, so the base sits proud of the
field surface.

**Parameters.**

*Structural (genome + age → build time, `opts.ears`):*

| Trait | Range | Default | Meaning |
|---|---|---|---|
| `earSize` | 0–1.6 | 0.9 | Overall ear scale vs head radius. **0 = no ears** (genome-optional). |
| `earLength` | 0.4–2.4 | 1.0 | Aspect: 0.4 = stubby nub, 2.4 = long rabbit/fennec ear. |
| `earWidth` | 0.5–1.6 | 1.0 | Base width. Wide+short = round teddy ear; narrow+long = sleek. |
| `earDroop` | 0–1 | 0.25 | Structural floppiness: bakes a downward bend into the tip segment's rest rotation AND compresses the reachable `earPerk` range (a floppy ear can lift, but never fully pricks — reads wonderfully). |
| `earPointed` | 0–1 | 0.6 | Tip sharpness: 0 rounded lobe, 1 sharp point (taper exponent in the radius function). |
| `earPairs` | 1–3 (step 1) | 1 | Extra trailing plate pairs, Toothless-style, at reduced scale/amplitude. |

*Expressive (per-frame, join `FACE_TRAITS`, added to `DEFAULTS` and every `EMOTIONS`
preset):*

| Param | Range | Meaning | Implementation |
|---|---|---|---|
| `earPerk` | −1–1 | −1 fully drooped/folded down · 0 neutral · +1 pricked tall | base roll toward vertical + tip-group pitch (droop bend) — the two-segment split makes low perk read as *fold*, not rigid tilt |
| `earPitch` | −1–1 | +1 swiveled forward (attention) · −1 pinned flat back against the skull (fear/anger) | yaw at the base pivot; at −1 also add extra roll so the ear hugs the skull |
| `earFlare` | 0–1 | 0 tight/vertical · 1 splayed horizontal "airplane ears" (unease, deep relaxation when combined with low perk) | outward roll at the base pivot about the head-forward axis |

Age lerps the **neutral pose** exactly like the eye rig: baby neutral ≈ `{perk 0.35,
pitch 0.25, flare 0.15}` with `earSize × ~1.3`, `earDroop + 0.2`, `earPointed × 0.6`
(big, soft, slightly floppy, forward-curious); adult neutral ≈ `{perk 0.15, pitch −0.15,
flare 0.05}` at genome size/sharpness (sleeker, swept back, composed). Emotions stay
deltas on top; the same `angry` pin-back is adorable on a floppy baby ear and menacing
on a sharp adult one — the arc for free.

**Emotion → ear pose table** (extend `EMOTIONS` in `face.js`; existing columns
unchanged):

| Emotion | earPerk | earPitch | earFlare | Read |
|---|---|---|---|---|
| neutral | 0.2 | 0.1 | 0.1 | ears softly up, faintly forward |
| happy | 0.6 | 0.5 | 0.15 | perked and forward — engaged |
| content | 0.1 | 0.15 | 0.35 | relaxed, slightly splayed — "melted cat" |
| curious | 1.0 | 0.8 | 0.0 | fully pricked, aimed at the target (pair with `pupilX`; optional +asym) |
| surprised | 1.0 | 0.45 | 0.0 | shot straight up |
| angry | −0.25 | −0.9 | 0.3 | pinned flat back — unmistakable at silhouette level |
| sleepy | −0.7 | −0.2 | 0.5 | drooped and splayed |
| *afraid* (new preset, recommended) | 0.3 | −1.0 | 0.6 | flat back + splayed, wide eyes from existing table |
| *sad* (new preset, recommended) | −0.8 | −0.3 | 0.2 | full droop (Judy Hopps), inner-up brows |

Behavior layer (later, with gaze/blink): random micro-twitch on `earPitch` every 2–6 s,
small wiggle on blink, and ears leading head turns by ~100 ms — the VNyan recipe.

### B. Other optional features

Each is genome-optional (default absent or current-look), one attach point, layered.

| Feature | Genome traits (range · default) | Attach point | Expressive? | Cute↔cool bias |
|---|---|---|---|---|
| **Tusks/fangs** | `tuskSize` 0–1.5 · **0**; `tuskCurve` 0–1 · 0.5 (straight→curled); `tuskDir` −1–1 · +0.5 (+ = up from lower jaw, − = down from upper snout) | `jaw` bone tip corners (up-tusks) or `snout` tip corners (sabers); position by sampling the mouth-band lower/upper arc at t ≈ ±0.75 — the existing `makeMouth` TODO | Static (they ride the jaw; visually "move" when `mouthOpen` changes) | up+small = cute underbite; down+long = fierce. Age-gate like wings: nubs until ~35% age, then grow |
| **Frill/fringe crest** | `frillSize` 0–1.5 · **0**; `frillExtent` 0–1 · 0.3 (skull-only crown → down the neck); `frillSoft` 0–1 · 0.7 (rounded fleshy axolotl → sharp webbed spikes) | row of petal meshes on `skull` rear arc; if `frillExtent` > ~0.4, continue along `spine`/neck bones (generator already iterates them) | **Yes — one param:** `frillFlare` 0–1 in `FACE_TRAITS`/`EMOTIONS` (petal pitch away from the body + slight scale): angry/surprised ≈ 0.8–1.0, sleepy/content ≈ 0.05, neutral 0.25 (frilled-lizard display) | soft+small = axolotl-cute (very Toothless); spiky+flared = threat display. `frillSoft` can also drift down with age |
| **Barbels/whiskers** | `barbelLength` 0–1.5 · **0**; `barbelPairs` 1–2 · 1 (snout-tip pair; 2 adds chin pair) | `snout` bone tip, sides, drooping bezier `taperedTube` (same helper) | Mostly static; optional tiny sway in the behavior tick. Not emotion-mapped | short nubs = cute; long flowing = wise eastern elegance ("cool" in the graceful register). Grow with age (elder whiskers) |
| **Heavy/droopy brows** | `browWeight` 0.3–1.8 · **1.0** (thickness multiplier); `browSag` 0–1 · **0** (outer-end downward sag baked into `browGeometry`) | existing brows — pure modifier of `browGeometry()` radius function + outer control point | Already expressive (existing `browHeight/Angle/Curve` ride on top) | heavy+sagging = gentle grandpa/bloodhound; thin+low = sharp hawk. Defaults preserve today's look exactly |
| **Nostrils** | `nostrilSize` 0.3–1.5 · **1.0** | two small dark discs (flattened spheres) on `snout` tip, ±30° off forward, hovering proud of the surface like the mouth band | **Cheap flare:** scale-pulse 1.0→1.35 driven by a `nostrilFlare` 0–1 param (angry 0.9, surprised 0.7, else ~0.1). Could piggyback on `mouthOpen` at v1 to avoid a new param | big round = piggy-cute; small = sleek. Neutral: slightly larger relative size on babies |

### C. Genome & schema changes (`generator.js`)

Add to `GENOME_SCHEMA` under two new groups:

- **`Ears` group:** `earSize`, `earLength`, `earWidth`, `earDroop`, `earPointed`,
  `earPairs` (ranges/defaults per table A).
- **`Features` group:** `tuskSize`, `tuskCurve`, `tuskDir`, `frillSize`, `frillExtent`,
  `frillSoft`, `barbelLength`, `barbelPairs`, `browWeight`, `browSag`, `nostrilSize`.
- **`Face` group (expressive, appended to `FACE_TRAITS` too):** `earPerk` (−1–1 · 0.2),
  `earPitch` (−1–1 · 0.1), `earFlare` (0–1 · 0.1), `frillFlare` (0–1 · 0.25).

All defaults chosen so **a current genome renders pixel-identical** (ears default *on*
at 0.9 is the one deliberate change — ears are the point of this work; every other
feature defaults absent/neutral). `DEFAULT_GENOME` derives automatically from the
schema, and unknown params in old saved genomes fall back to defaults, so nothing
breaks. Archetypes should then be re-tuned (e.g. serpentine archetype: `earSize 0.3,
barbelLength 1.2, frillSize 0.6, frillSoft 1.0` for the eastern look; bruiser:
`tuskSize 0.9, tuskDir +1, earSize 0.5`).

`phenotype()` additions — same pattern as the existing `face:` block:

```js
// structural, age-scaled
earSize:   g.earSize * lerp(1.3, 1.0, s),     // bigger vs head on babies
earDroop:  clamp01(g.earDroop + lerp(0.20, 0.0, s)),
earPointed:g.earPointed * lerp(0.6, 1.0, s),
tuskSize:  g.tuskSize * smoothstep(clamp01((e - 0.30) / 0.55)),  // age-gated like wings
frillSize: g.frillSize * lerp(0.45, 1.0, s),  // fringe present early (cute!), grows
barbelLen: g.barbelLength * smoothstep(clamp01((e - 0.25) / 0.6)),
earNeutral: { perk: lerp(0.35, 0.15, s), pitch: lerp(0.25, -0.15, s), flare: lerp(0.15, 0.05, s) },
// expressive (inside p.face, joining eyeOpen etc.)
earPerk: g.earPerk, earPitch: g.earPitch, earFlare: g.earFlare, frillFlare: g.frillFlare,
```

### D. Integration plan (exact seams)

1. **`face.js` — ears** *(the pattern to copy is brow/mouth)*:
   - `makeEar(anchor, earOpts, side)` → the 2-segment Group above; called from
     `createFaceRig` when `opts.ears` present; store layout in `rig.userData.ears`.
   - `earGeometry(size, length, width, pointed)` via the existing `taperedTube`.
     Geometry is built **once** — all posing is rotations, no cache-key regen needed.
   - Extend `DEFAULTS` + every `EMOTIONS` preset with `earPerk/earPitch/earFlare`
     (+`frillFlare`); add the `afraid` and `sad` presets (full rows incl. existing
     eye/brow/mouth columns from the emotion table in `research/expressive-faces.md`).
   - In `applyFaceParams`: if `rig.userData.ears`, map params → base/tip rotations,
     compose with the age-neutral pose and `earDroop` clamp; apply trailing pairs at
     0.5×/0.25× amplitude. Skip silently when ears absent (old rigs keep working).
2. **`generator.js` — anchors + genome**: schema/`FACE_TRAITS` additions (§C);
   phenotype block (§C); compute `opts.ears` anchors from the `skull` bone next to the
   existing `mouthOpts` code and pass into `createFaceRig`.
3. **Tusks + nostrils**: small meshes added by the generator into the `head` group from
   `jaw`/`snout` bone frames (they are placement-only, no expression state → generator-
   side, like the skull/snout capsules; export the mouth-band arc sampler from `face.js`
   for the gum-line positions). `nostrilFlare` pulse goes through `applyFaceParams`.
4. **Frill + barbels**: petal row on skull rear/neck bones (generator-side build);
   `frillFlare` posing in `applyFaceParams` (rig gets a `frill` group reference via
   `rig.userData`). Barbels static v1.
5. **Brow weight/sag**: thread `browWeight/browSag` into `browGeometry()`; defaults
   reproduce the current output exactly.
6. **Behavior polish** (with the future gaze/blink tick): ear micro-twitch, blink
   wiggle, ears lead head turns.

**Phased build order:** Phase 1 = steps 1–2 (ears — highest cuteness payoff; verify
with the age slider × emotion dropdown across archetypes, smooth + voxel + capsule
modes, grok second-opinion per AGENTS.md §5). Phase 2 = step 3 (tusks + nostrils).
Phase 3 = steps 4–5 (frill + barbels + brow weight). Phase 4 = step 6. Each phase is a
separate worktree task and keeps the face rig head-agnostic: the generator supplies
frames (`{pos,out,up}` + scale), the rig never reads head topology.

**Budget check:** worst case (ears ×3 pairs + inner-ear + frill ~8 petals + 2 tusks +
2 barbels + 2 nostrils) ≈ 25 small low-poly meshes per dragon, posed by ~10 rotations
per frame — negligible for ≤10 pets, and every piece is a bone+cuboid in the Bedrock
export.

## Sources

- [IndieWire — 'How to Train Your Dragon' Built a Better Toothless (live-action VFX)](https://www.indiewire.com/features/craft/how-to-train-your-dragon-live-action-remake-deblois-vfx-1235131634/) — Stitch-like face with ear plates as the core of Toothless's expressiveness
- [Daily Gazette — How Toothless evolved for the new HTTYD](https://www.dailygazette.com/tribune/how-toothless-evolved-for-the-new-how-to-train-your-dragon-we-wanted-him-to/article_059d5bc1-5f43-52cd-8e2e-0606d21f5ee4.html) — on-set puppet with articulated jaw and ear plates; feline/axolotl/falcon design mix
- [SCMP — The evolution of Toothless from animation to live action](https://www.scmp.com/lifestyle/entertainment/article/3315050/evolution-toothless-how-train-your-dragon-animation-live-action) — mammal-over-reptile, pet-like qualities as the design key
- [HTTYD Wiki — Night Fury](https://howtotrainyourdragon.fandom.com/wiki/Night_Fury_(Franchise)) and [DreamWorks Wiki — Toothless](https://dreamworks.fandom.com/wiki/Toothless) — 4,000+ controls, extra rigging around eyes/ears/mouth; ear nubs perk and drop like cats/dogs
- [Animation Mentor — Animating Toothless: HTTYD2 insider tips](https://www.animationmentor.com/blog/animating-toothless-insider-tips-from-how-to-train-your-dragon-2/) — feline reference for Toothless's acting
- [Hill's Pet — Cat ear language](https://www.hillspet.com/cat-care/behavior-appearance/cat-ear-language) and [Dog ear positions](https://www.hillspet.com/dog-care/behavior-appearance/dog-ear-language-and-positions) — forward/flattened/erect pose meanings
- [Cats.com — Cat ear positions and what they mean](https://cats.com/cat-ear-positions) and [Chewy — How to read a cat's ears](https://www.chewy.com/education/cat/training-and-behavior/how-to-read-a-cats-ears) — airplane ears, the full pose vocabulary
- [TV Tropes — Expressive Ears](https://tvtropes.org/pmwiki/pmwiki.php/Main/ExpressiveEars) and [Zootopia character notes](https://zootopia.fandom.com/wiki/Judy_Hopps) — ears up = happy, drooped = sad/nervous as a standard animation device
- [Polycount — Animal ear rig suggestions](https://polycount.com/discussion/226468/maya-animal-ear-rig-suggestions) — 2-joint base→tip chain as the production baseline; blendshapes only for subtle folds
- [VNyan-Tail-Ears (GitHub)](https://github.com/Lunazera/VNyan-Tail-Ears) — ears raised/lowered with brow parameters, idle wiggle timing/amount parameters, blink wiggle
- [Live2D — Expressive animal ears tutorial](https://www.youtube.com/watch?v=cQ2SZ3eXvnw) — physics + idle + brow-sync recipe for 2D avatar ears
- [Wikipedia — Frilled lizard](https://en.wikipedia.org/wiki/Frilled_lizard) and [A-Z Animals — what the frill display means](https://a-z-animals.com/articles/what-it-means-when-a-frilled-neck-lizard-shows-its-frill/) — frill erection as threat/communication display (basis for `frillFlare`)
- [Wikipedia — Chinese dragon](https://en.wikipedia.org/wiki/Chinese_dragon) — the composite anatomy (catfish barbels, cow ears, deer antlers) legitimizing independent feature toggles
- [Glocker et al. — Baby schema and cuteness perception (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3260535/) — kindchenschema basis for big/soft/droopy baby features (carried over from `research/expressive-faces.md`)
