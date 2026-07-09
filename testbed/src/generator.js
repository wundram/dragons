// generator.js — Dragon model generator.
//
// STEP 1 of the rigging-and-skinning build order (see
// design/rigging-and-skinning-recommendation.md):
//
//   Fixed-topology "maximal" skeleton  +  per-bone allometric growth,
//   skinned as RAW PER-BONE TAPERED CAPSULES (no implicit field / marching
//   cubes yet — that is Step 2).
//
// The central idea: ONE skeleton, shared by every dragon at every age. Its bone
// NAME SET is identical for all genomes/ages — growth never adds or removes
// bones, it only scales each bone's `length` and `envelopeRadius`. Snake body
// plans = limb bones scaled toward zero; quadruped = limb bones grown. Limb
// "budding" is therefore a pure surface effect over an unchanging rig, so future
// keyframe animation bound to stable bone names survives every growth re-bake.
//
// This file defines the GENERATOR INTERFACE CONTRACT the harness (app.js) depends
// on. Keep the three exports identical so nothing in the harness has to change:
//   - GENOME_SCHEMA  : Array<TraitSpec>        — declarative trait list (UI auto-built)
//   - DEFAULT_GENOME : Record<string, number>  — a default per trait
//   - generateDragon(genome, age, env) -> THREE.Group
//
// Additional exports used by the harness / evaluation:
//   - FACE_TRAITS, setDragonFace, phenotype   (unchanged contract)
//   - ARCHETYPES : { snake, drake, wyvern, crawlerFlyer, grasper, ... } — attractor
//     genomes remapped onto the unified bat-wing-forelimb case table (see
//     design/limb-and-wing-architecture.md). (quadruped/eastern kept as aliases
//     so the harness's hard-coded archetype <select> still resolves.)
//
// The returned group exposes the resolved bone tree on
// `group.userData.skeleton` (array of { name, parent, pos, length,
// envelopeRadius, tail, ... }). Step 2 (implicit field) consumes each bone's
// world `pos` + `tail` + `envelopeRadius` to sum the scalar field.

import * as THREE from 'three';
import { createFaceRig, applyFaceParams } from './face.js';
import { buildFieldMesh } from './field.js';
import { buildVoxelSkin } from './voxel.js';
import { exportGeoJSON } from './geojson.js';
import {
  buildFeatureGrid, runMarkingCA, applyMarkingColors,
  markingColorForPoint, cellPositions, buildGridOverlay,
} from './featureGrid.js';
import { buildFeatureState, buildFeatureMeshes } from './features.js';
import * as MAT from './materials.js';

// ---------------------------------------------------------------------------
// GENOME_SCHEMA
// ---------------------------------------------------------------------------
// Each entry describes one numeric trait. The harness auto-builds a slider for
// every entry, grouped by `group`. Every trait is a plain number in [min,max].
//
// TraitSpec = { name, min, max, default, step?, group, description }
//
// IMPORTANT: genome traits describe the ADULT *destination* / bias. The cute→cool
// arc is produced by `generateDragon` applying age-driven allometry + limb
// budding on top of the genome (see phenotype() below). So `age` (0..1), NOT the
// genome, drives the cute↔cool transformation; the genome only biases where the
// adult lands AND which body plan emerges (limbs vs no limbs, wings vs none).
export const GENOME_SCHEMA = [
  // --- Body proportions -----------------------------------------------------
  { name: 'bodyElongation', min: 0.4, max: 2.4, default: 1.0, group: 'Body',
    description: 'Trunk length along the spine. High = long serpentine body (eastern/snake).' },
  { name: 'robustness',     min: 0.6, max: 1.35, default: 0.85, group: 'Body',
    description: 'Overall girth: torso & neck & tail envelope radius. High = chunky, low = slender. (Kept in a believable band so adults are not beach-balls.)' },
  { name: 'neckLength',     min: 0.2, max: 2.6, default: 1.0, group: 'Body',
    description: 'Adult neck length (baby necks are always short/stubby, grow with age).' },
  { name: 'tailLength',     min: 0.2, max: 3.0, default: 1.2, group: 'Body',
    description: 'Adult tail length (grows with age).' },
  { name: 'girdleWidth',    min: 0.4, max: 1.9, default: 1.0, group: 'Body',
    description: 'Width of shoulder & hip girdles — sets leg stance & body width.' },

  // --- Head -----------------------------------------------------------------
  { name: 'headSize',    min: 0.5, max: 1.8, default: 1.0, group: 'Head',
    description: 'Adult head size relative to body. Babies get a big-head boost automatically.' },
  { name: 'snoutLength', min: 0.2, max: 1.8, default: 0.9, group: 'Head',
    description: 'Adult snout length (baby snouts are short & stubby; lengthen with age).' },
  { name: 'jawSize',     min: 0.3, max: 1.6, default: 1.0, group: 'Head',
    description: 'Size of the lower jaw envelope.' },
  { name: 'eyeSize',     min: 0.5, max: 1.8, default: 1.0, group: 'Head',
    description: 'Base eye size. Babies get huge low eyes; adults smaller & higher.' },

  // --- Forelimb (the UNIFIED bat-wing forelimb — ONE fixed topology; bone
  //     lengths alone decide arm vs wing vs hand. length ~0 => that part absent) -
  { name: 'armLength',    min: 0.0, max: 1.8, default: 1.0, group: 'Forelimb',
    description: 'Shoulder->wrist reach (upper arm + forearm). ~0 = no arm (snake); long+no-membrane = a walking foreleg.' },
  { name: 'finger0Length',min: 0.0, max: 3.2, default: 1.0, group: 'Forelimb',
    description: 'Primary finger / main wing spar (the leading edge beyond the wrist). Long = big wing spar, short = finger.' },
  { name: 'finger1Length',min: 0.0, max: 2.0, default: 0.6, group: 'Forelimb',
    description: 'Second finger. Short => toe/claw, long => extra wing spar (another membrane panel).' },
  { name: 'finger2Length',min: 0.0, max: 2.0, default: 0.5, group: 'Forelimb',
    description: 'Third finger. Short => toe/claw, long => extra wing spar.' },
  { name: 'finger3Length',min: 0.0, max: 2.0, default: 0.4, group: 'Forelimb',
    description: 'Fourth finger. Short => toe/claw, long => extra wing spar.' },
  { name: 'fingerSpread', min: 0.0, max: 1.0, default: 0.5, group: 'Forelimb',
    description: 'Fan splay of the fingers (wing chord width / hand spread).' },
  { name: 'foreClawSize', min: 0.0, max: 1.5, default: 0.6, group: 'Forelimb',
    description: 'Talon size at the fingertips.' },
  { name: 'limbThickness',min: 0.5, max: 1.8, default: 1.0, group: 'Forelimb',
    description: 'Arm/leg envelope radius. Babies get chubbier limbs automatically.' },

  // --- Wings (membrane amount over the SAME forelimb — no separate limb pair) --
  { name: 'wingMembrane', min: 0.0, max: 1.0, default: 0.6, group: 'Wings',
    description: 'Membrane sheet spanning the forelimb: 0 = bare arm/leg, low = leading-edge fringe, 1 = full bat wing. Also drives the wing-out rest pose. Emerges past ~25% age.' },

  // --- Hind limbs (legs ending in toed feet with claws) ---------------------
  { name: 'hindLegLength',min: 0.0, max: 1.8, default: 1.0, group: 'Hind',
    description: 'Hind leg length. ~0 = legless (snake). Babies bud short, lengthen with age.' },
  { name: 'toeCount',     min: 0, max: 4, default: 3, step: 1, group: 'Hind',
    description: 'How many toes on each hind foot are developed (0..4).' },
  { name: 'hindClawSize', min: 0.0, max: 1.5, default: 0.6, group: 'Hind',
    description: 'Talon size on the hind toes.' },

  // --- Growth (allometric rate biases; shape HOW the cute→cool arc travels) --
  { name: 'maturationRate', min: 0.4, max: 2.2, default: 1.0, group: 'Growth',
    description: 'How fast the whole cute→cool arc progresses with age (>1 matures sooner).' },
  { name: 'headNeoteny',    min: 0.0, max: 1.2, default: 0.9, group: 'Growth',
    description: 'Strength of the baby big-head/big-eye boost (higher = cuter baby).' },
  { name: 'limbGrowthRate', min: 0.5, max: 2.2, default: 1.0, group: 'Growth',
    description: 'Allometric limb/wing budding rate (>1 = limbs come in earlier & faster).' },

  // --- Color ----------------------------------------------------------------
  { name: 'colorHue',        min: 0.0, max: 1.0, default: 0.55, group: 'Color',
    description: 'Base body hue (0..1 around the color wheel).' },
  { name: 'colorSaturation', min: 0.0, max: 1.0, default: 0.6, group: 'Color',
    description: 'Adult saturation. Babies read more pastel; color saturates with age.' },
  { name: 'colorLightness',  min: 0.2, max: 0.85, default: 0.55, group: 'Color',
    description: 'Base body lightness.' },

  // --- Markings / pattern (the CA feature-grid coloration; PHASE 1) ----------
  // These drive featureGrid.js's activator–inhibitor CA -> per-vertex body colours
  // (smooth) and per-cube tint (voxel). Age is the CA clock: patterns emerge &
  // strengthen with age (cute -> cool). Deterministic from patternSeed.
  { name: 'markingContrast', min: 0.0, max: 1.0, default: 0.45, group: 'Markings',
    description: 'Marking amplitude: 0 = plain body, 1 = bold high-contrast pattern. Ramps up with age.' },
  { name: 'markingScale',    min: 0.0, max: 1.0, default: 0.5, group: 'Markings',
    description: 'Pattern wavelength: low = big blotches/patches, high = fine speckle.' },
  { name: 'markingType',     min: 0.0, max: 1.0, default: 0.35, group: 'Markings',
    description: 'Pattern anisotropy: 0 = spots/dapples, 1 = stripes/bands.' },
  { name: 'markingHue',      min: 0.0, max: 1.0, default: 0.08, group: 'Markings',
    description: 'Secondary marking hue offset from the body hue (0..1 around the wheel).' },
  { name: 'patternSeed',     min: 0, max: 65535, default: 1234, step: 1, group: 'Markings',
    description: 'Per-dragon PRNG seed for the marking CA (uniqueness). Breeds by inheriting/hashing parents.' },
  { name: 'featurePlasticity', min: 0.4, max: 2.2, default: 1.0, group: 'Markings',
    description: 'How fast the feature CA advances with age (pattern analogue of maturationRate).' },

  // --- Spikes / dorsal ridge (PHASE 2 discrete CA features; see features.js) --
  // Instanced cones on the back/tail, spaced by lateral inhibition, suppressed by
  // fat (big cells), emerging + sharpening with age. crestSail webs them into a fin.
  { name: 'spikeAmount',   min: 0.0, max: 1.0, default: 0.4, group: 'Spikes',
    description: 'Overall dorsal/tail spike potential. 0 = smooth back, 1 = dense spiny ridge.' },
  { name: 'spikeSpacing',  min: 0.3, max: 3.0, default: 1.0, group: 'Spikes',
    description: 'Lateral-inhibition spacing: low = crowded row, high = sparse, well-separated spikes.' },
  { name: 'spikeSharpness',min: 0.0, max: 1.0, default: 0.6, group: 'Spikes',
    description: 'Cone slenderness / tip acuity: 0 = stubby nub, 1 = long sharp spine.' },
  { name: 'spikeGrowthAge',min: 0.0, max: 1.0, default: 0.35, group: 'Spikes',
    description: 'Age at which spikes emerge & sharpen (cute→cool timing). Baby has none.' },
  { name: 'crestSail',     min: 0.0, max: 1.0, default: 0.2, group: 'Spikes',
    description: 'How strongly adjacent dorsal spikes web into a membrane sail/fin along the spine.' },
  { name: 'spikeRegionBias',min: 0.0, max: 1.0, default: 0.7, group: 'Spikes',
    description: 'Spike spread: 0 = strict back ridge only, 1 = spills down onto flanks.' },

  // --- Feathers / coat (PHASE 2) --------------------------------------------
  { name: 'featherCoverage',min: 0.0, max: 1.0, default: 0.0, group: 'Feathers',
    description: 'Feather vs bare-scale dominance: 0 = scaly dragon, 1 = feathered tufts.' },
  { name: 'featherRegionBias',min: 0.0, max: 1.0, default: 0.5, group: 'Feathers',
    description: 'Feather tract: 0 = neck/shoulder ruff, 1 = tail (+wing-arm).' },
  { name: 'featherLength', min: 0.0, max: 1.0, default: 0.5, group: 'Feathers',
    description: 'Feather card length.' },

  // --- Scales / plating (PHASE 2) -------------------------------------------
  { name: 'scaleSize',     min: 0.0, max: 1.0, default: 0.5, group: 'Scales',
    description: 'Base scute/plate lens size (interacts with cell area).' },
  { name: 'scutePlating',  min: 0.0, max: 1.0, default: 0.3, group: 'Scales',
    description: 'Belly/flank hard-plate (discrete scute) amount. 0 = smooth belly.' },

  // --- Face expression (drives the eye+brow rig directly) -------------------
  { name: 'eyeOpen',   min: 0.0, max: 1.0, default: 1.0, group: 'Face',
    description: 'Eyelid openness: 1 = wide, 0 = shut. Sleepy/angry lower it.' },
  { name: 'pupilX',    min: -1.0, max: 1.0, default: 0.0, group: 'Face',
    description: 'Horizontal gaze direction of both pupils (-1 left .. 1 right).' },
  { name: 'pupilY',    min: -1.0, max: 1.0, default: 0.0, group: 'Face',
    description: 'Vertical gaze direction of both pupils (-1 down .. 1 up).' },
  { name: 'browHeight',min: -1.0, max: 1.0, default: 0.3, group: 'Face',
    description: 'How high the floating brows sit above the eyes.' },
  { name: 'browAngle', min: -1.0, max: 1.0, default: 0.0, group: 'Face',
    description: 'Brow tilt: positive = inner-down (angry), negative = inner-up (sad/worried).' },
  { name: 'browCurve', min: -1.0, max: 1.0, default: 0.2, group: 'Face',
    description: 'Brow arch: positive = raised/curious arch, negative = flat/stern.' },
  { name: 'mouthOpen', min: 0.0, max: 1.0, default: 0.06, group: 'Face',
    description: 'Mouth / jaw opening: 0 = closed line, 1 = wide open (surprised).' },
  { name: 'mouthCurve',min: -1.0, max: 1.0, default: 0.1, group: 'Face',
    description: 'Mouth shape: positive = smile, negative = frown.' },
  // Expressive EAR + FRILL params (deltas on the age-lerped neutral pose; live-update
  // via FACE_TRAITS so the emotion presets drive them without a full rebuild).
  { name: 'earPerk',   min: -1.0, max: 1.0, default: 0.2, group: 'Face',
    description: 'Ear erectness: -1 drooped/folded down, +1 pricked tall & alert.' },
  { name: 'earPitch',  min: -1.0, max: 1.0, default: 0.1, group: 'Face',
    description: 'Ear swivel: +1 forward (attention), -1 pinned flat back (fear/anger).' },
  { name: 'earFlare',  min: 0.0, max: 1.0, default: 0.1, group: 'Face',
    description: 'Ear splay: 0 tight/vertical, 1 splayed horizontal (airplane ears).' },
  { name: 'frillFlare',min: 0.0, max: 1.0, default: 0.25, group: 'Face',
    description: 'Neck/crest frill display: 0 laid flat, 1 fully flared (threat/excitement).' },

  // --- Ears (structural genome; age remaps the NEUTRAL pose & proportions) ----
  { name: 'earSize',    min: 0.0, max: 1.6, default: 1.15, group: 'Ears',
    description: 'Overall ear scale vs head radius. 0 = no ears (genome-optional). Default is a big Toothless-style flap.' },
  { name: 'earLength',  min: 0.4, max: 2.4, default: 1.05, group: 'Ears',
    description: 'Ear aspect: 0.4 = stubby nub, 2.4 = long rabbit/fennec ear.' },
  { name: 'earWidth',   min: 0.5, max: 1.6, default: 1.3, group: 'Ears',
    description: 'Base width: wide = broad paddle/fin flap, narrow+long = sleek.' },
  { name: 'earDroop',   min: 0.0, max: 1.0, default: 0.25, group: 'Ears',
    description: 'Structural floppiness: bends the tip down & caps how far the ear can prick.' },
  { name: 'earPointed', min: 0.0, max: 1.0, default: 0.4, group: 'Ears',
    description: 'Tip sharpness: 0 rounded lobe, 1 sharp point.' },
  { name: 'earPairs',   min: 1, max: 3, default: 1, step: 1, group: 'Ears',
    description: 'Extra trailing ear-plate pairs (Toothless-style), at reduced scale/amplitude.' },

  // --- Features (all genome-optional; default ABSENT / neutral so a current
  //     genome renders essentially unchanged except for the now-present ears) ---
  { name: 'tuskSize',    min: 0.0, max: 1.5, default: 0.0, group: 'Features',
    description: 'Tusk/fang size. 0 = none. Small up-tusks = cute underbite; long down-sabers = fierce.' },
  { name: 'tuskDir',     min: -1.0, max: 1.0, default: 0.5, group: 'Features',
    description: 'Tusk direction: +1 up from the lower jaw (cute), -1 down from the upper snout (fierce).' },
  { name: 'tuskCurve',   min: 0.0, max: 1.0, default: 0.5, group: 'Features',
    description: 'Tusk curl: 0 straight, 1 curled back toward the head.' },
  { name: 'frillSize',   min: 0.0, max: 1.5, default: 0.0, group: 'Features',
    description: 'Neck/crest frill size. 0 = none. Soft rounded = axolotl-cute, spiky = cool.' },
  { name: 'frillExtent', min: 0.0, max: 1.0, default: 0.3, group: 'Features',
    description: 'Frill spread: small crown crest -> a wide fan reaching down the neck.' },
  { name: 'frillSoft',   min: 0.0, max: 1.0, default: 0.7, group: 'Features',
    description: 'Frill petal shape: 1 rounded fleshy (axolotl), 0 sharp webbed spikes.' },
  { name: 'barbelLength',min: 0.0, max: 1.5, default: 0.0, group: 'Features',
    description: 'Snout-tip barbel/whisker length (eastern). 0 = none; long = wise flowing tendrils.' },
  { name: 'barbelPairs', min: 1, max: 2, default: 1, step: 1, group: 'Features',
    description: 'Barbel pairs: 1 = snout-tip pair, 2 = adds a chin pair.' },
  { name: 'browWeight',  min: 0.3, max: 1.8, default: 1.0, group: 'Features',
    description: 'Brow thickness multiplier. Heavy = gentle grandpa/bloodhound; thin = sharp hawk.' },
  { name: 'browSag',     min: 0.0, max: 1.0, default: 0.0, group: 'Features',
    description: 'Outer-brow-end downward sag (heavy droopy brow). 0 = the original brow.' },
];

// ---------------------------------------------------------------------------
// DEFAULT_GENOME — derived from the schema so the two never drift apart.
// ---------------------------------------------------------------------------
export const DEFAULT_GENOME = Object.freeze(
  GENOME_SCHEMA.reduce((g, t) => { g[t.name] = t.default; return g; }, {})
);

// Trait names the face rig consumes (used by app.js grouping/live-update too).
// Includes the expressive ear/frill params so the emotion presets + live sliders
// update them WITHOUT a full rebuild (they are rotation-only poses).
export const FACE_TRAITS = ['eyeOpen', 'pupilX', 'pupilY', 'browHeight', 'browAngle', 'browCurve', 'mouthOpen', 'mouthCurve', 'earPerk', 'earPitch', 'earFlare', 'frillFlare'];

// ---------------------------------------------------------------------------
// ARCHETYPES — full genome objects that are attractor points in the continuous
// trait space. Each is a valid pose of the ONE fixed skeleton; only bone
// lengths/radii differ. Used for evaluation (render each across ages 0/0.5/1).
// ---------------------------------------------------------------------------
function withDefaults(overrides) {
  return { ...DEFAULT_GENOME, ...overrides };
}
// Every archetype is a strict TETRAPOD (2 girdles, 4 limbs). The front pair is
// EITHER a leg/hand OR a wing — never both — because both are the same forelimb;
// the difference is only armLength / finger lengths / wingMembrane (the case
// table in the spec). No archetype carries walking forelegs AND a separate wing.
export const ARCHETYPES = {
  // Snake: reduced front & back pair (lengths ~0), very long body/neck/tail.
  snake: withDefaults({
    bodyElongation: 2.3, robustness: 0.78, neckLength: 1.8, tailLength: 2.6,
    girdleWidth: 0.5, headSize: 0.9, snoutLength: 0.8, jawSize: 0.9,
    armLength: 0.0, finger0Length: 0.0, finger1Length: 0.0, finger2Length: 0.0,
    finger3Length: 0.0, foreClawSize: 0.0, wingMembrane: 0.0,
    hindLegLength: 0.0, toeCount: 0, hindClawSize: 0.0,
    colorHue: 0.32, colorSaturation: 0.65,
  }),
  // Drake (vestigial quadruped WALKER): forearm ≈ hind leg, short primary finger,
  // other fingers present as toes/claws, fringe-only membrane, NO wings. A clawed
  // four-legged walker.
  drake: withDefaults({
    bodyElongation: 1.1, robustness: 1.0, neckLength: 1.0, tailLength: 1.3,
    girdleWidth: 1.3, headSize: 1.1, snoutLength: 1.0, jawSize: 1.2, limbThickness: 1.3,
    armLength: 1.1, finger0Length: 0.5, finger1Length: 0.55, finger2Length: 0.5,
    finger3Length: 0.45, fingerSpread: 0.7, foreClawSize: 0.9, wingMembrane: 0.12,
    hindLegLength: 1.1, toeCount: 3, hindClawSize: 0.9,
    colorHue: 0.6, colorSaturation: 0.6,
  }),
  // Wyvern (BIPEDAL FLYER): short arm, long primary spar, a few short extra spars,
  // full membrane => a real bat wing. Strong hind legs. The natural flyer.
  wyvern: withDefaults({
    bodyElongation: 1.0, robustness: 0.8, neckLength: 1.2, tailLength: 1.6,
    girdleWidth: 1.0, headSize: 1.05, snoutLength: 1.1, jawSize: 1.1, limbThickness: 1.05,
    armLength: 0.9, finger0Length: 3.1, finger1Length: 2.0, finger2Length: 1.6,
    finger3Length: 1.2, fingerSpread: 0.95, foreClawSize: 0.5, wingMembrane: 1.0,
    hindLegLength: 1.15, toeCount: 3, hindClawSize: 0.8,
    colorHue: 0.02, colorSaturation: 0.7,
  }),
  // Crawler-flyer (bat/pterosaur plan): primary spar ≈ hind leg, full membrane,
  // several extra spars. Rest pose holds the wing out (the knuckle-walk fold is
  // deferred pose work).
  crawlerFlyer: withDefaults({
    bodyElongation: 1.15, robustness: 0.85, neckLength: 1.0, tailLength: 1.5,
    girdleWidth: 1.1, headSize: 1.0, snoutLength: 0.9, jawSize: 1.0, limbThickness: 1.1,
    armLength: 1.05, finger0Length: 2.7, finger1Length: 1.85, finger2Length: 1.5,
    finger3Length: 1.25, fingerSpread: 0.95, foreClawSize: 0.7, wingMembrane: 1.0,
    hindLegLength: 1.0, toeCount: 3, hindClawSize: 0.8,
    colorHue: 0.75, colorSaturation: 0.55,
  }),
  // Grasper (T-rex arms): short arm, huge fingers, no membrane — clawed graspers.
  grasper: withDefaults({
    bodyElongation: 1.05, robustness: 0.95, neckLength: 1.0, tailLength: 1.3,
    girdleWidth: 1.1, headSize: 1.15, snoutLength: 1.0, jawSize: 1.25, limbThickness: 1.7,
    armLength: 0.6, finger0Length: 0.95, finger1Length: 0.9, finger2Length: 0.8,
    finger3Length: 0.55, fingerSpread: 0.55, foreClawSize: 1.35, wingMembrane: 0.0,
    hindLegLength: 1.15, toeCount: 3, hindClawSize: 1.0,
    colorHue: 0.08, colorSaturation: 0.75,
  }),
  // --- aliases (kept so the harness's hard-coded <select> options resolve) ----
  // Quadruped -> the drake walker.
  quadruped: withDefaults({
    bodyElongation: 1.1, robustness: 1.0, neckLength: 1.0, tailLength: 1.3,
    girdleWidth: 1.3, headSize: 1.1, snoutLength: 1.0, jawSize: 1.2, limbThickness: 1.3,
    armLength: 1.1, finger0Length: 0.5, finger1Length: 0.55, finger2Length: 0.5,
    finger3Length: 0.45, fingerSpread: 0.7, foreClawSize: 0.9, wingMembrane: 0.12,
    hindLegLength: 1.1, toeCount: 3, hindClawSize: 0.9,
    colorHue: 0.6, colorSaturation: 0.6,
  }),
  // Eastern / Chinese: elongated, small dainty limbs, no wings (strict tetrapod).
  eastern: withDefaults({
    bodyElongation: 2.0, robustness: 0.8, neckLength: 2.0, tailLength: 2.4,
    girdleWidth: 0.8, headSize: 1.1, snoutLength: 1.2, jawSize: 1.0, limbThickness: 0.8,
    armLength: 0.6, finger0Length: 0.4, finger1Length: 0.4, finger2Length: 0.35,
    finger3Length: 0.3, fingerSpread: 0.6, foreClawSize: 0.7, wingMembrane: 0.0,
    hindLegLength: 0.6, toeCount: 3, hindClawSize: 0.7,
    colorHue: 0.11, colorSaturation: 0.8,
  }),
};
// Expose for headless verification / console poking without touching app.js
// (app.js assigns window.__testbed later; we use a separate, un-clobbered key).
if (typeof window !== 'undefined') {
  window.__ARCHETYPES = ARCHETYPES;
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EPS = 0.012; // below this envelope radius a part is treated as "absent"

// Resolved WORLD ear length (base->tip) for a given head radius R + genome ear
// size/length. Single source of truth so the ear BONE chain (buildSkeleton) and
// the ear SHEET mesh (face.js) agree, and so the scale-hotfix clamp lives in one
// place: length factor 1.35 (was 1.85), final extent clamped to <= 1.1x head Ø.
export const resolveEarLen = (R, earSize, earLength) =>
  Math.min(earSize * R * (earLength ?? 1) * 1.35, 2.2 * R);

// Base (adult-neutral) dimensions. Everything scales off these.
const U = {
  trunkHalf: 1.35,   // half-length of the trunk (shoulder..hip)
  neckReach: 1.6,    // forward reach of the neck at neckLength=1
  neckRise:  1.0,    // upward rise of the neck
  tailReach: 2.2,    // backward reach of the tail at tailLength=1
  tailDroop: 0.7,    // downward droop of the tail tip
  girth:     0.62,   // base torso envelope radius
  headR:     0.72,   // base skull radius
  legUpper:  0.62,   // upper leg length
  legLower:  0.55,   // lower leg length
  legR:      0.17,   // base limb envelope radius (arms + legs)
  footR:     0.15,   // foot radius
  armUpper:  0.60,   // shoulder->elbow at armLength=1
  armLower:  0.52,   // elbow->wrist at armLength=1
  fingerBase:0.95,   // finger/spar length at fingerXLength=1
  fingerR:   0.085,  // base finger phalanx radius (chunkier fingers/spars/toes)
  toeBase:   0.30,   // hind toe length at hindLegLength=1
};

const SHOULDER_IDX = 6;   // trunk vertebra the shoulder girdle / forelimbs hang from
const HIP_IDX = 20;       // trunk vertebra the hip girdle / hind limbs hang from
const N_SPINE = 24;       // spine_00 .. spine_23   (neck -> hip)
const N_TAIL = 12;        // tail_00 .. tail_11      (tail continuation)

// ---------------------------------------------------------------------------
// phenotype(genome, age, env)
// ---------------------------------------------------------------------------
// Turns genome + age into concrete, ready-to-build numbers. This is where the
// allometric (non-uniform) growth lives: babies are NOT small adults — big
// head/eyes, short limbs, absent wings; adults are longer-snouted, leaner,
// winged. `bud*` fields are the limb/wing budding factors (0 => absent).
export function phenotype(genome, age = 0, env = {}) {
  const g = { ...DEFAULT_GENOME, ...genome };
  const a = clamp01(age);

  // Effective (maturation-biased) age, then eased. maturationRate>1 matures sooner.
  const e = clamp01(Math.pow(a, 1 / Math.max(0.2, g.maturationRate)));
  const s = smoothstep(e);

  const sizeBoost = env.sizeBoost ?? 1.0;
  const hueShift  = env.hueShift ?? 0.0;

  // Allometric limb/wing budding. Radius & length rise from ~0 with age. A part
  // whose genome length is ~0 stays visually absent at every age (snake stays
  // limbless); membrane emerges past ~25% age. limbGrowthRate biases timing.
  const budAge = clamp01(Math.pow(e, 1 / Math.max(0.2, g.limbGrowthRate)));
  const legGrow  = lerp(0.10, 1.0, smoothstep(budAge));           // legs: tiny stub -> full
  const wingGrow = smoothstep(clamp01((budAge - 0.22) / 0.72));   // wings: truly 0 young -> emerge

  const neo = g.headNeoteny;

  // Render tier ('high' | 'cheap') threaded to the material factory. env wins,
  // then the window global (headless tools poke it like window.__skinMode).
  const renderTier = env.renderTier
    ?? (typeof window !== 'undefined' ? window.__renderTier : undefined) ?? 'high';

  return {
    ageEased: s,
    globalScale: sizeBoost,
    renderTier,

    // --- head: big & round on babies, proportionate & long-snouted on adults ---
    headScale:   g.headSize * lerp(1.0 + 0.85 * neo, 1.0, s),
    snoutLength: g.snoutLength * lerp(0.30, 1.0, s * s),  // snout emerges late (s^2)
    jawSize:     g.jawSize,
    eyeSize:     g.eyeSize * lerp(1.35 + 0.2 * neo, 0.85, s),
    eyeHeight:   lerp(0.30, 0.58, s),
    eyeFwd:      lerp(0.60, 0.78, s),

    // --- body proportions ---
    bodyElong: g.bodyElongation * lerp(0.80, 1.0, s),
    neckLen:   g.neckLength * lerp(0.35, 1.0, s),
    tailLen:   g.tailLength * lerp(0.45, 1.0, s),
    girdle:    g.girdleWidth,
    // girth: babies rounder relative to length; leaner with age. Softened baby
    // boost (1.18, was 1.28) so even babies read as a body, not a sphere.
    girth:     g.robustness * lerp(1.18, 1.0, s),

    // --- unified bat-wing forelimb (per-side; mirrored) ---
    armLength:     g.armLength,
    finger0Length: g.finger0Length,
    finger1Length: g.finger1Length,
    finger2Length: g.finger2Length,
    finger3Length: g.finger3Length,
    fingerSpread:  g.fingerSpread,
    foreClaw:      g.foreClawSize,
    wingMembrane:  g.wingMembrane,
    // --- hind limbs ---
    hindLegLength: g.hindLegLength,
    toeCount:      g.toeCount,
    hindClaw:      g.hindClawSize,
    // --- budding factors ---
    budLegLen:  legGrow,
    budLegRad:  lerp(0.14, 1.0, smoothstep(budAge)),
    budWing:    wingGrow,
    limbThick:  g.limbThickness * lerp(1.4, 0.9, s), // chubby young -> lean adult

    // --- color: pastel baby -> saturated adult ---
    hue:   (g.colorHue + hueShift + 1) % 1,
    sat:   g.colorSaturation * lerp(0.55, 1.0, s),
    light: lerp(g.colorLightness + 0.12, g.colorLightness, s),

    // --- markings / pattern (CA coloration) ---
    // markingContrast ramps 0.3x -> 1x with age so soft baby skin gains bold
    // adult markings ("markings emerge"). The other params + patternSeed pass
    // straight through (they are the adult destination; age drives emergence via
    // the CA generation count in runMarkingCA).
    markingContrast:   g.markingContrast * lerp(0.30, 1.0, s),
    markingScale:      g.markingScale,
    markingType:       g.markingType,
    markingHue:        g.markingHue,
    patternSeed:       g.patternSeed,
    featurePlasticity: g.featurePlasticity,

    // --- DISCRETE FEATURES (phase 2): spikes / sail / feathers / scutes -------
    // The trait numbers are the ADULT destination (pass-through); AGE drives
    // emergence via the *Grow gates so features are absent/tiny on the baby and
    // grow/sharpen with maturity (cute→cool). featurePlasticity biases timing.
    spikeAmount:     g.spikeAmount,
    spikeSpacing:    g.spikeSpacing,
    spikeSharpness:  g.spikeSharpness * lerp(0.4, 1.0, s),   // rounder young, sharper adult
    crestSail:       g.crestSail,
    spikeRegionBias: g.spikeRegionBias,
    // emergence gates (smoothstep past each growth age, sped by featurePlasticity).
    spikeGrow:   smoothstep(clamp01((e - g.spikeGrowthAge) / (0.42 / Math.max(0.4, g.featurePlasticity)))),
    featherGrow: smoothstep(clamp01((e - 0.18) / (0.5 / Math.max(0.4, g.featurePlasticity)))),
    scuteGrow:   smoothstep(clamp01((e - 0.12) / 0.5)),
    featherCoverage:   g.featherCoverage,
    featherRegionBias: g.featherRegionBias,
    featherLength:     g.featherLength,
    scaleSize:         g.scaleSize,
    scutePlating:      g.scutePlating,

    // --- EARS (structural, age-scaled): baby = big soft floppy-forward, adult =
    //     sleeker, sharper, swept-back. The NEUTRAL pose lerps with age; the
    //     expressive emotion deltas (in face.*) stay identical at every age. ---
    // Ears stay a big cute signature at every age: baby = extra-large soft
    // floppy-forward flap; adult = sleeker but still substantial (never shrinks
    // into a nub). The flap width/length carry through unchanged.
    earSize:    g.earSize * lerp(0.70, 1.0, s),              // proportionate on babies, grows modestly with age
    earLength:  g.earLength,
    earWidth:   g.earWidth,
    earDroop:   clamp01(g.earDroop + lerp(0.22, 0.0, s)),    // floppier young
    earPointed: g.earPointed * lerp(0.55, 1.0, s),           // rounder young, a touch sharper adult
    earPairs:   Math.round(g.earPairs),
    earNeutral: {
      perk:  lerp(0.35, 0.18, s),                            // big soft-up -> composed
      pitch: lerp(0.30, -0.12, s),                           // forward-curious -> gently swept back
      flare: lerp(0.15, 0.05, s),
    },

    // --- FEATURES (genome-optional; age-gated like wings/horns) ---
    tuskSize:   g.tuskSize * smoothstep(clamp01((e - 0.30) / 0.55)),  // grow in past ~30% age
    tuskDir:    g.tuskDir,
    tuskCurve:  g.tuskCurve,
    frillSize:  g.frillSize * lerp(0.45, 1.0, s),            // fringe present early (cute!), grows
    frillExtent:g.frillExtent,
    frillSoft:  g.frillSoft,
    barbelLen:  g.barbelLength * smoothstep(clamp01((e - 0.25) / 0.6)),
    barbelPairs:Math.round(g.barbelPairs),
    browWeight: g.browWeight,
    browSag:    g.browSag,

    // --- face params (gentle age drift: wide-innocent -> confident) ---
    face: {
      eyeOpen:    g.eyeOpen * lerp(1.0, 0.9, s),
      pupilX:     g.pupilX,
      pupilY:     g.pupilY + lerp(-0.12, 0.0, s),
      browHeight: g.browHeight + lerp(0.12, 0.0, s),
      browAngle:  g.browAngle + lerp(-0.15, 0.1, s),
      browCurve:  g.browCurve + lerp(0.25, 0.0, s),
      // mouth: babies read a touch smilier & rounder, softening toward the adult.
      mouthOpen:  g.mouthOpen,
      mouthCurve: g.mouthCurve + lerp(0.12, 0.0, s),
      // expressive ear/frill deltas (identical at every age; neutral pose ages).
      earPerk:    g.earPerk,
      earPitch:   g.earPitch,
      earFlare:   g.earFlare,
      frillFlare: g.frillFlare,
    },
  };
}

// ---------------------------------------------------------------------------
// buildSkeleton(p) — resolve the FIXED-TOPOLOGY bone tree for this phenotype.
// ---------------------------------------------------------------------------
// Returns { bones, byName } where bones is an array of:
//   { name, parent, pos:Vector3, length, envelopeRadius,
//     tail?:Vector3, rTail?:number, kind }
// The bone NAME SET is identical for every genome/age; only pos/length/radius
// change. `pos`+`tail`+`envelopeRadius` are the per-bone capsule envelope that
// Step 2's implicit field will sum. `kind` tags render style.
function buildSkeleton(p) {
  const bones = [];
  const byName = {};
  const add = (b) => { bones.push(b); byName[b.name] = b; return b; };
  const spineName = (i) => `spine_${String(i).padStart(2, '0')}`;
  const tailName = (j) => `tail_${String(j).padStart(2, '0')}`;

  // ---- backbone geometry (world space, pre-lift) --------------------------
  const trunkHalf = U.trunkHalf * p.bodyElong;
  const zSh = trunkHalf;          // shoulder end (+z front)
  const zHip = -trunkHalf;        // hip end
  const backArch = lerp(0.28, 0.10, p.ageEased); // rounder baby back

  // Neck: quadratic bezier from shoulder S up-forward to head base H.
  const S = V(0, 0, zSh);
  const H = V(0, U.neckRise * p.neckLen, zSh + U.neckReach * p.neckLen);
  const Cn = V(0, U.neckRise * p.neckLen * 1.05, zSh + U.neckReach * p.neckLen * 0.35);
  const bez = (P0, C, P1, t) => {
    const u = 1 - t;
    return V(
      0,
      u * u * P0.y + 2 * u * t * C.y + t * t * P1.y,
      u * u * P0.z + 2 * u * t * C.z + t * t * P1.z
    );
  };

  // Spine points P[0..23] and radii RAD[0..23]. 0..5 = neck (head->shoulder),
  // 6..23 = trunk (shoulder->hip).
  const P = new Array(N_SPINE);
  const RAD = new Array(N_SPINE);
  const girthScale = p.girth;
  for (let i = 0; i < 6; i++) {
    const t = (5 - i) / 5;                    // spine_00 = head end (t=1)
    P[i] = bez(S, Cn, H, t);
    // neck thin near head, thicker near shoulder
    RAD[i] = girthScale * lerp(0.50, 0.28, t) * (0.85 + 0.15 * p.ageEased);
  }
  for (let i = 6; i < N_SPINE; i++) {
    const f = (i - 6) / (N_SPINE - 1 - 6);    // 0 at shoulder .. 1 at hip
    const z = lerp(zSh, zHip, f);
    const y = backArch * Math.sin(Math.PI * f) * 0.5; // gentle arch
    P[i] = V(0, y, z);
    // torso profile: tapered toward the shoulder/hip ends with a moderate
    // mid-abdomen bump. Thinner ends + a lower mid keep the trunk reading as a
    // longer-than-wide body, not a beach-ball sphere.
    RAD[i] = girthScale * (0.72 + 0.5 * Math.sin(Math.PI * clamp01(f)));
  }

  // Tail points T[0..11], radii TR[0..11] continuing from the hip.
  const hip = P[N_SPINE - 1];
  const tailTip = V(0, hip.y - U.tailDroop * p.tailLen, hip.z - U.tailReach * p.tailLen);
  const Ct = V(0, hip.y - U.tailDroop * p.tailLen * 0.25, hip.z - U.tailReach * p.tailLen * 0.5);
  const T = new Array(N_TAIL);
  const TR = new Array(N_TAIL);
  for (let j = 0; j < N_TAIL; j++) {
    const t = (j + 1) / N_TAIL;
    T[j] = bez(hip, Ct, tailTip, t);
    TR[j] = girthScale * lerp(0.50, 0.045, t);
  }

  // ---- spine bones --------------------------------------------------------
  for (let i = 0; i < N_SPINE; i++) {
    const tail = i < N_SPINE - 1 ? P[i + 1] : T[0];
    const rTail = i < N_SPINE - 1 ? RAD[i + 1] : TR[0];
    add({
      name: spineName(i), parent: i === 0 ? null : spineName(i - 1),
      pos: P[i], envelopeRadius: RAD[i], tail, rTail,
      length: P[i].distanceTo(tail), kind: 'body',
    });
  }
  // ---- tail bones ---------------------------------------------------------
  for (let j = 0; j < N_TAIL; j++) {
    const tail = j < N_TAIL - 1 ? T[j + 1] : T[j].clone().add(V(0, -0.02, -0.04));
    const rTail = j < N_TAIL - 1 ? TR[j + 1] : 0.02;
    add({
      name: tailName(j),
      parent: j === 0 ? spineName(N_SPINE - 1) : tailName(j - 1),
      pos: T[j], envelopeRadius: TR[j], tail, rTail,
      length: T[j].distanceTo(tail), kind: 'body',
    });
  }

  // ---- head: skull + snout + jaw + face anchor ----------------------------
  const R = U.headR * p.headScale;
  // forward direction of the head = along the neck's last segment.
  const fwd = P[0].clone().sub(P[1]).normalize();
  const skullPos = P[0].clone().add(fwd.clone().multiplyScalar(R * 0.7)).add(V(0, R * 0.1, 0));
  add({ name: 'skull', parent: 'spine_00', pos: skullPos, envelopeRadius: R,
        length: R, kind: 'skull', fwd, headR: R });

  const snoutLen = R * (0.7 + 1.2 * p.snoutLength);
  const snoutBase = skullPos.clone().add(V(0, -R * 0.12, 0)).add(fwd.clone().multiplyScalar(R * 0.55));
  const snoutTip = snoutBase.clone().add(V(0, -R * 0.05, 0)).add(fwd.clone().multiplyScalar(snoutLen));
  add({ name: 'snout', parent: 'skull', pos: snoutBase, tail: snoutTip,
        envelopeRadius: R * 0.5, rTail: R * 0.26, length: snoutLen, kind: 'body' });

  const jawBase = snoutBase.clone().add(V(0, -R * 0.34, 0));
  const jawTip = jawBase.clone().add(fwd.clone().multiplyScalar(snoutLen * 0.85 * p.jawSize));
  add({ name: 'jaw', parent: 'skull', pos: jawBase, tail: jawTip,
        envelopeRadius: R * 0.30 * p.jawSize, rTail: R * 0.16 * p.jawSize,
        length: snoutLen * 0.85, kind: 'body' });

  // ---- girdles ------------------------------------------------------------
  // Transverse bars linking the two sockets; radius gated by limb presence so a
  // limbless snake shows no girdle bar (but the bone is ALWAYS emitted).
  const addGirdle = (name, idx, present) => {
    const anchor = P[idx];
    const torsoR = RAD[idx];
    const half = torsoR * 0.9 * p.girdle;
    const r = (present > EPS) ? torsoR * 0.35 : 0;
    add({ name, parent: idx < 12 ? spineName(SHOULDER_IDX) : spineName(HIP_IDX),
          pos: anchor.clone().add(V(-half, -torsoR * 0.15, 0)),
          tail: anchor.clone().add(V(half, -torsoR * 0.15, 0)), envelopeRadius: r, rTail: r,
          length: 2 * half, kind: 'girdle' });
  };
  addGirdle('shoulderGirdle', SHOULDER_IDX, p.armLength * p.budLegLen);
  addGirdle('hipGirdle', HIP_IDX, p.hindLegLength * p.budLegLen);

  // small vector helpers
  const nrm = (v) => v.clone().normalize();
  const mixV = (a, b, t) => a.clone().multiplyScalar(1 - t).add(b.clone().multiplyScalar(t));
  const seg2 = (n) => String(n).padStart(2, '0');

  const budR = p.budLegRad;
  const budL = p.budLegLen;
  const limbR = U.legR * p.limbThick * budR;   // shared arm/leg radius

  // ---- UNIFIED BAT-WING FORELIMB (per side) -------------------------------
  // Fixed topology:  shoulderGirdle -> {tag}_upperArm -> {tag}_foreArm ->
  //   {tag}_wrist -> finger0(3 phalanges) + finger1..finger3(2 phalanges each),
  //   each finger optionally capped by a {tag}_fingerN_claw. The SAME bones exist
  //   for every genome; only lengths/radii vary (finger length ~0 => absent).
  // The arm posture blends from a down-reaching LEG (walker) to an out/up WING
  // (flyer) by `wingness` — driven by wingMembrane (rest-pose only; the wrist
  // fold / weight-bearing walk is deferred pose/animation work).
  const wings = [];   // per-side membrane spec, consumed by generateDragon
  const FINGER_SEGS = [3, 2, 2, 2];
  const buildForelimb = (side) => {
    const tag = 'fore' + (side < 0 ? 'L' : 'R');
    const anchor = P[SHOULDER_IDX];
    const torsoR = RAD[SHOULDER_IDX];
    const upperLen = U.armUpper * p.armLength * budL;
    const foreLen  = U.armLower * p.armLength * budL;
    const armR = limbR * smoothstep(clamp01(p.armLength / 0.12)); // radius 0 when armLength ~0
    const wn = clamp01(p.wingMembrane);                 // 0 = leg pose, 1 = wing pose

    // shoulder socket: low on the flank for a walker, high on the back for a flyer
    const socket = anchor.clone().add(V(side * torsoR * 0.9 * p.girdle, torsoR * lerp(-0.15, 0.45, wn), 0));
    // upper arm: down-reaching leg (walker) -> raised up+out (flyer)
    const armDir = nrm(mixV(nrm(V(side * 0.18, -1.0, 0.10)),
                            nrm(V(side * 0.62, 0.78, 0.02)), wn));
    const elbow = socket.clone().add(armDir.multiplyScalar(upperLen));
    // forearm continues out; raised for the wing
    const foreDir = nrm(mixV(nrm(V(side * 0.06, -1.0, 0.26)),
                             nrm(V(side * 0.85, 0.48, -0.08)), wn));
    const wrist = elbow.clone().add(foreDir.multiplyScalar(foreLen));

    add({ name: `${tag}_upperArm`, parent: 'shoulderGirdle', pos: socket, tail: elbow,
          envelopeRadius: armR, rTail: armR * 0.85, length: upperLen, kind: 'limb' });
    add({ name: `${tag}_foreArm`, parent: `${tag}_upperArm`, pos: elbow, tail: wrist,
          envelopeRadius: armR * 0.85, rTail: armR * 0.72, length: foreLen, kind: 'limb' });
    const wristTail = wrist.clone().add(foreDir.clone().multiplyScalar(Math.max(0.02, armR)));
    add({ name: `${tag}_wrist`, parent: `${tag}_foreArm`, pos: wrist, tail: wristTail,
          envelopeRadius: armR * 0.7, rTail: armR * 0.6, length: wrist.distanceTo(wristTail),
          kind: 'limb' });

    // finger fan frame: `lead` = leading direction (finger0), `fanAxis` = the
    // direction later fingers rotate toward (splay). Both blend leg<->wing.
    const lead = nrm(mixV(nrm(V(side * 0.05, -0.5, 1.0)),   // toes forward/down (walker)
                          nrm(V(side * 0.72, 0.38, -0.55)), wn)); // spar out/up/back = leading edge
    const fanAxis = nrm(mixV(nrm(V(side * 0.85, -0.10, 0.15)),   // splay sideways (hand)
                             nrm(V(-side * 0.12, -0.92, -0.32)), wn)); // sweep DOWN = wing trailing edge
    const spread = 0.15 + 0.80 * p.fingerSpread;
    const fingerLens = [p.finger0Length, p.finger1Length, p.finger2Length, p.finger3Length];

    const tips = [];   // present fingertips (in fan order) for the membrane
    for (let fi = 0; fi < 4; fi++) {
      const totalLen = U.fingerBase * fingerLens[fi] * budL;
      const present = totalLen > 0.05;
      const dir0 = nrm(mixV(lead, fanAxis, (fi / 3) * spread));
      const nseg = FINGER_SEGS[fi];
      const segLen = totalLen / nseg;
      const baseR = present ? U.fingerR * p.limbThick * (1.0 - 0.14 * fi) : 0;
      let base = wrist.clone();
      let dir = dir0.clone();
      let parent = `${tag}_wrist`;
      let lastName = parent, tip = base.clone(), tipDir = dir.clone();
      for (let s2 = 0; s2 < nseg; s2++) {
        if (s2 > 0) dir = nrm(mixV(dir, V(dir.x, dir.y - 0.6, dir.z), 0.18)); // gentle curl
        const next = base.clone().add(dir.clone().multiplyScalar(segLen));
        const r0 = baseR * (1 - 0.18 * s2);
        const r1 = baseR * (1 - 0.18 * (s2 + 1));
        const nm = `${tag}_finger${fi}_${seg2(s2)}`;
        add({ name: nm, parent, pos: base, tail: next,
              envelopeRadius: r0, rTail: Math.max(r1, present ? 0.02 : 0),
              length: segLen, kind: 'finger' });
        parent = nm; base = next; tip = next; tipDir = dir.clone();
      }
      lastName = parent;
      // claw at the fingertip
      const clawLen = U.fingerBase * 0.20 * p.foreClaw;
      const clawR = present && p.foreClaw > 0.02 ? baseR * 0.9 : 0;
      const clawTip = tip.clone().add(nrm(mixV(tipDir, V(tipDir.x, tipDir.y - 0.9, tipDir.z), 0.45))
                        .multiplyScalar(clawLen));
      add({ name: `${tag}_finger${fi}_claw`, parent: lastName, pos: tip, tail: clawTip,
            envelopeRadius: clawR, rTail: 0.006, length: clawLen, kind: 'claw' });
      if (present) tips.push(tip);
    }

    // membrane spec (built as a separate mesh downstream; NOT a field bone).
    const hipAnchor = P[HIP_IDX].clone().add(V(side * RAD[HIP_IDX] * 0.55, -RAD[HIP_IDX] * 0.15, 0));
    wings.push({ side, socket, elbow, wrist, tips, hipAnchor,
                 amount: clamp01(p.wingMembrane) * p.budWing });
  };

  // ---- HIND LEG (leg ending in a toed foot with claws) --------------------
  const buildHindLeg = (side) => {
    const tag = 'hind' + (side < 0 ? 'L' : 'R');
    const anchor = P[HIP_IDX];
    const torsoR = RAD[HIP_IDX];
    const upperLen = U.legUpper * p.hindLegLength * budL;
    const lowerLen = U.legLower * p.hindLegLength * budL;
    const footFwd = 0.24 * p.hindLegLength * budL;
    const legR = limbR * smoothstep(clamp01(p.hindLegLength / 0.12)); // radius 0 when legless

    const socket = anchor.clone().add(V(side * torsoR * 0.9 * p.girdle, -torsoR * 0.15, 0));
    const knee = socket.clone().add(V(side * 0.06, -upperLen, 0.05));
    const ankle = knee.clone().add(V(-side * 0.02, -lowerLen, 0.07));
    const footPad = ankle.clone().add(V(0, -U.footR * budR * 0.4, footFwd + U.footR * budR));

    add({ name: `${tag}_upper`, parent: 'hipGirdle', pos: socket, tail: knee,
          envelopeRadius: legR, rTail: legR * 0.82, length: upperLen, kind: 'limb' });
    add({ name: `${tag}_lower`, parent: `${tag}_upper`, pos: knee, tail: ankle,
          envelopeRadius: legR * 0.82, rTail: legR * 0.7, length: lowerLen, kind: 'limb' });
    add({ name: `${tag}_foot`, parent: `${tag}_lower`, pos: ankle, tail: footPad,
          envelopeRadius: legR * 0.78, rTail: U.footR * budR * (legR > EPS ? 1 : 0),
          length: footFwd, kind: 'foot', footY: footPad.y - U.footR * budR });

    // toes fan forward off the foot pad; toeCount sets how many are developed.
    const nToes = Math.max(0, Math.min(4, Math.round(p.toeCount)));
    for (let ti = 0; ti < 4; ti++) {
      const present = ti < nToes && p.hindLegLength > 0.05;
      const toeLen = U.toeBase * p.hindLegLength * budL;
      const frac = nToes > 1 ? (ti / (nToes - 1) - 0.5) : 0;     // -0.5..0.5 across
      const dir = nrm(V(side * 0.1 + frac * 0.55, -0.30, 1.0));
      const toeTip = footPad.clone().add(dir.clone().multiplyScalar(toeLen));
      const r = present ? U.fingerR * p.limbThick * 0.95 : 0;
      add({ name: `${tag}_toe${ti}`, parent: `${tag}_foot`, pos: footPad, tail: toeTip,
            envelopeRadius: r, rTail: Math.max(r * 0.7, present ? 0.02 : 0),
            length: toeLen, kind: 'toe', footY: toeTip.y - r });
      const clawLen = U.toeBase * 0.5 * p.hindClaw;
      const clawR = present && p.hindClaw > 0.02 ? r * 0.9 : 0;
      const clawTip = toeTip.clone().add(nrm(V(side * 0.05 + frac * 0.4, -0.5, 0.9))
                        .multiplyScalar(clawLen));
      add({ name: `${tag}_toe${ti}_claw`, parent: `${tag}_toe${ti}`, pos: toeTip, tail: clawTip,
            envelopeRadius: clawR, rTail: 0.006, length: clawLen, kind: 'claw' });
    }
  };

  for (const side of [-1, 1]) { buildForelimb(side); buildHindLeg(side); }

  // ---- EARS: 3-bone chain per side (root->mid->tip), parented to `skull` -----
  // Added for EVERY genome (fixed-topology invariant) — zero-length when earSize
  // ~0, exactly like absent limbs. envelopeRadius 0 (< EPS) so the implicit
  // field / voxelizer / nearest-bone candidate set all skip them: the body skin
  // and skinIndex values are UNAFFECTED. Appended LAST so they never perturb the
  // ordered body-bone indices. The main ear SHEET (face.js) skins to these; the
  // chain rests straight up (+Y) — expression/age become bone rotations on top,
  // matching the world-axis posing math the rigid ears already used.
  const earLenW = resolveEarLen(R, p.earSize, p.earLength);
  const earStep = Math.max(1e-3, earLenW / 3);
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'earL' : 'earR';
    const rootP = skullPos.clone().add(V(side * R * 0.62, R * 0.55, -R * 0.10));
    const midP = rootP.clone().add(V(0, earStep, 0));
    const tipP = rootP.clone().add(V(0, 2 * earStep, 0));
    const tipTail = rootP.clone().add(V(0, 3 * earStep, 0));
    add({ name: `${tag}_root`, parent: 'skull', pos: rootP, tail: midP,
          envelopeRadius: 0, rTail: 0, length: earStep, kind: 'ear' });
    add({ name: `${tag}_mid`, parent: `${tag}_root`, pos: midP, tail: tipP,
          envelopeRadius: 0, rTail: 0, length: earStep, kind: 'ear' });
    add({ name: `${tag}_tip`, parent: `${tag}_mid`, pos: tipP, tail: tipTail,
          envelopeRadius: 0, rTail: 0, length: earStep, kind: 'ear' });
  }

  return { bones, byName, wings };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
// Material factories now live in materials.js (tier-aware PBR). Thin wrappers keep
// the local call sites unchanged; each reads the phenotype's resolved renderTier.
const bodyMaterial = (p) => MAT.bodyMaterial(p, p.renderTier);
const bellyMaterial = (p) => MAT.bellyMaterial(p, p.renderTier);
const hardMaterial = (p) => MAT.hardMaterial(p, p.renderTier);
const membraneMaterial = (p) => MAT.membraneMaterial(p, p.renderTier);

// ---------------------------------------------------------------------------
// Capsule rendering helpers
// ---------------------------------------------------------------------------
const _up = new THREE.Vector3(0, 1, 0);
const _unitSphere = new THREE.SphereGeometry(1, 14, 12);

function addTaperedCapsule(group, a, b, ra, rb, mat) {
  if (ra < EPS && rb < EPS) return;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return;
  const geo = new THREE.CylinderGeometry(Math.max(rb, 1e-3), Math.max(ra, 1e-3), len, 10, 1, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, dir.normalize());
  mesh.castShadow = true;
  group.add(mesh);
}
function addSphere(group, pos, r, mat, scale = null) {
  if (r < EPS) return;
  const m = new THREE.Mesh(_unitSphere, mat);
  m.position.copy(pos);
  if (scale) m.scale.copy(scale); else m.scale.setScalar(r);
  m.castShadow = true;
  group.add(m);
}

// Draw a bone's capsule (pos->tail, envelopeRadius->rTail) + a joint sphere at pos.
// Stamps `userData.boneName` on every mesh it adds so the animation rig can rigid-
// attach these layered capsules (fingers/toes/claws) to their bone (rig.js).
function renderBoneCapsule(group, bone, mat) {
  if (bone.envelopeRadius < EPS) return;
  const start = group.children.length;
  addSphere(group, bone.pos, bone.envelopeRadius, mat);
  if (bone.tail && bone.rTail !== undefined) {
    addTaperedCapsule(group, bone.pos, bone.tail, bone.envelopeRadius, bone.rTail, mat);
  }
  for (let i = start; i < group.children.length; i++) group.children[i].userData.boneName = bone.name;
}

// ---------------------------------------------------------------------------
// Wing membrane mesh — a thin DOUBLE-SIDED sheet spanning the forelimb.
// ---------------------------------------------------------------------------
// The membrane fills BEHIND the leading edge (arm + fingers) back to a trailing
// anchor on the body flank. It is a triangle FAN rooted at the wrist across the
// ordered boundary loop [socket, elbow, fingertip0..N, bodyAnchor]. Multiple long
// fingers therefore yield multiple panels automatically. Flat quad/tri sheet, so
// it renders identically in smooth, capsule AND voxel modes (the spec's cheap
// "flat quad sheet" for voxel/MC — no thin-surface voxelization). Returns null
// when there is no membrane (bare arm/leg) or nothing to span.
function buildMembraneMesh(spec, baseMat) {
  const { socket, elbow, wrist, tips, hipAnchor, amount } = spec;
  if (amount < 0.03 || tips.length < 1) return null;
  // Fringe (low amount) pulls the trailing body anchor toward the wrist so a low
  // membrane reads as a thin leading-edge fringe; full membrane reaches the flank.
  const bodyAnchor = wrist.clone().lerp(hipAnchor, amount);
  const loop = [socket, elbow, ...tips, bodyAnchor];
  const pos = [];
  const push = (v) => pos.push(v.x, v.y, v.z);
  for (let k = 0; k < loop.length; k++) {         // fan from the wrist
    push(wrist); push(loop[k]); push(loop[(k + 1) % loop.length]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // Map fullness onto per-panel translucency: high tier ramps `transmission`
  // (baby fringe glows more), cheap tier keeps the old opacity ramp.
  const m = MAT.tuneMembranePanel(baseMat.clone(), amount, 'membrane');
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'membrane';
  return mesh;
}

// ---------------------------------------------------------------------------
// Tusks/fangs + barbels/whiskers — small STATIC layered meshes built into the
// head group in head-local space (origin = skull world pos), so they render over
// smooth AND voxel skin. Both are genome-optional (default absent). Expression-
// free: they ride the head, and visually "move" only when mouthOpen changes.
// ---------------------------------------------------------------------------
function addTusksAndBarbels(head, p, byName, skull) {
  const origin = skull.pos;
  const R = skull.headR;
  const fwd = skull.fwd.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const lat = new THREE.Vector3().crossVectors(up, fwd).normalize();   // lateral axis
  const snoutB = byName['snout'], jawB = byName['jaw'];

  // ---- tusks / fangs -----------------------------------------------------
  if (p.tuskSize > 0.02) {
    const ivory = MAT.ivoryMaterial(p.renderTier);
    const dir = Math.max(-1, Math.min(1, p.tuskDir));   // + up (from jaw), - down (sabers)
    const len = R * 0.55 * p.tuskSize;
    const baseR = R * 0.06 * (0.7 + 0.5 * p.tuskSize);
    // up-tusks poke over the lip from the lower jaw; down-sabers hang off the snout.
    const mouthFront = snoutB.tail.clone().lerp(jawB.tail, dir > 0 ? 0.62 : 0.4);
    for (const side of [-1, 1]) {
      const base = mouthFront.clone()
        .add(lat.clone().multiplyScalar(side * (snoutB.rTail * 0.8 + baseR)))
        .add(up.clone().multiplyScalar(dir * R * 0.02))
        .sub(origin);
      const grow = up.clone().multiplyScalar(dir).add(fwd.clone().multiplyScalar(0.35)).normalize();
      const mid = base.clone().add(grow.clone().multiplyScalar(len * 0.6));
      // curl the tip back toward the head with tuskCurve.
      const curl = fwd.clone().multiplyScalar(-p.tuskCurve * 0.5)
        .add(up.clone().multiplyScalar(dir * 0.5)).normalize();
      const tip = mid.clone().add(curl.multiplyScalar(len * 0.5));
      addTaperedCapsule(head, base, mid, baseR, baseR * 0.6, ivory);
      addTaperedCapsule(head, mid, tip, baseR * 0.6, baseR * 0.12, ivory);
    }
  }

  // ---- barbels / whiskers (eastern) --------------------------------------
  if (p.barbelLen > 0.02) {
    const barbelMat = MAT.barbelMaterial(p, p.renderTier);
    const len = R * 0.9 * p.barbelLen;
    const baseR = R * 0.035;
    const pairs = Math.max(1, Math.min(2, Math.round(p.barbelPairs)));
    const anchors = [snoutB.tail.clone()];                       // snout-tip pair
    if (pairs > 1) anchors.push(jawB.tail.clone().add(up.clone().multiplyScalar(-R * 0.03))); // chin pair
    for (let pi = 0; pi < pairs; pi++) {
      const a = anchors[pi];
      for (const side of [-1, 1]) {
        const bpos = a.clone().add(lat.clone().multiplyScalar(side * R * 0.18)).sub(origin);
        const mid = bpos.clone().add(fwd.clone().multiplyScalar(len * 0.5)).add(up.clone().multiplyScalar(-len * 0.15));
        const tip = mid.clone().add(fwd.clone().multiplyScalar(len * 0.32)).add(up.clone().multiplyScalar(-len * 0.5));
        addTaperedCapsule(head, bpos, mid, baseR, baseR * 0.6, barbelMat);
        addTaperedCapsule(head, mid, tip, baseR * 0.6, baseR * 0.15, barbelMat);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// generateDragon(genome, age, env) — public entry point.
// ---------------------------------------------------------------------------
// Returns a THREE.Group named 'dragon' with:
//   dragon (Group)  userData:{ genome, age, env, phenotype, skeleton }
//   ├── body   (Group)  spine + tail capsule chain, belly patch
//   ├── head   (Group)  userData:{ faceRig, headRadius }  skull+snout+jaw+faceRig
//   ├── limbs  (Group)  fore/hind arm+leg capsules + girdles (capsule mode only)
//   ├── appendages (Group)  finger/toe capsules + claws (ALL modes — thin spars
//   │                   stay crisp instead of vanishing in the coarse field)
//   ├── wings  (Group)  double-sided membrane sheet(s) spanning each forelimb
//   └── rigDebug (LineSegments)  ONLY when env.showRig (or window.__showRig)
//
// `env.showRig` (or the global window.__showRig) toggles a thin-line bone overlay.
export function generateDragon(genome = DEFAULT_GENOME, age = 0, env = {}) {
  const p = phenotype(genome, age, env);
  const mat = bodyMaterial(p);
  const bellyMat = bellyMaterial(p);
  const hardMat = hardMaterial(p);

  const { bones, byName, wings: wingSpecs } = buildSkeleton(p);

  const dragon = new THREE.Group();
  dragon.name = 'dragon';

  // ---- CA FEATURE GRID + MARKINGS (phase 1) --------------------------------
  // Body-anchored (u,v) lattice derived deterministically from the skeleton, plus
  // the activator–inhibitor colour CA. `markingState.color` is the smooth marking
  // mask per cell; it is applied as per-vertex colours (smooth) or per-cube tint
  // (voxel) below. `markingState.peak` is reserved for phase-2 discrete features.
  // Age drives the CA generation count so patterns emerge/strengthen with age.
  const featureGrid = buildFeatureGrid(bones);
  const markingState = runMarkingCA(featureGrid, p, age, env);
  dragon.userData.featureGrid = featureGrid;      // for debug overlay / geo.json export
  // PHASE 2: DISCRETE feature geometry (spikes/sail/feathers/scutes) selected off
  // the SAME lattice. `featureState` is the age-INDEPENDENT selection (which cells
  // carry each feature); the age-driven emergence lives in the phenotype gates.
  // The meshes are added as a separate layered `features` group below (after the
  // wings), NOT fed through the implicit field — so the body stays clean and the
  // thin features stay crisp in every skin mode. Stored on userData so the
  // geo.json exporter can bake the voxel spike cubes regardless of skin mode.
  const featureState = buildFeatureState(featureGrid, p);
  dragon.userData.featureState = featureState;

  // Skin mode: 'smooth' = implicit-field + marching-cubes single mesh (default);
  // 'voxel'  = greedy-voxelized cuboids from the SAME field (Minecraft-native,
  //            Step 3); 'capsule' = the Step-1 raw per-bone capsules (fallback).
  // Honors env.skinMode, falling back to a window.__skinMode global so the
  // headless harness can flip modes without editing app.js (same pattern as
  // window.__showRig).
  const skinMode = env.skinMode
    ?? (typeof window !== 'undefined' ? window.__skinMode : undefined)
    ?? 'smooth';
  // 'smooth' and 'voxel' both build ONE solid body FROM THE FIELD that already
  // includes the head (skull/snout/jaw) — so the separate skull/snout/jaw meshes
  // and per-capsule limbs are skipped, and only the face rig layers on top.
  const fieldBody = skinMode === 'smooth' || skinMode === 'voxel';

  const skull = byName['skull'];
  const R = skull.headR;

  if (skinMode === 'smooth') {
    // ---- SMOOTH BODY: one convolution-field marching-cubes mesh -----------
    // Volumetric bone kinds only (body/skull/arm+leg 'limb'/foot/girdle). Fingers,
    // toes, claws and the wing membrane are thin and render as separate meshes.
    const fieldRes = env.fieldRes
      ?? (typeof window !== 'undefined' ? window.__fieldRes : undefined) ?? 64;
    const smoothK = env.smoothK
      ?? (typeof window !== 'undefined' ? window.__fieldSmoothK : undefined);
    const { geometry, stats } = buildFieldMesh(bones, {
      fieldRes,
      ...(smoothK !== undefined ? { smoothK } : {}),
    });
    // Marking coloration: write per-vertex colours from the CA, and give the body
    // mesh its OWN material with vertexColors on + white base so the vertex colour
    // is the final albedo (other groups keep the plain `mat`, unaffected).
    applyMarkingColors(geometry, featureGrid, markingState, p);
    const bodyMat = mat.clone();
    bodyMat.vertexColors = true;
    bodyMat.color.setRGB(1, 1, 1);
    const bodyMesh = new THREE.Mesh(geometry, bodyMat);
    bodyMesh.name = 'body';
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    dragon.add(bodyMesh);
    dragon.userData.fieldStats = stats;
    if (typeof console !== 'undefined') {
      console.log(`[field] marching-cubes ${stats.grid.join('x')} grid, ${stats.envelopes} envelopes`
        + ` -> ${stats.tris} tris / ${stats.verts} verts in ${stats.ms.toFixed(1)} ms`);
    }
  } else if (skinMode === 'voxel') {
    // ---- VOXEL BODY (Step 3): greedy-meshed cuboids from the same field -----
    // Organic rounded silhouette, blocky surface — the Minecraft-native skin.
    // Reads window.__voxelRes (longest-axis voxels) / window.__voxelHeadRes.
    const voxelRes = env.voxelRes
      ?? (typeof window !== 'undefined' ? window.__voxelRes : undefined) ?? 24;
    const headRes = env.voxelHeadRes
      ?? (typeof window !== 'undefined' ? window.__voxelHeadRes : undefined) ?? 1;
    const smoothK = env.smoothK
      ?? (typeof window !== 'undefined' ? window.__fieldSmoothK : undefined);
    // Per-cube marking tint: colour each cube by the CA mask at its centre. Give
    // the voxel body its own vertex-colour material (white base) so the tint is
    // the final albedo without disturbing the shared `mat`.
    const voxCellPos = cellPositions(featureGrid);
    const voxTintCol = new THREE.Color();
    const cubeTint = (cx, cy, cz) =>
      markingColorForPoint(cx, cy, cz, featureGrid, markingState, p, voxCellPos, voxTintCol);
    const voxMat = mat.clone();
    voxMat.vertexColors = true;
    voxMat.color.setRGB(1, 1, 1);
    const { group: bodyGroup, stats } = buildVoxelSkin(bones, {
      voxelRes, headRes, cubeTint,
      ...(smoothK !== undefined ? { smoothK } : {}),
    }, voxMat);
    dragon.add(bodyGroup);
    dragon.userData.voxelCubes = bodyGroup.userData.voxelCubes;
    dragon.userData.fieldStats = stats;
    if (typeof console !== 'undefined') {
      console.log(`[voxel] ${stats.grid.join('x')} grid, ${stats.envelopes} envelopes, ${stats.solidVoxels}`
        + ` solid voxels -> ${stats.cubes} greedy cubes in ${stats.ms.toFixed(1)} ms`
        + (stats.headHiRes > 1 ? ` (head ${stats.headHiRes}x)` : ''));
    }
  } else {
    // ---- CAPSULE BODY (Step-1): spine + tail capsule chain + belly --------
    const body = new THREE.Group();
    body.name = 'body';
    for (const b of bones) {
      if (b.kind === 'body') renderBoneCapsule(body, b, mat);
    }
    // Belly patch: a lighter ellipsoid along the underside of the trunk.
    {
      const shoulder = byName['spine_06'].pos, hipB = byName['spine_20'].pos;
      const mid = shoulder.clone().add(hipB).multiplyScalar(0.5);
      const trunkLen = shoulder.distanceTo(hipB);
      const midR = byName[`spine_${String(Math.round((SHOULDER_IDX + HIP_IDX) / 2)).padStart(2, '0')}`].envelopeRadius;
      const belly = new THREE.Mesh(_unitSphere, bellyMat);
      belly.name = 'belly';
      belly.position.copy(mid).add(V(0, -midR * 0.45, 0));
      belly.scale.set(midR * 0.82, midR * 0.6, trunkLen * 0.5);
      body.add(belly);
    }
    dragon.add(body);
  }

  // ---- HEAD group: face rig always layered ON TOP, at the skull position ---
  // The eyes+brows stay SEPARATE objects over the head so they never get
  // swallowed by the implicit field. In capsule mode the head also renders the
  // skull/snout/jaw meshes; in smooth mode those are part of the field body.
  const head = new THREE.Group();
  head.name = 'head';
  head.position.copy(skull.pos);

  if (!fieldBody) {
    const skullMesh = new THREE.Mesh(_unitSphere, mat);
    skullMesh.name = 'skull';
    skullMesh.scale.set(R * 0.98, R * 0.92, R * 1.06);
    skullMesh.castShadow = true;
    head.add(skullMesh);

    // snout + jaw rendered relative to the head group origin (= skull world pos).
    const headWorld = head.position;
    for (const nm of ['snout', 'jaw']) {
      const b = byName[nm];
      renderBoneCapsule(head, {
        ...b, pos: b.pos.clone().sub(headWorld), tail: b.tail.clone().sub(headWorld),
      }, mat);
    }
  }

  // ---- mouth placement from the skull/snout/jaw bones ---------------------
  // The mouth is part of the face rig but the generator supplies WHERE it sits
  // (the rig is head-agnostic). We put it along the snout/jaw seam on the front-
  // lower head, in head-local space (origin = skull world pos), facing the head's
  // forward direction. Sized in head-radius units so it reads at any age/scale.
  const snoutB = byName['snout'], jawB = byName['jaw'];
  const fwd = skull.fwd.clone().normalize();
  const snoutSeam = snoutB.pos.clone().lerp(snoutB.tail, 0.5);
  const jawSeam = jawB.pos.clone().lerp(jawB.tail, 0.5);
  const mouthCenterW = snoutSeam.clone().lerp(jawSeam, 0.5)
    .add(fwd.clone().multiplyScalar(snoutB.envelopeRadius * 0.35));
  const mouthOpts = {
    center: mouthCenterW.sub(skull.pos),            // head-local
    forward: fwd,
    up: new THREE.Vector3(0, 1, 0),
    width: Math.max((snoutB.envelopeRadius + snoutB.rTail) * 1.7, R * 1.05),
  };

  // ---- ear anchors from the skull bone (head-local, skull-centered) --------
  // Upper-rear-side of the skull sphere, base direction up-out-slightly-back.
  // Passed to the face rig, which builds/poses the ears (rotation-only). Absent
  // when earSize resolves to ~0 (genome-optional). fieldBody => sit proud of skin.
  // Skinned deformable ears only in the smooth/high (Explorer) tier — the body is
  // a SkinnedMesh there so rig.js can bind the ear sheet to its bone chain. Cheap
  // tier and voxel/capsule modes keep the rigid plates (they bake to Bedrock bones).
  const earSkinned = skinMode === 'smooth' && p.renderTier === 'high';
  const earOpts = (p.earSize * R) > 0.02 ? {
    size: p.earSize * R,
    length: p.earLength, width: p.earWidth,
    droop: p.earDroop, pointed: p.earPointed, pairs: p.earPairs,
    neutral: p.earNeutral,
    proud: fieldBody,
    skinned: earSkinned,
    headR: R,
    earLen: resolveEarLen(R, p.earSize, p.earLength),
    anchors: [-1, 1].map((side) => ({
      pos: V(side * R * 0.62, R * 0.55, -R * 0.10),
      out: V(side * 0.75, 0.62, -0.22).normalize(),
      up: V(0, 1, 0),
    })),
  } : null;

  // ---- frill anchor data (skull rear crown; posed by frillFlare) -----------
  const frillOpts = (p.frillSize * R) > 0.02 ? {
    size: p.frillSize * R, extent: p.frillExtent, soft: p.frillSoft, R,
  } : null;

  // Reusable face rig (unchanged eye/brow/mouth contract) sized to the skull
  // radius. In smooth mode we nudge it slightly forward/out so it sits ON the
  // smooth head surface (the field skull is a plain sphere of radius R).
  const face = createFaceRig(p.face, {
    headRadius: R,
    eyeSize: p.eyeSize * R * 0.42,
    eyeHeight: p.eyeHeight,
    eyeForward: fieldBody ? Math.min(0.95, p.eyeFwd + 0.06) : p.eyeFwd,
    mouth: mouthOpts,
    ears: earOpts,
    frill: frillOpts,
    brow: { weight: p.browWeight, sag: p.browSag },
    tier: p.renderTier,
  });
  face.name = 'faceRig';
  head.add(face);
  head.userData.faceRig = face;
  head.userData.headRadius = R;

  // ---- tusks + barbels: STATIC layered meshes on the jaw / snout tip -------
  // (placement-only, no expression state -> built generator-side into the head
  // group in head-local space, so they layer over smooth AND voxel skin).
  addTusksAndBarbels(head, p, byName, skull);

  dragon.add(head);

  // ---- LIMBS (arm/leg volumes: capsule mode only; smooth/voxel live in field) --
  if (!fieldBody) {
    const limbs = new THREE.Group();
    limbs.name = 'limbs';
    for (const b of bones) {
      if (b.kind === 'limb' || b.kind === 'foot' || b.kind === 'girdle') {
        renderBoneCapsule(limbs, b, mat);
      }
    }
    dragon.add(limbs);
  }

  // ---- APPENDAGES (fingers/toes + claws) — rendered as capsules in ALL skin
  // modes. Fingers/toes are thin spars: at the coarse field/voxel resolution they
  // would disappear, so (like the old wing spars) they stay explicit capsules.
  const appendages = new THREE.Group();
  appendages.name = 'appendages';
  for (const b of bones) {
    if (b.kind === 'finger' || b.kind === 'toe') renderBoneCapsule(appendages, b, mat);
    else if (b.kind === 'claw') renderBoneCapsule(appendages, b, hardMat);
  }
  dragon.add(appendages);

  // ---- WING MEMBRANE (separate double-sided sheet — NOT via the implicit field
  // so the torso stays clean and the thin sheet renders in every skin mode) ----
  const wings = new THREE.Group();
  wings.name = 'wings';
  const membraneMat = membraneMaterial(p);
  for (const spec of wingSpecs) {
    const mesh = buildMembraneMesh(spec, membraneMat);
    if (mesh) wings.add(mesh);
  }
  dragon.add(wings);

  // ---- DISCRETE FEATURES (phase 2): spikes / crest sail / feathers / scutes.
  // A separate layered/merged mesh group (like the wing membrane), oriented to
  // cell normals/tangents and bone-tagged. In voxel mode the spikes render as
  // cheap protruding cube stacks (matching the geo.json bake). Toggle off for
  // debugging via window.__noFeatures. ------------------------------------------
  const noFeatures = env.noFeatures
    ?? (typeof window !== 'undefined' ? window.__noFeatures : undefined) ?? false;
  if (!noFeatures) {
    const features = buildFeatureMeshes(featureState, p, { mode: skinMode });
    if (features.children.length) dragon.add(features);
  }

  // ---- optional rig debug overlay -----------------------------------------
  const showRig = env.showRig ?? (typeof window !== 'undefined' && window.__showRig);
  if (showRig) dragon.add(buildRigOverlay(bones, byName));

  // ---- optional feature-grid debug overlay (window.__showGrid, mirrors
  // window.__showRig) — dots at CA cell centres tinted by region, anchors white --
  const showGrid = env.showGrid ?? (typeof window !== 'undefined' && window.__showGrid);
  if (showGrid) dragon.add(buildGridOverlay(featureGrid));

  // ---- finalize: lift so feet/hands (or belly) sit near y = 0 -------------
  // Ground-walking forelimbs (low membrane, long arm) reach their fingertips to
  // y=0; pure flyers hold the wing up so the hind feet set the floor. We take the
  // lowest contact over feet, toes, developed fingertips, and the body underside.
  let lowest = Infinity;
  for (const b of bones) {
    if ((b.kind === 'foot' || b.kind === 'toe') && b.envelopeRadius >= EPS && b.footY !== undefined) {
      lowest = Math.min(lowest, b.footY);
    }
    if ((b.kind === 'finger' || b.kind === 'claw') && b.envelopeRadius >= EPS && b.tail) {
      lowest = Math.min(lowest, b.tail.y - (b.rTail ?? 0));
    }
    if (b.kind === 'body') lowest = Math.min(lowest, b.pos.y - b.envelopeRadius);
  }
  if (!isFinite(lowest)) lowest = 0;
  dragon.scale.setScalar(p.globalScale);
  dragon.position.y = -lowest * p.globalScale;

  dragon.userData = {
    genome: { ...genome }, age, env, phenotype: p, skeleton: bones,
    skinMode, fieldStats: dragon.userData.fieldStats,
    voxelCubes: dragon.userData.voxelCubes,
    featureGrid, markingState, featureState,
  };
  return dragon;
}

// ---------------------------------------------------------------------------
// Bedrock geo.json export hook (Step 3). app.js owns window.__testbed but we
// must not edit it, so we self-install exportGeoJSON onto it once it exists
// (same non-invasive pattern as window.__ARCHETYPES). exportGeoJSON(opts) bakes
// the CURRENT on-screen dragon's skeleton to a Bedrock geo.json string,
// regardless of the active skin mode.
if (typeof window !== 'undefined') {
  const install = () => {
    if (window.__testbed && !window.__testbed.exportGeoJSON) {
      window.__testbed.exportGeoJSON = (opts = {}) =>
        exportGeoJSON(window.__testbed.dragon, opts);
    }
    if (!window.__testbed || !window.__testbed.exportGeoJSON) setTimeout(install, 50);
  };
  install();
}

// Thin-line bone/rig debug overlay (env.showRig). Draws parent->child links plus
// each bone's own capsule axis so the rig can be inspected.
function buildRigOverlay(bones, byName) {
  const pts = [];
  for (const b of bones) {
    if (b.parent && byName[b.parent]) {
      const pp = byName[b.parent].pos;
      pts.push(pp.x, pp.y, pp.z, b.pos.x, b.pos.y, b.pos.z);
    }
    if (b.tail) pts.push(b.pos.x, b.pos.y, b.pos.z, b.tail.x, b.tail.y, b.tail.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x66ff99, depthTest: false, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'rigDebug';
  lines.renderOrder = 999;
  return lines;
}

// Re-apply just the face expression without a full rebuild (emotion dropdown).
export function setDragonFace(dragon, faceParams) {
  const rig = dragon && dragon.getObjectByName('faceRig');
  if (!rig) return false;
  applyFaceParams(rig, faceParams);
  return true;
}
