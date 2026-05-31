// io_pmi_smoke — STEP AP242 PMI/MBD export.
//
// Build a 10mm box, export STEP with one FCF annotation embedded as a
// PMI comment block, then re-read the file as text and assert:
//   * the AP242 header is present (write.step.schema = AP242DIS),
//   * the `/* PMI_FCF: ⊥|0.05|A */` comment block is present,
//   * the file still parses through forge.io.importStep (so the PMI
//     comment didn't corrupt the ISO-10303-21 stream),
//   * the re-imported solid has the expected mass props.

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-io-pmi-'));
console.log('[io-pmi-smoke] tmp =', TMP);

const box = forge.makeBox(10, 10, 10);

const stepPath = path.join(TMP, 'box-with-fcf.step');
const notes = [
  { text: '⊥|0.05|A',         anchorKind: 'face', anchorId: 1 },
  { text: '⌖|0.10|A|B|C',     anchorKind: 'face', anchorId: 3 },
  { text: '□|0.02',            anchorKind: '',    anchorId: 0 }, // unanchored flatness
];
forge.io.exportStepWithPmi(box, stepPath, notes);
assert.ok(fs.existsSync(stepPath), 'STEP+PMI file should exist');

const stepText = fs.readFileSync(stepPath, 'utf8');
assert.ok(/AP242/i.test(stepText) || /AUTOMOTIVE_DESIGN/i.test(stepText),
          'STEP file should declare the AP242 / AUTOMOTIVE_DESIGN schema');
assert.ok(stepText.includes('PMI_BLOCK_BEGIN'), 'PMI block opener missing');
assert.ok(stepText.includes('PMI_BLOCK_END'),   'PMI block terminator missing');
assert.ok(stepText.includes('PMI_FCF: ⊥|0.05|A'),
          'expected PMI_FCF perpendicularity comment');
assert.ok(stepText.includes('PMI_FCF: ⌖|0.10|A|B|C'),
          'expected PMI_FCF position comment');
assert.ok(stepText.includes('PMI_FCF: □|0.02'),
          'expected PMI_FCF flatness comment');
// All comments are inside an ISO-10303-21 block — `END-ISO-10303-21;`
// must still terminate after the PMI block.
const pmiIdx = stepText.indexOf('PMI_BLOCK_END');
const endIdx = stepText.indexOf('END-ISO-10303-21');
assert.ok(pmiIdx > 0 && endIdx > pmiIdx,
          'PMI block must be inserted *before* the ISO close marker');

// The file should still re-import via importStep (PMI comments are
// ISO-10303-21 C-comments, which the reader silently skips).
const reimported = forge.io.importStep(stepPath);
const mp = forge.massProps(reimported);
assert.ok(Math.abs(mp.volume - 1000) < 1e-4, `re-import vol ${mp.volume} != 1000`);
assert.ok(Math.abs(mp.area   - 600)  < 1e-4, `re-import area ${mp.area} != 600`);
console.log(`[io-pmi-smoke] PMI block present, file still parses (vol=${mp.volume.toFixed(2)})`);

forge.release(reimported);
forge.release(box);

// Empty-notes case: should write a vanilla STEP without any PMI block.
const stepPath2 = path.join(TMP, 'plain.step');
const box2 = forge.makeBox(5, 5, 5);
forge.io.exportStepWithPmi(box2, stepPath2, []);
const txt2 = fs.readFileSync(stepPath2, 'utf8');
assert.ok(!txt2.includes('PMI_BLOCK_BEGIN'),
          'empty notes → no PMI block');
forge.release(box2);
console.log('[io-pmi-smoke] empty-notes path OK (vanilla STEP)');

console.log('[io-pmi-smoke] ALL PASS');
