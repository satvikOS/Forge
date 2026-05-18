# L4 Assembly — First Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The AI builds a multi-part **assembly** — it decomposes an assembly description into individual parts, sculpts each one, and positions them together in the real ArchDisc desktop viewport.

**Architecture:** A `translate` atomic op moves a finished part's solid. A new `ai/sculptor/AssemblyBuilder.js` asks the LLM to decompose an assembly into `{name, description, position}` parts, sculpts each via the existing `sculptPart`, translates it to its position, and renders it as its own body. A new additive `renderBody` lets multiple parts coexist in the scene. A headed Electron spec proves it.

**Tech Stack:** ES modules; `manifold-3d`; the BYO-LLM layer; React. Tests: Node-mode Playwright for the assembly prompt/parser; a headed `_electron` spec. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 10** of the autonomous atomic-CAD sculptor (spec:
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`,
layer **L4**). Plans 1–9 shipped the L0 atomic ops and the L2 AI Sculptor (the
LLM autonomously sculpts ONE part from text and closes a vision-verify loop).

The watch movement is fundamentally an **assembly** of many parts. This plan is
the first L4 slice: the AI builds more than one part and positions them.

**Verified facts:**
- `frontend/src/kernel/atomic/AtomicOps.js` exports the L0 ops. manifold
  transforms are immutable — `solid.translate([dx,dy,dz])` returns a NEW
  manifold; `.delete()` the old. `Part` has `solid`, `addFeature(...)`.
- `frontend/src/ai/sculptor/PartSculptor.js` exports `sculptPart({description,
  llm, atomicApi, providers})` → `{part, plan}`, and `requestSculptPlan`.
  `PlannerProviders.js` (`PROVIDERS[provider].generate({apiKey,model,baseUrl,
  system,userMessage})`) is the LLM call; Node-safe.
- `WorkbenchMechanical.jsx` registers `window.__archdiscAtomic` (L0 ops +
  `render`, which REPLACES the previous atomic body) and `window.__archdiscSculptor`
  (`sculptPart`, `requestSculptPlan`, `executeSculptPlan`). The non-exported→
  exported `addFoundationManifoldToScene(scene, viewport, manifold, color)`
  (from `ToolExecutionEngine.js`) builds a Three.js body and ADDS it to the
  scene, returning the group. `render` wraps it with previous-body removal.
- LLM creds: gitignored `.llm-credentials.local.json` (`{provider, endpoint→
  baseUrl, apiKey, model}`).
- The Electron desktop app loads `frontend/dist` — rebuild before launching.
  Pattern: `e2e/ai-sculptor-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `translate`. |
| `frontend/src/ai/sculptor/AssemblyBuilder.js` | NEW — `buildAssemblyPrompt`, `parseAssemblyPlan`, `sculptAssembly`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `translate` + an additive `renderBody`; expose `sculptAssembly`. |
| `e2e/ai-assembly.spec.js` | NEW — Node-mode tests for the assembly prompt/parser. |
| `e2e/ai-assembly-electron.spec.js` | NEW — headed Electron test: AI builds a 2-part assembly. |

---

## Task 1: Add `translate` to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js` (append one function)

- [ ] **Step 1: Append the `translate` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after `linearPattern`:

```js
/**
 * Translate: move the part's whole current solid by (dx, dy, dz) mm. Used to
 * position a finished part within an assembly.
 *
 * @param {Part} part
 * @param {number} dx  x offset (mm)
 * @param {number} dy  y offset (mm)
 * @param {number} dz  z offset (mm)
 * @returns {object} the moved manifold-3d solid
 */
export function translate(part, dx, dy, dz) {
  if (!part.solid) throw new Error('translate: nothing to translate — build a solid first');
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    throw new Error('translate: dx, dy, dz must be finite numbers');
  }
  const moved = part.solid.translate([dx, dy, dz]);
  part.solid.delete();
  part.solid = moved;
  part.addFeature('translate', { dx, dy, dz }, moved);
  return moved;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` — expect exit 0 (skip if Node rejects ESM `import` in `--check`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps translate operation (atomic-CAD L4 assembly)"
```

---

## Task 2: `AssemblyBuilder.js` — decompose + sculpt + place

**Files:**
- Create: `frontend/src/ai/sculptor/AssemblyBuilder.js`
- Test: `e2e/ai-assembly.spec.js`

- [ ] **Step 1: Write the failing test** — create `e2e/ai-assembly.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { buildAssemblyPrompt, parseAssemblyPlan } from '../frontend/src/ai/sculptor/AssemblyBuilder.js';

test.describe('AssemblyBuilder — prompt', () => {
  test('the prompt asks for parts with name, description and position', () => {
    const p = buildAssemblyPrompt();
    expect(p).toContain('parts');
    expect(p).toContain('description');
    expect(p).toContain('position');
  });
});

test.describe('AssemblyBuilder — parseAssemblyPlan', () => {
  test('parses a valid two-part assembly', () => {
    const parts = parseAssemblyPlan(JSON.stringify({ parts: [
      { name: 'base', description: 'a 70 mm disc, 10 mm thick', position: [0, 0, 0] },
      { name: 'pillar', description: 'a 16 mm cylinder, 50 mm tall', position: [0, 0, 10] },
    ] }));
    expect(parts.length).toBe(2);
    expect(parts[1].position).toEqual([0, 0, 10]);
  });

  test('strips a ```json fence', () => {
    const parts = parseAssemblyPlan('```json\n{"parts":[{"name":"a","description":"d","position":[1,2,3]}]}\n```');
    expect(parts.length).toBe(1);
  });

  test('rejects a part with no description', () => {
    expect(() => parseAssemblyPlan('{"parts":[{"name":"a","position":[0,0,0]}]}'))
      .toThrow(/description/);
  });

  test('rejects a part whose position is not a 3-number array', () => {
    expect(() => parseAssemblyPlan('{"parts":[{"name":"a","description":"d","position":[0,0]}]}'))
      .toThrow(/position/);
  });

  test('rejects an empty parts list', () => {
    expect(() => parseAssemblyPlan('{"parts":[]}')).toThrow(/parts/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseAssemblyPlan('I will build it for you')).toThrow(/could not parse/);
  });
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/ai-assembly.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/ai/sculptor/AssemblyBuilder.js`:**

```js
/**
 * ArchDisc — L4 Assembly Builder.
 *
 * The AI decomposes an assembly description into individual parts, each with
 * a position; each part is sculpted on its own (via the L2 PartSculptor) and
 * translated into place. This is the first L4 slice — the AI building more
 * than one part and positioning them together.
 */

import { sculptPart } from './PartSculptor.js';

/**
 * The system prompt: asks the LLM to decompose an assembly into parts.
 * @returns {string}
 */
export function buildAssemblyPrompt() {
  return [
    'You are a CAD assembly planner for ArchDisc. Given a description of a',
    'mechanical assembly, decompose it into its individual parts and give each',
    'part a position in the assembly.',
    '',
    'Output ONLY a JSON object: {"parts":[ ... ]}. No prose, no markdown.',
    'Each part: {"name":"short id", "description":"<a self-contained part',
    'description with explicit mm dimensions>", "position":[x,y,z]}.',
    '',
    '- name: a short identifier for the part.',
    '- description: a complete standalone description of that ONE part — it is',
    '  sculpted on its own, so state every dimension explicitly.',
    '- position: [x,y,z] mm offset to place the finished part at. Each part is',
    '  sculpted at the origin, then translated to its position.',
    '',
    'All units are millimetres. Choose positions so the parts fit together as',
    'the assembly describes.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's assembly decomposition.
 * @param {string} text  the raw LLM completion
 * @returns {Array<{name:string, description:string, position:number[]}>}
 */
export function parseAssemblyPlan(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseAssemblyPlan: could not parse LLM response as JSON');
  }
  const parts = Array.isArray(data) ? data : data?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('parseAssemblyPlan: expected a non-empty {"parts":[...]}');
  }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (typeof p?.description !== 'string' || !p.description) {
      throw new Error(`parseAssemblyPlan: part ${i} needs a non-empty string "description"`);
    }
    if (!Array.isArray(p.position) || p.position.length !== 3
        || !p.position.every((n) => Number.isFinite(n))) {
      throw new Error(`parseAssemblyPlan: part ${i} needs a [x,y,z] numeric "position"`);
    }
  }
  return parts;
}

/**
 * Build a multi-part assembly: ask the LLM to decompose `description` into
 * parts, sculpt each part, translate it to its position, and render it.
 *
 * @param {object}   args
 * @param {string}   args.description     the assembly
 * @param {object}   args.llm             { provider, apiKey, baseUrl, model }
 * @param {object}   args.atomicApi       the AtomicOps API (must include `translate`)
 * @param {Function} args.placeAndRender  async (part, name) => void — render the
 *                                        placed part as its own body
 * @param {object}   [args.providers]     PROVIDERS map (injected for testing)
 * @returns {Promise<{parts:Array<{name,position,volume}>}>}
 */
export async function sculptAssembly({ description, llm, atomicApi, placeAndRender, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`sculptAssembly: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildAssemblyPrompt(),
    userMessage: `Assembly to build: ${description}`,
  });
  const specs = parseAssemblyPlan(raw);
  const built = [];
  for (const spec of specs) {
    const { part } = await sculptPart({ description: spec.description, llm, atomicApi, providers });
    atomicApi.translate(part, spec.position[0], spec.position[1], spec.position[2]);
    await placeAndRender(part, spec.name);
    built.push({ name: spec.name, position: spec.position, volume: part.solid.volume() });
  }
  return { parts: built };
}
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-assembly.spec.js --reporter=list`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/AssemblyBuilder.js e2e/ai-assembly.spec.js
git commit -m "Add AssemblyBuilder — LLM decomposes + places multi-part assemblies (L4)"
```

---

## Task 3: Wire assembly into the app

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Imports**

Add `translate` to the AtomicOps named import (the line importing `createPart,
…, linearPattern` from `'../../kernel/atomic/AtomicOps.js'`).

Add a new import line after the `PartSculptor` import:
```js
import { sculptAssembly } from '../../ai/sculptor/AssemblyBuilder.js';
```

- [ ] **Step 2: Expose `translate` and an additive `renderBody` on `window.__archdiscAtomic`**

In the `useEffect` that registers `window.__archdiscAtomic`: add `translate` to
the exposed op list, and add a `renderBody` function (additive — it does NOT
remove the previous body, unlike `render`). The object should gain these two
members. `renderBody`:
```js
            renderBody: (part, color) =>
                addFoundationManifoldToScene(scene, viewport, part.solid, color ?? 0x9aa3ad),
```
So the registered object is (existing members + `translate` in the op list +
`renderBody`):
```js
        window.__archdiscAtomic = {
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch,
            extrude, cut, revolve, circularPattern, linearPattern, translate,
            render: (part, color) => { /* …existing replace-render, unchanged… */ },
            renderBody: (part, color) =>
                addFoundationManifoldToScene(scene, viewport, part.solid, color ?? 0x9aa3ad),
        };
```
Keep the existing `render` function body exactly as it is — only add `translate`
to the op list and add the `renderBody` member.

- [ ] **Step 3: Expose `sculptAssembly` on `window.__archdiscSculptor`**

In the effect that registers `window.__archdiscSculptor`, add `sculptAssembly`:
```js
        window.__archdiscSculptor = { sculptPart, requestSculptPlan, executeSculptPlan, sculptAssembly };
```

- [ ] **Step 4: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds. Fix
only the import/syntax you introduced if it fails.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose translate, renderBody, and sculptAssembly on the window hooks (L4)"
```

---

## Task 4: Headed Electron spec — the AI builds a 2-part assembly

**Files:**
- Create: `e2e/ai-assembly-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/ai-assembly-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * L4 assembly, end to end, in the real ArchDisc desktop app: the AI is given
 * an ASSEMBLY description. It decomposes it into parts, sculpts each, and
 * positions them — multiple bodies coexisting in the viewport.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI decomposes and builds a 2-part assembly in the ArchDisc desktop app', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscAtomic && !!window.__archdiscSculptor
      && !!window.__archdiscSculptor.sculptAssembly, null, { timeout: 60000 });

  const description = 'A simple display stand: a round base disc 70 mm in diameter and '
    + '10 mm thick, and a vertical pillar — a cylinder 16 mm in diameter and 50 mm tall — '
    + 'standing on the centre of the base.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const r = await window.__archdiscSculptor.sculptAssembly({
      description, llm,
      atomicApi: window.__archdiscAtomic,
      placeAndRender: async (part) => { window.__archdiscAtomic.renderBody(part); },
    });
    return r;
  }, { description, llm });

  console.log('  assembly parts: ' + JSON.stringify(result.parts));

  // The AI must have decomposed the assembly into at least 2 parts, each a
  // real solid (positive volume).
  expect(result.parts.length).toBeGreaterThanOrEqual(2);
  for (const p of result.parts) {
    expect(p.volume).toBeGreaterThan(0);
    expect(Array.isArray(p.position)).toBe(true);
  }

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-assembly.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-assembly-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; the AI sculpts a base disc
and a pillar, positioned, both visible in the viewport.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `sculptAssembly` / `renderBody` / `translate` not a function → Task 3 wiring
  did not take; report BLOCKED.
- `parseAssemblyPlan` threw → the LLM returned an off-format decomposition;
  paste the raw output if visible; report DONE_WITH_CONCERNS or BLOCKED.
- A `sculptPart`/AtomicOps error inside a part → paste it; report BLOCKED.
- LLM HTTP error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-assembly.png` exists and is non-empty.
Open it: confirm the viewport shows TWO distinct positioned bodies (a base disc
with a pillar standing on it), and the BODIES panel lists 2 (or more) bodies.
Report honestly what you see.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-assembly-electron.spec.js
git commit -m "Add headed spec — AI builds a 2-part assembly in the ArchDisc desktop app (L4)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** First L4 slice — the AI decomposes an assembly into parts,
sculpts each (reusing L2 `sculptPart`), and positions them. Mate/constraint
solving, the DOF audit, and interference checks (the fuller L4) remain for a
later plan.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `translate(part, dx, dy, dz)` is added to AtomicOps and
exposed on `window.__archdiscAtomic`. `renderBody` is additive (no
previous-body removal), distinct from the replace-`render`. `buildAssemblyPrompt`,
`parseAssemblyPlan(text) -> [{name,description,position}]`, `sculptAssembly(
{description,llm,atomicApi,placeAndRender,providers?})` are consistent across
`AssemblyBuilder.js`, the workbench, and both specs. `sculptAssembly` reuses
`sculptPart` from `PartSculptor.js` unchanged.

---

## Subsequent Plans

- **Plan 11 — fillet/chamfer** (investigate the platform fillet path first).
- **Plan 12 — L4 mates: concentric/coincident positioning + interference check.**
- **Plan 13+ — L3 part verification, L5 dynamics, L6 render, L7 swarm → the watch.**
