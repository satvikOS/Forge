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
---

## D-026 (2026-08-30): THICKEN's whole 193-part deletion bucket was ONE surface type, and closing it moves native coverage 67.8% -> 96.2%

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
