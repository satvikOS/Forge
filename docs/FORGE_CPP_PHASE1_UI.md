# FORGE_CPP_PHASE1_UI.md — Pillar #10, Phase 1: the app's first real UI pixels (PROVEN)

**Status:** DONE / verified — the must-do (a representative Forge IDE rendered by Dear
ImGui to an offscreen framebuffer, headless) AND the stretch (the 3D kernel model
composited into the viewport panel via `ImGui::Image`) both PASS on this Mac.
**Scope:** the app's **UI layer** — the first time the pure-C++ desktop app draws real
interface pixels, layered on top of the already-proven headless Vulkan/MoltenVK renderer
backend (`docs/FORGE_CPP_PHASE1_RENDERER.md`, `forge-desktop/renderer_probe.cpp`).

Everything here is additive and behind a NEW option `FORGE_BUILD_DESKTOP_UI`
(default **OFF**), so the default build + CI are byte-unchanged.

---

## 0. The unknown, and the result

The renderer probe proved the GPU backend (Vulkan on Metal via MoltenVK) renders a real
kernel mesh **offscreen with no window**. What was still unproven: can the desktop app's
**UI toolkit** — Dear ImGui with its Vulkan backend — stand up on that same headless
offscreen target and draw a real, non-trivial interface, with no window / swapchain /
GLFW / input?

**Proven:** a standalone C++ probe (`forge-desktop/ui_probe.cpp`) reuses the renderer's
Vulkan init, creates a **1280×800** RGBA8 offscreen color image (no swapchain), stands up
`ImGui_ImplVulkan` against that offscreen render pass, builds ONE frame of a
representative **Forge IDE** (menu bar + model-tree / viewport / properties panels +
status bar), renders it offscreen, reads the pixels back and writes a PNG in which
**96.4 %** of the frame differs from the dark clear colour (the UI actually drew). The
central viewport shows the **real kernel box** (`tessellateLOD(makeBox(10,10,10), High)`,
12 triangles) — rendered depth-tested + diffuse-shaded into a separate offscreen texture
and composited through `ImGui::Image`. Exit code **0**.

---

## 1. What was added (additive, option-gated, default OFF)

Behind `option(FORGE_BUILD_DESKTOP_UI ... OFF)`:

- **`forge-desktop/ui_probe.cpp`** — the standalone headless ImGui UI probe. Self-contained:
  reuses the renderer's Vulkan setup pattern (portability instance + MoltenVK device +
  offscreen color image + render pass + readback), the same hand-rolled PNG writer (zlib
  "stored" — no new dep), and a minimal 4×4 matrix helper for the viewport MVP.
- **`forge-desktop/third_party/imgui/`** — vendored Dear ImGui **1.92.9** (upstream commit
  `7038887`): the core translation units + the Vulkan backend, **no platform backend**
  (`imgui_impl_glfw` is deliberately absent — this is headless, no window/input):
  `imgui.cpp imgui.h imgui_draw.cpp imgui_tables.cpp imgui_widgets.cpp imgui_internal.h
  imconfig.h imstb_rectpack.h imstb_textedit.h imstb_truetype.h` +
  `imgui_impl_vulkan.{cpp,h}`. (No nested `.git`.)
- **`forge-desktop/shaders/ui_viewport.{vert,frag}`** — the viewport's 3D shaders
  (position + normal in, fixed-MVP + model-rotation push constant, diffuse shading in the
  Forge amber accent). Compiled to SPIR-V **C headers** by `glslangValidator` at build time
  (into `<build>/forge_ui_shaders/`) and `#include`d by the probe (SPIR-V embedded — no
  runtime file load), exactly like the renderer probe's shaders.
- **`forge-kernel/CMakeLists.txt`** — the new option + a trailing gated block that locates
  the Vulkan SDK via `brew --prefix`, wires the two `glslangValidator` custom commands,
  and defines `add_executable(forge_ui_probe ...)` compiling the vendored ImGui + backend,
  linking the node-free `forge_kernel_core` (for the 3D viewport model) + the Vulkan
  loader. The block `FATAL_ERROR`s if `FORGE_BUILD_DESKTOP_FOUNDATION` is not also ON.

No kernel source was changed; the existing `forge_kernel` / `forge_kernel.node` targets,
the foundation/mesh/step/feature/renderer probes, and their CMake blocks are untouched.

---

## 2. Headless ImGui, the details that matter

- **No window, no swapchain, no platform backend.** `ImGui::CreateContext()`; `io.DisplaySize
  = {1280,800}`; `io.DeltaTime = 1/60`; `io.IniFilename = io.LogFilename = nullptr`. No
  `ImGui_ImplGlfw_*`; a static frame needs no input. `ImGui_ImplVulkan_Init` is pointed at
  the **offscreen** render pass (`PipelineInfoMain.RenderPass`) — the 1.92 API moved
  `RenderPass`/`Subpass`/`MSAASamples` into `PipelineInfoMain`.
- **Font atlas.** ImGui 1.92's new texture system uploads the font atlas automatically the
  first time `ImGui_ImplVulkan_RenderDrawData` walks `ImDrawData::Textures`. Because that
  upload does its own `vkQueueSubmit` + `vkQueueWaitIdle` on the backend's internal texture
  command pool, the probe **pre-uploads** all pending textures (font atlas + viewport tex)
  BEFORE beginning the UI render pass, so no queue submit happens inside an active render
  pass recording (clean on MoltenVK).
- **Descriptor pool.** The backend's convenience `DescriptorPoolSize = 16` is used — it
  builds its own `SAMPLED_IMAGE` + `SAMPLER` pool (the 1.92 split), enough for the font
  atlas plus the viewport texture.
- **Dark Forge style.** A hand-tuned dark-slate palette with a single amber accent
  (`0.90, 0.58, 0.20`) for checkmarks / sliders / active headers; rounded frames + windows.

## 3. The 3D-viewport composite (stretch)

`renderViewportTexture()` renders `tessellateLOD(makeBox(10,10,10), High)` into a **separate**
768×576 offscreen color texture with a depth attachment (so the solid reads correctly) using
`ui_viewport.{vert,frag}`; its render pass ends in `SHADER_READ_ONLY_OPTIMAL`. The color view
is registered with `ImGui_ImplVulkan_AddTexture(view, SHADER_READ_ONLY_OPTIMAL)` and the
returned `VkDescriptorSet` is passed as the `ImTextureID` to `ImGui::Image` inside the central
viewport panel (aspect-fit + centred). Ordering is guaranteed because the viewport render is
submitted + `vkQueueWaitIdle`-d before the UI frame is recorded. If the composite ever fails
(logged with the exact `VkResult`), the panel falls back to a framed placeholder rect and the
must-do UI is unaffected — but on this Mac the composite **succeeds**.

---

## 4. Build + run

```sh
cd forge-kernel
cmake -S . -B build-desktop-ui \
  -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_DESKTOP_UI=ON \
  -DCMAKE_SHARED_LINKER_FLAGS="-undefined dynamic_lookup"
cmake --build build-desktop-ui -j3 --target forge_ui_probe
VK_ICD_FILENAMES=$(brew --prefix molten-vk)/etc/vulkan/icd.d/MoltenVK_icd.json \
  ./build-desktop-ui/forge_ui_probe
```

**Note on `-undefined dynamic_lookup`:** `forge_kernel_core` (the node-free core lib, shared
with the renderer/foundation probes) has a small number of symbols it resolves at load time
against the OCCT dylibs (OCCT's TKBO boolean toolkit, reached transitively) plus one latent
gap (`forge::native::implicit::MeshToSDF::build`, referenced by `VoxelFieldOps::fromMesh`, a
source not currently in the kernel's compile list — never called by this probe). The original
`build/` tree that built the renderer/foundation probes is a cmake-js tree whose global
`CMAKE_SHARED_LINKER_FLAGS` already carries `-undefined dynamic_lookup`, so this matches how
those artifacts were actually produced. The flag is passed here so the isolated `build-desktop-ui`
tree links `forge_kernel_core` the same way — it does **not** touch the default `build/` tree.

---

## 5. Measured result (real probe output, exit 0)

```
=== Forge C++ Desktop UI Probe (Dear ImGui on Vulkan/MoltenVK, headless) ===
  physical device : Apple M4 Max
  driver          : MoltenVK
  imgui version   : 1.92.9 WIP

--- STRETCH: render kernel box into viewport texture ---
  viewport 3D texture rendered (12 triangles) — will composite via ImGui::Image

--- UI: build Forge IDE frame + render offscreen ---
  imgui draw data : 3098 vertices, 6999 indices, 6 draw lists
  covered pixels  = 987060 / 1024000  (96.4% of the frame differ from clear)
  PNG written     = /tmp/forge_ui_probe/forge_ui.png  (ok)
  viewport 3D     = composited (real kernel box)

=== UI PROBE PASS — Forge ImGui UI rendered headless offscreen -> PNG (Vulkan/MoltenVK) ===
```

- **Device:** `Apple M4 Max`, **driver** `MoltenVK`.
- **Draw data:** ImGui emitted **3098 vertices / 6999 indices / 6 draw lists** — a real,
  non-trivial frame (real widgets, not a stub).
- **Coverage:** **96.4 %** of the 1280×800 frame differs from the dark clear colour
  (asserted `> 15 %`) — the UI genuinely rasterized across the whole window. `/tmp/forge_ui_probe/forge_ui.png`
  is a valid 1280×800 8-bit RGBA PNG (self-contained writer).
- **The PNG shows a genuine CAD IDE:** a top menu bar (File / Edit / View / Model / Draft /
  Help + right-aligned `FORGE · M4 Max / MoltenVK` brand); a left **Model Tree** panel
  (`Part · Bracket` → Origin, Sketch1, Extrude1 → Sketch1 (profile), **Fillet1** selected,
  Shell1; Bodies / Sketches groups); a central **Viewport** (Orbit/Pan/Zoom/Fit toolbar and
  the shaded amber kernel box, three faces distinguishable); a right **Properties** panel
  (Length/Width/Height/Fillet-R/Shell-t/Draft sliders, amber checkboxes, a material combo,
  an appearance colour swatch, and a mass-properties block with mm³ / mm² superscripts); and
  a bottom status bar (`Ready · Model: box 10×10×10 · 12 triangles · Units: mm` + right-aligned
  x/y/z + zoom).

---

## 6. Node-free + linkage proof

```
$ otool -L build-desktop-ui/forge_ui_probe
    @rpath/libforge_kernel_core.dylib
    /opt/homebrew/opt/vulkan-loader/lib/libvulkan.1.dylib
    /usr/lib/libc++.1.dylib
    /usr/lib/libSystem.B.dylib

$ nm -u build-desktop-ui/forge_ui_probe | grep -iE 'napi|node_api'   → (none)
```

The probe depends on the node-free `forge_kernel_core` + the Vulkan loader + libc++/libSystem
**only** — zero Node, zero N-API. The UI layer, the renderer backend, and the kernel share the
same node-free link.

---

## 7. Default build untouched (CI-safe)

- `FORGE_BUILD_DESKTOP_UI` defaults **OFF**; the entire UI block (SDK discovery, the two
  `glslangValidator` custom commands, the vendored-ImGui compile, `add_executable(forge_ui_probe
  ...)`) lives inside `if(FORGE_BUILD_DESKTOP_UI)` and never runs otherwise.
- A fresh **default** configure (`cmake -S . -B <dir>`, all desktop options OFF — exactly what
  CI runs) completes clean and its generated `Makefile` contains **zero** `forge_ui_probe`
  rules. The UI probe was built in a **separate** `build-desktop-ui` tree, so the default
  `build/` tree was never touched (its cache still shows `FORGE_BUILD_DESKTOP_*` = OFF).
- `forge-kernel.node` is **byte-identical** before/after (`shasum -a 256` =
  `bb3b6b58…c988fab`, size 7718560) and still loads:
  `node -e "require('./build/Release/forge-kernel.node')"` → 339 exported keys.
- No kernel source was changed — only additive, option-gated CMake + one new `.cpp` + two
  shaders + vendored ImGui. The gate suite is unaffected.

---

## 8. What this closes

The desktop app's **UI layer** now draws real pixels, headless, on this Mac: `ImGui frame →
Vulkan/MoltenVK offscreen → readback/PNG`, with the **kernel's own 3D model composited into
the viewport** — the true app look (a shaded solid in a viewport surrounded by Forge UI
chrome). Combined with the foundation trilogy + feature/drafting probe + the renderer probe,
every layer the pure-C++ desktop app is built from — kernel, GPU backend, and now UI — is
proven standalone, node-free, headless. The remaining Phase-1 work is presentation plumbing (a
real GLFW window + swapchain to put this same frame on screen, and wiring live input) — no
further kernel-decoupling, backend-feasibility, or UI-toolkit-feasibility risk.
</content>
