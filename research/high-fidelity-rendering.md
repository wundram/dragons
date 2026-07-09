# High-Fidelity Rendering for Dragon Explorer (three.js r160, zero-build)

Research + implementation-ready proposal for upgrading `testbed/` rendering from the current
"rough 3-point + MeshStandardMaterial + PCF shadows" setup to a showcase-quality pipeline,
while keeping a cheap tier for the Minecraft/perf target. Everything below was verified to
exist in the **pinned `three@0.160.0`** on unpkg (the importmap version in `testbed/index.html`),
so it satisfies the zero-build constraint: only `three` + `three/addons/`, no external assets.

## TL;DR (5 bullets)

- **Recommended stack:** ACES Filmic tone mapping + sRGB output → **PMREM'd `RoomEnvironment` IBL** (no HDRI asset needed) → **`MeshPhysicalMaterial`** per part (vertex colors kept) → key/rim directionals with **VSM soft shadows** + a blurred **contact shadow** → `EffectComposer` [RenderPass → GTAOPass → UnrealBloomPass → OutputPass] on an **MSAA (samples: 4) HalfFloat target**.
- **Biggest single win is Phase 1** (a ~30-line change to `app.js`): ACES tone mapping, explicit color management, and `scene.environment = pmremGenerator.fromScene(new RoomEnvironment(renderer)).texture` — instant studio-quality ambient light and believable speculars with zero assets.
- **Materials:** body/belly stay vertex-colored but move to `MeshPhysicalMaterial` (white base × vertex colors, subtle clearcoat = moist reptile skin); **wing membranes use thin-walled `transmission`** (`transmission≈0.45`, `thickness: 0`, `DoubleSide`) for real light-through-the-wing translucency; feathers get `sheen`; horns/spikes/scutes/eyes get `clearcoat` (keratin/wet-eye gloss).
- **Post-processing is all built-in addons at r160:** `GTAOPass` (ground-truth AO, added in r160), `UnrealBloomPass` (subtle, HDR-driven), `OutputPass` (does the tone-map + sRGB conversion at the end of the chain), MSAA via the composer's render target — no SMAA/FXAA pass needed on WebGL2.
- **Two-tier switch (`window.__renderTier = 'high' | 'cheap'`)** keeps the Minecraft path honest: cheap tier = no composer, no env map, `MeshStandardMaterial`/flat voxel shading, plain PCF shadows — the same fidelity-tier principle as smooth-vs-voxel skin.

---

## Findings

### 1. Color management & tone mapping (the free 80%)

- Since r152, three.js defaults `renderer.outputColorSpace = THREE.SRGBColorSpace` and works
  in a linear-sRGB working space; hex colors set via `new THREE.Color(0x...)` and
  `material.color` are converted for you when `THREE.ColorManagement.enabled` (default true).
  Our vertex-color path writes *linear* values into the `color` attribute — that is exactly
  what the renderer expects, so **no change needed to keep markings correct**; just don't
  double-convert. ([Color management manual](https://threejs.org/docs/#manual/en/introduction/Color-management))
- `renderer.toneMapping = THREE.ACESFilmicToneMapping` is the standard "filmic" choice; r160
  also ships `AgXToneMapping` (arguably nicer highlight rolloff, slightly desaturated).
  Recommend **ACES** with `toneMappingExposure ≈ 1.0–1.2`; AgX is a one-line experiment.
- **Critical interaction with post-processing:** when rendering through `EffectComposer`,
  tone mapping must happen at the END of the chain. That's what **`OutputPass`** does — it
  reads `renderer.toneMapping` / `renderer.outputColorSpace` and applies tone map + sRGB
  conversion as the final pass (verified in the r160 source: it imports
  `ACESFilmicToneMapping`, `AgXToneMapping`, `SRGBTransfer` and rebuilds its defines from the
  renderer's settings). ([OutputPass docs](https://threejs.org/docs/pages/OutputPass.html))
- The r160 `EffectComposer` defaults its internal render target to **`HalfFloatType`**
  (verified in source), so the whole chain is HDR until `OutputPass` — bloom thresholds >1.0
  work, highlights don't clip.

### 2. Image-based lighting with zero external assets

- **`RoomEnvironment`** (`three/addons/environments/RoomEnvironment.js`) is a tiny procedural
  "photo studio" scene (a box room + area-light-like boxes + point light) taken from Google's
  model-viewer. Run it through **`PMREMGenerator.fromScene()`** and assign the resulting
  texture to `scene.environment` → full PBR IBL, no HDRI download.
  - **r160 gotcha #1:** the r160 constructor is `new RoomEnvironment(renderer)` — pass the
    renderer so it picks the physically-correct light intensity (900 vs legacy 5); verified
    in the [r160 source](https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js).
    (Newer three versions dropped the argument; we're pinned, so use it.)
  - **r160 gotcha #2:** `scene.environmentIntensity` does **not exist** at r160 (added r163).
    To tune IBL strength, set **`material.envMapIntensity`** per material (traverse the
    dragon after build). 0.5–0.9 reads well against our dark background.
- Alternative/upgrade: a **procedural gradient sky** — build a one-off `Scene` containing a
  big sphere with a vertex-gradient `ShaderMaterial` (+ a bright "sun" disc) and PMREM that
  instead. Gives an outdoor mood (cool sky dome, warm horizon) still with zero assets.
  RoomEnvironment first; the gradient sky is a drop-in swap later.
- **Backdrop:** `scene.background` can be the same PMREM texture with
  `scene.backgroundBlurriness = 0.5–0.7` and `backgroundIntensity ≈ 0.2–0.4` for a soft
  studio sweep, or keep the current flat color. Both are self-contained.

### 3. Materials: `MeshStandardMaterial` vs `MeshPhysicalMaterial`

`MeshPhysicalMaterial` extends Standard with exactly the channels a dragon needs
([docs](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial)):

| Channel | What it buys us |
|---|---|
| `clearcoat` / `clearcoatRoughness` | Wet/keratin gloss layer over a rough base — reptile skin sheen, horn/scute polish, **eyes** |
| `transmission` / `thickness` / `ior` / `attenuationColor` | Physically-based translucency — **wing membranes**, backlit ears |
| `sheen` / `sheenColor` / `sheenRoughness` | Retro-reflective micro-fiber rim — **feathers**/fuzz |
| `specularIntensity` / `specularColor` | Dial dielectric reflectance without touching metalness |
| `iridescence` | Optional exotic morph gene (beetle-shimmer scales) — cheap to expose later |

Key facts verified:

- **Vertex colors work unchanged**: `vertexColors: true` multiplies the `color` attribute into
  `material.color` on all mesh materials including Physical. Keep base `color` white on the
  body (as `generator.js` already does) and the markings carry straight into PBR.
- **Thin-walled transmission** is the right membrane model: per the
  [transmission docs](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial.transmission),
  `thickness: 0` (default) = thin-walled surface; thin semi-transparent materials remain
  reflective even when fully transmissive. Set `transparent: false`, `opacity: 1` when
  transmission > 0 (transmission replaces alpha blending). Live demo:
  [webgl_materials_physical_transmission](https://threejs.org/examples/webgl_materials_physical_transmission.html);
  good practical write-up: [Codrops — transparent glass/plastic in three.js](https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/).
  - **Cost:** any transmissive material triggers one extra opaque-scene render into the
    renderer's transmission target per frame (a fixed cost, not per-object). Fine for a
    single-creature viewer; it's the first thing the cheap tier drops.
- **True subsurface scattering** exists as an addon
  ([SubsurfaceScatteringShader / webgl_materials_subsurface_scattering](https://threejs.org/examples/webgl_materials_subsurface_scattering.html))
  but it's a `ShaderMaterial` fork of Phong — no env-map/PBR integration, needs a thickness
  map. **Not recommended**; thin-walled transmission + `attenuationColor` fakes membrane SSS
  well enough and stays in the PBR family.
- **No-UV constraint:** the marching-cubes body has no UVs, so `map`/`normalMap`/`bumpMap`
  are unavailable on the body without triplanar mapping (an `onBeforeCompile` shader patch)
  or box-projected UVs. Scale/texture detail on the body is therefore a **stretch goal**
  (Phase 4+), not part of this upgrade. Roughness/clearcoat variation + AO + IBL already read
  as "skin" at viewer distances.

### 4. Lights & shadows

- With IBL as ambient+fill, the light rig simplifies: **keep the warm key** (shadow caster)
  and a **strong cool rim** for silhouette pop; delete or heavily reduce the fill directional
  and hemisphere (the env map does their job better, and stacked fills wash out AO).
- **Soft shadows, options ranked** (see [sbcode soft-shadows](https://sbcode.net/threejs/soft-shadows/)):
  1. **`VSMShadowMap`** (recommended high tier): supports `shadow.radius` + `shadow.blurSamples`
     for genuinely soft, blurrable shadows —
     [webgl_shadowmap_vsm example](https://threejs.org/examples/webgl_shadowmap_vsm.html).
     Caveat: light bleeding where casters overlap; mitigate with `shadow.bias ≈ -0.0005` and
     keeping the ground `receiveShadow`-only.
  2. `PCFSoftShadowMap` (current): decent, but **`shadow.radius` has no effect** with this
     type — you can't soften it further. Keep as the cheap-tier type.
  3. **PCSS** (contact-hardening penumbra): the official
     [webgl_shadowmap_pcss example](https://threejs.org/examples/webgl_shadowmap_pcss.html)
     works by patching `THREE.ShaderChunk.shadowmap_pars_fragment` before materials compile.
     Prettiest penumbra, but it's a global shader hack — fragile. Optional experiment only;
     we're version-pinned so it can't silently break.
- **Contact shadow** (the grounding trick): the
  [webgl_shadow_contact example](https://threejs.org/examples/webgl_shadow_contact.html)
  renders scene depth from a camera looking **up** under the floor into a small render target
  (256² is plenty), blurs it with `HorizontalBlurShader`/`VerticalBlurShader` (both in r160
  addons), and shows it on a ground plane with a custom depth-to-alpha material. Cost: two
  tiny extra renders per frame (or on-demand — our dragon only changes on rebuild/animation).
  This soft dark pool under the dragon is the single best "product-shot" grounding cue.

### 5. Post-processing (all `three/addons`, verified present at 0.160.0)

- **AO:** r160 added **`GTAOPass`** (ground-truth ambient occlusion) —
  [example](https://threejs.org/examples/webgl_postprocessing_gtao.html),
  [docs](https://threejs.org/docs/pages/GTAOPass.html). Verified r160 signature:
  `new GTAOPass(scene, camera, width, height)`, with `pass.blendIntensity`,
  `pass.updateGtaoMaterial({...})`, `pass.setSize(w, h)`. Markedly better than the old
  `SSAOPass` (which tends to halo). External alternative: **N8AO**
  ([npm](https://www.npmjs.com/package/n8ao), [forum comparison](https://discourse.threejs.org/t/new-ambient-occlusion-example-hbao-vs-n8ao/58847))
  is higher quality with a half-res mode, and can be loaded zero-build by adding one importmap
  entry — but it's a second CDN dependency; **start with the built-in GTAOPass**.
- **Bloom:** `UnrealBloomPass` — keep it *subtle* (`threshold ≈ 0.85, strength ≈ 0.25,
  radius ≈ 0.5`); with the HalfFloat chain only true highlights (eye catchlights, rim
  glints, future fire-breath) bloom. [Example](https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html).
- **Anti-aliasing:** the canvas `antialias: true` MSAA is bypassed once you render into
  composer targets. On WebGL2 the fix is to give the composer an explicit target with
  **`samples: 4`** (`new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType })`)
  — hardware MSAA inside the composer, no extra pass, crisper than FXAA/SMAA on our
  hard-edged spikes. `SMAAPass`/`FXAAShader`/`TAARenderPass` all exist at r160 as fallbacks
  (SMAA would go **after** `OutputPass`, on tone-mapped LDR); TAA only converges on static
  scenes — wrong for an animated dragon.
- **Optional showcase extras:** `BokehPass` (depth-of-field; noticeable cost — showcase
  screenshots only, off by default) and `VignetteShader` via `ShaderPass` (cheap, tasteful
  at `darkness ≈ 1.1`). Both present at r160.
- **Pass order matters:** effects that need HDR/depth run first, tone-map last:
  `RenderPass → GTAOPass → UnrealBloomPass → [Bokeh/Vignette] → OutputPass`.

### 6. Presentation

- **Turntable:** `controls.autoRotate = true; controls.autoRotateSpeed = 1.0` + a UI toggle —
  OrbitControls already does this, and `controls.update()` is already in the loop.
- **Ground:** swap the flat grey disc for a slightly rough, very dark disc (`roughness 0.95,
  color ≈ 0x181d26`) + the contact-shadow plane; hide the `GridHelper` in high tier (keep in
  cheap/debug). Blurred-env background (§2) gives the "infinite sweep" look.
- **Framing:** the existing `frameObject()` Box3 fit is good; for hero shots drop the camera
  ~10° below the dragon's eye line and target 0.45×height — makes creatures read "grand".

---

## Proposed rendering upgrade for our project

### A. Material plan per part (tier-aware; vertex colors preserved)

Create `testbed/src/materials.js` exporting factories `makeMaterials(p, tier)` so
`generator.js` / `features.js` / `face.js` stop hand-rolling materials inline. `tier` is
`'high' | 'cheap'`; cheap returns today's `MeshStandardMaterial`s unchanged. High tier:

| Part | Material (all `MeshPhysicalMaterial` unless noted) | Key params |
|---|---|---|
| **Body** (marching-cubes, vertex-colored markings) | `vertexColors: true`, `color: 0xffffff` | `roughness 0.55, metalness 0, clearcoat 0.15, clearcoatRoughness 0.6, specularIntensity 0.9, envMapIntensity 0.7` — moist reptile skin; vertex colors untouched |
| **Belly** | phenotype belly color | `roughness 0.8, clearcoat 0.05` — matte plates vs glossier back |
| **Wing membrane + sail** | phenotype membrane color, `side: DoubleSide` | `transmission 0.45, thickness 0, ior 1.4, roughness 0.55, attenuationColor: membrane tint, transparent: false, opacity 1` — real backlit glow; drop the current fake `emissive`/`opacity 0.9`. Keep the existing age-based opacity ramp by mapping it onto `transmission` (baby ≈ 0.65 → adult ≈ 0.35) |
| **Ears** (thin) | body-tinted | body params + `transmission 0.2` — subtle backlit ear glow |
| **Spikes / horns / claws / scutes** | phenotype hard color | `roughness 0.35, metalness 0, clearcoat 0.5, clearcoatRoughness 0.25` — polished keratin (replaces the fake `metalness 0.2`) |
| **Feathers** | phenotype feather color | `roughness 0.9, sheen 0.6, sheenRoughness 0.7, sheenColor: lightened feather tint, side: DoubleSide` — fuzzy rim response |
| **Eyes** (sclera + iris in `face.js`) | white + pupil meshes | sclera: `roughness 0.15, clearcoat 1.0, clearcoatRoughness 0.05`; pupil: `roughness 0.1, clearcoat 1.0`. IBL + rim light produce the catchlight; keep the existing `MeshBasicMaterial` glint sprite as backup for cheap tier |
| **Teeth/ivory, barbels, brows, mouth** | as today's colors | ivory: `clearcoat 0.3, roughness 0.45`; mouth interior: `roughness 0.65` (wet), others ≈ current values on Physical |
| **Voxel skin (MC mode)** | `MeshStandardMaterial` or `MeshLambertMaterial`, `vertexColors: true`, `flatShading: true` | always cheap-tier — voxel mode *is* the reduced tier |

Notes: metalness stays 0 everywhere (dragons are dielectric; "shiny" comes from
clearcoat/env). All factories must keep working under `renderer.render` alone (cheap tier)
— none of these channels require the composer, only `transmission` requires WebGL2 (which
we already require).

### B. Lighting / environment (self-contained IBL)

In `app.js` scene setup (Phase 1):

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

renderer.outputColorSpace = THREE.SRGBColorSpace;      // explicit (r160 default, keep pinned)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04); // r160: pass renderer!
scene.environment = envRT.texture;
pmrem.dispose();
// optional backdrop: scene.background = envRT.texture;
// scene.backgroundBlurriness = 0.6; scene.backgroundIntensity = 0.3;
```

Light rig (replaces the 4-light rig):

```js
// KEY — warm, shadow caster
key.intensity = 1.6;                       // down from 2.2; IBL carries ambient
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
key.shadow.radius = 6; key.shadow.blurSamples = 12;   // VSM softness
// RIM — cool, from behind-left, no shadow
rim.intensity = 1.4;
// DELETE the fill directional and hemisphere (env replaces them)
renderer.shadowMap.type = THREE.VSMShadowMap;          // high tier
```

Since r160 lacks `scene.environmentIntensity`, after every `rebuild()` traverse the dragon
and set `material.envMapIntensity = TIER.envMapIntensity` (0.7 high / 0 cheap) — hook it
into the existing `rebuild()` right after `scene.add(currentDragon)`.

**Contact shadow:** port the `webgl_shadow_contact` technique into a small
`makeContactShadow(renderer, scene)` helper: 256² depth target under a 0.5-unit-deep box
around the ground, `HorizontalBlurShader` + `VerticalBlurShader` passes, dark plane with
`opacity ≈ 0.55`. Re-render it inside `rebuild()` (and per-frame once animation lands),
not every frame while static.

### C. Post-processing stack (ordered) + perf

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }    from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass }      from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }    from 'three/addons/postprocessing/OutputPass.js';

const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
  size.x, size.y, { samples: 4, type: THREE.HalfFloatType }));   // MSAA + HDR

composer.addPass(new RenderPass(scene, camera));                  // 1. scene (HDR, linear)
const gtao = new GTAOPass(scene, camera, size.x, size.y);         // 2. AO
gtao.blendIntensity = 0.8;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(size, 0.25, 0.5, 0.85);         // 3. subtle bloom
composer.addPass(bloom);
// 4. optional: BokehPass (showcase only) / ShaderPass(VignetteShader)
composer.addPass(new OutputPass());                               // 5. ACES + sRGB — LAST
```

Perf notes (1080p, integrated GPU as floor):
- MSAA×4 on the composer target ≈ free-ish on desktop GPUs; if iGPU struggles, drop to
  `samples: 2` before dropping passes.
- GTAO is the most expensive pass (depth+normal prepass + AO + denoise, ~2–4 ms on iGPU).
  If it dominates, swap to N8AO half-res mode (one extra importmap line:
  `"n8ao": "https://unpkg.com/n8ao@latest/dist/N8AO.min.js"`) or disable AO on `cheap`.
- Transmission adds one extra opaque-scene render per frame (fixed cost) — acceptable for
  one creature; disabled in cheap tier by material choice.
- Keep `setPixelRatio(min(devicePixelRatio, 2))`; if frame time > 16 ms, cap at 1.5 in high
  tier — MSAA+composer at DPR 2 is the usual killer on laptops.

### D. Exactly how this plugs into `app.js` + the two-tier switch

1. **Tier global** (same pattern as `window.__skinMode`, so `render.mjs`/`gallery.mjs` can
   poke it headlessly):
   ```js
   window.__renderTier ??= 'high';        // 'high' | 'cheap'
   const TIERS = {
     high:  { composer: true,  env: true,  shadowType: THREE.VSMShadowMap,
              envMapIntensity: 0.7, contactShadow: true,  grid: false },
     cheap: { composer: false, env: false, shadowType: THREE.PCFSoftShadowMap,
              envMapIntensity: 0.0, contactShadow: false, grid: true },
   };
   ```
   Add a "Render tier" `<select>` to the *Skin & View* panel section in `index.html`
   (auto-select `cheap` when skin mode = voxel, but allow override — seeing the voxel dragon
   under the high pipeline is a legitimate comparison).
2. **One render entry point.** Replace every direct `renderer.render(scene, camera)` call —
   the `animate()` loop, `screenshotPNG()`, and the gallery cell loop in `runGallery()` —
   with a shared `renderFrame()` that does `tier.composer ? composer.render() : renderer.render(scene, camera)`.
   (`canvas.toDataURL()` / `toBlob()` keep working: the composer's final pass still writes to
   the canvas, and `preserveDrawingBuffer: true` is already set.)
3. **Resize:** extend `resize()` with `composer.setSize(w, h)` and `gtao.setSize(...)`,
   `bloom.setSize(...)` (passes with internal targets).
4. **Rebuild hook:** after `scene.add(currentDragon)` in `rebuild()`, traverse and apply
   `envMapIntensity`, `castShadow = true` / `receiveShadow = true` on meshes (body receives,
   membranes cast but shouldn't receive VSM to limit bleed), then refresh the contact shadow.
5. **Tier application:** a `applyTier()` function sets `renderer.shadowMap.type`
   (needs `renderer.shadowMap.needsUpdate = true` + material `needsUpdate` when switching),
   toggles `scene.environment`, grid/contact-shadow visibility, and triggers `rebuild()` so
   the material factories re-run with the new tier.
6. **Generator interface:** pass `tier` through the existing `env` object
   (`generateDragon(genome, age, env)`) → `env.renderTier`, and have `generator.js` /
   `features.js` / `face.js` call the new `materials.js` factories. This keeps the
   harness-generator contract documented and lets the MC/`geo.json` path stay untouched.

### E. Phased build order (each phase independently shippable)

1. **Phase 1 — Color + IBL (app.js only, ~30 lines, biggest jump).** ACES tone mapping,
   explicit `outputColorSpace`, PMREM `RoomEnvironment(renderer)`, delete fill/hemisphere,
   retune key/rim, per-material `envMapIntensity` traversal in `rebuild()`. Verify: existing
   dragons instantly get grounded speculars; markings unchanged (vertex colors are untouched
   by this phase). *Screenshot before/after for the repo.*
2. **Phase 2 — PBR materials (`materials.js` + generator/features/face refactor).**
   Physical body/belly/hard/feather/eye materials; **membrane transmission** (the hero
   change — check the wing glows when the rim light is behind it); tier-aware factory with
   cheap tier = current materials. Verify voxel mode + glTF export still work
   (GLTFExporter handles MeshPhysicalMaterial channels incl. transmission/clearcoat).
3. **Phase 3 — Shadows + AO + composer skeleton.** VSMShadowMap + radius/blurSamples,
   shadow bias tuning, contact shadow helper, EffectComposer with MSAA target +
   RenderPass + GTAOPass + OutputPass, `renderFrame()` refactor (loop, screenshot, gallery),
   resize plumbing, tier switch UI.
4. **Phase 4 — Polish.** UnrealBloomPass (subtle), blurred-env backdrop, turntable toggle,
   optional VignetteShader / BokehPass behind a "showcase" checkbox; stretch: triplanar
   procedural scale detail on the body (`onBeforeCompile`), N8AO swap-in, PCSS experiment.

### F. Risks

- **Zero-build:** every import above is `three` or `three/addons/` at the pinned 0.160.0
  (availability verified on unpkg, incl. GTAOPass/OutputPass/blur shaders). N8AO is the only
  candidate needing a new importmap entry — optional. The r160 pin means examples-code from
  newer docs may not match (`RoomEnvironment(renderer)` arg, no `scene.environmentIntensity`) —
  both handled above.
- **VSM light bleed** between overlapping thin parts (wing membranes over body). Mitigation:
  bias tuning, membranes `castShadow` only; fallback to PCFSoft is one line.
- **Perf on weak GPUs:** GTAO + MSAA + transmission + DPR 2 can exceed budget on iGPUs; the
  tier switch (and `samples: 2`, DPR 1.5) is the escape hatch. Gallery batch rendering should
  temporarily force cheap tier if thumbnails feel slow.
- **Gallery/screenshot regressions:** any missed `renderer.render` call will silently produce
  un-tone-mapped thumbnails — grep for `renderer.render(` after the refactor (the
  `frameObject` gallery loop and `screenshotPNG` are the two known sites besides `animate`).
- **glTF export:** transmission/clearcoat export via extensions
  (`KHR_materials_transmission` etc.); older viewers may render membranes opaque — cosmetic,
  not blocking.

---

## Sources

- three.js Color management manual — https://threejs.org/docs/#manual/en/introduction/Color-management
- `MeshPhysicalMaterial` docs (clearcoat, sheen, transmission, specular) — https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial and https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial.transmission
- Transmission example — https://threejs.org/examples/webgl_materials_physical_transmission.html
- Codrops: Creating transparent glass & plastic in three.js (transmission in practice) — https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/
- Subsurface scattering addon example (considered, not recommended) — https://threejs.org/examples/webgl_materials_subsurface_scattering.html
- `RoomEnvironment` r160 source (constructor takes `renderer`) — https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js
- `OutputPass` docs / r160 source (tone map + sRGB as final pass) — https://threejs.org/docs/pages/OutputPass.html , https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/OutputPass.js
- `EffectComposer` r160 source (HalfFloat default target) — https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js ; post-processing manual — https://threejs.org/docs/#manual/en/introduction/How-to-use-post-processing
- GTAO example + docs (added r160) — https://threejs.org/examples/webgl_postprocessing_gtao.html , https://threejs.org/docs/pages/GTAOPass.html
- N8AO (external AO alternative) — https://www.npmjs.com/package/n8ao , forum comparison https://discourse.threejs.org/t/new-ambient-occlusion-example-hbao-vs-n8ao/58847
- UnrealBloom example — https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html
- VSM shadows example — https://threejs.org/examples/webgl_shadowmap_vsm.html ; PCSS example — https://threejs.org/examples/webgl_shadowmap_pcss.html ; soft-shadow parameter guide — https://sbcode.net/threejs/soft-shadows/
- Contact shadow example — https://threejs.org/examples/webgl_shadow_contact.html
