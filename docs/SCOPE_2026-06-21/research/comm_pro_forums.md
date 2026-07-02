# Community Research — PROFESSIONAL FORUMS / STANDARDS / DEEP PRACTITIONER

**Cluster:** Eng-Tips, GrabCAD, Physics Forums (engineering), ResearchGate/Quora engineering, LinkedIn engineering groups, NAFEMS, ASME/SAE community, GD&T forums (tec-ease), PLM/PDM practitioner blogs (engineering.com, develop3d, Lifecycle Insights).
**Date:** 2026-06-21
**Lens:** senior-practitioner concerns — standards/interoperability, MBD/PMI/digital thread, PLM/PDM reality, certification/compliance, "drawings are dead" debate, knowledge capture, simulation governance. The governing question: **what enterprise/standards/lifecycle capabilities separate a toy CAD from a tool real companies adopt?**

> Method note: Reddit-style fetch is JS-blocked and Eng-Tips returns HTTP 403 to plain fetch, so thread content is triangulated via WebSearch result-summaries of the actual Eng-Tips/GrabCAD/Onshape-forum/tec-ease threads plus practitioner-blog recaps (develop3d, engineering.com, capvidia, cadinterop, NAFEMS, LOTAR). Threads cited are real and surfaced by query; where only a summary was reachable that is noted. This is the most "Forge-defining" cluster: it is where the line between a demo and a tool a regulated company will actually buy gets drawn.

---

## 1. HOT / TRENDING TOPICS RIGHT NOW

### 1.1 "Drawings are dead / long live MBD" — the perennial flame war, now tipping
The single most recurring senior-practitioner debate. Eng-Tips threads run for years: *2D drawing nearly dead?*, *I Hate Drawings!!!*, *Are drawings needed anymore?*. The pro-MBD case (drawings take too long, MBE momentum, PMI is the single source of truth, aero/auto already advanced) vs. the entrenched reality: 2D survives because of **familiarity, not function** — machinists, inspectors, and shop-floor still demand a drawing, 3D is slower/costlier to author, and "the strongest MBD voices are vendors and consultants who are vested in selling it." Consensus landing zone for the next decade is **model + lightweight drawing/derivative**, not pure MBD. The debate is hot precisely because tooling has not made MBD *cheaper* than drawings yet.
- **Forge/Archie need:** First-class MBD authoring AND auto-derived 2D (drawing views, sections, BOM, balloons) from the same single source of truth — the model must produce a conformant drawing for free, so adopting MBD never costs the team its shop-floor drawing. Archie should be able to author semantic PMI by intent ("apply position tolerance Ø0.2 MMC to this hole pattern, datum A|B|C") and emit BOTH the annotated 3D and a Y14.5-correct drawing.

### 1.2 Generative/agentic AI landing inside the CAD kernel (and the trust gap)
2026 is the year every major CAD added AI: support copilots (Onshape AI Advisor, Siemens Design Copilot, Autodesk Assistant, Dassault Aura), **AI auto-drawings** (Solid Edge generating "up to 80% of drawing views with minimal input"; Fusion AI fastener classification + dimension placement; Solidworks/Onshape in beta), generative rendering, and Autodesk's **Neural CAD** foundation model generating *editable* CAD geometry from a text prompt. The senior-practitioner caveat the vendor press buries: outputs "currently require careful validation," and the biggest real win today is **finding existing proven parts**, not generating novel shapes. The deeper community theme (Develop3D Live 2026 keynote): the hard problem is no longer *generating digital output* — it is **"bits to atoms,"** whether AI output can be simulated, validated, manufactured, and *trusted*. This is the PoC-to-production gap restated for engineering.
- **Forge/Archie need:** This is exactly Forge's thesis — Archie must emit geometry that is *kernel-real, parametric, editable, and immediately validatable* (sim + GD&T + manufacturability), not a mesh blob. The differentiator vs. Neural-CAD-style tools is closing the "bits to atoms" loop: every Archie-generated body should be checkable against engineering truth (CADGenBench/ForgeCADScore) before a human trusts it.

### 1.3 Cloud PLM/SPDM migration + data-management-without-PLM
"70% of manufacturers expect to migrate at least one PLM module to cloud within two years (up from 52% in 2023)." Simultaneously, Eng-Tips threads like *Living without a PDM/PLM…* and *CAD data management without PLM* show the long tail of small/medium shops who **cannot afford or operate** Teamcenter/Windchill and are improvising with folders, naming conventions, and Vault-lite. The trend is a barbell: enterprises going cloud-SPDM, SMBs desperate for lightweight built-in data management.
- **Forge/Archie need:** Built-in, zero-admin PDM (versioning, check-in/out OR lock-free branching/merging, where-used, revision integrity, BOM with revision-level granularity) so a small shop gets governance without standing up Windchill. This is a concrete "toy vs. real tool" line.

### 1.4 Digital twin → virtual certification (NAFEMS / ASSESS theme for 2026)
Digital twins moving "from development models to living digital twins for **virtual certification**, remaining-useful-life prediction, and in-service management." Coupled with surrogate/reduced-order models and engineering-specific AI agents now "in production workflows." Simulation **democratization** (let design engineers run routine sims via natural-language/guided workflows "without sacrificing fidelity or governance") is the headline NAFEMS Americas 2026 topic.
- **Forge/Archie need:** Archie-as-simulation-democratizer is directly on-thesis — natural-language sim setup with governance guardrails. Plus surrogate/ROM support and a path toward credible virtual certification (traceable, validated solver results, not just pretty contour plots).

---

## 2. HARD TECHNOLOGIES — DEEP STUFF ENGINEERS ARE EXCITED ABOUT / STRUGGLING WITH

### 2.1 Semantic PMI vs. graphical PMI (the make-or-break technical detail of MBD)
The deepest, most underappreciated technical distinction. **Graphical PMI** = annotations a human can read on the model. **Semantic PMI** = a machine-readable data structure (identifiers, feature types, tolerance values, datum relations) software can *act on*. Only semantic PMI enables downstream automation: CNC, CMM inspection programming, automated tolerance analysis. Solidworks' own guidance: "Don't stop at graphical PMI." Three formats natively carry semantic PMI: **STEP AP242 Ed.2/3, QIF, and 3D PDF (PRC)**. Validation is a three-level problem: (a) **semantic integrity** (annotations correctly associated to geometry, references complete), (b) **standards conformance** (ASME Y14.41 / ISO 16792 symbology), (c) **functional consistency** (non-contradictory specs, coherent dimension chains). ASME's IDETC work on "Semantic Interoperability of GD&T through ISO 10303 AP242" is the academic frontier.
- **Forge/Archie need:** Forge must author *semantic* PMI tied to B-rep faces/edges, not painted annotations — and a built-in **PMI validator** (the three levels above). This is a defensible moat: most "AI CAD" tools cannot even represent semantic GD&T. Archie generating a feature control frame must attach it semantically to the toleranced feature with a valid datum reference frame.

### 2.2 STEP AP242 (Ed.2/Ed.3) + QIF + the as-designed/as-inspected pairing
AP242 ("Managed model-based 3D engineering," ISO 10303-242) is the dominant neutral exchange + MBD container. The frontier: pairing **AP242 (as-designed)** with **QIF 3.0 Ed.2 (as-inspected)** via ontologies/knowledge graphs to "close gaps in the digital thread." Practitioner reality from forums: people still ship AP203/AP214 and don't know if their export is even AP242 (Eng-Tips: *identifying and using AP242 STEP files*); CAD-side semantic-PMI export is **immature** (NX and CATIA V6 are the only ones really trusted for industrial-grade semantic export) while QIF support is **more mature on the CMM/metrology side** (Hexagon, Zeiss, Mitutoyo, InnovMetric). NIST's STEP File Analyzer + QIF survey are the conformance-checking references.
- **Forge/Archie need:** Best-in-class AP242 Ed.2 read/write *with semantic PMI preserved both directions* (most translators silently drop it), plus QIF 3.0 export for inspection. If Forge round-trips semantic PMR/PMI better than mid-tier MCAD, that alone wins regulated-industry pilots.

### 2.3 GD&T, datum reference frames, and tolerance stack-up (the eternal struggle)
tec-ease's tip library is essentially a catalogue of what engineers chronically get wrong: composite feature control frames (lower segment constrains only rotation), datum precedence chains (read L→R, sequential control), datums established from patterns of features, and — the big one — **tolerance stack-up where the DRF changes the effective stack path** because GD&T locational controls reference the DRF rather than chaining feature-to-feature. Choosing a DRF that mirrors how the part is *fixtured and assembled* is the core skill. Engineers want robustness decided "at the sketch phase" and need worst-case + statistical (RSS) stack analysis, including part-shift within assemblies under MMC.
- **Forge/Archie need:** A real tolerance-analysis engine (1D worst-case + RSS, ideally 3D variation/Monte-Carlo) that consumes the *semantic* GD&T, respects DRF/material-condition modifiers, and reports the contributing chain. Archie should advise datum selection from assembly/fixture intent. This is genuinely hard and a strong differentiator.

### 2.4 FEA credibility: mesh convergence, boundary conditions, singularities (V&V)
Physics Forums / Eng-Tips / FEA-blog corpus converges on a tight set of expert failure modes: **stress singularities** at sharp re-entrant corners and at points where a boundary condition abruptly ends (a split-line fixed constraint) → stress rises without bound and convergence *never* happens; **over-constrained BCs / artificially high contact stiffness** → false convergence; need **4–5 mesh refinements minimum** (2–3 is a classic mistake); aggressive refinement degrades element quality and can offset accuracy. Engineers want disciplined, auditable convergence studies and BCs that reflect reality.
- **Forge/Archie need:** Built-in convergence-study automation (auto-refine + report asymptote, flag non-convergence as a singularity rather than reporting a garbage peak stress), singularity detection at re-entrant geometry, and BC sanity-checks (over-constraint warnings). Archie running a sim must *report convergence status and credibility*, not just a number.

### 2.5 Simulation V&V / VVUQ governance (NAFEMS standards)
NAFEMS' Simulation Governance & Management Working Group + the 2025 *Guidelines for Validation of Engineering Simulations* (World Congress, Salzburg) make VVUQ — Verification, Validation & Uncertainty Quantification — the credibility backbone. Central challenge: scarcity of **high-quality validation experiments** as referents, forcing a "spectrum of validation approaches with varying rigour." As AI/ML enters simulation, **SPDM** (Simulation Process & Data Management) becomes critical for managing the massive train/validate datasets, with traceability.
- **Forge/Archie need:** Solver results carry provenance/UQ metadata (mesh, solver settings, version, convergence) so a result is *defensible* in an audit; an SPDM-lite store for sim runs; and — if Archie auto-runs sims — a governance layer that records what was validated against what. This is the credibility moat that separates a sim toy from a tool an engineer signs off on.

### 2.6 Long-Term Archival & Retrieval (LOTAR) — the 50-year problem
Aerospace/defense aircraft lifecycles reach 50 years while CAD formats/software die in a few. **LOTAR** (EN/NAS 9300-xxx series, built on OAIS / ISO 14721) standardizes archiving the full product definition — 3D model + PMI + product structure — in neutral form (**STEP AP242**) so it remains retrievable and trustworthy decades later, for certification/traceability. LOTAR's Q1-2026 workshop advanced 3D mechanical CAD, PLM, electrical wiring, and MBSE archival. EN 9300-210:2026 (Product Management Data) just landed.
- **Forge/Archie need:** AP242-based archival export with PMI + assembly structure + validation properties (so the archive is provably faithful), aligned to LOTAR/OAIS. Without this, Forge is locked out of aerospace/defense entirely.

---

## 3. PAIN POINTS / UNMET NEEDS / TOOL GRIPES (what makes them rage-quit)

### 3.1 Interoperability data-loss — the single biggest day-to-day rage trigger
The recurring nightmare across Eng-Tips (*IGES Geometry Repair*, *IGES & STEP translator set-up*) and GrabCAD: importing a STEP/IGES and getting **radii imported as splines, parallel faces at slight angles, lines as splines, surfaces that won't stitch, missing faces, exploded assemblies.** IGES is "a geometry lottery" because every vendor extended it differently. Feature history, materials, layers, colors, **and PMI are silently dropped** on export, breaking downstream manufacturing/inspection/PLM. Engineers spend hours stitching surfaces, closing gaps, removing slivers, rebuilding faces. Estimated 20–30% rework attributable to broken interop.
- **Forge/Archie need:** A *robust, native, lossless* STEP AP242 importer/exporter that preserves B-rep precision, semantic PMI, assembly structure, materials, and metadata — plus a **geometry healing/repair toolkit** (auto-stitch, gap-close, sliver-remove, face-rebuild) and an **import validation report** (what was lost/changed vs. source). "Imports cleanly when the competition mangles it" is a viscerally felt selling point.

### 3.2 PLM/PDM is slow, hostile, over-priced, and imposed top-down
Brutally consistent. Teamcenter: "very hard and awful to use," 45+ min to load large assemblies, requires full-time IT + a dedicated CAD-TC facilitator. Windchill: fast but "designed to be operated by a staff of SQL experts," prohibitive **named-user licensing even for view/print**, brutal for small shops. Universal gripe: **management picks the PLM without asking the actual users.** SMBs opt out entirely and drown in version chaos.
- **Forge/Archie need:** PDM/PLM that a normal engineer can operate with zero SQL/IT, fast on large assemblies, sane licensing, and lock-free collaboration. Built-in beats bolt-on. This is the clearest "real companies adopt vs. toy" axis.

### 3.3 Version/data chaos, corruption, and collaboration friction
From Onshape's own "120 CAD issues" + forum corpus: files lost/corrupted on hardware failure, parts that **no longer regenerate** on reopen, **corruption during the save itself**, "copies of out-of-date files everywhere," working on the wrong version, check-out **locks blocking parallel work**, no visibility into what changed on a check-in or whether a change affects you, manual merge of parallel copies, emailing zipped files with version ambiguity, IP leakage via suppliers, whole supply chain forced onto one software version. Assembly-specific: moving a part silently updates others; can't edit a part created in-context; sheet-metal parts that **can't unfold**.
- **Forge/Archie need:** Crash-safe/atomic save + autosave + recoverable history, deterministic regeneration (a model that opened must reopen), branch/merge (git-like) for parallel work without locks, visible change diffs + where-used + impact analysis, and robust sheet-metal (no unfoldable-flat-pattern failures). Reliability *is* a feature at this tier.

### 3.4 Engineering knowledge / design rationale evaporates
When a senior engineer leaves, the **"why" behind decisions** (constraints, trade-offs, alternatives rejected, failure history) walks out the door; the next engineer re-discovers the same constraint 6 months later at real cost. "One of the most underserved capabilities in current PLM is preservation of design rationale across generations." Data is fragmented across BOMs, CAD, compliance records, test results — untagged, inconsistent.
- **Forge/Archie need:** Capture design rationale *in the model/feature tree* (intent, constraints, alternatives, links to requirements/tests). Archie is uniquely positioned to *auto-capture* the why as it builds — every operation can record intent + cite the driving requirement, then answer "why is this wall 4mm?" with provenance. A genuine differentiator no incumbent does well.

### 3.5 Certification/compliance documentation burden (AS9100 / FAA / traceability)
AS9100 Clause 8.5.2: unique IDs + documented traceability from raw-material receipt → final delivery; primes demand **10–15 year** retention, flight-critical/life-limited **30–40 years**. Common audit finding: a procedure exists "for certification purposes" but **nobody actually uses it** — auditors catch the gap between written process and real practice. Configuration management, counterfeit-parts prevention, product safety are the usual weak spots.
- **Forge/Archie need:** Traceability baked in — every part/revision uniquely identified, full change/audit trail, requirements↔geometry↔inspection links (digital thread), retention-aware archival (ties to §2.6 LOTAR). Compliance shouldn't be a parallel manual documentation effort; the tool should *be* the evidence.

### 3.6 Generative/AI output you can't trust without re-validating everything
The "bits to atoms" gap, felt as pain: AI suggestions/geometry "require careful validation," generative rendering "isn't picture-perfect," and the honest value today is finding proven parts, not novel generation. Engineers won't ship un-validated AI geometry into a regulated product.
- **Forge/Archie need:** Make Archie output *self-validating* — geometry that ships with a sim/GD&T/manufacturability check and a confidence/provenance trail, so the human reviews a validated proposal, not a black-box mesh. Trust is the product.

---

## 4. EMERGING METHODS + DOMINANT TOOLS/STANDARDS

| Area | Dominant standard/tool | Emerging method | Forge/Archie implication |
|---|---|---|---|
| Neutral 3D + MBD exchange | **STEP AP242** (Ed.2/Ed.3); legacy AP203/214 still shipped; IGES dying but lingering | Semantic PMI in AP242; AP242↔QIF as-designed/as-inspected via ontologies/knowledge graphs | Lossless AP242 Ed.2 w/ semantic PMI both directions = table-stakes-plus moat |
| Quality / inspection | **QIF 3.0 Ed.2** (.qifb binary); CMM vendors Hexagon/Zeiss/Mitutoyo/InnovMetric | Model-based inspection; AI visual inspection driven by semantic QIF | QIF export for inspection; CAD-side semantic export (where most CAD is weak) |
| GD&T standards | **ASME Y14.5 / Y14.41**, **ISO 16792**, ISO GPS | Machine-actionable semantic GD&T; auto tolerance stack from DRF | Semantic FCFs on B-rep + real stack-up engine (worst-case + RSS + 3D) |
| Sim credibility | **NAFEMS VVUQ / Simulation Governance**; ASME V&V 10/20/40 | Simulation democratization w/ governance; surrogate/ROM; SPDM; living digital twins for **virtual certification** | Sim results with provenance/UQ; SPDM-lite; Archie-driven sim w/ guardrails |
| Long-term archival | **LOTAR (EN/NAS 9300-xxx)** on OAIS/ISO 14721; AP242 container | Archiving full def (3D+PMI+structure+validation props); MBSE/wiring archival | AP242 archival export, LOTAR-aligned, for aero/defense entry |
| PLM/PDM | **Teamcenter, Windchill** (enterprise); Aras, Arena, Autodesk; **cloud PLM** rising | Cloud-native SPDM; AI "Lifecycle Intelligence" backbone; design-rationale preservation | Built-in zero-admin PDM; rationale capture; cloud collaboration |
| AI in CAD | Onshape AI Advisor, Siemens Design Copilot, **Autodesk Neural CAD**, Dassault Aura, Leo AI | Text→editable CAD geometry; auto-drawings; agentic copilots | Archie = kernel-real, self-validating generation closing "bits→atoms" |
| Digital thread / MBSE | PTC/Siemens digital-thread backbones; **MBSE** maturing | Requirements↔CAD↔sim↔inspection↔service linkage | Thread links from requirement to geometry to inspection in Forge |

---

## 5. THE "TOY vs. REAL TOOL" CHECKLIST (synthesized — what separates adoptable from demo-ware)

A company adopts a CAD/CAE only when it clears these, in roughly this priority order:
1. **Lossless interoperability** — AP242 in/out preserving B-rep precision + semantic PMI + assembly + metadata; healing tools; import-validation report.
2. **Reliability** — atomic/crash-safe save, deterministic regeneration, recoverable history; large-assembly performance.
3. **Built-in data management** — versioning, revision-level BOM integrity, where-used, change/ECO workflow with audit trail, lock-free collaboration.
4. **Semantic MBD** — semantic (not graphical) PMI tied to geometry + a PMI validator (semantic integrity / standards conformance / functional consistency) + auto-derived conformant 2D drawings.
5. **Real tolerance analysis** — worst-case + statistical stack-up honoring DRF and material modifiers.
6. **Credible simulation** — convergence/singularity discipline, BC sanity checks, VVUQ-style provenance/UQ on every result.
7. **Compliance & archival** — unique IDs, full traceability/digital thread, retention-aware LOTAR/AP242 archival (AS9100/FAA-ready).
8. **Knowledge/rationale capture** — the "why" persists in the model and is queryable.
9. **Trustworthy AI** — generation that is editable, parametric, and self-validating, not a black box.

Forge/Archie's wedge: be **kernel-real + self-validating + standards-native** where the AI-CAD startups are mesh-blob-and-hope, and be **lightweight/built-in** where the incumbents (Teamcenter/Windchill) are heavy/hostile. The cluster's loudest unmet need is a tool that gives a *small or mid-size regulated shop* enterprise-grade interop, MBD, traceability, and sim-credibility **without** standing up a six-figure PLM and an IT team.

---

## Sources (threads/pages actually used)
- Eng-Tips: *identifying and using AP242 STEP files* — https://www.eng-tips.com/threads/identifying-and-using-ap242-step-files.527862/
- Eng-Tips: *MBD = Model Based Definition and MBE = Model Based Enterprise* — https://www.eng-tips.com/threads/mbd-model-based-definition-and-mbe-model-based-enterprise.486863/
- Eng-Tips: *2D drawing nearly dead?* — https://www.eng-tips.com/threads/2d-drawing-nearly-dead.282775/
- Eng-Tips: *I Hate Drawings!!!* — https://www.eng-tips.com/threads/i-hate-drawings.221206/
- Eng-Tips: *Are drawings needed anymore?* — https://www.eng-tips.com/threads/are-drawings-needed-anymore.184173/
- Eng-Tips: *Teamcenter vs Windchill* — https://www.eng-tips.com/threads/teamcenter-vs-windchill.550001/
- Eng-Tips: *Living without a PDM/PLM…* — https://www.eng-tips.com/threads/living-without-a-pdm-plm.547491/
- Eng-Tips: *Need Suggestions on CAD data management without PLM* — https://www.eng-tips.com/threads/need-suggestions-on-cad-data-management-without-plm.489348/
- Eng-Tips: *.IGES Geometry Repair* — https://www.eng-tips.com/threads/iges-geometry-repair.455145/
- Eng-Tips: *IGES & STEP translator set up* — https://www.eng-tips.com/threads/iges-amp-step-translator-set-up.253996/
- Eng-Tips: *BC techniques to keep FEA models realistic* — https://www.eng-tips.com/threads/what-boundary-condition-techniques-do-you-use-to-keep-fea-models-realistic.529667/
- Eng-Tips: *Thoughts about OnShape CAD?* — https://www.eng-tips.com/viewthread.cfm?qid=386645
- GrabCAD community (groups/questions/library) — https://grabcad.com/groups , https://grabcad.com/questions
- GrabCAD blog: *Engineering Drawings Are Dead?* — https://blog.grabcad.com/blog/2014/08/19/engineering-drawings-are-dead/
- GrabCAD blog: *FEA and 3D Printing — Challenges* — https://blog.grabcad.com/blog/2016/04/27/fea-and-3d-printing-challenges/
- tec-ease GD&T tips — https://www.tec-ease.com/gdt-tips-view.php?q=248 , .../q=43 , .../q=246 , .../q=174 ; article: https://www.tec-ease.com/article-defining-gdt.php
- Onshape forum: *Large Assembly performance* — https://forum.onshape.com/discussion/258/large-assembly-performance ; *Assembly performance issue* — https://forum.onshape.com/discussion/26714/
- Onshape blog: *120 CAD Issues No One Wants to Deal With* — https://www.onshape.com/en/blog/120-cad-issues-no-one-wants-to-deal-with ; *Model-Based Definition* — https://www.onshape.com/en/features/model-based-definition ; *Cloud-native MBD/PMI* — https://www.onshape.com/en/blog/cloud-native-model-based-definition-mbd-product-manufacturing-information-pmi
- engineering.com: *3 AI features coming to every CAD program in 2026* — https://www.engineering.com/3-ai-features-coming-to-every-cad-program-in-2026/ ; *Are Engineering Drawings Dead?* — https://www.engineering.com/engineering-drawings-dead/ ; *Avoiding singularities in FEA boundary conditions* — https://www.engineering.com/avoiding-singularities-in-fea-boundary-conditions/
- DEVELOP3D: *Develop3D Live 2026 — bits to atoms* — https://blog.4dpipeline.com/develop3d-live-2026-the-real-challenge-is-getting-to-physical-outcomes ; *Siemens Realize Live 2025* — https://develop3d.com/cad/siemens-realize-live-2025/ ; *MBD goes live in Onshape* — https://develop3d.com/cad/mbd-goes-live-in-onshape/
- NAFEMS: VVUQ event 2026 — https://www.nafems.org/events/nafems/2026/verification-and-validation-in-engineering-simulation-online-01/ ; *Guidelines for Validation of Engineering Simulations* (NWC25) — https://www.nafems.org/publications/resource_center/nwc25-0007290-paper/ ; SPDM Conference 2026 — https://www.nafems.org/events/nafems/2026/simulation-process-and-data-management-spdm-conference-2026/ ; Americas 2026 keynotes — https://www.nafems.org/events/nafems/2026/nafems-americas-conference/keynotes/ ; *Reshaping Simulation Data for an AI Future* — https://www.nafems.org/events/nafems/2026/sdmtechcom10/
- Digital Engineering 24/7: *Engineering Simulation in 2026 — ASSESS perspective* — https://www.digitalengineering247.com/article/engineering-simulation-in-2026assess-simulation-leadership-perspective
- Rescale: *NAFEMS Americas 2026 recap — agents & AI physics* — https://rescale.com/blog/nafems-americas-2026-recap/
- Capvidia: *QIF Definitive Guide* — https://www.capvidia.com/blog/qif-quality-information-framework-definitive-guide ; *Best STEP File: AP203 vs AP214 vs AP242* — https://www.capvidia.com/blog/best-step-file-to-use-ap203-vs-ap214-vs-ap242 ; MBDVidia — https://www.capvidia.com/products/mbdvidia
- CAD Interop: *PMI validation / MBD model integrity* — https://www.cadinterop.com/en/your-needs/mbd-mbe-approach/cad-model-validation-with-pmi.html ; *QIF* — https://www.cadinterop.com/en/formats/neutral-format/qif.html ; *IGES neutral format* — https://www.cadinterop.com/en/formats/neutral-format/iges.html ; *Long Term Archival / LOTAR* — https://www.cadinterop.com/en/your-needs/long-term-archival/lotar.html
- LOTAR International — https://lotar-international.org/ ; Q1-2026 milestones — https://lotar-international.org/advancing-global-standards-for-long-term-data-archiving-and-interoperability/ ; EN 9300-210:2026 — https://standards.iteh.ai/catalog/standards/cen/a44847e4-f841-48dd-8cf3-fdfc893ebc30/en-9300-210-2026
- ASME IDETC: *Semantic Interoperability of GD&T through ISO 10303 AP242* — https://asmedigitalcollection.asme.org/IDETC-CIE/proceedings-abstract/IDETC-CIE2016/50114/V02BT03A018/254972
- NIST: STEP File Analyzer & Viewer — https://www.nist.gov/services-resources/software/step-file-analyzer-and-viewer ; QIF Technology Survey (NISTIR 8127) — https://nvlpubs.nist.gov/nistpubs/ir/2016/NIST.IR.8127.pdf
- Chalmers/ScienceDirect: *Closing gaps in the digital thread with QIF* — https://www.sciencedirect.com/science/article/pii/S0010448525000223
- FEA practitioner refs: FEA Academy *15 Common Mistakes* — https://fea-academy.com/...; Sangster Eng *Mesh Convergence Studies* — https://www.sangstereng.com/post/mesh-convergence-studies-for-fea ; Enterfea *Boundary Conditions* — https://enterfea.com/what-are-different-boundary-conditions-in-fea/
- PatSnap: *AI engineering knowledge documentation strategies* — https://www.patsnap.com/resources/blog/articles/ai-engineering-knowledge-documentation-strategies/ ; Wipro: *Reimagining PLM with AI* — https://www.wipro.com/engineering/articles/reimagining-plm-the-ai-powered-leap-from-data-to-intelligence/
- DraftAid: *The Drawing vs MBD Debate* — https://draftaid.io/blog/the-drawing-vs-mbd-debate/
- AS9100/traceability refs: In Compliance Magazine — https://incompliancemag.com/how-to-fulfill-as-9100-traceability-requirements-as-a-defense-subcontractor/ ; Visure — https://visuresolutions.com/aerospace-and-defense/traceability/
- Engineering-change refs: Aras glossary — https://aras.com/en/glossary/engineering-change-management ; PTC — https://www.ptc.com/en/blogs/plm/what-is-an-engineering-change-order
