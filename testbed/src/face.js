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
//   ├── browL (Mesh)
//   └── browR (Mesh)

import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Face params shape (all optional; sensible defaults applied):
//   eyeOpen    0..1   eyelid openness (1 wide, 0 shut)
//   pupilX    -1..1   gaze left/right
//   pupilY    -1..1   gaze down/up
//   browHeight-1..1   brow vertical offset above the eye
//   browAngle -1..1   brow tilt (+ inner-down = angry, - inner-up = sad)
//   browCurve -1..1   brow arch (+ raised/curious, - flat/stern)
const DEFAULTS = { eyeOpen: 1, pupilX: 0, pupilY: 0, browHeight: 0.3, browAngle: 0, browCurve: 0.2 };

// ---------------------------------------------------------------------------
// Emotion presets — each sets the six face params. The generator/harness expose
// these via a dropdown. Pupils stay centered; expression carried by lids+brows.
// ---------------------------------------------------------------------------
export const EMOTIONS = {
  neutral: { eyeOpen: 1.0, pupilX: 0.0, pupilY: 0.0, browHeight: 0.3, browAngle: 0.0, browCurve: 0.2 },
  happy:   { eyeOpen: 0.85, pupilX: 0.0, pupilY: 0.15, browHeight: 0.55, browAngle: -0.1, browCurve: 0.6 },
  curious: { eyeOpen: 1.0, pupilX: 0.35, pupilY: 0.25, browHeight: 0.6, browAngle: -0.25, browCurve: 0.5 },
  angry:   { eyeOpen: 0.7, pupilX: 0.0, pupilY: -0.1, browHeight: -0.2, browAngle: 0.7, browCurve: -0.5 },
  sleepy:  { eyeOpen: 0.28, pupilX: 0.0, pupilY: -0.35, browHeight: -0.1, browAngle: 0.05, browCurve: -0.2 },
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
export function createFaceRig(params = {}, opts = {}) {
  const p = { ...DEFAULTS, ...params };
  const R = opts.headRadius ?? 1;
  const eyeR = opts.eyeSize ?? R * 0.4;
  const eyeHeight = opts.eyeHeight ?? 0.45;
  const eyeForward = opts.eyeForward ?? 0.72;
  const spread = (opts.eyeSpread ?? 0.55) * R;

  const rig = new THREE.Group();
  rig.name = 'faceRig';
  // Store the layout so applyFaceParams can recompute poses at the same scale.
  rig.userData.layout = { R, eyeR, eyeHeight, eyeForward, spread };

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

    const brow = makeBrow(eyeR, side);
    rig.add(brow);
  }

  applyFaceParams(rig, p);
  return rig;
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

// A floating cartoon brow: a slightly curved bar (torus arc) above the eye.
function makeBrow(eyeR, side) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.6, metalness: 0 });
  // capsule-ish bar; use a thin box that we can rotate/curve via scale
  const geo = new THREE.CapsuleGeometry(eyeR * 0.14, eyeR * 1.4, 4, 8);
  const brow = new THREE.Mesh(geo, mat);
  brow.name = side < 0 ? 'browL' : 'browR';
  brow.userData.side = side;
  brow.userData.eyeR = eyeR;
  // capsule is vertical by default → lay it horizontal
  brow.rotation.z = Math.PI / 2;
  return brow;
}

// ---------------------------------------------------------------------------
// applyFaceParams(rig, params) — pose the rig from face params without rebuilding.
// ---------------------------------------------------------------------------
export function applyFaceParams(rig, params = {}) {
  if (!rig || !rig.userData.layout) return;
  const p = { ...DEFAULTS, ...params };
  const { R, eyeR, spread } = rig.userData.layout;

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

    // --- brow: float above the eye, tilt by angle, arch by curve ---
    const eyeY = eye.position.y;
    const baseH = eyeR * (1.2 + 0.9 * p.browHeight);   // height above eye center
    brow.position.set(
      side * spread,
      eyeY + baseH,
      eye.position.z + eyeR * 0.35
    );
    // angle: inner end down (angry) when browAngle>0. Inner end is toward center
    // (opposite of `side`), so rotate about z by side*angle.
    const angle = clamp(p.browAngle, -1, 1) * 0.8;
    // curve: arch the brow up (raise middle) — approximate by tilting on x and
    // scaling length; positive curve lifts, negative flattens/stern.
    const curve = clamp(p.browCurve, -1, 1);
    brow.rotation.set(-curve * 0.5, 0, Math.PI / 2 + side * angle);
    brow.scale.set(1, lerp(0.85, 1.15, (curve + 1) / 2), 1);
  }
}
