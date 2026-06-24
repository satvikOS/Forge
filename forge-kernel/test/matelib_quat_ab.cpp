// test/matelib_quat_ab.cpp
//
// A/B gate for OCCT_ZERO_ROADMAP W2.2 — the in-house quaternion-rotate that
// replaced gp_Quaternion::Multiply in src/MateLibrary.cpp::rotateVec.
//
// The in-house formula below is BYTE-IDENTICAL to MateLibrary.cpp::rotateVec (the
// general sandwich  q * (0,v) * q^-1  with q^-1 = conj/|q|^2). We A/B it against
// an INDEPENDENT oracle — the closed-form rotation MATRIX  R(q)  built from a unit
// quaternion — over many random (q, v). For a unit q the sandwich product and the
// rotation matrix are the same rotation, so they must agree to 1e-12 (the roadmap
// tolerance). This is exactly the parity gp_Quaternion::Multiply provided; the OCCT
// dependency it required is now deleted. Pure C++, no OCCT, no deps.
//
// (rotateVec lives in an anonymous namespace inside the TU, so we re-state the
// identical body here; the build links MateLibrary.cpp too, so any future
// divergence of the production body from this gate is a code-review signal.)

#include <cmath>
#include <cstdio>
#include <random>

namespace {

int g_fail = 0;

// ===== IN-HOUSE (copy of MateLibrary.cpp::rotateVec — keep in lock-step) =====
void rotateVec_inhouse(const double q[4], const double v[3], double out[3]) {
    const double w = q[0], x = q[1], y = q[2], z = q[3];
    const double n2 = w*w + x*x + y*y + z*z;
    if (n2 <= 1e-30) { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return; }
    const double pw = 0.0, px = v[0], py = v[1], pz = v[2];
    const double tw = w*pw - x*px - y*py - z*pz;
    const double tx = w*px + x*pw + y*pz - z*py;
    const double ty = w*py - x*pz + y*pw + z*px;
    const double tz = w*pz + x*py - y*px + z*pw;
    const double inv = 1.0 / n2;
    const double cw =  w * inv, cx = -x * inv, cy = -y * inv, cz = -z * inv;
    out[0] = tw*cx + tx*cw + ty*cz - tz*cy;
    out[1] = tw*cy - tx*cz + ty*cw + tz*cx;
    out[2] = tw*cz + tx*cy - ty*cx + tz*cw;
}

// ===== ORACLE: rotation MATRIX from a UNIT quaternion (independent form) =====
// This is the standard R(q) v product, algebraically distinct from the sandwich
// product above, so agreement is a genuine cross-check (this is what OCCT's
// gp_Quaternion / gp_Trsf use internally; deleting OCCT did not change the math).
void rotateVec_matrix(const double q[4], const double v[3], double out[3]) {
    // normalise (the matrix form assumes a unit quaternion).
    const double n = std::sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
    const double w = q[0]/n, x = q[1]/n, y = q[2]/n, z = q[3]/n;
    const double R[3][3] = {
        { 1 - 2*(y*y + z*z),   2*(x*y - z*w),     2*(x*z + y*w)   },
        { 2*(x*y + z*w),       1 - 2*(x*x + z*z), 2*(y*z - x*w)   },
        { 2*(x*z - y*w),       2*(y*z + x*w),     1 - 2*(x*x + y*y)},
    };
    for (int i = 0; i < 3; ++i)
        out[i] = R[i][0]*v[0] + R[i][1]*v[1] + R[i][2]*v[2];
}

} // namespace

int main() {
    std::printf("[matelib-quat] W2.2 in-house quaternion-rotate A/B (vs rotation matrix)\n");
    std::mt19937_64 rng(0xC0FFEEu);
    std::uniform_real_distribution<double> U(-1.0, 1.0);

    double maxErr = 0.0;
    const int N = 200000;
    for (int it = 0; it < N; ++it) {
        // random quaternion (any magnitude — the in-house path uses the general
        // inverse, so a non-unit q must still rotate correctly; the oracle
        // normalises, and a unit-rotation is what both must produce).
        double q[4] = { U(rng), U(rng), U(rng), U(rng) };
        double nq = std::sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
        if (nq < 1e-6) continue;                 // skip degenerate draws
        double v[3] = { U(rng)*10.0, U(rng)*10.0, U(rng)*10.0 };
        double a[3], b[3];
        rotateVec_inhouse(q, v, a);
        rotateVec_matrix (q, v, b);
        for (int k = 0; k < 3; ++k)
            maxErr = std::max(maxErr, std::abs(a[k] - b[k]));
    }
    std::printf("  random %d draws: max |native - matrix| = %.3e\n", N, maxErr);
    if (maxErr > 1e-12) {
        std::printf("  [FAIL] quaternion rotate parity exceeds 1e-12\n");
        ++g_fail;
    }

    // A couple of named, hand-checkable rotations.
    struct Case { double q[4]; double v[3]; double want[3]; const char* name; };
    const double s2 = std::sqrt(0.5);
    Case cs[] = {
        { {1,0,0,0}, {3,-2,5}, {3,-2,5}, "identity" },
        { {s2,0,0,s2}, {1,0,0}, {0,1,0}, "+90 about Z: +X -> +Y" },
        { {s2,s2,0,0}, {0,1,0}, {0,0,1}, "+90 about X: +Y -> +Z" },
        { {0,1,0,0}, {0,1,0}, {0,-1,0}, "180 about X: +Y -> -Y" },
    };
    for (const auto& c : cs) {
        double got[3];
        rotateVec_inhouse(c.q, c.v, got);
        double e = 0;
        for (int k = 0; k < 3; ++k) e = std::max(e, std::abs(got[k] - c.want[k]));
        if (e > 1e-12) {
            std::printf("  [FAIL] %s: got (%.6f,%.6f,%.6f)\n", c.name, got[0], got[1], got[2]);
            ++g_fail;
        }
    }

    if (g_fail == 0) std::printf("[matelib-quat] ALL QUATERNION A/B GATES PASS (<=1e-12)\n");
    else             std::printf("[matelib-quat] %d FAILURE(S)\n", g_fail);
    return g_fail == 0 ? 0 : 1;
}
