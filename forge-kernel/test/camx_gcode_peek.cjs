const k = require('/Users/account_clawteam1/archdisc-Mech/forge-kernel/build/Release/forge-kernel.node');
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
