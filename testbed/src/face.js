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
const DEFAULTS = {
  eyeOpen: 1, pupilX: 0, pupilY: 0,
  browHeight: 0.3, browAngle: 0, browCurve: 0.2,
  mouthOpen: 0.06, mouthCurve: 0.1,
};

// ---------------------------------------------------------------------------
// Emotion presets — each sets the face params (eyes + brows + mouth). The
// generator/harness expose these via a dropdown. Pupils stay mostly centered;
// expression carried by lids + brows + mouth (the mouth disambiguates and
// strengthens the read, per the face research).
// ---------------------------------------------------------------------------
export const EMOTIONS = {
  neutral:   { eyeOpen: 1.0,  pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.3,  browAngle: 0.0,  browCurve: 0.2,  mouthOpen: 0.06, mouthCurve: 0.1 },
  happy:     { eyeOpen: 0.85, pupilX: 0.0,  pupilY: 0.15,  browHeight: 0.55, browAngle: -0.1, browCurve: 0.7,  mouthOpen: 0.18, mouthCurve: 0.85 },
  content:   { eyeOpen: 0.55, pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.15, browAngle: 0.0,  browCurve: 0.8,  mouthOpen: 0.05, mouthCurve: 0.45 },
  curious:   { eyeOpen: 1.0,  pupilX: 0.35, pupilY: 0.25,  browHeight: 0.6,  browAngle: -0.25,browCurve: 0.55, mouthOpen: 0.2,  mouthCurve: 0.25 },
  surprised: { eyeOpen: 1.0,  pupilX: 0.0,  pupilY: 0.0,   browHeight: 0.9,  browAngle: 0.0,  browCurve: 0.7,  mouthOpen: 0.75, mouthCurve: 0.0 },
  angry:     { eyeOpen: 0.7,  pupilX: 0.0,  pupilY: -0.1,  browHeight: -0.2, browAngle: 0.75, browCurve: -0.5, mouthOpen: 0.28, mouthCurve: -0.6 },
  sleepy:    { eyeOpen: 0.28, pupilX: 0.0,  pupilY: -0.35, browHeight: -0.1, browAngle: 0.05, browCurve: 0.1,  mouthOpen: 0.05, mouthCurve: -0.1 },
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

// A soft, arched, tapered brow. Built as a 3-point quadratic bezier (inner, mid,
// outer) swept into a thin tube whose radius tapers to a soft point at both ends
// — NOT a straight bar. Lives in a local frame: +x = along the brow (inner end at
// -x, so it can be mirrored per side), arch bows up in +y, thin in z. The arch
// amount is driven by browCurve; the whole brow is then positioned close above the
// eye and tilted by browAngle in applyFaceParams. Geometry is rebuilt only when
// browCurve changes (cached on userData.curveKey).
function makeBrow(eyeR, side) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.55, metalness: 0 });
  const brow = new THREE.Mesh(browGeometry(eyeR, 0.2), mat);
  brow.name = side < 0 ? 'browL' : 'browR';
  brow.userData.side = side;
  brow.userData.eyeR = eyeR;
  brow.userData.curveKey = 0.2;
  return brow;
}

// Build the arched, tapered brow geometry for a given curve value (-1..1).
// Higher curve = rounder/softer arch; lower = flatter, sterner. Radius tapers
// from a thin middle to soft points at both ends so it never reads as a rod.
function browGeometry(eyeR, curve) {
  const hx = eyeR * 0.85;                         // half length (~ eye width)
  const cN = (clamp(curve, -1, 1) + 1) / 2;       // 0..1
  const arch = eyeR * lerp(0.05, 0.55, cN);       // control-point rise (arch)
  const P0 = new THREE.Vector3(-hx, 0, 0);        // inner end (mirrored per side)
  const C  = new THREE.Vector3(0, arch, 0);       // mid control (arch peak)
  const P1 = new THREE.Vector3(hx, 0, 0);         // outer end
  const path = new THREE.QuadraticBezierCurve3(P0, C, P1);
  const rMax = eyeR * 0.17;                        // mid thickness (thin, soft)
  // inner end a touch fatter than the outer for a natural brow taper
  const radiusFn = (t) => rMax * Math.pow(Math.sin(Math.PI * t), 0.55) * lerp(1.1, 0.85, t) + eyeR * 0.012;
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
      brow.geometry = browGeometry(eyeR, curve);
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
}
