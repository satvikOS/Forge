# `forge-desktop` — the Forge CAD workstation

A real, runnable application: an SDL2 window, a Vulkan-on-MoltenVK device and swapchain, Dear ImGui,
a 3D viewport over a body the kernel actually built, and the `forge::ui` service layer driving all
of it.

Before this segment `forge-desktop/` was six headless probe programs and nothing rendered. The probes
are still here and still build — they are what proved the backend, and `renderer_probe.cpp` is where
the PNG writer in `src/PngWriter.hpp` comes from.

## The document, and the edge that was missing

The window, the dock tree, the ribbon, the tree panel and the viewport all worked before this change,
and **running a command still changed nothing you could see**, because the app had three disconnected
document models and no edge between them:

* `KernelScene` owned real geometry that was **hardcoded in C++** (`makeBox -> cut -> filletEdges`)
  and was built exactly once, from `main.cpp`;
* `forge::ui::PartDocument` was what the Part commands actually appended feature-IR to — and it
  was rendered as **one line of text** in the Properties panel and nowhere else;
* `ForgeShell::DocumentStats` was a set of counters that `file.*`/`edit.*` incremented, feeding the
  status strip. `edit.undo`'s entire body was `--doc_.undoDepth; ++doc_.redoDepth; ...`.

All three showed at once and disagreed: the tree said *Plate / Bore / Fillet*, Properties said
`%1 = BOX(80, 50, 20)`, and the status strip said `features 0 undo 0 redo 0`. There was also no
document file format of any kind — `file.open`'s whole execute body was `doc_.dirty = false;`, and it
never read its own `path` argument.

There is now **one document**, and one edge:

```
the ONE registry -> PartDocument -> irProgram()
                 -> forge::ft::parse -> forge::ft::compile
                 -> forge::tessellate -> the viewport's vertex stream
                 -> .fpart on disk -> back into a document -> the same solid
```

`KernelScene::buildFromIr()` is the only way geometry enters the scene, so what the viewport draws is
by construction what the document says. `KernelScene::build()` — the part the app opens on — is that
same call over `defaultPartIr()`, from the same table `ForgeFrame` seeds the document with, so the
starting part **is** a document rather than a second hand-written body beside one.

`ForgeFrame` implements the new `forge::ui::DocumentHost`, so the shell keeps its **one**
`file.new` / `file.open` / `file.save` / `edit.undo` / `edit.redo` and delegates what they *mean* to
whoever owns the document. With no host installed every counter behaves exactly as before, which is
why the eleven existing `forge::ui` gates are unchanged.

### The document is PARAMETRIC now

`PartDocument::appendFeature()` refuses any statement not numbered `nextIrId()`, so until
`part.edit_feature` existed the document was **append-only**: nothing a user could do anywhere in
the app changed a number already in the program. The starting part was worse than that — its five
statements are *seeded*, so they carry no undo step and undoing all the way to the bottom could not
reach them. The plate you open on was 80 x 50 x 20 with a d12 bore and r3 corners, permanently.

`part.edit_feature(feature, index, value)` rewrites one argument of one statement in place.
`feature` is a 1-based statement id and **0 means the last statement**; `index` counts only the
NUMBER arguments, so index 0 of `CYL(6, 40, 0, 0, -10)` is the radius and index 0 of
`FILLET(%4, 3, VERTICAL)` is the radius too — the caller never has to know that one leads with a
`%ref`. The Properties panel drives it, and clicking a **feature row** in the tree aims it (that
click used to do nothing at all).

It is deliberately narrow, and the narrowness is the safety property. The statement's id and op are
pinned, and **every `%ref` is pinned by position** — moving a ref rewires the dependency graph, and
a "change the radius" control that can silently reparent a feature is the bug the rule exists to
make impossible. `PartDocument::EditCheck` names each refusal (`operand_changed`, `no_change`,
`no_such_feature`, `invalid_statement`) rather than failing silently, and a refused edit mutates
nothing. What may change is every non-ref argument, and the arg *count* within the op's documented
arity, so `FILLET(%4, 3, VERTICAL)` may become `FILLET(%4, 3)` — `validateIr()` stays the single
authority on arity.

`EditFeatureArgsEdit` is the one place GoF's cheaper undo alternative is the right one: an arg edit
absorbs no name bindings, so "store enough state to reverse the effect" is exactly the old argument
list. `PartDocument::Snapshot` could not have served — it is a record *count* plus the binding
table, so `restore()` truncates and would not put a changed argument back.

### `.fpart`

A line-oriented, versioned text format (`src/PartFile.{hpp,cpp}`). It stores each feature
**structurally** — `OP` plus one `ARG <kind> <value>` line per argument, with the tree label, the
authoring command and the selection node — and *derives* the IR program text from that with the same
`IrLine::text()` the live document uses. Storing `irProgram()` instead would be lossy (no labels, no
selection bindings) and would need a second IR parser in the UI's vocabulary beside
`forge::ft::parse`. `document_gate` proves `write(read(x)) == x` byte for byte, and that a reopened
document rebuilds the identical solid.

Two things measured while building this, both recorded in the code:

* `forge::ft::compile` is documented "Never throws for a modelling failure". **That is false.**
  `SHELL(%5, 3)` on this bracket lets an OCCT `Standard_ConstructionError` escape — not a
  `std::exception`, so a `catch (const std::exception&)` misses it and `std::terminate` would end the
  session on a menu click. `buildFromIr` catches both, and the gate asserts the app survives it.
* The compiler runs an s0.4 graph-quality gate that fails the **whole** program when any op
  "contributes nothing to the result". A seeded-but-unconsumed profile is therefore not a harmless
  convenience, and the default part is a connected chain for that reason.

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
| `--open <path>` | open a `.fpart` document on launch — through the same `file.open` the menu dispatches, not a private loader beside it. A bare trailing path does the same, which is what a file manager hands the binary. |

State — workspace, dock layout per workspace, input profile and the whole keymap — is written to
`~/.forge/shell_state.txt` on exit and read back on launch.

## What is wired to what

Nothing in `src/` reimplements a service. The whole point of the segment is that the application is
a *consumer* of `forge::ui`.

| service (`ui/`) | what it drives in the app |
| --- | --- |
| `CommandRegistry` | the menu bar, the workspace ribbon, the command palette and the viewport context menu are all **generated from the registry**. There is no hand-written menu table. A greyed item is greyed by `evaluate()` — the same call `dispatch()` makes — so a menu can never disagree with the dispatcher. |
| `PartCommands` | `registerPartCommands()` puts the Part commands into the **same** registry the shell dispatches through, via `ForgeShell::registry()`. 13 shell commands + 22 Part = 35. The count is not spelled anywhere a gate reads: `partCommandIds()` is the source, and `capability_manifest_test` re-renders the live registry into `implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv` so a command added without recording it is red. |
| `SelectionService` | viewport hover sets preselection, a click sets selection and focus, the status strip's filter combo is `setFilter()`. Everything resolves to an `EntityRef` with a persistent name (`face@7`), never a raw index. |
| `Keymap` | key presses that ImGui does not want as text go to `ForgeShell::key()`. Multi-stroke sequences report `Pending` and are held. Switching input profile switches the shortcut table **and** the viewport's mouse-drag verbs at once. |
| `DockLayout` | the dock tree is walked into rectangles and one borderless ImGui window is placed per tab group. Splitter drags and tab clicks write **back into the tree**, so what you arranged is what gets serialized. |
| `WorkspaceProfile` | the eight workspace tabs. Switching saves the current layout and restores that workspace's. |
| `FeatureTreeModel` | the feature-tree panel reads through `window()` under an `ImGuiListClipper`, so the expensive per-row record is materialized only for rows on screen, and a second identical frame costs the source zero new fetches. |
| `PartDocument` / `UndoStack` | **the document.** `ForgeFrame` owns it, the Part commands append to it — and `part.edit_feature` **rewrites** a statement already in it — and its IR program is what the viewport is built from. Its undo stack is what `edit.undo` unwinds. |
| `forge::ft` | `parse` + `compile` turn the document's IR program into a solid. `KernelScene::buildFromIr()` is the only door; there is no hand-written geometry left in the app. |
| `forge::tessellate` | the viewport's triangles, from the solid `forge::ft` just compiled. The mesh is de-indexed so every vertex carries the per-triangle OCCT face id that face picking needs. |

## Layout of the source

```
src/KernelScene.{hpp,cpp}       the ONLY TU that includes an OCCT or forge-kernel header.
                                buildFromIr() is THE edge: IR program -> solid -> triangles.
src/PartFile.{hpp,cpp}          the .fpart document format + the table the default part comes from
src/Camera.{hpp,cpp}            turntable camera + the four profiles' mouse-drag verbs (pure math)
src/ForgeFrame.{hpp,cpp}        one ImGui frame of the shell, AND the document owner
                                (forge::ui::DocumentHost). Touches NO GPU state — which is what
                                lets the gates build real frames in CI with no display.
src/ViewportRenderer.{hpp,cpp}  the geometry pass into an offscreen colour+depth target, handed to
                                ImGui as a texture. The only class outside main.cpp naming a Vk type.
src/PlatformSDL2.{hpp,cpp}      first-party SDL2 -> ImGuiIO platform backend
src/PngWriter.hpp               dependency-free RGBA8 PNG, for --screenshot
src/main.cpp                    window, device, swapchain, frame loop, persistence
test/frame_gate.cpp             188 headless checks + 9 injectable mutations
test/document_gate.cpp          186 headless checks + 8 injectable mutations: the document edge,
                                end to end, including a real .fpart on a real disk
test/ir_pipeline_gate.cpp       18 checks: a UI-authored IR program compiles to a measured solid
test/click_gate.cpp             1144 headless checks + 5 injectable mutations. The one gate that
                                INTERACTS: it drives io.AddMousePosEvent / io.AddMouseButtonEvent
                                to click every dock tab and drag every splitter in all 8
                                workspaces. Built with -fsanitize=address.
test/run_click_gate.sh          the same gate, compiled DIRECTLY (no SDL2, no Vulkan, no CMake)
                                so it runs in the kernel CI job -- the first CI step in this repo
                                that compiles forge-desktop/src at all
test/run_desktop.sh             build + all five gates + the 29-mutation proof

src/update/Version.{hpp,cpp}    semantic version parsing + SemVer 2.0.0 ordering. The one place
                                "is B newer than A" is answered; a string compare here is the
                                defect update_gate --mutate 1 reproduces
src/update/Sha256.{hpp,cpp}     SHA-256, implemented rather than linked, so the gate can assert it
                                against the published NIST vectors
src/update/Manifest.{hpp,cpp}   the appcast: a STRICT flat-JSON parser (no nesting, no duplicate
                                keys, 64 KB cap) + https/host/pinned-URL admissibility
src/update/Updater.{hpp,cpp}    decide() and the install path: download, verify sha256, stage with
                                ditto, validate the ad-hoc signature, renamex_np(RENAME_SWAP).
                                Exactly ONE function here touches the network
src/update/main_update_cli.cpp  `forge_update check|apply` — the same library from a shell
emit_appcast.sh                 writes appcast.json from the MEASURED zip; the producer half of the
                                contract src/update/Manifest.cpp consumes
test/update_gate.cpp            132 headless checks + 7 injectable mutations, offline
test/appcast_check.cpp          runs the app's real parser over a generated appcast
test/run_update_gate.sh         compile + run the update gate with ONE c++ call (no kernel, no OCCT)
test/appcast_selftest.sh        proves the bash producer and the C++ consumer agree
```

## The gates

All five are headless: no window, no swapchain, no MoltenVK, no display. `ctest --test-dir
forge-desktop/build` runs them; `run_desktop.sh` runs them *and* the mutation proof.

`forge_desktop_ir_pipeline_gate` drives the real `registerPartCommands()` registry, takes
`PartDocument::irProgram()`, and runs it through `forge::ft::parse` + `compile`, asserting on
validity, face and edge counts, volume **and** the bounding box. It existed before this change and
was built only by a standalone script — the one edge that authorises deleting the JavaScript was a
gate nobody's build ran. It is a CMake target now.

`forge_desktop_document_gate` is the user-launchable slice: the starting part compiles through
`forge::ft`; the seeded document and the compiled program are the same text; a `part.fillet`
dispatched through the **one** `ForgeShell::run` drives a real kernel rebuild that changes the
triangle count, the face count and the volume, without moving the plate in X or Y; `edit.undo`
restores the *original geometry*, not just a counter; `file.save` writes a file that starts with the
magic and holds one `FEATURE` block per statement; `write(read(x)) == x` byte for byte; `file.new`
then `file.open` rebuilds the identical solid and keeps the selection binding; a command still
dispatches onto the reopened document; and an op that throws inside OCCT is caught, leaving the last
good body on screen. Geometry is never accepted on volume alone — every geometric claim is a vector
of triangles, face ids, face count, edge count, volume and bounding box.

Its eight mutations:

| mutation | the regression it stands for |
| --- | --- |
| 1 | the document is never synced to the scene → the viewport ignores commands (6 checks red) |
| 2 | the `.fpart` writer drops the node bindings → a reopened document loses them |
| 3 | save/load skips the file → the round trip is not a round trip (9 checks red) |
| 4 | the body node is a hard-coded literal → a document that names its body anything else is unpickable and every solid command on it refuses |
| 5 | the feature tree is bound to a SECOND, private history → the rows are a stale copy of a document nobody is editing |
| 6 | the tree is bound to a history that is a list of NAMES → the rows describe the wrong statements |
| 7 | the keystroke dispatches with a bare id instead of through the chord resolver → the shortcut dies on a multi-stroke sequence |
| 8 | the parameter editor is aimed by TREE ROW POSITION instead of by STATEMENT ID → it edits the statement before the one the user picked, and the part silently never changes (13 checks red) |

`forge_desktop_frame_gate` builds **real frames of the real shell** — no window, no swapchain, no
MoltenVK — and asserts values against references: the bounding box is 80x50x20 to within the
tessellation deflection, every vertex carries a face id, a centre ray hits and a reversed ray misses,
CATIA's middle-drag pans while NX's rotates, the eight workspaces each draw four panels, a splitter
drag lands in the dock tree, save→load→save is byte-identical, and unplugging a monitor loses no
panel.

`run_desktop.sh` then injects nine more defects in turn and **requires each to turn it red**:

| mutation | the regression it stands for |
| --- | --- |
| 1 | the frame builder is never called → the shell draws nothing |
| 2 | Part commands are not registered → the one registry is short by every Part command |
| 3 | a pick is not routed to the selection → no vertex is flagged for the shader |
| 4 | the tree panel calls the source's expensive fetch per row instead of `window()` |
| 5 | the projection loses its Vulkan Y-flip → the picking ray and the image disagree |
| 6 | the Measure panel is not fed the live selection → it measures nothing (7 checks red) |
| 7 | the Tools panel answers from a stale selection → it offers a tool that refuses (2 checks red) |
| 8 | the viewport ignores the selection filter → "pick an edge" picks a face, and the three edge tools stay unreachable (13 checks red) |
| 9 | the frame never pulls the shell's fit request → `view.fit` journals "ok" and the camera does not move |

### `forge_desktop_click_gate` — the one that CLICKS

The three gates above render frames. **None of them clicks anything**, and that is exactly the shape
of the hole two defects went through on 2026-08-30.

The first was a call to `KernelScene::features()`, a method that no longer existed: the app was
UNBUILDABLE for hours and nothing went red, because nothing in CI compiled `forge-desktop/src`. The
second was worse, because it shipped. Clicking a dock tab SIGSEGV'd the installed app on the FIRST
click, `EXC_BAD_ACCESS` at `0x17`. `drawTabGroup()` holds a `const DockNode&` into the live layout
while it walks; the tab button called `setActiveTabAt()`, whose last line is
`shell_.layout() = std::move(rebuilt)`, which destroys every node the recursion is holding — and the
next statement reads `node.panels[active]` out of freed memory. `0x17` is 23 bytes into a libc++
`std::string`: the size byte of the short-string form, so the fault was a dangling string header.
`frame_gate` and `document_gate` both passed throughout. `frame_gate` calls `setActiveTabAt()`
*directly*, from outside the walk — the one way to change a tab that was never broken.

This gate enumerates every dock tab in every workspace, **clicks** each one through the real ImGui
input queue, and steps **at least one FURTHER frame** after each click before it asserts. That last
part is the whole point: the crash was the next read through a reference the click had already
freed, so a click with no following frame would have gone green on an app that was already broken.
It does the same for splitter drags, which had the identical hazard — `drawSplitter()` wrote through
`setRatioAt()` from inside the walk, and `drawNode()` reads `node.children[1]` on the next line.

Two independent instruments, because one can go quiet:

* **A value.** `ForgeFrame::layoutReseatsDuringWalk()` counts every re-seat that happens while the
  draw is walking the tree. The only correct value is zero. It is a LIFETIME total, not a per-frame
  one — measured: with it reset each frame the gate stayed green against the reverted fix, because
  the assertion is made after the FOLLOWING frame, which had already zeroed it.
* **The sanitizer.** The whole first-party stack is recompiled under `-fsanitize=address` for this
  executable only, so reading freed memory is a report and not a coin flip. Mutation 3 is the
  positive control for it.

Both writers also refuse to re-seat the layout mid-walk, deferring to the end of the frame instead.
That is what makes the counter observable at all: without it every violation kills the process
before anyone can read the count, and an unfalsifiable check is not a check.

Its five mutations:

| mutation | the regression it stands for |
| --- | --- |
| 1 | the pointer never reaches the tab → the press lands on empty air and no tab activates (66 checks red) |
| 2 | no FURTHER frame after the click → the panel behind the clicked tab never comes up (96 checks red) |
| 3 | the historical use-after-free, performed on purpose → the sanitizer must catch it. If this one STAYS GREEN, `-fsanitize=address` is not reaching the binary and half this gate is silent |
| 4 | only the first workspace is exercised → the tab census goes unmet |
| 5 | the splitter is pressed but never dragged → no ratio moves (24 checks red) |

`run_click_gate.sh` builds and runs the same gate **without CMake, SDL2, the Vulkan loader, glslang
or MoltenVK** — `imgui_impl_vulkan.cpp` is the only vendored file that needs a Vulkan header, and it
is the one file this gate does not compile. That is what lets it ride the existing `kernel` CI job,
which already installs OCCT and already builds `forge_kernel_core`: about 35 s measured on an
M-series workstation, on the order of 2–3 minutes on a macOS runner. It is the first CI step in this
repository that compiles `forge-desktop/src` at all, so the *unbuildable* defect is a red build here
too — verified by re-injecting `scene_.features()`, which gives exit 3 and
`no member named 'features' in 'forge::desktop::KernelScene'`.

A mutation that stays green fails the script, because a check that cannot fail is not a check.

## Updating — why the Gatekeeper prompt is one-time

Forge ships **ad-hoc signed** from GitHub Releases. There is no Developer ID certificate, so
`spctl -a -t exec` says *rejected* and always will; that is a signature **policy** verdict, not a
broken build — `codesign -v --deep --strict` exits 0, and the app runs normally once admitted.

What a user actually sees is the first-launch dialog, and that dialog is driven by the
`com.apple.quarantine` extended attribute, which is applied **by whatever program did the
downloading**. A browser sets it. `/usr/bin/curl` does not. Measured on a loopback HTTP server (no
external network):

```
$ curl -sfL -o via_curl.bin http://127.0.0.1:8731/probe.bin
$ xattr via_curl.bin
                       # nothing: no com.apple.quarantine
```

So the whole distribution decision rests on one property: **the update is downloaded and installed
by the already-running app, never handed to the browser.** Do it the other way and every version
re-quarantines and the user sees the scary dialog again, for ever. The user clears it **once**, at
first install, via System Settings → Privacy & Security → *Open Anyway*. (Right-click → Open was
removed in macOS 15; instructions that still say it are out of date.)

The second measured fact is why `stageBundle()` strips the attribute anyway: `ditto -x -k`
**does** propagate `com.apple.quarantine` from a quarantined archive to the bundle it extracts. Our
archive is not quarantined because curl fetched it, but the strip costs one process and removes the
only route by which a quarantined bundle could reach the swap. `update_gate.cpp` quarantines its
fixture archive on purpose and asserts the staged bundle comes out clean.

### The path

```
appcast.json  (https://github.com/<repo>/releases/latest/download/appcast.json)
              A DRAFT release does not resolve as "latest" -- measured, not
              assumed: this repo's only release is the draft v0.1.0-alpha.0 and
              `gh api repos/satvikOS/Forge/releases/latest` returns 404. So the
              "a human presses Publish" gate is automatically the gate on
              auto-update, and nothing extra had to be built for it.
    |  parseManifest   strict flat JSON, no nesting, no duplicate keys, 64 KB cap
    v
decide()      schema, arch, channel, prerelease policy, https + host allow-list,
    |         payload URL pinned to ONE release, declared size cap, and version
    |         ordering that only ever moves FORWARD
    v
Fetcher::get  /usr/bin/curl via posix_spawn — no shell. --proto =https and
    |         --proto-redir =https, so no redirect can leave TLS; --max-filesize
    |         and --max-time from the manifest and the policy
    v
verifyPayload sha256 + size against the manifest, BEFORE anything is unpacked
    v
stageBundle   ditto -x -k into a sibling of the installed app (same volume, so
    |         the rename below is a rename), then xattr -dr com.apple.quarantine
    v
validate      *.app, a real executable, Info.plist version == the manifest's, and
    |         codesign --verify --deep --strict (which ad-hoc satisfies; spctl,
    |         which it never can, is consulted nowhere)
    v
atomicSwap    renamex_np(RENAME_SWAP): ONE syscall, so there is no instant at
              which /Applications/Forge.app is missing or half-written
```

Every failure leaves the installed app untouched. The displaced bundle survives the swap, so a
rollback is possible.

### Trust model, stated plainly

Auto-update downloads code and runs it as the user. What defends it: TLS to github.com (this
authenticates the **manifest**); the manifest's sha256 (this closes the gap between the two
requests — a swapped asset URL, a poisoned cache, a truncated transfer); a monotonic version (a
replayed old manifest cannot roll a user back onto published bugs); and validation of the staged
bundle before the swap.

**Not** defended: a compromised GitHub account. Closing that needs an Ed25519 signature over the
manifest with the public key compiled into the app, so the release credentials and the signing key
are separately held. It is **not implemented**, and it is written down here rather than implied by
silence.

### Running it

```bash
# offline: the gate and all seven negative controls, no kernel, no OCCT, ~10 s
bash forge-desktop/test/run_update_gate.sh --mutations

# offline: the bash producer and the C++ consumer agree on the appcast
bash forge-desktop/test/appcast_selftest.sh

# against the real release (this is the only thing here that uses the network)
forge_update check
forge_update apply --app /Applications/Forge.app --relaunch
```

`forge_update check` exits 0 when an update is available, 10 when already current, 1 when refused.

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
  polylines, which it does not yet. A command that consumes an edge therefore takes the *body's*
  selection node and the op's own selector keyword (`ALL`, `VERTICAL`), not a picked edge.
* **There is no file dialog.** `file.open` needs a path, and the app has no chooser to produce one:
  it comes from `--open`, from a trailing argument, or from a caller of the registry. `file.save`
  with no path writes `~/.forge/<name>.fpart` and says so in the status strip, rather than failing a
  keyboard save.
* **A failed rebuild keeps the last good body on screen** and marks the offending row, which is what
  history-based CAD does — but it does mean the viewport can show a solid the document no longer
  describes. The Properties panel says `REBUILD FAILED` with the reason whenever that is true.
* **There is no sketcher yet**, so the profile in the default part is authored by the seed table, not
  by the user. `Sketcher.hpp` exists in the kernel; the UI-side document for it does not.
* **Accessibility, printing and i18n remain owed** — carried from D-001, not addressed here.
* **No JavaScript was deleted.** That is segment 3's gate; this segment builds the replacement.
