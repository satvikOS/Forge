# TRAINING CURRICULUM — GD&T · TOLERANCE STACK-UP · METROLOGY & CMM · NDT · QA/TQM · RAMS · FMEA · REVERSE ENGINEERING

**Cluster:** Quality / Tolerancing / Inspection (the "does the design actually fit, measure, and survive?" cluster)
**Owner:** SCOPE_2026-06-24 / training · **Date:** 2026-06-24 · **Status:** canonical (folds into `archie_corpus_program.md` Pillar B Cluster 5 + Pillar C interface axis)
**Backbone module map:** `bulk_synth_mechatronics.py` (GD&T/tolstack/CMM/NDT) + `bulk_synth_plm.py` (QA/TQM/RAMS/FMEA/SPC/MSA) + `bulk_synth_geom.py` (reverse-eng fit)
**Grounding read 2026-06-24:** `forge-kernel/include/forge/native/gdt/Gdt.hpp`, `forge/native/tolstack/Tolstack.hpp`, `src/native/gdt/Gdt.cpp`, `src/native/tolstack/Tolstack.cpp`, `src/binding.cpp` (`forge.native.gdtTruePosition/gdtFlatness/tolstackAnalyze` registrations), `frontend/src/forge-v4/asmeY145Rules.js`, `GdtFcf.jsx`, `kernel/standards/GDTEngine.js`.

> **THESIS.** This cluster is where "looks right in the viewport" becomes "passes incoming inspection and the field-reliability target." A senior engineer here does five things a chat model cannot fake: (1) writes a *legal, minimal, manufacturable* feature-control frame against a correctly-ordered datum reference frame; (2) sizes the position/profile tolerance so the worst-case **and** statistical stack still assembles at the demanded yield; (3) designs the part so it is *inspectable* (CMM-accessible datums, probe-reachable features, a realistic GD&T-to-CMM measurement plan); (4) predicts whether the design will pass NDT and meet the RAMS/FMEA reliability budget; (5) closes the loop from measured points back to corrected geometry (reverse engineering / first-article). Archie must reason through all five and **terminate every geometric claim in a kernel-replayable `forge.native.gdt*` / `forge.native.tolstackAnalyze` call whose verdict is the ground truth** — never an asserted number.
>
> **WHY THIS CLUSTER IS THE INTERFACE-AXIS LEVER.** CADGenBench's interface axis (weight 0.4, the single dimension general models collapse on) *is* tolerancing + hole/boss/slot placement under GD&T. The MMC bonus, datum-3-2-1, and worst-case-vs-RSS judgment in this cluster are exactly the semantics that decide whether a generated hole pattern mates. This is the highest-leverage non-validity corpus in the whole program.
>
> **HONESTY ANCHOR (from the kernel headers themselves).** Forge's GD&T surface is split: `asmeY145Rules.js` / `GDTEngine.js` check FCF **strings** (datum precedence, legal modifiers, Ø prefix, ≤3 datums) and read no geometry, while `forge::native::gdt` (Gdt.hpp) does the **real ASME Y14.5-2018 math** on measured coordinates (DRF build, true-position-with-bonus, min-zone flatness/circularity/cylindricity/profile, FCF legality). Archie must know which layer answers which question and never claim a geometric pass from a string check. Profile-against-NURBS, composite-frame lower-segment, and datum-feature-simulator contact solving for irregular surfaces are *honestly still PMI-text* (Gdt.hpp lines 56-61) — teach the limit, do not paper it.

---

## 0. SCOPE & POSITION IN THE PROGRAM

| Sub-domain | Pillar B field # | Primary `forge.*` target | Kernel status (2026-06-24) |
|---|---|---|---|
| GD&T (ASME Y14.5-2018 / ISO GPS) | direct §23 | `forge.native.gdtTruePosition`, `gdtFlatness`, (planned `gdtZone`, `gdtFcfLegality`) | **native, real numerics** — DRF, true-position+bonus, 8 characteristics min-zone, FCF legality (Gdt.hpp/Gdt.cpp) |
| Tolerance stack-up | direct §24 | `forge.native.tolstackAnalyze` | **native** — WC + RSS + Monte-Carlo + RSS-validity verdict + GD&T-bonus coupling (Tolstack.hpp) |
| Metrology & CMM inspection | indirect §6 | `forge.native.gdt*` over probe points; `forge.cmm.*` plan (bridge `cmm`, `cmmImport`) | partial — geometric evaluators exist; **measurement-plan/path & QIF I/O are the gap** |
| NDT (UT/RT/PT/MT/ET/CT) | indirect §7 | `forge.ndt.*` (planned), `forge.inspect.*` | gap — physics formulas in corpus, evaluators to add |
| QA / TQM (SPC, MSA, DOE) | indirect §3 | `forge.spc.*`, `forge.msa.*`, `forge.doe.*` (Pillar D §4) | partial — Cp/Cpk inside tolstack; SPC/Gage-R&R/DOE to bind |
| RAMS (reliability/availability/maintainability/safety) | indirect §8 | `forge.rams.*` (Weibull/RBD/FTA/Markov) | gap — formulas in corpus |
| FMEA (D/P-FMEA, AIAG-VDA) | indirect §9 | `forge.fmea.*` (bridge `fmea.json/md`) | partial — authoring exists, scoring/AP to bind |
| Reverse engineering & metrology | sister §14 + indirect §6 | `forge.native.surfitFit`, `forge.reverse.{plane,cylinder,sphere,cone}`, `forge.reverseEng.fittedSurface` | partial — primitive fit native; ICP/RANSAC/Poisson to extend |

**Curriculum stage:** lands in **S4 (Lifecycle + Mechatronics)** of the master order; the GD&T/tolstack subset is pulled *forward into S3* because it is the manufacturing **interface axis** lever. Acceptance gate (from corpus program S4): *FMEA/RAMS/GD&T tool-calls schema-valid; interface axis ≥0.85 on jig smoke; eAGI L4–L5 ≥0.80.*

---

## 1. KNOWLEDGE BREAKDOWN — bachelors → masters → PhD → industry

The model must reason at every rung. Below, each sub-domain lists: **(a) sub-topics**, **(b) the load-bearing theory/equations**, **(c) standards (the answer keys)**, **(d) the hard real-world judgment** that separates a senior engineer from a textbook recitation.

### 1.1 GD&T — Geometric Dimensioning & Tolerancing (ASME Y14.5-2018 / ISO GPS)

**(a) Sub-topics.** The 14 characteristics in 5 categories — **Form** (flatness, straightness, circularity, cylindricity), **Orientation** (perpendicularity, parallelism, angularity), **Location** (position, concentricity†, symmetry†), **Profile** (profile-of-a-line, profile-of-a-surface), **Runout** (circular, total). (†concentricity/symmetry *removed* in Y14.5-2018 — a senior must know this and substitute position/profile.) Datum reference frames & precedence (3-2-1, primary/secondary/tertiary). Feature-of-size vs non-FoS. Material-condition modifiers (Ⓜ MMC, Ⓛ LMC, RFS-default). Bonus & datum-shift tolerance. Composite vs two-single-segment frames. Datum targets. Projected, free-state, tangent-plane, statistical (ⓈⓉ) modifiers. The Ⓟ projected zone, ⓤ unequally-disposed profile, "continuous feature" Ⓒ. Translation modifier ▷. Customized DRF (degrees of freedom constrained: [x,y,z] / [u,v,w]).

**(b) Theory / equations.**
- **True position (diametral):** `Δ = 2·√((x_act − x_true)² + (y_act − y_true)²)`; **pass iff** `Δ ≤ Ø_pos + bonus`. *(This is `evaluateTruePosition` in Gdt.cpp; the zone is a cylinder on the basic axis — Gdt.hpp §(2).)*
- **MMC/LMC bonus (Y14.5 §7.3.3):** HOLE@MMC `bonus = actualSize − materialLimit`; PIN@MMC `bonus = materialLimit − actualSize`; LMC is the opposite extreme; RFS `bonus = 0`; **all clamped ≥0** (a size-reject earns no position bonus). *(Exactly `mmcBonus` — Gdt.cpp.)*
- **Virtual condition / resultant condition:** `VC_hole = MMC_size − geom_tol`; `VC_pin = MMC_size + geom_tol` — the boundary that must clear the mating part; the basis of a functional gauge.
- **Datum reference frame:** primary plane A → `axisZ`; secondary B Gram-Schmidt-orthogonalized to A → `axisX`; tertiary `axisY = axisZ × axisX`; origin = three-plane intersection (Cramer). Express every point as `p' = Rᵀ(p − origin)` before evaluating — **tolerances live in the DRF, never world space**. *(`buildDrf` / `transformToDrf` — Gdt.hpp §(1).)*
- **Form (no datum):** flatness = peak-to-valley band of LS-plane signed distances; circularity = `R_max − R_min` of the LS circle (one section); cylindricity = `R_max − R_min` about the LS axis; straightness of a derived median line. **Min-zone (Chebyshev) vs least-squares** is the deep distinction — the standard zone is the *minimum* enclosing zone, not the LS residual; Forge implements the min-zone validators (`validateCircularityPointSet`, `validateCylindricityPointSet` — Gdt.cpp).
- **Profile of a surface:** band of width `tol` normal to the true profile; bilateral ±tol/2 (default) or unilateral 0..tol; value = `max|signed normal deviation|`. *(`validateProfilePointSet`.)*
- **Orientation:** band measured along the **fixed nominal datum-relative zone normal** (NOT the points' own best-fit normal) so a flat-but-tilted plate correctly FAILS perpendicularity. *(`validateOrientationPointSet` — Gdt.hpp §(a), the subtle correctness point.)*

**(c) Standards.** ASME Y14.5-2018 (the canonical), ASME Y14.5.1-2019 (mathematical definition — *the* PhD reference for zone math), ASME Y14.41 (model-based PMI), ISO GPS stack: ISO 1101 (geometrical tolerancing), ISO 5458 (positional), ISO 2692 (MMR/LMR/RPR), ISO 1660 (profile), ISO 8015 (fundamental/independency principle), ISO 14405 (linear/angular size), ISO 5459 (datums), ISO 14638 (GPS matrix), ISO 2768 (general tolerances). **Critical senior distinction:** ASME default = *independency only with Ⓘ* but Rule #1 (Taylor/envelope) applies by default; ISO default = *independency principle* (size & form independent unless Ⓔ). Mixing the two is a classic field defect.

**(d) Hard judgment.** Choosing the *minimum* control that guarantees function (over-tolerancing kills yield, under-controls function). Picking datum features that are (i) functional, (ii) accessible to the fixture/CMM, (iii) stable (largest-area-first for the primary, 3-2-1 contact). Knowing when position+Ⓜ on a clearance hole *is correct* (gauge-able, bonus helps assembly) versus when RFS is mandatory (a press-fit, a bearing bore). Recognizing that removing concentricity/symmetry in 2018 means re-expressing legacy callouts. Reading whether a composite frame's lower segment over-refines and blows cost.

### 1.2 Tolerance stack-up analysis

**(a) Sub-topics.** 1-D linear chains, ±loop / vector-loop (2-D/3-D), worst-case (WC), statistical RSS (root-sum-square), Monte-Carlo, sensitivity `∂gap/∂dim`, mean-shift & long-term drift (the 1.5σ shift → "six-sigma" PPM), process-capability propagation (Cp/Cpk/Pp/Ppk), GD&T-in-the-stack (bonus & datum shift as contributors), assembly-shift, gap analysis & interference probability, tolerance allocation/synthesis (cost-weighted optimization, reciprocal/exponential cost-tolerance models), six-sigma allocation.

**(b) Theory / equations.**
- **Worst-case:** `gap_nom = Σ sᵢ·dᵢ`; `tol_WC = Σ|sᵢ|·tolᵢ`; guarantees 100% interchange, pessimistic for long chains.
- **RSS:** `σ_gap = √(Σ (sᵢσᵢ)²)`, with `σᵢ = tolᵢ / (k·Cpᵢ)` (k=3 default); `yield = Φ((USL−μ)/σ) − Φ((LSL−μ)/σ)`; `Cp = (USL−LSL)/6σ`, `Cpk = min(USL−μ, μ−LSL)/3σ`. **RSS is a linearization of a sum of normals — exact only there.**
- **Monte-Carlo (the truth for mechanisms / non-normal):** seeded sampling of each contributor's real distribution through the (possibly non-linear) transfer `gap = transfer(d)`.
- **The named failure mode (Tolstack.hpp lines 20-39):** RSS *quietly misleads* when (a) the transfer is non-linear (mechanism, `|∂²gap/∂dim²|` significant), (b) a non-normal (uniform/triangular) contributor dominates variance, (c) too few contributors for CLT, (d) MC and RSS yields diverge past threshold. Forge sets `rssValid=false` + a reason and reports MC as authoritative. **This is the single most-tested senior judgment in the whole cluster.**
- **GD&T coupling:** a FoS at MMC grows its tol band by `mmcBonus` *before* σ derivation — same Y14.5 §7.3.3 branch as the geometric evaluator (numerically consistent by construction — Tolstack.hpp lines 30-34, 84-91).

**(c) Standards / refs.** ASME Y14.5-2018 §statistical tolerancing, AIAG-VDA & ISO 22514 (process capability), Dimensioning & Tolerancing Handbook (Drake), Tolerance Stack-Up Analysis (Fischer), the SAE/automotive 6σ allocation practice, Cpk↔PPM tables (Cpk 1.33→63 PPM, 1.67→0.57 PPM, the 1.5σ-shifted 6σ→3.4 PPM).

**(d) Hard judgment.** *Choosing the method.* WC for safety-critical / single-piece / few contributors; RSS only when its four assumptions hold; MC for any mechanism or non-normal-dominant stack — and *knowing the kernel will flag it for you* (`rssValid`). Allocating tolerance to the cheapest-to-hold contributors (sensitivity × cost), not uniformly. Treating GD&T bonus as *real slack* in clearance stacks but *forbidden* in interference fits. Not double-counting a datum shift. Reading the critical-path ranking (`ContributorShare.varianceShare`) to know where to spend money.

### 1.3 Metrology & CMM inspection

**(a) Sub-topics.** Tactile CMM (touch-trigger vs scanning), structured-light / laser-line scanning, photogrammetry, CT metrology. Sampling strategy (point density, Nyquist on a feature, Hammersley/uniform/feature-aware). Probe qualification & tip compensation. Datum-feature simulators & fixturing (3-2-1). Substitute-geometry fitting: **least-squares vs minimum-zone (Chebyshev) vs maximum-inscribed / minimum-circumscribed** — and which the standard demands per characteristic. Filtering (Gaussian, robust-spline, ISO 16610). Measurement uncertainty (GUM / ISO 15530-3). Inspection planning: GD&T → DMIS/QIF program → probe path. First-article (AS9102), in-process & CMM-to-SPC.

**(b) Theory / equations.**
- **Substitute geometry:** LS plane/line/circle/cylinder/sphere/cone fits (the covariance-eigen plane, Gauss-Newton for cylinder/cone). **Min-zone** by Chebyshev / linear-programming exchange; **MIC/MCC** for mating-size verification.
- **Measurement uncertainty (GUM):** combined `u_c = √(Σ (∂f/∂xᵢ)² u²(xᵢ))`; expanded `U = k·u_c` (k=2 ≈ 95%); ISO 15530-3 substitution method `u = √(u_cal² + u_p² + u_w² + u_b²)`.
- **Decision rule (ISO 14253-1):** conformance zone = spec − U (guard-banding); the **"shared risk vs stringent acceptance"** call.
- **Tip compensation, form-error of the probe, cosine error, Abbe error** `ε = L·tanθ`.

**(c) Standards.** ISO 10360 (CMM acceptance/reverification, MPE_E), ISO/ASME B89.4 series, ASME Y14.5.1 (zone math the CMM must reproduce), QIF (ISO 23952 — Quality Information Framework: MBD→measurement→results round-trip), DMIS (ISO 22093), GUM (JCGM 100), ISO 14253-1 (decision rules), ISO 15530-3 (uncertainty by calibrated workpieces), AS9102 (first-article), VDI/VDE 2634 (optical scanning).

**(d) Hard judgment.** Designing a part that is *measurable*: every datum reachable by the probe in one setup ideally, features not shadowed, enough material for a stable 3-2-1. Choosing the fit per characteristic (min-zone for form conformance, LS for location centroid, MIC for a mating bore). Setting sample density so a lobed/wavy surface isn't aliased. Guard-banding to the customer's risk appetite. Knowing when a CMM result that "fails" is actually fixturing/alignment error, not the part. Reconciling GD&T datum precedence with the physical CMM alignment sequence (the iterative best-fit-to-datums vs the rigid 3-2-1).

### 1.4 NDT — Non-Destructive Testing

**(a) Sub-topics.** UT (pulse-echo, TOFD, phased array PAUT), RT/CR/DR & CT, PT (dye penetrant), MT (magnetic particle), ET (eddy current), VT, AE (acoustic emission), thermography, leak testing. POD (probability of detection) & `a₉₀/₉₅` flaw size. Defect taxonomy (porosity, lack-of-fusion, cracks, inclusions, laminations) per process. Designing for inspectability (access, surface finish, geometry that doesn't mask reflectors).

**(b) Theory / equations.**
- **UT:** near-field `N = D²/(4λ) = D²f/(4c)`; beam divergence `sinθ = 1.22 λ/D`; resolution `~λ/2`; PAUT focal laws `Δtᵢ = (r − √(r²+xᵢ²−2rxᵢsinα))/c`. Acoustic impedance `Z = ρc`; reflection `R = ((Z₂−Z₁)/(Z₂+Z₁))²`.
- **RT:** attenuation `I = I₀ e^(−μt)`; geometric unsharpness `U_g = F·t/(d−t)` (F=focal spot, t=object-film gap, d=source-object); contrast/sensitivity from IQI.
- **ET:** standard depth of penetration `δ = 1/√(πfμσ)`; lift-off & fill-factor effects.
- **PT/MT:** capillary rise, dwell time; tangential field strength ≥ 2.4 kA/m (MT).

**(c) Standards.** ASME BPVC Section V (NDE methods), ASNT SNT-TC-1A / CP-189 (personnel), ISO 9712, ASTM E (E317 UT, E1742 RT, E1417 PT, E1444 MT, E1316 terminology), AWS D1.1 (weld NDT acceptance), API 5UE/1104, MIL-HDBK-1823A (POD).

**(d) Hard judgment.** Matching method to defect orientation/type (UT for planar cracks normal to beam, RT for volumetric porosity, ET for surface/near-surface in conductors, PT for surface-breaking in non-ferrous). Designing weld joints & castings for the chosen method (TOFD needs parallel scan surfaces; RT needs source access). Reading POD to set inspection interval against the fracture-mechanics crack-growth budget (couples to RAMS & fatigue). Knowing what *can't* be found and surfacing it (the honesty injection).

### 1.5 QA / TQM — Quality systems, SPC, MSA, DOE

**(a) Sub-topics.** SPC (X̄-R, X̄-s, I-MR, p/np/c/u, EWMA, CUSUM), control-limit vs spec-limit, Western Electric/Nelson rules, capability (Cp/Cpk/Pp/Ppk), MSA / Gage-R&R (ANOVA & average-range), bias/linearity/stability, attribute agreement, DOE (full/fractional factorial, response-surface, Taguchi robust design, signal-to-noise), 8D/PDCA/DMAIC, cost of quality, APQP/PPAP, control plans. TQM philosophy (Deming 14 points, Juran trilogy, Crosby).

**(b) Theory / equations.**
- **Control limits:** `X̄ ± A₂R̄`, `UCL_R = D₄R̄`, etc.; capability `Cp=(USL−LSL)/6σ`, `Cpk=min(...)/3σ`, `Pp/Ppk` with overall σ.
- **Gage-R&R (ANOVA):** `σ²_total = σ²_part + σ²_repeat + σ²_reprod`; %GRR `= σ_RR/σ_total`; ndc `= 1.41·σ_part/σ_RR`; accept <10%, marginal 10-30%.
- **DOE:** main effects & interactions from the design matrix; RSM `y = β₀ + Σβᵢxᵢ + Σβᵢⱼxᵢxⱼ + Σβᵢᵢxᵢ²`; Taguchi S/N (`−10log(Σ(1/yᵢ²)/n)` larger-better, etc.).
- **Sampling:** OC curves, AQL/LTPD, ANSI/ASQ Z1.4.

**(c) Standards.** ISO 9001 (QMS), IATF 16949 (automotive), AS9100 (aero), AIAG core tools (SPC, MSA 4th-ed, APQP, PPAP, FMEA — now AIAG-VDA), ISO 22514 (capability), ASQ body of knowledge (CQE), Montgomery *Design & Analysis of Experiments* / *Statistical Quality Control*.

**(d) Hard judgment.** Distinguishing a capable-but-not-centered process (good Cp, bad Cpk → shift the mean, don't tighten) from a variation problem (bad Cp → reduce spread). Refusing to act on common-cause noise (over-adjustment / tampering). Knowing Gage-R&R must pass *before* trusting any Cpk. Choosing a fractional design when full factorial is unaffordable and knowing the confounding it buys. Tying control-plan reaction rules to the FMEA.

### 1.6 RAMS — Reliability, Availability, Maintainability, Safety

**(a) Sub-topics.** Life models (exponential, Weibull, lognormal), bathtub curve, MTBF/MTTF/MTTR, availability `A = MTBF/(MTBF+MTTR)`, RBD (series/parallel/k-out-of-n), redundancy (active/standby), FTA (cut-sets, minimal cut-sets), event trees, Markov models (repairable, degraded states), Monte-Carlo reliability, accelerated life testing (Arrhenius, Eyring, Coffin-Manson for thermal cycling), derating, FRACAS, RCM, spares/LORA, functional safety (SIL/PL/ASIL, PFD/PFH).

**(b) Theory / equations.**
- **Weibull:** `R(t) = e^(−(t/η)^β)`; β<1 infant, β=1 random, β>1 wear-out; `B10 = η(−ln0.9)^(1/β)`; MTTF `= η·Γ(1+1/β)`.
- **RBD:** series `R = ΠRᵢ`; parallel `R = 1−Π(1−Rᵢ)`; k-of-n binomial.
- **FTA:** top-event prob from minimal cut-sets `P = 1−Π(1−Πqⱼ)`.
- **Markov:** `dP/dt = P·Q` (generator matrix), steady-state availability from balance equations.
- **Accelerated:** Arrhenius AF `= e^((Eₐ/k)(1/T_use − 1/T_test))`; Coffin-Manson `N = C·ΔT^(−n)`.
- **Functional safety:** PFD_avg for a SIF, hardware fault tolerance, SFF, diagnostic coverage (IEC 61508 / ISO 26262 ASIL with FMEDA, SPFM/LFM/PMHF).

**(c) Standards.** IEC 61508 (functional safety), ISO 26262 (automotive, ASIL/FMEDA/PMHF), IEC 61511 (process SIS), MIL-HDBK-217 / Telcordia SR-332 (prediction), IEC 61025 (FTA), IEC 61078 (RBD), IEC 61165 (Markov), IEC 60300 (dependability mgmt), DO-178C/DO-254 (avionics), ARP4761 (aero safety assessment — FHA/PSSA/SSA).

**(d) Hard judgment.** Choosing β from physics (wear-out design vs random-failure design changes the whole maintenance strategy). Allocating a system reliability budget down to components (top-down, weighted by criticality & cost). Deciding redundancy architecture (active vs cold standby vs k-of-n) against weight/cost/common-cause-failure (β-factor). Reading an FTA to find the single point of failure to redesign. Setting derating to buy life. Linking the design's fatigue/fracture (Cluster 2) life to the RAMS budget — *this is where geometry meets reliability.*

### 1.7 FMEA — Failure Mode & Effects Analysis

**(a) Sub-topics.** System/Design/Process FMEA, the AIAG-VDA 7-step (planning&prep, structure analysis, function analysis, failure analysis, risk analysis, optimization, results documentation), function trees, failure nets (FE/FM/FC chains), Severity/Occurrence/Detection rating tables, **Action Priority (AP, H/M/L — replaced RPN)**, FMEA-MSR (monitoring & system response, supplemental for in-service), linkage to control plans & DFMEA→PFMEA→Control-Plan flow, DRBFM (Toyota).

**(b) Theory / equations / logic.**
- **Legacy RPN** `= S·O·D` (and *why it's deprecated* — non-uniform scale, equal RPNs hide different severities).
- **AIAG-VDA Action Priority:** a lookup over (S, O, D) → H/M/L (S≥9 with O≥2 → H regardless of D, etc.) — Archie must apply the *table*, not multiply.
- **FMEA-MSR:** Severity / Frequency / Monitoring → AP for in-operation faults (couples to functional-safety diagnostic coverage).
- **Linkage logic:** every failure mode → a control (prevention lowers O, detection lowers D) → a control-plan reaction.

**(c) Standards.** AIAG-VDA FMEA Handbook (2019, the current canonical), IEC 60812 (FMEA/FMECA), SAE J1739, MIL-STD-1629A (FMECA criticality), ISO 26262-5 (DFMEA/FMEDA for ASIL).

**(d) Hard judgment.** Writing failure *modes* at the right level (not effects-as-modes — the classic novice error). Tracing a failure chain from component to system effect correctly. Resisting Occurrence-inflation games to dodge actions. Using AP to *prioritize redesign*, then *re-rating only what the action changed*. Connecting the DFMEA to the GD&T (a "hole mislocated" failure mode is *exactly* a position-tolerance + stack-up problem — the cluster is internally coupled). Knowing when MSR applies (safety-relevant, in-service monitored).

### 1.8 Reverse engineering & metrology

**(a) Sub-topics.** Scan→mesh→solid pipeline. Registration (coarse: FPFH+RANSAC / 4PCS; fine: ICP point-to-point & point-to-plane; global pose-graph). Primitive segmentation & fitting (RANSAC plane/cylinder/sphere/cone/torus). Surface reconstruction (Poisson, ball-pivoting, marching cubes, MLS). NURBS auto-surfacing & Class-A re-creation. Feature-based parametric re-engineering (recognize design intent: fillets, patterns, sketch-extrude). Datum recovery from a scan. Deviation/colour-map (scan vs CAD or scan vs scan). GD&T-from-scan (first-article from a point cloud).

**(b) Theory / equations.**
- **ICP:** minimize `Σ‖R pᵢ + t − qᵢ‖²` (point-to-point, closed-form SVD on cross-covariance) or point-to-plane `Σ((R pᵢ+t−qᵢ)·nᵢ)²`.
- **RANSAC fit:** inlier count vs threshold, model from minimal set, iterations `N = log(1−p)/log(1−wⁿ)`.
- **Primitive fits:** LS plane (covariance eigen), cylinder/cone (Gauss-Newton on axis+radius), sphere (algebraic then geometric). *(Forge native: `forge.reverse.{plane,cylinder,sphere,cone}`, `forge.native.surfitFit`, `forge.reverseEng.fittedSurface`.)*
- **Poisson reconstruction:** solve `Δχ = ∇·V` for the indicator field; isosurface.
- **Deviation:** signed distance scan→CAD with a robust (Hausdorff-trimmed / percentile) metric.

**(c) Standards / refs.** VDI/VDE 2634 (optical scanning accuracy), QIF (scan→inspection), Besl-McKay ICP, Schnabel RANSAC, Kazhdan Poisson, the parametric-CAD literature list (DeepCAD, Fusion360, BRepNet, AutoBrep — re-engineering design intent), ASME Y14.5.1 for the GD&T-from-scan side.

**(d) Hard judgment.** Knowing scan noise/density limits what you can claim (a 50 µm scan can't certify a 10 µm tolerance — surface honestly). Choosing primitive-fit vs free-form per region (a machined boss is a cylinder; a styled fender is NURBS). Recovering *design intent* (concentric, equal, tangent) not just a dumb mesh. Setting the ICP datum to the *functional* datums, not a global best-fit, when doing first-article. Reconciling a deviation map against the GD&T tolerance zones (a 0.2 mm deviation is fine in a ±0.5 profile zone, a reject in a ±0.1).

---

## 2. DATA SOURCES (premium / authoritative only)

> IP hygiene (per `mecado.md`): **cite standards & textbooks as answer-key references; never scrape proprietary PDFs into the corpus.** Synthetic generation *encodes* the equations/tables; the sources below are the provenance the generator's answer keys are checked against. Storage-safe streaming throughout (download→process→delete, `iter_batches`).

### 2.1 Textbooks (the canonical answer keys)
- **GD&T:** Krulikowski, *Fundamentals of GD&T* (3e); ASME Y14.5-2018 + **Y14.5.1-2019 (mathematical definition — the equation source)**; Meadows, *GD&T Applications & Inspection*; Drake, *Dimensioning & Tolerancing Handbook* (McGraw-Hill — also the stack-up bible).
- **Tolerance stack-up:** Fischer, *Mechanical Tolerance Stackup & Analysis* (2e); Bryan R. Fischer's SAE courses; Creveling, *Tolerance Design*.
- **Metrology/CMM:** Hocken & Pereira, *Coordinate Measuring Machines and Systems* (2e); Smith, *Industrial Metrology*; Flack (NPL) *Good Practice Guides* (CMM, probing, dimensional); the **NPL** and **NIST** metrology guides (authoritative, openly published).
- **NDT:** ASNT *Nondestructive Testing Handbook* (the 10-volume set, by method); *Charlie Chong* PAUT refs; Krautkrämer, *Ultrasonic Testing of Materials*.
- **QA/TQM/SPC/DOE/MSA:** Montgomery, *Statistical Quality Control* & *Design and Analysis of Experiments*; AIAG core-tool manuals (SPC, MSA 4e, APQP, PPAP); Wheeler, *Understanding Statistical Process Control*.
- **RAMS:** O'Connor & Kleyner, *Practical Reliability Engineering* (5e); Modarres, *Reliability Engineering and Risk Analysis*; Birolini, *Reliability Engineering*; *NASA Reliability & Maintainability* handbooks; *MIL-HDBK-217F*, *Telcordia SR-332*.
- **FMEA:** **AIAG-VDA FMEA Handbook (2019)** — the current canonical; IEC 60812; SAE J1739.
- **Reverse engineering:** Várady/Martin/Cox survey papers; the parametric-CAD literature synthesis (`research/parametric_cad_literature_2026.md`).

### 2.2 Courses (MIT OCW & peers — free, lecture-grade)
- **MIT OCW 2.008** Design & Manufacturing II (tolerancing, SPC, process capability); **2.810** Manufacturing Processes & Systems (GD&T, metrology, DOE labs); **2.830J / 6.780J** Control of Manufacturing Processes (SPC, DOE, run-to-run); **16.881** Robust System Design (Taguchi/DOE); **ESD.33** Systems Engineering (RAMS context).
- **Penn State / Georgia Tech** GD&T & metrology MOOCs; **NPTEL** (India) Metrology & Quality Control, Reliability Engineering (full lecture series, transcripts available).
- **Coursera/edX**: Georgia Tech "Six Sigma", ASU "Quality Engineering".

### 2.3 Standards bodies (the legal/normative spine)
ASME (Y14.5, Y14.5.1, Y14.41, B89, BPVC-V), ISO (GPS: 1101/5458/2692/1660/8015/14405/5459/14253/15530; QIF 23952; CMM 10360; capability 22514; dependability 60300-series; FMEA 60812; FTA 61025; RBD 61078; functional safety 61508/61511), IEC, SAE (J1739, ARP4761), AIAG-VDA, ASTM E-series (NDT), ASNT, AWS (D1.1), API (1104, 5UE), NIST/NPL (metrology good-practice), JCGM 100 (GUM).

### 2.4 Datasets (CC0 / clean — for grounded geometric samples)
- **CADGenBench public inputs** (`HuggingAI4Engineering/cadgenbench-data`, ODC-BY) — jig/bolt-pattern/slot/boss fixtures = the exact GD&T-interface part classes.
- **DeepCAD / Fusion360 Gallery / ABC** — sketch-extrude sequences → feed reverse-engineering "recover design intent" + first-article samples.
- **MVTec AD / NEU surface-defect / GC10-DET / Severstal** (steel-defect) — NDT/visual-inspection grounding (defect taxonomy, POD-style framing).
- **Scan datasets** (Stanford 3D, point-cloud benchmarks, ABC mesh) — ICP/RANSAC/Poisson reverse-eng grounding.
- **NIST/NPL published calibration & uncertainty worked examples** — GUM answer keys (known-answer).
- **Forge-generated truth** (dominant): every geometric sample's verdict comes from `forge.native.gdt*`/`tolstackAnalyze` replay — the deterministic owned-kernel advantage.

### 2.5 Papers (PhD rung)
Min-zone/Chebyshev fitting (linear-programming & computational-geometry exchange algorithms), datum-feature-simulator contact solving, ISO 15530-3 task-specific uncertainty, POD model theory (MIL-HDBK-1823A), Weibull MLE & confidence bounds, Bayesian reliability, FMEDA/PMHF derivations (ISO 26262-5/-10), ICP variants (Rusinkiewicz "Efficient Variants of ICP"), RANSAC primitive extraction (Schnabel 2007), Poisson reconstruction (Kazhdan 2006).

---

## 3. SYNTHETIC-DATA GENERATION PLAN

> **Programmatic, not hand-authored** (memory rule: agents top out at 40–60; `bulk_synth` does 3.5k–13k+ unique/run). Every sample is JSONL `{messages:[system,user,assistant]}`, the assistant ending in one or more **schema-valid `forge.<ns>.<op>(args)` calls the kernel replays**. Geometric claims are **kernel-verified** — the answer key is `forge.native.gdt*`/`tolstackAnalyze` output, never an asserted number. This is what makes Archie *drive Forge correctly* (place the hole at the right basic position with the right Ⓜ frame so the assembly passes) rather than merely *chat about GD&T*.

### 3.1 Generator modules & sample types

**G1 `gen_gdt_evaluate` (the core grounding loop).** Procedurally synthesize a feature-of-size (hole/pin) + a DRF (3 planes) + measured probe points; **call the kernel** `forge.native.gdtTruePosition` / `gdtFlatness` / (zone validators) to get the *true* verdict; emit a Q/A whose ideal answer reproduces that verdict with the reasoning (Δ, bonus, allowed Ø, pass/fail). **Bonus self-grounding:** because the answer is the kernel's own output, the corpus is automatically correct. Sweep MMC/LMC/RFS, hole vs pin, in-tolerance vs reject, bonus-saves-the-day cases. *(~400k.)*

**G2 `gen_fcf_author` (string + legality, the manufacturing-driver).** Spec → a *legal, minimal* feature-control frame string → `forge.gdt.feature/datum/position/write` authoring calls + a `forge.native` FCF-legality check (datum exists/ordered, ≤3, characteristic-vs-feature legal, modifier valid). Teaches Archie to *place correct PMI on the model it builds in Forge* — the interface-axis payload. Includes the "this callout is illegal because…" critique variant. *(~300k.)*

**G3 `gen_tolstack` (method-selection judgment).** Procedural dimension chain (linear & mechanism) → call `forge.native.tolstackAnalyze` → emit the WC/RSS/MC numbers, Cp/Cpk/yield, **and the `rssValid` verdict with its reason**. The crown jewel sample type: cases where RSS *quietly misleads* (non-linear / non-normal-dominant / thin-CLT) and the model must report MC as authoritative — matching the kernel's `authoritativeMc` flag. Plus tolerance-*allocation* (inverse) samples: given a gap target & cost-tolerance model, allocate. *(~350k.)*

**G4 `gen_metrology_plan` (design-for-inspection + uncertainty).** GD&T callout → a CMM measurement plan (datum alignment 3-2-1, sampling density, fit choice min-zone/LS/MIC per characteristic, guard-band per ISO 14253-1) → `forge.cmm.*` plan call + a GUM uncertainty budget (`u_c`, `U=k·u_c`). Design→critique variant: "this feature is not probe-accessible / this datum is unstable — relocate." *(~250k.)*

**G5 `gen_ndt` (method-match + physics + design).** Component/weld/casting + defect type → choose NDT method (UT/RT/PT/MT/ET/CT) with the governing formula (near-field N, `U_g`, skin depth δ, POD a₉₀/₉₅) → `forge.ndt.*` call + a *design-for-inspectability* critique. Honesty injection: "this orientation of crack is below POD for this method — add a second method / redesign access." *(~200k.)*

**G6 `gen_quality_stats` (SPC/MSA/DOE).** Process data → SPC chart selection + limits + out-of-control rule firing; Gage-R&R ANOVA → %GRR/ndc accept-reject; DOE design + effects/RSM/Taguchi S/N. `forge.spc.*`/`forge.msa.*`/`forge.doe.*`. The "good Cp bad Cpk → center, don't tighten" judgment sample. *(~250k.)*

**G7 `gen_rams` (reliability budget + architecture).** System → Weibull/RBD/FTA/Markov/availability computation → `forge.rams.*` call; redundancy-architecture choice; accelerated-life AF; SIL/ASIL PFD/PMHF. The "allocate a 0.999 budget across components" inverse sample. Couples to fatigue (Cluster 2): "this fillet's `da/dN` life sets the inspection interval." *(~200k.)*

**G8 `gen_fmea` (AIAG-VDA 7-step + AP).** Function tree → failure net (FE/FM/FC) → S/O/D rating → **Action Priority lookup (NOT RPN multiply)** → recommended actions → `forge.fmea.*`. Critique variant: "this is an effect mis-stated as a mode." Coupling sample: a "hole mislocated" failure mode whose fix is a tighter position tol + a stack-up re-run (calls G3). *(~200k.)*

**G9 `gen_reverse_eng` (scan→intent→model, kernel-grounded).** Synthetic point cloud (sampled from a known Forge solid + noise) → ICP/RANSAC/primitive-fit → `forge.reverse.{plane,cylinder,sphere,cone}` / `forge.native.surfitFit` / `forge.reverseEng.fittedSurface` → recovered parametric body → **deviation map scan-vs-rebuilt** (kernel computes), and a first-article GD&T-from-scan that reuses G1's evaluators. Honesty: scan-noise vs claimable-tolerance. *(~250k.)*

### 3.2 Grounding discipline (how each stays correct)
- **Geometric → kernel is the oracle.** G1/G3/G9 *call the kernel to make the answer key*; the sample can never disagree with `forge.native.gdt*`/`tolstackAnalyze`. (This is the `ForgeCADScore`-style offline-truth pattern applied to tolerancing.)
- **Tabular/standard → embedded known-answer.** AP lookup, Cpk↔PPM, A₂/D₄ control constants, k=2 coverage, AGMA-style tables are *embedded* and unit-checked; cite the standard clause.
- **Physics formula → analytical gate.** NDT N/U_g/δ, Weibull/RBD/FTA, ICP SVD verified against closed-form / MMS-style known inputs.
- **Honesty samples** seeded throughout: where the kernel is PMI-text-only (profile-vs-NURBS, composite lower segment, irregular-datum contact — Gdt.hpp 56-61) the answer *states the limit and routes to the string-check layer*, never fabricates a geometric pass. Same for scan-noise-vs-tolerance and below-POD defects.
- **Multi-turn self-correction:** samples where Archie gets a kernel verdict (FAIL, Δ=0.18 > Ø0.10) and *adjusts the basic position / opens the tolerance / adds bonus via Ⓜ* and re-checks — mirroring the auto-feedback loop, so it self-heals toward a passing interface.

### 3.3 Why this makes Archie better *inside Forge* (drive the CAD, not chat)
1. **Interface axis (the 0.4-weight CADGenBench lever):** G1/G2/G3 teach Archie to place a hole at the right *basic* position, give it the right *Ⓜ frame*, and verify the *stack still assembles* — exactly the hole/boss/slot-placement semantics the benchmark scores. A model that chats about GD&T but emits a hole 0.3 mm off scores 0 on interface; this corpus moves it to pass.
2. **Validity/manufacturability:** a part toleranced & inspectable here is a part that is *makeable & measurable*, not just watertight. The DFM interface (Cluster 3) hands off to this cluster's gauge/CMM check.
3. **Design→critique→repair (eAGI L4):** G2/G4/G5/G8 critique variants + G3/G9 self-correction make Archie an inspector of its *own* output — flag the illegal FCF, the unmeasurable datum, the misleading RSS, the below-POD weld — then fix and re-verify in-kernel. That is P-1 "error-detection + in-filling" applied to quality.
4. **Closed loop:** G9 (reverse-eng) + G1 (CMM evaluate) give Archie the *first-article* loop — build in Forge → "measure" → compare to GD&T → correct — which no chat model can do because it has no kernel to measure against. **Owned-kernel, deterministic, offline, free.**

### 3.4 Corpus scale & curriculum hook
| Generator | Target unique | Stage | Drives |
|---|---|---|---|
| G1 gdt_evaluate | ~400k | S3→S4 | interface axis, validity of PMI |
| G2 fcf_author | ~300k | S3 | interface axis (legal minimal PMI) |
| G3 tolstack | ~350k | S3→S4 | interface (assembles?), method judgment |
| G4 metrology_plan | ~250k | S4 | design-for-inspection, GUM |
| G5 ndt | ~200k | S4 | inspectability, honesty |
| G6 quality_stats | ~250k | S4 | SPC/MSA/DOE judgment |
| G7 rams | ~200k | S4 | reliability budget, fatigue coupling |
| G8 fmea | ~200k | S4 | AP, design-critique coupling |
| G9 reverse_eng | ~250k | S4 (+S1 fit) | first-article loop, intent recovery |
| **Cluster total** | **~2.4M unique** | — | interface axis ≥0.85 + L4–L5 critique/repair |

**Acceptance gate (folds into S3/S4):** GD&T/tolstack/FMEA/RAMS tool-calls schema-valid; **interface axis ≥0.85** on the jig smoke; tolstack `rssValid` honesty held (Archie reports MC as authoritative whenever the kernel does); GUM uncertainty budgets numerically consistent; reverse-eng deviation maps kernel-verified; no fabricated geometric pass where the kernel is PMI-text-only.

---

## 4. EXAMPLE TRAINING SAMPLES

### Sample A — True position with MMC bonus (kernel-grounded, interface-axis core)

**System:** You are Archie, an engineering CAD agent that drives Forge. Reason precisely, then verify every geometric claim with a kernel call.

**User:** A clearance hole is dimensioned Ø12.00–12.30, located at basic X40, Y25 in datum frame A|B|C, with positional tolerance Ⓘ Ø0.20 Ⓜ to A,B,C. The CMM measures the hole axis at X40.06, Y24.95 and the actual mating size at Ø12.22. Does it pass? Show the bonus and the allowed zone, then verify in the kernel.

**Ideal answer:**
This is a feature-of-size with an Ⓜ (MMC) positional callout, so the hole earns **bonus tolerance** as it departs MMC.

1. **MMC of the hole** = its *smallest* diameter = **Ø12.00** (least material removed → tightest). Stated positional zone at MMC = **Ø0.20**.
2. **Bonus** = departure from MMC = `actualSize − MMC = 12.22 − 12.00 = 0.22`. (HOLE@MMC bonus = actualSize − materialLimit, clamped ≥0 — Y14.5 §7.3.3.)
3. **Allowed zone Ø** = `0.20 + 0.22 = 0.42`.
4. **Position deviation (diametral)** = `2·√((40.06−40)² + (24.95−25)²) = 2·√(0.0036 + 0.0025) = 2·√0.0061 = 2·0.0781 = 0.156`.
5. **Verdict:** `Δ = 0.156 ≤ allowed Ø 0.42` → **PASS** (and it would *fail* a naive RFS read of Ø0.20 since 0.156 < 0.20 here it still passes, but at deviation 0.30 only the bonus saves it — that is the point of Ⓜ on a clearance hole).

Verifying with the kernel (the verdict is its output, not my arithmetic):
```
forge.native.gdtTruePosition({
  ax: 40.06, ay: 24.95,        // measured axis (in the DRF)
  tx: 40.00, ty: 25.00,        // basic/true location
  actualSize: 12.22,
  materialLimit: 12.00,        // MMC of a hole = smallest size
  positionTolDia: 0.20,
  mc: "MMC",
  ft: "HOLE"
})
// → { deviation: 0.1562, bonus: 0.22, allowedZoneDia: 0.42, pass: true }
```
**Senior note:** Ⓜ is correct here because this is a *clearance* hole — the bonus is real assembly slack and the feature is functional-gauge-able (virtual condition Ø11.80 must clear the mating pin). If this were a press-fit or bearing bore I would use **RFS** (no bonus) — and I would flag the FCF as illegal if someone applied Ⓜ to a non-feature-of-size form control.

---

### Sample B — Tolerance method selection: RSS quietly misleads (the named judgment)

**User:** A four-link gripper stack determines the jaw gap. Three contributors are machined (±0.05, normal, Cpk 1.33) and one is a molded pin slot with a uniform ±0.15 distribution that dominates; the gap is a non-linear function of the link angle. Spec on the gap is 1.0 ± 0.3 mm. Which tolerance method do I trust, and what's the yield?

**Ideal answer:**
**Do not trust RSS here.** RSS assumes (i) a *linear* transfer and (ii) a *sum of normals*. This stack breaks both: the gap is a **non-linear** function of link angle (a mechanism), and a **non-normal (uniform) contributor dominates** the variance. Under those conditions RSS linearizes about the operating point and assumes normality, so it **underpredicts the real spread** and overstates yield. The authoritative method is **Monte-Carlo** through the true non-linear transfer with each contributor's real distribution.

Run all three and read the validity verdict:
```
forge.native.tolstackAnalyze({
  contributors: [
    { name:"linkA", nominal:0, plusTol:0.05, minusTol:0.05, dist:"NORMAL",    sensitivity: ... },
    { name:"linkB", nominal:0, plusTol:0.05, minusTol:0.05, dist:"NORMAL",    sensitivity: ... },
    { name:"linkC", nominal:0, plusTol:0.05, minusTol:0.05, dist:"NORMAL",    sensitivity: ... },
    { name:"pinSlot", nominal:0, plusTol:0.15, minusTol:0.15, dist:"UNIFORM", sensitivity: ... }
  ],
  LSL: 0.7, USL: 1.3, k: 3, mcSamples: 200000, mcSeed: 12648430,
  transfer: <non-linear gap(angle)>, maxSecondDeriv: <|∂²gap/∂dim²|>
})
```
The kernel returns `rssValid:false` with `rssWarning` naming the cause (non-linear transfer AND a non-normal dominant contributor past the dominance threshold) and `authoritativeMc:true`. **I report `mcYield` (with `mcP01`/`mcP99`) as the truth, not `rssYield`** — exactly the failure mode Tolstack.hpp is built to catch. If `mcYield` misses the target, I fix the *dominant* contributor first (the molded slot, per the critical-path `varianceShare` ranking) — tightening the already-capable machined links would be wasted money.

**Senior note:** if the stack were linear and all-normal with ≥4 contributors, RSS would be valid and I'd prefer it (cheaper tolerances than worst-case while still hitting yield). Method choice is the judgment; the kernel's `rssValid` flag is the guardrail.

---

### Sample C — DFMEA failure mode coupled to GD&T + stack-up + reverse-eng loop (eAGI L4)

**User:** In the DFMEA for a bracket, an engineer wrote a failure mode "bracket fails inspection" with S=7, O=4, D=3, RPN=84, no action. Critique it and drive the fix in Forge.

**Ideal answer:**
Three problems, then the fix.

1. **"Fails inspection" is an *effect/detection state*, not a failure mode.** A failure mode is *how the part fails to deliver its function*. Restate as: **"Mounting-hole pattern mislocated beyond the positional tolerance,"** whose *effect* is "bracket will not bolt to mating frame (no assembly)" and whose *cause* is "drill-jig wear / fixture datum shift."
2. **RPN is deprecated (AIAG-VDA 2019).** Do not multiply S·O·D. With **S=7, O=4, D=3**, the **Action Priority** lookup gives **AP = Medium** — actions *should* be taken, so "no action" is non-conformant. (And if this were a safety-relevant S≥9 with O≥2, AP would be High regardless of D.)
3. **The fix is a tolerancing problem, not a paperwork problem** — this failure mode *is* a position-tolerance + stack-up issue, so I drive it in Forge:
   - **Prevention (lowers O):** verify the hole-pattern tolerance actually assembles. Re-run the bolt-circle stack to the mating frame with the kernel:
     `forge.native.tolstackAnalyze({...mating-frame chain..., LSL, USL})` → confirm yield, and if the mating uses clearance holes add Ⓜ for assembly bonus (`forge.gdt.position` with MMC) so the kernel's true-position check passes at the as-made size.
   - **Detection (lowers D):** add a *functional gauge / CMM first-article*: `forge.native.gdtTruePosition` over the four hole axes in the A|B|C frame, and a `forge.cmm.*` plan that aligns 3-2-1 to the *functional* datums — not a global best-fit, which would mask the very mislocation we're guarding against.
   - **Verify the realized part:** reverse-engineer a first article — `forge.reverse.plane`/`forge.native.surfitFit` on the scan → recovered hole axes → feed the same `gdtTruePosition` evaluator → deviation map. If any hole's Δ exceeds its bonus-allowed zone, the kernel flags it and I tighten the jig.
4. **Re-rate only what the action changed:** prevention drops **O 4→2**, the added gauge drops **D 3→2** → new **AP = Low**. S stays 7 (the effect severity is unchanged by a detection control — a senior never lowers S for a detection action).

**Senior note:** the DFMEA, the GD&T position frame, the assembly stack-up, and the first-article CMM/reverse-eng check are *one coupled problem*. The honest limit: profile-against-NURBS and irregular-datum contact solving are still PMI-text in the kernel, so for a *styled* mating face I'd state that the geometric profile verdict comes from the string/rule layer plus a scan deviation map, not a closed-form zone evaluator.

---

## 5. STORAGE-SAFE & TRAINING DISCIPLINE (cluster-specific reminders)

- **Programmatic only.** `bulk_synth_mechatronics.py` (G1–G5,G9 geometric) + `bulk_synth_plm.py` (G6–G8 quality/RAMS/FMEA) — never agent hand-authoring (40–60 ceiling vs ~2.4M here).
- **Kernel-in-the-loop generation** for G1/G3/G9: call `forge-kernel.node` to *make the answer keys*, write JSONL, **delete intermediate point clouds/scans immediately** (download→process→delete; scans are large — this is exactly where the M4 Max storage gets endangered).
- **No `--mask-prompt`** on long reasoning samples (NaN risk); NaN-guard + early-loss verify each run.
- **Chat template applied** at generation and inference (raw `--prompt` → garbled).
- **Honesty held:** every honesty-seed sample (PMI-text limit, scan-noise-vs-tolerance, below-POD, RSS-invalid) must survive the coherence/critic gate; a fabricated geometric pass is a corpus reject.
- **Serve fresh before eval** (output degrades over a session); track the **interface axis separately** (a 0.85 mean with weak interface FAILS the DoD).

---

## 6. TEN-LINE SUMMARY (for the corpus program / mission bible)

1. This cluster (GD&T, tolerance stack-up, metrology/CMM, NDT, QA/TQM, RAMS, FMEA, reverse-eng) is the **interface-axis lever** — the 0.4-weight CADGenBench dimension general models collapse on.
2. Knowledge spans bachelors→PhD→industry: ASME Y14.5-2018/Y14.5.1, ISO GPS, min-zone vs LS fitting, WC/RSS/Monte-Carlo with the *RSS-quietly-misleads* judgment, GUM uncertainty, NDT physics & POD, SPC/MSA/DOE, Weibull/RBD/FTA/Markov, AIAG-VDA AP (not RPN), ICP/RANSAC/Poisson reverse-eng.
3. **Kernel is already strong here:** `forge::native::gdt` does real Y14.5 math (DRF, true-position+MMC/LMC bonus, 8 characteristics min-zone, FCF legality); `forge::native::tolstack` does WC/RSS/MC + the `rssValid`/`authoritativeMc` verdict + GD&T-bonus coupling. Reverse-eng has native primitive fit + `surfitFit`.
4. **Grounding rule:** every geometric claim terminates in `forge.native.gdtTruePosition`/`gdtFlatness`/`tolstackAnalyze` (or the zone validators) — the kernel's output *is* the answer key, so the corpus can't be wrong.
5. **9 generators**, ~2.4M unique samples: gdt_evaluate, fcf_author, tolstack, metrology_plan, ndt, quality_stats, rams, fmea, reverse_eng — each emitting schema-valid `forge.*` calls.
6. **Honesty injected** where the kernel is PMI-text-only (profile-vs-NURBS, composite frame, irregular datum), where scan noise can't certify a tolerance, where a defect is below POD, and where RSS is invalid — never a fabricated geometric pass.
7. **Drives Forge, not chat:** Archie learns to place the hole at the right *basic* position with the right *Ⓜ* frame and confirm the *stack assembles* — and to critique/repair its own output (illegal FCF, unmeasurable datum, misleading RSS, below-POD weld) then re-verify in-kernel.
8. **Closed first-article loop** (build→"measure"→compare-to-GD&T→correct) is the owned-kernel, deterministic, offline advantage no chat model has.
9. **Lands S3 (GD&T/tolstack pulled forward for interface) + S4 (full cluster)**; gate: tool-calls schema-valid, interface ≥0.85 jig smoke, RSS-honesty held, GUM consistent, reverse-eng deviation kernel-verified.
10. **Storage-safe** (kernel-in-loop generate→write→delete scans immediately; no `--mask-prompt`; chat-template; serve fresh; track interface axis separately).

---

*Data sources cited as answer-key provenance only — standards & textbooks referenced, never scraped proprietary. Synthetic, kernel-grounded generation dominates (the deterministic owned-kernel advantage). Honor download→process→delete throughout.*
