# Sacrosanct execution — decision record

Each entry: the question, the constraints, what the evidence says, what was chosen, what was
rejected and why, whether it is reversible, and the measurement that would settle it.

---

## D-001 — Desktop UI stack: **Dear ImGui** — **RESOLVED by the user, 2026-08-28**

**Decision.** Dear ImGui, **not** Qt — but it must deliver the robustness, UI/UX system design,
layout, framework, structure, shell, browser/tree ("branches"), and overlays of **Siemens NX,
CATIA, and Blender**, in pure C++. A CAD workstation, not a debug overlay.

**Standing of this decision against Sacrosanct.** §19.2 names Qt 6 Widgets + KDDockWidgets. The
user has overridden that specific *technology* selection while keeping every *capability* §19.2
requires. This is the permitted direction of change: Sacrosanct says an implementation "may improve
these requirements but may not silently weaken them." Nothing is weakened here — the capability
list below is carried over verbatim and is now owed on ImGui. §19.2's technology row is superseded;
its contract rows are not.

**Why this is coherent rather than a shortcut.** The repository's own
`docs/FORGE_CPP_MIGRATION.md` §1.2 already argued this position in detail on 2026-07-16 — headed
"NOT Qt", with four recorded grounds. Two of them survive scrutiny independently of taste:

1. **Licensing.** Qt LGPLv3 permits proprietary use only via dynamic linking and compels a
   *prominent in-user-interface notice*. Forge is free-but-proprietary and wants a statically
   linkable binary. Sacrosanct Law 16 binds the *dependency stack* to be open source and
   source-buildable — it does **not** make Forge itself open source, so it never dissolved this
   obligation. KDDockWidgets (GPL/commercial) raised the same question again. **ImGui is MIT.**
   Both obligations disappear rather than being accepted.
2. **Latency.** ImGui emits draw lists into the *same* command buffer as the CAD scene — no second
   context, no per-frame FBO copy, and overlays can blend freely over geometry (translucent HUDs,
   modal sketch dimming, radial menus over the part).

The capability argument that favoured Qt — accessibility trees, rich-text, printing, deep i18n —
is real and is **not** waived. It becomes owed work on the ImGui path, recorded below.

**What is now owed (carried from §19.2 and §19.2.1, unchanged):**
- One versioned C++ command registry. Every command has a stable ID, label, category, shortcut,
  required selection signature, enabled predicate, parameter schema, preview policy, side-effect
  class, undo contract, and equivalent feature-IR operation. Menus, toolbars, command search,
  context and radial menus, shortcuts, macros, **and Archie tool calls** all route through it. The
  UI is never wired directly to a widget callback.
- A typed selection service with separate preselection / selection / focus / committed states,
  resolving to stable topology references — never a raw face index.
- Saveable dockable workspaces with deterministic default layouts and multi-monitor recovery. This
  is the one thing KDDockWidgets would have supplied for free; on ImGui it must be an explicit
  dock/layout serialization model, and it is now a first-class deliverable rather than a library
  call.
- Workspace profiles: Part, Sketch, Assembly, Surface, Manufacturing, Drawing, Simulation, Archie.
- Input-map profiles — Forge-native, NX-like, CATIA-like, Blender-like — over the *same* command IDs.
- A feature-tree UI that virtualizes enormous graphs (§19.4).
- **Accessibility, printing, and i18n remain owed.** They were Qt's strongest argument. Choosing
  ImGui converts them from free wins into scheduled work; it does not delete them. Tracked as
  follow-on, not silently dropped.

**Consequence for the renderer.** §19.2 selects Diligent Engine with a Metal backend, while the
existing `forge-desktop/` probes vendor Vulkan GLSL shaders. That is a separate, still-open
question — this decision settles the *UI framework*, not the *render backend*. Recorded as D-006.

**Reversible?** Cheaply today — `forge-desktop/` is six headless probe programs, not an app, so
almost nothing is sunk. Expensive once the 445-function kernel surface has a UI on top of it.

## D-002 — Sacrosanct 3.1 placed at `docs/sacrosanct/`, not `output/pdf/` — **DECIDED**

The execution brief suggested `output/pdf/Archie_Sacrosanct_v3.1.pdf` "or an equivalent versioned
PDF." `output/` reads as build output and is a deletion target under the storage governor; a
normative constitution must never sit in a directory a garbage collector may treat as disposable.
Placed at `docs/sacrosanct/` with a text extraction and recorded SHA-256 for both. Reversible.

---

## D-003 — `sacrosanct.md` left untouched — **DECIDED**

The working tree's `sacrosanct.md` shows −1136/+181 against HEAD. That is the uncommitted
2026-07-26 **v2 rewrite**, not a truncation accident. It was preserved byte-for-byte and the
three-generation lineage documented in `docs/sacrosanct/README.md`. Overwriting it with 3.1 would
have destroyed authored work that was never committed anywhere.

---

## D-004 — `kernel-tests.yml` `kernel` job retained despite being Node — **DECIDED**

The macOS OCCT job builds `forge-kernel.node` and runs the smoke suites through Node. It is
JavaScript, and Sacrosanct §3.2 targets its removal. It was **kept** because it is the only coverage
the OCCT-linked kernel has, and §3.2 permits removal only after a mapped C++ owner and C++ test
exist. Deleting it now would be removal-by-extension ahead of its replacement — the specific error
the section forbids. Marked TRANSITIONAL in the workflow and tracked as a deletion target.

The `guards` job and the `Bridge smoke` step were removed, because both are Electron/React app
concerns with no C++ successor to wait for: `bridge_smoke.js` literally launches Electron and
asserts the `window.forge` preload bridge round-trips.

---

## D-005 — Parallel writers must use worktrees — **DECIDED (learned the hard way)**

Five of eight baseline auditors reported HEAD moving underneath them mid-audit. The cause was this
session committing into the shared checkout while read-only agents were reading it. No finding was
invalidated (the SHA held during the census and results were re-verified), but the rule is now
binding: **parallel writers get their own worktree; audits pin a SHA and report against it, never
against `HEAD`;** and any manifest derived from a census is re-validated against the SHA actually
checked out when it executes.

---

## D-006 — Render backend: **Vulkan via MoltenVK** — **RESOLVED 2026-08-28, and RUNNING**

D-001 settled the UI framework (ImGui). This settles the renderer. Sacrosanct §19.2 selects
**Diligent Engine with a Metal backend** on Apple Silicon and requires ONE authoritative
interactive renderer. The entry above leaned Diligent/Metal on the grounds that "Vulkan on M4 Max is
Metal with a layer in front", and asked for a measured comparison rather than a document quote.

**Decision: Vulkan through MoltenVK.** The application is built, launches, and presents frames on
this machine. Four grounds, in the order of their weight:

1. **The Vulkan path is measured working here and the Metal path does not exist.**
   `forge-desktop/renderer_probe.cpp` already created a MoltenVK device, rendered a tessellated
   kernel mesh offscreen and read the pixels back; `ui_probe.cpp` already stood Dear ImGui's Vulkan
   backend up against that device. There is no Metal counterpart to either. Choosing the path with
   two working probes over the path with none is the measured comparison, not a substitute for it.
2. **Dear ImGui's Vulkan renderer backend is vendored and version-matched.**
   `forge-desktop/third_party/imgui/imgui_impl_vulkan.{cpp,h}`, 1.92.9-WIP, sits beside the core
   translation units. `imgui_impl_metal.mm` is not vendored, is Objective-C++, and taking it would
   make the UI layer's translation units `.mm` — for a framework that already speaks Vulkan.
3. **Diligent would be a THIRD abstraction.** §19.2 asks for ONE authoritative interactive
   renderer. The chain would be Forge → Diligent → Metal, on top of a UI framework that carries its
   own renderer backends. Vulkan → MoltenVK → Metal has one fewer layer that Forge owns, and the
   layer it does have is a Khronos-hosted, Apache-2.0, source-buildable translation layer — which is
   what Law 16 asks of the dependency stack. Diligent is Apache-2.0 too, so licensing does not
   separate them; provenance and already-working code do.
4. **It is portable in the direction the product needs.** The same backend reaches Linux and Windows
   natively. A Metal-only renderer would need a second backend the first time Forge leaves macOS,
   which is the "more than one authoritative renderer" outcome §19.2 forbids.

**The cost, recorded rather than waved away.** One translation layer of latency; and Metal features
MoltenVK does not expose. One is already live: **`VK_POLYGON_MODE_LINE` is unavailable** (Metal has
no equivalent fill mode), so `ViewportRenderer::createPipeline()` queries
`VkPhysicalDeviceFeatures::fillModeNonSolid`, creates the wireframe pipeline only if it is
advertised, and falls back to the solid pipeline otherwise. Wireframe display therefore degrades
rather than pretending. If MoltenVK's gaps ever cost more than that, the decision is reversible at
the `ViewportRenderer` seam alone: it is the only class that names a Vulkan type outside `main.cpp`.

**What the swapchain is.** Not a fifth hand-rolled one. `ImGui_ImplVulkanH_Window` /
`ImGui_ImplVulkanH_CreateOrResizeWindow` — Dear ImGui's own reference helpers, driven the way
upstream's `examples/example_sdl2_vulkan/main.cpp` drives them (SR-3: follow and name the reference
implementation). The platform backend (SDL2 → ImGuiIO) IS first-party, because
`imgui_impl_sdl2.cpp` is not vendored and this repository builds offline against a pinned
dependency plane (§10.6); `forge-desktop/src/PlatformSDL2.cpp` implements that same contract and
says so in its header.

**Measured, on an Apple M4 Max, 2026-08-28.** `GPU: Apple M4 Max (Vulkan 1.2 via MoltenVK)`,
swapchain 1680x1000 / 2 images / `VK_FORMAT_B8G8R8A8_UNORM`, first frame 5,310 UI vertices and
11,151 indices over 240 viewport triangles of a real `BOX -> CUT -> FILLET` kernel body, 120 frames
presented, and a PNG written from the LIVE swapchain image (`--screenshot`), not from an offscreen
surrogate.

---

## D-007 — `bench_tasks_benchcad_hf.jsonl` is EVAL, not training — **DECIDED 2026-08-28**

**Question.** The hardened contamination guard blocks 947 training rows that share a part with
`bench_tasks_benchcad_hf.jsonl`. That pool has served as **both** a training source **and** a
980-task evaluation set with measured ground truth on disk — and a baseline has already been scored
against it (`reports/voxel_iou_benchcad_hf_envelope_baseline.json`, grid 64, 11 scored, mean IoU
0.317). Strip the training rows, or retire the eval set?

**Decision. It is an EVALUATION set. The 947 training rows are stripped.**

Sacrosanct §17.3 is not ambiguous: public evaluation inputs, known answers, and submission artifacts
are excluded from training **and** retrieval, and "benchmark optimization means learning transferable
construction and editing competence, not answer-key contamination." A pool with measured ground
truth on disk, that a baseline has been scored against, is an answer key. Training on it does not
merely risk a inflated score — it destroys the ability of that set to measure anything ever again.

Retiring the eval set instead would be the cheaper move and is the wrong one: it would discard a
980-task measurement instrument to preserve 947 training rows out of a 68,307-row corpus. The
instrument is scarcer than the data.

**Consequence that must not be buried.** `voxel_iou_benchcad_hf_envelope_baseline.json` (mean IoU
0.317) was measured by a model whose training corpus overlapped this set. That number is now
**SUSPECT, not void** — 11 of 980 tasks were scored, and the overlap is by shared *part*, not
necessarily by identical task. It is reclassified UNPROVED and must be re-measured with a model
trained on the stripped corpus before it is cited again. Any downstream claim resting on it inherits
that status.

**Reversible?** Stripping is reversible (the rows are not deleted upstream, only excluded from the
train split). Contaminating an eval set is not.

**Follow-up owed:** re-measure the baseline post-strip, and check whether any *other* published
number in `reports/` was produced against a corpus overlapping its own eval set. This one was found
only because the guard was hardened; there is no reason to assume it is unique.

---

## SHA-256 is implemented a second time in `orchestration/`, not reused from `forge::ft`

*2026-08-28, TRACK ARCHIE (s11.1/s11.2 durable workflow + research node).*

`forge::ft::sha256Hex` already exists and is FIPS-verified. The durable checkpoint chain in
`orchestration/` needs the same primitive, and reuse was tried first. It does not link:
`forge-kernel/src/ft/ChunkChain.cpp` calls `forge::ft::parse`, which lives in
`FeatureTreeCompiler.cpp`, which pulls in the feature-tree compiler and the kernel behind it.
Measured, not assumed — linking `ChunkChain.o` alone fails with
`Undefined symbols ... forge::ft::parse(std::string const&)`.

**Decision. Implement it once more in `orchestration/src/Digest.cpp` and verify it against the same
FIPS 180-4 vectors.** The alternative — extracting a shared `sha256` translation unit out of
`ChunkChain.cpp` — edits a kernel file that the main checkout already holds modified and unpushed
(see `RECONCILIATION_OWED.md`), to serve a module that must stay buildable with no kernel, no OCCT
and no network. Taking that dependency to avoid ~90 lines of a fully specified, vector-checked
standard algorithm is the worse trade while the reconciliation is outstanding.

**Follow-up owed:** once the kernel reconciliation lands, extract one `forge::hash::sha256` used by
both `forge::ft` and `forge::orch`. Until then the duplication is deliberate and both copies are
independently checked against FIPS 180-4 in their own gates.

---

## `src/native/util/Sha256.cpp` was missing from `FORGE_KERNEL_SOURCES` — **FIXED 2026-08-28**

*Found by TRACK SEGMENT 2 while building the desktop app's kernel dependency.*

`forge_kernel_core` did not link from the committed tree:

```
Undefined symbols for architecture arm64:
  "forge::native::util::sha256Hex(std::string const&)", referenced from:
      forge::ft::sha256Hex(...) in ChunkChain.cpp.o
      forge::ft::GraphHeader::hash() const in ChunkChain.cpp.o
      forge::ft::FeatureChunk::computeHash() const in ChunkChain.cpp.o ...
```

`src/ft/ChunkChain.cpp` delegates to `forge::native::util::sha256Hex`, whose definition lives in
`src/native/util/Sha256.cpp` — a file that was in the tree but **not in the source list**. The
`.node` build never noticed because Darwin links it with `-undefined dynamic_lookup`, which defers
an unresolved symbol to load time. That is the SAME failure the list's own comment on
`MeshToSDF.cpp` records ("was omitted from the source list => an undefined symbol masked by
`-undefined dynamic_lookup`"), recurring.

**Fixed by adding the file to `FORGE_KERNEL_SOURCES`,** with the reason written at the call site.
Two consequences worth stating plainly:

* The node-free `forge_kernel_core` — the library the entire C++ desktop migration links — **could
  not be built at all** from the committed state. Every desktop track was blocked on this.
* In the `.node` build the symbol was not resolved, it was *deferred*. Anything reaching
  `forge.ft`'s chunked emission or `verifyChain` would have failed at load or call time. The gate
  that would have caught it is a strict-link build, which is exactly what the desktop target is.

**Follow-up owed:** `src/native/storage/StorageGovernor.cpp` also references `sha256Hex` and is also
absent from the source list. It is not linked by anything today, so it is not fixed here — but a
source file in the tree that no target compiles is either dead code or a second instance of this
bug, and nothing currently distinguishes the two.


---

## D-008 — kernel-file work goes on its own branch while the in-flight tree is dirty (2026-08-28)

**Context.** 36 of the 37 uncommitted files in the working tree are `forge-kernel/` sources and
are user-owned. Two of them are actively harmful if committed as they stand: `CMakeLists.txt` is a
superseded parallel line that would revert the TKOffset drop, and `Features.cpp` does not compile
(`occtoffset::thickenShell` -- wrong namespace, and a fourth argument the 3-parameter declaration
does not accept). Editing any of them in the main tree would mix my changes into someone else's
uncommitted diff and make both harder to recover.

**Decision.** Kernel-file work is done in a dedicated worktree branch and offered as a PR, never
edited in the main tree, for as long as that file is in-flight. Non-kernel work (`simulation/`,
`ui/`, `retrieval/`, `tools/`, `.github/`, `implementation/`) continues directly on the execution
branch.

**First application.** `fix/forge-verify-stoi` -> PR #62. The fix and its gate are complete and
verified; only the merge waits on the in-flight file. Checked rather than assumed: the user's
uncommitted diff to `forge_verify.cpp` is +33/-1 and does not touch `jsonUnescape`, so the two
changes do not overlap textually and will merge cleanly once that work is committed.

**Cost, stated plainly.** A verified fix sits unmerged. That is the correct trade -- the
alternative is either destroying uncommitted user work or leaving a crash in the verifier -- but it
is a real cost, and it grows with every kernel-file fix that queues up behind the same blocker.

**What would end it.** The in-flight work being committed to its own branch. Until then, expect
more branches like #62 rather than commits on the execution branch.

## D-011 (2026-08-28) — spend a second emission run to get expert3d-v1 at n=600

**Decision: yes.** Queued to start automatically when the v5cap emission finishes.

The enlargement to 600 rows exists to make effects answerable: at n=25 the paired
95% CI was about +-0.12 while every effect was under 0.07. But v1's emissions cover
only the 36-row holdout, of which **15** rows fall in the 600 — so the v5cap-vs-v1
comparison, the one the underpowered run could not settle, is not available on this
set at any useful n. Scoring the 15-row overlap would be weaker than the n=25 result
already in hand.

The alternative was to report only v5cap against the bounding-box floor. That is the
more fundamental bar — v1 is already known to be beaten by a box — but it leaves the
adapter-versus-adapter question exactly where the n=25 run left it, which is the
question the enlargement was built to answer.

The cost is GPU time that would otherwise be idle: the two arms cannot share the
model, so v1 is chained behind v5cap rather than run beside it, and the scoring is
sharded five ways (measured 54 s/row single-threaded, so about 1.8 h rather than 9 h).

**Comparability, checked rather than assumed:** NoveltyStop became the default at
13:26 and the v5cap e600 run started about 16:32, so both arms run with it ON. The
ORIGINAL v1 36-row emission predates that change and ran with it OFF — a real
confound in the n=25 comparison, bounded by the measurement that NoveltyStop is
score-neutral (31 of 32 rows identical, the one that moved went up). The n=600
comparison does not inherit it.
