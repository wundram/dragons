// materials.js — Tier-aware PBR material factory for the Dragon Explorer.
//
// The high-fidelity rendering upgrade (see research/high-fidelity-rendering.md)
// moves every dragon part from flat MeshStandardMaterial to MeshPhysicalMaterial
// with the channel each part actually needs — clearcoat (moist skin / keratin),
// transmission (backlit wing membrane, the HERO change), sheen (feathers). A
// second, CHEAP tier returns the original MeshStandardMaterials unchanged so the
// Minecraft/perf path (and voxel skin) stays honest and composer-free.
//
// TIER is threaded through the generator via `phenotype.renderTier` (which reads
// env.renderTier ?? window.__renderTier ?? 'high'); the face rig receives it via
// opts.tier. Every factory works under `renderer.render` alone — only transmission
// needs WebGL2 (which the test bed already requires), nothing here needs the
// EffectComposer.
//
// INVARIANTS the factory must preserve:
//   * The BODY keeps `vertexColors` markings: the caller clones the returned body
//     material, sets `vertexColors = true` and base `color` white, so the CA
//     marking colours remain the final albedo — unchanged by moving to Physical.
//   * metalness stays 0 everywhere (dragons are dielectric; "shiny" = clearcoat +
//     IBL, never metalness).
//   * envMapIntensity is a sensible default here; app.js re-applies the tier value
//     by traversal after each rebuild().

import * as THREE from 'three';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const isHigh = (tier) => tier !== 'cheap';

// Default IBL strength for high tier (app.js overrides per material after build).
export const HIGH_ENV_INTENSITY = 0.75;

// ---------------------------------------------------------------------------
// BODY — moist reptile hide. Physical + slight clearcoat sheen. The caller adds
// vertexColors + white base for markings, so `color` here is only the cheap-tier
// / no-markings fallback tint.
// ---------------------------------------------------------------------------
export function bodyMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL(p.hue, p.sat, p.light);
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.55, metalness: 0,
    clearcoat: 0.15, clearcoatRoughness: 0.55,
    specularIntensity: 0.9,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// BELLY — matte, softer plates vs the glossier back.
export function bellyMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.05) % 1, p.sat * 0.7, Math.min(0.9, p.light + 0.22));
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.0 });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.8, metalness: 0, clearcoat: 0.05, clearcoatRoughness: 0.7,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// HARD keratin — horns / claws / tusks base. Polished clearcoat over a rough base.
export function hardMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.08) % 1, p.sat * 0.4, Math.max(0.14, p.light - 0.30));
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2 });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.35, metalness: 0,
    clearcoat: 0.5, clearcoatRoughness: 0.25,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// IVORY (teeth / tusks) — pale keratin with a soft clearcoat.
export function ivoryMaterial(tier = 'high') {
  const c = new THREE.Color(0xece3cf);
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05 });
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// BARBEL / whisker — soft flesh tendril.
export function barbelMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.02) % 1, p.sat * 0.6, Math.min(0.72, p.light + 0.05));
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.6, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.6,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// ---------------------------------------------------------------------------
// WING MEMBRANE (HERO) — thin-walled transmission so the wing glows when the rim
// light is behind it. `transparent:false` + `opacity:1`: transmission (not alpha
// blending) carries the translucency. The per-mesh clone in generator.js maps the
// age/fullness `amount` onto `transmission` (baby ≈ 0.62 → adult ≈ 0.32).
// ---------------------------------------------------------------------------
export function membraneMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.02) % 1, Math.min(1, p.sat * 0.9), Math.max(0.16, p.light * 0.82));
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({
      color: c, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.9, emissive: c.clone().multiplyScalar(0.06),
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
    transmission: 0.45, thickness: 0, ior: 1.4,
    attenuationColor: c.clone(), attenuationDistance: 0.6,
    transparent: false, opacity: 1,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// SAIL / dorsal fin — like the membrane (a stretched web) but a touch more opaque
// so the webbing between spikes still reads. Slight transmission for backlit glow.
export function sailMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.02) % 1, Math.min(1, p.sat * 0.95), Math.max(0.14, p.light * 0.68));
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({
      color: c, roughness: 0.68, metalness: 0.02, side: THREE.DoubleSide,
      transparent: true, opacity: 0.96, emissive: c.clone().multiplyScalar(0.05),
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
    transmission: 0.3, thickness: 0, ior: 1.4,
    attenuationColor: c.clone(), attenuationDistance: 0.5,
    transparent: false, opacity: 1,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// SPIKES — polished keratin (same family as hard, tinted slightly warmer).
export function spikeMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.08) % 1, p.sat * 0.4, Math.max(0.14, p.light - 0.30));
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.22 });
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.35, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// FEATHERS — fuzzy micro-fibre rim via sheen. DoubleSide (thin cards).
export function featherMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.03) % 1, Math.min(1, p.sat * 0.85), Math.min(0.85, p.light + 0.06));
  if (!isHigh(tier)) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
  }
  const sheenC = c.clone().lerp(new THREE.Color(0xffffff), 0.35);
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    sheen: 0.6, sheenRoughness: 0.7, sheenColor: sheenC,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// SCUTES / plates — harder, darker armour; keratin clearcoat.
export function scuteMaterial(p, tier = 'high') {
  const c = new THREE.Color().setHSL((p.hue + 0.05) % 1, Math.min(1, p.sat * 0.7), Math.max(0.12, p.light - 0.24));
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.12 });
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// ---------------------------------------------------------------------------
// FACE materials (eyes / brows / mouth / ears / frill). Threaded `tier` from
// createFaceRig(opts.tier).
// ---------------------------------------------------------------------------
// Sclera — wet white, high-spec clearcoat gives the catchlight under IBL + rim.
export function eyeWhiteMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.15, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: 1.0,
  });
}
// Pupil / iris — dark, glossy.
export function pupilMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.2, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({
    color: 0x101014, roughness: 0.1, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.05,
    envMapIntensity: 1.0,
  });
}
// Brow — matte skin-dark ridge.
export function browMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.55, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({ color: 0x2a2320, roughness: 0.5, metalness: 0, clearcoat: 0.12, envMapIntensity: 0.5 });
}
// Mouth interior — wet.
export function mouthMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x2a0d10, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  return new THREE.MeshPhysicalMaterial({
    color: 0x2a0d10, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
    clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.6,
  });
}
// Ear outer plate — body-dark hide with slight transmission (thin, backlit glow).
export function earOuterMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x4a3b38, roughness: 0.6, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({
    color: 0x4a3b38, roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
    transmission: 0.2, thickness: 0, ior: 1.4, transparent: false, opacity: 1,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}
// Ear inner — pinker inset, more transmissive (fleshy backlit ear).
export function earInnerMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x9a5f63, roughness: 0.7, metalness: 0 });
  return new THREE.MeshPhysicalMaterial({
    color: 0x9a5f63, roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
    transmission: 0.3, thickness: 0, ior: 1.4, transparent: false, opacity: 1,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}
// Frill petals — thin fleshy fan, slight transmission.
export function frillMaterial(tier = 'high') {
  if (!isHigh(tier)) return new THREE.MeshStandardMaterial({ color: 0x6a4a52, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  return new THREE.MeshPhysicalMaterial({
    color: 0x6a4a52, roughness: 0.65, metalness: 0, side: THREE.DoubleSide,
    transmission: 0.25, thickness: 0, ior: 1.4, transparent: false, opacity: 1,
    envMapIntensity: HIGH_ENV_INTENSITY,
  });
}

// Map a wing-membrane fullness `amount` (0 fringe/baby → 1 full/adult) onto the
// per-panel translucency of a CLONED base membrane/sail material, in-place.
// High tier: more transmissive when young/thin. Cheap tier: the old opacity ramp.
export function tuneMembranePanel(m, amount, kind = 'membrane') {
  const a = clamp01(amount);
  if (m.isMeshPhysicalMaterial && 'transmission' in m) {
    m.transmission = kind === 'sail' ? lerp(0.42, 0.24, a) : lerp(0.62, 0.32, a);
  } else if ('opacity' in m) {
    m.opacity = lerp(0.5, 0.92, a);
  }
  return m;
}
