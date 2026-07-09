# Resume: High-fidelity rendering upgrade (Explorer tier)
Status: IN_PROGRESS
Branch/worktree: render-upgrade (worktree .claude/worktrees/agent-ad1b7252f372e83e6)
Last commit: <this checkpoint — see `git log -1`>

## Goal
Implement research/high-fidelity-rendering.md in testbed/: ACES + sRGB, PMREM
RoomEnvironment IBL, MeshPhysicalMaterial per part (vertex-color markings +
skinning preserved), transmission wing membranes, soft + contact shadows,
EffectComposer post stack (AO/bloom/OutputPass), all behind a
`window.__renderTier` = 'high' | 'cheap' switch with a single `renderFrame()`
entry point. Zero-build (three@0.160.0 + three/addons only, no external assets).

## Done so far (Phases 1 + 2 + tier switch/renderFrame — COMPLETE & VERIFIED)
- **Color mgmt + tone mapping** (app.js): `renderer.outputColorSpace = SRGB`,
  `toneMapping = ACESFilmicToneMapping`, exposure per tier (1.05 high / 1.0 cheap).
- **IBL** (app.js): `PMREMGenerator.fromScene(new RoomEnvironment(renderer),0.04)`
  → `envTexture`; assigned to `scene.environment` in high tier only (applyTier).
  Per-material `envMapIntensity` (0.75 high / 0 cheap) applied by traversal in
  `rebuild()` + gallery cell loop (r160 has no scene.environmentIntensity).
- **Light rebalance** (app.js): `applyTier()` sets key/fill/rim/hemi intensities +
  grid visibility + exposure + env per tier. High: key 1.6, fill 0.25, rim 1.4,
  hemi 0.15, no grid. Cheap: original 2.2/0.7/0.9/0.6 + grid. Key shadow bumped to
  2048² + bias/normalBias. Shadow type still PCFSoftShadowMap (VSM is Phase 3).
- **materials.js (NEW)** — tier-aware factory. High = MeshPhysicalMaterial per part:
  body (clearcoat 0.15, vertexColors set by caller), belly, hard/spikes/scutes
  (keratin clearcoat), **membrane (transmission 0.45 base, thickness 0, ior 1.4,
  DoubleSide, transparent:false)** + `tuneMembranePanel()` maps fullness→transmission
  (baby 0.62 → adult 0.32; sail 0.42→0.24), sail (transmission 0.3), feathers
  (sheen 0.6), eyes (clearcoat 1.0 sclera+pupil), ears (transmission 0.2/0.3),
  frill (0.25), ivory/barbel/brow/mouth. Cheap tier returns the ORIGINAL
  MeshStandardMaterials unchanged.
- **Wiring**: `phenotype.renderTier` (env.renderTier ?? window.__renderTier ??
  'high') threads tier to generator.js + features.js material fns; face.js gets it
  via `createFaceRig(opts.tier)`. generator/features/face material constructors now
  delegate to materials.js.
- **Tier switch + renderFrame**: `window.__renderTier`, `TIERS` table,
  `applyTier()`, `setRenderTier()`; UI `<select id="renderTier">` in index.html
  (after skinMode so emotion stays the first `<select>` render.mjs targets).
  `renderFrame()` is the single entry point; animate loop, screenshotPNG, and the
  in-app gallery all route through it (idle/pose update still runs BEFORE it).
  `window.__testbed` now exposes renderFrame, setRenderTier, renderTier getter.

## Verified (headless, port 8144, SwiftShader)
- No console/page errors in any case.
- Body: MeshPhysicalMaterial + isSkinnedMesh + vertexColors true + 35 distinct
  marking colors (MARKINGS SURVIVED) + clearcoat 0.15 + envMapIntensity 0.75.
- Membrane (wyvern wings-open): MeshPhysicalMaterial, transmission 0.32, ior 1.4,
  DoubleSide, transparent false, isSkinnedMesh — glows/tints backlit.
- Cheap tier: MeshStandardMaterial body+wings, no scene.environment, vertexColors
  kept, grid on. Voxel mode (high): builds, MeshPhysicalMaterial body.
- Renders (compared high vs cheap) look markedly richer: tone-mapped, IBL soft
  fill, wet clearcoat eyes, translucent pink ears, keratin spikes.
- **Perf**: SwiftShader software raster ~300ms/frame (NOT representative). On real
  GPU this is real-time; high-tier overhead vs cheap = physical-BRDF + IBL lookups
  + ONE fixed extra opaque render for the transmission pass (any transmissive obj).

## Next steps (in order) — Phases 3 & 4 (post-processing + shadow polish)
1. **Soft shadows**: high tier → `renderer.shadowMap.type = VSMShadowMap`,
   `key.shadow.radius`/`blurSamples`; membranes castShadow only (limit bleed);
   PCFSoft stays cheap-tier. Needs `renderer.shadowMap.needsUpdate = true` +
   material.needsUpdate when switching type in applyTier.
2. **Contact shadow**: port webgl_shadow_contact (256² depth cam under floor +
   HorizontalBlur/VerticalBlurShader → dark plane). Refresh in rebuild() only.
3. **EffectComposer** (three/addons, all present @0.160.0): MSAA+HalfFloat target
   `{samples:4,type:HalfFloatType}`; RenderPass → GTAOPass(scene,camera,w,h) →
   UnrealBloomPass(size,0.25,0.5,0.85) → OutputPass (does ACES+sRGB LAST — see note).
   Store `composer`/`gtao`/`bloom`; extend TIERS.high.composer=true.
4. **Make renderFrame() route through composer** when `tierCfg().composer`:
   `composer.render()` else `renderer.render()`. IMPORTANT toneMapping/OutputPass
   interaction: with the composer, RenderPass writes HDR-linear into the HalfFloat
   target and OutputPass applies tone map + sRGB; keeping renderer.toneMapping set
   is what OutputPass reads. Verify no double tone-map (test a bright highlight).
5. **resize()**: add composer.setSize + gtao.setSize + bloom.setSize.
6. **gallery.mjs** (headless, line ~199) calls `t.renderer.render` directly — once
   the composer lands, switch it to `t.renderFrame()` so thumbnails are post-processed
   (currently fine since renderFrame == renderer.render).
7. Optional polish: darker rough ground disc + blurred-env backdrop
   (scene.backgroundBlurriness), turntable toggle, subtle VignetteShader; stretch:
   triplanar body detail. Re-tune exposure/bloom once post is in.
8. Re-verify all cases + `tools/grok.sh eval`; note real-GPU frame cost.

## Key files
- testbed/src/materials.js — NEW tier-aware PBR factory (all per-part materials).
- testbed/src/app.js — renderer color/tone/IBL, TIERS, applyTier, setRenderTier,
  renderFrame, envMapIntensity traversal, UI wiring, boot. **Composer goes here.**
- testbed/src/generator.js — phenotype.renderTier; body/belly/hard/membrane/ivory/
  barbel delegate to materials.js; buildMembraneMesh uses tuneMembranePanel;
  createFaceRig gets tier. (Do NOT edit generator geometry.)
- testbed/src/features.js — spike/sail/feather/scute delegate to materials.js.
- testbed/src/face.js — eye/pupil/brow/mouth/ear/frill materials + tier threaded
  through createFaceRig → makeEye/makeBrow/makeMouth/buildEars/buildFrill.
- testbed/index.html — Render tier <select> (keep AFTER skinMode; emotion must stay
  the first <select>).

## Context notes / gotchas
- Body markings = white base × vertexColors on a MeshPhysicalMaterial (caller
  clones the factory body mat, sets vertexColors=true + color white). Preserved.
- Membrane/ears/frill/sail use `transparent:false` + `opacity:1`; transmission (not
  alpha) carries translucency. They become SkinnedMesh after upgradeToSkinned —
  transmission works on skinned meshes.
- Tier flows two ways: generator/features via phenotype.renderTier; face via
  opts.tier. Both read window.__renderTier fallback so headless tools can flip it.
- Verify headlessly: serve worktree testbed on a free port (e.g. 8144) and drive
  with the MAIN checkout's tools (puppeteer lives in /Users/wundram/dragons/testbed/
  tools/node_modules — worktree has none). Symlink it in or write a temp script and
  point Chrome --url at the worktree server. SwiftShader frame times are NOT real.
- metalness stays 0 everywhere (dielectric). "Shiny" = clearcoat + IBL.
