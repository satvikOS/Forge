// cam_family_a_offset_ab.cpp — TKOffset family A's A/B and gate, with BOTH ARMS
// IN ONE PROCESS.
//
// WHY THIS FILE EXISTS. The previous harness (test/cam_inwardoffset_coverage_ab
// .cpp + its runner) built its two arms as two BINARIES of the same source,
// separated by -DFORGE_OFFSET_DROP_MAKEOFFSET. That construction is gone with the
// flag: src/Cam.cpp no longer has an OCCT branch to compile in, so the two
// binaries would be byte-identical and the runner's own anti-null-A/B guard would
// (correctly) call it a FATAL. Here the native arm is the SHIPPED function
// (forge::cam::inwardOffset, reached by textually including src/Cam.cpp because
// it has internal linkage) and the OCCT arm is test/cam_family_a_occt_oracle.hpp,
// which holds the deleted production block verbatim. One process, one part, two
// answers, compared directly.
//
// THE OPERATION IS THE ONE THE LEDGER SCORES. Face selection, the tie-break, the
// plane frame and d = 0.05*sqrt(area) are byte-for-byte
// test/cam_inwardoffset_coverage_ab.cpp's and test/corpus_ab_coverage.cpp's, so
// the rows here line up with the rows there.
//
// THE OBSERVABLE VECTOR. Volume alone cannot validate geometry and neither can
// length; every row carries, for each arm: status (+ the native arm's REFUSAL
// REASON), wire count, edge count, whether every wire closed, total length,
// SIGNED enclosed area (this is the DIRECTION observable — a wire-only result
// has no volume, and the sign of the enclosed area is what distinguishes an
// inward offset from an outward one), length-weighted centroid, and all six
// bounding-box bounds. Across the arms it carries two Hausdorff distances, both
// two-sided and both computed from ONE sampler at ONE budget in ONE frame:
//   hd_tight     at kOffsetInputDeflection (3.125e-3 mm) — the geometry
//   hd_consumer  at kSampleDeflection      (0.05 mm)     — the toolpath that
//                                                          actually reaches the
//                                                          G-code, since both
//                                                          callers discard the
//                                                          exact geometry
// usage:
//   cam_family_a_offset_ab --selftest          run the gate (no corpus needed)
//   cam_family_a_offset_ab part1.step ...      emit one TSV row per part
#include "../src/Cam.cpp"   // NOLINT — inwardOffset has internal linkage
#include "cam_family_a_occt_oracle.hpp"

#include <cstdio>
#include <cstring>
#include <cmath>
#include <chrono>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Trsf.hxx>

namespace {

using forge::cam::InwardOffsetResult;

// ───────────────────────────────────────────────────────── observable vector

struct Obs {
    bool        ok{false};
    std::string reason;      // native arm only; empty when ok
    int         nWires{0};
    int         nEdges{0};
    bool        allClosed{true};
    double      len{0.0};
    double      encArea{0.0};   // SIGNED — the direction observable
    double      cx{0.0}, cy{0.0};
    double      minX{0}, minY{0}, minZ{0}, maxX{0}, maxY{0}, maxZ{0};
    std::vector<std::vector<std::array<double, 2>>> polys;  // sampled, for Hausdorff
};

double shoelace(const std::vector<std::array<double, 2>>& p) {
    // Twice the signed area of the closed polyline (Gauss's shoelace formula).
    if (p.size() < 3) return 0.0;
    double s = 0.0;
    for (std::size_t i = 0, n = p.size(); i < n; ++i) {
        const auto& a = p[i];
        const auto& b = p[(i + 1) % n];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
}

// Reduce an offset result (wire or compound of wires) to the observable vector.
// `deflection` is the sampling budget for the polylines the Hausdorff uses.
Obs observe(const TopoDS_Shape& sh, double deflection) {
    Obs o;
    if (sh.IsNull()) return o;
    o.ok = true;
    bool first = true;
    for (const TopoDS_Wire& w : forge::cam::wiresOf(sh)) {
        ++o.nWires;
        for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) ++o.nEdges;
        if (!BRep_Tool::IsClosed(w)) o.allClosed = false;
        auto pts = forge::cam::sampleWireXY(w, deflection);
        // sampleWireXY closes the ring by repeating the first point; drop it so
        // the shoelace and the centroid do not double-count a vertex.
        if (pts.size() >= 2) {
            const auto& f = pts.front();
            const auto& l = pts.back();
            if (std::abs(f[0] - l[0]) < 1e-12 && std::abs(f[1] - l[1]) < 1e-12) pts.pop_back();
        }
        if (pts.size() < 2) continue;
        o.encArea += shoelace(pts);
        for (std::size_t i = 0, n = pts.size(); i < n; ++i) {
            const auto& a = pts[i];
            const auto& b = pts[(i + 1) % n];
            const double dx = b[0] - a[0], dy = b[1] - a[1];
            const double seg = std::sqrt(dx * dx + dy * dy);
            o.len += seg;
            o.cx += seg * 0.5 * (a[0] + b[0]);
            o.cy += seg * 0.5 * (a[1] + b[1]);
            if (first) {
                o.minX = o.maxX = a[0];
                o.minY = o.maxY = a[1];
                o.minZ = o.maxZ = 0.0;
                first = false;
            }
            o.minX = std::min(o.minX, a[0]); o.maxX = std::max(o.maxX, a[0]);
            o.minY = std::min(o.minY, a[1]); o.maxY = std::max(o.maxY, a[1]);
        }
        o.polys.push_back(pts);
    }
    if (o.len > 0.0) { o.cx /= o.len; o.cy /= o.len; }
    // The result lives in the face's own plane frame, so Z is identically 0 and
    // both Z bounds are reported as such rather than omitted — a bounds vector
    // with a hole in it is how a wrong Z gets through.
    return o;
}

double distPointSeg(const std::array<double, 2>& p,
                    const std::array<double, 2>& a,
                    const std::array<double, 2>& b) {
    const double vx = b[0] - a[0], vy = b[1] - a[1];
    const double wx = p[0] - a[0], wy = p[1] - a[1];
    const double vv = vx * vx + vy * vy;
    double t = (vv > 0.0) ? (wx * vx + wy * vy) / vv : 0.0;
    t = std::max(0.0, std::min(1.0, t));
    const double dx = wx - t * vx, dy = wy - t * vy;
    return std::sqrt(dx * dx + dy * dy);
}

// One-sided: max over A's vertices of the distance to B's nearest segment.
double oneSided(const std::vector<std::vector<std::array<double, 2>>>& A,
                const std::vector<std::vector<std::array<double, 2>>>& B) {
    double worst = 0.0;
    for (const auto& pa : A) {
        for (const auto& p : pa) {
            double best = std::numeric_limits<double>::infinity();
            for (const auto& pb : B) {
                for (std::size_t i = 0, n = pb.size(); i < n; ++i) {
                    best = std::min(best, distPointSeg(p, pb[i], pb[(i + 1) % n]));
                    if (best == 0.0) break;
                }
            }
            if (std::isfinite(best)) worst = std::max(worst, best);
        }
    }
    return worst;
}

// Two-sided Hausdorff, or -1 when either side is too large to do exactly (the
// cap is reported, never silently skipped).
double hausdorff(const Obs& a, const Obs& b) {
    std::size_t na = 0, nb = 0;
    for (const auto& p : a.polys) na += p.size();
    for (const auto& p : b.polys) nb += p.size();
    if (na == 0 || nb == 0) return -1.0;
    if (na * nb > 60000000ull) return -2.0;   // -2 == not computed, too large
    return std::max(oneSided(a.polys, b.polys), oneSided(b.polys, a.polys));
}

// ───────────────────────────────────────────────────── corpus part selection
// Byte-for-byte test/cam_inwardoffset_coverage_ab.cpp's rules.

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}
bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
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
bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

// ───────────────────────────────────────────────────────────────── the gate

int gChecks = 0, gFails = 0;
void chk(const char* what, bool pass, double got, double want) {
    ++gChecks;
    if (!pass) ++gFails;
    std::printf("  [%s] %-58s got %.9g want %.9g\n",
                pass ? "ok  " : "FAIL", what, got, want);
}
void chkStr(const char* what, bool pass, const char* got) {
    ++gChecks;
    if (!pass) ++gFails;
    std::printf("  [%s] %-58s %s\n", pass ? "ok  " : "FAIL", what, got);
}

TopoDS_Wire squareWire(double s, bool ccw, double z) {
    BRepBuilderAPI_MakePolygon p;
    if (ccw) {
        p.Add(gp_Pnt(0, 0, z)); p.Add(gp_Pnt(s, 0, z));
        p.Add(gp_Pnt(s, s, z)); p.Add(gp_Pnt(0, s, z));
    } else {
        p.Add(gp_Pnt(0, 0, z)); p.Add(gp_Pnt(0, s, z));
        p.Add(gp_Pnt(s, s, z)); p.Add(gp_Pnt(s, 0, z));
    }
    p.Close();
    return p.Wire();
}

TopoDS_Wire circleWire(double r, double z) {
    gp_Circ c(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), r);
    BRepBuilderAPI_MakeEdge me(c);
    TopoDS_Wire w;
    BRep_Builder bb;
    bb.MakeWire(w);
    bb.Add(w, me.Edge());
    return w;
}

double absEnclosedArea(const TopoDS_Shape& sh) {
    return std::abs(observe(sh, forge::cam::kOffsetInputDeflection).encArea);
}

int selftest() {
    const gp_Pln flat(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
    std::printf("=== TKOffset family A gate — cam::inwardOffset ===\n");

    // 1-2. THE SIGN. An inward offset shrinks the region the wire encloses, and
    // it must do so for BOTH windings. A 10 mm square offset inward by 1 mm is a
    // square of side 8: area 64 exactly, with no corner rounding (an INWARD
    // offset rounds nothing — the round joins are on the convex side, which for a
    // shrinking convex polygon is the side that disappears).
    {
        InwardOffsetResult r = forge::cam::inwardOffset(squareWire(10.0, true, 0.0), 1.0, flat);
        chkStr("CCW square: offset succeeds", r.ok, r.ok ? "ok" : r.reason.c_str());
        chk("CCW square 10mm, d=1 inward -> area", r.ok && std::abs(absEnclosedArea(r.shape) - 64.0) < 1e-9,
            r.ok ? absEnclosedArea(r.shape) : -1.0, 64.0);
    }
    {
        // THE FIX. Before it, this read 143.13761 — the wire grew. The old rule
        // was `loop.isCCW() ? -offsetMm : offsetMm`, which is backwards for CW.
        InwardOffsetResult r = forge::cam::inwardOffset(squareWire(10.0, false, 0.0), 1.0, flat);
        chkStr("CW square: offset succeeds", r.ok, r.ok ? "ok" : r.reason.c_str());
        chk("CW square 10mm, d=1 inward -> area (NOT 143.13761)",
            r.ok && std::abs(absEnclosedArea(r.shape) - 64.0) < 1e-9,
            r.ok ? absEnclosedArea(r.shape) : -1.0, 64.0);
    }
    {
        // 3. THE CONTROL — the instrument is not stuck on 64. Driving the engine
        // itself OUTWARD on the same CW ring must give the planar Steiner answer
        // for a square grown by d with round joins,
        //     (s + 2d)^2 - (4 - pi) d^2 = s^2 + 4 s d + pi d^2
        //                               = 100 + 40 + pi = 143.1415927,
        // which is also what the DEFECT used to produce through inwardOffset. If
        // this reads 64 the gate above is vacuous.
        //   The 143.13761 quoted in MAKEOFFSET_DECOMPOSITION_2026-09-03.md §6 is
        //   the SAME quantity measured with the engine's DEFAULT arc tolerance
        //   (|d|*1e-3 = 1e-3), which under-resolves the four quarter-arcs by
        //   4.0e-3 of area. Tessellated to 1e-7 here, the engine reproduces the
        //   closed form to 6 decimal places — so the constant to pin is the
        //   theorem's, not a previous run's.
        using forge::native::geom::Loop2;
        using forge::native::geom::Point2;
        using forge::native::geom::PolygonOffset2D;
        Loop2 cw;
        cw.pts = { Point2{0, 0}, Point2{0, 10}, Point2{10, 10}, Point2{10, 0} };
        forge::native::geom::OffsetOptions o;
        o.arcTolerance = 1e-7;
        auto r = PolygonOffset2D::offsetLoop(cw, +1.0, o);
        const double a = r.loops.empty() ? -1.0 : std::abs(r.loops[0].signedArea());
        const double steiner = 100.0 + 4.0 * 10.0 * 1.0 + M_PI;   // s^2 + 4sd + pi d^2
        chk("CONTROL: engine, CW ring, d=+1 GROWS (Steiner)",
            r.ok && std::abs(a - steiner) < 1e-4, a, steiner);
    }

    // 4-5. THE EXACT ANALYTIC CASE. A full circle offsets to a concentric circle
    // of radius R-d exactly; there must be no tessellation at all.
    {
        const double R = 35.2, d = 3.07577;
        InwardOffsetResult r = forge::cam::inwardOffset(circleWire(R, 0.0), d, flat);
        chkStr("full circle: offset succeeds", r.ok, r.ok ? "ok" : r.reason.c_str());
        double rr = -1.0;
        int nE = -1;
        bool isCirc = false;
        if (r.ok) {
            auto ws = forge::cam::wiresOf(r.shape);
            nE = 0;
            for (const auto& w : ws) {
                for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
                    ++nE;
                    BRepAdaptor_Curve ad(TopoDS::Edge(ex.Current()));
                    if (ad.GetType() == GeomAbs_Circle) { isCirc = true; rr = ad.Circle().Radius(); }
                }
            }
        }
        chk("full circle -> ONE edge (not a polygon)", nE == 1, nE, 1);
        chkStr("full circle -> that edge is a Circle", isCirc, isCirc ? "Circle" : "not a circle");
        chk("full circle -> radius is EXACTLY R-d", std::abs(rr - (R - d)) < 1e-12, rr, R - d);

        // The oracle on the same input, RECORDED rather than asserted. On 38 of
        // the 600 corpus parts whose outer wire is a lone full circle, OCCT's
        // MakeOffset follows the edge's parametric direction and returns R+d —
        // it GROWS where the contract says shrink
        // (reports/corpus_ab/MAKEOFFSET_DECOMPOSITION_2026-09-03.md §2.1, which
        // concludes the native arm is the one honouring the stated intent). A
        // circle built here by BRepBuilderAPI_MakeEdge need not present the same
        // orientation as one read from STEP, so this prints what it measured and
        // asserts nothing: the corpus row is where that class is counted.
        TopoDS_Shape occt = forge::camtest::occtInwardOffset(circleWire(R, 0.0), d);
        double orr = -1.0;
        if (!occt.IsNull()) {
            for (TopExp_Explorer ex(occt, TopAbs_EDGE); ex.More(); ex.Next()) {
                BRepAdaptor_Curve ad(TopoDS::Edge(ex.Current()));
                if (ad.GetType() == GeomAbs_Circle) orr = ad.Circle().Radius();
            }
        }
        std::printf("  [note] oracle (OCCT) on this circle: radius %.9g "
                    "(native/contract R-d = %.9g, the growing case would be R+d = %.9g)\n",
                    orr, R - d, R + d);
    }

    // 6-8. REFUSAL, NOT SILENT APPROXIMATION.
    {
        InwardOffsetResult r = forge::cam::inwardOffset(squareWire(10.0, true, 0.0), 6.0, flat);
        chkStr("tool larger than the pocket REFUSES", !r.ok,
               r.ok ? "returned a shape" : r.reason.c_str());
        chkStr("...and the refusal names a reason", !r.ok && !r.reason.empty(),
               r.reason.empty() ? "(EMPTY REASON)" : r.reason.c_str());
        chkStr("...and returns a null shape", !r.ok && r.shape.IsNull(),
               r.shape.IsNull() ? "null" : "NON-NULL");
    }
    {
        InwardOffsetResult r = forge::cam::inwardOffset(circleWire(5.0, 0.0), 5.0, flat);
        chkStr("tool == circle radius REFUSES", !r.ok,
               r.ok ? "returned a shape" : r.reason.c_str());
        chkStr("...naming the circle radius", !r.ok && r.reason.find("circle radius") != std::string::npos,
               r.reason.c_str());
    }
    {
        InwardOffsetResult r = forge::cam::inwardOffset(TopoDS_Wire(), 1.0, flat);
        chkStr("null wire REFUSES with a reason", !r.ok && !r.reason.empty(),
               r.reason.empty() ? "(EMPTY REASON)" : r.reason.c_str());
    }

    // 9-11. THE ANTI-GOUGE CLAUSE, AT THE CONSUMER.
    // This is the defect the whole change exists to remove: profile() used to
    // fall back to the UNOFFSET wire, so a part the offset could not handle came
    // back as a toolpath that traces the finished edge — a full-tool-radius gouge
    // reported as success.
    {
        TopoDS_Face f = BRepBuilderAPI_MakeFace(squareWire(10.0, true, 0.0)).Face();
        forge::ShapeHandle h = forge::ShapeRegistry::instance().add(f);
        forge::cam::Tool tool{1, "t", 2.0, 20.0, 30.0, 2, forge::cam::Tool::EndMill};
        forge::cam::CuttingParams cp{600.0, 200.0, 12000.0, 1.0, 1.0, 0.0};
        bool threw = false;
        double bbSide = -1.0;
        try {
            forge::cam::Toolpath tp = forge::cam::profile(h, forge::cam::kAutoFaceId,
                                                          tool, cp, 1.0, 0.0, 0.0);
            double mnx = 1e30, mxx = -1e30;
            for (const auto& m : tp.moves) { if (m.cutting) { mnx = std::min(mnx, m.x); mxx = std::max(mxx, m.x); } }
            bbSide = mxx - mnx;
        } catch (...) { threw = true; }
        // 10 mm square, 2 mm tool -> radius 1 -> the cut path spans 8 mm, NOT 10.
        chk("profile() cuts the OFFSET boundary (8mm span, not 10)",
            !threw && std::abs(bbSide - 8.0) < 1e-6, bbSide, 8.0);

        // Now a tool too big for the part: it must THROW, not silently trace the
        // 10 mm boundary.
        forge::cam::Tool big{2, "big", 24.0, 20.0, 30.0, 2, forge::cam::Tool::EndMill};
        bool refused = false;
        std::string msg;
        try {
            forge::cam::profile(h, forge::cam::kAutoFaceId, big, cp, 1.0, 0.0, 0.0);
        } catch (const std::exception& e) { refused = true; msg = e.what(); }
        chkStr("profile() REFUSES when no standoff exists", refused,
               refused ? msg.c_str() : "RETURNED A TOOLPATH (would gouge)");
        chkStr("...and says so in the message",
               refused && msg.find("refusing to emit a toolpath") != std::string::npos,
               msg.c_str());
        bool pRefused = false;
        try {
            forge::cam::pocket(h, forge::cam::kAutoFaceId, big, cp, 1.0, 0.0);
        } catch (const std::exception&) { pRefused = true; }
        chkStr("pocket() REFUSES on the same input", pRefused,
               pRefused ? "threw" : "RETURNED A TOOLPATH (would gouge)");
    }

    // 11b. WHAT THE EXACT ANALYTIC PATH BUYS, MEASURED. Present the SAME circle
    // as a POLYLINE — the representation every other curved input arrives in —
    // and offset that. The difference between the two answers is exactly the
    // tessellation error the analytic case removes, and it is reported rather
    // than claimed. (Nothing is asserted here: the polyline answer is not wrong,
    // it is approximate, and how approximate is the number worth printing.)
    {
        const double R = 35.2, d = 3.07577;
        const double exact = M_PI * (R - d) * (R - d);
        // Discretise the source circle at the same budget the general path uses.
        const int n = static_cast<int>(std::ceil(M_PI /
                      std::acos(1.0 - forge::cam::kOffsetInputDeflection / R)));
        BRepBuilderAPI_MakePolygon poly;
        for (int i = 0; i < n; ++i) {
            const double t = 2.0 * M_PI * i / n;
            poly.Add(gp_Pnt(R * std::cos(t), R * std::sin(t), 0.0));
        }
        poly.Close();
        InwardOffsetResult viaPoly = forge::cam::inwardOffset(poly.Wire(), d, flat);
        InwardOffsetResult viaArc  = forge::cam::inwardOffset(circleWire(R, 0.0), d, flat);
        if (viaPoly.ok && viaArc.ok) {
            const Obs pa = observe(viaPoly.shape, forge::cam::kOffsetInputDeflection);
            const Obs ar = observe(viaArc.shape,  forge::cam::kOffsetInputDeflection);
            // READ THESE AREAS CORRECTLY. Both are measured by sampling the
            // RESULT at kOffsetInputDeflection and applying the shoelace, so
            // both carry that sampler's own inscribed-polygon deficit. The
            // analytic path's exactness is asserted above at the level where it
            // exists — ONE edge whose radius is R-d to 1e-12 — not here. What
            // this note shows is the representational difference: one exact
            // circular edge against a polygon of n sides, and the residual
            // area gap between them after both have been discretised.
            std::printf("  [note] circle R=%g d=%g, exact offset area pi(R-d)^2 = %.9g\n"
                        "         (both areas below are of the SAMPLED result, so both carry the\n"
                        "          sampler's inscribed deficit; the exactness claim is the edge, above)\n"
                        "         analytic path : %d edge(s), sampled area %.9g, rel %.3g\n"
                        "         polyline path : %d edge(s) from a %d-gon source, sampled area %.9g, rel %.3g\n",
                        R, d, exact,
                        ar.nEdges, std::abs(ar.encArea), std::abs(std::abs(ar.encArea) - exact) / exact,
                        pa.nEdges, n, std::abs(pa.encArea), std::abs(std::abs(pa.encArea) - exact) / exact);
        }
    }

    // 12. THE ENGINE-GHOST REGRESSION. src/Cam.cpp's post-condition exists
    // because PolygonOffset2D returns a non-empty answer for |d| larger than the
    // square's SIDE. Each of these must REFUSE; if one starts succeeding, either
    // the engine was fixed (good — check the geometry then) or the post-condition
    // stopped firing (bad).
    {
        const double side = 10.0;
        for (double d : {10.5, 12.0, 20.0, 50.0}) {
            InwardOffsetResult r = forge::cam::inwardOffset(squareWire(side, true, 0.0), d, flat);
            char what[96];
            std::snprintf(what, sizeof(what), "ghost regression: %gmm square, d=%g REFUSES", side, d);
            chkStr(what, !r.ok, r.ok ? "RETURNED A SHAPE (ghost accepted)" : r.reason.c_str());
        }
        // ...and the band that already collapsed correctly still does.
        InwardOffsetResult r6 = forge::cam::inwardOffset(squareWire(side, true, 0.0), 6.0, flat);
        chkStr("ghost regression: d=6 still collapses (engine's own path)", !r6.ok,
               r6.ok ? "RETURNED A SHAPE" : r6.reason.c_str());
    }

    // 13. THE TESSELLATION BOUND, MEASURED not asserted. A square with one
    // rounded corner exercises the curved-input path; the native answer must
    // agree with the oracle to well inside the consumer's own 0.05 mm.
    {
        const double d = 1.0;
        TopoDS_Wire w = circleWire(20.0, 0.0);
        InwardOffsetResult nat = forge::cam::inwardOffset(w, d, flat);
        TopoDS_Shape occt = forge::camtest::occtInwardOffset(w, d);
        if (nat.ok && !occt.IsNull()) {
            Obs a = observe(nat.shape, forge::cam::kSampleDeflection);
            Obs b = observe(occt, forge::cam::kSampleDeflection);
            std::printf("  [note] circle R=20 d=1 at the consumer's 0.05 mm: "
                        "native encArea %.9g, oracle encArea %.9g, two-sided Hausdorff %.6g mm\n",
                        a.encArea, b.encArea, hausdorff(a, b));
        }
    }

    std::printf("=== %d checks, %d failed ===\n", gChecks, gFails);
    return gFails == 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();

    std::printf("# part\tnat\tocct\tnat_wires\tocct_wires\tnat_edges\tocct_edges"
                "\tnat_closed\tocct_closed\tnat_len\tocct_len\tnat_encarea\tocct_encarea"
                "\tnat_cx\tnat_cy\tocct_cx\tocct_cy"
                "\tnat_minx\tnat_miny\tnat_minz\tnat_maxx\tnat_maxy\tnat_maxz"
                "\tocct_minx\tocct_miny\tocct_minz\tocct_maxx\tocct_maxy\tocct_maxz"
                "\thd_tight\thd_consumer\tnat_ms\tocct_ms\tnat_reason\n");
    int nNat = 0, nOcct = 0, nBoth = 0, nSkip = 0, nOcctOnly = 0, nNatOnly = 0;
    for (int i = 1; i < argc; ++i) {
        STEPControl_Reader rd;
        if (rd.ReadFile(argv[i]) != IFSelect_RetDone) { ++nSkip; continue; }
        rd.TransferRoots();
        TopoDS_Shape shape = rd.OneShape();
        if (shape.IsNull()) { ++nSkip; continue; }

        TopoDS_Face bigFace;
        double bigArea = 0.0;
        gp_Pln bigPln;
        TopTools_IndexedMapOfShape faces;
        TopExp::MapShapes(shape, TopAbs_FACE, faces);
        for (int fi = 1; fi <= faces.Extent(); ++fi) {
            TopoDS_Face f = TopoDS::Face(faces(fi));
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            const double a = faceArea(f);
            if (betterFace(f, a, bigFace, bigArea)) { bigFace = f; bigArea = a; bigPln = pl; }
        }
        if (bigFace.IsNull() || bigArea <= 0.0) { ++nSkip; continue; }

        TopoDS_Wire w = BRepTools::OuterWire(bigFace);
        if (w.IsNull()) { ++nSkip; continue; }

        const gp_Ax3 ax(bigPln.Location(), bigPln.Axis().Direction());
        gp_Trsf toLocal;
        toLocal.SetTransformation(ax);
        TopoDS_Shape moved;
        try { moved = BRepBuilderAPI_Transform(w, toLocal, true).Shape(); }
        catch (...) { ++nSkip; continue; }
        if (moved.IsNull() || moved.ShapeType() != TopAbs_WIRE) { ++nSkip; continue; }
        const TopoDS_Wire wl = TopoDS::Wire(moved);
        const gp_Pln flat(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1));
        const double d = 0.05 * std::sqrt(bigArea);

        // Per-arm wall time. A run killed on a deadline is otherwise unattributable
        // — "the part timed out" does not say WHICH engine ran away, and on this
        // family it is the oracle that does (measured: ho185 spends 38.8 s inside
        // BRepOffsetAPI_MakeOffset and then returns nothing, while the native arm
        // answers in milliseconds).
        using clk = std::chrono::steady_clock;
        InwardOffsetResult nat;
        const auto t0 = clk::now();
        try { nat = forge::cam::inwardOffset(wl, d, flat); }
        catch (...) { nat = InwardOffsetResult(); nat.reason = "native threw"; }
        const auto t1 = clk::now();

        TopoDS_Shape occt;
        try { occt = forge::camtest::occtInwardOffset(wl, d); } catch (...) {}
        const auto t2 = clk::now();
        const double natMs  = std::chrono::duration<double, std::milli>(t1 - t0).count();
        const double occtMs = std::chrono::duration<double, std::milli>(t2 - t1).count();

        Obs a = nat.ok ? observe(nat.shape, forge::cam::kOffsetInputDeflection) : Obs();
        Obs b = occt.IsNull() ? Obs() : observe(occt, forge::cam::kOffsetInputDeflection);
        const double hdT = (a.ok && b.ok) ? hausdorff(a, b) : -1.0;
        Obs ac = nat.ok ? observe(nat.shape, forge::cam::kSampleDeflection) : Obs();
        Obs bc = occt.IsNull() ? Obs() : observe(occt, forge::cam::kSampleDeflection);
        const double hdC = (ac.ok && bc.ok) ? hausdorff(ac, bc) : -1.0;

        if (nat.ok) ++nNat;
        if (b.ok) ++nOcct;
        if (nat.ok && b.ok) ++nBoth;
        else if (b.ok) ++nOcctOnly;
        else if (nat.ok) ++nNatOnly;

        const char* base = std::strrchr(argv[i], '/');
        base = base ? base + 1 : argv[i];
        std::printf("%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d"
                    "\t%.10g\t%.10g\t%.10g\t%.10g"
                    "\t%.10g\t%.10g\t%.10g\t%.10g"
                    "\t%.10g\t%.10g\t%.10g\t%.10g\t%.10g\t%.10g"
                    "\t%.10g\t%.10g\t%.10g\t%.10g\t%.10g\t%.10g"
                    "\t%.6g\t%.6g\t%.3f\t%.3f\t%s\n",
                    base, nat.ok ? "OK" : "REFUSE", b.ok ? "OK" : "FAIL",
                    a.nWires, b.nWires, a.nEdges, b.nEdges,
                    a.allClosed ? 1 : 0, b.allClosed ? 1 : 0,
                    a.len, b.len, a.encArea, b.encArea,
                    a.cx, a.cy, b.cx, b.cy,
                    a.minX, a.minY, a.minZ, a.maxX, a.maxY, a.maxZ,
                    b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ,
                    hdT, hdC, natMs, occtMs,
                    nat.ok ? "-" : (nat.reason.empty() ? "(EMPTY)" : nat.reason.c_str()));
        std::fflush(stdout);
    }
    std::printf("TOTAL native_ok=%d occt_ok=%d both=%d native_only=%d "
                "occt_only_DELETION_BUCKET=%d skipped=%d\n",
                nNat, nOcct, nBoth, nNatOnly, nOcctOnly, nSkip);
    return 0;
}
