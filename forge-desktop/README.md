# `forge-desktop` — the Forge CAD workstation

A real, runnable application: an SDL2 window, a Vulkan-on-MoltenVK device and swapchain, Dear ImGui,
a 3D viewport over a body the kernel actually built, and the `forge::ui` service layer driving all
of it.

Before this segment `forge-desktop/` was six headless probe programs and nothing rendered. The probes
are still here and still build — they are what proved the backend, and `renderer_probe.cpp` is where
the PNG writer in `src/PngWriter.hpp` comes from.

## Build

```sh
# 1. the node-free kernel core (once; ~2 min from cold on an M4 Max)
cmake -S forge-kernel -B forge-kernel/build-app -DCMAKE_BUILD_TYPE=Release \
      -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build forge-kernel/build-app -j8 --target forge_kernel_core

# 2. the application
cmake -S forge-desktop -B forge-desktop/build -DCMAKE_BUILD_TYPE=Release
cmake --build forge-desktop/build -j8
```

Or do all of it, plus the gate and its mutation proof, with one command:

```sh
bash forge-desktop/test/run_desktop.sh
```

Dependencies (Homebrew): `sdl2 vulkan-headers vulkan-loader molten-vk glslang opencascade`.

## Run

```sh
forge-desktop/build/run_forge.sh
```

`run_forge.sh` exists for one reason: Homebrew's Vulkan loader does not look inside Homebrew's
`molten-vk` prefix, so without `VK_ICD_FILENAMES` the app enumerates zero physical devices. The
script sets it and tells you if the manifest is missing.

Flags:

| flag | what it does |
| --- | --- |
| `--workspace <name>` | open directly in `part`, `sketch`, `assembly`, `surface`, `manufacturing`, `drawing`, `simulation` or `archie` |
| `--frames <n>` | present `n` frames and exit — how the app is driven non-interactively |
| `--screenshot <path>` | write a PNG **of the live swapchain image**, not of an offscreen surrogate |

State — workspace, dock layout per workspace, input profile and the whole keymap — is written to
`~/.forge/shell_state.txt` on exit and read back on launch.

## What is wired to what

Nothing in `src/` reimplements a service. The whole point of the segment is that the application is
a *consumer* of `forge::ui`.

| service (`ui/`) | what it drives in the app |
| --- | --- |
| `CommandRegistry` | the menu bar, the workspace ribbon, the command palette and the viewport context menu are all **generated from the registry**. There is no hand-written menu table. A greyed item is greyed by `evaluate()` — the same call `dispatch()` makes — so a menu can never disagree with the dispatcher. |
| `PartCommands` | `registerPartCommands()` puts the 18 Part commands into the **same** registry the shell dispatches through, via `ForgeShell::registry()`. 13 shell commands + 18 Part = 31. |
| `SelectionService` | viewport hover sets preselection, a click sets selection and focus, the status strip's filter combo is `setFilter()`. Everything resolves to an `EntityRef` with a persistent name (`face@7`), never a raw index. |
| `Keymap` | key presses that ImGui does not want as text go to `ForgeShell::key()`. Multi-stroke sequences report `Pending` and are held. Switching input profile switches the shortcut table **and** the viewport's mouse-drag verbs at once. |
| `DockLayout` | the dock tree is walked into rectangles and one borderless ImGui window is placed per tab group. Splitter drags and tab clicks write **back into the tree**, so what you arranged is what gets serialized. |
| `WorkspaceProfile` | the eight workspace tabs. Switching saves the current layout and restores that workspace's. |
| `FeatureTreeModel` | the feature-tree panel reads through `window()` under an `ImGuiListClipper`, so the expensive per-row record is materialized only for rows on screen, and a second identical frame costs the source zero new fetches. |
| `forge::tessellate` | the viewport's triangles. `KernelScene` builds `BOX -> CUT -> FILLET`, tessellates it, and de-indexes the mesh so every vertex carries the per-triangle OCCT face id that face picking needs. |

## Layout of the source

```
src/KernelScene.{hpp,cpp}       the ONLY TU that includes an OCCT or forge-kernel header
src/Camera.{hpp,cpp}            turntable camera + the four profiles' mouse-drag verbs (pure math)
src/ForgeFrame.{hpp,cpp}        one ImGui frame of the shell. Touches NO GPU state — which is what
                                lets the gate build real frames in CI with no display.
src/ViewportRenderer.{hpp,cpp}  the geometry pass into an offscreen colour+depth target, handed to
                                ImGui as a texture. The only class outside main.cpp naming a Vk type.
src/PlatformSDL2.{hpp,cpp}      first-party SDL2 -> ImGuiIO platform backend
src/PngWriter.hpp               dependency-free RGBA8 PNG, for --screenshot
src/main.cpp                    window, device, swapchain, frame loop, persistence
test/frame_gate.cpp             132 headless checks + 7 injectable mutations
test/run_desktop.sh             build + gate + mutation proof
```

## The gate

`forge_desktop_frame_gate` builds **real frames of the real shell** — no window, no swapchain, no
MoltenVK — and asserts values against references: the bounding box is 80x50x20 to within the
tessellation deflection, every vertex carries a face id, a centre ray hits and a reversed ray misses,
CATIA's middle-drag pans while NX's rotates, the eight workspaces each draw four panels, a splitter
drag lands in the dock tree, save→load→save is byte-identical, and unplugging a monitor loses no
panel.

`run_desktop.sh` then injects seven defects in turn and **requires each to turn the gate red**:

| mutation | the regression it stands for |
| --- | --- |
| 1 | the frame builder is never called → the shell draws nothing |
| 2 | Part commands are not registered → the one registry is short by 18 |
| 3 | a pick is not routed to the selection → no vertex is flagged for the shader |
| 4 | the tree panel calls the source's expensive fetch per row instead of `window()` |
| 5 | the projection loses its Vulkan Y-flip → the picking ray and the image disagree |
| 6 | the Measure panel is not fed the live selection → it measures nothing (7 checks red) |
| 7 | the Tools panel answers from a stale selection → it offers a tool that refuses (2 checks red) |

A mutation that stays green fails the script, because a check that cannot fail is not a check.

## Known limits, stated rather than hidden

* **Wireframe display degrades.** MoltenVK does not expose `VK_POLYGON_MODE_LINE` (Metal has no
  equivalent fill mode). `ViewportRenderer` queries `fillModeNonSolid` and creates the wireframe
  pipeline only if it is advertised; otherwise `view.wireframe` toggles the flag and the viewport
  stays solid.
* **Most workspace panels are surfaces, not features.** Of the 50 distinct panel ids the eight
  default layouts use, 21 have real content: `viewport_*`/`sheet_canvas`, the seven tree panels,
  `properties`/`operation_params`, the four console panels, `timeline`, and — added here —
  `measure` (whole-body and per-face measurement over the live tessellation and the live
  selection) and `archie_tools` (the agent-callable command surface with live availability).
  The remaining 29 are docked, laid out, serialized and restored — and each one says on its face
  that its content is not implemented in this segment, rather than looking finished. They are
  listed in the commit that added the two above; every one of them needs data the app does not
  yet have (a sketch solver, an assembly tree, a CAM setup, an FEA study, a drawing sheet).
* **Selection is faces only.** Edge and vertex picking need the tessellator to hand back edge
  polylines, which it does not yet.
* **Accessibility, printing and i18n remain owed** — carried from D-001, not addressed here.
* **No JavaScript was deleted.** That is segment 3's gate; this segment builds the replacement.
