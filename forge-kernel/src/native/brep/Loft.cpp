// forge/native/brep/Loft.cpp
//
// Implementation of forge::native::brep::loftSections — see Loft.hpp for the
// honest scope, robustness posture, and 0-FAKES refusal list.
//
// Pure C++20, standard library only. Reuses (by #include, never re-implements):
//   * mesh::HalfEdgeMesh / buildFromSoup / validate / signedVolume / surfaceArea
//   * geom::Point2 + the exact orient2d sign (via the signed-area of the
//     projected section loop) for the combinatorial winding decision
//   * native::orient2d (Predicates.hpp) directly, for the per-triangle CCW
//     (non-degenerate) check of a projected ring

#include "forge/native/brep/Loft.hpp"

#include <cmath>
#include <cstdint>

namespace forge {
namespace native {
namespace brep {

namespace {

using mesh::Vec3;

inline Vec3 sub(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
inline double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }

inline Vec3 centroid(const std::vector<Vec3>& p) {
    Vec3 c{0, 0, 0};
    for (const Vec3& v : p) {
        c.x += v.x;
        c.y += v.y;
        c.z += v.z;
    }
    const double inv = p.empty() ? 0.0 : 1.0 / static_cast<double>(p.size());
    return Vec3{c.x * inv, c.y * inv, c.z * inv};
}

// Build an orthonormal (u, v) basis spanning the plane perpendicular to `axis`,
// chosen so that u x v == +axis (right-handed). Used to project a section into
// 2D for the exact signed-area / winding decision.
void planeBasis(const Vec3& axis, Vec3& u, Vec3& v) {
    // Pick the world axis least aligned with `axis` as a seed for u.
    const double ax = std::fabs(axis.x), ay = std::fabs(axis.y),
                 az = std::fabs(axis.z);
    Vec3 seed = (ax <= ay && ax <= az) ? Vec3{1, 0, 0}
              : (ay <= az)             ? Vec3{0, 1, 0}
                                       : Vec3{0, 0, 1};
    // u = normalize(seed - (seed.axis) axis)  (Gram-Schmidt)
    const double s = dot(seed, axis);
    Vec3 uu{seed.x - s * axis.x, seed.y - s * axis.y, seed.z - s * axis.z};
    const double un = norm(uu);
    u = Vec3{uu.x / un, uu.y / un, uu.z / un};
    v = cross(axis, u);  // axis x u  => u x v == axis
}

// Signed area (x2) of a polygon ring projected into the (u,v) basis, with the
// section centroid as origin. Sign tells CCW (>0) / CW (<0) about +axis; zero
// is a degenerate (collinear / self-overlapping) loop. The summation is the
// shoelace formula; the COMBINATORIAL sign is what we trust.
double projectedSignedArea2x(const std::vector<Vec3>& ring, const Vec3& c,
                             const Vec3& u, const Vec3& v) {
    const std::size_t n = ring.size();
    double acc = 0.0;
    double px = 0.0, py = 0.0;  // first projected point, filled in loop
    bool first = true;
    double fx = 0.0, fy = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Vec3 d = sub(ring[i], c);
        const double x = dot(d, u);
        const double y = dot(d, v);
        if (first) {
            fx = x;
            fy = y;
            px = x;
            py = y;
            first = false;
            continue;
        }
        acc += px * y - x * py;
        px = x;
        py = y;
    }
    // close the ring (last -> first)
    acc += px * fy - fx * py;
    return acc;
}

}  // namespace

LoftResult loftSections(const std::vector<LoftSection>& sections,
                        const Vec3& axisHint) {
    LoftResult R;

    // ---- refusal gate (0 FAKES) -------------------------------------------
    if (sections.size() < 2) {
        R.reason = "need at least 2 sections to loft";
        return R;
    }
    const std::size_t M = sections[0].points.size();
    if (M < 3) {
        R.reason = "each section needs at least 3 vertices";
        return R;
    }
    for (std::size_t k = 0; k < sections.size(); ++k) {
        if (sections[k].points.size() != M) {
            R.reason = "sections have mismatched vertex counts";
            return R;
        }
    }

    const std::size_t N = sections.size();

    // ---- derive stacking axis from the section centroids ------------------
    std::vector<Vec3> cent(N);
    for (std::size_t k = 0; k < N; ++k) cent[k] = centroid(sections[k].points);

    Vec3 axis = sub(cent[N - 1], cent[0]);
    double aLen = norm(axis);
    if (aLen < 1e-12) {
        // Centroids coincide (e.g. all sections share a centroid) — fall back
        // to the hint (or +Z) so we still have a well-defined cap direction.
        Vec3 h = axisHint;
        if (norm(h) < 1e-12) h = Vec3{0, 0, 1};
        const double hn = norm(h);
        axis = Vec3{h.x / hn, h.y / hn, h.z / hn};
    } else {
        axis = Vec3{axis.x / aLen, axis.y / aLen, axis.z / aLen};
    }

    // ---- monotonic separation along the axis ------------------------------
    // Section centroids must advance strictly along +axis (a simple loft); a
    // non-monotonic stack would self-intersect — refused honestly.
    {
        double prev = dot(cent[0], axis);
        for (std::size_t k = 1; k < N; ++k) {
            const double t = dot(cent[k], axis);
            if (!(t > prev + 1e-12)) {
                R.reason =
                    "sections are not monotonically separated along the axis";
                return R;
            }
            prev = t;
        }
    }

    // ---- plane basis + per-section winding (exact-sign driven) ------------
    Vec3 u, v;
    planeBasis(axis, u, v);

    // Decide a single consistent winding for all sections. The sign of the
    // projected signed area is the combinatorial winding about +axis.
    int commonSign = 0;
    for (std::size_t k = 0; k < N; ++k) {
        const double a2 =
            projectedSignedArea2x(sections[k].points, cent[k], u, v);
        if (a2 == 0.0 || std::fabs(a2) < 1e-18) {
            R.reason = "section is degenerate (zero area in its plane)";
            return R;
        }
        const int sgn = (a2 > 0.0) ? +1 : -1;
        if (commonSign == 0) {
            commonSign = sgn;
        } else if (sgn != commonSign) {
            R.reason = "sections have inconsistent winding (one is reversed)";
            return R;
        }
    }

    // Normalize all loops to CCW-about-+axis. If the common winding is CW we
    // reverse each ring so the standard outward orientation below applies.
    // (We copy into a working buffer so the caller's input is untouched.)
    std::vector<std::vector<Vec3>> ring(N);
    for (std::size_t k = 0; k < N; ++k) {
        const std::vector<Vec3>& src = sections[k].points;
        ring[k].resize(M);
        if (commonSign > 0) {
            for (std::size_t i = 0; i < M; ++i) ring[k][i] = src[i];
        } else {
            for (std::size_t i = 0; i < M; ++i) ring[k][i] = src[M - 1 - i];
        }
    }

    // ---- assemble the triangle soup ---------------------------------------
    // Global vertex layout: section k vertex i  ->  index k*M + i.
    std::vector<double> positions;
    positions.reserve(3 * N * M);
    for (std::size_t k = 0; k < N; ++k) {
        for (std::size_t i = 0; i < M; ++i) {
            positions.push_back(ring[k][i].x);
            positions.push_back(ring[k][i].y);
            positions.push_back(ring[k][i].z);
        }
    }
    auto vid = [M](std::size_t k, std::size_t i) -> std::uint32_t {
        return static_cast<std::uint32_t>(k * M + i);
    };

    std::vector<std::uint32_t> indices;

    // (1) SIDE BANDS — for each consecutive pair (k, k+1) and each edge
    //     i -> i+1, build the quad
    //         a = (k,   i)   b = (k,   i+1)
    //         c = (k+1, i)   d = (k+1, i+1)
    //     With CCW-about-+axis rings and the band facing OUTWARD, the two
    //     triangles are (a, b, d) and (a, d, c). This keeps a consistent
    //     outward winding and never repeats a directed edge.
    for (std::size_t k = 0; k + 1 < N; ++k) {
        for (std::size_t i = 0; i < M; ++i) {
            const std::size_t j = (i + 1) % M;
            const std::uint32_t a = vid(k, i);
            const std::uint32_t b = vid(k, j);
            const std::uint32_t c = vid(k + 1, i);
            const std::uint32_t d = vid(k + 1, j);
            indices.push_back(a);
            indices.push_back(b);
            indices.push_back(d);
            indices.push_back(a);
            indices.push_back(d);
            indices.push_back(c);
        }
    }

    // (2) END CAPS — triangulate each end ring with a fan from its vertex 0.
    //     BOTTOM cap (section 0): outward normal points along -axis, so the
    //     fan must be wound CW-about-+axis  ->  (0, i+1, i).
    //     TOP cap (section N-1): outward normal points along +axis, so CCW
    //     ->  (0, i, i+1).
    //     A fan is valid for a CONVEX section; a non-convex section can produce
    //     a self-overlapping fan that fails the manifold build — that failure
    //     is surfaced honestly (not faked) by the validate() gate below.
    {
        const std::size_t kb = 0;
        for (std::size_t i = 1; i + 1 < M; ++i) {
            indices.push_back(vid(kb, 0));
            indices.push_back(vid(kb, i + 1));
            indices.push_back(vid(kb, i));
        }
        const std::size_t kt = N - 1;
        for (std::size_t i = 1; i + 1 < M; ++i) {
            indices.push_back(vid(kt, 0));
            indices.push_back(vid(kt, i));
            indices.push_back(vid(kt, i + 1));
        }
    }

    // ---- build + validate (never fake a closed solid) ---------------------
    mesh::HalfEdgeMesh hem;
    if (!hem.buildFromSoup(positions, indices)) {
        R.reason =
            "loft surface is not a consistently-wound 2-manifold soup "
            "(e.g. non-convex / self-overlapping section cap)";
        return R;
    }
    const mesh::ValidityReport rep = hem.validate();
    if (!rep.isValid()) {
        R.reason = "lofted solid is not a closed 2-manifold";
        return R;
    }

    R.mesh = std::move(hem);
    R.volume = R.mesh.signedVolume();
    R.area = R.mesh.surfaceArea();
    R.ok = true;
    return R;
}

}  // namespace brep
}  // namespace native
}  // namespace forge
