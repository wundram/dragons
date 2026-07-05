// generator.js — Dragon model generator (PLACEHOLDER implementation).
//
// This file defines the GENERATOR INTERFACE CONTRACT that the whole test bed
// harness depends on. The real, research-driven generator will replace the
// *implementation* in this file while keeping the three exports below identical,
// so nothing in the harness (app.js) has to change.
//
// Contract (do not break these three exports):
//   - GENOME_SCHEMA  : Array<TraitSpec>  — declarative description of every trait.
//   - DEFAULT_GENOME : Record<string, number> — a sensible default value per trait.
//   - generateDragon(genome, age, env) -> THREE.Group — the whole dragon.
//
// See testbed/README.md for the full contract write-up and how to plug in a
// real generator.

import * as THREE from 'three';
import { createFaceRig, applyFaceParams } from './face.js';

// ---------------------------------------------------------------------------
// GENOME_SCHEMA
// ---------------------------------------------------------------------------
// Each entry describes one numeric trait. The harness auto-builds a slider for
// every entry, grouped by `group`. Keep every trait a plain number in [min,max].
//
// TraitSpec = {
//   name        : string   — key in the genome object
//   min, max    : number   — slider bounds (inclusive)
//   default     : number   — default value (also mirrored in DEFAULT_GENOME)
//   step        : number   — slider granularity (optional, defaults to 0.01)
//   group       : string   — panel section this trait belongs to
//   description : string   — human-readable tooltip / doc
// }
//
// IMPORTANT: genome traits describe the ADULT *destination* / bias. The cute→cool
// arc is produced by `generateDragon` applying age-driven neoteny on top of the
// genome — see phenotype() below. So `age` (0..1), NOT the genome, drives the
// cute↔cool transformation; the genome only biases where the adult lands.
export const GENOME_SCHEMA = [
  // --- Body proportions -----------------------------------------------------
  { name: 'bodyLength',    min: 0.5, max: 2.0, default: 1.0, group: 'Body',
    description: 'Length of the main torso along the spine.' },
  { name: 'bodyRoundness', min: 0.0, max: 1.0, default: 0.45, group: 'Body',
    description: 'Adult body shape: 1 = stays round & soft (friendly), 0 = becomes angular/lean (fierce). Babies are always round regardless.' },
  { name: 'bellySize',     min: 0.6, max: 1.6, default: 1.1, group: 'Body',
    description: 'How pronounced the lighter belly is.' },
  { name: 'neckLength',    min: 0.4, max: 2.0, default: 1.0, group: 'Body',
    description: 'Adult neck length (baby necks are always short/stubby).' },
  { name: 'tailLength',    min: 0.4, max: 2.5, default: 1.2, group: 'Body',
    description: 'Adult tail length (grows with age).' },

  // --- Head -----------------------------------------------------------------
  { name: 'headSize',      min: 0.5, max: 1.6, default: 1.0, group: 'Head',
    description: 'Adult head size relative to body. Babies get a big-head boost automatically.' },
  { name: 'snoutLength',   min: 0.2, max: 1.6, default: 0.9, group: 'Head',
    description: 'Adult snout length (baby snouts are short & stubby).' },
  { name: 'snoutWidth',    min: 0.5, max: 1.5, default: 0.9, group: 'Head',
    description: 'Width/chunkiness of the snout.' },
  { name: 'eyeSize',       min: 0.5, max: 1.8, default: 1.0, group: 'Head',
    description: 'Base eye size. Babies get huge low eyes; adults smaller & higher.' },

  // --- Limbs ----------------------------------------------------------------
  { name: 'limbLength',    min: 0.4, max: 1.8, default: 1.0, group: 'Limbs',
    description: 'Adult limb length (baby limbs are short & stubby).' },
  { name: 'limbThickness', min: 0.5, max: 1.6, default: 1.0, group: 'Limbs',
    description: 'Base limb thickness. Babies get chubbier limbs automatically.' },

  // --- Features (emerge / grow with age) ------------------------------------
  { name: 'hornSize',      min: 0.0, max: 1.6, default: 1.0, group: 'Features',
    description: 'Adult horn length. Near-absent on babies, emerges past ~25% age.' },
  { name: 'hornCount',     min: 0.0, max: 6.0, default: 2.0, step: 1, group: 'Features',
    description: 'Number of horn pairs on the head.' },
  { name: 'spikeAmount',   min: 0.0, max: 14.0, default: 8.0, step: 1, group: 'Features',
    description: 'Number of dorsal back-spikes (grow in with age).' },
  { name: 'spikeSharpness',min: 0.3, max: 1.6, default: 1.0, group: 'Features',
    description: 'How tall/sharp the dorsal spikes get.' },
  { name: 'wingSize',      min: 0.0, max: 1.8, default: 1.0, group: 'Features',
    description: 'Adult wing span. Tiny/absent on babies, emerges past ~35% age.' },

  // --- Color ----------------------------------------------------------------
  { name: 'colorHue',       min: 0.0, max: 1.0, default: 0.55, group: 'Color',
    description: 'Base body hue (0..1 around the color wheel).' },
  { name: 'colorSaturation',min: 0.0, max: 1.0, default: 0.6, group: 'Color',
    description: 'Adult saturation. Babies read more pastel; color saturates with age.' },
  { name: 'colorLightness',  min: 0.2, max: 0.85, default: 0.55, group: 'Color',
    description: 'Base body lightness.' },

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
];

// ---------------------------------------------------------------------------
// DEFAULT_GENOME — derived from the schema so the two never drift apart.
// ---------------------------------------------------------------------------
export const DEFAULT_GENOME = Object.freeze(
  GENOME_SCHEMA.reduce((g, t) => { g[t.name] = t.default; return g; }, {})
);

// List of trait names that the face rig consumes (used by app.js grouping too).
export const FACE_TRAITS = ['eyeOpen', 'pupilX', 'pupilY', 'browHeight', 'browAngle', 'browCurve'];

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
// Smoothly ramps 0→1 as `t` crosses [start, start+width]; used for features
// (horns, wings, spikes) that *emerge* at a growth threshold rather than scaling
// from birth.
const emerge = (t, start, width = 0.35) => smoothstep((clamp01(t) - start) / width);

// ---------------------------------------------------------------------------
// phenotype(genome, age, env)
// ---------------------------------------------------------------------------
// The heart of the cute→cool arc. Turns the genome + age into concrete, ready-to-
// build numbers. This is where allometric (non-uniform) scaling lives: babies are
// NOT just small adults — their head/eyes are proportionally huge, limbs stubby,
// features absent. As age→1 we interpolate toward the genome-defined adult.
//
// Returns a flat "phenotype" object consumed by buildBody/buildHead/etc.
export function phenotype(genome, age = 0, env = {}) {
  const t = clamp01(age);
  const s = smoothstep(t);           // eased age for smooth silhouettes
  const g = { ...DEFAULT_GENOME, ...genome };

  // Optional environment nudges (documented, minimal). env is reserved for the
  // real generator; here it only does gentle, safe tweaks.
  const sizeBoost = env.sizeBoost ?? 1.0;   // e.g. well-fed dragons run larger
  const hueShift  = env.hueShift ?? 0.0;    // e.g. biome tint

  return {
    // --- overall ---
    globalScale: sizeBoost * lerp(0.7, 1.0, s),  // babies a touch smaller overall

    // --- head: big on babies, proportionate on adults (allometry) ---
    headSize:    g.headSize * lerp(1.8, 1.0, s),
    snoutLength: g.snoutLength * lerp(0.35, 1.0, s),
    snoutWidth:  g.snoutWidth * lerp(1.15, 1.0, s),

    // --- eyes: huge & low on babies, smaller & higher on adults ---
    eyeSize:   g.eyeSize * lerp(1.7, 0.8, s),
    eyeHeight: lerp(0.30, 0.58, s),   // fraction up the skull the eyes sit
    eyeFwd:    lerp(0.62, 0.78, s),   // how forward-facing the eyes are

    // --- neck / tail: short & stubby → long ---
    neckLength: g.neckLength * lerp(0.35, 1.0, s),
    tailLength: g.tailLength * lerp(0.45, 1.0, s),

    // --- body: round soft baby → genome-defined adult shape ---
    bodyLength:    g.bodyLength * lerp(0.75, 1.0, s),
    // roundness starts fully round (1) and eases toward the genome's adult value
    bodyRoundness: lerp(1.0, g.bodyRoundness, s),
    bellySize:     g.bellySize,

    // --- limbs: short & chubby → long & lean ---
    limbLength:    g.limbLength * lerp(0.5, 1.0, s),
    limbThickness: g.limbThickness * lerp(1.45, 0.85, s),

    // --- features that EMERGE with age ---
    hornSize:    g.hornSize * emerge(t, 0.22),
    hornCount:   Math.max(0, Math.round(g.hornCount)),
    spikeGrow:   emerge(t, 0.15),                 // 0..1 dorsal-spike growth
    spikeAmount: Math.max(0, Math.round(g.spikeAmount)),
    spikeSharpness: g.spikeSharpness,
    wingSize:    g.wingSize * emerge(t, 0.35),

    // --- color: pastel baby → saturated adult ---
    hue: (g.colorHue + hueShift) % 1,
    sat: g.colorSaturation * lerp(0.55, 1.0, s),
    light: lerp(g.colorLightness + 0.12, g.colorLightness, s), // babies lighter

    // --- face params (with a gentle age drift: wide-innocent → confident) ---
    face: {
      eyeOpen:   g.eyeOpen * lerp(1.0, 0.9, s),
      pupilX:    g.pupilX,
      pupilY:    g.pupilY + lerp(-0.12, 0.0, s),  // babies gaze slightly up (endearing)
      browHeight:g.browHeight + lerp(0.25, 0.0, s), // babies' brows sit higher
      browAngle: g.browAngle + lerp(-0.15, 0.1, s), // baby soft → adult a touch sterner
      browCurve: g.browCurve + lerp(0.25, 0.0, s),  // baby rounder arch
    },
  };
}

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------
function bodyMaterial(p) {
  const c = new THREE.Color().setHSL(p.hue, p.sat, p.light);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 });
}
function bellyMaterial(p) {
  const c = new THREE.Color().setHSL((p.hue + 0.05) % 1, p.sat * 0.7, Math.min(0.9, p.light + 0.22));
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.0 });
}
function hardMaterial(p) {
  // horns / spikes / claws — darker, harder, slightly desaturated
  const c = new THREE.Color().setHSL((p.hue + 0.08) % 1, p.sat * 0.4, Math.max(0.15, p.light - 0.3));
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2 });
}

// ---------------------------------------------------------------------------
// Geometry builders — each returns a THREE.Object3D and positions itself in the
// dragon's local space. Kept deliberately crude (primitives) — this is a
// placeholder whose job is to prove the arc, not to look production-ready.
// ---------------------------------------------------------------------------

// A tapered segmented tube (used for neck & tail) built from stacked spheres so
// it bends organically without custom geometry. Returns a Group whose +local
// direction runs along `dir`. Points are given as [{pos:Vector3, r:number}].
function segmentedLimb(points, material) {
  const grp = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 12, 10);
  for (const pt of points) {
    const m = new THREE.Mesh(geo, material);
    m.scale.setScalar(pt.r);
    m.position.copy(pt.pos);
    m.castShadow = true;
    grp.add(m);
  }
  return grp;
}

function buildTorso(p, mat, bellyMat) {
  const grp = new THREE.Group();
  grp.name = 'torso';
  // Roundness controls how spherical vs elongated/flattened (angular) the torso
  // reads: round babies → near-sphere; lean adults → longer, flatter, tapered.
  const round = p.bodyRoundness;
  const len = p.bodyLength * (1.6 - 0.3 * round);
  const geo = new THREE.SphereGeometry(1, 20, 16);

  const torso = new THREE.Mesh(geo, mat);
  torso.name = 'torsoMain';
  torso.scale.set(0.95 * (0.85 + 0.15 * round), 0.9 * (0.8 + 0.2 * round), len);
  torso.castShadow = true;
  grp.add(torso);

  // belly patch — a lighter ellipsoid poking out the underside/front
  const belly = new THREE.Mesh(geo, bellyMat);
  belly.name = 'belly';
  belly.scale.set(0.72 * p.bellySize, 0.6 * p.bellySize, len * 0.8);
  belly.position.set(0, -0.35, 0.05);
  grp.add(belly);

  return grp;
}

function buildDorsalSpikes(p, mat) {
  const grp = new THREE.Group();
  grp.name = 'spikes';
  const n = p.spikeAmount;
  if (n <= 0 || p.spikeGrow <= 0.001) return grp;
  const geo = new THREE.ConeGeometry(0.12, 1, 6);
  // Run spikes from just behind the neck, over the back, onto the tail base.
  for (let i = 0; i < n; i++) {
    const f = i / Math.max(1, n - 1);          // 0..1 front→back
    const z = lerp(0.9, -1.7, f);              // along spine (local +z is front)
    const h = p.spikeGrow * p.spikeSharpness * lerp(0.55, 0.28, f); // taper down the tail
    if (h < 0.02) continue;
    const spike = new THREE.Mesh(geo, mat);
    spike.scale.set(1, h * 3.0, 1);
    spike.position.set(0, 0.55 + h * 1.4, z);
    spike.castShadow = true;
    grp.add(spike);
  }
  return grp;
}

function buildLimb(p, mat, hardMat, side, front) {
  // side: -1 left, +1 right. front: true=fore, false=hind.
  const grp = new THREE.Group();
  grp.name = front ? (side < 0 ? 'legFL' : 'legFR') : (side < 0 ? 'legBL' : 'legBR');
  const len = p.limbLength * (front ? 0.9 : 1.05);
  const thick = 0.16 * p.limbThickness;

  const upperGeo = new THREE.CylinderGeometry(thick, thick * 0.85, len, 8);
  const upper = new THREE.Mesh(upperGeo, mat);
  upper.position.y = -len / 2;
  upper.castShadow = true;
  grp.add(upper);

  // foot / paw — a squashed sphere with a few claws
  const foot = new THREE.Mesh(new THREE.SphereGeometry(thick * 1.5, 8, 6), mat);
  foot.scale.set(1, 0.6, 1.4);
  foot.position.set(0, -len, thick * 0.6);
  grp.add(foot);

  const clawGeo = new THREE.ConeGeometry(thick * 0.35, thick * 1.4, 5);
  for (let c = -1; c <= 1; c++) {
    const claw = new THREE.Mesh(clawGeo, hardMat);
    claw.rotation.x = Math.PI / 2.2;
    claw.position.set(c * thick * 0.7, -len - thick * 0.2, thick * 1.7);
    grp.add(claw);
  }
  return grp;
}

function buildWing(p, mat, hardMat, side) {
  const grp = new THREE.Group();
  grp.name = side < 0 ? 'wingL' : 'wingR';
  if (p.wingSize <= 0.001) return grp;
  const span = p.wingSize * 1.6;

  // membrane — a thin, flattened, angular shape (cone flattened into a fan)
  const membrane = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 3), mat);
  membrane.material = mat.clone();
  membrane.material.side = THREE.DoubleSide;
  membrane.material.transparent = true;
  membrane.material.opacity = 0.9;
  membrane.scale.set(span, span * 1.3, 0.06);
  membrane.rotation.z = side * -0.5;
  membrane.position.set(side * span * 0.5, span * 0.4, -0.2);
  grp.add(membrane);

  // a couple of finger-bones along the leading edge
  const boneGeo = new THREE.CylinderGeometry(0.03, 0.02, span * 1.4, 5);
  for (let b = 0; b < 3; b++) {
    const bone = new THREE.Mesh(boneGeo, hardMat);
    bone.position.set(side * span * 0.5, span * 0.4, -0.2);
    bone.rotation.z = side * (-0.5 + b * 0.28);
    grp.add(bone);
  }
  grp.position.set(side * 0.35, 0.55, -0.4);
  return grp;
}

function buildHorns(p, hardMat) {
  const grp = new THREE.Group();
  grp.name = 'horns';
  if (p.hornSize <= 0.001 || p.hornCount <= 0) return grp;
  const geo = new THREE.ConeGeometry(0.09, 1, 7);
  for (let i = 0; i < p.hornCount; i++) {
    const back = i / Math.max(1, p.hornCount); // 0 front pair → 1 back pair
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(geo, hardMat);
      const h = p.hornSize * lerp(0.55, 0.35, back);
      horn.scale.set(1, h * 2.2, 1);
      horn.position.set(side * 0.22, 0.55 + h, -0.15 - back * 0.35);
      horn.rotation.set(-0.5 + back * 0.2, 0, side * 0.35);
      horn.castShadow = true;
      grp.add(horn);
    }
  }
  return grp;
}

// Build the head as its own group so the face rig can attach at head scale.
// headRadius is the local radius the face rig uses to place eyes/brows.
function buildHead(p, mat, hardMat) {
  const grp = new THREE.Group();
  grp.name = 'head';
  const R = 0.9 * p.headSize;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 14), mat);
  skull.name = 'skull';
  skull.castShadow = true;
  grp.add(skull);

  // snout — a tapered box/cone poking forward (+z)
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55 * p.snoutWidth, R * 0.7, R * 1.3 * p.snoutLength + 0.05, 10), mat);
  snout.name = 'snout';
  snout.rotation.x = Math.PI / 2;                 // point it forward
  snout.position.set(0, -R * 0.15, R * 0.9 + R * 0.6 * p.snoutLength);
  snout.castShadow = true;
  grp.add(snout);

  // nostrils / brow ridge nubs for a bit of character
  const ridge = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 8, 6), mat);
  ridge.position.set(0, R * 0.4, R * 0.7);
  grp.add(ridge);

  grp.add(buildHorns(p, hardMat));

  // Attach the reusable face rig. It sizes itself to headRadius and places eyes
  // on the front hemisphere using the phenotype's eyeHeight/eyeFwd.
  const face = createFaceRig(p.face, {
    headRadius: R,
    eyeSize: p.eyeSize * R * 0.42,
    eyeHeight: p.eyeHeight,
    eyeForward: p.eyeFwd,
  });
  face.name = 'faceRig';
  grp.add(face);
  grp.userData.faceRig = face;
  grp.userData.headRadius = R;

  return grp;
}

// ---------------------------------------------------------------------------
// generateDragon(genome, age, env) — the public entry point.
// ---------------------------------------------------------------------------
// Returns a THREE.Group with this child structure (documented in README):
//
//   dragon (Group)                     userData: { genome, age, env, phenotype }
//   ├── body (Group)
//   │   ├── torso (Group) [ torsoMain, belly ]
//   │   ├── neck  (Group of stacked spheres)
//   │   ├── tail  (Group of stacked spheres)
//   │   └── spikes (Group of dorsal cones)
//   ├── head (Group)                   userData: { faceRig, headRadius }
//   │   ├── skull (Mesh)
//   │   ├── snout (Mesh)
//   │   ├── ridge (Mesh)
//   │   ├── horns (Group)
//   │   └── faceRig (Group) [ eyeL, eyeR, browL, browR ]  ← from face.js
//   ├── limbs (Group) [ legFL, legFR, legBL, legBR ]
//   └── wings (Group) [ wingL, wingR ]
//
// The face rig is always reachable at: dragon.getObjectByName('faceRig').
export function generateDragon(genome = DEFAULT_GENOME, age = 0, env = {}) {
  const p = phenotype(genome, age, env);
  const mat = bodyMaterial(p);
  const bellyMat = bellyMaterial(p);
  const hardMat = hardMaterial(p);

  const dragon = new THREE.Group();
  dragon.name = 'dragon';

  // ---- BODY (torso + neck + tail + spikes) --------------------------------
  const body = new THREE.Group();
  body.name = 'body';
  body.add(buildTorso(p, mat, bellyMat));
  body.add(buildDorsalSpikes(p, hardMat));

  // neck: stacked spheres curving up & forward from the front of the torso
  const neckSegs = 5;
  const neckPts = [];
  for (let i = 0; i <= neckSegs; i++) {
    const f = i / neckSegs;
    neckPts.push({
      pos: new THREE.Vector3(0, lerp(0.1, 0.55, f) * p.neckLength + f * 0.15,
                             lerp(1.2, 1.2 + p.neckLength * 1.1, f)),
      r: lerp(0.55, 0.4, f),
    });
  }
  const neck = segmentedLimb(neckPts, mat);
  neck.name = 'neck';
  body.add(neck);

  // tail: stacked spheres tapering out the back (local -z)
  const tailSegs = 7;
  const tailPts = [];
  for (let i = 0; i <= tailSegs; i++) {
    const f = i / tailSegs;
    tailPts.push({
      pos: new THREE.Vector3(0, lerp(0.15, -0.1, f),
                             lerp(-1.2, -1.2 - p.tailLength * 1.8, f)),
      r: lerp(0.5, 0.06, f),
    });
  }
  const tail = segmentedLimb(tailPts, mat);
  tail.name = 'tail';
  body.add(tail);

  dragon.add(body);

  // ---- HEAD (with face rig) ----------------------------------------------
  const head = buildHead(p, mat, hardMat);
  // place head at the tip of the neck
  const neckTip = neckPts[neckPts.length - 1].pos;
  head.position.set(neckTip.x, neckTip.y + 0.25, neckTip.z + 0.35 * p.headSize);
  dragon.add(head);

  // ---- LIMBS --------------------------------------------------------------
  const limbs = new THREE.Group();
  limbs.name = 'limbs';
  const halfW = 0.55;                 // lateral offset of legs
  const foreZ = 0.7, hindZ = -0.9;    // fore/hind placement along spine
  const placements = [
    { side: -1, front: true,  z: foreZ }, { side: 1, front: true,  z: foreZ },
    { side: -1, front: false, z: hindZ }, { side: 1, front: false, z: hindZ },
  ];
  for (const pl of placements) {
    const leg = buildLimb(p, mat, hardMat, pl.side, pl.front);
    leg.position.set(pl.side * halfW, -0.35, pl.z);
    limbs.add(leg);
  }
  dragon.add(limbs);

  // ---- WINGS --------------------------------------------------------------
  const wings = new THREE.Group();
  wings.name = 'wings';
  wings.add(buildWing(p, mat, hardMat, -1));
  wings.add(buildWing(p, mat, hardMat, 1));
  dragon.add(wings);

  // ---- finalize -----------------------------------------------------------
  dragon.scale.setScalar(p.globalScale);
  // Lift so the feet roughly sit on y=0.
  dragon.position.y = (p.limbLength * (1.05) + 0.35) * p.globalScale;

  dragon.userData = { genome: { ...genome }, age, env, phenotype: p };
  return dragon;
}

// Convenience: re-apply just the face expression to an existing dragon without a
// full rebuild (handy for the emotion dropdown). Returns true if applied.
export function setDragonFace(dragon, faceParams) {
  const rig = dragon && dragon.getObjectByName('faceRig');
  if (!rig) return false;
  applyFaceParams(rig, faceParams);
  return true;
}
