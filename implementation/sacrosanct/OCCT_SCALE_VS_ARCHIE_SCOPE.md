# OCCT is 3M lines. What does Archie actually have to do?

**Prompted by the owner's OCCT scale brief (2026-08-31):** 7 modules, ~10,000 classes, hundreds of
thousands of member functions, >3M lines of C++, 4 Boolean operators over 4 core engines (GFA,
BOA, SA, SPA), 6 low-level interference ops. *"so understand Archie has to do all these."*

The scale is right. The conclusion needs splitting, because **three different questions are being
asked at once and they have wildly different answers.** Conflating them is how a programme spends
a year on the wrong one.

---

## The three questions

| | question | scale | on the critical path to benchmark wins? |
|---|---|---|---|
| **A** | What must Archie be able to **SAY**? | ~10² ops | ★**YES — this is the whole game** |
| **B** | What must the kernel be able to **DO**? | ~10² algorithms | Yes, and largely already true via OCCT |
| **C** | What must be **REIMPLEMENTED** to drop OCCT? | ~10⁶ lines | ★**No.** Strategic/IP goal, not a score lever |

### A — what Archie must SAY. Bounded, and small.

Archie emits a feature tree; the kernel executes it. The vocabulary it needs is the set of
**authoring operations**, not the set of C++ entry points that implement them.

★**The ground truth settles the ratio: `task_101` builds 329 faces and 753 edges from 14 ops.**
An op is a *feature* — a hub, a bore ring, a cast fillet — that expands into many faces. A complete
professional CAD authoring vocabulary is a few hundred operations. It is not 100,000 functions,
and it never was.

Forge's IR has **40 ops today, 28 user-invocable after PR #140.** The honest gap here is a couple
of hundred ops across the families being censused — sketch, surface, wireframe, direct modelling,
sheet metal, assembly — plus the missing value kinds. That is a real programme, and it is
*finite and scoped*.

### B — what the kernel must DO. Mostly already true.

OCCT's **Modeling Algorithms** module — the ~50 industrial algorithms — is the part that matters:
booleans, filleting, offsetting, sweeping, sewing, healing. Forge reaches these today *through
OCCT*, which is precisely why Archie's emissions already build.

★**The measured proof that capability is not the binding constraint:**
`FeatureTreeCompiler.cpp` calls `setForgeNativeBrepEnabled(false)` for every build, so **100% of
corpus booleans run on OCCT** — and Archie's emissions still produce a solid **80.8%** of the time
(485 of 600), pass the verifier outright **41.5%** of the time, and score only **+0.0547** over a
box floor. The kernel is not what is limiting the score. **The model's fidelity is.**

### C — what must be reimplemented to drop OCCT. This is the 3M lines.

This is where the owner's number actually lands, and it is measured (D-037):

* **ZERO of 14 toolkits are dropped.** `OCCT_CLOSURE = 14`, unchanged since the ledger began.
* **501 exclusive symbols remain**, and **404 of them are waves 6–13** — replacing `TopoDS_Shape`,
  `Handle(Geom_*)`, `Handle(Geom2d_Curve)`, `gp_*` and `Standard_*` as *interchange types*. That is
  not "porting algorithms", it is rewriting the type system the whole kernel speaks.
* The lattice is a **chain**: one toolkit is parent-free at a time, 13 waves, no parallelism.
* **Native DRAFT gates all thirteen waves** at 0.0% vs OCCT's 88.0%, p = 4.9e-150, with no bounded
  fix (all 565 parts violate *both* whole-shape guards; the count violating exactly one is zero).

**So question C is a multi-year commitment, and nothing in it moves a benchmark number.** It buys
independence, licensing freedom, and control over defects like the OCCT null-pcurve segfault that
crashes on our own gold reference parts. Those are real reasons. *Benchmark placement is not one
of them.*

---

## The concrete gaps the brief exposes — which are small, and checkable

Mapping the owner's taxonomy onto Forge's actual IR surfaces a short list, not a vast one:

| OCCT concept | Forge state | gap |
|---|---|---|
| **4 Boolean operators** (Fuse, Cut, Common, **Section**) | `FUSE`, `CUT`, `COMMON` present · **`SECTION` ABSENT from the IR entirely** | ★1 of 4 missing — not forbidden, *absent* |
| 4 boolean core engines (GFA/BOA/SA/SPA) | reached via OCCT `BOPAlgo_*` in `BooleanTol.cpp`, `Nurbs.cpp`, `Drawings.cpp`, `Weldments.cpp` | exposed only indirectly |
| 6 low-level interference ops (V/V, V/E, V/F, E/E, E/F, F/F) | not IR-addressable | no authoring need; a *diagnostic* need |
| Modeling Data — B-Rep topology | `PROFILE`, `SOLID`, `WIRE` only | ★no `SURFACE`, `SKETCH`, `ASSEMBLY`, `MESH` kind |
| Modeling Algorithms (~50) | most reachable via OCCT; 22 of 40 ops were unreachable from the UI | closing via #140 and the command tracks |
| Data Exchange (STEP/IGES/glTF/STL) | STEP works; rest unaudited | being censused |
| Visualization | ImGui + Vulkan shell exists | viewport track in flight |
| OCAF (document, undo/redo, dependency graph) | partial — `UndoStack`, feature tree | document-model track in flight |
| Draw Test Harness (Tcl) | no equivalent | ★arguably *should* exist — see below |

★**`SECTION` is the sharpest finding here.** It is one of the four operators every CAD kernel is
expected to have, it is absent from a 40-op table, and nobody noticed because no benchmark row
demanded it. That is exactly the kind of hole a systematic map against OCCT's own taxonomy finds
and an ad-hoc census does not.

★**The Draw Test Harness is worth stealing conceptually.** OCCT ships a scripting surface whose
purpose is to *drive the kernel headlessly and check it*. Forge's equivalent is `forge_verify` plus
the IR — which is to say Forge already has one, and it is the thing Archie speaks. Recognising that
the IR **is** Forge's Draw harness reframes it: the IR should be as expressive as the harness a
kernel developer would want, because that is the surface the model is programming against.

---

## What this changes

1. **Do not scope Archie against 3M lines or 10,000 classes.** Scope it against the authoring
   vocabulary, which is ~10². The 14-ops-to-329-faces ratio is the honest unit of work.
2. **Map the vocabulary against OCCT's own taxonomy rather than against our current corpus**, which
   is how `SECTION` went missing. A systematic map finds absences; a census of what we already do
   cannot.
3. **Keep question C sequenced behind the score work.** It is a legitimate strategic goal with a
   measured multi-year shape, and it competes for the same engineers.
4. **The fidelity problem remains the binding constraint.** 41.3% of failures are the model
   asserting a property its own construction does not satisfy. No amount of kernel surface fixes
   that.
