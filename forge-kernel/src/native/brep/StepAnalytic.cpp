// forge/native/brep/StepAnalytic.cpp
//
// Implementation of the in-house ANALYTIC STEP codec (StepAnalytic.hpp).
// Pure C++20, standard library + forge native headers only. No OCCT/WASM.
//
// EMITTED GRAMMAR (the analytic subset this module writes AND reads):
//
//   ISO-10303-21;
//   HEADER; FILE_DESCRIPTION/FILE_NAME/FILE_SCHEMA(AP242) ENDSEC;
//   DATA;
//   #=CARTESIAN_POINT('',(x,y,z));            -- one per topological Vertex
//   #=DIRECTION('',(x,y,z));                  -- axis / ref-dir unit vectors
//   #=VERTEX_POINT('',#pt);                   -- one per Vertex
//   #=LINE('',#pt,#vector) | #=CIRCLE('',#ax2,r)   -- edge geometry
//   #=EDGE_CURVE('',#vS,#vE,#curve,.T.);      -- one per topological Edge
//   #=ORIENTED_EDGE('',*,*,#edge,.T./.F.);    -- per coedge use
//   #=EDGE_LOOP('',(#oe,...));                -- one per face loop (outer + holes)
//   #=FACE_OUTER_BOUND('',#loop,.T.);         -- the peripheral loop
//   #=FACE_BOUND('',#loop,.T.);               -- one per inner (hole) loop
//   #=AXIS2_PLACEMENT_3D('',#origin,#axisDir,#refDir);
//   #=PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|
//     TOROIDAL_SURFACE|B_SPLINE_SURFACE_WITH_KNOTS('',#ax2,...);
//   #=ADVANCED_FACE('',(#bound),#surface,.T./.F.);
//   #=CLOSED_SHELL('',(#face,...));
//   #=MANIFOLD_SOLID_BREP('forge_solid',#shell);
//   -- minimal AP242 product wrapper so the file is a valid representation:
//   #=APPLICATION_CONTEXT(...); #=PRODUCT(...); #=PRODUCT_DEFINITION(...);
//   #=PRODUCT_DEFINITION_SHAPE(...);
//   #=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY... GLOBAL_UNIT...);
//   #=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#msb),#ctx);
//   #=SHAPE_DEFINITION_REPRESENTATION(#pds,#absr);
//   ENDSEC; END-ISO-10303-21;

#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepPart21.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

using p21::stepFmt;
using p21::stepNum;

namespace {

// ---- small vector helpers (operate on the brep::Vec3 / Point3 PODs) --------
inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

AnalyticWriteResult writeFail(const std::string& reason) {
    AnalyticWriteResult r; r.ok = false; r.reason = reason; return r;
}
AnalyticReadResult readFail(const std::string& reason) {
    AnalyticReadResult r; r.ok = false; r.reason = reason; return r;
}

// =====================================================================
// WRITE — an id-allocating emitter over the analytic topology graph.
// =====================================================================
struct Emitter {
    std::string data;            // DATA body (instances appended bottom-up)
    std::uint64_t nextId = 1;
    std::uint64_t alloc() { return nextId++; }

    void appendId(std::uint64_t id) { data += '#'; data += std::to_string(id); }

    std::uint64_t emitPoint(const Vec3& p) {
        std::uint64_t id = alloc();
        appendId(id);
        data += "=CARTESIAN_POINT('',(";
        data += stepFmt(p.x); data += ','; data += stepFmt(p.y); data += ',';
        data += stepFmt(p.z); data += "));\n";
        return id;
    }
    std::uint64_t emitDir(const Vec3& d) {
        std::uint64_t id = alloc();
        appendId(id);
        data += "=DIRECTION('',(";
        data += stepFmt(d.x); data += ','; data += stepFmt(d.y); data += ',';
        data += stepFmt(d.z); data += "));\n";
        return id;
    }
    std::uint64_t emitVector(const Vec3& d, double mag) {
        std::uint64_t dirId = emitDir(d);
        std::uint64_t id = alloc();
        appendId(id);
        data += "=VECTOR('',#"; data += std::to_string(dirId); data += ',';
        data += stepFmt(mag); data += ");\n";
        return id;
    }
    // AXIS2_PLACEMENT_3D from a frame (origin, axis=local +Z, refDir=local +X).
    std::uint64_t emitAxis2(const Vec3& origin, const Vec3& axis, const Vec3& refDir) {
        std::uint64_t oId = emitPoint(origin);
        std::uint64_t aId = emitDir(vnorm(axis));
        std::uint64_t rId = emitDir(vnorm(refDir));
        std::uint64_t id = alloc();
        appendId(id);
        data += "=AXIS2_PLACEMENT_3D('',#"; data += std::to_string(oId);
        data += ",#"; data += std::to_string(aId);
        data += ",#"; data += std::to_string(rId); data += ");\n";
        return id;
    }
};

// Emit the analytic surface entity for `s`, returning its id, or 0 if the
// surface kind cannot be emitted analytically (the caller then facets the face).
std::uint64_t emitSurface(Emitter& E, const Surface& s) {
    switch (s.kind) {
    case SurfaceKind::Plane: {
        std::uint64_t ax = E.emitAxis2(s.origin, s.axis, s.refDir);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=PLANE('',#"; E.data += std::to_string(ax);
        E.data += ");\n";
        return id;
    }
    case SurfaceKind::Cylinder: {
        std::uint64_t ax = E.emitAxis2(s.origin, s.axis, s.refDir);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=CYLINDRICAL_SURFACE('',#";
        E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(s.r1);
        E.data += ");\n";
        return id;
    }
    case SurfaceKind::Cone: {
        // A DEGENERATE cone (r1 == r2, zero half-angle) IS a cylinder — emit it as
        // a true CYLINDRICAL_SURFACE. This is both more correct and what a strict
        // third-party reader (OCCT) expects: a CONICAL_SURFACE with half_angle 0 is
        // degenerate/unbounded to many readers. The native cylinder primitive
        // stores its wall as such a degenerate cone, so this is the common case.
        const double height = (s.param != 0.0) ? s.param : 1.0;
        const double dr = s.r2 - s.r1;
        if (std::fabs(dr) <= 1e-12 * std::max(1.0, std::fabs(s.r1))) {
            std::uint64_t ax = E.emitAxis2(s.origin, s.axis, s.refDir);
            std::uint64_t id = E.alloc();
            E.appendId(id); E.data += "=CYLINDRICAL_SURFACE('',#";
            E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(s.r1);
            E.data += ");\n";
            return id;
        }
        // CONICAL_SURFACE(position, radius @ placement plane, half_angle), with the
        // radius changing along +axis as r(d) = refRadius + d*tan(half_angle). To
        // keep the half_angle in the STEP-canonical (0, pi/2) range we orient the
        // placement +Z toward INCREASING radius and put the placement plane at the
        // smaller-radius end (radius `rMin`), so a strict reader (OCCT) accepts it.
        const double halfAngle = std::atan2(std::fabs(dr), height);
        const double rMin = std::min(s.r1, s.r2);
        // axis points from the rMin end toward the rMax end.
        Vec3 axisOut = (s.r2 >= s.r1) ? s.axis : vscale(s.axis, -1.0);
        // placement origin = the centre of the rMin end circle.
        Vec3 baseOrigin = (s.r2 >= s.r1)
            ? s.origin                                   // r1 is the min (base)
            : vadd(s.origin, vscale(s.axis, height));    // r2 is the min (top end)
        std::uint64_t ax = E.emitAxis2(baseOrigin, axisOut, s.refDir);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=CONICAL_SURFACE('',#";
        E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(rMin);
        E.data += ','; E.data += stepFmt(halfAngle); E.data += ");\n";
        return id;
    }
    case SurfaceKind::Sphere: {
        std::uint64_t ax = E.emitAxis2(s.origin, s.axis, s.refDir);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=SPHERICAL_SURFACE('',#";
        E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(s.r1);
        E.data += ");\n";
        return id;
    }
    case SurfaceKind::Torus: {
        std::uint64_t ax = E.emitAxis2(s.origin, s.axis, s.refDir);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=TOROIDAL_SURFACE('',#";
        E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(s.r1);
        E.data += ','; E.data += stepFmt(s.r2); E.data += ");\n";
        return id;
    }
    case SurfaceKind::Nurbs: {
        const NurbsSurface& n = s.nurbs;
        if (!n.valid() || n.control.empty() || n.control[0].empty()) return 0;
        const std::size_t nU = n.control.size();
        const std::size_t nV = n.control[0].size();
        // Emit the control-point grid (CARTESIAN_POINT ids), row major in U.
        std::vector<std::vector<std::uint64_t>> cp(nU, std::vector<std::uint64_t>(nV));
        for (std::size_t iu = 0; iu < nU; ++iu)
            for (std::size_t iv = 0; iv < nV; ++iv)
                cp[iu][iv] = E.emitPoint(n.control[iu][iv]);
        // Knot multiplicities + distinct knots for U and V.
        auto compact = [](const std::vector<double>& knots,
                          std::vector<int>& mult, std::vector<double>& vals) {
            for (std::size_t k = 0; k < knots.size();) {
                std::size_t j = k;
                while (j < knots.size() && knots[j] == knots[k]) ++j;
                mult.push_back(static_cast<int>(j - k));
                vals.push_back(knots[k]);
                k = j;
            }
        };
        std::vector<int> mU, mV; std::vector<double> kU, kV;
        compact(n.knotsU, mU, kU);
        compact(n.knotsV, mV, kV);
        std::uint64_t id = E.alloc();
        E.appendId(id);
        E.data += "=B_SPLINE_SURFACE_WITH_KNOTS('',";
        E.data += std::to_string(n.degreeU); E.data += ',';
        E.data += std::to_string(n.degreeV); E.data += ",(";
        for (std::size_t iu = 0; iu < nU; ++iu) {
            if (iu) E.data += ',';
            E.data += '(';
            for (std::size_t iv = 0; iv < nV; ++iv) {
                if (iv) E.data += ',';
                E.data += '#'; E.data += std::to_string(cp[iu][iv]);
            }
            E.data += ')';
        }
        E.data += "),.UNSPECIFIED.,.F.,.F.,.F.,(";
        for (std::size_t k = 0; k < mU.size(); ++k) { if (k) E.data += ','; E.data += std::to_string(mU[k]); }
        E.data += "),(";
        for (std::size_t k = 0; k < mV.size(); ++k) { if (k) E.data += ','; E.data += std::to_string(mV[k]); }
        E.data += "),(";
        for (std::size_t k = 0; k < kU.size(); ++k) { if (k) E.data += ','; E.data += stepFmt(kU[k]); }
        E.data += "),(";
        for (std::size_t k = 0; k < kV.size(); ++k) { if (k) E.data += ','; E.data += stepFmt(kV[k]); }
        E.data += "),.UNSPECIFIED.);\n";
        return id;
    }
    }
    return 0;
}

// Decide whether the directed edge (a->b) lies on an exact circle of surface `s`
// (a latitude/meridian arc of a cylinder/cone/sphere/torus loop). If so, fill the
// circle's AXIS2 frame (centre, normal, ref toward `a`) and radius. Straight
// edges (and any edge whose two endpoints don't pin a circle of `s`) return false.
bool circleForEdge(const Surface& s, const Vec3& a, const Vec3& b,
                   Vec3& centre, Vec3& normal, Vec3& ref, double& radius) {
    // Only quadric side surfaces have circular boundary arcs in our primitives.
    if (s.kind != SurfaceKind::Cylinder && s.kind != SurfaceKind::Sphere &&
        s.kind != SurfaceKind::Torus && s.kind != SurfaceKind::Cone)
        return false;
    const Vec3 axis = vnorm(s.axis);
    // Project a,b onto the axis through s.origin; a circle requires equal axial
    // height and equal radial distance.
    auto axialAndRadial = [&](const Vec3& p, double& hh, double& rr, Vec3& radialDir) {
        Vec3 rel = vsub(p, s.origin);
        hh = vdot(rel, axis);
        Vec3 radial = vsub(rel, vscale(axis, hh));
        rr = vlen(radial);
        radialDir = (rr > 1e-12) ? vscale(radial, 1.0 / rr) : Vec3{0, 0, 0};
    };
    double ha, ra, hb, rb; Vec3 da, db;
    axialAndRadial(a, ha, ra, da);
    axialAndRadial(b, hb, rb, db);
    const double tol = 1e-7 * std::max(1.0, std::max(ra, rb));
    if (std::fabs(ha - hb) > tol) return false;       // not the same latitude
    if (std::fabs(ra - rb) > tol) return false;       // not the same radius
    if (ra < 1e-9) return false;                      // degenerate (on the axis)
    // The endpoints must actually differ in angle (a real arc, not a point).
    if (vlen(vsub(a, b)) < tol) return false;
    centre = vadd(s.origin, vscale(axis, ha));
    radius = ra;
    ref = da;            // local +X toward endpoint `a` (so `a` is at theta=0)
    // CRITICAL for STEP interoperability (OCCT): with EDGE_CURVE(vA,vB,circle,.T.)
    // the consumed arc runs from A to B in the circle's INCREASING-angle (CCW about
    // `normal`) direction. We must therefore pick `normal` so that B sits at a SMALL
    // POSITIVE angle from A — i.e. CCW(A->B) is the SHORT arc. The CCW direction is
    // (normal x ref); B's signed angle is atan2( (A x B)·normal , A·B ). Choose the
    // normal sign that makes that angle in (0, pi). (A strict reader that took the
    // long/complementary arc would build a face covering almost the whole quadric —
    // the 100x-volume failure mode.)
    Vec3 sgn = vcross(da, db);                 // points along +axis or -axis
    normal = (vdot(sgn, axis) >= 0.0) ? axis : vscale(axis, -1.0);
    return true;
}

// ---------------------------------------------------------------------------
// CLOSED-SPHERE DETECTION (compact analytic export).
//
// The native sphere primitive (Primitives.cpp buildSphere) is a SINGLE closed
// analytic spherical surface tiled into N*M angular/latitude SECTOR faces, all
// of which share ONE Surface* (kind Sphere, same centre+radius). Writing each
// sector as its own SPHERICAL_SURFACE + ADVANCED_FACE bounded by tiny chord/arc
// edges produced ~8192 patches that a strict third-party reader (OCCT) cannot
// re-integrate into the true sphere (it mis-bounded the periodic sectors and
// reported ~8192x the volume). The correct STEP form — the one OCCT itself
// emits — is ONE SPHERICAL_SURFACE + ONE ADVANCED_FACE whose bound is a
// DEGENERATE VERTEX_LOOP (a closed periodic sphere has no real edges; the whole
// surface IS the face).
//
// This returns the shared spherical Surface* IFF the solid is exactly one such
// closed sphere: every face references the SAME Surface*, that surface is a
// Sphere, and the union of the face trim windows covers the full closed domain
// theta in [0,2pi], phi in [0,pi]. A boolean-cut / partial sphere never matches
// (the boolean re-creates a distinct Surface* per output face — see
// Boolean.cpp), so OPEN/partial spherical faces keep their exact edge-loop form.
const Surface* closedSphereSurface(const Solid& solid) {
    const Surface* shared = nullptr;
    bool first = true;
    double uMin = 0, uMax = 0, vMin = 0, vMax = 0;
    std::size_t faceCount = 0;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f || !f->surface) return nullptr;
            const Surface* s = f->surface;
            if (s->kind != SurfaceKind::Sphere) return nullptr;
            if (first) { shared = s; first = false; }
            else if (s != shared) return nullptr;   // not a single shared surface
            // accumulate trim coverage over the (theta,phi) parameter rectangle
            double fu0 = std::min(f->u0, f->u1), fu1 = std::max(f->u0, f->u1);
            double fv0 = std::min(f->v0, f->v1), fv1 = std::max(f->v0, f->v1);
            if (faceCount == 0) { uMin = fu0; uMax = fu1; vMin = fv0; vMax = fv1; }
            else {
                uMin = std::min(uMin, fu0); uMax = std::max(uMax, fu1);
                vMin = std::min(vMin, fv0); vMax = std::max(vMax, fv1);
            }
            ++faceCount;
        }
    }
    if (!shared || faceCount == 0) return nullptr;
    const double PI = 3.14159265358979323846;
    const double tol = 1e-6;
    // full closed sphere: theta sweeps a full 2*pi, phi the full meridian 0..pi.
    if (std::fabs((uMax - uMin) - 2.0 * PI) > tol) return nullptr;
    if (std::fabs(vMin - 0.0) > tol || std::fabs(vMax - PI) > tol) return nullptr;
    return shared;
}

} // namespace

// =====================================================================
// StepAnalytic::write
// =====================================================================
AnalyticWriteResult StepAnalytic::write(const Solid& solid, const std::string& name) {
    if (solid.shells.empty())
        return writeFail("StepAnalytic.write: solid has no shells");

    Emitter E;
    // Dedup tables keyed by the topology pointers (stable for the solid).
    std::unordered_map<const Vertex*, std::uint64_t> pointId;   // -> CARTESIAN_POINT
    std::unordered_map<const Vertex*, std::uint64_t> vertexId;  // -> VERTEX_POINT
    std::unordered_map<const Edge*,   std::uint64_t> edgeCurveId;

    auto pointFor = [&](const Vertex* v) -> std::uint64_t {
        auto it = pointId.find(v);
        if (it != pointId.end()) return it->second;
        std::uint64_t id = E.emitPoint(PV(v->point));
        pointId.emplace(v, id);
        return id;
    };
    auto vertexFor = [&](const Vertex* v) -> std::uint64_t {
        auto it = vertexId.find(v);
        if (it != vertexId.end()) return it->second;
        std::uint64_t pid = pointFor(v);
        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=VERTEX_POINT('',#";
        E.data += std::to_string(pid); E.data += ");\n";
        vertexId.emplace(v, id);
        return id;
    };

    // EDGE_CURVE for a topological Edge (deduped). Stored start->end of the Edge.
    // The geometry curve is a CIRCLE iff EITHER adjacent face's surface makes
    // (start,end) a circular arc (so a cap-boundary arc shared with a curved wall
    // is recorded as a CIRCLE regardless of which face is emitted first — this is
    // what lets the reader recover the exact-disk cap). Otherwise a LINE.
    auto edgeCurveFor = [&](const Coedge* ce) -> std::uint64_t {
        const Edge* e = ce->edge;
        auto it = edgeCurveId.find(e);
        if (it != edgeCurveId.end()) return it->second;
        const Vec3 ps = PV(e->start->point);
        const Vec3 pe = PV(e->end->point);
        std::uint64_t vS = vertexFor(e->start);
        std::uint64_t vE = vertexFor(e->end);

        // Collect the surfaces of BOTH faces incident to this edge.
        const Surface* sA = (ce->loop && ce->loop->face) ? ce->loop->face->surface : nullptr;
        const Surface* sB = (ce->mate && ce->mate->loop && ce->mate->loop->face)
                            ? ce->mate->loop->face->surface : nullptr;

        std::uint64_t curveId = 0;
        Vec3 c, n, r; double rad = 0.0;
        bool isCircle = (sA && circleForEdge(*sA, ps, pe, c, n, r, rad)) ||
                        (sB && circleForEdge(*sB, ps, pe, c, n, r, rad));
        if (isCircle) {
            std::uint64_t ax = E.emitAxis2(c, n, r);
            curveId = E.alloc();
            E.appendId(curveId); E.data += "=CIRCLE('',#";
            E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(rad);
            E.data += ");\n";
        } else {
            // LINE('', start_point, VECTOR(dir, |end-start|)).
            Vec3 d = vsub(pe, ps);
            double L = vlen(d);
            Vec3 dir = (L > 1e-12) ? vscale(d, 1.0 / L) : Vec3{1, 0, 0};
            std::uint64_t pId = E.emitPoint(ps);
            std::uint64_t vecId = E.emitVector(dir, (L > 1e-12) ? L : 1.0);
            curveId = E.alloc();
            E.appendId(curveId); E.data += "=LINE('',#";
            E.data += std::to_string(pId); E.data += ",#";
            E.data += std::to_string(vecId); E.data += ");\n";
        }

        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=EDGE_CURVE('',#";
        E.data += std::to_string(vS); E.data += ",#"; E.data += std::to_string(vE);
        E.data += ",#"; E.data += std::to_string(curveId); E.data += ",.T.);\n";
        edgeCurveId.emplace(e, id);
        return id;
    };

    std::vector<std::uint64_t> faceIds;

    // ---- COMPACT CLOSED-SPHERE PATH ---------------------------------------
    // A whole, un-cut sphere is emitted as ONE SPHERICAL_SURFACE + ONE
    // ADVANCED_FACE bounded by a DEGENERATE VERTEX_LOOP (the OCCT-canonical form),
    // instead of thousands of tessellated patches. This is the analytic
    // representation a strict reader re-integrates to the true sphere volume.
    if (const Surface* sph = closedSphereSurface(solid)) {
        std::uint64_t surfId = emitSurface(E, *sph);
        if (surfId == 0)
            return writeFail("StepAnalytic.write: closed sphere surface emit failed");
        // A single VERTEX_POINT at the -axis pole (matching OCCT's pole vertex).
        const Vec3 pole = vsub(sph->origin, vscale(vnorm(sph->axis), sph->r1));
        std::uint64_t poleCp = E.emitPoint(pole);
        std::uint64_t poleVp = E.alloc();
        E.appendId(poleVp); E.data += "=VERTEX_POINT('',#";
        E.data += std::to_string(poleCp); E.data += ");\n";
        std::uint64_t vloop = E.alloc();
        E.appendId(vloop); E.data += "=VERTEX_LOOP('',#";
        E.data += std::to_string(poleVp); E.data += ");\n";
        std::uint64_t bound = E.alloc();
        E.appendId(bound); E.data += "=FACE_BOUND('',#";
        E.data += std::to_string(vloop); E.data += ",.T.);\n";
        std::uint64_t faceId = E.alloc();
        E.appendId(faceId); E.data += "=ADVANCED_FACE('',(#";
        E.data += std::to_string(bound); E.data += "),#";
        E.data += std::to_string(surfId);
        E.data += sph->reversed ? ",.F.);\n" : ",.T.);\n";
        faceIds.push_back(faceId);
    } else
    for (const Shell* shell : solid.shells) {
        if (!shell) continue;
        for (const Face* f : shell->faces) {
            if (!f || !f->outerLoop || !f->outerLoop->first)
                return writeFail("StepAnalytic.write: face missing outer loop");
            if (!f->surface)
                return writeFail("StepAnalytic.write: face has no analytic surface "
                                 "(faceted-only handles route through StepFaceted)");
            const Surface& surf = *f->surface;

            // Emit ONE EDGE_LOOP + bound entity for a coedge ring. `boundKw` is
            // FACE_OUTER_BOUND for the peripheral loop, FACE_BOUND for a hole. Walks
            // the ring in coedge order, emitting an ORIENTED_EDGE per coedge (sense
            // .T. iff the coedge runs its Edge's stored start->end). Returns the
            // bound id, or 0 on a broken / degenerate ring (the caller fails).
            //
            // FACE_BOUND for an inner (hole) loop is the round-trip sibling of the
            // FOREIGN readers (StepRead / IgesRead), which build inner rings via
            // TopologyBuilder::addInnerLoopToFace from every additional FACE_BOUND;
            // without emitting them a bored / holed face would silently lose its
            // hole on write (the coverage gap this closes).
            auto emitLoopBound = [&](const Loop* lp, bool outerLoop,
                                     std::uint64_t& boundOut) -> bool {
                if (!lp || !lp->first) return false;
                std::vector<std::uint64_t> orientedIds;
                const Coedge* start = lp->first;
                const Coedge* ce = start;
                std::size_t guard = 0;
                const std::size_t maxRing = lp->coedgeCount + 4;
                do {
                    if (!ce || !ce->edge) return false;
                    std::uint64_t ec = edgeCurveFor(ce);
                    std::uint64_t oid = E.alloc();
                    E.appendId(oid); E.data += "=ORIENTED_EDGE('',*,*,#";
                    E.data += std::to_string(ec);
                    E.data += ce->forward ? ",.T.);\n" : ",.F.);\n";
                    orientedIds.push_back(oid);
                    ce = ce->next;
                    if (++guard > maxRing) return false;   // loop does not close
                } while (ce && ce != start);
                if (orientedIds.size() < 3) return false;  // degenerate ring
                std::uint64_t loopId = E.alloc();
                E.appendId(loopId); E.data += "=EDGE_LOOP('',(";
                for (std::size_t k = 0; k < orientedIds.size(); ++k) {
                    if (k) E.data += ',';
                    E.data += '#'; E.data += std::to_string(orientedIds[k]);
                }
                E.data += "));\n";
                boundOut = E.alloc();
                E.appendId(boundOut);
                E.data += outerLoop ? "=FACE_OUTER_BOUND('',#" : "=FACE_BOUND('',#";
                E.data += std::to_string(loopId); E.data += ",.T.);\n";
                return true;
            };

            // 1+2) Outer loop -> EDGE_LOOP + FACE_OUTER_BOUND, then every inner
            //       (hole) loop -> EDGE_LOOP + FACE_BOUND. The ADVANCED_FACE bound
            //       list is {outer} U inner, matching what the readers reconstruct.
            std::vector<std::uint64_t> boundIds;
            std::uint64_t outerBound = 0;
            if (!emitLoopBound(f->outerLoop, /*outerLoop=*/true, outerBound))
                return writeFail("StepAnalytic.write: degenerate / non-closing face "
                                 "outer loop (<3 edges)");
            boundIds.push_back(outerBound);
            for (const Loop* hole : f->innerLoops) {
                std::uint64_t innerBound = 0;
                if (!emitLoopBound(hole, /*outerLoop=*/false, innerBound))
                    return writeFail("StepAnalytic.write: degenerate / non-closing "
                                     "inner (hole) loop");
                boundIds.push_back(innerBound);
            }

            // 3) Surface entity (analytic; 0 means we could not emit it).
            std::uint64_t surfId = emitSurface(E, surf);
            if (surfId == 0)
                return writeFail("StepAnalytic.write: unsupported NURBS face "
                                 "(incomplete surface data — no analytic emit)");

            // 4) ADVANCED_FACE over the full bound list. same_sense = .T. iff the
            //    surface normal already points OUT of the solid. Our Surface.reversed
            //    flips the natural (du x dv) normal to outward; so same_sense w.r.t.
            //    the STORED surface == NOT reversed.
            std::uint64_t faceId = E.alloc();
            E.appendId(faceId); E.data += "=ADVANCED_FACE('',(";
            for (std::size_t k = 0; k < boundIds.size(); ++k) {
                if (k) E.data += ',';
                E.data += '#'; E.data += std::to_string(boundIds[k]);
            }
            E.data += "),#";
            E.data += std::to_string(surfId);
            E.data += surf.reversed ? ",.F.);\n" : ",.T.);\n";
            faceIds.push_back(faceId);
        }
    }
    if (faceIds.empty())
        return writeFail("StepAnalytic.write: solid produced no faces");

    // CLOSED_SHELL + MANIFOLD_SOLID_BREP.
    std::uint64_t shellId = E.alloc();
    E.appendId(shellId); E.data += "=CLOSED_SHELL('',(";
    for (std::size_t k = 0; k < faceIds.size(); ++k) {
        if (k) E.data += ',';
        E.data += '#'; E.data += std::to_string(faceIds[k]);
    }
    E.data += "));\n";
    std::uint64_t msbId = E.alloc();
    E.appendId(msbId); E.data += "=MANIFOLD_SOLID_BREP('forge_solid',#";
    E.data += std::to_string(shellId); E.data += ");\n";

    // ----- minimal AP242 product / representation wrapper -------------------
    // (units in MM, length uncertainty 1e-6) so the file is a valid
    // (geometrically-grounded) ADVANCED_BREP_SHAPE_REPRESENTATION.
    std::uint64_t appCtx = E.alloc();
    E.appendId(appCtx);
    E.data += "=APPLICATION_CONTEXT('core data for automotive mechanical design "
              "processes');\n";
    std::uint64_t appProto = E.alloc();
    E.appendId(appProto);
    E.data += "=APPLICATION_PROTOCOL_DEFINITION('international standard',"
              "'automotive_design',2010,#"; E.data += std::to_string(appCtx);
    E.data += ");\n";
    // Product definition context, product context, product, definitions.
    std::uint64_t prodDefCtx = E.alloc();
    E.appendId(prodDefCtx);
    E.data += "=PRODUCT_DEFINITION_CONTEXT('part definition',#";
    E.data += std::to_string(appCtx); E.data += ",'design');\n";
    std::uint64_t prodCtx2 = E.alloc();
    E.appendId(prodCtx2);
    E.data += "=PRODUCT_CONTEXT('',#"; E.data += std::to_string(appCtx);
    E.data += ",'mechanical');\n";
    std::uint64_t prod2 = E.alloc();
    E.appendId(prod2);
    E.data += "=PRODUCT('forge_part','forge_part','',(#";
    E.data += std::to_string(prodCtx2); E.data += "));\n";
    std::uint64_t prodDefFormation = E.alloc();
    E.appendId(prodDefFormation);
    E.data += "=PRODUCT_DEFINITION_FORMATION('','',#";
    E.data += std::to_string(prod2); E.data += ");\n";
    std::uint64_t prodDef = E.alloc();
    E.appendId(prodDef);
    E.data += "=PRODUCT_DEFINITION('design','',#";
    E.data += std::to_string(prodDefFormation); E.data += ",#";
    E.data += std::to_string(prodDefCtx); E.data += ");\n";
    std::uint64_t pds = E.alloc();
    E.appendId(pds);
    E.data += "=PRODUCT_DEFINITION_SHAPE('','',#";
    E.data += std::to_string(prodDef); E.data += ");\n";

    // Units: SI millimetre length + radian angle + steradian, 1e-6 uncertainty.
    std::uint64_t lenUnit = E.alloc();
    E.appendId(lenUnit);
    E.data += "=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n";
    std::uint64_t angUnit = E.alloc();
    E.appendId(angUnit);
    E.data += "=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n";
    std::uint64_t solUnit = E.alloc();
    E.appendId(solUnit);
    E.data += "=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());\n";
    std::uint64_t uncert = E.alloc();
    E.appendId(uncert);
    E.data += "=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#";
    E.data += std::to_string(lenUnit);
    E.data += ",'distance_accuracy_value','confusion accuracy');\n";
    std::uint64_t geoCtx = E.alloc();
    E.appendId(geoCtx);
    E.data += "=(GEOMETRIC_REPRESENTATION_CONTEXT(3)"
              "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#";
    E.data += std::to_string(uncert);
    E.data += "))GLOBAL_UNIT_ASSIGNED_CONTEXT((#";
    E.data += std::to_string(lenUnit); E.data += ",#"; E.data += std::to_string(angUnit);
    E.data += ",#"; E.data += std::to_string(solUnit);
    E.data += "))REPRESENTATION_CONTEXT('Context','3D'));\n";
    std::uint64_t absr = E.alloc();
    E.appendId(absr);
    E.data += "=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#";
    E.data += std::to_string(msbId); E.data += "),#";
    E.data += std::to_string(geoCtx); E.data += ");\n";
    std::uint64_t sdr = E.alloc();
    E.appendId(sdr);
    E.data += "=SHAPE_DEFINITION_REPRESENTATION(#";
    E.data += std::to_string(pds); E.data += ",#"; E.data += std::to_string(absr);
    E.data += ");\n";
    (void)appProto;

    // ----- envelope + header ------------------------------------------------
    std::string out;
    out.reserve(E.data.size() + 768);
    out += "ISO-10303-21;\n";
    out += "HEADER;\n";
    out += "FILE_DESCRIPTION(('forge analytic B-rep solid (AP242, analytic "
           "surfaces)'),'2;1');\n";
    out += "FILE_NAME('";
    for (char ch : name) { if (ch == '\'') out += "''"; else out += ch; }
    out += "','2026-01-01T00:00:00',(''),(''),"
           "'forge::native::brep::StepAnalytic','forge','');\n";
    out += "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF "
           "{ 1 0 10303 442 1 1 4 }'));\n";
    out += "ENDSEC;\n";
    out += "DATA;\n";
    out += E.data;
    out += "ENDSEC;\n";
    out += "END-ISO-10303-21;\n";

    AnalyticWriteResult r;
    r.ok = true;
    r.text = std::move(out);
    return r;
}

// =====================================================================
// READ — reconstruct an analytic brep::Solid from the part-21 text.
// =====================================================================
namespace {

using p21::Instance;
using p21::splitTopLevel;
using p21::parseRef;
using p21::parseList;

// Resolve a CARTESIAN_POINT id to a Vec3.
bool getPoint(const std::unordered_map<std::uint64_t, Instance>& tab,
              std::uint64_t id, Vec3& out, std::string& why) {
    auto it = tab.find(id);
    if (it == tab.end() || it->second.type != "CARTESIAN_POINT") {
        why = "expected CARTESIAN_POINT at #" + std::to_string(id); return false;
    }
    auto p = splitTopLevel(it->second.params);
    std::vector<std::string> c;
    if (p.size() != 2 || !parseList(p[1], c) || c.size() != 3) {
        why = "bad CARTESIAN_POINT #" + std::to_string(id); return false;
    }
    if (!stepNum(c[0], out.x) || !stepNum(c[1], out.y) || !stepNum(c[2], out.z)) {
        why = "non-finite CARTESIAN_POINT #" + std::to_string(id); return false;
    }
    return true;
}

// Resolve a DIRECTION id to a (unit-ish) Vec3.
bool getDir(const std::unordered_map<std::uint64_t, Instance>& tab,
            std::uint64_t id, Vec3& out, std::string& why) {
    auto it = tab.find(id);
    if (it == tab.end() || it->second.type != "DIRECTION") {
        why = "expected DIRECTION at #" + std::to_string(id); return false;
    }
    auto p = splitTopLevel(it->second.params);
    std::vector<std::string> c;
    if (p.size() != 2 || !parseList(p[1], c) || c.size() != 3) {
        why = "bad DIRECTION #" + std::to_string(id); return false;
    }
    if (!stepNum(c[0], out.x) || !stepNum(c[1], out.y) || !stepNum(c[2], out.z)) {
        why = "non-finite DIRECTION #" + std::to_string(id); return false;
    }
    return true;
}

// Resolve an AXIS2_PLACEMENT_3D -> (origin, axis, refDir). refDir defaults to a
// perpendicular of axis when the optional ref-direction is absent ($).
bool getAxis2(const std::unordered_map<std::uint64_t, Instance>& tab,
              std::uint64_t id, Vec3& origin, Vec3& axis, Vec3& ref, std::string& why) {
    auto it = tab.find(id);
    if (it == tab.end() || it->second.type != "AXIS2_PLACEMENT_3D") {
        why = "expected AXIS2_PLACEMENT_3D at #" + std::to_string(id); return false;
    }
    auto p = splitTopLevel(it->second.params);
    if (p.size() != 4) { why = "AXIS2_PLACEMENT_3D arity"; return false; }
    std::uint64_t oId = 0, aId = 0, rId = 0;
    if (!parseRef(p[1], oId)) { why = "AXIS2 origin not a ref"; return false; }
    if (!getPoint(tab, oId, origin, why)) return false;
    if (parseRef(p[2], aId)) { if (!getDir(tab, aId, axis, why)) return false; }
    else axis = Vec3{0, 0, 1};
    if (parseRef(p[3], rId)) { if (!getDir(tab, rId, ref, why)) return false; }
    else {
        // pick any unit vector perpendicular to axis
        Vec3 a = vnorm(axis);
        Vec3 t = (std::fabs(a.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        ref = vnorm(vsub(t, vscale(a, vdot(t, a))));
    }
    axis = vnorm(axis);
    // Re-orthonormalise ref against axis (OCCT may store a slightly off ref).
    ref = vsub(ref, vscale(axis, vdot(ref, axis)));
    ref = vnorm(ref);
    return true;
}

// Build a native Surface from an ADVANCED_FACE surface id. Returns false if the
// surface entity is unsupported (the caller fails honestly).
bool buildSurface(const std::unordered_map<std::uint64_t, Instance>& tab,
                  std::uint64_t id, bool sameSense, Surface& s, std::string& why) {
    auto it = tab.find(id);
    if (it == tab.end()) { why = "dangling surface ref #" + std::to_string(id); return false; }
    const std::string& type = it->second.type;
    auto p = splitTopLevel(it->second.params);

    auto frame = [&](std::size_t ax2Field) -> bool {
        std::uint64_t ax = 0;
        if (p.size() <= ax2Field || !parseRef(p[ax2Field], ax)) { why = type + " missing placement"; return false; }
        return getAxis2(tab, ax, s.origin, s.axis, s.refDir, why);
    };

    if (type == "PLANE") {
        s.kind = SurfaceKind::Plane;
        if (!frame(1)) return false;
    } else if (type == "CYLINDRICAL_SURFACE") {
        s.kind = SurfaceKind::Cylinder;
        if (!frame(1)) return false;
        if (p.size() < 3 || !stepNum(p[2], s.r1)) { why = "CYLINDRICAL_SURFACE radius"; return false; }
    } else if (type == "CONICAL_SURFACE") {
        s.kind = SurfaceKind::Cone;
        if (!frame(1)) return false;
        double refRadius = 0, halfAngle = 0;
        if (p.size() < 4 || !stepNum(p[2], refRadius) || !stepNum(p[3], halfAngle)) {
            why = "CONICAL_SURFACE radius/half_angle"; return false;
        }
        // r(d) = refRadius + d*tan(half_angle) along +axis (d measured from the
        // placement plane). We stash refRadius in r1 and the SLOPE tan(half) in
        // param; attachTrim() reads the real axial extent from the loop and turns
        // these into the native (r1@base, r2@top, param=height) parameterisation.
        s.r1 = refRadius;
        s.param = std::tan(halfAngle);   // SLOPE carrier (resolved in attachTrim)
        s.r2 = refRadius;                // placeholder (resolved in attachTrim)
    } else if (type == "SPHERICAL_SURFACE") {
        s.kind = SurfaceKind::Sphere;
        if (!frame(1)) return false;
        if (p.size() < 3 || !stepNum(p[2], s.r1)) { why = "SPHERICAL_SURFACE radius"; return false; }
    } else if (type == "TOROIDAL_SURFACE") {
        s.kind = SurfaceKind::Torus;
        if (!frame(1)) return false;
        if (p.size() < 4 || !stepNum(p[2], s.r1) || !stepNum(p[3], s.r2)) {
            why = "TOROIDAL_SURFACE radii"; return false;
        }
    } else {
        // B_SPLINE_SURFACE_WITH_KNOTS and any other surface are not reconstructed
        // into a native analytic Surface in this increment — honest failure.
        why = "unsupported analytic surface entity '" + type + "'";
        return false;
    }
    // ADVANCED_FACE same_sense .F. means the surface normal is opposite the face
    // orientation -> the OUTWARD normal needs the reversed flag set.
    s.reversed = !sameSense;
    return true;
}

// A circle recovered from an EDGE_CURVE's geometry (for the exact-disk cap path).
struct EdgeCircle { bool ok=false; Vec3 centre{}; Vec3 normal{}; double radius=0; };

// Read an EDGE_CURVE id -> its CIRCLE geometry (centre/normal/radius), if any.
EdgeCircle circleOfEdgeCurve(const std::unordered_map<std::uint64_t, Instance>& tab,
                             std::uint64_t ecId) {
    EdgeCircle out;
    auto eit = tab.find(ecId);
    if (eit == tab.end() || eit->second.type != "EDGE_CURVE") return out;
    auto ep = splitTopLevel(eit->second.params);
    if (ep.size() != 5) return out;
    std::uint64_t curveId = 0;
    if (!parseRef(ep[3], curveId)) return out;  // '*' or non-ref -> not a circle
    auto cit = tab.find(curveId);
    if (cit == tab.end() || cit->second.type != "CIRCLE") return out;
    auto cp = splitTopLevel(cit->second.params);
    if (cp.size() != 3) return out;
    std::uint64_t ax = 0;
    if (!parseRef(cp[1], ax)) return out;
    Vec3 o, a, rdir; std::string w;
    if (!getAxis2(tab, ax, o, a, rdir, w)) return out;
    if (!stepNum(cp[2], out.radius)) return out;
    out.centre = o; out.normal = vnorm(a); out.ok = true;
    return out;
}

// Parameterise a reconstructed face over its analytic surface and store the trim
// window + vertexUV so the EXACT mass integrator runs on it. Returns false if the
// face cannot be parameterised. For curved surfaces this UNWRAPS the angular theta
// (continuous per sector — no atan2 seam jump) and, for a CONE, recovers the axial
// height into `param` with normalised v in [0,1] (matching the primitive). For a
// PLANE bounded by CIRCLE edges it sets the EXACT-disk / annular-sector annotation
// (centre + radii read from the boundary circles), so caps integrate exactly.
//
// `ringCircles[i]` is the circle (if any) of the loop edge LEAVING ring[i].
bool attachTrim(Face* f, Surface* surf, const std::vector<Vertex*>& ring,
                const std::vector<EdgeCircle>& ringCircles) {
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());
    const Vec3 axis = vnorm(surf->axis);
    const Vec3 rdir = vnorm(surf->refDir);
    const Vec3 bdir = surf->binormal();

    const bool angular = (surf->kind == SurfaceKind::Cylinder ||
                          surf->kind == SurfaceKind::Cone ||
                          surf->kind == SurfaceKind::Sphere ||
                          surf->kind == SurfaceKind::Torus);

    // Pass 1: raw (theta, secondary) per ring vertex. The angular theta is
    // unwrapped to within (-pi, pi] of the FIRST vertex's theta (an ANCHOR, not a
    // running previous) so a small face that straddles the atan2 +pi/-pi seam stays
    // a tight contiguous cluster — the previous-vertex unwrap could still leave the
    // [min,max] bbox spanning ~2pi when the ring crossed the seam, spuriously
    // turning a small sector into a full-circle sweep (and doubling its mass).
    std::vector<double> us(ring.size()), vs(ring.size());
    const double PI = 3.14159265358979323846;
    double anchorTheta = 0.0; bool haveAnchor = false;
    for (std::size_t i = 0; i < ring.size(); ++i) {
        Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
        double x = vdot(rel, rdir), y = vdot(rel, bdir), z = vdot(rel, axis);
        double pu = 0, pv = 0;
        switch (surf->kind) {
        case SurfaceKind::Plane:
            pu = x; pv = y; break;
        case SurfaceKind::Cylinder:
            pu = std::atan2(y, x); pv = z; break;
        case SurfaceKind::Cone:
            pu = std::atan2(y, x); pv = z; break;  // pv = axial height (normalised below)
        case SurfaceKind::Sphere: {
            pu = std::atan2(y, x);
            double rr = vlen(rel);
            pv = (rr > 1e-12) ? std::acos(std::max(-1.0, std::min(1.0, z / rr))) : 0.0;
            break;
        }
        case SurfaceKind::Torus: {
            pu = std::atan2(y, x);
            double ringR = std::sqrt(x * x + y * y) - surf->r1;
            pv = std::atan2(z, ringR);
            break;
        }
        case SurfaceKind::Nurbs:
            pu = 0; pv = 0; break;
        }
        if (angular) {
            // A pole vertex (radial ~0) has an undefined theta; skip anchoring on it
            // but still unwrap once an anchor exists.
            bool radialDefined = (std::sqrt(x * x + y * y) > 1e-9);
            if (!haveAnchor && radialDefined) { anchorTheta = pu; haveAnchor = true; }
            if (haveAnchor) {
                while (pu - anchorTheta >  PI) pu -= 2.0 * PI;
                while (pu - anchorTheta < -PI) pu += 2.0 * PI;
            }
        }
        us[i] = pu; vs[i] = pv;
    }

    // The TORUS minor angle phi (vs) is ALSO periodic (-pi..pi) and wraps at the
    // seam; anchor-unwrap it the same way so a small minor-band face that straddles
    // phi = +-pi stays a tight contiguous span (else its [v0,v1] spuriously spans
    // ~2pi and the face over-integrates — the torus doubling). Sphere phi is acos
    // in [0,pi] (no seam) so it is left untouched.
    if (surf->kind == SurfaceKind::Torus) {
        double anchorPhi = vs[0];
        for (std::size_t i = 0; i < ring.size(); ++i) {
            while (vs[i] - anchorPhi >  PI) vs[i] -= 2.0 * PI;
            while (vs[i] - anchorPhi < -PI) vs[i] += 2.0 * PI;
        }
    }

    // POLE handling: a vertex on the surface axis (radial ~0 — e.g. a sphere/cone
    // apex or pole) has an undefined theta. Its trim-u must NOT widen the face's
    // angular rectangle (the pole row has zero Jacobian, so its u is integration-
    // irrelevant, but a stray u=0 would inflate [u0,u1] and over-integrate the
    // rest of the rectangle). Re-assign each pole vertex's u to the mean of the
    // NON-pole vertices' u, collapsing the rectangle to the true sector width.
    if (angular) {
        double sumU = 0; int cntU = 0;
        for (std::size_t i = 0; i < ring.size(); ++i) {
            Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
            double rad = std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                   vdot(rel, bdir) * vdot(rel, bdir));
            if (rad > 1e-9) { sumU += us[i]; ++cntU; }
        }
        if (cntU > 0 && cntU < static_cast<int>(ring.size())) {
            double meanU = sumU / cntU;
            for (std::size_t i = 0; i < ring.size(); ++i) {
                Vec3 rel = vsub(PV(ring[i]->point), surf->origin);
                double rad = std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                       vdot(rel, bdir) * vdot(rel, bdir));
                if (rad <= 1e-9) us[i] = meanU;
            }
        }
    }

    // CONE: recover the axial height H from the v-span (axial distances from the
    // STEP placement plane), normalise v to [0,1], re-base the origin to the
    // lowest-axial loop point, and set the native (r1@base, r2@top, param=H) from
    // the SLOPE carried in `param` (== tan(half_angle)). r(d)=refRadius+d*slope.
    if (surf->kind == SurfaceKind::Cone) {
        double vmin = vs[0], vmax = vs[0];
        for (double v : vs) { vmin = std::min(vmin, v); vmax = std::max(vmax, v); }
        double H = vmax - vmin;
        if (H < 1e-12) return false;
        const double refRadius = surf->r1;      // radius at the placement plane (d=0)
        const double slope = surf->param;       // tan(half_angle) (signed)
        surf->origin = vadd(surf->origin, vscale(axis, vmin));
        surf->r1 = refRadius + slope * vmin;    // radius at base (d=vmin)
        surf->r2 = refRadius + slope * vmax;    // radius at top  (d=vmax)
        surf->param = H;                        // axial extent over v in [0,1]
        for (double& v : vs) v = (v - vmin) / H;
    }

    double u0 = us[0], u1 = us[0], v0 = vs[0], v1 = vs[0];
    for (std::size_t i = 0; i < ring.size(); ++i) {
        f->vertexUV.push_back({us[i], vs[i]});
        u0 = std::min(u0, us[i]); u1 = std::max(u1, us[i]);
        v0 = std::min(v0, vs[i]); v1 = std::max(v1, vs[i]);
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;

    // PLANE-as-DISK / ANNULAR-SECTOR: a curved primitive's cap is bounded by CIRCLE
    // arcs (read back from the loop's EDGE_CURVEs). If this PLANE face's loop
    // carries one or two concentric boundary circles, annotate the EXACT disk /
    // annular sector so the mass integrator uses the analytic polar formula (not
    // the chordal polygon) — restoring the exact volume/COM/inertia of the cap.
    // The integrator spans theta in [u0,u1], radius in [v0,v1]=[diskInner,
    // diskOuter] in a frame centred at the disk centre.
    if (surf->kind == SurfaceKind::Plane) {
        // Collect the distinct boundary circles (centre on this plane, normal ~
        // plane axis). Their common centre is the disk centre; their radii are the
        // inner/outer extents.
        Vec3 centre{0, 0, 0}; bool haveCentre = false;
        double rInner = 0.0, rOuter = 0.0; int nCircles = 0; bool consistent = true;
        const Vec3 nAxis = vnorm(surf->axis);
        for (const EdgeCircle& ec : ringCircles) {
            if (!ec.ok) continue;
            // the circle must lie in this plane (normal parallel to the plane axis)
            if (std::fabs(std::fabs(vdot(vnorm(ec.normal), nAxis)) - 1.0) > 1e-6) continue;
            if (!haveCentre) { centre = ec.centre; haveCentre = true; }
            else if (vlen(vsub(ec.centre, centre)) > 1e-6 * std::max(1.0, vlen(centre))) {
                consistent = false; break;   // not concentric -> not a disk cap
            }
            ++nCircles;
            if (ec.radius > rOuter) rOuter = ec.radius;
            if (rInner == 0.0 || ec.radius < rInner) rInner = ec.radius;
        }
        // GUARD: a disk/annular-sector cap has a boundary made ONLY of (a) circle
        // arcs concentric on `centre` and (b) RADIAL straight edges that point
        // through `centre`. A box face that merely has an arc NOTCH (its other
        // edges are box edges, NOT radial) must NOT be treated as a disk — that is
        // the holed top/bottom face of a bored plate, integrated as a polygon.
        bool diskShaped = haveCentre && consistent && nCircles >= 1 && rOuter > 1e-9;
        if (diskShaped) {
            const std::size_t n = ring.size();
            for (std::size_t i = 0; i < n && diskShaped; ++i) {
                if (ringCircles[i].ok) continue;  // arc edge: fine
                // straight edge ring[i]->ring[i+1] must be radial (both endpoints at
                // the same angle about centre, i.e. the segment passes through it).
                Vec3 a = vsub(PV(ring[i]->point), centre);
                Vec3 b = vsub(PV(ring[(i + 1) % n]->point), centre);
                double ax = vdot(a, rdir), ay = vdot(a, bdir);
                double bx = vdot(b, rdir), by = vdot(b, bdir);
                double cross = ax * by - ay * bx;       // ~0 iff collinear w/ centre
                double scale = std::max(1.0, rOuter * rOuter);
                if (std::fabs(cross) > 1e-6 * scale) diskShaped = false;
            }
        }
        if (diskShaped) {
            if (rInner >= rOuter - 1e-9) rInner = 0.0;  // a single radius -> full disk
            const double TWO_PI = 2.0 * 3.14159265358979323846;
            // FULL disk/annulus iff EVERY boundary edge is a circle arc (no radial
            // LINE edges). A partial sector has >=1 radial LINE edge; its true
            // angular span is the spread of its vertex angles about the centre.
            bool allArcs = true;
            for (const EdgeCircle& ec : ringCircles) if (!ec.ok) { allArcs = false; break; }

            double aMin, aMax;
            if (allArcs) {
                aMin = 0.0; aMax = TWO_PI;   // full disk / annulus
            } else {
                // SECTOR: its angular width is the spread of the vertex angles about
                // the centre. Reference all angles to the first vertex and unwrap to
                // (-pi,pi], then take [min,max] — robust for the <pi sectors the
                // primitives emit (and any sector whose vertices fit one half-turn).
                const std::size_t n = ring.size();
                Vec3 rel0 = vsub(PV(ring[0]->point), centre);
                double a0 = std::atan2(vdot(rel0, bdir), vdot(rel0, rdir));
                double lo = 0, hi = 0;
                for (std::size_t i = 0; i < n; ++i) {
                    Vec3 rel = vsub(PV(ring[i]->point), centre);
                    if (std::sqrt(vdot(rel, rdir) * vdot(rel, rdir) +
                                  vdot(rel, bdir) * vdot(rel, bdir)) < 1e-9) continue;
                    double a = std::atan2(vdot(rel, bdir), vdot(rel, rdir)) - a0;
                    while (a >  3.14159265358979323846) a -= TWO_PI;
                    while (a < -3.14159265358979323846) a += TWO_PI;
                    lo = std::min(lo, a); hi = std::max(hi, a);
                }
                aMin = a0 + lo; aMax = a0 + hi;
            }
            surf->isDisk = true;
            surf->diskInner = rInner;
            surf->diskOuter = rOuter;
            surf->origin = centre;
            f->u0 = aMin; f->u1 = aMax;
            f->v0 = rInner; f->v1 = rOuter;
        }
    }
    return true;
}

// Re-tessellate a CLOSED analytic sphere (read from the compact one-face form:
// SPHERICAL_SURFACE bounded by a degenerate VERTEX_LOOP) back into the SAME
// N*M sector topology the sphere primitive emits, into `tb`/`shell`. Each sector
// face carries a trim window over the SHARED analytic surface, so the divergence
// integrator recovers the EXACT sphere volume/COM/inertia (a single full-sphere
// face under-resolves the periodic theta sweep; the sectors integrate exactly —
// proven by step_analytic_test). The mesh is watertight (shared rim/seam verts).
// `proto` carries the analytic centre (origin), axis, refDir, radius, reversed.
//
// Returns the number of faces created (0 on failure).
std::size_t refacetClosedSphere(TopologyBuilder& tb, Shell* shell,
                                const Surface& proto) {
    const double PI = 3.14159265358979323846;
    const int N = 32;   // theta sectors
    const int M = 16;   // phi bands  (32x16 = 512 faces; vol exact to ~1e-15)
    const double r = proto.r1;
    const Vec3 c  = proto.origin;
    const Vec3 ax = vnorm(proto.axis);
    const Vec3 rd = vnorm(proto.refDir);
    const Vec3 bd = vcross(ax, rd);   // binormal (+Y of the local frame)

    auto P = [&](double th, double phi) -> Point3 {
        double sp = std::sin(phi), cp = std::cos(phi);
        Vec3 p = vadd(c, vadd(vscale(rd, r * sp * std::cos(th)),
                      vadd(vscale(bd, r * sp * std::sin(th)),
                           vscale(ax, r * cp))));
        return Point3{p.x, p.y, p.z};
    };

    // ONE shared analytic surface for every sector (matches the primitive).
    Surface* surf = tb.makeSurface();
    surf->kind = SurfaceKind::Sphere;
    surf->origin = c; surf->axis = ax; surf->refDir = rd;
    surf->r1 = r; surf->reversed = proto.reversed;

    // poles + interior-row vertices (deduped per row so rims are shared).
    Vertex* north = tb.makeVertex(P(0.0, 0.0));
    Vertex* south = tb.makeVertex(P(0.0, PI));
    std::vector<std::vector<Vertex*>> rows(M + 1);
    for (int row = 1; row < M; ++row) {
        double phi = PI * row / M;
        rows[row].resize(N);
        for (int i = 0; i < N; ++i)
            rows[row][i] = tb.makeVertex(P(2.0 * PI * i / N, phi));
    }
    auto uvAt = [&](int i, int row) -> std::array<double, 2> {
        return {2.0 * PI * i / N, PI * row / M};
    };

    std::size_t made = 0;
    for (int row = 0; row < M; ++row) {
        for (int i = 0; i < N; ++i) {
            int j = (i + 1) % N;
            double u0 = 2.0 * PI * i / N, u1 = 2.0 * PI * (i + 1) / N;
            double v0 = PI * row / M, v1 = PI * (row + 1) / M;
            Face* f = tb.makeFace();
            tb.addFaceToShell(shell, f);
            std::vector<std::array<double, 2>> uv;
            if (row == 0) {
                std::vector<Vertex*> ring = {north, rows[1][j], rows[1][i]};
                tb.addOuterLoopToFace(f, ring);
                uv = {{u0, 0.0}, uvAt(j, 1), uvAt(i, 1)};
            } else if (row == M - 1) {
                std::vector<Vertex*> ring = {rows[M - 1][i], rows[M - 1][j], south};
                tb.addOuterLoopToFace(f, ring);
                uv = {uvAt(i, M - 1), uvAt(j, M - 1), {u0, PI}};
            } else {
                std::vector<Vertex*> ring = {rows[row][i], rows[row][j],
                                             rows[row + 1][j], rows[row + 1][i]};
                tb.addOuterLoopToFace(f, ring);
                uv = {uvAt(i, row), uvAt(j, row), uvAt(j, row + 1), uvAt(i, row + 1)};
            }
            f->surface = surf;
            f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
            f->vertexUV = std::move(uv);
            ++made;
        }
    }
    return made;
}

} // namespace

AnalyticReadResult StepAnalytic::read(const std::string& text) {
    std::size_t dB = 0, dE = 0; std::string why;
    if (!p21::locateSections(text, dB, dE, why))
        return readFail("StepAnalytic.read: " + why);

    std::unordered_map<std::uint64_t, Instance> tab;
    if (!p21::parseInstances(text, dB, dE, tab, why))
        return readFail("StepAnalytic.read: " + why);
    if (tab.empty()) return readFail("StepAnalytic.read: empty DATA section");

    // Locate the (single) MANIFOLD_SOLID_BREP -> CLOSED_SHELL -> faces.
    std::uint64_t msb = 0; bool found = false;
    for (const auto& kv : tab) {
        if (kv.second.type == "MANIFOLD_SOLID_BREP") {
            if (found) return readFail("StepAnalytic.read: multiple MANIFOLD_SOLID_BREP");
            msb = kv.first; found = true;
        }
    }
    if (!found) return readFail("StepAnalytic.read: no MANIFOLD_SOLID_BREP");

    std::uint64_t shellRef = 0;
    {
        auto p = splitTopLevel(tab.at(msb).params);
        if (p.size() != 2 || !parseRef(p[1], shellRef))
            return readFail("StepAnalytic.read: MANIFOLD_SOLID_BREP shell ref");
    }
    auto shIt = tab.find(shellRef);
    if (shIt == tab.end() ||
        (shIt->second.type != "CLOSED_SHELL" && shIt->second.type != "OPEN_SHELL"))
        return readFail("StepAnalytic.read: shell is not a CLOSED_SHELL");
    std::vector<std::string> shellFields = splitTopLevel(shIt->second.params);
    std::vector<std::string> faceRefs;
    if (shellFields.size() != 2 || !parseList(shellFields[1], faceRefs) || faceRefs.empty())
        return readFail("StepAnalytic.read: empty CLOSED_SHELL");

    // Reconstruct into a fresh builder. Vertices are deduped by their
    // CARTESIAN_POINT id (each topological vertex == one VERTEX_POINT id; we key
    // by VERTEX_POINT id, falling back to the point id).
    auto owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *owner;
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    std::unordered_map<std::uint64_t, Vertex*> vpVertex;  // VERTEX_POINT id -> Vertex

    auto vertexForVP = [&](std::uint64_t vpId) -> Vertex* {
        auto vit = vpVertex.find(vpId);
        if (vit != vpVertex.end()) return vit->second;
        auto it = tab.find(vpId);
        if (it == tab.end() || it->second.type != "VERTEX_POINT") return nullptr;
        auto p = splitTopLevel(it->second.params);
        std::uint64_t cp = 0;
        if (p.size() != 2 || !parseRef(p[1], cp)) return nullptr;
        Vec3 pos; std::string w;
        if (!getPoint(tab, cp, pos, w)) return nullptr;
        Vertex* v = tb.makeVertex(Point3{pos.x, pos.y, pos.z});
        vpVertex.emplace(vpId, v);
        return v;
    };

    std::size_t nAnalytic = 0, nPlanar = 0;

    for (const std::string& fref : faceRefs) {
        std::uint64_t faceId = 0;
        if (!parseRef(fref, faceId))
            return readFail("StepAnalytic.read: shell holds a non-ref");
        auto fit = tab.find(faceId);
        if (fit == tab.end() || fit->second.type != "ADVANCED_FACE")
            return readFail("StepAnalytic.read: shell member #" +
                            std::to_string(faceId) + " is not ADVANCED_FACE");
        auto fp = splitTopLevel(fit->second.params);
        if (fp.size() != 4)
            return readFail("StepAnalytic.read: ADVANCED_FACE arity");
        // bounds list -> use the FACE_OUTER_BOUND (or the first FACE_BOUND).
        std::vector<std::string> boundRefs;
        if (!parseList(fp[1], boundRefs) || boundRefs.empty())
            return readFail("StepAnalytic.read: ADVANCED_FACE has no bounds");
        std::uint64_t surfRef = 0;
        if (!parseRef(fp[2], surfRef))
            return readFail("StepAnalytic.read: ADVANCED_FACE surface not a ref");
        bool sameSense = (fp[3] == ".T.");

        // Pick the outer bound (prefer FACE_OUTER_BOUND).
        std::uint64_t loopId = 0;
        bool gotLoop = false;
        for (const std::string& bref : boundRefs) {
            std::uint64_t bId = 0;
            if (!parseRef(bref, bId)) continue;
            auto bit = tab.find(bId);
            if (bit == tab.end()) continue;
            if (bit->second.type != "FACE_OUTER_BOUND" && bit->second.type != "FACE_BOUND")
                continue;
            auto bp = splitTopLevel(bit->second.params);
            if (bp.size() != 3) continue;
            std::uint64_t lId = 0;
            if (!parseRef(bp[1], lId)) continue;
            if (bit->second.type == "FACE_OUTER_BOUND") { loopId = lId; gotLoop = true; break; }
            if (!gotLoop) { loopId = lId; gotLoop = true; }  // fallback to first FACE_BOUND
        }
        if (!gotLoop)
            return readFail("StepAnalytic.read: ADVANCED_FACE has no usable bound loop");

        auto lit = tab.find(loopId);
        if (lit == tab.end())
            return readFail("StepAnalytic.read: bound loop ref dangling");

        // COMPACT CLOSED-SPHERE FACE: a periodic spherical surface whose bound is a
        // DEGENERATE VERTEX_LOOP (the OCCT-canonical single-face form) has NO edges.
        // Rebuild the closed analytic surface, then re-facet it into N*M sector faces
        // (sharing one surface) so the mass integrator + watertight tessellation get
        // the EXACT sphere. (Both directions of the round-trip are supported: the new
        // compact form here, and the legacy edge-loop sectors below.)
        if (lit->second.type == "VERTEX_LOOP") {
            Surface compact;
            std::string sw;
            if (!buildSurface(tab, surfRef, sameSense, compact, sw))
                return readFail("StepAnalytic.read: " + sw);
            if (compact.kind != SurfaceKind::Sphere)
                return readFail("StepAnalytic.read: VERTEX_LOOP bound on a non-sphere "
                                "surface (only closed spheres use the degenerate loop)");
            std::size_t made = refacetClosedSphere(tb, shell, compact);
            if (made == 0)
                return readFail("StepAnalytic.read: failed to re-facet closed sphere");
            nAnalytic += made;
            continue;   // this ADVANCED_FACE is fully handled
        }

        if (lit->second.type != "EDGE_LOOP")
            return readFail("StepAnalytic.read: bound is not an EDGE_LOOP");
        auto lp = splitTopLevel(lit->second.params);
        std::vector<std::string> oeRefs;
        if (lp.size() != 2 || !parseList(lp[1], oeRefs) || oeRefs.size() < 3)
            return readFail("StepAnalytic.read: EDGE_LOOP < 3 oriented edges");

        // Walk the oriented edges -> ordered ring of START vertices (in the loop's
        // traversal direction). For each ORIENTED_EDGE: resolve its EDGE_CURVE and
        // the orientation flag; the directed start vertex is the ring corner.
        std::vector<Vertex*> ring;
        std::vector<EdgeCircle> ringCircles;  // circle of the edge leaving ring[i]
        ring.reserve(oeRefs.size());
        ringCircles.reserve(oeRefs.size());
        for (const std::string& oref : oeRefs) {
            std::uint64_t oeId = 0;
            if (!parseRef(oref, oeId))
                return readFail("StepAnalytic.read: EDGE_LOOP holds a non-ref");
            auto oit = tab.find(oeId);
            if (oit == tab.end() || oit->second.type != "ORIENTED_EDGE")
                return readFail("StepAnalytic.read: loop member not ORIENTED_EDGE");
            auto op = splitTopLevel(oit->second.params);
            if (op.size() != 5)
                return readFail("StepAnalytic.read: ORIENTED_EDGE arity");
            std::uint64_t ecId = 0;
            if (!parseRef(op[3], ecId))
                return readFail("StepAnalytic.read: ORIENTED_EDGE edge not a ref");
            bool sense;
            if (op[4] == ".T.") sense = true;
            else if (op[4] == ".F.") sense = false;
            else return readFail("StepAnalytic.read: ORIENTED_EDGE sense not .T./.F.");

            auto eit = tab.find(ecId);
            if (eit == tab.end() || eit->second.type != "EDGE_CURVE")
                return readFail("StepAnalytic.read: edge is not EDGE_CURVE");
            auto ep = splitTopLevel(eit->second.params);
            if (ep.size() != 5)
                return readFail("StepAnalytic.read: EDGE_CURVE arity");
            std::uint64_t vS = 0, vE = 0;
            if (!parseRef(ep[1], vS) || !parseRef(ep[2], vE))
                return readFail("StepAnalytic.read: EDGE_CURVE endpoints");
            std::uint64_t startVp = sense ? vS : vE;
            Vertex* v = vertexForVP(startVp);
            if (!v)
                return readFail("StepAnalytic.read: cannot resolve oriented-edge "
                                "start vertex");
            ring.push_back(v);
            ringCircles.push_back(circleOfEdgeCurve(tab, ecId));
        }
        // Reject a degenerate ring (a repeated consecutive vertex).
        for (std::size_t k = 0; k < ring.size(); ++k) {
            if (ring[k] == ring[(k + 1) % ring.size()])
                return readFail("StepAnalytic.read: degenerate loop (repeated vertex)");
        }

        // Build the face + outer loop (edges created on demand, shared+mated).
        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, ring);
        tb.addFaceToShell(shell, f);

        // Attach the reconstructed analytic surface.
        Surface* surf = tb.makeSurface();
        Surface tmp;
        if (!buildSurface(tab, surfRef, sameSense, tmp, why))
            return readFail("StepAnalytic.read: " + why);
        *surf = tmp;
        f->surface = surf;
        if (surf->kind == SurfaceKind::Plane) ++nPlanar; else ++nAnalytic;

        // Compute the face trim window (u0..v1) + vertexUV so the EXACT mass
        // integrator can integrate this face over the SAME parameterisation the
        // primitives use. For a PLANE we project the ring to the (refDir,binormal)
        // frame (exact polygon moments). For a quadric we recover each ring
        // vertex's parametric (u,v) — CRUCIALLY unwrapping the angular theta so a
        // sector that straddles the atan2 -pi/+pi seam stays a small contiguous
        // span (NOT a spurious full-circle sweep that would over-count its mass).
        if (!attachTrim(f, surf, ring, ringCircles))
            return readFail("StepAnalytic.read: could not parameterise face over "
                            "its analytic surface (trim window)");
    }

    AnalyticReadResult r;
    r.ok = true;
    r.owner = owner;
    r.solid = solid;
    r.facesAnalytic = nAnalytic;
    r.facesPlanar = nPlanar;
    return r;
}

} // namespace brep
} // namespace native
} // namespace forge
