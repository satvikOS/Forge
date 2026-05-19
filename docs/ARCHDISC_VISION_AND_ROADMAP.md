# ArchDisc — Full Vision & Roadmap

> **Carry-over document.** Written 2026-05-18 to hand the full ArchDisc vision,
> the honest current state, the gap, and the resume points into a fresh
> session. Read this first. It is self-contained — assume the reader has no
> prior context.

---

## 0. Read this first — the honest framing

ArchDisc's ambition is an **AI-native engineering platform**: a user downloads
it, plugs in any LLM/SLM, types a prompt, and the platform autonomously plans,
clarifies, constructs, tests, analyses, renders, assembles, and publishes a
complete engineering project — at a granularity beyond expert engineers.

The honest current state, stated plainly so no one is misled:

- ArchDisc is **not** at parity with ACIS / Parasolid / Siemens NX / SolidWorks /
  Autodesk. It is early-stage.
- Its working modeling kernel is **`manifold-3d`** — a robust *mesh / triangle
  boolean* kernel. It is **not an exact boundary-representation (B-rep) kernel**.
  It cannot do exact NURBS surfaces, exact trimmed topology, exact fillets,
  tolerant modeling, or most of the capability list in §3.
- The **AI integration is genuinely strong** — a BYO-LLM provider layer (cloud +
  local SLM) works, and an autonomous LLM-driven CAD pipeline has been built and
  proven end-to-end (see §6).
- A real autonomous run was attempted (build an Omega Seamaster). It produced 23
  component STEP files **fully autonomously**, but **0 passed verification** —
  the geometry kernel cannot produce convincing watch parts. That is the honest
  result and it correctly diagnoses the core gap (§7).

**The single biggest blocker between today and the vision is the geometry
kernel.** Everything else (AI orchestration, UI, simulation) is meaningful work,
but without an exact B-rep kernel the platform cannot construct real engineering
geometry. Plan accordingly — do not let AI-orchestration progress disguise the
kernel gap.

---

## 1. The Vision

### 1.1 Plug-and-play AI onboarding

- The user **downloads the software** (desktop app — ArchDisc is Electron).
- The user **enters their LLM/SLM configuration** into the software (API
  endpoint, key, model — any provider, cloud or local).
- The software **sends multiple test signals** to fully confirm the model
  connection works, and the status **turns green** only when confirmed.
- BYO model: any LLM or SLM, plug and play. (Foundation for this exists — §6.)

### 1.2 Prompt → end-to-end planning → MCQ clarification

- The user **enters a prompt** describing the project to build.
- The platform performs **full end-to-end planning** — this may take anywhere
  from **minutes to hours**.
- The platform presents the user with **anywhere from single-digit to
  triple-digit multiple-choice questions (MCQs)** to answer — exhaustively
  resolving every ambiguity, misunderstanding, and potential mistake **before**
  any construction begins.

### 1.3 Autonomous swarm construction

- After all MCQs are answered, the AI **begins implementing the plans**.
- It **creates, constructs, tests, analyses, and renders** the project **one
  component at a time**, with **swarm agents working in parallel** across
  components.
- The workflow follows **the same manner a manual expert user would** — from the
  ground up — but with **microscopic refinement not achievable by a human**.
- From **detailed sketches → precise modelling → engineering excellence**, built
  with **creativity and accuracy**.
- Each component is fully completed (constructed, tested, analysed, rendered)
  and **saved with an id** before moving to the next.

### 1.4 Final assembly

- When **all components are fully achieved**, the platform performs the **final
  assembly** of all components into the complete project.

### 1.5 Publishing (the last step — many steps precede it)

- A **full suite for all types of publishing** of the finished project.

---

## 2. Required engineering depth — the workflow

The construction must perform, autonomously and robustly:

- **Detailed sketches** → **precise parametric/precise modelling**.
- **Complex blending and filleting**.
- **Robust Boolean operations**.
- Microscopic refinement at a granularity **harder than most expert engineers**
  can achieve by hand.
- **Full plans and blueprints wherever possible.**

---

## 3. Geometry kernel — the required capability set (ACIS / Parasolid parity)

This is the capability list the platform must reach. Today ArchDisc has **almost
none of it** (it has mesh booleans only — see §6). This list IS the kernel
roadmap.

### 3.1 Blending & Filleting
- **Variable Radius Blending** — smoothly changing radii across non-uniform surfaces.
- **Cliff-Edge Blending** — blends that completely consume or run off adjacent faces.
- **Corner Mitering** — resolving the intersection of three or more complex blends at one vertex.
- **Curvature-Continuous (G2) Blending** — matching surface *curvature rates*, not just tangency, across splines.

### 3.2 Local Operations
- **Complex Face Offsetting** — offsetting intricate high-curvature surfaces without self-intersection.
- **Hollowing & Shelling** — thin-walled solids from models with sharp, tight interior corners.
- **Drafting Spline Faces** — taper angles applied to complex non-planar surfaces.
- **Thickening Sheets** — converting a complex open surface into a valid watertight solid.

### 3.3 Advanced Surfacing
- **N-Sided Patching** — filling a gap bounded by an arbitrary non-four-sided loop of curves.
- **Sweeping Along Tortuous Paths** — preventing self-intersection when a profile sweeps tight 3-D curves.
- **Lofting with Tangency Constraints** — smooth surfaces through multi-profile guides with boundary conditions.

### 3.4 Boolean & Topology Alterations
- **Non-Manifold Booleans** — intersections that result in zero-thickness walls or shared edges.
- **Coplanar / Coincident Face Booleans** — uniting/subtracting bodies with perfectly overlapping faces.
- **High-Density Lattice Intersections** — intersecting thousands of microscopic beams in generative-design models.
- **Local Face Replacement** — swapping underlying geometry while dynamically rebuilding surrounding topology.

### 3.5 Healing & Conversion
- **Tolerant Modeling / Stitching** — sewing imported surfaces with gaps larger than standard tolerances.
- **Geometry Simplification** — removing tiny features, sliver faces, small edges automatically.
- **Convergent Modeling** — performing classic B-rep operations directly on facet/mesh data.

### 3.6 Evaluation & Checking
- **Clash & Interference Detection** — exact intersection zones within massive assemblies of complex parts.
- **Self-Intersection Detection** — scanning highly warped spline surfaces for crossings.

> **Honest engineering note.** Items in §3.1–§3.5 fundamentally require an
> **exact B-rep / NURBS kernel**. `manifold-3d` (mesh) cannot do them. Reaching
> this list means **building or integrating an exact kernel** — a multi-year,
> specialist effort, or licensing one. This is the platform's foundational
> decision. Convergent modeling (§3.5) and clash/self-intersection (§3.6) are
> the items most reachable on a mesh kernel.

---

## 4. Tests & Analysis — full integration

- **Every test and analysis that exists in the world**, fully integrated into
  the platform.
- Not just **equations / numbers** shown — **fully rendered video** of each
  analysis scenario playing out.
- The **Mechanical section's** scope of disciplines (not limited to):
  - Thermal Engineering
  - Design Engineering
  - Manufacturing Engineering
  - Mechatronics & Robotics
  - Automotive Engineering
  - Aerospace Engineering
  - Materials Engineering
  - Industrial Engineering

Each component AND the final assembly must be tested and analysed against all
applicable scenarios, rules, regulations, and real-world conditions — with the
results rendered as video, not only reported numerically.

---

## 5. Granularity & Documentation principle

- Full end-to-end operations at the **highest possible granularity** — finer
  than most expert engineers work.
- **Full plans and blueprints** produced wherever possible.
- The autonomous workflow mirrors a manual expert user's process, ground-up,
  with refinement beyond human reach.

---

## 6. Honest current state (as of 2026-05-18)

### 6.1 What ArchDisc is today
- A JS / Vite / Electron CAD-CAE platform. Repo `~/archdiscv1`, branch `archdisc`.
- Working modeling engine: **`manifold-3d`** (mesh-boolean WASM kernel) — robust
  watertight booleans; **NOT** an exact B-rep kernel.
- `kernel/` has B-rep *topology* classes (`TopoFace/Edge/...`) and a constraint
  `SketchSolver`, and `foundation/` has NURBS *fragments* (`NURBSSurface`,
  `BlendSurface`, `SurfaceCurvature`) — but there is **no unified, robust,
  exact, auto-trimming B-rep kernel**. By the project's own audit: "no
  auto-trimming NURBS B-rep kernel; no class-A modelling workflow."
- UI/UX: a workbench exists but is **not ready** for the vision.

### 6.2 What was built this session — the autonomous atomic-CAD sculptor (16 plans)
All on branch `archdisc`, pushed. Plans in `docs/superpowers/plans/`.

- **L0 atomic operations** — `frontend/src/kernel/atomic/`:
  - `ParametricCurve.js` — involute, spiral, ellipse, circle evaluators.
  - `SketchProfile.js` — signed area, orientation, loop chaining.
  - `Part.js` — the construction-history record.
  - `AtomicOps.js` — `createPart, startSketch (XY / top / bottom face),
    sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve,
    circularPattern, linearPattern, translate, fillet`.
- **L2 AI Sculptor** — `frontend/src/ai/sculptor/`:
  - `PartSculptor.js` — `buildSculptPrompt, parseSculptPlan, executeSculptPlan,
    requestSculptPlan, sculptPart, sculptAndVerify` (the LLM autonomously
    sequences atomic ops; the verify loop recovers from execution failures).
  - `PartVerifier.js` — `verifyRender` — a **vision LLM** judges the part from
    **5 orbited camera angles** (`window.__archdiscOrbitView`).
  - `AssemblyBuilder.js` — `sculptAssembly` (decompose → sculpt parts → place).
  - `ComponentManifest.js` — `requestManifest` (LLM decomposes a product).
  - `ComponentLibrary.js` — `partToStep` (STEP export) + a component registry.
  - `DeliverablePackage.js` — `buildReportMarkdown` (honest build report).
- **BYO-LLM** — `frontend/src/ai/PlannerProviders.js` — `PROVIDERS` for
  anthropic / openai / google / Azure OpenAI / Azure Foundry / any
  OpenAI-compatible endpoint, with local SLM presets (Ollama, LM Studio, vLLM,
  llamafile). This is the real foundation for §1.1 plug-and-play.
- Window hooks driving the app: `__archdiscAtomic`, `__archdiscSculptor`,
  `__archdiscComponents`, `__archdiscOrbitView`.
- `foundation/` (~80 modules) usable as building blocks: `StepExport`
  (`manifoldToSTEP`), `StepImport`, `ZipArchive` (`makeZip`), `MorphologicalFillet`
  (voxel fillet), `SmoothImplicit`, `KinematicsCore`, `MotionStudy`,
  `SystemDynamics`, `ExplicitDynamics`, `JpegEncoder` + `VideoMux` (in-platform
  video), simulation modules.

### 6.3 The Omega Seamaster autonomous run — honest result
- The AI autonomously: decomposed "Omega Seamaster" into a 22-component
  manifest, sculpted each component (LLM → atomic ops), verified each from 5
  camera angles, STEP-exported and saved each, and packaged a deliverable ZIP.
- **23 component STEP files produced. 0 passed vision verification.** The
  geometry was inadequate (a case came out a blob, a crystal a sphere); the
  verifier honestly rejected all of them.
- Deliverable: `autonomous-output/seamaster/Omega-Seamaster-deliverable.zip`
  (~22.5 MB) — 23 component STEP files + an honest `BUILD_REPORT.md`.
- **The autonomous *pipeline* works end-to-end. The *geometry quality* does
  not** — and that is purely the kernel gap (§3, §7).

---

## 7. The gap — what stands between today and the vision

Ordered by how foundational / blocking each is.

1. **An exact B-rep / NURBS geometry kernel** — THE blocker. Without it, none of
   §3.1–§3.5 is possible and autonomous construction cannot produce real
   engineering geometry. Options: build one (multi-year, specialist), integrate
   an open exact kernel, or license one. Every other item below is gated on a
   decision here.
2. **The full operation set on that kernel** — the §3 capability list.
3. **Simulation suites across all disciplines** (§4) + scenario **video**
   rendering — large, but `foundation/` has seeds (sim modules, video mux).
4. **Plug-and-play onboarding UX** (§1.1) — the BYO-LLM layer exists; the
   download → configure → test-signals → green-light experience does not.
5. **The MCQ clarification engine** (§1.2) — fragments exist (`ai/Clarifier.js`);
   the single-to-triple-digit exhaustive MCQ flow does not.
6. **Swarm orchestration at scale** (§1.3) — the autonomous sculptor exists;
   genuine parallel multi-agent construction at scale does not.
7. **UI/UX** — not ready for the vision.
8. **The publishing suite** (§1.5).

---

## 8. Suggested roadmap for the new session

Honest sequencing — do not skip the foundational decision.

- **Step 0 — Kernel decision (do this first).** Decide how ArchDisc gets an
  exact B-rep/NURBS kernel: build, integrate an open kernel, or license. This
  decision shapes everything. Until it is made, autonomous construction is
  capped at mesh-quality geometry (proven this session).
- **Step 1 — Onboarding & plug-and-play.** Build the §1.1 flow on the existing
  BYO-LLM layer: LLM config UI → multi-signal connection test → green-light.
  This is genuinely achievable now and is a clean, high-value first deliverable.
- **Step 2 — The MCQ clarification engine.** The exhaustive prompt → planning →
  MCQ flow (§1.2), built on `ai/Clarifier.js`.
- **Step 3 — Kernel + operation set.** Implement §3 on the chosen kernel,
  capability by capability. Convergent modeling and clash/self-intersection
  (§3.6) are reachable sooner; exact blending/surfacing needs the exact kernel.
- **Step 4 — Simulation suites + scenario video** (§4).
- **Step 5 — Swarm orchestration, assembly, publishing** (§1.3–§1.5).
- Throughout: keep the autonomous AI-sculptor architecture from this session —
  it is the proven orchestration layer; it simply needs a real kernel beneath it.

---

## 9. Resume pointers

- **This document** — the master vision/roadmap.
- **Honest design spec:** `docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`.
- **The 16 implementation plans:** `docs/superpowers/plans/` (2026-05-17 and
  2026-05-18 dated files).
- **Built code:** `frontend/src/kernel/atomic/`, `frontend/src/ai/sculptor/`,
  `frontend/src/ai/PlannerProviders.js`.
- **The autonomous-build artifact:** `autonomous-output/seamaster/` (component
  STEP files, `BUILD_REPORT.md`, the deliverable ZIP) — not git-tracked.
- **Auto-memory:** the `project_atomic_cad_sculptor` memory captures the
  session's progression and the honest findings.

---

## 10. The honest bottom line

This session proved one thing genuinely: an AI can autonomously drive ArchDisc's
real CAD operations end-to-end — decompose a product, sculpt components, verify
them with vision, export, assemble, package. **The orchestration works.**

It also proved, honestly, the thing that matters most: **ArchDisc's geometry
kernel is the gate.** A mesh-boolean kernel cannot build an Omega Seamaster, and
no amount of AI orchestration changes that. The vision in this document is
genuinely reachable — but the path runs through an exact B-rep kernel, and that
is the real, foundational, multi-year piece of engineering to commit to. Build
the foundation; the autonomous layer is already waiting on top of it.
