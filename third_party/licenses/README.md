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
| `DearImGui-MIT.txt` | Dear ImGui `v1.92.9 WIP` | **static**, compiled into `forge_desktop` | fetched from `raw.githubusercontent.com/ocornut/imgui/<ref>/LICENSE.txt`, 1083 B, sha256 `173506a2d6f7fb67990d257fb2507f188690eca39060c39469ae7bef43aae2a3` |
| `ProggyClean-MIT.txt` | ProggyClean.ttf, embedded in `imgui_draw.cpp` | **static**, ~9 KB of the binary | fetched from `raw.githubusercontent.com/bluescan/proggyfonts/master/LICENSE`, 1078 B, sha256 `fe61d069df303c697e04200f5f8232c2cb09dd3572f4357b323469f7d592d142` |
| `ProggyForever-MIT.txt` | ProggyForever-Regular-minimal.ttf, embedded | **static**, ~14 KB of the binary | fetched from `raw.githubusercontent.com/ocornut/proggyforever/master/LICENSE.txt`, 1118 B, sha256 `47d329848d81b5ad777bf5eca73509a4d1b730d6e2ca917f03e72010b2f59576` |
| `stb-MIT-or-Unlicense.txt` | stb rectpack / textedit / truetype | **static**, vendored inside imgui | extracted from the file on this machine, `forge-desktop/third_party/imgui/imstb_truetype.h:5046-5084`, 2668 B |

Every file above is a real file, copied or fetched verbatim. Nothing was
transcribed from memory — the same rule `forge_deps.py notices` states in its own
header, and the reason `INCOMPLETE.md` exists rather than a reconstructed MIT text.

## Dear ImGui: closed 2026-09-18, and it was four components, not one

`DearImGui-MIT.txt` was fetched rather than transcribed, and **four upstream refs**
(`v1.92.9`, `v1.92.9-docking`, `master`, `docking`) return a byte-identical file,
sha256 `173506a2...`. Its copyright line, `Copyright (c) 2014-2026 Omar Cornut`,
matches the string in the vendored `imgui.cpp:30` exactly — two independent sources
agreeing is what makes this a provenance record rather than an assertion.

Closing it showed the obligation had been scoped to the *component* and not to the
*artifact*. Dear ImGui compiles two fonts into `forge_desktop` as byte arrays, each
under its own MIT notice naming copyright holders who are not Omar Cornut, and
vendors stb. `imconfig.h:53-55` leaves all three `IMGUI_DISABLE_DEFAULT_FONT*`
macros commented out, so both fonts ship. All four texts are in the table above and
all four are required by `verify_bundle_licences.sh`.

That gate now checks the *content* as well as the presence of each file: a licence
text that exists, is non-empty and discloses nothing would pass a file-exists check.
Each must carry the copyright line it is there to disclose.

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
