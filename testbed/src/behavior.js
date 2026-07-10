// behavior.js — PHASE 3 of the animation system (see
// research/procedural-animation-behavior.md §E "Behavior FSM"). A TWO-LEVEL
// controller that makes a dragon "live its life":
//
//   BEHAVIOR BRAIN (the "what"):  picks one of the nine behaviors + a dwell time.
//     In AUTO mode it's a seeded, weighted RANDOM WALK over a legal-transition
//     graph (rest→stand→walk→…, occasionally posture/beg/play/fly) with per-
//     behavior dwell times — deterministic from a PRNG seed, time-driven (never
//     Math.random per frame). The available behavior set is FILTERED per dragon:
//     a wingless drake never picks flying, a limbless snake never begs/plays/etc.
//
//   MOTOR LAYER (the "how"):  realizes the chosen behavior via a key POSE
//     (poses.js) + a GAIT (locomotion.js setSpeed) + a face MOOD (emotion preset),
//     with a SMOOTH CROSS-FADE (~0.5 s) between the outgoing and incoming pose so
//     switches never snap. Ground↔air transitions ride the fly gait's own air
//     blend (take-off lifts, landing settles). A few behaviors add a small live
//     procedural OVERLAY (posturing tail-lash, begging paw-paddle, playing bounce)
//     for extra life.
//
// The controller writes the CROSS-FADED pose into the rig's poseBase every frame
// via rig.applyPoseQuats(); the existing pipeline (idle sway → locomotion → springs
// → face) then composes on top exactly as before. It runs in animate() BEFORE the
// idle step. In 'manual' mode the controller is INERT (update() no-ops) so the
// hand pose / gait / emotion controls drive the rig unchanged.
//
// Unskinned modes (voxel/capsule) have no rig -> createBehavior returns an inert
// controller (update() a no-op), so the caller degrades gracefully.

import * as THREE from 'three';
import { POSES } from './poses.js';

// ---------------------------------------------------------------------------
// Behavior table — each maps to a pose (poses.js), a gait (locomotion setSpeed),
// a face mood (an EMOTIONS preset), a dwell window [min,max] seconds, and an
// optional live overlay. `needsLimbs` behaviors are skipped for the limbless
// serpent; `flying` is skipped unless the plan canFly.
// ---------------------------------------------------------------------------
const BEHAVIORS = {
  resting:   { pose: 'curl-sleep', gait: 'idle', mood: 'sleepy',  dwell: [7, 12] },
  roosting:  { pose: 'roost',      gait: 'idle', mood: 'content', dwell: [6, 10], needsLimbs: true },
  standing:  { pose: 'stand',      gait: 'idle', mood: 'neutral', dwell: [3, 6] },
  posturing: { pose: 'posture',    gait: 'idle', mood: 'angry',   dwell: [3, 5], needsLimbs: true, overlay: 'lash' },
  begging:   { pose: 'beg',        gait: 'idle', mood: 'curious', dwell: [3, 5], needsLimbs: true, overlay: 'paw' },
  playing:   { pose: 'play-bow',   gait: 'idle', mood: 'happy',   dwell: [3, 6], needsLimbs: true, overlay: 'bounce' },
  walking:   { pose: 'idle',       gait: 'walk', mood: 'neutral', dwell: [5, 9] },
  running:   { pose: 'idle',       gait: 'run',  mood: 'neutral', dwell: [3, 6] },
  flying:    { pose: 'idle',       gait: 'fly',  mood: 'curious', dwell: [7, 12], needsFly: true },
};
export const BEHAVIOR_NAMES = Object.keys(BEHAVIORS);

// Legal-transition graph with weights — a creature-plausible day-in-the-life:
// rest/roost settle, stand is the hub that branches to the lively behaviors,
// walk↔run, and takeoff→fly→land back to stand.
const ADJ = {
  resting:   { standing: 3, roosting: 2 },
  roosting:  { standing: 3, resting: 2 },
  standing:  { walking: 3, resting: 2, roosting: 1.5, posturing: 1.2, begging: 1.2, playing: 1.2, flying: 1 },
  posturing: { standing: 3, playing: 1 },
  begging:   { standing: 3, playing: 1 },
  playing:   { standing: 2, running: 1.2, walking: 1 },
  walking:   { standing: 2, running: 2, playing: 1, flying: 1 },
  running:   { walking: 3, standing: 1 },
  flying:    { standing: 2.5, flying: 1 },
};

const CROSSFADE = 0.55;   // seconds — pose cross-fade duration (spec: 0.4–0.8 s)
const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

// Deterministic PRNG (mulberry32) — seeded so AUTO mode replays exactly.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pre-bake each pose's sparse euler map into a boneName -> Quaternion map (once).
const _e = new THREE.Euler();
function bakePoseQuats(pose) {
  const out = {};
  for (const name in pose) {
    const r = pose[name];
    out[name] = new THREE.Quaternion().setFromEuler(_e.set(r[0] || 0, r[1] || 0, r[2] || 0, 'XYZ'));
  }
  return out;
}
const POSE_QUATS = {};
for (const name in POSES) POSE_QUATS[name] = bakePoseQuats(POSES[name]);
const IDENT = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// createBehavior(dragon, rig, loco, opts) -> controller
//   dragon : the generated THREE.Group
//   rig    : AnimRig (null in voxel/capsule -> inert)
//   loco   : LocomotionController (drives gaits)
//   opts   : { seed?, setMood(name) }  — setMood applies a face emotion preset
//            LIVE (without touching the genome/dropdown), so a behavior's mood
//            composes over, and never permanently clobbers, the user's manual
//            emotion (it is re-applied only ON a behavior switch, not per frame).
// ---------------------------------------------------------------------------
export function createBehavior(dragon, rig, loco, opts = {}) {
  if (!dragon || !rig) {
    return {
      update() {}, setBehavior() {}, setAuto() {},
      get behavior() { return 'manual'; }, get auto() { return false; },
      get available() { return []; }, dispose() {},
    };
  }
  const setMood = opts.setMood || (() => {});
  const rand = mulberry32((opts.seed ?? 1234) >>> 0);

  const plan = loco ? loco.plan : 'quadruped';
  const canFly = loco ? loco.canFly : false;

  // Per-archetype available behavior set (skip fly if wingless, skip limb-only
  // behaviors for the limbless serpent).
  const available = BEHAVIOR_NAMES.filter((n) => {
    const b = BEHAVIORS[n];
    if (b.needsFly && !canFly) return false;
    if (b.needsLimbs && plan === 'serpent') return false;
    return true;
  });
  const isAvailable = (n) => available.includes(n);

  // -- Mutable state ----------------------------------------------------------
  let mode = 'manual';        // 'manual' (inert) | a behavior name
  let auto = false;
  let current = 'standing';   // current behavior (when not manual)
  let dwellDur = 4;           // seconds to dwell in the current behavior
  let nextT = -1;             // absolute time (s) to switch at; -1 = (re)arm on next update

  // Cross-fade state: livePose is the union of bones written last frame; from/to
  // are the pose-quat maps we blend between; blend advances 0..1 over CROSSFADE.
  const livePose = {};        // boneName -> THREE.Quaternion (persisted result)
  let fromQuats = {};
  let toQuats = POSE_QUATS.stand;
  let blend = 1;
  let unionKeys = Object.keys(toQuats);

  const _tmp = new THREE.Quaternion();
  const _ov = new THREE.Quaternion();
  const _oe = new THREE.Euler();

  function snapshotLive() {
    // clone livePose so a subsequent write doesn't mutate the from-target.
    const snap = {};
    for (const k in livePose) snap[k] = livePose[k].clone();
    return snap;
  }

  // Begin a cross-fade toward behavior `name`. immediate=true settles instantly
  // (used on rebuild so an age-scrub doesn't replay the fade).
  function beginBehavior(name, immediate) {
    current = name;
    const b = BEHAVIORS[name];
    fromQuats = snapshotLive();
    toQuats = POSE_QUATS[b.pose] || {};
    unionKeys = Array.from(new Set([...Object.keys(fromQuats), ...Object.keys(toQuats)]));
    blend = immediate ? 1 : 0;
    // gait: set immediately; the fly gait eases its own take-off/land air blend,
    // ground gaits just start their cadence (the pose fade carries the posture).
    if (loco) loco.setSpeed(b.gait);
    // mood: apply ONCE per switch (composes over manual emotion; not per-frame).
    setMood(b.mood);
    // dwell drawn from the behavior's window; armed against an ABSOLUTE wall-clock
    // deadline on the next update (robust to frame drops / rAF throttling — the
    // timer must not depend on the per-frame physics-capped dt).
    const [lo, hi] = b.dwell;
    dwellDur = lo + (hi - lo) * rand();
    nextT = -1;
  }

  // Weighted pick of the next behavior from the current one's adjacency, filtered
  // to the available set. Falls back to 'standing' (always available).
  function pickNext() {
    const opts2 = ADJ[current] || { standing: 1 };
    let total = 0;
    const entries = [];
    for (const n in opts2) {
      if (!isAvailable(n)) continue;
      total += opts2[n];
      entries.push([n, total]);
    }
    if (entries.length === 0) return 'standing';
    const r = rand() * total;
    for (const [n, cum] of entries) if (r <= cum) return n;
    return entries[entries.length - 1][0];
  }

  // Live procedural overlay for a few behaviors (scaled by the fade `a`), composed
  // onto the target quats before they're written. Small, sine-based, deterministic.
  function applyOverlay(kind, t, a) {
    if (!kind || a < 0.01) return;
    if (kind === 'lash') {
      // posturing: slow menacing tail-lash (base yaw) + a little head sway.
      const y = 0.16 * a * Math.sin(2 * Math.PI * 0.6 * t);
      for (let j = 0; j <= 4; j++) composeInto(`tail_0${j}`, 0, y * (1 - 0.12 * j), 0);
      composeInto('spine_02', 0, 0.05 * a * Math.sin(2 * Math.PI * 0.5 * t), 0);
    } else if (kind === 'paw') {
      // begging: paddle the raised forepaws in small circles (endearing).
      const c = 0.22 * a * Math.sin(2 * Math.PI * 1.1 * t);
      const s = 0.22 * a * Math.cos(2 * Math.PI * 1.1 * t);
      composeInto('foreL_foreArm', c, 0, s);
      composeInto('foreR_foreArm', c, 0, -s);
    } else if (kind === 'bounce') {
      // playing: springy vertical bob (trunk pitch pump) + excited tail wag.
      const bob = 0.10 * a * Math.sin(2 * Math.PI * 1.6 * t);
      composeInto('spine_12', bob, 0, 0);
      composeInto('spine_14', bob, 0, 0);
      const wag = 0.28 * a * Math.sin(2 * Math.PI * 2.2 * t);
      for (let j = 0; j <= 4; j++) composeInto(`tail_0${j}`, 0, wag * (0.5 + 0.12 * j), 0);
    }
  }

  // Compose a small local euler delta onto a bone's live pose quat (in-place),
  // ensuring the bone is part of the written union.
  function composeInto(name, ex, ey, ez) {
    if (!rig.boneByName[name]) return;
    let q = livePose[name];
    if (!q) { q = livePose[name] = new THREE.Quaternion(); if (!unionKeys.includes(name)) unionKeys.push(name); }
    _ov.setFromEuler(_oe.set(ex, ey, ez, 'XYZ'));
    q.multiply(_ov);
  }

  // -- Per-frame update -------------------------------------------------------
  function update(dt, t) {
    if (mode === 'manual') return;   // inert — hand controls drive the rig
    dt = Math.min(0.05, Math.max(0, dt));

    // BRAIN: in auto, switch when the wall-clock dwell deadline passes.
    if (auto) {
      if (nextT < 0) nextT = t + dwellDur;      // (re)arm the deadline
      else if (t >= nextT) beginBehavior(pickNext(), false);
    }

    // MOTOR: advance + apply the cross-fade.
    if (blend < 1) blend = Math.min(1, blend + dt / CROSSFADE);
    const a = smooth(blend);
    // write the blended pose into livePose over the union of from/to bones.
    for (const name of unionKeys) {
      if (!rig.boneByName[name]) continue;
      const f = fromQuats[name] || IDENT;
      const to = toQuats[name] || IDENT;
      let q = livePose[name];
      if (!q) q = livePose[name] = new THREE.Quaternion();
      q.copy(f).slerp(to, a);
    }
    // remove bones that fully faded to identity and aren't in the target (keep the
    // union tidy so springs/idle don't see stale near-identity writes) — cheap.
    applyOverlay(BEHAVIORS[current].overlay, t, a);
    rig.applyPoseQuats(livePose);
  }

  return {
    update,
    // name: a behavior name or 'manual'. immediate settles the fade at once.
    setBehavior(name, immediate) {
      if (name === 'manual') { mode = 'manual'; return; }
      if (!BEHAVIORS[name]) return;
      mode = name;
      beginBehavior(name, !!immediate);
    },
    setAuto(on) {
      auto = !!on;
      if (auto) {
        // leaving manual (if we were) — kick off from a calm state.
        if (mode === 'manual') { mode = current; beginBehavior(current, false); }
        else beginBehavior(current, false);   // restart dwell so it starts stepping
      }
    },
    get behavior() { return mode === 'manual' ? 'manual' : current; },
    get auto() { return auto; },
    get available() { return available.slice(); },
    dispose() {},
  };
}
