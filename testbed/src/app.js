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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let genome = { ...DEFAULT_GENOME };
let age = 0.0;
let currentDragon = null;
let rebuildTimer = null;

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
  const next = generateDragon(genome, age, {});
  scene.remove(currentDragon);
  disposeDragon(currentDragon);
  currentDragon = next;
  scene.add(currentDragon);
  updateReadout();
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
document.getElementById('btnRandom').addEventListener('click', () => {
  for (const t of GENOME_SCHEMA) {
    // leave pupil gaze centered-ish so faces don't look cross-eyed randomly
    const v = t.min + Math.random() * (t.max - t.min);
    genome[t.name] = (t.step === 1) ? Math.round(v) : v;
  }
  syncSliders();
  rebuild();
});

document.getElementById('btnReset').addEventListener('click', () => {
  genome = { ...DEFAULT_GENOME };
  age = 0.0;
  ageInput.value = '0';
  ageVal.textContent = '0.00';
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
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
  scene, camera, renderer,
  regenerate: rebuild,
};
