// PUSH-10 camx smoke test. Run via:
//   node forge-kernel/test/camx_smoke.cjs
// Loads the forge-kernel.node built in THIS tree.
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
const out = {};

// 1. listTools
const tools = camx.listTools();
out.toolCount = tools.length;
out.toolIds   = tools.map(t => t.id);
out.toolNames = tools.map(t => ({ id: t.id, type: t.type, dia: t.diameter, mat: t.material }));

// 2. pocketToolpath — 100x100 square pocket, 6mm endmill, depth=5, stepdown=2.5, stepover=4
const square = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
const pocketSegs = camx.pocketToolpath([square], 1, { depth:5, stepdown:2.5, stepover:4, direction:'climb' });
const zLevels = new Set();
pocketSegs.forEach(s => s.forEach(p => zLevels.add(p.z.toFixed(4))));
out.pocketSegments = pocketSegs.length;
out.pocketFirstSegLen = pocketSegs[0].length;
out.pocketZLevels = [...zLevels].sort((a,b)=>parseFloat(b)-parseFloat(a));

// 3. contourToolpath — 50x30 rectangle, outside, depth=4, stepdown=2
const rect = [{x:0,y:0},{x:50,y:0},{x:50,y:30},{x:0,y:30}];
const contour = camx.contourToolpath(rect, 1, 'outside', { depth:4, stepdown:2, direction:'climb' });
out.contourSegments = contour.length;
out.contourFirstSegLen = contour[0].length;
out.contourSampleZ = contour.map(c => c[0].z);
out.contourFirstPoint = contour[0][0];

// 4. drillToolpath — 4 holes, G83 peck
const holes = [{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}];
const drill = camx.drillToolpath(holes, 5, 'G83', { depth:8, retract:2, peck:2 });
out.drillCycleCount = drill.length;
out.drillFirstHoleMoves = drill[0].length;
out.drillFirstHoleZs = drill[0].map(p => p.z);

// 5. postProcess — small pocket (100x100x-10) for all 3 dialects
const smallPocket = camx.pocketToolpath([square], 1, { depth:10, stepdown:5, stepover:5, direction:'climb' });
const fanucGcode = camx.postProcess(smallPocket, 'fanuc',      { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
const heidGcode  = camx.postProcess(smallPocket, 'heidenhain', { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
const siemGcode  = camx.postProcess(smallPocket, 'siemens',    { spindleRPM:10000, feed:1200, safeZ:10, toolId:1 });
out.fanucLines      = fanucGcode.split('\n').length;
out.heidenhainLines = heidGcode.split('\n').length;
out.siemensLines    = siemGcode.split('\n').length;
out.fanucHasPercent = fanucGcode.includes('%');
out.fanucHasO0001   = fanucGcode.includes('O0001');
out.fanucHasM30     = fanucGcode.includes('M30');
out.heidHasBeginPgm = heidGcode.includes('BEGIN PGM');
out.heidHasEndPgm   = heidGcode.includes('END PGM');
out.heidHasToolCall = heidGcode.includes('TOOL CALL');
out.siemHasG54      = siemGcode.includes('G54');
out.siemHasT1M6     = siemGcode.includes('T1 M6');
out.siemHasHeader   = siemGcode.includes(';Header');

// 6. estimateCycleTime
const ct = camx.estimateCycleTime(smallPocket, 1200);
out.cycleTotalMm = ct.totalLengthMm;
out.cycleTimeSec = ct.timeSec;

console.log(JSON.stringify(out, null, 2));
