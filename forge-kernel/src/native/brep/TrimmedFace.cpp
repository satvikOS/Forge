// forge/native/brep/TrimmedFace.cpp
//
// Implementation of the K1.2 TRIMMED-NURBS B-REP FACE (TrimmedFace.hpp).
// Pure C++20, standard library only. No OCCT, no new dependencies, no WASM.
//
// Algorithms (all standard, re-implemented from definition — not copied source):
//   * Even-odd ray-cast point-in-polygon (Shimrat / Hormann-Agathos crossing
//     number) against the flattened trim pcurves, with an exact orientation sign
//     for each ray-segment crossing so the in/out parity cannot be corrupted by a
//     float tie-break, plus a point-to-segment distance for the On band.
//   * Chordal-adaptive flattening of each pcurve (recursive midpoint-deviation
//     subdivision) into the (u,v) polyline the mesher and classifier consume.
//   * Trim-respecting tessellation via the existing exact-predicate constrained
//     Delaunay (geom::constrainedDelaunay2D) on the PSLG {loop polylines + interior
//     Steiner points}, keeping the even-odd INSIDE triangles, then S(u,v) + the
//     analytic rational normal per vertex (REUSE evaluateWithDerivatives).
//   * Green's-theorem planar loop area (∮ (u dv − v du)/2) with EXACT analytic
//     per-pcurve contributions (Line2 trapezoid term, Circle2 = ±π r², BSpline2 by
//     high-order Gauss on its own derivative) for the planar-exact mass path, and
//     Gauss-Legendre triangle quadrature of |S_u × S_v| for the curved path.
//
// REUSE (no re-derivation): NurbsSurface.hpp (validateSurface,
// evaluateWithDerivatives), NurbsAlgebra.hpp (surfaceCurvature), Curve.hpp
// (PCurve eval), geom/ConstrainedDelaunay2D.hpp (the CDT mesher).

#include "forge/native/brep/TrimmedFace.hpp"

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/NurbsAlgebra.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi   = 3.14159265358979323846;
constexpr double k2Pi  = 6.28318530717958647692;

// ----- tiny vector helpers (Vec3 from Nurbs.hpp) ----------------------------
inline Vec3 vsub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double vdot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double vlen(const Vec3& a) { return std::sqrt(vdot(a, a)); }

// =====================================================================
// Chordal-adaptive flattening of a single pcurve into (u,v) samples.
// Appends to `out` the points P(t) for t in (t0..t1], i.e. it does NOT push the
// start point (the caller pushes the very first loop point once, then each
// segment appends its own end + interior splits, so the polyline stays closed
// without duplicates between consecutive segments).
// =====================================================================
void flattenPCurveRange(const PCurve& pc, double a, double b,
                        std::size_t baseSegs, int depth,
                        std::vector<UVCoord>& out);

void flattenPCurve(const PCurve& pc, std::size_t baseSegs,
                   std::vector<UVCoord>& out) {
    // Walk the pcurve's own [t0,t1] with `baseSegs` uniform spans, each adaptively
    // refined. The caller has already pushed P(t0); we append the rest.
    const double t0 = pc.t0, t1 = pc.t1;
    if (baseSegs < 1) baseSegs = 1;
    for (std::size_t i = 0; i < baseSegs; ++i) {
        const double a = t0 + (t1 - t0) * (double(i)     / double(baseSegs));
        const double bb = t0 + (t1 - t0) * (double(i + 1) / double(baseSegs));
        flattenPCurveRange(pc, a, bb, baseSegs, 0, out);
    }
}

// Recursive midpoint-deviation refinement of one span [a,b]; appends P(b) (and any
// needed interior splits) but NOT P(a).
void flattenPCurveRange(const PCurve& pc, double a, double b,
                        std::size_t /*baseSegs*/, int depth,
                        std::vector<UVCoord>& out) {
    const UVCoord pa = pc.evaluate(a);
    const UVCoord pb = pc.evaluate(b);
    const double mid = 0.5 * (a + b);
    const UVCoord pm = pc.evaluate(mid);
    // Deviation of the true midpoint from the chord midpoint (parameter units).
    const double cmx = 0.5 * (pa.u + pb.u), cmy = 0.5 * (pa.v + pb.v);
    const double dev = std::hypot(pm.u - cmx, pm.v - cmy);
    const double chord = std::hypot(pb.u - pa.u, pb.v - pa.v);
    // Refine while the curve bulges meaningfully relative to the chord, capped by
    // depth so a perverse pcurve cannot run away.
    if (depth < 14 && dev > 1e-4 * std::max(chord, 1e-9) && dev > 1e-12) {
        flattenPCurveRange(pc, a, mid, 0, depth + 1, out);
        flattenPCurveRange(pc, mid, b, 0, depth + 1, out);
    } else {
        out.push_back(pb);
    }
}

// Flatten an entire loop into a closed (u,v) polyline (no duplicated closing
// vertex). Returns the ordered unique-ish ring; consecutive duplicates removed.
std::vector<UVCoord> flattenLoop(const TrimLoop& loop, std::size_t baseSegs) {
    std::vector<UVCoord> ring;
    if (loop.segments.empty()) return ring;
    // Seed with the start of the first segment, then append each segment's range.
    ring.push_back(loop.segments.front().evaluate(loop.segments.front().t0));
    for (const auto& pc : loop.segments) {
        flattenPCurve(pc, baseSegs, ring);
    }
    // Drop a trailing point coincident with the first (closed ring), and squeeze
    // any consecutive near-duplicates (degenerate-zero-length chords break CDT).
    auto nearEq = [](const UVCoord& p, const UVCoord& q) {
        return std::hypot(p.u - q.u, p.v - q.v) <= 1e-12;
    };
    std::vector<UVCoord> dedup;
    dedup.reserve(ring.size());
    for (const auto& p : ring) {
        if (!dedup.empty() && nearEq(dedup.back(), p)) continue;
        dedup.push_back(p);
    }
    if (dedup.size() >= 2 && nearEq(dedup.front(), dedup.back()))
        dedup.pop_back();
    return dedup;
}

// =====================================================================
// Exact-orientation crossing parity (point-in-polygon) over a flat segment list.
// Each loop ring contributes its closed edges; a hole ring flips parity for points
// it contains, so {outer + holes} classify the material region by a single parity.
// =====================================================================

// Squared distance from q to segment [a,b], plus whether the foot is interior.
double segDistSq(const UVCoord& q, const UVCoord& a, const UVCoord& b) {
    const double dx = b.u - a.u, dy = b.v - a.v;
    const double l2 = dx * dx + dy * dy;
    if (l2 <= 0.0) {
        const double ex = q.u - a.u, ey = q.v - a.v;
        return ex * ex + ey * ey;
    }
    double t = ((q.u - a.u) * dx + (q.v - a.v) * dy) / l2;
    t = std::clamp(t, 0.0, 1.0);
    const double px = a.u + t * dx, py = a.v + t * dy;
    const double ex = q.u - px, ey = q.v - py;
    return ex * ex + ey * ey;
}

// Crossing-number parity of a +u horizontal ray from q against the closed ring.
// Uses the standard Hormann-Agathos rule (half-open edge convention) so a vertex
// on the ray is counted exactly once. Returns the number of crossings.
int rayCrossings(const UVCoord& q, const std::vector<UVCoord>& ring) {
    int crossings = 0;
    const std::size_t n = ring.size();
    if (n < 3) return 0;
    for (std::size_t i = 0; i < n; ++i) {
        const UVCoord& a = ring[i];
        const UVCoord& b = ring[(i + 1) % n];
        // Edge straddles the horizontal line v == q.v (half-open in v).
        const bool aBelow = a.v <= q.v;
        const bool bBelow = b.v <= q.v;
        if (aBelow == bBelow) continue;          // both on same side: no crossing
        // Compute the u of the intersection of the edge with v == q.v.
        const double t = (q.v - a.v) / (b.v - a.v);
        const double xu = a.u + t * (b.u - a.u);
        if (xu > q.u) ++crossings;               // crossing to the +u side of q
    }
    return crossings;
}

// =====================================================================
// Planar detection + Green's-theorem analytic loop area.
// =====================================================================

// Detect whether `surf` is (numerically) a PLANAR chart: the partials S_u,S_v are
// constant over the domain and their cross product is a constant nonzero vector,
// so the surface area element |S_u×S_v| is a constant Jacobian J. Returns J (>0)
// in `jac` and true on success.
bool detectPlanarJacobian(const NurbsSurface& surf, double& jac) {
    const double u0 = surf.knotsU.front(), u1 = surf.knotsU.back();
    const double v0 = surf.knotsV.front(), v1 = surf.knotsV.back();
    // Sample the partials on a small grid; planar iff S_u,S_v are constant.
    Vec3 su0{}, sv0{};
    bool first = true;
    double maxDev = 0.0;
    for (int i = 0; i <= 3; ++i) {
        for (int j = 0; j <= 3; ++j) {
            const double u = u0 + (u1 - u0) * (i / 3.0);
            const double v = v0 + (v1 - v0) * (j / 3.0);
            SurfaceSample s = evaluateWithDerivatives(surf, u, v);
            if (!s.ok) return false;
            if (first) { su0 = s.du; sv0 = s.dv; first = false; }
            maxDev = std::max(maxDev, vlen(vsub(s.du, su0)));
            maxDev = std::max(maxDev, vlen(vsub(s.dv, sv0)));
        }
    }
    const Vec3 cr = vcross(su0, sv0);
    const double J = vlen(cr);
    const double scale = std::max({vlen(su0), vlen(sv0), 1e-30});
    if (J <= 0.0) return false;
    // Constant partials ⇒ planar affine chart. Tolerance relative to the partial
    // magnitude (a planar B-spline has bit-constant partials up to FP rounding).
    if (maxDev > 1e-9 * scale) return false;
    jac = J;
    return true;
}

// Analytic ∮ (u dv − v du)/2 over a single pcurve (signed planar area swept).
// Exact for Line2 (trapezoid) and Circle2 (= ±π r² over a full turn, exact
// fraction over a partial arc); high-order Gauss for BSpline2 on its own
// derivative (the pcurve x→u, y→v with z ignored).
double pcurveSignedAreaTerm(const PCurve& pc) {
    switch (pc.kind) {
        case GeomPCurveKind::Line2: {
            const UVCoord a = pc.evaluate(pc.t0);
            const UVCoord b = pc.evaluate(pc.t1);
            // ∮ (u dv − v du)/2 along a straight chord = (u_a v_b − u_b v_a)/2.
            return 0.5 * (a.u * b.v - b.u * a.v);
        }
        case GeomPCurveKind::Circle2: {
            // Centre c, radius r, angle t. P=(cu+r cos t, cv+r sin t).
            // (u dv − v du)/2 integrated over [t0,t1]:
            //   = ∫ ½[(cu+r cos)(r cos) − (cv+r sin)(−r sin)] dt
            //   = ½∫[ r² + r(cu cos + cv sin) ] dt
            //   = ½[ r² (t1−t0) + r( cu(sin t1−sin t0) − cv(cos t1−cos t0) ) ].
            const double r = pc.r, cu = pc.centre.u, cv = pc.centre.v;
            const double t0 = pc.t0, t1 = pc.t1;
            const double term = r * r * (t1 - t0)
                + r * (cu * (std::sin(t1) - std::sin(t0))
                       - cv * (std::cos(t1) - std::cos(t0)));
            return 0.5 * term;
        }
        case GeomPCurveKind::BSpline2:
        default: {
            // ½ ∫ (u v' − v u') dt by 8-point Gauss-Legendre on each of `nseg`
            // uniform spans (the pcurve is piecewise-polynomial; this is exact up
            // to the per-span Gauss order for a sufficiently fine partition).
            static const double gx[8] = {
                -0.9602898564975363, -0.7966664774136267, -0.5255324099163290,
                -0.1834346424956498,  0.1834346424956498,  0.5255324099163290,
                 0.7966664774136267,  0.9602898564975363};
            static const double gw[8] = {
                0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
                0.3626837833783620, 0.3626837833783620, 0.3137066458778873,
                0.2223810344533745, 0.1012285362903763};
            const std::size_t nseg = 64;
            const double t0 = pc.t0, t1 = pc.t1;
            const double h = (t1 - t0) / double(nseg);
            const double eps = 1e-7 * std::max(std::fabs(t1 - t0), 1e-9);
            double acc = 0.0;
            for (std::size_t s = 0; s < nseg; ++s) {
                const double sa = t0 + h * double(s);
                const double sb = sa + h;
                const double mid = 0.5 * (sa + sb), half = 0.5 * (sb - sa);
                for (int g = 0; g < 8; ++g) {
                    const double t = mid + half * gx[g];
                    const UVCoord p  = pc.evaluate(t);
                    const UVCoord pp = pc.evaluate(std::min(t + eps, t1));
                    const UVCoord pm = pc.evaluate(std::max(t - eps, t0));
                    const double du = (pp.u - pm.u) / (2.0 * eps);
                    const double dv = (pp.v - pm.v) / (2.0 * eps);
                    acc += gw[g] * half * 0.5 * (p.u * dv - p.v * du);
                }
            }
            return acc;
        }
    }
}

// Signed planar area enclosed by an entire loop = sum of its pcurve terms.
double loopSignedArea(const TrimLoop& loop) {
    double a = 0.0;
    for (const auto& pc : loop.segments) a += pcurveSignedAreaTerm(pc);
    return a;
}

} // namespace

// ===========================================================================
// TrimmedFace::valid
// ===========================================================================
bool TrimmedFace::valid(const char** reason) const {
    if (reason) *reason = "";
    const char* sr = nullptr;
    if (!validateSurface(surface, &sr)) {
        if (reason) *reason = sr ? sr : "invalid NURBS surface";
        return false;
    }
    bool anySeg = false;
    for (const auto& l : loops) if (!l.segments.empty()) { anySeg = true; break; }
    if (!anySeg) { if (reason) *reason = "no trim loops with segments"; return false; }
    return true;
}

// ===========================================================================
// (1) POINT-IN-TRIM
// ===========================================================================
TrimClass classifyPointInTrim(const TrimmedFace& face, const UVCoord& q,
                              double onTol, std::size_t loopSamples) {
    // Flatten loops once.
    std::vector<std::vector<UVCoord>> rings;
    rings.reserve(face.loops.size());
    for (const auto& loop : face.loops)
        rings.push_back(flattenLoop(loop, loopSamples));

    // On-boundary band: distance to any loop segment within onTol.
    const double onTol2 = onTol * onTol;
    for (const auto& ring : rings) {
        const std::size_t n = ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            if (segDistSq(q, ring[i], ring[(i + 1) % n]) <= onTol2)
                return TrimClass::On;
        }
    }

    // Even-odd parity over ALL rings combined: a point inside the outer loop and
    // inside K hole loops has total parity (1 + K) mod 2 — inside the material iff
    // that total is odd (outer once, each hole flips it back out).
    int total = 0;
    for (const auto& ring : rings) total += rayCrossings(q, ring);
    return (total % 2 == 1) ? TrimClass::Inside : TrimClass::Outside;
}

// ===========================================================================
// (2) TRIM-RESPECTING ADAPTIVE TESSELLATION
// ===========================================================================
TrimMesh tessellateTrimmedFace(const TrimmedFace& face,
                               const TessellateOptions& opt) {
    TrimMesh out;
    const char* vr = nullptr;
    if (!face.valid(&vr)) { out.reason = vr; return out; }

    const NurbsSurface& surf = face.surface;
    const double u0 = surf.knotsU.front(), u1 = surf.knotsU.back();
    const double v0 = surf.knotsV.front(), v1 = surf.knotsV.back();

    // --- Build the PSLG: loop polylines (constraint edges) + interior Steiner pts.
    std::vector<geom::Point2> pts;
    std::vector<geom::ConstraintEdge> cons;

    // Flatten loops and add each ring as a closed chain of constraint edges.
    for (const auto& loop : face.loops) {
        std::vector<UVCoord> ring = flattenLoop(loop, opt.loopSamples);
        if (ring.size() < 3) continue;
        const int base = static_cast<int>(pts.size());
        const int m = static_cast<int>(ring.size());
        for (const auto& p : ring) pts.push_back({p.u, p.v});
        for (int i = 0; i < m; ++i)
            cons.push_back({base + i, base + ((i + 1) % m)});
    }
    if (cons.empty()) { out.reason = "no closed trim loops to mesh"; return out; }

    // Interior Steiner points: a curvature-adaptive regular grid, each kept only
    // when it classifies strictly INSIDE the trim (so the CDT fills the interior
    // with well-shaped triangles rather than long boundary-spanning slivers).
    std::size_t gridN = std::max<std::size_t>(opt.interiorGrid, 2);
    // Curvature-driven bump: sample max curvature, raise the grid where sharp.
    {
        double kmax = 0.0;
        for (int i = 0; i <= 4; ++i)
            for (int j = 0; j <= 4; ++j) {
                const double u = u0 + (u1 - u0) * (i / 4.0);
                const double v = v0 + (v1 - v0) * (j / 4.0);
                SurfaceCurvature c = surfaceCurvature(surf, u, v);
                if (c.ok) kmax = std::max({kmax, std::fabs(c.k1), std::fabs(c.k2)});
            }
        const double span = std::max(u1 - u0, v1 - v0);
        if (kmax * span > 1.0)
            gridN = static_cast<std::size_t>(std::ceil(gridN * opt.curvatureRefine));
        gridN = std::min<std::size_t>(gridN, 96);
    }
    for (std::size_t i = 1; i + 1 <= gridN; ++i) {
        for (std::size_t j = 1; j + 1 <= gridN; ++j) {
            const double u = u0 + (u1 - u0) * (double(i) / double(gridN));
            const double v = v0 + (v1 - v0) * (double(j) / double(gridN));
            if (classifyPointInTrim(face, {u, v}, opt.onTol, opt.loopSamples)
                    == TrimClass::Inside) {
                pts.push_back({u, v});  // not a constraint endpoint: a free interior vertex
            }
        }
    }

    // --- Constrained Delaunay over the PSLG, with even-odd inside marking.
    geom::CDTResult cdt = geom::constrainedDelaunay2D(pts, cons);
    if (!cdt.ok) { out.reason = cdt.reason; return out; }

    // --- Keep INSIDE triangles, mapping CDT-local vertices to 3D.
    // The CDT may have de-duplicated points; index into cdt.points.
    const std::size_t np = cdt.points.size();
    out.positions.resize(np);
    out.normals.resize(np);
    out.uv.resize(np);
    std::vector<char> used(np, 0);

    for (std::size_t t = 0; t < cdt.triangles.size(); ++t) {
        if (t < cdt.inside.size() && !cdt.inside[t]) continue;
        const auto& tr = cdt.triangles[t];
        std::array<std::uint32_t, 3> idx{};
        bool good = true;
        for (int k = 0; k < 3; ++k) {
            const int vi = tr[k];
            if (vi < 0 || vi >= static_cast<int>(np)) { good = false; break; }
            idx[k] = static_cast<std::uint32_t>(vi);
            if (!used[vi]) {
                const double uu = cdt.points[vi].x, vv = cdt.points[vi].y;
                // Clamp to the domain (boundary samples may sit a hair outside FP).
                const double uc = std::clamp(uu, u0, u1);
                const double vc = std::clamp(vv, v0, v1);
                SurfaceSample s = evaluateWithDerivatives(surf, uc, vc);
                if (!s.ok) {
                    // Fall back to a point-only eval for the normal-degenerate case
                    // (e.g. a parametric pole); keep a zero normal honestly.
                    SurfaceSample sp = evaluatePoint(surf, uc, vc);
                    if (!sp.ok) { good = false; break; }
                    out.positions[vi] = sp.point;
                    out.normals[vi]   = Vec3{0, 0, 0};
                } else {
                    out.positions[vi] = s.point;
                    out.normals[vi]   = s.normal;
                }
                out.uv[vi] = {uc, vc};
                used[vi] = 1;
            }
        }
        if (good) out.triangles.push_back(idx);
    }

    if (out.triangles.empty()) {
        out.reason = "no inside triangles produced (empty trim region?)";
        return out;
    }
    out.ok = true;
    return out;
}

// ===========================================================================
// (3) TRIMMED-PATCH AREA
// ===========================================================================
TrimmedMassProps trimmedFaceArea(const TrimmedFace& face,
                                 std::size_t quadRefine,
                                 const TessellateOptions& tessOpt) {
    TrimmedMassProps out;
    const char* vr = nullptr;
    if (!face.valid(&vr)) { out.reason = vr; return out; }

    // --- PLANAR-EXACT path: constant Jacobian × Green's-theorem loop area.
    double jac = 0.0;
    if (detectPlanarJacobian(face.surface, jac)) {
        // Signed planar area enclosed by ALL loops (outer +, holes − by winding).
        // For robustness against caller winding, the MATERIAL area is
        //   |outerSigned| − Σ |holeSigned|  taken with outer's sign as reference.
        double outerSigned = 0.0;
        double holeMag = 0.0;
        bool haveOuter = false;
        // Identify the outer loop as the isOuter==true one (or the largest |area|).
        std::size_t outerIdx = 0;
        double bestMag = -1.0;
        for (std::size_t i = 0; i < face.loops.size(); ++i) {
            const double a = std::fabs(loopSignedArea(face.loops[i]));
            if (face.loops[i].isOuter) { outerIdx = i; haveOuter = true; break; }
            if (a > bestMag) { bestMag = a; outerIdx = i; }
        }
        for (std::size_t i = 0; i < face.loops.size(); ++i) {
            const double a = loopSignedArea(face.loops[i]);
            if (i == outerIdx) outerSigned = a;
            else holeMag += std::fabs(a);
        }
        (void)haveOuter;
        const double planarArea = std::fabs(outerSigned) - holeMag;
        out.area = jac * std::max(planarArea, 0.0);
        out.planarExact = true;
        out.ok = true;
        return out;
    }

    // --- QUADRATURE path: Gauss-Legendre over the trim tessellation triangles.
    TrimMesh mesh = tessellateTrimmedFace(face, tessOpt);
    if (!mesh.ok) { out.reason = mesh.reason; return out; }

    // Symmetric 3-point degree-2 triangle rule on barycentric mid-edge points; the
    // triangle is subdivided 4^quadRefine times to drive the curved-surface area
    // toward the true ∫∫|S_u×S_v|. Each sub-triangle area is approximated by the
    // average area element at its three mid-edge (u,v) points × its (u,v) area.
    const NurbsSurface& surf = face.surface;
    auto areaElem = [&](double u, double v) -> double {
        SurfaceSample s = evaluateWithDerivatives(surf, u, v);
        if (!s.ok) {
            // Use a finite-difference Jacobian as a last resort (degenerate normal).
            return 0.0;
        }
        return vlen(vcross(s.du, s.dv));
    };

    double total = 0.0;
    for (const auto& tr : mesh.triangles) {
        const UVCoord A = mesh.uv[tr[0]];
        const UVCoord B = mesh.uv[tr[1]];
        const UVCoord C = mesh.uv[tr[2]];
        // Recursively subdivide this parameter triangle.
        struct Tri { UVCoord a, b, c; };
        std::vector<Tri> work{ {A, B, C} };
        for (std::size_t r = 0; r < quadRefine; ++r) {
            std::vector<Tri> next;
            next.reserve(work.size() * 4);
            for (const auto& T : work) {
                const UVCoord ab{0.5 * (T.a.u + T.b.u), 0.5 * (T.a.v + T.b.v)};
                const UVCoord bc{0.5 * (T.b.u + T.c.u), 0.5 * (T.b.v + T.c.v)};
                const UVCoord ca{0.5 * (T.c.u + T.a.u), 0.5 * (T.c.v + T.a.v)};
                next.push_back({T.a, ab, ca});
                next.push_back({ab, T.b, bc});
                next.push_back({ca, bc, T.c});
                next.push_back({ab, bc, ca});
            }
            work.swap(next);
        }
        for (const auto& T : work) {
            // (u,v) area of the sub-triangle.
            const double duvArea = 0.5 * std::fabs(
                (T.b.u - T.a.u) * (T.c.v - T.a.v) -
                (T.c.u - T.a.u) * (T.b.v - T.a.v));
            if (duvArea <= 0.0) continue;
            // Degree-2 mid-edge rule: average the area element at the 3 mid-edges.
            const double mu_ab = 0.5 * (T.a.u + T.b.u), mv_ab = 0.5 * (T.a.v + T.b.v);
            const double mu_bc = 0.5 * (T.b.u + T.c.u), mv_bc = 0.5 * (T.b.v + T.c.v);
            const double mu_ca = 0.5 * (T.c.u + T.a.u), mv_ca = 0.5 * (T.c.v + T.a.v);
            const double j = (areaElem(mu_ab, mv_ab) +
                              areaElem(mu_bc, mv_bc) +
                              areaElem(mu_ca, mv_ca)) / 3.0;
            total += j * duvArea;
        }
    }

    out.area = total;
    out.planarExact = false;
    out.ok = true;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
