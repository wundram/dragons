# Research: Runtime-generated & evolving entity models in a Minecraft mod

Task: how custom entity models/animations work in modern Minecraft modding, and whether we can procedurally generate and *evolve* a pet dragon's mesh at runtime from a compact genome. Target: NeoForge-lean, MC 1.21.x, ≤ ~10 evolving pets per server.

## TL;DR (5 bullets)

- **Runtime procedural entity geometry is fully feasible.** Vanilla entity models are *already built in code* (`MeshDefinition` → `LayerDefinition.bakeRoot()` → `ModelPart` tree); nothing forces a model to come from a file or to be baked only once at registration. Re-baking a genome-derived cube tree on growth ticks is microseconds of CPU for our scale.
- **The hard constraint is the primitive, not the pipeline:** vanilla `ModelPart` and GeckoLib bones are hierarchies of textured **cuboids** (plus per-axis dilation/stretch). Arbitrary smooth triangle meshes require dropping to raw `VertexConsumer` rendering — possible, but you then own lighting normals, culling, and animation/skinning yourself. A "parametric cuboid skeleton" is the safe sweet spot and matches Minecraft's aesthetic anyway.
- **GeckoLib (NeoForge/Fabric/Forge) is the best animation layer:** Bedrock-style `geo.json` bones + keyframe `animation.json` + Molang, with documented **runtime per-bone position/rotation/scale manipulation** — exactly what allometric cute→cool growth needs. Models are normally file-loaded but `GeoModel` lets us return our own programmatically built `BakedGeoModel`.
- **NeoForge lean: validated.** Both loaders can do this (the rendering classes involved are vanilla and loader-agnostic); NeoForge wins on structured registration events, data attachments for genome storage, first-class docs for the 1.21.2+ render-state pipeline, and GeckoLib parity. Fabric's only real edge (Sodium-first performance culture, faster snapshot support) doesn't matter for ≤10 entities.
- **Don't bridge via glTF.** MCglTF is stale (Forge 1.18–1.20.1). Instead make the **genome→cuboid-skeleton generator the portable artifact**: prototype it in Three.js using box-per-bone geometry, export Bedrock-format `geo.json` (GeckoLib's native format) as the interchange, then port the pure-math generator to Java. glTF stays a testbed-only render/eval format.

---

## 1. How custom entity models & animations normally work

### 1.1 Vanilla pipeline (the important surprise: models are code)

Since MC 1.17, every vanilla/modded entity model is defined **programmatically**:

1. Build a `MeshDefinition`; get its root `PartDefinition`; add named children via `PartDefinition.addOrReplaceChild(name, CubeListBuilder, PartPose)`. Each `CubeListBuilder` adds one or more **cuboids**: origin, size (x,y,z), per-cube UV offset, optional `CubeDeformation` (inflate/deflate per axis), mirroring.
2. Wrap in `LayerDefinition.create(mesh, texWidth, texHeight)`.
3. Register it under a `ModelLayerLocation` — on NeoForge in `EntityRenderersEvent.RegisterLayerDefinitions`, on Fabric via `EntityModelLayerRegistry.registerModelLayer(...)`.
4. At renderer construction, `context.bakeLayer(location)` (backed by `EntityModelSet`) bakes the definition into an immutable **`ModelPart` tree** — the runtime hierarchy with per-part `x/y/z`, `xRot/yRot/zRot`, `xScale/yScale/zScale`, `visible`.
5. The `EntityModel` subclass poses parts each frame in `setupAnim(...)`; `LivingEntityRenderer` walks the tree and emits quads into a `VertexConsumer` for the model's `RenderType`.

Blockbench is just an **editor for step 1**: its "Modded Entity" export emits exactly this Java code; its Bedrock export emits `geo.json` for GeckoLib. There is no runtime "model file" for vanilla-style entities.

**1.21.2+ change (matters for us):** entity rendering was refactored around **render states** — the renderer fills an `EntityRenderState` in `extractRenderState()` and the model only sees the state, not the entity. Our genome/age/cached-model handle must ride through a custom `EntityRenderState` subclass (NeoForge additionally offers `RegisterRenderStateModifiersEvent` with `ContextKey<T>` for attaching data to states). NeoForge also ships a JSON keyframe animation system (`assets/<ns>/neoforge/animations/entity/*.json`, baked via `AnimationHolder`/`KeyframeAnimation.apply`).

### 1.2 GeckoLib (bones + keyframe animations + Molang)

GeckoLib 4/5 is the de-facto standard for complex animated entities, supporting **Forge, Fabric, and NeoForge** from one codebase:

- Models are Bedrock-format `*.geo.json` (bones → cubes), animations are `*.animation.json` with keyframes and **Molang** expressions; both authored in Blockbench.
- Pipeline: Gson-parse → `BakedModelFactory` compiles to **`BakedGeoModel`** (tree of `GeoBone`) cached by the resource manager; `AnimationController` + `AnimationProcessor` evaluate controllers/Molang into per-bone **`BoneSnapshot`s** (position/rotation/scale) each render.
- Your `GeoModel<T>` subclass supplies `getModelResource()/getTextureResource()/getAnimationResource()` — and is the seam where a mod can **override which `BakedGeoModel` is returned** (see §2.2).
- `GeoBone` exposes runtime setters (position/rotation/**scale** per axis), so code can deform the rig every frame *on top of* keyframe animation — GeckoLib entities routinely do procedural head-tracking, breathing scale, etc.
- GeckoLib 5 (MC 1.21.5+) removed the old `DynamicGeoEntityRenderer` family in favor of **render layers** (`CustomBoneTextureGeoLayer` etc.) for per-bone texture/render-type overrides — relevant to our eye/brow sub-rig, which maps cleanly onto a GeoLayer.

### 1.3 Resource-pack CEM (not for us)

OptiFine CEM / [EMF] Entity Model Features replace *existing* entities' models from resource-pack `.jem` files. It's user-side reskinning, still cuboid-based and static per pack load — noted only as evidence that the community has pushed cuboid model swapping hard; not a mechanism for per-entity evolving geometry.

### 1.4 Prior art for "growth" in dragon mods

Ice and Fire (5 growth stages, 125 days) and Dragon Mounts–style mods implement growth as **uniform renderer scaling of one fixed model** (`PoseStack.scale` driven by an age value), sometimes with stage-swapped textures. Vanilla babies are the same trick (big head via per-part scaling). Nobody ships true shape-evolving geometry — that's our differentiator, and the reason it's absent is authoring effort, not an engine impossibility.

## 2. Can a mod build/modify entity geometry at runtime? Yes — four options

### Option A — Re-bake a vanilla `ModelPart` tree from code (baseline, zero dependencies)

`LayerDefinition.bakeRoot()` is a plain public method: build a `MeshDefinition` from `f(genome, age)` **at any time on the client** and bake a fresh `ModelPart` tree. Registration events are only the *conventional* place to do this; the bake itself is pure CPU data-structure work (no GL calls), safe off the render thread. Our renderer holds a small per-entity cache: `genomeHash + quantizedAge → bakedRoot`, rebuilt on growth ticks.

Real limits & gotchas:
- **Cuboids only.** No arbitrary triangles; curvature is faked with many small boxes or per-axis `CubeDeformation`. (This is also simply what Minecraft creatures look like — fighting it costs style coherence.)
- **UVs are per-cube box mapping** onto a fixed-size texture sheet; when a cube's dimensions change, its UV footprint changes → see §5 (texture strategy must be parametric).
- Recent versions **compile cube vertex data at bake time** (that's why baking exists), so you cannot mutate cube *dimensions* on a live `ModelPart` — you re-bake. Pose/scale per part remains freely mutable per frame (that's what `setupAnim` does).
- **Animation is yours**: `setupAnim` trig code, or vanilla's JSON keyframe system re-baked against each new root (`KeyframeAnimation` binds to part names, so name-stable topology keeps animations valid across re-bakes — important design rule).

### Option B — Programmatic GeckoLib models (recommended)

Two sub-paths:
1. **Override the model lookup**: subclass `GeoModel` and return a programmatically constructed `BakedGeoModel` (build `GeoBone`s/cubes in code, or run GeckoLib's own `BakedModelFactory` over an in-memory `geo.json`-equivalent structure generated from the genome). Cache per (genome, age-bucket) exactly as in A.
2. **Fixed topology + runtime bone deformation**: load ONE species rig (`geo.json` with all possible parts: horn sockets, wing membranes, spikes — hidden at age 0) and drive per-bone **scale/position/visibility** from `f(genome, age)` every growth tick via `GeoBone` setters. No re-bake at all; keyframe animations keep working untouched because bone names never change.

Path 2 is dramatically safer for animation (walk/fly/idle keyframes authored once in Blockbench keep working at every age); path 1 adds true structural variation. They compose: a fixed *bone topology* whose cube dimensions are re-baked (1) while animation state rides on stable bone names (2).

Gotchas: GeckoLib's loader caches baked models by `ResourceLocation` — per-entity models need unique synthetic keys or a bypass of the cache (the `GeoModel` override seam handles this); GeckoLib 5 targets MC 1.21.5+ and its renderer API changed from 4→5 (render layers replace Dynamic renderers), so pin versions early.

### Option C — Raw mesh via `VertexConsumer` (custom `EntityRenderer`)

A renderer may emit **arbitrary quads/tris** directly: `MultiBufferSource.getBuffer(RenderType.entityCutoutNoCull(texture))` then per-vertex `addVertex(pose, x,y,z).setColor(...).setUv(u,v).setOverlay(overlay).setLight(packedLight).setNormal(nx,ny,nz)`. This is how end crystal beams, leashes, and MCglTF render. It lifts the cuboid restriction entirely — we could replay a genome-generated triangle mesh (marching cubes, loft surfaces, wing membranes as soft quads strips).

Real limits & gotchas (this is where the dragons hide):
- **Lighting**: you must supply correct **normals** (diffuse shading) and the packed **light/overlay** ints per vertex; get normals wrong and growth deformations shade visibly wrong.
- **Skinning/animation is 100% yours** — no bones unless you implement them (per-vertex weights or rigid-part decomposition). Easiest viable form: keep a bone hierarchy, rigid mesh chunk per bone (which converges back toward Option A/B).
- **Culling & shadows**: entity visibility culling uses the entity's culling AABB (`EntityRenderer.shouldRender` / cull-box inflation must track grown size or wings pop out of view at screen edges); shadows are just the blob (`shadowRadius`) — set it from age, done.
- **Future-proofing**: Fabric's docs warn that raw legacy GL is dead and "will break even further when Minecraft 26.2 releases with a Vulkan backend"; the `VertexConsumer`/`RenderType` abstraction is the supported path and the 1.21.6+ render-state/prepare phases keep reorganizing this area. Direct-mesh code carries real per-MC-version maintenance cost.

### Option D — Cached/baked mesh replay

Not really separate: whatever generates geometry (A/B/C), bake once per growth tick into a retained vertex list (or the baked `ModelPart`/`BakedGeoModel`, which *are* compiled vertex data in modern versions) and replay per frame. This is the required shape of the solution per our feasibility guardrails, and it's also just how vanilla works now.

**Hitboxes (all options):** collision/hit detection is server-side and **AABB-only** — `EntityDimensions` via `Entity.getDimensions(Pose)`, updated with `refreshDimensions()` on growth ticks (vanilla slimes/frogs do exactly this). Visual mesh and hitbox are independent; we just keep the AABB tracking overall body size. Name-plate height follows dimensions too.

## 3. NeoForge vs Fabric for this specific need

The core insight: **almost everything above is vanilla client code** (`ModelPart`, `LayerDefinition`, `VertexConsumer`, `RenderType`, `DynamicTexture`, `SynchedEntityData`) — identical on both loaders. The loaders differ in registration plumbing and ancillary APIs:

| Concern | NeoForge | Fabric |
|---|---|---|
| Renderer/layer registration | `EntityRenderersEvent.RegisterRenderers` / `RegisterLayerDefinitions` events | `EntityRendererRegistry` / `EntityModelLayerRegistry` callbacks |
| Render-state extension | `RegisterRenderStateModifiersEvent` + `ContextKey<T>` (first-class) | Subclass render state / mixin |
| Entity keyframe animation JSON | Built-in (`neoforge/animations/entity/*.json`) | Vanilla code paths only |
| Genome persistence | **Data attachments** (built-in) or plain NBT | NBT or Cardinal Components (3rd-party) |
| Networking (genome/growth sync) | Payload registration API | Fabric Networking API — equivalent |
| GeckoLib | Supported | Supported |
| Docs for 1.21.x entity rendering | docs.neoforged.net entity/renderer pages are current and detailed | docs.fabricmc.net strong on low-level rendering concepts |
| Ecosystem culture | Big-content mods (our genre) | Performance/client mods (Sodium); snapshot ports land faster |

Sodium compatibility (a Fabric-culture concern) is a non-issue here: entity rendering through `MultiBufferSource`/`VertexConsumer` is untouched by Sodium's chunk-terrain pipeline.

**Verdict: the NeoForge lean stands.** Nothing in Fabric makes runtime geometry easier — the mechanism is vanilla either way — while NeoForge gives us data attachments for genome storage, structured events, built-in animation JSON as a fallback tier, and the modpack ecosystem where a content mod like ours lives. If we ever want dual-loader, keep the generator in a loader-free Java module (pure math + a thin `MeshDefinition`/`BakedGeoModel` emitter) so only the ~10% registration shell is per-loader (Architectury or a multiloader template later, not now).

## 4. Performance & feasibility for ≤10 evolving pets

- **Bake cost**: a dragon rig is realistically 30–120 cuboids. Building a `MeshDefinition` and baking is allocation-light object work — well under a millisecond; even 10 dragons re-baking on the *same* tick is negligible. Growth ticks are seconds-to-minutes apart, render frames never regenerate geometry.
- **Memory**: a baked cuboid model is a few KB–tens of KB of vertex data. 10 pets × (current + previous for crossfade) is trivially small. Evict cache entries when entities unload.
- **Cache key**: `hash(genome) + quantize(age)` (e.g. 64–256 age buckets over the full arc). Quantizing also guarantees identical results across clients and after reload — determinism is a correctness feature, not just a perf one.
- **Smooth growth without per-frame re-bake**: re-bake per bucket, then lerp *per-part scale/position* (freely mutable per frame) between buckets — visually continuous growth at re-bake-per-minutes cost.
- **LOD**: optional and easy — beyond N blocks render the nearest cached *stage* model or a fixed silhouette model; with ≤10 pets this is polish, not necessity.
- **Genome storage & sync (the architecture that keeps all this cheap):**
  - Genome = compact trait vector (e.g. 16–64 bytes). Server-authoritative.
  - **Save**: entity NBT (`addAdditionalSaveData`) or NeoForge data attachments. Egg items carry the genome as a **data component** (1.20.5+ item data system) for breeding hand-off.
  - **Sync**: `SynchedEntityData` with a custom `EntityDataSerializer<byte[]>` (register the serializer; entity-data is auto-synced and delta-tracked to tracking clients only) — genome + a synced `age`/`growthStage` int. Alternatively a custom payload on tame/track events; entity-data is simpler and handles late-joining trackers for free.
  - **Client** expands genome+age → mesh via the deterministic generator. Meshes are never serialized or sent — exactly per our guardrails.
  - **Breeding** is pure server logic on two genomes → egg component; zero rendering involvement.

## 5. Textures for procedural models

Three workable strategies, in order of preference:

1. **Shared parametric atlas (start here).** One (or a few per species/element) hand-or-grok-authored texture sheets with *regions* (belly, scale field, membrane, horn, eye whites). The generator assigns each cube UVs into the appropriate region, scaling/tiling within it. Zero runtime texture cost, batches perfectly, works identically in vanilla and GeckoLib pipelines. Cost: cubes that change size sample more/less of a region — design regions as tileable/gradient fields so that reads as growth, not stretching.
2. **Per-dragon `DynamicTexture`.** Client builds a `NativeImage` from genome (base color, markings emerging with age — cute→cool color shift), uploads via `TextureManager.register(id, new DynamicTexture(image))`, re-uploads on growth ticks. 10 dragons × 256² RGBA = ~2.5 MB VRAM — fine. Each unique texture is a separate draw batch: irrelevant at 10 entities. This is a proven pattern (map items, skins, DynamicAssetGenerator mod). Best combined with 1: dynamic texture generated *by compositing the shared atlas* with genome tint/markings.
3. **Vertex tint only.** `setColor` per vertex / render-layer tinting over a grayscale atlas — cheapest color-variation path; GeckoLib render layers and `RenderType.entityTranslucent` handle this today. Insufficient alone for markings, great as the day-one color system.

Recommended sequence: 1+3 first, add 2 when markings/pattern genes land.

## 6. Bridging from our Three.js/glTF testbed

- **glTF import into Minecraft: don't.** MCglTF (and the CustomglTF fork) prove it's *possible* to replay glTF via `VertexConsumer`, but the maintained versions stop at Forge 1.19/1.20.1 — no NeoForge 1.21.x path — and a general triangle-mesh dragon would fight the game's cuboid aesthetic, its lighting model, and every future render-pipeline change (Vulkan backend incoming per Fabric docs). We'd inherit Option C's full gotcha list permanently.
- **The generator, not the mesh, is the portable artifact.** Constrain the testbed generator to what ports losslessly: a **bone hierarchy of boxes** (Three.js `BoxGeometry` per bone/cube, parented transforms, per-axis scale). Then "porting" = re-implementing pure math (`genome × age → list of {bone, parent, pivot, rotation, cubes[origin,size,uv]}`) in a dependency-free Java module. This structure is *isomorphic to Bedrock `geo.json`* — GeckoLib's native format and Blockbench's native format.
- **Make Bedrock `geo.json` the interchange format**: testbed exports its skeleton as `geo.json` → open in Blockbench to inspect/tweak → load in GeckoLib directly. This gives a round-trippable pipeline (testbed ↔ Blockbench ↔ mod) with zero custom importers. Keep glTF export in the testbed solely for pretty renders and grok-vision evaluation.
- The eye/brow sub-rig ports as a reserved bone group in the same skeleton plus a GeckoLib render layer (per-bone texture swap — `CustomBoneTextureGeoLayer` pattern) for pupil/brow states.

## Recommendation for our project

**Loader: NeoForge — confirmed.** The runtime-geometry mechanism is vanilla and loader-neutral; NeoForge adds data attachments (genome), structured registration events, current entity-renderer docs, an extra built-in animation tier, and the right ecosystem for a content mod. Keep the generator in a loader-free Java module as cheap insurance.

**Feasibility verdict: runtime evolving meshes are realistic — LOW technical risk at our scale**, *provided* we stay cuboid-skeleton-based. Rebuilding a 30–120-cube model on growth ticks for ≤10 pets is sub-millisecond CPU and kilobytes of memory; every required mechanism (`bakeRoot()` re-baking, GeckoLib bone manipulation, `DynamicTexture`, `SynchedEntityData` genome sync, `refreshDimensions()` hitboxes) is a supported, documented pattern. The genuinely risky path — arbitrary triangle meshes via raw `VertexConsumer` — is unnecessary and should be avoided.

**Safest architecture (recommended):**
1. **Representation**: genome = compact trait vector; deterministic pure function `f(genome, age) → cuboid-skeleton spec` (bones stable in name/topology; cubes vary in size/offset; parts appear at growth thresholds by unhiding/inflating pre-declared bones — horns, spikes, membranes).
2. **Server**: genome in NBT/data attachment; age advanced by growth ticks; `refreshDimensions()` on stage change; breeding combines genomes into an egg data component. No mesh code server-side, ever.
3. **Sync**: genome + age via `SynchedEntityData` (custom byte-array serializer); clients re-expand locally.
4. **Client rendering**: **GeckoLib entity** with a custom `GeoModel` returning a cached, programmatically baked `BakedGeoModel` per (genome, age-bucket); per-frame smoothing via per-bone scale/position lerp between buckets; keyframe walk/fly/idle animations authored in Blockbench against the stable bone names; eyes/brows as a GeckoLib render layer. Fallback tier if GeckoLib churn bites: the identical generator emitting vanilla `MeshDefinition` + `setupAnim` (we lose Molang/keyframes, not the geometry).
5. **Textures**: shared parametric atlas + vertex/layer tinting first; per-dragon `DynamicTexture` compositing when marking genes land.
6. **Testbed contract**: Three.js generator restricted to box-per-bone skeletons; export **Bedrock `geo.json`** as the bridge format (Blockbench- and GeckoLib-readable); glTF only for evaluation renders.

Suggested de-risk spike once modding starts: a 1-week NeoForge prototype — one hardcoded genome, re-bake on a 10-second growth tick, age-scaled hitbox, one GeckoLib walk animation surviving re-bakes. That exercises every risky seam (GeckoLib model-cache bypass, render-state plumbing, animation-over-rebake) before the generator port.

## Sources

- NeoForge docs — Entity Renderers (render states 1.21.2+, `LayerDefinition`/`MeshDefinition`/`bakeLayer`, render layers, animation JSON): https://docs.neoforged.net/docs/entities/renderer/
- Fabric docs — Creating Your First Entity (model layers, renderer registration): https://docs.fabricmc.net/develop/entities/first-entity and Fabric wiki entity tutorial: https://wiki.fabricmc.net/tutorial:entity
- Fabric docs — Basic Rendering Concepts (`VertexConsumer`/`BufferBuilder`, render-state phases 1.21.6+, no-legacy-GL / Vulkan-backend warning for MC 26.2): https://docs.fabricmc.net/develop/rendering/basic-concepts
- GeckoLib GitHub + wiki (geo.json pipeline, `GeoModel`, examples incl. dynamic-bone entities): https://github.com/bernie-g/geckolib/wiki/Examples-(Geckolib-4) · GeckoLib 5 changes (dynamic renderers → render layers, `CustomBoneTextureGeoLayer`): https://github.com/bernie-g/geckolib/wiki/Geckolib-5-Changes · new wiki: https://wiki.geckolib.com/
- GeckoLib architecture deep-dive (BakedGeoModel/GeoBone/BoneSnapshot/Molang pipeline, tri-loader support): https://deepwiki.com/bernie-g/geckolib
- GeckoLib NeoForge releases (version/loader matrix): https://modrinth.com/mod/geckolib/version/xji1VqGU
- MCglTF — glTF loader library for Minecraft (original, Forge ≤1.19): https://github.com/TimLee9024/MCglTF · maintained fork: https://github.com/ModularMods/MCglTF · CustomglTF 1.20.1 port: https://www.curseforge.com/minecraft/mc-mods/custommcgltf
- Minecraft Wiki — Dynamic textures (runtime-generated textures): https://minecraft.wiki/w/Dynamic_textures · `NativeImageBackedTexture`/`DynamicTexture` javadoc: https://maven.fabricmc.net/docs/yarn-1.21.11+build.1/net/minecraft/client/texture/NativeImageBackedTexture.html
- DynamicAssetGenerator — runtime asset/texture generation mod (prior art): https://github.com/lukebemishprojects/DynamicAssetGenerator
- [EMF] Entity Model Features — CEM replacement, cuboid model swapping prior art: https://modrinth.com/mod/entity-model-features · CEM: https://www.curseforge.com/minecraft/mc-mods/custom-entity-models-cem
- Ice and Fire wiki — dragon growth stages (uniform-scale prior art): https://ice-and-fire-mod.fandom.com/wiki/Dragons
- NeoForge vs Fabric comparisons (ecosystem/API framing): https://foundry.archreon.com/blog/fabric-vs-neoforge-guide · https://wisehosting.com/blog/fabric-vs-forge
