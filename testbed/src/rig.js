// rig.js — PHASE 0 of the animation system (see
// research/procedural-animation-behavior.md §A, build-order step 0).
//
// Turns a STATIC generated dragon Group into a LIVE, poseable rig:
//
//   1. Build a THREE.Bone hierarchy from `group.userData.skeleton`, RE-ROOTED at
//      the pelvis (spine_20) so head-ward vertebrae pivot at their trunk-side
//      joint — "bend the neck" bends the neck, not the whole trunk.
//   2. Order `Skeleton.bones` to match `geometry.userData.boneNames` so the body
//      mesh's existing field-softmax skinIndex/skinWeight map correctly, then
//      convert the body Mesh -> THREE.SkinnedMesh and bind it in the rest pose.
//   3. Make the LAYERED parts follow their bones:
//        - head group (face rig / tusks / barbels)  -> bone.attach to `skull`
//        - finger/toe/claw capsules (appendages)     -> bone.attach per bone
//        - wing membrane + discrete features         -> re-skinned to the SAME
//          skeleton (each vertex rigid-weighted to its nearest bone) so a rotated
//          wing/tail/spine bone carries its membrane/spikes/etc. with it.
//   4. Expose a clean POSE API (set a bone's local rotation by name; apply a named
//      full-body pose) + an always-on GENTLE IDLE (breathing + low-amplitude axial
//      sway + a slight ear idle) composed on top of the current pose.
//
// Skinning is hierarchy-agnostic (GPU path is Σ wᵢ·boneMatrixᵢ·bindInverseᵢ·v);
// only world matrices matter, so the re-rooting + custom bone origins are FREE —
// the bind inverses (computed once at rest) absorb them. The stored
// `userData.skeleton` (geo.json export, feature grid) is never mutated.
//
// Only the SMOOTH skin mode carries standard skin attributes; voxel/capsule
// modes are NOT skinned, so `upgradeToSkinned` returns null there (the caller
// degrades gracefully — no posing, no crash).

import * as THREE from 'three';
import { applyFaceParams } from './face.js';

const HIP_IDX = 20;                 // pelvis vertebra = animation root (re-root here)
const EPS = 0.012;                  // envelopeRadius below this => bone absent (matches generator/field)
const pad2 = (n) => String(n).padStart(2, '0');
const spineName = (i) => `spine_${pad2(i)}`;

// ---------------------------------------------------------------------------
// Geometry helper: squared distance from point p to segment a->b (all Vector3).
// ---------------------------------------------------------------------------
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
function distSqToSeg(px, py, pz, a, b) {
  _ab.set(b.x - a.x, b.y - a.y, b.z - a.z);
  _ap.set(px - a.x, py - a.y, pz - a.z);
  const l2 = _ab.lengthSq();
  let t = l2 > 1e-9 ? (_ap.dot(_ab) / l2) : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = _ap.x - _ab.x * t, dy = _ap.y - _ab.y * t, dz = _ap.z - _ab.z * t;
  return dx * dx + dy * dy + dz * dz;
}

// ---------------------------------------------------------------------------
// Re-rooting rule: given a skeleton spec, return { parent, origin } for its Bone.
//   spine_20 (HIP)     -> root (no parent), origin = pos
//   spine_<20 (head)   -> parent spine_{i+1}, origin = tail (trunk-side joint):
//                         rotating it swings the HEAD-side about that joint.
//   spine_>20 (tail)   -> parent spine_{i-1} (stored dir), origin = pos.
//   everything else    -> stored parent, origin = pos (skull->spine_00, girdles,
//                         limbs, tail_*, snout/jaw all keep their stored parent).
// ---------------------------------------------------------------------------
function rerootOf(spec) {
  const m = /^spine_(\d+)$/.exec(spec.name);
  if (m) {
    const i = +m[1];
    if (i === HIP_IDX) return { parent: null, origin: spec.pos };
    if (i < HIP_IDX) return { parent: spineName(i + 1), origin: spec.tail ?? spec.pos };
    return { parent: spineName(i - 1), origin: spec.pos };
  }
  return { parent: spec.parent, origin: spec.pos };
}

// ---------------------------------------------------------------------------
// Re-skin a plain (non-skinned) geometry rigidly to its nearest bones: every
// vertex is weighted 1.0 to the nearest present bone envelope. Robust and
// provenance-free — used for the wing membrane + discrete-feature meshes so each
// spike/membrane-panel follows the bone it physically sits on.
// ---------------------------------------------------------------------------
function addRigidSkinAttributes(geometry, candBones, boneIndex) {
  const pos = geometry.getAttribute('position');
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    let best = -1, bestD = Infinity;
    for (let c = 0; c < candBones.length; c++) {
      const s = candBones[c];
      const d = s.tail ? distSqToSeg(px, py, pz, s.pos, s.tail)
        : (px - s.pos.x) ** 2 + (py - s.pos.y) ** 2 + (pz - s.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = boneIndex[s.name]; }
    }
    si[v * 4] = best < 0 ? 0 : best;
    sw[v * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

// Convert a plain Mesh in the graph into a SkinnedMesh bound to `skeleton`,
// rigid-skinned to nearest bones, replacing it in-place under its parent.
function meshToNearestSkinned(mesh, candBones, boneIndex) {
  addRigidSkinAttributes(mesh.geometry, candBones, boneIndex);
  const sm = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
  sm.name = mesh.name;
  sm.castShadow = mesh.castShadow;
  sm.receiveShadow = mesh.receiveShadow;
  sm.frustumCulled = false;
  sm.position.copy(mesh.position);
  sm.quaternion.copy(mesh.quaternion);
  sm.scale.copy(mesh.scale);
  const parent = mesh.parent;
  parent.add(sm);
  parent.remove(mesh);
  return sm;
}

// ---------------------------------------------------------------------------
// upgradeToSkinned(dragon) -> AnimRig | null
// ---------------------------------------------------------------------------
export function upgradeToSkinned(dragon) {
  if (!dragon) return null;
  if (dragon.userData.skinMode !== 'smooth') return null;   // voxel/capsule: not skinned
  const specs = dragon.userData.skeleton;
  const bodyMesh = dragon.getObjectByName('body');
  if (!specs || !bodyMesh || !bodyMesh.geometry) return null;
  const boneNames = bodyMesh.geometry.userData.boneNames;
  if (!boneNames || !bodyMesh.geometry.getAttribute('skinIndex')) return null;

  // ---- 1. Bone objects (one per spec), with re-rooted parent + rest origin ---
  const boneObj = {};              // name -> THREE.Bone
  const specByName = {};
  for (const s of specs) { specByName[s.name] = s; }
  for (const s of specs) {
    const b = new THREE.Bone();
    b.name = s.name;
    boneObj[s.name] = b;
  }
  let root = null;
  for (const s of specs) {
    const { parent, origin } = rerootOf(s);
    const b = boneObj[s.name];
    b.userData.origin = origin.clone();
    if (parent && boneObj[parent]) boneObj[parent].add(b);
    else root = b;
  }
  // Local rest position = origin - parentOrigin (identity rest rotation).
  for (const s of specs) {
    const b = boneObj[s.name];
    const p = (b.parent && b.parent.isBone) ? b.parent : null;
    const po = p ? p.userData.origin : null;
    if (po) b.position.copy(b.userData.origin).sub(po);
    else b.position.copy(b.userData.origin);
  }

  // ---- 2. Skeleton.bones ORDER = boneNames first (so skinIndex maps), rest after
  const ordered = [];
  const seen = new Set();
  for (const nm of boneNames) { if (boneObj[nm]) { ordered.push(boneObj[nm]); seen.add(nm); } }
  for (const s of specs) { if (!seen.has(s.name)) { ordered.push(boneObj[s.name]); seen.add(s.name); } }
  const boneIndex = {};
  ordered.forEach((b, i) => { boneIndex[b.name] = i; });

  // ---- Convert body Mesh -> SkinnedMesh, carry root bone under it -------------
  const skinned = new THREE.SkinnedMesh(bodyMesh.geometry, bodyMesh.material);
  skinned.name = 'body';
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.frustumCulled = false;
  dragon.add(skinned);
  dragon.remove(bodyMesh);
  skinned.add(root);

  // Candidate bones for nearest-bone skinning of layered meshes: present envelopes.
  const candBones = specs.filter((s) => (s.envelopeRadius ?? 0) >= EPS);

  // ---- 3. Layered parts follow bones ----------------------------------------
  const extraSkins = [];
  // wing membranes -> rigid nearest-bone skin (leading edge on wing bones,
  // trailing edge on body bones) so wings-open spreads the membrane.
  const wings = dragon.getObjectByName('wings');
  if (wings) {
    for (const m of [...wings.children]) {
      if (m.isMesh) extraSkins.push(meshToNearestSkinned(m, candBones, boneIndex));
    }
  }
  // discrete features (spikes/sail/feathers/scutes) -> rigid nearest-bone skin so
  // each rides the vertebra it sits on (tail spikes curl with the tail, etc.).
  const features = dragon.getObjectByName('features');
  if (features) {
    for (const m of [...features.children]) {
      if (m.isMesh) extraSkins.push(meshToNearestSkinned(m, candBones, boneIndex));
    }
  }

  // SKINNED EARS (smooth/high tier): each main ear is one smooth sheet authored
  // in face.js with ANALYTIC skin weights against a LOCAL bone list
  // [root,mid,tip,skull]. Remap those local indices to real skeleton indices,
  // convert to SkinnedMesh, and RE-PARENT the sheet OUT of the skull-attached head
  // group to the dragon root (so it is not double-transformed by both the head
  // group and the ear bones), then bind below with the other extraSkins.
  const faceRig = dragon.getObjectByName('faceRig');
  const earInfo = faceRig && faceRig.userData && faceRig.userData.ears;
  if (earInfo && earInfo.skinned) {
    for (const it of earInfo.items) {
      if (!it.skinned || !it.sheet || !it.boneNames) continue;
      const mesh = it.sheet;
      const localBones = [it.boneNames.root, it.boneNames.mid, it.boneNames.tip, 'skull'];
      const map = localBones.map((nm) => boneIndex[nm] ?? boneIndex['skull'] ?? 0);
      const siAttr = mesh.geometry.getAttribute('skinIndex');
      if (siAttr) {
        const src = siAttr.array;
        const dst = new Uint16Array(src.length);
        for (let k = 0; k < src.length; k++) dst[k] = map[src[k]] ?? 0;
        mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(dst, 4));
      }
      dragon.attach(mesh);                       // preserve world xf out of the head group
      const sm = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
      sm.name = mesh.name;
      sm.frustumCulled = false;
      sm.castShadow = mesh.castShadow;
      sm.receiveShadow = mesh.receiveShadow;
      sm.position.copy(mesh.position);
      sm.quaternion.copy(mesh.quaternion);
      sm.scale.copy(mesh.scale);
      dragon.add(sm);
      dragon.remove(mesh);
      extraSkins.push(sm);
      it.sheet = sm;
      it.bones = {
        root: boneObj[it.boneNames.root],
        mid: boneObj[it.boneNames.mid],
        tip: boneObj[it.boneNames.tip],
      };
    }
  }

  // World matrices must be current BEFORE building the Skeleton (its bind
  // inverses read bone.matrixWorld) and before bone.attach (preserves world xf).
  dragon.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(ordered);   // computes bind inverses @ rest
  skinned.bind(skeleton, skinned.matrixWorld);
  for (const sm of extraSkins) sm.bind(skeleton, sm.matrixWorld);

  // head group (face rig, tusks, barbels): rigid-attach to the skull bone so the
  // whole expressive face rides the head. setDragonFace() keeps working (it
  // traverses for 'faceRig').
  const head = dragon.getObjectByName('head');
  const skullBone = boneObj['skull'];
  if (head && skullBone) skullBone.attach(head);

  // appendage capsules (fingers/toes/claws): each mesh tagged with userData.boneName
  // by the generator -> rigid-attach to its bone (rigid is correct for a phalanx).
  const appendages = dragon.getObjectByName('appendages');
  if (appendages) {
    for (const m of [...appendages.children]) {
      const bn = m.userData && m.userData.boneName;
      if (bn && boneObj[bn]) boneObj[bn].attach(m);
    }
  }

  dragon.updateMatrixWorld(true);

  // The ear BONES now exist (skinned tier) — re-pose the ears from the last face
  // params, since createFaceRig ran applyFaceParams before the skeleton existed
  // (that pass could not touch bones). Poses the bone quaternions the sheet skins to.
  if (faceRig && faceRig.userData.lastFaceParams) {
    applyFaceParams(faceRig, faceRig.userData.lastFaceParams);
  }

  // ---- 4. Pose API + idle state ---------------------------------------------
  // poseBase[name] = the current POSE target quaternion for each bone; the idle
  // layer composes a small time-varying delta ON TOP of it each frame.
  const poseBase = {};
  for (const b of ordered) poseBase[b.name] = new THREE.Quaternion();

  // Ear idle: a slight wiggle. For SKINNED ears the idle drives the ear ROOT
  // BONES (the sheet follows via skinning); for rigid ears it drives the ^ear[LR]
  // groups. The captured base is refreshed each frame by undoing the previous idle
  // delta, so the emotion rig can still repose the ears without a fight.
  const earIdle = [];
  if (earInfo && earInfo.skinned) {
    for (const it of earInfo.items) {
      if (it.bones && it.bones.root) earIdle.push({ obj: it.bones.root, prev: new THREE.Quaternion() });
    }
  }
  if (head) {
    head.traverse((o) => {
      if (/^ear[LR]/.test(o.name)) earIdle.push({ obj: o, prev: new THREE.Quaternion() });
    });
  }

  const rig = _makeRig({ skeleton, bones: ordered, boneObj, boneIndex, poseBase, earIdle, dragon });
  return rig;
}

// ---------------------------------------------------------------------------
// AnimRig — the pose API + idle. Kept as a factory so the state is closed over.
// ---------------------------------------------------------------------------
const _euler = new THREE.Euler();
const _qd = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

function _makeRig(state) {
  const { boneObj, poseBase, earIdle } = state;

  function setBoneRotation(name, x, y, z) {
    const b = boneObj[name];
    if (!b) return false;
    const q = poseBase[name] || (poseBase[name] = new THREE.Quaternion());
    q.setFromEuler(_euler.set(x || 0, y || 0, z || 0, 'XYZ'));
    b.quaternion.copy(q);
    return true;
  }

  function resetPose() {
    for (const name in poseBase) {
      poseBase[name].identity();
      boneObj[name].quaternion.identity();
    }
  }

  // pose = { boneName: [x,y,z] radians, ... } sparse. Morphology-tolerant: bones
  // the dragon lacks are simply absent from boneObj and skipped.
  function applyPose(pose) {
    resetPose();
    if (!pose) return true;
    for (const name in pose) {
      const r = pose[name];
      if (r) setBoneRotation(name, r[0], r[1], r[2]);
    }
    return true;
  }

  // Like applyPose but takes a map of boneName -> THREE.Quaternion (already the
  // final local rotation). Used by the behavior layer to write a CROSS-FADED pose
  // each frame (slerped between two behaviors) directly into poseBase, so the idle
  // sway / gait / springs still compose on top exactly as with applyPose. Bones not
  // present in the map are reset to identity (the union of the two behaviors' bones
  // is what the caller passes, so this correctly clears bones leaving the pose).
  function applyPoseQuats(quatMap) {
    resetPose();
    if (!quatMap) return true;
    for (const name in quatMap) {
      const b = boneObj[name];
      if (!b) continue;                       // morphology-tolerant
      poseBase[name].copy(quatMap[name]);
      b.quaternion.copy(quatMap[name]);
    }
    return true;
  }

  // -- gentle always-on idle (composed on top of poseBase) --------------------
  // A low-amplitude lateral traveling wave down the axial chain (breathing life
  // + tail sway + snake undulation-at-rest), subtle ribcage-breathing pitch, and
  // a slight ear idle. Cheap, sine-based (never Math.random per frame).
  const axial = [];
  for (let i = 6; i < 24; i++) if (boneObj[spineName(i)]) axial.push({ b: boneObj[spineName(i)], n: spineName(i), s: (i - 6) / 29 });
  for (let j = 0; j < 12; j++) { const nm = `tail_${pad2(j)}`; if (boneObj[nm]) axial.push({ b: boneObj[nm], n: nm, s: (18 + j) / 29 }); }
  const ribs = [10, 12, 14, 16].map((i) => boneObj[spineName(i)]).filter(Boolean);

  let enabled = true;
  function updateIdle(t) {
    // axial lateral sway: traveling wave, envelope small at trunk -> larger at tail.
    for (const a of axial) {
      const base = poseBase[a.n];
      if (!enabled) { a.b.quaternion.copy(base); continue; }
      const env = 0.012 + 0.05 * a.s * a.s;                 // radians (~0.7°..3.5°)
      const yaw = env * Math.sin(2 * Math.PI * (0.13 * t - 1.1 * a.s));
      _qd.setFromEuler(_euler.set(0, yaw, 0, 'XYZ'));
      a.b.quaternion.copy(base).multiply(_qd);
    }
    // breathing: subtle ribcage pitch (~0.9°), slow.
    const breath = 0.016 * Math.sin(2 * Math.PI * 0.22 * t);
    for (const rb of ribs) {
      if (!rb) continue;
      const base = poseBase[rb.name];
      if (!enabled) { rb.quaternion.copy(base); continue; }
      // compose breathing onto whatever the sway already wrote for this bone.
      _qd.setFromEuler(_euler.set(breath, 0, 0, 'XYZ'));
      rb.quaternion.multiply(_qd);
    }
    // slight ear idle: undo last delta to recover the (possibly emotion-updated)
    // base, then re-apply a fresh tiny delta.
    for (const e of earIdle) {
      _qInv.copy(e.prev).invert();
      e.obj.quaternion.multiply(_qInv);           // -> recovered base
      if (enabled) {
        const a = 0.05 * Math.sin(2 * Math.PI * 0.31 * t + 0.7);
        e.prev.setFromEuler(_euler.set(0, 0, a, 'XYZ'));
        e.obj.quaternion.multiply(e.prev);
      } else {
        e.prev.identity();
      }
    }
  }

  function dispose() { /* skeleton/bones are GC'd with the dragon group */ }

  return {
    skeleton: state.skeleton,
    bones: state.bones,
    boneByName: boneObj,
    boneIndex: state.boneIndex,
    setBoneRotation,
    applyPose,
    applyPoseQuats,
    resetPose,
    updateIdle,
    dispose,
    get idleEnabled() { return enabled; },
    set idleEnabled(v) { enabled = !!v; },
  };
}
