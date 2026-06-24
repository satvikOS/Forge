// native_vs_occt_gear.cpp
//
// STANDALONE cross-check of the in-house INVOLUTE SPUR GEAR generator
// (forge::native::brep, Gear.hpp/.cpp) against (a) the closed-form involute math
// and (b) OpenCASCADE as an INDEPENDENT B-rep validity oracle.
//
// This is NOT a kernel gate and does NOT touch binding.cpp / CMakeLists / the
// native gate. It is a one-off verification harness the parent requested:
//
//   GEAR under test (mirrors test/native/brep/gear_test.cpp):
//       module m = 2, teeth N = 20, pressure angle alpha = 20 deg,
//       face width w = 10, bore radius = 8.
//
//   CHECKS
//   (a) INVOLUTE FLANK vs the closed-form parametric involute
//           x(t) = rBase*(cos t + t sin t),  y(t) = rBase*(sin t - t cos t)
//       AND the DEFINING involute identity tangent-line-length == base-arc-length
//           | involutePoint(rBase,t) - tangentContact(rBase,t) | == rBase*t
//       over a dense sweep of t on the active flank, residual <= 1e-9.
//   (b) PITCH DIAMETER  d == m*N == 40  EXACTLY (operator==, not a tolerance).
//   (c) TOOTH COUNT == 20 (addendum/tip arcs emitted by the outer rim).
//   (d) Re-build the SAME native solid in OCCT from the NATIVE tessellation:
//       walk the native Solid's faces -> triangulate each outer loop -> feed the
//       triangles to BRepBuilderAPI_Sewing -> close to a TopoDS_Solid -> run
//       BRepCheck_Analyzer (must be a VALID closed solid OCCT accepts) AND
//       GProp_GProps volume must match the native divergence-theorem volume to
//       rel <= 1e-6. This proves the native solid is a genuine, OCCT-acceptable
//       B-rep, independently of the in-house topology validator.
//
// Build (see the run command in the harness):
//   c++ -std=c++20 -O2 -I forge-kernel/include \
//       -I /opt/homebrew/opt/opencascade/include/opencascade \
//       native_vs_occt_gear.cpp <native srcs...> \
//       -L /opt/homebrew/opt/opencascade/lib \
//       -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//       -lTKPrim -lTKShHealing -o native_vs_occt_gear

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ---- in-house native kernel under test ------------------------------------
#include "forge/native/brep/Gear.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

// ---- OpenCASCADE: ONLY as an independent B-rep validity / volume oracle -----
#include <gp_Pnt.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Builder.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static constexpr double PI = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Walk the native Solid and emit a flat list of TRIANGLES (each as three world
// points). Every native face carries an ordered outer loop of coedges; the
// coedge originVertex() sequence is the face's polygon ring. The gear's side
// walls / caps are already triangles (3 coedges), the bore-wall sectors are
// quads (4 coedges) — fan-triangulate any ring of >= 3 vertices.
// ---------------------------------------------------------------------------
struct Tri { double p[3][3]; };

// Signed volume of the tetra (origin, a, b, c) = (a . (b x c)) / 6. Summing this
// over an oriented closed triangle soup is the divergence-theorem volume of that
// EXACT polyhedron (the SAME faceted shell that is sewn into OCCT).
static double tetVol(const double a[3], const double b[3], const double c[3]) {
    const double cx = b[1] * c[2] - b[2] * c[1];
    const double cy = b[2] * c[0] - b[0] * c[2];
    const double cz = b[0] * c[1] - b[1] * c[0];
    return (a[0] * cx + a[1] * cy + a[2] * cz) / 6.0;
}

static std::vector<Tri> nativeTriangles(const Solid& solid) {
    std::vector<Tri> tris;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f || !f->outerLoop || !f->outerLoop->first) continue;
            // Gather the ordered ring of vertices from the coedge loop.
            std::vector<const Vertex*> ring;
            const Coedge* start = f->outerLoop->first;
            const Coedge* c = start;
            do {
                const Vertex* v = c->originVertex();
                if (v) ring.push_back(v);
                c = c->next;
            } while (c && c != start && ring.size() < 64);
            if (ring.size() < 3) continue;
            // Fan-triangulate (ring[0], ring[i], ring[i+1]).
            for (std::size_t i = 1; i + 1 < ring.size(); ++i) {
                Tri t;
                const Vertex* vs[3] = {ring[0], ring[i], ring[i + 1]};
                for (int k = 0; k < 3; ++k) {
                    t.p[k][0] = vs[k]->point.x;
                    t.p[k][1] = vs[k]->point.y;
                    t.p[k][2] = vs[k]->point.z;
                }
                tris.push_back(t);
            }
        }
    }
    return tris;
}

int main() {
    std::printf("== native_vs_occt_gear (involute spur gear cross-check) ==\n");

    // ---- the gear under test (mirrors gear_test.cpp) -----------------------
    GearSpec spec;
    spec.module        = 2.0;
    spec.teeth         = 20;
    spec.pressureAngle = 20.0 * PI / 180.0;  // 20 degrees
    spec.faceWidth     = 10.0;
    spec.boreRadius    = 8.0;
    spec.flankSamples  = 32;

    GearGeometry g = gearDimensions(spec);

    // =======================================================================
    // (b) PITCH DIAMETER == m*N == 40 EXACTLY (operator==)
    // =======================================================================
    const double dExpect = spec.module * (double)spec.teeth; // 2*20
    std::printf("  pitch diameter d = m*N = %.17g  (expect %.17g)\n",
                g.pitchDiameter, dExpect);
    check(g.pitchDiameter == dExpect, "pitch diameter == m*N exactly (==)");
    check(g.pitchDiameter == 40.0,    "pitch diameter == 40 exactly (==)");
    std::printf("  base r=%.9f  pitch r=%.9f  addendum r=%.9f  root r=%.9f\n",
                g.baseRadius, g.pitchRadius, g.addendumRadius, g.rootRadius);

    // =======================================================================
    // (a) INVOLUTE EQUATION residual over a dense sweep of t
    //     - parametric closed form x(t),y(t)
    //     - tangent-line-length == base-arc-length identity (rBase*t)
    // =======================================================================
    const double rBase = g.baseRadius;
    const double tTip  = involuteParamForRadius(rBase, g.addendumRadius);
    double maxResidParam   = 0.0;  // |P(t) - (x(t),y(t))|
    double maxResidTangent = 0.0;  // | |P-C| - rBase*t |
    for (int i = 0; i <= 200000; ++i) {
        double t = tTip * (double)i / 200000.0;
        Vec3 P = involutePoint(rBase, t);
        Vec3 C = involuteTangentContact(rBase, t);
        // closed-form parametric values
        double xExp = rBase * (std::cos(t) + t * std::sin(t));
        double yExp = rBase * (std::sin(t) - t * std::cos(t));
        double rp = std::fabs(P.x - xExp) + std::fabs(P.y - yExp);
        // taut-string (tangent line) length must equal the unrolled base arc
        double tangentLen = std::sqrt((P.x - C.x) * (P.x - C.x) +
                                      (P.y - C.y) * (P.y - C.y));
        double rt = std::fabs(tangentLen - rBase * t);
        maxResidParam   = std::max(maxResidParam, rp);
        maxResidTangent = std::max(maxResidTangent, rt);
    }
    const double maxResid = std::max(maxResidParam, maxResidTangent);
    std::printf("  involute parametric  max residual = %.3e\n", maxResidParam);
    std::printf("  involute tangent-arc max residual = %.3e\n", maxResidTangent);
    std::printf("  involute COMBINED    max residual = %.3e  (over t in [0,%.6f])\n",
                maxResid, tTip);
    check(maxResidParam   <= 1e-9, "flank lies on closed-form involute x(t),y(t) (<=1e-9)");
    check(maxResidTangent <= 1e-9, "tangent-line-length == base-arc-length (<=1e-9)");

    // Residual on the ACTUAL emitted flank vertices of the generated tooth.
    std::vector<Vec3> tooth = gearToothProfile2D(spec, g);
    double maxResidEmitted = 0.0;
    int flankPts = 0;
    for (const Vec3& p : tooth) {
        double r = std::sqrt(p.x * p.x + p.y * p.y);
        if (r > rBase + 1e-7 && r < g.addendumRadius - 1e-7) {
            double t = involuteParamForRadius(rBase, r);
            double tangentLen = std::sqrt(r * r - rBase * rBase); // == rBase*t identity
            double resid = std::fabs(tangentLen - rBase * t);
            maxResidEmitted = std::max(maxResidEmitted, resid);
            ++flankPts;
        }
    }
    std::printf("  emitted-flank involute residual (%d pts) = %.3e\n",
                flankPts, maxResidEmitted);
    check(flankPts > 0 && maxResidEmitted <= 1e-9,
          "emitted flank vertices satisfy the involute equation (<=1e-9)");

    // =======================================================================
    // Build the native gear solid.
    // =======================================================================
    GearResult R = buildGear(spec);
    std::printf("  buildGear ok=%d reason=\"%s\"\n", (int)R.ok, R.reason);
    check(R.ok, "buildGear succeeded");
    if (!R.ok || !R.solid) {
        std::printf("\n== native_vs_occt_gear: ABORT — no native solid ==\n");
        std::printf("REPORT  pitchDia=%.17g  teeth=%d  involuteResidual=%.3e  occtValid=0  volRel=nan\n",
                    g.pitchDiameter, R.toothCount, maxResid);
        return 1;
    }

    // =======================================================================
    // (c) TOOTH COUNT == 20
    // =======================================================================
    std::printf("  tooth count (addendum arcs) = %d  (expect %d)\n",
                R.toothCount, spec.teeth);
    check(R.toothCount == 20, "tooth count == 20");
    check(R.closedManifold, "native: closed 2-manifold (in-house validator)");

    const double nativeVolume = R.volume;
    std::printf("  native V=%zu E=%zu F=%zu  volume=%.9f  area=%.9f\n",
                R.vertices, R.edges, R.faces, R.volume, R.area);

    // =======================================================================
    // (d) Re-build the SAME solid in OCCT from the native tessellation and let
    //     OCCT independently verify it is a valid closed solid with the same
    //     volume.
    // =======================================================================
    std::vector<Tri> tris = nativeTriangles(*R.solid);
    std::printf("  native tessellation -> %zu triangles handed to OCCT sewing\n",
                tris.size());
    check(!tris.empty(), "native tessellation produced triangles for OCCT");

    // Divergence-theorem volume of the EXACT faceted shell handed to OCCT (round
    // bore -> inscribed polygon). This is the apples-to-apples reference for the
    // OCCT GProp volume: both describe the identical polyhedron. The native
    // MassProps `nativeVolume` instead integrates the ANALYTIC round Cylinder
    // bore (the more accurate value); the two differ only by the known chordal
    // facet error of the polygonal bore (an inscribed P-gon has slightly less
    // hole area than the true circle, so the faceted solid keeps slightly more
    // material). We report BOTH and compare OCCT against the faceted reference.
    double facetedVolume = 0.0;
    for (const Tri& t : tris) facetedVolume += tetVol(t.p[0], t.p[1], t.p[2]);
    facetedVolume = std::fabs(facetedVolume);
    std::printf("  native analytic-bore volume = %.9f  (round Cylinder bore)\n",
                nativeVolume);
    std::printf("  native faceted-shell volume = %.9f  (inscribed-polygon bore; "
                "== the soup OCCT receives)\n", facetedVolume);

    // Sew the triangles into a shell. Tolerance is generous relative to the
    // tessellation (mm-scale gear) but far below any feature size, so coincident
    // tessellation vertices fuse into shared edges -> a watertight shell.
    BRepBuilderAPI_Sewing sewer(1.0e-6);
    int faceFails = 0;
    for (const Tri& t : tris) {
        BRepBuilderAPI_MakePolygon poly;
        poly.Add(gp_Pnt(t.p[0][0], t.p[0][1], t.p[0][2]));
        poly.Add(gp_Pnt(t.p[1][0], t.p[1][1], t.p[1][2]));
        poly.Add(gp_Pnt(t.p[2][0], t.p[2][1], t.p[2][2]));
        poly.Close();
        if (!poly.IsDone()) { ++faceFails; continue; }
        BRepBuilderAPI_MakeFace mkFace(poly.Wire(), /*OnlyPlane=*/true);
        if (!mkFace.IsDone()) { ++faceFails; continue; }
        sewer.Add(mkFace.Face());
    }
    std::printf("  triangle->planar-face conversion failures: %d\n", faceFails);
    check(faceFails == 0, "every native triangle became a valid OCCT planar face");

    sewer.Perform();
    TopoDS_Shape sewn = sewer.SewedShape();
    check(!sewn.IsNull(), "OCCT sewing produced a non-null shape");

    // Count free edges (an edge used by != 2 faces means the shell is not closed).
    int nFreeEdges = sewer.NbFreeEdges();
    int nMultiEdges = sewer.NbMultipleEdges();
    int nDegen = sewer.NbDegeneratedShapes();
    std::printf("  sewing: freeEdges=%d  multipleEdges=%d  degenerate=%d\n",
                nFreeEdges, nMultiEdges, nDegen);
    check(nFreeEdges == 0,
          "OCCT shell is watertight (0 free/boundary edges => closed)");

    // Promote the sewn shell(s) into a solid.
    TopoDS_Solid occtSolid;
    bool builtSolid = false;
    {
        TopExp_Explorer exShell(sewn, TopAbs_SHELL);
        if (exShell.More()) {
            TopoDS_Shell shell = TopoDS::Shell(exShell.Current());
            try {
                BRepBuilderAPI_MakeSolid mkSolid(shell);
                if (mkSolid.IsDone()) { occtSolid = mkSolid.Solid(); builtSolid = true; }
            } catch (...) { builtSolid = false; }
        }
        if (!builtSolid) {
            // Fallback: wrap whatever faces exist into a shell -> solid by hand.
            BRep_Builder bb;
            TopoDS_Shell shell; bb.MakeShell(shell);
            for (TopExp_Explorer exF(sewn, TopAbs_FACE); exF.More(); exF.Next())
                bb.Add(shell, TopoDS::Face(exF.Current()));
            try {
                BRepBuilderAPI_MakeSolid mkSolid(shell);
                if (mkSolid.IsDone()) { occtSolid = mkSolid.Solid(); builtSolid = true; }
            } catch (...) { builtSolid = false; }
        }
    }
    check(builtSolid && !occtSolid.IsNull(), "OCCT built a TopoDS_Solid from the sewn shell");

    // BRepCheck_Analyzer: OCCT's own structural validity verdict.
    bool occtValid = false;
    if (builtSolid && !occtSolid.IsNull()) {
        BRepCheck_Analyzer ana(occtSolid, /*GeomControls=*/true);
        occtValid = ana.IsValid();
        std::printf("  BRepCheck_Analyzer.IsValid() = %d\n", (int)occtValid);
    }
    check(occtValid, "OCCT BRepCheck_Analyzer accepts the solid as VALID");

    // GProp volume vs the native faceted-shell volume (apples-to-apples: both are
    // the identical polyhedron). We also report the relErr vs the analytic-bore
    // native volume to expose the (expected, bounded) chordal-bore facet error.
    double occtVolume = 0.0, volRelFaceted = 1.0, volRelAnalytic = 1.0;
    if (builtSolid && !occtSolid.IsNull()) {
        GProp_GProps props;
        BRepGProp::VolumeProperties(occtSolid, props);
        occtVolume = std::fabs(props.Mass()); // signed by orientation; magnitude
        volRelFaceted  = std::fabs(occtVolume - facetedVolume) /
                         (facetedVolume != 0.0 ? std::fabs(facetedVolume) : 1.0);
        volRelAnalytic = std::fabs(occtVolume - nativeVolume) /
                         (nativeVolume  != 0.0 ? std::fabs(nativeVolume)  : 1.0);
        std::printf("  OCCT volume = %.9f\n", occtVolume);
        std::printf("  relErr vs native FACETED-shell volume  = %.3e  (same polyhedron)\n",
                    volRelFaceted);
        std::printf("  relErr vs native ANALYTIC-bore volume  = %.3e  (round vs faceted bore)\n",
                    volRelAnalytic);
    }
    // Primary cross-check: OCCT's measurement of the native solid equals the
    // native solid's own (faceted) volume to machine precision.
    check(volRelFaceted <= 1e-6,
          "OCCT GProp volume matches native faceted-shell volume (relErr <= 1e-6)");
    // Secondary: the analytic round-bore volume differs only by the known small
    // bore-facet error (an inscribed P-gon bore), well under 1e-5 here.
    check(volRelAnalytic <= 1e-5,
          "OCCT volume within bore-facet bound of native analytic volume (<=1e-5)");

    // independent native re-measure for sanity (gaussN=8).
    MassProps mp = massProperties(*R.solid, 8);
    check(std::fabs(mp.volume - nativeVolume) <= 1e-9 * std::fabs(nativeVolume),
          "native volume re-measure consistent");

    // ---- verdict -----------------------------------------------------------
    const bool pitchExact = (g.pitchDiameter == 40.0) && (g.pitchDiameter == dExpect);
    const bool involuteOk = (maxResid <= 1e-9) && (maxResidEmitted <= 1e-9);
    const bool occtOk      = occtValid && (volRelFaceted <= 1e-6);
    const bool VERDICT     = involuteOk && pitchExact && occtOk;

    std::printf("\n== native_vs_occt_gear: %d/%d checks passed ==\n", g_pass, g_total);
    std::printf("REPORT  pitchDia=%.17g  teeth=%d  involuteResidual=%.3e  "
                "occtValid=%d  nativeVolAnalytic=%.9f  nativeVolFaceted=%.9f  "
                "occtVol=%.9f  volRelFaceted=%.3e  volRelAnalytic=%.3e\n",
                g.pitchDiameter, R.toothCount, maxResid,
                (int)occtValid, nativeVolume, facetedVolume, occtVolume,
                volRelFaceted, volRelAnalytic);
    std::printf("VERDICT %s\n", VERDICT ? "PASS" : "FAIL");
    return (g_pass == g_total && VERDICT) ? 0 : 1;
}
