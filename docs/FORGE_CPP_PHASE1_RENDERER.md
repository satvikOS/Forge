# FORGE_CPP_PHASE1_RENDERER.md — Pillar #10, Phase 1: the headless Vulkan/MoltenVK renderer (PROVEN)

**Status:** DONE / verified — both the must-do smoke (Step 2) and the stretch mesh-render
(Step 3) PASS on this Mac. **Scope:** the last Phase-1 unknown — that the desktop renderer
BACKEND (Vulkan on Metal via MoltenVK) runs **headless** (no window, no swapchain) on this
machine, and can rasterize a real kernel mesh offscreen and read the pixels back.

This builds directly on the node-free `forge_kernel_core` foundation
(`docs/FORGE_CPP_PHASE1_FOUNDATION.md`). Everything here is additive and behind a NEW option
`FORGE_BUILD_DESKTOP_RENDERER` (default **OFF**), so the default build + CI are byte-unchanged.

---

## 0. The unknown, and the result

The foundation trilogy proved the kernel decouples from Node and feeds a tessellated
`Mesh{positions,indices,normals}`. What was still unproven on this Mac: does the actual GPU
backend the desktop app will use — **Vulkan, running on Apple Metal through MoltenVK** — even
initialize and render **offscreen with no window**? The mesh-feed probe explicitly left this
open ("the offscreen renderer itself is blocked on this machine — no Vulkan SDK installed").

**Proven:** with the Vulkan SDK installed via Homebrew, a standalone C++ probe
(`forge-desktop/renderer_probe.cpp`) creates a `VkInstance` + MoltenVK `VkDevice` with **no
window/swapchain**, clears a 256×256 offscreen image and reads a pixel back **exactly** equal to
the clear colour (Step 2), then tessellates `forge::makeBox(10,10,10)` through the node-free
`forge_kernel_core`, rasterizes it with a minimal graphics pipeline, and writes a valid PNG
whose box silhouette covers **42.1 %** of the frame (Step 3). Exit code **0**.

---

## 1. SDK installed (Homebrew — for the human's awareness + reversibility)

All four are **new** installs (none were present before). Reverse with
`brew uninstall glslang molten-vk vulkan-loader vulkan-headers` (+ the pulled deps
`spirv-tools spirv-headers` if desired).

| formula | version | `brew --prefix` |
|---|---|---|
| `molten-vk`       | 1.4.1     | `/opt/homebrew/opt/molten-vk` |
| `vulkan-headers`  | 1.4.350.1 | `/opt/homebrew/opt/vulkan-headers` |
| `vulkan-loader`   | 1.4.350.1 | `/opt/homebrew/opt/vulkan-loader` |
| `glslang`         | 16.4.0    | `/opt/homebrew/opt/glslang` |
| (deps) `spirv-headers` 1.4.350.1, `spirv-tools` 1.4.350.1 | | (pulled by glslang) |

The Vulkan loader finds MoltenVK via its ICD json. Homebrew puts it under **`etc/`** (not the
`share/` the task expected):

```
VK_ICD_FILENAMES=/opt/homebrew/opt/molten-vk/etc/vulkan/icd.d/MoltenVK_icd.json
```

(The json is `"is_portability_driver": true` and points at `../../../lib/libMoltenVK.dylib`.)
The loader itself (`libvulkan.1.dylib`) has an **absolute** install name, so the probe needs no
`DYLD_LIBRARY_PATH` — only `VK_ICD_FILENAMES` at run time.

---

## 2. What was added (additive, option-gated, default OFF)

Behind `option(FORGE_BUILD_DESKTOP_RENDERER ... OFF)`:

- **`forge-desktop/renderer_probe.cpp`** — the standalone headless Vulkan/MoltenVK probe
  (Step 2 clear-smoke + Step 3 mesh→PNG). Self-contained: includes a tiny hand-rolled PNG
  writer (zlib "stored"/uncompressed deflate + CRC32/Adler32 — **no new brew dep for PNG**) and
  a minimal 4×4 matrix helper for the fixed MVP.
- **`forge-desktop/shaders/renderer.vert` / `renderer.frag`** — a trivial fixed-MVP vertex
  shader + a flat-colour fragment shader. Compiled to SPIR-V **C headers** by
  `glslangValidator -V --target-env vulkan1.2 --vn` at build time (into
  `<build>/forge_renderer_shaders/`) and `#include`d by the probe (SPIR-V embedded — no runtime
  file load).
- **`forge-kernel/CMakeLists.txt`** — the new option + a trailing gated block that locates the
  SDK via `brew --prefix`, wires the two `glslangValidator` custom commands, and defines
  `add_executable(forge_renderer_probe ...)` linking `forge_kernel_core` (node-free) + the
  Vulkan loader. The block `FATAL_ERROR`s if `FORGE_BUILD_DESKTOP_FOUNDATION` is not also ON
  (Step 3 links `forge_kernel_core`).

No kernel source was changed; the existing `forge_kernel` / `forge_kernel.node` targets and all
foundation probes are untouched.

---

## 3. Build + run

```sh
cd forge-kernel
cmake -S . -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_DESKTOP_RENDERER=ON
cmake --build build -j3 --target forge_renderer_probe
VK_ICD_FILENAMES=/opt/homebrew/opt/molten-vk/etc/vulkan/icd.d/MoltenVK_icd.json \
  ./build/forge_renderer_probe
```

(`forge_kernel_core` is reused from the foundation build — the renderer probe itself compiles +
links in seconds.)

---

## 4. Measured result (real probe output, exit 0)

```
=== Forge C++ Desktop Renderer Probe (Vulkan/MoltenVK, headless offscreen) ===
  physical device : Apple M4 Max
  driver          : MoltenVK

--- STEP 2: headless clear + readback smoke ---
  sampled centre pixel RGBA = (26,51,77,255)  expected ~(26,51,77,255)
  STEP 2 PASS: Vulkan-on-Metal cleared + read back offscreen headless.

--- STEP 3: offscreen kernel-mesh render -> PNG ---
  kernel mesh: 8 verts, 36 indices (12 tris)
  covered pixels = 27588 / 65536  (42.1% of the frame differ from clear)
  PNG written    = /tmp/forge_renderer_probe/box.png
  STEP 3 PASS: kernel box rendered offscreen -> PNG, coverage non-degenerate.

=== RENDERER PROBE: STEP 2 PASS + STEP 3 PASS — Vulkan/MoltenVK headless render verified ===
```

- **Device:** `Apple M4 Max`, **driver** `MoltenVK` (queried via
  `VkPhysicalDeviceDriverProperties`, apiVersion 1.2.334) — the MoltenVK portability device.
- **Step 2 (must-do):** the centre pixel read back from GPU memory is `(26,51,77,255)`, an
  **exact** match to the clear colour `RGBA(0.1,0.2,0.3,1)` → `round(0.1·255)=26`,
  `round(0.2·255)=51`, `round(0.3·255)=77`, `255` (asserted within an 8-bit-rounding slack of
  ±2; it landed dead-on). Vulkan-on-Metal renders + reads back headless here.
- **Step 3 (stretch):** the kernel box (8 verts / 12 tris from `tessellateLOD(High)`) uploaded
  into Vulkan vertex/index buffers and rasterized through a fixed-MVP isometric pipeline covers
  **42.1 %** of the 256×256 frame (asserted non-degenerate: `> 5 %` and `< 98 %`).
  `/tmp/forge_renderer_probe/box.png` is a valid 256×256 8-bit RGBA PNG (verified by `file` and
  macOS `sips`) showing an orange cube silhouette (hexagon) on the dark-teal clear background.

---

## 5. Node-free + linkage proof (the load-bearing check)

```
$ otool -L build/forge_renderer_probe
    @rpath/libforge_kernel_core.dylib
    /opt/homebrew/opt/vulkan-loader/lib/libvulkan.1.dylib
    /usr/lib/libc++.1.dylib
    /usr/lib/libSystem.B.dylib

$ nm -u build/forge_renderer_probe | grep -iE 'napi|node_api'   → (none)
```

The probe depends on the node-free `forge_kernel_core` + the Vulkan loader + libc++/libSystem
**only** — zero Node, zero N-API. The renderer backend and the kernel share the same node-free
link.

---

## 6. Default build untouched (CI-safe)

- `FORGE_BUILD_DESKTOP_RENDERER` defaults **OFF**; the entire renderer block (the `brew --prefix`
  discovery, the `glslangValidator` custom commands, `add_executable(forge_renderer_probe ...)`)
  lives inside `if(FORGE_BUILD_DESKTOP_RENDERER)` and never runs otherwise.
- A fresh **default** configure (`cmake -S . -B <dir>`, both options OFF — exactly what CI runs)
  completes clean and its generated `Makefile` contains **zero** `forge_renderer_probe` rules;
  the ON configure's Makefile has the target. CI never sets the option → unaffected by
  construction.
- `forge-kernel.node` is **byte-identical** before/after (`shasum -a 256` =
  `bb3b6b58…c988fab`, size 7718560) and still loads:
  `node -e "require('./build/Release/forge-kernel.node')"` → 339 exported keys.
- No kernel source was changed — only additive, option-gated CMake + one new `.cpp` + two
  shaders. The gate suite is unaffected.

---

## 7. What this closes

Phase-1's **last unknown is resolved**: the desktop renderer backend (Vulkan/MoltenVK) works
headless on this Mac, and the full kernel→GPU→pixels loop runs offscreen with zero Node —
`ShapeHandle → tessellateLOD → Mesh → Vulkan vertex/index buffers → graphics pipeline →
offscreen image → readback/PNG`. Combined with the foundation trilogy + feature/drafting probe,
every kernel-and-backend surface the pure-C++ desktop app depends on is now proven standalone.
The remaining Phase-1 work is presentation polish (a real GLFW window + swapchain for an
on-screen viewport, ImGui UI) — no further kernel-decoupling or backend-feasibility risk.
