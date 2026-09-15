# Licence texts that must ship inside the artifact

`third_party/notices/NOTICES.md` records WHAT we use and hashes the licence file
**in the resolved build prefix**. That is a build-machine path. It means the
published zip contained **no licence text at all**, which is the thing binary
distribution actually requires — an obligation that does not arise for internal use.

These files exist to be copied into `Forge.app/Contents/Resources/licenses/` by
`forge-desktop/package_macos.sh`. Verified present in the bundle by
`third_party/licenses/verify_bundle_licences.sh`.

## What is here, and where each came from

| file | component | linkage into the shipped app | provenance |
| --- | --- | --- | --- |
| `LGPL-2.1.txt` | OpenCascade | dynamic | copied from `/opt/homebrew/opt/opencascade/share/doc/opencascade/LICENSE_LGPL_21.txt`, 26434 B |
| `SDL2-zlib.txt` | SDL2 | dynamic (dylib in Frameworks) | copied from `/opt/homebrew/opt/sdl2/LICENSE.txt`, 884 B |
| `MoltenVK-Apache-2.0.txt` | MoltenVK | dynamic, staged explicitly by the packager | copied from `/opt/homebrew/opt/molten-vk/LICENSE`, 11358 B |

Every file above was copied from a real file on this machine. Nothing was
transcribed from memory — the same rule `forge_deps.py notices` states in its own
header, and the reason `INCOMPLETE.md` exists rather than a reconstructed MIT text.

## The one that is NOT here, and why

**Dear ImGui** is statically linked into `forge_desktop` and its licence text is not
on this machine. `forge-desktop/third_party/imgui/imgui.h` says
`Copyright (c) 2014-2026 Omar Cornut` and `See LICENSE.txt ... (standard MIT
License)` — but that `LICENSE.txt` was never vendored with the subtree, and MIT
requires the notice to accompany the distribution. See `INCOMPLETE.md`.

## planegcs WAS the heaviest obligation here — it is now a shared library

Until 2026-09-15 planegcs (`LGPL-2.1-or-later`) was compiled **statically** into the
shipped `libforge_kernel_core.dylib` — five objects, `GCS.cpp.o`, `Constraints.cpp.o`,
`Geo.cpp.o`, `qp_eq.cpp.o`, `SubSystem.cpp.o` — and this file recorded that shipping
the licence text satisfied the notice part of LGPL-2.1 §6 and **not** the relink part.

That item is closed by construction rather than by paperwork. The solver is now
`libforge_gcs.dylib`, built from `third_party/freecad-derived/sketch-solver` as a
separate shared library behind a versioned C interface, installed in
`Contents/Frameworks` and linked dynamically; no Forge target compiles a planegcs
source. Its own licence text, notice and dated modification record travel with it:
`forge-desktop/package_macos.sh` copies every `third_party/freecad-derived/*/`
component's `COPYING.LGPL`, `MODIFICATIONS.md` and `NOTICE` into
`Contents/Resources/licenses/freecad-derived/<component>/`, and
`verify_bundle_licences.sh` requires them. What remains is a RELEASE obligation —
publishing the modified library source with each release — recorded as the
"Release obligation" line of each component's section in
`third_party/freecad-derived/THIRD_PARTY_NOTICES.md`.
