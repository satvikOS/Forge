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
#include "forge/native/brep/StepRead.hpp"  // resolveLengthScaleMm
#include "forge/native/brep/StepPart21.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/NurbsSurface.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
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
    std::size_t rationalSurfaces = 0;

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

// Knot vector -> (multiplicities, distinct knots), the Part-21 B-spline form.
void compactKnots(const std::vector<double>& knots,
                  std::vector<int>& mult, std::vector<double>& vals) {
    for (std::size_t k = 0; k < knots.size();) {
        std::size_t j = k;
        while (j < knots.size() && knots[j] == knots[k]) ++j;
        mult.push_back(static_cast<int>(j - k));
        vals.push_back(knots[k]);
        k = j;
    }
}
std::string intList(const std::vector<int>& v) {
    std::string o = "(";
    for (std::size_t k = 0; k < v.size(); ++k) { if (k) o += ','; o += std::to_string(v[k]); }
    return o + ')';
}
std::string realList(const std::vector<double>& v) {
    std::string o = "(";
    for (std::size_t k = 0; k < v.size(); ++k) { if (k) o += ','; o += stepFmt(v[k]); }
    return o + ')';
}

// Emit a B-spline CURVE (simple when every weight is 1, else the rational complex
// form) and return its id, or 0 if the curve cannot be written truthfully.
std::uint64_t emitBSplineCurve(Emitter& E, const NurbsCurve& c) {
    if (!c.valid()) return 0;
    bool rational = false;
    for (double w : c.weights) {
        if (!(w > 0.0) || !std::isfinite(w)) return 0;
        if (w != 1.0) rational = true;
    }
    std::string pts = "(";
    for (std::size_t k = 0; k < c.controlPoints.size(); ++k) {
        const std::uint64_t pid = E.emitPoint(c.controlPoints[k]);
        if (k) pts += ',';
        pts += '#'; pts += std::to_string(pid);
    }
    pts += ')';
    std::vector<int> m; std::vector<double> kv;
    compactKnots(c.knots, m, kv);
    const std::string base = std::to_string(c.degree) + ',' + pts + ",.UNSPECIFIED.,.F.,.F.";
    const std::string knotData = intList(m) + ',' + realList(kv) + ",.UNSPECIFIED.";
    const std::uint64_t id = E.alloc();
    E.appendId(id);
    if (!rational) {
        E.data += "=B_SPLINE_CURVE_WITH_KNOTS('',"; E.data += base; E.data += ',';
        E.data += knotData; E.data += ");\n";
    } else {
        E.data += "=(BOUNDED_CURVE()B_SPLINE_CURVE("; E.data += base;
        E.data += ")B_SPLINE_CURVE_WITH_KNOTS("; E.data += knotData;
        E.data += ")CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE(";
        E.data += realList(c.weights);
        E.data += ")REPRESENTATION_ITEM(''));\n";
    }
    return id;
}

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
        // valid() also requires a weights grid of the control grid's shape.
        if (!n.valid() || n.control.empty() || n.control[0].empty()) return 0;
        const std::size_t nU = n.control.size();
        const std::size_t nV = n.control[0].size();
        // ★ T-158: the weights ARE the geometry of a rational surface. They were
        //   dropped here (every surface written polynomial, flags .F.), and the
        //   exact rational quarter-circle blend read back 6.07 % too large. A
        //   weight that is not finite and positive cannot be written truthfully:
        //   refuse the face rather than write a different surface.
        bool rational = false;
        for (std::size_t iu = 0; iu < nU; ++iu)
            for (std::size_t iv = 0; iv < nV; ++iv) {
                const double w = n.weights[iu][iv];
                if (!(w > 0.0) || !std::isfinite(w)) return 0;
                if (w != 1.0) rational = true;   // T158-RATIONAL-SURFACE
            }
        // Emit the control-point grid (CARTESIAN_POINT ids), row major in U.
        std::vector<std::vector<std::uint64_t>> cp(nU, std::vector<std::uint64_t>(nV));
        for (std::size_t iu = 0; iu < nU; ++iu)
            for (std::size_t iv = 0; iv < nV; ++iv)
                cp[iu][iv] = E.emitPoint(n.control[iu][iv]);
        std::vector<int> mU, mV; std::vector<double> kU, kV;
        compactKnots(n.knotsU, mU, kU);
        compactKnots(n.knotsV, mV, kV);
        std::string grid = "(";
        for (std::size_t iu = 0; iu < nU; ++iu) {
            if (iu) grid += ',';
            grid += '(';
            for (std::size_t iv = 0; iv < nV; ++iv) {
                if (iv) grid += ',';
                grid += '#'; grid += std::to_string(cp[iu][iv]);
            }
            grid += ')';
        }
        grid += ')';
        const std::string knotData = intList(mU) + ',' + intList(mV) + ',' +
                                     realList(kU) + ',' + realList(kV) + ",.UNSPECIFIED.";
        const std::string base = std::to_string(n.degreeU) + ',' +
                                 std::to_string(n.degreeV) + ',' + grid +
                                 ",.UNSPECIFIED.,.F.,.F.,.F.";
        std::uint64_t id = E.alloc();
        E.appendId(id);
        if (!rational) {
            E.data += "=B_SPLINE_SURFACE_WITH_KNOTS('',";
            E.data += base; E.data += ','; E.data += knotData; E.data += ");\n";
        } else {
            // The ISO-10303-21 complex instance for a rational B-spline surface:
            // partial records in alphabetical order, exactly as OCCT and the
            // AP242 exporters write it (and as readForeignStep reads it).
            std::string wgrid = "(";
            for (std::size_t iu = 0; iu < nU; ++iu) {
                if (iu) wgrid += ',';
                wgrid += realList(n.weights[iu]);
            }
            wgrid += ')';
            E.data += "=(BOUNDED_SURFACE()B_SPLINE_SURFACE(";
            E.data += base;
            E.data += ")B_SPLINE_SURFACE_WITH_KNOTS(";
            E.data += knotData;
            E.data += ")GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE(";
            E.data += wgrid;
            E.data += ")REPRESENTATION_ITEM('')SURFACE());\n";
            ++E.rationalSurfaces;
        }
        return id;
    }
    case SurfaceKind::EllipseExtrusion:
        return 0;   // no analytic emit in this codec (the caller fails honestly)
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
// ISO-LINE ARCS of ONE analytic surface (T-158). A primitive tiles a single
// sphere / torus into sectors that SHARE one Surface*; the edge between two such
// sectors is an iso-parameter line of that surface. Besides the latitude circles
// circleForEdge() already recognises, those are:
//   * a sphere MERIDIAN: a great-circle arc in the plane holding the axis, and
//   * a torus MINOR circle: the tube cross-section at one azimuth.
// Writing them as straight chords put the file's edge up to r(1-cos(dθ/2)) off the
// surface. Only called for an edge whose two faces share the SAME Surface*, where
// an endpoint pair that fits one of these families is that family's iso-line.
// The normal is chosen so CCW(a->b) is the SHORT arc (see circleForEdge()).
bool isoArcForEdge(const Surface& s, const Vec3& a, const Vec3& b,
                   Vec3& centre, Vec3& normal, Vec3& ref, double& radius) {
    const Vec3 axis = vnorm(s.axis);
    const double scale = std::max(1.0, std::max(vlen(vsub(a, s.origin)), vlen(vsub(b, s.origin))));
    const double tol = 1e-7 * scale;
    if (vlen(vsub(a, b)) < tol) return false;
    if (s.kind == SurfaceKind::Sphere) {
        const Vec3 qa = vsub(a, s.origin), qb = vsub(b, s.origin);
        if (std::fabs(vlen(qa) - s.r1) > tol || std::fabs(vlen(qb) - s.r1) > tol) return false;
        const Vec3 nrm = vcross(qa, qb);
        const double nl = vlen(nrm);
        if (nl < 1e-12 * scale * scale) return false;            // antipodal / identical
        if (std::fabs(vdot(nrm, axis)) > 1e-9 * nl) return false; // plane must hold the axis
        centre = s.origin; normal = vscale(nrm, 1.0 / nl);
        ref = vnorm(qa); radius = s.r1;
        return true;
    }
    if (s.kind == SurfaceKind::Torus) {
        auto radialOf = [&](const Vec3& p, Vec3& dir, double& h) {
            const Vec3 q = vsub(p, s.origin);
            h = vdot(q, axis);
            const Vec3 rad = vsub(q, vscale(axis, h));
            const double rl = vlen(rad);
            if (rl < 1e-12) return false;
            dir = vscale(rad, 1.0 / rl);
            return true;
        };
        Vec3 da, db; double ha = 0, hb = 0;
        if (!radialOf(a, da, ha) || !radialOf(b, db, hb)) return false;
        if (vdot(da, db) < 1.0 - 1e-12) return false;            // not the same azimuth
        const Vec3 c = vadd(s.origin, vscale(da, s.r1));         // tube-centre ring point
        if (std::fabs(vlen(vsub(a, c)) - s.r2) > tol || std::fabs(vlen(vsub(b, c)) - s.r2) > tol)
            return false;
        const Vec3 tangent = vnorm(vcross(axis, da));            // the minor circle's normal
        const Vec3 sgn = vcross(vsub(a, c), vsub(b, c));
        centre = c;
        normal = (vdot(sgn, tangent) >= 0.0) ? tangent : vscale(tangent, -1.0);
        ref = vnorm(vsub(a, c)); radius = s.r2;
        return true;
    }
    return false;
}

// Closest-point inversion of p onto a NURBS surface: a coarse grid seed, then
// Gauss-Newton on |S(u,v) - p|^2 clamped to the knot domain. Returns the final
// distance (infinity when the surface cannot be evaluated). `G` is the seed grid
// (G+1)^2: a seed that misses the global minimum can only make the distance
// LARGER, so a coarse grid may refuse / over-count, never certify a false hit.
// The same holds for `maxIt` (fewer Gauss-Newton steps) and `acceptBelow` (stop
// as soon as a point within that distance is FOUND -- that point certifies it).
double invertNurbs(const NurbsSurface& n, const Vec3& p, double& uOut, double& vOut,
                   int G = 16, int maxIt = 50, double acceptBelow = -1.0) {
    if (!n.valid()) return std::numeric_limits<double>::infinity();
    const double u0 = n.knotsU.front(), u1 = n.knotsU.back();
    const double v0 = n.knotsV.front(), v1 = n.knotsV.back();
    double best = std::numeric_limits<double>::infinity(), bu = u0, bv = v0;
    for (int i = 0; i <= G; ++i)
        for (int j = 0; j <= G; ++j) {
            const double u = u0 + (u1 - u0) * i / G, v = v0 + (v1 - v0) * j / G;
            const double d = vlen(vsub(n.evaluate(u, v), p));
            if (d < best) { best = d; bu = u; bv = v; }
        }
    double u = bu, v = bv;
    for (int it = 0; it < maxIt; ++it) {
        const SurfaceSample ss = evaluateWithDerivatives(n, u, v);
        if (!ss.ok && vlen(ss.du) == 0.0 && vlen(ss.dv) == 0.0) break;
        const Vec3 r = vsub(ss.point, p);
        if (vlen(r) <= acceptBelow) break;   // found: the final check returns it
        const double a11 = vdot(ss.du, ss.du), a12 = vdot(ss.du, ss.dv), a22 = vdot(ss.dv, ss.dv);
        const double g1 = vdot(r, ss.du), g2 = vdot(r, ss.dv);
        const double det = a11 * a22 - a12 * a12;
        if (!(std::fabs(det) > 1e-300)) break;
        double du = -( a22 * g1 - a12 * g2) / det;
        double dv = -(-a12 * g1 + a11 * g2) / det;
        const double nu = std::min(u1, std::max(u0, u + du));
        const double nv = std::min(v1, std::max(v0, v + dv));
        const bool small = std::fabs(nu - u) < 1e-15 * std::max(1.0, std::fabs(u1 - u0)) &&
                           std::fabs(nv - v) < 1e-15 * std::max(1.0, std::fabs(v1 - v0));
        u = nu; v = nv;
        if (small) break;
    }
    const double d = vlen(vsub(n.evaluate(u, v), p));
    if (d <= best) { uOut = u; vOut = v; return d; }
    uOut = bu; vOut = bv; return best;
}

// Distance-like residual of p from surface s (0 on the surface). Used ONLY to
// decide whether a straight chord written for an edge with no exact curve is in
// fact a line of both adjacent faces (then it is exact, not a chord). `tol` is
// that decision's threshold: a NURBS search may stop once it is met.
double surfaceResidual(const Surface& s, const Vec3& p, double tol) {
    const Vec3 axis = vnorm(s.axis);
    const Vec3 q = vsub(p, s.origin);
    const double h = vdot(q, axis);
    const double rad = vlen(vsub(q, vscale(axis, h)));
    switch (s.kind) {
    case SurfaceKind::Plane:    return std::fabs(h);
    case SurfaceKind::Cylinder: return std::fabs(rad - s.r1);
    case SurfaceKind::Cone: {
        if (std::fabs(s.param) < 1e-300) return std::numeric_limits<double>::infinity();
        return std::fabs(rad - (s.r1 + (s.r2 - s.r1) * h / s.param));
    }
    case SurfaceKind::Sphere:   return std::fabs(vlen(q) - s.r1);
    case SurfaceKind::Torus:    return std::fabs(std::sqrt((rad - s.r1) * (rad - s.r1) + h * h) - s.r2);
    case SurfaceKind::EllipseExtrusion: {
        if (!(s.r1 > 0.0) || !(s.r2 > 0.0)) return std::numeric_limits<double>::infinity();
        const Vec3 rd = vnorm(s.refDir), bd = s.binormal();
        const double x = vdot(q, rd) / s.r1, y = vdot(q, bd) / s.r2;
        return std::fabs(std::sqrt(x * x + y * y) - 1.0) * std::min(s.r1, s.r2);
    }
    case SurfaceKind::Nurbs: {
        double u = 0, v = 0;
        // Diagnostic only (edgesLine vs edgesChord): a 7x7 seed, at most 12
        // Gauss-Newton steps, stop once within `tol`. A miss can only count a
        // straight edge as an unverified chord, never certify a curved one.
        return invertNurbs(s.nurbs, p, u, v, 6, 12, tol);
    }
    }
    return std::numeric_limits<double>::infinity();
}

// Write an edge's OWN exact curve (Edge::curve) and return its id, setting
// `sameSense` for EDGE_CURVE. Returns 0 when the curve does not span this edge's
// two vertices (inconsistent data is never written as if it were exact) or its
// kind cannot be written truthfully; the caller then falls back to inference.
std::uint64_t emitEdgeOwnCurve(Emitter& E, const Edge& e, bool& sameSense) {
    if (!e.curve) return 0;
    const Curve& c = *e.curve;
    const Vec3 ps = PV(e.start->point), pe = PV(e.end->point);
    const Vec3 c0 = c.evaluate(c.t0), c1 = c.evaluate(c.t1);
    double scale = std::max({1.0, vlen(ps), vlen(pe), std::fabs(c.r), std::fabs(c.a), std::fabs(c.b)});
    const double tol = 1e-7 * scale;
    const bool fwd = vlen(vsub(c0, ps)) <= tol && vlen(vsub(c1, pe)) <= tol;
    const bool rev = vlen(vsub(c0, pe)) <= tol && vlen(vsub(c1, ps)) <= tol;
    if (!fwd && !rev) return 0;
    if (!(c.t1 != c.t0)) return 0;
    // The edge runs start->end; its curve parameter INCREASES along it iff ...
    const bool increasing = fwd ? (c.t1 > c.t0) : (c.t0 > c.t1);
    switch (c.kind) {
    case GeomCurveKind::Line: {
        Vec3 d = vsub(pe, ps);
        const double L = vlen(d);
        if (L <= tol) return 0;
        d = vscale(d, 1.0 / L);
        const std::uint64_t pId = E.emitPoint(ps);
        const std::uint64_t vecId = E.emitVector(d, L);
        const std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=LINE('',#"; E.data += std::to_string(pId);
        E.data += ",#"; E.data += std::to_string(vecId); E.data += ");\n";
        sameSense = true;
        return id;
    }
    case GeomCurveKind::Circle:
    case GeomCurveKind::Ellipse: {
        if (std::fabs(c.t1 - c.t0) > 2.0 * 3.14159265358979323846 + 1e-12) return 0;
        const bool circ = (c.kind == GeomCurveKind::Circle);
        if (circ ? !(c.r > 0.0) : !(c.a > 0.0 && c.b > 0.0)) return 0;
        const std::uint64_t ax = E.emitAxis2(c.origin, c.normal, c.refDir);
        const std::uint64_t id = E.alloc();
        E.appendId(id);
        if (circ) {
            E.data += "=CIRCLE('',#"; E.data += std::to_string(ax); E.data += ',';
            E.data += stepFmt(c.r);
        } else {
            E.data += "=ELLIPSE('',#"; E.data += std::to_string(ax); E.data += ',';
            E.data += stepFmt(c.a); E.data += ','; E.data += stepFmt(c.b);
        }
        E.data += ");\n";
        sameSense = increasing;
        return id;
    }
    case GeomCurveKind::Parabola: {
        // STEP C(u) = c + f(u^2 x + 2u y); ours C(t) = c + t^2/(4f) x + t y, so
        // t = 2 f u: the same point set, the same increasing direction for f > 0.
        if (!(c.a > 0.0)) return 0;
        const std::uint64_t ax = E.emitAxis2(c.origin, c.normal, c.refDir);
        const std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=PARABOLA('',#"; E.data += std::to_string(ax);
        E.data += ','; E.data += stepFmt(c.a); E.data += ");\n";
        sameSense = increasing;
        return id;
    }
    case GeomCurveKind::Hyperbola: {
        if (!(c.a > 0.0 && c.b > 0.0)) return 0;
        const std::uint64_t ax = E.emitAxis2(c.origin, c.normal, c.refDir);
        const std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=HYPERBOLA('',#"; E.data += std::to_string(ax);
        E.data += ','; E.data += stepFmt(c.a); E.data += ','; E.data += stepFmt(c.b);
        E.data += ");\n";
        sameSense = increasing;
        return id;
    }
    case GeomCurveKind::BSpline: {
        const std::uint64_t id = emitBSplineCurve(E, c.nurbs);
        if (id == 0) return 0;
        sameSense = increasing;
        return id;
    }
    }
    return 0;
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
    std::size_t edgesFromCurve = 0, edgesInferredArc = 0, edgesLine = 0, edgesChord = 0;

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
    // Geometry, in priority order (T-158; see the EDGE MAP in StepAnalytic.hpp):
    // the edge's OWN Edge::curve; else a CIRCLE iff EITHER adjacent face's surface
    // makes (start,end) a circular arc (so a cap-boundary arc shared with a curved
    // wall is recorded as a CIRCLE regardless of which face is emitted first — this
    // is what lets the reader recover the exact-disk cap), or an iso-line arc of
    // one shared surface; otherwise a LINE, counted as edgesLine when verified on
    // both adjacent surfaces and as edgesChord when not.
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
        bool sameSense = true;
        // 1) The edge's OWN exact curve (T-158: it was ignored, and an exact arc on
        //    a planar cap / NURBS blend was written as a straight chord).
        curveId = emitEdgeOwnCurve(E, *e, sameSense);   // T158-EDGE-OWN-CURVE
        if (curveId) {
            ++edgesFromCurve;
        } else {
            Vec3 c, n, r; double rad = 0.0;
            bool isCircle = (sA && circleForEdge(*sA, ps, pe, c, n, r, rad)) ||
                            (sB && circleForEdge(*sB, ps, pe, c, n, r, rad));
            // 2b) an iso-line arc of ONE shared surface (sphere meridian, torus
            //     minor circle) — only when both faces carry the same Surface*.
            if (!isCircle && sA && sA == sB) isCircle = isoArcForEdge(*sA, ps, pe, c, n, r, rad);
            if (isCircle) {
                std::uint64_t ax = E.emitAxis2(c, n, r);
                curveId = E.alloc();
                E.appendId(curveId); E.data += "=CIRCLE('',#";
                E.data += std::to_string(ax); E.data += ','; E.data += stepFmt(rad);
                E.data += ");\n";
                ++edgesInferredArc;
            } else {
                // 3) LINE('', start_point, VECTOR(dir, |end-start|)). Exact iff the
                //    edge IS straight: verify the chord on BOTH adjacent surfaces and
                //    COUNT the ones that cannot be verified (edgesChord).
                Vec3 d = vsub(pe, ps);
                double L = vlen(d);
                Vec3 dir = (L > 1e-12) ? vscale(d, 1.0 / L) : Vec3{1, 0, 0};
                const double tolL = 1e-7 * std::max(1.0, std::max(vlen(ps), vlen(pe)));
                bool straight = (sA != nullptr) || (sB != nullptr);
                // Cheapest decisive test first, stop at the first failure: the
                // midpoint before the quarter points, and an analytic surface
                // before a NURBS one (whose residual is a closest-point search).
                // A curved edge almost always fails at once, so an imported part
                // whose every edge lacks Edge::curve pays ~one residual per edge.
                const Surface* order[2] = {sA, sB};
                if (sA && sB && sA->kind == SurfaceKind::Nurbs && sB->kind != SurfaceKind::Nurbs)
                    std::swap(order[0], order[1]);
                for (double f : {0.5, 0.25, 0.75}) {
                    const Vec3 q = vadd(ps, vscale(d, f));
                    for (const Surface* s : order)
                        if (s && !(surfaceResidual(*s, q, tolL) <= tolL)) { straight = false; break; }
                    if (!straight) break;
                }
                if (straight) ++edgesLine; else ++edgesChord;
                std::uint64_t pId = E.emitPoint(ps);
                std::uint64_t vecId = E.emitVector(dir, (L > 1e-12) ? L : 1.0);
                curveId = E.alloc();
                E.appendId(curveId); E.data += "=LINE('',#";
                E.data += std::to_string(pId); E.data += ",#";
                E.data += std::to_string(vecId); E.data += ");\n";
            }
        }

        std::uint64_t id = E.alloc();
        E.appendId(id); E.data += "=EDGE_CURVE('',#";
        E.data += std::to_string(vS); E.data += ",#"; E.data += std::to_string(vE);
        E.data += ",#"; E.data += std::to_string(curveId);
        E.data += sameSense ? ",.T.);\n" : ",.F.);\n";
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
                return writeFail("StepAnalytic.write: face surface cannot be written "
                                 "exactly (a NURBS with incomplete data or a weight "
                                 "that is not finite and > 0, or an EllipseExtrusion)");

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
    r.rationalSurfaces = E.rationalSurfaces;
    r.edgesFromCurve = edgesFromCurve;
    r.edgesInferredArc = edgesInferredArc;
    r.edgesLine = edgesLine;
    r.edgesChord = edgesChord;
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

// Part-21 numeric lists.
bool realListOf(const std::string& tok, std::vector<double>& out) {
    std::vector<std::string> f;
    if (!parseList(tok, f)) return false;
    out.clear();
    for (const std::string& x : f) { double v = 0; if (!stepNum(x, v)) return false; out.push_back(v); }
    return true;
}
bool expandKnotData(const std::string& multTok, const std::string& knotTok,
                    std::vector<double>& knots) {
    std::vector<double> m, k;
    if (!realListOf(multTok, m) || !realListOf(knotTok, k) || m.size() != k.size() || k.empty())
        return false;
    knots.clear();
    for (std::size_t i = 0; i < k.size(); ++i) {
        const long long mi = std::llround(m[i]);
        if (mi < 1 || mi > 64 || static_cast<double>(mi) != m[i]) return false;
        if (i && !(k[i] > k[i - 1])) return false;
        for (long long r = 0; r < mi; ++r) knots.push_back(k[i]);
    }
    return true;
}

// Reconstruct a B-spline SURFACE from either
//   B_SPLINE_SURFACE_WITH_KNOTS('',dU,dV,grid,form,uC,vC,si,mU,mV,kU,kV,spec)   or
//   (BOUNDED_SURFACE()B_SPLINE_SURFACE(dU,dV,grid,form,uC,vC,si)
//    B_SPLINE_SURFACE_WITH_KNOTS(mU,mV,kU,kV,spec)...[RATIONAL_B_SPLINE_SURFACE(w)]...)
// Weights default to 1; a rational record supplies every one. Strict: anything
// that does not validate as a clamped NURBS surface is refused.
bool readBSplineSurface(const std::unordered_map<std::uint64_t, Instance>& tab,
                        const Instance& ins, NurbsSurface& n, std::string& why) {
    std::vector<std::string> base, knots, weights;
    if (ins.type == "B_SPLINE_SURFACE_WITH_KNOTS") {
        auto f = splitTopLevel(ins.params);
        if (f.size() != 13) { why = "B_SPLINE_SURFACE_WITH_KNOTS arity"; return false; }
        base.assign(f.begin() + 1, f.begin() + 8);
        knots.assign(f.begin() + 8, f.end());
    } else {
        const auto parts = p21::splitComplexRecord(ins.params);
        bool isSurface = false;
        for (const auto& pt : parts) {
            if (pt.type == "B_SPLINE_SURFACE") { base = splitTopLevel(pt.params); isSurface = true; }
            else if (pt.type == "B_SPLINE_SURFACE_WITH_KNOTS") knots = splitTopLevel(pt.params);
            else if (pt.type == "RATIONAL_B_SPLINE_SURFACE") weights = splitTopLevel(pt.params);
        }
        if (!isSurface || base.size() != 7 || knots.size() != 5) {
            why = "unsupported analytic surface entity (complex record is not a B-spline surface)";
            return false;
        }
        if (!weights.empty() && weights.size() != 1) { why = "RATIONAL_B_SPLINE_SURFACE arity"; return false; }
    }
    double dU = 0, dV = 0;
    if (!stepNum(base[0], dU) || !stepNum(base[1], dV) || dU < 1 || dV < 1 ||
        dU != std::floor(dU) || dV != std::floor(dV)) { why = "B-spline surface degree"; return false; }
    n = NurbsSurface{};
    n.degreeU = static_cast<std::size_t>(dU);
    n.degreeV = static_cast<std::size_t>(dV);
    std::vector<std::string> rows;
    if (!parseList(base[2], rows) || rows.empty()) { why = "B-spline surface control grid"; return false; }
    for (const std::string& row : rows) {
        std::vector<std::string> refs;
        if (!parseList(row, refs) || refs.empty()) { why = "B-spline surface control row"; return false; }
        std::vector<Vec3> pts;
        for (const std::string& r : refs) {
            std::uint64_t pid = 0; Vec3 P;
            if (!parseRef(r, pid) || !getPoint(tab, pid, P, why)) { if (why.empty()) why = "B-spline control point"; return false; }
            pts.push_back(P);
        }
        n.control.push_back(std::move(pts));
        n.weights.emplace_back(n.control.back().size(), 1.0);
    }
    if (!weights.empty()) {
        std::vector<std::string> wrows;
        if (!parseList(weights[0], wrows) || wrows.size() != n.control.size()) {
            why = "RATIONAL_B_SPLINE_SURFACE weight grid shape"; return false;
        }
        for (std::size_t i = 0; i < wrows.size(); ++i) {
            std::vector<double> w;
            if (!realListOf(wrows[i], w) || w.size() != n.control[i].size()) {
                why = "RATIONAL_B_SPLINE_SURFACE weight row"; return false;
            }
            n.weights[i] = std::move(w);
        }
    }
    if (!expandKnotData(knots[0], knots[2], n.knotsU) ||
        !expandKnotData(knots[1], knots[3], n.knotsV)) { why = "B-spline surface knot data"; return false; }
    const char* vr = nullptr;
    if (!validateSurface(n, &vr)) {
        why = std::string("invalid B-spline surface: ") + (vr ? vr : "?");
        return false;
    }
    return true;
}

// Reconstruct a B-spline CURVE (simple or rational complex). Strict.
bool readBSplineCurve(const std::unordered_map<std::uint64_t, Instance>& tab,
                      const Instance& ins, NurbsCurve& c) {
    std::vector<std::string> base, knots, weights;
    if (ins.type == "B_SPLINE_CURVE_WITH_KNOTS") {
        auto f = splitTopLevel(ins.params);
        if (f.size() != 9) return false;
        base.assign(f.begin() + 1, f.begin() + 6);
        knots.assign(f.begin() + 6, f.end());
    } else if (ins.type.empty()) {
        bool isCurve = false;
        for (const auto& pt : p21::splitComplexRecord(ins.params)) {
            if (pt.type == "B_SPLINE_CURVE") { base = splitTopLevel(pt.params); isCurve = true; }
            else if (pt.type == "B_SPLINE_CURVE_WITH_KNOTS") knots = splitTopLevel(pt.params);
            else if (pt.type == "RATIONAL_B_SPLINE_CURVE") weights = splitTopLevel(pt.params);
        }
        if (!isCurve || base.size() != 5 || knots.size() != 3) return false;
    } else {
        return false;
    }
    double d = 0;
    if (!stepNum(base[0], d) || d < 1 || d != std::floor(d)) return false;
    c = NurbsCurve{};
    c.degree = static_cast<std::size_t>(d);
    std::vector<std::string> refs;
    if (!parseList(base[1], refs) || refs.empty()) return false;
    std::string w;
    for (const std::string& r : refs) {
        std::uint64_t pid = 0; Vec3 P;
        if (!parseRef(r, pid) || !getPoint(tab, pid, P, w)) return false;
        c.controlPoints.push_back(P);
    }
    c.weights.assign(c.controlPoints.size(), 1.0);
    if (!weights.empty()) {
        std::vector<double> ws;
        if (weights.size() != 1 || !realListOf(weights[0], ws) || ws.size() != c.controlPoints.size())
            return false;
        for (double x : ws) if (!(x > 0.0)) return false;
        c.weights = std::move(ws);
    }
    if (!expandKnotData(knots[0], knots[1], c.knots)) return false;
    return c.valid();
}

// Parameter of p on a NURBS curve (sampled seed + Newton on (C-p).C').
double invertNurbsCurve(const NurbsCurve& c, const Vec3& p, double& tOut) {
    const double lo = c.knots.front(), hi = c.knots.back();
    const int G = 64;
    double best = std::numeric_limits<double>::infinity(), bt = lo;
    for (int i = 0; i <= G; ++i) {
        const double t = lo + (hi - lo) * i / G;
        const double dd = vlen(vsub(c.evaluate(t), p));
        if (dd < best) { best = dd; bt = t; }
    }
    double t = bt;
    const double h = 1e-7 * std::max(1.0, hi - lo);
    for (int it = 0; it < 50; ++it) {
        const Vec3 P = c.evaluate(t);
        const double ta = std::max(lo, t - h), tb = std::min(hi, t + h);
        const Vec3 d1 = vscale(vsub(c.evaluate(tb), c.evaluate(ta)), 1.0 / (tb - ta));
        const double g = vdot(vsub(P, p), d1), H = vdot(d1, d1);
        if (!(H > 0.0)) break;
        const double nt = std::min(hi, std::max(lo, t - g / H));
        if (std::fabs(nt - t) < 1e-15 * std::max(1.0, hi - lo)) { t = nt; break; }
        t = nt;
    }
    const double dd = vlen(vsub(c.evaluate(t), p));
    if (dd <= best) { tOut = t; return dd; }
    tOut = bt; return best;
}

// Decode an EDGE_CURVE's geometry into a native Curve parameterised from the
// edge's START (es) at t0 to its END (ee) at t1 (the Topology.hpp convention).
// Returns false — leaving Edge::curve empty — for geometry this reader does not
// understand or that does not pass through both vertices.
bool decodeEdgeCurve(const std::unordered_map<std::uint64_t, Instance>& tab,
                     std::uint64_t ecId, const Vec3& es, const Vec3& ee, Curve& out) {
    auto eit = tab.find(ecId);
    if (eit == tab.end() || eit->second.type != "EDGE_CURVE") return false;
    auto ep = splitTopLevel(eit->second.params);
    if (ep.size() != 5) return false;
    std::uint64_t vs = 0, ve = 0, cid = 0;
    if (!parseRef(ep[1], vs) || !parseRef(ep[2], ve) || !parseRef(ep[3], cid)) return false;
    bool sense;
    if (ep[4] == ".T.") sense = true; else if (ep[4] == ".F.") sense = false; else return false;
    auto vpPoint = [&](std::uint64_t vp, Vec3& P) {
        auto it = tab.find(vp);
        if (it == tab.end() || it->second.type != "VERTEX_POINT") return false;
        auto p = splitTopLevel(it->second.params);
        std::uint64_t cp = 0; std::string w;
        return p.size() == 2 && parseRef(p[1], cp) && getPoint(tab, cp, P, w);
    };
    Vec3 PS, PE;
    if (!vpPoint(vs, PS) || !vpPoint(ve, PE)) return false;
    const double scale = std::max(1.0, std::max(vlen(es), vlen(ee)));
    const double tol = 1e-7 * scale;
    bool startIsPS;
    if (vlen(vsub(es, PS)) <= tol && vlen(vsub(ee, PE)) <= tol) startIsPS = true;
    else if (vlen(vsub(es, PE)) <= tol && vlen(vsub(ee, PS)) <= tol) startIsPS = false;
    else return false;
    auto cit = tab.find(cid);
    if (cit == tab.end()) return false;
    // T-270: an AP214 exporter (OCCT) wraps the 3D curve as SURFACE_CURVE /
    // SEAM_CURVE('', #curve3d, (pcurves...), .PCURVE_S1.); its first argument is
    // the edge's 3D geometry. Without it the edge was a bare chord, which the
    // curved-face trim check (verifyQuadricTrim) rightly finds off the surface.
    if (cit->second.type == "SURFACE_CURVE" || cit->second.type == "SEAM_CURVE") {   // T270-EDGE-SURFACE-CURVE
        auto sp = splitTopLevel(cit->second.params);
        std::uint64_t c3 = 0;
        if (sp.size() < 2 || !parseRef(sp[1], c3)) return false;
        cit = tab.find(c3);
        if (cit == tab.end()) return false;
    }
    const std::string& ty = cit->second.type;
    const double TWO_PI = 2.0 * 3.14159265358979323846;

    // File-order parameters (tS at PS, tE at PE), then map onto the edge.
    double tS = 0, tE = 0;
    if (ty == "LINE") {
        out = Curve::makeLine(es, ee);
        return vlen(vsub(ee, es)) > tol;
    } else if (ty == "CIRCLE" || ty == "ELLIPSE" || ty == "PARABOLA" || ty == "HYPERBOLA") {
        auto cp = splitTopLevel(cit->second.params);
        std::uint64_t ax = 0;
        if (cp.size() < 3 || !parseRef(cp[1], ax)) return false;
        Vec3 C, N, X; std::string w;
        if (!getAxis2(tab, ax, C, N, X, w)) return false;
        const Vec3 Y = vcross(N, X);
        double a = 0, b = 0;
        if (!stepNum(cp[2], a) || !(a > 0.0)) return false;
        if (ty == "ELLIPSE" || ty == "HYPERBOLA") {
            if (cp.size() != 4 || !stepNum(cp[3], b) || !(b > 0.0)) return false;
        } else if (cp.size() != 3) {
            return false;
        }
        auto lx = [&](const Vec3& P) { return vdot(vsub(P, C), X); };
        auto ly = [&](const Vec3& P) { return vdot(vsub(P, C), Y); };
        if (ty == "CIRCLE" || ty == "ELLIPSE") {
            const double bb = (ty == "CIRCLE") ? a : b;
            const double aS = std::atan2(ly(PS) / bb, lx(PS) / a);
            const double aE = std::atan2(ly(PE) / bb, lx(PE) / a);
            // .T.: increasing angle PS -> PE; .F.: decreasing. A closed edge
            // (PS == PE) spans the full turn.
            double span = sense ? aE - aS : aS - aE;
            while (span <= 1e-15) span += TWO_PI;
            while (span > TWO_PI) span -= TWO_PI;
            tS = aS; tE = sense ? aS + span : aS - span;
            out = (ty == "CIRCLE") ? Curve::makeCircle(C, X, N, a)
                                   : Curve::makeEllipse(C, X, N, a, b);
        } else if (ty == "PARABOLA") {
            // ours: C(t) = c + t^2/(4f) x + t y  ->  t = local y
            tS = ly(PS); tE = ly(PE);
            if (sense != (tE > tS)) return false;
            out = Curve::makeParabola(C, X, N, a, 0.0, 1.0);
        } else {
            tS = std::asinh(ly(PS) / b); tE = std::asinh(ly(PE) / b);
            if (sense != (tE > tS)) return false;
            out = Curve::makeHyperbola(C, X, N, a, b, 0.0, 1.0);
        }
    } else if (ty == "B_SPLINE_CURVE_WITH_KNOTS" || ty.empty()) {
        NurbsCurve nc;
        if (!readBSplineCurve(tab, cit->second, nc)) return false;
        if (invertNurbsCurve(nc, PS, tS) > tol || invertNurbsCurve(nc, PE, tE) > tol) return false;
        if (vlen(vsub(PS, PE)) <= tol) {           // closed: the whole domain, in sense
            tS = sense ? nc.knots.front() : nc.knots.back();
            tE = sense ? nc.knots.back() : nc.knots.front();
        }
        if (sense != (tE > tS)) return false;
        out = Curve::makeBSpline(nc);
    } else {
        return false;   // SURFACE_CURVE, POLYLINE, ... : not understood here
    }
    out.t0 = startIsPS ? tS : tE;
    out.t1 = startIsPS ? tE : tS;
    return vlen(vsub(out.evaluate(out.t0), es)) <= tol &&
           vlen(vsub(out.evaluate(out.t1), ee)) <= tol;
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
    } else if (type == "B_SPLINE_SURFACE_WITH_KNOTS" || type.empty()) {
        // T-158: the writer emits B-spline faces, so the reader must read them —
        // the simple form and the RATIONAL complex form, weights included.
        s.kind = SurfaceKind::Nurbs;
        if (!readBSplineSurface(tab, it->second, s.nurbs, why)) return false;
    } else {
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
    // T-270: the AP214 SURFACE_CURVE / SEAM_CURVE wrapper carries the 3D curve
    // first (as in decodeEdgeCurve), so an OCCT-dialect disk cap is a disk too.
    if (cit != tab.end() && (cit->second.type == "SURFACE_CURVE" || cit->second.type == "SEAM_CURVE")) {   // T270-DISK-SURFACE-CURVE
        auto sp = splitTopLevel(cit->second.params);
        std::uint64_t c3 = 0;
        if (sp.size() < 2 || !parseRef(sp[1], c3)) return out;
        cit = tab.find(c3);
    }
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
                const std::vector<EdgeCircle>& ringCircles, std::string& why) {
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());

    // NURBS (T-158): a B-spline face's trim window is attachNurbsTrim()'s (below),
    // which also decides whether the face IS a (u,v) rectangle at all.
    if (surf->kind == SurfaceKind::Nurbs) return false;
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
        case SurfaceKind::Nurbs:             // handled (and returned) above
        case SurfaceKind::EllipseExtrusion:  // buildSurface() never produces one
            return false;
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
        // T-270: HOLED DISK. The polar disk integral has no holes, so a disk face
        // WITH inner (hole) loops was read back as the WHOLE disk, holes filled.
        // Integrated as its holed boundary POLYGON (boolHoled) instead, it is the
        // face only when every arc of it is chorded as finely as readForeignStep's
        // own representation of the face (it densifies an arc into
        // llround(96*span/2pi) chords, none wider than pi/32) -- which is what an
        // imported part written by write() carries. A coarser arc (a circle in 3
        // or 4 arcs: its polygon is the inscribed triangle / square, -36 % for 4)
        // has no exact integral here, so such a face is REFUSED.
        if (diskShaped && !f->innerLoops.empty()) {
            std::vector<const Loop*> loops{f->outerLoop};
            for (const Loop* il : f->innerLoops) loops.push_back(il);
            for (const Loop* lp : loops) {
                const Coedge* ce = lp ? lp->first : nullptr;
                std::size_t guard = 0;
                while (ce && ce->edge) {
                    const Edge* e = ce->edge;
                    const bool line = e->curve && e->curve->kind == GeomCurveKind::Line;
                    const bool fineArc = e->curve && e->curve->kind == GeomCurveKind::Circle &&
                                         std::fabs(e->curve->t1 - e->curve->t0) <=
                                             3.14159265358979323846 / 32.0 + 1e-9;
                    if (!line && !fineArc) {   // T270-HOLED-DISK-COARSE
                        why = "a planar disk face with holes is bounded by an arc coarser than pi/32 "
                              "(its chord polygon is not the face, and the disk integral has no holes)";
                        return false;
                    }
                    ce = ce->next;
                    if (ce == lp->first || ++guard > 1000000) break;
                }
            }
            diskShaped = false;   // T270-HOLED-DISK-POLYGON
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
                // SECTOR (T-270): its angular span is the angle SWEPT by its
                // boundary about the centre -- the loop's vertices and the midpoint
                // of every arc edge (its re-attached Edge::curve), unwrapped
                // CONTINUOUSLY along the loop from the first point off the centre.
                // It was the spread of the vertex angles referenced to ring[0] with
                // [lo,hi] seeded at 0: when ring[0] IS the centre (the apex of a
                // fillet's cap sector) that seed widened every sector to start at
                // angle 0 (MEASURED: filletCylinderTopEdgeAnalytic area 394.478 ->
                // 1197.941 on the round trip, volume unchanged), and a half-disk's
                // far radial edge at +-pi could land on either side.
                std::vector<Vec3> bpts;
                const Coedge* ce = f->outerLoop ? f->outerLoop->first : nullptr;
                std::size_t guard = 0;
                while (ce && ce->edge) {
                    bpts.push_back(PV(ce->originVertex()->point));
                    const Edge* e = ce->edge;
                    if (e->curve && e->curve->kind == GeomCurveKind::Circle)
                        bpts.push_back(e->curve->evaluate(0.5 * (e->curve->t0 + e->curve->t1)));
                    ce = ce->next;
                    if (ce == f->outerLoop->first || ++guard > 1000000) break;
                }
                bool have = false;
                double prev = 0.0, lo = 0.0, hi = 0.0;
                for (const Vec3& p : bpts) {
                    const Vec3 rel = vsub(p, centre);
                    const double x = vdot(rel, rdir), y = vdot(rel, bdir);
                    if (std::sqrt(x * x + y * y) < 1e-9) continue;   // the centre itself
                    double a = std::atan2(y, x);
                    if (have) {
                        while (a - prev >  3.14159265358979323846) a -= TWO_PI;
                        while (a - prev < -3.14159265358979323846) a += TWO_PI;
                        lo = std::min(lo, a); hi = std::max(hi, a);
                    } else {
                        have = true; lo = hi = a;   // T270-SECTOR-SWEEP
                    }
                    prev = a;
                }
                aMin = lo; aMax = hi;
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

// ---------------------------------------------------------------------------
// B-SPLINE FACE TRIM (T-158). The mass integrator integrates a Nurbs face over
// its (u,v) RECTANGLE [u0,u1]x[v0,v1]. That is the face only when the face IS a
// rectangle of the knot domain: no hole, and its whole boundary on the IMAGE of
// the rectangle's four sides. A foreign file's TRIMMED B-spline face (a triangle
// cut from a patch, a patch with a hole, an edge that bulges off the vertex box)
// would otherwise be read back as the whole rectangle -- a wrong solid returned
// as ok -- so it is refused with a reason, and importStep's ladder falls through
// to readForeignStep (which carries real trim regions) exactly as it did before
// B-spline faces were read.
//
// The rectangle is the (u,v) box of the loop vertices inverted onto the surface,
// EXCEPT on a CLOSED surface (first and last iso-lines coincide, e.g. a B-spline
// cylinder): a vertex ON the seam inverts to u = ua or u = ub indistinguishably.
// MEASURED (validator round 1): the 270->360 deg quarter of a split B-spline
// cylinder came back as u[0,0.75] instead of u[0.75,1] -- ok=1, volume +50.6 %.
// A seam vertex therefore does not bound the rectangle in that direction; the
// candidates are [ua,hi], [lo,ub] and [ua,ub] (lo/hi = the other vertices'
// extent), and the face is read only when EXACTLY ONE candidate has the whole
// boundary on its sides. A face that CROSSES the seam (315 -> 45 deg) has no
// rectangle in the knot domain at all: its vertex box is the face's complement,
// which the side test refuses.
//
// SIDE TEST. Every loop vertex and 7 interior samples of every edge (along the
// geometry the file gave it: Edge::curve as re-attached from the EDGE_CURVE, the
// straight chord when there was none) are inverted onto the surface ONCE. Each
// must lie on the surface and on the image of a side: p == S(u0,v*), S(u1,v*),
// S(u*,v0) or S(u*,v1), with u*, v* the sample's own inverted parameters CLAMPED
// INTO THE RECTANGLE. Without the clamp, a point of the iso-line v = v0 lying
// OUTSIDE [u0,u1] passed as "on side v0" -- how the wrong quarter was accepted.
// (On a seam sample the clamp may pick the far one of ua/ub for side v0, but such
// a point is on side u0 or u1, which needs no clamp in u.)
struct NurbsTrimSample { Vec3 p; double u, v; };

bool nurbsCoincide(const Vec3& a, const Vec3& p) {
    return vlen(vsub(a, p)) <= 1e-6 * std::max(1.0, vlen(p));
}

// True iff every sample lies on the image of a side of [u0,u1]x[v0,v1].
bool nurbsSamplesOnBox(const NurbsSurface& n, const std::vector<NurbsTrimSample>& S,
                       double u0, double u1, double v0, double v1) {
    for (const NurbsTrimSample& s : S) {
        const double cu = std::clamp(s.u, u0, u1), cv = std::clamp(s.v, v0, v1);   // T158-NURBS-BOX-CLAMP
        if (!nurbsCoincide(n.evaluate(u0, cv), s.p) && !nurbsCoincide(n.evaluate(u1, cv), s.p) &&
            !nurbsCoincide(n.evaluate(cu, v0), s.p) && !nurbsCoincide(n.evaluate(cu, v1), s.p))
            return false;   // T158-NURBS-TRIM-GUARD
    }
    return true;
}

// Sets f's (u,v) rectangle and vertexUV and returns true iff the B-spline face is
// exactly one rectangle of the knot domain (see above); otherwise `why` says why.
bool attachNurbsTrim(Face* f, const NurbsSurface& n, const std::vector<Vertex*>& ring,
                     std::string& why) {
    const char* const trimmed = "B-spline face is trimmed (an edge leaves its iso-parameter rectangle)";
    if (!f->innerLoops.empty()) { why = "B-spline face has an inner (hole) bound"; return false; }
    const Loop* lp = f->outerLoop;
    if (!lp || !lp->first || ring.empty()) { why = "B-spline face has no outer loop"; return false; }
    if (!n.valid()) { why = "B-spline surface does not validate"; return false; }
    const double ua = n.knotsU.front(), ub = n.knotsU.back();
    const double va = n.knotsV.front(), vb = n.knotsV.back();

    // A direction is CLOSED when the surface's first and last iso-lines coincide.
    bool closedU = true, closedV = true;
    for (int j = 0; j <= 8; ++j) {
        const double t = j / 8.0;
        const double v = va + t * (vb - va), u = ua + t * (ub - ua);
        closedU = closedU && nurbsCoincide(n.evaluate(ua, v), n.evaluate(ub, v));
        closedV = closedV && nurbsCoincide(n.evaluate(u, va), n.evaluate(u, vb));
    }

    // Loop vertices, inverted once; a vertex on a seam bounds nothing in that direction.
    auto invert = [&](NurbsTrimSample& s) {
        return invertNurbs(n, s.p, s.u, s.v) <= 1e-6 * std::max(1.0, vlen(s.p));
    };
    std::vector<NurbsTrimSample> S;
    std::vector<std::array<bool, 2>> seam;
    const double inf = std::numeric_limits<double>::infinity();
    double uLo = inf, uHi = -inf, vLo = inf, vHi = -inf;
    bool anySeamU = false, anySeamV = false;
    for (const Vertex* vx : ring) {
        NurbsTrimSample s{PV(vx->point), 0.0, 0.0};
        if (!invert(s)) { why = "a B-spline face loop vertex is not on its surface"; return false; }
        const bool su = closedU && nurbsCoincide(n.evaluate(ua, s.v), s.p), sv = closedV && nurbsCoincide(n.evaluate(s.u, va), s.p);   // T158-NURBS-SEAM
        if (su) anySeamU = true; else { uLo = std::min(uLo, s.u); uHi = std::max(uHi, s.u); }
        if (sv) anySeamV = true; else { vLo = std::min(vLo, s.v); vHi = std::max(vHi, s.v); }
        seam.push_back({su, sv});
        S.push_back(s);
    }
    // Interior samples of every loop edge.
    const Coedge* ce = lp->first;
    std::size_t guard = 0;
    do {
        const Edge* e = ce->edge;
        if (!e || !e->start || !e->end) { why = "B-spline face loop has a bare coedge"; return false; }
        for (int k = 1; k < 8; ++k) {
            const double fr = k / 8.0;
            NurbsTrimSample s{e->curve
                ? e->curve->evaluate(e->curve->t0 + fr * (e->curve->t1 - e->curve->t0))
                : vadd(PV(e->start->point), vscale(vsub(PV(e->end->point), PV(e->start->point)), fr)),
                0.0, 0.0};
            if (!invert(s)) { why = trimmed; return false; }   // the edge leaves the surface
            S.push_back(s);
        }
        ce = ce->next;
    } while (ce && ce != lp->first && ++guard < 1000000);

    // Candidate extents per direction (deduplicated, positive length only).
    auto extents = [](bool anySeam, double lo, double hi, double a, double b) {
        std::vector<std::array<double, 2>> r;
        if (lo <= hi) {
            if (anySeam) { r.push_back({a, hi}); r.push_back({lo, b}); }
            else r.push_back({lo, hi});
        }
        if (anySeam) r.push_back({a, b});
        r.erase(std::remove_if(r.begin(), r.end(),
                               [](const std::array<double, 2>& x) { return !(x[1] > x[0]); }), r.end());
        std::sort(r.begin(), r.end());
        r.erase(std::unique(r.begin(), r.end()), r.end());
        return r;
    };
    std::array<double, 4> box{};
    int fits = 0;
    for (const auto& eu : extents(anySeamU, uLo, uHi, ua, ub))
        for (const auto& ev : extents(anySeamV, vLo, vHi, va, vb))
            if (nurbsSamplesOnBox(n, S, eu[0], eu[1], ev[0], ev[1])) {
                box = {eu[0], eu[1], ev[0], ev[1]};
                ++fits;
            }
    if (fits == 0) { why = trimmed; return false; }
    if (fits > 1) {
        why = "B-spline face on a closed surface fits more than one (u,v) rectangle";
        return false;
    }
    f->u0 = box[0]; f->u1 = box[1]; f->v0 = box[2]; f->v1 = box[3];
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());
    for (std::size_t i = 0; i < ring.size(); ++i) {
        double u = S[i].u, v = S[i].v;   // a seam vertex takes the side its rectangle owns
        if (seam[i][0] && !(box[0] == ua && box[1] == ub)) u = (box[0] == ua) ? ua : ub;
        if (seam[i][1] && !(box[2] == va && box[3] == vb)) v = (box[2] == va) ? va : vb;
        f->vertexUV.push_back({u, v});
    }
    return true;
}

// ---------------------------------------------------------------------------
// CURVED QUADRIC FACE TRIM (T-270). attachTrim() gives a cylinder / cone /
// sphere / torus face the (u,v) BOX OF ITS LOOP VERTICES, and massProperties()
// integrates that box. The box IS the face only for a primitive's iso-parameter
// tiling. A face imported by readForeignStep carries its real trim as a (u,v)
// region (Face::regionUV) and generally is not its vertex box: a sector with a
// notch, a full ring split by a seam (the anchor unwrap drops one sub-arc and
// shifts the box), a wall with holes (the box ignores inner loops). MEASURED on
// the in-tree corpus at ed241f37: 35 of the 42 solids the import ladder reads
// via readForeignStep came back from write()->read() ok=1 with the WRONG
// volume, worst +111.9 %.
//
// THE RULE. Every loop of the face is walked: each coedge's origin vertex plus
// 7 interior samples along the edge's FILE geometry (Edge::curve as re-attached
// from the EDGE_CURVE, the straight chord when there was none), in the coedge's
// direction. Each sample must lie ON the surface (a chord of a curved edge does
// not -- refused). The samples are mapped to the surface's (u,v) with theta (and
// the torus' minor angle) unwrapped CONTINUOUSLY along the loop; a pole sample
// (sphere pole, cone apex: theta undefined) stands for the iso-segment between
// its neighbours' theta. Then:
//   * the outer loop traverses its (u,v) box exactly once (every sample on a box
//     side, |signed area| == box area), the face has no inner loop, and the box
//     is attachTrim()'s window (mod 2 pi): the face IS that rectangle -- kept
//     untouched (every native primitive tiling; byte-identical);
//   * otherwise, when every edge is a STRAIGHT segment in (u,v) (generator,
//     latitude / meridian / minor circle -- the edges whose (u,v) polygon is the
//     trim EXACTLY), the face is integrated over that region (regionUV: outer
//     polygon minus the hole polygons, the representation readForeignStep gives
//     the same face);
//   * otherwise -- an off-surface edge, an edge curved in (u,v), a loop that
//     winds around the axis (a full ring with no seam), a hole outside the outer
//     loop's (u,v) span -- the face is REFUSED with a reason, never read as a
//     wrong rectangle. importStep then falls through to readForeignStep;
//     FgCopyBody degrades to its honest mesh copy.
// ---------------------------------------------------------------------------
struct QuadSample {
    Vec3 p{};
    double u = 0.0, v = 0.0;
    bool pole = false;    // theta undefined (on the axis: sphere pole / cone apex)
};

// Raw parameters of p on the (attachTrim-normalised) quadric s: theta in
// (-pi,pi], v per Surface.hpp. Returns |S(u,v) - p|, the on-surface residual.
double quadricParams(const Surface& s, const Vec3& p, double tolP, QuadSample& q) {
    const Vec3 ax = vnorm(s.axis), rd = vnorm(s.refDir), bd = vcross(ax, rd);
    const Vec3 rel = vsub(p, s.origin);
    const double x = vdot(rel, rd), y = vdot(rel, bd), z = vdot(rel, ax);
    const double rho = std::sqrt(x * x + y * y);
    q.p = p;
    q.u = std::atan2(y, x);
    q.pole = (s.kind != SurfaceKind::Cylinder) && rho <= tolP;
    switch (s.kind) {
    case SurfaceKind::Cylinder: q.v = z; break;
    case SurfaceKind::Cone:     q.v = (std::fabs(s.param) > 0.0) ? z / s.param : 0.0; break;
    case SurfaceKind::Sphere: {
        const double R = vlen(rel);
        q.v = (R > 0.0) ? std::acos(std::max(-1.0, std::min(1.0, z / R))) : 0.0;
        break;
    }
    case SurfaceKind::Torus:    q.v = std::atan2(z, rho - s.r1); break;
    default: return std::numeric_limits<double>::infinity();
    }
    return vlen(vsub(s.evaluate(q.u, q.v), p));
}

// One walked loop: the samples in loop order, and for each coedge the index of
// its origin-vertex sample (interior samples follow it).
struct QuadLoop {
    std::vector<QuadSample> s;
    std::vector<std::size_t> vtx;
};

constexpr int kQuadEdgeSamples = 8;   // 7 interior samples per edge

// Walk `lp`, sample, check on-surface, unwrap theta (and the torus minor angle)
// continuously, and require the loop to close in (u,v) (zero net winding).
bool walkQuadricLoop(const Surface& s, const Loop* lp, double tolP, QuadLoop& out,
                     std::string& why) {
    const double PI = 3.14159265358979323846, TWO_PI = 2.0 * PI;
    out.s.clear(); out.vtx.clear();
    if (!lp || !lp->first) { why = "curved face has an empty loop"; return false; }
    const Coedge* ce = lp->first;
    std::size_t guard = 0;
    do {
        const Edge* e = ce->edge;
        if (!e || !e->start || !e->end) { why = "curved face loop has a bare coedge"; return false; }
        out.vtx.push_back(out.s.size());
        for (int k = 0; k < kQuadEdgeSamples; ++k) {
            const double fr = static_cast<double>(k) / kQuadEdgeSamples;
            const double t = ce->forward ? fr : 1.0 - fr;   // edge parameter fraction
            Vec3 p;
            if (k == 0) p = PV(ce->originVertex()->point);
            else if (e->curve) p = e->curve->evaluate(e->curve->t0 + t * (e->curve->t1 - e->curve->t0));
            else p = vadd(PV(e->start->point), vscale(vsub(PV(e->end->point), PV(e->start->point)), t));
            QuadSample q;
            if (quadricParams(s, p, tolP, q) > tolP) {   // T270-QUADRIC-ON-SURFACE
                why = "a boundary edge of a curved face leaves its surface (a chord of a curved edge)";
                return false;
            }
            out.s.push_back(q);
        }
        ce = ce->next;
    } while (ce && ce != lp->first && ++guard < 1000000);

    // Continuous unwrap along the loop, anchored on the first non-pole sample.
    const bool wrapV = (s.kind == SurfaceKind::Torus);
    bool have = false; double pu = 0.0, pv = 0.0, firstU = 0.0, firstV = 0.0;
    for (QuadSample& q : out.s) {
        if (q.pole) continue;
        if (have) {
            while (q.u - pu >  PI) q.u -= TWO_PI;
            while (q.u - pu < -PI) q.u += TWO_PI;
            if (wrapV) {
                while (q.v - pv >  PI) q.v -= TWO_PI;
                while (q.v - pv < -PI) q.v += TWO_PI;
            }
        } else { have = true; firstU = q.u; firstV = q.v; }
        pu = q.u; pv = q.v;
    }
    if (!have) { why = "curved face loop lies entirely on the surface axis"; return false; }
    // Closing step back to the first sample: the loop must not wind around the
    // axis (or the torus tube). A ring bounded by two full circles and no seam
    // has no (u,v) polygon.   T270-QUADRIC-WINDING
    auto winds = [&](double last, double first) {
        double d = first - last;
        while (d >  PI) d -= TWO_PI;
        while (d < -PI) d += TWO_PI;
        return std::fabs(last + d - first) > PI;
    };
    if (winds(pu, firstU) || (wrapV && winds(pv, firstV))) {
        why = "a loop of a curved face winds around the surface (a full ring with no seam edge)";
        return false;
    }
    return true;
}

// The (u,v) point of sample i of the loop; a pole sample takes the theta of the
// neighbouring non-pole sample on the side `fromNext` selects.
std::array<double, 2> quadUV(const QuadLoop& L, std::size_t i, bool fromNext) {
    const std::size_t n = L.s.size();
    if (!L.s[i].pole) return {L.s[i].u, L.s[i].v};
    for (std::size_t k = 1; k < n; ++k) {
        const std::size_t j = fromNext ? (i + k) % n : (i + n - k) % n;
        if (!L.s[j].pole) return {L.s[j].u, L.s[i].v};
    }
    return {0.0, L.s[i].v};
}

// The loop's (u,v) polygon over its VERTICES (a pole vertex contributes the two
// ends of its degenerate iso-segment), shifted by `du`.
std::vector<std::array<double, 2>> quadPolygon(const QuadLoop& L, double du) {
    std::vector<std::array<double, 2>> poly;
    auto push = [&](std::array<double, 2> p) {
        p[0] += du;
        if (!poly.empty() && poly.back()[0] == p[0] && poly.back()[1] == p[1]) return;
        poly.push_back(p);
    };
    for (std::size_t i : L.vtx) {
        if (L.s[i].pole) { push(quadUV(L, i, false)); push(quadUV(L, i, true)); }
        else push(quadUV(L, i, false));
    }
    if (poly.size() > 1 && poly.front() == poly.back()) poly.pop_back();
    return poly;
}

double signedArea(const std::vector<std::array<double, 2>>& P) {
    double a = 0.0;
    for (std::size_t i = 0; i < P.size(); ++i) {
        const auto& p = P[i];
        const auto& q = P[(i + 1) % P.size()];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return 0.5 * a;
}

// True iff every edge of the loop is a straight segment in (u,v): each interior
// sample is S() of the closest point of the (u,v) chord between its edge's ends
// (closest in the surface metric at the sample).
bool quadEdgesStraight(const Surface& s, const QuadLoop& L, double tolP) {
    const std::size_t nE = L.vtx.size(), n = L.s.size();
    for (std::size_t k = 0; k < nE; ++k) {
        const std::size_t ia = L.vtx[k], ib = (k + 1 < nE) ? L.vtx[k + 1] : n;
        const std::array<double, 2> A = quadUV(L, ia, true);
        const std::array<double, 2> B = quadUV(L, ib % n, false);
        const double du = B[0] - A[0], dv = B[1] - A[1];
        for (std::size_t i = ia + 1; i < ib; ++i) {
            const QuadSample& q = L.s[i];
            if (q.pole) continue;
            Vec3 P, Su, Sv;
            s.evaluateDeriv(q.u, q.v, P, Su, Sv);
            const double gu = vdot(Su, Su), gv = vdot(Sv, Sv);
            const double den = du * du * gu + dv * dv * gv;
            double lam = 0.0;
            if (den > 0.0) lam = ((q.u - A[0]) * du * gu + (q.v - A[1]) * dv * gv) / den;
            lam = std::max(0.0, std::min(1.0, lam));
            if (vlen(vsub(s.evaluate(A[0] + lam * du, A[1] + lam * dv), q.p)) > tolP) return false;
        }
    }
    return true;
}

// Decide the curved face's integration domain (see the block comment above).
bool verifyQuadricTrim(Face* f, const Surface& s, std::string& why) {
    const double PI = 3.14159265358979323846, TWO_PI = 2.0 * PI;
    // Positional tolerance: decodeEdgeCurve's 1e-7 relative, on the face's scale.
    double scale = 1.0;
    if (f->outerLoop && f->outerLoop->first) {
        const Coedge* ce = f->outerLoop->first;
        std::size_t g = 0;
        do {
            if (ce->edge && ce->edge->start) scale = std::max(scale, vlen(PV(ce->originVertex()->point)));
            ce = ce->next;
        } while (ce && ce != f->outerLoop->first && ++g < 1000000);
    }
    const double tolP = 1e-7 * scale;

    QuadLoop outer;
    if (!walkQuadricLoop(s, f->outerLoop, tolP, outer, why)) return false;
    double U0 = std::numeric_limits<double>::infinity(), U1 = -U0, V0 = U0, V1 = -U0;
    for (std::size_t i = 0; i < outer.s.size(); ++i) {
        const auto p = quadUV(outer, i, false);
        U0 = std::min(U0, p[0]); U1 = std::max(U1, p[0]);
        V0 = std::min(V0, p[1]); V1 = std::max(V1, p[1]);
    }
    const std::vector<std::array<double, 2>> poly = quadPolygon(outer, 0.0);
    const double boxArea = (U1 - U0) * (V1 - V0);

    // Is the outer loop its box, traversed once?   T270-QUADRIC-RECT
    bool isBox = boxArea > 0.0 &&
                 std::fabs(std::fabs(signedArea(poly)) - boxArea) <= 1e-9 * boxArea;
    for (std::size_t i = 0; isBox && i < outer.s.size(); ++i) {
        const QuadSample& q = outer.s[i];
        const auto p = quadUV(outer, i, false);
        auto on = [&](double uu, double vv) {
            return vlen(vsub(s.evaluate(uu, vv), q.p)) <= tolP;
        };
        isBox = on(U0, p[1]) || on(U1, p[1]) || on(p[0], V0) || on(p[0], V1);
    }
    if (isBox && f->innerLoops.empty()) {
        const double k = std::round((U0 - f->u0) / TWO_PI);
        const double tu = 1e-9 * std::max(1.0, std::fabs(U0) + std::fabs(U1));
        const double tv = 1e-9 * std::max(1.0, std::fabs(V0) + std::fabs(V1));
        if (std::fabs(U0 - k * TWO_PI - f->u0) <= tu && std::fabs((U1 - U0) - (f->u1 - f->u0)) <= tu &&
            std::fabs(V0 - f->v0) <= tv && std::fabs(V1 - f->v1) <= tv)
            return true;   // attachTrim's rectangle IS the face: untouched
    }

    // Not attachTrim's rectangle: integrate the real (u,v) region, if it is exact.
    if (!quadEdgesStraight(s, outer, tolP)) {   // T270-QUADRIC-UV-STRAIGHT
        why = "a curved face's trim is not its (u,v) rectangle and an edge is curved in (u,v)";
        return false;
    }
    if (!(std::fabs(signedArea(poly)) > 0.0)) {
        why = "a curved face's (u,v) trim polygon has no area";
        return false;
    }
    std::vector<std::vector<std::array<double, 2>>> holes;
    for (const Loop* hl : f->innerLoops) {
        QuadLoop H;
        if (!walkQuadricLoop(s, hl, tolP, H, why)) return false;
        if (!quadEdgesStraight(s, H, tolP)) {
            why = "an inner (hole) loop of a curved face is curved in (u,v)";
            return false;
        }
        // Place the hole in the outer loop's theta range (a whole turn shift).
        double hu0 = std::numeric_limits<double>::infinity(), hu1 = -hu0, hv0 = hu0, hv1 = -hu0;
        for (std::size_t i = 0; i < H.s.size(); ++i) {
            const auto p = quadUV(H, i, false);
            hu0 = std::min(hu0, p[0]); hu1 = std::max(hu1, p[0]);
            hv0 = std::min(hv0, p[1]); hv1 = std::max(hv1, p[1]);
        }
        const double shift = TWO_PI * std::round((0.5 * (U0 + U1) - 0.5 * (hu0 + hu1)) / TWO_PI);
        const double tu = 1e-9 * std::max(1.0, std::fabs(U0) + std::fabs(U1));
        const double tv = 1e-9 * std::max(1.0, std::fabs(V0) + std::fabs(V1));
        if (hu0 + shift < U0 - tu || hu1 + shift > U1 + tu || hv0 < V0 - tv || hv1 > V1 + tv) {
            why = "an inner (hole) loop of a curved face is not inside its outer loop's (u,v) span";
            return false;
        }
        holes.push_back(quadPolygon(H, shift));
    }
    f->regionOuterUV = poly;
    f->regionInnerUV = std::move(holes);
    f->regionUV = true;                     // T270-QUADRIC-REGION
    f->u0 = U0; f->u1 = U1; f->v0 = V0; f->v1 = V1;
    f->vertexUV.clear();
    for (std::size_t i : outer.vtx) {
        const auto a = quadUV(outer, i, false), b = quadUV(outer, i, true);
        f->vertexUV.push_back({0.5 * (a[0] + b[0]), a[1]});
    }
    return true;
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

    // ── DECLINE A FILE THAT IS NOT IN MILLIMETRES ────────────────────────────
    // This reader exists to round-trip FORGE'S OWN analytic dialect, which write()
    // below always emits as SI_UNIT(.MILLI.,.METRE.). Because Forge is the only
    // producer it was written for, it never resolved a unit context at all -- and
    // so it read a FOREIGN file declaring SI_UNIT($,.METRE.) raw, returning metres
    // where every other instrument returns millimetres. MEASURED: exactly 1000x on
    // every axis, which refused 359 otherwise round-trip-proved rows from the
    // STEP->IR corpus against 187 kept.
    //
    // ★ THE FIX IS TO DECLINE, NOT TO SCALE. Teaching this reader to scale would
    //   mean multiplying every length it produces -- getPoint(), getAxis2(), the
    //   radii in buildSurface(), circleOfEdgeCurve() -- a large new surface that
    //   duplicates logic readForeignStep() ALREADY HAS CORRECT (StepRead.cpp,
    //   which resolves and applies the same scale). Returning !ok here drops the
    //   file to that reader via IoExchange.cpp's ladder. A fast path specialised
    //   for one producer should REFUSE foreign input, not be generalised to it:
    //   refusing routes to code already proven, generalising writes code that can
    //   be wrong.
    {
        std::string unitName;
        const double scaleMm = resolveLengthScaleMm(tab, unitName);
        if (scaleMm != 1.0)
            return readFail("StepAnalytic.read: unit context is " + unitName +
                            " (scale " + std::to_string(scaleMm) +
                            " mm), not millimetres; deferring to the foreign reader");
    }

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

    // Walk an EDGE_LOOP (referenced by `loopId`) into an ordered ring of START
    // vertices + the per-edge circle, in the loop's traversal direction. Returns
    // false (with `err` set) on any malformed loop. Shared by the OUTER bound and
    // every INNER (hole) bound so a holed face reconstructs exactly as written.
    // EDGE_CURVE id of the edge LEAVING ring[i], per loop (for Edge::curve).
    std::vector<std::uint64_t> ringEdgeIds;
    auto buildRing = [&](std::uint64_t loopId,
                         std::vector<Vertex*>& ring,
                         std::vector<EdgeCircle>& ringCircles,
                         std::string& err) -> bool {
        ringEdgeIds.clear();
        auto litR = tab.find(loopId);
        if (litR == tab.end()) { err = "bound loop ref dangling"; return false; }
        if (litR->second.type != "EDGE_LOOP") { err = "bound is not an EDGE_LOOP"; return false; }
        auto lp = splitTopLevel(litR->second.params);
        std::vector<std::string> oeRefs;
        if (lp.size() != 2 || !parseList(lp[1], oeRefs) || oeRefs.size() < 3) {
            err = "EDGE_LOOP < 3 oriented edges"; return false;
        }
        ring.clear(); ringCircles.clear();
        ring.reserve(oeRefs.size()); ringCircles.reserve(oeRefs.size());
        for (const std::string& oref : oeRefs) {
            std::uint64_t oeId = 0;
            if (!parseRef(oref, oeId)) { err = "EDGE_LOOP holds a non-ref"; return false; }
            auto oit = tab.find(oeId);
            if (oit == tab.end() || oit->second.type != "ORIENTED_EDGE") { err = "loop member not ORIENTED_EDGE"; return false; }
            auto op = splitTopLevel(oit->second.params);
            if (op.size() != 5) { err = "ORIENTED_EDGE arity"; return false; }
            std::uint64_t ecId = 0;
            if (!parseRef(op[3], ecId)) { err = "ORIENTED_EDGE edge not a ref"; return false; }
            bool sense;
            if (op[4] == ".T.") sense = true;
            else if (op[4] == ".F.") sense = false;
            else { err = "ORIENTED_EDGE sense not .T./.F."; return false; }
            auto eit = tab.find(ecId);
            if (eit == tab.end() || eit->second.type != "EDGE_CURVE") { err = "edge is not EDGE_CURVE"; return false; }
            auto ep = splitTopLevel(eit->second.params);
            if (ep.size() != 5) { err = "EDGE_CURVE arity"; return false; }
            std::uint64_t vS = 0, vE = 0;
            if (!parseRef(ep[1], vS) || !parseRef(ep[2], vE)) { err = "EDGE_CURVE endpoints"; return false; }
            std::uint64_t startVp = sense ? vS : vE;
            Vertex* v = vertexForVP(startVp);
            if (!v) { err = "cannot resolve oriented-edge start vertex"; return false; }
            ring.push_back(v);
            ringCircles.push_back(circleOfEdgeCurve(tab, ecId));
            ringEdgeIds.push_back(ecId);
        }
        for (std::size_t k = 0; k < ring.size(); ++k)
            if (ring[k] == ring[(k + 1) % ring.size()]) { err = "degenerate loop (repeated vertex)"; return false; }
        return true;
    };

    std::size_t nAnalytic = 0, nPlanar = 0, nNurbs = 0, nEdgeCurves = 0;

    // Re-attach the exact edge geometry the file carries (T-158): walk the loop
    // just built — its coedges are in ring order — and decode each EDGE_CURVE
    // once per topological Edge. Geometry this reader does not understand leaves
    // Edge::curve empty (as before); it never fails the read.
    auto attachEdgeCurves = [&](Loop* lp, const std::vector<std::uint64_t>& ecIds) {
        if (!lp || !lp->first) return;
        Coedge* ce = lp->first;
        for (std::size_t k = 0; k < ecIds.size() && ce; ++k, ce = ce->next) {
            Edge* e = ce->edge;
            if (!e || e->curve) continue;
            Curve c;
            if (decodeEdgeCurve(tab, ecIds[k], PV(e->start->point), PV(e->end->point), c)) {
                e->curve = tb.makeCurve(c);
                ++nEdgeCurves;
            }
        }
    };

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

        // Classify the bounds: the FACE_OUTER_BOUND is the peripheral loop; every
        // FACE_BOUND is an inner (hole) loop — the round-trip sibling of the writer
        // (which emits FACE_OUTER_BOUND then one FACE_BOUND per Face::innerLoops). A
        // holed face thus reconstructs WITH its holes (previously the inner bounds
        // were dropped, filling the hole -> non-watertight + wrong COM/inertia).
        std::uint64_t loopId = 0;
        bool gotLoop = false;
        std::vector<std::uint64_t> innerLoopIds;
        for (const std::string& bref : boundRefs) {
            std::uint64_t bId = 0;
            if (!parseRef(bref, bId)) continue;
            auto bit = tab.find(bId);
            if (bit == tab.end()) continue;
            const bool isOuter = (bit->second.type == "FACE_OUTER_BOUND");
            if (!isOuter && bit->second.type != "FACE_BOUND") continue;
            auto bp = splitTopLevel(bit->second.params);
            if (bp.size() != 3) continue;
            std::uint64_t lId = 0;
            if (!parseRef(bp[1], lId)) continue;
            if (isOuter && !gotLoop) { loopId = lId; gotLoop = true; }
            else                     { innerLoopIds.push_back(lId); }
        }
        // No explicit FACE_OUTER_BOUND -> promote the first FACE_BOUND to the outer.
        if (!gotLoop) {
            if (innerLoopIds.empty())
                return readFail("StepAnalytic.read: ADVANCED_FACE has no usable bound loop");
            loopId = innerLoopIds.front();
            innerLoopIds.erase(innerLoopIds.begin());
            gotLoop = true;
        }

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

        // Build the OUTER ring (the legacy EDGE_LOOP walk, now factored into buildRing).
        std::vector<Vertex*> ring;
        std::vector<EdgeCircle> ringCircles;  // circle of the edge leaving ring[i]
        {
            std::string rerr;
            if (!buildRing(loopId, ring, ringCircles, rerr))
                return readFail("StepAnalytic.read: " + rerr);
        }

        // Build the face + outer loop (edges created on demand, shared+mated).
        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, ring);
        tb.addFaceToShell(shell, f);
        attachEdgeCurves(f->outerLoop, ringEdgeIds);

        // Attach the reconstructed analytic surface.
        Surface* surf = tb.makeSurface();
        Surface tmp;
        if (!buildSurface(tab, surfRef, sameSense, tmp, why))
            return readFail("StepAnalytic.read: " + why);
        *surf = tmp;
        f->surface = surf;
        if (surf->kind == SurfaceKind::Plane) ++nPlanar; else ++nAnalytic;
        if (surf->kind == SurfaceKind::Nurbs) ++nNurbs;

        // INNER (hole) loops -> addInnerLoopToFace (edges shared+mated with the bore
        // wall via the deduped VERTEX_POINTs). A PLANAR face that gains holes is
        // tagged boolHoled so the hole-aware mass integrator + annulus tessellation
        // treat it exactly as the boolean's holed face did — keeping a drilled-plate
        // STEP round-trip watertight + mass-exact.
        for (std::uint64_t innerId : innerLoopIds) {
            std::vector<Vertex*> hv;
            std::vector<EdgeCircle> hc;
            std::string rerr;
            if (!buildRing(innerId, hv, hc, rerr))
                return readFail("StepAnalytic.read: inner (hole) loop: " + rerr);
            if (hv.size() >= 3) attachEdgeCurves(tb.addInnerLoopToFace(f, hv), ringEdgeIds);
        }
        if (surf->kind == SurfaceKind::Plane && !f->innerLoops.empty())
            f->boolHoled = true;

        // Compute the face trim window (u0..v1) + vertexUV so the EXACT mass
        // integrator can integrate this face over the SAME parameterisation the
        // primitives use. For a PLANE we project the ring to the (refDir,binormal)
        // frame (exact polygon moments). For a quadric we recover each ring
        // vertex's parametric (u,v) — CRUCIALLY unwrapping the angular theta so a
        // sector that straddles the atan2 -pi/+pi seam stays a small contiguous
        // span (NOT a spurious full-circle sweep that would over-count its mass).
        // A B-spline face's window is its (u,v) rectangle, and only when the face
        // IS one (attachNurbsTrim, T-158).
        if (surf->kind == SurfaceKind::Nurbs) {
            std::string tw;
            if (!attachNurbsTrim(f, surf->nurbs, ring, tw))
                return readFail("StepAnalytic.read: " + tw + " -- only a B-spline face "
                                "that is its iso-parameter rectangle is read here; a "
                                "general trimmed B-spline face is readForeignStep's");
        } else if (std::string tw; !attachTrim(f, surf, ring, ringCircles, tw)) {
            return readFail("StepAnalytic.read: " +
                            (tw.empty() ? std::string("could not parameterise face over its "
                                                      "analytic surface (trim window)") : tw));
        } else if (surf->kind != SurfaceKind::Plane) {
            // T-270: the vertex box is the face only when the face IS that box.
            std::string tw;
            if (!verifyQuadricTrim(f, *surf, tw))   // T270-QUADRIC-TRIM-GUARD
                return readFail("StepAnalytic.read: " + tw + " -- refused rather than "
                                "read as the vertex (u,v) box; readForeignStep reads it");
        }
    }

    AnalyticReadResult r;
    r.ok = true;
    r.owner = owner;
    r.solid = solid;
    r.facesAnalytic = nAnalytic;
    r.facesPlanar = nPlanar;
    r.facesNurbs = nNurbs;
    r.edgesWithCurve = nEdgeCurves;
    return r;
}

} // namespace brep
} // namespace native
} // namespace forge
