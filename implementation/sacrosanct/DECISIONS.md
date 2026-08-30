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
