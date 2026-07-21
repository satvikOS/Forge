// forge/native/linalg/forge_math_test.cpp
//
// Validation gate for the unified native math substrate forge::math
// (include/forge/math/*.hpp) — the OCCT-zero foundation header that gives the
// kernel a single canonical Vec3 + the native equivalents of gp_Ax1/Ax2/Ax3,
// gp_Quaternion, gp_Mat and gp_GTrsf.
//
// Lives under test/native/linalg/ so test/native/run_native.sh (which scans the
// `linalg` class) builds & runs it against the whole native object set — this is
// ADDITIVE, it touches no production path, so the byte-identical OCCT gates are
// unaffected.
//
// Every assertion is MEASURED against an independently hand-computed / closed-
// form reference (never against the code under test's own other path), including:
//   - Vec3 add/sub/scale/dot/cross/norm/normalize/length
//   - Ax2 placing a point in a ROTATED frame vs a hand-computed world point
//   - the THREE rotation representations (Quaternion / Mat3 / axis-angle
//     Rodrigues) agreeing to 1e-12
//   - Mat3 determinant + inverse (A·A⁻¹ = I)
//   - general-affine NON-uniform scale on a Vec3 (gp_GTrsf case)
//   - negative / degenerate edge cases (zero-vector normalise, singular inverse,
//     zero-axis quaternion, ref-dir parallel to main axis).
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/test/native/linalg/forge_math_test.cpp -o /tmp/fm && /tmp/fm

#include "forge/math/Math.hpp"

#include <cstdio>
#include <cmath>

using namespace forge::math;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}

static bool approx(double a, double b, double tol = 1e-12) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}
static bool vapprox(const Vec3& a, const Vec3& b, double tol = 1e-12) {
    return approx(a.x, b.x, tol) && approx(a.y, b.y, tol) && approx(a.z, b.z, tol);
}
static bool mapprox(const Mat3& a, const Mat3& b, double tol = 1e-12) {
    for (int k = 0; k < 9; ++k)
        if (!approx(a.m[k], b.m[k], tol)) return false;
    return true;
}

int main() {
    std::printf("== forge::math unified native substrate gate ==\n");

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Vec3 arithmetic vs hand-computed values.
    // ─────────────────────────────────────────────────────────────────────────
    {
        Vec3 a{1, 2, 3}, b{4, -5, 6};
        check(vapprox(a + b, Vec3{5, -3, 9}), "Vec3 add");
        check(vapprox(a - b, Vec3{-3, 7, -3}), "Vec3 sub");
        check(vapprox(a * 2.0, Vec3{2, 4, 6}), "Vec3 scale (operator*)");
        check(vapprox(2.0 * a, Vec3{2, 4, 6}), "Vec3 scale (scalar*vec)");
        check(vapprox(a.scaled(0.5), Vec3{0.5, 1.0, 1.5}), "Vec3 scaled()");
        check(vapprox(-a, Vec3{-1, -2, -3}), "Vec3 negate");

        // dot = 1*4 + 2*-5 + 3*6 = 4 -10 +18 = 12
        check(approx(a.dot(b), 12.0), "Vec3 dot");
        check(approx(dot(a, b), 12.0), "Vec3 free dot");
        // cross(a,b) = (2*6 - 3*-5, 3*4 - 1*6, 1*-5 - 2*4) = (12+15, 12-6, -5-8) = (27,6,-13)
        check(vapprox(a.cross(b), Vec3{27, 6, -13}), "Vec3 cross");
        check(vapprox(cross(a, b), Vec3{27, 6, -13}), "Vec3 free cross");
        // anti-commutativity
        check(vapprox(b.cross(a), Vec3{-27, -6, 13}), "Vec3 cross anti-commutes");

        // length of (3,4,0) = 5
        Vec3 c{3, 4, 0};
        check(approx(c.length(), 5.0), "Vec3 length");
        check(approx(c.norm(), 5.0), "Vec3 norm == length");
        check(approx(c.lengthSquared(), 25.0), "Vec3 lengthSquared");
        check(approx(a.distance(Vec3{1, 2, 3}), 0.0), "Vec3 distance to self == 0");
        check(approx(Vec3{0, 0, 0}.distance(c), 5.0), "Vec3 distance");

        Vec3 cn = c.normalized();
        check(vapprox(cn, Vec3{0.6, 0.8, 0.0}) && approx(cn.length(), 1.0),
              "Vec3 normalized() is unit + correct direction");
        Vec3 c2 = c;
        check(c2.normalize() && vapprox(c2, Vec3{0.6, 0.8, 0.0}),
              "Vec3 normalize() in-place");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Ax2 — place a point in a ROTATED frame vs hand-computed world point.
    // ─────────────────────────────────────────────────────────────────────────
    {
        // Identity frame at (1,2,3): X=(1,0,0) Y=(0,1,0) Z=(0,0,1).
        Ax2 f(Vec3{1, 2, 3}, Vec3{0, 0, 1}, Vec3{1, 0, 0});
        check(vapprox(f.xDirection, Vec3{1, 0, 0}) &&
              vapprox(f.yDirection, Vec3{0, 1, 0}) &&
              vapprox(f.direction, Vec3{0, 0, 1}),
              "Ax2 (loc,Z,X) builds identity-oriented right-handed frame");
        // Y = Z x X must hold (right-handed).
        check(vapprox(f.yDirection, f.direction.cross(f.xDirection)),
              "Ax2 right-handed: Y = Z x X");
        // toWorld(local (2,0,0)) = (1,2,3) + 2*X = (3,2,3)
        check(vapprox(f.toWorld(Vec3{2, 0, 0}), Vec3{3, 2, 3}), "Ax2 toWorld point");
        // round trip
        Vec3 wp{7.5, -1.25, 4.0};
        check(vapprox(f.toLocal(f.toWorld(wp)), wp), "Ax2 toLocal∘toWorld == id");

        // Rotate the frame 90° about its own Z axis: X→(0,1,0), Y→(-1,0,0).
        Ax2 fr = f.rotated(f.axis(), M_PI / 2.0);
        check(vapprox(fr.xDirection, Vec3{0, 1, 0}) &&
              vapprox(fr.yDirection, Vec3{-1, 0, 0}) &&
              vapprox(fr.direction, Vec3{0, 0, 1}),
              "Ax2 rotate 90° about own Z spins X,Y");
        // toWorld(local (2,0,0)) in rotated frame = (1,2,3) + 2*X' = (1,4,3)
        check(vapprox(fr.toWorld(Vec3{2, 0, 0}), Vec3{1, 4, 3}),
              "Ax2 rotated-frame toWorld vs hand-computed (1,4,3)");

        // A non-trivial rotation: frame at origin (Z up, X=+x) rotated 90° about
        // the WORLD X axis. Expect X unchanged, Y=(0,1,0)→(0,0,1), Z=(0,0,1)→(0,-1,0).
        Ax2 g(Vec3{0, 0, 0}, Vec3{0, 0, 1}, Vec3{1, 0, 0});
        Ax2 gr = g.rotated(Ax1{Vec3{0, 0, 0}, Vec3{1, 0, 0}}, M_PI / 2.0);
        check(vapprox(gr.xDirection, Vec3{1, 0, 0}), "Ax2 rot90 about X: X fixed");
        check(vapprox(gr.yDirection, Vec3{0, 0, 1}), "Ax2 rot90 about X: Y→+Z");
        check(vapprox(gr.direction,  Vec3{0, -1, 0}), "Ax2 rot90 about X: Z→−Y");
        // local (0,0,1) maps to the rotated Z = (0,-1,0)
        check(vapprox(gr.toWorld(Vec3{0, 0, 1}), Vec3{0, -1, 0}),
              "Ax2 rotated toWorld of local +Z vs hand-computed (0,-1,0)");

        // setRotation (in-place about own axis) matches rotated().
        Ax2 h = g;
        h.setRotation(0.37);
        check(vapprox(h.direction, g.rotated(g.axis(), 0.37).direction),
              "Ax2 setRotation == rotated about own axis");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. THREE rotation representations agree to 1e-12.
    //    (a) Quaternion sandwich   (b) Mat3::fromAxisAngle   (c) Rodrigues (hand)
    // ─────────────────────────────────────────────────────────────────────────
    {
        Vec3 axis = Vec3{1, 2, 3}.normalized();
        double angle = 0.7;
        Vec3 v{0.5, -1.3, 2.1};

        // (a) quaternion
        Quaternion q = Quaternion::fromAxisAngle(axis, angle);
        check(approx(q.norm(), 1.0), "Quaternion fromAxisAngle is unit");
        Vec3 vq = q.rotate(v);

        // (b) Mat3
        Mat3 R = Mat3::fromAxisAngle(axis, angle);
        Vec3 vm = R * v;

        // (c) independent Rodrigues, computed inline (NOT via our Mat3/quat):
        //     v' = v cosθ + (k×v) sinθ + k (k·v)(1−cosθ)
        double c = std::cos(angle), s = std::sin(angle);
        Vec3 k = axis;
        Vec3 vr = v * c + k.cross(v) * s + k * (k.dot(v) * (1.0 - c));

        check(vapprox(vq, vm), "rotation: Quaternion == Mat3 (to 1e-12)");
        check(vapprox(vm, vr), "rotation: Mat3 == Rodrigues (to 1e-12)");
        check(vapprox(vq, vr), "rotation: Quaternion == Rodrigues (to 1e-12)");

        // quaternion→matrix agrees with the axis-angle matrix too.
        check(mapprox(q.toMat3(), R), "Quaternion.toMat3() == Mat3::fromAxisAngle");

        // rotation preserves length; length-of-rotated == length-of-v.
        check(approx(vq.length(), v.length()), "rotation preserves length");

        // Composition: q1*q2 as a matrix == R1*R2 (Hamilton order == matrix order).
        Quaternion q1 = Quaternion::fromAxisAngle(Vec3{0, 0, 1}, 0.9);
        Quaternion q2 = Quaternion::fromAxisAngle(Vec3{1, 0, 0}, -0.4);
        Mat3 R1 = Mat3::fromAxisAngle(Vec3{0, 0, 1}, 0.9);
        Mat3 R2 = Mat3::fromAxisAngle(Vec3{1, 0, 0}, -0.4);
        check(mapprox((q1 * q2).toMat3(), R1 * R2),
              "Quaternion Hamilton compose == Mat3 compose");
        // and applied to a vector both give the same result.
        check(vapprox((q1 * q2).rotate(v), (R1 * R2) * v),
              "composed quaternion rotate == composed matrix apply");

        // 360° about any axis == identity.
        check(vapprox(Mat3::fromAxisAngle(axis, 2.0 * M_PI) * v, v),
              "rotation by 2π == identity");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Mat3 determinant + inverse (A·A⁻¹ = I).
    // ─────────────────────────────────────────────────────────────────────────
    {
        // diagonal: det = 2*3*4 = 24, inverse = diag(1/2, 1/3, 1/4)
        Mat3 D = Mat3::diagonal(2, 3, 4);
        check(approx(D.determinant(), 24.0), "Mat3 diagonal determinant = 24");
        Mat3 Dinv;
        check(D.inverse(Dinv), "Mat3 diagonal inverse exists");
        check(mapprox(Dinv, Mat3::diagonal(0.5, 1.0 / 3.0, 0.25)),
              "Mat3 diagonal inverse = diag(1/2,1/3,1/4)");

        // general non-symmetric matrix — verify A·A⁻¹ = I.
        Mat3 A{2, -1, 0, -1, 2, -1, 0, -1, 2};   // det = 4
        check(approx(A.determinant(), 4.0), "Mat3 general determinant = 4");
        Mat3 Ainv;
        check(A.inverse(Ainv), "Mat3 general inverse exists");
        check(mapprox(A * Ainv, Mat3::identity()), "Mat3 A·A⁻¹ = I");
        check(mapprox(Ainv * A, Mat3::identity()), "Mat3 A⁻¹·A = I");

        // rotation matrix is orthonormal: R⁻¹ == Rᵀ, det == 1.
        Mat3 R = Mat3::fromAxisAngle(Vec3{0.3, -0.5, 1.0}, 1.1);
        check(approx(R.determinant(), 1.0), "rotation Mat3 determinant = 1");
        Mat3 Rinv;
        R.inverse(Rinv);
        check(mapprox(Rinv, R.transpose()), "rotation Mat3 inverse == transpose");

        // transpose is an involution; (A·B)ᵀ = Bᵀ·Aᵀ.
        check(mapprox(A.transpose().transpose(), A), "Mat3 transpose involution");
        check(mapprox((A * R).transpose(), R.transpose() * A.transpose()),
              "Mat3 (AB)ᵀ = BᵀAᵀ");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. General-affine NON-uniform scale on a Vec3 (gp_GTrsf case: ellipsoid).
    // ─────────────────────────────────────────────────────────────────────────
    {
        Transform S = Transform::scaling(2, 3, 4);   // diag(2,3,4)
        check(vapprox(S.transformPoint(Vec3{1, 1, 1}), Vec3{2, 3, 4}),
              "Transform non-uniform scale on (1,1,1) = (2,3,4)");
        check(!S.isRigid(), "non-uniform scale is NOT rigid");
        check(approx(S.determinant(), 24.0), "scale determinant = 2*3*4 = 24");

        // Unit sphere → ellipsoid: a unit-direction point on +X/+Y/+Z maps onto
        // the semi-axes, exactly what a rigid transform CANNOT express.
        check(vapprox(S.transformPoint(Vec3{1, 0, 0}), Vec3{2, 0, 0}) &&
              vapprox(S.transformPoint(Vec3{0, 1, 0}), Vec3{0, 3, 0}) &&
              vapprox(S.transformPoint(Vec3{0, 0, 1}), Vec3{0, 0, 4}),
              "Transform sphere→ellipsoid semi-axes (2,3,4)");

        // compose scale then translate, and the general inverse round-trips.
        Transform T = Transform::translationOf(Vec3{10, 20, 30}).compose(S);
        Vec3 p{1, 1, 1};
        check(vapprox(T.transformPoint(p), Vec3{12, 23, 34}),
              "Transform (translate∘scale) point vs hand-computed (12,23,34)");
        Transform Tinv;
        check(T.inverse(Tinv), "Transform general inverse exists (det≠0)");
        check(vapprox(Tinv.transformPoint(T.transformPoint(p)), p),
              "Transform inverse round-trips a point");

        // rigid path: rotation about a line keeps a point ON the line fixed,
        // and the fast (transpose) inverse round-trips.
        Ax1 line{Vec3{0, 0, 5}, Vec3{0, 0, 1}};
        Transform Rot = Transform::rotationAbout(line, 0.85);
        check(Rot.isRigid(), "rotationAbout is rigid");
        check(vapprox(Rot.transformPoint(Vec3{0, 0, 5}), Vec3{0, 0, 5}),
              "rotationAbout keeps on-axis point fixed");
        Vec3 q{3, -2, 5};
        check(vapprox(Rot.rigidInverse().transformPoint(Rot.transformPoint(q)), q),
              "Transform rigid fast-inverse round-trips");
        // vector transform ignores translation.
        check(vapprox(Rot.transformVec(Vec3{1, 0, 0}),
                      Mat3::fromAxisAngle(Vec3{0, 0, 1}, 0.85) * Vec3{1, 0, 0}),
              "Transform transformVec is linear-part only");
        // a mirror (det<0) is improper.
        Transform Mir = Transform::scaling(1, 1, -1);
        check(!Mir.isProper() && approx(Mir.determinant(), -1.0),
              "Transform mirror det = −1, improper");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. NEGATIVE / DEGENERATE edge cases.
    // ─────────────────────────────────────────────────────────────────────────
    {
        // zero-vector normalise: in-place returns false & leaves unchanged;
        // normalized() returns zero (no NaN/inf from a divide-by-~0).
        Vec3 zero{0, 0, 0};
        check(!zero.normalize(), "Vec3 zero normalize() returns false");
        check(vapprox(zero, Vec3{0, 0, 0}), "Vec3 zero unchanged after failed normalize");
        Vec3 zn = Vec3{0, 0, 0}.normalized();
        check(vapprox(zn, Vec3{0, 0, 0}) &&
              std::isfinite(zn.x) && std::isfinite(zn.y) && std::isfinite(zn.z),
              "Vec3 zero normalized() is finite zero (no NaN/inf)");
        check(Vec3{0, 0, 0}.isZero() && !Vec3{1e-3, 0, 0}.isZero(), "Vec3 isZero");

        // singular matrix: inverse must FAIL (return false), out untouched.
        Mat3 sing{1, 2, 3, 2, 4, 6, 7, 8, 9};   // rows 0,1 dependent ⇒ det 0
        check(approx(sing.determinant(), 0.0), "singular Mat3 determinant = 0");
        Mat3 sentinel = Mat3::diagonal(9, 9, 9);
        Mat3 out = sentinel;
        check(!sing.inverse(out), "singular Mat3 inverse returns false");
        check(mapprox(out, sentinel), "singular Mat3 inverse leaves out untouched");

        // singular Transform inverse also fails.
        Transform Tsing{sing, Vec3{1, 2, 3}};
        Transform tout;
        check(!Tsing.inverse(tout), "singular Transform inverse returns false");

        // zero-axis quaternion / zero angle → identity rotation.
        Quaternion qz = Quaternion::fromAxisAngle(Vec3{0, 0, 0}, 1.0);
        check(vapprox(qz.rotate(Vec3{5, 6, 7}), Vec3{5, 6, 7}),
              "Quaternion zero-axis → identity rotation");
        Quaternion q0 = Quaternion::fromAxisAngle(Vec3{0, 0, 1}, 0.0);
        check(vapprox(q0.rotate(Vec3{5, 6, 7}), Vec3{5, 6, 7}),
              "Quaternion zero-angle → identity rotation");
        // non-unit quaternion rotates the same as its normalisation (general inverse).
        Quaternion qbig{2, 0, 0, 0};   // == identity direction, non-unit
        check(vapprox(qbig.rotate(Vec3{5, 6, 7}), Vec3{5, 6, 7}),
              "non-unit quaternion still rotates correctly");

        // Ax2 with ref-X PARALLEL to the main axis: degenerate reference must not
        // blow up — X falls back to a valid perpendicular, frame stays orthonormal.
        Ax2 deg(Vec3{0, 0, 0}, Vec3{0, 0, 1}, Vec3{0, 0, 5});
        check(approx(deg.xDirection.dot(deg.direction), 0.0) &&
              approx(deg.xDirection.length(), 1.0) &&
              vapprox(deg.yDirection, deg.direction.cross(deg.xDirection)),
              "Ax2 ref-dir ∥ axis falls back to valid orthonormal frame");

        // anyPerpendicular is always unit & orthogonal for assorted directions.
        Vec3 dirs[] = {{1,0,0},{0,1,0},{0,0,1},{1,1,1},{-3,0.2,7},{0,-9,0.001}};
        bool allPerp = true;
        for (const Vec3& d : dirs) {
            Vec3 p = anyPerpendicular(d);
            if (!(approx(p.length(), 1.0) && approx(p.dot(d.normalized()), 0.0)))
                allPerp = false;
        }
        check(allPerp, "anyPerpendicular is unit ⟂ for all sampled directions");
    }

    // ─────────────────────────────────────────────────────────────────────────
    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
