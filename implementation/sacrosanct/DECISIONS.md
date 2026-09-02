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
`grep -n "ref.kind = "` over `forge-desktop/src/ForgeFrame.cpp` returned those two lines and no
others. `SelectionSignature::satisfiedBy` compares kinds EXACTLY —
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
