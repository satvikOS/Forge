# FORGE_CPP_PHASE1_FOUNDATION.md — Pillar #10, Phase 1: the node-free kernel link (PROVEN)

**Status:** DONE / verified. **Scope:** the single riskiest unknown of the pure-C++ desktop
migration (`docs/FORGE_CPP_MIGRATION.md` §1.3) — proving the geometry kernel decouples from
Node so a plain C++ desktop app can link it in-process with **no N-API runtime**.

This is *only* the kernel-link foundation. The Vulkan renderer / ImGui UI (later Phase-1) are
out of scope. A headless C++ program that drives the kernel with zero Node **is** the deliverable.

---

## 0. The unknown, and the result

The shipping `forge-kernel.node` (7.7 MB) compiles the N-API binding (`src/binding*.cpp`, which
`#include <napi.h>`) **into** the shared library. A standalone C++ app that linked that lib would
drag in Node's N-API runtime at load. Phase-1's thesis is that the binding is a *removable
adapter* — a **relink, not a rewrite**.

**Proven:** a node-free core library (`forge_kernel_core` = the SAME source set MINUS the 4
binding TUs) builds and links cleanly with **zero** Node symbols, and a plain C++ program links
it and drives the kernel headlessly (box + cylinder + boolean, exact volume + face inventory),
exiting 0. The N-API bridge is confirmed removable.

---

## 1. The N-API leak set — the ONLY files excluded from the core

`grep -rl 'napi\.h\|node-addon-api\|node_api' src/` enumerates exactly the files that touch
N-API. There are **four**, all in `src/`:

| Excluded file | Why |
|---|---|
| `src/binding.cpp`          | main N-API surface (2078 `exports.Set`) |
| `src/binding_field.cpp`    | N-API bridge for the implicit/voxel field ops |
| `src/binding_geom.cpp`     | N-API bridge for the dark geom engines |
| `src/binding_sketchdiag.cpp` | N-API bridge for PlaneGCS constraint diagnostics |

**No other source and no header leaks N-API** — verified:
- `grep -rl 'napi\.h\|node-addon-api' include/` → none (the public headers are node-free).
- `grep -rln 'Napi::\|napi_' src/ | grep -v binding` → none (no non-binding TU references N-API).

So `forge_kernel_core` is exactly `forge_kernel` minus those 4 TUs (plus any cmake-js node glue,
empty on this macOS build). It links the identical `OCCT_LIBS` and honors the same
`FORGE_NATIVE_BREP` compile gate.

---

## 2. What was added (additive, option-gated, default OFF)

Everything is behind `option(FORGE_BUILD_DESKTOP_FOUNDATION ... OFF)` so the **default build (what
CI runs) is byte-unchanged**: the `forge-kernel.node` target and every gate are untouched.

- **`forge-kernel/CMakeLists.txt`** — the option + a trailing gated block that:
  - reads the source list *from the existing `forge_kernel` target*
    (`get_target_property(... SOURCES)`) so the `add_library(forge_kernel ...)` block is **not
    edited** — the block only *filters* that list (drops `binding*.cpp` + node glue);
  - defines `add_library(forge_kernel_core SHARED ...)` as a **normal** shared lib — NO
    `-undefined dynamic_lookup`, so the link **fails loud** if any non-binding source had needed
    a Node symbol (it doesn't);
  - defines `add_executable(forge_foundation_probe ...)` linking only `forge_kernel_core`.
- **`forge-desktop/foundation_probe.cpp`** — the standalone headless C++ driver.

---

## 3. Build + run

```sh
cd forge-kernel
cmake -S . -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build build -j3 --target forge_kernel_core forge_foundation_probe   # heavy: full kernel compile
./build/forge_foundation_probe
```

`forge_kernel_core` is a full kernel compile (~400 `.cpp`, OCCT-linked) into its own object dir —
budget ~10-15 min cold; `-j3` caps RAM. The default build is restored with
`-DFORGE_BUILD_DESKTOP_FOUNDATION=OFF` (the default).

---

## 4. Measured result (real probe output — native analytic B-rep, the production default)

```
=== Forge C++ Desktop Foundation Probe ===
  linked library : forge_kernel_core  (N-API binding EXCLUDED)
  kernel backend : native analytic B-rep (production default)

[1] makeBox(10,10,10)
    volume        = 1000.000000000   (expected 1000)
    surface area  = 600.000000000   (expected 600)
    face count    = 6           (expected 6)
    planar faces  = 6           (expected 6)
    centroid      = (5.000000, 5.000000, 5.000000)

[2] makeCylinder(r=5, h=10)  [+ unifyFaces]
    volume        = 785.398163397   (expected 785.398163397 = pi*25*10)
    face count    = 3           (expected 3 after unify)
    lateral faces = 1  radius = 5.000000000 (expected 1 face, r=5)

[3] cut( box(10^3), cylinder(r=2,h=10) @ (5,5) )  [through-hole]
    volume        = 874.336293856   (expected 874.336293856 = 1000 - pi*4*10)
    removed        = 125.663706144   (expected 125.663706144)
    face count    = 134           (expected > 6: box + bore)

=== ALL 12 CHECKS PASSED — PASS ===
Node-free kernel core drove box + cylinder + boolean headlessly.
```

Exit code **0**. The probe drove the kernel through its public **C++ API** (`forge::makeBox`,
`forge::makeCylinder`, `forge::translate`, `forge::cut`, `forge::massProperties`,
`forge::unifyFaces`, `forge::faceInventory`). Box volume/faces are exact; the cylinder volume is
exact (`pi*25*10`), 3 faces after the documented `unifyFaces` (the native→OCCT bridge shatters
the analytic side into 128 strips — the boolean's 134 faces = box 6 + those 128 bore strips);
the boolean volume matches the analytic drop to `1e-9`.

---

## 5. Node-free proof (the load-bearing check)

```
$ otool -L build/forge_foundation_probe
	@rpath/libforge_kernel_core.dylib
	/usr/lib/libc++.1.dylib
	/usr/lib/libSystem.B.dylib

$ nm -u build/forge_foundation_probe | grep -iE 'napi|node'      → (none)
$ nm -u build/Release/libforge_kernel_core.dylib | grep -iE 'napi|node_api' → (none)
$ otool -L build/Release/libforge_kernel_core.dylib | grep -iE 'napi|node'  → (none)
```

The probe depends on `libforge_kernel_core` + libc++ + libSystem **only** — no Node, no N-API.
`forge_kernel_core` links 17 OCCT dylibs and no Node lib, and carries **zero** `napi`/`node`
undefined symbols — the load-bearing node-free proof.

**Accuracy note (corrected after the `forge_ui_probe` strict link, 2026-07-17):** the shipping
`build/` is a cmake-js tree that sets `-undefined dynamic_lookup` **globally**, so
`forge_kernel_core` there inherits it and does NOT strictly resolve every symbol at link time — an
earlier revision of this section overstated that. A truly strict (non-`dynamic_lookup`) link
surfaced two deferred symbols: (1) `forge::native::implicit::MeshToSDF::build` — a real omitted-source
gap (`MeshToSDF.cpp` was missing from the `add_library` list), **fixed in `602062dd`**; and (2)
OCCT `TKBO` boolean symbols, resolved transitively via the linked toolkits' flat-namespace load
(normal OCCT behavior, not a gap). Post-fix, `nm -u forge-kernel.node | c++filt | grep forge::`
is **empty** — every in-house symbol resolves; only OCCT/system symbols remain deferred, which is
the expected flat-namespace linkage and does not affect the node-free property.

---

## 6. Default build untouched (CI-safe)

- `forge-kernel.node` is **byte-identical** before and after the ON build
  (`shasum -a 256` = `bb3b6b58…c988fab`, size 7718560, mtime unchanged) — the ON build never
  rebuilt it (separate object dir `forge_kernel_core.dir`).
- With the option OFF (default): `forge_kernel_core` / `forge_foundation_probe` are **absent**
  from the build system; `cmake --build build --target forge_kernel` reports the target
  up-to-date (no recompile); `node -e "require('./build/Release/forge-kernel.node')"` loads and
  returns `volume = 1000 | faces = 6`.
- No kernel source was changed — only additive, option-gated CMake targets + one new `.cpp`. The
  137-gate suite is unaffected by construction.

---

## 7. What this unlocks

The kernel is confirmed to be the standalone C++ product; the `.node` bridge is a removable
adapter. The next Phase-1 steps (`docs/FORGE_CPP_MIGRATION.md` §2.1) — GLFW+Vulkan (MoltenVK)
window, zero-copy tessellation into mapped Vulkan buffers, the viewport algorithms — build **on
top of** this same `forge_kernel_core` link, calling `forge::tessellate` → `Mesh` (plain
`std::vector`s, already `memcpy`-ready) with no Node in the process.

---

## 8. Mesh-feed probe (`forge_mesh_probe`) — the render data-feed, proven standalone

The Vulkan renderer is blocked on this machine (no Vulkan SDK / MoltenVK installed:
`VULKAN_SDK` unset, no `libvulkan`/`libMoltenVK`), so the renderer itself is a later step. But its
**input** — the exact per-frame pipeline `ShapeHandle → tessellateLOD(High) → Mesh{positions,
indices, normals} → GPU buffer` — is fully provable headlessly, and now is. `forge-desktop/mesh_probe.cpp`
(a second option-gated target `forge_mesh_probe`, same node-free `forge_kernel_core` link) drives
`forge::tessellateLOD` + `forge::io::exportStl` and asserts the mesh/STL invariants. Measured (real
run, exit 0, **48/48 checks**):

| body | verts | tris | AABB | STL (ascii) |
|---|---|---|---|---|
| `makeBox(10,10,10)`        | 8   | 12  | [0,10]³                    | 12 facets, 1480 B |
| `makeCylinder(5,10)`       | 256 | 508 | [-5,5]×[-5,5]×[0,10]        | 508 facets |
| `box − cyl(r2) through`    | 264 | 528 | [0,10]³ (bore adds a wall) | 528 facets |

Checks per body: positions/indices triangle-aligned, every coordinate finite, one normal per
vertex, every index in range, vertex AABB matches the solid's known bounds, the curved cylinder
carries far more triangles than the planar box (the tessellator sampled the curve), and
`exportStl` wrote a valid STL whose facet count matches the body (format-agnostic: ASCII facet
count *or* binary offset-80 layout). Note: `forge::io::exportStl` emits **ASCII** STL regardless of
the `ascii` argument on this build — documented here, not worked around. Build:
`cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON && cmake --build build -j3 --target forge_mesh_probe && ./build/forge_mesh_probe`.

---

## 9. STEP-IO probe (`forge_step_probe`) — the file-IO backbone, proven standalone

A CAD app must Open/Save. `forge-desktop/step_probe.cpp` (option-gated `forge_step_probe`,
same node-free `forge_kernel_core` link) proves the persistence/interchange backbone —
`ShapeHandle → exportStep → importStep → volume-preserved` — works standalone C++ with zero
Node. Measured (real run, exit 0, **21/21 checks**):

| body | vol(orig) | STEP | vol(reimport) | round-trip |
|---|---|---|---|---|
| `makeBox(10,10,10)`       | 1000.000000 | 6300 B   | 1000.000000 | exact |
| `makeCylinder(5,10)`      | 785.398163  | 190251 B | 785.398163  | exact |
| `box − cyl(r2) through`   | 874.336294  | 196102 B | 874.336294  | exact (=1000−π·4·10) |

Per body: `exportStep` wrote a real STEP part file (ISO-10303-21 magic, non-trivial size),
`importStep` re-read it to a positive-volume solid, the round-trip preserved volume to a tight
tol (native STEP is **analytic + lossless**, so exact here), and the reimported body was itself
re-savable (idempotent writer). Build: `cmake --build build -j3 --target forge_step_probe`.

### Phase-1 foundation trilogy — COMPLETE
The three essential kernel surfaces the desktop app depends on are now all proven to run
standalone C++ (node-free `forge_kernel_core`, zero Node in the process):
1. **geometry** — `forge_foundation_probe` (box/cylinder/boolean, 12/12)
2. **render-feed** — `forge_mesh_probe` (tessellate→Mesh→STL, 48/48)
3. **file-IO** — `forge_step_probe` (STEP round-trip, 21/21)

Next (blocked here — needs the Vulkan SDK / MoltenVK, not installed): the GLFW+Vulkan offscreen
renderer that uploads `forge::tessellateLOD` → `Mesh` into a mapped Vulkan vertex/index buffer.
It builds on this same link with no further kernel-decoupling risk.

---

## 10. Feature+drafting probe (`forge_feature_probe`) — modeling + 2D drawings, standalone

Beyond the data trilogy, a CAD app must EDIT geometry and produce DRAWINGS.
`forge-desktop/feature_probe.cpp` (option-gated `forge_feature_probe`, same node-free link)
proves both work standalone C++ (zero Node). Real run, exit 0, **9/9 checks**:

| op | result |
|---|---|
| `forge::part::shell(box(10³), {face0}, t=1)` | box vol 1000.000 → shell vol **564.926** (real 1 mm wall, 1 face open; 0 < shellVol < boxVol) |
| `forge::projectShape(box, frontView())` (ortho HLR) | **4 visible + 4 hidden** polylines, screen extent **10.000 × 10.000** (matches the cube face), all coords finite |

`projectShape` runs on a NATIVE solid (the native analytic HLR is exact on a NativeSolid — no
`importOcctSolid` faceting). The box's occluded back edges correctly appear as hidden lines.

### App-critical kernel surface — all proven standalone C++
The four probes together show every kernel surface the desktop app depends on runs with **zero
Node** on the node-free `forge_kernel_core`:
- **geometry** — `forge_foundation_probe` (12/12)
- **render-feed** — `forge_mesh_probe` (48/48)
- **file-IO** — `forge_step_probe` (21/21)
- **modeling + drafting** — `forge_feature_probe` (9/9)

The N-API bridge is a fully removable adapter across the app's entire kernel dependency. The
remaining Phase-1 work is purely the presentation layer (Vulkan/MoltenVK renderer + ImGui UI),
blocked here only by the absent Vulkan SDK.
