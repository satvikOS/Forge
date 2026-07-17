// forge/src/OcctNativeMesh.cpp  — K5 native meshing (replaces BRepMesh / TKMesh)
//
// See include/forge/OcctNativeMesh.hpp for the honesty statement. In one line:
// every face is TRIANGULATED in-house (shared adaptive edge discretisation +
// adaptive interior UV grid + the native constrained-Delaunay of the pure geom/
// engine); OCCT is only READ for surface points, wire pcurves and 3D edge curves
// (TKBRep/TKG3d/TKG2d/TKTopAlgo — never TKMesh). No BRepMesh_IncrementalMesh
// symbol appears in this TU.
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
#include <Geom2d_Curve.hxx>
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

    // ---- boundary loops: SHARED edge samples mapped into this face's UV --------
    std::vector<geom::ConstraintEdge> cons;
    int wireCount = 0;
    for (TopExp_Explorer wexp(face, TopAbs_WIRE); wexp.More(); wexp.Next()) {
        const TopoDS_Wire wire = TopoDS::Wire(wexp.Current());
        std::vector<int> loop;
        for (BRepTools_WireExplorer we(wire, face); we.More(); we.Next()) {
            const TopoDS_Edge e = we.Current();
            double f = 0.0, l = 0.0;
            Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(e, face, f, l);
            if (pc.IsNull()) return out;   // HONEST DEFERRAL: no pcurve to read
            if (!(l > f)) continue;
            const bool rev = (e.Orientation() == TopAbs_REVERSED);

            const EdgeSamples& es = edgeSamplesFor(e, cache, linDefl, angDefl);
            if (es.usable) {
                // Map each shared edge param t (in [es.rf,es.rl]) to this face's
                // pcurve param, take UV there, but use the SHARED global 3-D point
                // for the node position so adjacent faces weld exactly.
                const double span = (es.rl > es.rf) ? (es.rl - es.rf) : 1.0;
                const int n = static_cast<int>(es.t.size());
                for (int s = 0; s + 1 < n; ++s) {        // skip last (shared w/ next)
                    const int k = rev ? (n - 1 - s) : s;  // wire-forward order
                    const double t  = es.t[k];
                    const double tp = f + (t - es.rf) / span * (l - f);
                    const gp_Pnt2d q = pc->Value(tp);
                    loop.push_back(addPt(q.X(), q.Y(), es.p[k]));
                }
            } else {
                // Degenerate edge (no 3-D curve, e.g. a pole seam): fall back to
                // per-face pcurve sampling. Such edges collapse to a point / seam,
                // so this does not open a crack against a neighbouring face.
                auto isoPt = [&](double tt) -> gp_Pnt {
                    gp_Pnt2d q = pc->Value(tt);
                    return Sloc(q.X(), q.Y());
                };
                std::vector<double> ts = adaptiveSample(isoPt, f, l, linDefl, angDefl);
                if (rev) std::reverse(ts.begin(), ts.end());
                for (std::size_t s = 0; s + 1 < ts.size(); ++s) {
                    const gp_Pnt2d q = pc->Value(ts[s]);
                    loop.push_back(addPt(q.X(), q.Y(), Sglob(q.X(), q.Y())));
                }
            }
        }
        if (loop.size() < 3) continue;      // degenerate wire — skip
        const int n = static_cast<int>(loop.size());
        for (int k = 0; k < n; ++k)
            cons.push_back(geom::ConstraintEdge{loop[k], loop[(k + 1) % n]});
        ++wireCount;
    }
    if (wireCount == 0 || cons.size() < 3) return out;

    // ---- adaptive interior UV grid (only points strictly inside the trim) ------
    const double umid = 0.5 * (umin + umax);
    const double vmid = 0.5 * (vmin + vmax);
    const int nU = isoSegments([&](double u) { return Sloc(u, vmid); }, umin, umax, linDefl, angDefl);
    const int nV = isoSegments([&](double v) { return Sloc(umid, v); }, vmin, vmax, linDefl, angDefl);
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
                           double angDefl) {
    pos.clear();
    idx.clear();
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
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face face = TopoDS::Face(ex.Current());
        FaceMesh fm = tessellateFace(face, cache, linDefl, angDefl);
        if (!fm.ok) return false;    // HONEST DEFERRAL: a face we could not read
        anyFace = true;
        for (const auto& t : fm.tris) {
            const std::uint32_t a = vid(fm.nodes[t[0]]);
            const std::uint32_t b = vid(fm.nodes[t[1]]);
            const std::uint32_t c = vid(fm.nodes[t[2]]);
            if (a == b || b == c || a == c) continue;   // welded-degenerate
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
        }
    }
    return anyFace && !idx.empty();
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
