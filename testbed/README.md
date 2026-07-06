# Dragons — Web / Three.js Test Bed Harness

A standalone, **zero-build** sandbox for developing and evaluating the dragon-model
generator. It renders a dragon in the browser, gives you live sliders for every
genome trait plus a prominent **Age** slider to scrub the **cute → cool growth
arc**, and lets you export glTF / PNG for the evaluation loop.

The harness is **generator-agnostic**: it talks to the generator only through the
interface contract in `src/generator.js`. The current generator is a crude
**placeholder** built from primitives whose only job is to prove the harness and
the arc are wired correctly. The real, research-driven generator drops in by
replacing the *implementation* in `src/generator.js` — nothing else changes.

---

## Run it

Zero build step. Any static file server works; use Python's:

```bash
cd testbed
python3 -m http.server 8000
# open http://localhost:8000
```

Then in the browser:

- **Drag** to orbit, **scroll** to zoom, **right-drag** to pan.
- Drag the big orange **AGE** slider (top-left) from 0 → 1 and watch the dragon
  transform from a round, big-eyed, stubby-limbed **baby** into a leaner, horned,
  winged, angular **adult**.
- Tune any trait slider (grouped: Body / Head / Limbs / Features / Color / Face).
- **Randomize** / **Reset**, pick an **Emotion** preset, **Copy** the genome JSON.
- **⬇ glTF** and **📷 PNG** download the current model / render.
- **Skin & View** group: **Skin mode** (Smooth / Capsule / Voxel-Minecraft),
  **Voxel res** (voxel mode only), **Show rig** overlay, **Archetype** loader
  (Custom / Snake / Wyvern / Quadruped / Eastern → copies that genome into the
  live sliders), and **⬇ Export geo.json** (Bedrock geometry download). Skin
  settings flow into `generateDragon` via an explicit `env`, and are also mirrored
  onto `window.__skinMode` / `__voxelRes` / `__showRig` so the headless tools that
  poke those globals keep working.
- **Gallery** group: **Age strip** / **Variation** / **Breeding tree** render
  thumbnail grids into an overlay over the 3D stage (reusing the single renderer),
  respecting the current skin mode. Close with **✕ Close**.

### Offline

The page loads Three.js r0.160.0 + `OrbitControls` + `GLTFExporter` from unpkg via
an ES-module **importmap** (see `index.html`). If the machine is offline, an error
banner appears in the stage. To vendor:

1. Download `three.module.js`, `examples/jsm/controls/OrbitControls.js`, and
   `examples/jsm/exporters/GLTFExporter.js` (same version) into `testbed/vendor/`.
2. Repoint the importmap in `index.html` to `./vendor/...`.

The rest of the code needs no changes (it imports the bare specifiers `three` and
`three/addons/`).

---

## Generator interface contract

Everything the harness needs from a generator lives in `src/generator.js` and is
**the stable API a real generator must implement**:

### `GENOME_SCHEMA: TraitSpec[]`

Declarative list describing every numeric trait. The control panel is auto-built
from this — add a trait here and a grouped slider appears automatically.

```js
TraitSpec = {
  name: string,          // key in the genome object
  min: number, max: number,
  default: number,       // also mirrored into DEFAULT_GENOME
  step?: number,         // slider granularity (default 0.01; use 1 for counts)
  group: string,         // panel section: Body/Head/Limbs/Features/Color/Face
  description: string,   // tooltip / documentation
}
```

### `DEFAULT_GENOME: Record<string, number>`

A default value per trait (derived from the schema so they can't drift apart).

### `generateDragon(genome, age, env) -> THREE.Group`

- `genome`: `{ traitName: number }` (any subset; missing traits fall back to
  `DEFAULT_GENOME`).
- `age`: `0..1`. **This — not the genome — drives the cute→cool transformation.**
  Genome traits only bias *where the adult lands* and *how features grow in*.
- `env`: optional object for environmental influence. The placeholder honors
  `{ sizeBoost?: number, hueShift?: number }`; the real generator may extend it
  (diet, biome, temperature…). Treat unknown keys as ignorable.

Returns a `THREE.Group` (the whole dragon, including the face rig) positioned so
its feet rest near `y = 0`. `userData` carries `{ genome, age, env, phenotype }`.

**Returned child structure** (Step 1: fixed-topology skeleton skinned as raw
per-bone tapered capsules; the harness only relies on the `faceRig` name):

```
dragon (Group)   userData: { genome, age, env, phenotype, skeleton }
├── body   (Group)  spine_00..23 + tail_00..11 capsule chain + belly patch
├── head   (Group)  userData: { faceRig, headRadius }
│   ├── skull (Mesh, ellipsoid) + snout + jaw capsules
│   └── faceRig (Group)  ← from face.js: [ eyeL, eyeR, browL, browR ]
├── limbs  (Group)  fore/hind leg capsules + girdles (budding-gated; empty for a snake)
├── wings  (Group)  wing spar capsules (budding-gated; empty when wingDev=0)
└── rigDebug (LineSegments)  only when env.showRig (or window.__showRig) is set
```

Reach the face rig anywhere with `dragon.getObjectByName('faceRig')`.

**`userData.skeleton`** is the resolved fixed-topology bone tree: an array of
`{ name, parent, pos:Vector3, length, envelopeRadius, tail?, rTail?, kind }`. The
bone **name set is identical for every genome at every age** (59 bones:
`spine_00..23`, `tail_00..11`, `skull`, `snout`, `jaw`, `shoulderGirdle`,
`hipGirdle`, `{fore,hind}{L,R}_{upper,lower,foot}`, `wing{L,R}_{00,01,02}`).
Growth only scales each bone's `length`/`envelopeRadius`; a limb whose `*Dev`
trait is 0 has radius 0 and is simply skipped. **Step 2** sums each bone's
`pos`→`tail` capsule envelope (radius `envelopeRadius`→`rTail`) into the implicit
field.

### Helpers exported alongside the contract

- `phenotype(genome, age, env)` — the pure function that maps genome + age → the
  concrete numbers used to build geometry. **This is where the cute→cool allometry
  lives.** A real generator can keep this shape or fold it in.
- `setDragonFace(dragon, faceParams)` — re-pose the face rig without a full
  rebuild (used by the emotion dropdown and live face sliders).
- `FACE_TRAITS` — the six face-param trait names the face rig consumes.
- `ARCHETYPES` — `{ snake, wyvern, quadruped, eastern }`, each a full genome
  object that is an attractor point in the continuous trait space (all valid
  poses of the one skeleton). Also on `window.__ARCHETYPES` for headless/console
  use. Render an archetype headless with
  `node render.mjs --genome '{"foreLimbDev":0,"hindLimbDev":0,"wingDev":0,...}'`.

### The face rig — `src/face.js`

A reusable, scale-independent eye+brow sub-rig. `createFaceRig(params, opts)`
builds two eyes (white eyeball + steerable pupil + catch-light) and two floating
brows, sized from the head's radius so it works at any scale.
`applyFaceParams(rig, params)` re-poses it. `EMOTIONS` / `emotionParams(name)`
provide presets: `neutral`, `happy`, `curious`, `angry`, `sleepy`.

Face params: `eyeOpen` (0..1 lid), `pupilX`/`pupilY` (-1..1 gaze),
`browHeight`/`browAngle`/`browCurve` (-1..1).

---

## Plugging in a real generator

1. Keep `GENOME_SCHEMA`, `DEFAULT_GENOME`, and `generateDragon(genome, age, env)`
   exports intact (same names & shapes).
2. Have `generateDragon` return a `THREE.Group`. Include a face rig named
   `faceRig` (reuse `src/face.js` — it's independent of the body generator) so the
   emotion dropdown and live face sliders keep working.
3. Keep the cute→cool arc driven by `age` (0..1), not by a genome trait.
4. Position the group so feet rest near `y = 0`. Dispose-friendly geometry/materials
   are nice (the harness disposes on rebuild) but not required.
5. Add/rename traits by editing `GENOME_SCHEMA` only — the panel rebuilds itself.

You should not need to touch `index.html` or `src/app.js`.

---

## Evaluation loop

The harness feeds the human + AI feedback loop described in `AGENTS.md`:

1. **Export** a render: **📷 PNG** (canvas snapshot) or **⬇ glTF** (geometry).
   Saved via the browser's download; move keepers into `testbed/out/` (gitignored).
2. **Claude Read** the PNG as the primary vision check — is the silhouette
   unmistakably "cute baby" at age 0 and "cool adult" at age 1, with no broken
   intermediate frames, face expressive throughout (the success test in
   `design/cute-to-cool-arc.md`)?
3. **grok second opinion** — cross-check aesthetics/geometry:
   ```bash
   tools/grok.sh eval testbed/out/dragon_age1.00.png
   ```
   (See `AGENTS.md §5` for the exact prompt / JSON-schema scoring flags.)
4. Scrub several ages (e.g. 0.0, 0.25, 0.5, 0.75, 1.0) on a fixed genome, export
   each, and evaluate the whole arc — not just the endpoints.

A `window.__testbed` debug hook exposes `{ genome, age, dragon, scene, camera,
renderer, regenerate }` for scripted / headless verification.

---

## Gallery (headless contact sheets)

`tools/gallery.mjs` renders montaged PNG contact sheets for visual evaluation
(spec: `design/gallery-spec.md`). It drives the live page in headless Chrome
like `tools/render.mjs`, screenshots only the canvas, and composites with
ImageMagick. Serve the testbed first (`python3 -m http.server 8000 --directory
testbed`; pass `--url` if you use another port), then from `testbed/tools/`:

```bash
node gallery.mjs age       --archetype wyvern --ages 0,0.2,0.4,0.6,0.8,1   # one genome aging (strip)
node gallery.mjs variation --mode sweep  --trait neckLength --n 12 --age 1 # one trait min→max (grid)
node gallery.mjs variation --mode random --subset body,head --n 12 --seed 7 # randomized genomes (grid)
node gallery.mjs tree      --root wyvern --fanout 3 --depth 2 --jitter 0.2 # mutation tree (tiers)
node gallery.mjs poses     --genome '{}'   # stub — waits on the Step 2 pose API
```

Genomes come from `--genome '<json>'` or `--archetype snake|wyvern|quadruped|eastern`.
Random/tree modes are deterministic from `--seed` + cell index. Grids are capped
at 16 cells. Sheets land in `out/gallery/` (gitignored, like all of `out/`);
the final sheet path(s) are printed as the last line(s) for scripted evaluation.

---

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell, importmap (CDN pin / offline note), UI layout, styles. |
| `src/app.js` | The harness: scene, lights, OrbitControls, auto-built panel, Skin & View + Gallery groups, buttons, export. Talks to the generator only via the contract. |
| `src/generator.js` | **Interface contract** + placeholder generator (`GENOME_SCHEMA`, `DEFAULT_GENOME`, `generateDragon`, `phenotype`). |
| `src/face.js` | Reusable, scalable eye+brow face rig + emotion presets. |
| `tools/render.mjs` | Headless Chrome render harness (single shots across ages). |
| `tools/gallery.mjs` | Headless gallery generator — montaged contact sheets (age / variation / tree; poses stubbed). |
| `out/` | Rendered PNG/glTF output (gitignored). Gallery sheets go to `out/gallery/`. |
