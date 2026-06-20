# External Reference — "Project Prometheus" (Bezos AI-for-engineering startup)

**Purpose.** Disambiguate the name "Project Prometheus" in the engineering/AI
context, confirm the correct referent, capture its real public scope with cited
sources, and translate that into concrete, grounded targets for Forge. This is a
competitive/positioning reference, not a feature spec.

**Honesty contract (Forge Engineering Bible rules 0/9).** Every external claim
below carries a real accessible source URL. Every Forge claim carries real
`file:line` repo evidence. Anything non-public, unverifiable, or not-yet-built is
marked **UNVERIFIED** or **TODO**. A correct "not found / not implemented" beats
a fake "working." No invented numbers.

---

## 1. Disambiguation — which "Project Prometheus"?

"Prometheus" / "Project Prometheus" is a heavily reused name. Known distinct
referents (so we do **not** conflate them):

1. **Project Prometheus (the AI company)** — Jeff Bezos + Vik Bajaj, founded
   Nov 2025. *This is the referent relevant to Forge.* It builds AI for the
   physical economy — engineering and manufacturing of complex physical systems.
   Public Wikipedia page exists: `Project Prometheus (company)`.
   <https://en.wikipedia.org/wiki/Project_Prometheus_(company)>
2. **Project Prometheus (NASA, 2003)** — a NASA nuclear-propulsion/space program
   (cancelled). Unrelated; historical. (Not researched here beyond noting the
   name collision.)
3. Various unrelated software projects, codenames, and a separate trademark
   filing (see §2 note on the Nov-17-2025 trademark application). These are not
   the Bezos company.

**Confirmation that the Bezos company is the correct referent.** It is a public,
well-attested entity (Wikipedia + NYT-broken story + Axios/TechCrunch/CNBC/Inc/
GeekWire coverage) and it is explicitly an *AI-for-engineering / "modern CAD"*
play — the same problem space as Forge + Archie. Confidence: **high** on identity
and public scope; **the company's actual product internals remain stealth / not
public** (see §4), so anything about *how* their software works is bounded by what
they have chosen to disclose.

---

## 2. Verified public facts (cited)

| Fact | Value | Source |
|------|-------|--------|
| Founders / co-CEOs | Jeff Bezos and Vik Bajaj (Bajaj: ex-Google X / Verily co-founder, Foresite Labs) | [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)), [TechCrunch 2025-11-17](https://techcrunch.com/2025/11/17/jeff-bezos-reportedly-returns-to-the-trenches-as-co-ceo-of-new-ai-startup-project-prometheus/) |
| Founded | November 2025 | [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)) |
| Story broken by | The New York Times, 2025-11-17 | [TechCrunch 2025-11-17](https://techcrunch.com/2025/11/17/jeff-bezos-reportedly-returns-to-the-trenches-as-co-ceo-of-new-ai-startup-project-prometheus/) |
| Initial funding | $6.2 billion (partly from Bezos personally) | [TechCrunch 2025-11-17](https://techcrunch.com/2025/11/17/jeff-bezos-reportedly-returns-to-the-trenches-as-co-ceo-of-new-ai-startup-project-prometheus/), [Built In](https://builtin.com/articles/what-is-project-prometheus) |
| June 2026 round | $12 billion (Series B) | [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/), [Axios 2026-06-11](https://www.axios.com/2026/06/11/prometheus-bezos-industrial-ai) |
| Valuation | $41 billion (June 2026) | [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/), [Axios 2026-06-11](https://www.axios.com/2026/06/11/prometheus-bezos-industrial-ai) |
| Total raised | ~$18.2 billion | [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/) |
| Lead investors (June round) | Bezos, JPMorgan Chase, Goldman Sachs, BlackRock, DST Global, Arch Venture Partners | [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/) |
| Headcount | ~120 (Dec 2025) → ~150 (June 2026) | [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)), [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/) |
| Talent sourced from | OpenAI, Meta, Google DeepMind (and reported xAI) | [TechCrunch 2025-11-17](https://techcrunch.com/2025/11/17/jeff-bezos-reportedly-returns-to-the-trenches-as-co-ceo-of-new-ai-startup-project-prometheus/) |
| HQ / offices | San Francisco (HQ); London; Zurich | [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)) |
| Acquisition | General Agents (agentic AI) acquired Nov 2025 | [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)) |
| Public website | None — operating in stealth | [Built In](https://builtin.com/articles/what-is-project-prometheus) |

Trademark note (unrelated entity): Wikipedia reports a *separate* trademark
application for a same-named AI company filed 2025-11-17 — name collision, not the
Bezos company. Source: [Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company)).

---

## 3. The mission, in their own words

- **"Artificial general engineer."** Prometheus's stated goal is software that
  automates the design and manufacturing of complex physical systems — examples
  cited include **jet engines and drug compounds**. ([TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/))
- **"A very, very modern version of CAD."** Bezos has described the product as a
  modern version of computer-aided design software — tooling to *design physical
  objects*, not robots. ([WebSearch result summary, June 2026 coverage; primary GeekWire 2026 article](https://www.geekwire.com/2026/jeff-bezos-describes-his-38b-startup-prometheus-for-the-first-time-nothing-to-do-with-robotics/))
  — **NOTE/UNVERIFIED-EXACT-WORDING:** GeekWire returned HTTP 403 to the fetch
  tool, so this exact phrasing is taken from search-engine summaries of June-2026
  coverage rather than a directly-fetched primary page. The *substance* (CAD
  framing; "nothing to do with robotics") is corroborated across multiple
  outlets; treat the precise quoted string as needing a direct re-read before
  external reuse.
- **"Nothing to do with robotics."** Bezos has repeatedly stressed Prometheus is
  not a robotics company — it builds *upstream design tools* that make engineers
  more effective, not factory-floor automation. ([New Space Economy 2026-06-14](https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/), corroborated by GeekWire headline)
- **"All societal wealth is driven by invention… What Prometheus seeks to do is
  to offer a set of tools that dramatically accelerates that invention loop."**
  ([New Space Economy 2026-06-14](https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/))
- **Technical approach (as disclosed):** "world models" — AI trained on
  multimodal real-world data producing dynamic 3D representations to predict
  physical behavior (cited example: *reconstruct how air flows around an airplane
  wing to improve flight performance*). WSJ (via Built In) reports they
  "initially plan to sell these capabilities through software tools for
  engineering simulations and design." All three of these — the world-models
  framing, the airplane-wing example, and the WSJ software-tools note — are
  sourced from **Built In**, which states them directly (verified verbatim).
  ([Built In](https://builtin.com/articles/what-is-project-prometheus))
  — **CORRECTED (adversarial verification):** this cluster was previously
  co-attributed to New Space Economy; a direct re-fetch of the New Space Economy
  article shows it does **not** contain the world-models / airplane-wing / WSJ
  material — only Built In does. The earlier "**very compute-intensive**"
  characterization is **downgraded to UNVERIFIED**: Built In speaks of growing
  "compute needs" but does not use the phrase "very compute-intensive," so the
  superlative is not directly supported by the cited source.
- **Target industries:** aerospace/space (spacecraft, propulsion, launch
  vehicles, satellites), automotive, semiconductors/computing hardware,
  pharma/drug design. ([New Space Economy 2026-06-14](https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/), [TechCrunch 2026-06-11](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/))

---

## 4. What is NOT public (do not invent)

The following are **UNVERIFIED / stealth** — Prometheus has not disclosed them,
so we must not claim them or benchmark against fabricated specifics:

- Any concrete product UI, file formats, kernel/geometry representation, or API.
- Any shipped solver, accuracy number, or benchmark. (Their "world model" /
  airflow-around-a-wing example is an *illustrative aspiration in interviews*,
  **not** a published, validated result.)
- Any release date, pricing, or customer.
- Whether their "modern CAD" is parametric B-rep, mesh/implicit, generative, or
  pure ML surrogate. Unknown — **TODO if/when disclosed.**
- The reported "$100B roll-up of manufacturing companies" is *reported talks*,
  not a confirmed action. ([TechFundingNews](https://techfundingnews.com/jeff-bezos-ai-startup-project-prometheus-ceo-return-manufacturing-aerospace/))

Because their internals are private, the §5 targets are derived from Prometheus's
**publicly stated mission**, not from any private spec.

---

## 5. Grounded translation into Forge targets

Prometheus's public thesis — *"a very modern version of CAD" + "artificial
general engineer" + "accelerate the invention loop" for jet engines / spacecraft
/ automotive / semiconductors* — maps almost exactly onto the ArchDisc thesis:
**Forge (native B-rep MCAD kernel) + Archie (LLM/VLM that drives the design).**
This is positioning gold: the most-watched, best-funded AI startup of 2026 has
publicly validated the exact category ArchDisc is building. The strategic answer
is **not** to copy them (we cannot — they're stealth) but to make Forge
demonstrably *real* on the dimensions they only describe aspirationally.

Targets below separate **BUILT & VALIDATED** (with `file:line` evidence) from
**TARGETED** (work to do). No target carries an unmeasured number.

### Pillar A — "Modern CAD" must be a *real geometric kernel*, not a demo
Prometheus frames itself as CAD's successor; Forge's moat is a *native exact
B-rep kernel* that already exists and is parity-tracked.

- **BUILT & VALIDATED.** Native OCCT 7.9 kernel, no WASM, loaded as
  `forge-kernel.node`. Evidence: `README.md:3-6`. Full feature-modeling parity
  surface (extrude/revolve/sweep/loft/shell/fillet/chamfer/draft/hole-wizard/
  rib/patterns/direct-modeling/healing/sheet-metal/weldments/NURBS surfacing/
  persistent topo IDs) marked shipped+tested. Evidence: `PARITY.md:22-37`.
- **BUILT & VALIDATED.** 100k+ instance assemblies with ref-counted B-rep dedup
  and a C++ BVH; measured perf (100k addInstance 311 ms; 500k BVH build 84.8 ms;
  500k tiny-AABB query 0.011 ms). Evidence for the *measured numbers*:
  `PARITY.md:43-50` (the "Performance" table — confirmed all three figures live
  there verbatim). `README.md:12-14` supports only the **design intent**
  ("designed for 100,000+ component instances … BVH spatial index built in C++"),
  **not** the measured millisecond figures — those are NOT in the README. (Corrected
  during adversarial verification: README was over-cited; PARITY.md is the real
  source of the numbers.)
- **TARGET.** Keep the parity ledger honest and current every slice (it already
  uses ✅/◐/☐ with gap notes — `PARITY.md:7`). When we make the "modern CAD"
  comparison publicly, lead with this measured parity table, never marketing.

### Pillar B — "Artificial general engineer" = real multi-physics, validated
Prometheus's headline is automating *engineering*, with airflow-around-a-wing as
its showcase. Forge's counter is *measured* solver accuracy, not a video.

- **BUILT & VALIDATED.** Physics solvers verified against closed-form analytical
  benchmarks with literal harness numbers: truss axial **0.00%**, frame
  longitudinal mode **0.0%**, Hex8 cantilever converging under h-refinement
  35.2% → 12.3% → 6.0%, CFD incompressibility enforced to **~7e-16** (machine ε,
  lid-driven cavity Re=100 vs Ghia 1982). Evidence:
  `FORGE_PHYSICS_VERIFICATION.md:26-60`. The doc's own framing — "every number is
  measured… nothing here is marketing" (`FORGE_PHYSICS_VERIFICATION.md:5-9`) — is
  precisely the rigor Prometheus has *not* published.
- **TARGET (their exact showcase).** Prometheus publicly cited *airflow around an
  airplane wing*. Forge already verifies incompressible CFD on the canonical
  lid-driven cavity; **TODO** = stand up a validated external-aero (wing/airfoil)
  CFD case with a cited reference solution, so we can meet their headline demo
  with a *measured* result. Known open gap to be honest about: turbulent CFD is
  not yet validated (per the physics-rigor memory; confirm against
  `FORGE_PHYSICS_VERIFICATION.md` before claiming). **UNVERIFIED until a wing
  case lands in the harness.**

### Pillar C — "Accelerate the invention loop" = Archie driving the kernel
Prometheus says it makes engineers dramatically faster at iterating designs.
That is exactly the Archie-drives-Forge CUA story.

- **BUILT (per memory, verify before external use).** Archie provider wired into
  Forge (SP-91); 14 parametric verbs bridged so the LLM emits real parametric
  geometry, not straight primitives; `installForgeRunner` wired. **TODO/VERIFY:**
  these claims come from auto-memory, not re-checked here — confirm with current
  `file:line` evidence in the Archie/ForgeRunner bridge before quoting them in any
  external/comparative material.
- **TARGET.** The flagship demos (GE9X ~20k parametric components, gearbox,
  turbopump per memory) are the credible "jet-engine-class" answer to
  Prometheus's jet-engine example — but built on a *real* B-rep kernel they have
  not shown. Make at least one flagship reproducible end-to-end (Archie prompt →
  real BRep ops → multi-cam e2e) as the comparison artifact.

### Pillar D — Positioning / messaging guardrails
- **DO** say: "Forge is a real, native, exact-B-rep MCAD kernel with *measured*
  solver accuracy and 100k+ component assemblies — today." (All evidenced above.)
- **DO** frame Prometheus as *category validation*: the best-funded AI startup of
  2026 publicly bets that 'modern CAD' + an 'artificial general engineer' is the
  future — which is the ArchDisc thesis.
- **DO NOT** claim feature/benchmark superiority over Prometheus: their product
  is stealth and unmeasured, so any head-to-head number would be fabricated.
  State only that *they have published none*, which is verifiable.
- **DO NOT** copy their disclosed buzzwords ("world models") into Forge marketing
  unless/until Forge actually ships that representation.

---

## 6. Sources (all accessed June 2026)

- Wikipedia — *Project Prometheus (company)*: <https://en.wikipedia.org/wiki/Project_Prometheus_(company)>
- TechCrunch (2026-06-11) — $12B raise / artificial general engineer: <https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/>
- TechCrunch (2025-11-17) — Bezos co-CEO / launch: <https://techcrunch.com/2025/11/17/jeff-bezos-reportedly-returns-to-the-trenches-as-co-ceo-of-new-ai-startup-project-prometheus/>
- Axios (2026-06-11) — $41B valuation / industrial AI: <https://www.axios.com/2026/06/11/prometheus-bezos-industrial-ai>
- Built In — what is Project Prometheus / world models / CAD framing: <https://builtin.com/articles/what-is-project-prometheus>
- New Space Economy (2026-06-14) — artificial general engineer / use cases / "invention loop" quote: <https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/>
- GeekWire (2026) — "nothing to do with robotics" / CAD-of-the-future (HTTP 403 to fetch tool; cited from headline + search summaries — re-read directly before quoting verbatim): <https://www.geekwire.com/2026/jeff-bezos-describes-his-38b-startup-prometheus-for-the-first-time-nothing-to-do-with-robotics/>
- TechFundingNews — manufacturing/aerospace roll-up reporting: <https://techfundingnews.com/jeff-bezos-ai-startup-project-prometheus-ceo-return-manufacturing-aerospace/>
- CNBC (2026-06-11) — Bezos "we're not being secretive" (HTTP 403 to fetch tool; listed for the record, not relied on for any unique claim): <https://www.cnbc.com/2026/06/11/project-prometheus-bezos-bajaj-live-updates.html>

### Repo evidence cited (this codebase)
- `/Users/account_clawteam1/archdisc-Mech/README.md:3-6, 12-14` — native OCCT kernel, no WASM, 100k+ assemblies.
- `/Users/account_clawteam1/archdisc-Mech/PARITY.md:7, 22-37, 43-50` — feature-modeling parity surface + measured perf.
- `/Users/account_clawteam1/archdisc-Mech/FORGE_PHYSICS_VERIFICATION.md:5-9, 26-60` — measured analytical-benchmark solver verification.

**Fetch-tool limitation (honesty note):** GeekWire, CNBC, Inc.com, and Axios
returned HTTP 403 to the automated fetch tool, and TechFundingNews timed out
once. The facts attributed to those outlets above are either corroborated by at
least one *directly-fetched* source (Wikipedia / TechCrunch / Built In / New
Space Economy) or are flagged inline as search-summary-only. No claim rests
solely on an un-fetched page except where explicitly marked UNVERIFIED.

---

## Verification (adversarial)

Independent adversarial re-check performed **2026-06-20** against live sources
(WebSearch + WebFetch) and the cited repo files. Default posture: skepticism —
anything not confirmable from a real source was downgraded or marked UNVERIFIED.

**External claims — re-fetched / re-searched and CONFIRMED:**
- Bezos + Vik Bajaj as co-CEOs; founded Nov 2025; $6.2B initial funding — confirmed
  via Wikipedia (directly fetched) and TechCrunch 2025-11-17 (in search index).
- Story first broken by **The New York Times, 2025-11-17** — confirmed via search
  (NYT credited as first report; widely echoed).
- **$12B Series B / $41B valuation / ~$18.2B total raised / June 2026 / ~150 staff /
  investors JPMorgan, Goldman Sachs, BlackRock, DST Global, Arch Venture Partners** —
  confirmed via TechCrunch 2026-06-11 (directly fetched) and Axios/GeekWire search
  summaries. TechCrunch fetch independently returned $12B / $41B / $18.2B / 150 /
  the named investor list.
- Headcount ~120 (Dec 2025); SF HQ + London + Zurich; **General Agents** acquisition
  Nov 2025; operating in stealth with no public website — confirmed via Wikipedia
  (directly fetched) and Built In.
- "Artificial general engineer"; examples **jet engines and drug compounds**;
  target industries aerospace/space, automotive, semiconductors/computing, pharma —
  confirmed via TechCrunch + New Space Economy (both fetched).
- **"a very, very modern version of CAD"** and **"nothing to do with robotics"** —
  confirmed via search (GeekWire headline + multiple outlets quote both verbatim;
  GeekWire itself 403'd to the fetch tool, as the file already disclosed).
- **"All societal wealth is driven by invention … accelerates that invention loop"**
  Bezos quote — confirmed **verbatim** in the directly-fetched New Space Economy article.
- **$100B manufacturing roll-up = reported talks, not confirmed** — confirmed via
  search (WSJ/TechCrunch, March 2026; described as preliminary, no close announced).
  The file's "reported talks, not a confirmed action" framing is accurate.

**Repo evidence — re-read and CONFIRMED:**
- Physics numbers in §2 Pillar B (truss axial **0.00%**, frame longitudinal mode
  **0.0%**, Hex8 cantilever **35.2% → 12.3% → 6.0%**, CFD incompressibility **~7e-16**,
  lid-driven cavity Re=100 vs **Ghia 1982**) all match `FORGE_PHYSICS_VERIFICATION.md:26-62`
  exactly. Accurately cited.
- Feature-modeling parity surface and the ✅/◐/☐ legend match `PARITY.md:7, 22-37`.
- Performance figures (311 ms / 84.8 ms / 0.011 ms) match `PARITY.md:43-50` exactly.

**CORRECTED / DOWNGRADED during this pass:**
1. **Perf-number citation (§5 Pillar A).** The measured perf figures were co-cited to
   `README.md:12-14`; the README contains only the *design intent* ("designed for
   100,000+ … BVH built in C++"), **not** the millisecond numbers. Source corrected to
   `PARITY.md:43-50` only; README downgraded to design-intent support.
2. **World-models / airplane-wing / WSJ cluster (§3).** Previously co-attributed to
   New Space Economy. A direct re-fetch shows New Space Economy does **not** contain
   that material — it is in **Built In** only. Attribution corrected to Built In.
3. **"Very compute-intensive" (§3).** Downgraded to **UNVERIFIED**: Built In says
   "compute needs," not "very compute-intensive"; the superlative is not supported by
   the cited source.

**Net assessment.** The document is substantially accurate and honestly sourced; its
financial/identity facts about Prometheus all hold against live reporting, and its
repo physics/perf citations are faithful. The only defects were two attribution
slips (one repo `file:line`, one news outlet) and one unsupported intensifier — all
corrected above. No fabricated numbers were found; no claim was invented out of whole
cloth. The pre-existing UNVERIFIED/TODO/stealth guardrails in §4 are appropriate and
were left intact.
