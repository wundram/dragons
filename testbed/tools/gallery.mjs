// Headless gallery generator for the Dragons test bed.
//
// Produces montaged PNG contact sheets (ImageMagick `montage`/`convert`) for
// visual evaluation — see design/gallery-spec.md. Reuses render.mjs's
// machinery: drive the live page in headless Chrome, set the genome, scrub the
// AGE slider (range input #0), auto-frame via Box3, and screenshot ONLY the
// canvas element (clip rect = canvas bounding box) so cells are clean creature
// shots with no UI panel.
//
// Setup (once):  cd testbed/tools && npm install
// Serve:         python3 -m http.server 8000 --directory <testbed>
//
// Sub-commands:
//   node gallery.mjs age       --archetype wyvern --ages 0,0.2,0.4,0.6,0.8,1
//   node gallery.mjs age       --genome '{"neckLength":2}' --ages 0,0.5,1
//   node gallery.mjs variation --mode sweep  --trait neckLength --n 12 --age 1
//   node gallery.mjs variation --mode random --subset body,head --n 12 --age 1 --seed 7
//   node gallery.mjs tree      --root wyvern --fanout 3 --depth 2 --jitter 0.2 --age 1
//   node gallery.mjs poses     --genome '{}'      # stub: needs pose API (Step 2 rig)
//
// Common flags:
//   --out   output dir for sheets      (default ../out/gallery)
//   --url   testbed page url           (default http://localhost:8000/)
//   --size  WxH viewport               (default 1100x900)
//   --seed  integer seed for random/tree modes (default 1); deterministic
//           per-cell (seeded mulberry32 — no bare Math.random)
//
// The final sheet path(s) are printed as the LAST line(s) of output so the
// orchestrator can Read them and run `tools/grok.sh eval`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MONTAGE = '/opt/homebrew/bin/montage';
const CONVERT = '/opt/homebrew/bin/magick'; // IMv7 name for `convert`
const MAX_CELLS = 16;      // grids capped so sheets stay readable & fast
const CELL_PX = 340;       // cell edge in the montage
const BG = '#14141c';      // sheet background (close to the app's scene bg)
const FG = 'white';

// ---------------------------------------------------------------------------
// CLI parsing (same style as render.mjs)
// ---------------------------------------------------------------------------
const sub = process.argv[2];
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v; // boolean flags
}
function die(msg) { console.error('gallery.mjs: ' + msg); process.exit(1); }

const SUBS = ['age', 'variation', 'tree', 'poses'];
if (!SUBS.includes(sub)) {
  die(`usage: node gallery.mjs <${SUBS.join('|')}> [flags]  (see header comment)`);
}

const out = String(arg('out', '../out/gallery'));
const url = String(arg('url', 'http://localhost:8000/'));
const seed = Number(arg('seed', 1));
const [vw, vh] = String(arg('size', '1100x900')).split('x').map(Number);
fs.mkdirSync(out, { recursive: true });
const cellsDir = path.join(out, '.cells');
fs.rmSync(cellsDir, { recursive: true, force: true });
fs.mkdirSync(cellsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Deterministic per-cell RNG (mulberry32). NEVER bare Math.random here —
// galleries must be reproducible from --seed + cell index.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  a >>>= 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cellRng = (index) =>
  mulberry32((Math.imul(seed, 0x9E3779B9) ^ Math.imul(index + 1, 0x85EBCA6B)) >>> 0);

// ---------------------------------------------------------------------------
// Browser: ONE browser/page reused across every cell in the run.
// ---------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--disable-gpu', `--window-size=${vw},${vh}`],
  defaultViewport: { width: vw, height: vh },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text()))
    errors.push('CONSOLE: ' + m.text());
});
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__testbed && window.__testbed.regenerate && window.__ARCHETYPES',
  { timeout: 30000 });
// hide the mouse-hints HUD that floats over the canvas (it would show in cells)
await page.evaluate(() => { const h = document.querySelector('#hud'); if (h) h.style.display = 'none'; });

// Trait schema (min/max/group) + defaults, read from the live page so the tool
// never drifts from generator.js.
const { schema, defaults, archetypeNames } = await page.evaluate(async () => {
  const mod = await import('./src/generator.js');
  return {
    schema: mod.GENOME_SCHEMA.map(t => ({ name: t.name, min: t.min, max: t.max, group: t.group })),
    defaults: { ...mod.DEFAULT_GENOME },
    archetypeNames: Object.keys(window.__ARCHETYPES),
  };
});
const traitByName = Object.fromEntries(schema.map(t => [t.name, t]));

async function resolveGenome(spec, flagName) {
  if (spec == null) return { ...defaults };
  const s = String(spec);
  if (archetypeNames.includes(s)) {
    return await page.evaluate(n => ({ ...window.__ARCHETYPES[n] }), s);
  }
  try { return { ...defaults, ...JSON.parse(s) }; }
  catch { die(`--${flagName} must be an archetype (${archetypeNames.join('|')}) or genome JSON, got: ${s}`); }
}

// ---------------------------------------------------------------------------
// shootCell — render one genome@age and screenshot ONLY the canvas.
// ---------------------------------------------------------------------------
async function shootCell(genome, age, file) {
  await page.evaluate(async ({ genome, age }) => {
    const THREE = await import('three');
    const t = window.__testbed;
    Object.assign(t.genome, genome);
    // drive the real AGE slider (range #0) so the app's own handler rebuilds
    // with the new genome + age
    const ageEl = document.querySelectorAll('input[type=range]')[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(ageEl, String(age));
    ageEl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    // auto-frame from a 3/4-front view based on true world bounds (as render.mjs)
    const cam = t.camera;
    const box = new THREE.Box3().setFromObject(t.dragon);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const fov = (cam.fov || 50) * Math.PI / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.15;
    const dir = new THREE.Vector3(0.55, 0.35, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    cam.near = dist / 100; cam.far = dist * 100;
    cam.lookAt(center); cam.updateProjectionMatrix();
    if (t.controls) { t.controls.target.copy(center); t.controls.update(); }
  }, { genome, age });
  await new Promise(r => setTimeout(r, 250));
  // clean creature-only cell: clip to the canvas element's bounding box
  const clip = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: Math.ceil(r.x), y: Math.ceil(r.y),
             width: Math.floor(r.width) - 1, height: Math.floor(r.height) - 1 };
  });
  await page.screenshot({ path: file, type: 'png', clip });
  return file;
}

// ---------------------------------------------------------------------------
// shootPose — like shootCell but applies a named POSE (from the Phase-0 rig)
// with the idle layer FROZEN, so the pose sheet is a clean deterministic still.
// ---------------------------------------------------------------------------
async function shootPose(genome, age, pose, file) {
  await page.evaluate(async ({ genome, age, pose }) => {
    const THREE = await import('three');
    const t = window.__testbed;
    Object.assign(t.genome, genome);
    const ageEl = document.querySelectorAll('input[type=range]')[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(ageEl, String(age));
    ageEl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    // freeze the idle + strike the pose, then frame the posed dragon.
    if (t.setIdle) t.setIdle(false);
    if (t.applyPose) t.applyPose(pose);
    const cam = t.camera;
    const box = new THREE.Box3().setFromObject(t.dragon);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const fov = (cam.fov || 50) * Math.PI / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.2;
    const dir = new THREE.Vector3(0.55, 0.30, 1).normalize();
    cam.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    cam.near = dist / 100; cam.far = dist * 100;
    cam.lookAt(center); cam.updateProjectionMatrix();
    if (t.controls) { t.controls.target.copy(center); t.controls.update(); }
    t.renderer.render(t.scene, cam);
  }, { genome, age, pose });
  await new Promise(r => setTimeout(r, 200));
  const clip = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: Math.ceil(r.x), y: Math.ceil(r.y),
             width: Math.floor(r.width) - 1, height: Math.floor(r.height) - 1 };
  });
  await page.screenshot({ path: file, type: 'png', clip });
  return file;
}

// ---------------------------------------------------------------------------
// ImageMagick compositing
// ---------------------------------------------------------------------------
function montageSheet(cells, labels, tile, title, sheetPath) {
  const args = ['-background', BG, '-fill', FG, '-pointsize', '15'];
  cells.forEach((c, i) => args.push('-label', labels[i], c));
  args.push('-tile', tile, '-geometry', `${CELL_PX}x${CELL_PX}+5+5`);
  if (title) args.push('-title', title);
  args.push(sheetPath);
  execFileSync(MONTAGE, args);
  return sheetPath;
}
// Stack row images vertically (tree tiers) under a title banner.
function stackRows(rowPaths, title, sheetPath) {
  execFileSync(CONVERT, [
    '-background', BG, '-fill', FG, '-pointsize', '22',
    `label:${title}`, ...rowPaths,
    '-gravity', 'center', '-append', sheetPath,
  ]);
  return sheetPath;
}
const fmt = (v) => (Math.round(v * 100) / 100).toString();

function capCells(n, what) {
  if (n > MAX_CELLS) die(`${what} would need ${n} cells; cap is ${MAX_CELLS}. Reduce --n / --fanout / --depth.`);
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------
const sheets = [];

if (sub === 'age') {
  // One horizontal strip: the SAME genome aging left→right.
  const which = arg('archetype', null);
  const genome = await resolveGenome(which ?? arg('genome', null), which ? 'archetype' : 'genome');
  const ages = String(arg('ages', '0,0.2,0.4,0.6,0.8,1')).split(',').map(Number);
  capCells(ages.length, 'age strip');
  const cells = [], labels = [];
  for (let i = 0; i < ages.length; i++) {
    cells.push(await shootCell(genome, ages[i], path.join(cellsDir, `age_${i}.png`)));
    labels.push(`age ${fmt(ages[i])}`);
  }
  const name = which ? String(which) : 'custom';
  sheets.push(montageSheet(cells, labels, `${ages.length}x1`,
    `Age strip — ${name}`, path.join(out, `age_${name}.png`)));
}

if (sub === 'variation') {
  const mode = String(arg('mode', 'random'));
  const n = Number(arg('n', 12));
  const age = Number(arg('age', 1));
  capCells(n, 'variation grid');
  const base = await resolveGenome(arg('archetype', null) ?? arg('genome', null), 'genome');
  const cols = Math.ceil(Math.sqrt(n));
  const cells = [], labels = [];

  if (mode === 'sweep') {
    // one named trait swept min→max across cells, all else held fixed
    const traitName = arg('trait', null);
    const t = traitByName[traitName];
    if (!t) die(`--trait must be one of: ${schema.map(s => s.name).join(', ')}`);
    for (let i = 0; i < n; i++) {
      const v = t.min + (t.max - t.min) * (n === 1 ? 0.5 : i / (n - 1));
      cells.push(await shootCell({ ...base, [t.name]: v }, age,
        path.join(cellsDir, `sweep_${i}.png`)));
      labels.push(`${t.name} ${fmt(v)}`);
    }
    sheets.push(montageSheet(cells, labels, `${cols}x`,
      `Sweep — ${t.name} ${fmt(t.min)}→${fmt(t.max)} @ age ${fmt(age)}`,
      path.join(out, `variation_sweep_${t.name}.png`)));
  } else if (mode === 'random') {
    // randomize the whole genome, or only traits in the named schema groups
    const subset = arg('subset', null);
    let traits = schema;
    if (subset) {
      const groups = String(subset).toLowerCase().split(',').map(s => s.trim());
      traits = schema.filter(t => groups.includes(t.group.toLowerCase()));
      if (!traits.length) die(`--subset matched no schema groups; groups are: ${[...new Set(schema.map(t => t.group))].join(', ')}`);
    }
    for (let i = 0; i < n; i++) {
      const rng = cellRng(i); // deterministic: --seed + cell index
      const g = { ...base };
      for (const t of traits) g[t.name] = t.min + rng() * (t.max - t.min);
      cells.push(await shootCell(g, age, path.join(cellsDir, `rand_${i}.png`)));
      labels.push(`#${i + 1}`);
    }
    const tag = subset ? String(subset).replace(/[^a-z0-9]+/gi, '-') : 'all';
    sheets.push(montageSheet(cells, labels, `${cols}x`,
      `Random ${tag} @ age ${fmt(age)} (seed ${seed})`,
      path.join(out, `variation_random_${tag}_seed${seed}.png`)));
  } else die(`--mode must be sweep or random, got: ${mode}`);
}

if (sub === 'poses') {
  // Pose-sheet: render the current dragon in each named POSE (Phase-0 rig) as a
  // montage contact sheet — how we evaluate the rig. Needs SMOOTH skin (the rig
  // only skins the marching-cubes body); the page defaults to smooth.
  const which = arg('archetype', null);
  const genome = await resolveGenome(which ?? arg('genome', null), which ? 'archetype' : 'genome');
  const age = Number(arg('age', 1));
  const poseNames = await page.evaluate(() => (window.__testbed && window.__testbed.poseNames) || []);
  if (!poseNames.length) die('no poses exposed by window.__testbed.poseNames (is the rig wired?)');
  capCells(poseNames.length, 'pose sheet');
  const cols = Math.ceil(Math.sqrt(poseNames.length));
  const cells = [], labels = [];
  for (let i = 0; i < poseNames.length; i++) {
    cells.push(await shootPose(genome, age, poseNames[i], path.join(cellsDir, `pose_${i}.png`)));
    labels.push(poseNames[i]);
  }
  const name = which ? String(which) : 'custom';
  sheets.push(montageSheet(cells, labels, `${cols}x`,
    `Poses — ${name} @ age ${fmt(age)}`, path.join(out, `poses_${name}.png`)));
}

if (sub === 'tree') {
  // Tiered mutation tree: root, fanout mutated children, their children, ...
  // Mutation = jitter each trait by ±jitter*(trait range), clamped.
  const fanout = Number(arg('fanout', 3));
  const depth = Number(arg('depth', 2));
  const jitter = Number(arg('jitter', 0.2));
  const age = Number(arg('age', 1));
  if (depth < 1 || depth > 3) die('--depth must be 1..3');
  let total = 1;
  for (let d = 1, w = 1; d <= depth; d++) { w *= fanout; total += w; }
  capCells(total, `tree (fanout ${fanout}, depth ${depth})`);

  const rootSpec = arg('root', null);
  const root = await resolveGenome(rootSpec, 'root');
  const mutate = (parent, nodeIndex) => {
    const rng = cellRng(nodeIndex); // deterministic: --seed + node index
    const child = { ...parent };
    for (const t of schema) {
      const v = parent[t.name] + (rng() * 2 - 1) * jitter * (t.max - t.min);
      child[t.name] = Math.max(t.min, Math.min(t.max, v));
    }
    return child;
  };

  // breadth-first tiers of genomes
  let tier = [root];
  let nodeIndex = 0;
  const rowPaths = [];
  for (let gen = 0; gen <= depth; gen++) {
    const cells = [], labels = [];
    for (let i = 0; i < tier.length; i++) {
      cells.push(await shootCell(tier[i], age,
        path.join(cellsDir, `tree_g${gen}_${i}.png`)));
      labels.push(gen === 0 ? 'root' : `g${gen}.${i + 1}`);
    }
    const rowPath = path.join(cellsDir, `row_${gen}.png`);
    montageSheet(cells, labels, `${tier.length}x1`, null, rowPath);
    rowPaths.push(rowPath);
    if (gen < depth) {
      tier = tier.flatMap(g => Array.from({ length: fanout }, () => mutate(g, nodeIndex++)));
    }
  }
  const name = rootSpec && archetypeNames.includes(String(rootSpec)) ? rootSpec : 'custom';
  sheets.push(stackRows(rowPaths,
    `Mutation tree — ${name}  (fanout ${fanout}, depth ${depth}, jitter ${jitter}, seed ${seed}, age ${fmt(age)})`,
    path.join(out, `tree_${name}_f${fanout}d${depth}_seed${seed}.png`)));
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------
await browser.close();
fs.rmSync(cellsDir, { recursive: true, force: true });
if (errors.length) console.error(JSON.stringify({ pageErrors: errors }, null, 2));
// final sheet path(s) = last line(s), for the orchestrator to Read
for (const s of sheets) console.log(path.resolve(s));
