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

**Returned child structure** (names are stable; the harness relies on `faceRig`):

```
dragon (Group)                      userData: { genome, age, env, phenotype }
├── body (Group)
│   ├── torso (Group)  [ torsoMain, belly ]
│   ├── neck  (Group)  stacked spheres, curves up to the head
│   ├── tail  (Group)  stacked spheres, tapers out the back
│   └── spikes (Group) dorsal cones (grow in with age)
├── head (Group)                    userData: { faceRig, headRadius }
│   ├── skull (Mesh)
│   ├── snout (Mesh)
│   ├── ridge (Mesh)
│   ├── horns (Group)
│   └── faceRig (Group)  ← from face.js: [ eyeL, eyeR, browL, browR ]
├── limbs (Group)  [ legFL, legFR, legBL, legBR ]
└── wings (Group)  [ wingL, wingR ]
```

Reach the face rig anywhere with `dragon.getObjectByName('faceRig')`.

### Helpers exported alongside the contract

- `phenotype(genome, age, env)` — the pure function that maps genome + age → the
  concrete numbers used to build geometry. **This is where the cute→cool allometry
  lives.** A real generator can keep this shape or fold it in.
- `setDragonFace(dragon, faceParams)` — re-pose the face rig without a full
  rebuild (used by the emotion dropdown and live face sliders).
- `FACE_TRAITS` — the six face-param trait names the face rig consumes.

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

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell, importmap (CDN pin / offline note), UI layout, styles. |
| `src/app.js` | The harness: scene, lights, OrbitControls, auto-built panel, buttons, export. Talks to the generator only via the contract. |
| `src/generator.js` | **Interface contract** + placeholder generator (`GENOME_SCHEMA`, `DEFAULT_GENOME`, `generateDragon`, `phenotype`). |
| `src/face.js` | Reusable, scalable eye+brow face rig + emotion presets. |
| `out/` | Rendered PNG/glTF output (gitignored). |
