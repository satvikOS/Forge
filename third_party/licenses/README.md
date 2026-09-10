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
| `LGPL-2.1.txt` | OpenCascade **and** planegcs | OCCT dynamic; planegcs **static** | copied from `/opt/homebrew/opt/opencascade/share/doc/opencascade/LICENSE_LGPL_21.txt`, 26434 B |
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

## planegcs is the heaviest obligation here, and it is not OCCT

OCCT is **dynamically** linked and carries the OCCT LGPL exception. planegcs is
`LGPL-2.1-or-later` (per the SPDX header in every source file) and is **statically**
linked: five objects — `GCS.cpp.o`, `Constraints.cpp.o`, `Geo.cpp.o`, `qp_eq.cpp.o`,
`SubSystem.cpp.o` — are compiled into the shipped `libforge_kernel_core.dylib`.

LGPL-2.1 §6 lets you distribute a work that uses the library, but a **statically**
linked one is only permitted under §6(a)–(e): the recipient must be able to relink
the application against a modified library. Shipping this text satisfies the notice
part and **not** the relink part. Vendoring the licence does not discharge that; it
is tracked as its own item.
