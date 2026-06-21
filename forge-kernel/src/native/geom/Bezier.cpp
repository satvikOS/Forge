// forge/native/geom/Bezier.cpp
//
// Implementation of the Bezier curve + tensor-product surface module
// (Bezier.hpp). Pure C++20, no external dependencies. See the header for the
// honesty posture and the validated ENVELOPE.
//
// Algorithm: the de Casteljau corner-cutting recurrence (Farin, "Curves and
// Surfaces for CAGD"), re-derived from the definition — NOT copied source and NOT
// the Bernstein-power monomial form. Each level is a convex combination
//   Q^{r}_i(t) = (1-t) Q^{r-1}_i + t Q^{r-1}_{i+1},
// so every intermediate point lies in the convex hull of the control points; this
// is what makes the hull-containment property hold in floating point and what
// makes subdivision an EXACT polynomial identity (the left/right diagonals of the
// de Casteljau triangle are themselves valid Bezier control nets).
//
// The first derivative is the hodograph: B'(t) = n * sum Bernstein_{n-1,i}(t) *
// (P[i+1]-P[i]). We evaluate it by a SECOND de Casteljau pass over the difference
// net {n*(P[i+1]-P[i])} rather than by finite differencing, so the test's
// analytic-vs-FD comparison is a genuine cross-check of two independent methods.

#include "forge/native/geom/Bezier.hpp"

#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>     // std::max
#include <array>         // std::array (HalfEdgeMesh interplay; included per CI rule)
#include <cmath>         // std::sqrt, std::fabs
#include <cstddef>       // std::size_t
#include <cstdint>       // std::uint32_t
#include <limits>        // std::numeric_limits
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace geom {

// ---- vector helpers declared in the header --------------------------------
double vlen(const Vec3& a) { return std::sqrt(vdot(a, a)); }
double vdist(const Vec3& a, const Vec3& b) { return vlen(vsub(a, b)); }

namespace {

// In-domain test for a Bezier parameter (closed [0,1], tiny tolerance so the
// caller's exact 0.0 / 1.0 endpoints are accepted without surprise).
inline bool inUnit(double t) {
    return t >= -1e-12 && t <= 1.0 + 1e-12;
}

// One full de Casteljau pass over `pts` at parameter t, returning the apex point
// B(t). `pts` is copied into a scratch buffer the caller owns. Non-mutating.
Vec3 deCasteljauPoint(const std::vector<Vec3>& pts, double t) {
    std::vector<Vec3> tmp = pts;                 // working diagonal
    const std::size_t n = tmp.size();
    for (std::size_t r = 1; r < n; ++r) {
        for (std::size_t i = 0; i + r < n; ++i) {
            // Convex combination (corner cut): stays in the convex hull.
            tmp[i] = vadd(vscale(tmp[i], 1.0 - t), vscale(tmp[i + 1], t));
        }
    }
    return tmp.front();
}

// The raw first derivative B'(t) of a degree-(n) curve with control points `pts`
// (size n+1). Builds the hodograph difference net d_i = n*(P[i+1]-P[i]) (a
// degree-(n-1) Bezier) and evaluates it by de Casteljau. For n==0 (single point)
// the derivative is the zero vector.
Vec3 hodographValue(const std::vector<Vec3>& pts, double t) {
    const std::size_t m = pts.size();
    if (m < 2) return Vec3{};                    // constant curve -> zero deriv
    const double n = static_cast<double>(m - 1); // degree
    std::vector<Vec3> diff(m - 1);
    for (std::size_t i = 0; i + 1 < m; ++i) {
        diff[i] = vscale(vsub(pts[i + 1], pts[i]), n);
    }
    return deCasteljauPoint(diff, t);
}

// Full de Casteljau that ALSO records the left and right diagonals (for
// subdivision). `left[r]` is the apex after r levels reading from the top
// (the [0,t] sub-net), `right[r]` symmetrically from the bottom (the [t,1] net).
void deCasteljauSplit(const std::vector<Vec3>& pts, double t,
                      std::vector<Vec3>& left, std::vector<Vec3>& right) {
    const std::size_t n = pts.size();
    left.assign(n, Vec3{});
    right.assign(n, Vec3{});
    std::vector<Vec3> tmp = pts;
    left[0] = tmp.front();
    right[n - 1] = tmp.back();
    for (std::size_t r = 1; r < n; ++r) {
        for (std::size_t i = 0; i + r < n; ++i) {
            tmp[i] = vadd(vscale(tmp[i], 1.0 - t), vscale(tmp[i + 1], t));
        }
        // After level r, the first valid entry is the left diagonal point, and
        // the last valid entry (index n-1-r) is the right diagonal point.
        left[r] = tmp[0];
        right[n - 1 - r] = tmp[n - 1 - r];
    }
}

} // namespace

// ===========================================================================
// Validation
// ===========================================================================
bool validateCurveNet(const std::vector<Vec3>& control, const char** reason) {
    auto fail = [&](const char* r) { if (reason) *reason = r; return false; };
    if (control.size() < 2) return fail("curve needs >= 2 control points (degree >= 1)");
    const std::size_t degree = control.size() - 1;
    if (degree > kMaxBezierDegree) return fail("curve degree exceeds kMaxBezierDegree");
    if (reason) *reason = "";
    return true;
}

bool validateSurfaceNet(const std::vector<std::vector<Vec3>>& grid,
                        const char** reason) {
    auto fail = [&](const char* r) { if (reason) *reason = r; return false; };
    if (grid.size() < 2) return fail("surface needs >= 2 rows (u-degree >= 1)");
    const std::size_t rows = grid.size();
    if (rows - 1 > kMaxBezierDegree) return fail("u-degree exceeds kMaxBezierDegree");
    const std::size_t cols = grid.front().size();
    if (cols < 2) return fail("surface needs >= 2 columns (v-degree >= 1)");
    if (cols - 1 > kMaxBezierDegree) return fail("v-degree exceeds kMaxBezierDegree");
    for (const auto& row : grid) {
        if (row.size() != cols) return fail("control net is not rectangular");
    }
    if (reason) *reason = "";
    return true;
}

// ===========================================================================
// (1) Curve evaluation
// ===========================================================================
CurveSample evalCurve(const std::vector<Vec3>& control, double t) {
    CurveSample out;
    if (!validateCurveNet(control)) return out;   // ok stays false
    if (!inUnit(t)) return out;                    // out of domain -> ok=false

    out.point = deCasteljauPoint(control, t);
    out.deriv = hodographValue(control, t);
    const double dl = vlen(out.deriv);
    if (dl > std::numeric_limits<double>::min() * 1e3 && dl > 0.0) {
        out.tangent = vscale(out.deriv, 1.0 / dl);
        out.tangentDefined = true;
    } else {
        out.tangent = Vec3{};
        out.tangentDefined = false;               // stationary point / cusp
    }
    out.ok = true;
    return out;
}

// ===========================================================================
// (2) Curve subdivision
// ===========================================================================
CurveSplit subdivideCurve(const std::vector<Vec3>& control, double t) {
    CurveSplit out;
    if (!validateCurveNet(control)) return out;
    // Splitting only makes sense strictly inside the open interval.
    if (!(t > 1e-12 && t < 1.0 - 1e-12)) return out;

    deCasteljauSplit(control, t, out.left, out.right);
    out.ok = true;
    return out;
}

// ===========================================================================
// (3) Tensor-product surface evaluation
// ===========================================================================
SurfaceSample evalSurface(const std::vector<std::vector<Vec3>>& grid,
                          double u, double v) {
    SurfaceSample out;
    if (!validateSurfaceNet(grid)) return out;
    if (!inUnit(u) || !inUnit(v)) return out;

    const std::size_t rows = grid.size();          // u-direction (m+1)
    const std::size_t cols = grid.front().size();  // v-direction (n+1)

    // --- point + dS/dv: for each u-row evaluate the v-curve point and v-deriv,
    //     then run the u-curve over those results. ---------------------------
    std::vector<Vec3> rowPointAtV(rows);   // curve in u of: row_i evaluated at v
    std::vector<Vec3> rowDerivAtV(rows);   // curve in u of: d/dv row_i at v
    for (std::size_t i = 0; i < rows; ++i) {
        rowPointAtV[i] = deCasteljauPoint(grid[i], v);
        rowDerivAtV[i] = hodographValue(grid[i], v);
    }
    out.point = deCasteljauPoint(rowPointAtV, u);
    out.dv    = deCasteljauPoint(rowDerivAtV, u);   // d/dv commutes with the u-eval

    // --- dS/du: for each v-column evaluate the u-curve's hodograph at u, then
    //     run the v-curve over those. Build columns first. -------------------
    std::vector<Vec3> colDerivAtU(cols);
    {
        std::vector<Vec3> col(rows);
        for (std::size_t j = 0; j < cols; ++j) {
            for (std::size_t i = 0; i < rows; ++i) col[i] = grid[i][j];
            colDerivAtU[j] = hodographValue(col, u);
        }
    }
    out.du = deCasteljauPoint(colDerivAtU, v);

    // --- normal = unit(du x dv) -------------------------------------------
    const Vec3 nrm = vcross(out.du, out.dv);
    const double nl = vlen(nrm);
    if (nl > std::numeric_limits<double>::min() * 1e3 && nl > 0.0) {
        out.normal = vscale(nrm, 1.0 / nl);
        out.normalDefined = true;
    } else {
        out.normal = Vec3{};
        out.normalDefined = false;                  // degenerate parameter point
    }
    out.ok = true;
    return out;
}

// ===========================================================================
// (4) Surface tessellation -> HalfEdgeMesh open patch
// ===========================================================================
mesh::HalfEdgeMesh tessellateSurface(const std::vector<std::vector<Vec3>>& grid,
                                     std::size_t resU, std::size_t resV, bool& ok) {
    ok = false;
    mesh::HalfEdgeMesh hem;
    if (resU < 1 || resV < 1) return hem;
    if (!validateSurfaceNet(grid)) return hem;

    const std::size_t gu = resU + 1;   // u-samples
    const std::size_t gv = resV + 1;   // v-samples

    std::vector<double> positions;
    positions.reserve(3 * gu * gv);
    for (std::size_t i = 0; i < gu; ++i) {
        const double u = static_cast<double>(i) / static_cast<double>(resU);
        for (std::size_t j = 0; j < gv; ++j) {
            const double v = static_cast<double>(j) / static_cast<double>(resV);
            const SurfaceSample s = evalSurface(grid, u, v);
            // evalSurface is guaranteed ok here (net validated, u,v in [0,1]).
            positions.push_back(s.point.x);
            positions.push_back(s.point.y);
            positions.push_back(s.point.z);
        }
    }

    auto vid = [gv](std::size_t i, std::size_t j) -> std::uint32_t {
        return static_cast<std::uint32_t>(i * gv + j);
    };

    std::vector<std::uint32_t> indices;
    indices.reserve(6 * resU * resV);
    for (std::size_t i = 0; i + 1 < gu; ++i) {
        for (std::size_t j = 0; j + 1 < gv; ++j) {
            const std::uint32_t a = vid(i,     j);
            const std::uint32_t b = vid(i + 1, j);
            const std::uint32_t c = vid(i,     j + 1);
            const std::uint32_t d = vid(i + 1, j + 1);
            // Two CCW triangles per quad (consistent winding for the half-edge
            // build); an open patch so it is intentionally not watertight.
            indices.push_back(a); indices.push_back(b); indices.push_back(d);
            indices.push_back(a); indices.push_back(d); indices.push_back(c);
        }
    }

    if (!hem.buildFromSoup(positions, indices)) {
        return mesh::HalfEdgeMesh{};   // surface a build failure honestly
    }
    ok = true;
    return hem;
}

} // namespace geom
} // namespace native
} // namespace forge
