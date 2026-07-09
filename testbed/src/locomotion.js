// locomotion.js — PHASE 1 of the animation system (see
// research/procedural-animation-behavior.md §C/§D, build-order step 1).
//
// A morphology-adaptive procedural LOCOMOTION layer, composed ON TOP of the
// pose + gentle-idle pipeline (rig.js). Per frame it:
//
//   1. reads a BodyPlan descriptor MEASURED from the skeleton (which legs are
//      real, whether the forelimb is a wing, how serpentine the body is),
//   2. drives a gait appropriate to that plan:
//        - QUADRUPED (drake): 4-beat diagonal-sequence walk. Each leg swings via
//          a phase-oscillator step cycle; the planted foot is solved with analytic
//          TWO-BONE IK (upper+lower -> ground target). Body bob + weight-shift on
//          the spine, head/neck counter-motion.
//        - BIPED (wyvern): alternating 2-leg (hind) walk, IK-planted, arms/wings
//          left to the pose/idle layer, body counter-sway.
//        - SERPENT (snake / very long bodies): a traveling lateral sine down
//          spine_00..tail_11 — slither, no legs to plant.
//   3. advances the ROOT (the dragon Group) forward along its facing at a speed
//      MATCHED to the gait so stance feet don't skate (treadmill principle: in
//      body-local space a stance foot slides backward at exactly the body's
//      forward speed, so it reads world-planted). A gentle turn keeps the dragon
//      roughly in frame (walks a wide circle) — see TURN_RADIUS.
//
// speed:  'idle' (no-op — the rig's own idle is unchanged) | 'walk' | 'run'
//         (run = faster cadence + longer stride + more body motion) | 'fly'.
//
// FLIGHT ('fly'): dragons with FUNCTIONAL WINGS (a forelimb-wing plan — typically
// the biped wyvern) flap. The wing bones (_upperArm/_foreArm/_wrist + finger0
// chain) beat on a sine oscillator with a phase lag down the chain (shoulder
// leads, membrane/finger tips trail), the body pitches nose-up, hind legs tuck,
// the tail extends as a rudder, and the ROOT eases up to a cruise altitude and
// cruises the same wide in-frame circle as walk/run — but through the air.
// A LEGLESS SERPENT "flies" by cloud-swimming (the lateral undulation, airborne).
// A wingless plan (e.g. a four-legged drake) can't flap: setSpeed('fly') on it
// gracefully FALLS BACK to 'run' (it keeps moving on the ground instead of
// teleporting into the sky). Take-off/landing ease the root height (no snap).
//
// EVERYTHING is done in the dragon GROUP's LOCAL frame (bones live under the
// group; the group carries a uniform globalScale + a y-lift so rest feet sit at
// world y=0). Working in group-local keeps the IK independent of the root's
// world translation/rotation. Bones have IDENTITY rest rotation and are
// world-aligned at rest, so a bone's rest DIRECTION (tail-pos, from the skeleton
// spec) equals its bone-local axis — that's all the IK needs to emit local
// quaternions (see solveTwoBone).
//
// Unskinned modes (voxel/capsule) have no rig -> createLocomotion returns an inert
// controller (update() is a no-op), so the caller degrades gracefully.

import * as THREE from 'three';

const EPS = 0.012;                          // envelopeRadius below this => bone absent
const pad2 = (n) => String(n).padStart(2, '0');
const spineName = (i) => `spine_${pad2(i)}`;
const tailName = (j) => `tail_${pad2(j)}`;

// Gait presets. Distances/angles are in GROUP-LOCAL units (unscaled); root
// translation multiplies by globalScale. cadence = gait cycles / second.
const GAITS = {
  walk: { cadence: 0.85, duty: 0.68, stride: 0.55, lift: 0.20, bob: 1.0, undA: 0.20, undLambda: 0.50 },
  run:  { cadence: 1.65, duty: 0.52, stride: 0.98, lift: 0.42, bob: 2.0, undA: 0.30, undLambda: 0.55 },
};

// FLIGHT preset (the `fly` gait). Distances are GROUP-LOCAL (× globalScale for
// world). `cadence` = wing-beats / second. A legless serpent reuses undA/undLambda
// to "cloud-swim" through the air (no wing bones to flap).
const FLY = {
  cadence: 1.05,               // wing-beats per second
  rise: 2.6,                   // group-local height gained aloft (cruise altitude)
  speed: 1.15,                 // forward air speed at full amplitude
  bob: 0.12,                   // vertical heave amplitude, synced to the beat
  undA: 0.34, undLambda: 0.62, // serpent cloud-swim undulation
};
const AIR_EASE = 1.8;          // rate of the take-off / settle height blend (1/s)

// Diagonal-sequence 4-beat footfall offsets (fraction of the cycle) — a leg
// lifts when its own phase crosses `duty`. Diagonal pairs (hindL,foreR) /
// (hindR,foreL) move together-ish for a readable 4-beat walk.
const QUAD_OFFSET = { hindL: 0.00, foreR: 0.30, hindR: 0.50, foreL: 0.80 };
const BIPED_OFFSET = { hindL: 0.00, hindR: 0.50 };

const TURN_RADIUS = 3.4;   // world units — walks a wide circle so it stays in frame

// ---------------------------------------------------------------------------
// Scratch objects (module-level; one controller drives per frame).
// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _u = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _K = new THREE.Vector3();
const _dirU = new THREE.Vector3();
const _dirL = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _qPar = new THREE.Quaternion();
const _qParInv = new THREE.Quaternion();
const _qUpper = new THREE.Quaternion();
const _qUw = new THREE.Quaternion();
const _qUwInv = new THREE.Quaternion();
const _qLower = new THREE.Quaternion();
const _qTmp = new THREE.Quaternion();
const _grpInv = new THREE.Quaternion();
const _euler = new THREE.Euler();

// small vector: unit rest direction, or null if degenerate.
function unitDir(a, b) {
  if (!a || !b) return null;
  const v = b.clone().sub(a);
  if (v.lengthSq() < 1e-9) return null;
  return v.normalize();
}

// ---------------------------------------------------------------------------
// createLocomotion(dragon, rig) -> controller
//   dragon : the generated THREE.Group (carries userData.skeleton + genome)
//   rig    : the AnimRig from upgradeToSkinned (null in voxel/capsule)
// ---------------------------------------------------------------------------
export function createLocomotion(dragon, rig) {
  // Inert controller when there's nothing to drive.
  if (!dragon || !rig) {
    return { update() {}, setSpeed() {}, get speed() { return 'idle'; },
      get plan() { return 'none'; }, get canFly() { return false; },
      get airborne() { return 0; }, dispose() {} };
  }

  const specs = dragon.userData.skeleton || [];
  const byName = {};
  for (const s of specs) byName[s.name] = s;
  const boneByName = rig.boneByName;
  const genome = dragon.userData.genome || {};
  const globalScale = dragon.scale.x || 1;

  // -- Body-plan measurement (continuous descriptors from the skeleton) --------
  const present = (nm) => { const s = byName[nm]; return !!s && (s.envelopeRadius ?? 0) >= EPS; };
  const boneLen = (nm) => { const s = byName[nm]; return s ? (s.length ?? (s.tail ? s.pos.distanceTo(s.tail) : 0)) : 0; };

  const hasHind = present('hindL_upper') || present('hindR_upper');
  const hasForeArm = present('foreL_upperArm') || present('foreR_upperArm');
  // Forelimb is a WING (not a walking leg) when the primary finger (finger0)
  // greatly out-reaches the arm — the leading-edge spar — or a membrane mesh
  // exists. Then the forelimb doesn't plant.
  const arm = boneLen('foreL_upperArm') + boneLen('foreL_foreArm');
  let finger0 = 0;
  for (let s2 = 0; s2 < 3; s2++) finger0 += boneLen(`foreL_finger0_${pad2(s2)}`);
  const wingsGroup = dragon.getObjectByName('wings');
  const hasMembrane = !!(wingsGroup && wingsGroup.children.some((m) => m.isMesh));
  const foreIsWing = hasMembrane && finger0 > 1.25 * Math.max(arm, 0.01);
  const foreIsLeg = hasForeArm && !foreIsWing;

  const elong = genome.bodyElongation ?? 1.0;
  // serpent-ness: strong when legs are absent/weak; boosted by a very long body.
  let serpent = (hasHind ? 0 : 0.5) + (foreIsLeg ? 0 : 0.5);
  serpent = Math.min(1, serpent + Math.max(0, (elong - 1.6)) * 0.35);

  let plan;
  if (!hasHind && !foreIsLeg) plan = 'serpent';
  else if (serpent > 0.75) plan = 'serpent';
  else if (hasHind && foreIsLeg) plan = 'quadruped';
  else plan = 'biped';

  // -- Leg descriptors (only the legs this plan actually plants) ---------------
  // A leg: { key, upper, lower, restU, restL, L1, L2, home(ankle/wrist rest),
  //          pole(group-local bend dir), offset }.
  const legs = [];
  const addLeg = (key, upperNm, lowerNm, poleZ, offset) => {
    const su = byName[upperNm], sl = byName[lowerNm];
    if (!su || !sl || !boneByName[upperNm] || !boneByName[lowerNm]) return;
    const restU = unitDir(su.pos, su.tail);
    const restL = unitDir(sl.pos, sl.tail);
    if (!restU || !restL) return;
    legs.push({
      key,
      upper: boneByName[upperNm], lower: boneByName[lowerNm],
      restU, restL,
      L1: su.pos.distanceTo(su.tail), L2: sl.pos.distanceTo(sl.tail),
      home: sl.tail.clone(),                    // ankle / wrist rest pos (group-local)
      pole: new THREE.Vector3(0, 0, poleZ),     // hind knee bends +z (fwd); fore elbow -z (back)
      offset,
    });
  };
  if (plan === 'quadruped') {
    addLeg('hindL', 'hindL_upper', 'hindL_lower', 1, QUAD_OFFSET.hindL);
    addLeg('hindR', 'hindR_upper', 'hindR_lower', 1, QUAD_OFFSET.hindR);
    addLeg('foreL', 'foreL_upperArm', 'foreL_foreArm', -1, QUAD_OFFSET.foreL);
    addLeg('foreR', 'foreR_upperArm', 'foreR_foreArm', -1, QUAD_OFFSET.foreR);
  } else if (plan === 'biped') {
    addLeg('hindL', 'hindL_upper', 'hindL_lower', 1, BIPED_OFFSET.hindL);
    addLeg('hindR', 'hindR_upper', 'hindR_lower', 1, BIPED_OFFSET.hindR);
  }

  // -- Axial chain for undulation / spine motion (head->tail arc param) ---------
  const axial = [];
  for (let i = 0; i < 24; i++) { const b = boneByName[spineName(i)]; if (b) axial.push({ b, s: i / 35 }); }
  for (let j = 0; j < 12; j++) { const b = boneByName[tailName(j)]; if (b) axial.push({ b, s: (24 + j) / 35 }); }
  // Trunk bones used for walk body-bob / weight-shift + neck counter-motion.
  const trunk = [10, 12, 14, 16].map((i) => boneByName[spineName(i)]).filter(Boolean);
  const neck = [0, 1, 2, 3].map((i) => boneByName[spineName(i)]).filter(Boolean);
  const tailBones = [];
  for (let j = 0; j < 12; j++) { const b = boneByName[tailName(j)]; if (b) tailBones.push(b); }

  // -- Wing chains (forelimb) for flapping flight ------------------------------
  // Gathered for both sides; flight only flaps when `canFlap` (a real wing plan).
  const wingChains = [];
  for (const side of ['L', 'R']) {
    const pre = `fore${side}_`;
    const ua = boneByName[pre + 'upperArm'];
    if (!ua) continue;
    const fingers = [];
    for (let k = 0; k < 3; k++) { const b = boneByName[`${pre}finger0_${pad2(k)}`]; if (b) fingers.push(b); }
    wingChains.push({ sign: side === 'L' ? 1 : -1, ua, fa: boneByName[pre + 'foreArm'], wr: boneByName[pre + 'wrist'], fingers });
  }
  const canFlap = foreIsWing && wingChains.length > 0;   // articulated wings
  const canFly = canFlap || plan === 'serpent';          // serpent flies by cloud-swim

  // -- Mutable state -----------------------------------------------------------
  let speed = 'idle';
  let phase = 0;        // gait cycle phase [0,1)
  let wavePhase = 0;    // undulation wave phase (radians)
  const groundY = dragon.position.y;   // rest ground height (world y); flight lifts from here
  let air = 0;                         // airborne blend [0,1] — eased on take-off / landing

  // -- Analytic two-bone IK (upper+lower -> target T, all group-local) ----------
  // Emits LOCAL quaternions for the two bones. Accounts for the live parent world
  // orientation (so body-bob that moves/rotates the girdle doesn't desync feet).
  function solveTwoBone(leg, A, T) {
    const L1 = leg.L1, L2 = leg.L2;
    const dRaw = A.distanceTo(T);
    const d = Math.min(Math.max(dRaw, Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3);
    _u.copy(T).sub(A); if (_u.lengthSq() < 1e-9) return; _u.multiplyScalar(1 / d);
    const a = (d * d + L1 * L1 - L2 * L2) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    // bend direction = pole component perpendicular to the A->T axis.
    _bend.copy(leg.pole).addScaledVector(_u, -leg.pole.dot(_u));
    if (_bend.lengthSq() < 1e-6) { _bend.set(0, 1, 0).addScaledVector(_u, -_u.y); }
    _bend.normalize();
    _K.copy(A).addScaledVector(_u, a).addScaledVector(_bend, h);   // knee / elbow
    _dirU.copy(_K).sub(A).normalize();                            // desired upper dir
    _dirL.copy(T).sub(_K).normalize();                            // desired lower dir

    // parent world orientation (in group frame) of the upper bone.
    leg.upper.parent.getWorldQuaternion(_qPar);
    _qPar.premultiply(_grpInv);            // -> group-local orientation
    _qParInv.copy(_qPar).invert();

    // upper: local q so its (rest-dir) axis points to _dirU in group space.
    _v1.copy(_dirU).applyQuaternion(_qParInv);
    _qUpper.setFromUnitVectors(leg.restU, _v1);
    leg.upper.quaternion.copy(_qUpper);

    // lower: parent is the upper we just set. Its group-world orient = _qPar*_qUpper.
    _qUw.copy(_qPar).multiply(_qUpper);
    _qUwInv.copy(_qUw).invert();
    _v2.copy(_dirL).applyQuaternion(_qUwInv);
    _qLower.setFromUnitVectors(leg.restL, _v2);
    leg.lower.quaternion.copy(_qLower);
  }

  // Foot target for a leg at the current cycle phase (group-local). Treadmill:
  // stance foot slides backward (-z) at the body's forward speed; swing arcs fwd.
  function footTarget(leg, out) {
    const g = GAITS[speed];
    let p = (phase + leg.offset) % 1; if (p < 0) p += 1;
    out.copy(leg.home);
    if (p < g.duty) {
      const s = p / g.duty;                       // 0..1 across stance
      out.z += g.stride * (0.5 - s);              // front -> back
    } else {
      const uSw = (p - g.duty) / (1 - g.duty);    // 0..1 across swing
      out.z += g.stride * (-0.5 + uSw);           // back -> front
      out.y += g.lift * Math.sin(Math.PI * uSw);  // lift arc
    }
  }

  // -- Per-frame update --------------------------------------------------------
  function update(dt) {
    dt = Math.min(0.05, Math.max(0, dt));

    // Airborne blend: ease toward flight height while flying, back to the ground
    // otherwise — so take-off lifts and landing settles the root smoothly (no
    // teleport). Runs even outside 'fly' so leaving flight glides back down.
    const wantFly = (speed === 'fly');
    air += ((wantFly ? 1 : 0) - air) * (1 - Math.exp(-AIR_EASE * dt));
    if (air < 1e-4) air = 0;

    // Fully grounded + idle => original no-op (frame reads exactly as before).
    // Snap the root exactly back to the ground once on landing, then no-op after.
    if (!wantFly && air === 0 && (speed === 'idle' || !GAITS[speed])) {
      if (dragon.position.y !== groundY) dragon.position.y = groundY;
      return;
    }

    dragon.getWorldQuaternion(_grpInv).invert();   // group->local rotation, reused by IK

    if (wantFly) { updateFlight(dt); return; }

    // Descending out of flight but the gait is now idle: keep settling height.
    if (air > 0) dragon.position.y = groundY + air * FLY.rise * globalScale;
    if (speed === 'idle' || !GAITS[speed]) return;

    const g = GAITS[speed];
    if (plan === 'serpent') updateSerpent(dt, g);
    else updateLegged(dt, g);
  }

  // -- Flapping flight ---------------------------------------------------------
  function updateFlight(dt) {
    const amp = air;   // scales wing amplitude + air speed in during take-off

    if (plan === 'serpent') {
      // Cloud-swimming: a legless flyer undulates through the air (no wing bones).
      updateSerpent(dt, FLY);   // sets the lateral wave + advances the root
      dragon.position.y = groundY + (air * FLY.rise + FLY.bob * Math.sin(wavePhase) * amp) * globalScale;
      return;
    }

    wavePhase += 2 * Math.PI * FLY.cadence * dt;
    const beat = wavePhase;
    // Cruise altitude + gentle vertical heave synced to the beat (body lifts on
    // the powered down-stroke).
    dragon.position.y = groundY + (air * FLY.rise + FLY.bob * Math.sin(beat) * amp) * globalScale;

    if (canFlap) flapWings(beat, amp);
    flightBody(beat, amp);
    advanceRoot(dt, FLY.speed * amp);
  }

  // Beat the wing chains: shoulder leads, elbow/wrist/finger lag progressively
  // (phase offset down the chain) so the membrane + finger tips trail — the
  // characteristic whip. Roll (z) is the main flap axis (see the wings-open pose).
  function flapWings(beat, amp) {
    const s0 = Math.sin(beat);
    const s1 = Math.sin(beat - 0.6);
    const s2 = Math.sin(beat - 1.1);
    const s3 = Math.sin(beat - 1.6);
    for (const w of wingChains) {
      const g = w.sign;
      // upperArm: held out (spread) + big roll flap; a little fore/aft sweep on yaw.
      setLocalEuler(w.ua, -0.14 * amp, g * (0.16 + 0.10 * Math.cos(beat)) * amp, g * (0.34 + 0.62 * s0) * amp);
      if (w.fa) setLocalEuler(w.fa, -0.05 * amp, g * 0.08 * amp, g * (0.12 + 0.40 * s1) * amp);
      if (w.wr) setLocalEuler(w.wr, 0, g * 0.05 * amp, g * (0.06 + 0.30 * s2) * amp);
      for (let k = 0; k < w.fingers.length; k++) {
        const f = 1 - 0.18 * k;                              // tips flex a touch less far
        setLocalEuler(w.fingers[k], 0, g * 0.10 * amp * f, g * (0.08 + 0.24 * s3) * amp * f);
      }
    }
  }

  // Body attitude in flight: nose-up climb pitch, head levels/leads, hind legs
  // tuck, tail lifts toward horizontal and trails as a rudder (springs add the
  // real trailing lag on top). Composed onto the idle sway.
  function flightBody(beat, amp) {
    for (const b of trunk) compose(b, -0.05 * amp, 0, 0);    // pitch nose-up (climb)
    for (const b of neck) compose(b, 0.03 * amp, 0, 0);      // head leads / levels
    for (const leg of legs) {                                 // tuck the hind legs up
      leg.upper.quaternion.setFromEuler(_euler.set(0.55 * amp, 0, 0, 'XYZ'));
      leg.lower.quaternion.setFromEuler(_euler.set(-1.0 * amp, 0, 0, 'XYZ'));
    }
    const n = Math.max(1, tailBones.length - 1);
    for (let j = 0; j < tailBones.length; j++) {
      const t = j / n;
      compose(tailBones[j], -0.045 * amp * (1 - 0.3 * t), 0.045 * Math.sin(beat - 1.3 - t * 1.2) * amp, 0);
    }
  }

  function setLocalEuler(b, x, y, z) { b.quaternion.setFromEuler(_euler.set(x, y, z, 'XYZ')); }

  function updateLegged(dt, g) {
    phase = (phase + g.cadence * dt) % 1;

    // -- body motion on the spine (composed onto the idle output) --------------
    // vertical bob at 2x cadence + lateral weight-shift roll at 1x + a subtle
    // serpentine yaw for long-bodied blends. Applied BEFORE the IK's world update
    // so sockets move with the body and the feet stay planted (IK compensates).
    const bobA = 0.022 * g.bob;
    const rollA = 0.030 * g.bob;
    const pitch = bobA * Math.sin(2 * Math.PI * 2 * phase);
    const roll = rollA * Math.sin(2 * Math.PI * phase);
    for (const b of trunk) compose(b, pitch, 0, roll);
    // head/neck counter-motion (opposite, damped) so the head stays level.
    for (const b of neck) compose(b, -pitch * 0.4, 0, -roll * 0.6);
    // long-body blend: a faint lateral wave down the whole axis.
    if (serpent > 0.05) {
      const A = 0.05 * serpent;
      for (const a of axial) {
        const yaw = A * (0.2 + 0.8 * a.s) * Math.sin(2 * Math.PI * (a.s / 0.7 - phase));
        compose(a.b, 0, yaw, 0);
      }
    }

    // world matrices now reflect the body motion; sockets read live below.
    dragon.updateMatrixWorld(true);

    for (const leg of legs) {
      leg.upper.getWorldPosition(_v1);
      dragon.worldToLocal(_v1);                 // socket A (group-local)
      const A = _v1.clone();
      footTarget(leg, _v2);                     // target T (group-local)
      solveTwoBone(leg, A, _v2.clone());
    }

    advanceRoot(dt, g.stride * g.cadence / g.duty);   // v_local (units/s)
  }

  function updateSerpent(dt, g) {
    wavePhase += 2 * Math.PI * g.cadence * dt;
    const A = g.undA;
    const lam = g.undLambda;
    // slow turning bias curls the body so it circles in-frame.
    const turnBias = 0.02 * Math.sin(wavePhase * 0.15);
    for (const a of axial) {
      const env = 0.18 + 0.82 * a.s;            // small at head -> big mid/tail
      const yaw = A * env * Math.sin(2 * Math.PI * (a.s / lam) - wavePhase) + turnBias;
      a.b.quaternion.setFromEuler(_euler.set(0, yaw, 0, 'XYZ'));
    }
    // forward crawl: wave-speed * amplitude, tuned slip constant.
    advanceRoot(dt, 0.9 * A * (2 * Math.PI * g.cadence) * lam);
  }

  // Translate + gently turn the group. vLocal is group-local units/sec; the world
  // translation multiplies by globalScale. A wide-circle yaw keeps it in frame.
  function advanceRoot(dt, vLocal) {
    const vWorld = vLocal * globalScale;
    _fwd.set(0, 0, 1).applyQuaternion(dragon.quaternion);   // group forward in world
    dragon.position.addScaledVector(_fwd, vWorld * dt);
    const turnRate = vWorld / TURN_RADIUS;                   // omega = v / r
    dragon.rotateY(turnRate * dt);
  }

  // compose a small local euler delta onto a bone's current quaternion.
  function compose(b, ex, ey, ez) {
    _qTmp.setFromEuler(_euler.set(ex, ey, ez, 'XYZ'));
    b.quaternion.multiply(_qTmp);
  }

  return {
    update,
    setSpeed(s) {
      if (s === 'fly') { speed = canFly ? 'fly' : 'run'; return; }   // wingless -> fall back to run
      if (s === 'idle' || GAITS[s]) speed = s;
    },
    get speed() { return speed; },
    get plan() { return plan; },
    get canFly() { return canFly; },
    get airborne() { return air; },   // 0 grounded .. 1 at cruise altitude
    dispose() {},
  };
}
