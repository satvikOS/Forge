// forge/src/OcctNativeMesh.cpp  — K5 native meshing (replaces BRepMesh / TKMesh)
//
// See include/forge/OcctNativeMesh.hpp for the honesty statement. In one line:
// every face is TRIANGULATED in-house (shared adaptive edge discretisation +
// adaptive interior UV grid + the native constrained-Delaunay of the pure geom/
// engine); OCCT is only READ for surface points, 3D edge curves and 2D trim endpoints
// (TKBRep/TKG3d/TKGeomAlgo/TKTopAlgo — never TKMesh, and no longer TKG2d). No
// BRepMesh_IncrementalMesh symbol appears in this TU.
//
// BOUNDARY (u,v) RECOVERY: an interior/non-seam boundary vertex's (u,v) is recovered by
// NATIVE projection of its shared GLOBAL 3-D point onto this face's surface
// (GeomAPI_ProjectPointOnSurf — unambiguous for such edges). The one case projection
// cannot resolve is a SEAM edge on a FULL-WRAP periodic surface (sphere / cylinder /
// cone / torus, u:[0,2π]): its shared 3-D point maps to TWO (u,v) branches (u=umin and
// u=umax), so projection alone self-intersects the trim loop and the CDT fails. For seam
// edges we therefore read only the two 2-D ENDPOINTS the BRep stores for the edge on the
// face via BRep_Tool::UVPoints (TKBRep) — which, like CurveOnSurface, is ORIENTATION-
// CORRECT so the forward/reversed seam uses land on the two OPPOSITE boundaries — and
// LINEARLY interpolate between them. The seam p-curve is a straight ISO-LINE, so this
// reproduces it EXACTLY without evaluating any 2-D curve (Geom2d_Curve::Value, the last
// exclusive TKG2d symbol, is gone → TKG2d dropped, otool 15→14). An earlier K6 attempt
// that used projection for seams too DEFERRED on imported-STEP spheres for exactly the
// branch-ambiguity reason; the endpoint read fixes that without re-linking TKG2d.
//
// WATERTIGHTNESS: each unique edge is discretised ONCE (by 3-D chord/angle
// deflection on its own 3-D curve) and the resulting GLOBAL 3-D points are SHARED
// by every face that bounds it — so the two faces meeting at an edge emit the
// identical boundary vertices and the welded soup is crack-free (this is exactly
// what BRepMesh's shared polygon-on-triangulation buys, done natively here).

#include "forge/OcctNativeMesh.hpp"

#include "forge/native/geom/ConstrainedDelaunay2D.hpp"  // native CDT (OCCT-free)
#include "forge/native/geom/Geom.hpp"                   // geom::Point2

// OCCT surface/topology READ surface (NOT TKMesh):
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomAdaptor_Surface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <Poly_Triangle.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <tuple>
#include <vector>

namespace forge {
namespace occtmesh {

namespace {

namespace geom = ::forge::native::geom;

// ------------------------- adaptive parametric sampler -----------------------
// Refine a parametric segment [t0,t1] until the chord sag < linDefl AND the turn
// angle between successive chords < angDefl (curvature control), bounded by depth.
// `pointAt(t)` evaluates the 3-D point. Returns the ordered param list INCLUDING
// both ends — the midpoint-insertion refinement OCCT's BRepMesh uses, native here.
void adaptiveRec(const std::function<gp_Pnt(double)>& pointAt,
                 double t0, double t1, const gp_Pnt& p0, const gp_Pnt& p1,
                 double linDefl, double angDefl, int depth, int maxDepth,
                 std::vector<double>& out) {
    const double tm = 0.5 * (t0 + t1);
    const gp_Pnt pm = pointAt(tm);

    const gp_XYZ chordMid = (p0.XYZ() + p1.XYZ()) * 0.5;
    const double sag = (pm.XYZ() - chordMid).Modulus();

    const gp_XYZ d0 = pm.XYZ() - p0.XYZ();
    const gp_XYZ d1 = p1.XYZ() - pm.XYZ();
    double ang = 0.0;
    const double m0 = d0.Modulus(), m1 = d1.Modulus();
    if (m0 > 1e-12 && m1 > 1e-12) {
        double c = d0.Dot(d1) / (m0 * m1);
        if (c > 1.0) c = 1.0; else if (c < -1.0) c = -1.0;
        ang = std::acos(c);
    }

    if (depth < maxDepth && (sag > linDefl || ang > angDefl)) {
        adaptiveRec(pointAt, t0, tm, p0, pm, linDefl, angDefl, depth + 1, maxDepth, out);
        out.push_back(tm);
        adaptiveRec(pointAt, tm, t1, pm, p1, linDefl, angDefl, depth + 1, maxDepth, out);
    }
}

std::vector<double> adaptiveSample(const std::function<gp_Pnt(double)>& pointAt,
                                   double t0, double t1,
                                   double linDefl, double angDefl,
                                   int maxDepth = 11) {
    std::vector<double> ts;
    ts.push_back(t0);
    adaptiveRec(pointAt, t0, t1, pointAt(t0), pointAt(t1),
                linDefl, angDefl, 0, maxDepth, ts);
    ts.push_back(t1);
    return ts;
}

// ------------------------- shared per-edge discretisation --------------------
// One discretisation per unique edge (keyed on the underlying TShape), reused by
// every bounding face so shared boundary vertices are byte-identical => the soup
// welds crack-free. Points are GLOBAL (BRep_Tool::Curve applies the edge loc).
struct EdgeSamples {
    double              rf = 0.0, rl = 0.0;   // edge 3-D param range
    std::vector<double> t;                     // params (ascending, incl. ends)
    std::vector<gp_Pnt> p;                      // GLOBAL 3-D points at t (shared)
    bool                usable = false;         // false => no 3-D curve (degenerate)
};
// Keyed on the edge's (TShape + Location) identity — NOT the TShape alone. Two
// edges can share a TShape yet sit at different Locations (a MakePrism top ring is
// the bottom ring's TShape translated; a MakeRevol copy; a boolean operand placed by
// BRepBuilderAPI_Transform(copy=false)). Because es.p holds GLOBAL points
// (BRep_Tool::Curve applies the edge Location), a TShape-only key returned the
// first-visited instance's points for every co-TShape edge => phantom facets at the
// wrong place. TopTools_IndexedMapOfShape uses IsSame (TShape+Location, orientation-
// independent) and is collision-safe, so idx.Add(e) is a stable per-placed-edge key.
struct EdgeCache {
    TopTools_IndexedMapOfShape idx;          // unique placed-edge index (IsSame)
    std::map<int, EdgeSamples>  samples;     // idx -> discretisation
};

const EdgeSamples& edgeSamplesFor(const TopoDS_Edge& e, EdgeCache& cache,
                                  double linDefl, double angDefl) {
    const int key = cache.idx.Add(e);   // stable per (TShape+Location); IsSame, orient-independent
    auto it = cache.samples.find(key);
    if (it != cache.samples.end()) return it->second;

    EdgeSamples es;
    Standard_Real rf = 0.0, rl = 0.0;
    Handle(Geom_Curve) c3d = BRep_Tool::Curve(e, rf, rl);   // GLOBAL 3-D curve
    if (!c3d.IsNull() && rl > rf) {
        es.rf = rf; es.rl = rl;
        auto P = [&](double t) -> gp_Pnt { return c3d->Value(t); };
        es.t = adaptiveSample(P, rf, rl, linDefl, angDefl);
        es.p.reserve(es.t.size());
        for (double t : es.t) es.p.push_back(c3d->Value(t));
        es.usable = es.p.size() >= 2;
    }
    auto res = cache.samples.emplace(key, std::move(es));
    return res.first->second;
}

// ------------------------------ per-face native mesh -------------------------
// GLOBAL-frame triangulation of a single OCCT face. Boundary vertices come from
// the SHARED edge cache (watertight); interior vertices from an adaptive UV grid.
struct FaceMesh {
    std::vector<gp_Pnt>            nodes;   // GLOBAL coordinates
    std::vector<std::array<int,3>> tris;    // 0-indexed, outward-consistent winding
    TopLoc_Location               loc;      // face location (for local re-frame)
    bool                          ok = false;
};

int isoSegments(const std::function<gp_Pnt(double)>& pointAt,
                double a, double b, double linDefl, double angDefl) {
    if (!(b > a)) return 1;
    std::vector<double> ts = adaptiveSample(pointAt, a, b, linDefl, angDefl, 9);
    int segs = static_cast<int>(ts.size()) - 1;
    if (segs < 1) segs = 1;
    if (segs > 96) segs = 96;   // bound interior-grid cost
    return segs;
}

FaceMesh tessellateFace(const TopoDS_Face& face, EdgeCache& cache,
                        double linDefl, double angDefl) {
    FaceMesh out;

    Handle(Geom_Surface) surf = BRep_Tool::Surface(face, out.loc);
    if (surf.IsNull()) return out;
    const gp_Trsf locTr = out.loc.Transformation();

    double umin, umax, vmin, vmax;
    BRepTools::UVBounds(face, umin, umax, vmin, vmax);
    if (!(umax > umin) || !(vmax > vmin)) return out;

    auto Sloc = [&](double u, double v) -> gp_Pnt { return surf->Value(u, v); };
    auto Sglob = [&](double u, double v) -> gp_Pnt { return surf->Value(u, v).Transformed(locTr); };

    // Parallel arrays: 2-D CDT point, and the GLOBAL 3-D point.
    std::vector<geom::Point2> P2;
    std::vector<gp_Pnt>       p3;   // GLOBAL
    std::vector<gp_Pnt2d>     uvP;  // param (for winding centroid)
    auto addPt = [&](double u, double v, const gp_Pnt& gpos) -> int {
        int id = static_cast<int>(P2.size());
        P2.push_back(geom::Point2{u, v});
        p3.push_back(gpos);
        uvP.push_back(gp_Pnt2d(u, v));
        return id;
    };

    // ---- native (u,v) recovery — NO OCCT p-curve (drops the last TKG2d symbol) ----
    // Each boundary vertex's (u,v) is recovered by PROJECTING its shared GLOBAL 3-D
    // point onto THIS face's surface (GeomAPI_ProjectPointOnSurf, TKGeomAlgo — kept),
    // reproducing exactly what Geom2d_Curve::Value read from the stored p-curve, but
    // without evaluating any 2-D curve. Seams and poles — where a 3-D point maps to
    // TWO (u,v) branches so projection alone is ambiguous — are disambiguated NATIVELY
    // from surface periodicity + edge topology (BRep_Tool::IsClosed / no-3-D-curve),
    // so the reconstructed loop is the same crack-free trim rectangle.
    GeomAdaptor_Surface gsurf(surf);
    const bool    uPer    = gsurf.IsUPeriodic();
    const bool    vPer    = gsurf.IsVPeriodic();
    const double  uPeriod = uPer ? gsurf.UPeriod() : 0.0;
    const double  vPeriod = vPer ? gsurf.VPeriod() : 0.0;
    const gp_Trsf invTr   = locTr.Inverted();
    const double  umid    = 0.5 * (umin + umax);
    const double  vmid    = 0.5 * (vmin + vmax);

    // interior-grid density (also used to subdivide a pole-bridge boundary).
    const int nU = isoSegments([&](double u) { return Sloc(u, vmid); }, umin, umax, linDefl, angDefl);
    const int nV = isoSegments([&](double v) { return Sloc(umid, v); }, vmin, vmax, linDefl, angDefl);

    GeomAPI_ProjectPointOnSurf projector;
    // shift a periodic coord by k*period to lie nearest `target` (continuity / box-pin).
    auto shiftNear = [](double val, double period, bool per, double target) -> double {
        if (!per || period <= 0.0) return val;
        double best = val, bd = std::fabs(val - target);
        for (int k = -3; k <= 3; ++k) {
            const double c = val + k * period, d = std::fabs(c - target);
            if (d < bd) { bd = d; best = c; }
        }
        return best;
    };
    // shift a whole (already locally-continuous) coord run by one k*period to minimise
    // its total excursion outside the face box [lo,hi] — re-pins a full-wrap ring (e.g.
    // a cylinder base circle) back into the face's own [umin,umax] the interior grid uses.
    auto fitToBox = [](std::vector<double>& c, double period, bool per, double lo, double hi) {
        if (!per || period <= 0.0 || c.empty()) return;
        double bestK = 0.0, bestCost = 1e300;
        for (int k = -3; k <= 3; ++k) {
            double cost = 0.0;
            for (double v : c) {
                const double x = v + k * period;
                if (x < lo) cost += lo - x; else if (x > hi) cost += x - hi;
            }
            if (cost < bestCost) { bestCost = cost; bestK = static_cast<double>(k); }
        }
        if (bestK != 0.0) for (double& v : c) v += bestK * period;
    };
    // bounded projection of a GLOBAL 3-D point onto this face's surface → (u,v).
    auto projectUV = [&](const gp_Pnt& gpos, double& u, double& v) -> bool {
        const gp_Pnt lp = gpos.Transformed(invTr);
        projector.Init(lp, surf, umin, umax, vmin, vmax);
        if (!projector.IsDone() || projector.NbPoints() < 1) {
            projector.Init(lp, surf);
            if (!projector.IsDone() || projector.NbPoints() < 1) return false;
        }
        projector.LowerDistanceParameters(u, v);
        return true;
    };

    // resolved boundary samples for one edge (wire-forward, INCLUDING both endpoints).
    struct EdgeUV {
        std::vector<gp_Pnt2d> uv;
        std::vector<gp_Pnt>   p3;
        bool pole = false;    // no 3-D curve (collapsed / pole edge) — bridged from neighbours
    };
    // continuity anchor: the (u,v) of the last NON-seam, NON-pole edge processed.
    double lastU = umid, lastV = vmid;
    bool   haveAnchor = false;
    // A seam edge appears TWICE in the wire (fwd + rev) with the SAME (TShape+Location)
    // cache key; its two uses MUST land on OPPOSITE parameter boundaries (u=umin vs umax,
    // or v=vmin vs vmax) or the trim rectangle collapses. Record the first use's boundary
    // keyed by the shared edge id so the second use takes the opposite side.
    std::map<int, double> uSeamPin, vSeamPin;

    auto resolveEdge = [&](const TopoDS_Edge& e, EdgeUV& er) -> bool {
        const EdgeSamples& es = edgeSamplesFor(e, cache, linDefl, angDefl);
        if (!es.usable) { er.pole = true; return true; }   // no 3-D curve ⇒ collapsed edge; bridge later
        const int  key  = cache.idx.Add(e);   // idempotent; SAME id for both seam uses (IsSame)
        const bool rev  = (e.Orientation() == TopAbs_REVERSED);
        const bool seam = (BRep_Tool::IsClosed(e, face) == Standard_True);
        const int  n    = static_cast<int>(es.t.size());
        if (n < 2) return false;

        // ---- SEAM (u,v): reconstruct the ISO-LINE trim from its stored 2-D endpoints ----
        // A seam edge (BRep_Tool::IsClosed) sits on a pinned parameter boundary and its
        // stored p-curve is a straight ISO-LINE (constant u OR constant v) — sphere /
        // cylinder / cone / torus, u:[0,2π] and periodic B-spline seams. We read only the
        // edge's two 2-D ENDPOINTS via BRep_Tool::UVPoints (TKBRep, NOT TKG2d): like
        // CurveOnSurface it is ORIENTATION-CORRECT, so a seam edge's forward and reversed
        // uses return the two OPPOSITE-boundary endpoints (u=umin vs u=umax) automatically —
        // the exact disambiguation a 3-D-point projection cannot do. LINEARLY interpolating
        // between those endpoints at the same param fraction reproduces the p-curve EXACTLY
        // for an iso-line — WITHOUT evaluating any 2-D curve, so the last exclusive TKG2d
        // symbol (Geom2d_Curve::Value) is gone while the seam branch is preserved. The
        // shared GLOBAL 3-D point es.p[k] is still the node position (watertight weld); the
        // endpoints only fix the trim rectangle for the native CDT. A full-wrap seam has
        // endpoints DISTINCT in param space (e.g. (0,0) and (0,2π)) even where the 3-D
        // point coincides, so the interpolated run spans the whole face. Non-seam edges —
        // whose p-curve may be an arbitrary (non-iso) curve — fall through to unambiguous
        // 3-D-point projection below (projection is exact for them; only the periodic seam
        // branch was ever ambiguous).
        if (seam) {
            gp_Pnt2d uvF, uvL;
            BRep_Tool::UVPoints(e, face, uvF, uvL);   // endpoints at pf..pl (edge param dir), oriented
            const double dseg = std::hypot(uvL.X() - uvF.X(), uvL.Y() - uvF.Y());
            if (dseg > 1e-12) {   // stored endpoints exist & are non-degenerate
                const double span = (es.rl > es.rf) ? (es.rl - es.rf) : 1.0;
                er.uv.reserve(n); er.p3.reserve(n);
                for (int s = 0; s < n; ++s) {
                    const int k = rev ? (n - 1 - s) : s;   // wire-forward order
                    const double g = (es.t[k] - es.rf) / span;   // param fraction (0 at pf, 1 at pl)
                    er.uv.emplace_back(uvF.X() + (uvL.X() - uvF.X()) * g,
                                       uvF.Y() + (uvL.Y() - uvF.Y()) * g);
                    er.p3.push_back(es.p[k]);
                }
                return true;
            }
            // no usable stored endpoints ⇒ fall through to the projection seam handling.
        }

        std::vector<double> ru(n), rv(n);
        std::vector<gp_Pnt> gp(n);
        for (int s = 0; s < n; ++s) {
            const int k = rev ? (n - 1 - s) : s;   // wire-forward order
            gp[s] = es.p[k];
            if (!projectUV(gp[s], ru[s], rv[s])) return false;
        }

        // POLE (apex) snapping: at a parametric pole the u- (or v-) surface derivative
        // vanishes, so the projected u (or v) there is ARBITRARY — a meridian meeting a
        // pole vertex would otherwise spike the loop off its iso-line and self-intersect
        // (a sphere octant / cone apex). Detect degenerate samples (|S_u| or |S_v| ≈ 0)
        // and snap that coordinate to the nearest NON-degenerate neighbour on the edge,
        // reproducing the p-curve's iso-line branch natively.
        std::vector<char> uDeg(n, 0), vDeg(n, 0);
        {
            std::vector<double> mu(n), mv(n);
            double maxU = 0.0, maxV = 0.0;
            for (int s = 0; s < n; ++s) {
                gp_Pnt sp; gp_Vec du, dv;
                surf->D1(ru[s], rv[s], sp, du, dv);
                mu[s] = du.Magnitude(); mv[s] = dv.Magnitude();
                maxU = std::max(maxU, mu[s]); maxV = std::max(maxV, mv[s]);
            }
            for (int s = 0; s < n; ++s) {
                uDeg[s] = (maxU > 0.0 && mu[s] < 1e-3 * maxU) ? 1 : 0;
                vDeg[s] = (maxV > 0.0 && mv[s] < 1e-3 * maxV) ? 1 : 0;
            }
            auto snap = [&](std::vector<double>& c, const std::vector<char>& deg) {
                for (int s = 0; s < n; ++s) {
                    if (!deg[s]) continue;
                    int best = -1, bd = n + 1;
                    for (int o = 0; o < n; ++o)
                        if (!deg[o] && std::abs(o - s) < bd) { bd = std::abs(o - s); best = o; }
                    if (best >= 0) c[s] = c[best];
                }
            };
            snap(ru, uDeg);
            snap(rv, vDeg);
        }

        // forward local-continuity (kill periodic branch jumps ALONG the edge)…
        for (int s = 1; s < n; ++s) {
            if (!uDeg[s]) ru[s] = shiftNear(ru[s], uPeriod, uPer, ru[s - 1]);
            if (!vDeg[s]) rv[s] = shiftNear(rv[s], vPeriod, vPer, rv[s - 1]);
        }
        // …then re-pin the whole run into this face's parameter box.
        fitToBox(ru, uPeriod, uPer, umin, umax);
        fitToBox(rv, vPeriod, vPer, vmin, vmax);

        if (seam) {
            // A seam edge sits on a pinned param boundary; recover which axis is pinned
            // (the near-constant one) and place the two seam uses on OPPOSITE boundaries.
            const double uSpan = *std::max_element(ru.begin(), ru.end()) - *std::min_element(ru.begin(), ru.end());
            const double vSpan = *std::max_element(rv.begin(), rv.end()) - *std::min_element(rv.begin(), rv.end());
            const bool uSeam = uPer && (!vPer || uSpan <= vSpan);
            const bool vSeam = vPer && !uSeam;
            if (uSeam) {
                double pin;
                auto it = uSeamPin.find(key);
                if (it != uSeamPin.end()) {        // 2nd use ⇒ the OPPOSITE boundary
                    pin = (std::fabs(it->second - umin) < std::fabs(it->second - umax)) ? umax : umin;
                } else {                           // 1st use ⇒ anchor to the adjoining edge (else orient)
                    if (haveAnchor) pin = (std::fabs(umin - lastU) <= std::fabs(umax - lastU)) ? umin : umax;
                    else            pin = rev ? umax : umin;
                    uSeamPin[key] = pin;
                }
                er.uv.reserve(n); er.p3.reserve(n);
                for (int s = 0; s < n; ++s) { er.uv.emplace_back(pin, rv[s]); er.p3.push_back(gp[s]); }
                return true;
            }
            if (vSeam) {
                double pin;
                auto it = vSeamPin.find(key);
                if (it != vSeamPin.end()) {
                    pin = (std::fabs(it->second - vmin) < std::fabs(it->second - vmax)) ? vmax : vmin;
                } else {
                    if (haveAnchor) pin = (std::fabs(vmin - lastV) <= std::fabs(vmax - lastV)) ? vmin : vmax;
                    else            pin = rev ? vmax : vmin;
                    vSeamPin[key] = pin;
                }
                er.uv.reserve(n); er.p3.reserve(n);
                for (int s = 0; s < n; ++s) { er.uv.emplace_back(ru[s], pin); er.p3.push_back(gp[s]); }
                return true;
            }
            // undetermined seam ⇒ fall through to the regular embedding
        }
        er.uv.reserve(n); er.p3.reserve(n);
        for (int s = 0; s < n; ++s) { er.uv.emplace_back(ru[s], rv[s]); er.p3.push_back(gp[s]); }
        lastU = ru[n - 1]; lastV = rv[n - 1]; haveAnchor = true;
        return true;
    };

    // ---- boundary loops: SHARED edge samples embedded in this face's UV ---------
    std::vector<geom::ConstraintEdge> cons;
    int wireCount = 0;
    for (TopExp_Explorer wexp(face, TopAbs_WIRE); wexp.More(); wexp.Next()) {
        const TopoDS_Wire wire = TopoDS::Wire(wexp.Current());
        std::vector<TopoDS_Edge> wedges;
        for (BRepTools_WireExplorer we(wire, face); we.More(); we.Next())
            wedges.push_back(we.Current());
        const int ne = static_cast<int>(wedges.size());
        if (ne == 0) continue;

        std::vector<EdgeUV> ex(ne);
        bool ok = true;
        for (int i = 0; i < ne; ++i) if (!resolveEdge(wedges[i], ex[i])) { ok = false; break; }
        if (!ok) return out;   // HONEST DEFERRAL: an edge we could not read

        // fill collapsed (pole) edges: bridge in (u,v) from the previous edge's last
        // vertex to the next edge's first vertex; every 3-D point is the collapsed pole.
        for (int i = 0; i < ne; ++i) {
            if (!ex[i].pole) continue;
            int pi = (i - 1 + ne) % ne;
            for (int c = 0; c < ne && ex[pi].uv.empty(); ++c) pi = (pi - 1 + ne) % ne;
            int ni = (i + 1) % ne;
            for (int c = 0; c < ne && ex[ni].uv.empty(); ++c) ni = (ni + 1) % ne;
            if (ex[pi].uv.empty() || ex[ni].uv.empty()) return out;
            const gp_Pnt2d a = ex[pi].uv.back();
            const gp_Pnt2d b = ex[ni].uv.front();
            const gp_Pnt   pole = ex[pi].p3.back();   // the collapsed vertex (shared 3-D)
            const int nb = std::max(1, std::min(nU + nV, 96));
            ex[i].uv.reserve(nb + 1); ex[i].p3.reserve(nb + 1);
            for (int s = 0; s <= nb; ++s) {
                const double t = static_cast<double>(s) / nb;
                ex[i].uv.emplace_back(a.X() + (b.X() - a.X()) * t, a.Y() + (b.Y() - a.Y()) * t);
                ex[i].p3.push_back(pole);
            }
        }

        // stitch: append every edge's samples EXCEPT its last (next edge repeats it).
        std::vector<int> loop;
        for (int i = 0; i < ne; ++i) {
            const EdgeUV& er = ex[i];
            const int m = static_cast<int>(er.uv.size());
            for (int s = 0; s + 1 < m; ++s)
                loop.push_back(addPt(er.uv[s].X(), er.uv[s].Y(), er.p3[s]));
        }
        if (loop.size() < 3) continue;      // degenerate wire — skip
        const int nlp = static_cast<int>(loop.size());
        for (int k = 0; k < nlp; ++k)
            cons.push_back(geom::ConstraintEdge{loop[k], loop[(k + 1) % nlp]});
        ++wireCount;
    }
    if (wireCount == 0 || cons.size() < 3) return out;

    // ---- adaptive interior UV grid (only points strictly inside the trim) ------
    if (nU > 1 && nV > 1) {
        BRepTopAdaptor_FClass2d fclass(face, 1e-9);
        const double du = (umax - umin) / nU;
        const double dv = (vmax - vmin) / nV;
        for (int i = 1; i < nU; ++i) {
            const double u = umin + i * du;
            for (int j = 1; j < nV; ++j) {
                const double v = vmin + j * dv;
                if (fclass.Perform(gp_Pnt2d(u, v)) == TopAbs_IN)
                    addPt(u, v, Sglob(u, v));   // free interior point (no constraint)
            }
        }
    }

    // ---- native constrained Delaunay in UV, keep the trimmed interior ----------
    geom::CDTResult r = geom::constrainedDelaunay2D(P2, cons);
    if (!r.ok || r.triangles.empty()) return out;

    std::vector<int> remap(p3.size(), -1);
    auto nodeOf = [&](int orig) -> int {
        if (orig < 0 || orig >= static_cast<int>(p3.size())) return -1;
        if (remap[orig] < 0) {
            remap[orig] = static_cast<int>(out.nodes.size());
            out.nodes.push_back(p3[orig]);
        }
        return remap[orig];
    };

    for (std::size_t t = 0; t < r.triangles.size(); ++t) {
        if (t < r.inside.size() && !r.inside[t]) continue;   // outside the trim
        const auto& tr = r.triangles[t];
        int orig[3];
        bool good = true;
        double cu = 0.0, cv = 0.0;
        for (int kk = 0; kk < 3; ++kk) {
            int li = tr[kk];
            if (li < 0 || li >= static_cast<int>(r.inputIndex.size())) { good = false; break; }
            orig[kk] = r.inputIndex[li];
            if (orig[kk] < 0 || orig[kk] >= static_cast<int>(p3.size())) { good = false; break; }
            cu += uvP[orig[kk]].X();
            cv += uvP[orig[kk]].Y();
        }
        if (!good) continue;
        const int a = nodeOf(orig[0]), b = nodeOf(orig[1]), c = nodeOf(orig[2]);
        if (a < 0 || b < 0 || c < 0 || a == b || b == c || a == c) continue;

        // Outward-consistent winding: GLOBAL surface normal at the triangle
        // centroid, flipped for a REVERSED face, decides the vertex order.
        cu /= 3.0; cv /= 3.0;
        gp_Pnt sp; gp_Vec d1u, d1v;
        surf->D1(cu, cv, sp, d1u, d1v);
        gp_XYZ sn = d1u.Crossed(d1v).Transformed(locTr).XYZ();   // rotation only
        if (face.Orientation() == TopAbs_REVERSED) sn.Reverse();

        const gp_XYZ triN =
            (out.nodes[b].XYZ() - out.nodes[a].XYZ())
            .Crossed(out.nodes[c].XYZ() - out.nodes[a].XYZ());
        if (triN.Dot(sn) < 0.0)
            out.tris.push_back({a, c, b});
        else
            out.tris.push_back({a, b, c});
    }

    out.ok = !out.tris.empty();
    return out;
}

}  // namespace

// ------------------------------ public: soup ---------------------------------
bool tessellateShapeToSoup(const TopoDS_Shape& shape,
                           std::vector<double>& pos,
                           std::vector<std::uint32_t>& idx,
                           double linDefl,
                           double angDefl,
                           int* deferredFaces) {
    pos.clear();
    idx.clear();
    if (deferredFaces) *deferredFaces = 0;
    if (shape.IsNull()) return false;

    // Global weld: shared edge vertices are byte-identical, so this collapses them
    // (and any near-coincident interior vertex) to one id — a crack-free soup.
    constexpr double kWeldTol = 1e-7;
    std::map<std::tuple<long long, long long, long long>, std::uint32_t> weld;
    auto vid = [&](const gp_Pnt& p) -> std::uint32_t {
        auto q = [](double v) { return static_cast<long long>(std::llround(v / kWeldTol)); };
        auto key = std::make_tuple(q(p.X()), q(p.Y()), q(p.Z()));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        std::uint32_t id = static_cast<std::uint32_t>(pos.size() / 3);
        pos.push_back(p.X()); pos.push_back(p.Y()); pos.push_back(p.Z());
        weld.emplace(key, id);
        return id;
    };

    EdgeCache cache;
    bool anyFace = false;
    int total = 0, deferred = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face face = TopoDS::Face(ex.Current());
        ++total;
        FaceMesh fm = tessellateFace(face, cache, linDefl, angDefl);
        if (!fm.ok) { ++deferred; continue; }   // PER-FACE HONEST DEFERRAL (below)
        anyFace = true;
        for (const auto& t : fm.tris) {
            const std::uint32_t a = vid(fm.nodes[t[0]]);
            const std::uint32_t b = vid(fm.nodes[t[1]]);
            const std::uint32_t c = vid(fm.nodes[t[2]]);
            if (a == b || b == c || a == c) continue;   // welded-degenerate
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
        }
    }
    // PER-FACE FALLBACK (was a whole-shape deferral): one unmeshable face no
    // longer empties the whole soup — every meshable face is emitted and the
    // deferred count is reported honestly. Display/mesh consumers tolerate a
    // partial (non-watertight) soup; a consumer that NEEDS watertightness must
    // check the report (deferred>0 => the soup has boundary cracks there).
    if (deferred > 0) {
        std::fprintf(stderr,
            "[K5][soup] %d/%d faces DEFERRED (no BRepMesh — unresolvable trim) "
            "— PARTIAL mesh emitted\n", deferred, total);
    }
    if (deferredFaces) *deferredFaces = deferred;
    return anyFace && !idx.empty();
}

// ------------------------- public: viewport display contract -----------------
// Smooth-normal accumulation identical to the BRepMesh readback in
// src/Tessellate.cpp (area-weighted per-triangle face normal summed onto each
// vertex, renormalised once per face) — so switching the display mesher from
// BRepMesh to this native path is shading-identical.
namespace {
inline void vpAccumulate(float* dst, const gp_Vec& n) {
    dst[0] += static_cast<float>(n.X());
    dst[1] += static_cast<float>(n.Y());
    dst[2] += static_cast<float>(n.Z());
}
inline void vpRenormalize(float* n) {
    const float l = std::sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    if (l > 1e-20f) { n[0] /= l; n[1] /= l; n[2] /= l; }
    else            { n[0] = 0.0f; n[1] = 0.0f; n[2] = 1.0f; }
}
}  // namespace

bool tessellateShapeForViewport(const TopoDS_Shape& shape,
                                std::vector<float>& positions,
                                std::vector<float>& normals,
                                std::vector<std::uint32_t>& indices,
                                std::vector<std::uint32_t>& faceIds,
                                double linDefl,
                                double angDefl) {
    positions.clear(); normals.clear(); indices.clear(); faceIds.clear();
    if (shape.IsNull()) return false;

    EdgeCache cache;
    std::uint32_t faceId = 0;   // 1-based, TopExp_Explorer(FACE) order (picking id)
    bool anyFace = false;
    int deferred = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face face = TopoDS::Face(ex.Current());
        ++faceId;
        FaceMesh fm = tessellateFace(face, cache, linDefl, angDefl);
        if (!fm.ok) {
            // PER-FACE HONEST DEFERRAL (was whole-shape): skip only THIS face —
            // faceId still advances so picking ids stay stable. The viewport
            // tolerates the hole; the count is reported below.
            ++deferred;
            continue;
        }
        anyFace = true;

        // Per-face vertex block (mirrors Tessellate.cpp: OCCT emits seam verts per
        // face; the position-weld in the consumer/gate collapses shared-edge verts
        // — which our GLOBAL shared-edge nodes make byte-identical across faces).
        const std::uint32_t base =
            static_cast<std::uint32_t>(positions.size() / 3);
        for (const gp_Pnt& p : fm.nodes) {
            positions.push_back(static_cast<float>(p.X()));
            positions.push_back(static_cast<float>(p.Y()));
            positions.push_back(static_cast<float>(p.Z()));
        }
        const std::size_t normalsBase = normals.size();
        normals.resize(normalsBase + 3 * fm.nodes.size(), 0.0f);

        for (const auto& t : fm.tris) {
            const gp_Pnt& p1 = fm.nodes[t[0]];
            const gp_Pnt& p2 = fm.nodes[t[1]];
            const gp_Pnt& p3 = fm.nodes[t[2]];
            // fm.tris already wound outward-consistent, so this normal points OUT.
            const gp_Vec n = gp_Vec(p1, p2).Crossed(gp_Vec(p1, p3));
            if (n.SquareMagnitude() < 1e-30) continue;   // degenerate — skip
            vpAccumulate(normals.data() + normalsBase + 3 * t[0], n);
            vpAccumulate(normals.data() + normalsBase + 3 * t[1], n);
            vpAccumulate(normals.data() + normalsBase + 3 * t[2], n);
            indices.push_back(base + static_cast<std::uint32_t>(t[0]));
            indices.push_back(base + static_cast<std::uint32_t>(t[1]));
            indices.push_back(base + static_cast<std::uint32_t>(t[2]));
            faceIds.push_back(faceId);
        }
        for (std::size_t i = 0; i < fm.nodes.size(); ++i)
            vpRenormalize(normals.data() + normalsBase + 3 * i);
    }
    if (deferred > 0) {
        std::fprintf(stderr,
            "[K5][viewport] %u face(s) of %u DEFERRED (no BRepMesh) — PARTIAL "
            "display mesh emitted\n", static_cast<unsigned>(deferred),
            static_cast<unsigned>(faceId));
    }
    return anyFace && !indices.empty();
}

// ------------------------- public: attach in place (HLR) ---------------------
bool triangulateShapeInPlace(const TopoDS_Shape& shape,
                             double linDefl,
                             double angDefl) {
    if (shape.IsNull()) return false;
    BRep_Builder builder;
    EdgeCache cache;
    bool any = false;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face face = TopoDS::Face(ex.Current());
        FaceMesh fm = tessellateFace(face, cache, linDefl, angDefl);
        if (!fm.ok || fm.nodes.empty() || fm.tris.empty()) continue;

        // An attached triangulation is stored in the face's LOCAL frame; our nodes
        // are GLOBAL, so re-frame them by the inverse of the face location.
        const gp_Trsf inv = fm.loc.Transformation().Inverted();

        Handle(Poly_Triangulation) tri = new Poly_Triangulation(
            static_cast<Standard_Integer>(fm.nodes.size()),
            static_cast<Standard_Integer>(fm.tris.size()),
            /*hasUV*/ Standard_False);
        for (std::size_t i = 0; i < fm.nodes.size(); ++i)
            tri->SetNode(static_cast<Standard_Integer>(i + 1),
                         fm.nodes[i].Transformed(inv));
        for (std::size_t i = 0; i < fm.tris.size(); ++i)
            tri->SetTriangle(static_cast<Standard_Integer>(i + 1),
                             Poly_Triangle(fm.tris[i][0] + 1,
                                           fm.tris[i][1] + 1,
                                           fm.tris[i][2] + 1));
        builder.UpdateFace(face, tri);
        any = true;
    }
    return any;
}

}  // namespace occtmesh
}  // namespace forge
