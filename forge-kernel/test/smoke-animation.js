// Forge-209 — animation timeline smoke.

const kernel = require('../build/Release/forge-kernel.node');
const a = kernel.animation;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// Single linear track: x = 0 at t=0, x = 10 at t=1.
const tracks = [
  {
    name: 'body0.translation',
    interpolation: 'linear',
    keys: [
      { time: 0, value: [0, 0, 0] },
      { time: 1, value: [10, 0, 0] },
    ],
  },
];

const d = a.duration(tracks);
close(d, 1, 1e-12, 'duration');

// Evaluate at t=0.5 → should be (5, 0, 0).
let s = a.evaluateAll(tracks, 0.5);
ck(s.length === 1, `samples ${s.length}`);
close(s[0].value[0], 5, 1e-12, 'lerp mid');

// Clamp before / after.
s = a.evaluateAll(tracks, -1);
close(s[0].value[0], 0, 1e-12, 'clamp before');
s = a.evaluateAll(tracks, 2);
close(s[0].value[0], 10, 1e-12, 'clamp after');

// Cubic — 3 keyframes, monotone segment should at least round-trip endpoints.
const tracksC = [{
  name: 'box.translation', interpolation: 'cubic',
  keys: [
    { time: 0, value: [0, 0, 0] },
    { time: 1, value: [1, 0, 0] },
    { time: 2, value: [4, 0, 0] },
  ],
}];
s = a.evaluateAll(tracksC, 0);
close(s[0].value[0], 0, 1e-12, 'cubic at t=0');
s = a.evaluateAll(tracksC, 2);
close(s[0].value[0], 4, 1e-12, 'cubic at t=2');
s = a.evaluateAll(tracksC, 1);
close(s[0].value[0], 1, 1e-12, 'cubic at t=1');

// sampleRange — 5 frames between 0 and 1 on the linear track.
const frames = a.sampleRange(tracks, 0, 1, 5);
ck(frames.length === 5, `frame count ${frames.length}`);
close(frames[0].time, 0,    1e-12, 'frame 0 time');
close(frames[4].time, 1,    1e-12, 'frame 4 time');
close(frames[2].values[0].value[0], 5, 1e-12, 'frame 2 mid value');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-209 animation smoke: OK');
console.log(`  linear mid: x = ${frames[2].values[0].value[0]}`);
console.log(`  cubic endpoints: 0 → 4 round-trip OK`);
