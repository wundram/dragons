// springs.js — PHASE 2 (secondary motion). See
// research/procedural-animation-behavior.md §6 / §D "springs".
//
// A cheap, always-on SPRING-BONE / damped-follow-through pass applied to the
// soft appendages so they LAG and JIGGLE with the body's motion — the
// "alive/weighty" feel. Runs LAST, every frame, AFTER the pose/idle/locomotion
// bone passes, so it composes with (never fights) walk/run/fly and the emotion
// ear poses.
//
// Chains driven:
//   - TAIL   (tail_02..tail_11)          trails & sways on turns/gait; tip lags most
//   - EARS   (ear{L,R}_mid, ear{L,R}_tip) flop/bounce ON TOP of the emotion pose
//   - WINGS  (fore{L,R}_finger0_01/_02)  membrane/finger tips trail on the flap
//
// Integrator (per spring bone, per XYZ component of a small local angular offset):
//   1. Recover the POSED base written upstream this frame (see below).
//   2. Kick velocity by the parent's per-frame world rotation, mapped into the
//      bone's local frame and NEGATED — so the bone momentarily lags where its
//      parent just went (inertia), then a spring pulls it back.
//   3. v += -stiffness·x·dt ;  v *= exp(-damping·dt) ;  x += v·dt   (stable spring)
//   4. Clamp |x| (deflection cap) so it can never explode.
//   5. Apply  bone.quaternion = base · euler(x).
//
// COMPOSING with upstream without a fight: each frame we compare the bone's
// current quaternion to what WE wrote last frame (`applied`). If upstream
// rewrote it (idle sway, a gait, an emotion re-pose), that fresh value becomes
// the new spring `base`; if not (a static bone), the stored base is kept. A
// large base jump (a pose switch / rebuild) zeroes the velocity and shrinks the
// deflection so discontinuities settle instead of snapping.
//
// STABILITY is paramount: dt is clamped (<= 1/30) so a stalled tab can't blow up
// the integrator, the per-frame parent delta is capped, exponential damping is
// used, and every deflection is clamped. No Math.random anywhere.
//
// Unskinned modes (voxel/capsule) have no rig -> createSprings returns an inert
// controller (update() is a no-op).

import * as THREE from 'three';

const pad2 = (n) => String(n).padStart(2, '0');
const MAX_DT = 1 / 30;          // clamp so a stalled frame can't destabilise the springs
const OM_CAP = 0.5;             // max parent rotation (rad) reacted-to per frame
const JUMP_DOT = 0.9;           // |quat dot| below this == a pose discontinuity (~>50°)
const lerp = (a, b, t) => a + (b - a) * t;

// scratch
const _qp = new THREE.Quaternion();
const _qpPrevInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _qBoneW = new THREE.Quaternion();
const _qBoneWInv = new THREE.Quaternion();
const _omega = new THREE.Vector3();
const _euler = new THREE.Euler();
const _off = new THREE.Quaternion();

// Quaternion -> rotation vector (axis * shortest-angle).
function quatToRotVec(q, out) {
  let w = q.w; if (w > 1) w = 1; else if (w < -1) w = -1;
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-6) { out.set(0, 0, 0); return out; }
  let angle = 2 * Math.acos(w);
  if (angle > Math.PI) angle -= 2 * Math.PI;   // shortest arc
  const k = angle / s;
  return out.set(q.x * k, q.y * k, q.z * k);
}

// ---------------------------------------------------------------------------
// createSprings(dragon, rig) -> controller
//   { update(dt), reset(), enabled, dispose() }
// ---------------------------------------------------------------------------
export function createSprings(dragon, rig) {
  if (!dragon || !rig) {
    return { update() {}, reset() {}, get enabled() { return false; }, set enabled(_) {}, dispose() {} };
  }
  const byName = rig.boneByName;
  const springs = [];

  // Add a bone chain. Params interpolate along it: base end (t=0) is stiffer &
  // less reactive (stays glued to the body); the tip (t=1) is looser & lags more.
  function addChain(names, o) {
    const bones = names.map((n) => byName[n]).filter(Boolean);
    const N = Math.max(1, bones.length - 1);
    bones.forEach((bone, i) => {
      const t = i / N;
      springs.push({
        bone,
        x: new THREE.Vector3(), v: new THREE.Vector3(),
        base: bone.quaternion.clone(),
        applied: bone.quaternion.clone(),
        qpPrev: new THREE.Quaternion(), init: false,
        stiffness: lerp(o.stiff0, o.stiff1, t),
        damping: o.damping,
        react: lerp(o.react0, o.react1, t),
        maxAngle: o.maxAngle,
      });
    });
  }

  // TAIL — trails on turns & undulates with the gait; the tip lags most.
  addChain([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((j) => `tail_${pad2(j)}`),
    { stiff0: 95, stiff1: 30, damping: 8.5, react0: 0.45, react1: 1.5, maxAngle: 0.22 });

  // EARS — mid + tip flop/bounce composed ON TOP of the emotion ear pose (the
  // pose is the spring `base`; the spring only adds a subtle offset, so
  // curious/angry ears still read). Driven by the ear-root idle wiggle + body.
  for (const side of ['L', 'R']) {
    addChain([`ear${side}_mid`, `ear${side}_tip`],
      { stiff0: 75, stiff1: 42, damping: 8, react0: 0.8, react1: 1.35, maxAngle: 0.26 });
  }

  // WING membrane / finger tips — trail on the flap.
  for (const side of ['L', 'R']) {
    addChain([`fore${side}_finger0_01`, `fore${side}_finger0_02`],
      { stiff0: 120, stiff1: 70, damping: 11, react0: 0.35, react1: 0.85, maxAngle: 0.16 });
  }

  let enabled = true;

  function reset() {
    for (const sp of springs) {
      sp.x.set(0, 0, 0); sp.v.set(0, 0, 0);
      sp.base.copy(sp.bone.quaternion);
      sp.applied.copy(sp.bone.quaternion);
      sp.init = false;
    }
  }

  function update(dt) {
    if (!enabled || springs.length === 0) return;
    dt = Math.min(MAX_DT, Math.max(0, dt));
    if (dt <= 0) return;

    for (const sp of springs) {
      const b = sp.bone;

      // (1) Recover the posed base. If upstream rewrote the bone since our last
      // write, adopt it (idle sway / gait / emotion re-pose); a big jump == a
      // discontinuity -> settle instead of snapping.
      if (!b.quaternion.equals(sp.applied)) {
        if (Math.abs(sp.base.dot(b.quaternion)) < JUMP_DOT) {
          sp.v.set(0, 0, 0); sp.x.multiplyScalar(0.25);
        }
        sp.base.copy(b.quaternion);
      }

      // (2) Parent per-frame world rotation -> local reaction kick.
      if (b.parent) b.parent.getWorldQuaternion(_qp); else _qp.identity();
      if (!sp.init) { sp.qpPrev.copy(_qp); sp.init = true; }
      _qpPrevInv.copy(sp.qpPrev).invert();
      _dq.copy(_qp).multiply(_qpPrevInv);          // world rotation the parent underwent
      quatToRotVec(_dq, _omega);
      const om = _omega.length();
      if (om > OM_CAP) _omega.multiplyScalar(OM_CAP / om);   // cap discontinuities
      _qBoneW.copy(_qp).multiply(sp.base);         // bone's (posed) world orientation
      _qBoneWInv.copy(_qBoneW).invert();
      _omega.applyQuaternion(_qBoneWInv);          // -> bone-local rotation vector
      sp.v.addScaledVector(_omega, -sp.react);     // lag opposite to parent motion
      sp.qpPrev.copy(_qp);

      // (3) Spring + exponential damping (stable at any dt).
      sp.v.addScaledVector(sp.x, -sp.stiffness * dt);
      sp.v.multiplyScalar(Math.exp(-sp.damping * dt));
      sp.x.addScaledVector(sp.v, dt);

      // (4) Clamp deflection so it can never explode.
      const mag = sp.x.length();
      if (mag > sp.maxAngle) { sp.x.multiplyScalar(sp.maxAngle / mag); sp.v.multiplyScalar(0.5); }

      // (5) Apply: base (posed) composed with the additive spring offset.
      _off.setFromEuler(_euler.set(sp.x.x, sp.x.y, sp.x.z, 'XYZ'));
      b.quaternion.copy(sp.base).multiply(_off);
      sp.applied.copy(b.quaternion);
    }
  }

  return {
    update, reset,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (enabled) reset(); },
    dispose() {},
  };
}
