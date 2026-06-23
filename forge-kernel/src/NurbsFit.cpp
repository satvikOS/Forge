#include "forge/NurbsFit.hpp"

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace forge { namespace nurbsfit {

namespace la = forge::native::linalg;

namespace {

constexpr int DEGREE = 3;

// Open-uniform knot vector for a degree-3 B-spline with `n` control
// points. Length = n + 4.
std::vector<double> openUniformKnots(int n) {
    const int K = n + DEGREE + 1;
    std::vector<double> kt(K, 0.0);
    for (int i = 0; i < DEGREE + 1; ++i)        kt[i]         = 0.0;
    for (int i = K - DEGREE - 1; i < K; ++i)    kt[i]         = 1.0;
    const int interior = n - DEGREE - 1;        // number of interior knots
    for (int i = 0; i < interior; ++i) {
        kt[DEGREE + 1 + i] = double(i + 1) / double(interior + 1);
    }
    return kt;
}

// Cox-de-Boor: evaluate B-spline basis function N_{i,p}(u) at u given a
// knot vector. We compute all DEGREE+1 non-zero basis values for the
// interval spanning u.
//
// `span` is the knot span index s such that knots[s] ≤ u < knots[s+1].
int findSpan(int n, const std::vector<double>& knots, double u) {
    if (u >= knots[n]) return n - 1;
    if (u <= knots[DEGREE]) return DEGREE;
    int lo = DEGREE, hi = n;
    int mid = (lo + hi) / 2;
    while (u < knots[mid] || u >= knots[mid + 1]) {
        if (u < knots[mid]) hi = mid;
        else                lo = mid;
        mid = (lo + hi) / 2;
    }
    return mid;
}

// Fill the (DEGREE+1)-long N vector with N_{span-DEGREE+i, DEGREE}(u).
void basisFunctions(int span, double u,
                    const std::vector<double>& knots,
                    double N[DEGREE + 1]) {
    double left[DEGREE + 1];
    double right[DEGREE + 1];
    N[0] = 1.0;
    for (int j = 1; j <= DEGREE; ++j) {
        left[j]  = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        double saved = 0.0;
        for (int r = 0; r < j; ++r) {
            const double denom = right[r + 1] + left[j - r];
            const double temp  = denom > 1e-12 ? N[r] / denom : 0.0;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

} // anonymous namespace

FitResult fitSurface(const FitInputs& in) {
    const std::size_t N = in.points.size() / 3;
    if (N < 16) throw std::invalid_argument("forge.nurbsfit: need ≥ 16 points");
    if (in.uCount < DEGREE + 1 || in.vCount < DEGREE + 1) {
        throw std::invalid_argument("forge.nurbsfit: uCount and vCount must be ≥ 4");
    }
    if (in.uCount * in.vCount > static_cast<int>(N)) {
        throw std::invalid_argument(
            "forge.nurbsfit: control net must have ≤ point count");
    }

    // Find bounding box on (x, y).
    double xMin = +1e308, xMax = -1e308, yMin = +1e308, yMax = -1e308;
    for (std::size_t i = 0; i < N; ++i) {
        const double x = in.points[3 * i + 0];
        const double y = in.points[3 * i + 1];
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
    const double xR = std::max(1e-12, xMax - xMin);
    const double yR = std::max(1e-12, yMax - yMin);

    const auto kU = openUniformKnots(in.uCount);
    const auto kV = openUniformKnots(in.vCount);

    const int K = in.uCount * in.vCount;
    la::MatrixD B = la::MatrixD::Zero(static_cast<std::size_t>(N),
                                      static_cast<std::size_t>(K));
    std::vector<double> Z(static_cast<std::size_t>(N), 0.0);

    double NU[DEGREE + 1];
    double NV[DEGREE + 1];

    for (std::size_t pIdx = 0; pIdx < N; ++pIdx) {
        const double x = in.points[3 * pIdx + 0];
        const double y = in.points[3 * pIdx + 1];
        const double z = in.points[3 * pIdx + 2];
        const double u = (x - xMin) / xR;
        const double v = (y - yMin) / yR;
        const int spanU = findSpan(in.uCount, kU, u);
        const int spanV = findSpan(in.vCount, kV, v);
        basisFunctions(spanU, u, kU, NU);
        basisFunctions(spanV, v, kV, NV);
        for (int j = 0; j <= DEGREE; ++j) {
            for (int i = 0; i <= DEGREE; ++i) {
                const int colU = spanU - DEGREE + i;
                const int colV = spanV - DEGREE + j;
                if (colU < 0 || colU >= in.uCount) continue;
                if (colV < 0 || colV >= in.vCount) continue;
                const int col = colV * in.uCount + colU;
                B(static_cast<std::size_t>(pIdx),
                  static_cast<std::size_t>(col)) += NU[i] * NV[j];
            }
        }
        Z[static_cast<std::size_t>(pIdx)] = z;
    }

    // Least squares solve: minimise ||B·P − Z||².
    // Single RHS column (the fitted control-point Z values), so one QR solve.
    std::vector<double> P = la::HouseholderQR<double>(B).solve(Z);

    FitResult R;
    R.uCount = in.uCount;
    R.vCount = in.vCount;
    R.xMin = xMin; R.xMax = xMax;
    R.yMin = yMin; R.yMax = yMax;
    R.samples = static_cast<int>(N);
    R.controlZ.assign(P.data(), P.data() + K);

    // Residuals.
    R.residuals.assign(N, 0.0);
    double rss = 0.0;
    double maxAbs = 0.0;
    for (std::size_t pIdx = 0; pIdx < N; ++pIdx) {
        // zFit = B.row(pIdx) · P  (explicit dot product over the K columns).
        double zFit = 0.0;
        for (int col = 0; col < K; ++col) {
            zFit += B(pIdx, static_cast<std::size_t>(col)) *
                    P[static_cast<std::size_t>(col)];
        }
        const double r = zFit - Z[pIdx];
        R.residuals[pIdx] = r;
        rss += r * r;
        if (std::abs(r) > maxAbs) maxAbs = std::abs(r);
    }
    R.maxAbsResidual = maxAbs;
    R.rmsResidual = std::sqrt(rss / std::max<std::size_t>(1, N));
    return R;
}

}} // namespace forge::nurbsfit
