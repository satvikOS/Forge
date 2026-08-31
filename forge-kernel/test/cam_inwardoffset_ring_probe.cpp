// cam_inwardoffset_ring_probe.cpp — ATTRIBUTION PROBE for the two parts still in
// FORGE_OFFSET_DROP_MAKEOFFSET's deletion bucket (ho13, ho133).
//
// It reproduces test/cam_inwardoffset_coverage_ab.cpp's face selection EXACTLY
// (same area rule, same centroid tie-break, same plane frame, same
// d = 0.05*sqrt(area)), then builds the ring tryNativeInwardOffset would build —
// using the SAMPLER AND DEFLECTION taken from the INCLUDED src/Cam.cpp, never
// re-typed — and prints offsetLoop's verdict for it. `DUMP_RING=1` prints the
// ring itself so any defer can be replayed against PolygonOffset2D standalone,
// with no OCCT in the loop.
//
// This binary is a probe: it never links into the kernel and never changes
// behaviour. It exists so a deletion-bucket row can be attributed to a cause
// instead of guessed at.
#define FORGE_OFFSET_DROP_MAKEOFFSET 1
#include "../src/Cam.cpp"   // NOLINT — inwardOffset has internal linkage

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>

namespace {
double abFaceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
gp_Pnt abFaceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}
bool abPlaneOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}
bool abBetterFace(const TopoDS_Face& cand, double candArea,
                  const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = abFaceCentroid(cand), b = abFaceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}
}  // namespace

int main(int argc, char** argv) {
    using forge::cam::kEps;
    using forge::cam::kOffsetInputDeflection;
    using forge::cam::sampleWireXY;
    using forge::native::geom::Loop2;
    using forge::native::geom::Point2;
    using forge::native::geom::PolygonOffset2D;
    using forge::native::geom::OffsetOptions;
    using forge::native::geom::OffsetResult;

    for (int i = 1; i < argc; ++i) {
        STEPControl_Reader rd;
        TopoDS_Shape shape;
        try {
            if (rd.ReadFile(argv[i]) != IFSelect_RetDone) continue;
            rd.TransferRoots();
            shape = rd.OneShape();
        } catch (...) { continue; }
        if (shape.IsNull()) continue;

        TopoDS_Face big; double bigArea = 0.0; gp_Pln bigPln;
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int k = 1; k <= fm.Extent(); ++k) {
            const TopoDS_Face f = TopoDS::Face(fm(k));
            const double a = abFaceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!abPlaneOf(f, pl)) continue;
            if (abBetterFace(f, a, big, bigArea)) { big = f; bigArea = a; bigPln = pl; }
        }
        if (big.IsNull()) continue;
        const TopoDS_Wire w = BRepTools::OuterWire(big);
        if (w.IsNull()) continue;
        const gp_Ax3 ax(bigPln.Location(), bigPln.Axis().Direction());
        gp_Trsf toLocal; toLocal.SetTransformation(ax);
        TopoDS_Shape moved;
        try { moved = BRepBuilderAPI_Transform(w, toLocal, true).Shape(); } catch (...) { continue; }
        if (moved.IsNull() || moved.ShapeType() != TopAbs_WIRE) continue;
        const TopoDS_Wire wl = TopoDS::Wire(moved);
        const double d = 0.05 * std::sqrt(bigArea);

        // ---- the forward conversion, via the INCLUDED Cam.cpp's own helpers ----
        bool allLines = true;
        int nEdges = 0;
        for (BRepTools_WireExplorer ex(wl); ex.More(); ex.Next()) {
            ++nEdges;
            BRepAdaptor_Curve adaptor(ex.Current());
            if (adaptor.GetType() != GeomAbs_Line) allLines = false;
        }
        Loop2 loop;
        if (allLines) {
            for (BRepTools_WireExplorer ex(wl); ex.More(); ex.Next()) {
                gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
                Point2 q{p.X(), p.Y()};
                if (!loop.pts.empty()) {
                    const Point2& b = loop.pts.back();
                    if (std::abs(b.x - q.x) < kEps && std::abs(b.y - q.y) < kEps) continue;
                }
                loop.pts.push_back(q);
            }
        } else {
            for (const auto& p : sampleWireXY(wl, kOffsetInputDeflection))
                loop.pts.push_back(Point2{p[0], p[1]});
        }
        if (loop.pts.size() >= 2) {
            const Point2& f = loop.pts.front(); const Point2& l = loop.pts.back();
            if (std::abs(f.x - l.x) < kEps && std::abs(f.y - l.y) < kEps) loop.pts.pop_back();
        }

        const char* base = std::strrchr(argv[i], '/'); base = base ? base + 1 : argv[i];
        const double signedDist = loop.isCCW() ? -d : d;
        OffsetOptions opts;
        OffsetResult r = PolygonOffset2D::offsetLoop(loop, signedDist, opts);
        double minx = 0, maxx = 0, miny = 0, maxy = 0;
        if (!loop.pts.empty()) {
            minx = maxx = loop.pts[0].x; miny = maxy = loop.pts[0].y;
            for (auto& q : loop.pts) {
                if (q.x < minx) minx = q.x; if (q.x > maxx) maxx = q.x;
                if (q.y < miny) miny = q.y; if (q.y > maxy) maxy = q.y;
            }
        }
        std::printf("PART %s edges=%d allLines=%d n=%zu area=%.6f d=%.9f signed=%.9f ccw=%d "
                    "ext=%.6f ok=%d loops=%zu dropped=%zu relaxed=%d reason=\"%s\"\n",
                    base, nEdges, (int)allLines, loop.pts.size(), loop.signedArea(), d, signedDist,
                    (int)loop.isCCW(), std::max(maxx - minx, maxy - miny),
                    (int)r.ok, r.loops.size(), r.droppedLoops, (int)r.relaxedCollinear,
                    r.reason.c_str());
        const char* e = std::getenv("DUMP_RING");
        if (e && e[0] == '1') {
            std::printf("RINGBEGIN %s %zu %.17g\n", base, loop.pts.size(), signedDist);
            for (auto& q : loop.pts) std::printf("%.17g %.17g\n", q.x, q.y);
            std::printf("RINGEND\n");
        }
        std::fflush(stdout);
    }
    return 0;
}
