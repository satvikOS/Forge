# Seamaster Deliverable Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Package the autonomous Seamaster build into its honest deliverable: a ZIP containing every component as a STEP file plus a truthful `BUILD_REPORT.md` recording each component's verified/best-effort status and an honest accounting of what was and was not achieved.

**Architecture:** A new `ai/sculptor/DeliverablePackage.js` generates the honest build-report markdown. A spec gathers the component STEP files from disk, generates the report, and zips everything via ArchDisc's own `foundation/ZipArchive.js`.

**Tech Stack:** ES modules; ArchDisc `foundation/ZipArchive.js`. Tests: Node-mode Playwright. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

The autonomous Omega Seamaster build has finished its component pass: a
22-component manifest, every component sculpted by the AI and exported to a
STEP file. **Every component came back `accepted: false`** from the multi-angle
vision verifier — the geometry-capability ceiling (the atomic op set cannot
produce convincing watch parts; the mechanical movement is far beyond it). This
is the honest, recorded outcome. This plan packages the result truthfully.

**Verified facts:**
- Component STEP files are on disk: `autonomous-output/seamaster/components/*.step`
  (23 files — `c1`..`c22` plus a pre-existing `SM-001`). Each is valid
  ISO-10303-21. The manifest is `autonomous-output/seamaster/manifest.json`
  (22 entries `{id,name,description}`).
- All 22 manifest components were verified `accepted: false` during the build
  runs (recorded in this project's memory and the build console logs).
- `frontend/src/foundation/ZipArchive.js` is ArchDisc's ZIP writer (used for the
  vendor ZIP). Its exact API (function name, input shape — likely
  `{filename: contentString|Uint8Array}` → a zip `Uint8Array`/`Blob`) must be
  confirmed against a real call site — Task 2 Step 1.
- Honest scope: the deliverable is the component STEP files + a truthful report.
  It does NOT include a "fully assembled watch" STEP or an assembly video —
  composing 22 vision-rejected components and presenting it as a finished watch
  would misrepresent the result. The report states this plainly.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/ai/sculptor/DeliverablePackage.js` | NEW — `buildReportMarkdown(components, meta)`. |
| `e2e/seamaster-deliverable.spec.js` | NEW — Node-mode: gather STEPs, build report, zip the deliverable. |
| `e2e/deliverable-package.spec.js` | NEW — Node-mode unit tests for `buildReportMarkdown`. |

---

## Task 1: `DeliverablePackage.js` — the honest build report

**Files:**
- Create: `frontend/src/ai/sculptor/DeliverablePackage.js`
- Test: `e2e/deliverable-package.spec.js`

- [ ] **Step 1: Write the failing test** — create `e2e/deliverable-package.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { buildReportMarkdown } from '../frontend/src/ai/sculptor/DeliverablePackage.js';

const COMPONENTS = [
  { id: 'c1', name: 'Watch Case', volume: 10933, accepted: false, stepBytes: 1307962 },
  { id: 'c2', name: 'Caseback', volume: 2246, accepted: false, stepBytes: 547826 },
  { id: 'c5', name: 'Dial', volume: 330, accepted: true, stepBytes: 183301 },
];

test.describe('DeliverablePackage — buildReportMarkdown', () => {
  test('the report has a title and an honest summary line', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    expect(md).toContain('Omega Seamaster');
    expect(md).toContain('Build Report');
    // 3 components, 1 accepted
    expect(md).toContain('3');
    expect(md).toContain('1');
  });

  test('the report lists every component with its status', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    for (const c of COMPONENTS) {
      expect(md).toContain(c.id);
      expect(md).toContain(c.name);
    }
    expect(md).toContain('best-effort');   // the unverified ones are marked best-effort
    expect(md).toContain('verified');      // the accepted one is marked verified
  });

  test('the report states what is NOT included and why', () => {
    const md = buildReportMarkdown(COMPONENTS, { product: 'Omega Seamaster' });
    expect(md.toLowerCase()).toContain('not included');
  });

  test('an empty component list still produces a valid report', () => {
    const md = buildReportMarkdown([], { product: 'X' });
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/deliverable-package.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/ai/sculptor/DeliverablePackage.js`:**

```js
/**
 * ArchDisc — Deliverable Package.
 *
 * Generates the honest build report for an autonomous build: every component,
 * its measured volume, its STEP file size, and — crucially — its TRUE
 * verified/best-effort status from the vision-verify loop. The report does not
 * dress up best-effort geometry as a finished product.
 */

/**
 * Build the honest Markdown build report.
 *
 * @param {Array<{id,name,volume,accepted,stepBytes}>} components
 * @param {object} meta  { product }
 * @returns {string} the BUILD_REPORT.md text
 */
export function buildReportMarkdown(components, meta = {}) {
  const product = meta.product ?? 'Product';
  const total = components.length;
  const verified = components.filter((c) => c.accepted).length;
  const bestEffort = total - verified;

  const lines = [];
  lines.push(`# ${product} — Autonomous Build Report`);
  lines.push('');
  lines.push(`Generated by the ArchDisc autonomous atomic-CAD sculptor.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Components attempted: **${total}**`);
  lines.push(`- Passed multi-angle vision verification: **${verified}**`);
  lines.push(`- Best-effort (built but not verified): **${bestEffort}**`);
  lines.push('');
  lines.push('Each component was sculpted from scratch by an LLM sequencing '
    + "ArchDisc's atomic CAD operations (sketch, extrude, cut, revolve, "
    + 'patterns), then checked by a vision LLM from five orbited camera angles.');
  lines.push('');
  lines.push('## Components');
  lines.push('');
  lines.push('| id | name | volume (mm^3) | STEP (bytes) | status |');
  lines.push('|----|------|---------------|--------------|--------|');
  for (const c of components) {
    const status = c.accepted ? 'verified' : 'best-effort (unverified)';
    lines.push(`| ${c.id} | ${c.name} | ${Math.round(c.volume ?? 0)} `
      + `| ${c.stepBytes ?? 0} | ${status} |`);
  }
  lines.push('');
  lines.push('## Not included — and why');
  lines.push('');
  lines.push('This deliverable does **not** contain a "fully assembled watch" '
    + 'STEP file or an assembly video. Composing components that did not pass '
    + 'verification and presenting the result as a finished watch would '
    + 'misrepresent what was achieved. The honest deliverable is the set of '
    + 'component STEP files, each labelled with its true status, plus this '
    + 'report.');
  lines.push('');
  lines.push('## Honest assessment');
  lines.push('');
  lines.push('The autonomous build pipeline works end to end — decompose -> '
    + 'sculpt -> multi-angle vision-verify -> STEP-export -> save. The limiting '
    + 'factor is geometric capability: the current atomic operation set cannot '
    + 'produce convincing watch components (compound-curved case, the mechanical '
    + 'movement), and the vision verifier honestly rejects inadequate geometry '
    + 'rather than rubber-stamping it. Closing that gap needs an exact B-rep '
    + 'kernel and a far richer operation set.');
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/deliverable-package.spec.js --reporter=list`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/DeliverablePackage.js e2e/deliverable-package.spec.js
git commit -m "Add DeliverablePackage — honest autonomous-build report generator"
```

---

## Task 2: Produce the deliverable ZIP

**Files:**
- Create: `e2e/seamaster-deliverable.spec.js`

- [ ] **Step 1: Confirm the `ZipArchive` API**

Read `frontend/src/foundation/ZipArchive.js` and grep the codebase for its use
(the "vendor ZIP" path, likely in `ToolExecutionEngine.js` or a foundation
spec). Note exactly: the export name, how files are added (e.g. a class with
`.add(name, content)` then `.toUint8Array()`, or a function
`makeZip({name: content})` → `Uint8Array`), and whether it is synchronous and
Node-importable (pure JS, no manifold/WASM). Report what you found. Task 2
Step 2's spec must call it correctly.

- [ ] **Step 2: Create `e2e/seamaster-deliverable.spec.js`**

A Node-mode Playwright spec (no browser). It must:
1. Read every `.step` file in `autonomous-output/seamaster/components/`.
2. Read `autonomous-output/seamaster/manifest.json` for component names.
3. Build the `components` array — `{id, name, volume, accepted, stepBytes}`.
   - `id` from the filename (the part before `--`, or the `SM-001` prefix).
   - `name` from the manifest (match by id) or the filename.
   - `stepBytes` from the file size.
   - `volume`: 0 is acceptable here (the build did not persist per-component
     volume to disk — do not fabricate one).
   - `accepted`: **false** for every component — this build produced zero
     verified components; that is the honest recorded outcome. Do NOT mark any
     `true`.
4. Generate the report via `buildReportMarkdown(components, {product: 'Omega Seamaster'})`,
   write it to `autonomous-output/seamaster/BUILD_REPORT.md`.
5. Build the ZIP via ArchDisc's `ZipArchive` (the API confirmed in Step 1) —
   include every `.step` file and `BUILD_REPORT.md`. Write the zip bytes to
   `autonomous-output/seamaster/Omega-Seamaster-deliverable.zip`.
6. Assert: the ZIP file exists and is non-empty (> 1 KB); `BUILD_REPORT.md`
   exists and contains 'Omega Seamaster' and 'best-effort'; `console.log` the
   component count, the ZIP byte size, and the report's summary section.

Write the spec following the existing Node-mode spec conventions
(`import { test, expect } from '@playwright/test'`, `import fs from 'fs'`,
`import path from 'path'`, synchronous `test(...)` — no `page`). Import
`buildReportMarkdown` from `../frontend/src/ai/sculptor/DeliverablePackage.js`
and `ZipArchive` from `../frontend/src/foundation/ZipArchive.js`.

If `ZipArchive.js` turns out NOT to be Node-importable (it transitively pulls
the manifold WASM kernel), report that in Step 3 — the fallback is to make the
zip inside the headed Electron app via `win.evaluate`; but first try the direct
Node import.

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/seamaster-deliverable.spec.js --reporter=list`
Expected: PASS — 1 passed. `autonomous-output/seamaster/Omega-Seamaster-deliverable.zip`
and `BUILD_REPORT.md` are written.

If it FAILS:
- `ZipArchive` import / API error → paste it; if it is a Node-import failure of
  the module, report BLOCKED with the finding (the headed-app fallback is then
  the next plan).
- Otherwise paste the exact error and report BLOCKED.

- [ ] **Step 4: Verify the artifacts**

Confirm `autonomous-output/seamaster/Omega-Seamaster-deliverable.zip` exists and
its byte size. Confirm `autonomous-output/seamaster/BUILD_REPORT.md` exists —
read it and confirm it honestly lists the components and states 0 verified.
Report the ZIP size, the component count, and paste the report's Summary section.

- [ ] **Step 5: Commit**

```bash
git add e2e/seamaster-deliverable.spec.js
git commit -m "Add Seamaster deliverable spec — component STEPs + honest build report zipped"
```

(Do NOT git-add `autonomous-output/`.)

---

## Self-Review

**Spec coverage:** Produces the honest deliverable — the component STEP files +
a truthful `BUILD_REPORT.md`, zipped with ArchDisc's own `ZipArchive`. The
report records every component's true `best-effort/verified` status and states
plainly what is not included (an assembled-watch STEP / video) and why.

**Placeholder scan:** No placeholders. Task 2 Step 1 is a deliberate
API-verification step.

**Type consistency:** `buildReportMarkdown(components, {product})` — `components`
is `[{id,name,volume,accepted,stepBytes}]`. The deliverable spec builds that
array from the on-disk STEP files + manifest, with `accepted:false` for all
(the honest recorded outcome).

---

## Honest closing note

This is the deliverable the autonomous loop can truthfully produce: a real
record of how far an AI got building an Omega Seamaster from scratch using only
ArchDisc's operations — 22 components, each a valid STEP file, none passing
honest verification, with a transparent account of the capability ceiling. It
is not a finished watch, and the report says so.
