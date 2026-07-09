// face.js — Reusable, scalable expressive-face sub-rig (eyes + floating brows).
//
// This is a STANDALONE, reusable component per the design: a cartoon eye+brow rig
// that layers onto ANY generated head at ANY scale and reads clear emotions. The
// generator (generator.js) builds a head, then calls createFaceRig() and adds the
// returned Group as a child of the head. Because the rig sizes itself from the
// passed head geometry, the same code works on a tiny baby head and a big adult one.
//
// Exports:
//   createFaceRig(params, opts) -> THREE.Group   — build the rig.
//   applyFaceParams(rig, params)                 — update pose without rebuilding.
//   EMOTIONS                                     — preset name → face params.
//   emotionParams(name)                          — get a preset's params.
//
// Rig child structure (names are stable — the harness/generator rely on them):
//   faceRig (Group)
//   ├── eyeL (Group) [ white(Mesh), pupil(Mesh) ]
//   ├── eyeR (Group) [ white(Mesh), pupil(Mesh) ]
//   ├── browL (Mesh)   — soft arched tapered brow (bezier tube)
//   ├── browR (Mesh)
//   └── mouth (Group)  [ band(Mesh) ] — curved parametric mouth (open/curve)

import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Face params shape (all optional; sensible defaults applied):
//   eyeOpen    0..1   eyelid openness (1 wide, 0 shut)
//   pupilX    -1..1   gaze left/right
//   pupilY    -1..1   gaze down/up
//   browHeight-1..1   brow vertical offset above the eye
//   browAngle -1..1   brow tilt (+ inner-down = angry, - inner-up = sad)
//   browCurve -1..1   brow arch (+ round/soft arch, - flat/stern bar)
//   mouthOpen  0..1   jaw gap (0 closed line, 1 open)
//   mouthCurve-1..1   mouth shape (+1 smile, -1 frown)
//   earPerk   -1..1   ear erectness: -1 drooped/folded down .. +1 pricked tall
//   earPitch  -1..1   ear swivel: +1 forward (attention) .. -1 pinned flat back
//   earFlare   0..1   ear splay: 0 tight/vertical .. 1 airplane-horizontal
//   frillFlare 0..1   neck/crest frill display: 0 laid flat .. 1 fully flared
// earPerk/earPitch/earFlare/frillFlare are EXPRESSIVE (emotion) deltas that ride
// on top of the age-lerped NEUTRAL ear pose the generator supplies via opts.ears.
const DEFAULTS = {
  eyeOpen: 1, pupilX: 0, pupilY: 0,
  browHeight: 0.3, browAngle: 0, browCurve: 0.2,
  mouthOpen: 0.06, mouthCurve: 0.1,
  earPerk: 0.2, earPitch: 0.1, earFlare: 0.1, frillFlare: 0.25,
};

// ---------------------------------------------------------------------------
// Emotion presets — each sets the face params (eyes + brows + mouth). The
// generator/harness expose these via a dropdown. Pupils stay mostly centered;
// expression carried by lids + brows + mouth (the mouth disambiguates and
// strengthens the read, per the face research).
// ---------------------------------------------------------------------------
export const EMOTIONS = {
  neutral:   { eyeOpen: 1.0,  pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.3,  browAngle: 0.0,  browCurve: 0.2,  mouthOpen: 0.06, mouthCurve: 0.1,  earPerk: 0.2,  earPitch: 0.1,  earFlare: 0.1,  frillFlare: 0.25 },
  happy:     { eyeOpen: 0.85, pupilX: 0.0,  pupilY: 0.15,  browHeight: 0.55, browAngle: -0.1, browCurve: 0.7,  mouthOpen: 0.18, mouthCurve: 0.85, earPerk: 0.6,  earPitch: 0.5,  earFlare: 0.15, frillFlare: 0.35 },
  content:   { eyeOpen: 0.55, pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.15, browAngle: 0.0,  browCurve: 0.8,  mouthOpen: 0.05, mouthCurve: 0.45, earPerk: 0.1,  earPitch: 0.15, earFlare: 0.35, frillFlare: 0.05 },
  curious:   { eyeOpen: 1.0,  pupilX: 0.35, pupilY: 0.25,  browHeight: 0.6,  browAngle: -0.25,browCurve: 0.55, mouthOpen: 0.2,  mouthCurve: 0.25, earPerk: 1.0,  earPitch: 0.8,  earFlare: 0.0,  frillFlare: 0.4  },
  surprised: { eyeOpen: 1.0,  pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.9,  browAngle: 0.0,  browCurve: 0.7,  mouthOpen: 0.75, mouthCurve: 0.0,  earPerk: 1.0,  earPitch: 0.45, earFlare: 0.0,  frillFlare: 0.85 },
  angry:     { eyeOpen: 0.7,  pupilX: 0.0,  pupilY: -0.1,  browHeight: -0.2, browAngle: 0.75, browCurve: -0.5, mouthOpen: 0.28, mouthCurve: -0.6, earPerk: -0.25,earPitch: -0.9, earFlare: 0.3,  frillFlare: 1.0  },
  sleepy:    { eyeOpen: 0.28, pupilX: 0.0,  pupilY: -0.35, browHeight: -0.1, browAngle: 0.05, browCurve: 0.1,  mouthOpen: 0.05, mouthCurve: -0.1, earPerk: -0.7, earPitch: -0.2, earFlare: 0.5,  frillFlare: 0.05 },
  // afraid: ears flat back + splayed, wide worried eyes, inner-up brows.
  afraid:    { eyeOpen: 1.0,  pupilX: 0.0,  pupilY: 0.1,   browHeight: 0.7,  browAngle: -0.55,browCurve: 0.5,  mouthOpen: 0.4,  mouthCurve: -0.25,earPerk: 0.3,  earPitch: -1.0, earFlare: 0.6,  frillFlare: 0.8  },
  // sad: ears fully drooped (Judy Hopps), inner-up brows, downturned mouth.
  sad:       { eyeOpen: 0.6,  pupilX: 0.0,  pupilY: -0.3,  browHeight: -0.1, browAngle: -0.8, browCurve: 0.35, mouthOpen: 0.05, mouthCurve: -0.55,earPerk: -0.8, earPitch: -0.3, earFlare: 0.2,  frillFlare: 0.1  },
};

export function emotionParams(name) {
  return { ...(EMOTIONS[name] || EMOTIONS.neutral) };
}

// ---------------------------------------------------------------------------
// createFaceRig(params, opts)
// ---------------------------------------------------------------------------
// opts:
//   headRadius : number  — radius of the head sphere the rig sits on (required-ish)
//   eyeSize    : number  — world radius of each eyeball (defaults from headRadius)
//   eyeHeight  : 0..1     — fraction up the skull the eyes sit (0 low .. 1 top)
//   eyeForward : 0..1     — how far forward on the hemisphere (1 = full front)
//   eyeSpread  : number   — lateral separation factor (default 0.55 of headRadius)
//   mouth      : {center, forward, up, width}  — mouth placement (relative to head
//                origin), supplied by the generator from the skull/snout/jaw bones.
//                All in head-local space. Omit to skip the mouth (eye-only rigs).
//   ears       : {anchors:[{pos,out,up}], size, length, width, droop, pointed,
//                pairs, neutral:{perk,pitch,flare}, proud} — expressive ear rig
//                (head-local anchors from the generator's skull bone). Omit / size 0
//                to skip ears entirely (genome-optional).
//   frill      : {size, extent, soft, R} — neck/crest frill petals on the skull rear;
//                posed by frillFlare. Omit / size 0 to skip.
//   brow       : {weight, sag} — structural brow thickness / outer-end sag modifiers
//                (default {1,0} reproduces the original brow exactly).
export function createFaceRig(params = {}, opts = {}) {
  const p = { ...DEFAULTS, ...params };
  const R = opts.headRadius ?? 1;
  const eyeR = opts.eyeSize ?? R * 0.4;
  const eyeHeight = opts.eyeHeight ?? 0.45;
  const eyeForward = opts.eyeForward ?? 0.72;
  const spread = (opts.eyeSpread ?? 0.55) * R;
  const brow = opts.brow || {};
  const browWeight = brow.weight ?? 1;
  const browSag = brow.sag ?? 0;

  const rig = new THREE.Group();
  rig.name = 'faceRig';
  // Store the layout so applyFaceParams can recompute poses at the same scale.
  rig.userData.layout = { R, eyeR, eyeHeight, eyeForward, spread, browWeight, browSag };

  // Vertical position of the eyes on the skull (y), and forward (z) on the sphere.
  const eyeY = lerp(-R * 0.15, R * 0.5, eyeHeight);
  // keep the eye on the sphere surface: z from remaining radius budget
  const eyeZ = Math.sqrt(Math.max(0.0001, R * R - eyeY * eyeY)) * eyeForward;

  for (const side of [-1, 1]) {
    const eye = makeEye(eyeR, side);
    eye.position.set(side * spread, eyeY, eyeZ);
    // toe eyes slightly outward so they wrap the head
    eye.rotation.y = side * 0.25;
    rig.add(eye);

    const brow = makeBrow(eyeR, side, browWeight, browSag);
    rig.add(brow);
  }

  // Mouth — a separate layered object (like the eyes) so it never gets swallowed
  // by the smooth/voxel body. Placed & oriented from the generator-supplied
  // skull/snout/jaw frame; sized in head-radius units so it reads at any age.
  if (opts.mouth) {
    const m = makeMouth(opts.mouth);
    rig.add(m);
    rig.userData.mouth = {
      width: opts.mouth.width ?? R * 0.9,
      headR: R,
    };
  }

  // Ears — expressive 2-segment (base + tip) rotation chain per ear, mirrored L/R,
  // layered on top like the eyes/mouth so smooth/voxel skin never swallows them.
  // Built ONCE; all posing is rotation-only (no geometry rebuild on emotion change).
  if (opts.ears && (opts.ears.size ?? 0) > 0.01) {
    rig.userData.ears = buildEars(rig, opts.ears);
  }

  // Frill / crest — a row of petals on the skull rear, posed by frillFlare.
  if (opts.frill && (opts.frill.size ?? 0) > 0.01) {
    rig.userData.frill = buildFrill(rig, opts.frill);
  }

  applyFaceParams(rig, p);
  return rig;
}

// ---------------------------------------------------------------------------
// Ears — the highest-leverage cuteness feature. Each ear is a cheap 2-segment
// rotation chain (base pivot + tip pivot) reusing taperedTube, driven entirely by
// rotations so emotion changes need NO geometry rebuild (and it ports 1:1 to
// Bedrock bones). `earPairs` 2–3 adds Toothless-style trailing plates that follow
// the main pair at reduced amplitude (automatic overlapping action).
// ---------------------------------------------------------------------------
function buildEars(rig, e) {
  const size = e.size;                          // world length unit (earSize * R)
  const length = e.length ?? 1;
  const width = e.width ?? 1;
  const pointed = clamp(e.pointed ?? 0.6, 0, 1);
  const pairs = Math.max(1, Math.min(3, Math.round(e.pairs ?? 1)));
  const proud = e.proud ? 1.04 : 1.0;

  const earLen = size * length * 1.55;
  const baseLen = earLen * 0.55;
  const tipLen = earLen * 0.45;
  const baseW = size * width * 0.34;
  const midW = baseW * 0.92;
  const tipW = baseW * 0.5;

  // shared geometry (built once); tinted plates. Inner-ear a pinker inset.
  const outerMat = new THREE.MeshStandardMaterial({ color: 0x4a3b38, roughness: 0.6, metalness: 0 });
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x9a5f63, roughness: 0.7, metalness: 0 });
  const baseGeo = earSegGeometry(baseLen, baseW, midW, 0.15);            // barely tapers
  const tipGeo = earSegGeometry(tipLen, midW, tipW, pointed);           // tapers to point
  const innerGeo = earSegGeometry(baseLen * 0.92, baseW * 0.6, midW * 0.5, 0.3);

  const PAIR_SCALE = [1.0, 0.7, 0.5];
  const PAIR_AMP = [1.0, 0.5, 0.25];
  const items = [];

  for (let pi = 0; pi < pairs; pi++) {
    for (const anchor of e.anchors) {
      const side = anchor.pos.x < 0 ? -1 : 1;
      const root = new THREE.Group();
      root.name = `ear${side < 0 ? 'L' : 'R'}${pi ? '_' + pi : ''}`;
      // trailing pairs cascade down-and-back along the skull, at reduced scale.
      const back = pi * size * 0.9;
      root.position.copy(anchor.pos).multiplyScalar(proud)
        .add(new THREE.Vector3(0, -pi * size * 0.55, -back));
      root.scale.setScalar(PAIR_SCALE[pi]);

      const baseMesh = new THREE.Mesh(baseGeo, outerMat);
      baseMesh.name = 'earBase';
      baseMesh.scale.z = 0.42;                    // flatten into a leaf/plate
      root.add(baseMesh);

      if (pi === 0) {                             // inner-ear only on the main pair
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.name = 'earInner';
        inner.scale.z = 0.30;
        inner.position.z = baseW * 0.28;          // proud of the front plate face
        root.add(inner);
      }

      const tip = new THREE.Group();
      tip.name = 'earTip';
      tip.position.set(0, baseLen, 0);
      const tipMesh = new THREE.Mesh(tipGeo, outerMat);
      tipMesh.name = 'earTipMesh';
      tipMesh.scale.z = 0.42;
      tip.add(tipMesh);
      root.add(tip);

      rig.add(root);
      items.push({ root, tip, side, amp: PAIR_AMP[pi] });
    }
  }

  return {
    items,
    neutral: e.neutral || { perk: 0.2, pitch: 0.0, flare: 0.1 },
    droop: clamp(e.droop ?? 0.25, 0, 1),
  };
}

// One ear segment: a taperedTube swept up +Y, tip sharpness from `pointed` (0
// rounded lobe .. 1 sharp point). Flattened downstream (scale.z) into a plate.
function earSegGeometry(len, rBase, rTip, pointed) {
  const P0 = new THREE.Vector3(0, 0, 0);
  const C = new THREE.Vector3(0, len * 0.5, 0);
  const P1 = new THREE.Vector3(0, len, 0);
  const path = new THREE.QuadraticBezierCurve3(P0, C, P1);
  const pExp = lerp(0.7, 2.2, clamp(pointed, 0, 1));   // tip taper exponent
  const radiusFn = (t) => {
    const body = lerp(rBase, rTip, t);                 // linear base->tip
    const point = Math.pow(1 - t, pExp);               // sharpen the very tip
    return Math.max(1e-3, body * lerp(1, point, t));   // full width at base -> point at tip
  };
  return taperedTube(path, 12, 7, radiusFn);
}

// Neck/crest frill: a fan of petals across the rear-top of the skull. Posed by
// frillFlare (petals pitch away from the body + scale slightly) — the frilled-
// lizard display, doubling as a threat/excitement expression. Softness controls
// rounded-fleshy (axolotl) vs sharp-webbed (spiky) petal tips.
function buildFrill(rig, f) {
  const R = f.R ?? 1;
  const size = f.size;                            // world unit (frillSize * R)
  const soft = clamp(f.soft ?? 0.7, 0, 1);
  const extent = clamp(f.extent ?? 0.3, 0, 1);
  const nPetals = 5 + Math.round(extent * 4);     // 5..9 petals
  const petalLen = size * lerp(0.9, 1.5, extent);
  const petalW = size * 0.16;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6a4a52, roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
  });
  const geo = earSegGeometry(petalLen, petalW, petalW * 0.35, 1 - soft * 0.7);

  const items = [];
  const grp = new THREE.Group();
  grp.name = 'frill';
  for (let i = 0; i < nPetals; i++) {
    const u = nPetals > 1 ? i / (nPetals - 1) - 0.5 : 0;   // -0.5..0.5 across
    const petal = new THREE.Mesh(geo, mat);
    petal.scale.z = 0.4;
    // seat across the rear crown of the skull, arcing down the sides toward the neck.
    petal.position.set(u * R * 1.15, R * (0.55 - u * u * 0.6), -R * (0.55 + Math.abs(u) * 0.1));
    petal.userData.spanU = u;
    grp.add(petal);
    items.push({ petal, u });
  }
  rig.add(grp);
  return { items, R };
}

// A single eye: white eyeball (front-facing dome) + a dark pupil that rides on
// its surface. Built pointing +z (forward).
function makeEye(eyeR, side) {
  const grp = new THREE.Group();
  grp.name = side < 0 ? 'eyeL' : 'eyeR';

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
  const white = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 14), whiteMat);
  white.name = 'white';
  grp.add(white);

  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.2, metalness: 0 });
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 14, 12), pupilMat);
  pupil.name = 'pupil';
  pupil.userData.eyeR = eyeR;
  grp.add(pupil);

  // a tiny catch-light for life
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(eyeR * 0.13, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  glint.name = 'glint';
  grp.add(glint);

  grp.userData.eyeR = eyeR;
  return grp;
}

// A soft, arched, tapered brow. Built as a 3-point quadratic bezier (inner, mid,
// outer) swept into a thin tube whose radius tapers to a soft point at both ends
// — NOT a straight bar. Lives in a local frame: +x = along the brow (inner end at
// -x, so it can be mirrored per side), arch bows up in +y, thin in z. The arch
// amount is driven by browCurve; the whole brow is then positioned close above the
// eye and tilted by browAngle in applyFaceParams. Geometry is rebuilt only when
// browCurve changes (cached on userData.curveKey).
function makeBrow(eyeR, side, weight = 1, sag = 0) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.55, metalness: 0 });
  const brow = new THREE.Mesh(browGeometry(eyeR, 0.2, weight, sag), mat);
  brow.name = side < 0 ? 'browL' : 'browR';
  brow.userData.side = side;
  brow.userData.eyeR = eyeR;
  brow.userData.curveKey = 0.2;
  brow.userData.weight = weight;
  brow.userData.sag = sag;
  return brow;
}

// Build the arched, tapered brow geometry for a given curve value (-1..1).
// Higher curve = rounder/softer arch; lower = flatter, sterner. Radius tapers
// from a thin middle to soft points at both ends so it never reads as a rod.
// `weight` (thickness multiplier, 1 = original) and `sag` (0..1, drops the OUTER
// end for a heavy bloodhound/grandpa brow) are STRUCTURAL genome modifiers —
// weight 1 / sag 0 reproduce the original brow exactly.
function browGeometry(eyeR, curve, weight = 1, sag = 0) {
  const hx = eyeR * 0.85;                         // half length (~ eye width)
  const cN = (clamp(curve, -1, 1) + 1) / 2;       // 0..1
  const arch = eyeR * lerp(0.05, 0.55, cN);       // control-point rise (arch)
  const outerDrop = eyeR * clamp(sag, 0, 1) * 0.6;// heavy brow: outer end sags down
  const P0 = new THREE.Vector3(-hx, 0, 0);        // inner end (mirrored per side)
  const C  = new THREE.Vector3(0, arch, 0);       // mid control (arch peak)
  const P1 = new THREE.Vector3(hx, -outerDrop, 0);// outer end (sags with `sag`)
  const path = new THREE.QuadraticBezierCurve3(P0, C, P1);
  const rMax = eyeR * 0.17 * Math.max(0.2, weight);// mid thickness (thin, soft)
  // inner end a touch fatter than the outer for a natural brow taper
  const radiusFn = (t) => rMax * Math.pow(Math.sin(Math.PI * t), 0.55) * lerp(1.1, 0.85, t) + eyeR * 0.012 * weight;
  return taperedTube(path, 22, 7, radiusFn);
}

// A floating cartoon mouth: a curved dark band spanning the front of the lower
// head. A single filled ribbon between an UPPER lip arc (smile/frown shape) and a
// LOWER lip arc that drops by mouthOpen — so one mesh reads both a closed curved
// line and an open jaw. Built in a local frame (+x across, +y up, +z forward);
// the generator orients/positions the group from the skull/snout/jaw bones.
function makeMouth(mouthOpts) {
  const grp = new THREE.Group();
  grp.name = 'mouth';

  // Orient: local +z -> forward, local +y -> up (right-handed basis).
  const z = mouthOpts.forward.clone().normalize();
  const up = (mouthOpts.up || new THREE.Vector3(0, 1, 0)).clone();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  grp.position.copy(mouthOpts.center);

  const width = mouthOpts.width ?? 1;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a0d10, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
  });
  const band = new THREE.Mesh(mouthBandGeometry(width, 0.06, 0.1), mat);
  band.name = 'band';
  band.userData.width = width;
  // hover just off the head surface so it layers on top of smooth/voxel skin.
  band.position.z = width * 0.09;
  grp.add(band);

  // TODO(teeth/tongue/fangs): a later step attaches teeth/fangs/tusks along the
  // jaw — sample the LOWER lip arc of mouthBandGeometry (y = arc(t) - open) as the
  // gum line and instance small cones/cuboids there; tongue = a small flattened
  // sphere at (0, midpoint of the two arcs, +z). Left un-built on purpose.

  return grp;
}

// Build the curved mouth ribbon. `open` = vertical jaw gap, `curve` = smile(+)/
// frown(-). Upper arc gives the mouth-line shape; lower arc = upper arc dropped by
// `open` (min a thin lip so a closed mouth still reads as a curved line). A slight
// backward z bow at the corners lets it wrap the rounded snout instead of floating.
function mouthBandGeometry(width, open, curve) {
  const hw = width * 0.5;
  const m = clamp(curve, -1, 1);
  const cornerY = m * width * 0.3;                  // corners: up=smile, down=frown
  const centerY = -m * width * 0.22;                // middle dips opposite the corners
  const gap = Math.max(width * 0.06, open * width * 0.6); // closed still shows a line
  const zBow = width * 0.14;                          // corners recede to wrap the head
  const N = 20;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const t = u * 2 - 1;                              // -1..1 across the mouth
    const x = t * hw;
    const yU = lerp(centerY, cornerY, t * t);         // parabolic arc (mouth line)
    const z = -zBow * t * t;                           // wrap back at the corners
    pos.push(x, yU, z);                                // upper lip vertex
    pos.push(x, yU - gap, z);                          // lower lip vertex
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, d, a, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Sweep a 3D curve into a tube with a per-length variable radius (radiusFn(t) in
// 0..1). Mirrors THREE.TubeGeometry's frame construction but allows tapering, so
// the brow can narrow to soft points at both ends. Planar curves are stable here.
function taperedTube(path, tubularSegments, radialSegments, radiusFn) {
  const frames = path.computeFrenetFrames(tubularSegments, false);
  const pos = [];
  const idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    path.getPointAt(u, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = Math.max(1e-4, radiusFn(u));
    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v), cos = -Math.cos(v);
      pos.push(
        P.x + r * (cos * N.x + sin * B.x),
        P.y + r * (cos * N.y + sin * B.y),
        P.z + r * (cos * N.z + sin * B.z),
      );
    }
  }
  const stride = radialSegments + 1;
  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = stride * (i - 1) + (j - 1);
      const b = stride * i + (j - 1);
      const c = stride * i + j;
      const d = stride * (i - 1) + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// applyFaceParams(rig, params) — pose the rig from face params without rebuilding.
// ---------------------------------------------------------------------------
export function applyFaceParams(rig, params = {}) {
  if (!rig || !rig.userData.layout) return;
  const p = { ...DEFAULTS, ...params };
  const { R, eyeR, spread, eyeForward } = rig.userData.layout;

  for (const side of [-1, 1]) {
    const eye = rig.getObjectByName(side < 0 ? 'eyeL' : 'eyeR');
    const brow = rig.getObjectByName(side < 0 ? 'browL' : 'browR');
    if (!eye || !brow) continue;

    // --- eyelid openness: squash the eyeball vertically (crude but reads well) ---
    const open = clamp(p.eyeOpen, 0.05, 1);
    eye.scale.set(1, open, 1);

    // --- pupil gaze: ride the pupil across the eyeball surface toward +z ---
    const pupil = eye.getObjectByName('pupil');
    const glint = eye.getObjectByName('glint');
    if (pupil) {
      const gx = clamp(p.pupilX, -1, 1) * eyeR * 0.45;
      const gy = clamp(p.pupilY, -1, 1) * eyeR * 0.45;
      const gz = Math.sqrt(Math.max(0.0001, eyeR * eyeR - gx * gx - gy * gy)) * 0.92;
      pupil.position.set(gx, gy / Math.max(0.2, open), gz); // divide so pupil stays visible when squinting
      if (glint) glint.position.set(gx - eyeR * 0.18, gy / Math.max(0.2, open) + eyeR * 0.18, gz + eyeR * 0.35);
    }

    // --- brow: soft arched tube sitting CLOSE above the eye, anchored on the
    // head surface (not floating), tilted by angle, arch shape from curve ---
    const curve = clamp(p.browCurve, -1, 1);
    // rebuild the arched geometry only when the curve changes (cheap, but avoid
    // per-frame churn); dispose the old geometry so we don't leak buffers.
    if (brow.userData.curveKey !== curve) {
      brow.geometry.dispose();
      brow.geometry = browGeometry(eyeR, curve, brow.userData.weight ?? 1, brow.userData.sag ?? 0);
      brow.userData.curveKey = curve;
    }
    // height above the eye center — small so it hugs the eye (close, not antenna).
    const browY = eye.position.y + eyeR * (0.95 + 0.5 * clamp(p.browHeight, -1, 1));
    // anchor z onto the head sphere at that height, then hover slightly proud of
    // the surface (Wind Waker trick) so it reads as attached, never detached.
    const surfZ = Math.sqrt(Math.max(0.0001, R * R - Math.min(browY * browY, R * R))) * eyeForward;
    brow.position.set(side * spread, browY, surfZ + eyeR * 0.22);
    // mirror so the built-in inner end (local -x) always points toward the face
    // centerline; angle then tilts the inner end down (angry, +) / up (worried, -).
    const angle = clamp(p.browAngle, -1, 1) * 0.7;
    brow.scale.set(side, 1, 1);          // side=-1 mirrors the left brow
    brow.rotation.set(0, 0, side * angle);
  }

  // --- mouth: rebuild the curved band on open/curve change, dispose old buffer ---
  const mouthGrp = rig.getObjectByName('mouth');
  const mouthInfo = rig.userData.mouth;
  if (mouthGrp && mouthInfo) {
    const band = mouthGrp.getObjectByName('band');
    const open = clamp(p.mouthOpen, 0, 1);
    const mcurve = clamp(p.mouthCurve, -1, 1);
    const key = open.toFixed(3) + ':' + mcurve.toFixed(3);
    if (band && band.userData.key !== key) {
      band.geometry.dispose();
      band.geometry = mouthBandGeometry(mouthInfo.width, open, mcurve);
      band.userData.key = key;
    }
  }

  // --- ears: pose each ear (base pivot + tip pivot) from the 3 expressive params
  // composed onto the age-lerped neutral pose. Rotation-only — no geometry rebuild.
  const ears = rig.userData.ears;
  if (ears) {
    const nP = ears.neutral, droop = ears.droop;
    for (const it of ears.items) {
      // deltas ride on the neutral pose, scaled per trailing-pair amplitude.
      const perk  = clamp(nP.perk  + clamp(p.earPerk,  -1, 1) * it.amp, -1, 1.2);
      const pitch = clamp(nP.pitch + clamp(p.earPitch, -1, 1) * it.amp, -1.2, 1.2);
      const flare = clamp(nP.flare + clamp(p.earFlare,  0, 1) * it.amp, 0, 1.4);
      // droop compresses reachable erectness: a floppy ear can lift but never fully pricks.
      const perkEff = ((perk + 1) / 2) * (1 - 0.5 * droop);

      const REST_FLARE = 0.42, REST_BACK = 0.1;
      // base pivot (head axes): X = fore/aft lean, Y = slight toe on swivel, Z = splay.
      const rotX = pitch * 0.95 - (perkEff - 0.45) * 0.4 - REST_BACK;
      const rotY = it.side * pitch * 0.12;
      const rotZ = -it.side * (REST_FLARE + flare * 0.9);
      it.root.rotation.set(rotX, rotY, rotZ, 'ZYX');
      // tip pivot: straight when pricked, folds forward/down when drooped or floppy.
      const fold = lerp(1.75, 0.06, perkEff) + droop * 0.9;
      it.tip.rotation.set(fold, 0, 0);
    }
  }

  // --- frill: petals pitch away from the body + scale up slightly with flare ---
  const frill = rig.userData.frill;
  if (frill) {
    const flare = clamp(p.frillFlare, 0, 1);
    for (const it of frill.items) {
      // laid-back (flat against neck) at flare 0 -> erect/fanned at flare 1.
      const pitch = lerp(1.5, 0.15, flare);          // rotation back from vertical
      const splay = it.u * lerp(0.15, 0.7, flare);   // fan the outer petals wider
      it.petal.rotation.set(pitch, 0, -it.u * 0.3 - splay);
      it.petal.scale.y = lerp(0.82, 1.12, flare);
    }
  }
}
