// poses.js — Named full-body key poses for the Phase-0 rig (Overgrowth-style:
// each pose is a SPARSE set of per-bone local rotations; liveliness later comes
// from interpolation + idle + secondary motion). Applied via rig.applyPose().
//
// Conventions
// -----------
// * Rotations are LOCAL bone euler angles in radians, order 'XYZ'. Rest bone
//   rotation is identity and the bone frame is (near) world-aligned, so:
//     +X = pitch DOWN the head-side / drop the jaw   (nose-down for spine)
//     +Y = yaw to the dragon's LEFT
//     +Z = roll
//   The re-rooted spine means a head-ward `spine_i` rotation swings the HEAD side
//   about that joint; a tail-ward `tail_j`/`spine_2x` rotation swings the tail.
// * Poses are MORPHOLOGY-TOLERANT: a bone a given dragon lacks (e.g. a snake's
//   arms, whose bones exist but carry ~no skin) is simply skipped by the rig.
// * Forelimb/hind bones are mirrored L/R by negating Y and Z (reflection across
//   the sagittal x=0 plane).

const d = (deg) => deg * Math.PI / 180;

// Mirror a left-side [x,y,z] to the right side (reflection across x=0 plane).
const mir = (r) => [r[0], -r[1], -r[2]];

// Spread a per-side forelimb/hind pose over both sides into a flat bone map.
// sideMap: { boneSuffix: [x,y,z] } for the LEFT side; foreL_*/foreR_* etc.
function bilateral(prefixL, prefixR, sideMap) {
  const out = {};
  for (const suffix in sideMap) {
    out[prefixL + suffix] = sideMap[suffix];
    out[prefixR + suffix] = mir(sideMap[suffix]);
  }
  return out;
}

// A gentle S-curve of head-ward neck vertebrae (spine_00..05) about a given axis.
function neck(axis, degTotal) {
  const out = {};
  for (let i = 0; i <= 5; i++) {
    const r = [0, 0, 0];
    r[axis] = d(degTotal / 6);
    out[`spine_${String(i).padStart(2, '0')}`] = r;
  }
  return out;
}

// ---------------------------------------------------------------------------
// POSES — the named table. Values are { boneName: [x,y,z] radians } (sparse).
// ---------------------------------------------------------------------------
export const POSES = {
  // Neutral rest (the generator's built pose). Idle layer adds the "alive".
  idle: {},

  // Composed, weight-settled standing pose: a touch of neck lift, tail relaxed
  // down, legs squared. Reads as "attentive stand" vs. the flat rest.
  stand: {
    ...neck(0, -10),                 // lift the head a little (nose up)
    spine_18: [d(2), 0, 0],
    tail_00: [d(6), 0, 0], tail_01: [d(6), 0, 0], tail_02: [d(5), 0, 0],
    tail_03: [d(4), 0, 0], tail_04: [d(3), 0, 0],
  },

  // Rear up on the hind legs: arch the front of the trunk UP, head up, forelimbs
  // raised, tail swings down as a counterbalance.
  'rear-up': {
    spine_18: [d(-13), 0, 0], spine_16: [d(-13), 0, 0], spine_14: [d(-12), 0, 0],
    spine_12: [d(-11), 0, 0], spine_10: [d(-9), 0, 0], spine_08: [d(-6), 0, 0],
    ...neck(0, 22),                  // let the head come back level/up
    ...bilateral('foreL', 'foreR', { _upperArm: [d(-40), 0, d(18)], _foreArm: [d(-25), 0, 0] }),
    tail_00: [d(24), 0, 0], tail_01: [d(20), 0, 0], tail_02: [d(16), 0, 0],
    tail_03: [d(12), 0, 0], tail_04: [d(9), 0, 0], tail_05: [d(6), 0, 0],
  },

  // Wings open / spread: raise + sweep both forelimbs up-and-out (carries the
  // membrane), fan finger0 (the main spar). Also perks the head a touch.
  'wings-open': {
    ...bilateral('foreL', 'foreR', {
      _upperArm: [d(-18), d(14), d(22)],
      _foreArm: [d(-4), d(6), d(12)],
      _wrist: [0, 0, d(8)],
      _finger0_00: [0, d(12), 0], _finger0_01: [0, d(8), 0],
    }),
    ...neck(0, -8),
  },

  // Roar: jaw dropped wide, head reared up, chest raised, forelimbs braced out.
  roar: {
    jaw: [d(44), 0, 0],              // drop the lower jaw open
    ...neck(0, -30),                 // rear the head UP
    spine_08: [d(-6), 0, 0], spine_10: [d(-6), 0, 0], spine_12: [d(-4), 0, 0],
    ...bilateral('foreL', 'foreR', { _upperArm: [d(-16), d(10), d(14)] }),
  },

  // Curl to sleep: coil the neck + tail laterally around the body, settle low.
  'curl-sleep': {
    // neck curls to the dragon's left, tucking the head toward the flank.
    spine_00: [0, d(22), 0], spine_01: [0, d(22), 0], spine_02: [0, d(20), 0],
    spine_03: [0, d(18), 0], spine_04: [0, d(15), 0], spine_05: [0, d(12), 0],
    spine_08: [0, d(8), 0], spine_10: [0, d(8), 0], spine_12: [0, d(6), 0],
    // tail sweeps around into a spiral.
    tail_00: [0, d(20), 0], tail_01: [0, d(22), 0], tail_02: [0, d(24), 0],
    tail_03: [0, d(26), 0], tail_04: [0, d(28), 0], tail_05: [0, d(30), 0],
    tail_06: [0, d(30), 0], tail_07: [0, d(30), 0], tail_08: [0, d(28), 0],
    tail_09: [0, d(26), 0], tail_10: [0, d(24), 0], tail_11: [0, d(22), 0],
    jaw: [d(4), 0, 0],
  },

  // Walk contact pose (a single mid-stride snapshot): opposite fore/hind reach,
  // a little spine counter-yaw. Not a gait — just a readable stepping key pose.
  'walk-contact': {
    spine_12: [0, d(5), 0], spine_16: [0, d(-4), 0],
    foreL_upperArm: [d(-26), 0, d(6)], foreL_foreArm: [d(14), 0, 0],
    foreR_upperArm: [d(20), 0, d(-6)], foreR_foreArm: [d(6), 0, 0],
    hindL_upper: [d(22), 0, 0], hindL_lower: [d(-18), 0, 0],
    hindR_upper: [d(-24), 0, 0], hindR_lower: [d(10), 0, 0],
    ...neck(0, -6),
    tail_00: [d(8), d(6), 0], tail_02: [d(6), d(8), 0], tail_04: [d(4), d(6), 0],
  },
};

export const POSE_NAMES = Object.keys(POSES);
