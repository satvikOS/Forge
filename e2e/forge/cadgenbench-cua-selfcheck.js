#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cadgenbench-cua-selfcheck.js — OFFLINE wiring self-check for the genuine-CUA
// CADGenBench harness. NO Electron, NO GPU, NO model — safe to run while a CPT
// train holds the GPU.
//
// It proves the harness is correctly wired end-to-end by running the REAL helper
// functions (the SAME code the spec uses) against a MockPage that simulates the
// LIVE console WITHOUT the model:
//   1. the fixture spec is TYPED into the (mock) command bar and Enter is pressed
//      → that triggers the mock "runArchie" (proving the prompt reaches the
//         genuine submit path);
//   2. the export path resolves to a REAL numeric handle off window.__forgeBodies
//      and writes <id>/output.step;
//   3. the honest-miss path produces NO output.step when the model drives nothing.
// Plus static guards: both files parse (node --check) and the spec routes through
// the genuine console with NO dispatchToolCall/__forgeRun build bypass.
//
// IMPORTANT: the STEP bytes written here come from a MOCK forge.io.exportStep
// living ONLY in this self-check. The REAL spec calls the live OCCT writer
// (window.forge.io.exportStep → kernel.io.exportStep). There is NO mock and NO
// fake STEP anywhere in the real harness path.
//
//   Run:  node e2e/forge/cadgenbench-cua-selfcheck.js
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./cadgenbench-cua-helper.js');

const SPEC_FILE = path.join(__dirname, 'cadgenbench-cua.spec.js');
const HELPER_FILE = path.join(__dirname, 'cadgenbench-cua-helper.js');

let failures = 0;
function ok(name) { console.log(`  PASS  ${name}`); }
function bad(name, detail) { failures++; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

// ─────────────────────────────────────────────────────────────────────────────
// MockPage — a minimal Playwright-page shim that simulates the GENUINE console
// flow without Electron or the model. `evaluate(fn,arg)` runs the browser
// function against a fabricated window/document; the cmdbar Enter press triggers
// a mock model build (or, in miss mode, nothing).
// ─────────────────────────────────────────────────────────────────────────────
class MockPage {
  constructor({ buildOnSubmit = true } = {}) {
    this.buildOnSubmit = buildOnSubmit;
    this.submittedPrompt = null;
    this.inputValue = '';
    this._toolSteps = [];
    // the fabricated browser globals.
    const self = this;
    this.win = {
      __forgeBodies: [],
      __forgeFit: () => {},
      __forgeSetBodies: (next) => { self.win.__forgeBodies = Array.isArray(next) ? next : []; },
      forge: {
        isReady: () => true,
        io: {
          // MOCK writer (self-check ONLY). The real spec uses the OCCT writer.
          exportStep: (handle, fp) => {
            if (typeof handle !== 'number') return false;
            const step = [
              'ISO-10303-21;',
              'HEADER;',
              "FILE_DESCRIPTION(('cadgen-cua selfcheck mock'),'2;1');",
              "FILE_NAME('output.step','2026-06-27',(''),(''),'','','');",
              "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
              'ENDSEC;',
              'DATA;',
              '#10=CARTESIAN_POINT(\'\',(0.,0.,0.));',
              '#20=MANIFOLD_SOLID_BREP(\'mock\',#10);',
              '/* padding to clear the 500-byte non-trivial gate '.padEnd(560, '.') + ' */',
              'ENDSEC;',
              'END-ISO-10303-21;',
            ].join('\n');
            fs.writeFileSync(fp, step);
            return true;
          },
        },
      },
    };
    this.doc = {
      querySelectorAll: (sel) => {
        if (sel.includes('data-role="tool"')) {
          return self._toolSteps.map((t) => ({ textContent: t }));
        }
        return [];
      },
    };
  }

  // run a browser fn against the fabricated globals.
  async evaluate(fn, arg) {
    const pw = global.window; const pd = global.document;
    global.window = this.win; global.document = this.doc;
    try { return await fn(arg); }
    finally { global.window = pw; global.document = pd; }
  }

  async waitForTimeout(ms) { return new Promise((r) => setTimeout(r, Math.min(1, ms || 0))); }
  async addInitScript() { /* no-op in the mock */ }

  locator(sel) {
    const self = this;
    return {
      async click() {},
      async fill(v) { self.inputValue = v; },
      async type(v) { self.inputValue = (self.inputValue || '') + v; },
      async press(key) {
        // THE genuine submit: Enter on the cmdbar input → runArchie. The mock
        // model then drives a body into the scene (or nothing, in miss mode).
        if (sel.includes('forge-cmdbar-input') && key === 'Enter') {
          self.submittedPrompt = self.inputValue;
          if (self.buildOnSubmit) {
            self.win.__forgeBodies = [{
              id: 'archie-mockbuild-1', kind: 'native', handle: 7, toolId: 'part.finish',
            }];
            self._toolSteps = ['▶ part.begin ✓', '▶ part.add cylinder ✓', '▶ part.finish ✓'];
          }
        }
      },
      async count() { return 1; },
      async screenshot({ path: p }) { fs.writeFileSync(p, Buffer.from('PNGMOCK')); },
      async boundingBox() { return { x: 0, y: 0, width: 100, height: 100 }; },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
(async function main() {
  console.log('cadgenbench-cua self-check (offline — no GPU, no Electron, no model)\n');

  // ── A) both files parse (node --check) ──────────────────────────────────────
  for (const f of [HELPER_FILE, SPEC_FILE]) {
    try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); ok(`node --check ${path.basename(f)}`); }
    catch (e) { bad(`node --check ${path.basename(f)}`, String(e.stderr || e.message)); }
  }

  // ── B) spec routes through the GENUINE console, no build bypass ─────────────
  const specSrc = fs.readFileSync(SPEC_FILE, 'utf8');
  const helperSrc = fs.readFileSync(HELPER_FILE, 'utf8');
  check('genuine console entry (forge-cmdbar-input typed + Enter)',
    /forge-cmdbar-input/.test(helperSrc) && /press\(['"]Enter['"]\)/.test(helperSrc),
    'helper must type into the live command bar and press Enter');
  check('routes via runArchie (submitPromptToConsole → onSubmit → runArchie)',
    /submitPromptToConsole/.test(specSrc) || /submitPromptToConsole/.test(helperSrc),
    'the per-fixture flow must go through submitPromptToConsole');
  // the forbidden deterministic build bypass: an actual dispatchToolCall({...})
  // call or a __forgeRun(...) call that builds geometry. A `typeof …
  // dispatchToolCall === 'function'` readiness probe is fine and not a call.
  const bypassDispatch = /dispatchToolCall\s*\(\s*\{/.test(specSrc) || /dispatchToolCall\s*\(\s*\{/.test(helperSrc);
  const bypassRun = /__forgeRun\s*\(/.test(specSrc) || /__forgeRun\s*\(/.test(helperSrc);
  check('NO dispatchToolCall({…}) build bypass', !bypassDispatch, 'found a direct dispatchToolCall build call');
  check('NO __forgeRun(…) build bypass', !bypassRun, 'found a direct __forgeRun build call');

  // ── C) fixtures load — 49 specs, keyed by id ────────────────────────────────
  let specs = [];
  try { specs = H.loadSpecs(); ok(`loadSpecs() → ${specs.length} fixtures from ${H.DEFAULT_SPECS}`); }
  catch (e) { bad('loadSpecs()', e.message); }
  check('49 gen fixtures present', specs.length === 49, `got ${specs.length}`);
  check('every fixture has a non-empty id + spec',
    specs.length > 0 && specs.every((f) => f.id && typeof f.spec === 'string' && f.spec.length > 0));
  check('pickFixtures filters by only/limit',
    (() => {
      const a = H.pickFixtures(specs, { limit: 3 }).length === Math.min(3, specs.length);
      const b = specs.length === 0 || H.pickFixtures(specs, { only: specs[0].id }).length === 1;
      return a && b;
    })());

  // ── D) output layout matches the CADGenBench submission contract ────────────
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'cadgen-cua-selfcheck-'));
  check('stepPathFor → <out>/<id>/output.step',
    H.stepPathFor(tmpOut, '101') === path.join(tmpOut, '101', 'output.step'),
    H.stepPathFor(tmpOut, '101'));

  // ── E) END-TO-END WIRING (hit): genuine submit → handle → output.step ───────
  if (specs.length > 0) {
    const fx = specs[0];
    const page = new MockPage({ buildOnSubmit: true });
    const rec = await H.runFixture(page, fx, { outRoot: tmpOut, buildMs: 20000, render: true, adapterLabel: 'selfcheck-mock' });
    check('prompt reached runArchie (typed spec == submitted prompt)',
      page.submittedPrompt === fx.spec, `submitted="${String(page.submittedPrompt).slice(0, 50)}…"`);
    check('export resolved to a REAL numeric handle', rec.handle === 7, `handle=${rec.handle}`);
    check('fixture recorded as a hit', rec.status === 'hit', `status=${rec.status} reason=${rec.reason}`);
    const sp = H.stepPathFor(tmpOut, fx.id);
    check('output.step written to <id>/output.step', fs.existsSync(sp), sp);
    check('written STEP passes validateStepFile (ISO-10303-21 + B-rep)', H.validateStepFile(sp).ok);
    check('meta.json written for the fixture', fs.existsSync(H.metaPathFor(tmpOut, fx.id)));
    check('model-drove proof: tool steps captured', rec.toolCalls >= 1, `toolCalls=${rec.toolCalls}`);
  }

  // ── F) HONEST MISS: model drives nothing → NO output.step ───────────────────
  if (specs.length > 1) {
    const fx = specs[1];
    const page = new MockPage({ buildOnSubmit: false });
    const rec = await H.runFixture(page, fx, { outRoot: tmpOut, buildMs: 60, render: false, adapterLabel: 'selfcheck-miss' });
    check('honest miss recorded (status=miss)', rec.status === 'miss', `status=${rec.status}`);
    const sp = H.stepPathFor(tmpOut, fx.id);
    check('NO output.step written on a miss (no placeholder)', !fs.existsSync(sp), `unexpected file at ${sp}`);
    check('miss still writes meta.json provenance', fs.existsSync(H.metaPathFor(tmpOut, fx.id)));
  }

  // cleanup
  try { fs.rmSync(tmpOut, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('self-check crashed:', e); process.exit(1); });
