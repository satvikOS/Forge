// forge/native/brep/HelicalSweep.cpp
//
// Implementation of forge::native::brep::helicalSweep / helixArcLength — see
// HelicalSweep.hpp for the honest scope (circular profile / constant-pitch helix;
// faceted ruled tube that is volume-exact in the limit), the reuse rationale, and
// the named follow-up list. Pure C++20, standard library only; ZERO new deps.
//
// Reuses (by #include, never re-implements):
//   * TopologyBuilder / Solid / Face / Surface assembly (Topology + Primitives +
//     Surface),
//   * massProperties() (MassProps) for the exact divergence-theorem volume/area
//     over the analytic planar faces.
//
// Method (discretized swept-loft, unified body model):
//   1. Validate the spec (R>0, p>0, N>0, r>0, segments sane; require p > 2r so the
//      wire does not self-intersect — an honest geometric precondition).
//   2. Discretise the helix C(t)=R(cos t,sin t,0)+(p t/2π)ẑ, t∈[0,2πN] into M
//      segments (M+1 stations). Seed a frame ⟂ T(0) and ROTATION-MINIMISING-FRAME
//      (double-reflection RMF) transport it station to station, so the swept tube
//      does not spuriously twist.
//   3. At each station place the `profileSegments`-gon circle (radius r) in the
//      RMF (u,v) plane, centred at C(t). This is one section ring.
//   4. Build the solid directly on a fresh TopologyBuilder: two PLANAR end caps
//      (first/last circle) with outward normals ∓T at the ends, and a RULED quad
//      band between every consecutive section pair (each quad → two exact planar
//      triangles, outward normal computed from the local section centre so it
//      points radially out of the tube). Shared edges via addOuterLoopToFace ⇒ a
//      closed 2-manifold.
//   5. Validate isClosedTwoManifold + massProperties volume > 0 before ok=true.
//      The faceted volume converges to π r² · L (Pappus) as M and profileSegments
//      grow; the gate reports the convergence.

#include "forge/native/brep/HelicalSweep.hpp"

#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 V3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
inline Point3 P3(const Vec3& v) { return Point3{v.x, v.y, v.z}; }

inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 mul(const Vec3& a, double s)      { return {a.x * s, a.y * s, a.z * s}; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double len(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline Vec3 unit(const Vec3& a) {
    double L = len(a);
    return (L > 1e-300) ? mul(a, 1.0 / L) : Vec3{0, 0, 0};
}

// One station's transported orthonormal frame: tangent T plus the in-plane (u,v)
// basis the profile circle is drawn in. (u,v) is ⟂ T and RMF-transported.
struct Frame {
    Vec3 c;   // centreline point C(t)
    Vec3 t;   // unit tangent T(t)
    Vec3 u;   // in-plane axis 1 (unit, ⟂ t)
    Vec3 v;   // in-plane axis 2 (unit, ⟂ t and ⟂ u)
};

// ---------------------------------------------------------------------------
// Build the closed coiled-tube solid from a stack of already-prepared circular
// section rings (each ring is the profile circle at one station, ordered CCW as
// seen from the +tangent side). Emits two planar end caps + ruled quad side
// bands on a fresh TopologyBuilder and returns the Solid* (non-owning view into
// fac). Returns nullptr (and sets `reason`) on a structural failure.
//
// `tEnd[0]` / `tEnd[1]` are the path tangents at the FIRST / LAST station, used to
// orient the two cap normals (outward == -T(0) at the start cap, +T(end) at the
// end cap). Each section also carries its own centre `centres[k]` so a side
// triangle's outward normal is oriented radially out of the local tube section.
// ---------------------------------------------------------------------------
Solid* assembleTube(SolidFactory& fac,
                    const std::vector<std::vector<Point3>>& rings,
                    const std::vector<Vec3>& centres,
                    const Vec3& tStart, const Vec3& tEnd,
                    const char** reason) {
    TopologyBuilder& tb = fac.builder();
    const std::size_t N = rings.size();

    // One shared vertex per (station, ring-vertex).
    std::vector<std::vector<Vertex*>> Vtx(N);
    for (std::size_t k = 0; k < N; ++k) {
        Vtx[k].resize(rings[k].size());
        for (std::size_t i = 0; i < rings[k].size(); ++i)
            Vtx[k][i] = tb.makeVertex(rings[k][i]);
    }

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // attach a Plane surface to a planar polygon face whose CCW ring (seen along
    // +outwardNormal) is `ringV`; sets `reversed` so normalAt points outward.
    auto attachPlane = [&](Face* f, const std::vector<Vertex*>& ringV,
                           const Vec3& outwardNormal) -> bool {
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        const Vec3 o = V3(ringV[0]->point);
        s->origin = o;
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

    auto addTri = [&](Vertex* a, Vertex* b, Vertex* c, const Vec3& outwardNormal) -> bool {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {a, b, c};
        tb.addOuterLoopToFace(f, ring);
        return attachPlane(f, ring, outwardNormal);
    };

    // --- (1) END CAPS ---------------------------------------------------------
    // FIRST station cap: outward normal points along -tStart. Ring is CCW about
    // +tStart; as seen from outside (the -tStart side) it is CW, so reverse it.
    {
        std::vector<Vertex*> capRing(Vtx[0].rbegin(), Vtx[0].rend());
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, capRing);
        if (!attachPlane(f, capRing, mul(tStart, -1.0))) return nullptr;
    }
    // LAST station cap: outward normal +tEnd; ring already CCW about +tEnd.
    {
        std::vector<Vertex*> capRing = Vtx[N - 1];
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, capRing);
        if (!attachPlane(f, capRing, tEnd)) return nullptr;
    }

    // --- (2) RULED QUAD BANDS between consecutive sections --------------------
    for (std::size_t k = 0; k + 1 < N; ++k) {
        const std::vector<Vertex*>& lo = Vtx[k];
        const std::vector<Vertex*>& hi = Vtx[k + 1];
        const std::size_t n = lo.size();   // equal section vertex counts by construction

        // local band centre (midway between the two section centres) — used to
        // orient each side triangle's normal radially OUT of the tube.
        const Vec3 bandCentre = mul(add(centres[k], centres[k + 1]), 0.5);

        auto outwardFor = [&](Vertex* a, Vertex* b, Vertex* c) -> Vec3 {
            const Vec3 pa = V3(a->point), pb = V3(b->point), pc = V3(c->point);
            Vec3 nrm = cross(sub(pb, pa), sub(pc, pa));
            Vec3 tc = mul(add(add(pa, pb), pc), 1.0 / 3.0);
            Vec3 radial = sub(tc, bandCentre);   // points out of the tube section
            if (dot(nrm, radial) < 0.0) nrm = mul(nrm, -1.0);
            return vnorm(nrm);
        };

        for (std::size_t i = 0; i < n; ++i) {
            const std::size_t j = (i + 1) % n;
            Vertex* a = lo[i]; Vertex* b = lo[j];
            Vertex* c = hi[i]; Vertex* d = hi[j];
            // quad (a,b,d,c); tris (a,b,d) and (a,d,c).
            Vec3 n1 = outwardFor(a, b, d);
            Vec3 n2 = outwardFor(a, d, c);
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
    }

    return solid;
}

} // namespace

// ===========================================================================
// Public: helixArcLength
// ===========================================================================
double helixArcLength(double coilRadius, double pitch, double turns) {
    const double circ = 2.0 * kPi * coilRadius;
    return turns * std::sqrt(circ * circ + pitch * pitch);
}

// ===========================================================================
// Public: helicalSweep
// ===========================================================================
HelicalSweepResult helicalSweep(const HelixSpec& spec) {
    HelicalSweepResult R;

    const double Rc = spec.coilRadius;
    const double p  = spec.pitch;
    const double Nt = spec.turns;
    const double r  = spec.profileRadius;
    const std::size_t segs = std::max<std::size_t>(spec.profileSegments, 3);
    const std::size_t spt  = std::max<std::size_t>(spec.stepsPerTurn, 8);

    if (!(Rc > 0.0)) { R.reason = "coilRadius must be > 0"; return R; }
    if (!(p  > 0.0)) { R.reason = "pitch must be > 0"; return R; }
    if (!(Nt > 0.0)) { R.reason = "turns must be > 0"; return R; }
    if (!(r  > 0.0)) { R.reason = "profileRadius must be > 0"; return R; }
    // non-self-intersecting wire precondition: adjacent coils must clear the wire.
    if (!(p > 2.0 * r)) { R.reason = "pitch must exceed 2*profileRadius (self-intersecting wire)"; return R; }

    // Always carry the Pappus reference (independent of the discretisation).
    R.helixArcLength = helixArcLength(Rc, p, Nt);
    R.pappusVolume   = kPi * r * r * R.helixArcLength;

    // ---- 1) discretise the helix into M segments (M+1 stations) -------------
    const std::size_t M = static_cast<std::size_t>(std::llround(Nt * static_cast<double>(spt)));
    if (M < 2) { R.reason = "too few path stations"; return R; }
    const std::size_t Ns = M + 1;
    const double tMax = 2.0 * kPi * Nt;
    const double sign = spec.leftHanded ? -1.0 : 1.0;

    // helix centreline + analytic unit tangent at parameter t.
    auto helixPoint = [&](double t) -> Vec3 {
        return Vec3{Rc * std::cos(sign * t),
                    Rc * std::sin(sign * t),
                    p * t / (2.0 * kPi)};
    };
    auto helixTangent = [&](double t) -> Vec3 {
        // dC/dt = (-Rc*sign*sin, Rc*sign*cos, p/2π).
        return unit(Vec3{-Rc * sign * std::sin(sign * t),
                          Rc * sign * std::cos(sign * t),
                          p / (2.0 * kPi)});
    };

    // ---- 2) build the per-station rotation-minimising frames ----------------
    std::vector<Frame> frames(Ns);
    // Seed frame at t=0: any unit vector ⟂ T(0).
    {
        Vec3 t0 = helixTangent(0.0);
        Vec3 ref = (std::fabs(t0.z) < 0.9) ? Vec3{0, 0, 1} : Vec3{1, 0, 0};
        Vec3 u0 = unit(cross(ref, t0));
        Vec3 v0 = unit(cross(t0, u0));
        frames[0] = Frame{helixPoint(0.0), t0, u0, v0};
    }
    // Double-reflection RMF (Wang, Jüttler, Zheng, Liu 2008): transport (u,v) from
    // station k to k+1 with two reflections, exactly minimising the rotation.
    for (std::size_t k = 0; k + 1 < Ns; ++k) {
        const double t0 = tMax * static_cast<double>(k)     / static_cast<double>(M);
        const double t1 = tMax * static_cast<double>(k + 1) / static_cast<double>(M);
        const Frame& F0 = frames[k];
        const Vec3 c1 = helixPoint(t1);
        const Vec3 T1 = helixTangent(t1);

        // R1: reflect across the plane bisecting (c1 - c0).
        Vec3 v1 = sub(c1, F0.c);
        double c2 = dot(v1, v1);
        Vec3 uL, tL;
        if (c2 > 1e-300) {
            double s = 2.0 / c2;
            uL = sub(F0.u, mul(v1, s * dot(v1, F0.u)));
            tL = sub(F0.t, mul(v1, s * dot(v1, F0.t)));
        } else { uL = F0.u; tL = F0.t; }
        // R2: reflect across the plane bisecting (T1 - tL).
        Vec3 v2 = sub(T1, tL);
        double c3 = dot(v2, v2);
        Vec3 uFinal;
        if (c3 > 1e-300) {
            double s = 2.0 / c3;
            uFinal = sub(uL, mul(v2, s * dot(v2, uL)));
        } else { uFinal = uL; }
        Vec3 u1 = unit(uFinal);
        Vec3 vv = unit(cross(T1, u1));
        // re-orthogonalise u against T1 to kill any drift.
        u1 = unit(cross(vv, T1));
        frames[k + 1] = Frame{c1, T1, u1, vv};
    }

    // ---- 3) draw the circular profile in each station frame -----------------
    // Ring order CCW about +T: P(theta) = c + r(cosθ u + sinθ v). With u,v,T
    // right-handed (v = T x u), increasing θ winds CCW as seen from +T.
    std::vector<std::vector<Point3>> rings(Ns);
    std::vector<Vec3> centres(Ns);
    for (std::size_t k = 0; k < Ns; ++k) {
        const Frame& F = frames[k];
        centres[k] = F.c;
        rings[k].resize(segs);
        for (std::size_t i = 0; i < segs; ++i) {
            double th = 2.0 * kPi * static_cast<double>(i) / static_cast<double>(segs);
            Vec3 pt = add(F.c, add(mul(F.u, r * std::cos(th)), mul(F.v, r * std::sin(th))));
            rings[k][i] = P3(pt);
        }
    }

    // ---- 4) assemble the closed tube ----------------------------------------
    R.owner = std::make_shared<SolidFactory>();
    Solid* solid = assembleTube(*R.owner, rings, centres,
                                frames[0].t, frames[Ns - 1].t, &R.reason);
    if (solid == nullptr) return R;

    if (!R.owner->builder().isClosedTwoManifold()) {
        R.reason = "helical-swept tube is not a closed 2-manifold (shared-edge wiring failed)";
        return R;
    }

    MassProps mp = massProperties(*solid, 8);
    if (!(mp.volume > 0.0)) {
        R.reason = "helical-swept tube has non-positive volume (inverted shell)";
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

} // namespace brep
} // namespace native
} // namespace forge
