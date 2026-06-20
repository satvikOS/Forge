# PLM Capability Status — ArchDisc Forge (archdisc-Mech)

**Generated:** 2026-06-20
**Scope:** Honest audit of Product Lifecycle Management (PLM) capability in this repo
against the six dimensions named in the Bible 5.2 task: BOM generation + management,
version control, configuration management, change/revision control, lifecycle state,
and traceability.

## Honesty rules applied (Forge Engineering Bible 0/9)

- Every repo claim below cites real `file:line` evidence that was read or run.
- "Built & validated" (a unit/e2e test was found and, where runnable headlessly, **executed and passed**)
  is kept strictly separate from "built but unvalidated" and "targeted / not built".
- No external/market claim is made. No numbers are invented.
- **This is NOT a full PLM system.** It is a set of local-first, single-user
  PLM-*adjacent* features. There is no server, no multi-user concurrency control beyond
  a local lock file, no enterprise PDM/PLM (Teamcenter / Windchill / 3DEXPERIENCE)
  integration, and no cross-document configuration/effectivity engine. See gaps per row.

## Important caveat — three overlapping, non-unified implementations

PLM-adjacent code exists in **three independent stacks** that do not share state:

1. **`electron/pdmVault.js`** — JSON-on-disk file vault, reached over `pdm:*` IPC,
   driven by `frontend/src/forge-v4/PDMWorkbench.jsx`. (File/document centric.)
2. **`frontend/src/forge-v4/pdmStore.js`** — localStorage item-revision graph,
   driven by `frontend/src/forge-v4/PdmPanel.jsx`. (Item/part-number centric.)
3. **`frontend/src/kernel/forge/Pdm.js`** + **`frontend/src/kernel/pdm/VersionControl.js`**
   — in-memory class libraries (PartVersion/ECO; branch/tag/approval). (Library code.)

These are **not integrated** with each other or with a single source of truth.
A part edited in one surface is not reflected in the others.

---

## Capability matrix

| Capability | Status | Primary evidence |
| --- | --- | --- |
| BOM generation + management | **PARTIAL** | `bomAggregator.js`, `BomPanel.jsx`, `kernel/forge/drawings/BomRollup.js`, `pdmStore.js` |
| Version control | **PARTIAL** | `electron/pdmVault.js`, `pdmStore.js`, `kernel/pdm/VersionControl.js` |
| Configuration management | **NOT STARTED** | (no config/variant/effectivity/baseline engine found) |
| Change / revision control | **PARTIAL** | `pdmStore.js` (rev letters + ECN), `kernel/forge/Pdm.js` (ECO), `pdmVault.js` (ECN) |
| Lifecycle state | **PARTIAL** | `pdmStore.js`, `kernel/forge/Pdm.js` |
| Traceability | **PARTIAL** | `pdmStore.js` whereUsed/bomDiff, `pdmVault.js` whereUsed/setUses, `CertTraceabilityPanel.jsx` |

No row is marked **PARITY**. Every capability that exists is single-user / local-first
and at least one of the three stacks for it is unwired or unvalidated.

---

## 1. BOM generation + management — **PARTIAL**

**Built & validated**

- **Per-body BOM panel** with inline material picker, kernel-volume × density mass,
  totals row, and real CSV export through `forge.dialog.saveFile`/`writeBlob`.
  `frontend/src/forge-v4/BomPanel.jsx:128` (`buildRows`), `:93` (`buildBomCSV`),
  `:230` (`onExport`). Mounted in app: `frontend/src/App.jsx:1052` (`<BomPanelHost/>`).
  E2e spec exists: `e2e/push-60-bom-csv.spec.js`.
- **Drawing auto-BOM rollup + auto-balloon** in the kernel:
  `frontend/src/kernel/forge/drawings/BomRollup.js:1`. Unit test
  `frontend/src/kernel/forge/drawings/__tests__/BomRollup.test.mjs` — **run and PASSED**
  (`[forge.bom-rollup] all tests passed`).
- **Item-graph BOM** with parent/child edges, qty summing, cycle detection,
  `releasedBom`/`workingBom`/`whereUsed`/`bomDiff`:
  `frontend/src/forge-v4/pdmStore.js:417` (`linkBom`), `:478` (`whereUsed`),
  `:492` (`releasedBom`), `:529` (`bomDiff`). Driven by `PdmPanel.jsx` (mounted at
  `App.jsx:1053`).

**Built but BROKEN / unwired (must be disclosed)**

- **BOM Aggregator** (group-by name/material/part-key with cost rollup) is **not wired
  into the app and its panel is broken against its own dependency.**
  `BomAggregatorPanel.jsx:43-52` imports
  `groupBodies, totalsForGroups, exportCsv, computeRowMass, namePattern, GROUP_BY_MODES,
  DENSITY_TABLE, COST_TABLE` from `./bomAggregator.js`, **but that module exports none
  of them** — its only exports are `MATERIAL_DENSITY, MATERIAL_COSTS_PER_KG,
  aggregateBOM, totalsFor, exportCSV` (`bomAggregator.js:24,45,81,157,171`).
  The mount is **commented out** with a note acknowledging the mismatch:
  `frontend/src/App.jsx:943-945`
  ("PUSH-116 BomAggregator deferred — panel imports a different bomAggregator.js API
  … left out of this batch"). Consequently the e2e
  `e2e/push-116-bom-aggregator.spec.js` (which asserts
  `window.__forgeBomAggregatorHelper`) **cannot pass against the shipped app**, because
  that global is only installed by the unmounted `BomAggregatorPanelHost`.
- The standalone `aggregateBOM()` in `bomAggregator.js:81` is a real, working pure
  function (dedup by partKey, qty, mass via `window.forge.massProps` with bbox
  fallback, CSV) — but **no mounted UI imports it**; it is currently dead/orphaned in
  the running app.

**Gaps:** no single canonical BOM (three separate BOM notions); cost data in
`bomAggregator.js:45` is described in-comment as LME/polymer-index averages but is
**hard-coded and unverified** against any live source; no multi-level indented BOM
export from the mounted UIs; no BOM<->PDM-item linkage in the running app.

## 2. Version control — **PARTIAL**

**Built & validated (vault)**

- **File vault with immutable, content-addressed versions.** `electron/pdmVault.js`:
  `add` (`:84`) writes `v1` + SHA-256; `checkin` (`:129`) appends `v{N+1}`;
  `history` (`:161`); `rollback` (`:175`) creates a *new* version from an old payload
  (non-destructive); `fetch` (`:207`) returns any version by number. SHA-256 integrity
  at `:61`. **Wired**: 12 `pdm:*` IPC handlers in `electron/main.js:299-306` (+ ecn,
  ecnList, whereUsed, setUses) backed by `require('./pdmVault.js')` at `main.js:288`.
  UI: `frontend/src/forge-v4/PDMWorkbench.jsx` (add/checkout/checkin/history/rollback/ecn
  buttons, `:155-171`), mounted at `App.jsx:1054`. E2e specs exist:
  `e2e/push-14-pdm-vault.spec.js`, `e2e/push-51-pdm.spec.js`,
  `e2e/push-100-pdm-revisions.spec.js`. (These are Electron e2e and were **not** run in
  this audit — see "Validation gaps".)
- **SemVer document revisions** (MAJOR.MINOR.PATCH bump with correct reset rules,
  persisted to localStorage): `frontend/src/forge-v4/PdmRevisionsPanel.jsx:80`
  (`bumpVersion`), mounted `App.jsx:1428`.

**Built but unwired**

- **`kernel/pdm/VersionControl.js`** — a fuller VCS-style class with `commit`,
  `checkout`, **branches** (`createBranch`/`switchBranch`, `:61`/`:71`), **tags** (`:84`),
  **approval workflow** (`submitForApproval`, `:91`), `log`, and feature-tree `diff`
  (`:124`). It is referenced only by
  `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` and
  `frontend/src/kernel/index.js` — **not** by the running forge-v4 shell. Branch/tag
  capability therefore is **not reachable** from the shipped Forge UI. Its `_hash` is a
  non-cryptographic 32-bit hash (`:155`), unlike the vault's SHA-256.

**Gaps:** version control is **per-file or per-item, single-user, local**. No server,
no merge, no concurrent-edit resolution, no real branch/merge in the shipped path.

## 3. Configuration management — **NOT STARTED**

No configuration/variant/effectivity/baseline engine was found. A repo-wide grep for
`configuration management | configuration item | effectivity | baseline | as-built |
as-designed` returned only incidental matches (UI strings, shaders, drawing templates),
**no implementation**. There is:

- no part **configuration/variant table** (e.g. SolidWorks-style configurations or
  family-of-parts),
- no **effectivity** (date/serial/lot) on BOM edges or revisions,
- no **baseline** snapshot that freezes a multi-part assembly state for release.

The closest adjacent primitives are the single immutable version snapshots in
`pdmVault.js` and the `releasedBom`/`workingBom` distinction in `pdmStore.js:492,510`,
but neither constitutes configuration management. **Marked NOT STARTED.**

## 4. Change / revision control — **PARTIAL**

**Built & validated**

- **ASME Y14.35M revision letters** (A→B→…, skipping I/O/Q/S/X/Z, then AA/AB…):
  `frontend/src/forge-v4/pdmStore.js:57` (`nextRevLetter`), driven by `revise()`
  (`:239`) which optionally tags the rev with an ECN ref. ECN entity + affected-item
  linkage: `addEcn` (`:379`).
- **ECO (Engineering Change Order) state machine** with an enforced transition graph
  (Draft→InReview→Approved→Implemented→Closed / Rejected) and a **unanimous-approval
  guard** before Approved: `frontend/src/kernel/forge/Pdm.js:137` (`ECO_FORWARD`),
  `:174` (`transition`), `:181` (approval guard). Unit test
  `frontend/src/kernel/forge/__tests__/Pdm.test.mjs` — **run and PASSED**
  (`[forge.pdm] all tests passed`).
- **ECN records on the file vault**, with stage/approver/releasedAt:
  `electron/pdmVault.js:218` (`ecn`), `:235` (`ecnList`); IPC `pdm:ecn`/`pdm:ecnList`.

**Gaps:** the three change models (pdmStore ECN, kernel/forge ECO, vault ECN) are
**independent** and do not share IDs or state. The kernel `Pdm.js` ECO is a class
library only — no mounted UI files ECOs in the shipped Forge shell (it is the kernel
layer, not forge-v4). No closed-loop "ECO drives revision bump of the affected parts"
flow exists end-to-end in one stack.

## 5. Lifecycle state — **PARTIAL**

**Built & validated**

- **Item lifecycle WIP / Released / Obsolete**, with state transitions logged to a
  history trail: `frontend/src/forge-v4/pdmStore.js:350` (`setLifecycle`, allowed-set
  guard at `:351`). Surfaced in `PdmPanel.jsx` with lifecycle pills and explicit
  Release/Obsolete buttons (`PdmPanel.jsx:419-425`), mounted at `App.jsx:1053`.
- **Part-version lifecycle WIP / InReview / Released / Obsolete** with an enforced
  forward-adjacency graph: `frontend/src/kernel/forge/Pdm.js:20` (`LifecycleState`),
  `:27` (`LIFECYCLE_FORWARD`), `:79` (`promote`, illegal-transition guard).
  Covered by the passing `Pdm.test.mjs`.

**Gaps:** two different lifecycle vocabularies (pdmStore has 3 states; kernel Pdm has
4, adding InReview). They are not unified. The `pdmStore` lifecycle has **no transition
guard** (any allowed state to any allowed state is permitted; only the *value* is
validated, `pdmStore.js:351`), unlike the kernel's adjacency-enforced `promote`.
No approval gate ties lifecycle promotion to an approved ECO in the shipped path.

## 6. Traceability — **PARTIAL**

**Built & validated**

- **Where-used / BOM diff** on the item graph: `pdmStore.js:478` (`whereUsed`),
  `:529` (`bomDiff` returns added/removed/changed vs the released BOM). Driven by
  `PdmPanel.jsx:702,866`. Per-item **history log** of create/revise/checkout/checkin/
  lifecycle/ecn events: `pdmStore.js:184` (`historyForItem`).
- **Vault where-used** via explicit `uses` links: `electron/pdmVault.js:242`
  (`whereUsed`), `:260` (`setUses`); IPC `pdm:whereUsed`/`pdm:setUses`.
- **Certification traceability matrix** (requirements→design→analysis→verification→
  results) backed by real clause sets (FAA Part 23 / AS9100 Rev D / ISO 9001:2015) with
  CSV export: `frontend/src/forge-v4/CertTraceabilityPanel.jsx:1`, templates in
  `certTemplates.js`. (Wired in `App.jsx`.) **Note:** the clause-set fidelity to the
  actual published standards was **not independently verified** in this audit — marked
  UNVERIFIED.

**Gaps:** traceability is intra-document/intra-graph only. No cross-stack traceability
(an item in `pdmStore` is not linked to a vault doc or a kernel PartVersion). The vault
`whereUsed` depends on manually-maintained `uses` arrays — there is no automatic
extraction of assembly dependencies into the vault.

---

## Validation gaps (what was NOT proven in this audit)

- **Electron e2e specs were not executed.** `e2e/push-14-pdm-vault.spec.js`,
  `push-51-pdm.spec.js`, `push-100-pdm-revisions.spec.js`, `push-60-bom-csv.spec.js`,
  `push-93-bom-balloons.spec.js` exist but require a full headed Electron boot; they
  were not run here. Their **presence** is verified; their **current pass/fail is
  UNVERIFIED**.
- **`e2e/push-116-bom-aggregator.spec.js` is expected to FAIL / be unrunnable** against
  the shipped app because its panel host is unmounted (see §1).
- Only two unit tests in this area were run, both **PASSED**:
  `kernel/forge/__tests__/Pdm.test.mjs` and
  `kernel/forge/drawings/__tests__/BomRollup.test.mjs`.
- Material **cost** and **density** tables (`bomAggregator.js:24,45`,
  `kernel/pdm/CostingEngine.js`, `Sustainability.js`) are hard-coded reference values;
  they were **not** validated against any live external source and no source URL is
  asserted.

## Summary

Forge has a real, working, **single-user local-first** slice of PLM: a SHA-256 file
vault with check-in/out/history/rollback/ECN (wired + IPC-backed), an item-revision
graph with ASME rev letters, lifecycle states, where-used and BOM-diff (wired), a
working per-body BOM with CSV export (wired), a passing kernel ECO/lifecycle state
machine, and a certification traceability matrix. It is **not** a full PLM system:
no configuration management at all, no server/multi-user, three un-unified data stacks,
a broken-and-deferred BOM aggregator, and an unwired branch/tag/approval VCS library.
Every capability that exists is marked PARTIAL or NOT STARTED above — **none reaches
PARITY** with a commercial PDM/PLM.
