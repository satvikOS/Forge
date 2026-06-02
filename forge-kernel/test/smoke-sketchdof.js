// Forge-208 — sketch DOF audit smoke.

const kernel = require('../build/Release/forge-kernel.node');
const sd = kernel.sketchdof;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// (1) A line (4 DOF) with coincident at both ends + horizontal +
//     distance = 4 - (2 + 2 + 1 + 1) = -2 → over-constrained.
let r = sd.audit({
  entities:    [{ kind: 'line' }],
  constraints: [
    { kind: 'coincident' }, { kind: 'coincident' },
    { kind: 'horizontal' }, { kind: 'distance' },
  ],
});
ck(r.totalDof === 4,        `(1) totalDof ${r.totalDof}`);
ck(r.constrainedDof === 6,  `(1) constrainedDof ${r.constrainedDof}`);
ck(r.freeDof === -2,        `(1) freeDof ${r.freeDof}`);
ck(r.status === 'over',     `(1) status ${r.status}`);

// (2) Square sketch: 4 lines connected at vertices.
//     4 × line = 16 DOF.
//     4 coincident (vertex pairs) = 8.
//     2 horizontal + 2 vertical = 4.
//     1 fix on a corner = 2.
//     1 distance = 1.
//     16 - (8 + 4 + 2 + 1) = 1 → under-constrained by 1.
r = sd.audit({
  entities: Array(4).fill({ kind: 'line' }),
  constraints: [
    ...Array(4).fill({ kind: 'coincident' }),
    { kind: 'horizontal' }, { kind: 'horizontal' },
    { kind: 'vertical' }, { kind: 'vertical' },
    { kind: 'fix' },
    { kind: 'distance' },
  ],
});
ck(r.totalDof === 16, `(2) totalDof ${r.totalDof}`);
ck(r.freeDof === 1,   `(2) freeDof ${r.freeDof} (expected 1)`);
ck(r.status === 'under', `(2) status ${r.status}`);

// (3) Custom DOF override — a constraint of kind "block" counts as 3.
r = sd.audit({
  entities:    [{ kind: 'line' }],
  constraints: [{ kind: 'block' }],
  constraintOverrides: [{ kind: 'block', dof: 3 }],
});
ck(r.constrainedDof === 3, `(3) override constrainedDof ${r.constrainedDof}`);
ck(r.freeDof === 1, `(3) override freeDof ${r.freeDof}`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-208 sketch DOF smoke: OK');
console.log(`  square: 16 DOF, 15 constrained → ${r.status} (1 left)`);
