# FORGE_CPP_MIGRATION.md — Pillar #10: pure-C++ desktop migration

**Status:** decision doc / phased plan. **Authority:** `sacrosanct.md` ADDENDUM (2026-07-16,
lines 1131–1167) — "the entire Forge desktop application must be built on a **pure C++
framework** … all three platforms … maximum performance, extremely low latency … no
Electron/Node/web-frontend runtime … direct in-process linkage to the native OCCT kernel …
interface REIMPLEMENTED as Forge's own IP — modern, not a clone."

This supersedes the Electron/React/Vite desktop stack. It does **not** touch the kernel's
geometry code, the model fleet, corpora, or the `:8080` serve contract — the migration is
entirely the **presentation + bridge** layer.

---

## 0. What exists today (surveyed, not assumed)

The current desktop app is **Electron (Chromium + Node) + React 19 + Vite +
react-three-fiber (three.js / WebGL2)**. The engineering value sits *below* that JS layer,
already in C++:

| Layer | Today | Evidence |
|---|---|---|
| **Geometry kernel** | Native C++, OCCT 7.9.3-backed, 428 `.cpp`. Already builds as `add_library(forge_kernel SHARED …)`, links 24 OCCT dylibs. Clean C++ API (`forge::makeBox`) **and** a C API (`forge_capi.h`). | `forge-kernel/CMakeLists.txt:136`; `include/forge/Primitives.hpp`; `include/forge/capi/forge_capi.h` |
| **Bridge (to be killed)** | `binding*.cpp` = N-API wrapper, **2078 `exports.Set`**; compiled into `forge-kernel.node` (7.7 MB). `preload.js` re-exposes **302 `kernel.*` methods** over `contextBridge`. | `forge-kernel/src/binding.cpp`; `electron/preload.js` |
| **Tessellation** | `forge::tessellate → Mesh{ vector<float> positions/normals; vector<uint32> indices; vector<uint32> faceIds }`. Async worker pool already exists. | `include/forge/Tessellate.hpp` |
| **CUA runner** | `ai/ForgeRunner.js` — HTTP client to `:8080`, parses `<tool_call>`, routes adapter `archie-14b-v3`. | `ai/ForgeRunner.js` |
| **Tool dispatch** | `ai/ForgeToolBridge.js` (4324 LOC) — maps `tool_call.name` → `window.forge.*` kernel calls. | `ai/ForgeToolBridge.js` |
| **Vision/CUA feedback** | `ai/VisionPerception.js` — `canvas.toBlob` → `:8081` Qwen2.5-VL caption → `<viewport_state>` prepended to next turn. | `ai/VisionPerception.js` |
| **Shell (4-zone)** | `forge-v4/ForgeShellV4.jsx` (3657 LOC) — **677 menu-action case handlers**. Viewport (left/center), feature-tree (React state), `StatusBar.jsx` (bottom). | `forge-v4/ForgeShellV4.jsx` |
| **Viewport renderer** | `forge-v4/Viewport.jsx` (1264 LOC) — r3f/three; **octree frustum culling, LOD scheduler, GPU instancing, AIS pick, camera-fit-to-bounds** all already implemented. | `forge-v4/Viewport.jsx` |
| **UX blueprint (already built)** | `ActionWheel.jsx` (radial pie menu), modal sketch, rollback, `Menus.jsx` (`MENU_SPEC` data table), `HierarchicalToolsMenu.jsx`. | `forge-v4/*.jsx` |
| **UI breadth** | **163 `*Workbench.jsx` + 120 panels**, `forge-v4/` total **240,798 LOC** JS/JSX. | `frontend/src/forge-v4/` |
| **e2e** | 160 `push-*.spec.js` + `e2e/forge/*` Playwright **HEADED Electron on the built dist**; canonical CUA capture = `demo-forge-cua-genuine.spec.js`; relies on `window.__forge*` hooks (`__forgePartBox`, `__forgeBodies`, `__forgeFitToBounds`), **not** DOM clicking. | `e2e/` |

**Load-bearing consequence:** the kernel is *already* the standalone C++ product; the `.node`
addon is the only thing making it a "library for a JS app." Killing the bridge is a
**relink**, not a rewrite. The cost is rebuilding the 240k-LOC presentation layer — and that
layer is ~80% data-driven calculator forms, not bespoke code.

**Today's latency tax (the thing the ADDENDUM targets):** every model-built body crosses
`.node` → JS typed arrays → `three.BufferGeometry` upload; every frame the r3f reconciler
walks a React tree; the 3D scene lives in a WebGL context that cannot co-composite with the
DOM UI without a copy. Native removes all three.

---

## 1. Framework decision (decision-forcing)

### 1.1 Renderer — **one Vulkan 1.3 backend for all three OSes, via MoltenVK on macOS**

**Decision:** a single Vulkan renderer, run natively on Windows/Linux and through **MoltenVK**
on macOS. Wrap it in a thin ~15-call **RHI** (Render Hardware Interface) so a native-Metal or
D3D12 backend can be slotted in later *only if* profiling proves the translation layer is the
bottleneck (it will not be — see rationale).

**Rationale:**
- The ADDENDUM explicitly authorizes "Vulkan cross-platform via MoltenVK on macOS." Taking it
  gives **one renderer codebase**, not three (Metal + D3D12 + Vulkan) — directly serving the
  "single shared C++ codebase" requirement.
- MoltenVK is production-grade: Vulkan 1.3 (May 2025), **Vulkan 1.4 (Aug 2025)**, ships in the
  Vulkan SDK, "direct mapping … maximally performant," and is what real shipping Mac titles use
  atop Metal. Its handful of non-compliant edges are irrelevant to CAD (no sparse-residency /
  exotic subpass tricks in a B-rep viewer).
- **For CAD the renderer bottleneck is draw-call batching + tessellation upload, not API
  translation.** The win comes from GPU instancing + indirect draw + **zero-copy tessellation**
  (kernel writes `Mesh.positions/indices` straight into a mapped Vulkan buffer — the
  `std::vector<float>` layout in `Tessellate.hpp` is already `memcpy`-ready), not from choosing
  Metal over Vulkan. MoltenVK overhead is sub-millisecond and off the hot path.
- Windowing/surface + swapchain glue via **GLFW 3.4** (zlib license) or SDL3 — one thin,
  permissive, cross-platform layer. This is unavoidable native glue, isolated behind the RHI.

**Rejected:** three hand-written native backends (Metal/D3D12/Vulkan) up front — triples the
renderer surface for a latency delta that does not exist for this workload; violates
"single shared codebase / platform code isolated to thin backends."

### 1.2 UI — **Forge's own immediate-mode design system on the Vulkan renderer (Dear ImGui as the layout/input engine, 100% custom-skinned) + thin native-OS glue. NOT Qt.**

**Decision:** build Forge's bespoke UI as an **immediate-mode layer composited in the same
Vulkan command buffer as the 3D scene**, using **Dear ImGui purely as the foundation**
(layout, input, hit-testing, text) with a **completely custom Forge widget set and draw
callbacks** — nothing ships that reads as "default ImGui." Heavy OS-integration surfaces
(native file/print dialogs, the macOS menubar, clipboard, drag-drop, IME) call **thin native
OS APIs directly**, not a UI toolkit.

**Rationale — this is the crux, so it is argued explicitly:**

1. **The ADDENDUM forbids exactly what Qt would give us:** "Do NOT ship stock Qt widgets, nor a
   copy of the dated NX/CATIA/Creo chrome … Build Forge's own bespoke, contemporary design
   language." An immediate-mode layer where *we own every pixel of every widget's draw* is the
   shortest path to a proprietary look. Qt Widgets pushes you toward stock chrome; re-skinning
   QWidgets/QSS to a genuinely bespoke language is slow and always looks "restyled-Qt."
2. **Latency (the whole point).** ImGui emits draw lists into the **same frame** as the CAD
   scene → UI and 3D co-composite with zero context switches and can freely blend (translucent
   HUDs over geometry, the modal sketch dimming the scene, the radial pie over the part). Qt
   over `QRhi`/`QQuickFramebufferObject` puts the scene in a separate context or an FBO that is
   copied/composited every frame — more latency, more friction, the opposite of "no stutter."
3. **Business-model / licensing fit.** Per memory `business-model-free-not-oss`, Forge is
   *free to use, not open source / not modifiable*. **Dear ImGui (MIT) + GLFW (zlib) +
   Forge's own code = a fully proprietary, statically-linkable binary with no viral or
   attribution-in-UI obligations.** Qt LGPLv3 permits proprietary apps only via **dynamic
   linking** and forces "prominent notice that the software uses Qt under LGPL-3.0 … in the
   user interface" + a relink path — friction we do not need, on a component we are told not to
   let define the look.
4. **A CAD app is a retained *document* with a re-emitted *view* — immediate mode's known
   weakness doesn't bite.** The feature tree, bodies, selection, and parametric history live in
   C++ state (they already do — `ShapeRegistry`, ref-counted BREPs per BRAND.md); each frame
   the UI is regenerated from that state. This is exactly how pro DCC/engine tooling works. The
   "immediate mode is awkward for retained UIs" caveat applies to apps that want persistent
   *widget objects* — we want a bespoke design language, which immediate mode makes *easier* to
   fully control. Where a light retained convenience helps (dockable panel layout persistence),
   add a thin ID→layout store over ImGui; do not import a toolkit for it.
5. **The proven UX behaviors already exist** in JS and are behavior specs to port, not
   research: `ActionWheel.jsx` (radial pie), modal sketch, rollback scrubber, feature-tree DNA,
   4-zone workspace. Reimplementing them as immediate-mode draws is mechanical.

**The one condition that flips this to Qt Quick/QML:** if enterprise procurement hard-requires
certified accessibility (screen-reader/AT trees), rich-text document editing, printing
pipelines, or 20-language i18n *inside the app chrome* on day one. Those are Qt's free wins and
ImGui's genuine weak spots. Mitigation that keeps us on ImGui: route text-heavy modal dialogs,
file/print dialogs, and a11y-critical surfaces to **native OS controls** (NSOpenPanel /
IFileDialog / GTK portal; native menubar), which also raises platform-native feel. If that
mitigation stops scaling, adopt **Qt Quick** (GPU scene-graph, fully custom look via QML — not
Qt Widgets) for the chrome and keep the ImGui+Vulkan viewport embedded. We design the RHI +
UI boundary so this swap touches only the shell, never the renderer or kernel.

### 1.3 Kernel linkage — **direct in-process C++, drop the `.node` boundary**

**Decision:** the native app links `forge_kernel` (the existing `SHARED` target) directly and
calls the **C++ API** (`forge::*`) or the **C API** (`forge_capi.h`) in-process. `binding*.cpp`
(N-API) is **not compiled into the app**; it may stay in-tree for a frozen legacy web build
(§4). Geometry handles (`ShapeHandle` = `uint32`) already fit this model unchanged.

**Rationale:** `binding.cpp` is a pure wrapper over `forge::` (verified: `Primitives.hpp`
declares `forge::makeBox(dx,dy,dz)`; the binding just marshals a JS number in and a handle
out). Removing it deletes 2078 marshalling sites and one serialization boundary. `Mesh` is
plain `std::vector`s → **the tessellator can write directly into a mapped Vulkan vertex/index
arena** (the zero-copy path the ADDENDUM's "geometry and rendering share memory" clause asks
for). This is the single largest latency win and it is essentially free given the current API
shape.

### 1.4 One-line summary

> **Native Vulkan (MoltenVK on macOS) renderer + Forge-owned Dear-ImGui-foundation UI + direct
> in-process `forge_kernel` C++ linkage + thin native-OS glue.** No Electron, no Node, no Qt,
> no `.node` bridge. One codebase; per-OS code confined to windowing, GPU surface, and file/menu
> dialogs.

---

## 2. Phased plan

Each phase ships a runnable binary and keeps the **frame-capture → ffmpeg → multi-cam mp4**
demo pipeline alive (renderer-agnostic; see §3.3).

### Phase 0 — scaffold / "hello, no bridge" (proof spike)
- New CMake target `forge_app` linking `forge_kernel` directly; build with the node addon
  **off** for the app (kernel still builds `.node` separately for legacy).
- GLFW window + Vulkan instance/device/swapchain; **MoltenVK validated on macOS, native Vulkan
  on Linux/Windows.**
- Render one triangle **and** one `forge::makeBox` → `forge::tessellate` mesh in the same frame.
- **Exit:** identical binary path builds & runs on all three OSes; a kernel-built solid appears
  with zero JS in the process. Proves in-process kernel + Vulkan + MoltenVK.

### Phase 1 — the latency win: renderer + viewport + kernel linkage *(primary deliverable)*
Scope (detailed in §2.1 below). **Exit criteria:**
- Load a **10k-body assembly**, orbit at a locked frame rate with sub-frame input latency.
- **Zero-copy tessellation** demonstrated (kernel writes into mapped Vulkan buffers; no host
  copy on the hot path).
- Face pick works (`Mesh.faceIds` → BREP face), matching today's AIS behavior.
- Digit view-keys + fit-to-bounds (`__forgeFitToBounds` behavior) reproduced.
- Offscreen multi-cam capture harness renders 5 named angles → mp4 (parity with
  `demo-forge-cua-genuine.spec.js` outputs), higher fidelity than `canvas.toDataURL`.

### Phase 2 — bespoke UI IP foundation
- Forge design system (typography/spacing/color per `BRAND.md` monochrome, zero chromatic
  accent) as a custom ImGui skin + Forge widget set.
- The **4-zone workspace**; feature-tree DNA rail; `StatusBar` (cursor X/Y/Z + snap toggles);
  top command area; **ActionWheel radial pie**; modal sketch sandbox (interface lock-down +
  plane highlight + view-flatten); **rollback/time-travel scrubber**; keyboard chaining.
- Port `MENU_SPEC` + `HierarchicalToolsMenu` **as data** (the 677 action ids are IP; the JSON/
  struct tree ports verbatim) and wire each action id to a kernel call.
- Native-OS glue: file/print dialogs, macOS menubar, clipboard, drag-drop.
- **Exit:** a user can drive a full sketch→extrude→hole→fillet→rollback edit entirely in the
  native UI; the look is unmistakably Forge, not Qt/NX.

### Phase 3 — Archie CUA + workbenches + dashboards
- Port `ForgeRunner` (the `:8080` client, `<tool_call>` parser, adapter routing, system-prompt
  grammar) and `ForgeToolBridge`'s name→kernel dispatch to **C++** (a `libcurl`/tiny-HTTP client
  + a regex + a dispatch table over ~300 ids — 4324 LOC of JS collapses to a table since the
  targets are now direct `forge::` calls). App stays single-process, no Node.
- Native command bar (an ImGui text input) = the CUA entry point; `VisionPerception` screenshots
  the **native window** (trivially — it's a real OS window) → `:8081` → `<viewport_state>`.
- Stand up the **native control/introspection socket** (§3.3) that replaces `window.__forge*`.
- Progressively port the 163 workbenches / 120 panels — **most are calculator forms**; generate
  their UI from a schema (one immediate-mode form renderer + N data descriptors) rather than
  hand-porting 283 files.
- **Exit:** the model types a prompt into the native bar and builds a part end-to-end
  (genuine-CUA parity); ≥ the demo set of workbenches present.

### Phase 4 — platform hardening
- Per-OS packaging/installers/signing/auto-update; hi-DPI + multi-monitor; profiling.
- Decide, *from data*, whether a native-Metal/D3D12 RHI backend is worth adding (only if
  MoltenVK/Vulkan profiling flags it — expected: no).

---

### 2.1 Phase-1 detailed scope (the primary deliverable)

1. **RHI over Vulkan** (~15 calls: device/swapchain, buffer, texture, pipeline, command,
   present) + GLFW windowing; MoltenVK on macOS.
2. **Scene renderer:** GPU **instancing + indirect draw** for large assemblies; MSAA; depth
   pre-pass; **PBR + IBL/HDRI** (port `forgeFlagshipRender.js` `setupPhotoreal`: ACES tonemap,
   studio env) so the real-time canvas *is* the render, as today.
3. **Zero-copy tessellation:** persistent mapped vertex/index arena; `forge::tessellateAsync`
   worker pool writes `Mesh` straight in; per-body sub-allocation + free-list.
4. **Port the viewport algorithms (these are the IP, not the JSX):** octree frustum culling,
   LOD scheduler (re-tessellate on level crossing via `tessellateAsync`), per-instance
   zero-scale cull, **AIS pick** via `Mesh.faceIds` (GPU color-id target or CPU BVH ray).
5. **Camera:** orbit/pan/zoom; digit view presets (1 iso … 7 left); **fit-to-world-bounds**
   (`__forgePartBox`/`__forgeFitToBounds` behavior).
6. **Direct kernel API:** app calls `forge::` / `forge_capi.h`; `binding*.cpp` excluded from
   `forge_app`.
7. **Offscreen multi-cam capture** → PNG frames → ffmpeg mp4 (the demo/e2e evidence pipeline).

---

## 3. Archie-CUA + headless e2e on a native GUI

### 3.1 The CUA principle is unchanged
Today "CUA" is **console-CUA**: the model types a prompt into the Archie command bar;
`ForgeShellV4.runArchie → ForgeRunner → :8080` streams `<tool_call>`s; `onTrace` dispatches each
via `ForgeToolBridge` → kernel; bodies surface in the viewport. Natively this is *identical* in
shape — the command bar is an ImGui input, the runner + dispatch are C++, the kernel is
in-process. **The `:8080` serve contract, adapters, and system-prompt grammar do not change.**

### 3.2 Genuine pixel-level CUA gets *easier*
The ADDENDUM's north-star ("computer-use works on any native window") is simpler natively than
in Chromium: screenshot the real OS window, inject synthetic mouse/keyboard at the OS level, and
`VisionPerception` already captures a window image → `:8081` Qwen2.5-VL → `<viewport_state>`. No
canvas/DOM indirection.

### 3.3 Headless / headed e2e — the real adaptation
Playwright drives Electron's **DOM**; a custom-rendered ImGui window has **no DOM / no
accessibility tree**, so DOM selectors die. But the current CUA demos **already don't click the
DOM** — they drive `window.__forge*` hooks and assert on outcomes. So:

- **Promote `window.__forge*` to a first-class native control/introspection socket.** Expose a
  small local RPC (unix socket / loopback) with: `typeIntoCommandBar(text)`, `pressEnter()`,
  `invokeAction(id)`, `screenshotWindow()`, `getFeatureTree()`, `getBodies()`, `getPartBox()`,
  `setCamera(view)`, `fitToBounds()`. These mirror the exact hooks the specs use today
  (`__forgePartBox`, `__forgeBodies`, `__forgeFitToBounds`, digit keys).
- **Keep the harness structure:** a thin test runner (Node/Playwright *as a process driver*, or
  a C++/Python runner) launches `forge_app` **headed**, talks the control socket, watches the
  scene grow, captures frames, ffmpeg → multi-cam mp4. `demo-forge-cua-genuine.spec.js`'s
  logic (type prompt → do nothing → watch model build → assert body count > 0 → multi-cam)
  survives almost verbatim against the socket instead of the page.
- **Headed + multi-cam mandate preserved** (memory: Forge e2e are headed, ≥5 cam angles):
  the native offscreen renderer produces the 5 named angles at higher fidelity than
  `toDataURL`.
- **Determinism:** the socket also enables a deterministic mode (replay a cached `scope_plan`
  through the C++ dispatch, no model) — the model-free CI path the version-loop memory relies
  on.

---

## 4. Risks + what to preserve

### 4.1 Risks & mitigations
| Risk | Mitigation |
|---|---|
| **Rebuilding 240k LOC of UI** is the schedule risk. | ~80% is data-driven calculator forms → one schema-driven form renderer + N descriptors, not 283 hand-ports. Phase so kernel+viewport (the value + the demo) land first; breadth fills in Phase 3. |
| **MoltenVK non-compliance edges.** | RHI abstraction + runtime feature caps; native-Metal backend kept as an escape hatch (never expected to be needed for B-rep rendering). |
| **Loss of DOM/Playwright e2e.** | Native control/introspection socket (§3.3); the frame-capture/ffmpeg/multi-cam harness is renderer-agnostic and survives. |
| **Loss of the web/Vercel demo** (app becomes desktop-only). | Aligned with business model (free desktop app). If a web preview is still wanted, **freeze the current Electron/React build as a read-only web demo** while native becomes the product; the `.node` bindings stay in-tree for it. |
| **Team velocity** — the codebase muscle memory is React/JS; Vulkan/C++/ImGui is a different skill. | Phase 0 spike de-risks the stack before committing; keep the RHI + UI boundary clean so most feature work is "add a form + wire an action id," not graphics code. |
| **ImGui a11y / rich-text / i18n gaps.** | Route those surfaces to native OS controls (§1.2); named flip-condition to Qt Quick if that stops scaling. |
| **Regressing the 677-action taxonomy or kernel op surface.** | Both are *data/relinks*, not rewrites — port `MENU_SPEC` verbatim; link `forge_kernel` unchanged. |

### 4.2 Preserve (the crown jewels — mostly below the JS line)
1. **The entire native kernel** — 428 `.cpp`, OCCT + native BREP, 302 ops. Untouched; only the
   binding layer is dropped from the app build.
2. **The 677-action menu/tool taxonomy + tool ids** (`MENU_SPEC`, `HierarchicalToolsMenu`,
   `forge:menu-action` ids) — the information architecture is IP; port as data.
3. **The tool-dispatch mapping** (`ForgeToolBridge` name→op) — port to a C++ dispatch table.
4. **The CUA protocol** — `ForgeRunner` system prompt, `<tool_call>` grammar, `:8080` contract,
   adapter routing (`archie-14b-v3`).
5. **The viewport algorithms** — octree culling, LOD scheduler, instancing, AIS `faceId` pick,
   camera-fit, `setupPhotoreal` HDRI/ACES.
6. **The e2e introspection hooks** (`window.__forge*`) — reimplement as the native control
   socket; keep the multi-cam capture harness.
7. **Proven UX behaviors** — ActionWheel radial pie, modal sketch, rollback, feature-tree DNA,
   4-zone workspace (behavior specs, reimplemented in the bespoke layer).
8. **Model fleet, adapters, corpora, serve scripts** — unchanged; migration is client-side only.

### 4.3 Discard
240k LOC of JSX presentation (`ForgeShellV4`, `Viewport`, 163 `*Workbench.jsx`, 120 panels);
three.js / react-three-fiber / drei; `manifold-3d` (JS) + `opencascade.js` (WASM fallback);
Electron `main.js`/`preload.js`/`pdmVault.js` (Node → native OS glue + C++ PDM). The pure-*math*
`.js` helpers (`autoDimMath`, `bendDeduction`, `catmullClark`, …) are ported to C++ or folded
into the kernel where still needed.

---

## 5. Reported decision (summary)

**Framework decision:** a **pure-C++ native desktop app** = **one Vulkan renderer for all three
OSes (MoltenVK on macOS) behind a thin RHI + GLFW windowing**, a **Forge-owned immediate-mode
UI built on Dear ImGui as the foundation and 100%-custom-skinned** (bespoke Forge design
language, *not* stock Qt, *not* an NX/CATIA/Creo clone) with **thin native-OS controls** for
dialogs/menubar/a11y, and **direct in-process linkage to the existing `forge_kernel` C++ library
(kill the `.node` N-API bridge)**. Qt is explicitly rejected (stock-look mandate + LGPL
in-UI-notice + separate-context latency), with **Qt Quick named as the single fallback** under
one enumerated a11y/i18n/rich-text condition. Archie keeps driving Forge via CUA — the native
window is *more* CUA-friendly, not less; e2e moves from DOM selectors to a native control/
introspection socket that promotes today's `window.__forge*` hooks, preserving the headed,
multi-cam capture pipeline.

**Phase-1 scope (primary deliverable — the latency win):** RHI-over-Vulkan + GLFW (MoltenVK on
macOS); a scene renderer with GPU instancing/indirect-draw + PBR/HDRI photoreal; **zero-copy
tessellation** (kernel `Mesh` written into mapped Vulkan buffers); ported octree culling + LOD +
AIS `faceId` face-pick + camera fit-to-bounds/digit views; **direct `forge::`/`forge_capi.h`
linkage with `binding*.cpp` excluded**; offscreen multi-cam capture → ffmpeg mp4. **Exit:** a
10k-body assembly orbits at locked frame rate with sub-frame latency, a kernel-built part renders
and is face-pickable, all with **zero JavaScript in the process**, and the multi-cam demo mp4 is
produced by the native renderer.
