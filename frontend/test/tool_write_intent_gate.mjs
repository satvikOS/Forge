// T-131 — can an Archie tool call put a file where it likes?
//
// HOW THIS GATE AVOIDS BEING BLIND, which is the failure this family keeps
// repeating (T-123, T-124 and T-130 each shipped with a green gate beside a live
// defect). The obvious instrument is "dispatchToolCall returns ok:false", and it
// is WORTHLESS here: on an unguarded tree the attack call also returns ok:false,
// because with no kernel loaded `forge.io.exportStl` is undefined and the verb
// throws for a completely unrelated reason. A gate asserting ok:false would be
// GREEN on the defect.
//
// So the observable is the WRITE ITSELF. A stub kernel records every (path,
// bytes) it is asked to write. On a tree without the guard the attack path lands
// in that list; on a guarded tree the list is empty AND the error names the
// refusal. Both halves are required -- an empty list alone would also be
// produced by a verb that crashed early.
//
// Run:  node --test frontend/test/tool_write_intent_gate.mjs
// This file is deliberately runnable against the PARENT tree, where the
// declaration/unit arms self-skip and the measured arm goes RED.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolCall, FORGE_TOOLS } from '../src/ai/ForgeToolBridge.js';

const intent = await import('../src/ai/fileIntent.js').catch(() => null);

/** A kernel that writes nothing but remembers everything it was asked to write. */
function recordingForge() {
  const writes = [];
  const rec = (p) => { writes.push(String(p)); return true; };
  return {
    writes,
    io: {
      exportStep: (_h, p) => rec(p),
      exportStl: (_h, p) => rec(p),
      exportStepWithPmi: (_h, p) => rec(p),
      writeTextFile: (p) => rec(p),
      importStep: () => 1,
    },
    dialog: { writeBlob: (p) => rec(p) },
  };
}

// Each attack is a path a model could choose that is not the kind of file the
// verb exports. The first two are the ones with teeth on a real machine.
const ATTACKS = [
  ['a launch agent', '/Users/victim/Library/LaunchAgents/com.evil.plist'],
  ['a shell rc file', '/Users/victim/.zshrc'],
  ['traversal out of a temp dir', '/tmp/forge/../../Users/victim/.ssh/authorized_keys'],
  ['a relative path', 'evil.step'],
  ['no extension at all', '/Users/victim/authorized_keys'],
];

// Two verbs whose `run` reaches a writer with nothing but a stub: both take
// (shape, filepath) and call forge.io.*. The guard lives in the dispatcher, so
// it is verb-independent by construction; these two make it MEASURABLE.
const MEASURED = [
  { name: 'io.export-step', args: (fp) => ({ shape: 1, filepath: fp }), legal: '/tmp/forge-t131/out.step' },
  { name: 'io.export-stl', args: (fp) => ({ shape: 1, filepath: fp }), legal: '/tmp/forge-t131/out.stl' },
];

test('MEASURED: an attack path is never written, and the refusal says why', async () => {
  for (const verb of MEASURED) {
    for (const [what, fp] of ATTACKS) {
      const forge = recordingForge();
      const res = await dispatchToolCall(
        { name: verb.name, arguments: verb.args(fp) }, { forge });
      assert.deepEqual(
        forge.writes, [],
        `${verb.name} WROTE ${what} (${fp}) -- the kernel was asked to write `
        + `${JSON.stringify(forge.writes)}`);
      assert.equal(res.ok, false, `${verb.name} accepted ${what}`);
      assert.match(
        String(res.error), /NOT APPLIED|ABSOLUTE|'\.\.' segment|NUL byte/,
        `${verb.name} refused ${what} for the WRONG REASON: ${res.error}. An `
        + 'unguarded tree also fails here, because no kernel is loaded.');
    }
  }
});

test('MEASURED: the legal path is still written -- the guard is not a wall', async () => {
  for (const verb of MEASURED) {
    const forge = recordingForge();
    const res = await dispatchToolCall(
      { name: verb.name, arguments: verb.args(verb.legal) }, { forge });
    assert.equal(res.ok, true, `${verb.name} refused its own legal path: ${res.error}`);
    assert.deepEqual(forge.writes, [verb.legal]);
  }
});

test('the declaration covers every filesystem path, and only those', { skip: !intent && 'fileIntent.js absent (parent tree)' }, () => {
  const { pathParams, assertFileIntentDeclared } = intent;
  const withPaths = FORGE_TOOLS.filter((t) => pathParams(t).length);
  assert.equal(withPaths.length, 13,
    `expected 13 verbs with a filesystem path, found ${withPaths.length}: `
    + withPaths.map((t) => t.name).join(', '));
  // The four geometric `path`/`toolpath` params must NOT be swept in.
  for (const n of ['part.pipe', 'part.sweep', 'manufacture.gcode', 'cam.material-removal']) {
    const spec = FORGE_TOOLS.find((t) => t.name === n);
    assert.equal(pathParams(spec).length, 0,
      `${n} has a GEOMETRIC path, not a filesystem one; declaring it would `
      + 'document a writer that does not exist');
  }
  assert.equal(assertFileIntentDeclared(FORGE_TOOLS), FORGE_TOOLS.length);
});

test('NEGATIVE CONTROL: strip one declaration and that verb can no longer write',
  { skip: !intent && 'fileIntent.js absent (parent tree)' }, async () => {
    const spec = FORGE_TOOLS.find((t) => t.name === 'io.export-step');
    const keep = spec.files;
    try {
      delete spec.files;
      const forge = recordingForge();
      const res = await dispatchToolCall(
        { name: 'io.export-step', arguments: { shape: 1, filepath: '/tmp/forge-t131/out.step' } },
        { forge });
      assert.equal(res.ok, false, 'an undeclared verb wrote a legal-looking path');
      assert.deepEqual(forge.writes, []);
      assert.match(String(res.error), /declares no file intent/);
    } finally {
      spec.files = keep;
    }
  });

test('the path policy, term by term', { skip: !intent && 'fileIntent.js absent (parent tree)' }, () => {
  const { checkPathArg, extensionOf, hasTraversal } = intent;
  const spec = { name: 'x', parameters: {}, files: { filepath: { mode: 'write', ext: ['.step'] } } };
  assert.equal(checkPathArg(spec, 'filepath', '/tmp/a.step'), null);
  assert.equal(checkPathArg(spec, 'filepath', '/tmp/a.STEP'), null, 'extension match is case-insensitive');
  assert.match(checkPathArg(spec, 'filepath', '/tmp/a.stl'), /NOT APPLIED/);
  assert.match(checkPathArg(spec, 'filepath', 'a.step'), /ABSOLUTE/);
  assert.match(checkPathArg(spec, 'filepath', '/tmp/../a.step'), /'\.\.' segment/);
  assert.equal(checkPathArg(spec, 'filepath', ''), null, 'an absent optional path is not an attack');
  assert.equal(checkPathArg(spec, 'filepath', undefined), null);
  // `a..b.step` contains '..' as a SUBSTRING and is a perfectly ordinary name.
  assert.equal(hasTraversal('/tmp/a..b.step'), false);
  assert.equal(extensionOf('/Users/v/.zshrc'), '', 'a dotfile has no extension');
  assert.equal(extensionOf('/tmp/x'), '');
  assert.equal(extensionOf('/tmp/a.b.STEP'), '.step');
});

test('a verb may not misrepresent the file type it produces',
  { skip: !intent && 'fileIntent.js absent (parent tree)' }, async () => {
    // The union form of this declaration accepted SDF content in a .urdf file.
    const cases = [
      ['sdf', '/tmp/model.urdf', false, 'SDF content into a .urdf file'],
      [undefined, '/tmp/model.sdf', false, 'the urdf default into a .sdf file'],
      ['urdf', '/tmp/model.urdf', true, 'urdf into .urdf'],
      ['sdf', '/tmp/model.sdf', true, 'sdf into .sdf'],
      ['mjcf', '/tmp/model.xml', true, 'mjcf into .xml (MuJoCo is XML)'],
    ];
    for (const [format, filepath, allowed, what] of cases) {
      const forge = recordingForge();
      const res = await dispatchToolCall(
        { name: 'io.export-robot',
          arguments: { assembly: { parts: [], mates: [] }, format, filepath } }, { forge });
      const refusedByGuard = !res.ok && /NOT APPLIED/.test(String(res.error));
      assert.equal(refusedByGuard, !allowed,
        `${what}: expected ${allowed ? 'allowed' : 'refused'}, got ${res.error || 'ok'}`);
    }
  });

test('the Electron bridge keeps a trusted path for generated staging files',
  { skip: !intent && 'fileIntent.js absent (parent tree)' }, async () => {
    // REGRESSION: requiring a panel for every writeBlob broke project OPEN.
    // projectFile.js writeTmpStep stages /tmp/forge-project-*.step with no
    // dialog, loadProject catches the throw into restoreErrors and continues,
    // so every native body vanished while loadProject returned ok:true.
    const { createRequire } = await import('node:module');
    let consent;
    try { consent = createRequire(import.meta.url)('../../electron/writeConsent.js'); }
    catch { return; }
    const os = await import('node:os');
    consent.resetConsentForTests();
    for (const [p, want, what] of [
      ['/tmp/forge-project-1-b1-abc.step', true, 'the project-open stager'],
      ['/tmp/forge-brepcache-1-x-q.brep', true, 'the brep cache stager'],
      [`${os.tmpdir()}/forge-thing.step`, true, 'os.tmpdir() staging'],
      ['/tmp/evil.step', false, 'temp without the forge- prefix'],
      ['/tmp/forge-sub/evil.plist', false, 'nested below temp'],
      ['/Users/v/Library/LaunchAgents/forge-evil.plist', false, 'forge- prefix, wrong directory'],
      ['/Users/v/.zshrc', false, 'a dotfile'],
    ]) {
      assert.equal(consent.consentedFor(p), want, `${what}: ${p}`);
    }
  });

test('consent travels with the path (the Electron write bridge)',
  { skip: !intent && 'fileIntent.js absent (parent tree)' }, async () => {
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    let consent;
    try {
      consent = require_('../../electron/writeConsent.js');
    } catch {
      return; // parent tree
    }
    consent.resetConsentForTests();
    assert.equal(consent.consentedFor('/tmp/forge-t131/x.step'), false,
      'a path nobody chose is writable before any panel');
    consent.rememberConsent('/tmp/forge-t131/chosen.step');
    assert.equal(consent.consentedFor('/tmp/forge-t131/chosen.step'), true);
    assert.equal(consent.consentedFor('/tmp/forge-t131/mesh0.stl'), true,
      'a sidecar beside a chosen document is allowed -- io.export-robot needs it');
    assert.equal(consent.consentedFor('/tmp/forge-t131/../../Users/v/.zshrc'), false,
      'a sidecar may not climb out of the chosen directory');
    assert.equal(consent.consentedFor('/Users/v/Library/LaunchAgents/e.plist'), false);
    assert.equal(consent.consentedFor('relative.step'), false);
  });
