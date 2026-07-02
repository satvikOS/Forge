# Community Research — Robotics / Mechatronics / Automation / Controls

**Cluster:** r/robotics, r/Mechatronics, r/PLC, r/ControlTheory, r/AskElectronics (mech-adjacent), r/IndustrialAutomation, r/ROS + professional controls/PLC forums (PLCtalk, Control.com, OpenRobotics Discourse).
**Date compiled:** 2026-06-21
**Method note:** Reddit serves JS to plain fetch and blocks direct `*.reddit.com` / `old.reddit.com` fetches in this environment (403 / "unable to fetch"), and `site:reddit.com` queries returned thin results. Findings are therefore triangulated from WebSearch result-snippets, professional forums that index well (PLCtalk, OpenRobotics Discourse, ControlDesign, ControlEng), engineer blogs/Medium first-person rants, vendor/integrator field reports, and arXiv survey papers that quote practitioner pain. Where a claim is forum/practitioner-sourced it is cited inline; where it is industry/academic context it is flagged as such. This is intentionally conservative about attributing exact Reddit quotes.

---

## 1. HOT / TRENDING TOPICS RIGHT NOW

### 1.1 Vision-Language-Action (VLA) models & embodied-AI foundation models — the dominant robotics conversation
The single loudest topic. VLA models "have become the dominant paradigm for robot intelligence" — ICLR 2026 received 164 VLA paper submissions, an **18x increase from 9 the prior year**; NVIDIA, Physical Intelligence (π), Google, Ant Group all shipped major VLA models. 2025 is being framed as the year robotics went "from cool demos to deployed at scale" (OpenAI, DeepMind, Tesla, Figure). VCs put **$7.2B into robotics in 2025** (up from $3.1B in 2023). [robocloud trends 2026, voxos.ai 2026, awesome-embodied-vla GitHub, dtsbourg predictions]
*Counter-current the community keeps raising:* the hype/reality gap — "policies that work 95% of the time in the lab drop to 60% in the real world," most humanoids last ~90 min on a charge, and even humanoid builders told WSJ (Dec 2025) they think the category is overhyped. [voxos.ai 2026]
**Forge/Archie hook:** Archie *is* an embodied/agentic model driving a CAD app via computer-use — the same "foundation-model-as-operator" thesis. The transferable lesson is that the community is converging on **natural-language → action-policy** as the interface; Archie's text-prompt → real-UI → geometry pipeline is on-trend, but the credibility bar is the same 95%→60% reliability gap. Forge should expose **deterministic, verifiable build steps** (the geometry-truth scorer already in the Mech program) so Archie's "policy" is checkable, not a 60%-in-the-wild black box.

### 1.2 Digital twins + virtual commissioning crossing from hype to standard practice
Strongest *automation-side* trend with real money behind it. LNS Research survey of 300 manufacturing execs: **75% had implemented or planned digital-twin initiatives**; vendors claim **up to 90% of PLC code validated before commissioning** and **commissioning-time cuts of 70-75%**. The framing has shifted from "future promise" to "concrete lever" (Automatica 2025). Tools repeatedly named: Rockwell **Emulate3D**, Siemens **SIMIT / NX MCD (Mechatronics Concept Designer)**, **Factory I/O**, Visual Components, **Vention**, Speedgoat (HIL). [Bonetto Group 2025, ControlEng, Vention, automate.org, controldesign.com, vintecc.com, hesconet.com]
**Forge/Archie hook:** This is the clearest greenfield for Forge. A digital twin = **physics-accurate kinematic/dynamic model that exchanges live I/O with controller logic in real time**. Forge already has an MIT-PhD-validated kernel (static/modal/CFD/HHT-α multibody DAE per the physics-rigor memory). To play here Forge needs: (a) **kinematic mechanism modeling with joints/constraints** (revolute/prismatic/cam/gear — partially present), (b) a **real-time I/O/signal bus** so an external PLC/soft-PLC can drive the model, (c) **sensor emulation** (limit switches, encoders, photo-eyes, vision), and (d) **deterministic scan-cycle-accurate stepping**. This is exactly the "mechatronics/digital-twin capability" the task asks about.

### 1.3 The "PLC scalability crisis" + AI-assisted PLC coding
Recurring: veteran controls engineers retiring, **~80% of machine application code is reused project-to-project**, yet engineers "spend most time deciphering existing code." Schneider, Siemens, Rockwell all pushing AI copilots for PLC code generation in 2025. [plcprogramming.io 2025/2026, Schneider blog 2025-11]
**Forge/Archie hook:** Mirrors Archie's value prop (LLM that authors deterministic engineering artifacts). A future Archie surface could be **controls-logic + mechanism co-generation** from a spec — but only if Forge models the mechanism the logic acts on.

### 1.4 Sim-to-real transfer / RL on real hardware (robotics)
Continuously discussed as *the* hardest robotics problem; "one of the hardest problems is how to make your model transfer to the real world." Practitioner stack pattern that keeps recurring: **Gazebo to prototype the ROS 2 nav/planning/perception stack → MuJoCo / Isaac Lab for RL training → Isaac Sim for synthetic data + visual domain randomization → deploy on real ROS 2 robot.** Domain randomization + higher-fidelity sim + actuator-fidelity modeling + "digital-twin pipelines" are the cited mitigations. [arxiv 2510.20808 reality-gap survey, lilianweng DR post, VnRobo/SVRC sim comparisons, arxiv 2501.02902]
**Forge/Archie hook:** Reinforces that **high-fidelity actuator + contact physics** is the moat. If Forge's kernel can export a physics-faithful twin (correct inertia, friction, joint limits, contact), it slots into the sim-to-real pipeline as the "authoritative model" upstream of Gazebo/Isaac.

### 1.5 Open / software-defined control vs. proprietary DCS-PLC lock-in
2025-2026 momentum toward open automation: "the gap between what proprietary DCS delivers and what operators need has grown wide enough to drive real change — vendor lock-in, decades of hardware obsolescence, and maintenance contracts... no longer tolerable." Standards in the conversation: **OPC UA** (vendor-neutral data/interoperability), **IEC 61499** (distributed event-driven control, portable function blocks), **PROFINET / EtherNet/IP / IEC 61850**. [IJITEE open-automation 2026, einnosys, aercoiot, urjasec Medium]
**Forge/Archie hook:** Interoperability is the price of entry. Forge's digital-twin surface should speak **OPC UA** (and ideally consume IEC 61131/61499 logic) so it isn't *another* island — the exact gripe engineers have about every vendor.

---

## 2. HARD TECHNOLOGIES — what engineers are excited about OR struggling with (the technically deep stuff)

### 2.1 The CAD → robot-description-format pipeline (URDF / SDF / USD / MJCF) — deeply broken, deeply technical
This is the most concrete, most actionable hard-tech finding for Forge. Four competing description formats (**URDF** = single-robot kinematics/dynamics; **SDF/SDFormat** = adds friction/physics/sensors/world; **USD** = Pixar/NVIDIA scene; **MJCF** = MuJoCo). Practitioner pain (OpenRobotics Discourse thread + arXiv "Understanding URDF" user-experience studies):
- The most-used **SolidWorks → URDF exporter (SW2URDF) "has been dead for 4 years" and only supports SW 2021**; OnShape-to-robot "simply doesn't work for more complicated robots"; tools "fail to load" on assemblies with "1000s of parts and 100s of joints." [OpenRobotics Discourse 36997]
- **Auto-exported URDF is "not very clean," hard to edit later**, and reuses the same dense mesh for *both* visual and collision geometry (kills sim performance). [petrikvandervelde blog, OpenRobotics Discourse]
- **Inertial properties** (mass, COM, inertia tensor) must be configured per-link and are a frequent source of silent error.
- **URDF cannot express closed-chain mechanisms** — links forming the loop must be detached in URDF and reassembled in SDF; "Extended URDF" papers exist precisely because parallel mechanisms aren't representable. [arxiv 2504.04767]
- Per-CAD-platform fragmentation: SolidWorks/Fusion360/OnShape each differ on **naming, joint definitions, and units handling**; OnShape needs API private-key generation. [OpenRobotics Discourse]
- Adding one sensor means editing "multiple places" across config files — no single source of truth between viz and sim.
**Forge/Archie hook — high priority:** Forge is a kernel-native CAD app; it can be the **clean, parametric source of truth** that current exporters fail to be. Capabilities: (1) first-class **URDF/SDF/USD/MJCF export** with correct kinematic tree, joint types, and limits; (2) **kernel-computed inertia tensors / COM / mass from solid geometry** (the kernel already does mass-props — expose it to the export); (3) **automatic convex-decomposition / mesh-decimation to generate collision geometry** separate from visual mesh; (4) **closed-chain / parallel-mechanism support** that the formats themselves choke on (Forge can represent the loop internally and emit the detach/reassemble workaround or USD which handles it); (5) units/naming normalization. This is a moat: nobody owns a maintained, kernel-accurate CAD→sim asset pipeline.

### 2.2 Mechatronic co-design: no joint data structure linking mechanical + electrical + control
The systems-engineering core pain. Practitioner/academic consensus: "there is **no integrated mechanism to seamlessly trace requirements down to multi-disciplinary design**," "**no joint data structure that interlinks the disciplinary data structures**," and document-based hand-offs cause "weak synchronization and inefficiencies that appear during integration or testing." Coupling between disciplines causes "explosion of complexity." [arxiv 2007.10962 modern mechatronic design, 2006.07790 fuzzy multicriteria, mechatronics-system blog]
**Forge/Archie hook:** This is the multidisciplinary-system-design ask verbatim. Forge would need a **shared parametric model that carries mechanical geometry + electrical/signal interfaces + control/behavioral intent** in one graph, with **requirement traceability** down to geometry. That is effectively lightweight MBSE bolted to a real geometric kernel — a combination nobody has (MBSE tools have no geometry; CAD has no requirements/behavior).

### 2.3 ECAD ↔ MCAD co-design & wiring-harness 3D routing
Concrete and well-defined. Engineers fight the seam between electrical (Altium, SolidWorks Electrical, Zuken) and mechanical CAD. Specific friction: SolidWorks "bundles every cable/wire on the same route into a single bundle" (loses per-wire fidelity); ECAD↔MCAD differs "significantly in 3D routing of cables/wires and component definitions"; success metric is **bi-directional sync** (ECAD→MCAD: connectors/wires/splices/topology; MCAD→ECAD: physical wire/cable/segment **lengths**) to "eliminate manual length estimation and reduce rework." [Altium ECAD-MCAD CoDesigner docs, Zuken harness blog, Altium automotive bridging]
**Forge/Archie hook:** Forge could host **3D harness/cable routing on the mechanical model** with bidirectional length feedback to an electrical netlist — directly attacking "manual length estimation" rework. Needs: routable conductor/bundle entities, connector placement tied to geometry, and a netlist/connectivity import (Altium/KiCad/SolidWorks Electrical formats).

### 2.4 Kinematics & motion planning internals (robotics)
Deep, specific complaints in the MoveIt/OMPL/ROS stack:
- **No continuous collision checking** in OMPL/MoveIt — the default checker just **discretizes the edge into sub-states** and can miss thin obstacles. [ROS docs, ompl docs]
- Collision via **FCL**; IK default is the **KDL numeric Jacobian solver** (slow/local-minima-prone) — community routinely swaps to TRAC-IK / analytic / QP-based collision-free IK (iKinQP) and flow-based vision IK. [moveit docs, arxiv 2308.15268, 2408.11293]
**Forge/Archie hook:** Forge's kernel already does exact geometry; **kernel-accurate continuous collision detection (swept-volume/CCD)** and **analytic/QP IK** would be differentiators for the digital-twin/robot-cell use case where the discretized OMPL checker is a known liability.

### 2.5 Control theory: MPC ⇄ RL convergence, safe-RL, and learning-based control
The technically-deep ControlTheory current: unifying **MPC and reinforcement learning** ("share principles... relate to Newton's method"), **safe RL** (Lagrangian/primal-dual, robust-MPC safety filters, Gaussian-process learned dynamics), **Bayesian optimization for auto-tuning MPC hyperparameters**, and RL-learned prediction horizons. Cited blocker: "**computational cost of MPC inside an RL loop**" and "**software hurdles to seamless integration of MPC and RL tools.**" [arxiv 2406.00592, 2504.01086 MPCritic, 2211.01860, 2102.11122]
**Forge/Archie hook:** Less direct to CAD, but the digital-twin surface is where a learned/MPC controller would be *validated* — Forge-as-plant-model in an HIL/SIL loop. The takeaway: controls engineers want a **trustworthy plant model to close the loop against**, which is exactly what a physics-accurate Forge twin provides.

### 2.6 ROS 2 middleware / DDS / build-system depth
Hard-tech struggle, heavily discussed: **DDS networking** ("nodes not communicating," intermittent connectivity under load, config complexity), **Ubuntu lock-in** (ROS 2 binds to specific Ubuntu+ROS pairs; Pi4→Pi5 upgrade cascaded into broken deps), **tool fragmentation** (rosdep vs colcon vs ros2 CLI), **C++/Python only** (FFI needed for other languages), dependency rot over long-lived projects. [Clearpath ROS2 networking blog 2025, Forrest Allison Medium rant, Shawn Hymel "when to use ROS2", ros2/ros2 issues]
**Forge/Archie hook:** Mostly out of scope (Forge isn't a robot runtime), *but* it warns against the same trap: if Forge exposes a digital-twin/co-sim bridge, keep it **standard (OPC UA / DDS / FMI) and not another fragile, version-locked island.**

### 2.7 Sensor integration / EMC / signal-integrity (AskElectronics, mech-adjacent)
Persistent low-level pain: encoder signals corrupted by motor ground currents and shaft-coupled noise from switching drives; remedies (differential line drivers, twisted-shielded pair, star grounding, shield grounded one-end, ≥12" separation from power) are tribal knowledge re-asked constantly. [encoder.com white paper, solomotorcontrollers, electro-tech-online thread]
**Forge/Archie hook:** Adjacent — argues for Forge to model **cable routing + separation/clearance rules** (signal vs. power keep-out distances) as a checkable constraint in the harness-routing surface (ties to 2.3).

---

## 3. PAIN POINTS / UNMET NEEDS / TOOL GRIPES — what makes them rage-quit

1. **PLC tools: bloat, no real offline test, sim≠reality.** TIA Portal called "incredibly heavy, bloated... useless on a laptop"; "systems perform flawlessly in simulation only to fail unpredictably on-site" (scan-cycle behavior PC sim doesn't capture); logical errors aren't caught by compilers; one lost pulse stops a process. [plctalk 107323 (snippet), licosplc debugging, plcprogramming.io 2025] **→ Forge:** scan-cycle-accurate, physics-grounded twin closes the sim≠reality gap that PC-only PLC sim can't.
2. **PLC version control is a nightmare — proprietary binary formats won't diff/merge.** The whole reason Copia/Git-for-PLC exists; ladder/structured-text live in vendor binaries that resist branching, diffing, reverting, and multi-dev collaboration. [Copia blog] **→ Forge/Archie:** anything Forge emits for controls/mechanism should be **text-serializable and diffable** (don't repeat the binary-blob sin).
3. **CAD→sim asset export is dead/broken** (see 2.1): flagship exporters abandoned, dirty output, wrong/missing inertia, no separate collision mesh, no closed-chain support, per-platform unit/naming chaos. Pure rage-quit territory for roboticists. **→ Forge:** owning a *maintained, kernel-accurate* exporter is a wedge.
4. **No single source of truth across disciplines** — mechanical, electrical, control, and requirements live in disconnected tools with document-based hand-offs; integration bugs surface late at test/commissioning. (2.2, 2.3) **→ Forge:** unified parametric model carrying geometry + interfaces + behavior + requirement trace.
5. **Vendor lock-in everywhere** — proprietary DCS/PLC, brand-locked robot offline-programming (RobotStudio/ROBOGUIDE/KUKA.Sim each one-brand-only), decades of hardware obsolescence, confidential protocols making integration "costly and difficult." [IJITEE 2026, electromate OLP, einnosys] **→ Forge:** be the brand-neutral layer; ingest/emit open formats (OPC UA, FMI, URDF/SDF, STEP, IEC 61131).
6. **ROS 2 onboarding & ops friction** — Ubuntu lock-in, DDS config hell, tool fragmentation, dependency rot (2.6). **→ Forge:** keep any co-sim bridge standards-based and low-friction.
7. **MoveIt/OMPL discretized collision checking misses thin obstacles; KDL IK is fragile** (2.4). **→ Forge:** kernel-exact CCD + robust IK.
8. **MBSE = paperwork that engineers abandon.** "Companies buy a modeling tool, do quick training, deadlines loom, official docs still required in Word/Excel, nobody rethought integration → engineers revert to old ways." Largest inhibitor is *culture*; tools also lack standard APIs (each needs custom adapters; SysML v2's REST/JSON API is the hoped-for fix). [one-sys.eu, arxiv 1709.00266, sodiuswillert] **→ Forge/Archie:** make systems-modeling a *byproduct of doing the real geometric/behavioral work*, not a parallel document chore — Archie can auto-maintain the model so engineers don't "revert to old ways."
9. **Mechatronic noise/EMC tribal knowledge** — encoder/sensor integration re-debugged from scratch every project (2.7). **→ Forge:** encode routing/clearance rules as checks.

---

## 4. EMERGING METHODS + DOMINANT TOOLS / STANDARDS

| Area | Emerging method | Dominant tools / standards | What Forge/Archie needs |
|---|---|---|---|
| Robot intelligence | **VLA / foundation models**, sim-to-real RL, domain randomization | π/Physical Intelligence, NVIDIA GR00T, Isaac Lab/Sim, MuJoCo, Gazebo, ROS 2 | Be the **authoritative physics twin** upstream of Gazebo/Isaac (correct inertia/friction/contact) |
| Automation | **Digital twin + virtual commissioning** | Emulate3D, Siemens SIMIT / NX MCD, Factory I/O, Visual Components, Vention, Speedgoat (HIL) | Real-time **I/O/signal bus**, sensor emulation, scan-accurate stepping, OPC UA |
| Robot description | URDF→**SDF/USD/MJCF** convergence; "Extended URDF" for parallel mechs | URDF, SDFormat, USD (NVIDIA), MJCF; SW2URDF (dead), onshape-to-robot, phobos, ACDC4Robot | **Clean kernel-accurate export** w/ inertia, separate collision mesh, closed chains |
| Mechatronic co-design | ECAD-MCAD **bi-directional sync**; harness 3D routing | Altium 365 + MCAD CoDesigner, SolidWorks Electrical, Zuken E3 | 3D harness routing w/ length feedback, netlist import, clearance rules |
| Systems eng | **MBSE / digital thread**, SysML **v2** (REST/JSON/RDF API) | Cameo/MagicDraw, SysML v2, ontologies | Lightweight requirement-trace + behavior bound to geometry; auto-maintained by Archie |
| Control | **MPC⇄RL unification, safe-RL, BO auto-tuning** | MATLAB/Simulink, do-mpc, acados, CasADi; HIL via Speedgoat/dSPACE | Trustworthy plant model for SIL/HIL loop closure |
| Interop | **Open/software-defined control** | **OPC UA**, IEC 61499, IEC 61131-3, PROFINET, EtherNet/IP, **FMI/FMU** for co-sim | Speak OPC UA + FMI; ingest IEC 61131/61499 logic |
| Robot programming | **Offline programming (OLP)** replacing teach-pendant | RoboDK (brand-neutral, 1200+ arms), RobotStudio/ROBOGUIDE/KUKA.Sim (brand-locked) | Brand-neutral cell sim w/ reachability + collision + cycle-time |

**The single biggest Forge wedge in this cluster:** a **kernel-accurate, maintained CAD→digital-twin pipeline** — clean URDF/SDF/USD/MJCF export with correct inertia and separate collision geometry, plus a real-time OPC-UA/FMI I/O bridge so the model becomes the virtual-commissioning + sim-to-real source of truth. It simultaneously hits the #1 automation trend (digital twin/VC), the most broken hard-tech (dead exporters), and the deepest pain (no cross-discipline source of truth) — and every incumbent fails on at least one of accuracy, maintenance, or brand-neutrality.

---

## Sources used
- Robotics trends 2026 — robocloud-dashboard.vercel.app/learn/blog/robotics-trends-2026; voxos.ai/blog/embodied-intelligence-robotics-2026; dtsbourg.me predictions; github.com/jonyzhang2023/awesome-embodied-vla-va-vln
- Digital twin / virtual commissioning — bonetto-group.com (2025-07); controleng.com; vention.io digital-twins blog; automate.org tech-papers; controldesign.com (55320796); vintecc.com; blog.hesconet.com (Emulate3D)
- ROS 2 pain — clearpathrobotics.com/blog/2025/01 networking; medium.com/@forrestallison ROS2 rant; shawnhymel.com 3302; github.com/ros2/ros2 issues
- Sim-to-real — arxiv 2510.20808 (reality-gap survey), lilianweng.github.io domain-randomization, arxiv 2501.02902, vnrobo.com / roboticscenter.ai sim comparisons
- CAD→robot-asset pipeline — discourse.openrobotics.org/t/.../36997; petrikvandervelde.nl URDF; arxiv 2302.13442 & 2308.00514 (Understanding URDF), 2504.04767 (Extended URDF); charitha94 Medium (SW2URDF); kikobot.com file types
- Motion planning internals — docs.ros.org / moveit.picknik.ai OMPL+FCL+KDL; ompl.kavrakilab.org; arxiv 2308.15268 (iKinQP), 2408.11293 (ViIK)
- Mechatronic co-design — arxiv 2007.10962, 2006.07790; mechatronics-system.blogspot.com
- ECAD-MCAD / harness — altium.com ECAD-MCAD CoDesigner docs + automotive bridging; zuken.com harness blog
- MBSE / SysML — one-sys.eu; arxiv 1709.00266; sodiuswillert.com; arxiv 2506.21608 (SysML v2)
- PLC pain / debugging — plctalk.net 107323 (snippet), licosplc.com debugging, plcprogramming.io 2025/2026 guides, schneider blog 2025-11, copia.io (git-for-PLC)
- Control MPC/RL — arxiv 2406.00592, 2504.01086 (MPCritic), 2211.01860, 2102.11122, 1906.04005
- Open automation / interop — IJITEE open-automation 2026; einnosys.com, aercoiot.com, urjasec Medium (OPC UA / IEC 61499 / protocols)
- Sensor/EMC — encoder.com WP2004; solomotorcontrollers.com; electro-tech-online.com encoder-noise thread
- Robot OLP — robodk.com/simulation; electromate.com OLP; robohub.org future-of-OLP
