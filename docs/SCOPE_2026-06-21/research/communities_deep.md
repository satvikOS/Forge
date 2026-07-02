# Communities — Deep Cross-Cluster Synthesis (SYNTHESIZER pass)

**Compiled:** 2026-06-21
**Author:** synthesizer subagent (consolidates the 8 `comm_*.md` cluster findings + the prior `communities.md` pass).
**Job:** (1) consolidate the cross-community signal; (2) extract the hard-techs the field is converging on and the chronic pains that make engineers rage-quit; (3) **dedup against the existing SCOPE_2026-06-21 program** and propose ONLY genuinely-new workstreams.

**Sources consolidated (read in full):**
`comm_cad_tools.md`, `comm_core_me.md`, `comm_mfg_cnc.md`, `comm_sim_cae.md`, `comm_pro_forums.md`, `comm_robotics_auto.md`, `comm_additive_adv.md`, `comm_ai_eng.md`, and the prior `communities.md`.

**Existing program read for dedup:** `programs/{cadgenbench_program,kernel_parity_program,archie_corpus_program,uiux_program}.md` + `00_MISSION_BIBLE_V2.md`.

---

## 0. The single most important cross-cluster truth

Across all eight clusters, one structural pattern dominates: **engineers don't rage-quit because a tool can't draw a shape — they rage-quit at the *seams*.** The seam between an edit and the downstream features that break (toponaming). The seam between a vendor's file and yours (interop data-loss). The seam between CAD and mesh (preprocessing). The seam between the model and the drawing (detailing tax). The seam between design and manufacturability (over-tolerance / unmakeable geometry). The seam between disciplines (ECAD↔MCAD, mechanical↔control). The seam between a colourful contour plot and a signature (sim credibility). The seam between "the senior engineer knows why" and "the senior engineer left" (knowledge loss).

Forge's one-native-kernel + Archie-CUA thesis is *structurally* a seam-eliminator: when one kernel owns geometry + mesh + sim + PMI + assembly + history, the seams that kill bolt-on tools don't exist. The existing program already attacks the deepest seam (toponaming via persistent-ID rebuild) and the interop seam (AP242/Parasolid healing). **The new work this synthesis surfaces is the *other* high-frequency seams the existing program does not yet operationalize as shippable Forge/Archie capabilities.**

---

## 1. Cross-community trends/hard-tech/pains synthesis (the 15-25 line read)

The frontier (`comm_ai_eng`, `comm_sim_cae`, `comm_robotics_auto`) has *validated Forge+Archie's architecture* and walked away from the hard 20%: Project Prometheus ($12B, "artificial general engineer," literally "a very modern version of CAD"), Zoo Zookeeper (Plan→Act→Observe over a real kernel), the OpenFOAM LLM-agent wave (Foam-Agent / PhyNiKCE), and the VLA robotics explosion (164 ICLR'26 VLA papers, 18× YoY) all converge on "natural-language → action over a real kernel, with execution-grounded feedback." Every one of them punts on the engineering-grade core: dimensionally-exact tolerance-bearing editable B-rep that survives manufacturing AND simulation AND assemblies-with-motion. The hard-techs the community is *converging* on: persistent/stable references (FreeCAD 1.0 toponaming "fix" was the loudest OSS story, but it's incomplete); semantic (machine-actionable) PMI in STEP AP242 + QIF, not graphical annotations; implicit/SDF field-driven design (nTop + cloudfluid fusing GPU CFD into the kernel) escaping the STL tax; sim credibility/V&V governance (NAFEMS VVUQ, ASME V&V 10/20/40) — "trust a model as much as it deserves, but not more"; ML physics surrogates as a first-class deliverable ("100k sims a day," ~2700× claims) but always demanded *with error bounds*; the CAD→robot-description (URDF/SDF/USD/MJCF) pipeline (the flagship SW2URDF exporter "dead for 4 years"); GPU-native solvers (Fluent 10-14×); hybrid RANS-LES / mesh-free SPH-LBM to escape meshing; and geometry-truth benchmarks (CADGenBench) replacing text-similarity. The chronic pains — ranked by heat — are: (1) **the model breaks when you edit it** (toponaming + rebuild errors, "~20% of SW time fixing a broken tree"); (2) **interop data-loss** ("a geometry lottery," PMI/history/materials silently dropped, ~20-30% rework); (3) **drawings/detailing/GD&T are slow, manual, unloved** ("Onshape can't auto-create drawings," config changes don't propagate); (4) **large-assembly slowness/crashes** (Onshape "slow at ~11k instances," SW "spends time in suppress/lightweight rituals"); (5) **preprocessing/meshing is the sim bottleneck** (defeaturing ~80% of prep); (6) **"is my result trustworthy?"** (singularities, y+ mismatch, hourglass energy, contact non-convergence); (7) **design-for-process gap** ("CAD lets you draw geometry the process can't make" — over-tolerance, sharp internal corners, unsupported overhangs, fibers that won't drape, sections that won't feed); (8) **PLM/PDM is slow, hostile, six-figure, IT-gated**; (9) **knowledge/rationale evaporates when a senior leaves**; (10) **cloud-only / subscription / licensing rage** and offline/data-ownership anxiety; (11) **the CAD→sim-asset export pipeline is dead/broken** (roboticists); (12) **AI output is dimensionally-wrong, non-parametric, mesh-not-editable, no design intent.** The dominant tools/standards the community defers to: SolidWorks (mid-market default), NX/CATIA (aero/auto class-A + big assemblies), Fusion/Onshape (price/cloud), FreeCAD 1.0 (credible free); Ansys Fluent / Abaqus / OpenFOAM (sim); Mastercam (CAM); nTop (implicit/lattice); STEP AP242 + QIF + IGES + DXF/DWG + Parasolid/ACIS (interop); ASME Y14.5/Y14.41 + ISO GPS (GD&T/MBD); NAFEMS/ASME V&V (sim governance); LOTAR/AP242 (50-year archival); Teamcenter/Windchill (PLM); URDF/SDF/USD/MJCF + OPC-UA/FMI (robotics/automation interop).

---

## 2. HARD-TECHS the community is converging on (the technically-deep stuff)

1. **Persistent reference identity that survives recompute** (toponaming) — the category-defining moat; FreeCAD 1.0's incomplete "fix" proved it.
2. **Semantic (machine-actionable) PMI / GD&T** in STEP AP242 Ed.2/3 + QIF 3.0, with a real **geometric FCF evaluator** (not stored annotations).
3. **Implicit / SDF field-driven design** (gyroid/TPMS/Voronoi, functionally-graded) + feature-preserving iso-surfacer — escaping the STL/mesh round-trip.
4. **Sim credibility / VVUQ governance** — automatic singularity detection, y+/wall-treatment coupling, hourglass + mass-scaling + contact-stabilization energy ratios, mesh-convergence discipline, provenance/UQ on every result.
5. **ML physics surrogates / ROMs as a first-class deliverable** — instant CFD/FEA in the ideation loop, *with honest error bounds*; trained on the tool's own validated solver.
6. **CAD→robot-description export** (URDF/SDF/USD/MJCF) with kernel-computed inertia, separate collision geometry, and closed-chain support.
7. **GPU-native / mesh-free solvers** (Fluent 10-14×; SPH for free-surface/large-deformation, LBM for complex-geometry external aero).
8. **AM build-process simulation + automated geometric pre-compensation** (LPBF residual-stress warp; binder-jet sinter-shrink) round-tripped into parametric geometry.
9. **Process-aware anisotropic material models with scatter/uncertainty** (build-direction-dependent, not a single isotropic E/σ).
10. **Composites draping simulation** (fiber rotation/wrinkling on curved tools) + versioned layup-schedule/allowables.
11. **Tolerance-stack analysis** (worst-case + RSS + Monte-Carlo) that consumes semantic GD&T, respects the datum-reference-frame, and warns when RSS is invalid (non-linearity).
12. **Multi-axis (5-axis simultaneous) gouge/collision-checked toolpaths + verified post-processors + full-machine simulation + in-machine probing.**
13. **Differentiable / point-supervised parametric surfaces** (DreamCAD/NURBGen) — fitting geometry to a reference image/scan to break past blockout fidelity.
14. **Dynamic CAD / assemblies-with-motion** (AADvark: "no existing system can build a piston, a pendulum, or even scissors") driven by a real multibody DAE solver.

---

## 3. TOP PAINS that make engineers abandon a tool (chronic, cross-cluster)

1. **The model breaks when you edit it** — toponaming + rebuild/regen errors; ~20% of design time lost fixing a broken feature tree. (#1 everywhere.)
2. **Interop data-loss** — STEP/IGES "geometry lottery": radii→splines, missing/torn faces, PMI/materials/history/assembly-tree silently dropped; ~20-30% rework.
3. **Drawing / 2D-detailing / GD&T is slow, manual, and under-automated** — the most-hated routine workflow; nobody has nailed auto-drawings or auto-GD&T.
4. **Large-assembly slowness, crashes, and rebuild waiting** — suppress/lightweight/pause-regen rituals just to keep working at 1k-11k instances.
5. **Meshing / geometry-cleanup is the sim time-sink** — defeaturing ~80% of preprocessing; dirty CAD → bad mesh → divergence.
6. **"Is my result trustworthy?"** — singularities, wrong turbulence/y+ pairing, hourglass/mass-scaling abuse, contact non-convergence; colourful-contour-to-signature gap.
7. **Design-for-process gap** — CAD lets you draw geometry the process can't make (over-tolerance, sharp internal corners, unsupported overhangs, undraped fibers, unfeedable sections, unmachinable/un-depowderable features).
8. **PLM/PDM is slow, hostile, six-figure, IT-gated, top-down-imposed** — SMBs opt out and drown in version chaos; check-ins take 5-20 min; named-user-even-to-view licensing.
9. **Version/data chaos + collaboration friction** — corruption on save, models that won't reopen, lock-blocked parallel work, no visible change-diff/where-used/impact, manual merge of parallel copies.
10. **Knowledge / design-rationale evaporates** — the "why" walks out the door when a senior engineer leaves; rediscovered at cost 6 months later.
11. **Cloud-only / subscription / licensing rage + offline/data-ownership anxiety** — "lose access if you stop paying," cloud-only sim, browser timeouts.
12. **CAD→sim-asset export is dead/broken** (robotics) — abandoned exporters, dirty URDF, wrong inertia, no separate collision mesh, no closed chains.
13. **AI output is dimensionally-wrong, mesh-not-parametric, intent-free** — "a 3D screenshot"; validation effort exceeds time saved.
14. **Post-processor / machine-collision / quoting guesswork** (CAM) — bad posts crash machines; quotes are spreadsheets + eyeballing; CAM time ≠ real time.

---

## 4. DEDUP — what the existing program ALREADY covers (excluded from new tasks)

Confirmed by reading the four program docs. These pains map to **existing** scope and are therefore NOT re-proposed:

| Community pain / hard-tech | Already owned by |
|---|---|
| Toponaming / persistent-ID rebuild / edit-stability | kernel Batch 8 (`native::history`, `native::ident`, c1 "solves FreeCAD topological-naming"); UI U4 time-travel |
| STEP AP242 / IGES / Parasolid / ACIS / JT / DWG interop + geometry healing | kernel Batch 0 (`native::heal`) + Batch 11 (AP242/QIF/JT/Parasolid/ACIS/DWG) |
| Semantic PMI / auto-MBD / GD&T authoring (the *authoring* side) | kernel Batch 11 (semantic FCFs not annotation curves) + Pillar C (auto-datums, MMC bonus, `forge.capp/plm`) |
| Feature recognition + direct modeling on imported STEP ("edit existing part") | CADGenBench DIM-6 (feature-recognition/defeature, replace-face, move-face, delete-face+heal) |
| Per-process DFM rule set (corner-radius 130%/6:1, draft, Niyama, Chvorinov, K-factor, AWS fillet, 45° self-support, TPMS) — the *rule knowledge* | Pillar C `bulk_synth_mfg` (the 101 numbered rules) |
| Implicit/TPMS/lattice modeling + faceter + HLR | kernel Batch 10 (`native::lattice`, `native::facet`, `native::hlr`) |
| FEA/CFD/MBD/modal/transient/contact/buckling sim *ops* + multibody DAE | Pillar B (`forge.fea.*`, `forge.cfd.*`, `forge.simulate.multibodyDynamics`) |
| Instanced boolean + inertia tensor + clash/interference | kernel Batch 7 (a22, b14, c14) |
| Enterprise NX/CATIA/Creo UI (four-zone, modal sketch, constraint colors, rollback, pie menus, keyboard chaining, contextual dashboards) | uiux U0-U5 |
| CADGenBench ≥0.85 all-axes + ForgeCADScore v2 | cadgenbench_program (whole) |
| 14B Archie on math/logic + ~60 fields + manufacturing + P-1/Prometheus eAGI | archie_corpus_program (Pillars A-E) |
| Local-first / free-to-use / own-your-data positioning | mission bible business-model |
| Dynamic structures (mechanism/multibody/modal/transient) in the training corpus | Pillar B + corpus directive |

**Important nuance for novelty:** the existing program covers the **kernel ops** and the **training corpus / answer-keys** for many of these areas (e.g., `forge.twin.*`, `forge.vcommission.*`, FMI/OPC-UA appear as *corpus answer-keys* in Pillar D; tolerance-stack rules appear as *DFM knowledge* in Pillar C). The new tasks below are deliberately scoped to the **productized Forge feature / engine / workbench / benchmark axis** that those corpus answer-keys and kernel primitives do NOT by themselves deliver. Where a topic is "in the corpus but has no engine," the engine is the new work.

---

## 5. GENUINELY-NEW workstreams the communities reveal (the proposal)

Each is justified with `sourceSignal` (the community trend/pain that drove it) and `newBeyondExisting` (why it is not already covered). See the structured `newTasks` for the canonical list; the prose here gives the rationale.

### N1 — Large-assembly graphics + incremental-rebuild performance engine (P0, kernel/infra)
The #4 pain everywhere (`comm_cad_tools` "Onshape slow at ~11k instances," `comm_core_me` "SW large-assembly crashes," `comm_pro_forums` "Teamcenter 45 min to load," `communities.md` C1 "500-1000 parts almost unusable"). The existing program has *instanced boolean* (Batch 7) and *organized instancing* for flagships, but **no dependency-graph incremental recompute (re-evaluate only the dirty subtree), no native lightweight/graphics-only representation with on-demand resolve, and no large-assembly rebuild-time benchmark.** Pro users do suppress/pause-regen rituals precisely because every tool recomputes too much. This is the performance moat that lets Forge claim "no suppress rituals."

### N2 — Tolerance-stack analysis engine: worst-case + RSS + Monte-Carlo with method-validity warnings (P0, sim/plm)
The single most recurring *technical* struggle in `comm_core_me` (§2.1) and `comm_mfg_cnc` (§2.3) and `comm_pro_forums` (§2.3). The program has the *DFM rule knowledge* (Pillar C) and *semantic PMI authoring* (Batch 11), but **no actual tolerance-stack solver** — 1D/2D/3D, worst-case + RSS + Monte-Carlo in one place, consuming the semantic GD&T + DRF + MMC/LMC bonus, identifying the critical-path contributors, and (the differentiator engineers get wrong) **warning when RSS is invalid because the mechanism is non-linear.** This is a named, missing engine, not corpus knowledge.

### N3 — Geometric GD&T / FCF evaluator (validate part vs tolerance zone) (P0, kernel/sim)
`comm_mfg_cnc` §2.2 + `comm_pro_forums` §2.1 + memory both flag it explicitly: kernel **binds PMI/tolerance but has NO geometric FCF evaluator.** Authoring semantic FCFs (Batch 11) is *writing* the tolerance; this is *checking* it — verify a feature control frame is legal (datums exist, ordered, callout matches feature type), compute MMC/LMC bonus geometrically, and verify a measured/sampled point set against the tolerance zone (pass/fail). Closes the CADGenBench interface axis from the *validation* side and is the bridge to QIF inspection.

### N4 — Auto-2D-drawing generation from the model/PMI (P0, uiux/model)
The #3 pain, universally hated and universally unautomated (`comm_cad_tools` §3.2, `comm_core_me` §3.3, `comm_mfg_cnc` §3.7, `comm_pro_forums` §1.1, `communities.md` A5). The UI program builds the *interactive viewport/sketch/tree*; the kernel has *HLR* (Batch 10) as a primitive. But **no program builds the auto-drawing pipeline**: place standard views + sections + details, auto-dimension, auto-balloon a BOM, place GD&T from the model's semantic PMI, propagate config changes to the drawing, emit a Y14.5-conformant sheet. This is the highest-ROI Archie computer-use target and the thing that makes MBD adoption free (model → drawing for nothing). HLR is the primitive; the drawing engine is the new work.

### N5 — Simulation credibility report + VVUQ governance layer (P0, sim)
The emotional core of `comm_sim_cae` (§3.2, §5) and `comm_pro_forums` (§2.5) — NAFEMS VVUQ / ASME V&V is now a governance movement. Pillar B has the *solver ops*; this is the **credibility wrapper every run emits by default**: singularity detection (re-entrant corners / point loads / point BCs), guided mesh-convergence study that distinguishes converging from singular quantities, y+/wall-treatment coupling check, energy-ratio monitors (hourglass/artificial %, KE/IE for explicit, contact-stabilization %), a red/amber/green fit-for-purpose verdict with reasons, and auto-cross-check against an analytical/benchmark referent. "Easy to run, hard to run wrong." Resolves the democratization-vs-governance tension. Not in any program today.

### N6 — ML surrogate / ROM layer over Forge's own validated solver (P1, sim/research)
`comm_sim_cae` §1.4, `comm_additive_adv` §1.3, `comm_ai_eng` §2.4 — surrogates are now a first-class expectation ("100k sims a day," ~2700×), and the community's own demand is **error bounds**. Forge's unfair advantage: it owns the validated ground-truth solver to train against. "Train a surrogate from my parameter sweep → real-time response surface with a quantified confidence band" is a named, shippable feature. The corpus has none of this; it is an engine + workflow, not training data.

### N7 — CAD→robot-description export pipeline (URDF/SDF/USD/MJCF) (P1, interop)
The most concrete, most actionable robotics finding (`comm_robotics_auto` §2.1) — flagship exporters "dead for 4 years," dirty output, wrong inertia, no separate collision mesh, no closed chains. Batch 11 covers MCAD interop (STEP/Parasolid/JT) and Batch 7 computes inertia, but **no program emits robot-description formats** with kernel-computed inertia tensors/COM, auto convex-decomposition for collision geometry separate from visual mesh, joint types/limits, and closed-chain handling. A maintained, kernel-accurate exporter nobody else owns — slots Forge into the Gazebo/Isaac/MuJoCo sim-to-real pipeline as the authoritative twin.

### N8 — ECAD↔MCAD bidirectional bridge + 3D wiring-harness/cable routing (P2, interop/model)
`comm_robotics_auto` §2.3 + §2.7 — a concrete, well-defined seam (Altium/Zuken/SW-Electrical): bundle-fidelity loss, manual wire-length estimation, signal-vs-power clearance. The corpus mentions `forge.bim`/mechatronics fields but **no harness-routing engine**: routable conductor/bundle entities on the mechanical model, connector placement tied to geometry, netlist import, bidirectional wire-length feedback, and signal/power keep-out clearance checks. Distinct from PMI and from MCAD interop.

### N9 — AM build-process simulation + automated distortion/shrink pre-compensation (P1, sim/manufacturing)
`comm_additive_adv` §1.2 + §2.1 — moving from nice-to-have to production gate. Pillar C carries DfAM *rules*; Batch 10 builds *lattices*. But **no build-process solver**: inherent-strain/thermo-mechanical LPBF residual-stress + warp predictor, binder-jet sinter-shrink solver, and the killer **automated geometric pre-compensation** (morph the CAD so the as-built/as-sintered shape hits nominal) round-tripped back into parametric geometry. Knowing the rule ≠ simulating the build.

### N10 — Composites / laminate workbench with draping simulation + versioned allowables (P2, sim/manufacturing)
`comm_additive_adv` §2.4 — large, sticky, underserved; FiberSim/Ansys-ACP/Digimat territory; "every change = new layup schedule + new allowables." Nothing in the program builds a ply-layup definition, a draping simulation (fiber rotation/wrinkling on curved tools), element-by-element orthotropic FEA orientation, or a versioned layup-schedule/allowables manager. A distinct workbench.

### N11 — Process-aware anisotropic material database with scatter/uncertainty (P2, infra/sim)
`comm_additive_adv` §3.2 ("the allowables crisis") — AM/composite properties are process- and orientation-dependent; engineers don't trust the single isotropic number CAD hands them. **No program builds a material DB keyed on (material, process, orientation, post-process) carrying uncertainty/scatter** (not a single E/σ), wired into orientation-aware FEA, with a "low data confidence → recommend coupon test" honesty flag. Pillar A uses material *properties as feeds* but assumes isotropic point values.

### N12 — CAM post-processor library + full-machine collision simulation + in-machine probing (P1, manufacturing)
`comm_mfg_cnc` §1.5, §2.5, §3.9 + `communities.md` C7 — the universal CAM sore spot: bad posts crash machines, Mastercam paywalls posts, in-CAM verification only checks tool-vs-part. The corpus has `forge.capp.plan`/G-code answer-keys, but **no productized post-processor system** (verified, transparent, editable, per-controller: Fanuc/Haas/Siemens/Heidenhain/Mazak), **full-machine collision simulation** (tool+holder+spindle+fixture+table, 5-axis over-travel/rotary-limit/singularity), or **on-machine probing routine generation** tied back to the GD&T zones (N3). The free, uncrippled CAM wedge.

### N13 — Part-retrieval + dedup + find-and-adapt-existing (P1, plm/model)
`comm_ai_eng` §3.4 — the 80/20 reality check: "80% of engineering work isn't starting from scratch"; engineers spend 30-40% of design time on retrieval; 40k-part vaults carry 8-12k duplicates. Generative-only competitors ignore this. **No program builds geometry-based part search, duplicate detection, or retrieve-then-parametrically-edit** — yet it's where every honest 2026 review says the *measurable* time-savings live, and it pairs perfectly with the existing CADGenBench "edit STEP" skill. A retrieval engine, not a generator.

### N14 — Design-rationale / knowledge capture bound to the feature tree (P2, plm/model)
`comm_pro_forums` §3.4 — "one of the most underserved capabilities in current PLM is preservation of design rationale across generations." When a senior leaves, the "why" walks out. Archie is uniquely positioned to **auto-capture intent as it builds** — every operation records the driving requirement/constraint/rejected-alternative, queryable later ("why is this wall 4mm?"). The corpus references SysML/requirements *fields*; this is the in-model rationale store + capture + query, a genuine differentiator no incumbent does well.

### N15 — LOTAR / AP242 long-term-archival export with validation properties (P2, interop/plm)
`comm_pro_forums` §2.6 — the 50-year problem; aerospace/defense gate. Batch 11 reads/writes AP242, but **archival is a distinct deliverable**: AP242 container with PMI + product structure + *validation properties* (so the archive is provably faithful), aligned to LOTAR (EN/NAS 9300) / OAIS / ISO 14721, with a retention-aware audit trail. Without it Forge is locked out of regulated industries. Round-trip ≠ certified archival.

### N16 — Local-first version control: branch / merge / change-diff / where-used / impact (P1, plm/infra)
`comm_pro_forums` §3.3 + `comm_cad_tools` §3.5 + `comm_robotics_auto` (PLC binary-blob lesson) — the data-chaos pain: lock-blocked parallel work, no change-diff, manual merge, "working on the wrong version," and Onshape's *admired* git-like branch/merge that desktop tools lack. The program has *kernel rollback/marks/partitions* (Batch 8, single-user history) and a JSON-vault PDM seed, but **no multi-version branch/merge/diff/where-used/impact-analysis** that gives a small shop git-for-CAD governance without Windchill. Single-user undo ≠ multi-version collaboration.

### N17 — Dynamic-assembly / mechanism benchmark axis + generator (P1, benchmark/research)
`comm_ai_eng` §2.3 (AADvark: "no existing system can build a piston, a pendulum, or even scissors") + the standing user directive to add dynamic structures. CADGenBench scores *static* geometry on 4 axes. Forge's latent advantage is the validated HHT-α multibody solver, but **no benchmark axis measures mechanism correctness** (joints, DOF, kinematic chains, motion-range, no-interference-through-cycle). A new geometry-truth axis + fixture generator that makes "Archie builds working mechanisms" measurable — the frontier's biggest stated gap turned into a scored capability.

### N18 — Differentiable / point-supervised surface fitting (reference-image/scan → parametric) (P2, kernel/research)
`comm_ai_eng` §2.1 + §2.5 (DreamCAD rational-Bézier differentiable tessellation; NURBGen) + Forge's own "blockout-fidelity ceiling" memory. The kernel has NURBS/deformable modeling (Batch 8 `native::deform`), but **no differentiable/point-supervised mode** to fit geometry to a reference image, scan, or point cloud — the research path past blockout fidelity toward reference-matching detail. Distinct from the load-constraint deform solve already scoped.

---

## 6. Why these 18 and not more

Excluded as already-covered (per §4): toponaming, AP242/Parasolid healing, semantic-PMI authoring, feature-recognition STEP-edit, the DFM rule corpus, implicit/lattice modeling, FEA/CFD/MBD ops, clash/interference, enterprise UI, CADGenBench all-axes, the 14B corpus, local-first positioning, dynamic-structures-in-corpus.

Excluded as out-of-scope-for-a-CAD-tool: ROS 2 runtime/DDS, PLC code-gen, MPC/RL control theory, EMC/grounding tribal knowledge (kept only as the clearance-check seam inside N8), VLA model research, world-models. These are *context* (why digital-twin/robotics matters) but Forge is not a robot runtime or a controls IDE — the actionable slice is the **export/interop seam** (N7, N8), per the clusters' own "be the brand-neutral layer" conclusion.

The 18 are deliberately the *productized engine/workbench/benchmark/interop* deliverables that the existing kernel-parity + corpus + UI + CADGenBench programs do not themselves produce, each traceable to a high-frequency cross-cluster pain.

---

## 7. Sources

All inline citations live in the eight `comm_*.md` cluster files and `communities.md` (Reddit threads via DuckDuckGo/Bing snippets; Eng-Tips, GrabCAD, Practical Machinist, CFD-Online, Onshape/PTC/SolidWorks/McNeel forums; NAFEMS/ASSESS/LOTAR; arXiv AI-for-CAD/CFD corpus; vendor/educator blogs; 2026 trade press). This synthesis adds no new external sources; it consolidates and dedups against `programs/{cadgenbench,kernel_parity,archie_corpus,uiux}_program.md` and `00_MISSION_BIBLE_V2.md`.
