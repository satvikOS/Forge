// ★ THE KERNEL PATH IS TREE-LOCAL, and it used to be the PRIMARY CHECKOUT's.
// Hard-coding /Users/.../archdisc-Mech/forge-kernel/build/Release made this file
// load SOMEONE ELSE'S BINARY whenever it was run from a git worktree: the suite
// printed ALL PASS against a build that did not contain the change under test.
// MEASURED in this session — three suites reported green against a kernel dated
// four days earlier. Resolved from this file's own location instead, and a
// MISSING binary is a loud failure, never a silent fall back to another tree's.
const k = require(process.env.FORGE_KERNEL ||
        require('node:path').resolve(__dirname, '../build/Release/forge-kernel.node'));
const camx = k.camx;
const square = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
const pocketSegs = camx.pocketToolpath([square], 1, { depth:10, stepdown:5, stepover:5, direction:'climb' });

console.log('=== FANUC HEAD (first 15 lines) ===');
const fanuc = camx.postProcess(pocketSegs, 'fanuc', { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
console.log(fanuc.split('\n').slice(0,15).join('\n'));
console.log('=== FANUC TAIL (last 5 lines) ===');
console.log(fanuc.split('\n').slice(-6).join('\n'));

console.log('\n=== HEIDENHAIN HEAD ===');
const h = camx.postProcess(pocketSegs, 'heidenhain', { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
console.log(h.split('\n').slice(0,12).join('\n'));
console.log('=== HEIDENHAIN TAIL ===');
console.log(h.split('\n').slice(-4).join('\n'));

console.log('\n=== SIEMENS HEAD ===');
const s = camx.postProcess(pocketSegs, 'siemens', { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
console.log(s.split('\n').slice(0,12).join('\n'));
console.log('=== SIEMENS TAIL ===');
console.log(s.split('\n').slice(-5).join('\n'));
