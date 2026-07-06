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
//   - ARCHETYPES : { snake, wyvern, quadruped, eastern }  — attractor genomes
//
// The returned group exposes the resolved bone tree on
// `group.userData.skeleton` (array of { name, parent, pos, length,
// envelopeRadius, tail, ... }). Step 2 (implicit field) consumes each bone's
// world `pos` + `tail` + `envelopeRadius` to sum the scalar field.

import * as THREE from 'three';
import { createFaceRig, applyFaceParams } from './face.js';

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
  { name: 'robustness',     min: 0.5, max: 1.7, default: 1.0, group: 'Body',
    description: 'Overall girth: torso & neck & tail envelope radius. High = chunky, low = slender.' },
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

  // --- Limbs (development gates the whole limb; 0 = that limb never appears) --
  { name: 'foreLimbDev',  min: 0.0, max: 1.0, default: 1.0, group: 'Limbs',
    description: 'Front-limb development. 0 = no forelimbs at any age (snake/wyvern), 1 = full.' },
  { name: 'hindLimbDev',  min: 0.0, max: 1.0, default: 1.0, group: 'Limbs',
    description: 'Hind-limb development. 0 = no hind legs at any age (snake), 1 = full.' },
  { name: 'limbLength',   min: 0.4, max: 1.8, default: 1.0, group: 'Limbs',
    description: 'Adult limb length (baby limbs bud short & stubby, lengthen with age).' },
  { name: 'limbThickness',min: 0.5, max: 1.8, default: 1.0, group: 'Limbs',
    description: 'Limb envelope radius. Babies get chubbier limbs automatically.' },

  // --- Wings ----------------------------------------------------------------
  { name: 'wingDev',  min: 0.0, max: 1.0, default: 1.0, group: 'Wings',
    description: 'Wing development. 0 = wingless at any age (snake/some quadrupeds), 1 = full.' },
  { name: 'wingSize', min: 0.4, max: 2.2, default: 1.0, group: 'Wings',
    description: 'Adult wing spar span. Absent on babies, buds/emerges past ~25% age.' },

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

// Trait names the face rig consumes (used by app.js grouping/live-update too).
export const FACE_TRAITS = ['eyeOpen', 'pupilX', 'pupilY', 'browHeight', 'browAngle', 'browCurve'];

// ---------------------------------------------------------------------------
// ARCHETYPES — full genome objects that are attractor points in the continuous
// trait space. Each is a valid pose of the ONE fixed skeleton; only bone
// lengths/radii differ. Used for evaluation (render each across ages 0/0.5/1).
// ---------------------------------------------------------------------------
function withDefaults(overrides) {
  return { ...DEFAULT_GENOME, ...overrides };
}
export const ARCHETYPES = {
  // Snake: no limbs, no wings, very long body + neck + tail, slender.
  snake: withDefaults({
    bodyElongation: 2.3, robustness: 0.9, neckLength: 1.8, tailLength: 2.6,
    girdleWidth: 0.5, headSize: 0.9, snoutLength: 0.8, jawSize: 0.9,
    foreLimbDev: 0.0, hindLimbDev: 0.0, wingDev: 0.0,
    colorHue: 0.32, colorSaturation: 0.65,
  }),
  // Wyvern: no forelimbs, strong hind legs + big wings.
  wyvern: withDefaults({
    bodyElongation: 1.0, robustness: 1.0, neckLength: 1.2, tailLength: 1.6,
    girdleWidth: 1.0, headSize: 1.05, snoutLength: 1.1, jawSize: 1.1,
    foreLimbDev: 0.0, hindLimbDev: 1.0, limbLength: 1.15, limbThickness: 1.15,
    wingDev: 1.0, wingSize: 1.5,
    colorHue: 0.02, colorSaturation: 0.7,
  }),
  // Quadruped: four strong legs, medium wings, chunky.
  quadruped: withDefaults({
    bodyElongation: 1.1, robustness: 1.3, neckLength: 1.0, tailLength: 1.3,
    girdleWidth: 1.3, headSize: 1.1, snoutLength: 1.0, jawSize: 1.2,
    foreLimbDev: 1.0, hindLimbDev: 1.0, limbLength: 1.1, limbThickness: 1.35,
    wingDev: 0.5, wingSize: 1.0,
    colorHue: 0.6, colorSaturation: 0.6,
  }),
  // Eastern / Chinese: extremely elongated body+neck+tail, small dainty limbs, no wings.
  eastern: withDefaults({
    bodyElongation: 2.0, robustness: 0.95, neckLength: 2.0, tailLength: 2.4,
    girdleWidth: 0.8, headSize: 1.1, snoutLength: 1.2, jawSize: 1.0,
    foreLimbDev: 0.35, hindLimbDev: 0.35, limbLength: 0.7, limbThickness: 0.8,
    wingDev: 0.0, wingSize: 0.6,
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
  legR:      0.17,   // base limb envelope radius
  footR:     0.15,   // foot radius
  wingSparR: 0.10,   // base wing spar radius
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

  // Allometric limb/wing budding. Radius & length rise from ~0 with age, gated by
  // the *Dev trait so dev=0 => that limb NEVER appears at any age (snake stays
  // limbless, wyvern buds only hind legs + wings). limbGrowthRate biases timing.
  const budAge = clamp01(Math.pow(e, 1 / Math.max(0.2, g.limbGrowthRate)));
  const legGrow  = lerp(0.10, 1.0, smoothstep(budAge));           // legs: tiny stub -> full
  const wingGrow = smoothstep(clamp01((budAge - 0.22) / 0.72));   // wings: truly 0 young -> emerge

  const neo = g.headNeoteny;

  return {
    ageEased: s,
    globalScale: sizeBoost,

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
    // girth: babies rounder relative to length; leaner with age
    girth:     g.robustness * lerp(1.28, 1.0, s),

    // --- limbs / wings (budding) ---
    foreDev: g.foreLimbDev,
    hindDev: g.hindLimbDev,
    wingDev: g.wingDev,
    budLegLen:  legGrow,
    budLegRad:  lerp(0.14, 1.0, smoothstep(budAge)),
    budWing:    wingGrow,
    limbLen:    g.limbLength,
    limbThick:  g.limbThickness * lerp(1.4, 0.9, s), // chubby young -> lean adult
    wingSize:   g.wingSize,

    // --- color: pastel baby -> saturated adult ---
    hue:   (g.colorHue + hueShift + 1) % 1,
    sat:   g.colorSaturation * lerp(0.55, 1.0, s),
    light: lerp(g.colorLightness + 0.12, g.colorLightness, s),

    // --- face params (gentle age drift: wide-innocent -> confident) ---
    face: {
      eyeOpen:    g.eyeOpen * lerp(1.0, 0.9, s),
      pupilX:     g.pupilX,
      pupilY:     g.pupilY + lerp(-0.12, 0.0, s),
      browHeight: g.browHeight + lerp(0.12, 0.0, s),
      browAngle:  g.browAngle + lerp(-0.15, 0.1, s),
      browCurve:  g.browCurve + lerp(0.25, 0.0, s),
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
    // torso bump: thickest around mid-abdomen
    RAD[i] = girthScale * (0.85 + 0.55 * Math.sin(Math.PI * clamp01(f)));
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

  // ---- girdles + limbs ----------------------------------------------------
  // A limb's envelope radius/length are gated by its *Dev * budding factor, so
  // dev=0 => radius 0 => the whole limb is skipped by the renderer & field.
  const buildLeg = (side, front) => {
    const idx = front ? SHOULDER_IDX : HIP_IDX;
    const dev = front ? p.foreDev : p.hindDev;
    const anchor = P[idx];
    const torsoR = RAD[idx];
    const budR = dev * p.budLegRad;   // radius factor
    const budL = dev * p.budLegLen;   // length factor
    const legR = U.legR * p.limbThick * budR;
    const upperLen = U.legUpper * p.limbLen * budL;
    const lowerLen = U.legLower * p.limbLen * budL;
    const footFwd = 0.24 * p.limbLen * budL;

    const socket = anchor.clone().add(V(side * torsoR * 0.9 * p.girdle, -torsoR * 0.15, 0));
    const knee = socket.clone().add(V(side * 0.06, -upperLen, 0.04));
    const ankle = knee.clone().add(V(-side * 0.02, -lowerLen, 0.06));
    const toe = ankle.clone().add(V(0, -U.footR * budR * 0.4, footFwd + U.footR * budR));

    const tag = (front ? 'fore' : 'hind') + (side < 0 ? 'L' : 'R');
    const girdleName = front ? 'shoulderGirdle' : 'hipGirdle';
    add({ name: `${tag}_upper`, parent: girdleName, pos: socket, tail: knee,
          envelopeRadius: legR, rTail: legR * 0.82, length: upperLen, kind: 'limb' });
    add({ name: `${tag}_lower`, parent: `${tag}_upper`, pos: knee, tail: ankle,
          envelopeRadius: legR * 0.82, rTail: legR * 0.7, length: lowerLen, kind: 'limb' });
    add({ name: `${tag}_foot`, parent: `${tag}_lower`, pos: ankle, tail: toe,
          envelopeRadius: legR * 0.75, rTail: U.footR * budR, length: footFwd, kind: 'foot',
          footY: toe.y - U.footR * budR });
  };

  // Girdles are transverse bars linking the two sockets; gated by limb dev so a
  // limbless snake shows no girdle bar.
  const addGirdle = (name, idx, dev) => {
    const anchor = P[idx];
    const torsoR = RAD[idx];
    const half = torsoR * 0.9 * p.girdle;
    const r = (dev > EPS) ? torsoR * 0.35 : 0;
    add({ name, parent: idx < 12 ? spineName(SHOULDER_IDX) : spineName(HIP_IDX),
          pos: anchor.clone().add(V(-half, -torsoR * 0.15, 0)),
          tail: anchor.clone().add(V(half, -torsoR * 0.15, 0)), envelopeRadius: r, rTail: r,
          length: 2 * half, kind: 'girdle' });
  };
  addGirdle('shoulderGirdle', SHOULDER_IDX, p.foreDev);
  addGirdle('hipGirdle', HIP_IDX, p.hindDev);
  for (const side of [-1, 1]) { buildLeg(side, true); buildLeg(side, false); }

  // ---- wings: spar chains from the upper back near the shoulders ----------
  const buildWing = (side) => {
    const dev = p.wingDev;
    const bud = dev * p.budWing;
    const sparR = U.wingSparR * bud;
    const span = p.wingSize * bud;
    const root = P[SHOULDER_IDX].clone().add(V(side * RAD[SHOULDER_IDX] * 0.5, RAD[SHOULDER_IDX] * 0.75, 0));
    const p1 = root.clone().add(V(side * 0.55 * span, 0.65 * span, -0.15 * span));
    const p2 = p1.clone().add(V(side * 0.85 * span, 0.30 * span, -0.5 * span));
    const tip = p2.clone().add(V(side * 0.7 * span, -0.05 * span, -0.6 * span));
    const tag = 'wing' + (side < 0 ? 'L' : 'R');
    add({ name: `${tag}_00`, parent: spineName(SHOULDER_IDX), pos: root, tail: p1,
          envelopeRadius: sparR, rTail: sparR * 0.85, length: root.distanceTo(p1), kind: 'wing' });
    add({ name: `${tag}_01`, parent: `${tag}_00`, pos: p1, tail: p2,
          envelopeRadius: sparR * 0.85, rTail: sparR * 0.7, length: p1.distanceTo(p2), kind: 'wing' });
    add({ name: `${tag}_02`, parent: `${tag}_01`, pos: p2, tail: tip,
          envelopeRadius: sparR * 0.7, rTail: sparR * 0.45, length: p2.distanceTo(tip), kind: 'wing' });
  };
  buildWing(-1); buildWing(1);

  return { bones, byName };
}

// ---------------------------------------------------------------------------
// Materials
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
  const c = new THREE.Color().setHSL((p.hue + 0.08) % 1, p.sat * 0.4, Math.max(0.14, p.light - 0.30));
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2 });
}

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
function renderBoneCapsule(group, bone, mat) {
  if (bone.envelopeRadius < EPS) return;
  addSphere(group, bone.pos, bone.envelopeRadius, mat);
  if (bone.tail && bone.rTail !== undefined) {
    addTaperedCapsule(group, bone.pos, bone.tail, bone.envelopeRadius, bone.rTail, mat);
  }
}

// ---------------------------------------------------------------------------
// generateDragon(genome, age, env) — public entry point.
// ---------------------------------------------------------------------------
// Returns a THREE.Group named 'dragon' with:
//   dragon (Group)  userData:{ genome, age, env, phenotype, skeleton }
//   ├── body   (Group)  spine + tail capsule chain, belly patch
//   ├── head   (Group)  userData:{ faceRig, headRadius }  skull+snout+jaw+faceRig
//   ├── limbs  (Group)  fore/hind leg capsules + girdles (budding-gated)
//   ├── wings  (Group)  wing spar capsules (budding-gated)
//   └── rigDebug (LineSegments)  ONLY when env.showRig (or window.__showRig)
//
// `env.showRig` (or the global window.__showRig) toggles a thin-line bone overlay.
export function generateDragon(genome = DEFAULT_GENOME, age = 0, env = {}) {
  const p = phenotype(genome, age, env);
  const mat = bodyMaterial(p);
  const bellyMat = bellyMaterial(p);
  const hardMat = hardMaterial(p);

  const { bones, byName } = buildSkeleton(p);

  const dragon = new THREE.Group();
  dragon.name = 'dragon';

  // ---- BODY (spine + tail capsule chain + belly) --------------------------
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

  // ---- HEAD (skull ellipsoid + snout + jaw + face rig) --------------------
  const head = new THREE.Group();
  head.name = 'head';
  const skull = byName['skull'];
  const R = skull.headR;
  head.position.copy(skull.pos);

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

  // Reusable face rig (unchanged face.js) sized to the skull radius.
  const face = createFaceRig(p.face, {
    headRadius: R,
    eyeSize: p.eyeSize * R * 0.42,
    eyeHeight: p.eyeHeight,
    eyeForward: p.eyeFwd,
  });
  face.name = 'faceRig';
  head.add(face);
  head.userData.faceRig = face;
  head.userData.headRadius = R;
  dragon.add(head);

  // ---- LIMBS (fore/hind legs + girdles) -----------------------------------
  const limbs = new THREE.Group();
  limbs.name = 'limbs';
  for (const b of bones) {
    if (b.kind === 'limb' || b.kind === 'foot' || b.kind === 'girdle') {
      renderBoneCapsule(limbs, b, mat);
    }
  }
  dragon.add(limbs);

  // ---- WINGS (spar chains) ------------------------------------------------
  const wings = new THREE.Group();
  wings.name = 'wings';
  for (const b of bones) {
    if (b.kind === 'wing') renderBoneCapsule(wings, b, hardMat);
  }
  dragon.add(wings);

  // ---- optional rig debug overlay -----------------------------------------
  const showRig = env.showRig ?? (typeof window !== 'undefined' && window.__showRig);
  if (showRig) dragon.add(buildRigOverlay(bones, byName));

  // ---- finalize: lift so feet (or belly) sit near y = 0 -------------------
  let lowest = Infinity;
  for (const b of bones) {
    if (b.kind === 'foot' && b.envelopeRadius >= EPS && b.footY !== undefined) {
      lowest = Math.min(lowest, b.footY);
    }
    if (b.kind === 'body') lowest = Math.min(lowest, b.pos.y - b.envelopeRadius);
  }
  if (!isFinite(lowest)) lowest = 0;
  dragon.scale.setScalar(p.globalScale);
  dragon.position.y = -lowest * p.globalScale;

  dragon.userData = { genome: { ...genome }, age, env, phenotype: p, skeleton: bones };
  return dragon;
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
