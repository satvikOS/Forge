# Community Research — MANUFACTURING / CNC / SHOP FLOOR

**Cluster:** r/Manufacturing, r/CNC, r/Machinists, r/MachinE, r/Hobbymachinist, r/Metalworking, r/Welding, r/Casting, r/InjectionMolding, r/Machinist + Practical Machinist forums, CNCzone, GrabCAD community.
**Date:** 2026-06-21
**Mission:** Mine what real shop-floor people struggle with / are excited about / wish their tools did, to steer Forge (MCAD/CAM/CAE on in-house C++20 kernel) and Archie (14B model that drives Forge via computer-use).

> **Method note:** Reddit's `reddit.com`, `old.reddit.com`, and its JSON endpoints are all blocked for direct fetch in this environment, and `site:reddit.com` queries returned nothing useful. Practical Machinist returned 403 on direct fetch after the first hit. I therefore triangulated via WebSearch result-summaries (which surface forum thread bodies), DFM/CAM vendor knowledge bases, and industry-trend reporting, and cite the actual threads/sources I drew from. The substance below is corroborated across multiple independent sources; where a specific Reddit/PM thread is the origin it is named.

---

## 1. HOT / TRENDING TOPICS RIGHT NOW

### 1.1 AI is "coming for CAM" — autonomous toolpath + instant quoting
This is the single biggest live debate in r/CNC / r/Machinists / Practical Machinist right now. Tools like **Toolpath** and **CloudNC CAM Assist** generate full 3-axis milling strategies + cycle-time + cost estimates in minutes, holistically analyzing the whole setup (stock, fixtures, owned tooling) rather than feature-by-feature. CloudNC cites 2,400 customers on autonomous 3-axis milling; Red Bull Powertrains reportedly cut a gearbox-housing program from 3 days to 11 minutes. Shop sentiment splits hard: programmers fear replacement; owners want the throughput. "AI-generated G-code" is being called the default for Tier-1 shops in 2025.
- **Forge/Archie capability needed:** This is *exactly* Archie's thesis — but Archie must beat these by being **DFM-aware at design time AND CAM-aware at program time in one kernel**. Archie should ingest a body, propose a setup plan (stock, datums, fixtures, op sequence), generate verified toolpaths, AND return a defensible cost/cycle estimate using the shop's owned tool library. The differentiator vs Toolpath/CloudNC: Archie also *edits the design* to be cheaper, not just programs the existing one.
- Sources: [engineering.com: AI comes for CAM](https://www.engineering.com/ai-comes-for-cam-toolpath-generation-custom-dfm-and-quick-cost-estimates/), [Toolpath](https://toolpath.com/ai-cam-platform), [CloudNC CAM Assist](https://www.cloudnc.com/blog/ai-powered-cam-automation-cnc)

### 1.2 Fusion 360 personal-use restrictions → ongoing migration/rage
Autodesk's tightening of the free "Personal Use" tier is a perennial rage topic that flared again in 2025. Restrictions that hit hobby/job-shop people: **no STEP/IGES/SAT/DXF export** (interchange formats gone), **rapid feedrate clamped to cutting feedrate** (so simulated/real cycle times are wrong and rapids run slow), **no automatic tool change**, **no 3+2 / 4-axis / 5-axis simultaneous CAM**, and a **10-document limit**. Real Tormach/Langmuir/Maslow CNC owners on CNCzone and vendor forums report this directly breaking their workflows.
- **Forge/Archie capability needed:** **Lossless, free STEP/IGES export and full multi-axis CAM with no artificial feed/tool-change clamps.** This is a wide-open wedge: "the CAM that doesn't cripple your rapids or paywall your STEP." Native, complete STEP AP242 read/write is table-stakes credibility.
- Sources: [Autodesk: Changes to Fusion for personal use](https://www.autodesk.com/products/fusion-360/blog/changes-to-fusion-360-for-personal-use/), [CNCzone: New Fusion 360 limitations](https://www.cnczone.com/forums/tormach-personal-cnc-mill/410028-new-fusion-360-limitations.html), [Langmuir: Fusion rapids limit](https://forum.langmuirsystems.com/t/fusion-rapids-limit/10624)

### 1.3 Reshoring + the machinist shortage = automation pressure
433,000 US manufacturing openings (Dec 2025); Deloitte/Manufacturing Institute project up to 2.1M unfilled jobs by 2030. 327,000 jobs reshored in 2024 (record). 95% of US industrial businesses plan new automation within 3 years. The hottest practical thread topic: **cobots tending CNC machines, in-machine probing, lights-out/after-hours running** — "do more with fewer skilled people." CAM programmers and experienced machinists are the most acute shortage. The recurring tension: reshoring more work while losing the people who know how to make it.
- **Forge/Archie capability needed:** Archie as the "missing experienced programmer/methods engineer" — encode the retiring veteran's tribal knowledge (feeds/speeds, setup tricks, fixturing, which features to flag). First-class **in-machine probing/measurement plans** and **lights-out/automation-aware program generation** (predictable, collision-checked, with mid-process verification).
- Sources: [Kent USA: Machining Trends 2026](https://kentusa.com/machining-trends-in-2026-automation-workforce-challenges-and-reshoring/), [A3 Automate: labor shortage](https://www.automate.org/blogs/manufacturing-labor-the-crisis-still-continues), [SupplyChain247: 95% automation by 2028](https://www.supplychain247.com/article/us-factories-automation-reshoring-labor-shortages-2025)

### 1.4 Hybrid (additive + subtractive) manufacturing going mainstream
Meltio/DMG Mori/Mazak driving a ~$3.1B hybrid market; ~97% material-waste reduction claims; converting an existing CNC to hybrid costs ~¼ of a turnkey additive cell, so job shops are getting in. Print-near-net then machine-to-tolerance in one setup is the appeal (10 weeks → 72 hours case studies). The repeated complaint: **programming is the hard part** — few programmers understand both the additive deposition side and the subtractive side.
- **Forge/Archie capability needed:** Archie that plans **near-net additive deposition + finish-machining toolpaths together**, reasoning about which surfaces get printed oversize and which get machined to GD&T. Needs the kernel to represent stock-as-printed vs finished body and a unified hybrid op planner.
- Sources: [All3DP Pro: hybrid 10 weeks→72 hours](https://all3dp.com/4/from-10-weeks-to-72-hours-the-power-of-hybrid-manufacturing-3d-printing-cnc-machining/), [UnisonTek: CNC meets metal 3D printing](https://unisontekco.com/the-rise-of-hybrid-manufacturing-cnc-meets-metal-3d-printing/)

### 1.5 The eternal CAM holy-war: Fusion vs Mastercam vs SolidCAM
Active on Practical Machinist and the SolidCAM forum. Consensus pattern: Fusion is stronger CAD + cheaper (subscription), Mastercam is stronger/more trusted CAM but pricey and **forces paid post-processors** (Autodesk gives posts away free). SolidCAM-in-SolidWorks praised for "set parameters, verify, auto-generate." Post-processor reliability is the universal sore spot — a bad post nearly crashed a machine.
- **Forge/Archie capability needed:** A **transparent, free, editable post-processor system** with a verified library per controller (Fanuc/Haas/Siemens/Heidenhain/Mazak), plus machine simulation that catches post bugs before the spindle moves.
- Sources: [Practical Machinist: Fusion 360 vs Mastercam](https://www.practicalmachinist.com/forum/threads/fusion-360-vs-mastercam.402985/), [SolidCAM forum: SolidCAM vs Fusion 360](https://forum.solidcam.com/forum/competitors/1615-solidcam-vs-fusion-360)

---

## 2. HARD TECHNOLOGIES — EXCITED ABOUT / STRUGGLING WITH (the technically-deep stuff)

### 2.1 Multi-axis (3+2 and full 5-axis simultaneous) toolpaths
The deep-end skill. CAM tools that do it well (PowerMill, hyperMILL) are expensive with steep learning curves requiring real understanding of 5-axis motion, tool-axis control, and collision/gouge avoidance. Fusion is the "affordable on-ramp" but the personal tier locks out simultaneous milling. This is where programmers feel the skills gap most.
- **Forge/Archie need:** Robust **gouge/collision-checked 5-axis simultaneous toolpath generation with tool-axis control (lead/lag, tilt)**, swarf/flowline machining, and full holder/fixture collision simulation. Hard kernel + CAM problem; a genuine moat if solved well.
- Source: [TwoTrees: Best CAM for 5-axis](https://twotrees3d.com/blogs/twotrees-blog/best-cam-software-for-5-axis-cnc-routers-power-precision-and-control)

### 2.2 GD&T done *correctly* (not just present)
Recurring expert refrain on Practical Machinist: **"improperly used GD&T is worse than none."** Thousands of prints from hundreds of companies show GD&T applied wrong. Over-decorated drawings get no-quoted or astronomically quoted — not because precision is hard but because shops can't read mis-applied datum/perpendicularity callouts. Datum-reference-frame logic, MMC/LMC bonus tolerance, and feature-control-frame validity are the deep technical sticking points on both sides.
- **Forge/Archie need:** A **real geometric GD&T evaluator** — validate that feature control frames are legal (datums exist, are properly ordered, callout matches feature type), compute MMC/LMC bonus tolerance, and verify a measured/sampled part against the tolerance zone geometrically (not just store PMI as metadata). *Note from internal memory: kernel currently binds PMI/tolerance but has NO geometric FCF evaluator — this is the gap the community most validates.*
- Sources: [Practical Machinist: GD&T thread](https://www.practicalmachinist.com/forum/threads/geometric-dimensioning-and-tolerancing.386714/), [GD&T Basics](https://www.gdandtbasics.com/), [Eng-Tips: Machining GD&T workflow](https://www.eng-tips.com/threads/machining-gd-amp-t-parts-workflow.492639/)

### 2.3 Tolerance stack-up analysis
Closely tied — engineers over-tolerance because they don't run real stack-ups, and machinists eat the cost. Veterans explicitly tell young engineers to learn **tolerance analysis + GD&T** as the two highest-leverage skills. Worst-case vs RSS stack-up, datum-shift contributions, and "which dimension actually needs to be tight" are the hard parts.
- **Forge/Archie need:** Built-in **1D/2D/3D tolerance stack-up** (worst-case + statistical/RSS), automatic identification of the critical-path dimensions, and an "is this tolerance actually necessary for function?" check that proposes loosening non-critical dims to cut cost.
- Source: [Practical Machinist: New Engineer Advice](https://www.practicalmachinist.com/forum/threads/new-engineer-advice.429402/)

### 2.4 STEP/IGES interchange fidelity (the data-exchange tax)
Huge GrabCAD pain corpus: imported STEP/IGES arrives with **broken/missing surfaces, dropped tiny features, non-manifold edges/vertices**, sometimes crashing the import or failing simulation ("no valid geometry"). Small features get dropped as anomalies by the import engine; healing requires tuning gap tolerances; **STEP AP203 does not carry tolerance/PMI**. Round-tripping between CAD systems silently corrupts geometry.
- **Forge/Archie need:** **Best-in-class STEP AP242 import/export** (geometry + PMI + assembly structure), robust **automatic heal/stitch/repair** (gap closing, non-manifold fix, sliver-face removal) with reported diagnostics, and lossless round-trip. This is a credibility moat: "Forge opens the file everyone else mangles."
- Sources: [GrabCAD: broken iges/stp](https://grabcad.com/questions/why-cad-data-that-i-convert-in-iges-or-stp-are-broken-when-open-in-other-software), [GrabCAD: non-manifold recovery](https://grabcad.com/questions/which-non-manifold-surface-modeling-file-is-best-to-recover), [GrabCAD: no valid geometry for simulation](https://grabcad.com/groups/solidworks-design-help/discussions/no-valid-geometry-when-importing-cad-files-from-other-software-to-perform-simulation)

### 2.5 In-machine probing & metrology
Trending as both cost-saver and quality gate: probing finds errors early, sets work offsets, and enables unattended running. Tied to the labor-shortage automation push. Programming probing cycles and interpreting results (especially against GD&T) is non-trivial.
- **Forge/Archie need:** Generate **on-machine probing routines** (datum pickup, in-process verification, post-machining inspection) and tie measured results back to the GD&T tolerance zones from §2.2 for pass/fail.

### 2.6 Hard-to-machine materials (316/Ti/Inconel) — physics of cutting
Deep, oft-debated: 304 (machinability ~70) vs 316 (~60, work-hardens 15% faster, needs sharp tools); Inconel 718 the canonical nightmare (rapid work-hardening, severe tool wear); titanium (low thermal conductivity concentrates heat at the edge, low modulus springs away from the tool). Engineers picking 316/Ti/Inconel for corrosion without considering machinability is a classic "wrong material" complaint.
- **Forge/Archie need:** A **material-aware feeds/speeds + machinability model** and a material-selection advisor that surfaces the machinability/cost penalty of a corrosion-driven choice ("316 buys you marine corrosion resistance at +15% work-hardening and 2× tool wear vs 304 — confirm you need it").
- Sources: [Hobby-Machinist: 304 vs 316](https://www.hobby-machinist.com/threads/machining-stainless-steel-304-vs-316.116524/), [Machining Doctor: stainless machinability](https://www.machiningdoctor.com/machinability/stainless-steel-2/)

---

## 3. PAIN POINTS / UNMET NEEDS / TOOL GRIPES (what makes them rage-quit)

> The cluster's defining gripe: **"engineers who've never touched a machine."** Threads like Practical Machinist's *"Engineers: A machinist's worst nightmare"*, *"Tips for engineers from machinists"*, *"What do you want young engineers/designers to know?"*, and *"The worst drawings I have ever seen"* are the canonical corpus. This is the exact knowledge Archie must encode to never emit an unmakeable part.

### 3.1 Over-tolerancing / unnecessary precision (the #1 rage)
The most common drawing mistake. Examples cited: ±.0001" general tolerances and 4-decimal dims everywhere; ±.0005" clearance holes for #10 wood screws into a wood top (impossible to hold and pointless). Over-toleranced prints get no-quoted or priced astronomically. Root cause: lack of system understanding or a hurried draftsman defaulting to tight tolerances "to be safe."
- **Archie must:** Default to **process-appropriate tolerances**, tighten ONLY function-critical features, and refuse/flag tolerances that exceed the chosen process capability. Tie tolerance to the §2.3 stack-up (only tighten what the stack needs).
- Sources: [Practical Machinist: GD&T helpful or not](https://www.practicalmachinist.com/forum/threads/ot-geometric-dimensioning-tolerancing-helpful-or-not.79112/), [Practical Machinist: worst drawings](https://www.practicalmachinist.com/forum/threads/the-worst-drawings-i-have-ever-seen.374982/)

### 3.2 Sharp internal corners that can't be milled
A rotating cutter physically cannot cut a sharp inside corner — **minimum internal radius = cutter radius**. Designers draw zero-radius internal corners constantly. Workarounds (dog-bone/T-bone fillets, EDM ~0.005" radius, broaching) all add cost; EDM/broach only when function demands it.
- **Archie must:** **Never emit a sharp internal corner** on a milled feature without an explicit radius ≥ a sane cutter radius; auto-suggest dog-bone relief for mating sharp-corner fits; escalate to EDM/broach only when function requires and flag the cost.
- Sources: [Make It From Metal: square inside corners nightmare](https://makeitfrommetal.com/machining-square-inside-corners-the-nightmare/), [Protolabs/Hubs: sharp corners](https://www.hubs.com/knowledge-base/sharp-corners-in-cnc-machining/)

### 3.3 Deep pockets / thin walls / tool reach (deflection & chatter)
Long, slender tools flex → tapered walls, poor finish, expensive rework. Rules of thumb the community enforces: **pocket depth:width keep ≤3:1** (standard tools), up to 6:1 only with extended tooling + reduced feeds + extra cost; **unsupported wall height:thickness ≤4:1** or it deflects/chatters (50–70% slower feeds, +40–80% cycle time). Shank rubbing on pocket walls if reach is excessive.
- **Archie must:** Encode **depth:width and wall height:thickness ratios per process**, flag/redesign features exceeding them, and reflect the cycle-time/cost penalty when extended-reach tooling is forced.
- Sources: [Trustbridge: deep pockets/thin walls/undercuts](https://www.trustbridge.pro/blogs/post/why-does-my-cnc-machining-cost-so-much-%E2%80%94-and-can-a-design-change-fix-it1), [Approved Machining: thin-wall limits](https://www.approvedmachining.com/blog/thin-wall-thickness-limits-for-cnc-machined-parts), [MakerStage: walls/pockets/threads](https://www.makerstage.com/resources/cnc-design-guidelines)

### 3.4 Surface-finish over-specification
Calling Ra 8 µin where Ra 32 µin would work; mirror/lap finishes specified casually. Each step down in roughness adds polish/grind/lap operations and cost. Machinists rage at finish callouts that don't match the part's function or the primary process capability.
- **Archie must:** Hold finish callouts to **process-attainable Ra by default**, flag finishes finer than the function requires, and surface the added-operation cost (e.g., "Ra 8 needs lapping — confirm sealing/optical/bearing requirement").
- Source: [engineeringproductdesign.com: surface finish](https://engineeringproductdesign.com/knowledge-base/surface-finish/)

### 3.5 Tapped/blind-hole callouts that break taps
Tapping blind holes blows up taps when there's **insufficient clearance below the threads** (tap jams on the bottom) and chips pack in the flutes recutting. Veterans' explicit tip: **make it a through-hole unless a bottoming tap is truly required**; for deep/blind/hard material use a spiral-flute tap or thread-mill. Engineers spec full-depth threads in shallow blind holes constantly.
- **Archie must:** Add **thread relief / extra drill depth below thread**, prefer through-holes when wall thickness allows, default to thread-milling for deep/blind/hard-material threads, and never call a thread depth that leaves no chip clearance.
- Sources: [CNCCookbook: blind-hole tapping secrets](https://www.cnccookbook.com/blind-hole-tapping-secrets/), [Practical Machinist: tips for engineers (through-hole tip)](https://www.practicalmachinist.com/forum/threads/tips-for-engineers-from-machinists.249877/), [CTE: tapping deep holes](https://ctemag.com/articles/tapping-deep-hole/)

### 3.6 Fixturing / workholding ignored at design time
"How will this even be held/probed?" is a top machinist gripe. Parts with no flat reference, no datum that can be clamped, or features that require impossible re-fixturing to reach. Veterans tell engineers: think about workholding and whether the part can be made easier to hold/probe **without changing design intent**.
- **Archie must:** Reason about **setups and workholding as a first-class step** — identify clampable faces/datums, count required setups, and prefer geometry reachable in fewer setups. A part Archie designs should come with an implicit "here's how it's held."
- Source: [Practical Machinist: what young engineers should know](https://www.practicalmachinist.com/forum/threads/what-do-you-want-young-engineers-designers-to-know.398563/)

### 3.7 Drawings missing info / no annotation of intent
Beyond tolerances: machinists complain engineers **under-annotate** — no datums, no notes on why a decision was made, ambiguous groove/weld symbols, missing critical dims. "A drawing is the language used to talk to the shop." Incomplete weld symbols force the fabricator to guess.
- **Archie must:** Emit **complete, unambiguous drawings/PMI** — datums, fully-defined feature control frames, complete weld symbols (side, size, length, all-around vs intermittent), and intent notes. Nothing left for the shop to assume.
- Sources: [Practical Machinist: tips for engineers](https://www.practicalmachinist.com/forum/threads/tips-for-engineers-from-machinists.249877/), [Structure Mag: commonly misapplied weld symbols](https://www.structuremag.org/article/commonly-misapplied-welding-symbols/)

### 3.8 Cost estimation / quoting is mostly guesswork
The shop reality: #1 quoting "tool" is a **spreadsheet**, #2 is **"eyeball guestimate"** by an experienced machinist. CAM cycle time ≠ real time — load/unload, deburr, inspect, and an ~80% efficiency factor mean **real time ≈ 1.5–2× CAM time**. Setup amortization (batch size) is the single biggest per-part lever. Pricing is stressful and error-prone; bad quotes lose money or lose jobs.
- **Archie must:** Produce **defensible quotes** = material + (machine_time × rate) + setup + finishing, with the **1.5–2× CAM→real-time correction**, batch-size amortization, and the shop's actual rate/tooling. This directly answers the "instant quote" trend in §1.1.
- Sources: [CNCCookbook: cost estimation rates](https://www.cnccookbook.com/machining-manufacturing-cost-estimation-quotes-rates/), [CNCCookbook: quoting survey results](https://www.cnccookbook.com/job-quote-cost-estimation-survey-results/), [Practical Machinist: cost estimation](https://www.practicalmachinist.com/forum/threads/cost-estimation.410407/)

### 3.9 Post-processor pain
Bad/incompatible posts produce wrong G-code that crashes machines; Mastercam charging for posts Autodesk gives free. A live, trust-eroding pain across the CAM holy-war.
- **Archie must:** Ship a **verified, transparent, editable post library per controller** with machine simulation that validates the post output before cutting.

### 3.10 Wrong material for the job
Engineers spec 316/Ti/Inconel for corrosion, exotic/uncommon alloys "to be safe," creating machinability and cost blowups (see §2.6). The deeper complaint is **ego over experience** — not asking the shop before committing.
- **Archie must:** Be the always-available "ask the shop" — flag machinability/cost penalties of material choices and suggest the cheaper-to-make alternative that still meets the functional spec.

---

## 4. EMERGING METHODS + DOMINANT TOOLS/STANDARDS

### 4.1 Process-specific DFM rule sets are converging (and quantified)
The community now treats DFM as quantified rules, not vibes. **Injection molding:** uniform wall thickness is the #1 rule; ribs/bosses **40–60% of nominal wall** or they sink; **boss OD 2–2.5× hole dia**; gradual **3:1 wall transitions**; wall variation >25% causes sink/warp; **draft ~3° (light texture) / 5°+ (heavy texture)**, undercuts need side-actions/cores. **Sheet metal:** inside bend radius **≥ material thickness** (2× for brittle 6061-T6); hole-to-bend **≥ 1.5–2.5× thickness + R**; **K-factor mismatch** between CAD defaults (0.33/0.5) and shop die width is the #1 cause of wrong flat patterns. **CNC:** the §3 ratios (corner radius, pocket 3:1, wall 4:1, thread relief).
- **Forge/Archie need:** A **parametric DFM rule engine per process** (molding / sheet metal / CNC / casting / welding) that runs continuously during Archie's design and at quote time — the same engine that powers both "don't emit unmakeable geometry" and the manufacturability report.
- Sources: [Protolabs: uniform wall thickness](https://www.protolabs.com/resources/design-tips/improving-part-design-with-uniform-wall-thickness/), [Manufyn: ribs & bosses](https://manufyn.com/resources/design-guides/injection-molding/ribs-bosses/), [Protolabs: draft](https://www.protolabs.com/resources/design-tips/improving-part-moldability-with-draft/), [JLC: sheet metal design](https://jlccnc.com/blog/sheet-metal-design), [Prime Custom Parts: hole-to-bend](https://primecustomparts.com/how-far-should-a-hole-be-from-a-sheet-metal-bend/)

### 4.2 Casting DFM as a distinct rule domain
Foundry-specific: **shrinkage allowance is material-specific** (gray iron 0.6–1.0%, aluminum bronze 2.0–2.5%, stainless 2.0–2.5%) — patterns must be made oversize; avoid **isolated thick sections** (they can't feed → shrinkage porosity/tearing); **draft, parting line, undercuts→cores, uniform cross-sections, generous fillets at junctions** are the 8 canonical elements. Engineers who design castings like machined solids create porosity and uncastable undercuts.
- **Forge/Archie need:** A **casting-aware modeler**: apply material-specific shrink scale to the pattern, detect hot-spots/isolated thick sections (thermal-modulus check), auto-add draft and fillets, flag undercuts needing cores, and verify directional solidification feeding.
- Sources: [BONACE: casting shrinkage rates](https://www.hardwarecustom.com/metal-casting-shrinkage/), [engineeringproductdesign.com: sand casting considerations](https://engineeringproductdesign.com/key-sand-casting-design-considerations/), [ZHY Casting: shrinkage porosity geometry](https://www.zhycasting.com/optimizing-casting-geometry-to-reduce-shrinkage-porosity/)

### 4.3 Welding DFM + distortion control
Emerging emphasis: **weld access** (torch-angle reachability), **distortion management** (uneven heating/cooling pulls parts out of tolerance → use intermittent/skip welds, not one long bead; don't spec weld-all-around unless functionally needed), correct **weld-symbol side/supplementary info**, and full **joint/bevel prep definition** (incomplete groove callouts force fabricator guesses). Load path + accessibility + thickness + distortion-sensitivity drive weld-type choice.
- **Forge/Archie need:** **Weld feature modeling** with torch-access checking, distortion-aware sequencing (intermittent/balanced welds), complete weld-symbol generation, and joint-prep (bevel) definition. Tie to CAE for weld distortion prediction.
- Sources: [Structure Mag: misapplied weld symbols](https://www.structuremag.org/article/commonly-misapplied-welding-symbols/), [Medium: 5 welding design mistakes](https://medium.com/@kenneth.williams/5-common-welding-design-mistakes-and-how-to-avoid-them-bbae3960006b), [Fictiv: sheet metal welding](https://www.fictiv.com/articles/sheet-metal-welding-design-guide)

### 4.4 Dominant tools & standards to interoperate with (be honest about the incumbents)
- **CAD:** SolidWorks, Fusion 360, Creo, NX, CATIA, Inventor.
- **CAM:** Mastercam (production king, paid posts), Fusion CAM (cheap on-ramp), SolidCAM (in-SW), PowerMill / hyperMILL (high-end 5-axis, expensive/steep).
- **AI-CAM challengers:** Toolpath, CloudNC CAM Assist (the §1.1 wave Archie is racing).
- **Interchange standards:** **STEP (AP203/AP214/AP242)** is the lingua franca — **AP242 carries PMI/GD&T**, AP203 does NOT carry tolerance; IGES legacy/leaky; DXF for 2D/sheet-metal flats; STL/OBJ for additive; G-code (controller-specific dialects: Fanuc/Haas/Siemens-Sinumerik/Heidenhain/Mazatrol).
- **GD&T standard:** ASME Y14.5 (and ISO GPS).
- **Forge/Archie need:** First-class **STEP AP242 (with PMI)** read/write is the credibility gate; controller-aware G-code posts; ASME Y14.5-correct GD&T generation/validation. Interop with these formats is non-negotiable for adoption.
- Sources: [GrabCAD: does STEP AP203 include tolerance](https://grabcad.com/questions/does-step-ap203-include-tolerance-information), [Practical Machinist: Fusion vs Mastercam](https://www.practicalmachinist.com/forum/threads/fusion-360-vs-mastercam.402985/)

---

## 5. SYNTHESIS — The manufacturability knowledge Archie MUST have to never emit an unmakeable part

A prioritized DFM-rule kernel, drawn directly from what this cluster rages about:

1. **Tolerances:** process-capable by default; tighten only function-critical (stack-up-driven); never exceed process capability. (§3.1)
2. **Internal corners:** always a radius ≥ cutter radius on milled features; dog-bone relief for mating sharp fits. (§3.2)
3. **Reach geometry:** enforce pocket depth:width ≤3:1, wall height:thickness ≤4:1; cost-penalize extended reach. (§3.3)
4. **Surface finish:** process-attainable Ra by default; flag finer-than-functional. (§3.4)
5. **Threads/holes:** through-holes preferred; thread relief + extra drill below thread; thread-mill deep/blind/hard. (§3.5)
6. **Workholding:** design with clampable datums and minimum setups in mind. (§3.6)
7. **Complete drawings/PMI:** datums, legal feature control frames (ASME Y14.5), complete weld symbols, intent notes. (§2.2, §3.7)
8. **Material:** flag machinability/cost penalty of corrosion-driven exotic picks; suggest cheaper-to-make equivalents. (§3.10, §2.6)
9. **Process-specific rules:** molding (uniform wall, 40–60% ribs/bosses, draft, transitions), sheet metal (bend radius ≥ t, hole-to-bend, K-factor↔die width), casting (material shrink scale, no isolated thick sections, draft/cores), welding (access, distortion, joint prep). (§4.1–4.3)
10. **Cost/quote:** material + machine_time×rate + setup + finishing, with 1.5–2× CAM→real-time and batch amortization. (§3.8)
11. **Geometric GD&T evaluator** (legal FCFs, MMC/LMC bonus, verify part vs tolerance zone) — the validated #1 capability gap. (§2.2)
12. **STEP AP242 + robust import-heal/repair** — open and round-trip the files everyone else mangles. (§2.4)

The strategic wedge: every AI-CAM competitor (Toolpath, CloudNC) programs the *existing* part. Archie's defensible edge is **fixing the design to be makeable AND programming it AND quoting it in one DFM-aware kernel** — being the retiring veteran machinist + methods engineer the shortage created.
