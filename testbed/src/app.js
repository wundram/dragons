// app.js — Test bed HARNESS. Owns the Three.js scene, the auto-built control
// panel, and the export/eval buttons. It talks to the generator ONLY through the
// documented interface (GENOME_SCHEMA / DEFAULT_GENOME / generateDragon), so a
// real generator can be swapped into generator.js without touching this file.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  GENOME_SCHEMA, DEFAULT_GENOME, FACE_TRAITS,
  generateDragon, setDragonFace,
} from './generator.js';
import { EMOTIONS, emotionParams } from './face.js';
import { upgradeToSkinned } from './rig.js';
import { createLocomotion } from './locomotion.js';
import { POSES, POSE_NAMES } from './poses.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let genome = { ...DEFAULT_GENOME };
let age = 0.0;
let currentDragon = null;
let currentRig = null;        // AnimRig for the live dragon (null in voxel/capsule)
let currentLoco = null;       // LocomotionController for the live dragon (null in voxel/capsule)
let currentGait = 'idle';     // 'idle' | 'walk' | 'run' — persists across rebuilds
let currentPoseName = 'idle'; // last applied pose; re-applied across rebuilds
let rebuildTimer = null;

// Skin/view settings live on window.__* so the headless tools (render.mjs /
// gallery.mjs) can poke them and call regenerate. The UI controls below write
// these globals before rebuilding; rebuild() reads them back into an explicit
// env, so an external set (e.g. render.mjs --skinmode voxel) still wins.
if (typeof window !== 'undefined') {
  window.__skinMode ??= 'smooth';
  window.__voxelRes ??= 24;
  window.__showRig ??= false;
  // Render fidelity tier — mirrors window.__skinMode so the headless tools can
  // flip it. 'high' = ACES + IBL + PBR/transmission materials (Explorer showcase);
  // 'cheap' = no IBL, flat MeshStandard materials (MC/perf path).
  window.__renderTier ??= 'high';
}

// Per-tier rendering config. HIGH is the Explorer showcase (IBL + PBR materials +
// EffectComposer post-fx + VSM soft shadows + contact shadow + studio backdrop);
// CHEAP is the Minecraft/perf path (flat materials, plain PCF shadow, no composer,
// no env, no backdrop — a flat, fast, honest reduced tier).
const TIERS = {
  high:  { composer: true,  env: true,  envMapIntensity: 0.75, exposure: 1.1, grid: false,
           key: 1.6, fill: 0.25, rim: 1.4, hemi: 0.15,
           shadowType: THREE.VSMShadowMap,    contactShadow: true,  backdrop: true,
           groundColor: 0x171b23, groundRough: 0.95 },
  cheap: { composer: false, env: false, envMapIntensity: 0.0,  exposure: 1.0, grid: true,
           key: 2.2, fill: 0.7,  rim: 0.9, hemi: 0.6,
           shadowType: THREE.PCFSoftShadowMap, contactShadow: false, backdrop: false,
           groundColor: 0x2a3340, groundRough: 1.0 },
};
const tierCfg = () => TIERS[window.__renderTier] ?? TIERS.high;

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Color management + filmic tone mapping — the single biggest quality jump. sRGB
// output is the r160 default; set it explicitly so the pin can't drift. ACES maps
// the HDR IBL/lights into a believable display range (exposure set per tier).
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11131a);

// IBL: PMREM a procedural RoomEnvironment (r160 constructor takes the renderer so
// it uses physically-correct light intensity) → studio-quality ambient + real
// speculars with ZERO external HDRI assets. Assigned to scene.environment only in
// high tier (applyTier). r160 has no scene.environmentIntensity — per-material
// envMapIntensity (set in rebuild()) tunes strength instead.
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(4.5, 3.0, 6.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.2, 0);
// Track whether the user has grabbed the camera, so auto-frame (boot / archetype
// swap) never yanks the view mid-inspection. OrbitControls fires 'start' on any
// user pointer/scroll interaction.
let userMovedCamera = false;
controls.addEventListener('start', () => { userMovedCamera = true; });

// --- lighting: rough 3-point setup ---------------------------------------
// Light rig — rebalanced by applyTier(): in high tier the IBL carries ambient/fill
// so the key drops and the cool rim pops the silhouette; cheap tier keeps the old
// brighter 3-point + hemisphere since it has no environment map.
const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
key.position.set(5, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 30;
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
// VSM softness (only takes effect under VSMShadowMap = high tier; PCFSoft ignores
// radius). blurSamples trades a little cost for a smoother penumbra.
key.shadow.radius = 7;
key.shadow.blurSamples = 16;
scene.add(key);

const fill = new THREE.DirectionalLight(0x9fc0ff, 0.7);
fill.position.set(-6, 3, 4);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(-2, 5, -8);
scene.add(rim);

const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x35302a, 0.6);
scene.add(hemi);

// --- ground + grid --------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 48),
  new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 1.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(24, 24, 0x55708f, 0x3a4a5c);
grid.position.y = 0.001;
scene.add(grid);

// --- studio backdrop (high tier) ------------------------------------------
// A soft vertical gradient so the creature reads against a considered vitrine
// sweep instead of a flat slate. A 2D CanvasTexture assigned to scene.background
// paints stretched across the viewport (cool obsidian up top → deep at the
// horizon where it meets the ground). Cheap tier keeps the flat solid colour.
const FLAT_BG = new THREE.Color(0x11131a);
function makeBackdropTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.00, '#191d27');   // top — lifted obsidian
  g.addColorStop(0.55, '#12151d');
  g.addColorStop(1.00, '#0a0c11');   // bottom — deep, meets the ground disc
  ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const backdropTexture = makeBackdropTexture();

// --- contact shadow (high tier) -------------------------------------------
// A cheap, soft blurred blob under the dragon that grounds it (the tight belly
// occlusion the directional VSM shadow can't give). Radial-gradient alpha on a
// ground-hugging plane; fitted to the dragon's XZ footprint in rebuild().
function makeContactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.22)');
  g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({
    map: makeContactShadowTexture(), transparent: true,
    depthWrite: false, opacity: 0.75,
  })
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.y = 0.013;   // just above the ground disc, below the belly
contactShadow.renderOrder = 2;
scene.add(contactShadow);

// Fit the contact-shadow blob to the current dragon's ground footprint.
function refreshContactShadow() {
  if (!contactShadow.visible || !currentDragon) return;
  const box = new THREE.Box3().setFromObject(currentDragon);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Oval a touch larger than the silhouette; local Y maps to world Z after tilt.
  contactShadow.scale.set(Math.max(size.x, 0.5) * 1.4, Math.max(size.z, 0.5) * 1.6, 1);
  contactShadow.position.x = center.x;
  contactShadow.position.z = center.z;
}

// ---------------------------------------------------------------------------
// Post-processing composer (HIGH tier only). Order matters — HDR/AO first, tone
// map LAST:  RenderPass → GTAOPass → UnrealBloomPass → OutputPass.
//   * The composer target is MSAA (samples:4) + HalfFloat, so anti-aliasing is
//     hardware MSAA inside the chain and the whole pipe stays HDR-linear until
//     the end (bloom thresholds > 1 work; highlights don't clip early).
//   * TONE MAPPING HAPPENS EXACTLY ONCE: RenderPass renders the scene into the
//     (non-canvas) HalfFloat target, where three skips tone mapping, so the beauty
//     stays HDR-linear; OutputPass reads renderer.toneMapping / outputColorSpace
//     and applies ACES + sRGB as the final pass. renderer.toneMapping therefore
//     stays set — it's consumed by OutputPass here, and by the cheap tier's plain
//     renderer.render (which draws straight to the canvas and tone-maps there).
// ---------------------------------------------------------------------------
const _bufSize = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(_bufSize.x, _bufSize.y, {
    samples: 4, type: THREE.HalfFloatType,
  })
);
composer.addPass(new RenderPass(scene, camera));
const gtaoPass = new GTAOPass(scene, camera, _bufSize.x, _bufSize.y);
gtaoPass.output = GTAOPass.OUTPUT.Default;   // AO multiplied over the beauty pass
gtaoPass.blendIntensity = 0.85;
// World-space AO tuned for a ~10-unit dragon: a modest radius seats ears↔skull,
// legs↔body, spikes↔skin without haloing the silhouette.
gtaoPass.updateGtaoMaterial({
  radius: 0.55, distanceExponent: 1.0, thickness: 1.0, scale: 1.0,
  samples: 16, screenSpaceRadius: false,
});
composer.addPass(gtaoPass);
// Subtle, HDR-driven bloom — only true highlights (eye catchlights, rim glints)
// bloom. strength 0.22 / radius 0.5 / threshold 0.85.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(_bufSize.x, _bufSize.y), 0.22, 0.5, 0.85
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());   // ACES + sRGB, applied ONCE, at the end

// ---------------------------------------------------------------------------
// Render tier: apply env map, light balance, exposure, grid visibility for the
// active window.__renderTier. Called at boot and whenever the tier changes; the
// caller triggers a rebuild() so the material factory re-runs at the new tier.
// ---------------------------------------------------------------------------
function applyEnvMapIntensity(obj, intensity) {
  if (!obj) return;
  obj.traverse((n) => {
    if (!n.material) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) if ('envMapIntensity' in m) m.envMapIntensity = intensity;
  });
}

function applyTier() {
  const cfg = tierCfg();
  scene.environment = cfg.env ? envTexture : null;
  scene.background = cfg.backdrop ? backdropTexture : FLAT_BG;
  renderer.toneMappingExposure = cfg.exposure;
  key.intensity = cfg.key;
  fill.intensity = cfg.fill;
  rim.intensity = cfg.rim;
  hemi.intensity = cfg.hemi;
  grid.visible = cfg.grid;
  // Soft shadows: VSM (blurrable) in high, PCFSoft in cheap. Switching the shadow
  // map type at runtime needs a shadow-map refresh + material recompile.
  if (renderer.shadowMap.type !== cfg.shadowType) {
    renderer.shadowMap.type = cfg.shadowType;
    renderer.shadowMap.needsUpdate = true;
    scene.traverse((n) => {
      if (!n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) m.needsUpdate = true;
    });
  }
  // Darker, rougher ground disc for the high vitrine; original slate for cheap.
  ground.material.color.setHex(cfg.groundColor);
  ground.material.roughness = cfg.groundRough;
  contactShadow.visible = cfg.contactShadow;
  refreshContactShadow();
  applyEnvMapIntensity(currentDragon, cfg.envMapIntensity);
}

// ---------------------------------------------------------------------------
// Dragon (re)build
// ---------------------------------------------------------------------------
function disposeDragon(obj) {
  if (!obj) return;
  obj.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

function rebuild() {
  const env = {
    skinMode: window.__skinMode ?? 'smooth',
    voxelRes: window.__voxelRes ?? 24,
    showRig: window.__showRig ?? false,
    renderTier: window.__renderTier ?? 'high',
  };
  const next = generateDragon(genome, age, env);
  scene.remove(currentDragon);
  disposeDragon(currentDragon);
  currentDragon = next;
  scene.add(currentDragon);
  // Apply per-material IBL strength for the active tier (r160 has no
  // scene.environmentIntensity, so we set envMapIntensity per material here).
  applyEnvMapIntensity(currentDragon, tierCfg().envMapIntensity);
  // Convert the freshly-built body to a live SkinnedMesh rig (smooth mode only;
  // returns null for voxel/capsule, which stay static). Re-apply the current pose
  // so the age slider scrubs a POSED dragon.
  currentRig = upgradeToSkinned(currentDragon);
  if (currentRig) applyPoseByName(currentPoseName);
  // Morphology-adaptive locomotion layer over the pose/idle pipeline (smooth mode
  // only; inert otherwise). Restore the persisted gait so it survives rebuilds.
  currentLoco = createLocomotion(currentDragon, currentRig);
  if (currentLoco) currentLoco.setSpeed(currentGait);
  // Refit the soft contact-shadow blob to the new silhouette (high tier only).
  refreshContactShadow();
  updateReadout();
}

// Fit the camera to the live dragon's bounds at a pleasing 3/4 hero angle, sat a
// touch below the eyeline so the creature reads "grand". Called on boot and after
// wholesale genome swaps (archetype / randomize / reset) — NOT on age scrubbing,
// so the camera holds steady while you scrub the years. `force` reframes even if
// the user has already orbited (used by the explicit new-creature actions).
function frameDragon(force = false) {
  if (!currentDragon) return;
  if (userMovedCamera && !force) return;
  const box = new THREE.Box3().setFromObject(currentDragon);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const fov = camera.fov * Math.PI / 180;
  const dist = (radius / Math.sin(fov / 2)) * 1.28;   // a little breathing room
  const dir = new THREE.Vector3(0.6, 0.28, 1).normalize();   // 3/4 front, slightly low
  // Aim just below the vertical centre so head/upper body dominate the frame.
  const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.46, center.z);
  camera.position.copy(target.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist / 100; camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.update();
  userMovedCamera = false;   // programmatic frame is the new "home"
}

// Apply a named pose from the POSES table to the live rig (no-op if unskinned).
function applyPoseByName(name) {
  currentPoseName = name;
  if (currentRig && POSES[name]) currentRig.applyPose(POSES[name]);
}

// Throttle rebuilds so dragging a slider stays smooth.
function scheduleRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = requestAnimationFrame(() => {
    rebuildTimer = null;
    rebuild();
  });
}

// ---------------------------------------------------------------------------
// Control panel — auto-built from GENOME_SCHEMA, grouped.
// ---------------------------------------------------------------------------
const sliderEls = {};   // name -> {input, valueLabel}

function buildPanel() {
  const panel = document.getElementById('controls');

  // Group schema entries preserving first-seen group order.
  const groups = new Map();
  for (const t of GENOME_SCHEMA) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }

  for (const [groupName, traits] of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    const h = document.createElement('h3');
    h.textContent = groupName;
    section.appendChild(h);

    for (const t of traits) {
      section.appendChild(makeSlider(t));
    }
    panel.appendChild(section);
  }
}

function makeSlider(t) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = t.name;
  label.title = t.description;

  const value = document.createElement('span');
  value.className = 'val';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = t.min;
  input.max = t.max;
  input.step = t.step ?? 0.01;
  input.value = genome[t.name];
  input.title = t.description;

  const isFace = FACE_TRAITS.includes(t.name);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    genome[t.name] = v;
    value.textContent = fmt(v);
    // Face params can update cheaply without a full rebuild; everything else
    // needs a regenerate.
    if (isFace) {
      // re-derive age-adjusted face from generator by rebuilding is heavy; instead
      // apply the raw genome face params live for responsiveness, then the next
      // full rebuild (age change) will reconcile.
      applyLiveFace();
      updateReadout();
    } else {
      scheduleRebuild();
    }
  });

  value.textContent = fmt(parseFloat(input.value));
  row.append(label, input, value);
  sliderEls[t.name] = { input, value };
  return row;
}

function applyLiveFace() {
  if (!currentDragon) return;
  const fp = {};
  for (const k of FACE_TRAITS) fp[k] = genome[k];
  setDragonFace(currentDragon, fp);
}

function fmt(v) { return (Math.round(v * 100) / 100).toString(); }

function syncSliders() {
  for (const t of GENOME_SCHEMA) {
    const el = sliderEls[t.name];
    if (!el) continue;
    el.input.value = genome[t.name];
    el.value.textContent = fmt(genome[t.name]);
  }
}

// ---------------------------------------------------------------------------
// Age slider (prominent, top of panel — wired in HTML)
// ---------------------------------------------------------------------------
const ageInput = document.getElementById('age');
const ageVal = document.getElementById('ageVal');
// Paint the ember "maturation" track fill (0→100%) to match the current age.
function paintAgeFill() {
  ageInput.style.setProperty('--p', (age * 100).toFixed(1) + '%');
}
ageInput.addEventListener('input', () => {
  age = parseFloat(ageInput.value);
  ageVal.textContent = age.toFixed(2);
  paintAgeFill();
  scheduleRebuild();
});

// ---------------------------------------------------------------------------
// Buttons + emotion dropdown
// ---------------------------------------------------------------------------
// Fully randomize a genome (shared by the Randomize button + Variation gallery).
function randomGenome() {
  const g = {};
  for (const t of GENOME_SCHEMA) {
    const v = t.min + Math.random() * (t.max - t.min);
    g[t.name] = (t.step === 1) ? Math.round(v) : v;
  }
  return g;
}

document.getElementById('btnRandom').addEventListener('click', () => {
  genome = randomGenome();
  setArchetypeCustom();
  syncSliders();
  rebuild();
  frameDragon(true);   // a fresh creature — reframe the hero shot
});

document.getElementById('btnReset').addEventListener('click', () => {
  genome = { ...DEFAULT_GENOME };
  age = 0.0;
  ageInput.value = '0';
  ageVal.textContent = '0.00';
  paintAgeFill();
  setArchetypeCustom();
  syncSliders();
  rebuild();
  frameDragon(true);   // back to the default dragon — reframe
});

document.getElementById('btnExport').addEventListener('click', exportGLTF);
document.getElementById('btnShot').addEventListener('click', screenshotPNG);

// Reframe affordance: single click re-fits the hero shot (force, even after the
// user has orbited); double click toggles a slow showcase turntable.
const btnReframe = document.getElementById('btnReframe');
if (btnReframe) {
  btnReframe.addEventListener('click', () => { frameDragon(true); });
  btnReframe.addEventListener('dblclick', () => {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.6;
    btnReframe.classList.toggle('on', controls.autoRotate);
  });
}

const emotionSel = document.getElementById('emotion');
for (const name of Object.keys(EMOTIONS)) {
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name;
  emotionSel.appendChild(opt);
}
emotionSel.addEventListener('change', () => {
  const ep = emotionParams(emotionSel.value);
  for (const k of FACE_TRAITS) if (k in ep) genome[k] = ep[k];
  syncSliders();
  applyLiveFace();
  updateReadout();
});

// ---------------------------------------------------------------------------
// Skin & View controls (skin mode / voxel res / show rig / archetype / geo.json)
// ---------------------------------------------------------------------------
const skinModeSel = document.getElementById('skinMode');
const renderTierSel = document.getElementById('renderTier');
const voxelResEl = document.getElementById('voxelRes');
const voxelResVal = document.getElementById('voxelResVal');
const voxelResRow = document.getElementById('voxelResRow');
const showRigEl = document.getElementById('showRig');
const archetypeSel = document.getElementById('archetype');

function setArchetypeCustom() { archetypeSel.value = 'custom'; }

// Voxel res only matters in voxel mode — dim + disable it otherwise (kept in DOM).
function syncVoxelResEnabled() {
  const isVoxel = skinModeSel.value === 'voxel';
  voxelResRow.classList.toggle('dim', !isVoxel);
  voxelResEl.disabled = !isVoxel;
}

// Initialize the controls from the (possibly headless-preset) globals.
skinModeSel.value = window.__skinMode;
renderTierSel.value = window.__renderTier;
voxelResEl.value = String(window.__voxelRes);
voxelResVal.textContent = String(window.__voxelRes);
showRigEl.checked = !!window.__showRig;
syncVoxelResEnabled();

skinModeSel.addEventListener('change', () => {
  window.__skinMode = skinModeSel.value;
  syncVoxelResEnabled();
  rebuild();
});
renderTierSel.addEventListener('change', () => {
  setRenderTier(renderTierSel.value);
});
voxelResEl.addEventListener('input', () => {
  window.__voxelRes = parseInt(voxelResEl.value, 10);
  voxelResVal.textContent = voxelResEl.value;
  scheduleRebuild();
});
showRigEl.addEventListener('change', () => {
  window.__showRig = showRigEl.checked;
  rebuild();
});
archetypeSel.addEventListener('change', () => {
  const name = archetypeSel.value;
  if (name === 'custom') return;
  const src = window.__ARCHETYPES && window.__ARCHETYPES[name];
  if (!src) return;
  genome = { ...src };
  syncSliders();
  rebuild();
  frameDragon(true);   // new archetype subject — reframe the hero shot
});
document.getElementById('btnExportGeo').addEventListener('click', () => {
  const t = window.__testbed;
  if (!t || !t.exportGeoJSON) { console.warn('exportGeoJSON not ready yet'); return; }
  const json = t.exportGeoJSON();
  downloadBlob(new Blob([json], { type: 'application/json' }),
    `dragon_age${age.toFixed(2)}.geo.json`);
});

// ---------------------------------------------------------------------------
// Pose (stance) — strike a named POSE on the live rig. Poses only apply to the
// smooth-skin rig (voxel/capsule stay static); applyPoseByName is a no-op then.
// Options are built from POSE_NAMES so this never drifts from poses.js.
// ---------------------------------------------------------------------------
const poseSel = document.getElementById('pose');
if (poseSel) {
  for (const name of POSE_NAMES) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    poseSel.appendChild(opt);
  }
  poseSel.value = currentPoseName;
  poseSel.addEventListener('change', () => { applyPoseByName(poseSel.value); });
}

// ---------------------------------------------------------------------------
// In-browser gallery — reuse the single renderer to shoot thumbnail grids.
// ---------------------------------------------------------------------------
const galleryEl = document.getElementById('gallery');
const galleryGrid = document.getElementById('galleryGrid');
const galleryTitle = document.getElementById('galleryTitle');
const galleryStatus = document.getElementById('galleryStatus');
let galleryBusy = false;

// Frame an object with a Box3 fit (same 3/4-front framing render.mjs uses).
function frameObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const fov = camera.fov * Math.PI / 180;
  const dist = (radius / Math.sin(fov / 2)) * 1.15;
  const dir = new THREE.Vector3(0.55, 0.35, 1).normalize();
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.near = dist / 100; camera.far = dist * 100;
  camera.lookAt(center); camera.updateProjectionMatrix();
  controls.target.copy(center);
}

// Jitter every trait by ±amt*(range), clamped to [min,max] (breeding mutation).
function jitterGenome(parent, amt = 0.2) {
  const child = { ...parent };
  for (const t of GENOME_SCHEMA) {
    let v = parent[t.name] + (Math.random() * 2 - 1) * amt * (t.max - t.min);
    v = Math.max(t.min, Math.min(t.max, v));
    child[t.name] = (t.step === 1) ? Math.round(v) : v;
  }
  return child;
}

function closeGallery() {
  galleryEl.style.display = 'none';
  galleryGrid.innerHTML = '';
}
document.getElementById('galleryClose').addEventListener('click', closeGallery);

// rows: array of rows; each row is an array of { genome, age, caption }.
async function runGallery(title, rows) {
  if (galleryBusy) return;
  galleryBusy = true;
  galleryTitle.firstChild.textContent = title + ' ';
  galleryStatus.textContent = 'rendering…';
  galleryEl.style.display = 'flex';
  galleryGrid.innerHTML = '';

  // Build the cell shells first so the grid + captions paint immediately.
  const jobs = [];
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'galRow';
    for (const cell of row) {
      const fig = document.createElement('figure');
      fig.className = 'galCell';
      const img = document.createElement('img');
      const cap = document.createElement('figcaption');
      cap.textContent = cell.caption;
      fig.append(img, cap);
      rowEl.appendChild(fig);
      jobs.push({ img, cell });
    }
    galleryGrid.appendChild(rowEl);
  }

  // Save camera/controls state and hide the main dragon while we shoot cells.
  const savedPos = camera.position.clone();
  const savedTarget = controls.target.clone();
  const savedNear = camera.near, savedFar = camera.far;
  const mainDragon = currentDragon;
  if (mainDragon) mainDragon.visible = false;

  const env = {
    skinMode: window.__skinMode ?? 'smooth',
    voxelRes: window.__voxelRes ?? 24,
    showRig: window.__showRig ?? false,
    renderTier: window.__renderTier ?? 'high',
  };

  let done = 0;
  for (const { img, cell } of jobs) {
    // Yield a frame so the overlay + progress paint between cells.
    await new Promise((r) => requestAnimationFrame(r));
    if (galleryEl.style.display === 'none') break; // closed mid-run
    const d = generateDragon(cell.genome, cell.age, env);
    scene.add(d);
    applyEnvMapIntensity(d, tierCfg().envMapIntensity);
    frameObject(d);
    renderFrame();
    img.src = canvas.toDataURL('image/png');
    scene.remove(d);
    disposeDragon(d);
    galleryStatus.textContent = `rendering… ${++done}/${jobs.length}`;
  }

  // Restore the main dragon + camera/controls state.
  if (mainDragon) mainDragon.visible = true;
  camera.position.copy(savedPos);
  camera.near = savedNear; camera.far = savedFar;
  camera.updateProjectionMatrix();
  controls.target.copy(savedTarget);
  controls.update();
  galleryStatus.textContent = '';
  galleryBusy = false;
}

document.getElementById('btnGalAge').addEventListener('click', () => {
  const ages = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const row = ages.map((a) => ({ genome: { ...genome }, age: a, caption: `age ${a}` }));
  runGallery('Age strip', [row]);
});
document.getElementById('btnGalVar').addEventListener('click', () => {
  const cells = [];
  for (let i = 0; i < 9; i++) {
    cells.push({ genome: randomGenome(), age: 1, caption: `#${i + 1}` });
  }
  runGallery('Variation', [cells.slice(0, 3), cells.slice(3, 6), cells.slice(6, 9)]);
});
document.getElementById('btnGalTree').addEventListener('click', () => {
  const root = { ...genome };
  const gen1 = [0, 1, 2].map(() => jitterGenome(root));
  const gen2 = gen1.flatMap((p) => [0, 1, 2].map(() => jitterGenome(p)));
  runGallery('Breeding tree', [
    [{ genome: root, age: 1, caption: 'root' }],
    gen1.map((g, i) => ({ genome: g, age: 1, caption: `gen1.${i + 1}` })),
    gen2.map((g, i) => ({ genome: g, age: 1, caption: `gen2.${i + 1}` })),
  ]);
});

// ---------------------------------------------------------------------------
// Genome readout (copyable JSON)
// ---------------------------------------------------------------------------
const readout = document.getElementById('readout');
function updateReadout() {
  readout.value = JSON.stringify({ age: +age.toFixed(3), genome }, null, 2);
}
document.getElementById('btnCopy').addEventListener('click', async () => {
  readout.select();
  try { await navigator.clipboard.writeText(readout.value); } catch { document.execCommand('copy'); }
});

// ---------------------------------------------------------------------------
// Export glTF
// ---------------------------------------------------------------------------
function exportGLTF() {
  if (!currentDragon) return;
  const exporter = new GLTFExporter();
  exporter.parse(currentDragon, (result) => {
    const blob = new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
    downloadBlob(blob, `dragon_age${age.toFixed(2)}.gltf`);
  }, (err) => console.error('glTF export failed', err), { binary: false });
}

// ---------------------------------------------------------------------------
// Screenshot PNG (renders once at full res then downloads the canvas)
// ---------------------------------------------------------------------------
function screenshotPNG() {
  renderFrame();
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `dragon_age${age.toFixed(2)}.png`);
  }, 'image/png');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------------------
function resize() {
  const wrap = document.getElementById('stage');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Keep the composer + its internal-target passes matched to the drawing buffer.
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer.setSize(buf.x, buf.y);
  gtaoPass.setSize(buf.x, buf.y);
  bloomPass.setSize(buf.x, buf.y);
}
window.addEventListener('resize', resize);

// Single render entry point — the animate loop, the PNG screenshot, and the
// in-app gallery all route through here so the tier switch picks the path at ONE
// site. HIGH renders through the EffectComposer (RenderPass → GTAO → bloom →
// OutputPass, tone-mapped once by OutputPass); CHEAP draws straight to the canvas
// via renderer.render (tone-mapped by the renderer). Both write the final frame to
// the canvas, so canvas.toDataURL()/toBlob() (gallery + PNG) capture the composed
// image either way.
function renderFrame() {
  if (tierCfg().composer) composer.render();
  else renderer.render(scene, camera);
}

const animClock = new THREE.Clock();
let lastLocoT = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const t = animClock.getElapsedTime();
  const dt = Math.min(0.05, t - lastLocoT);
  lastLocoT = t;
  // Gentle always-on idle: breathing + low-amplitude axial sway + ear idle,
  // composed on top of the current pose. Cheap, sine-based, deterministic.
  // (Runs BEFORE the render so the posed/idle frame is what gets drawn.)
  if (currentRig) currentRig.updateIdle(t);
  // Locomotion layer: composed AFTER the pose/idle step, BEFORE the render. When
  // the gait is 'idle' this is a no-op, so the frame reads exactly like before.
  if (currentLoco) currentLoco.update(dt);
  renderFrame();
}

// Set the ground gait: 'idle' | 'walk' | 'run'. Switching to idle re-applies the
// current pose so the leg/spine bones the gait overrode return to their rest
// (the locomotion controller writes bone quaternions directly during a gait).
function setGait(name) {
  if (name !== 'idle' && name !== 'walk' && name !== 'run') return false;
  currentGait = name;
  if (currentLoco) currentLoco.setSpeed(name);
  if (name === 'idle') applyPoseByName(currentPoseName);
  return true;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Switch render tier: set the global, re-apply env/lights, and rebuild so the
// material factory re-runs at the new tier. Shared by the UI select + the headless
// hook. `rebuild()` re-applies per-material envMapIntensity for the new tier.
function setRenderTier(tier) {
  if (tier !== 'high' && tier !== 'cheap') return;
  window.__renderTier = tier;
  applyTier();
  rebuild();
}

buildPanel();
paintAgeFill();
resize();
applyTier();
rebuild();
frameDragon();   // frame-on-boot: fit the hero shot instead of the face close-up
animate();

// Expose a tiny debug hook for the orchestrator / console verification.
window.__testbed = {
  get genome() { return genome; },
  get age() { return age; },
  get dragon() { return currentDragon; },
  get rig() { return currentRig; },
  scene, camera, renderer,
  regenerate: rebuild,
  renderFrame,
  setRenderTier,
  get renderTier() { return window.__renderTier; },
  controls,
  // Fit the camera to the dragon (3/4 hero). force=true reframes even if the user
  // has orbited. Exposed for the console + the "reframe" affordance.
  frameDragon,
  // Slow showcase turntable (OrbitControls autoRotate; controls.update() already
  // runs each animate() frame). setTurntable(true|false) or toggle.
  setTurntable: (on, speed = 0.6) => {
    controls.autoRotate = (on === undefined) ? !controls.autoRotate : !!on;
    controls.autoRotateSpeed = speed;
    return controls.autoRotate;
  },
  // --- Pose API (Phase-0 animation) --------------------------------------
  poses: POSES,
  poseNames: POSE_NAMES,
  applyPose: (name) => { applyPoseByName(name); return !!(currentRig && POSES[name]); },
  setBoneRotation: (bone, x, y, z) => currentRig ? currentRig.setBoneRotation(bone, x, y, z) : false,
  resetPose: () => { currentPoseName = 'idle'; if (currentRig) currentRig.resetPose(); },
  // Freeze/enable the idle layer (pose gallery freezes it for clean stills).
  setIdle: (on) => { if (currentRig) currentRig.idleEnabled = !!on; },
  // --- Locomotion API (Phase-1 animation) --------------------------------
  // Morphology-adaptive ground gait. 'idle' = current gentle idle (default);
  // 'walk' / 'run' drive a step cycle (quadruped/biped) or serpentine undulation
  // per the measured body plan, translating the root forward. Persists across
  // rebuilds (age scrub / genome edits keep walking).
  setGait,
  get gait() { return currentGait; },
  get gaitPlan() { return currentLoco ? currentLoco.plan : 'none'; },
  // Current root (group) world position — advances as the dragon walks; handy for
  // verifying forward translation ("does it actually move?").
  get rootPos() { return currentDragon ? currentDragon.position.clone() : null; },
};
