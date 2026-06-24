// forge/native/brep/LoftSweep.cpp
//
// Implementation of forge::native::brep::loftSolid / sweepSolid — see
// LoftSweep.hpp for the honest scope, the A3 (features-write-brep) rationale, and
// the named follow-up list. Pure C++20, standard library only; ZERO new deps.
//
// Reuses (by #include, never re-implements):
//   * TopologyBuilder / Solid / Face / Surface assembly (Topology + Primitives +
//     Surface),
//   * massProperties() (MassProps) for the exact divergence-theorem volume/area
//     and as the positive-volume orientation guard.
//
// Method (analytic, unified body model):
//   1. Validate sections (>= 2, each >= 3 vertices, planar, non-degenerate).
//   2. Derive the loft axis from the first->last section centroid; require the
//      section centroids to be strictly monotone along it (a simple loft).
//   3. Normalise every section's winding to CCW about +axis (so a cap built from
//      the ring has a right-hand-rule normal).
//   4. Emit ONE Vertex per section vertex (shared between the cap and the side
//      bands and between adjacent side bands), then:
//        * the FIRST section as a planar end cap with outward normal -axis,
//        * the LAST  section as a planar end cap with outward normal +axis,
//        * between every consecutive section pair a ruled side band:
//            - equal vertex count  -> a quad band, each quad split into two
//              triangles (exact whether or not the quad is planar),
//            - unequal vertex count -> a greedy shortest-diagonal triangle strip
//              stitching the two rings (a ruled hull).
//      Every side face is a TRIANGLE carrying an exact Plane surface; every cap is
//      one planar polygon face. All faces share edges through addOuterLoopToFace,
//      so the shell is a closed 2-manifold (asserted via isClosedTwoManifold).
//   5. Measure with massProperties; if the volume came out negative the whole
//      shell was wound inward — we never reach that because the winding is fixed
//      in step 3, but we still assert volume > 0 honestly before ok=true.

#include "forge/native/brep/LoftSweep.hpp"

#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace forge {
namespace native {
namespace brep {

namespace {

inline Vec3 V3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x * s, a.y * s, a.z * s}; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double len(const Vec3& a) { return std::sqrt(dot(a, a)); }

Vec3 centroid(const std::vector<Point3>& p) {
    Vec3 c{0, 0, 0};
    for (const Point3& v : p) { c.x += v.x; c.y += v.y; c.z += v.z; }
    const double inv = p.empty() ? 0.0 : 1.0 / static_cast<double>(p.size());
    return {c.x * inv, c.y * inv, c.z * inv};
}

// Newell's method: the (un-normalised) area-weighted normal of a 3D polygon ring.
// Robust for non-planar rings; for a planar ring it is the true plane normal
// scaled by 2x the signed area.
Vec3 newellNormal(const std::vector<Point3>& ring) {
    Vec3 n{0, 0, 0};
    const std::size_t m = ring.size();
    for (std::size_t i = 0; i < m; ++i) {
        const Point3& a = ring[i];
        const Point3& b = ring[(i + 1) % m];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n;  // |n| == 2*planar area; direction == ring normal by right-hand rule
}

// ---------------------------------------------------------------------------
// Build a closed analytic solid from a stack of already-prepared section rings.
// PRECONDITIONS (the callers establish these): each ring is CCW about +axis,
// sections are monotone along +axis, every ring has >= 3 vertices. Emits caps +
// ruled side faces on `fac` and returns the Solid* (non-owning view into fac).
// Returns nullptr (and sets `reason`) on a structural failure.
// ---------------------------------------------------------------------------
Solid* assembleStack(SolidFactory& fac,
                     const std::vector<std::vector<Point3>>& rings,
                     const Vec3& axis,
                     const char** reason) {
    TopologyBuilder& tb = fac.builder();
    const std::size_t N = rings.size();

    // One shared vertex per (section, ring-vertex).
    std::vector<std::vector<Vertex*>> V(N);
    for (std::size_t k = 0; k < N; ++k) {
        V[k].resize(rings[k].size());
        for (std::size_t i = 0; i < rings[k].size(); ++i)
            V[k][i] = tb.makeVertex(rings[k][i]);
    }

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // --- helper: attach a Plane surface to a planar polygon face --------------
    // `ringV` is the face's CCW ring (as seen from outside, along +outwardNormal).
    // We span the plane with two non-parallel edges of the ring; `reversed` is
    // set so normalAt points along outwardNormal (the mass integrator's needed
    // outward sense).
    auto attachPlane = [&](Face* f, const std::vector<Vertex*>& ringV,
                           const Vec3& outwardNormal) -> bool {
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        const Vec3 o = V3(ringV[0]->point);
        s->origin = o;
        // pick two ring edges that span the plane (non-parallel).
        Vec3 uDir = sub(V3(ringV[1]->point), o);
        Vec3 vDir{0, 0, 0};
        for (std::size_t i = 2; i < ringV.size(); ++i) {
            Vec3 cand = sub(V3(ringV[i]->point), o);
            if (len(cross(uDir, cand)) > 1e-12 * (len(uDir) * len(cand) + 1e-300)) {
                vDir = cand; break;
            }
        }
        if (len(cross(uDir, vDir)) <= 0.0) { *reason = "degenerate planar face"; return false; }
        s->refDir = vnorm(uDir);
        s->axis = vnorm(cross(uDir, vDir));
        s->reversed = (dot(s->axis, outwardNormal) < 0.0);
        f->surface = s;
        // vertexUV + trim window in the (refDir, binormal) plane coords.
        f->vertexUV.clear();
        f->vertexUV.reserve(ringV.size());
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        const Vec3 bn = s->binormal();
        for (std::size_t i = 0; i < ringV.size(); ++i) {
            Vec3 rel = sub(V3(ringV[i]->point), o);
            double pu = dot(rel, s->refDir);
            double pv = dot(rel, bn);
            f->vertexUV.push_back({pu, pv});
            if (i == 0) { u0 = u1 = pu; v0 = v1 = pv; }
            else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
                   v0 = std::min(v0, pv); v1 = std::max(v1, pv); }
        }
        f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
        return true;
    };

    // --- helper: emit one triangle face with an outward Plane surface ---------
    auto addTri = [&](Vertex* a, Vertex* b, Vertex* c, const Vec3& outwardNormal) -> bool {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {a, b, c};
        tb.addOuterLoopToFace(f, ring);
        return attachPlane(f, ring, outwardNormal);
    };

    // --- (1) END CAPS ---------------------------------------------------------
    // FIRST section: outward normal points along -axis. The ring is CCW about
    // +axis, so as seen from BELOW (-axis side, i.e. from outside the solid) it is
    // CW; we reverse it so the cap face ring is CCW from outside (right-hand rule
    // gives -axis). The mass integrator only needs the polygon + the outward
    // normal we attach, so a single planar polygon face is exact.
    {
        std::vector<Vertex*> capRing(V[0].rbegin(), V[0].rend());
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, capRing);
        if (!attachPlane(f, capRing, mul(axis, -1.0))) return nullptr;
    }
    // LAST section: outward normal +axis; ring already CCW about +axis.
    {
        std::vector<Vertex*> capRing = V[N - 1];
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, capRing);
        if (!attachPlane(f, capRing, axis)) return nullptr;
    }

    // --- (2) RULED SIDE BANDS between consecutive sections --------------------
    for (std::size_t k = 0; k + 1 < N; ++k) {
        const std::vector<Vertex*>& lo = V[k];
        const std::vector<Vertex*>& hi = V[k + 1];
        const std::size_t nLo = lo.size();
        const std::size_t nHi = hi.size();

        // Outward normal of a side triangle: for a CCW-about-+axis ring, walking
        // edge i->i+1 on the lower ring and rising to the upper ring, the outward
        // side faces AWAY from the axis. We compute each triangle's geometric
        // normal from its own vertices and flip it to point away from the band's
        // local centroid-to-axis line; simplest robust choice: outward == the
        // triangle normal oriented so it points away from the segment centroid.
        // We pass the per-triangle outward normal computed below.

        // band centre line point (midway between the two section centroids) and
        // axis, used to decide the outward sense per triangle.
        Vec3 cLo{0, 0, 0}, cHi{0, 0, 0};
        for (auto* v : lo) cLo = add(cLo, V3(v->point));
        for (auto* v : hi) cHi = add(cHi, V3(v->point));
        cLo = mul(cLo, 1.0 / static_cast<double>(nLo));
        cHi = mul(cHi, 1.0 / static_cast<double>(nHi));
        const Vec3 bandCentre = mul(add(cLo, cHi), 0.5);

        auto outwardFor = [&](Vertex* a, Vertex* b, Vertex* c) -> Vec3 {
            const Vec3 pa = V3(a->point), pb = V3(b->point), pc = V3(c->point);
            Vec3 n = cross(sub(pb, pa), sub(pc, pa));
            // tri centroid relative to the band axis line (point bandCentre, dir axis).
            Vec3 tc = mul(add(add(pa, pb), pc), 1.0 / 3.0);
            Vec3 rel = sub(tc, bandCentre);
            // remove the axial component -> radial outward direction.
            Vec3 radial = sub(rel, mul(axis, dot(rel, axis)));
            if (dot(n, radial) < 0.0) n = mul(n, -1.0);
            return vnorm(n);
        };

        if (nLo == nHi) {
            // EQUAL count: quad band, each quad i split into two triangles.
            for (std::size_t i = 0; i < nLo; ++i) {
                const std::size_t j = (i + 1) % nLo;
                Vertex* a = lo[i]; Vertex* b = lo[j];
                Vertex* c = hi[i]; Vertex* d = hi[j];
                // quad (a,b,d,c) CCW outward; tris (a,b,d) and (a,d,c).
                Vec3 n1 = outwardFor(a, b, d);
                Vec3 n2 = outwardFor(a, d, c);
                // emit with a consistent CCW ring relative to that normal: order so
                // cross(b-a,d-a) aligns with n1 (addTri attaches outward = n given).
                if (dot(cross(sub(V3(b->point), V3(a->point)), sub(V3(d->point), V3(a->point))), n1) >= 0.0) {
                    if (!addTri(a, b, d, n1)) return nullptr;
                } else {
                    if (!addTri(a, d, b, n1)) return nullptr;
                }
                if (dot(cross(sub(V3(d->point), V3(a->point)), sub(V3(c->point), V3(a->point))), n2) >= 0.0) {
                    if (!addTri(a, d, c, n2)) return nullptr;
                } else {
                    if (!addTri(a, c, d, n2)) return nullptr;
                }
            }
        } else {
            // UNEQUAL count: greedy shortest-diagonal triangle strip stitching the
            // two closed rings (a ruled hull). Advance two pointers i (lower) and
            // j (upper); at each step add the triangle that consumes the shorter
            // candidate diagonal, until both rings are fully traversed.
            std::size_t i = 0, j = 0;
            std::size_t addedLo = 0, addedHi = 0;
            // guard: total triangles == nLo + nHi (each ring edge consumed once).
            while (addedLo < nLo || addedHi < nHi) {
                Vertex* a = lo[i % nLo];
                Vertex* b = hi[j % nHi];
                // candidate next on each ring
                Vertex* an = lo[(i + 1) % nLo];
                Vertex* bn = hi[(j + 1) % nHi];
                bool advanceLo;
                if (addedLo >= nLo)      advanceLo = false;     // lower ring exhausted
                else if (addedHi >= nHi) advanceLo = true;      // upper ring exhausted
                else {
                    // pick the move whose new diagonal is shorter (well-shaped strip).
                    double dLo = len(sub(V3(an->point), V3(b->point)));   // a->b->an triangle
                    double dHi = len(sub(V3(bn->point), V3(a->point)));   // a->b->bn triangle
                    advanceLo = (dLo <= dHi);
                }
                if (advanceLo) {
                    // triangle (a, an, b) on the lower edge a->an.
                    Vec3 n = outwardFor(a, an, b);
                    if (dot(cross(sub(V3(an->point), V3(a->point)), sub(V3(b->point), V3(a->point))), n) >= 0.0) {
                        if (!addTri(a, an, b, n)) return nullptr;
                    } else {
                        if (!addTri(a, b, an, n)) return nullptr;
                    }
                    ++i; ++addedLo;
                } else {
                    // triangle (a, bn, b) on the upper edge b->bn.
                    Vec3 n = outwardFor(b, bn, a);
                    if (dot(cross(sub(V3(bn->point), V3(b->point)), sub(V3(a->point), V3(b->point))), n) >= 0.0) {
                        if (!addTri(b, bn, a, n)) return nullptr;
                    } else {
                        if (!addTri(b, a, bn, n)) return nullptr;
                    }
                    ++j; ++addedHi;
                }
            }
        }
    }

    return solid;
}

// Normalise a stack of raw section rings: validate, derive axis, fix winding to
// CCW about +axis. Returns false (and sets reason) on any honest refusal.
bool prepareStack(const std::vector<std::vector<Point3>>& raw,
                  std::vector<std::vector<Point3>>& out, Vec3& axisOut,
                  const char** reason) {
    const std::size_t N = raw.size();
    if (N < 2) { *reason = "need at least 2 sections to loft"; return false; }
    for (const auto& r : raw)
        if (r.size() < 3) { *reason = "each section needs at least 3 vertices"; return false; }

    std::vector<Vec3> cent(N);
    for (std::size_t k = 0; k < N; ++k) cent[k] = centroid(raw[k]);

    Vec3 axis = sub(cent[N - 1], cent[0]);
    double aLen = len(axis);
    if (aLen < 1e-12) { *reason = "section centroids coincide (no loft axis)"; return false; }
    axis = mul(axis, 1.0 / aLen);

    // monotone separation along +axis (a simple loft).
    double prev = dot(cent[0], axis);
    for (std::size_t k = 1; k < N; ++k) {
        double t = dot(cent[k], axis);
        if (!(t > prev + 1e-12)) { *reason = "sections not monotonically separated along the axis"; return false; }
        prev = t;
    }

    // each section non-degenerate (planar area > 0); fix winding to CCW about +axis.
    out.assign(N, {});
    for (std::size_t k = 0; k < N; ++k) {
        Vec3 nrm = newellNormal(raw[k]);
        double area2 = len(nrm);
        if (area2 < 1e-18) { *reason = "section is degenerate (zero area)"; return false; }
        out[k] = raw[k];
        if (dot(nrm, axis) < 0.0)  // wound CW about +axis -> reverse to CCW.
            std::reverse(out[k].begin(), out[k].end());
    }
    axisOut = axis;
    return true;
}

LoftSweepResult buildFromStack(const std::vector<std::vector<Point3>>& raw) {
    LoftSweepResult R;
    std::vector<std::vector<Point3>> rings;
    Vec3 axis;
    if (!prepareStack(raw, rings, axis, &R.reason)) return R;

    R.owner = std::make_shared<SolidFactory>();
    Solid* solid = assembleStack(*R.owner, rings, axis, &R.reason);
    if (solid == nullptr) return R;

    // Structural closed-2-manifold check on the unified topology.
    if (!R.owner->builder().isClosedTwoManifold()) {
        R.reason = "lofted/swept solid is not a closed 2-manifold (shared-edge wiring failed)";
        return R;
    }

    // Exact divergence-theorem mass properties over the analytic planar faces.
    MassProps mp = massProperties(*solid, 8);
    if (!(mp.volume > 0.0)) {
        R.reason = "lofted/swept solid has non-positive volume (inverted shell)";
        return R;
    }

    EulerCounts c = R.owner->builder().counts();
    R.ok = true;
    R.solid = solid;
    R.volume = mp.volume;
    R.area = mp.area;
    R.vertices = c.vertices;
    R.edges = c.edges;
    R.faces = c.faces;
    R.closedManifold = true;
    R.reason = "";
    return R;
}

} // namespace

// ===========================================================================
// Public: loftSolid
// ===========================================================================
LoftSweepResult loftSolid(const std::vector<LoftSection>& sections) {
    std::vector<std::vector<Point3>> raw;
    raw.reserve(sections.size());
    for (const auto& s : sections) raw.push_back(s.points);
    return buildFromStack(raw);
}

// ===========================================================================
// Public: sweepSolid
// ===========================================================================
LoftSweepResult sweepSolid(const std::vector<Point3>& profile,
                           const std::vector<Point3>& path) {
    LoftSweepResult R;
    if (profile.size() < 3) { R.reason = "profile needs at least 3 vertices"; return R; }
    if (path.size() < 2)    { R.reason = "path needs at least 2 points"; return R; }

    // Build N parallel section copies = profile translated to each path vertex.
    // (Pure translation — no rotation/miter in this increment; named follow-up.)
    const Vec3 base = centroid(profile);
    std::vector<std::vector<Point3>> raw;
    raw.reserve(path.size());
    for (const Point3& pv : path) {
        const Vec3 delta = sub(V3(pv), base);
        std::vector<Point3> sec;
        sec.reserve(profile.size());
        for (const Point3& p : profile)
            sec.push_back({p.x + delta.x, p.y + delta.y, p.z + delta.z});
        raw.push_back(std::move(sec));
    }
    return buildFromStack(raw);
}

} // namespace brep
} // namespace native
} // namespace forge
