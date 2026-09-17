// t129_invalid_handle_parity.mjs — the behavioural control for T-129.
//
// T-129 replaces `kindOf(h) == ShapeKind::NativeSolid` + `getNativeSolid(h)` with
// the OCCT-free seam (`nativeSolidOf(h)` / `nativeMeshOf(h)`) at six production
// sites. The seam NEVER THROWS: it answers nullptr where the old pair raised
// "ShapeRegistry::kindOf — invalid handle". That is a REAL behavioural difference,
// and the single most likely way this change breaks something quietly is a site
// that used to throw on a bad handle and now silently takes a different branch.
//
// So this file asserts the OUTCOME an external caller sees, at each of the six
// sites, for a handle that names nothing. It says nothing about which internal
// function raised — only that the call still FAILS rather than succeeding, or
// returning an empty result, or writing a file.
//
// It is run with FORGE_NATIVE_FEATURES=1 so the native branches T-129 edited are
// actually TAKEN. With the gate at its default (off) three of the six sites are
// not even reached, which would make this control vacuous.
//
// Exit 0 iff every case still throws.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const k = require('../build/Release/forge-kernel.node');

if (!process.env.FORGE_NATIVE_FEATURES) {
  console.error('FATAL: run with FORGE_NATIVE_FEATURES=1 — otherwise the native ' +
                'branches this control exists for are gated off and it proves nothing.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't129-'));
// A handle that was never issued. liveCount()/totalEverIssued() stay far below
// this, and 0 is kInvalidHandle, so both spellings of "names nothing" are covered.
const GHOST = 0xBADF00D;
const ZERO  = 0;

let pass = 0, fail = 0;
function mustThrow(name, fn) {
  let threw = false, what = '';
  try { fn(); } catch (e) { threw = true; what = String(e && e.message || e).slice(0, 90); }
  if (threw) { pass++; console.log(`PASS ${name} -> threw: ${what}`); }
  else       { fail++; console.log(`FAIL ${name} -> RETURNED NORMALLY on a handle that names nothing`); }
}

const smp = { thickness: 1.0, minBendRadius: 1.0, kFactor: 0.44 };

for (const h of [GHOST, ZERO]) {
  const tag = h === ZERO ? 'kInvalidHandle' : 'unissued';

  // IoExchange.cpp :366 — exportStl. The else-branch of the converted dispatch.
  mustThrow(`io.exportStl(${tag})`,
            () => k.io.exportStl(h, path.join(tmp, `stl_${tag}.stl`), 0.05, 0.08, true));

  // IoExchange.cpp :148 — exportStep. `k = kindOf(h)` is kept here as the
  // invalid-handle throw AND the OCCT-kind question.
  mustThrow(`io.exportStep(${tag})`,
            () => k.io.exportStep(h, path.join(tmp, `step_${tag}.step`)));

  // ClassASurfacing.cpp :250 — stitchG2. tryNativeStitchG2 now DEFERS instead of
  // throwing; the OCCT path below it must still raise.
  mustThrow(`classa.stitchG2(${tag})`,
            () => k.classa.stitchG2([h, h], 1e-3, false));

  // SheetMetal.cpp :302 — closedCorner reaches tryNativeFuseBrick with the raw
  // handle and falls through to ShapeRegistry::get(shape) on deferral.
  mustThrow(`sheetMetal.closedCorner(${tag})`,
            () => k.sheetMetal.closedCorner(h, 0, smp, 0.5));

  // Sewing.cpp :124 — the else-if kindOf() arm is retained, so this is unchanged.
  mustThrow(`sewing.sew(${tag})`,
            () => k.sewing.sew([h, h], 1e-3));

  // FeaTet.cpp :1128 — same retained else-if arm.
  mustThrow(`fea.meshFromBrep(${tag})`,
            () => k.fea.meshFromBrep(h, 5.0));
}

// CONTROL, so a green above cannot be "everything throws for some other reason":
// a REAL handle must still export. If this fails the harness is broken, not the code.
const box = k.makeBox(10, 10, 10);
const okPath = path.join(tmp, 'real.step');
let ctrlOk = false;
try { k.io.exportStep(box, okPath); ctrlOk = fs.existsSync(okPath) && fs.statSync(okPath).size > 0; }
catch (e) { console.log('CONTROL threw: ' + e.message); }
if (ctrlOk) { pass++; console.log('PASS control: a real handle still exports a non-empty STEP'); }
else        { fail++; console.log('FAIL control: a REAL handle failed to export — this control is measuring nothing'); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`=== t129 invalid-handle parity: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
