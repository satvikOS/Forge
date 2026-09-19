# Vendored-component licence sweep

T-156, release gate. Every component of third-party source code that is COPIED
INTO this repository, the SPDX its own source headers carry, the licence the
local note claims for it, how it is linked, and whether it ships.

Measured on `archdisc` at `cbac85c7`. Every cell below came from a command run
against the tree; nothing is recalled. Where two measurements disagreed, the
smaller number is printed and the disagreement is stated.

---

## 0. The denominator

**Vendoring roots: 4 found / 4 searched.** The search was not "look in the two
paths we know about". Thirteen conventional directory names were swept repo-wide:

```
$ find . -type d \( -name '3rdParty' -o -name 'third_party' -o -name 'thirdparty' \
    -o -name '3rdparty' -o -name 'third-party' -o -name 'vendor' -o -name 'vendored' \
    -o -name 'external' -o -name 'externals' -o -name 'extern' -o -name 'deps' \
    -o -name 'contrib' \) -not -path '*/node_modules/*' -not -path '*/.git/*'
./third_party
./tools/deps
./forge-kernel/3rdParty
./forge-desktop/third_party
```

Two of those four were not in the brief. `tools/deps` holds no third-party code
(it is `forge_deps.py` and its tests — first-party tooling that *manages*
dependencies). `forge-desktop/third_party` holds Dear ImGui, which does.

**Vendored source components: 4 found / 4 checked.**
**Licence-bearing units inside them: 11 found / 11 checked** (the 4 components
plus 7 sub-components that carry their own separate licence text).

**Independent cross-check, by a different method.** A repo-wide copyright-holder
sweep over tracked source files returns **10 distinct non-ArchDisc holders**:
Konstantinos Poulios, Victor Titov (DeepSOIC), Jürgen Riegel, Eivind Kvedalen,
Zheng Lei (realthunder), Omar Cornut, Sean Barrett, Tristan Grimmer, Disco Hello,
and the Free Software Foundation. **All 10 map into the 4 components above**, so
the two derivations agree and there is no fifth component hiding behind an
unconventional directory name.

Also checked and **absent**: git submodules (`.gitmodules` does not exist), git
subtree merge markers (`git log --all --grep=git-subtree` is empty), and CMake
source downloads (`FetchContent` / `ExternalProject_Add` are redefined to
`FATAL_ERROR` by `forge-kernel/cmake/ForgeDeps.cmake`; there are no live uses).
`node_modules` is not tracked by git (`git ls-files | grep -c node_modules` → 0).

**OndselSolver is not in this repository.** `grep -ril ondsel` returns 7 files,
all prose in `docs/SCOPE_2026-06-*/` research notes discussing Ondsel's public
writing on FreeCAD's topological-naming problem. There is no OndselSolver code,
no OndselSolver directory and therefore no licence note about it to disagree
with. Forge's own assembly constraint solver is
`forge-kernel/src/AssemblySolver.cpp` — first-party, no third-party copyright
line, no SPDX tag, documented in its header as an original design over
`ComponentRegistry`.

---

## 1. Table A — vendored source (the 4 components)

| # | component | SPDX **per its own source headers** | licence claimed in the local note | linkage | ships? |
|---|---|---|---|---|---|
| 1 | `forge-kernel/3rdParty/planegcs` | `LGPL-2.1-or-later` — 13 of 13 source files, no file without a tag, no second value | `UPSTREAM.md` said **"BSD/LGPL-2.1+"** (corrected by this change); `third_party/notices/NOTICES.md` and `deps.lock.json` say `LGPL-2.1-or-later` | **STATIC** — 5 objects compiled into `forge_kernel` and `forge_kernel_core`, both `add_library(... SHARED ...)` | **YES** — inside `Contents/Frameworks/libforge_kernel_core.dylib` |
| 2 | `forge-kernel/3rdParty/planegcs_eigen_shim` | none — no SPDX tag, no copyright line, no third-party licence text | no note anywhere | header-only, on the include path ahead of any system include | YES (header-only; it is first-party code) |
| 3 | `third_party/freecad-derived/expressions` | `LGPL-2.1-or-later` — 19 of 19 source files (and 22 tracked files in the component in total: the three extra are `CMakeLists.txt`, `build_forge_expr.sh` and `ExpressionParser.sh`) | `THIRD_PARTY_NOTICES.md`, `manifest.json`, `NOTICE`, `COPYING.LGPL`: all `LGPL-2.1-or-later` | **DYNAMIC** — `add_library(forge_expr SHARED ...)`, `@rpath/libforge_expr.dylib` | **YES** — `Contents/Frameworks/libforge_expr.dylib` |
| 4 | `forge-desktop/third_party/imgui` | **none** — not one of the 12 files carries an SPDX tag | `third_party/licenses/INCOMPLETE.md`: MIT, and states the MIT text was never vendored | **STATIC** — `add_library(forge_imgui STATIC ...)` into `forge_desktop` | **YES** — inside `Contents/MacOS/forge_desktop` |

Component 2 is first-party code living in a directory named `3rdParty`. It is a
clean-room `namespace Eigen` shim over `forge::native::linalg`; **no real Eigen
source is in this repository** (`grep -rl 'include <Eigen/'` returns only
planegcs, the shim itself and one linalg test, and `forge-kernel/CMakeLists.txt`
line 198 reads `# Eigen: REMOVED`). It is listed here because a sweep that
silently skipped it would not be a sweep.

### Table A2 — the 7 sub-components with their own licence text

| # | sub-component | inside | licence its own text states | ships? |
|---|---|---|---|---|
| 5 | `stb_rect_pack.h` 1.01 | `imstb_rectpack.h` | dual: `ALTERNATIVE A - MIT License / Copyright (c) 2017 Sean Barrett`, `ALTERNATIVE B - Public Domain (www.unlicense.org)` | YES, static |
| 6 | `stb_textedit.h` 1.14 | `imstb_textedit.h` | same dual text, Sean Barrett | YES, static |
| 7 | `stb_truetype.h` 1.26 | `imstb_truetype.h` | same dual text, Sean Barrett | YES, static |
| 8 | ProggyClean.ttf (embedded font data) | `imgui_draw.cpp:6358` | `// MIT License / Copyright (c) 2004, 2005 Tristan Grimmer` | YES, static |
| 9 | ProggyForever-Regular-minimal.ttf | `imgui_draw.cpp:6548` | `// MIT license / Copyright (c) 2026 Disco Hello, Copyright (c) 2019,2023 Tristan Grimmer` | YES, static |
| 10 | GNU Bison 3.8.2 parser skeleton | `Expression.tab.c`, `Expression.tab.h` | GPL-3.0-or-later **plus the Bison special exception** (see §2, finding B) | YES, in `libforge_expr.dylib` |
| 11 | flex 2.6.4 scanner skeleton | `Expression.lex.c` | the generated scanner carries **no** flex copyright block; its only embedded copyright is FreeCAD's, from `Expression.l` | YES, in `libforge_expr.dylib` |

### SPDX census, whole repository

```
$ git ls-files | while read f; do head -5 "$f" | grep -qE '(^|[/#* ])SPDX-License-Identifier:' && echo "$f"; done | wc -l
35
```

35 tracked files carry a real SPDX tag in their first five lines: **13 planegcs,
22 expressions (19 sources + 3 build scripts), 0 everywhere else**. One value only, `LGPL-2.1-or-later`.

*Two measurements disagreed and the smaller is printed above.* Counting raw
line hits instead of files gives 42, and a parallel sweep reported 38. Both are
larger because they count prose: the `grep -qE` pattern inside
`tools/gates/freecad_derived_lgpl_gate.sh`, a fixture line in its selftest, the
`"note"` strings in `deps.lock.json` and `NOTICES.md`, the prose in this
component's `UPSTREAM.md`, and `Expression.lex.c`, which carries the tag twice
(prepended at line 1 and again at line 8564 inside the embedded FreeCAD header).
35 is the count of files that actually declare a licence, and it is the honest
one.

---

## 2. Note-vs-header disagreements — the list is NOT empty. Three.

**The instrument, and proof it is not quiet.** The detector reads each
component's SPDX tags and embedded licence text out of its own sources, reads
the licence names out of every local note, and prints both. If a component had
this problem, it would print two different values on the `headers ->` and
`note ->` lines. Run against the tree **before** this change, on the known-bad
case, it printed exactly that:

```
forge-kernel/3rdParty/planegcs
    headers  -> LGPL-2.1-or-later
    note UPSTREAM.md -> BSD/LGPL-2.1+,LGPL-2.1-or-later      <-- fires
```

So the detector is known to fire. The three findings below are what it found
when pointed at all 4 components, not an assertion that nothing else was wrong.

### Finding A — planegcs: the note was softer than the headers. **FIXED by this change.**

- Headers, 13 of 13: `LGPL-2.1-or-later`. No file offers a BSD alternative.
- `UPSTREAM.md:5` said: *"It is BSD/LGPL-2.1+ licensed"*.
- "BSD/LGPL" invites a permissive reading that no file in the directory
  supports. A reviewer who read the note instead of the sources would conclude
  there was nothing to do.
- Corrected in `forge-kernel/3rdParty/planegcs/UPSTREAM.md`, which now quotes
  the census and a header line verbatim.
- **The detector still prints `BSD/LGPL-2.1+` for this component after the fix**,
  because the corrected note quotes the old wording in order to retract it. That
  is a false positive of a literal-string rule, disclosed here rather than
  tuned away.

### Finding B — expressions: a Bison skeleton under an LGPL tag it did not come with.

- `Expression.tab.c` and `Expression.tab.h` begin with
  `// SPDX-License-Identifier: LGPL-2.1-or-later`.
- That line is **not inherited from any upstream header**. It is prepended by
  Forge's own regeneration script:
  `third_party/freecad-derived/expressions/src/ExpressionParser.sh:44`.
- Immediately below it, the skeleton's own notice reads *"Copyright (C) 1984,
  1989-1990, 2000-2015, 2018-2021 Free Software Foundation, Inc. … under the
  terms of the GNU General Public License … either version 3"*, followed by
  *"As a special exception, you may create a larger work that contains part or
  all of the Bison parser skeleton and distribute that work under terms of your
  choice"*.
- So the file's own text says GPL-3.0-or-later WITH Bison-exception-2.2; the tag
  on line 1 says LGPL-2.1-or-later. The Bison exception is exactly what makes the
  LGPL distribution work, so this is a **labelling** gap, not a licence conflict —
  but no note in the tree mentions the exception, and the tag alone does not
  record why the skeleton may be shipped this way. `MODIFICATIONS.md` describes
  how the files are generated and by which tool versions; it does not name the
  exception.
- Not fixed here. Fixing it means either an `SPDX-FileCopyrightText` /
  `GPL-3.0-or-later WITH Bison-exception-2.2` line on the generated files or a
  paragraph in `MODIFICATIONS.md`, and `freecad_derived_lgpl_gate.sh:144`
  currently *requires* an LGPL-2.1 tag in the first five lines of every source
  file — so the two would have to change together. That is a build-adjacent
  change and is out of scope for T-156.

### Finding C — Dear ImGui: the note under-counts what is embedded.

- `third_party/licenses/INCOMPLETE.md:16-17` says *"The only MIT text under
  `forge-desktop/third_party/imgui/` is stb's, inside `imstb_rectpack.h`"*.
- Measured: the same dual-licence text is in **three** files —
  `imstb_rectpack.h:591`, `imstb_textedit.h:1491`, `imstb_truetype.h:5049` — and
  each is **MIT *or* Public Domain (Unlicense)**, a dual grant the note does not
  mention.
- Two further embedded components with their own MIT notices are named nowhere:
  the ProggyClean and ProggyForever font data compiled into `imgui_draw.cpp`
  (rows 8 and 9 above), holders Tristan Grimmer and Disco Hello.
- Direction matters: this note **under-states** what is shipped, so it does not
  create a permissive misreading the way Finding A did. It does mean the app's
  disclosure names 1 obligation where 4 exist. Dear ImGui's own `LICENSE.txt` is
  still not vendored — `INCOMPLETE.md` says so, and that remains true.
- Not fixed here: closing it requires fetching upstream licence text, which is a
  network fetch and a separate change.

### Checked and clean

- `third_party/freecad-derived/expressions` **itself** (as distinct from its
  generated files): headers, `NOTICE`, `COPYING.LGPL`, `MODIFICATIONS.md`,
  `manifest.json` and `THIRD_PARTY_NOTICES.md` all say `LGPL-2.1-or-later`, and
  `COPYING.LGPL` is sha256-pinned to the shipped LGPL text. No disagreement.
- `planegcs_eigen_shim`: no note exists, so there is nothing to disagree; but
  see §4.
- `third_party/notices/NOTICES.md` and `deps.lock.json` on planegcs: both
  already said `LGPL-2.1-or-later` and were never wrong.

---

## 3. Table B — ships or is recorded, but is NOT vendored source

Included because a sweep confined to copied source would miss what actually
leaves the building. These are resolved at build time, not copied in.

| component | SPDX per `deps.lock.json` | linkage | ships? | record |
|---|---|---|---|---|
| opencascade 7.9.3 | `LGPL-2.1-only WITH OCCT-exception-1.0` | dynamic | YES | in lock + NOTICES + `LGPL-2.1.txt` staged |
| boost 1.90.0 | `BSL-1.0` | headers only | no | in lock; licence text **NOT FOUND** in the prefix — recorded INCOMPLETE |
| node-addon-api 8.8.0 | `MIT` | headers only | no | in lock |
| vulkan-headers / vulkan-loader / glslang / molten-vk | `Apache-2.0`, `BSD-3-Clause AND Apache-2.0` | headers / dynamic / build tool / runtime ICD | MoltenVK YES | in lock; MoltenVK text staged |
| SDL2 → sdl2-compat → SDL3 | (not in the lock) | dynamic, `Contents/Frameworks` | **YES** | `SDL2-zlib.txt` staged; **no NOTICES.md entry** — `INCOMPLETE.md` says the entry "is still owed" |
| Dear ImGui | (not in the lock) | static | **YES** | Table A row 4; no licence text in the bundle |

**A distribution path the licence machinery does not cover.** Everything above
concerns `forge-desktop/package_macos.sh`, which builds the native `Forge.app`.
`electron-builder.yml` describes a second artifact that bundles
`frontend/dist/**/*` and publishes it to GitHub Releases. That bundle contains
the frontend's 17 direct npm dependencies compiled into a Vite build — including
`opencascade.js 2.0.0-beta.b5ff984` (a prebuilt OCCT WASM binary, imported by 25
files under `frontend/src/`), `manifold-3d`, `cesium` and `three`. None of them
appear in `deps.lock.json`, in `NOTICES.md`, or in `third_party/licenses/`, and
`package_macos.sh` never touches that tree. Stated as a boundary of this sweep,
not adjudicated: whether that Electron artifact is still published is a release
question, and if it is, its dependency licences are a separate ledger.

---

## 4. Two smaller observations

1. **A first-party component sits in a directory named `3rdParty`.**
   `planegcs_eigen_shim` is Forge's own code with no note recording that. Anyone
   auditing by directory name will count it as vendored and look for an upstream
   that does not exist. A one-line `UPSTREAM.md`-style note saying "first-party,
   no upstream" would close it.
2. **Adding a `.md` to `third_party/licenses/` ships it to users.**
   `package_macos.sh:228-232` copies **every** `*.txt` and `*.md` in that directory
   into `Forge.app/Contents/Resources/licenses/`. That is why this sweep and the
   options memo live at `third_party/` and not beside `INCOMPLETE.md`: they are
   internal documents and would otherwise be published inside the application.

---

## 5. What this sweep did NOT do

It did not adjudicate any licence question, and it changed no build file. The
one static-linkage question it raises — planegcs — is costed, without a
recommendation to adopt, in `third_party/PLANEGCS_STATIC_LINK_OPTIONS.md`.
