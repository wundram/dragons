// Headless render harness for the Dragons test bed.
//
// Drives the real page in headless Chrome (no Chrome extension needed), scrubs
// the AGE slider, auto-frames the dragon, and writes clean PNGs for evaluation
// (Claude Read + `tools/grok.sh eval`). This is the canonical eval path when the
// Claude-in-Chrome extension is unavailable.
//
// Setup (once):  cd testbed/tools && npm install
// Serve:         (in testbed/)  python3 -m http.server 8000
// Run:           node render.mjs --ages 0,0.5,1 --out ../out --hideui
//                node render.mjs --genome '{"headSize":1.4}' --ages 0.3 --out ../out
//
// Flags:
//   --ages   comma list of ages in [0,1]           (default 0,0.5,1)
//   --out    output directory                       (default ../out)
//   --url    page url                               (default http://localhost:8000/)
//   --hideui hide the control panel (NOTE: canvas is letterboxed until the app's
//            CSS grid is made to reflow on panel hide — a Phase-2 testbed polish item;
//            for now prefer full-window shots and crop with `sips` if needed)
//   --genome inline JSON of trait overrides applied before rendering
//   --emotion neutral|happy|curious|angry|sleepy    (default leaves as-is)
//   --size   WxH viewport                           (default 900x900 when hideui, else 1100x900)

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v; // boolean flags
}

const ages = String(arg('ages', '0,0.5,1')).split(',').map(Number);
const out = arg('out', '../out');
const url = arg('url', 'http://localhost:8000/');
const hideui = !!arg('hideui', false);
const genomeOverride = arg('genome', null);
const emotion = arg('emotion', null);
const [vw, vh] = String(arg('size', hideui ? '900x900' : '1100x900')).split('x').map(Number);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--disable-gpu', `--window-size=${vw},${vh}`],
  defaultViewport: { width: vw, height: vh },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
// ignore the benign favicon 404 (no favicon shipped)
page.on('console', m => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction('window.__testbed && window.__testbed.regenerate', { timeout: 30000 });

if (hideui) {
  // hide everything except the canvas for creature-only shots
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (!el.querySelector('canvas') && el.tagName !== 'CANVAS') el.style.display = 'none';
    }
    const panel = document.querySelector('#panel, .panel, aside, .controls');
    if (panel) panel.style.display = 'none';
    document.body.style.margin = '0';
    // let the app's resize handler grow the canvas into the freed space
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise(r => setTimeout(r, 150));
}

if (genomeOverride) {
  await page.evaluate((g) => {
    Object.assign(window.__testbed.genome, JSON.parse(g));
    window.__testbed.regenerate();
  }, genomeOverride);
}
if (emotion) {
  await page.evaluate((e) => {
    const sel = document.querySelector('select');
    if (sel) { sel.value = e; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, emotion);
}

const results = [];
for (const age of ages) {
  const info = await page.evaluate(async (age) => {
    const THREE = await import('three');
    const t = window.__testbed;
    // drive the real AGE slider (range #0) so the app's own handler regenerates
    const ageEl = document.querySelectorAll('input[type=range]')[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(ageEl, String(age));
    ageEl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    // auto-frame from a 3/4-front view based on true world bounds
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
    return { size: size.toArray().map(n => +n.toFixed(2)) };
  }, age);
  await new Promise(r => setTimeout(r, 400));
  const name = `age_${String(age).replace('.', '')}.png`;
  await page.screenshot({ path: `${out}/${name}`, type: 'png' });
  results.push({ age, file: `${out}/${name}`, ...info });
}

console.log(JSON.stringify({ ok: errors.length === 0, errors, results }, null, 2));
await browser.close();
