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

---

## D-013 (2026-08-29): how to guard the unifyFaces SIGSEGV

**Decision: detect the configuration and skip unification for that body.** Two other
designs were implemented and MEASURED FIRST, and both were rejected on evidence
rather than judgement:

* **A null-pcurve pre-check on the input** -- the design this task started with.
  Rejected: the crashing input is clean (`nullPcurves=0` over 9 faces and 42
  face-edge pairs). The null is produced INSIDE the merge, so the check never fires.
* **`ShapeUpgrade_UnifySameDomain::KeepShapes`**, withholding just the offending pair
  so every other merge in the body survives -- strictly the nicer fix. Rejected:
  all six crashing cases still SIGSEGV. `KeepShapes` stops a face being merged AWAY;
  it does not keep the traversal off it.

The shipped guard changes behaviour ONLY where the current behaviour is a crash.
Measured over real emissions: 0 of 150 rows differ from the unguarded build, and it
rescues `ho1139` from a SIGSEGV. An over-wide variant that drops the
analytic-vs-extrusion test differs on 39 of 150 (26%), so the narrow condition is
load-bearing and not a stylistic preference.

**A prior conclusion was withdrawn in the course of this.** The first blast-radius
measurement compared one binary against itself three times (`forge_verify` is a stub
that loads a dylib; copying the executable copies a loader). On that invalid
evidence the narrow and wide guards looked indistinguishable and the narrowness was
written up as justified "on principle, not by corpus evidence". It is justified by
corpus evidence. See `findings/AN_AB_THAT_COMPARED_ONE_BINARY_TO_ITSELF.md`.

## D-014 (2026-08-29): PR #63 lands via the execution branch, not on its own

CodeRabbit does not review PRs based on `claude/sacrosanct-execution-20260828` --
its check reports `pass` with the description "Review skipped: reviews are disabled
for this base branch", which is a green bucket over a review that never ran.
**Decision: merge #63 into the execution branch** so the code reaches CodeRabbit
through PR #61, which does get reviewed, rather than retargeting #63 at the default
branch and dragging #61's commits into its diff.

---

## D-015 (2026-08-29): Archie's op constraint is real, but today's forge::ui cannot be the whole of it

The instruction is that Archie must be trained on where the features, functions and ops
live in the Forge app "so it only uses what Users can use". That is right, and the
constraint is now MEASURED rather than assumed -- the command registry was compiled and
EXECUTED, not read from docs:

    forge::ui registry                     31 commands in 6 categories
    commands that actually emit IR         14  (verified by dispatching each with a legal
                                               selection and reading PartDocument::lastFeature)
    distinct IR ops reachable from the UI  14  EXTRUDE REVOLVE LOFT HOLE CBORE FILLET
                                               CHAMFER BLEND SHELL PATTERN MIRROR FUSE CUT COMMON
    kernel ops in a default build          43
    IR ops with NO forge::ui command       26  incl. RECT RRECT CIRCLE SLOT POLY REGPOLY
                                               BOX CYL CONE, TRANSLATE, ROTATE

**Taken literally, the constraint makes generation impossible rather than merely
limited.** No command in the registry CREATES a value: every one of the 14 IR-emitting
commands consumes a selection that must already exist. So RECT/CIRCLE/POLY and all 15
profile and primitive ops are unreachable, and an Archie confined to today's registry
could not emit a program that produces any solid at all -- there is nothing for EXTRUDE
to extrude.

**Decision: the constraint is a TARGET on forge::ui, not a cage for Archie.** The
op vocabulary asset is still built and still authoritative, but the correct response to a
gap is to EXTEND the UI to expose the op, not to forbid Archie from an operation users
demonstrably need. Concretely:

* Ops a user CAN reach today -> Archie may emit freely.
* Ops with no command that a part cannot be built without (profile and primitive
  creation) -> a forge::ui command is OWED, and the vocabulary records them as
  `owed`, not as forbidden.
* Ops that are genuine drift rather than policy -> fix the drift. ALIGN, COMPONENT and
  ASSEMBLY exist in `forge::ft::opFromName` and are ABSENT from
  `forge::ui::irOpTable()`. ALIGN matters: it is the recorded fix for the largest
  measured failure mode in this programme (derived placement, where 40.4% of train and
  48.2% of held-out TRANSLATE arguments are exact arithmetic on other constants).
  Forbidding ALIGN would forbid the fix.

**Also measured and NOT yet fixed:** `ui/test/run_ui.sh` is RED right now -- 8 of 246
checks in `feature_ir`, because the UI's op table is 3 ops behind the kernel. The
committed `APP_SURFACE_MANIFEST.tsv` and its own gate are green, so the command list
above is trustworthy, but the drift is real and is the first thing the vocabulary
generator will trip over.

---

## D-016 (2026-08-29): stop the v6r8 emission mid-run and train the axis-named round first

**Decision: yes, switch — because nothing is lost by switching and the evidence favours
the other experiment.**

The v6r8 emission had run 3.5 hours and reached 238 of 600 rows, holding the GPU for
another ~5. It answers a CAPACITY question: does expert LoRA rank 4 -> 8 help? The
axis-named round answers the question the evidence actually points at.

`ARCHIE_SHIFTS_THE_DIMENSIONS_DOWN_A_RANK.md` measured that on the rows Archie fails it
emits the part's REAL dimensions and binds them to the WRONG AXES -- 67 of 116 failing
rows show a strict rank shift against a shuffled-null 99th percentile of 10, only 4.3% are
pose-consistent, and 67% get the LARGEST extent exact while 14-16% get the middle or
smallest. The prompt handed the model three bare numbers in a fixed order. Capacity is not
the measured bottleneck; binding is.

**What made this safe rather than a gamble: the trace carries the IR.** Each row of
`reports/archie_loop_v6r8_e600.jsonl` holds `history[-1]['ir']`, so the 238 completed rows
were reconstructed into `emissions.part1.jsonl` and a 362-row remainder task file was
written before anything was killed. 238 + 362 = 600, checked. No GPU work was discarded;
only the ORDER of two jobs changed.

Resuming is precedented rather than novel: v5cap's own e600 emission was run as 416 rows
plus a 185-row resume, combined afterwards (`..._COMBINED.jsonl`). `archie_loop.py` has no
`--resume` flag, so the mechanism is the remainder task file plus a trace merge, which is
exactly what was done then.

**The cost, stated:** the v6r8 capacity answer is delayed, and its two halves will have
been emitted at different times. That is the same seam v5cap's own arm carries, so the
comparison is not made worse by it -- but it is a seam, and it is recorded here rather
than discovered later.

## D-017 (2026-08-29): the OCCT drop is measured and is NOT shippable; FILLING is the one family that earns its flip

The twelve `FORGE_*_DROP_*` options all name the same flip condition — "native success
rate >= the measured OCCT baseline" — and until tonight nothing measured it. The corpus
A/B harness did not exist; `golden_corpus_measure.cpp` measures per-model freeze/verify on
72 steps and is a different gate. It exists now and it returns a negative answer.

**20-part stride sample** (the corpus is sorted hardest-first, so a prefix is biased —
this programme has already measured a prefix at 0.2423 where the full set read 0.3617):

| family | native | OCCT | valid nat/occt | deletion bucket |
|---|---|---|---|---|
| PIPE | DEFER 20 | OK 20 | 0 / 20 | 20 of 20 |
| DRAFT | DEFER 19 | OK 17, THREW 2 | 0 / 16 | 19 of 19 |
| PIPESHELL | OK 15, DEFER 5 | OK 20 | 15 / 20 | 5, and 15 DISAGREE |
| THICKEN | OK 17, DEFER 3 | OK 20 | 17 / 20 | 3, 17 agree only up to orientation |
| FILLING | OK 17, DEFER 3 | OK 17, THREW 3 | 17 / 17 | 0 — 17/17 agree fully |

**DECISION: closure 14 -> 11 is accepted as a BUILD result and REFUSED as a ship result.**
PIPE and DRAFT defer on every applicable part, so with the fallback compiled out those two
options delete the capability outright. PIPESHELL is worse than a defer on 15 parts: it
DISAGREES, which returns a different solid and tells nobody. Only FILLING passes its own
flip gate, and there OCCT actually THREW on 3 parts where native deferred honestly.

The seven correctness A/Bs passing was never sufficient evidence: they measure whether the
native engines are RIGHT on hand-built cases, and the question was how often they DECLINE
on real ones. Those are different questions and only the second gates shipping.

**The stated caveat was closed by measurement, not argument.** The first build forked
before #80's canonize fix, so THICKEN's disagreement might have been a
`SurfaceOfLinearExtrusion` artifact. Rebuilt at HEAD `67507174` with canonize verified
present: identical numbers. It also separated two problems being treated as one — THICKEN's
17 agree on `|volume|` and differ only in signed orientation (a bounded fix); PIPESHELL's
15 agree on neither, so it builds different geometry.

**OCCT is not the reliable arm it is being treated as.** Two of three crash reports this
session were OCCT's own `BRepOffset_Inter2d::ConnexIntByInt` faulting at 0x60 inside
`libTKOffset` — the very toolkit these engines would replace — each contained in its forked
child. `ARM_CRASH` is a distinct status from `ARM_DEFER`, set on `WIFSIGNALED`, and
`--selftest` asserts a deliberate segfault returns CRASH and never a defer, so PIPE's
`DEFER 20` is twenty honest declines rather than twenty crashes under a softer name.

Recorded as PR #81. The full 600 x all-families run is in flight and becomes the baseline.

## D-018 (2026-08-29): old Forge versions are NOT deleted yet; deletion is gated on the C++ app, and the gate is named

The standing order says to delete all old Forge versions from the repo and locally. I am
deferring that deletion and stating why rather than either doing it or dropping it.

Measured state: `forge-desktop` is a real C++ application — 51,468 LOC across 33 C++ files
on ImGui + Vulkan/MoltenVK + SDL2, with a headless frame gate that builds REAL frames and
asserts values against references. It is not a stub. But it had NO build directory at all
before tonight, so nothing in the repo demonstrated it runs, and the release is
independently blocked (bundled dylibs at minos=26.0, Gatekeeper rejecting the ad-hoc
signature with spctl exit 3).

Deleting the working JS application before its replacement is demonstrably usable would
leave users with neither. The safety constraint is also explicit that JS must not be
deleted by extension before its behaviour is mapped and the C++ replacement proven, and the
measured position is that ZERO of 1,768 JS files currently clear that bar.

**DECISION: deletion waits on a NAMED gate, not on a judgement call.** All four must hold:
1. `forge_desktop` configures and builds clean from a cold tree (in flight tonight).
2. The headless frame gate passes on that build.
3. The user-invocable op inventory shows the C++ UI covers the operations the JS app
   exposes — the honest blocker today, since D-015 found no forge::ui command creates a
   value, which makes generation from an empty document impossible.
4. A Gatekeeper-acceptable bundle exists, which may itself depend on the OCCT drop if the
   minos=26.0 floor comes from OCCT dylibs.

Until all four hold the old versions stay, and `e2e/forge` (101M, 248 js/ts) stays as the
behavioural reference the mapping in (3) is measured against.

## D-019 (2026-08-29): the release is NOT blocked on OCCT; the floor and Gatekeeper are separate causes and neither waits on the kernel

I raised the hypothesis that the OCCT drop and the release blocker were the same problem —
the minos=26.0 floor comes from bundled Homebrew dylibs, so removing OCCT would remove the
floor. **That hypothesis is refuted by measurement.**

Simulating the closure walk with every `libTK*` deleted leaves the floor at **26.0**, with
two survivors, both linked DIRECTLY into `forge_desktop` and structural rather than
incidental (`forge-desktop/CMakeLists.txt:94,97,174`):

| survivor | minos | source |
|---|---|---|
| `libSDL2-2.0.0.dylib` | 26.0 | homebrew sdl2 |
| `libvulkan.1.dylib` | 26.0 | homebrew vulkan-loader |

OCCT accounts for 16 of 18 floor-setters — `libtbb`/`libtbbmalloc` do leave with it, being
referenced only by `libTKBO/TKernel/TKGeomBase/TKMath/TKTopAlgo` — but not the last two.
`otool -L` on the shipped executable confirms exactly three non-system deps: SDL2, vulkan,
and `libforge_kernel_core.dylib`. The window layer and renderer are OCCT-independent by
construction.

**Root cause 1 — the floor is a RUNNER-IMAGE problem, not a dependency problem.** `minos`
is inherited from whichever Homebrew bottle tag the build host pulls, and
`-DCMAKE_OSX_DEPLOYMENT_TARGET` cannot lower a floor inside someone else's binary. This
host is macOS 26.6.2, so every bottle here is `arm64_tahoe` at 26.0 — OCCT and non-OCCT
alike. opencascade, sdl2-compat, vulkan-loader and tbb all publish arm64_sonoma and
arm64_sequoia bottles too, so SDL2 and vulkan have the SAME escape hatch as OCCT.
`desktop-release.yml:129` already pins `runs-on: macos-15` with `FORGE_FLOOR_MAX: "15.0"`,
which fixes the floor for the whole bundle WITH OCCT STILL PRESENT.

**Root cause 2 — Gatekeeper is independent, and a positive control proves it.** A trivial
`.app` — one Mach-O compiled at `minos=14.0`, zero Homebrew dylibs, zero OCCT — is still
`rejected, exit 3` ad-hoc signed, and STILL rejected with hardened runtime
(`flags=0x10002(adhoc,runtime)`). `security find-identity -v -p codesigning` returns **0
valid identities**. So spctl rejects on the absence of a Developer ID signature plus
notarization. That needs a paid credential, not code, and would reject a 14.0-floor
OCCT-free artifact just the same.

**A third blocker, separate from both:** `desktop-release.yml` is not on the default
branch (`git ls-tree origin/archdisc -- .github` lists only `build-app.yml` and
`kernel-tests.yml`). `workflow_dispatch` only registers from the default branch, so the
dry-run path does not exist and the only working trigger is the tag push that publishes.

**DECISION: stop treating the OCCT drop as a release prerequisite.** They are orthogonal in
both directions. The drop is justified on dependency-closure grounds alone (D-017), and the
release is unblocked by a runner pin plus a Developer ID — neither of which the kernel work
gates. Per the standing constraint, no tag is pushed and no draft release is published.

## D-018 UPDATE (2026-08-29, same night): gates 1 and 2 now SATISFIED and mutation-proved

`forge_desktop` had no build directory because it has a PREREQUISITE, not a defect: it
needs `libforge_kernel_core` built first, and its CMake says so by name with the exact
command (`forge-desktop/CMakeLists.txt:45-56`). Built that (`-DFORGE_BUILD_NODE_ADDON=OFF
-DFORGE_BUILD_DESKTOP_FOUNDATION=ON`, rc=0), after which:

* **Gate 1 SATISFIED** — configure rc=0, `forge_desktop_frame_gate` rc=0, `forge_desktop`
  rc=0. Both binaries link exactly three non-system deps.
* **Gate 2 SATISFIED** — the headless frame gate runs **132 checks, 0 failures**, and does
  real work: builds a kernel body (BOX -> CUT -> FILLET, 240 triangles / 10 faces / 3
  features), renders a real frame (5310 vtx / 11151 idx, 16 draw lists, 4 panels),
  materialises a 14-row feature tree, and measures area 13405.325 mm2 / volume 77278.139
  mm3 / watertight with 0 boundary, 0 non-manifold, 0 reversed edges.

It exited 0 with no visible output at first, which is the shape of a gate that cannot fail,
so it was **mutation-proved**: changing one expected bbox value from 80.0f to 81.0f made it
exit 1 with `FAIL bounding box X == 80mm  80.000000`. Restoring took a forced rebuild — the
first restore raced CMake's timestamp granularity and left a STALE MUTANT BINARY reporting
1 failure against clean source, which is precisely the false reading this programme keeps
hitting. Confirmed back to 132/0 with the file byte-identical and the worktree clean.

Gates 3 (op coverage) and 4 (Gatekeeper-acceptable bundle) remain. Per D-019, gate 4 does
NOT depend on the OCCT drop; it needs a Developer ID plus notarization.

## D-018 RE-VERIFIED ON ORIGIN (2026-08-29): the earlier pass was measured on a 36-commit-stale tree

The gate-1/gate-2 result above was measured in a checkout that turned out to be **36
commits behind origin** and 3 ahead. That is the in-flight-vs-HEAD trap this programme has
now hit four times in one day, and it is the reason the claim was re-run rather than left
standing.

Rebuilt from `origin/claude/sacrosanct-execution-20260828` in a clean worktree:
`KCORE_BUILD=0`, `CONFIGURE_RC=0`, `GATE_BUILD_RC=0`, `GATE_RUN_RC=0`, and the headless
frame gate reports **135 checks, 0 failures** — three MORE checks than the stale tree's 132.
So gates 1 and 2 hold on the real tree, and the conclusion is unchanged; only its
provenance is now correct.

The same staleness explains the "SKETCH seed" defect: it is real in the stale tree and was
ALREADY FIXED on origin, where `wirePartCommands` replays `defaultPartStatements()` and
reports a refusal by name. What was still live on origin was the RESIDUE — two UI gates
still seeding the non-existent op and still discarding `seed()`'s return. That is fixed in
PR #82 with a negative control both ways.

**Rule reinforced, since restating it has not been enough:** every measured claim must name
the tree it was measured against, and the tree must be checked against origin at the moment
of measurement — not assumed from the branch name.

## D-020 (2026-08-29): the corpus A/B baseline is INDEPENDENTLY REPLICATED, and it found a live production defect

The 600-part baseline was produced TWICE, by two separately written harness drivers, in
different worktrees, at different build SHAs, hours apart. **All ten per-family rows are
identical** — same N, same native %, same OCCT % — across 6000 paired trials. Both runs
also independently reached the same two non-coverage findings, on the same part, to three
decimals.

The second run supplies the check the first could not: **ten per-family native POSITIVE
CONTROLS, 10/10 OK**, each engine fed an input its own header documents as in scope. That
is what makes PIPE 0.3%, DRAFT 0.0% and THRUSECTIONS 0.0% believable as ENGINE results
rather than a mis-wired arm — the question left open the moment the first zeros appeared.

It also counts the OCCT arm's own failures, which are large: **OFFSETSHAPE CRASHED on 66 of
600** parts and MAKEOFFSET TIMED OUT on 5. Those are the 23 contained crash reports this
machine logged, all one stack (`BRepOffset_MakeOffset` -> `BRepOffset_Inter2d::ConnexIntByInt`
-> `BRep_Tool::CurveOnSurface` at 0x60). The arm being treated as the trustworthy reference
is itself unreliable on this corpus.

And a guard that COULD NOT FIRE was found and fixed: the first build-SHA-vs-HEAD guard
exited 0 on a poisoned stamp because the driver rebuilds and re-stamps on the line above
it. Both guards are now proved to fire (exit 3, exit 4). Same class as the four harnesses
that could not link.

**A LIVE PRODUCTION DEFECT, found by a harness not looking for it.** `Features.cpp` does
`return ShapeRegistry::instance().add(mk.Shape());` unmodified, and `mk.Shape()` is
negatively oriented on all 407 shared successes — so `part::thickenSurface` hands the
ShapeRegistry a **reversed solid** today on the default non-native path. **DECISION: record
it, do not fix it blind.** The correct remedy — reverse the solid, or leave the convention
to consumers — depends on what downstream consumers assume about orientation, and that has
not been measured. Fixing it without that measurement would be exactly the guesswork this
programme keeps paying for.

## D-021 (2026-08-29): Archie's allowed op set is the forge::ui vocabulary, and that vocabulary is NOT CLOSED — the gap is named and owed, not trained around

The standing order is that Archie be "trained on where the features, functions, ops are in
the Forge app so it only uses what Users can use". Executing that requires a decision the
op inventory explicitly could not make for itself, because it is a decision and not a
measurement: **which surface defines "what users can use"?**

There are two candidate surfaces and they are far apart:

* **`forge::ui` (C++)** — 31 commands, 16 emitting IR, **14 user-invocable kernel ops**.
* **The shipped Electron/React app** — `package.json:6` -> `electron/main.js:404` ->
  `frontend/dist/index.html`, whose `frontend/src/ai/ForgeToolBridge.js:962` defines
  **154 tool ids**, including the very creators the C++ surface lacks (`part.make-box`,
  `part.make-cylinder`, `sketch.add-circle`, ...).

**DECISION: the C++ `forge::ui` vocabulary is the allowed set.** The C++ app is the
shipping target, the JS app is under an explicit deletion order, and `ZERO_JS_MIGRATION_MANIFEST.md`
already records forge-v4 as the app being replaced. Training Archie against a surface the
programme intends to delete would buy a working demo today and a retraining bill later. The
machine-readable form of that set already exists and is CI-gated:
`implementation/sacrosanct/archie_op_vocabulary.json`, with `emission_policy.allowed_ops`
listing the 14 and `forbidden_ops` giving a REASON for each of the 26.

**But the honest consequence must be stated rather than papered over: that vocabulary is
not closed, so the constraint as written is UNSATISFIABLE.** This is not an opinion; the
artifact computes it about itself in `value_kind_closure.gaps`:

| gap | needed by | producers in the allowed set | producers in the kernel |
|---|---|---|---|
| PROFILE | EXTRUDE, REVOLVE | **none** | CIRCLE, POLY, RECT, REGPOLY, RRECT, SLOT |
| WIRE | LOFT | **none** | RING, WIRE |

All 14 allowed ops take a value reference as their first argument, and the only value kind
any of them PRODUCES is SOLID. So from an empty document no legal program exists: every
generation must begin from a value the user cannot create. Independently confirmed by
execution — seeding only `RECT` and driving the real commands yields a full nine-statement
program (RECT -> EXTRUDE -> FUSE -> FILLET -> HOLE -> SHELL -> PATTERN), so **one profile
producer unlocks the entire existing registry.**

**DECISION: close the gap in the UI rather than relax the constraint in training.** The
alternative — letting Archie emit ops no user can invoke — would reintroduce exactly the
gap this constraint exists to remove, and would be invisible in any eval that scores
geometry rather than reachability. The owed set, smallest first:

1. **PROFILE producer — `RECT` (strict minimum, measured).** Unlocks EXTRUDE/REVOLVE and
   through them every remaining op.
2. **`CIRCLE`** — second profile producer; without it a large class of real parts is
   unreachable.
3. **WIRE producer — `WIRE` or `RING`** — closes the second gap and makes LOFT reachable.
4. **`TRANSLATE`** — load-bearing and easy to miss: it is ORPHAN today, so nothing can be
   POSITIONED, and every boolean would operate on bodies coincident at the origin.
5. **`INPUT`** — the only creator for an imported body, so the whole edit family
   (PUSHFACE, RESIZEBORE, DEFEATURE, TAG, VERIFY, HEAL) is unreachable without it.

`ALIGN` is separately notable: orphan AND absent from the UI op table, which matters
because ALIGN is this programme's recorded fix for derived placement — the sub-task
measured as unlearnable.

**Until (1) lands, any claim that Archie is "constrained to user-invocable ops" is a claim
about an empty language.** That is recorded here so no future eval reports a score against
this constraint without the reader knowing it.

Seven `derived_defects` are already recorded in the artifact and are NOT re-litigated here,
but two are worth naming because they are live: `edit.delete` declares `feature_ir_op
"DELETE"`, an op the kernel does not have, so nothing can ever compile it; and
`model.extrude`, `model.fillet`, `model.shell` all declare an op and emit nothing, because
`ForgeShell` holds only a `DocumentStats` counter and no `PartDocument`.

## D-022 (2026-08-30): the OCCT drop is blocked on ENGINE COVERAGE, not on integration — and the one shippable drop moves the ledger by ZERO

Two measurements close the question of what to do next about the dependency drop.

**1. The only family that passes its own flip gate buys nothing.** `FORGE_FILLING_DROP_NATIVE`
is the single option the 600-part baseline cleared (67.8% vs 67.8%, deletion bucket ZERO).
Built both arms from a worktree pinned to origin, with the arms PROVED to differ by `cmp`:

| arm | direct | **OCCT_CLOSURE** |
|---|---:|---:|
| baseline | 11 | **14** |
| `FORGE_FILLING_DROP_NATIVE=ON` | 11 | **14** |

The ledger number does not move. `BRepOffsetAPI_MakeFilling` lives in a toolkit that many
other still-live call sites also pull, so removing this one use changes no library's
liveness. Shipping the one defensible drop is therefore correct hygiene and worth **0** on
the north star.

**2. The other nine cannot be shipped at all**, and not for want of integration work: three
are total capability loss (PIPE 0.3%, DRAFT 0.0%, THRUSECTIONS 0.0% against OCCT's 100%,
88.0%, 94.5%), and the rest delete between 27 and 315 parts of capability out of 600.

**DECISION: stop treating the drop as an integration task and treat it as an ENGINE task.**
There is no flag-flipping, build-plumbing or closure-accounting sequence that reduces the
ledger from here. The only thing that moves OCCT_CLOSURE is native engines that actually
build geometry on real parts. The ranked work is therefore:

1. **PIPESHELL** — the most tractable by far. It already succeeds on 51.5% and its
   disagreement is SYSTEMATIC, not noise: volume ratio 1.07051 with sd 0.00327, 8 of 15
   sampled parts on exactly 1.07180. One convention error, one bounded fix.
2. **MAKEOFFSET** — nearest miss at 94.5% vs 99.0%, 27 parts from parity.
3. **THICKEN** — 67.8%, and its "disagreement" is already understood to be OCCT returning a
   reversed solid rather than a native defect.
4. **PIPE / DRAFT / THRUSECTIONS** — near-total gaps; these need capability, not tuning, and
   should be scoped as such rather than promised as flips.

**A correction that cost real time and is recorded so it is not repeated.** The first run of
this experiment was made against the shared main checkout, which had drifted **41 commits
behind origin**. There `FORGE_FILLING_DROP_NATIVE` does not exist, CMake accepted the
unknown `-D` SILENTLY, and both arms compiled to a BYTE-IDENTICAL binary — which I nearly
reported as "the drop buys zero closure". It happens to be the same conclusion, but it was
not a measurement. Chasing that artifact produced a second wrong finding ("8 of 10 drop
options are not real options"), which was also only the stale tree: on origin the CMake
names and the source `#ifdef` names match exactly and the A/B report's option column is
correct. **The positive control is what caught it — `cmp` said the two arms were the same
file.** This is the FIFTH stale-tree error in one session. Every measured claim must name
the tree it was measured against, and that tree must be pinned to origin at the moment of
measurement.
---

## D-023 (2026-08-30): LOFT consumes WIRE — `part.loft` was a LATENT BUG, and closing the gap needed BOTH halves

*(Numbered D-023, not D-022: PR #85 `decisions/d022-drop-blocked-on-engines` claims D-022
concurrently for the OCCT-drop decision. If that PR never lands, D-022 is a gap rather
than a duplicate, which is the cheaper of the two failures.)*

D-021 left one question open on purpose: WIRE was the last unclosed value kind, and it named
`WIRE or RING` as owed — but it also refused to add the producer blind, because the gap was
entangled with a defect the vocabulary already recorded, `command_feeds_the_wrong_value_kind`
for `part.loft`. Its words were: "deciding whether LOFT takes profiles or wires is a semantics
question and is not answered blind here."

**The kernel answers it, and it is not ambiguous.** `forge-kernel/src/ft/FeatureTreeCompiler.cpp`:
`opLoft()` puts every `%ref` through `refWire()`, which throws unless the value's kind is
`Val::Wire`; `Builder::kindOf()` assigns `Val::Wire` to exactly two OpCodes, `Ring` and `Wire`.
`FeatureTree.hpp` says the same in prose ("WIRE ... consumed by LOFT"), and `FeatureIr.hpp`
already states the standard this violates: "a UI that emits IR the kernel would reject is worse
than a UI that emits none, because it looks like progress."

**MEASURED, not read** — the four statements driven through the native verifier
(`forge_verify` -> `forge::ft::compileText`), with the arms proved to differ:

| program | result |
|---|---|
| `BOX(10,10,10)` (positive control) | ok, volume 1000 |
| `RECT(40,40); CIRCLE(10); LOFT(%1,%2)` — **what `part.loft` emitted** | **ok=false**, `LOFT: %1 is not a WIRE section (use RING(...) or WIRE([...]))`, failedOpId 3 |
| `RING(20,20,0); RING(10,10,30); LOFT(%1,%2)` | ok, volume 21928.4 |
| `WIRE([...]); WIRE([...]); LOFT(%1,%2)` | ok, volume 24960 |

So `part.loft` feeding PROFILE was **neither correct-by-accident nor a deliberate widening**: it
was a statement `forge::ui` called well-formed and `forge::ft` refuses. Correct-by-accident was
never available — `refWire()` rejects on the value KIND before any handle is used.

**DECISION: do both halves, because either alone leaves LOFT unreachable.** Fixing only the
command gives a right-kind command with nothing legal to select; adding only a producer leaves a
command that still resolves PROFILE and would never enable on it. Both landed:

1. `part.loft` now resolves `IrValueKind::Wire` and its signature is `atLeast(EntityKind::Wire, 2)`.
2. `part.section_ring` (`RING`) is the WIRE producer, a creator taking no selection like
   `part.sketch_rect` and `part.sketch_circle`.

**RING and not WIRE.** `WIRE([x y z; ...])` needs a POINTS token, and `FeatureIr.hpp` deliberately
does not model `IrArgKind::Points` ("a token kind nothing produces is a liability, not coverage").
RING is all numbers, emits through the existing `IrArg::num` path, and its `z` is the point of the
whole value kind: the Z=0 sketcher cannot express a section at another height.

**`EntityKind::Wire` was added** rather than reusing `Sketch`. A sketch is a Z=0 profile; reusing
that kind would have offered LOFT and EXTRUDE on each other's input, which is the mis-selection a
typed signature exists to refuse.

**Two kernel behaviours the command refuses rather than passes on.** `wireRing()` throws on
`rx <= 0 || ry <= 0`, but it SILENTLY CLAMPS `p` to `>= 2` and `seg` to `>= 8`. A recorded statement
the kernel reads as different numbers is worse than no statement, so the enabled predicate refuses
both. Its four optional arguments are also emitted as ONE positional group: emitting `p` without
`cx, cy` would put the superellipse exponent in the `cx` slot and build a different ring.

**Result — the vocabulary is CLOSED.** `value_kind_closure.gaps` is now `[]` and
`produced_by_allowed_ops` is `PROFILE, SOLID, WIRE`, computed by the artifact about itself. Counts
UPDATED to new exact values, never relaxed: 17 -> 18 user-invocable ops, 23 -> 22 forbidden,
34 -> 35 commands, 19 -> 20 emitting IR, 7 -> 6 derived defects
(`command_feeds_the_wrong_value_kind` is gone because the defect is gone). ALL 12 UI GATES PASS,
0 failures: part_commands 400 -> 450 checks, archie_op_vocabulary 1453 -> 1536 (32 -> 34 examples
dispatched through the live registry), tool_catalog 854 -> 877. Vocabulary `--check` exits 0.

**Verified end to end, not just in the gate.** The ten-statement program the part_commands gate
builds from an EMPTY document using only user-invocable commands —
`RECT; EXTRUDE; FILLET; CIRCLE; EXTRUDE; TRANSLATE; CUT; RING; RING; LOFT` — compiles in the kernel
to a valid solid of volume 34964.0.

**Observed and NOT fixed here** (pre-existing, independent of this change): `LOFT` over two
COPLANAR sections returns `ok=true, valid=true, volume=0`. Two rings at the same `z` build a
zero-volume shell that the kernel reports as valid. That is a kernel-side silent-zero, older than
this decision and out of its scope; it is recorded so the next reader does not discover it as a
surprise.

**Reversible.** Both halves are local: `part.loft` reverts by changing one value kind back, and
the producer reverts by deleting one command block plus its id. The measurement above is what
would have to be refuted first.

## D-024 (2026-08-30): the Forge deletion PLAN exists, gate 3 is re-assessed at 11.0%, and the Developer ID blocks only the last two tiers

The standing order is to delete all old Forge versions from the repo and locally. D-018 gated
that on four conditions and deferred the inventory. This decision records the inventory, the
honest re-assessment of gate 3, and one consequence that changes what can be worked on now.
The plan is `implementation/sacrosanct/FORGE_DELETION_PLAN.md`; every figure in it is
reproduced by `implementation/sacrosanct/tools/forge_deletion_inventory.py`, run from a tree
pinned to origin. **Nothing is deleted by this decision or by the PR that carries it.**

**GATES 1 AND 2 RE-MEASURED, NOT RESTATED.** D-018's pass reported 135 checks, and three
commits have touched `forge-desktop` since (#88, #91, #89). Re-run from scratch on this tree:
`KCONF_RC=0 KCORE_RC=0 CONFIGURE_RC=0 GATE_BUILD_RC=0`, `ctest` reports `100% tests passed, 0
tests failed out of 3`, and the frame gate prints **137 checks, 0 failures** — two more than
before, so it grew rather than went quiet. The verdict is read from the printed line and not
from `$?`, which after that pipeline belongs to `tee`.

**GATE 3 IS NOT MET, AND THE CLOSURE RESULT DOES NOT MOVE IT.** The op vocabulary being closed
(`value_kind_closure.gaps == []`) answers a different question from the one the gate asks.
Closure asks whether the C++ vocabulary is self-consistent — whether any program can be written
in it at all. Gate 3 asks whether the C++ UI covers the operations the JS app exposes. Measured
on `5adc26a0`, mapping the JS app's 164 declared tools onto the 30 C++ registry commands with a
synonym table printed in full so any row can be rejected individually:

```
JS tools with a C++ counterpart : 18 / 164   =  11.0%
  part 17/104   simulate 0/29   drawing 0/12   assembly 0/8   sketch 1/6   manufacture 0/5
```

Four of the six disciplines are at zero, and the gap includes every primitive creator
(`part.make-box` … `part.make-wedge`) and the whole constraint sketcher. On the wider surface
the renderer actually has — 445 `contextBridge` kernel functions in `electron/preload.js` — the
ratio is 30/445. What closure *did* change is that gate 3 is now a **size** problem rather than
an **impossibility** problem, which is real progress and is why the tier order below moves.

**Two counts in circulation are wrong and are corrected here.** Reachability is **30/30**, not
34/34 — measured by running the 13 UI gates on this tree, with the gate's own negative control
firing (`reaches 29 / 30`, FAIL, as designed). The "34" is the count of recorded IR examples
`archie_op_vocabulary_test` dispatches, and a stale comment in
`app_surface_reachability_test.cpp:9-10` quotes "13 of 34" from revision `6a7f3aa3`. Separately
D-023's "35 commands" was correct when written: `80a26e0d` (#89) landed after `903cf338` (#92)
and removed five rows — `model.extrude`, `model.fillet`, `model.shell` (D-021's
"declares an op and emits nothing") and `part.undo`/`part.redo` (duplicates of `edit.*`).
`user_invocable_ops` stayed 18 and `commands_emitting_ir` stayed 20 across it, so the shrink is
de-stubbing and de-duplication, **not** a capability regression.

**THE CONSEQUENCE THAT MATTERS: the Developer ID blocks only the last two tiers.** Gate 4 is
re-confirmed blocked (`security find-identity -v -p codesigning` -> `0 valid identities found`,
re-run today), and per D-019 it needs a paid credential, not code. But the deletion decomposes,
and only T5–T6 touch it:

```
T0 today   the one provably dead spec + ~155 MiB of local residue
T1 needs a per-op A/B vs forge_kernel_core     -> frontend/src/kernel   69,265 LOC
T2 needs per-file evidence transcription       -> 200 unreachable JS acceptance files
T3 needs CAPI@445 + CI moved to ctest          -> 41 reachable JS files, THEN the N-API layer
T4 needs a C++ owner per module                -> foundation + the AI bridge
T5 needs GATE 3 and GATE 4                     -> forge-v4, then e2e root, then e2e/forge LAST
T6 needs the default branch on the C++ ship    -> electron, projects, the JS build config
```

**T1–T3 alone are 124,572 LOC and are gated on engineering evidence this programme can produce.**
Two facts make that credible rather than optimistic, and both are measured rather than assumed:
`git grep` for any JS path over `forge-desktop ui orchestration simulation retrieval` returns
**0 files** (positive control: the same grep over `forge-kernel` returns 29), so the C++ app
cannot break when the JS app is deleted; and CTest now exists — 44 registered A/B gates plus the
native suite, the s0 ratchet, the CAPI smoke and the coaxial guard — which clears the blocker
`ZERO_JS_MIGRATION_MANIFEST.md` §3 called "the true blocker on Z1".

**What is refused.** No deletion is performed. No gate is lowered: gate 3 is restated as a
ratchet with 11.0% attached, not relaxed to an inequality. `e2e/forge` stays, and stays **last**
in the order — it is the reference gate 3 is measured against, and deleting the reference before
the thing it measures is how a regression becomes invisible. A separate measured finding
sharpens that: `grep` for `playwright` over the workflows on BOTH branches returns nothing, so
**no CI job runs any of the 404 Playwright specs**. They are a manual reference. That is not a
reason to delete them sooner; it is the reason they must be re-authored before they go, because
nothing else in the tree would go red on the day their assertions stop being true.

## D-025 (2026-08-30): the release is NOT blocked on a Developer ID — D-019's conclusion is CORRECTED by the user's distribution decision

**D-019 concluded that the release was blocked on a Developer ID certificate. That conclusion
was wrong, and the user corrected it.** The measurements behind it were sound; the inference
from them was not. A paid certificate was treated as a hard PREREQUISITE when it is a
FRICTION TRADEOFF, and the choice of how much friction to accept belongs to whoever ships the
product, not to the person measuring it.

**The distribution model, decided by the user:** Forge ships from GitHub Releases and later
the ArchDisc website, with auto-update on, so a user downloads once and every later version
arrives in place. Not the Mac App Store.

**One factual correction to the user's framing, recorded because getting it backwards would
misdirect future work.** Developer ID is not the App Store path -- it is precisely the
OUTSIDE-the-App-Store path. Apple's split is: Mac App Store builds use an Apple Distribution
certificate and get App Store review; anything distributed by web uses a **Developer ID
Application** certificate plus **notarization**. So shipping from GitHub Releases does not
sidestep Gatekeeper; it means the user meets Gatekeeper once. That does not change the
decision, and the decision stands.

**What was MEASURED on the existing bundle, rather than assumed:**

* `codesign -v --deep --strict` **exits 0**. The ad-hoc signature is VALID and intact, so the
  app runs normally once approved. This is the load-bearing fact: a BROKEN signature would
  fail even after "Open Anyway", and this one does not.
* `spctl -a -t exec` says **rejected**, with the quarantine attribute and without it. That is
  expected and permanent for an ad-hoc signature -- spctl assesses signature POLICY, which
  ad-hoc cannot satisfy. It is NOT a build defect and must not be chased.
* A downloaded copy carries `com.apple.quarantine`, so the first launch shows "cannot be
  opened because the developer cannot be verified". The user clears it once in System
  Settings -> Privacy & Security -> "Open Anyway".

**Two consequences that shape the implementation:**

1. **The right-click -> Open shortcut was REMOVED in macOS 15.** Any instruction telling users
   to right-click and Open is wrong on current macOS and sends them somewhere that does not
   work. The first-launch documentation must say System Settings.
2. **The updater must download and apply IN-APP, never via the browser.** A browser download
   re-applies `com.apple.quarantine` and reproduces the scary dialog on every version, which
   destroys the entire premise that the prompt is one-time. It must also verify a checksum
   BEFORE swapping: an auto-updater without that is a remote code execution channel.

**DECISION: ship ad-hoc signed, from GitHub Releases, with in-app auto-update.** No
certificate is bought. D-019's floor analysis is unaffected and still correct: minos=26.0 is a
runner-image property inherited from the Homebrew bottle tag, not an OCCT consequence, and
`desktop-release.yml` already pins `runs-on: macos-15` with `FORGE_FLOOR_MAX 15.0`, which
fixes it with OCCT still present. PR #86, which moves that workflow to the default branch so
`workflow_dispatch` registers, remains a prerequisite for a CI-driven release.

**Publishing remains a human action.** The agents preparing this are explicitly forbidden from
pushing a tag or publishing a release, including a draft. Everything is staged so that
publishing is one reviewed step.

## D-026 (2026-08-30): the app crashed THREE times on one root cause — mutating a container mid-walk — and a liveness probe could not see any of them

Three separate crashes were reported against the installed app. They were not three bugs
in the ordinary sense; they were **one defect written three times** in `ForgeFrame`:

| # | Trigger | Symptom | What was live during the mutation |
|---|---------|---------|-----------------------------------|
| 1 | first tab click | SIGSEGV at `0x17` | `DockNode&` held by the draw recursion |
| 2 | splitter drag | SIGSEGV | `children[1]` of a re-seated layout |
| 3 | feature-tree expander click | **SIGABRT**, uncaught `std::out_of_range` | clipper range sized from the previous `rowCount()` |

In each case the draw walk held an index or reference into a container, and the click
handler re-seated that container **during the walk**. The remedy is the same all three
times: record the intent, apply it after the walk returns.

**The third was found only because the second fix was verified by interaction.** The run
that aborted had presented **1165 frames** and saved its workspace, layout and keymap
cleanly. Every liveness signal was healthy. A GUI needs to be *used*, not pinged — and
"the process is still up" is not evidence about a click path.

**It is proven, not asserted.** `frame_gate.cpp` §5b clicks the real widget —
`ForgeFrame` now exposes the expander's screen rect so the gate targets it instead of
guessing pixels — and requires the row set to actually change, because a click that
no-ops would make the check unfalsifiable. Positive control, same gate, only the defer
removed:

```
pre-fix   exit 134   uncaught std::out_of_range: FeatureTreeModel::rowAt   <- the user's crash
post-fix  exit 0     188 checks, 0 failures, expander click: 17 rows -> 1 rows
```

**Two traps worth carrying forward.** First, the rebuild after restoring the good source
did **not** recompile: `cp` stamped the source in the same second the mutated object was
written, so make saw it as current and the gate still reported 134. The exit code was
right and the assumption was wrong. Second, `file(GLOB FORGE_UI_SOURCES ...)` had no
`CONFIGURE_DEPENDS`, so a new `forge::ui` source was absent from the link and surfaced as
undefined symbols in a file nobody had touched.

## D-027 (2026-08-30): a count copied into a second place goes stale — three times in one session

`EXPECTED_MUTATIONS` is pinned exactly, deliberately, and is never a floor. The number was
nonetheless duplicated into two other places, and both drifted the moment it moved 17 → 24:

* the CI **job name**, `forge-desktop compiles + its headless gates (17 mutation proofs)`,
  which advertised 17 while the suite ran 24;
* the **self-test fixture**, whose stub verdict lines were literal 17/16/18, so case A —
  the one case that must be GREEN — went red.

The second failure is the instructive one. It produced a **six-second job with no gate
output**, which reads exactly like a build failure. Time was spent looking for a broken
build that did not exist.

Resolved by removing the duplicates rather than synchronising them: the job name no longer
carries a count, and the self-test derives N from the pin and asserts the *relationship*
(one below and one above must both go red) instead of a literal. What the cases were always
about is that the check is exact; the integer was incidental.

## D-028 (2026-08-30): a clean merge silently DROPPED mutation coverage

Merging base into the release branch conflicted in exactly one place — a header comment
about the mutation count. The **code** merged cleanly, by taking one side:

```
-run_gate forge_desktop_frame_gate 1 2 3 4 5 6 7 8 9    (base)
+run_gate forge_desktop_frame_gate 1 2 3 4 5 6 7        (ours)
```

Frame mutations 8 and 9 are implemented in the merged `frame_gate.cpp`. They would simply
have stopped running, with a green suite and no line in the diff to attribute it to.
Resolving only the conflicted comment would have shipped that.

**A conflict marks where git could not choose. It does not mark where the wrong choice was
made.** When a merge touches a file that governs coverage, diff the merged result against
*both* parents for what each side ran, not just the region that conflicted.

Resolved as the union — 8 document + 9 frame + 7 update = 24 — with `EXPECTED_MUTATIONS`
moved in the same commit, which is the constraint the base comment existed to state. The
merge also exposed a real defect in code neither side touched: the missing-include preflight
had never run against the updater branch, and `update_gate.cpp` used fixed-width integers
without `<cstdint>`.

## D-029 (2026-08-30): the auto-update endpoint cannot see a prerelease — VERIFIED, and it supersedes D-024's publishing prohibition

The updater fetches `https://github.com/satvikOS/Forge/releases/latest/download/appcast.json`.
GitHub's `latest` resolves to the newest release that is **neither a draft nor a
prerelease**. Measured against the live repository:

```
releases:  tag=v0.1.0-alpha.0  draft=true  prerelease=true  assets=0
GET /releases/latest  ->  404 Not Found
```

So the chain the user asked for — download once, update forever — is **inert** for a release
published as a draft or flagged prerelease, and the failure is silent: the app simply never
finds an update. The release workflow creates every release as a draft and never publishes,
by design.

That design encoded D-024's rule that publishing is a human's call. **The user has now made
that call explicitly** ("all versions are put in the github releases", "auto updates on so
user just downloads once"), which supersedes the prohibition recorded at the end of D-025 —
recorded here rather than quietly ignored.

Two caveats stand and are not resolved by that decision:
* **minimum macOS 26.0**, set by Homebrew bottles' `LC_BUILD_VERSION`, not by any choice
  in this codebase. Users below macOS 26 cannot run the bundle at all.
* the signature is **ad-hoc**; first launch needs one pass through System Settings →
  Privacy & Security → Open Anyway. The user has accepted this explicitly.

A release must therefore be published as a **full release, not a prerelease**, for the
updater to see it — despite the version reading `alpha`. That is a footgun worth a guard
rather than a note.
---

## D-030 (2026-08-30): THICKEN's whole 193-part deletion bucket was ONE surface type, and closing it moves native coverage 67.8% -> 96.2%

**The state this starts from.** D-022 measured the drop blocked on ENGINE COVERAGE, with THICKEN at
native 67.8% vs OCCT 100.0% over 600 real parts — 193 parts where OCCT builds and native declines.
Its geometric disagreement was already understood and was NOT a native defect (OCCT's
`MakeThickSolid` returns a negatively oriented solid, which is why `Features.cpp` normalises
orientation; the `thicken_orientation_gate` pins it). So the open question was purely: WHY does
native defer on 193 parts?

**Instrument first, and the answer was not a scatter.** `runArm` in `test/corpus_ab_coverage.cpp`
has carried a `reasonFn` hook since the PIPE family's 598-part bucket was unattributable; the
THICKEN family simply never passed one. Wiring
`&forge::occtthicken::thickenLastDeferReason` into the native arm is a ONE-LINE change and it
attributed the bucket completely:

    193 of 193 deferred with the SINGLE reason "a face is not a Geom_Plane"

Not 193 spread over the file's twenty-odd named defers. One.

**A surface census named the type.** The THICKEN family's derivation feeds the largest face of the
part, of ANY surface type. Replicating that picker in a standalone probe over the same 600 parts:

    surface type of the picked face   BOTH_OK   OCCT_ONLY
    Plane                                 407           0
    Cylinder                                0         193

There is no third surface type anywhere in that slot. The deletion bucket was not "curved faces" in
general — it was cylinders, all of them, and every one spanning a full 2*pi turn.

**The closed form was READ OFF live OCCT, not reasoned about.** Skinning a cylindrical patch of
radius R by a signed t gives the coaxial cylinder R' = R + s*t. Which way s points is exactly the
kind of thing that is easy to argue and easy to get backwards, so the same
`BRepOffset_MakeOffset` call `src/Features.cpp` makes was run on all 193 picked faces and its
volume compared with BOTH candidates:

    face REVERSED (119 parts) -> OCCT's volume == the R-t form   rel < 1e-9
    face FORWARD   (51 parts) -> OCCT's volume == the R+t form   rel < 1e-9
    the remaining  (23 parts) -> NEITHER form                    rel 2e-2 .. 9e-2

**And that measurement handed over the guard for free.** The 170 that match are EXACTLY the parts
that pass a RECTANGLE CERTIFICATE, and the 23 that miss are exactly the ones that fail it. The
certificate is exact, not heuristic: a cylindrical face trims its surface to some UV region D inside
the adaptor box, and its area is exactly `R * area(D)`, so `area(face) == R*du*dv` if and only if D
IS the whole rectangle. A hole cut in the tube wall has strictly less area. So one area comparison
decides whether the closed form is OCCT's answer — the predicate was not invented, it was found by
measuring where the formula stops holding.

**The construction was CHANGED after measuring, because the first one shipped a regression.**
`forge::occtRevol` of the axial-section rectangle gives the right volume and is TKPrim-free, and it
was written and measured first. On corpus part ho1002 it returned 4F/**8E** where OCCT returns
4F/**6E**: every face a `Geom_SurfaceOfRevolution`, the two annular caps carrying a seam a planar
annulus does not have. That is a coverage gain paid for with a SURFACE-TYPE regression — every
downstream consumer asking "is this face a cylinder" would have started getting "no", including the
corpus picker itself. It was replaced with
`occtCylinderSolid(Rhi) CUT occtCylinderSolid(Rlo)`, which leaves exactly two
`Geom_CylindricalSurface` walls and two `Geom_Plane` caps — the same inventory OCCT returns, now
4F/6E/4V on both sides. The rejected construction is named in the engine banner so it is not
rediscovered.

**MEASURED, paired, same 600 parts, same derivation, nothing else changed:**

    THICKEN   before   native 407/600 = 67.8%   OCCT 600 = 100.0%   deletion bucket 193
              after    native 577/600 = 96.2%   OCCT 600 = 100.0%   deletion bucket  23
              170 parts GAINED, 0 parts LOST, McNemar exact two-sided p = 1.34e-51

Of the 170 newly-built parts: **all 170 are BRepCheck-VALID**, and the worst |volume| difference
against live OCCT over all 170 is **0.000e+00** — bit-exact, not merely inside tolerance. 165 of the
170 agree with OCCT on the FULL observable vector up to solid orientation; the 5 that do not differ
ONLY in face/edge counts, where native emits the canonical 4F/6E/4V and OCCT emits a redundantly
split 6F/13E/8V of the identical body.

**The untouched control families did not move.** Run in the same process, same corpus, same commit:

    FILLING      native 67.8%  OCCT 67.8%   deletion 0    (the known value, reproduced exactly)
    MAKEOFFSET   native 94.5%  OCCT 99.0%   deletion 27   (the known value, reproduced exactly)

A control that reproduces the prior number to the decimal is what makes the THICKEN delta readable
as the change and not as the harness.

**The remaining 23 are ONE named cause, not a mystery.** Every one of them defers with
`"cylindrical path: the face is not the full parametric rectangle (a trimmed or holed patch)"` —
the certificate declining exactly the inputs on which the closed form is provably not OCCT's answer.
Closing them needs the holed-patch case, and that is now an attributable target rather than a
silent null. THICKEN is still 3.8% short of parity, so `FORGE_THICKEN_DROP_NATIVE` does NOT flip:
the gate is `>=`, and 96.2 < 100.0.

**A withheld gate was restored, on a measurement — and the scope of that is SMALLER than it first
reads.** `ab_native_thicken_occt` was excluded from `FORGE_AB_GATES` with a note recording it RED at
a70dd1da (208 passed, 19 failed, all surface-type counts). That note had gone stale — the case5
`want`s were re-measured and pinned on 2026-08-28. Measured on this tree BEFORE any change here:
**227 passed, 0 failed, exit 0**. It is re-registered on that measurement, and it now builds and
passes through ctest as `kernel.ab.ab_native_thicken_occt`.

★ BUT `FORGE_AB_GATES` IS THE ctest LIST, AND CI DOES NOT INVOKE ctest FOR IT. Checked rather than
assumed: `.github/workflows/kernel-tests.yml` runs `forge-kernel/test/run_ab_all.sh`, whose
`HARNESSES` line ALREADY contained `thicken`, and this PR's CI run shows
`[ab-all] ok thicken: 0 failure(s), baseline 0`. So the harness was never actually dark — it was
running through the shell ratchet the whole time, and what the re-registration restores is its
ctest membership, not its execution. Claiming otherwise would have been a bigger number than the
measurement supports.

**Nothing was weakened to get there.** The gate's defer control (a) used to feed a cylinder's
lateral face and require a DECLINE with the reason "a face is not a Geom_Plane". That face is now
BUILT, so the assertion is obsolete rather than inconvenient, and it was REPLACED by two stronger
controls, not deleted: a HOLED cylindrical patch must decline with the certificate's own reason, and
a SPHERICAL face must still decline with the original one — the engine gained ONE surface type, not
a licence to approximate every one. Plus a new case 6 asserting the cylindrical result against live
OCCT and against both closed forms, with the surface inventory pinned on both sides. The gate goes
227 -> **285 passed, 0 failed**. Not one `want` was relaxed.

**Drop hygiene, checked on the object file and not on the comment.**
`NativeThickenShell.cpp.o` imports **0** `BRepOffset*`, **0** `BRepOffsetAPI*` and **0**
`BRepPrimAPI*` symbols. The new path adds only `BRepAlgoAPI_Cut` (TKBO — the same toolkit the file's
n-ary fuse already needed) and `forge::occtCylinderSolid` (in-house, TKPrim-free). No toolkit enters
the closure.

**Reversible.** The whole change is one guarded early-return in `thickenShell`, live only when the
input is a SINGLE face carrying a `Geom_CylindricalSurface`; a shell with two or more faces, or one
planar face, falls through to the code that has always handled it. Deleting that block restores
67.8% exactly. The measurement above is what would have to be refuted first.
## D-031 (2026-08-31): op-constrained TRAINING does not constrain EMISSION — the fix is a decode-time mask

`adapters/archie-30b-vocab-legal-v8` had been trained and **never evaluated**. Running it is
what produced this, and the result is the opposite of what the adapter's name asserts.

**The corpus is perfectly legal.** Measured over every row, parsing the real target form
(`%id = OP(args)`) rather than grepping for substrings:

```
data/forge/vocab_legal_v2/train.jsonl   rows=38000   distinct ops=18   ILLEGAL ops: NONE
data/forge/vocab_legal_v2/valid.jsonl   rows=2000    distinct ops=18   ILLEGAL ops: NONE
```

Zero rows contain an op outside the allowed 18, and the system prompt enumerates them
explicitly: *"The ONLY ops a user can invoke are: BLEND, CBORE, CHAMFER, CIRCLE, COMMON, CUT,
EXTRUDE, FILLET, FUSE, HOLE, LOFT, MIRROR, PATTERN, RECT, REVOLVE, RING, SHELL, TRANSLATE."*

**The model trained on it emits illegal ops anyway.** First 12 holdout rows, pinned verifier,
expert LoRA confirmed loaded (36 switch keys / 276 modules):

```
rows=12   compiled=True: 0   compiled=False: 12
out-of-vocabulary ops:  bore (6)   CYLINDER (4)   CUBOID (2)
```

None of `bore`, `CYLINDER` or `CUBOID` occurs anywhere in the 40,000-row corpus as an op.
They are **base-model CAD priors reasserting themselves through the fine-tune** — `CYLINDER`
and `CUBOID` are the primitive names a general CAD-trained model reaches for, and `bore` is
the natural-language word for the feature Forge calls `CBORE`.

**Therefore: teaching the vocabulary by example does not enforce it.** The corpus was not the
problem, so a better or larger corpus is not the fix. The constraint has to be applied where
tokens are actually chosen — a **decode-time mask or reject-and-resample over the op position**
— which makes an illegal op unrepresentable rather than merely unattested.

**A measurement trap this finding nearly fell into.** A first pass grepped the corpus for the
literal string `bore` and reported it in **11,857 of 38,000 rows**, which would have supported
exactly the wrong conclusion — that the corpus was contaminated. It is a SUBSTRING of `CBORE`
and `cboreDia`. Counting op TOKENS instead gives zero. A substring is not an op.

**Denominators, stated honestly.** The corpus side is complete and exact (40,000 rows). The
emission side is **12 of 600** — 100% so far, three distinct illegal ops, and systematic rather
than incidental, but it is not yet a rate. The run continues; if the pattern holds the rate is
the number to quote, and if it does not, this entry is wrong and must be corrected.

**What this unblocks.** [[D-015]] recorded that no `forge::ui` command creates a value, so a
literal "only what users can use" rule made generation impossible. That premise is REFUTED at
head (PR #128): a non-trivial program IS emittable from the allowed 18. So the remaining
obstacle to op-constrained Archie is not expressiveness and not corpus quality — it is
enforcement at decode time.

## D-032 (2026-08-31): the COMPLETE OCCT ledger — every toolkit accounted for, and TKOffset is a capability decision, not an engineering one

The standing instruction was "don't drop one and forget about the others". This is the
full accounting, measured on real linked binaries rather than read off a document.

**The number.** `occt_closure_count.sh` on three configurations:

```
default (committed defaults)        DIRECT=9  CLOSURE=14  PHANTOM=2
nine families, FILLET off           DIRECT=8  CLOSURE=13  PHANTOM=2
all twelve drop options ON          DIRECT=9  CLOSURE=11  PHANTOM=0
```

**A NEGATIVE CONTROL THAT SOLVES A RECURRING TRAP.** CMake accepts an unknown `-D`
silently, which has already cost this programme an entire A/B whose two arms compiled to
byte-identical binaries. There is now a discriminator:

```
-DFORGE_TOTALLY_FAKE_DROP_NATIVE=ON   ->  configures rc=0, NO warning anywhere,
                                          lands as  FORGE_TOTALLY_FAKE_DROP_NATIVE:UNINITIALIZED=ON
all twelve real options               ->  land as   FORGE_..._DROP_NATIVE:BOOL=ON
```

**The `:BOOL=` vs `:UNINITIALIZED=` suffix in CMakeCache.txt separates a live option from a
silently-swallowed typo.** Use it before believing any flag did anything.

**Every toolkit, with what actually holds it:**

| Toolkit | Status | What holds it | Excl. syms |
|---|---|---|---|
| TKOffset | droppable **only in the all-drops arm** | 42 symbols still REFERENCED in the shipping build | 42 |
| TKFillet | blocked-by-parent | TKOffset DT_NEEDs it | 11 |
| TKBool | never-needed | zero exclusive symbols; falls free with the pair | 0 |
| TKBO | blocked-by-engine | needs a native boolean/defeaturing engine | 32 |
| TKPrim | never-needed | a DEAD link record naming a library it needs no export of | 0 |
| TKG3d | no fix at any level | removing all 141 symbols moves closure by **zero** | 141 |
| TKShHealing | worth 0 closure | 12 symbols survive its own partial drop | 12 |
| TKTopAlgo | last rung | bounded for only 19 of 99 symbols (read side) | 99 |
| TKBRep | blocked by everything | stays while TKTopAlgo et al. remain | — |

**TKOffset's 42 symbols partition EXACTLY onto the nine families with no residue** —
PipeShell 7 (F), ThruSections 6 (D), DraftAngle 6 (J), MakeFilling 5 (C),
BRepOffset_MakeOffset 5 (I), MakeOffset 4 (A), MakeThickSolid 3 (G), MakePipe 3 (E),
MakeOffsetShape 3 (H). With all nine plus FILLET on, the variant library has **0 needed and
0 exclusive TKOffset symbols and dyld no longer maps libTKOffset**. It was built.

**So the drop is available in the ALL-DROPS ARM, and what blocks shipping it is CAPABILITY.**
Family J (DRAFT) is 0.0% native against 88.0% OCCT (497/565), with a measured 75.0% ceiling
for the only bounded alternative. Shipping the drop now would delete geometry users can
currently make. That is a product decision, not a compiler problem, and it should be recorded
as one rather than presented as "blocked".

### CORRECTED 2026-08-31 — three claims above were wrong, caught by adversarial verification

The first draft of this entry inherited three errors from the ledger it was written from. The
verifier rebuilt three arms from its own detached worktree at origin (31 commits ahead of the
tree the ledger measured) and reproduced every headline number — closure 14/13/11, the
parent-free set, TKG3d worth zero, TKShHealing worth zero. What it refuted was the framing:

* **"Droppable now" was wrong as a status.** In the SHIPPING build TKOffset has **42
  referenced exclusive symbols across 7 objects** (strict link, no `-undefined
  dynamic_lookup`). It reaches zero ONLY with all nine family macros on — the configuration
  that deletes 497 draft parts. The prose said this correctly; the status label contradicted
  it. A one-word label that disagrees with the paragraph under it is how a reader takes away
  the opposite of what was measured. No other label is wrong: TKBool, TKPrim, TKGeomAlgo and
  TKGeomBase all measure exactly 0.
* **"Eight of nine families fail their flip gate" was wrong.** TWO options pass, not one:
  `FORGE_FILLING_DROP_NATIVE` and `FORGE_OFFSET_DROP_MAKEOFFSET` — the latter recorded at
  `corpus_ab/makeoffset_shipped_bucket_600_summary.md` as *600 parts, both 594, native-only 6,
  **OCCT-only 0**, 100.0% vs 99.0%, PASS*. The ledger read a superseded comment table in
  `CMakeLists.txt` instead of the committed A/B summary sitting in the same tree it measured.
* **The programme's stated PRICE is overstated by up to 5.6x.** Best committed 600-part rows
  supersede four of the nine capability-cost figures: PIPE **106** deleted / 82.3% (not 598),
  FILLET **59** / 67.2% (not 315), MAKEOFFSET **0** (not 27), PIPESHELL **1** / 99.8% (not
  291), THICKEN **23** (not 193).

**The conclusion survives all of it.** DRAFT is unchanged at 0.0% vs 88.0%, and
`CMakeLists.txt:1053-1081` still requires all nine families, so the shippable ceiling stands.
But "the drop costs 1,400 parts" and "the drop costs 190 parts" are different arguments, and
only the second is true. A decision recorded with the wrong price is a decision made on the
wrong grounds.

**Two accounting traps this closes:**

* **TKFillet alone is worth NEGATIVE progress.** Flipping only `FORGE_FILLET_DROP_NATIVE`
  takes DIRECT **9 -> 10** and leaves CLOSURE at 14, with libTKFillet still mapped at
  runtime. `{TKOffset, TKFillet}` is the unit that pays; scoring TKFillet on its own reports
  a regression as an improvement.
* **`FORGE_GEOM_DROP_NATIVE` has ZERO readers of its own name.** A grep would call it dead.
  It gates an `if()` defining `FORGE_NATIVE_PROJECTION` / `_NURBS_CONVERT` / `_LAW`, read by
  13 files, and is why TKGeomBase and TKGeomAlgo now export zero exclusive symbols. Proved by
  diffing `flags.make` between configures — a flag can act **by proxy**.

**Where the next real movement is.** Not more family work: the family programme's ceiling is
CLOSURE 11 (D-027 / #127). Past that, **TKBO is worth 11 -> 10** and becomes the unique
parent-free node in the all-drops arm — but it has no option, no family, no corpus harness,
and 32 symbols across 14 files. It needs a native boolean/defeaturing engine. TKPrim's dead
DIRECT record is free accounting (DIRECT 9 -> 8) and moves the ledger by nothing.

## D-033 (2026-08-31): axis-naming is UNANSWERABLE on this holdout — and the prefix nearly gave the opposite answer

The v7 arm (axis-named corpus) was emitted and scored to completion against v5cap, paired on
ids, through the baseline pin, `--align centred-longest --grid 64`.

**The full result:**

```
paired n=516      v5cap mean 0.3004      v7 mean 0.3083
delta (v7 - v5cap) = +0.0080      95% CI [-0.0177, +0.0338]   (20k bootstrap)
per-part: v7 better on 236, worse on 206, tied 74
vs box floor 0.2367:  v5cap +0.0637   v7 +0.0716
```

**THE SIGN FLIPPED WHEN THE BIAS WAS REMOVED.** The first pairing available gave
**-0.0203**, CI [-0.0528, +0.0123] — v7 apparently *worse*. That was measured on coverage
`[100, 100, 100, 60, 0, 0]`: a PREFIX of a hardest-first holdout, with **zero coverage of the
easiest 240 rows**. The cause was mundane — v5cap had ten emission shards and only six had
ever been scored; shards 6-9 had never been run. Scoring them moved the delta from -0.0203 to
+0.0080.

Neither number is significant. But a report of "-0.0203, axis-naming hurts" would have been
published off a partial arm, and the check that caught it was one line: **count the paired ids
per 100-row block before believing any paired delta.**

**AND THE QUESTION IS UNANSWERABLE AT THIS n, which is the more useful finding:**

```
sd of the paired difference = 0.2977      SE = 0.0131
smallest reliably detectable delta at n=516  ~  0.0367
observed |delta| = 0.0080     ->  FAR below the resolution of the instrument
n needed for 80% power:   +0.050 -> 278      +0.030 -> 773      +0.020 -> 1738
```

The holdout has **600 rows**. So any true axis-naming effect smaller than ~0.037 cannot be
resolved here no matter how carefully the run is repeated. **Re-running this comparison on
this holdout is wasted GPU time**, and that is the decision: do not schedule it again.

Two ways forward, and only these: measure an effect that is expected to be *large* (>0.05,
detectable at n=278), or reduce the variance rather than chase n — sd 0.2977 on a mean of
0.30 is the real obstacle, and a stratified or lower-variance holdout buys more than a
bigger one.

**What IS established, at full n:** v7 beats the box floor (+0.0716) and so does v5cap
(+0.0637). Both are real models. Neither is distinguishable from the other here.

## D-034 (2026-08-31): D-031 completed at n=600 — 0/600 compile, and TWO concepts are 98.8% of it

D-031 was recorded at n=12 and explicitly promised a denominator. The emission has now
finished all 600 holdout rows against the pinned verifier, with the expert LoRA confirmed
loaded (36 switch keys / 276 modules).

```
rows 600      compiled=True 0      compiled=False 600
585 (97.5%)   fail on an OUT-OF-VOCABULARY op
 15 (2.5%)    fail as DEGENERATE emission (e.g. "348 statements but only 38 distinct shapes")
```

**The finding survives the full run, unchanged in direction and stronger in size.** A corpus
of 38,000 training rows containing exactly the 18 legal ops and ZERO illegal ones produced a
model that emits an illegal op in 97.5% of cases and compiles in none.

**The concentration is the new information.** The illegal ops are not a long tail:

| token | count |
|---|---|
| `bore` / `BORE` | 277 |
| `CYLINDER` / `cylinder` | 301 |
| `CUBOID` | 5 |
| `CUBE` | 2 |

**Two concepts are 578 of 585 — 98.8%.** And both have exact expressions in the allowed set:
a bore is `CBORE` or `HOLE`; a cylinder is a `CIRCLE` profile with `EXTRUDE`. The model is not
reaching for capability the vocabulary lacks. It is reaching for the NAME it learned before
the fine-tune, for a shape the vocabulary can already build.

**The case variants matter.** `CYLINDER` 257 vs `cylinder` 44, `bore` 274 vs `BORE` 3: the
model is not consistently emitting a single wrong token, it is emitting a concept in whatever
case the surrounding text suggests. That rules out one cheap fix — a literal string
substitution on the output would have to cover case variants and would still be a patch over
the wrong layer.

**What this sharpens about the remedy.** A decode-time mask over the op position remains the
right fix, and this makes it a *small* one: the mask has to suppress a handful of tokens, not
police an open vocabulary. It also makes the experiment cheap to falsify — if masking two
concepts does not move the compile rate off zero, the illegal op was a symptom and something
else is wrong, which is exactly the outcome worth knowing.

**Denominator honesty.** D-031 said 12 of 600 and "not yet a rate". It is now a rate: 600 of
600, and it did not soften. The 15 degenerate-emission rows are reported separately rather
than folded in, because they are a different defect (repetition, not vocabulary) and would
not be fixed by a mask.

## D-035 (2026-08-31): D-034 is RETRACTED — the "0/600 compile" was a UI-policy gate, not the kernel

D-034 was merged this morning. Re-measuring its own inputs refutes its central table and its
diagnosis. This entry supersedes it. The DIRECTION of D-031 survives; the CAUSE does not.

### 1. The token table was a substring artifact

D-034 reported `bore`/`BORE` 277 and `CYLINDER`/`cylinder` 301, and concluded "two concepts are
578 of 585 (98.8%)". Both counts are wrong:

* `bore` **never appears as an op**. It matched as a SUBSTRING of `CBORE`, which is a legal op.
  This project already carries the rule *A SUBSTRING IS NOT AN OP*; D-034 broke it.
* `runs/composite_anchor/axis_named_v7_e600/emissions.jsonl` contains **zero** occurrences of
  the strings `bore` or `cylinder`, in any case, anywhere in the file.

The real census, taken at the op position (`%\d+\s*=\s*NAME\s*\(`) over all 600 rows:

```
POLY 892 | VERIFY 533 | ROTATE 231 | CYL 225 | PLY 41
RESULT 23 | FST 13 | CONE 9 | POISSON 8 | PUSH 3
```

### 2. The verifier accepts almost all of them

Probing each op as `%1 = OP(1,2,3)` against the instrument itself — the method
`scripts/oov_op_rate.py` already prescribes, "truth comes from the instrument" — both
`tools/pinned/forge_verify` and `tools/baseline_pin_45e9ad9a/forge_verify` **accept 40 ops**,
including `POLY`, `CYL`, `VERIFY`, `ROTATE` and `CONE`. They reject only five names:
`FST`, `PLY`, `POISSON`, `PUSH`, `RESULT`.

**95.6% of "illegal" op uses (1890 of 1978) are ops the kernel implements.** They are forbidden
by `archie_op_vocabulary.json` for exactly one stated reason: *"no command in the forge::ui
registry emits it, so no user can produce it."* That is a UI gap, not a model error.

### 3. The emissions build

All 600 v7 emissions were fed to `tools/pinned/forge_verify`. Against D-034's "0 compiled":

```
ok=true             249  (41.5%)
valid=true          445  (74.2%)
produced a solid    485  (80.8%)
true unknown op       6  ( 1.0%)      <- D-034 said 585 (97.5%)
```

Failure taxonomy of the same 600:

```
248 (41.3%)  VERIFY assertion failed
 43 ( 7.2%)  empty feature tree
 32 ( 5.3%)  other
 23 ( 3.8%)  invalid / not-closed solid
 16 ( 2.7%)  parse error
  6 ( 1.0%)  unknown op (true out-of-vocabulary)
  6 ( 1.0%)  verifier crash or 300s timeout
```

### 4. What this changes

**The decode-time op mask is deprioritised.** D-034 argued it was the right fix and cheap to
falsify. It addresses **1.0%** of failures, not 97.5%. Spending GPU hours on it would have
bought almost nothing — and the reason we would never have noticed is that it would have
"worked": the masked rate would have moved, on six rows.

*(Incidentally D-034's premise about how to build it was also wrong. `logits_processors` is not
confined to `mlx_vlm/server/generation.py`: `mlx_vlm.generate` → `stream_generate` forwards
`**kwargs` to `mlx_vlm/generate/ar.py::generate_step`, which accepts **both** `logit_bias` and
`logits_processors`, and whose pop-list does not touch either. The hook was available on the
path `archie_loop.py` already calls. Recorded so the next person does not re-derive it.)*

**The real bottleneck is self-consistency, then fidelity.** The largest single failure is the
model asserting a property its own output does not satisfy — `VERIFY failed: holes=36 (got 30)`
— at 41.3%. That is a measurable training signal and it is not a vocabulary problem.

**The app has the actual gap.** `POLY`, `CYL`, `CONE`, `ROTATE`, `SPHERE`, `TORUS`, `SLOT`,
`TUBE`, `PRISM`, `REGPOLY`, `RRECT` and `SWEEP` are implemented in the kernel and reachable by
no user. A CAD application at the grade this project targets cannot lack a cylinder primitive.
Adding the commands closes the gap from the correct side and legalises ~95% of what Archie
already emits, without touching the model.

### 5. Why D-034 passed review

It was internally consistent, and its number came from a real script over a real file. Nothing
in it was invented. It was never checked against the instrument that judges emissions — the
verifier binary — which is the one check that would have caught it, and which the repo already
had a script for. **A gate's verdict is not the kernel's verdict.** The op-constraint bridge is
correct and already distinguishes `ForbiddenOp` (the kernel has it, no UI command emits it) from
`UnknownOp` (not a feature-IR op at all). D-034 collapsed that distinction into
"out-of-vocabulary" and lost the entire finding.

## D-036 (2026-08-31): D-033's per-arm means updated at n=576 — conclusion unchanged

The v7 instrument-failure retry finished (72 rows attempted, 48 recovered, 24 still refused as
`verifier timeout after 300s`). Merging them:

| arm | n | mean | 95% CI | vs box floor 0.2367 |
|---|---|---|---|---|
| v5cap | 576 | 0.2767 | [0.2576, 0.2958] | +0.0400 |
| v7 (as recorded in D-033) | 528 | 0.3076 | [0.2864, 0.3288] | +0.0709 |
| **v7 (with retry)** | **576** | **0.2914** | **[0.2713, 0.3114]** | **+0.0547** |

Paired comparison, before and after the recovered rows:

```
n=514   v5cap 0.2999   v7 0.3091   delta +0.0092   CI [-0.0165, +0.0349]
n=555   v5cap 0.2819   v7 0.2947   delta +0.0128   CI [-0.0111, +0.0368]
```

**D-033's conclusion stands: axis-naming is unanswerable at this denominator.** The delta is not
significant either way, and the smallest detectable effect at n=555 is 0.0343 — larger than any
plausible effect here.

**The exclusion rule is confirmed a third time.** Adding 41 excluded pairs moved both arms' means
DOWN materially (v5cap 0.2999 → 0.2819, v7 0.3091 → 0.2947) and moved the paired delta by
+0.0036. Exclusions inflate the arms and cancel in the difference.

**The sobering number.** Both arms sit barely above a box: +0.0400 and +0.0547 over the 0.2367
floor. Read with D-035, the picture is consistent — the model builds a valid solid four times in
five, and it is close to the wrong shape.

## D-037 (2026-08-31): ZERO of the 14 OCCT toolkits are dropped, and the number that says so was never gated

The owner asked directly whether all the kernel dependencies are dropped, and told us not to
drop one and forget the others. **The answer is no — none of them are.** `OCCT_CLOSURE = 14`
today, the same number as the day the ledger was created. Nothing was dropped and forgotten;
nothing has been dropped at all.

### The measurement

Three arms built at one tree (`32ee7485`, a worktree pinned to `origin/archdisc`, 0 tracked
edits), with every option read back out of `CMakeCache.txt` rather than trusted from the flag —
**CMake accepts an unknown `-D` silently**:

| arm | DIRECT | **CLOSURE** | PHANTOM | what leaves |
|---|---:|---:|---:|---|
| default — what ships | 9 | **14** | 2 | **nothing** |
| only the options that PASS their flip gate (FILLING, MAKEOFFSET) | 9 | **14** | 2 | **nothing** |
| all 12 drop options forced ON | 9 | **11** | 0 | TKOffset, TKFillet, TKBool |

Positive control that the arms genuinely differ: `cmp` differs at char 66; 9,104,000 vs
9,011,664 bytes; the configure log prints `TKOffset REMOVED FROM OCCT_LIBS`.

### Two recorded claims are corrected

* **"All nine families at parity moves closure 14 → 13" is wrong.** The two families that
  actually pass their gate move it by **zero**, because `CMakeLists.txt:1080` removes TKOffset
  only when all nine of A,C,D,E,F,G,H,I,J are compiled out — and **7 of the 9 fail their gate**.
* **"The ceiling is 12" is wrong; it is 11** (three leave, because TKBool rides out free with
  TKFillet). ★And **11 is the ceiling of a capability-DELETING configuration. With capability
  preserved the closure is 14.** Never quote 11 as progress.

### One thing gates all thirteen waves

The graph is a chain — exactly one toolkit is parent-free at a time, so there is no parallel
path and family work cannot compound. Wave 1 is TKOffset, and TKOffset needs family **J,
DRAFT**, which is **0.0% native (0/565) against OCCT's 88.0% (497/565)**, McNemar
p = 4.9e-150. Not a wiring defect: the control drafts a cube wall to 973.796 mm³, exactly
`1000 − ½·10·10·10·tan 3°`. **No bounded fix exists and that is measured, not asserted** — all
565 parts violate *both* whole-shape guards, and the number violating *exactly one* is 0 and 0,
so no relaxation of either guard moves a single part. The only alternative construction ceilings
at 424/565 = 75.0% against an 88.0% gate, a strict subset of OCCT's wins with 0 native-only wins.

**501 exclusive symbols remain, and 404 of them are waves 6–13** — the opaque-handle rewrite
(replacing `TopoDS_Shape`, `Handle(Geom_*)`, `Handle(Geom2d_Curve)`, `gp_*` and `Standard_*` as
interchange types). No option, harness or corpus exists for any of them.

**Four toolkits are free riders with nothing to build** — TKBool, TKPrim, TKGeomAlgo, TKGeomBase
export zero needed symbols. Work scheduled against them is wasted.

### ★D1 — the number the programme is scored by had no gate. FIXED IN THIS COMMIT.

`grep -rn 'occt_closure_count\|tkoffset_ledger_gate' .github/ package.json` returned **zero
hits**. `scripts/tkoffset_ledger_gate.sh` exists, is well-written, encodes the correct ceilings —
and was invoked by no workflow, no npm script, no test runner.

That is not hypothetical. The gate's own header records the regression it was built to catch: a
family-E wiring change silently took `OCCT_PHANTOM` 2 → 3, invisible on macOS
(`-undefined dynamic_lookup`) and a hard link error on Linux.

`kernel-tests.yml` now runs `occt_closure_count.sh --assert-closure 14 --assert-direct 9` right
after the kernel build. **Proved to fire in both directions** against the census build: rc=0 at
ceiling 14, and rc=1 printing `FAIL: OCCT_CLOSURE=14 exceeds --assert-closure 13` at 13. The
numbers are a ceiling, so a genuine drop is never blocked — lower them in the commit that
retires the toolkit, and that edit *is* the ledger entry.

`--assert-no-phantom` is deliberately not set: there are two phantoms today (TKBO 32 symbols,
TKG2d 24), and naming them is accounting worth 0 closure, so demanding zero would fail the build
for a defect this step exists to report rather than forbid.

### Five more defects, recorded not fixed

* **D2** — `FORGE_GEOM_DROP_NATIVE` has `option(` = 1 and source reads = **0**, so the standard
  dead-flag check calls it dead. It is live: it guards an `if()` defining three *other* macros.
  Falsified by configuring both ways — `flags.make` carries `FORGE_NATIVE_{LAW,NURBS_CONVERT,
  PROJECTION}` by default and none of them with the option OFF. **A flag can act by proxy.**
* **D3** — TKPrim's DIRECT link record is dead (raw symbol intersection = 0; the binary defines
  `forge::occtPrism` itself). The comment at `CMakeLists.txt:~470` justifying it went stale when
  PR #64 swapped `BRepPrimAPI_MakePrism` out. Removing it is DIRECT 9 → 8 at **0 closure** —
  accounting, never to be scored as a drop.
* **D4** — the two phantoms (TKBO, TKG2d) are called with no link record and survive only on
  macOS; on a strict-link CI they are hard errors.
* **D5** — `occt_drop_gate.sh` returns `DROP-SAFE` for three libraries that are not on the link
  line at all. Scheduling from that output produces exactly the wasted work noted above.
* **D6** — ★**the committed per-family corpus numbers are stale and two of them contradict.**
  Two PIPESHELL numbers (82.3% and 99.8%) are both committed at this SHA, and a later commit
  tightened the mitre transport with a `BRepCheck_Analyzer` gate because taking both merge sides
  cleanly *ships a known-invalid solid and the volume oracle cannot see a fold*. **The current
  PIPESHELL and THRUSECTIONS coverage rates are NOT MEASURED.**

### The one instruction this supports

The only work that moves this number is a **general native draft-angle engine**, and after it a
**native boolean/defeaturing engine** (TKBO, wave 4 — the first *unowned* frontier: no option, no
family, no harness). Everything else is already done, free, or unreachable until those two land.
**There is no parallel front to open here** — which is worth stating plainly, because the
instruction was to parallelise, and the lattice does not permit it.

Related: `FeatureTreeCompiler.cpp` calls `setForgeNativeBrepEnabled(false)` for every build, so
**100% of corpus booleans run on OCCT today**. And OCCT is not always a working incumbent — for
THICKSOLID *all 133 of its successes are `BRepCheck`-INVALID*, and it segfaults on the gold
reference parts (see the null-pcurve report).

## D-038 (2026-08-31): the app was missing TEN primitives the kernel already built — adding them moves corpus coverage 48.6% -> 74.9%, and SLOT is measurably broken so it stays out

*(Numbering collision, resolved at merge: this entry was allocated **D-033** on `archdisc` while `claude/sacrosanct-execution-20260828` independently allocated D-033 to the axis-naming result above. It is renumbered **D-038** here. The two comments in `ui/test/part_commands_test.cpp` (the SLOT volume defect, at lines 786 and 1035 after the #177 merge -- re-measured here, because a line number cited in a second place goes stale by standing still) that once cited "D-033" refer to THIS entry, not to the axis-naming one, and now say D-038.)*



`archie_op_vocabulary.json` said 18 user-invocable ops and 22 forbidden, and every forbidden
entry carried the same reason: *"no command in the forge::ui registry emits it, so no user can
produce it."* That is not a kernel gap. It is a **missing app surface**, and the ops it hid are
not exotic: `BOX`, `CYL`, `CONE`, `SPHERE`, `TORUS`, `PRISM`, `TUBE`, `RRECT`, `REGPOLY` and
`ROTATE` — a CAD application with no cylinder primitive. The app even **seeded a `BOX` into
every new document** (`ForgeFrame`'s default part) while giving the user no way to author one.

**What was added.** Ten `forge::ui` commands, so `registerPartCommands` goes 21 -> 31 and the
registry 31 -> 41:

| command | op | kind |
|---|---|---|
| `part.primitive_box` | `BOX` | Solid |
| `part.primitive_cylinder` | `CYL` | Solid |
| `part.primitive_cone` | `CONE` | Solid |
| `part.primitive_sphere` | `SPHERE` | Solid |
| `part.primitive_torus` | `TORUS` | Solid |
| `part.primitive_prism` | `PRISM` | Solid |
| `part.primitive_tube` | `TUBE` | Solid |
| `part.sketch_rounded_rect` | `RRECT` | Profile |
| `part.sketch_polygon` | `REGPOLY` | Profile |
| `part.rotate` | `ROTATE` | Solid (consumes one) |

Nothing was hand-edited into the asset. `gen_archie_op_vocabulary.py --write` DERIVES the
user-invocable set from the registry, so the ten moved out of `forbidden_ops` on their own:
**18 -> 28 user-invocable ops, 22 -> 12 forbidden, 20 -> 30 commands emitting IR, 34 -> 54
worked examples**, and `ui/include/forge/ui/ArchieOpVocabulary.hpp` was regenerated from the
JSON in the same commit.

**What it is worth, MEASURED on the repo's own IR corpus** (the four kernel smoke suites,
`measure_vocabulary_coverage.py`, same four files each time):

| revision | statements inside the vocabulary | programs fully inside |
|---|---|---|
| before any creator existed | 45.4% | 0.0% |
| after D-023's five creators | 48.6% (89/183) | 3.8% (2/53) |
| after this change | **74.9% (137/183)** | **54.7% (29/53)** |

The program figure is the one that matters: a program counts only if EVERY statement is inside,
so `BOX` (30 statements) and `CYL` (17) alone were disqualifying whole programs. What is left
outside is the direct-edit family (`TAG`, `DEFEATURE`, `PUSHFACE`, `RESIZEBORE`), `INPUT`,
`VERIFY`, and the three ops needing a points token `forge::ui::IrArgKind` does not model
(`POLY`, `WIRE`, `SWEEP`).

**Argument order was measured, not assumed.** Getting an optional-group order wrong produces
geometry silently, so every emitted form was compiled through the pinned native verifier
(`forge_verify` -> `forge::ft::compileText`) against closed form BEFORE the command was
written, in both the minimal and the full form. All 54 recorded examples were then re-compiled
after generation: **all 20 belonging to the new ops build a valid solid**. A VECTOR of
observables, never volume alone — the divergence theorem gives a self-intersecting shell the
right volume:

```
BOX(40,30,20)     24000.0000  = 40*30*20            6 faces genus 0  bbox [-20,-15,0]..[20,15,20]
CYL(10,25)         7853.9816  = pi*100*25           3 faces genus 0
CONE(10,4,25)      4084.0705  = pi*h/3*(r1^2+r1r2+r2^2)
SPHERE(10)         4188.7902  = 4/3*pi*1000         1 face
TORUS(30,8)       37899.2809  = 2*pi^2*30*64        GENUS 1
PRISM(6,15,20)    11691.3430  = 0.5*6*15^2*sin60*20 8 faces = 6 sides + 2 caps
TUBE(12,8,30)      7539.8224  = pi*(144-64)*30      GENUS 1, 4 faces
RRECT(40,30,5)+E  11785.3982  = (40*30-(4-pi)*25)*10
REGPOLY(20,6)+E   10392.3048  = 0.5*6*400*sin60*10  bbox 40.000 x 34.641 (corners vs flats)
ROTATE(%1,90,0,1,0) on BOX(20,10,4): vol UNCHANGED at 800, bbox [0,-5,-10]..[4,5,10]
```

The two genus-1 rows and the ROTATE row are the point. A tube whose bore failed to cut keeps a
plausible volume and reports genus 0; a rotation that did not happen keeps its volume exactly,
because a rigid motion must. Only the bbox and the genus can tell.

**SLOT IS BROKEN AND HAS NO COMMAND. This is the finding, not an omission.** `SLOT(len, wid)`
extruded 10 mm, area read back as volume/10 through the same verifier:

| statement | area | an obround is | bbox x |
|---|---|---|---|
| `SLOT(40, 12)` | 222.9027 | 449.0973 | −14.000 .. 14.000 |
| `SLOT(60, 10)` | 421.4602 | 578.5398 | −25.000 .. 25.000 |
| `SLOT(30, 20)` | 114.1593 | 514.1593 | −5.000 .. 5.000 |
| `SLOT(100, 4)` | 371.4336 | 396.5664 | −48.000 .. 48.000 |

Every row is EXACTLY `|(len - wid)*wid - pi*(wid/2)^2|` and every bbox spans `+/-(len - wid)/2`
rather than `+/-len/2`. Both semicircular end caps bow **inward**: the shape is the straight
section with a full circle's area REMOVED, not an obround with it added — **−50.4%** of the
promised volume on the nominal case, and a part 28 mm long where the statement says 40.
`profSlot`'s own source is correct (`addArc(s, cR, tr, br)` from `(l/2, r)` to `(l/2, -r)` about
`(l/2, 0)` IS the outward cap), so the defect is in how a 180-degree arc's direction is resolved
downstream. The control agrees: `RRECT`'s arcs are 90 degrees and its area is exact to ten
significant figures through the same path. Adding the command would have put a broken solid one
click away and taught Archie a shape `SLOT` is not. It stays forbidden until the arc is fixed
and re-measured. **NOT fixed here** — a kernel arc change is a different blast radius and cannot
be verified from this tree.

**POLY, WIRE and SWEEP are also NOT added, structurally.** They take a `[x y; x y; ...]` points
token, and `forge::ui::IrArgKind` models `Number/Ref/Keyword/Text` and deliberately no points
kind ("a token kind nothing produces is a liability, not coverage"). Emitting `POLY(5)` would
pass `validateIr` — arity 1..1 — and reach `profPoly`, which reads `op.poly`, finds it empty and
builds an EMPTY SKETCH. That is the silent-geometry failure mode again, so the honest gap is
recorded rather than papered over. POLY is 892 of the refused uses in the held-out sample and is
the largest remaining item.

**Two gate pins were RE-AIMED, and neither was weakened.** `op_constraint_bridge_test.cpp` named
`BOX` as its example of a forbidden op; `BOX` is now allowed, so a named example had to be an op
still out of reach — `POLY`, whose reason is structural rather than "nobody wrote the command".
The same test's mutation 1 erased `RECT` to prove the closure check has teeth; with four PROFILE
producers, erasing one of four leaves the language closed and the mutation would have been caught
by a row count instead of by the check it exists to prove. It now erases the KIND, and the run
confirms the intended path: *"NOT CLOSED — OWED, a forge::ui command that CREATES: profile;
OWED, unreachable until then: EXTRUDE, REVOLVE."*

**Every generated artifact was regenerated in this commit** — the repeated defect this project
has hit five times. `archie_op_vocabulary.json`, `ArchieOpVocabulary.hpp`,
`APP_SURFACE_MANIFEST.tsv` and the machine-checked numbers in `ARCHIE_OP_VOCABULARY.md`.
Verified: both `--check` commands exit 0, `run_op_constraint_gate.sh` reports 8/8 mutations
caught, and `run_ui.sh` reports ALL 15 UI GATES PASS.

**Two curated entries were added to `OP_ARG_OVERRIDES`, the generator's only judgement layer.**
`BOX`'s `dx/dy/dz` were classified `step_offset` by the generic `/^(dx|dy|dz)$/` rule written for
`PATTERN` and `TRANSLATE` — they are SIDE LENGTHS, and Archie trains from this file. `REGPOLY.n`
and `PRISM.nSides` were classified `instance_count`; they count SIDES of one solid, not copies.

**Observed and NOT fixed here** (pre-existing, independent of this change): of the 34 examples
that predate it, 5 do not build a solid in the pinned kernel — `LOFT(..., OPEN)` x2 ("not
closed", which is what OPEN means), `REVOLVE(%rect, 360)` x2 where the fixture profile straddles
the axis ("Pappus self-check"), and `SHELL(%body, 2, 3, 4, 4)` ("no face faces the open axis").
Recorded so the next reader does not discover them as a surprise.

**Reversible.** Each command is one self-contained block plus one id in `partCommandIds()`;
deleting a block and re-running `--write` puts its op back in `forbidden_ops`. The measurements
above are what would have to be refuted first.




## D-039 (2026-08-31): a SIGSEGV is not an exception — the kernel moves to a process the app can afford to lose, and the gates that would have caught it are built

**The defect.** `forge-kernel/reports/OCCT_NULL_PCURVE_SEGV.md` measured a null `Geom2d_Curve`
dereferenced *inside* OCCT on three paths, crashing on Archie's emitted geometry **and on the gold
reference STEP files** — `TKG2d`, `TKGeomBase`, `TKBRep`, `TKOffset`, none of them ours. It is the
only failure mode in the taxonomy that produces **no diagnostic at all**: no verdict, no error
string, no partial measurement, indistinguishable from a broken harness.

**Every cheaper remedy is closed off by measurement, not by opinion.** The report's own three
self-corrections:

1. **A pre-check on the input cannot work.** The crashing shape measured `nullPcurves=0`. The null
   is *born inside* OCCT's merge, so there is nothing on the input to repair.
2. **`KeepShapes` was implemented and measured**, and all six crashing cases still SIGSEGV'd.
3. **The accessor a guard would call is itself a faulting frame** — `BRep_Tool::CurveOnSurface` is
   the innermost frame of path B, so the guard would crash inside the guard.

And `KernelScene::buildFromIr` already catches `std::exception` **and** `(...)`. Neither clause
exists for a signal.

**So the remedy is not a check.** It is somewhere to put the fault: `forge_kernel_worker` reads one
IR program on stdin, compiles and tessellates it, and writes the vertex stream back. When OCCT
faults, that process dies and the application keeps the document, the undo stack, the dock layout
and the last good body on screen.

★ **AND IT REFUSES NOTHING.** The owner's constraint is explicit — *"dont gate anything if you do
that then how will Archie generate ultra long feature trees for Kernel to execute"* — and the report
says the same thing in geometry: a construction-time reject *"would fire hardest on the longest,
densest, most curved trees"*, which is what the ground truth is made of (`task_101` is 329 faces /
753 edges; `archie_edit_214`'s input is 430 faces, 167 cylinders and 67 B-splines). So there is **no
quarantine**. The incident ledger is advisory and `submit()` cannot consult it. Re-submitting a
program that has just crashed **runs it again**, and the gate asserts that as forcefully as it
asserts the isolation. A missing worker falls back to in-process rather than declining to model: an
application shipped without its worker is still an application.

**What the gate proves**, against the REAL worker and a REAL fatal signal — 70 checks, 0 failures:
the parent survives SIGSEGV; the drawn mesh is byte-identical afterwards (FNV hash over the vertex
stream, not merely its length); the diagnostic **names `%7 = SHELL`** from the worker's stderr op
trail, where a segfault normally leaves nothing; a hang is bounded and cancellable; a non-zero exit
is `Failed` and does **not** move the crash counter; a worker that exits 0 writing nonsense is
diagnosed rather than rendered.

**Seven mutations, five injected into a COPY of the production sources** — a mutation that only
edits the test proves the test can print FAIL. All seven are red, including `S2`, which grows
exactly the quarantine this decision forbids, and `G1`, which dereferences null *in the parent* and
is the positive control without which every "the parent survived" check is unfalsifiable.

**★ Three defects the gates found in their own authors, recorded because each is a general trap:**

* **A gate that conflated two things and asserted both were unchanged.** After a crash the *mesh*
  survives and the *build report* is reset — because the report describes the attempt that just
  failed. Both are correct; the assertion that bundled them was not. Split into `sameDrawn()` (must
  be identical) and a report that must **not** claim success.
* **A mutation that STAYED GREEN.** Removing the further frame after each command changed nothing,
  because none of the dock invariants is rebuilt by a draw — the sweep was asserting against state
  the invocation left behind, a unit test wearing a click gate's clothes. Fixed by asserting on the
  frame the redraw produces, not by dropping the mutation.
* **A gate that FLAKED.** A cancel fired on a fixed pump count that can elapse before the child's
  first write to stderr. It now waits for the fact it is demonstrating. *A gate that fails on timing
  is worse than no gate: it teaches people to re-run it until green.*

Plus two in the harness itself: a mutation matching **two** sites (the second a `const` method with
no `program` in scope) did not compile, and the runner scored that as *caught*. **A non-compiling
mutation proves nothing about the assertions** — it proves the compiler works — and is now counted
RED against the suite. And `\&` in a `sed` replacement is a literal ampersand, not the match.

**The honest coverage number, before and after.** The premise that *"CI never compiles
forge-desktop"* was **already stale** when this work began: the `desktop` job compiles the whole
CMake project and `run_click_gate.sh` compiles `forge-desktop/src` in the `kernel` job. Every one of
the 14 shipped `forge-desktop/src` TUs was already compiled. What was *not*:

| | before | after |
|---|---|---|
| shipped `forge-desktop/src` TUs compiled by CI | 13 / 13 | **14 / 14** |
| `kernel_worker_main.cpp` | **compiled by nothing** | a CMake target the app depends on |
| interactive widget families a gate exercises | **2 of 35** (tab, splitter grip) | 2 spatially + **all 41 commands by name** |
| registered commands invoked against a real frame | 0 / 41 | **41 / 41** |
| click-gate checks / mutations | 1144 / 5 | **1557 / 7** |

The 33 widgets a headless test cannot address by rectangle are not 33 behaviours: every one ends in
`ForgeFrame::invoke(id) -> ForgeShell::run()`. The surface unreachable by *position* is reachable by
*name*, and `invoke()` was made public so the gate drives the app's own schema-default parameter
filling rather than a copy of it.

**And the bundle shipped without the worker.** `package_macos.sh` copied one executable. Because the
app degrades *quietly* when the worker is absent — by design, since refusing to model would be worse
— every bundle would have had no isolation with nothing going red. The worker is now staged, seeds
the dylib walk, has its build-tree rpaths stripped (without which it would load from the build tree
and **pass a relocation test it should fail**), and is verified from the RELOCATED copy. Measured on
the packaged binary: `BOX(20, 10, 5)` -> 6 faces, 12 edges, V = 999.99999999999977; selftest crash ->
exit 139 with `FORGE-OP 7 SHELL` still on stderr.

**What this does NOT claim.** The OCCT defect is not fixed — it is survived. The null pcurve is still
dereferenced inside OCCT on all three paths, and the crash still costs the rebuild it happens in.
Whether the null on paths A and B is present on the input or generated inside the operation is
**still not measured**, and the report's instruction to run that sweep before writing any guard
stands. This decision buys the app the right to stay alive and to say which statement died; it does
not buy a correct offset.
## D-040 (2026-08-31): the missing surfacing capability was a missing TYPE — SURFACE is now the fourth IR value kind

*(Numbering collision, resolved at merge: this entry was allocated **D-038** on `archdisc`, which `claude/sacrosanct-execution-20260828` had already spent on the ten-primitives entry above. It is renumbered **D-040** here.)*



**The finding.** The feature-tree IR had exactly three value kinds — PROFILE, WIRE, SOLID
(`FeatureTree.hpp` "IR VALUE MODEL"; `Val::Kind` in `FeatureTreeCompiler.cpp`;
`forge::ui::IrValueKind` in `PartCommands.hpp`). That, not a missing op, is why the product had
no surfacing: a NURBS patch, a lofted skin and an extracted face set are none of PROFILE
(planar, at Z=0), WIRE (1-dimensional) or SOLID (must bound a volume), so **no op could produce
or consume one**, and the surfacing machinery already sitting in the kernel had no route into
the emission target. Counted by `grep -ril` over `forge-kernel/src`: NURBS 58 files, Sweep 68,
G2 32, Loft 27, curvature 21, SubD 18, Subdiv 17, Blend 17, BSpline 24 — plus
`ClassASurfacing.{hpp,cpp}` (760 lines), which a `grep -ril "class a"` misses because the file
spells it `ClassA`.

**Why it is not deferrable.** The canonical ground-truth edit fixture (`archie_edit_214`) opens
on an INPUT inventory of **430 faces, 67 of them BSPLINE** — 15% of the part. The IR could not
name one of them.

**The decision.** `SURFACE` — a sheet body: an ordered set of faces that is NOT required to be
closed, sewn, manifold, or non-empty. Six ops give it producers and consumers in both
directions, each a thin wiring of a kernel entry point that already existed: `SKIN` (open
`loftguide::loft`), `FACES` (new `forge::surf::facesOf`), `SEW` (`heal::sewShape` /
`sewing::sew`), `THICKEN` (`part::thickenSurface`), `CAP` (`heal::autoFillMissingFaces`),
`SURFCHECK` (`surf::statsOf` + `heal::checkValidity`).

**Its invariant is deliberately the weakest of the four, and that is the decision.** The
governing constraint is the owner's: *don't gate anything; a validator that refuses input is a
capability gate wearing a safety hat, and it fires hardest on the longest, densest, most curved
trees.* So an unsewn face set, edges without p-curves, a self-intersecting patch and an EMPTY
sheet are all representable SURFACE values, answerable through `SURFCHECK`, and none of them
aborts a walk. `THICKEN`/`CAP` sew an unsewn sheet as a REPAIR; `SKIN` records an unknown flag
instead of throwing; a bare `SURFCHECK "expr"` is repaired to the explicit form exactly as
`VERIFY` already is. Where a refusal is unavoidable the message names the op id, the face count
and the free-edge count.

**A wrong answer wearing the shape of a right one — found by RUNNING it.** The first
`facesOf` read an EMPTY index list as "every face". That collides with the one case the kind
exists to survive: a selector that matched nothing. Measured through
`build_surface_compile_probe.sh`, `FACES(%body, "bore:r=99999")` on a 6-face box returned all
SIX faces and `THICKEN` built a **5587 mm³ body** out of them, reported `ok=1 valid=1`. Every
headless gate was green. "Give me the whole boundary" is now a different function
(`boundaryOf`), so the two can never be spelled the same way again. **The lesson is the
familiar one and it recurred here: a capability that is only compile-verified is not verified —
the defect was invisible to three green gates and took one run to expose.**

**What is measured, on real geometry** (`surface_compile_probe`, 15/15):
`FACES("+z")` → 1 face / 4 free edges → `THICKEN(3)` → a valid solid, vol 14400.
`SKIN` of two `RING` sections → **48 free-form faces, 96 free edges** → `CAP` → a valid solid,
50 faces, vol 52961.5. A `FUSE` handed a sheet now says *"%2 is a SURFACE, expected a SOLID — a
sheet is not a body: use THICKEN(%2, wall) or CAP(%2)"* instead of the old hard-coded, and by
then false, *"is a PROFILE"*.

**The one gate that remains, named honestly.** All six ops land in the vocabulary's FORBIDDEN
list (kernel ops 40 → 46, forbidden 22 → 28) because no `forge::ui` command emits them. That is
the PRE-EXISTING app-surface policy of D-021, not a new rule about surfaces, and it lifts the
moment a command does. It is asserted rather than described in
`ui/test/surface_value_kind_test.cpp` §7.

**Known mistyping, recorded rather than silently changed.** `LOFT(..., OPEN)` produces the same
uncapped geometry as `SKIN` but is still typed `SOLID`, because `Builder::kindOf` keys on the
OpCode alone. Fixing it means making `kindOf` depend on a statement's keywords — a behaviour
change for every corpus already written against `LOFT`, and it belongs in its own commit with
its own measurement.

## D-041 (2026-09-01): a capability can land as a TYPE, a GRAMMAR and a PARSE GATE and move the product surface by ZERO — #146 did, and #165 is the control that proves it

The third JS-deletion pass expected #146 (SURFACE as the fourth IR value kind) to retire three
surfacing JS harnesses. It retires none, and the reason is worth more than the deletion.

**Measured on `b793ebe1`** (merge of `origin/archdisc` into the execution branch):

```
kernel ops (opFromName)      47      <- 40 + 6 SURFACE (#146) + 1 SECTION (#165)
forge::ui registry commands  42      <- UNCHANGED by #144 and #146; +1 from #165
user-invocable IR ops        29      <- UNCHANGED by #144 and #146; +1 from #165
forbidden_ops                18      <- 12 + the six SURFACE ops, ALL SIX. NOT SECTION.
gate 3 coverage           15.9%      <- IDENTICAL after ALL THREE PRs
```

**#165 IS THE CONTROL, AND IT ARRIVED MID-PASS.** It landed `SECTION` the other way round — an op
**and** a `forge::ui` command (`part.section_curve`) — so `SECTION` is **not** forbidden while all
six of #146's ops are. Two capability PRs, one week, one difference: **whether a command emits the
op.** Without #165 this decision would rest on a single observation; with it, it rests on a
contrast.

Every one of the six new ops carries the generated reason *"no command in the forge::ui registry
emits it, so no user can produce it."* And `forge-kernel/test/ft/surface_round_trip_test.cpp:12-16`
declares its own scope: it *"leaves `compile()`'s kernel symbols unresolved … this is a PARSE-level
gate: it proves the grammar, the op table, the arities and the tolerant repairs agree. **It does not
build geometry and does not claim to.**"*

So `knit_surface_smoke.js` still holds, alone, the only assertion in the tree that sewing two
adjacent 100×60 patches gives **area 12000** and thickening the result gives **volume 48000** with
**CoM x = 100** — a vector of observables on the knit→thicken pipeline. The nearest C++ harness,
`native_vs_occt_sew.cpp`, asserts a *topology signature* (free edges, closed, F/E/V) on *box faces*.
Same word, different subject.

**THE DECISION: a capability is not landed, and nothing becomes retireable, until (a) a `forge::ui`
command emits the op and (b) a gate BUILDS the geometry.** Three-quarters — value kind, op table
entry, parse gate — buys zero product surface and zero deletions. Future PRs claiming a capability
must state which of (a) and (b) they include; "the op exists" is not an answer. This is D-021's
finding one layer up: there the vocabulary was open, here the vocabulary is closed and the *door* is
missing.

**Corollary, and the reason this is a decision rather than a note.** `forbidden_ops` grew 12 → 18
and no gate went red, because "forbidden" is the *correct* generated state for an op no command
emits. **The list growing is the signal.** A rising `forbidden_ops` count means kernel capability is
outrunning app surface, and it is the cheapest available early warning that a PR shipped three
quarters of a feature. Read it at every capability landing.

### Two standing claims retracted in the same pass

1. **`build-app.yml` is on the default branch and ships the JS app** — asserted in four places in
   `FORGE_DELETION_PLAN.md` plus blocker B11. **False, and false when written.** It left at
   `50c512e4` (2026-08-28), an ancestor of `origin/archdisc`; `git ls-tree origin/archdisc
   --name-only .github/workflows/` returns `desktop-release.yml` and `kernel-tests.yml`. **Nothing
   in CI builds the JS app on any branch**, so deleting `frontend/` and `electron/` breaks no
   workflow. B11 cleared.

   *How it survived:* the second pass ran that exact command to confirm `desktop-release.yml` had
   **arrived** and did not notice, in the same output, that `build-app.yml` had **left**. **A
   command run to confirm one expectation will not volunteer the other half of its own answer.**

2. **`SECTION` is an op and user-invocable ops are 29** — carried in this pass's own briefing.
   **RETRACTED, THEN UN-RETRACTED, AND THE ROUND TRIP IS THE POINT.** Measured on the first tree
   (`origin/archdisc` merged into the execution branch) `SECTION` was genuinely absent from
   `opFromName`, user-invocable ops were **28**, and the only occurrence of the string in the tree
   was the comment banner `// ── SECTION RING ──` at `ui/src/PartCommands.cpp:669`, heading the
   **RING** command. All of that was true of that ref. It was **already false of the execution
   branch**, where #165 had landed `SECTION` as a real op with a real command. Final merged
   figures: **47** kernel ops, **29** user-invocable.

   **A CAPABILITY'S PRESENCE IS A PROPERTY OF A REF, NOT OF A REPOSITORY.** Two long-lived
   branches can both be measured correctly and disagree, and "I checked the tree" is not an answer
   unless it says *which* tree. A banner is still not a capability — but neither is an absence on
   one ref evidence of absence on another.

   **How the drift announced itself, which is the reusable part:** as `mergeable=CONFLICTING` on
   the PR, whose *symptom* was that **CI never ran at all**. `pull_request` workflows check out
   `refs/pull/<n>/merge`; when that ref cannot be computed there is no run — not a red run, **no
   run** — and `gh pr checks` showed one green line, `CodeRabbit — pass`, whose description read
   *"Review skipped: reviews are disabled for this base branch."* **A green bucket on a check that
   did nothing, next to zero rows for the gate that matters.** Read the description, never the
   bucket; and treat "all checks settled" as a claim to verify whenever the row count is small.



## D-042 (2026-08-31): the IR had three of OCCT's four Boolean operators, and the fourth is the only one that is not a body

*(Numbering: D-040 and D-041 are allocated on `decisions/d040-arm-qualified` and
`decisions/d041-selfconsistency-flat`, which are not merged here. This entry takes **D-042** so a
fourth collision does not have to be untangled at merge — D-033 already cost one.)*

**The hole, and how it was found.** `BRepAlgoAPI` ships four operators — `Fuse`, `Cut`, `Common`
and `Section`. `forge::ft`'s op table had three. Probing the pinned verifier with a `SECTION`
statement returned unknown-op. **No benchmark row demanded it**, so nothing was ever red: this is
exactly the class of gap a systematic map over the source finds and a census over failing rows
cannot, because a census can only see what something already asked for.

**Why the value kind is the whole decision.** A section of two solids is not a smaller solid. It is
the CURVE where their faces cross — a wire with no faces, no shells and zero volume. `Builder::
kindOf()` ends in `default: return Val::Solid`, so an op added to `OpCode` without naming itself
there is *silently typed a body*. Typed SOLID, `SECTION` would still "compile", and then
`massProperties`, `faceCount` and `checkValidity` would each report a perfectly good section as an
empty invalid body, while a downstream `FUSE` consumed nothing. **That is worse than not having the
op at all**, which is why `Section` is named EXPLICITLY in `kindOf()` and given its own handler
rather than a fourth `which` value in `opBool()` — the vocabulary generator derives each op's
consumed kinds from ITS OWN handler body, so folding them together would have described `FUSE` and
`SECTION` as one thing.

**Every site that had to change, found by grepping the op NAMES and not a symbol.** The lesson from
#140 holds: three files used a forbidden-op *exemplar* rather than a shared symbol, and a search
filtered on `ForbiddenOp` missed the one spelled `opIsCommandReachable`.

| site | file | change |
|---|---|---|
| the op table | `forge::ft::opFromName` | `{"SECTION", OpCode::Section}` |
| the enum | `forge/ft/FeatureTree.hpp` | `Section`, in its own group |
| the unknown-op repair hint list | `FeatureTreeCompiler.cpp` | so a near miss NAMES `SECTION` |
| the dispatch switch | `Builder::build()` | `-> opSection`, its own handler |
| **the value-kind switch** | `Builder::kindOf()` | `-> Val::Wire`, **explicitly, not by default** |
| the UI op table | `forge::ui::irOpTable()` | `{"SECTION", 2, 2, true}` |
| the UI command registry | `ui/src/PartCommands.cpp` | `part.section_curve`, + `partCommandIds()` |
| `GraphAudit::isPredicate` | `src/ft/GraphAudit.cpp` | **UNCHANGED, and checked** — see below |
| `toString(IrValueKind)` / the second kind enum | `ui/src/PartCommands.cpp` | **UNCHANGED** — `WIRE` already existed for `RING`/`WIRE` |

`isPredicate` is the site that is easy to get wrong in the *quiet* direction. It names `VERIFY` and
`TAG`: ops that produce no value and are therefore never orphans. `SECTION` produces one, so adding
it there would have made an unconsumed section INVISIBLE instead of reported. It is left alone, and
a test now pins that an unconsumed `SECTION` is an unexplained orphan.

**Measured** (OCCT 7.9.3, `forge-kernel/test/build_section_op_gate.sh`, four TUs and no kernel
build). Volume alone cannot validate this — a correct section and an empty solid both measure 0.0 —
so the gate asserts a VECTOR of observables:

| case | shape | wires | edges | faces / shells / solids | closed | length | volume |
|---|---|---|---|---|---|---|---|
| box(40,40,20) ∩ sphere(r=10) on the top face | `WIRE` | 1 | 1 | 0 / 0 / 0 | 1 | **62.831853** = 2·π·10 | 0 |
| box ∩ box, corner overlap | `WIRE` | 1 | 6 | 0 / 0 / 0 | 1 | **100.000000** = 40 + 40 + 20 | 0 |
| box ∩ cylinder(r=10) passing through | `COMPOUND` | **2** | 2 | 0 / 0 / 0 | 2 | **125.663706** = 4·π·10 | 0 |
| box ∩ a disjoint box | — | — | — | — | — | **refused** | — |

The first row is the sharp one: a section returned as unapproximated intersection edges would be a
chord polygon and come in *below* 2·π·10 by ~1e-2, so a 1e-6 tolerance on that length is what proves
`Approximation` was set before the build rather than after it. The third row is the one that proves
the edge chaining does not WELD: two loops that never touch stay two loops, and a single welded wire
would have measured the same total length. The fourth is a refusal on purpose — an empty section
returned as a valid-looking empty compound pushes the failure into whatever tried to loft it.

**User-invocable, not merely present.** `part.section_curve` takes two Bodies. Unlike the other three
booleans it **consumes neither operand** — both bodies survive a section, which is the point of taking
one — so its consumed-node list is empty and its produced node carries the `wire_` prefix, exactly as
`part.section_ring`'s does. A `WIRE` has to be selectable as a wire because `LOFT` is what consumes it
and `EXTRUDE` must not be offered for it; both directions are asserted.

**Falsifiability.** Three mutations, run by the build script, each required to turn the gate red:
read the section as a body, weld two distinct loops into one wire, accept an empty section. All three
are RED as required. The gate runs in CI in the `s0_conformance` job, which already installs OCCT and
already documents the `-undefined dynamic_lookup` link policy this gate shares.

**Counts, both artefacts regenerated in the same commit and `--check` clean:** `kernel_ops` 40 → 41,
`user_invocable_ops` 28 → 29, `registry_commands` 41 → 42, `commands_emitting_ir` 30 → 31.
`APP_SURFACE_MANIFEST.tsv` is a THIRD generated artefact and it was stale by exactly the one new row;
it is regenerated here too. The brief for this work said 46 → 47 — that count includes the six
`SURFACE` ops from PR #146 (`ir/surface-value-kind`), which is **not merged into either
`archdisc` or `claude/sacrosanct-execution-20260828`**. 40 → 41 is the measured state of this tree.

**What this does NOT claim.** `SECTION` is not wired into the node binding, so no `.mjs` smoke drives
it; the gate calls `forge::section` and `forge::ft::parse` directly and never `compile()`, so these
numbers are the OPERATOR's and not a whole-pipeline result. Nothing here measures a benchmark: the
interface term scores planes and cylinders only, and a section curve scores zero points on it. This
closes a hole in the op table, and it is not claimed to move a score.
## D-043 (2026-09-01): the forbidden set was 18, not 12 — and the last SIX needed one SELECTION KIND, not six commands

*(Numbering collision, resolved at merge — the THIRD in this file. `D-042` was surveyed as free across every `decisions/*` branch at `origin` before it was taken, and #165 allocated it on the execution branch in the same window. The SECTION entry keeps `D-042` because it is the one already merged; this entry is renumbered **D-043**. Content unchanged. The lesson is that surveying the `decisions/*` branches is not enough — a feature PR can allocate a number too.)*

**Number chosen by survey, not by increment.** `D-040` and `D-041` are both
already allocated on unmerged branches (`decisions/d040-arm-qualified` and
`decisions/d041-selfconsistency-flat`), and this file has just spent a merge
untangling a DOUBLE collision where two branches each allocated D-033 and D-038.
`D-042` was free on every decision branch at `origin` when this was written. The
survey is recorded so the next writer can do it in one command instead of one
merge.

### What was actually forbidden

The standing brief said twelve ops were forbidden "ONLY because no forge::ui
command emits them". Regenerating the asset on the merged tree says **eighteen**,
and the extra six are the SURFACE ops #146 landed while that list was being
written. `kernel_ops` is **46**, not the 41 the brief carried — re-measured, as
the brief itself instructed.

Of the eighteen, **seventeen are now closed**: eleven by #164, six here. The
count moved **28 -> 39 -> 45**, and `forbidden_ops` **18 -> 7 -> 1**.

### The six were not six problems

Four of the six CONSUME a sheet, and nothing in the app could hold one. A click
yields an `EntityRef`; `resolveValues()` maps it `bodyId -> valueFor() ->
kindOf()`; and every node any command produced was `body_N`, `sketch_N` or
`wire_N`. A sheet parked in `body_N` reads back as a SOLID — so `THICKEN` would
have offered itself on a fillet's output and `SHELL` on a skin, and the kernel
throws on both.

`EntityKind::Surface` + `surfaceNodeFor()` is the whole unlock, and it is the
LAST one this scheme needs: PROFILE, WIRE, SOLID and SURFACE are the whole of
`IrValueKind`, and each now has an entity kind and a node prefix. **This is the
same shape as #164's finding** — POLY/WIRE/SWEEP were blocked by a missing
`IrArgKind::Points`, not by three missing commands. Twice now, a batch of
"missing commands" has turned out to be one missing TYPE.

### A COUNT IS NOT A CAPABILITY, and this one was not

`user_invocable_ops` means "some forge::ui command emits this op". It does NOT
mean a user can run that command, and for these it did not:

* **`resolveSelection()` knew two of the four kinds.** It chose
  `want = (select == LatestProfile) ? Profile : Solid`, so a Wire- or
  Surface-signature command got a ref naming a SOLID, `resolveValues()` returned
  `{}`, and the command greyed out — reported as `SelectionSignatureMismatch` on
  a document that HELD the value. **`part.loft` has been shipped and undrivable
  by the CoPilot this entire time.**

  This is D-023's defect ("part.loft was resolving PROFILE values") standing in a
  SECOND place. It survived the fix because that search went looking for the
  command and this is the concept — the third time this file records that shape.
  Measured red-then-green: 7 of 7 cases failed before, 7 of 7 apply after.

* **The viewport still cannot pick a wire or a sheet, and that is NOT fixed.**
  `ForgeFrame`'s only two selection entry points build `Face` and `Edge` refs;
  clicking a feature-tree row calls `setEditTarget()`, which aims the parameter
  editor and writes nothing to the selection. So Archie can now drive these
  through the CoPilot and a HUMAN still cannot click them. Named rather than
  half-done: the fix is a forge-desktop change inside the tree walk that has
  already shipped three container-mutation crashes, so it needs the click gate,
  and this machine is sharing itself with a 600-row evaluation.

### SLOT is the one left, and it is not a missing command

`SLOT`'s extruded area is `|(len-wid)*wid - pi*(wid/2)^2|` at every measured size
and its bbox spans `+/-(len-wid)/2` — both semicircular caps bow INWARD, -50.4%
of the promised volume at `SLOT(40, 12)`. The mechanism is located (`addArc`
records only centre/start/end, which cannot express a semicircle), but the two
candidate repairs differ in FACE COUNT, so which one is right is itself a
question only a measurement answers, through a kernel build. No command in the
app layer can close it, and adding one would put `SLOT` into Archie's training
vocabulary as a shape it is not.

That makes `SLOT` the right negative control, and `surface_value_kind_test`
section 7 now uses it as one. That test was written by #146 to assert the six
SURFACE ops were forbidden and it predicted its own end — "it lifts the moment a
command emits these ops". It was INVERTED rather than deleted, and the
Ok / ForbiddenOp / UnknownOp three-way distinction it existed to protect is kept
in full. `Ok` is asserted for the first time: while all six were forbidden,
nothing tested the allowed verdict at all.

### One correction to the merge recipe

There are three generated artifacts, and they do not have three generators.
`APP_SURFACE_MANIFEST.tsv`'s ONLY writer is the `capability_manifest_test` binary
under `FORGE_WRITE_APP_SURFACE=1`. `forge_deletion_inventory.py` READS it and
never writes it — running that script to "regenerate" the manifest regenerates
nothing and leaves the gate red with no indication why.


## D-043 (2026-08-31): the missing surfacing capability was a missing TYPE — SURFACE is now the fourth IR value kind

*(Numbering collision, resolved across THREE merges: this entry was allocated **D-038** on `archdisc`, but that number was already taken by the ten-primitives entry above — itself renumbered out of a D-033 collision. It was then briefly **D-040**, which collides with the reservation recorded in D-042 below (`decisions/d040-arm-qualified` and `decisions/d041-selfconsistency-flat` hold D-040 and D-041). It is **D-043** here. Any comment in the tree citing "D-038" for the SURFACE value kind refers to THIS entry.)*

**The finding.** The feature-tree IR had exactly three value kinds — PROFILE, WIRE, SOLID
(`FeatureTree.hpp` "IR VALUE MODEL"; `Val::Kind` in `FeatureTreeCompiler.cpp`;
`forge::ui::IrValueKind` in `PartCommands.hpp`). That, not a missing op, is why the product had
no surfacing: a NURBS patch, a lofted skin and an extracted face set are none of PROFILE
(planar, at Z=0), WIRE (1-dimensional) or SOLID (must bound a volume), so **no op could produce
or consume one**, and the surfacing machinery already sitting in the kernel had no route into
the emission target. Counted by `grep -ril` over `forge-kernel/src`: NURBS 58 files, Sweep 68,
G2 32, Loft 27, curvature 21, SubD 18, Subdiv 17, Blend 17, BSpline 24 — plus
`ClassASurfacing.{hpp,cpp}` (760 lines), which a `grep -ril "class a"` misses because the file
spells it `ClassA`.

**Why it is not deferrable.** The canonical ground-truth edit fixture (`archie_edit_214`) opens
on an INPUT inventory of **430 faces, 67 of them BSPLINE** — 15% of the part. The IR could not
name one of them.

**The decision.** `SURFACE` — a sheet body: an ordered set of faces that is NOT required to be
closed, sewn, manifold, or non-empty. Six ops give it producers and consumers in both
directions, each a thin wiring of a kernel entry point that already existed: `SKIN` (open
`loftguide::loft`), `FACES` (new `forge::surf::facesOf`), `SEW` (`heal::sewShape` /
`sewing::sew`), `THICKEN` (`part::thickenSurface`), `CAP` (`heal::autoFillMissingFaces`),
`SURFCHECK` (`surf::statsOf` + `heal::checkValidity`).

**Its invariant is deliberately the weakest of the four, and that is the decision.** The
governing constraint is the owner's: *don't gate anything; a validator that refuses input is a
capability gate wearing a safety hat, and it fires hardest on the longest, densest, most curved
trees.* So an unsewn face set, edges without p-curves, a self-intersecting patch and an EMPTY
sheet are all representable SURFACE values, answerable through `SURFCHECK`, and none of them
aborts a walk. `THICKEN`/`CAP` sew an unsewn sheet as a REPAIR; `SKIN` records an unknown flag
instead of throwing; a bare `SURFCHECK "expr"` is repaired to the explicit form exactly as
`VERIFY` already is. Where a refusal is unavoidable the message names the op id, the face count
and the free-edge count.

**A wrong answer wearing the shape of a right one — found by RUNNING it.** The first
`facesOf` read an EMPTY index list as "every face". That collides with the one case the kind
exists to survive: a selector that matched nothing. Measured through
`build_surface_compile_probe.sh`, `FACES(%body, "bore:r=99999")` on a 6-face box returned all
SIX faces and `THICKEN` built a **5587 mm³ body** out of them, reported `ok=1 valid=1`. Every
headless gate was green. "Give me the whole boundary" is now a different function
(`boundaryOf`), so the two can never be spelled the same way again. **The lesson is the
familiar one and it recurred here: a capability that is only compile-verified is not verified —
the defect was invisible to three green gates and took one run to expose.**

**What is measured, on real geometry** (`surface_compile_probe`, 15/15):
`FACES("+z")` → 1 face / 4 free edges → `THICKEN(3)` → a valid solid, vol 14400.
`SKIN` of two `RING` sections → **48 free-form faces, 96 free edges** → `CAP` → a valid solid,
50 faces, vol 52961.5. A `FUSE` handed a sheet now says *"%2 is a SURFACE, expected a SOLID — a
sheet is not a body: use THICKEN(%2, wall) or CAP(%2)"* instead of the old hard-coded, and by
then false, *"is a PROFILE"*.

**The one gate that remains, named honestly.** All six ops land in the vocabulary's FORBIDDEN
list (kernel ops 40 → 46, forbidden 22 → 28) because no `forge::ui` command emits them. That is
the PRE-EXISTING app-surface policy of D-021, not a new rule about surfaces, and it lifts the
moment a command does. It is asserted rather than described in
`ui/test/surface_value_kind_test.cpp` §7.

**Known mistyping, recorded rather than silently changed.** `LOFT(..., OPEN)` produces the same
uncapped geometry as `SKIN` but is still typed `SOLID`, because `Builder::kindOf` keys on the
OpCode alone. Fixing it means making `kindOf` depend on a statement's keywords — a behaviour
change for every corpus already written against `LOFT`, and it belongs in its own commit with
its own measurement.

## D-044 (2026-09-01): the app could SAVE and could never OPEN — three reader defects, none of which any gate could see

**The measurement.** `ui/src/DocumentModel.cpp` and `ui/src/DocumentStore.cpp` (1,918 lines)
were recovered from `origin/rescue/wf_a23474ae-034-5`, whose own commit message says "NOT
reviewed, NOT built, and NOT claimed to compile". They had never been through a compiler. They
needed one fix to build — and then three separate defects turned up the moment anything actually
read a file back.

**1. `END` was absent from the reader's key table, for every scope.** `readDocumentFile` refuses
any key `findKey(key, scope)` has no spec for, so the END handler at the bottom of the reader —
the code that closes a `FEATURE`, `PARAMETER` or `NAMED` block and pushes it into the document —
was **dead code**. Its own comment ("It is scope-checked above") described a check that did not
exist. The writer emits a FEATURE block per statement, so **every file this application can
produce died on its first END**. Save worked; open could never work.

**2. `valueKindFromName` listed four of `IrValueKind`'s five values.** It was written when the IR
had three value kinds; `SURFACE` arrived with D-043's six producing ops. Any document holding a
single SURFACE-typed statement was refused with `unknown KIND 'surface'` — the whole surfacing
half of the kernel, unsaveable. This is the second-order cost of a merge: the two branches were
each internally consistent, and nothing compared them because nothing read a file.

**3. `~DocumentWalk` could call `std::terminate`.** The walk guard added here rebuilds the feature
tree when the outermost walk closes, and a destructor that throws while the stack is already
unwinding terminates the process. Exceptions are live in this build. That would have been a hard
crash inside the one mechanism whose purpose is to prevent a crash, on exactly the path a throw
out of a panel body takes. Reasoned about, not measured: bad_alloc cannot be forced here, and no
observation of the terminate is claimed.

**Why nothing caught any of it.** `DocumentModel` and `DocumentStore` had **no gate at all**.
They compiled, and compiling is not working. A GATE THAT DOES NOT EXIST CANNOT FAIL, and neither
can one that never exercises the round trip: a writer and a reader written together are each
other's only witness, and they agree on their shared mistakes.

**The instrument.** `serialise(load(text)) == text` is ONE observable and the one most likely to
pass while the document is wrong — a field the writer never emits round-trips perfectly as its
default, and a field both halves get wrong identically is invisible. So the round trip is asserted
on a VECTOR of **144 observables** (every statement's id / op / produces-kind / label / command /
node binding / suppression; every IR argument's kind and BIT PATTERN; the units quadruple; the
material's density and all six appearance channels; fourteen view fields; every parameter's exact
value and the expression the user typed; every named entity's five fields; the derived IR and
BUILD programs; the content digest), with **eighteen negative controls** that mutate each field in
turn — a dropped density, a storage unit changed by 25.4x, a parameter off by ONE ULP — and
require the vector to notice. An observable that cannot report a difference is decoration.

**A SECOND WRITER EXISTS, and this does not resolve it.** `.fpart` is written by
`forge-desktop/src/PartFile.cpp` (magic `FORGE-PART`, version 1, what the shipped app calls) and by
`ui/src/DocumentModel.cpp` (same magic, version 2). Same format name, two implementations. What is
gated is the property migration depends on — v1 means the same thing to both, with v1's key
vocabulary derived FROM PartFile.cpp'S OWN SOURCE so a transcription cannot drift. Two
disagreements are measured rather than assumed: compatibility is ONE-WAY (`readPartFile` pins
`version != kPartFileVersion`, so the shipped build cannot open v2 — a refusal, not a corruption),
and **the shipped writer is LOSSY**, which was stated nowhere. It formats numbers with
`formatIrNumber` ("%.10g"), so the app writes `0.1+0.2` as `0.3` and cannot read it back as the
same double. Migrating fixes that going forward; it cannot repair a file already on disk.

**What this does NOT claim.** `ForgeFrame` still holds a `PartDocument` and saves through
`PartFile`; nothing here wires the application onto the document layer, so the click gate is NOT
extended — there is no walk over this container in the app to click on yet. The two writers are
not unified. Measured on `app/viewport-document-v2` (PR #175, stacked on #167): 27 UI gates pass,
446 checks across the four new document gates.

## D-045 — self-consistency is NOT learnable from synthesised assertion supervision (the pre-registered prediction is refuted, and the direction is WORSE than baseline)

**Status: recorded mid-run at n=183 of 600. The primary prediction is refuted beyond
recovery; the "worse than baseline" reading is DIRECTIONAL and not yet established.**

A prediction was pre-registered *before* the run precisely so that it could fail. It
failed. Recording it because it failed, not in spite of that.

### What was predicted, and what was measured

| | baseline `v6r8` | predicted | measured @ n=183 |
|---|---|---|---|
| rows emitting VERIFY | 131 of 238 | — | **112 of 183** |
| of those, own assertion false | 76 | — | **95** |
| **self-inconsistency** | **58.0%** | **< 25%** | **84.8%** |
| CBORE | 0 / 238 | >= 5 (Fisher p<0.05) | **0** |

Both numbers use the SAME denominator rule — failures over VERIFY-BEARING rows, not over
all rows. Quoting `95/183 = 51.9%` would be wrong and would understate the effect; the
denominator is the rows that actually make an assertion.

### Why this is not recoverable

Reaching 25% needs <= 28 failures of 112 and there are 95. The remaining 417 rows cannot
reverse it.

### The finding

The corpus was built **measure-then-assert**: build first, read every assertion off the
kernel's own assertion path, rebuild under VERIFY, keep the row only if all pass —
**10,190 assertions, ZERO unchecked, every one true by construction.** Trained 2,400
iters, 6.89M tokens, loss 0.591 -> 0.0345. The model still asserts properties its own
output does not satisfy.

Combined with **D-041** — build rate spans 57.6–80.8% across four arms while
self-inconsistency stays FLAT at 55.1 / 56.3 / 58.0 / 58.4 — neither incidental nor
targeted supervision moves it. **A 23-point spread in whether the tree BUILDS moves
self-consistency by nothing.**

### Three caveats that bound this, stated because they cut against the strongest reading

1. ★**THE HOLDOUT IS SORTED HARDEST-FIRST, so a 183-row PREFIX IS A HARD SAMPLE.** This
   has bitten before: a partial read of 0.2423 became 0.3617 on the full set. 84.8% is
   therefore an over-estimate of the final rate by an unknown margin.
2. **The baseline comparison is UNPAIRED** — `v6r8` at n=238 against `v10` on a different
   prefix. "Worse than baseline" needs the same ids on both arms; until then the honest
   claim is only that the prediction is refuted.
3. The composite is secondary and underpowered (sd 0.2977; min detectable 0.034 at
   n=600). It is not the result.

### What follows

Synthetic assertion supervision is exhausted as a lever. The untried thing is **REAL human
construction sequences** — see the ABC `ofs` finding: chunk 0000 is already on disk, and
an even-stride census of 80 trees gives **mean 17 real ops, max 123**, dominated by
`newSketch 466 / extrude 411 / fillet 128 / revolve 55`. ★`hole` appears **once in 182
features** — real modellers cut holes with sketch+extrude rather than a hole feature,
which is a candidate explanation for CBORE never appearing and is testable.

### D-045 addendum — an instrument failure is being labelled a model failure (and it is NOT what inflates the number)

Re-measured at **n=318**: VERIFY-bearing 209, own-assertion-false 180 =
**86.1%** self-inconsistency. The prefix reading is holding, not decaying.

★**A defect in the taxonomy, found by reading a crash report rather than the log.**
`forge_verify` aborted once today on an **uncaught C++ exception**
(`__cxa_throw` -> `failed_throw` -> `std::terminate` -> `abort`; SIGABRT, not
SIGSEGV). The harness respawned and the run continued, but **three rows are
recorded as `the tree does not compile`** when the real cause was:

```
[verifier] timeout after 180s; respawn #1   -> ho998  "the tree does not compile: verifier timeout after 180s"
[verifier] timeout after 180s; respawn #2   -> ho932  "the tree does not compile: verifier timeout after 180s"
                                            -> ho962  "the tree does not compile: verifier produced no output"
```

"The tree does not compile" is a claim about the MODEL'S OUTPUT, and for these
three it is false — the tree may compile perfectly; the INSTRUMENT died or hung.
★This is the second instance today of the same failure class: an absent or
failed instrument reported as a property of the specimen (the first was
`quality_gate` labelling good STEP files `corrupt:parse_failed` because OCP was
not importable). **A verifier that dies must be its own outcome, never a verdict
on the input.**

**Direction of the error, stated because it cuts AGAINST the headline, not for
it.** Two of the three are VERIFY-bearing, so they sit in the DENOMINATOR
without contributing to the numerator. Excluding them gives **180/207 = 87.0%**.
The contamination therefore **understates** self-inconsistency slightly; D-045's
conclusion is robust to it and conservative. It is recorded anyway, because a
taxonomy that misattributes an instrument death will eventually mislead someone
in the direction that flatters us.

**Follow-up owed:** give the harness a distinct `instrument_failed` outcome so
these rows are excluded from both numerator and denominator rather than silently
scored, and capture the uncaught exception's `what()` — an abort with no message
is a second missing measurement.

### D-045 second addendum — the hardest-first caveat is EMPIRICALLY SMALL for this metric, and half the crashes never reach the report

Two measurements at **n=350** (198/231 = **85.7%**; the reading is stable across
183 -> 318 -> 350 at 84.8 / 86.1 / 85.7).

**1. The prefix caveat was right to state and is smaller than feared — measured,
not assumed.** D-045 warns that the holdout is sorted hardest-first, so a prefix
OVERSTATES. Splitting this run in half:

```
first  half   94/109 = 86.2%
second half  104/122 = 85.2%
```

**A 1.0-point gradient.** Hardest-first is a real property of the holdout — it
once turned a partial composite of 0.2423 into 0.3617 on the full set — but that
was the COMPOSITE. **Self-inconsistency is nearly order-insensitive**, which is
itself consistent with D-041: the defect does not track difficulty any more than
it tracked build rate (57.6-80.8% spread, self-inconsistency flat at
55.1/56.3/58.0/58.4). ★So the caveat stays in the record, but it is now bounded
by measurement rather than left open — and it does not rescue the prediction:
even the easier half is 85.2% against a predicted <25%.

**2. A gap between the crash reports and the run's own record.** macOS has
written **8** `forge_verify` crash reports today; the run's report contains only
**4** instrument-failure rows (3 VERIFY-bearing). So roughly half the aborts
never surface as a recorded outcome at all — they are retried, or absorbed, or
scored as something else. ★"Half the failures are invisible to the artifact that
is supposed to record them" is a measurement defect in its own right, separate
from mislabelling three rows as `the tree does not compile`. The
`instrument_failed` outcome must therefore be written where the process EXITS,
not where the harness happens to notice, and its count must reconcile against
the crash reports.

**Cause of the rising rate, and it is NOT resource pressure — a hypothesis
tested and killed.** While the aborts accelerated (3 by 16:54 -> 8 by 17:03),
free memory IMPROVED 892 MB -> 3,491 MB, compressed fell 1,526 -> 967 MB, swap
stayed flat and no jetsam fired. Only one `forge_verify` was live, parented to
the eval's own Python, and no agent worktree held one. The aborts are
INPUT-DEPENDENT — an uncaught C++ exception on particular geometry — not an OOM,
and not caused by the concurrent agents.

### D-045 FINAL — the run completed at 600/600, and PAIRED the result is a SIGNIFICANT REGRESSION, not merely a refuted prediction

The last caveat D-045 carried was that the baseline comparison was UNPAIRED, so
only "prediction refuted" was established and "worse than baseline" was NOT.
**The run finished; the pairing is done; the stronger claim now holds.**

**Paired on the 97 shared ids where BOTH arms emit a VERIFY:**

| arm | self-inconsistency |
|---|---|
| `v10` (targeted, measure-then-assert) | **90/97 = 92.8%** |
| `v6r8` (baseline) | **58/97 = 59.8%** |

Discordant pairs: **35 got WORSE, 3 got BETTER.** Exact McNemar two-sided
**p = 6.68e-08**. Targeted assertion training did not fail to help — it actively
**degraded** self-consistency, and by a margin no reasonable sampling story explains.

**The conditioning was checked before the claim was made, not after.** Restricting
to rows where BOTH arms emit a VERIFY is only safe if training did not change how
often VERIFY is emitted. It did not: on the same 238 ids, `v10` emits VERIFY on
**58.4%** and `v6r8` on **55.0%**. And the comparison run a second, independent way
— unconditionally, over each arm's OWN bearers on those same ids — agrees:
**83.5% (116/139) vs 57.3% (75/131)**. Two methods, same direction, same magnitude.
The paired figure is the higher of the two because the both-bearing subset is
harder; that is a property of the subset, not of the effect.

**What this settles.** D-045 recorded that self-consistency is not learnable from
synthesised assertion supervision. The final data says something sharper: a corpus
of 10,190 assertions with ZERO unchecked, every one true by construction, trained
2,400 iters to loss 0.0345, made the model **measurably worse** at satisfying its
own assertions. Training a model to emit assertions taught it to emit MORE
assertions (58.4% vs 55.0%) without teaching it to satisfy them — which is the
failure mode the corpus was built to prevent.

**Caveats that survive, stated because they still bound the claim.**
* The 97-id conditioning set is small; the 3-vs-35 split is what carries the
  significance, not n.
* CBORE remains **0** across the full 600 — the second pre-registered prediction
  (>=5 of 238) is refuted outright, with nothing to pair.
* The composite remains underpowered (sd 0.2977) and is still not the result.
* The instrument defect stands: ~11 `forge_verify` aborts today against ~4 recorded
  instrument-failure rows. Those rows are VERIFY-bearing and land in the DENOMINATOR
  only, so they UNDERSTATE both arms — the correction would widen the gap, not close it.

**Consequence for the programme.** Synthetic assertion supervision is not merely
exhausted, it is counter-productive. The untried lever remains REAL human
construction sequences: ABC `ofs` chunk 0000 is on disk, 9,852 FeatureScript trees,
mean 17 real ops and max 123.

### D-045 FINAL, corrected — v10 is BETTER at compiling and WORSE at self-consistency; the run's scoring half never executed

Two corrections to the record, both of which I would rather state than have
someone find later.

**1. "The evaluation completed" was too broad.** The run's own last lines are
`EMIT_DONE rc=0` then **`EVAL_FAILED rc=0 rows=0`**. `emissions.jsonl` is 0 bytes.
The TRACE completed with 600 rows; the SELF-DISTILL / COMPOSITE stage produced
nothing, so **no composite exists for v10**. Cause, confirmed rather than guessed:
self-distill keeps only rows that PASS the gate, and **0 of 600 passed**. The
harness reported this correctly — `EVAL_FAILED rows=0` is the gate working, not a
silent truncation.

**2. v10 is not uniformly worse, and the record must say so.** Measured the same
way on both arms, PAIRED on the 238 shared ids:

| | v10 | v6r8 |
|---|---|---|
| compiled | **83 = 34.9%** | 61 = 25.6% |
| emits a VERIFY | 58.4% | 55.0% |
| self-inconsistency (both-bearing, n=97) | **92.8%** | 59.8% |
| **passed the full gate** | **0 / 600** | **0 / 238** |

★**Zero passes is the BASELINE condition, not a regression** — the gate requires
volume, genus and bore count all correct, and neither arm ever clears it. Quoting
"0/600 passed" as a v10 failure would be dishonest.

★**The real shape of the effect: targeted training made the model BUILD MORE
(+9.3 points compiled) and ASSERT MORE (+3.4 points VERIFY-bearing) while making
its assertions MUCH LESS TRUE (92.8% vs 59.8%, McNemar p = 6.68e-08, 35 worse vs
3 better).** It learned the FORM of a VERIFY statement without the CONTENT. That
is a more precise and more useful finding than "assertion supervision does not
work", and it is consistent with D-041: the thing that moves is never the thing
being supervised.

**Final n=600 figures:** VERIFY-bearing 455, assertion-false 389 = **85.5%**
(stable across 84.8 / 86.1 / 85.7 / 85.6 at n=183/318/350/422). **CBORE = 0 across
all 600 emissions** — the second pre-registered prediction (>=5 of 238) is refuted
outright.

**Instrument reconciliation, as owed:** 13 `forge_verify` crash reports today
against **9** rows recorded as an instrument failure (2 timeouts, 7 "verifier
produced no output"). ★The earlier addendum said "half never surface"; measured at
the end, the shortfall is a CONSTANT **4**, not a proportion — it was 8-vs-4 then
and 13-vs-9 now. The constant-offset reading is better supported, and it is the
more useful one for finding the leak.

### D-045 correction — the instrument failures are OUT of both halves, and the correction WIDENS the result

The follow-up the first addendum owed itself is done: `instrument_failed` is a
distinct outcome, emitted where the process EXITS, reconciled against the OS's own
crash reports, and gated. This section restates every D-045 figure it touches, in
both forms, so the direction of the correction is visible rather than asserted.

**What the instrument actually lost, over the completed 600 rows.** Nine rows, all
of them written down as `the tree does not compile`:

| kind | n | rows |
|---|---:|---|
| `verifier timeout after 180s` (we SIGKILLed a wedged child) | 2 | ho932, ho998 |
| `verifier produced no output` (the child ABORTED) | 7 | ho116, ho274, ho341, ho962, ho1180, ho1212, ho1229 |

The first addendum caught **three** of these at n=318. Over the full run it is
**nine**, and **eight of the nine are VERIFY-bearing**.

**★ The direction, which cuts AGAINST the headline.** A VERIFY-bearing row the
verifier never answered for can sit in the self-inconsistency DENOMINATOR but can
never reach its NUMERATOR — a false assertion has to be *measured* to be counted.
So the contamination could only ever push the rate DOWN. Excluding the nine from
both halves:

| | published | corrected | direction |
|---|---|---|---|
| self-inconsistency, n=600 | 389 / 455 = **85.5%** | 389 / **447** = **87.0%** | **+1.53 pt — WIDER** |
| the same, counting a VERIFY failure that arrived as a compile error | 408 / 455 = 89.7% | 408 / 447 = **91.3%** | +1.60 pt — wider |

Against a pre-registered prediction of **< 25%**, the correction moves the result
*further* from the prediction, not nearer. It is recorded for that reason: a
correction that flatters the headline and one that does not must be equally
reportable, and this programme has already been bitten once by an instrument
failure worn as a property of the specimen (`quality_gate` labelling good STEP
files `corrupt:parse_failed` because OCP was not importable).

**The paired result does not move at all, and that is measured, not assumed.**
`v6r8`'s own 238-row trace contains **zero** instrument failures, and of the 238
shared ids exactly **one** (ho998) is instrument-failed on `v10` — a row that is
not VERIFY-bearing on either arm. The 97-id both-bearing set therefore contains
none of them:

| | published | corrected |
|---|---|---|
| paired self-inconsistency (both-bearing) | 92.8% vs 59.8%, n=97 | **unchanged**, n=97 |
| discordant pairs | 35 worse / 3 better | **unchanged** |
| McNemar (exact, two-sided) | p = 6.68e-08 | **unchanged** |
| paired compiled | 34.9% vs 25.6%, n=238 | 35.0% vs 25.7%, n=237 |
| VERIFY-emission rate | 58.4% vs 55.0% | 58.6% vs 55.3% |

**★ The "constant shortfall of 4" was an artefact of the window, not a leak.** The
previous section read 13 crash reports against 9 recorded instrument rows as four
deaths that went unrecorded, and noted it had measured the same offset twice
(8-vs-4, then 13-vs-9), which is exactly what a structural leak looks like. It is
not one. Attributed by **parent pid** instead of by wall clock:

```
ppid 68311 (the run's own python)    7 reports  <->  7 "produced no output" rows   1:1
five OTHER processes on the machine  6 reports  <->  nothing to do with this run
the 2 timeouts                       0 reports  <->  correct: we SIGKILL a wedged
                                                     child, and SIGKILL leaves none
13 - 9 = 4  =  6 foreign  -  2 SIGKILLed
```

A wall-clock window on a machine shared with other agents is not an attribution.
**Nothing had gone unrecorded.**

That parent-pid split was measured on 2026-09-01 while the reports still existed
and is preserved in `scripts/verifier_crash_census.py`; the `.ips` files have since
aged off the machine, so its foreign-process half cannot be re-derived today. The
half that *can* still be re-derived was, independently, and it holds exactly:
**exactly 7 of the 600 emissions carry a zero-axis `ROTATE`, and they are exactly
the 7 rows recorded "verifier produced no output"** — 7 aborts, 7 rows, 1:1.
(`FeatureTreeCompiler::opRotate` reads `ROTATE(body, angleDeg, ax, ay, az[, ox, oy,
oz])`; read as point-then-axis instead, 19 rows look zero-axis and six of the seven
change classification. The argument order is load-bearing in this census.)

**The cause, and the before/after, measured on one 3-row fixture.**
`forge::rotate`'s OCCT path built `gp_Dir(ax, ay, az)` with no zero-axis guard,
though the native path beside it always had one. `gp_Dir` raises
`Standard_ConstructionError`, which derives from `Standard_Transient` and NOT from
`std::exception`, so `main`'s `catch (const std::exception&)` never matched:
`__cxa_throw -> failed_throw -> std::terminate -> abort`. Through the
**emission-time pinned binary** (sha256 `45e9ad9a…`, the one the 600 rows were
actually emitted and gated with):

```
before   rc=134,  1 of 3 records  — the zero-axis row AND its innocent neighbour lost
         stderr: libc++abi: terminating due to uncaught exception of type
                 Standard_ConstructionError          <- destroyed by the .ips, which
                                                        carries only "abort() called"
after    rc=0,    3 of 3 records
         r2: op %2 (line 2): ROTATE: axis is zero (args 2-4 are the axis vector;
             use e.g. 0,0,1 for Z)
```

The collateral is the reason this had to be fixed at the kernel rather than only in
the harness: a mid-batch abort takes the rows behind it, so at `--batch 20` one
zero-axis row could have written off up to nineteen innocent ones.

**★ The nine lost rows, replayed.** A gate on a synthetic fixture proves the
property; the real emissions prove the recovery. All nine rows the run lost were
re-fed to the fixed binary **in one batch** — the case that used to cost the
neighbours too:

```
exit rc=0,  9 of 9 records,  peak child RSS 0.05 GiB
  ho116 ho274 ho341 ho962 ho1180 ho1212 ho1229
        -> op %3 (line 3): ROTATE: axis is zero (args 2-4 are the axis vector...)
  ho932 -> op %8 (line 8): VERIFY failed: faces=51 (got 0.000000)
  ho998 -> PAUSED_INCOMPLETE: ft parse line 74 — the emission stopped mid-statement
```

Every one is now an attributed verdict about the TREE. Seven of the nine turn out
to be the same one-line defect in the emission, which the run could not say because
the tool measuring it died first.

**The correction does not re-verify, and that is deliberate.** The nine rows are excluded from D-045's rates; they are NOT replaced by the verdicts above. Re-measuring nine rows with a fixed binary and leaving the other 591 on the pinned one would swap the instrument in the middle of the comparison — the same class of error as the one being corrected, wearing the clothes of a fix. The replay establishes that the rows are measurable, nothing more.

**★ And the two "timeouts" were not a property of their rows either.** ho932 and
ho998 were recorded as `verifier timeout after 180s`. Run ALONE against the
**emission-time binary** — the same sha256 `45e9ad9a…`, not the fixed one — they
answer in **0.1 s each**. So the 180-second wait belonged to the state the child
was in, not to the input; the label was wrong on a second axis, not just the "does
not compile" one. What put the child in that state is NOT established by this
measurement and is not claimed here.

(A caution that cuts the other way: the pinned binary and the current build are not
otherwise identical — ho998 returns `ok:true` on the pin and `PAUSED_INCOMPLETE` on
HEAD — so only the crash/no-crash property was compared across binaries, on one
fixture, with everything else held constant.)

**What now exists so this cannot recur silently.**

* `instrument_failed` is a distinct outcome in `archie_loop.py`,
  `measure_failure_v2.py`, `score_run.py` and `selfdistill_report.py`, excluded
  from BOTH the numerator and the denominator; the uncorrected figures are printed
  beside the corrected ones rather than replaced by them.
* `forge_verify` answers for itself **from inside the crash**
  (`src/tools/InstrumentRecord.hpp`): one record per row, emitted from
  `std::terminate` and from the fatal signals, carrying the row in flight, the
  exception's demangled type and its `what()`, allocation-free so a signal handler
  can use it — and it still aborts afterwards, so the OS crash report survives to
  be counted against.
* The count reconciles by parent pid (`scripts/verifier_crash_census.py`), with
  three outcomes rather than two: `unrecorded_deaths` is a finding, `pending` is
  the oracle being slow (ReportCrash was measured 438 s late once here) and is
  never reported as a leak.
* Three gates, all in CI: the unit gate drives every death path in the shipped
  header; the end-to-end gate drives the real binary; and
  `instrument_record_mutations.sh` breaks the shipped header **eight** ways and
  requires the gate to go red at the specific check each guarantee belongs to —
  because the original defect survived a whole 600-row run for exactly one reason,
  that nothing ever exercised the path it died on.

## D-046 (2026-09-01): the sketch family leaves `forbidden_ops` — 46 → 53 user-invocable ops, and the direct-ops-alone yield goes 0.00% → 40.78%

*(Numbering collision, resolved at merge: this entry was allocated **D-045** on `claude/sacrosanct-execution-20260828` while `archdisc` independently allocated D-045 to the self-consistency refutation above. It is renumbered **D-046** here, because that entry's number is written into a commit subject already on the default branch (#180) and this one's is not. Nothing outside this file cited either number.)*

**The measurement that set this.** Paired over 9,846 real ABC / Onshape FeatureScript trees
(154,637 features), scored by `implementation/sacrosanct/tools/abc_yield_census.py`. Arms differ
ONLY in which ops exist, so the rows are comparable:

| arm | vocabulary | DIRECT | translatable with DIRECT OPS ALONE |
|---|---|---|---|
| 0 | 40 ops (b003bb3a) | 55.08% | 0.00% |
| 1 | 46 ops, before this change | 55.80% | **0.00%** |
| 2 | 55 ops — the KERNEL's set | 86.02% | 40.78% (4,015) |
| 3 | **53 ops, after this change** | **86.02%** | **40.78% (4,015)** |

Arm 3 is the row this change creates, and it is not an alias for arm 2: arm 2 is the kernel's 55
and arm 3 is the 53 a user can now reach, because `ARC` and `SLOT` stay forbidden. They come out
equal because neither of those two reaches a `newSketch`, and that equality was a PREDICTION the
census had to measure — it is stated as a separate row for exactly that reason. Arms 0–2 reproduce
the previous census (PR #181) to four decimals, which is what licenses the pairing.

**The mechanism, exact.** `newSketch` appears in **100.00%** of the 5,629 trees that clear both
census gates. Every translatable human tree opens with a sketch, and a sketch was reachable only
as a canned profile (`RECT` / `CIRCLE` / `RRECT` / `REGPOLY` / `POLY`) or a `POLY` tessellation, so
no tree was lossless and the direct-ops-alone figure was exactly zero — not nearly zero. **93.63%**
of the corpus's 49,903 sketches are pure line / circle / arc, which is precisely what
`SLINE` / `SCIRC` / `SARC` reproduce.

**What it does NOT close, measured.** `clear_both_gates` is **5,629 on arms 1 and 3 alike**. This
family converts PARTIAL into DIRECT and turns no blocked tree into a clear one. What blocks the
other 4,217 is `importForeign` (51.29% of non-clearing), spline / ellipse / conic geometry
(16.34%), `draft` (8.75%) and `mateConnector` (8.61%) — none of which a sketch op reaches. 64.98%
of the non-clearing tail is UNRECOVERABLE IN PRINCIPLE.

**Why this was UI work and not kernel work.** PR #163 added all seven ops to the kernel and to
`forbidden_ops`, not to `ops`. Every entry read `compiled_into_a_default_build: true` with the
reason "no command in the `forge::ui` registry emits it, so no user can produce it". The kernel
gained the sketch family; the emittable vocabulary did not. Eight commands close it, and the
generator derives the move from the registry — the JSON was regenerated, never edited.

**Eight commands, seven ops.** `part.sketch_new` (SKETCH), `part.sketch_entity_point` (SPT),
`part.sketch_entity_line` (SLINE), `part.sketch_entity_circle` (SCIRC), `part.sketch_entity_arc`
(SARC), `part.sketch_constrain_single` and `part.sketch_constrain` (CON), `part.sketch_solve`
(SOLVE). CON gets two because it is one op with two signatures — one entity for `HORIZ` / `VERT`,
two for `COINC` / `PARA` / `PERP` / `TANG` / `EQUAL` / `PTON` / `DIST` — and a signature accepting
either would offer each on the other's selection. That mistake is NOT loud: the facade throws on a
type-mismatched operand and the compiler swallows the throw as a `SKIPPED` verify note, so the
constraint would silently not apply.

**Two selection kinds had to exist first**, for the same structural reason `EntityKind::Wire` had
to exist before `LOFT` was reachable and `EntityKind::Surface` before `THICKEN` was.
`EntityKind::Sketch` has always meant a solved PROFILE (`ArchieCopilot::wantedKind` maps it to
`IrValueKind::Profile`, the node prefix is `sketch_`), so an unsolved sketch parked there would
have made `EXTRUDE` offer itself on a sketch the kernel refuses. `OpenSketch` and `SketchRef`
carry the two kinds, with `opensketch_N` and `sketchref_N` node prefixes.

**Their `toString()` spelling is not free, and the rule is now written down.**
`archie_op_vocabulary.json` records a command's selection kind by its ENUM SPELLING, and two
consumers compare that against `toString()` case-folded — the vocabulary gate asserts the
equality, and `OpConstraintBridge::mapEntityKind` resolves the spelling back through it. So a kind
naming a SELECTION SIGNATURE must spell itself as its enum name lowered with no separator:
`opensketch`, not `open_sketch`. `SketchCurve` gets away with its underscore only because no
signature names it. Until now that agreement was a coincidence across four kinds; `Types.hpp` now
states it as a rule.

**CON rebinds the sketch's node, and the naive resolution is wrong.** CON is PASS-THROUGH — it
returns the sketch handle it was given — so its statement is that sketch with one more constraint
on it, not a second sketch, and it rebinds the node the way `TAG` and `VERIFY` rebind a body's.
The consequence is that after `%25 = CON(%22, HORIZ)` the sketch's node names `%25` and no longer
names the `SKETCH` statement `%18`, so `nodeFor(root)` answers `""` for every sketch already
constrained once — **the second constraint on any sketch, and the SOLVE after it, would have
greyed out**. `sharedSketchNode` therefore walks the records newest-first. Both this and the
cross-sketch refusal are mutation-proved: replacing the walk with `nodeFor(root)` fails 11 checks,
and removing the cross-sketch test fails 2.

**What is deliberately left out.** The `YZ` / `XZ` sketch planes: `skNew` accepts them and then
reports `plane=YZ NOT APPLIED — solved on XY`, so a command offering the keyword would record a
plane in the history that the built solid does not have — the same defect
`part.sketch_rounded_rect`'s predicate refuses on RRECT's silent corner clamp, and the reason
`SLOT` is still not registered. `SKETCH(XY)` is emitted as a literal. Also left out: the eight
constraint kinds (`RADIUS`, `DIAM`, `ANGLE`, `CONC`, `COLL`, `SYMM`, `MIDPT`, `FIX`) that exist in
planegcs and are one switch arm each in the facade, none wired at this SHA.

**A looseness this shares with REVOLVE, stated rather than discovered later.** The census scores
DIRECT at OP level, so 40.78% is an UPPER bound on what is actually emittable. `SKETCH(XY)` is the
concrete instance here: a tree whose sketch is on YZ or XZ is counted DIRECT by the census and is
not emittable by this command, exactly as `REVOLVE`'s 8-argument emitted form pins the axis origin
to a literal `0,0,0` and cannot state an off-origin revolve. Neither is corrected in the figure;
both are named.

**Two adjacent holes closed, because the tables they live in are the tables this change edits.**
`entityKindFromName` (`DocumentModel.cpp`) omitted `EntityKind::Surface`, and its own comment
claimed the mapping was total — the writer emits `toString(kind)` for ANY kind, so a named face of
a SHEET saved a document the reader then refused with `unknown KIND 'surface'`; the round-trip
gate's kind list had the same omission and a `CHECK_EQ_INT(..., 11)` that could not see it.
`describeSelection` (`ActivityLog.cpp`) omitted it too, so a selected sheet counted as "1 selected"
rather than "1 surface". Both are one-row fixes in tables the sketch kinds had to join anyway;
leaving them would have meant knowingly adding rows beside a hole.

**Gates.** `bash ui/test/run_ui.sh` — ALL 30 UI gates pass (a filtered `ONLY=` run announces it is
not a gate, so the full run is the one recorded). `bash ui/test/run_op_constraint_gate.sh` — PASS,
drift check green, 9/9 gate mutations caught, 53 allowed ops. The three generated artefacts were
regenerated by their three separate mechanisms; `--check` then named every stale prose figure and
REFUSED to auto-fix the narrative, and the sentences in `ARCHIE_OP_VOCABULARY.md` were authored by
hand from the JSON.

**What this does NOT claim.** No sketch has been solved through the real solver by this branch —
the 2D family's kernel behaviour is #163's measurement, unchanged here, and nothing in this branch
re-measures it. `forge-desktop` is not built LOCALLY here and no ribbon was clicked. CI does
compile it (`kernel-tests.yml`: "forge-desktop compiles + its headless gates (mutation-proved)"),
and the ribbon renders Part commands straight out of the registry through `ribbonCategories()`, so
the eight arrive there without a code change — but "reachable in the registry" is what is GATED,
not "clicked in the shipped app", and this branch adds no click gate. Its two curated
`EntityKind` lists (`ForgeFrame`'s selection-filter combo, which already omitted `Wire` and
`Surface`, and `PartFile`'s reader, which delegates to `irValueKindFromName` and is total by
construction) are deliberately not touched: neither is a switch, so neither would have caught the
omission, and extending the filter combo is a UI decision this branch did not measure. The 40.78% is a TRANSLATION-YIELD figure over a corpus whose
provenance is UNVERIFIED (`MODEL_DATA.md`); it is a capability measurement, not a training licence,
and it is not a benchmark score.


---

## D-050 (2026-09-01): the sketch family's binding limit was its CONSTRAINT VOCABULARY, not its value kind — CON 9 -> 19, and a merge proved a fourth value kind can be added twice without a compile error

*(Numbering collision, resolved at merge — and the THIRD number this one entry has held.
It was allocated **D-042**, having deliberately skipped D-041 for concurrent self-consistency
work; both reservations were overtaken, so at the previous merge it moved to **D-046**. That has
now been overtaken too: **#184 landed D-046 on the base** for the sketch family leaving
`forbidden_ops`. Per this file's own precedent (see the D-043 note), the entry already merged
keeps the number and the incoming one moves, so this entry is renumbered **D-050**. Content
unchanged.

**D-050 rather than D-047, and the survey is the reason.** The numbers were surveyed across every
ref at `origin`, INCLUDING THE PULL REQUESTS STILL OPEN, because a number held only on an unmerged
branch is exactly what has now overtaken this entry twice. That survey found D-047 and D-048 held
by #169 and D-049 held by #161 — all three unmerged, and all three invisible to a survey of merged
refs alone. Taking the next free number after the merged maximum would therefore have collided a
FOURTH time, with a branch already written. D-050 is the first number free on every ref, merged or
not. The lesson, three times over: a reserved number is not a held number, and a survey is only as
good as the set of refs it covers — which must include the ones not yet landed.)*

**What was already true, and is not claimed here as new.** The `SKETCH` / `SKETCHREF` value kinds,
the `SOLVE -> PROFILE -> EXTRUDE` exit, `solveOrRepair`'s never-refuse contract and the
conflict/residual demotion loop all landed with the family (PRs #159 and #163). This branch merges
them with the `SURFACE` kind (#146) and closes what was left.

**The finding.** The census
(`forge-kernel/reports/family_census/SKETCH_AND_CONSTRAINTS.md` §4) specified `CON`'s keyword set
as **nineteen** and closed: *"Every one of those routes to a primitive that ALREADY EXISTS in
GCS.h. This is facade exposure, not numerics."* **Nine** shipped. `FeatureTree.hpp` listed the
other ten as absent on a correct principle — a vocabulary naming a keyword the compiler skips is
worse than a short one — but the consequence was that the value kind was reachable and the
DRAWING was not.

A ground-truth sketch is **dimensioned**: a bolt circle is a `RADIUS`, a counterbore is a `DIAM`,
a bracket arm is an `ANGLE`. With `COINC / PARA / PERP / DIST` alone a tree can state a sketch's
TOPOLOGY and must then bake every coordinate — which is the baked form the whole family exists to
replace. So `SKETCH` was decorative in the way that matters even with the extrude path proven.

Ten switch arms in `forge::Sketcher`, each one line of planegcs, plus three refusals removed where
the primitive was declared in the very header the facade was calling into: `EQUAL` on arcs
(`EqualRadius(Arc,Arc)` exists), `TANG` on anything but line-circle (five pairings exist), and
`PTON` onto a circle or an arc (`PointOnCircle` / `PointOnArc` exist).

**★ The merge is the load-bearing evidence for the value-kind rule.** `SURFACE` and
`SKETCH`/`SKETCHREF` were each added as "the fourth kind" on branches that never saw each other.
They merged into a tree where `kAllIrValueKinds` — the ONE list the `.fpart` reader, the
vocabulary bridge and the round-trip gate all walk — was **missing a kind, and nothing failed to
compile.** The comment above it promised "a kind added to the enum is a compile error here"; that
was not true of an unsized array. It is now, via a `static_assert` on
`std::size(kAllIrValueKinds) == SketchRef + 1`. Two more sites were silently wrong the same way:
`kindName()` had no arm for `Sketch` or `SketchRef` (every sketch diagnostic would have printed
`"?"`), and `gen_archie_op_vocabulary.py`'s `REF_ACCESSOR_KIND` had no row for `refSurface`, which
would have published `THICKEN`/`CAP` as CREATORS reachable from an empty document.

**★ And the gate was measuring a stale build.** `build_sketch_solve.sh` cached an object whenever
it was newer than its `.cpp`, comparing against **no headers**. Editing `Sketcher.hpp` — where this
family's constraint enum lives — left the old object in place and the gate reported PASS for the
previous build. That is "a gate that cannot build cannot fail" with an extra step: it *does* build,
it just builds something else. Every number below is from a clean `.sketchbuild`, and the fix was
verified by touching a header and watching all eight TUs recompile.

**Measured, from a clean build** (`forge-kernel/test/ft/build_sketch_solve.sh`, 57 -> 103 checks,
0 failures). Every case asserts a NUMBER the constraint had to move, because "it did not throw" is
also what a keyword mapped to the wrong primitive looks like:

```
[RADIUS]  seeded 5 -> solved 12.000000 (want 12)
[DIAM]    DIAM 30 -> radius 15.000000 (want 15, NOT 30)
[ANGLE]   |cos| between the two lines = 0.000000000 (want 0)
[FIX]     anchor stayed at (0.000000000, 0.000000000)
[DISTXY]  partner at (25.000000000, -7.000000000) (want 25, -7)
[CONC]    centre separation 0.000000000 (was 24.41)
[COLL]    the other line's endpoints y = -0.000000000, -0.000000000
[MIDPT]   midpoint at (20.000000000, 10.000000000)
[SYMM]    mirrored point at (12.000000000, 20.000000000)
[PTON]    point distance from centre 10.000000000 (want 10)
[COLL/repair] demotions = 1 (want 1); every FIXed point still where it was drawn
[keywords] 19 of 19 documented CON keywords dispatch
```

**Falsifiability proved by mutation, not asserted.** Four mutants, each reverted:

| mutant | result |
|---|---|
| the degrees->radians conversion removed | `[ANGLE] \|cos\| = 0.448073616` — FAIL. The case comment PREDICTED 0.447 before the mutant ran. |
| `DIAM` routed to `CircleRadius` | `[DIAM] radius 30.000000` — FAIL |
| `COLL`'s two constraints split across two tags | `demotions = 2` — FAIL |
| point-form `ANGLE` forced onto the tag-dropping overload | `residual = nan` — FAIL |

**★ The third mutant is the one worth recording, because the FIRST version of that case did not
catch it.** With line B pinned horizontal, `COLL`'s Parallel half was already satisfied, so
splitting the tag still needed only one demotion and the test passed against the mutant — an
unfalsifiable check dressed as a measurement of a claim written in a code comment. The geometry was
changed so both halves independently conflict, and only then did the mutant turn it red. *Running
the mutation is what found this; the check had already "passed".*

**★ A REAL DEFECT IN THE VENDORED SOLVER, found by rewriting a test that had already passed.**
`ANGLE`'s two-point form goes to `addConstraintP2PAngle`. planegcs declares that twice, and the
convenient four-argument overload **discards the caller's tag** (`GCS.cpp:655`):

```cpp
int System::addConstraintP2PAngle(Point& p1, Point& p2, double* angle,
                                  int /*tagId*/, bool driving)
{ return addConstraintP2PAngle(p1, p2, angle, 0., 0, driving); }
```

The parameter is commented out and **0 — planegcs's "no tag" sentinel — is hard-coded in its
place.** It is the ONLY delegating overload in that file that does this: **34** delegating definitions were
counted and **33** forward `tagId`. (A first pass said 30/29 — the three multi-line
`addConstraintTangentCircumf` calls forward the tag on a continuation line, which a one-line grep
cannot see. Recorded because it is the same shape as the rest of this entry: a count is only worth
what the instrument that produced it can see.) A constraint left on tag 0 is invisible to `getConflicting()`,
`clearByTag()` and `calculateConstraintErrorByTag()`, so the geometry still solves while **the
repair loop can never demote it and its residual reads NaN** — a silent hole in exactly the
never-refuse contract this family exists to honour. Fixed in the FACADE, not in the vendored file
(`3rdParty` is a verbatim vendor copy), by calling the five-argument overload with
`incrAngle = 0.0` and the real tag. Measured both ways: NaN before, `-1.471127674` after.

**★ How it was found is the point.** The first version of that test contradicted the angle against
two `FIX`es and asserted the repair NAMED a demotion. It passed — and it passed against a mutant
that deliberately selected the wrong overload, because the repair satisfied the assertion by
dropping a `FIX` instead. A downstream consequence another constraint can satisfy is not a probe of
the thing. Rewritten to ask `constraintResidual()` for the returned tag directly — which nothing
else in the sketch can mask — it caught the mutant, and then caught the SAME defect in the
unmutated code. **Two of this branch's tests were unfalsifiable when first written, and running
mutations against them is the only reason either is worth anything.**

**The unit seam, stated because a wrong answer here still builds.** The IR is degrees (`ROTATE`,
`PATTERN POLAR`, `REVOLVE`); planegcs is radians. The conversion is at the IR boundary and both
sides name it. Unconverted, `ANGLE 90` aims at 90 rad = 116.6 deg after wrapping: it compiles,
solves, converges and reports a clean DOF while making the wrong part.

**What this does NOT claim.** The seven sketch ops are still **forbidden in the app vocabulary** —
no `forge::ui` command emits `SKETCH`/`SPT`/`SLINE`/`SCIRC`/`SARC`/`CON`/`SOLVE`, and an Archie
plan naming `SOLVE` is refused by the op-constraint bridge before dispatch. That is the
emission-surface work, not this branch, and it is the next thing standing between this family and
a benchmark score.

*(Figure re-measured at every merge, because it goes stale by standing still — which is
the defect class this whole entry is about. It has now gone stale FOUR times. When this entry was
written the count was **25 of 53** forbidden; after #164 it read **14 of 53**; at the merge before
this one it was **9 of 55**. MEASURED on the tree this merge commits, from the regenerated
`archie_op_vocabulary.json`, it is **2 of 55** — only `ARC` and `SLOT`. The seven sketch ops left
`forbidden_ops` entirely, because D-045 (#184) gave the family eight commands while this branch
was in review.

★ THAT CHANGES WHAT THIS ENTRY CLAIMS, so the claim is restated rather than left standing. The
previous wording said the nineteen keywords were "invisible to the emission surface" because `CON`
was forbidden. `CON` is no longer forbidden, and the invisibility did not disappear — it MOVED
DOWN ONE LAYER, and it is now measurable rather than structural. MEASURED on this tree:

  the compiler dispatches            19 CON keywords (`kKinds`, FeatureTreeCompiler.cpp)
  the two CON commands offer          9 (`part.sketch_constrain{,_single}`, PartCommands.cpp)
  reachable by a user                 9
  dispatchable but UNREACHABLE       10 — ANGLE COLL CONC DIAM DISTX DISTY FIX
                                          MIDPT RADIUS SYMM
  offered but NOT dispatched          0

The last row is the one that would be a DEFECT rather than a gap, and it is empty: no command
promises a keyword the compiler would skip. The ten in the fourth row are the same shape of gap
this entry was written about, one layer up — the facade has them, the compiler routes them, and no
command emits them. That is app-surface work, it is not done here, and it is now a number someone
can close rather than a sentence.)*

No benchmark number is claimed here: nothing in this branch was scored against BenchCAD,
CADGenBench or MUSE.


## D-047 (2026-09-02): the app could save a part and could not offer it back — the reopen leg had no surface, and the crash-isolation state was reported to a stream a Finder launch does not have

**The audit that found it.** Against the running surface rather than the source: the committed
`APP_SURFACE_MANIFEST.tsv` holds 80 commands (58 Part, carrying 53 distinct feature-IR ops), and
`app_surface_reachability_test` already proves every one of them is offered by the menu, the
ribbon, the palette, the tool catalog and the manifest. So breadth was not the gap. The gap was on
the ONE path the product is judged on — open, sketch, extrude, modify, save, reopen — and it was in
the last step.

**`file.open` declares `path` REQUIRED with no default, and it is right to.** `""` is not a
document, so Ctrl+O opens the parameter prompt instead of failing. The prompt seeded that box from
`ForgeFrame::documentPath_` — **which is empty on every launch**. A user who saved a part, quit,
and came back got an EMPTY text box and no way to reopen their work except to type its absolute
path from memory. Worse for the commonest case: `file.save` with no path writes to
`~/.forge/<name>.fpart` (ForgeFrame.cpp), a directory the user never chose, never sees and has no
reason to guess — so they could save successfully and be unable to find the file again, with
nothing anywhere reporting a failure. There was no recent-documents list of any kind in the tree:
`grep -rn recent ui/ forge-desktop/src` matched an LRU cache in `FeatureTreeModel` and a comment.

**The fix is a model in the layer CI compiles, written by the HANDLERS.**
`forge::ui::RecentDocuments` is a bounded MRU list (10, dedup, most-recent-first) owned by
`ForgeShell` and written inside the `file.open` and `file.save` execute bodies — so a menu click,
Ctrl+O, the palette, `--open` on the command line and an Archie tool call all feed it by
construction. A surface that remembered paths itself would be a second list only that surface can
see. Three specifics that are not incidental:

* It reads the path back from `documentHost_->documentPath()`, never from the command's `path`
  argument. A bare Ctrl+S passes `""` and the HOST chooses where it went; remembering the argument
  would remember the empty string, which is precisely the case that loses the file.
* Only a SUCCESSFUL open or save is remembered. A refused open leaves the list untouched, so a path
  that does not exist is never offered back for ever.
* `isStorable()` refuses a path containing `\n` or `\r`. A POSIX path may legally contain a
  newline and the session file is line-oriented, so storing one would emit a `recent` record whose
  tail parses as a further record — silently corrupting the workspace, layouts or keymap after it.

**It persists, and `restore()` is not `remember()` in a loop.** `saveState`/`loadState` carry
`recent <path>` lines beside the workspace and the keymap. `remember()` pushes to the FRONT, so
replaying a most-recent-first file through it would load the list REVERSED and the session file
would invert the user's history on every launch. `restore()` takes the order as given. The record
is optional on read (a session file that predates it still loads, and an unknown record was already
tolerated-and-counted rather than refused), and the round trip is byte-identical.

**The second half: the safety net nobody could see.** `main.cpp` probes `forge_kernel_worker` at
startup and, when it will not launch, turns isolation OFF and prints `kernel isolation:
UNAVAILABLE ... modelling runs IN PROCESS` to **stderr**. A user who launches Forge.app from the
Finder or the Dock has no stderr. The single most consequential fact the startup path knows — that
an OCCT fault will now take the document with it — reached nobody. `ForgeFrame::reportKernelIsolation()`
now writes it into `shell_.log()`, which the console panel filters by severity and the status strip
counts, and it READS THE SCENE rather than being told, so the log cannot say "active" about a
session that is not. It is a WARNING, not an error: the app is still an application without its
worker, and refusing to model would be the capability gate wearing a safety hat that
`KernelSession.hpp` already argues against.

**What is deliberately NOT done.** No native file dialog. `file.open` still takes a typed path, now
pre-filled and reachable from File > Open Recent; an `NSOpenPanel` is Objective-C++, would make the
TU `.mm`, and cannot be driven by a headless gate — so it is written down as owed rather than
half-built. The prompt seeds `""` on a first-ever launch with nothing remembered: there is nothing
to suggest, and inventing a path that does not exist would put a refusal one Enter away. A
remembered path that stops opening is KEPT, not dropped — this frame cannot tell "deleted" from
"the volume is not mounted today", and silently forgetting a part because a share was asleep is the
worse of the two mistakes; it raises a named error instead.

**Gates.** `bash ui/test/run_ui.sh` — ALL 31 UI gates pass (30 before; `recent_documents` is the
new one, 78 checks). `bash forge-desktop/test/run_syntax_gate.sh` — GREEN, all 12 forge-desktop TUs
type-check. `frame_gate` gains mutations 10 and 11 (a session with a worker CONFIGURED is not
distinguished from one without; the frame never dispatches the deferred Open Recent request), so
`EXPECTED_MUTATIONS` in `ci_desktop_gate.sh` moves 40 → 42 — RE-COUNTED from run_desktop.sh's own
`run_gate` arguments on this tree (document 8 + frame 11 + copilot 8 + update 7 + click 8), not
incremented on faith.

**Two gate defects found while reading them, and fixed here.** The `desktop_app` job asserted six
of the TEN executables `cmake --build` produces — `forge_desktop_copilot_gate`,
`forge_desktop_click_gate`, `forge_desktop_update_gate` and `forge_update` could all have stopped
being PRODUCED with that step still green. And its comment said the gate pins "exactly 31
mutations" while `ci_desktop_gate.sh` pinned 40: a number in two places is a number that drifts, so
the count is now named only where it decides the build.

**What this does NOT claim.** `forge-desktop` was NOT built locally (a 30B training run held this
box); only the `-fsyntax-only` gate and the headless forge::ui suite were run here, and CI is the
authority for the compiled half. No window was opened and no menu was clicked: File > Open Recent
is asserted by ENUMERATION and by the deferral contract, not by pixels, exactly as
`app_surface_reachability_test` states of every other surface. And the packaging assertions that
prove `forge_kernel_worker` ships inside `Contents/MacOS/` (`package_macos.sh` dies without it;
`release_dryrun.sh` re-checks the built bundle) still run ONLY on a tag or a dispatch of
`desktop-release.yml` — they are correct and they have no PR-time gate. That is recorded as an open
finding, not closed here: a 90-minute packaging job on every PR would be the wrong answer to it.

## D-048 (2026-09-02): a user could not extrude a sketch — 28 of the 80 commands needed a selection kind the interface could not produce, and every gate was green because none of them was asking

**The measurement.** ForgeFrame had exactly TWO producers of selection refs:
`clickFace`, which makes an `EntityKind::Face`, and `clickEdge`, which makes an `EntityKind::Edge`.
`grep -n "ref.kind = "` over `forge-desktop/src/ForgeFrame.cpp` at 2b09b774 returns FOUR lines
naming exactly TWO kinds — 1118 and 1141 `EntityKind::Face` (the preselection and the click), 1216
and 1233 `EntityKind::Edge` (the same pair) — and nothing else in the file assigns a ref kind at
all. `SelectionSignature::satisfiedBy` compares kinds EXACTLY —
`sel.countOf(kind) == total`, with no subsumption — so a picked Face does not stand in for a Body
and certainly not for a Profile. Classifying the live registry by required kind gives:

| required kind | commands | reachable |
|---|---|---|
| none | 39 | yes |
| any | 2 | yes |
| face | 8 | yes (viewport pick) |
| edge | 3 | yes (viewport pick) |
| **body** | **13** | **no** |
| **sketchref** | **5** | **no** |
| **surface** | **4** | **no** |
| **sketch** | **2** | **no** |
| **opensketch** | **2** | **no** |
| **wire** | **2** | **no** |

**28 of 80 were un-invocable by a human.** The list includes `part.extrude` and `part.revolve`,
all three booleans, all three patterns, mirror, move, rotate, loft, skin, thicken, cap, sew and the
entire sketch-entity family. **A user could not extrude a sketch in a CAD application.**

**Why every gate was green.** `capability_manifest_test` asks whether the committed manifest equals
the live registry — it did. `app_surface_reachability_test` asks whether every surface OFFERS every
command — it did, in both directions, for the menu, the ribbon, the palette, the tool catalog and
the manifest; that gate states its own limit in its header ("Enumeration, not pixels"). **Offering
a command and being able to invoke it are two claims, and only the first one had a gate.** The
sharpest form of the finding: `ArchieCopilot::resolveSelection` builds exactly the refs that were
missing, so the AGENT could drive all 28 commands the PERSON could not.

**The close.** A feature-tree row IS a document statement, which is precisely what those signatures
want, so the tree becomes the third producer. `ForgeFrame::clickFeature(irId, additive)` takes the
kind from a new `forge::ui::entityKindFor(IrValueKind)` — never from a mapping the frame invents —
and shift-click is how two bodies are picked for a boolean and three points for a sketch arc. Two
details that are not incidental:

* **The filter is honoured, and honoured FIRST.** A tree click that ignored the selection filter
  would make "set the filter to Edge" mean nothing in half the window. It is checked before the
  binding below, so a refused pick leaves the document exactly as it was.
* **An unbound statement is bound on demand.** `resolveValues()` reads `bodyId -> valueFor() ->
  kindOf()`, so a statement with no node binding cannot be resolved by ANY route — and
  `makeDefaultPart()` binds a node for only its LAST statement, so the four rows a new document
  opens on were exactly the un-pickable ones. `clickFeature` binds `pick_<irId>` through
  `PartDocument::restore()`, the document's own published way to set a binding (`ensureBodyBinding`
  already does the same for the body). This is not a document edit: bindings are not statements, so
  `irProgram()` is unchanged and nothing rebuilds. `kindOf()` reads the record's own `produces`
  field rather than the node's spelling, which is why the name only has to be unique and needs none
  of PartCommands' private `sketch_` / `wire_` prefixes.

**Gates, and the two halves they divide into.**
`ui/test/selection_reachability_test.cpp` is the standing measurement: it classifies the live
registry, reads the producible kinds out of `ForgeFrame.cpp` AS DATA (the literal
`ref.kind = forge::ui::EntityKind::X` assignments, plus the delegated `entityKindFor` form), and
RATCHETS the unreachable count at an EQUALITY — **28 → 0** — so a command added needing a kind no
surface produces turns red instead of shipping a menu item nobody can invoke, and a producer
removed turns red instead of silently greying out a family again. It also proves `entityKindFor` is
total over `IrValueKind` and injective, because two IR kinds sharing one `EntityKind` would undo
exactly the Wire-vs-Sketch and Surface-vs-Body distinctions the kernel forced into that enum.

What a source read cannot prove is that the click reaches dispatch. That is proved where it can be:
`frame_gate` mutation 12 clicks the seeded PROFILE row on the real linked `ForgeFrame`, asserts the
ref comes back as an `EntityKind::Sketch` whose node resolves to that statement, dispatches
`part.extrude` through the one registry and requires an `EXTRUDE` statement in the document — then
sets the filter to Edge and requires the same click to select NOTHING.

**One scanner defect, kept as a fact.** The first version of the source read compared the parsed
enumerator (`Face`) against `toString(EntityKind::Face)` (`face`) and matched nothing, so it
reported an EMPTY producible set. It did not pass vacuously: `parsed` is asserted precisely so a
scanner that stops matching is RED rather than silent. That is why the assertion is there.

**What this does NOT claim.** No window was opened and no row was clicked with a mouse: the tree's
`ImGui::Selectable` handler is asserted by the source read, and `clickFeature` — the function it
calls — is asserted end to end. The 28 is a count of commands whose SIGNATURE could not be
satisfied; it is not a claim that all 28 now produce correct geometry, which is the kernel's
question and not this one. And `forge-desktop` was NOT built locally (a 30B training run held this
box): the compiled half is CI's.
## D-051 (2026-09-02): D-045's "compiled" row is `status == "ok"`, not "built" — the true build rates are 86.6% and 57.6%, the effect it was cited for is THREE TIMES larger, and the quantity as recorded is not independent of the endpoint it sat beside

D-045 FINAL, corrected, records this table and draws its sharpest sentence from the
first row:

| | v10 | v6r8 |
|---|---|---|
| compiled | **83 = 34.9%** | 61 = 25.6% |

and then: *"targeted training made the model BUILD MORE (+9.3 points compiled) and
ASSERT MORE (+3.4 points VERIFY-bearing) while making its assertions MUCH LESS TRUE."*

**`83` and `61` are not build counts. They are the number of rows whose STATUS is
exactly `ok`.** Re-derived from the only two measured artefacts on disk, on the same
238 shared ids:

```
v10  status: verify_failed 123 | ok  83 | op_error 31 | unknown_op 1
v6r8 status: op_error       91 | verify_failed 76 | ok 61 | unknown_op 9 | verify_malformed 1

              status=="ok"        built==True
v10             83 (34.9%)        206 (86.6%)
v6r8            61 (25.6%)        137 (57.6%)
```

`83` and `61` reproduce the recorded numbers to the row. And `v6r8_part1_BASELINEPIN.json`
states the build count **in its own summary** — `"built": 137, "built_pct": 57.6` — so
the artefact was never ambiguous; only the label was.

### Why this is a defect and not a naming quibble

`ok` means *the tree built **and** every assertion it made passed*. A row that builds
perfectly and then fails its own VERIFY is `verify_failed`, **not** `ok`. So `ok` has
the self-inconsistency outcome baked into it.

D-045 cites "builds more" and "assertions much less true" as **two movements**, and the
force of the finding — *the model learned the FORM of a VERIFY without the CONTENT* —
comes from their being independent. **They are not independent as measured.** Every row
v10 gained on self-inconsistency was mechanically subtracted from its "compiled" count.
The build claim was being read off a quantity that the endpoint controls.

### The direction, stated because it cuts FOR the finding it corrects, not against it

Under the actual build predicate the gap does not shrink, it **widens by more than
three times**:

| | as recorded | corrected | direction |
|---|---|---|---|
| v10 build rate, 238 shared ids | 34.9% | **86.6%** | +51.7 pt |
| v6r8 build rate, 238 shared ids | 25.6% | **57.6%** | +32.0 pt |
| **the gap D-045 quotes** | **+9.3 pt** | **+29.0 pt** | **3.1x LARGER** |

So D-045's shape — *builds far more, asserts more, assertions much less true* — survives
the correction and is **strengthened** by it. This entry is not a retraction of D-045 and
nothing in its paired endpoint moves. It is filed because a number that flatters the
conclusion has to be corrected on exactly the same terms as one that does not.

### A confound on the MAGNITUDE that is NOT resolved here, and is owed

The two arms were scored by **different scorers**, and this is recorded in the files
themselves: v10's summary says `measure_failure_v2.py`, v6r8's summary names no scorer,
i.e. `measure_failure.py` v1. v1 has a measured defect — *a mid-batch abort condemns its
neighbours*, because it returns the lines printed before the crash and every row after
the crashing one is recorded no-output and scored as a failure. That defect can only
**depress** v6r8's count.

**Therefore +29.0 pt is an UPPER BOUND on the build gap, not a measurement of it.** What
is certain is the mislabel (`ok` is not `built`, on both arms, by the same rule) and the
two absolute rates as their own files report them. What is not established is how much of
the 29-point gap is the arm and how much is the scorer.

**Owed, and deliberately NOT run today:** re-measure v6r8 from
`runs/composite_anchor/expert3d_v6r8_e600/emissions.part1.jsonl` with
`measure_failure_v2.py` against the same pinned binary, and report the gap again. It was
not run now because free memory was **2.6 GB of 36 GB with 1.0 GB of swap in use** while
the v11 eval's generator holds 10.6 GB, and a second 4 GB verifier sweep beside it is how
this session produced two OOMs already. An OOM would cost the live run hours. **The
measurement is owed, the reason for deferring it is resource pressure, and neither is a
result.**

### A one-row discrepancy in the paired figures, left open rather than silently fixed

Re-deriving D-045's paired endpoint from the same two files reproduces every
whole-arm figure exactly — v6r8 **76/131 = 58.0%**, v10 whole-arm **411/448 = 91.7%**,
emission **58.4% vs 55.0%**, both-bearing **n = 97**, v10 **90/97 = 92.8%** — and differs
on the baseline's count inside that set by **one row**:

| | D-045 FINAL | re-derived |
|---|---|---|
| v6r8, both-bearing | 58/97 = 59.8% | **59/97 = 60.8%** |
| discordant | 35 worse / 3 better | **34 worse / 3 better** |
| exact McNemar, two-sided | p = 6.68e-08 | **p = 1.23e-07** |

Both readings are internally forced (90 − 34 = 56 = 59 − 3; 90 − 35 = 55 = 58 − 3), so
this is one row classified differently, not an arithmetic slip on either side. Two
candidate predicates were tried and **neither** reproduces 58: `status == "verify_failed"`
gives 59 and `assert_fail > 0` also gives 59. **The conclusion is untouched** — both
p-values are below 1e-6 and both gaps are ~32 points — so this is recorded as an open
one-row discrepancy and D-045 is **not** edited on the strength of it.

### A third outcome that neither ratio should absorb

`verify_malformed` — the model wrote a VERIFY the scorer could not parse — occurs once on
v6r8 and is the entire difference between the two predicates above. Such a row made **no
checkable claim**: it is neither a measured falsehood nor a pass. Counting it in the
numerator would change the instrument relative to every number already in the record.
`pair_arms.py` uses the recorded predicate and prints the malformed count **separately**,
never folded in.

### What now exists so these numbers are checkable instead of quoted

`archdisc-Models: tools/selfconsist/pair_arms.py`. It reads two files that
`measure_failure*.py` already wrote and does arithmetic only — it re-verifies nothing.
It **refuses to pair two arms measured with different binaries** unless the caller passes
`--allow-instrument-mismatch` and thereby says out loud that an instrument comparison is
intended. It prints (a) **three ways** — paired both-bearing, unconditional over each
arm's own bearers on shared ids, and whole-arm — because D-045 legitimately reports
**59.8%** and **58.0%** for the same arm and those are different denominators, not a
contradiction, and quoting one alone is how that becomes one.

    .venv/bin/python3 tools/selfconsist/pair_arms.py \
      --new  reports/abcreal/v10_recovered_BASELINEPIN.json      --new-name  v10 \
      --base reports/selfconsist/v6r8_part1_BASELINEPIN.json     --base-name v6r8

### Two facts about the v10 artefact, recorded because they change how it should be read

1. **It is a RE-measurement, not the original.** `n_rows_emitted 600`, `n_rows 593`,
   `n_instrument_failed 7`, ids `ho116 ho274 ho341 ho962 ho1180 ho1212 ho1229`. D-045's
   correction lists **nine** instrument failures — those seven **plus** `ho932` and
   `ho998`, the two 180-second timeouts. In this re-measurement **both answer normally**
   (`ho932` → `verify_failed`, 5 assertions false; `ho998` → `ok`, no VERIFY). That is
   the same conclusion D-045's own replay reached by a different route — the 180-second
   wait belonged to the state the child was in, not to the input — and it is now visible
   in a full scored artefact rather than a two-row fixture.
2. **`ho998` is not instrument-failed here at all**, so the claim that exactly one shared
   id is instrument-failed on v10 does not describe this file. The paired 97-id set
   contains no instrument-failed row on either arm under it either way.




## D-047 (2026-08-31): one feature tree, four ways to a solid, and nothing compared them — the differential gate, and the two defects it found on its first run

*(Numbering collision, resolved at merge — the FOURTH in this file, and it took TWO
attempts, which is the part worth recording. This entry was allocated **D-040** on
`app/differential-gate`; by the first rebase the execution branch had spent D-040 on
the SURFACE value kind and D-041 on the #146/#165 control, so it was renumbered
**D-046**. Before that rebase could merge, 2d30916a landed on the base and allocated
**D-046** to the sketch family. Renumbered again, to **D-047**, with its follow-on to
**D-048**.*

*The lesson is the one D-043 already wrote down, sharpened: surveying `origin` ONCE is
not enough either, because the base can allocate a number while your branch is being
rebased onto it. A number is only free at the instant you merge. Content unchanged.
Nothing in the tree cites any of these numbers — `grep -rn 'D-040\|D-041\|D-046' ui
forge-desktop forge-kernel` is empty — so every renumber has stayed confined to this
file.)*

**The gap.** A feature tree could reach the kernel by two routes and no gate tied them
together:

* **headless** — `forge_verify` consumes the IR text and reports the census every benchmark
  number in this programme comes from.
* **in-app** — the CoPilot proposes, `OpConstraintBridge` rules, `PartDocument::appendFeature`
  applies, the kernel builds, the viewport draws.

`ir_pipeline_gate.cpp` proved a UI-authored program compiles to *a* solid. It never compared
that solid against anything. So a tree that builds headless and fails in the app — or worse,
**builds differently** — was found by a user, not by CI. That is the same shape as the
vocabulary/header desync that has bitten this repo nine times: two artifacts from one source
with no gate between them.

**The gate, in two tiers, over ONE shared corpus** (`ui/test/differential_corpus.hpp` — eight
trees spanning PROFILE / WIRE / SOLID, every command family that emits IR, and both the
seeded-sketch and pure-primitive ways of starting a document):

* **tier 1, kernel-free** (`ui/test/differential_gate_test.cpp`, ubuntu `ui` job, ~1 s). The
  app-authored IR must be **byte-identical** to the planner's; the bridge must accept what the
  app itself emitted; `validateIr` must too; and the **arity differential** — every
  kernel-legal argument count the bridge refuses — is measured and ratcheted in both
  directions.
* **tier 2, the solids** (`forge-desktop/test/differential_solid_gate.cpp`, macOS `kernel`
  job, reusing `build-verify`). Four arms: `compileText`, `parse`+`compile`,
  `KernelScene::buildFromIr`, and **the `forge_verify` binary over its stdin protocol**. The
  first three are entry points inside one process; only the fourth tests two ARTIFACTS, which
  is what the defect class is actually about.

**The observable VECTOR, never volume alone.** `ok error failedOpId valid volume area
bbox·min[3]/max[3] faceCount edgeCount genus shellCount welded V/E/F Euler-chi centre-of-mass[3]
nDeclared nParsed nCompiled`. This programme has four measured cases of a wrong solid
reproducing a right volume, and in the worst of them no single observable caught it — centre of
mass was clean on the sphere and the bounding box was clean on the cylinder. `forge_verify` did
not report **area or centre of mass at all**, so the vector could not be compared against the
artifact; both are added here from one `GProp` evaluation, guarded and additive.

**Tolerance, stated rather than tuned.** The in-process arms compare at 1e-9 *relative* — same
code, same text, so anything above that is a divergence and not noise. Arm D compares at 5e-7
**absolute**, because `forge_verify`'s own `num()` is `precision(6) << fixed`: the transcript is
quantised to 1e-6, and a tighter tolerance would be comparing the formatter, not the geometry.

**TWO DEFECTS, MEASURED BY THE COPILOT ARM ON ITS FIRST RUN.** Tier 1's original arms drove
`CommandRegistry::dispatch` with the selection nodes spelled out — a menu click, not the path
the invariant names. The named path differs where it matters: a plan step cannot carry a `%ref`,
so `resolveSelection` **chooses** the operands at apply time.

1. **Every two-body boolean ran the wrong way round.** `boundValues` walks the document
   backwards, so `bound[0]` is the newest value, and the resolver handed them over in that
   order. `PartCommands.cpp` registers the booleans with *"selection ORDER is load-bearing for
   CUT: the first pick is the target, the second is the tool."* So a plan that said "subtract"
   produced `CUT(%tool, %target)` — the pin minus the block. Three of eight trees. CUT changed
   the **solid**; FUSE and COMMON are commutative in geometry but reversed **which document node
   survived**, and the surviving node is the one every later command selects. Fixed by handing
   the chosen values over oldest-first; `need == 1` is unaffected.
2. **`PlanSelect` could not name the WIRE kind, so LOFT was unreachable.** The IR value model
   has three kinds and the enum named two; the resolver read the target as
   `LatestProfile ? Profile : Solid`, with no third answer. The only op that consumes a WIRE was
   reachable from **no plan however written**, and the `LocalPlanner`'s own `loft` verb asked for
   the newest PROFILE and handed it to a command whose signature is Wire. A refusal by omission
   on a surface whose constraint is *represent, repair, tolerate — never refuse*. Added
   `PlanSelect::LatestWire` (appended, never inserted) and replaced the ternary with a switch: a
   ternary that answers SOLID for everything it cannot name is exactly how the missing third
   kind stayed invisible.

**WHAT REMAINS, PINNED RATHER THAN HIDDEN.** `resolveSelection` takes exactly
`signature.minCount` values, because a `PlanStep` names a value **kind** and never a **count**.
So an open-ended selection always gets the minimum: the three-ring `lofted_nozzle` comes out as
`LOFT(%2, %3, RULED)`, a two-section loft and a different solid. The gate ratchets the divergence
**set** — not a count — and prints the defect on every run.

**The arity differential is a standing, measured refusal.** 61 kernel-legal argument counts
across 23 of the 28 user-invocable ops are refused by the bridge, with a live positive control
rather than a table read: `FILLET(%1, 3)` is the two-argument form `FeatureTree.hpp` documents,
`validateIr` accepts it, and the bridge refuses it because no command emits that form. Under the
owner's constraint that is a defect to shrink, not a safety feature — so it is ratcheted in both
directions: red if it grows, and red if it shrinks without the pin moving.

**Mutation-proved, nine cases, every one required to exit non-zero.** The app drops a step,
swaps a boolean's operands, perturbs a number; the planner's text drops a statement, perturbs a
number, reorders two ops; the bridge is handed an op no command emits; and — the two the other
arms cannot reach — the CoPilot applies one step short, and the CoPilot picks nothing. Both
runners ask the **binary** for the mutation count rather than carrying a second copy of it, and
both exit 3 (never 0) when they cannot build or an input artifact is missing: a check that could
not run is not a check that passed.

**WHAT THE FIRST CI RUN OF TIER 2 FOUND — three things a laptop could not.** The solid tier had
never executed anywhere before CI run 33453484236, and it went red on all three.

1. **A corpus tree that did not build, in BOTH arms, identically.**
   `revolved_shell` reported `SHELL: no face faces the open axis` from A *and* B. Revolving a
   rectangle a full 360° about Y gives a torus of rectangular section — no planar face at all, so
   SHELL's default open axis `(0,0,-1)` can never find one. The two arms agreed perfectly, **on a
   failure**, and a tree that does not build measures agreement on nothing. SHELL now gets a body
   that has a −Z face; REVOLVE keeps its own and is still compiled, so a REVOLVE regression fails
   the tree through `ok` and the s0.4 census.

2. **A mutation that was never caught and reported itself as caught.** Case 7 renames an op inside
   the `OpConstraintBridge` *proposal*; tier 2 rules on no proposal. It came back "caught" with
   `325 checks, 1 failures` — the **same** count as the red clean run. It was riding the corpus
   failure, and would have flipped to green the moment the gate became healthy. A mutation swept by
   a tier that cannot see it is worse than one not swept at all. The tier now declares what it can
   observe (`--applicable-mutations`) and the runner sweeps exactly that, written as a whitelist of
   **exclusions** so a later mutation is swept by default and has to be argued out.

3. **A centre of mass of 2×10³³ mm, which adding the centre of mass exposed.** `boss_on_plate` — a
   50×50×8 plate FUSEd with an r=12 h=20 boss — reported
   `com=(2.02759422756e+33, -2.02759422756e+33, 23.4083321608)`, x and y exact negatives of each
   other, on a body 50 mm across.

   **It is a mass-property defect and not a geometry defect, and that is measured, not inferred.**
   Driven through the pinned native verifier the solid is faultless:
   `ok=true valid=true genus=0 shellCount=1 faceCount=9 edgeCount=16`,
   `bbox min=[-25,-25,0] max=[25,25,20]`, `volume=25428.671731` against a closed form of
   50·50·8 + π·144·20 − π·144·8 = 25428.672105 — agreeing to **1.5×10⁻⁸ relative**, which is the
   sketcher's circle approximation and not a modelling error. By symmetry the centre of mass is x=0, y=0,
   z=(20000·4 + 5428.67·14)/25428.67 = 6.135. All three reported components are wrong and **all
   three lie outside the bounding box**.

   **Both arms reported it identically**, so the differential called it agreement and went green on
   that tree. A differential compares arms; it does not, on its own, notice that they agree on
   nonsense — two measurements of the same broken thing agree perfectly. So each arm is now checked
   against invariants true of *any* solid: positive volume and area, `bbox min ≤ max`, and a
   **centre of mass inside that bbox**. That is not a heuristic; a centre of mass is an average of
   points in the box. The slack is one part in a thousand of the box's own span, so a
   tessellation-tight bbox cannot produce a false red.

   **Reported, not fixed.** It is `forge::massProperties` on a fused OCCT solid, it is not
   reproducible without a kernel build, and guessing at GProp would be worse than saying so. The
   set is ratcheted at exactly `{boss_on_plate}` and printed in full on every run: red if it grows,
   red if it shrinks without the pin moving.

**And the reader that arm D depends on is gated where it costs nothing.** A transcript reader that
silently fails to find a field makes the comparison measure the arm's *default* — a green produced
by an absence, which is the shape of every gate in this programme that turned out to be measuring
nothing. It needs no kernel, so it lives in `ui/test/verify_transcript.hpp` and tier 1 checks it on
every PR against a line captured **verbatim** from the verifier rather than written from the
protocol comment — which lists neither `bodies` nor `vertexCount`, and does not show that `bores`
carries its own `cx`, `at` and `axis`, the last two being exactly the shape a careless triple search
collides with. The negative half is the half that matters: the captured line predates `area` and
`com`, so the reader must report them **absent**, never 0.0, which is where a great many parts
genuinely have a centre of mass.

## D-048 (2026-09-01): the app's buttons were the refusal boundary, a plan's third loft section was dropped in silence, and one `<cstdio>` call took seven forge-desktop gates dark

*(Renumbered from **D-041**, then **D-047**, alongside D-047 above and for the same reason.)*

Follow-on to D-047, which built the two-path differential. Four defects, one correction
to D-047's own reading of its results, and one finding that is larger than any of them.

**1. A gate that could not build could not fail — and it took six others with it.** The
`forge-desktop` CI job died in its missing-include preflight, before the compiler ran:
`MISSING <algorithm>: forge-desktop/test/differential_solid_gate.cpp`. The two lines that
tripped it are `std::remove(inPath.c_str())` — `<cstdio>`'s ONE-argument file-removal
`std::remove`, correctly included. `<algorithm>`'s is the THREE-argument range form. The
preflight matched the field, not the meaning.

That job never compiles `differential_solid_gate.cpp`; it only SCANS it, because the
preflight globs `forge-desktop/test/*.cpp`. What it does build is forge-desktop, and it
runs SEVEN gates — ir_pipeline, document, frame, copilot, update, click, isolation — and
39 mutation proofs. All of it was dark, over a file the job does not compile.

`<algorithm>`'s form always carries a comma in its argument list and the stdio form never
does, so `remove` becomes `remove\([^;]*,`. And because this checker is a regex over text
that is only ever OBSERVED saying OK — where a false positive is indistinguishable from a
real finding and a false negative from a clean tree — it now has to prove it can fail:
`check_includes.sh --self-test` runs 11 controls, and `run_native.sh` runs them BEFORE the
scan. **Measured: the forge-desktop job went FAILURE -> SUCCESS.**

**2. The bridge refused 61 argument forms the kernel builds.** `OpConstraintBridge`
narrowed each op's arity to the discrete counts its emitting commands happen to produce:
**61 kernel-legal argument counts across 23 of the user-invocable ops**. The old refusal
said so itself — *"the kernel would accept 2-3, which is wider than the app"*.
`FILLET(%body, r)` and `CHAMFER(%body, d)` are the forms `FeatureTree.hpp` DOCUMENTS.

The owner's constraint is REPRESENT / REPAIR / TOLERATE, never refuse. A planner is not a
transcript of the app's buttons, and refusing a form the kernel builds removes capability
to prevent nothing. **The kernel's range is now the refusal boundary**; what was refused
for the app's sake is accepted and RECORDED on `OpRuling::tolerated`, so the capability
gap stays visible without being a refusal. All 61 are swept through the LIVE bridge every
run — `0 refused for arity, 61 accepted AND recorded` — because one positive control is
one row of a table of 61, and it was the row someone happened to pick.

**The 61 UNDERCOUNTS**, and the pin cannot express by how much: the sweep skips ops whose
kernel arity is unbounded, and `LOFT` and `VERIFY` both are. VERIFY's emitted forms stop
at 3 arguments against a `2..n` kernel range, so every VERIFY with four or more arguments
is kernel-legal, unauthorable, and part of an INFINITE set. All of them were refused.

**3. A plan that named three sections built a two-section loft.** `resolveSelection` took
exactly `signature.minCount` values, because a `PlanStep` named a value KIND and never a
COUNT. `part.loft` is `2..n`, so the three-ring nozzle was applied as `LOFT(%2, %3,
RULED)` — a different solid, from a plan naming three rings, with no error on any path. A
quietly different solid is worse than a refusal, because a refusal is visible.
`PlanStep::selectCount` carries the count; 0 still means the signature's minimum, so a
step that states nothing is unchanged, and a stated count is CLAMPED rather than refused.

**4. D-040 read its own tier-2 failure wrong, and so did I once.** D-040 reported the 2e33
centre of mass as tier 2's open defect. Its incoherent-set ratchet pins `{boss_on_plate}`
and the measured set IS that, so the ratchet PASSES and adds no failure. Tier 2's single
failure was a different tree entirely:

    [revolve_and_shell] both arms report NOT BUILT: "s0.4 graph-quality gate:
      unexplained_orphans=2 [%1, %2] — these ops contribute nothing to the result."

`%4 = SHELL(%3, 2)` was the result and `%3` a fresh BOX, so the REVOLVE above it fed
nothing: the tree was TWO INDEPENDENT PROGRAMS sharing a name. D-040 had hit this tree
failing on `SHELL: no face faces the open axis` and repaired it by moving SHELL onto a
box — and that repair is what orphaned the revolve. Split into `revolved_ring` and
`shelled_box`, which adds no operation the corpus did not already require. (My own first
commit on this branch claimed tier 2 "has never once run in CI"; it runs in the macOS
`kernel` job and always has. Corrected in a follow-up commit, not rewritten.)

**5. THE ONE THAT MATTERS, reported and NOT fixed: every extruded wall is face-kind
`"other"`, and the interface metric matches only `"cylinder"` and `"plane"`.**

Traced entirely through committed source:

* `Features.cpp::extrudeProfile` calls `occtPrism(f, dir)` with **no third argument**.
* `occtPrism`'s `canonize` parameter **defaults to `false`** (`OcctPrimBuilder.hpp:89`).
* So `canonicalExtrusion` — which exists precisely to return a `Geom_Plane` for a swept
  line and a `Geom_CylindricalSurface` for a swept circle — never runs, and every lateral
  face is a `Geom_SurfaceOfLinearExtrusion`, `P(u,v) = C(u) + v·dir`, unbounded in v.
* `faceInventory` (`DirectEdit.cpp:264`) switches on `BRepAdaptor_Surface::GetType()`. It
  names Plane, Cylinder, Cone, Sphere, Torus, BSpline, Bezier and SurfaceOfRevolution —
  and NOT SurfaceOfExtrusion, which falls to `default: fi.kind = "other"`.

The `occtPrism` header states the consequence in its own words: *"Since the TKPrim drop
every prism in the kernel has carried extrusion-typed laterals where OCCT emitted Planes,
and faceInventory reports those as kind 'other'."*

And `family_census/BENCHMARK_OP_REQUIREMENTS.md:455`, under **"verified by reading an
implementation this session"**, records what consumes that field: *"`interface_metrics.py`
reads exactly `kind == "cylinder"` (l.465) and `kind == "plane"` (l.587, l.704) **and no
other kind**"*, with `W_SHAPE, W_INTERFACE, W_TOPOLOGY = 0.4, 0.4, 0.2` two lines below.

A face of kind `"other"` matches neither predicate, so it cannot contribute to the
interface term — **40% of the composite**. `DirectEdit.cpp:102` names the two
representations side by side: *"one an analytic `Geom_CylindricalSurface` (what HOLE
builds) and one a `Geom_SurfaceOfLinearExtrusion` of a circle (what CIRCLE+EXTRUDE+CUT
leaves behind)"*. The same bore, two representations, and only one is a `"cylinder"` to
the scorer.

**NOT MEASURED, and stated as such:** `interface_metrics.py` was not run (it is in the
Models repo), and the share of the emitted corpus that reaches a bore by CIRCLE+EXTRUDE+CUT
rather than by HOLE is unknown. The SIZE of the effect is unmeasured; the MECHANISM is four
committed files. The default is deliberately not flipped here — the header says flipping it
changes the face-type census of every extrude, push/pull, rib, parting slab and base flange
in the product at once, and that needs the full Models-OS gate as its own measurement.

**Also recorded: `prism_meets_tube` does not test TUBE.** It measures
`V = 2094.39510239`; the upper hemisphere of `SPHERE(10)` is `(2/3)·π·10³ =
2094.3951023932`, agreeing to 3.2e-9. The hexagon's inradius is `15·cos30° = 12.99 > 10`,
so `COMMON` returns the plain hemisphere and the TUBE contributes nothing. A mutation
perturbing any tube parameter is invisible on that tree. It passes the s0.4 graph gate —
every op feeds the result IN THE GRAPH — while contributing nothing IN THE GEOMETRY.
Graph reachability is not geometric dependence, and the corpus is checked only for the
first. Reported, not fixed: changing corpus geometry without being able to run tier 2 is
how `revolve_and_shell` acquired its second failure.

**Ledger note.** There are TWO entries numbered D-038 (#140's ten primitives and #146's
SURFACE value kind). Both are merged and this file is append-only, so neither is
renumbered; the collision is recorded here rather than silently corrected.

## D-052 (2026-09-02): real human construction sequences moved EMISSION and BUILD and moved TRUTH BY NOTHING — the second pre-registered prediction fails, and the improvement that appeared under the pinned binary is the INSTRUMENT ARTEFACT the pre-registration named in advance

`archie-30b-abcreal-v11` was trained on the v10 self-consistent corpus **plus real
ABC/Onshape FeatureScript trees**, each carrying a VERIFY measured off the kernel's own
census and re-verified before the row could enter. The hypothesis, registered in
`PREREG_abcreal_v11.md` before the corpus was assembled: v10's assertions were true by
construction but attached to **synthetic** trees, so attaching true assertions to **real**
construction sequences is the change most likely to reconnect form to content.

**It did not. Under the only binary that can read both arms, self-consistency did not move
at all.**

### The result, all three arms through ONE instrument

`build-sarc` is the authority on capability (PREREG §6/§9); the pinned binary is reported
for continuity only. Every figure below is `measure_failure_v2` — `instrument_failed`
excluded from both halves — through
`forge-kernel/build-sarc/forge_verify`, sha256 `87250291a8170c3c…`.

| arm | (a) self-inconsistency | (b) VERIFY-emission | built | rows scored `ok` |
|---|---|---|---|---|
| `v6r8` baseline | **64/131 = 48.9%** | 131/238 = 55.0% | 82/238 = 34.5% | 18 |
| `v10` synthetic assertions | **402/448 = 89.7%** | 448/593 = 75.5% | 402/593 = 67.8% | **0** |
| `v11` real ABC trees | **495/552 = 89.7%** | **552/600 = 92.0%** | **495/600 = 82.5%** | **0** |

**(a) is identical between v10 and v11 to the decimal place.** Paired, which is the test
the pre-registration named:

| paired, both-bearing | v11 | comparator | discordant | exact McNemar |
|---|---|---|---|---|
| **vs `v10`**, n = 419 | 370/419 = **88.3%** | 375/419 = **89.5%** | 35 worse / 40 better | **p = 0.644** |
| **vs `v6r8`**, n = 117 | 111/117 = **94.9%** | 58/117 = **49.6%** | **55 worse / 2 better** | **p = 2.30e-14** |

Emission moved, hard and significantly: v11 started asserting on **126** ids v10 did not
and stopped on 29 (p = 1.29e-15); against v6r8, started on **96** and stopped on 14
(p = 3.30e-16).

★**Read the two rows of that table together. The corpus moved the thing that is easy to
supervise — how often the model asserts, and whether the tree builds — by 16.5 and 14.7
points, significantly. It moved whether the assertions are TRUE by 1.2 points, p = 0.64,
which is nothing.**

### The pre-registered predictions

* **P1 — REFUTED.** P1 predicted (a) falls below v10's level, landing between the baseline
  and v10 — "the regression is partly undone but the baseline is not beaten." Under the
  authority instrument (a) **did not fall**: 88.3% vs 89.5%, p = 0.644. The regression is
  not partly undone; it is entirely intact.
* **P2 — CONFIRMED, and it matters.** (b) ≥ 45% was the denominator-collapse guard. (b) is
  **92.0%**, the highest of any arm ever measured, and the paired emission change is
  significantly **upward**. ★**This is emphatically NOT denominator collapse.** The arm did
  not buy its number by falling silent; it asserted more than anything before it and the
  assertions were no truer. That is a cleaner negative result than a collapse would have
  been, and it is why the guard was written.
* **P4 — CONFIRMED.** CBORE appears in **1 row of 600**. It is the first non-zero CBORE ever
  recorded, and it is one row; P4 predicted ~0 because ABC trees contain no CBORE and cannot
  teach one. One row is not a capability.

### The INSTRUMENT ARTEFACT, named in the words the pre-registration chose

PREREG §6 says: *"An improvement in (a) that appears under the pinned binary but NOT under
`build-sarc` is an INSTRUMENT ARTEFACT, and I will say so in those words."* That is exactly
what happened, so: **the improvement is an instrument artefact.**

| v11, n=600 | `baseline_pin` | `build-sarc` |
|---|---|---|
| (a) | **72.3%** (399/552) | **89.7%** (495/552) |
| (b) | 92.0% (552/600) | 92.0% (552/600) |
| built | 69.0% | 82.5% |
| `ok` | 15 | 0 |

The 17.4-point gap is fully accounted for by the status transitions, row by row:

```
unknown_op    -> verify_failed   97      <- the artefact, exactly
unknown_op    -> parse_error     32
unknown_op    -> op_error        29
ok            -> parse_error     15      <- every one of the pin's "successes"
verify_failed -> verify_failed  397
op_error      -> op_error        23
unknown_op    -> unknown_op       4
verify_failed -> op_error         2
op_error      -> verify_failed    1
```

**Mechanism.** The ABC corpus taught the model the SKETCH family, and the pinned binary
cannot parse it. `SKETCH_FAMILY_ROWS = 158/600 = 26.3%` (SKETCH 158, SPT 158, SLINE 152,
SOLVE 145, SCIRC 98, SARC 26), and the cross-tab is total: **every one of those 158 rows is
`unknown_op` under the pin, and not one `verify_failed` or `ok` row carries a SKETCH op.**
A VERIFY-bearing row scored `unknown_op` sits in the self-inconsistency DENOMINATOR and can
never reach its NUMERATOR, because a false assertion has to be *measured* to be counted. So
the pin's 72.3% is `399 measured-false / (399 measured-false + 153 never-measured)`, and
★**every assertion the pin could actually measure was false: 399/399 = 100%.**

★**The op surface the model learned and the op surface the instrument reads are different
sets.** That is a finding about the programme's measurement chain, not about this arm.

### (b) is instrument-independent, and that is now MEASURED rather than asserted

`selfconsist_endpoint.py` claims (b) is safe under instrument change because
`rows_emitting_VERIFY` is read from the model's TEXT by regex, not from the kernel. Checked
across the two binaries on all 600 rows: **VERIFY-bearing agrees on 600/600**, and (b) reads
92.0% under both. The claim holds.

### A THIRD-ORDER correction to D-045, which D-051 half-found

D-051 established that D-045's "compiled" row counts `status == "ok"`, not builds. This run
establishes what those `ok` rows *were*. Of the **123** rows the pin scored `ok` for v10,
under `build-sarc` **122 are `parse_error` and 1 is `verify_failed` — zero remain `ok`**.
Every `parse_error` on both arms is the same shape:

```
PAUSED_INCOMPLETE: ft parse line N: PAUSED_INCOMPLETE — the emission stopped mid-statement
```

★**The pinned binary silently scores a TRUNCATED emission as a clean success.** It builds
whatever prefix parsed; the VERIFY that would have come at the end was cut off, so the row
asserts nothing and lands in `ok`. So D-045's "compiled 83 = 34.9%" was not merely
mislabelled (D-051) — the quantity it names is **almost entirely truncated output**. v10's
real build rate under a parser that refuses a truncated tree is **402/593 = 67.8%**.

**Truncation itself moved, and in v11's favour:** `PAUSED_INCOMPLETE` is **145/593 = 24.5%**
on v10 against **47/600 = 7.8%** on v11 — while v11 emits *longer* trees (median 28 lines
vs 16, p90 125 vs 94). This is consistent with PREREG §10, which filtered the v11 corpus to
rows whose entire sequence fits the 3072-token window so that every surviving row masks
correctly and carries its assertion. Consistent with, not proof of.

### What the three arms say together

| | v6r8 | v10 | v11 |
|---|---|---|---|
| built | 34.5% | 67.8% | **82.5%** |
| asserts | 55.0% | 75.5% | **92.0%** |
| **assertions true** | **51.1%** | 10.3% | 10.3% |

★Build rate has more than doubled and emission has nearly doubled across three arms of
increasingly careful supervision, and the fraction of assertions that are true fell by a
factor of five and then stayed exactly flat. **This is D-041's pattern at a third data
point and under a better instrument: the thing that moves is never the thing being
supervised.** Two corpora built specifically to teach self-consistency — 10,190 synthesised
assertions true by construction, then real human construction sequences with measured
assertions — moved it by nothing and by nothing.

### Caveats, including the ones that cut against this reading

1. **The baseline is better than the record says, which makes the gap WIDER, not narrower.**
   `v6r8` measures **48.9%** under `build-sarc` against **58.0%** under the pin. The
   stricter kernel finds the baseline *more* self-consistent. Nothing in D-045 is retracted
   by this — both its arms were scored by one binary — but the honest baseline for a
   `build-sarc`-scored arm is 48.9%.
2. **The both-bearing conditioning is asymmetric.** v11 asserts on 92% of rows and v6r8 on
   55%, so the 117-id set is selected by v6r8's emission. The unconditional reading agrees
   in direction and magnitude (93.0% vs 48.9%), so the conclusion does not rest on the
   conditioning.
3. **`unrecorded_deaths` is non-zero and is reported as a finding, not smoothed.** The
   BUILDSARC runs report `crash_reports 1, unrecorded_deaths 1` (v11) and `2, 2` (v10)
   attributed by parent pid. Row accounting is nonetheless complete (495+47+54+4 = 600), so
   those deaths were absorbed by a retry rather than lost. Twelve `forge_verify` crash
   reports were written on this machine today; the aborts are input-dependent, and
   `measure_failure_v2` re-runs a missing row alone before any verdict.
4. **The mid-run prefix readings are NOT comparable to this result and must not be quoted
   beside it.** A prefix reading of 97.9% at n=358 was carried through several ticks; the
   final measured value is 72.3% under the same binary. Those prefix figures were not
   produced by `measure_failure_v2` on the final emissions, so the ~25-point gap is a method
   difference of unknown size, **not** a measurement of the hardest-first ordering effect.
   THE PREFIX WAS NOT THE RESULT.
5. **`verify_malformed`** — a VERIFY the scorer cannot parse — occurs once on v6r8 and once
   on v10 and never on v11. It is in neither numerator: such a row made no checkable claim.

### What follows

The untried lever is no longer "real sequences" — that is now tried and measured. What this
run newly exposes is that **the corpus taught 26.3% of emissions in an op family the scoring
kernel cannot read**, so the programme has been optimising a model and measuring it with
instruments that disagree about what the model is even allowed to say. Before another corpus
is built, the eval must score with a binary that can parse the ops the training data
contains, and the arms already in the record should be re-read under it — which is what this
entry does for v6r8 and v10.

### Reproduction

Every number above comes from files on disk and one script that does arithmetic only:

    scripts/crossinstrument_v11.sh          # put every arm through ONE instrument, sequentially
    tools/selfconsist/pair_arms.py          # refuses to pair arms measured with different binaries
    reports/abcreal/{abcreal_v11_BASELINEPIN,abcreal_v11_BUILDSARC,v10_BUILDSARC,
                     v10_recovered_BASELINEPIN,v6r8_BUILDSARC}.json


### D-052 addendum — D-051's owed measurement is discharged, and it CONFIRMS the claim it was raised against

D-051 reported v10's build rate as **206/238 = 86.6%** against v6r8's **137/238 = 57.6%**, a
**+29.0 pt** gap, and then bounded its own result: the two arms had been scored by different
scorers (v10 by `measure_failure_v2`, v6r8 by v1, per the files' own `scorer` field), and v1
has a measured defect — *a mid-batch abort condemns its neighbours*, because it returns the
lines printed before a crash and records every row after the crashing one as no-output. That
defect can only **depress** v6r8, so D-051 called +29.0 an **upper bound** and owed a
re-measurement.

**Re-measured: v6r8's emissions, the SAME pinned binary, the v2 scorer.** The two scorers
agree exactly — not approximately:

| | v1 (as recorded) | v2 (re-measured) |
|---|---|---|
| built | 137/238 = **57.6%** | 137/238 = **57.6%** |
| rows emitting VERIFY | 131 = **55.0%** | 131 = **55.0%** |
| self-inconsistency | **58.0%** | **58.0%** |
| `instrument_failed` | n/a | **0** |
| status histogram | `verify_failed 76 / op_error 91 / ok 61 / verify_malformed 1 / unknown_op 9` | **identical, bucket for bucket** |

**The confound is zero. The gap is exactly +29.0 pt, not an upper bound.** v1's defect never
fired here because **v6r8's run contains no verifier deaths at all** — with nothing to
condemn its neighbours, the two scorers are the same function on this input.

★Recorded because the direction matters: this was a caveat raised **against** a claim I had
made, and discharging it **strengthened** the claim. A caveat is only worth writing if it is
allowed to come back either way, and this one came back the way that suited me. It is
reported with the same energy the opposite result would have been. **Nothing in D-051 needs
amending except the word "upper bound", which can now be struck.**

**One thing this does NOT establish:** the v1/v2 agreement holds on a run with zero
instrument deaths, which is exactly the case where the two are provably equivalent. It says
nothing about v1's behaviour on a run that DOES crash — and the v10 arm, which had 7
instrument failures, was never scored with v1. So the correct reading is not "v1 and v2 agree"
but "**v1 and v2 agree when nothing dies**", which is the only claim the data supports and
the only one D-051 needed.


## D-053 — MM-CAD's 33,816 rows carry the answer inside the question, and the blocker was never the download

**Question.** The owner asked, with visible frustration, why Archie is not "under heavy training"
on the ~34,000 rows of `exanos/MMCAD`. Two prior sessions answered "it was never downloaded".
That answer was wrong twice, for the same reason both times: the check looked at `data/mmcad*`
when the corpus lives at **`data/external/mmcad`**. A path miss printed as a fact.

### What is actually on disk, and what I added

`data/external/mmcad/scan/mmcad_a_*.jsonl` holds **exactly 33,816 rows** — train 27,048,
val 3,376, test 3,392. The corpus shipped **without its images**: every row referenced
`renders/iso1/<uid>.png` and `find data/external -name '*.png'` returned **0**. The renders ship
as separate archives that had never been fetched. I pulled `archives/renders/renders_iso1.zip`
(33,816 entries, 512x512, 1.1 GB), extracted it, verified **33,816/33,816 rows resolve with 0
missing** over the full set rather than a sample, then deleted the now-redundant zip after
proving the extraction complete — re-checking resolvability *after* the delete (27,048/27,048).

The repo's own permanent gate passes it: `scripts/contamination_guard.py --scan` reports
**0 contaminated rows across all three splits**, and still 0 under `--strict-family`.

### The two measurements that decide it

Over **all 33,816 rows, no sampling**:

| measurement | result |
|---|---|
| assistant string appears VERBATIM inside the user message | **33,816 / 33,816 = 100.00%** |
| rows carrying a construction op token AND a numeric parameter | **0 / 33,816 = 0.00%** |
| assistant length | p50 **201** chars, p90 372, max 1055 |

**The answer is in the question in every single row.** Training a 30B VLM on this teaches it to
echo the tail of its own prompt and to emit prose where an IR belongs — and the loss curve would
have looked excellent throughout.

★**This is not a preprocessing slip; the source has nothing better.** `metadata.csv` has 28
columns — uid, benchmark, source_id, category, supervision, split, title/description (+`_gemini`,
+`_human`) and asset paths. **There is no op, parameter, sequence or feature column anywhere.**
MM-CAD:A is a mesh + render + caption corpus. Archie's task is to emit a construction tree; this
dataset holds no trees to teach. A parallel measurement over MM-CAD:B's 192,626 captions agrees:
47.6% name a CAD op verb, but only **0.375%** carry a verb AND a dimension, and 93.6% contain no
digit at all.

★**A SCHEMA MATCH IS NOT A CONTENT MATCH, and I asserted the opposite mid-session before
correcting it.** The rows carry the right KEYS (`image` + a 3-role `messages`), which reads as
"already canonical". Their system prompt is **115 characters**; ours is **3,477**. And
`validate_corpus.check_row` forbids extra top-level keys, while these rows carry `id`/`source`/
`stem` — so the trainer's own gate rejects them as they stand.

### The real blocker is ours, not the dataset's

`scripts/canonicalize_dataset.py` returns `in=3 accepted=0 rejected=3`, and
`grep -n "accepted.append"` returns **nothing** — the variable is declared and read, never
written. Every measured row dies at `rejected@emit`: *"measured OK but IR recovery is not wired
for this source; refusing to emit a row whose assistant side would be invented."*
`representation.extract` builds the USER side (face census) only. **There is no STEP -> IR
recovery wired. That, not the download, is why the model is not training on MM-CAD.**
The door refusing was correct, and it must stay correct: "no data" and "not implemented" must
not look alike downstream.

### Decision

1. **Do not train on `scan/*.jsonl` in any form.** Rebuild from `metadata.csv`, which holds the
   caption columns SEPARATELY (`description_human` 22,634 = 66.9%, `description_gemini` 33,816,
   `title`), so the caption can be the answer without also being the question. Gate every emitted
   row with a leak check — assistant not a substring of user, and no 8-word shingle shared — run
   over 100% of rows and mutation-proved to fail on a poisoned row.
2. **Treat MM-CAD as vision grounding and as GEOMETRY, not as construction supervision.**
3. **Wire STEP -> IR recovery** for the narrow cases where it can be proven, accepting a row only
   when recompiling the recovered IR reproduces the source within tolerance on a VECTOR of
   observables (volume AND bbox AND face-kind census AND centre of mass) — volume alone cannot
   validate geometry.

### Scope, licence and cost

The repo is **200.83 GB across 5,809 files** (`mmcad_b/` 140.56 GB, `photoreal/` 39.17 GB,
`archives/` 20.91 GB); it does not fit in the free space and was never bulk-pulled. **We hold
5.2 GB** — MM-CAD:A metadata + splits + renders (1.2 GB) and three **stride-sampled** STEP shards
(4.0 GB); stride, never a contiguous block, because a contiguous block is one region of a sorted
corpus. Geometry from shard 00000 (200 files by stride, parser first proved on a known-good box):
**198/200 parse = 99.0%**, BRepCheck-valid 194/198, analytic-only 66.7%, and 31.3% "tractable"
(1 solid, <=30 faces, analytic-only) — projecting **~59,700 candidate parts** of 192,625. That is
a ceiling on candidate GEOMETRY, not on trainable rows, and "tractable" is a **chosen threshold,
not a measured boundary of our decomposer**.

**Licence: CC BY-NC 4.0, NonCommercial** (`LICENSES.md` + README front-matter; the Hub's `"other"`
tag is only the aggregate label). MM-CAD:A aggregates 11 benchmarks and the geometry keeps each
upstream licence — **ShapeNetV2 is gated and forbids mesh redistribution**, Thingi10K is per-model.
**The owner has directed that the work proceed on a non-commercial research basis** and that
decision is recorded here so a future commercial decision is not made blind — it would need
counsel and, for several constituents, would not be available at all.

### Cutting against this entry

The geometry is genuinely good and 31.3% is a real, sizeable pool: MM-CAD is worth having, and the
thing to build is **the decomposer, not another download**. Nothing here argues the corpus is
worthless — only that it cannot teach a feature tree in the form it ships.

### A defect found in passing, unrelated to MM-CAD

**2 of the 103 rows in `data/forge/selfconsist_v10_split/valid.jsonl` have a byte-identical user
census to a train row carrying a DIFFERENT correct answer** — `%10 = BOX(12, 70, 12, 0, 0, 0)` in
valid against `BOX(20, 70, 12, 0, 0, 0)` in train, and the mirror case. Those rows are unanswerable
as posed and the model is trained toward the wrong one, **capping holdout accuracy at 98.1%**.
Pre-existing; recorded so no future run reads that ceiling as a model failure.

### Reproduction

    python3 scripts/contamination_guard.py --scan data/external/mmcad/scan/mmcad_a_{train,val,test}.jsonl
    python3 scripts/canonicalize_dataset.py --source mmcad_b --raw data/external/mmcad_b_raw --limit 3 ...
    grep -n "accepted.append" scripts/canonicalize_dataset.py    # returns nothing


## D-054 — OCCT is not always a working incumbent: its own offset engine segfaults on corpus parts

**Context.** Six agents were dropping six TKOffset families natively, in parallel, under the wave-1
work that gates all thirteen waves of the OCCT chain. Their A/B harnesses produced a burst of
`corpus_ab_coverage` crash reports.

**The reports are two different things, and a count of them is not a count of defects:**

* **20 x SIGSEGV entirely inside OCCT**, one identical stack:
  `BRepOffsetAPI_MakeOffsetShape::PerformByJoin` -> `BRepOffset_MakeOffset::MakeOffsetShape` ->
  `BuildOffsetByInter` -> `IntersectEdges` -> `BRepOffset_Inter2d::ConnexIntByInt` ->
  `BRepAdaptor_Curve::Initialize` -> `BRep_Tool::CurveOnSurface`, terminating
  **`EXC_BAD_ACCESS`, `KERN_INVALID_ADDRESS at 0x0000000000000060`** — a null dereference plus a
  field offset. **No `forge::` frame appears above `runArm`.** This is OCCT's own code failing.
* **5 x SIGSEGV in the harness's own `selftest`** — its positive control, crashing deliberately to
  prove per-part subprocess isolation works. All six agents kept running throughout.

Separating the two required reading the **faulting frames**, not the filename.

**Why this changes the plan.** `BRepOffsetAPI_MakeOffsetShape` is family **H (OFFSETSHAPE)** and the
engine beneath it, `BRepOffset_MakeOffset`, is family **I (THICKEN)** — so **two of the nine
TKOffset families are being measured against an incumbent that segfaults.** A native replacement
there does not have to match a working baseline; it has to beat a crashing one. That is a
materially easier bar than DRAFT faces (native 372/565 = 65.8% against OCCT 497/565 = 88.0%), and
it should change which families are attempted first.

This is the same shape as THICKSOLID, where **all 133 of OCCT's "successes" are `BRepCheck`-INVALID**
— a pass that is not a pass. Both point one way: **the reason a family has not been dropped is not
always that OCCT is good at it.** Measure the incumbent; never assume it.

**What this does NOT establish.** The crash was observed under concurrent load from fourteen agents,
and the specific parts that trigger it were not isolated here — so no per-part rate is claimed, and
none should be quoted until one is measured. It is also not established that a native path would
succeed on those same parts; only that the incumbent fails on them.

**Ledger, unchanged and stated plainly:** `forge-kernel/scripts/occt_closure_count.sh` reports
**OCCT_CLOSURE = 14, ZERO of 14 toolkits dropped.** No family work has moved that number, because
`CMakeLists.txt:1170` removes TKOffset only when **all nine** families compile out and seven still
fail their flip gate. **"11" must never be quoted as progress** — it is reachable only with
`FORGE_DRAFT_DROP_NATIVE=ON`, which deletes 497 draft parts.

---

## 2026-09-03 — three PRs unblocked, and two of them shared one cause

**The click gate hand-lists desktop translation units while globbing `ui/src/*.cpp`.** That asymmetry
failed **two** open PRs on the same day. #217 added `FileDialog.cpp` and called it from
`ForgeFrame.cpp`; #218 added `ImGuiErrorPolicy.cpp` and called it from `ForgeFrame::build`. Each
surfaced as an undefined-symbol dump that **names the symbol but not the cause** — the reader is told
`forge::desktop::fileDialogPolicyFor(...)` is missing, not that a list needs a line.

**The list cannot simply become a glob**, which is why it was hand-written in the first place:
`main.cpp` and `kernel_worker_main.cpp` each define `main()` and would collide with the gate's own,
`PlatformSDL2.cpp` needs SDL2, and `ViewportRenderer.cpp` needs a GL context a headless ASAN frame
does not have. So the include list is now paired with an explicit **`DESKTOP_SKIP`** list carrying
*the reason each file cannot link here*, and a guard requires every `forge-desktop/src/*.cpp` to
appear in **exactly one** of the two. Proved in both directions: 5 linked + 6 skipped covers all 11
sources, and an unclassified probe file makes the guard name it and exit 3.

**A gate that matches member NAMES can be right about the name and wrong about the field.** The prose
gate flagged `TextColored` and `BulletText` being handed `.detail`. `detail` is on its internal list
because `DispatchResult::detail` and `ActivityLogEntry::detail` carry the program's own description of
a failure, drawable only in the Console. But `SketchEntity::detail` held *user-facing operands* —
"at 0, 0 mm", "centre Point A, radius 12 mm". **The honest fix was to rename the field to `operands`,
not to carve the gate open.** Evidence that nothing was weakened: **8894 checks before and after,
failures 2 → 0**, and the full suite reports ALL 35 UI GATES PASS.

★ `model_tree_test.cpp` reached that field through `g.entities[0]` without ever naming the type, so a
grep for `SketchEntity` did not find it and the rename broke four assertions. **A rename's blast
radius is not found by grepping the type name.**

★ **Read WHICH STEP failed before diagnosing a job.** #219's red job showed exactly one `FAIL` line,
and that line was an explicitly-labelled *expected* negative control. The actual failure was a
different step — "Archie op vocabulary is still what the sources imply" — the merge tax: the
vocabulary records a sha256 of `ForgeFrame.cpp`. Regenerating (vocabulary first, then the constraint
table) produced a **four-line diff, all sha/bytes**, with `bytes` moving 200209 → 200215: exactly the
+6 from `.detail` → `.operands` at three call sites. Command surface unchanged at 84/53/57/3.

★ **A stale local artefact fabricates a crash.** The click gate run locally against a
`libforge_kernel_core.dylib` built 2026-08-29, while `forge-kernel/src/ft/` had changed 2026-09-03,
gave an ASAN SEGV in `std::vector<forge::ft::Point3>::__destroy_vector`. Pure ABI mismatch. **Check an
artefact's mtime against its sources before believing its stack trace** — the *link* success was
still valid evidence, and that was the thing under test.

**`EXPECTED_MUTATIONS` was contested at a fourth merge, and neither side was right.** This branch
derived 52 (frame 12 + assembly 4); `archdisc` derived 50 (frame 14, no assembly gate). Both were
correct on their own tree and both are wrong on the merged one. Measured on the merged tree: **54** =
ir_pipeline 0 + document 8 + file_exchange 5 + frame 14 + copilot 8 + update 7 + click 8 + assembly 4
+ isolation 0. **Taking either side would have silently dropped real mutations.** Re-derive it at
every merge; never carry a side across. (bash uses the LAST assignment, so leaving both is worse than
picking wrong.)

**Ledger, unchanged:** `occt_closure_count.sh` reports **OCCT_CLOSURE = 14, ZERO of 14 dropped**.
Re-verified structurally this tick: **all nine family options still default OFF on `origin/archdisc`**,
and `CMakeLists.txt` releases TKOffset only when **all nine** are ON — so the number cannot have moved.
No binary was rebuilt for this check, and that is stated rather than implied. **"11" must never be
quoted as progress.**

---

## 2026-09-03 — the flip gate was measuring the wrong thing, and the instruments crash

**THE VERDICT WAS ONE LINE, AND THE FILE SAID SO.** `forge-kernel/test/corpus_ab_aggregate.mjs` decided
every family with

```js
const natOk = f.BOTH_OK + f.NATIVE_ONLY; const occtOk = f.BOTH_OK + f.OCCT_ONLY;
const pass = natOk >= occtOk;
```

while its own prose admitted `agree` was computed and **"THE VERDICT DOES NOT READ IT"**. Validity was
likewise reported and unread. Same 600 parts, same 7,796 rows, aggregated twice: **five of ten drop
options PASSED on coverage; ZERO of ten pass on replaceability.** MAKEOFFSET, PIPE, PIPESHELL, FILLING
and THICKEN all flip. Not a regression — the geometry was always this way and the verdict could not
see it. **"A, C, E, I pass their flip gate" is retired.**

**THE DISAGREEMENTS ARE FIVE CLASSES, EACH WITH A CLOSED FORM OR A COUNT.**
- *Different operation* — PIPE and PIPESHELL differ on **600/600** at volume ratio 1.071797, and
  **2/(1+cos 30°) = 1.071797** exactly. Face counts differ on 505/600.
- *Different orientation* — THICKEN differs on **600/600** by signed volume **exactly −1.000000**, area
  ratio exactly 1.000000, 595/600 agreeing up to orientation. One sign bit — and still not
  boolean-interchangeable.
- *Different representation* — FILLING **407/407** and THRUSECTIONS **498/498** match on volume, area,
  COM, all six bbox bounds **and every f/e/v/shell/solid count**, differing only as native `Plane` vs
  OCCT `BSplineSurface` on the same face with the same four line edges. **The native answer is arguably
  the better one**; the gate judges interchangeability, not correctness, and prints both readings.
- *Different decomposition* — MAKEOFFSET **285/285** differ in edge count at wire-length ratio p50
  0.999956.
- *Numerical margin* — FILLET's 58 sit at 2–5e-6 against a 1e-6 bound. **No tolerance was widened.**

**AND THE BAR IS MOSTLY INVALID.** THICKSOLID: 132 OCCT answers, **132 BRepCheck-invalid**, valid bar
**zero**. OFFSETSHAPE: 38 answers, **33 invalid**, valid bar 5 — and native's 24 answers are all valid
yet reproduce **none** of those 5, because it declines on exactly those parts. DRAFT 52 of 497 invalid;
FILLET 91 of its own 403.

**THE GROUND TRUTH CRASHES, AND SO DOES THE INSTRUMENT THAT JUDGES IT.** A census of 232 crash reports
from one day, counted by **faulting address** rather than process name, shows OCCT faulting at **five
distinct sites**:

```
  67  0x30  libTKTopAlgo   BRepCheck_Analyzer / BRepCheck_Solid::Minimum   <- the validity checker
  48  0x60  libTKBRep      BRep_Tool::CurveOnSurface (the offset engine)
  28  0x78  libTKMath      ShapeCustom::SweptToElementary
   2  0x70  libTKG3d
   2  0x10  libTKG2d
```

**The most frequent OCCT crash is the validity checker itself** — 67 of 145 OCCT faults. Every
"N of M are BRepCheck-invalid" figure above therefore has a true denominator of *"shapes the checker
survived"*, and any validity term used as a merge criterion needs a crash-safe call path. Separately,
`ShapeCustom::SweptToElementary` — the natural API for asking *"is this BSplineSurface really a
plane?"*, which is exactly the FILLING/THRUSECTIONS question — **crashes on this corpus**, so that
equivalence must be decided without it. And THICKSOLID's bar is not even stable: `ho317` returned OK,
then `CRASH signal 11`, then OK five times running.

**METHOD NOTES WORTH KEEPING.** Term 1 of the new verdict is the original line **verbatim**, so the new
verdict is a strict subset of the old — it can only remove passes, and a check enforces
`verdict==PASS ⇒ coverage_only_verdict==PASS` over fixtures and every real run. The coverage bar is
never lowered; the valid bar prints beside it. The harness change was proved **inert**: 7,781 of 7,796
rows byte-identical, the 14 differing only in already-documented summation noise. All three committed
summaries **regenerate byte-identically** from the committed raw rows, so a reviewer can reproduce every
number rather than trust it. **A threshold must be measured, not chosen**: the first centroid-sanity
term fired on 12 of 61 *valid* THICKEN rows because a full cylinder's vertex-derived bbox is a line —
a term that reds a valid cylinder is a wrong gate, not a stricter one.

**LEDGER, UNCHANGED AND STATED PLAINLY:** `occt_closure_count.sh` reports **OCCT_DIRECT 9,
OCCT_CLOSURE 14, OCCT_PHANTOM 2 — zero of fourteen toolkits dropped.** All nine family options remain
default OFF; `CMakeLists.txt` releases TKOffset only when all nine are ON, and flipping them today
would delete an answer on **233 of 600 parts (38.8%)** while shifting every sweep's volume by 5.5–9.8%.
Nothing in this work moved that number, and nothing should until a family is replaceable rather than
merely covering.

---

## 2026-09-04 — The OCCT closure census, from one binary; and the seam measured on half of what it drops

**Decision: set every closure figure from `reports/OCCT_TOOLKIT_SYMBOL_CENSUS_2026-09-04.md`
and from nothing else.** Two earlier censuses disagreed (TKTopAlgo 110 vs 106, TKMath 32 vs 31)
and a ceiling must never be set from a contested number. The census is one measurement of one
binary — the `forge-kernel.node` CI built on #232, preserved before its worktree was reaped.

**It is self-checking.** `called` equals `uniquely attributed` on all fourteen rows and the rows
sum to the distinct total (541). Every OCCT symbol this binary calls is exported by exactly one
closure member, so no attribution judgement was required and none was made.

- **TKTopAlgo = 110. TKMath = 32.** Both contested figures settled.
- **TKBO = 32, correcting the 59 carried in the running notes** — that number came from a
  different arm and was never re-measured on one binary. It is retracted.
- TKGeomBase, TKGeomAlgo, TKPrim, TKBool call **ZERO** symbols: pure free riders, present only
  because `libTKOffset` DT_NEEDs them.
- The bottom six sum to **exactly 444 of 541**, confirming the architecture-floor arithmetic.

**The finding that changes what to do next.** The pair {TKOffset, TKFillet} — the only unit that
moves CLOSURE 14 -> 11 — is 53 symbols in **twelve OCCT classes**. Nine are exactly the A/B
families the current programme is working, which is independent evidence the effort is aimed
correctly. **One, `BRepFilletAPI_MakeChamfer` (5 symbols), is covered by no A/B family at all.**

★`FORGE_FILLET_DROP_NATIVE` guards BOTH MakeFillet and MakeChamfer (`src/Features.cpp:70-76`,
`:2040-2147`) — correctly, since both live in TKFillet. But the harness includes only
`BRepFilletAPI_MakeFillet.hxx` (`test/corpus_ab_coverage.cpp:179`) and its family list has ten
entries, none of them CHAMFER. **The seam that would drop TKFillet is measured on half of what
it drops**, so even a perfect FILLET result cannot justify the flip. Same shape as the defect
where a status label absorbed the endpoint beside it: two quantities treated as one.

**This is a measurement gap, not a missing capability.** `src/native/brep/NativeFilletChamfer.cpp`
(118 KB, "ROUTINE R3 of the OCCT-zero drop plan") already re-implements both classes referencing
no BRepFilletAPI/ChFi3d symbol, and the native chamfer path REFUSES on decline rather than faking
(`Features.cpp:2047`). **Action: add CHAMFER as the eleventh A/B family, built exactly as the
other ten are. Do not flip `FORGE_FILLET_DROP_NATIVE` before it reports.**

---

## 2026-09-04 — The corpus taught a third of the product, and three gates could not fail

**Four findings, each measured, each with the instrument named. Two of them retract things
this programme believed.**

### 1. The training corpus covered 18 of the 53 ops a user can invoke

`data/forge/vocab_legal_v2` is 100% vocabulary-LEGAL — `tools/archie_vocab/validate_corpus.py`
returns `rows=40000 legal=40000 illegal=0, VERDICT PASS`. It is also **18 of 53 ops**, measured
over 8,000 sampled rows. The 35 it never shows include **BOX, CYL, CONE, SPHERE, TORUS, PRISM,
TUBE, SWEEP, THICKEN and SECTION**.

★**That is not a theoretical gap; it is the whole of a measured failure.** The adapter trained on
that corpus, `adapters/archie-30b-vocab-legal-v8`, scored **`kernel-GATE PASSED 0/600 (0.0%)`** on
the e600 held-out set (`logs/eval_vocab_legal_v8_e600.log`), and every failing line names the same
cause: `unknown op 'bore'` / `'CYLINDER'` / `'cylinder'` / `'CUBOID'`. The model needed a cylinder
or a box, had never been shown `CYL` or `BOX`, and fell back to a base-model prior `forge::ui`
cannot execute. The corpus's own system prompt advertises only those 18, so the omission was
taught twice.

★★**THE DECISION THIS FORCES: LEGALITY AND COVERAGE ARE DIFFERENT PROPERTIES, AND ONLY ONE WAS
EVER CHECKED.** Every training launch verified legality. No launch ever measured coverage. A
corpus can be 100% legal and still teach a third of the product, and in-distribution it will look
excellent the whole time — v8 is the proof that in-distribution success and 0/600 on real tasks
coexist. **Both are now required: an in-distribution split AND a real-task set.**

★**The generator diagnosed itself.** `gen_corpus.py` today prints
`ZERO COVERAGE for BOX, CAP, ... -- refusing to write` and emits nothing, because the vocabulary
grew 18 → 28 → 53 under a walk whose builders were written for the 18-op era (the snapshots
`archie_op_vocabulary.json.18op-20260831` and `.28op-20260902` sit beside the live file). **An
honest refusal that names the missing set turned a standing mystery into a scoped task.**

**Resolved:** `data/forge/vocab_legal_v3` covers **53/53, missing none** (CYL 4,762, BOX 5,040),
validator `rows=40000 legal=40000 illegal=0 PASS`, train/valid prompt overlap 0, and **0 of 40,000
prompts leak a `%id`** into the question — a defect the rebuild also found and fixed. `v2` is
byte-identical and kept. Training moved to v3; the evaluation is **pre-registered** in
`scripts/eval_vocab_v5_e600.sh` so it can contradict us.

### 2. A launch defect of ours: 43.9% of training rows were silently truncated

The first v3-era run used `--max-seq-length 512`, carried over from the MMCAD *vision* script where
rows are short. On this corpus that truncated **43.9% of rows** (p50 471, p90 913, max 1413), and
mlx_vlm's SFT trainer **truncates rather than skips** (`trainer/sft_trainer.py:222`,
`max_len = min(max(lengths), max_seq_length)`). With `--train-on-completions` the span being cut is
exactly the assistant's IR program. **The "loss is dropping" reading taken from those iterations is
retracted** — it was computed on mangled targets. **Measure a corpus's length profile before setting
the cap.**

### 3. Three gates shared a build tree and could not fail; the third was found by predicting it

#223 fixed `build_native_gate_guard_gate.sh` and protected only its own two objects. #236 found the
same race in `run_step_unit_decline_gate.sh`, and #239 in `build_thicken_orientation_gate.sh` —
located by sweeping for the pattern (a real `touch`, a persistent build tree, no object deletion)
rather than waiting for it to fire.

★**`touch` is not enough, and that is measured, not argued.** It sets the source mtime to NOW while
the object was compiled by the previous round, also NOW; a build system recompiles when the source
is **NEWER**, and **equal is not newer**. Positive control, because a green run cannot prove an
intermittent race fixed: `touch -r "$OBJ"` on the source → build `rc=0` and the object is **NOT**
recompiled; delete the object → the compiler runs. ★**The comparison is SOURCE vs OBJECT, not source
vs library** — comparing against the library at minute granularity reported "recompiled" and hid it.
★A **header** mutation invalidates every including TU, so deletion is driven off cmake's own `*.o.d`
depfiles. ★`cmp` proves the SOURCE came back; it can never prove the OBJECT recompiled.

### 4. Three times a harness accused the kernel and was itself wrong

#225: THICKEN's "600/600 orientation flip at signed volume exactly −1.000000" — repeated here as a
measured fact — **was the A/B measuring half the block the flag deletes.** Native was right;
corrected, agreement is **0/600 → 595/600**. #230's RED was the step-unit gate's own skipped
rebuild, on a branch whose 27 files touched nothing named `step*`. And the flip gate had earlier
decided ten families on coverage while computing an agreement term its own comment said the verdict
never read.

★★**THE STANDING RULE THIS ESTABLISHES: before believing a gate's verdict about its subject, check
that the gate measures the WHOLE subject, and that the step which failed is the measurement rather
than the thing measured.** The same shape retired several other beliefs the same day: MAKEOFFSET's
285 disagreements are two classes and **neither is an edge partition** (38 are the two arms offsetting
in OPPOSITE directions); DRAFT's other 52 are **not** a topology change; THICKSOLID's invalid bar is
**133**; and FILLET's 58 near-misses are a **real geometric difference, not a tolerance** — so
declining to widen was right.

## 2026-09-04 — the v5 evaluation blocker was self-inflicted; the invariant was backwards

**Claimed yesterday and recorded as measured:** every adapter holds 1024 tensors of which 480 are
LoRA; `adapter_config.json` lists the 240 LoRA modules, so **544 are silently ignored at load**, and
110 of them changed during v5 training. On that basis I declared the evaluation blocked, refused to
produce a number, and put a question mark on the published v3 result.

**That claim is false.** `mlx_vlm/trainer/utils.py:346` calls `model.load_weights(..., strict=False)`
on the WHOLE model after the LoRA layers are installed, so a non-LoRA tensor is applied iff its name
matches an existing parameter. Measured on the live model — load v3, read the tensor back:
`vision_tower.blocks.25.mlp.linear_fc2.weight` equals the ADAPTER exactly (max|d| 0) and differs from
base by the full 4.37e-3. All 544 land. v3's result stands; v5 was never blocked.

**The real defect was in our own `expert_lora_patch.verify()`**, and it was backwards: it passed the
784-key config that CRASHES the loader and refused the 240-key config that works. Cause:
`keys_from_weights()` stripped `.lora_[ab]` off every tensor name, so the norms and the whole vision
tower (544) were counted as LoRA module paths.

**Decision — fix the invariant, do not relax it.** LoRA-only key derivation; `verify(base_dir=...)`
checks the two tensor classes on the instrument that governs each. The v4a protection (a LoRA tensor
whose module is never built IS dropped — 72 expert tensors lost) is unchanged in both directions; a
new check covers the class that had none. Gate: `scripts/test_expert_lora_verify.py`, 10 checks,
three mutations each refused with its own diagnosis. The evaluator now refuses an adapter whose
tensors cannot all land, proved against a synthetic bad adapter.

**Rule taken from it:** a measured fact multiplied by an unmeasured premise yields an unmeasured
conclusion. The measurement ("110 tensors changed") was right; the premise about load behaviour was
never checked, and the product was a blocker that cost a night. Loading the model and reading the
tensor back took four minutes.

**Also this tick:** #242 merged (`0e1efdcd`, 27 today). App rebuilt from the merged HEAD and
installed; the shipped dylib carries both new guard strings, the worker answers
`FORGE-WORKER-RESULT 1`, the bundle launches. Rollback `/Applications/Forge.app.prev-20260904-1142`.
**OCCT_CLOSURE re-measured after the base move: 14, unchanged** — as predicted, `BRepExtrema` is
TKTopAlgo and already a direct dep. Zero of 14 dropped; the pair {TKOffset, TKFillet} still gates it.

## 2026-09-04 — the vocabulary corpus teaches copying, not knowing

**Measured, and it is a total disjunction on the one cue the corpus exists to teach:**

```
vocab_legal_v3/train.jsonl   38,000 rows — system prompt lists the 53 legal ops:  38,000  (100.0%)
holdout_enlarged_600.jsonl      600 rows — system prompt lists the 53 legal ops:       0  (  0.0%)
```

Training says *"The ONLY ops a user can invoke are: BLEND, BOX, CAP, …"* in **every** row. The
benchmark says *"reverse-engineer this face census"* and names **no ops at all**. The model was
never required to memorise the vocabulary — it could read it out of the context window every time —
and at evaluation the context does not contain it.

**The failure this produces is exactly the observed one.** First 15 e600 tasks under v5: 15/15 fail
to compile, **100% on invented ops** — `CYLINDRICAL_BORE` (10), `CYLINDRICAL BORE` (2), `CYLINDER`
(2), `extrudeSphere` (1). Pre-registered P1 said the unknown-op share of compile failures would fall
from ~100% to **<20%**. On this evidence **P1 is failing**, and `CYLINDER` is the same token that
made v8 score 0/600.

**The tasks also differ, not just the cue.** Training: "Build this part in Forge" from a text
description. Benchmark: reverse-engineer a solid from a kernel-measured face census. Same output
grammar, different input modality.

**Decision — stop the full run and buy the answer instead.** e600 was emitting at 2.7 min/task, so
the remaining 585 would take ~27 hours to confirm a number already visible at 15/15. The partial
data is preserved (`reports/vocab_v5_partial/`) and reported as what it is: a prefix, and the
holdout is sorted hardest-first, so it is a hard sample. Running in its place is a controlled A/B on
a **stride** sample of 20 tasks, identical in every field except the system prompt, which in arm B
gains the one sentence naming the 53 ops. Positive control recorded before launch: the arms differ
in exactly one field, `system`, 0/20 vs 20/20.

**What each outcome would mean, written down before the result:**
- **Arm B collapses the invented-op rate** → the vocabulary was never internalised, and the fix is a
  corpus that withholds the op list from a large fraction of rows.
- **Arm B fails too** → the binding constraint is the TASK mismatch (census → tree), not the
  vocabulary cue, and a corpus of census-derived rows is what is missing. **Do not build v6 until
  this comes back** — the two diagnoses call for different corpora.

**The shape is one already in the ledger:** MM-CAD was unusable because all 33,816 rows carried the
assistant answer verbatim in the user prompt. This is the same defect one level down — not the
answer in the prompt, but the *vocabulary* in the prompt, in 100% of rows. **A corpus can be 100%
legal, fully covered across all 53 ops, and still teach copying rather than knowing. Check what the
model must SUPPLY, not just what the corpus CONTAINS.**

## 2026-09-04 — the FILLET/CHAMFER deficit decomposed; and it does not move closure

Measured on a full 600-part corpus run at `0e1efdcd` (1200 rows, 0 error rows, gate self-test PASS,
`build_stamp.git_head == kernel_head_at_run`, 0 dirty files). Positive control: the run reproduced
#242's pre-registered numbers exactly, so the binary matches the tree.

**First, a correction to how we have been stating the deficit.** "Parts where OCCT succeeds and
native DEFERS" is true for CHAMFER (171/171) but NOT for FILLET:

| family | deficit | native DEFER | native invalid | native VALID but disagrees |
|---|---:|---:|---:|---:|
| FILLET | 202 | **144** | 0 | **58** |
| CHAMFER | 171 | **171** | 0 | 0 |

Both tables below sum to the deficit **exactly, with no remainder**.

**FILLET 202** — hole-wire clearance 69 · *disagreement (not a defer) 58* · ring clearance 37 ·
face A non-planar 14 · face B non-planar 9 · extent unmeasurable 7 · non-straight outer boundary 6 ·
vertex not trihedral 2.

**CHAMFER 171** — end face not a straight-boundary corner 67 · hole-wire clearance 59 · ring
clearance 16 · face B non-planar 8 · face A non-planar 7 · extent unmeasurable 7 · non-straight
outer boundary 6 · vertex not trihedral 1.

The two families are the **same parts class-for-class**. The one off-diagonal cell is
`FILLET DISAGREE(58) → CHAMFER ENDFACE(58)`: one geometry class seen twice.

**The 58 are probably the instrument, not the engine.** Counts, bbox (bit-identical) and COM all
agree; only volume (2.2–5.0e-6 relative) and area (4.5–6.3e-6) differ. Native emits exact
**Torus×4 + Cylinder×8**; OCCT emits **BSpline×8**. If native is the correct arm the true FILLET
capability deficit is **144, not 202**. **This is being adjudicated against an independent closed
form — neither arm may be its own judge — and until that returns the deficit stays stated as 202.**

**Tractable:** CHAMFER's 67 end-face parts are a pure code gap — FILLET answers them through
`filletTangentRim`; CHAMFER has no rim path at all. The chamfer rim is strictly simpler (a Plane per
line segment where the fillet uses a cylinder, a Cone per arc where it uses a torus). Implementation
is under way. Hole-wire clearance (69/59) is also bounded but is two pieces, not one: OCCT's answer
there is a blend **split into two by the bore**, which `retrimAdjacentFace` cannot express.

**Deep, and not to be budgeted as a sprint:** the non-planar-face classes (23 FILLET / 15 CHAMFER)
are 157–181-face organic parts with B-spline outer rings and B-spline/cylindrical end faces; they
need uv-space retrim of a cylindrical face, spline-boundary retrim, and blend termination against a
B-spline end face. The last two are the general problem.

★★★**AND THE PART THAT MATTERS MOST: NONE OF THIS MOVES CLOSURE.** The flip gate is
**`deficit == 0`, not "deficit small"**. Even if the CHAMFER rim and both hole-clearance classes
landed perfectly, FILLET's defers would fall 144 → 75 and CHAMFER's 171 → 45 — **both rows still
fail, `TKFillet` still cannot go, and `TKOffset` has to go in the same step regardless.**
**OCCT_CLOSURE stays 14.** This is the honest answer to "why has closure still not dropped": the
remaining work is not a long tail of small fixes, it is ~23–38 parts per family of genuine spline
blending, behind an all-or-nothing gate, on the second member of a pair that must be removed
together.
