// app.js — Test bed HARNESS. Owns the Three.js scene, the auto-built control
// panel, and the export/eval buttons. It talks to the generator ONLY through the
// documented interface (GENOME_SCHEMA / DEFAULT_GENOME / generateDragon), so a
// real generator can be swapped into generator.js without touching this file.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import {
  GENOME_SCHEMA, DEFAULT_GENOME, FACE_TRAITS,
  generateDragon, setDragonFace,
} from './generator.js';
import { EMOTIONS, emotionParams } from './face.js';
import { upgradeToSkinned } from './rig.js';
import { POSES, POSE_NAMES } from './poses.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let genome = { ...DEFAULT_GENOME };
let age = 0.0;
let currentDragon = null;
let currentRig = null;        // AnimRig for the live dragon (null in voxel/capsule)
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
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2330);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(4.5, 3.0, 6.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 1.2, 0);

// --- lighting: rough 3-point setup ---------------------------------------
const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
key.position.set(5, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1; key.shadow.camera.far = 30;
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
scene.add(key);

const fill = new THREE.DirectionalLight(0x9fc0ff, 0.7);
fill.position.set(-6, 3, 4);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(-2, 5, -8);
scene.add(rim);

scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x35302a, 0.6));

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
  };
  const next = generateDragon(genome, age, env);
  scene.remove(currentDragon);
  disposeDragon(currentDragon);
  currentDragon = next;
  scene.add(currentDragon);
  // Convert the freshly-built body to a live SkinnedMesh rig (smooth mode only;
  // returns null for voxel/capsule, which stay static). Re-apply the current pose
  // so the age slider scrubs a POSED dragon.
  currentRig = upgradeToSkinned(currentDragon);
  if (currentRig) applyPoseByName(currentPoseName);
  updateReadout();
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
ageInput.addEventListener('input', () => {
  age = parseFloat(ageInput.value);
  ageVal.textContent = age.toFixed(2);
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
});

document.getElementById('btnReset').addEventListener('click', () => {
  genome = { ...DEFAULT_GENOME };
  age = 0.0;
  ageInput.value = '0';
  ageVal.textContent = '0.00';
  setArchetypeCustom();
  syncSliders();
  rebuild();
});

document.getElementById('btnExport').addEventListener('click', exportGLTF);
document.getElementById('btnShot').addEventListener('click', screenshotPNG);

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
voxelResEl.value = String(window.__voxelRes);
voxelResVal.textContent = String(window.__voxelRes);
showRigEl.checked = !!window.__showRig;
syncVoxelResEnabled();

skinModeSel.addEventListener('change', () => {
  window.__skinMode = skinModeSel.value;
  syncVoxelResEnabled();
  rebuild();
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
});
document.getElementById('btnExportGeo').addEventListener('click', () => {
  const t = window.__testbed;
  if (!t || !t.exportGeoJSON) { console.warn('exportGeoJSON not ready yet'); return; }
  const json = t.exportGeoJSON();
  downloadBlob(new Blob([json], { type: 'application/json' }),
    `dragon_age${age.toFixed(2)}.geo.json`);
});

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
  };

  let done = 0;
  for (const { img, cell } of jobs) {
    // Yield a frame so the overlay + progress paint between cells.
    await new Promise((r) => requestAnimationFrame(r));
    if (galleryEl.style.display === 'none') break; // closed mid-run
    const d = generateDragon(cell.genome, cell.age, env);
    scene.add(d);
    frameObject(d);
    renderer.render(scene, camera);
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
  renderer.render(scene, camera);
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
}
window.addEventListener('resize', resize);

const animClock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // Gentle always-on idle: breathing + low-amplitude axial sway + ear idle,
  // composed on top of the current pose. Cheap, sine-based, deterministic.
  if (currentRig) currentRig.updateIdle(animClock.getElapsedTime());
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
buildPanel();
resize();
rebuild();
animate();

// Expose a tiny debug hook for the orchestrator / console verification.
window.__testbed = {
  get genome() { return genome; },
  get age() { return age; },
  get dragon() { return currentDragon; },
  get rig() { return currentRig; },
  scene, camera, renderer,
  regenerate: rebuild,
  controls,
  // --- Pose API (Phase-0 animation) --------------------------------------
  poses: POSES,
  poseNames: POSE_NAMES,
  applyPose: (name) => { applyPoseByName(name); return !!(currentRig && POSES[name]); },
  setBoneRotation: (bone, x, y, z) => currentRig ? currentRig.setBoneRotation(bone, x, y, z) : false,
  resetPose: () => { currentPoseName = 'idle'; if (currentRig) currentRig.resetPose(); },
  // Freeze/enable the idle layer (pose gallery freezes it for clean stills).
  setIdle: (on) => { if (currentRig) currentRig.idleEnabled = !!on; },
};
