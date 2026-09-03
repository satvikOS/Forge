// pcurve_fit_gate.cpp — the differential check BSplineBasis.hpp promises, plus the
// numerical properties that make the four routines usable at all.
//
// WHY THIS FILE EXISTS. BSplineBasis.hpp says, in its own header comment:
//
//     "a silent second copy of a validated algorithm is how two engines start
//      disagreeing ... `test/pcurve_fit_gate.cpp` therefore includes a DIFFERENTIAL
//      check -- the basis functions here must reproduce the partition of unity, the
//      correct support, and a straight line exactly -- so that the copy cannot drift
//      silently while it exists."
//
// That file was written and the gate it names was not. This is it.
//
// KERNEL-FREE ON PURPOSE. BSplineBasis.hpp contains no OCCT type -- it is arithmetic
// on std::vector and nothing else -- so this gate needs no kernel, no OCCT and no
// link step beyond libc++. Everything here runs in milliseconds, which is the
// difference between a gate that runs on every push and one that does not.
//
// WHAT IT DOES NOT COVER, stated so nobody reads more into a green run: it does not
// touch cylinderPCurve, planeCylinderSection or pointsToBSpline2d. Those need OCCT
// types and a built kernel, and their gate is a separate, heavier one. This gate
// covers the numerics UNDER them, which is where a silent transcription drift would
// live.
#include "forge/native/geom/BSplineBasis.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using forge::bsplinebasis::basisFuns;
using forge::bsplinebasis::choleskyFactor;
using forge::bsplinebasis::choleskySolve;
using forge::bsplinebasis::findSpan;

static int g_fail = 0;
static int g_checks = 0;

static void ok(bool cond, const std::string& what) {
    ++g_checks;
    if (!cond) {
        std::printf("[pcurve-gate] FAIL: %s\n", what.c_str());
        ++g_fail;
    }
}

// A clamped uniform knot vector of degree p with nCtrl control points on [0,1].
static std::vector<double> clampedKnots(int p, int nCtrl) {
    std::vector<double> U;
    for (int i = 0; i <= p; ++i) U.push_back(0.0);
    const int nInner = nCtrl - p - 1;
    for (int i = 1; i <= nInner; ++i) U.push_back(double(i) / (nInner + 1));
    for (int i = 0; i <= p; ++i) U.push_back(1.0);
    return U;
}

int main() {
    // ── 1. PARTITION OF UNITY ────────────────────────────────────────────────
    // sum_j N_{j,p}(u) == 1 for every u in the domain, for every degree and net
    // size the fitter can choose (degMin 3 .. degMax 8).
    for (int p = 1; p <= 8; ++p) {
        for (int nCtrl = p + 1; nCtrl <= p + 6; ++nCtrl) {
            const std::vector<double> U = clampedKnots(p, nCtrl);
            const int n = nCtrl - 1;
            std::vector<double> N;
            double worst = 0.0;
            for (int s = 0; s <= 200; ++s) {
                const double u = double(s) / 200.0;
                const int i = findSpan(n, p, u, U);
                basisFuns(i, u, p, U, N);
                double sum = 0.0;
                for (double v : N) sum += v;
                worst = std::max(worst, std::fabs(sum - 1.0));
            }
            ok(worst < 1e-12,
               "partition of unity p=" + std::to_string(p) +
                   " nCtrl=" + std::to_string(nCtrl) +
                   " worst=" + std::to_string(worst));
        }
    }

    // ── 2. SUPPORT AND NON-NEGATIVITY ────────────────────────────────────────
    // basisFuns returns exactly p+1 values, all in [0,1]; a negative or >1 value
    // means the recurrence has been transcribed wrong even if the sum still hits 1.
    for (int p = 1; p <= 8; ++p) {
        const int nCtrl = p + 4;
        const std::vector<double> U = clampedKnots(p, nCtrl);
        const int n = nCtrl - 1;
        std::vector<double> N;
        bool sized = true, ranged = true;
        for (int s = 0; s <= 200; ++s) {
            const double u = double(s) / 200.0;
            basisFuns(findSpan(n, p, u, U), u, p, U, N);
            if ((int)N.size() != p + 1) sized = false;
            for (double v : N) if (v < -1e-15 || v > 1.0 + 1e-15) ranged = false;
        }
        ok(sized,  "basisFuns returns p+1 values, p=" + std::to_string(p));
        ok(ranged, "basis values in [0,1], p=" + std::to_string(p));
    }

    // ── 3. FINDSPAN IS THE SPAN THAT CONTAINS u ──────────────────────────────
    // U[i] <= u < U[i+1], with the clamped endpoint convention at u = 1.
    for (int p = 1; p <= 5; ++p) {
        const int nCtrl = p + 5, n = nCtrl - 1;
        const std::vector<double> U = clampedKnots(p, nCtrl);
        bool good = true;
        for (int s = 0; s <= 500; ++s) {
            const double u = double(s) / 500.0;
            const int i = findSpan(n, p, u, U);
            if (i < p || i > n) { good = false; break; }
            if (u < 1.0 && !(U[i] <= u && u < U[i + 1])) { good = false; break; }
        }
        ok(good, "findSpan brackets u, p=" + std::to_string(p));
        ok(findSpan(n, p, 1.0, U) == n, "findSpan clamps at the right end, p=" + std::to_string(p));
        ok(findSpan(n, p, 0.0, U) == p, "findSpan clamps at the left end, p=" + std::to_string(p));
    }

    // ── 4. A STRAIGHT LINE IS REPRODUCED EXACTLY ─────────────────────────────
    // The header names this one specifically. With Greville-abscissa poles the
    // B-spline of ANY degree must reproduce a linear function to machine epsilon.
    for (int p = 1; p <= 6; ++p) {
        const int nCtrl = p + 5, n = nCtrl - 1;
        const std::vector<double> U = clampedKnots(p, nCtrl);
        std::vector<double> P(nCtrl);
        for (int j = 0; j < nCtrl; ++j) {           // Greville abscissa
            double g = 0.0;
            for (int k = 1; k <= p; ++k) g += U[j + k];
            P[j] = 3.0 * (g / p) + 1.0;             // the line f(u) = 3u + 1
        }
        std::vector<double> N;
        double worst = 0.0;
        for (int s = 0; s <= 300; ++s) {
            const double u = double(s) / 300.0;
            const int i = findSpan(n, p, u, U);
            basisFuns(i, u, p, U, N);
            double f = 0.0;
            for (int k = 0; k <= p; ++k) f += N[k] * P[i - p + k];
            worst = std::max(worst, std::fabs(f - (3.0 * u + 1.0)));
        }
        ok(worst < 1e-11, "straight line reproduced exactly, p=" + std::to_string(p) +
                              " worst=" + std::to_string(worst));
    }

    // ── 5. CHOLESKY FACTOR + SOLVE ───────────────────────────────────────────
    // A = B^T B + I is SPD by construction; the solve must return the x we chose.
    {
        const int m = 7;
        std::vector<double> A(m * m, 0.0), x(m), b(m, 0.0);
        for (int i = 0; i < m; ++i) x[i] = 0.5 * i - 1.25;
        for (int i = 0; i < m; ++i)
            for (int j = 0; j < m; ++j)
                A[i * m + j] = (i == j ? 4.0 : 1.0 / (1.0 + i + j));
        for (int i = 0; i < m; ++i)
            for (int j = 0; j < m; ++j) b[i] += A[i * m + j] * x[j];
        std::vector<double> L = A;
        ok(choleskyFactor(L, m), "choleskyFactor succeeds on an SPD matrix");
        std::vector<double> sol = b;
        choleskySolve(L, m, sol);
        double worst = 0.0;
        for (int i = 0; i < m; ++i) worst = std::max(worst, std::fabs(sol[i] - x[i]));
        ok(worst < 1e-10, "choleskySolve recovers x, worst=" + std::to_string(worst));
    }

    // ── 6. CHOLESKY REFUSES A NON-SPD MATRIX ─────────────────────────────────
    // The rank-deficient path is the one the fitter relies on to DEFER instead of
    // emitting a wrong pcurve, so a factoriser that never returns false would be a
    // gate that cannot fail. Two cases: a negative pivot and an exactly singular
    // matrix.
    {
        const int m = 3;
        std::vector<double> neg = {-1.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.0, 1.0};
        ok(!choleskyFactor(neg, m), "choleskyFactor REFUSES a negative pivot");
        std::vector<double> sing = {1.0, 1.0, 1.0,  1.0, 1.0, 1.0,  1.0, 1.0, 1.0};
        ok(!choleskyFactor(sing, m), "choleskyFactor REFUSES a singular matrix");
    }

    std::printf("[pcurve-gate] %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
