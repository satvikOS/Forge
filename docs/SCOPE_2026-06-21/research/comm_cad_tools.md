# Community Research — CAD Tool Communities (tool-specific gripes + wishlists)

**Cluster:** r/CAD, r/SolidWorks, r/cad, r/NX, r/Creo, r/CATIA, r/FreeCAD, r/Onshape, r/Fusion360, r/AutoCAD, r/Rhino3D, r/blender (CAD-adjacent), r/3DModeling + SolidWorks/PTC/Siemens user forums + the Onshape forum.
**Date:** 2026-06-21
**Method note:** Reddit's www/old domains are blocked to plain fetch in this environment, so findings are triangulated via WebSearch result summaries (which surface Reddit content), the Onshape/PTC/SolidWorks/McNeel official forums (directly fetchable or summarized), CAD review aggregators (G2, Capterra, Gartner), the Ondsel/FreeCAD blogs, Hacker News, and CAD-comparison long-reads. Sources cited inline and listed at the end.

---

## 0. TL;DR for Forge/Archie

The single biggest cross-tool truth in these communities: **history-based parametric CAD breaks, and the breakage is the #1 thing that makes engineers rage-quit and switch tools.** The breakage has three named villains — (1) the **topological naming problem** (references die when geometry recomputes), (2) **rebuild/regeneration time** on large assemblies, and (3) **STEP/import "dumb solid" hell** (you get geometry with no editable history). Underneath those, the second universal pain is that **drawing/detailing/GD&T is tedious, manual, and under-automated** — everyone wishes it were faster, and nobody has nailed automation. Third, **cloud-vs-desktop and subscription/licensing rage** is reshaping who switches where. Forge's in-house C++20 kernel + Archie's computer-use are best positioned to win on exactly these axes: **a topologically-stable reference system, fast large-assembly handling, automated drawing/GD&T generation, and a model that re-derives editable feature trees from dumb imported STEP.**

---

## 1. HOT / TRENDING TOPICS RIGHT NOW

### 1.1 FreeCAD 1.0 and the "toponaming is finally fixed" moment
This is the loudest single story in the open-source CAD community over the last ~18 months. FreeCAD 1.0 shipped the topological-naming-problem (TNP) mitigation (mainlining RealThunder's "Linkstage 3" algorithm), and the community framing is "the decade-long curse is broken; FreeCAD is now a credible free alternative to SolidWorks/Inventor for a wide range of work" (Ondsel, Libre Arts, FreeCAD News). **But the caveat is huge and trending in the bug tracker:** TNP mitigation "helps only for a specific kind of model breakage — models can still break for reasons that have nothing to do with topological naming," and there are open regressions (e.g., FreeCAD issue #17041 "face/edge IDs change after recompute"). Commenters also note "mainline v1.1 is still not able to work with big models" (Hacker News thread 47097446). 
- **Forge capability:** This is the validating signal that a *genuinely* stable reference system is a category-defining feature — not a checkbox. Forge should make "edits never orphan downstream references, even on big models" a headline guarantee and prove it on a large-assembly benchmark.

### 1.2 Subscription / licensing rage and tool migration churn
Across r/SolidWorks, r/AutoCAD, r/Fusion360 the hottest recurring emotional thread is cost. SolidWorks: "recent changes to their subscription model make it feel even more expensive and less customer-friendly," small teams "reconsider each year if they can stick with it" (Capterra, SoftwareReviews). AutoCAD: LT ~$720 without updates, full subscription ~$250/yr that "over five years totals $1,250+ with nothing to show if you stop" — driving active hunts for BricsCAD/LibreCAD/QCAD/FreeCAD alternatives (SmartCAD Reddit roundup). NX: "licensing and purchasing options are simply nightmarish… at least 4× more than SW per seat" (joshflowers comparison, Quora).
- **Forge capability:** Pricing/licensing model is a go-to-market wedge, not a kernel feature — but the corollary for Forge is *no recurring lock-in friction, no per-seat license-server nightmare, offline-capable.*

### 1.3 Cloud-only backlash (Fusion 360 and Onshape)
Fusion's move to make several simulation study types **cloud-solve-only** (linear static, modal, thermal) provoked a large Autodesk-forum revolt, and "excessive cloud dependency — if you want to work offline you're stuck" is a top G2/Capterra con. Onshape is cloud-*only* with "no offline capability" and "browser timeouts every 15–20 minutes" cited by switchers (joshflowers). The trend: engineers want collaboration *and* local control.
- **Forge capability:** Local-first/offline-capable with optional collaboration is a real differentiator. Don't force the cloud.

### 1.4 Text-to-CAD / AI-generates-geometry skepticism vs. excitement
"Text2CAD promises a sentence → a fully parametric part, but that dream is only partially real" — community consensus is AI is real for *boring repetitive* work (PDF→DWG, dimension strings, standard symbol/detailing, cookie-cutter parts) but *not* for design judgment, multi-discipline coordination, or catching quality issues (caddrafter analysis; Werk24 doing AI GD&T/PMI extraction). Named players engineers discuss: Zoo/Text-to-CAD, AdamCAD, Werk24.
- **Forge/Archie capability:** This is exactly Archie's lane — *drive the boring/repetitive CAD work via computer-use, leave judgment to the engineer.* The skepticism tells us to lead with reliability on well-specified ops (the very ops Mecado/CADGenBench score), not over-promise "describe a product, get a finished design."

### 1.5 "Which CAD should I learn/switch to" is the perennial top post
r/CAD / r/SolidWorks / r/Fusion360 are saturated with comparison/migration threads. The dominant verdict pattern (joshflowers, GoEngineer): SolidWorks = mid-tier parametric workhorse but fragile tree + struggles at scale; NX = world-class surfacing/direct modeling but nightmarish licensing + clunky drawings; Onshape = best collaboration/sharing + good drawings but cloud-only + can't do super-complex assemblies; Fusion = best price/accessibility + bundled CAM/sim but cloud-leaning + "specialized manufacturing features not as robust."

---

## 2. HARD TECHNOLOGIES — the technically-deep stuff engineers are excited about OR struggling with

### 2.1 Topological naming / persistent reference identity (the deep one)
The clearest technical articulation comes from the HN/FreeCAD discussion: "When you have a box and assign ID face_007 to its top face, that works fine until you fillet an adjacent edge. Now the kernel recomputes geometry and face_007 might split into multiple faces, be destroyed completely, or persist in a different shape… the geometric kernel computes an entirely new B-rep from scratch rather than editing existing faces." Commercial tools (SW, Fusion, Onshape) "have better heuristics that break down only in much more complex models than FreeCAD." FreeCAD's mitigation "tends to create names of ever-increasing length as you continue building." Solvespace is "fairly robust for cases it handles." 
- **The pro-user workaround engineers describe:** build "intermediary planes for all distances and extrude always with respect to those" rather than referencing model faces/edges directly — i.e., reference robust datums, never transient topology.
- **Forge capability (HIGH PRIORITY):** A reference system that survives recompute is the deepest moat available. Options: stable per-entity IDs propagated through every kernel op (split→children inherit + tag, merge→union tag), datum-first reference resolution, and a "reference healer" that re-binds orphaned references by geometric proximity/feature-history match. This is the #1 thing that would make an engineer switch.

### 2.2 Direct modeling + history-free editing of imported geometry
NX is *revered* for direct modeling: "SolidWorks has a small number of direct modeling tools, NX has dozens, each dizzyingly powerful… direct modeling, surfacing and direct object selection puts NX on another plane." The deep struggle is bridging *history-based* and *history-free*: imported STEP arrives as a "dumb solid — visible geometry, no feature history, no ability to go back and edit; a block of geometry suspended in space," and "modeling operations fail even for simple sketches and extrudes." Repair workflows are brutal: import diagnostics → delete bad faces → re-surface → knit; or "export to IGES/STEP and reimport until auto-repair fixes it" (SolidWorks blogs/forums).
- **Forge capability:** (a) A strong direct-modeling toolset (push/pull faces, move-face, delete-face-and-heal, replace-face) on imported B-reps; (b) **feature recognition that re-derives an editable history tree from dumb STEP** (holes, fillets, extrudes, patterns) — this is a killer Archie+kernel combo; (c) robust import healing (gap stitching, tolerance reconciliation, unit/precision normalization).

### 2.3 Large-assembly performance & rebuild/regeneration architecture
Concrete numbers from the communities: Onshape "really slow at ~11k instances," "performance unpredictable"; SolidWorks large assemblies "slow down workflow, erratic behavior, crashes"; pro mitigations are all about *not recomputing everything* — "pause regeneration," "suppress slow features (threads, textures, interior geometry) into a lightweight config," "move longer-regenerating features to the end of the feature list," lightweight/SpeedPak-style modes. Creo "regeneration failures from broken parent-child relationships, missing/invalid references, bad geometry." Configurations bloat files ("each config stores how it differs; more configs = bigger file") and daisy-chained derived parts "have performance consequences."
- **Forge capability:** (a) Incremental/dependency-graph recompute (only re-evaluate the dirty subtree); (b) native lightweight/graphics-only representations + on-demand resolve; (c) instancing-first large assemblies (Forge already does organized instancing for the GE9X flagship — that's directly relevant); (d) parallelized regeneration; (e) a config/variant system that doesn't bloat or daisy-chain badly.

### 2.4 Constraint/mate solving and sketch DOF robustness
Mate failures and regeneration failures both trace to fragile references: "rebuild failures rarely start at the failure feature — the first crack sits in a sketch anchor, a reference picked for convenience, or a finish face acting as a parent" (IDC/robust-modeling). Over-constraining "leads to rigidity and reduced flexibility." This is the assembly-side twin of TNP.
- **Forge capability:** A robust geometric constraint solver (Forge uses PLANEGCS-class solving) plus *diagnostic* tooling that points to the *root* broken reference, not just the symptom feature — and an auto-suggest "re-pick this reference to a stable datum."

### 2.5 GD&T / PMI / MBD as machine-readable data
Werk24 (AI extraction of GD&T/PMI/tolerances/threads from drawings) signals demand for *structured* tolerancing data, not just annotations. SolidWorks MBD and the model-based-definition push are mentioned as a SW advantage Onshape "lacks entirely." Note from memory context: Forge's kernel "has PMI/tolerance/interference bound-not-bridged; NO geometric FCF evaluator."
- **Forge capability:** First-class semantic GD&T (FCFs that *mean* something geometrically and can be validated/measured against the model), MBD authoring, and machine-readable PMI export — a genuine gap vs. SW and an Archie automation target.

### 2.6 Surfacing / class-A / NURBS vs. solids divide
NX, CATIA, Rhino dominate organic/class-A surfacing; the recurring community advice is "people jump into surface modeling when solid sweeps/lofts would be more robust in fewer steps." Rhino's pain is the *opposite* of SW's: NURBS freedom but *no parametric history* (Grasshopper bolts on parametrics but it's a separate paradigm).
- **Forge capability:** Unified solid+surface (Forge's kernel already targets OCCT+Manifold+CGAL+libfive+PicoGK breadth) with history that spans both — the thing Rhino lacks and SW does weakly.

---

## 3. PAIN POINTS / UNMET NEEDS / TOOL GRIPES — what makes them rage-quit

Ranked by frequency/heat across the communities:

### 3.1 The model breaks when you edit it (TNP + rebuild errors)
The universal rage-quit. Feature-tree fragility "requires constant management"; one edit cascades into a wall of red error flags; "learning the hard way about instability." This drove FreeCAD users to migrate to Onshape entirely *before* 1.0. **This is the #1 pain in the entire cluster.**
- **Forge:** stable references + root-cause-diagnostic rebuilds + reference healer (see §2.1).

### 3.2 Drawings & detailing are slow, manual, and unloved
"Onshape is known to have trouble with drawings"; NX drawings are a "frustratingly complicated process"; SW drawings "capable but cumbersome." Onshape "does not auto-create 2D drawings from 3D — you manually create drawings, add views, add dimensions," and config changes "don't propagate to drawings — you change the config of every part in the drawing individually." Detailing/GD&T/dimension strings are precisely the "boring repetitive" work the community wants automated.
- **Forge/Archie:** **Auto-drawing generation** (views, sections, dims, BOM, balloons, GD&T from model/PMI) is one of the highest-ROI Archie computer-use targets — directly attacks the most-hated workflow.

### 3.3 STEP/import "dumb solid" hell
Imported geometry has no history, ops fail on it, and repair is a multi-step surfacing slog with hacky reimport loops. Cross-tool interoperability is a chronic tax.
- **Forge:** feature-recognition rebuild + robust healing + strong direct modeling (see §2.2).

### 3.4 Large-assembly slowness, crashes, and waiting on rebuilds
Slow check-ins, long rebuilds, crashes on big models, unpredictable cloud performance. SolidWorks "crashes very often"; large assemblies "tax workstation/server." Engineers spend real time on suppress/lightweight/pause-regen rituals just to keep working.
- **Forge:** incremental recompute + lightweight reps + instancing (see §2.3).

### 3.5 PDM / file-reference / data-management pain
SolidWorks PDM: "check-in 5+ min for parts, 20+ min for assemblies" after migration; "0 efficiency, only cloud problems" on 3DEXPERIENCE; broken file references; version-compatibility ("older versions can't open newer files") blocks collaboration. Fusion/Onshape PDM is mandatory + cloud-only, "native files cannot be retrieved offline."
- **Forge:** fast, reference-integrity-preserving data management; no forced-cloud; forward/backward file compatibility as a design principle (Forge memory notes a JSON vault for PDM — relevant).

### 3.6 Cloud dependency / offline / data-ownership anxiety
"If you want to work offline you're stuck"; cloud-only sim; account/sign-in required; data-loss fear. A real switching driver.
- **Forge:** local-first, offline-capable, you-own-your-files.

### 3.7 Cost / subscription / licensing
Covered in §1.2 — but as a *pain*: it's the thing that makes people *leave* even when the tool works (small teams priced out of SW; NX licensing "nightmarish"; AutoCAD "nothing to show if you stop"). Drives the BricsCAD/FreeCAD alternative hunt.

### 3.8 Outdated/clunky UI on the high-end tools
NX/Creo "outdated codebase → frustrations in sketching, template creation, file export"; Creo upgrades silently change default behavior so "models created in Creo 4 don't regenerate identically in Creo 7" and PTC says "functions to spec." The high-capability tools are the worst UX.
- **Forge/Archie:** modern UX + Archie smoothing the tedious paths is a wedge against the capable-but-painful incumbents (NX/Creo/CATIA).

### 3.9 Simulation locked behind cloud / weak built-ins
Fusion forced sim study types to cloud-solve-only; Onshape FEA is "basic with geometric restrictions." Engineers want capable, *local*, integrated sim.
- **Forge:** Forge already has an MIT-PhD-validated in-house solver (static/modal/CFD/multibody per memory) — local, integrated sim is a genuine strength to lean into.

---

## 4. EMERGING METHODS + WHICH TOOLS/STANDARDS DOMINATE

### 4.1 Dominance map (what the community actually uses)
- **SolidWorks** — the mid-market default / "lingua franca" of mechanical design; fragile tree, struggles at scale, desktop-only, pricey-and-getting-pricier.
- **Siemens NX** — high-end aero/auto; best direct modeling + surfacing; brutal licensing/cost; clunky drawings.
- **PTC Creo** — high-end, strong parametric/relations; outdated UI; regeneration-failure-prone across versions.
- **CATIA** — aero/auto class-A surfacing + huge assemblies; heavy, expensive, complex.
- **Onshape** — cloud-native collaboration leader; great sharing/versioning + decent drawings; cloud-only, weak on huge assemblies/complex parts, no sheet-metal/electrical/routing.
- **Fusion 360** — accessibility/price/CAM+sim bundle leader for SMB/makers/students; cloud-leaning, free-tier shrinking, specialized features thinner.
- **FreeCAD 1.0** — the credible free option post-TNP-fix; gaps in generative/organic surfacing + cloud collaboration; TechDraw HLR still being rewritten.
- **AutoCAD** — 2D drafting incumbent under pressure from BricsCAD/LibreCAD/QCAD on price.
- **Rhino + Grasshopper** — NURBS/organic + algorithmic/parametric design (arch/product/jewelry); no native history.
- **Blender (CAD-adjacent) / r/3DModeling** — viz/organic, CAD-adjacent precision via add-ons (CAD Sketcher etc.); precision + units + boolean robustness are the gripes.

### 4.2 Emerging methods engineers are adopting
- **Resilient/robust modeling discipline** (datum-first references, master-model/skeleton top-down design, descriptive named params, avoid over-constraining, prefer robust solids over surfaces). This is the "pro move" beginners don't do — see §5.
- **Master-model / skeleton / top-down design** to control design intent across multi-designer assemblies (the non-solid reference part disseminates intent).
- **Model-Based Definition (MBD) / PMI** replacing 2D drawings as the authoritative deliverable — and **AI extraction of GD&T/PMI** (Werk24) as machine-readable tolerance data.
- **Text-to-CAD / generative geometry** (Zoo, AdamCAD) — early, trusted only for well-specified simple parts; the rest is human judgment.
- **Cloud collaboration / branching-and-merging version control** (Onshape's model of CAD-as-Git) — admired even by people who won't go cloud-only.
- **Generative design / topology optimization** — Fusion/NX feature, increasingly expected.

### 4.3 Standards that matter
- **STEP (AP242)** is the interop lingua franca *and* the source of import pain; AP242 carries PMI/MBD — supporting it well (with PMI round-trip) is table stakes + differentiator.
- **GD&T per ASME Y14.5 / ISO GPS** — the tolerancing language; a *geometric* FCF evaluator (validate tolerances against the model) is an unmet need.
- **IGES** (legacy surfaces), **DXF/DWG** (2D), **Parasolid/ACIS** (kernel exchange) round out interop expectations.

---

## 5. WHAT "PRO" USERS DO THAT BEGINNERS DON'T (and what would make them switch)

**Pro habits (the design-intent / robustness playbook):**
- Reference **stable datums** (planes/axes/origin), never transient model faces/edges — to survive TNP.
- Use **master-model / skeleton / top-down** structure to propagate intent across assemblies.
- Name features/params **meaningfully**; capture functional requirements as relations.
- **Don't over-constrain**; leave intended degrees of freedom.
- Keep feature order recompute-friendly; push slow features late; use lightweight/suppressed configs while working.
- Prefer robust **solid** sweeps/lofts over fragile surfacing when possible.
- Diagnose rebuild errors at the **root reference**, not the red feature.

**What would make a pro switch to a new CAD tool (the Forge thesis):**
1. **References that never break on edit** — even on large models (beats everyone, especially FreeCAD; matches/exceeds SW/NX heuristics).
2. **Fast, incremental large-assembly handling** — no suppress/pause-regen rituals.
3. **Automated drawings + GD&T/MBD** from the model — kills the most-hated workflow (Archie's lane).
4. **Imported STEP becomes editable** — feature-recognition rebuild + strong direct modeling.
5. **Local-first, offline, no licensing/subscription nightmare, files you own** — the migration accelerant.
6. **Modern UX over capable-but-painful incumbents** (NX/Creo/CATIA), with Archie automating the tedium.

These six are precisely where an in-house kernel (Forge) + a computer-use agent (Archie) can out-position both the fragile-but-friendly SMB tools (SW/Fusion/Onshape) and the powerful-but-painful enterprise tools (NX/Creo/CATIA).

---

## Sources
- Hacker News — "Topological Naming Problem" discussion: https://news.ycombinator.com/item?id=47097446
- Ondsel — "FreeCAD's topological naming problem is (officially) history": https://www.ondsel.com/blog/toponaming-problem-is-history/
- Ondsel — "Don't hold your breath for FreeCAD's topological naming fix": https://www.ondsel.com/blog/freecad-topological-naming/
- FreeCAD docs — Topological naming problem: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_naming_problem.md
- FreeCAD issue #17041 — face/edge IDs change after recompute (regression): https://github.com/FreeCAD/FreeCAD/issues/17041
- FreeCAD issue #8432 — user models break when topological entities change name: https://github.com/FreeCAD/FreeCAD/issues/8432
- Libre Arts — "FreeCAD 1.0: new features and the larger picture": https://librearts.org/2024/11/freecad-1-0/
- FreeCAD News — TechDraw getting-started tutorial (HLR limitations): https://blog.freecad.org/2025/10/10/tutorial-getting-started-with-techdraw/
- GoEngineer — "Onshape vs. SOLIDWORKS: The Complete Story": https://www.goengineer.com/blog/onshape-vs-solidworks-the-complete-story
- joshflowers.xyz — "Fusion 360 vs SolidWorks vs Siemens NX vs Onshape — Best CAD Review 2025": https://www.joshflowers.xyz/blog/solidworks-vs-siemens-nx-vs-onshape-vs-fusion360
- Onshape forum — Large Assembly Management: https://forum.onshape.com/discussion/17935/large-assembly-management
- Onshape forum — SolidWorks user considering Onshape (large assemblies): https://forum.onshape.com/discussion/15820/
- Onshape forum — drawing auto-update after config changes: https://forum.onshape.com/discussion/15979/
- Onshape help — Performance Considerations (config/derived-part perf): https://cad.onshape.com/help/Content/Home/performance_considerations.htm
- Capterra — SolidWorks Premium reviews (cons): https://www.capterra.com/p/93121/SolidWorks-Premium/reviews/
- SoftwareReviews — SolidWorks customer reviews 2026: https://www.softwarereviews.com/products/solidworks?c_id=70
- Hawk Ridge Systems — SOLIDWORKS 2025/2026 crash-on-launch (WebView2): https://support.hawkridgesys.com/hc/en-us/articles/44396298148877
- G2 — Autodesk Fusion pros/cons: https://www.g2.com/products/autodesk-fusion/reviews?qs=pros-and-cons
- Capterra — Autodesk Fusion reviews: https://www.capterra.com/p/178416/Fusion-360/reviews/
- Autodesk Community — Fusion cloud-only simulation solving thread: https://forums.autodesk.com/t5/fusion-support-forum/fusion-360-cloud-solving-will-be-the-only-option-available-for/td-p/11342929
- PTC Community — Regeneration issues / unexpected feature failures: https://community.ptc.com/t5/3D-Part-Assembly-Design/Regeneration-Issues-Unexpected-Feature-Failures/td-p/764462
- PTC support — About Regeneration Failures: https://support.ptc.com/help/creo/creo_pma/r11.0/usascii/part_modeling/part_modeling/About_Regeneration_Failures.html
- SolidWorks blog — Healing/repairing imported geometry: https://blogs.solidworks.com/tech/2015/12/repair-imported-geometry.html
- Solid Solutions — Repair & edit imported geometry in SOLIDWORKS: https://www.solidsolutions.co.uk/blog/2023/11/surface-modelling-tips-how-to-repair-edit-imported-geometry-in-SOLIDWORKS/
- CAD Forum / CADmunity — Very slow PDM file check-in: https://www.cadforum.net/viewtopic.php?t=608
- SmartCAD — "Best Budget AutoCAD Alternative 2026 — Reddit's Top Picks": https://www.smartcadsoft.com/budget-autocad-alternative-reddit/
- McNeel forum — Parametric design in Rhino/Grasshopper: https://discourse.mcneel.com/t/parametric-design-in-rhino/211464
- Werk24 — AI GD&T/PMI extraction from technical drawings: https://werk24.io/
- caddrafter.us — "Will AI Replace CAD Drafters in 2026?" (text-to-CAD reality check): https://caddrafter.us/will-ai-replace-cad-drafters-in-2026/
- IDC — "How robust are your SolidWorks CAD models?": https://www.idc.uk.com/news/2020-1/robust-solidworks-cad-models/
- M3 Design — Guide to top-down design / master model: https://www.m3design.com/guide-to-top-down-design/
- Engineers Rule — Configurations, what are they good for: https://www.engineersrule.com/configurations-what-are-they-good-for-heres-a-few-things/
