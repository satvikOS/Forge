// forge-kernel inertia smoke test — Task #43.
// ---------------------------------------------------------------------------
// Verifies that forge.massProps(handle).inertiaCom is the EXACT rigid-body
// inertia tensor of the solid about its CENTRE OF MASS, at unit density
// (row-major 9, units mass·mm² with mass == volume), computed by OCCT
// GProp_GProps::MatrixOfInertia() in the native kernel.
//
// Cross-checked against the textbook closed forms (about the COM):
//   Solid box  a×b×c :  I = m/12 · diag(b²+c², a²+c², a²+b²),  products = 0
//                       (Mirtich 1996, "Fast and Accurate Computation of
//                        Polyhedral Mass Properties", J. Graphics Tools 1(2);
//                        Eberly, "Polyhedral Mass Properties".)
//   Solid cylinder r,h (axis +Z) :  Izz = ½ m r²,
//                                    Ixx = Iyy = 1/12 m (3r² + h²)
//   Solid sphere r :  I = ⅖ m r² · E  (isotropic, products = 0)
// At unit density the kernel mass m equals the volume V, so substitute m = V.
//
// Exits non-zero on any failure so CI can gate.
// ---------------------------------------------------------------------------

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let forge;
try {
  forge = require(KERNEL);
} catch (e) {
  console.error(`[inertia] failed to load ${KERNEL}: ${e.message}`);
  process.exit(1);
}

// relative closeness with an absolute floor (for ~0 off-diagonals).
function close(got, exp, relTol, absFloor) {
  const tol = Math.max(relTol * Math.abs(exp), absFloor || 0);
  return Math.abs(got - exp) <= tol;
}

// ---- solid box a×b×c, about COM, unit density (mass = V = a·b·c) -----------
{
  const a = 3, b = 5, c = 7;
  const V = a * b * c;
  const mp = forge.massProps(forge.makeBox(a, b, c));
  const I = mp.inertiaCom;
  assert.ok(Array.isArray(I) && I.length === 9, 'inertiaCom is a length-9 array');
  assert.ok(Math.abs(mp.volume - V) / V < 1e-9, `box volume ${mp.volume} != ${V}`);

  const exx = V / 12 * (b * b + c * c);
  const eyy = V / 12 * (a * a + c * c);
  const ezz = V / 12 * (a * a + b * b);

  assert.ok(close(I[0], exx, 1e-6), `box Ixx ${I[0]} != ${exx}`);
  assert.ok(close(I[4], eyy, 1e-6), `box Iyy ${I[4]} != ${eyy}`);
  assert.ok(close(I[8], ezz, 1e-6), `box Izz ${I[8]} != ${ezz}`);

  // symmetry: stored matrix must be exactly symmetric.
  assert.strictEqual(I[1], I[3], 'Ixy == Iyx');
  assert.strictEqual(I[2], I[6], 'Ixz == Izx');
  assert.strictEqual(I[5], I[7], 'Iyz == Izy');

  // axis-aligned symmetric solid → products of inertia ≈ 0.
  const offFloor = 1e-6 * exx;
  assert.ok(Math.abs(I[1]) < offFloor, `box Ixy ${I[1]} not ~0`);
  assert.ok(Math.abs(I[2]) < offFloor, `box Ixz ${I[2]} not ~0`);
  assert.ok(Math.abs(I[5]) < offFloor, `box Iyz ${I[5]} not ~0`);

  console.log('[inertia] box ok — Ixx', I[0].toFixed(4), 'Iyy', I[4].toFixed(4),
              'Izz', I[8].toFixed(4), '(exp', exx.toFixed(4), eyy.toFixed(4),
              ezz.toFixed(4) + ')  products ~0');
}

// ---- solid cylinder r,h, axis +Z, about COM, unit density -----------------
{
  const r = 2, h = 5;
  const V = Math.PI * r * r * h;
  const mp = forge.massProps(forge.makeCylinder(r, h));
  const J = mp.inertiaCom;
  assert.ok(Math.abs(mp.volume - V) / V < 1e-6, `cyl volume ${mp.volume} != ${V}`);

  const eIzz = 0.5 * V * r * r;
  const eIxx = V / 12 * (3 * r * r + h * h);

  assert.ok(close(J[8], eIzz, 5e-3), `cyl Izz ${J[8]} != ${eIzz}`);
  assert.ok(close(J[0], eIxx, 5e-3), `cyl Ixx ${J[0]} != ${eIxx}`);
  assert.ok(close(J[4], eIxx, 5e-3), `cyl Iyy ${J[4]} != ${eIxx}`);
  // Izz/Ixx symmetric about the axis: Ixx == Iyy.
  assert.ok(close(J[0], J[4], 1e-6), `cyl Ixx ${J[0]} != Iyy ${J[4]}`);

  // axis-aligned symmetric solid → products of inertia ≈ 0.
  const offFloor = 1e-6 * eIxx;
  assert.ok(Math.abs(J[1]) < offFloor, `cyl Ixy ${J[1]} not ~0`);
  assert.ok(Math.abs(J[2]) < offFloor, `cyl Ixz ${J[2]} not ~0`);
  assert.ok(Math.abs(J[5]) < offFloor, `cyl Iyz ${J[5]} not ~0`);

  console.log('[inertia] cylinder ok — Izz', J[8].toFixed(4), '(exp', eIzz.toFixed(4) +
              ')  Ixx=Iyy', J[0].toFixed(4), '(exp', eIxx.toFixed(4) + ')  products ~0');
}

// ---- solid sphere r, about COM, unit density (isotropic) ------------------
{
  const r = 3;
  const V = 4 / 3 * Math.PI * r * r * r;
  const mp = forge.massProps(forge.makeSphere(r));
  const S = mp.inertiaCom;
  assert.ok(Math.abs(mp.volume - V) / V < 1e-3, `sphere volume ${mp.volume} != ${V}`);

  const eI = 2 / 5 * V * r * r;
  assert.ok(close(S[0], eI, 5e-3), `sphere Ixx ${S[0]} != ${eI}`);
  assert.ok(close(S[4], eI, 5e-3), `sphere Iyy ${S[4]} != ${eI}`);
  assert.ok(close(S[8], eI, 5e-3), `sphere Izz ${S[8]} != ${eI}`);
  // isotropic: products ≈ 0.
  const offFloor = 5e-3 * eI;
  assert.ok(Math.abs(S[1]) < offFloor, `sphere Ixy ${S[1]} not ~0`);
  assert.ok(Math.abs(S[2]) < offFloor, `sphere Ixz ${S[2]} not ~0`);
  assert.ok(Math.abs(S[5]) < offFloor, `sphere Iyz ${S[5]} not ~0`);

  console.log('[inertia] sphere ok — Ixx=Iyy=Izz', S[0].toFixed(4), S[4].toFixed(4),
              S[8].toFixed(4), '(exp', eI.toFixed(4) + ')  products ~0');
}

// ---- backward compatibility: legacy fields unchanged ----------------------
{
  const mp = forge.massProps(forge.makeBox(1, 1, 1));
  assert.ok(Math.abs(mp.volume - 1) < 1e-9, 'legacy volume still 1');
  assert.ok(Math.abs(mp.area - 6) < 1e-9, 'legacy area still 6');
  assert.ok(Array.isArray(mp.centerOfMass) && mp.centerOfMass.length === 3,
            'legacy centerOfMass still present');
  console.log('[inertia] backward-compat ok — volume/area/centerOfMass intact');
}

console.log('[inertia] ALL PASS');
