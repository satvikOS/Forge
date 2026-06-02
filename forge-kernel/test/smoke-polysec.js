// Forge-224 — polygon centroid smoke.

const kernel = require('../build/Release/forge-kernel.node');
const ps = kernel.polysec;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Unit square at origin (CCW): vertices (0,0), (1,0), (1,1), (0,1).
//     A = 1, centroid = (0.5, 0.5), I_xx (about centroid) = b·h³/12 = 1/12,
//     I_yy = 1/12, I_xy = 0.
let r = ps.analyse({ outer: [[0,0],[1,0],[1,1],[0,1]] });
close(r.area, 1, 1e-12, 'unit square area');
close(r.centroid.x, 0.5, 1e-12, 'unit square Cx');
close(r.centroid.y, 0.5, 1e-12, 'unit square Cy');
close(r.IxxCentroid, 1/12, 1e-12, 'unit square Ixx');
close(r.IyyCentroid, 1/12, 1e-12, 'unit square Iyy');
close(r.IxyCentroid, 0, 1e-12, 'unit square Ixy');
// r_gyration = √(I/A) = √(1/12) ≈ 0.2887
close(r.radiusOfGyrationX, Math.sqrt(1/12), 1e-12, 'r_gyration X');

// (2) Right triangle (0,0), (3,0), (0,2):
//     A = 3, centroid = (1, 2/3),
//     I_xx (centroid) = b·h³/36 = 3·8/36 = 2/3
//     I_yy (centroid) = b³·h/36 = 27·2/36 = 1.5
r = ps.analyse({ outer: [[0,0],[3,0],[0,2]] });
close(r.area, 3, 1e-12, 'tri area');
close(r.centroid.x, 1, 1e-12, 'tri Cx');
close(r.centroid.y, 2/3, 1e-12, 'tri Cy');
close(r.IxxCentroid, 2/3, 1e-9, 'tri Ixx');
close(r.IyyCentroid, 1.5, 1e-9, 'tri Iyy');

// (3) Square with a 0.4 × 0.4 hole centred at (0.5, 0.5).
//     Net A = 1 - 0.16 = 0.84
const h = 0.2;   // half-side of hole
r = ps.analyse({
  outer: [[0,0],[1,0],[1,1],[0,1]],
  holes: [[
    [0.5-h, 0.5-h], [0.5-h, 0.5+h],
    [0.5+h, 0.5+h], [0.5+h, 0.5-h],
  ]],   // CW so the cross product flips sign
});
close(r.area, 1 - 0.16, 1e-12, 'with-hole area');
close(r.centroid.x, 0.5, 1e-12, 'with-hole Cx (still centre)');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-224 polygon section smoke: OK');
console.log(`  unit square: I=${(1/12).toFixed(6)} (b·h³/12 exact)`);
console.log(`  triangle:    I_xx=${(2/3).toFixed(6)} (b·h³/36 exact)`);
console.log(`  with hole:   area=${r.area.toFixed(3)} (centred remains centre)`);
