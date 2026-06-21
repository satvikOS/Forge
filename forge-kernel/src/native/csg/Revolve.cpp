// forge/native/csg/Revolve.cpp
//
// Implementation of forge::native::csg::revolve — a watertight solid of
// revolution from a simple 2D profile. Pure C++20, stdlib only. See Revolve.hpp
// for the honest scope / envelope statement.
//
// Reuses, by #include only:
//   forge/native/Predicates.hpp        (exact orient2d)
//   forge/native/geom/Geom.hpp         (Point2)
//   forge/native/mesh/HalfEdgeMesh.hpp (Vec3, HalfEdgeMesh)

#include "forge/native/csg/Revolve.hpp"

#include "forge/native/Predicates.hpp"          // orient2d, Sign

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace csg {

namespace {

constexpr double kPi = 3.14159265358979323846;

using mesh::Vec3;
using geom::Point2;

inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x*s, a.y*s, a.z*s}; }
inline double dot(const Vec3& a, const Vec3& b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b){
    return {a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x};
}
inline double norm(const Vec3& a) { return std::sqrt(dot(a,a)); }

// Signed area of the profile polygon via the shoelace formula (2D, plain double
// — used only for the Pappus reference and for orientation sign; the ear-clip
// combinatorics below use the EXACT orient2d predicate, not this value).
double signedAreaProfile(const std::vector<Point2>& p) {
    double a2 = 0.0;
    const std::size_t n = p.size();
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& c = p[i];
        const Point2& d = p[(i + 1) % n];
        a2 += c.x * d.y - d.x * c.y;
    }
    return 0.5 * a2;
}

// Ear-clip triangulation of a SIMPLE polygon given CCW. Emits triangles as
// triples of indices into `poly`. Uses the exact orient2d predicate for both the
// convexity (ear-tip) test and the point-in-triangle containment test, so the
// combinatorial decisions are rounding-proof for a simple input. Returns false
// if no ear can be found (input not simple / not CCW) — honest failure.
bool earClipCCW(const std::vector<Point2>& poly,
                std::vector<std::array<std::uint32_t, 3>>& tris) {
    const std::size_t n = poly.size();
    tris.clear();
    if (n < 3) return false;
    if (n == 3) { tris.push_back({0, 1, 2}); return true; }

    // Active vertex ring (indices into poly).
    std::vector<std::uint32_t> v(n);
    for (std::size_t i = 0; i < n; ++i) v[i] = static_cast<std::uint32_t>(i);

    auto orient = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c) {
        return native::orient2d(poly[a].x, poly[a].y,
                                poly[b].x, poly[b].y,
                                poly[c].x, poly[c].y);
    };
    // Is point p strictly inside (or on the boundary of) triangle (a,b,c),
    // a,b,c CCW? Inside == non-negative orientation against all three edges.
    auto inTri = [&](std::uint32_t a, std::uint32_t b, std::uint32_t c,
                     std::uint32_t p) {
        if (p == a || p == b || p == c) return false;
        const native::Sign s0 = orient(a, b, p);
        const native::Sign s1 = orient(b, c, p);
        const native::Sign s2 = orient(c, a, p);
        // Inside (incl. boundary): none strictly negative.
        return s0 != native::Sign::NEGATIVE &&
               s1 != native::Sign::NEGATIVE &&
               s2 != native::Sign::NEGATIVE;
    };

    std::size_t guard = 0;
    const std::size_t guardMax = n * n + 16;
    while (v.size() > 3) {
        if (guard++ > guardMax) return false;  // no progress -> not simple/CCW
        const std::size_t m = v.size();
        bool clipped = false;
        for (std::size_t i = 0; i < m; ++i) {
            const std::uint32_t a = v[(i + m - 1) % m];
            const std::uint32_t b = v[i];
            const std::uint32_t c = v[(i + 1) % m];
            // Convex (ear-tip) requires a CCW corner.
            if (orient(a, b, c) != native::Sign::POSITIVE) continue;
            // No other active vertex may lie inside the ear triangle.
            bool empty = true;
            for (std::size_t j = 0; j < m; ++j) {
                const std::uint32_t pj = v[j];
                if (pj == a || pj == b || pj == c) continue;
                if (inTri(a, b, c, pj)) { empty = false; break; }
            }
            if (!empty) continue;
            tris.push_back({a, b, c});
            v.erase(v.begin() + static_cast<long>(i));
            clipped = true;
            break;
        }
        if (!clipped) return false;  // no ear found this pass -> failure
    }
    tris.push_back({v[0], v[1], v[2]});
    return true;
}

} // namespace

RevolveResult revolve(const std::vector<geom::Point2>& profileIn,
                      const mesh::Vec3& axisPoint,
                      const mesh::Vec3& axisDir,
                      double angleDeg,
                      int segments) {
    RevolveResult R;

    // ---- validate scalar inputs ------------------------------------------
    if (profileIn.size() < 3) { R.reason = "profile has < 3 vertices"; return R; }
    if (!(std::fabs(angleDeg) > 1e-9) || std::fabs(angleDeg) > 360.0 + 1e-9) {
        R.reason = "angle must be in (0, 360] degrees"; return R;
    }
    const double L = norm(axisDir);
    if (!(L > 1e-12)) { R.reason = "axis direction is zero"; return R; }

    const bool full = std::fabs(std::fabs(angleDeg) - 360.0) < 1e-7;
    if (full && segments < 3) { R.reason = "full revolve needs segments >= 3"; return R; }
    if (!full && segments < 1) { R.reason = "partial revolve needs segments >= 1"; return R; }

    // ---- validate the profile --------------------------------------------
    // Must be entirely on one side of the axis (all radial coords v=.y same
    // strict sign), else the revolve self-intersects through the axis.
    bool anyPos = false, anyNeg = false, anyZero = false;
    for (const Point2& p : profileIn) {
        if (p.y > 0)      anyPos = true;
        else if (p.y < 0) anyNeg = true;
        else              anyZero = true;
    }
    if (anyPos && anyNeg) {
        R.reason = "profile straddles the axis (radial coords change sign)";
        return R;
    }
    // A vertex exactly on the axis (v==0) collapses a circle to a point. That is
    // a valid cone apex ONLY at isolated tips; a general profile with v==0
    // somewhere is degenerate for a watertight band here -> reject honestly.
    if (anyZero) {
        R.reason = "profile vertex lies on the axis (radial coord == 0)";
        return R;
    }

    double sArea = signedAreaProfile(profileIn);
    if (std::fabs(sArea) < 1e-14) { R.reason = "profile area ~ 0 (degenerate)"; return R; }

    // Work with a CCW copy of the profile (for the ear-clip + consistent ring
    // winding). If the input is CW, reverse it.
    std::vector<Point2> prof = profileIn;
    if (sArea < 0.0) { std::reverse(prof.begin(), prof.end()); sArea = -sArea; }
    const std::size_t n = prof.size();

    // Radial sign: profile sits at v>0 (we mirrored sign via |v| centroid below,
    // but coords keep their sign). Pappus uses |R̄|.
    // ---- Pappus analytic reference ---------------------------------------
    const double area = sArea;  // > 0
    // Radial centroid distance R̄ = (1/A) * ∫ v dA, computed from the polygon.
    // Centroid v-coord of a polygon: Cy = (1/(6A)) Σ (y_i + y_{i+1})(x_i y_{i+1} - x_{i+1} y_i).
    double cy = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = prof[i];
        const Point2& b = prof[(i + 1) % n];
        const double crossT = a.x * b.y - b.x * a.y;
        cy += (a.y + b.y) * crossT;
    }
    cy /= (6.0 * sArea);
    const double Rbar = std::fabs(cy);
    const double theta = std::fabs(angleDeg) * kPi / 180.0;
    R.pappusVolume = theta * Rbar * area;
    R.fullRevolution = full;

    // ---- build an orthonormal frame about the axis -----------------------
    const Vec3 w = mul(axisDir, 1.0 / L);                 // unit axis
    Vec3 ref = (std::fabs(w.x) < 0.9) ? Vec3{1,0,0} : Vec3{0,1,0};
    Vec3 e1 = sub(ref, mul(w, dot(ref, w)));
    double e1n = norm(e1);
    if (!(e1n > 1e-12)) { R.reason = "failed to build axis frame"; return R; }
    e1 = mul(e1, 1.0 / e1n);
    Vec3 e2 = cross(w, e1);                                // unit, w-e1-e2 RH

    // Sweep sense: angleDeg sign chooses CCW/CW by the right-hand rule about w.
    const double sweep = angleDeg * kPi / 180.0;           // signed radians
    const int rings = full ? segments : (segments + 1);    // distinct ring count
    const int sideRings = segments;                        // # quad bands

    // 3D position of profile vertex j at angular parameter phi.
    auto place = [&](std::size_t j, double phi) -> Vec3 {
        const double u = prof[j].x;   // along-axis
        const double r = prof[j].y;   // radial (signed; same sign for all)
        const Vec3 radialDir = add(mul(e1, std::cos(phi)), mul(e2, std::sin(phi)));
        Vec3 p = add(axisPoint, mul(w, u));
        p = add(p, mul(radialDir, r));
        return p;
    };

    // ---- emit vertices ----------------------------------------------------
    std::vector<double> pos;
    pos.reserve(static_cast<std::size_t>(rings) * n * 3);
    auto vid = [&](int ring, std::size_t j) -> std::uint32_t {
        return static_cast<std::uint32_t>(ring * static_cast<int>(n) + static_cast<int>(j));
    };
    for (int ring = 0; ring < rings; ++ring) {
        const double phi = sweep * (static_cast<double>(ring) / static_cast<double>(segments));
        for (std::size_t j = 0; j < n; ++j) {
            Vec3 p = place(j, phi);
            pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z);
        }
    }

    // ---- emit side band triangles ----------------------------------------
    // For band s (0..sideRings-1) connect ring s -> ring s+1 (mod rings if full).
    // Each profile edge (j -> j+1) makes a quad (a,b,d,c):
    //   a = (s,   j)   b = (s,   j+1)
    //   c = (s+1, j)   d = (s+1, j+1)
    // Triangulated (a,b,d),(a,d,c). Combinatorial winding is consistent; the
    // global orientation is fixed up after the build by the volume sign.
    std::vector<std::uint32_t> idx;
    idx.reserve(static_cast<std::size_t>(sideRings) * n * 6);
    for (int s = 0; s < sideRings; ++s) {
        const int s1 = full ? ((s + 1) % rings) : (s + 1);
        for (std::size_t j = 0; j < n; ++j) {
            const std::size_t j1 = (j + 1) % n;
            const std::uint32_t a = vid(s,  j);
            const std::uint32_t b = vid(s,  j1);
            const std::uint32_t c = vid(s1, j);
            const std::uint32_t d = vid(s1, j1);
            idx.push_back(a); idx.push_back(b); idx.push_back(d);
            idx.push_back(a); idx.push_back(d); idx.push_back(c);
        }
    }

    // ---- caps for partial revolve ----------------------------------------
    if (!full) {
        std::vector<std::array<std::uint32_t, 3>> tris;
        if (!earClipCCW(prof, tris)) {
            R.reason = "profile is not a simple polygon (cap triangulation failed)";
            return R;
        }
        // Start cap = ring 0; end cap = ring `rings-1`. The shared boundary
        // edges between a cap and the side band MUST be oppositely directed
        // (twin half-edges) or buildFromSoup rejects the soup as non-manifold.
        //
        // Side band start ring (s=0) boundary edges run profile-FORWARD
        // (0,j)->(0,j+1)  [from triangle (a,b,d), edge a->b]. So the START cap
        // must emit profile edges REVERSED -> reverse the CCW ear triangles.
        //
        // Side band end ring (rings-1) boundary edges run profile-REVERSE
        // (end,j+1)->(end,j)  [from triangle (a,d,c), edge d->c]. So the END
        // cap must emit profile edges FORWARD -> keep the CCW ear triangles.
        const int startRing = 0;
        const int endRing = rings - 1;
        for (const auto& t : tris) {
            // start cap: REVERSED winding
            idx.push_back(vid(startRing, t[0]));
            idx.push_back(vid(startRing, t[2]));
            idx.push_back(vid(startRing, t[1]));
            // end cap: as-is (CCW)
            idx.push_back(vid(endRing, t[0]));
            idx.push_back(vid(endRing, t[1]));
            idx.push_back(vid(endRing, t[2]));
        }
    }

    // ---- build, orient, validate -----------------------------------------
    mesh::HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) {
        R.reason = "half-edge build failed (non-manifold soup)";
        return R;
    }
    // Fix global orientation: outward => positive signed volume. If negative,
    // flip every triangle and rebuild.
    if (m.signedVolume() < 0.0) {
        for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
            std::swap(idx[t + 1], idx[t + 2]);
        }
        mesh::HalfEdgeMesh m2;
        if (!m2.buildFromSoup(pos, idx)) {
            R.reason = "half-edge rebuild after flip failed";
            return R;
        }
        m = std::move(m2);
    }

    mesh::ValidityReport vr = m.validate();
    if (!vr.twinsConsistent || !vr.manifold || !vr.watertight) {
        R.reason = "result is not a closed 2-manifold";
        return R;
    }

    R.mesh = std::move(m);
    R.ok = true;
    R.reason = "ok";
    return R;
}

RevolveResult revolve(const std::vector<geom::Point2>& profile2D,
                      const Axis& axis,
                      double angleDeg,
                      int segments) {
    return revolve(profile2D, axis.point, axis.direction, angleDeg, segments);
}

} // namespace csg
} // namespace native
} // namespace forge
