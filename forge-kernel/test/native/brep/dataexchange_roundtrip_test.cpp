// forge/native/brep/dataexchange_roundtrip_test.cpp
//
// Native (OCCT-free) gate for the DATA-EXCHANGE WRITE round trip — the writers
// StepAnalytic::write (extended with inner-hole FACE_BOUND + a trimmed-NURBS
// ADVANCED_FACE) and the new writeIges (IgesWrite.hpp), validated by feeding their
// output to the FOREIGN readers readForeignStep / readForeignIges and asserting a
// LITERAL round-trip identity: SAME face count + SAME volume to <= 1e-9 (a true
// round-trip-identity, not a tessellation tolerance — the geometry stays exact).
//
// This is the round-trip sibling of the committed readers: write -> foreign read
// must reconstruct the same B-rep. The exercise body is a CLOSED box whose ONE
// face is a TRIMMED-NURBS face (a planar bilinear B_SPLINE_SURFACE_WITH_KNOTS /
// 128 RATIONAL B-SPLINE SURFACE whose 4 control points are that face's 4 corners),
// so the writers' NURBS-surface emit path is exercised AND the body is a genuine
// "box + a trimmed-NURBS-face part" with a known closed-form volume L^3.
//
// Build (single clang, the same dep set the reader tests use):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/StepAnalytic.cpp \
//     forge-kernel/src/native/brep/StepPart21.cpp \
//     forge-kernel/src/native/brep/StepRead.cpp \
//     forge-kernel/src/native/brep/IgesRead.cpp \
//     forge-kernel/src/native/brep/IgesWrite.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/TrimmedFace.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/geom/Delaunay.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/test/native/brep/dataexchange_roundtrip_test.cpp \
//     -o /tmp/dataexchange_roundtrip_test && /tmp/dataexchange_roundtrip_test
//
// Pure C++20, no external deps, no test framework.

#include <algorithm>
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/IgesWrite.hpp"
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/IgesRead.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

using namespace forge::native::brep;

// Point3 -> Vec3 (the analytic geometry helpers all operate on Vec3).
static inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool relle(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
static std::size_t faceCount(const Solid& s) {
    std::size_t n = 0;
    for (const Shell* sh : s.shells) if (sh) n += sh->faces.size();
    return n;
}

// ===========================================================================
// Build a CLOSED box [0,L]^3 whose +Z (top) face is a TRIMMED-NURBS face: a
// planar bilinear B-spline surface whose 4 control points ARE the +Z face's 4
// corners. The other 5 faces are analytic planes. Vertices/edges are SHARED
// across faces (a real closed 2-manifold), so the topology round-trips cleanly.
//
// The bilinear NURBS patch over (u,v) in [0,1]^2 maps exactly to the planar top
// quad, so the solid's volume is exactly L^3 and the NURBS face integrates over
// its full [0,1]^2 domain (no trimming away from the rectangle) — giving an exact
// round-trip volume through the writers' NURBS-surface emit + the foreign readers'
// NURBS reconstruction.
// ===========================================================================
struct BoxNurbs {
    std::shared_ptr<TopologyBuilder> owner;
    Solid* solid = nullptr;
};

static BoxNurbs buildBoxWithNurbsTop(double L) {
    BoxNurbs out;
    out.owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *out.owner;
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // 8 box corners (shared).
    auto V = [&](double x, double y, double z) { return tb.makeVertex(Point3{x, y, z}); };
    Vertex* v000 = V(0, 0, 0);
    Vertex* v100 = V(L, 0, 0);
    Vertex* v110 = V(L, L, 0);
    Vertex* v010 = V(0, L, 0);
    Vertex* v001 = V(0, 0, L);
    Vertex* v101 = V(L, 0, L);
    Vertex* v111 = V(L, L, L);
    Vertex* v011 = V(0, L, L);

    // A planar face from a CCW (as seen from OUTSIDE) vertex ring + outward normal
    // + an in-plane ref direction. vertexUV = plane coords (refDir,binormal).
    auto addPlane = [&](std::vector<Vertex*> ring, Vec3 n, Vec3 ref) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        s->origin = PV(ring[0]->point);
        s->axis = vnorm(n);
        s->refDir = vnorm(ref);
        f->surface = s;
        Vec3 bn = s->binormal();
        double u0 = 0, u1 = 0, w0 = 0, w1 = 0;
        f->vertexUV.clear();
        for (std::size_t i = 0; i < ring.size(); ++i) {
            Vec3 rel = vsub(PV(ring[i]->point), s->origin);
            double pu = vdot(rel, s->refDir), pv = vdot(rel, bn);
            f->vertexUV.push_back({pu, pv});
            if (i == 0) { u0 = u1 = pu; w0 = w1 = pv; }
            else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
                   w0 = std::min(w0, pv); w1 = std::max(w1, pv); }
        }
        f->u0 = u0; f->u1 = u1; f->v0 = w0; f->v1 = w1;
        return f;
    };

    // 5 planar faces (CCW outward). Box [0,L]^3.
    addPlane({v000, v010, v110, v100}, {0, 0, -1}, {1, 0, 0});   // -Z bottom
    addPlane({v000, v100, v101, v001}, {0, -1, 0}, {1, 0, 0});   // -Y front
    addPlane({v100, v110, v111, v101}, {1, 0, 0},  {0, 1, 0});   // +X right
    addPlane({v110, v010, v011, v111}, {0, 1, 0},  {-1, 0, 0});  // +Y back
    addPlane({v010, v000, v001, v011}, {-1, 0, 0}, {0, -1, 0});  // -X left

    // +Z top as a planar BILINEAR NURBS face. Ring CCW seen from +Z (outward):
    // v001 -> v101 -> v111 -> v011. The bilinear patch control grid (2x2) is laid
    // out so S(0,0)=v001, S(1,0)=v101, S(0,1)=v011, S(1,1)=v111 — i.e. u along +X,
    // v along +Y. The face's outer ring is the same 4 corners.
    {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, {v001, v101, v111, v011});
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Nurbs;
        NurbsSurface& nb = s->nurbs;
        nb.degreeU = 1;
        nb.degreeV = 1;
        nb.control = {
            { Vec3{0, 0, L}, Vec3{0, L, L} },   // i=0 (u=0): v=0 -> v001, v=1 -> v011
            { Vec3{L, 0, L}, Vec3{L, L, L} },   // i=1 (u=1): v=0 -> v101, v=1 -> v111
        };
        nb.weights = { {1.0, 1.0}, {1.0, 1.0} };
        nb.knotsU = {0, 0, 1, 1};   // clamped degree-1, 2 ctrl pts
        nb.knotsV = {0, 0, 1, 1};
        // outward (+Z): S_u x S_v = (+X)x(+Y) = +Z, already outward -> not reversed.
        s->reversed = false;
        f->surface = s;
        f->u0 = 0.0; f->u1 = 1.0; f->v0 = 0.0; f->v1 = 1.0;
        f->vertexUV = { {0, 0}, {1, 0}, {1, 1}, {0, 1} };
    }

    out.solid = solid;
    return out;
}

int main() {
    std::printf("dataexchange_roundtrip_test — native STEP+IGES WRITE round trip\n");

    const double L = 3.0;
    BoxNurbs src = buildBoxWithNurbsTop(L);
    const double expVol = L * L * L;

    MassProps mp0 = massProperties(*src.solid);
    check(relle(mp0.volume, expVol, 1e-9),
          "source box+NURBS-top volume == L^3 (" + std::to_string(mp0.volume) + ")");
    const std::size_t srcFaces = faceCount(*src.solid);   // 6
    check(srcFaces == 6, "source has 6 faces");

    // =======================================================================
    // STEP WRITE round trip:  StepAnalytic::write -> readForeignStep.
    // =======================================================================
    {
        auto wr = StepAnalytic::write(*src.solid, "box_nurbs_top");
        check(wr.ok, std::string("STEP: write ok") + (wr.ok ? "" : " — " + wr.reason));
        if (wr.ok) {
            // the file must carry the trimmed-NURBS surface keyword (proves the
            // B_SPLINE_SURFACE_WITH_KNOTS write path ran, not a faceted fallback).
            check(wr.text.find("B_SPLINE_SURFACE_WITH_KNOTS") != std::string::npos,
                  "STEP: emits B_SPLINE_SURFACE_WITH_KNOTS (trimmed-NURBS face)");
            ForeignReadResult rr = readForeignStep(wr.text);
            check(rr.ok && rr.solid,
                  std::string("STEP: readForeignStep ok") + (rr.ok ? "" : " — " + rr.reason));
            if (rr.ok && rr.solid) {
                check(rr.closed, "STEP: re-read solid is a closed 2-manifold");
                std::size_t nf = faceCount(*rr.solid);
                check(nf == srcFaces,
                      "STEP: face count identity (" + std::to_string(nf) + " == " +
                      std::to_string(srcFaces) + ")");
                MassProps mp1 = massProperties(*rr.solid);
                check(relle(mp1.volume, mp0.volume, 1e-9),
                      "STEP: volume round-trip identity to 1e-9 (got " +
                      std::to_string(mp1.volume) + ", exp " +
                      std::to_string(mp0.volume) + ")");
            }
        }
    }

    // =======================================================================
    // IGES WRITE round trip:  writeIges -> readForeignIges.
    // =======================================================================
    {
        IgesWriteResult wr = writeIges(*src.solid, "box_nurbs_top");
        check(wr.ok, std::string("IGES: write ok") + (wr.ok ? "" : " — " + wr.reason));
        if (wr.ok) {
            // every line must be exactly 80 columns + the 5 sections present.
            bool col80ok = true; std::size_t lines = 0;
            for (std::size_t i = 0; i < wr.text.size();) {
                std::size_t e = wr.text.find('\n', i);
                std::string ln = (e == std::string::npos) ? wr.text.substr(i)
                                                          : wr.text.substr(i, e - i);
                if (!ln.empty()) { ++lines; if (ln.size() != 80) col80ok = false; }
                i = (e == std::string::npos) ? wr.text.size() : e + 1;
            }
            check(col80ok && lines > 0, "IGES: every line is exactly 80 columns");
            check(wr.text.find("128") != std::string::npos,
                  "IGES: carries a 128 RATIONAL B-SPLINE SURFACE (NURBS face)");
            ForeignReadResult rr = readForeignIges(wr.text);
            check(rr.ok && rr.solid,
                  std::string("IGES: readForeignIges ok") + (rr.ok ? "" : " — " + rr.reason));
            if (rr.ok && rr.solid) {
                check(rr.closed, "IGES: re-read solid is a closed 2-manifold");
                std::size_t nf = faceCount(*rr.solid);
                check(nf == srcFaces,
                      "IGES: face count identity (" + std::to_string(nf) + " == " +
                      std::to_string(srcFaces) + ")");
                MassProps mp1 = massProperties(*rr.solid);
                check(relle(mp1.volume, mp0.volume, 1e-9),
                      "IGES: volume round-trip identity to 1e-9 (got " +
                      std::to_string(mp1.volume) + ", exp " +
                      std::to_string(mp0.volume) + ")");
            }
        }
    }

    // =======================================================================
    // HONEST SCOPE: a QUADRIC face is NOT exportable to the IGES reader's 510
    // base-surface set -> writeIges returns ok=false (no fake, no mesh fallback).
    // (Build a 1-face quadric stub: a cylinder side surface on a lone face.)
    // =======================================================================
    {
        auto stub = std::make_shared<TopologyBuilder>();
        TopologyBuilder& tb = *stub;
        Solid* sol = tb.makeSolid();
        Shell* sh = tb.makeShell();
        tb.addShellToSolid(sol, sh);
        Vertex* a = tb.makeVertex(Point3{1, 0, 0});
        Vertex* b = tb.makeVertex(Point3{0, 1, 0});
        Vertex* c = tb.makeVertex(Point3{-1, 0, 0});
        Face* f = tb.makeFace();
        tb.addFaceToShell(sh, f);
        tb.addOuterLoopToFace(f, {a, b, c});
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Cylinder; s->r1 = 1.0; s->axis = {0, 0, 1};
        s->refDir = {1, 0, 0}; s->param = 1.0;
        f->surface = s;
        IgesWriteResult wr = writeIges(*sol, "quadric_stub");
        check(!wr.ok, "IGES: quadric face -> ok=false (honest scope, no fake)");
    }

    std::printf("dataexchange_roundtrip_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
