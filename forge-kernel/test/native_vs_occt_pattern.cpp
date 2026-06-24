// forge-kernel/test/native_vs_occt_pattern.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native ANALYTIC FEATURE PATTERN
//   (forge::native::brep::applyPattern, linear / circular)   vs   OCCT
//   (BRepPrimAPI_MakeBox plate + N transformed BRepPrimAPI_MakeCylinder tools,
//    fused into one compound, BRepAlgoAPI_Cut from the plate).
//
// This is the pattern-feature SIBLING of native_vs_occt_chamfer.cpp / _fillet.cpp
// (READ those first; this mirrors their harness structure). It is a STANDALONE
// C++20 oracle test that LINKS OCCT (brew opencascade 7.9.3). It is NOT part of
// the native gate (run_native.sh) and does NOT touch binding.cpp / CMakeLists.txt.
//
// It builds the SAME two pattern cases on BOTH sides — IDENTICAL to the cases
// pattern_test.cpp gates — and compares the two physical signatures the analytic
// pattern must match OCCT on (patterned VOLUME, rel <= 1e-6, and the bored-HOLE
// COUNT):
//
//   CASE A — CIRCULAR: a 20x20x2 plate (V=800) drilled with a BOLT CIRCLE of 6
//     holes (cylinder r=1, through the 2mm thickness) on bolt-circle radius 7
//     centred on the plate (axisOrigin (10,10,0), axis +Z, 60deg step; first hole
//     at (17,10)). Non-overlapping => the EXACT analytic patterned volume is
//       800 - 6 * pi * r^2 * t = 800 - 12*pi = 762.3008928790093...
//     Bored-hole count = 6.
//
//   CASE B — LINEAR: the same plate drilled with a ROW of 4 holes (r=1) spaced
//     5mm in +X (centres x = 2.5, 7.5, 12.5, 17.5; y=10). Non-overlapping =>
//       800 - 4 * pi * r^2 * t = 800 - 8*pi = 774.8672034..
//     Bored-hole count = 4.
//
// On the NATIVE side the tool builder, the pattern spec, the plate, and the
// nSeg=128 faceting are LITERALLY the same as pattern_test.cpp. On the OCCT side
// the plate is BRepPrimAPI_MakeBox(20,20,2); each hole instance is a
// BRepPrimAPI_MakeCylinder(r=1, h=4) placed by a gp_Trsf to the SAME centre the
// native pattern transforms put it (the circular instances are produced by the
// SAME axis rotation; the linear instances by the SAME +X step). All N tools are
// fused (BRepAlgoAPI_Fuse) into one compound and CUT from the plate in one
// BRepAlgoAPI_Cut — the OCCT analogue of applyPattern's ONE-feature-ONE-boolean
// compound strategy. Volume via BRepGProp::VolumeProperties.Mass(); the cut faces
// are counted (GeomAbs_Cylinder lateral bore walls => one per hole).
//
// GATES (verdict = PASS iff ALL pass):
//   (1) CIRCULAR patterned VOLUME  native vs OCCT  rel <= 1e-6  (both == 762.3008..)
//   (2) LINEAR   patterned VOLUME  native vs OCCT  rel <= 1e-6  (both == 774.8672..)
//   (3) CIRCULAR bored-hole COUNT  native == OCCT == 6
//   (4) LINEAR   bored-hole COUNT  native == OCCT == 4
//
// Build + run (manual; mirrors native_vs_occt_chamfer.cpp's build line + the OCCT
// boolean/prim link set):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     <native sources, see list below> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_pattern.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_pattern && /tmp/native_vs_occt_pattern
//
// native sources (trim to what links):
//   src/native/brep/{Pattern,Boolean,Primitives,Topology,Surface,Curve,MassProps,
//                    Nurbs,NurbsSurface,SurfaceIntersect,SolidTessellate}.cpp
//   src/native/mesh/{MeshBooleanNative,HalfEdgeMesh,TriTriIntersect,MeshBoolean}.cpp
//   src/native/geom/{ConstrainedDelaunay2D,Geom,Delaunay}.cpp
//   src/native/{Predicates,ExactReal,ExactPredicates3D}.cpp

// --- native analytic feature pattern ---------------------------------------
#include "forge/native/brep/Pattern.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax2.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

constexpr double PI = 3.14159265358979323846;

// Shared problem definition (LITERALLY pattern_test.cpp's cases) ------------
static constexpr double kPlateX = 20.0, kPlateY = 20.0, kPlateZ = 2.0;
static constexpr double kPlateV = kPlateX * kPlateY * kPlateZ;   // 800
static constexpr double kHoleR  = 1.0;                            // cylinder radius
static constexpr double kHoleH  = 4.0;                            // pierces 2mm fully
static constexpr double kHoleZ  = -1.0;                           // base z so it pierces
static constexpr double kThick  = 2.0;                            // material thickness cut
static constexpr int    kNSeg   = 128;

// CIRCULAR: 6 holes, bolt-circle radius 7, centred on plate centre (10,10).
static constexpr int    kCircN     = 6;
static constexpr double kCircCx    = 10.0, kCircCy = 10.0;        // axis / bolt-circle centre
static constexpr double kCircFirstX = 17.0, kCircFirstY = 10.0;   // first hole (10+7,10)
static const     double kCircExpect = kPlateV - kCircN * PI * kHoleR * kHoleR * kThick; // 800-12pi

// LINEAR: 4 holes, +X spacing 5, first at (2.5,10).
static constexpr int    kLinN      = 4;
static constexpr double kLinFirstX = 2.5, kLinFirstY = 10.0;
static constexpr double kLinStep   = 5.0;
static const     double kLinExpect = kPlateV - kLinN * PI * kHoleR * kHoleR * kThick; // 800-8pi

// ===========================================================================
// NATIVE side — IDENTICAL to pattern_test.cpp (holeAt builder + pattern specs).
// ===========================================================================

// Tool builder mirroring pattern_test.cpp::holeAt exactly.
static ToolBuilder holeAt(double cx, double cy, double r, double zBase, double h) {
    return [=](SolidFactory& f) -> Solid* {
        Solid* cyl = f.buildCylinder(r, h);   // axis +Z, base z=0
        RigidTransform xf; xf.t = Vec3{cx, cy, zBase}; xf.det = 1.0;
        transformSolidInPlace(xf, cyl, f.builder());
        return cyl;
    };
}

// Count the cylindrical bore-wall FACE SETS in a native result (same convention
// as pattern_test.cpp::curvedFaceCount: SolidFactory builds a cylinder as an
// equal-radius CONE, so a bore wall reports Cone-kind; each hole = nSeg sectors of
// one analytic cylinder; holes = curvedFaceCount / nSeg).
static int nativeCurvedFaceCount(const Solid& s) {
    int n = 0;
    for (Shell* sh : s.shells) for (Face* f : sh->faces) {
        if (!f->surface) continue;
        if (f->surface->kind == SurfaceKind::Cylinder ||
            f->surface->kind == SurfaceKind::Cone)
            ++n;
    }
    return n;
}

struct NativeOut {
    bool   ok = false;
    double volume = 0.0;
    int    holes = 0;
    bool   usedMeshFallback = false;
    bool   closed2Manifold = false;
};

static NativeOut runNativeCircular() {
    NativeOut out;
    PrimitiveOptions hi; hi.nSeg = kNSeg;
    SolidFactory plateFac;
    Solid* plate = plateFac.buildBox(kPlateX, kPlateY, kPlateZ);

    PatternSpec spec;
    spec.kind = PatternKind::Circular;
    spec.count = kCircN;
    spec.axisOrigin = Vec3{kCircCx, kCircCy, 0};
    spec.axisDir = Vec3{0, 0, 1};
    spec.angleStep = 2.0 * PI / kCircN;

    BooleanResult r = applyPattern(*plate, holeAt(kCircFirstX, kCircFirstY, kHoleR, kHoleZ, kHoleH),
                                   spec, BoolOp::Cut, hi);
    if (!r.ok) { std::printf("  [native circular] NOT ok: %s\n", r.reason); return out; }
    out.ok = true;
    out.volume = massProperties(*r.solid).volume;
    out.usedMeshFallback = r.usedMeshFallback;
    out.closed2Manifold = r.owner->isClosedTwoManifold();
    out.holes = nativeCurvedFaceCount(*r.solid) / kNSeg;
    return out;
}

static NativeOut runNativeLinear() {
    NativeOut out;
    PrimitiveOptions hi; hi.nSeg = kNSeg;
    SolidFactory plateFac;
    Solid* plate = plateFac.buildBox(kPlateX, kPlateY, kPlateZ);

    PatternSpec spec;
    spec.kind = PatternKind::Linear;
    spec.count = kLinN;
    spec.step = Vec3{kLinStep, 0, 0};

    BooleanResult r = applyPattern(*plate, holeAt(kLinFirstX, kLinFirstY, kHoleR, kHoleZ, kHoleH),
                                   spec, BoolOp::Cut, hi);
    if (!r.ok) { std::printf("  [native linear] NOT ok: %s\n", r.reason); return out; }
    out.ok = true;
    out.volume = massProperties(*r.solid).volume;
    out.usedMeshFallback = r.usedMeshFallback;
    out.closed2Manifold = r.owner->isClosedTwoManifold();
    out.holes = nativeCurvedFaceCount(*r.solid) / kNSeg;
    return out;
}

// ===========================================================================
// OCCT side — same plate box + N transformed cylinders, fused, CUT from plate.
// ===========================================================================
struct OcctOut {
    bool   ok = false;
    double volume = 0.0;
    int    holes = 0;   // distinct cylindrical bore walls in the cut result
};

// Count the cylindrical lateral faces (bore walls) of the OCCT cut result. Each
// through-hole leaves exactly ONE cylindrical lateral surface of radius kHoleR.
// (The plate's own faces are all planar; the cylinder caps are cut away as the
// tool pierces the plate fully, so only the bore wall survives.)
static int occtCylBoreCount(const TopoDS_Shape& shape) {
    int n = 0;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface surf(f);
        if (surf.GetType() == GeomAbs_Cylinder) {
            double rr = surf.Cylinder().Radius();
            if (std::fabs(rr - kHoleR) <= 1e-6) ++n;
        }
    }
    return n;
}

// Build one OCCT hole cylinder (r=kHoleR, h=kHoleH) with its base at (cx,cy,kHoleZ),
// axis +Z — EXACTLY the placement the native holeAt + pattern transform produce.
static TopoDS_Shape occtHole(double cx, double cy) {
    gp_Ax2 ax(gp_Pnt(cx, cy, kHoleZ), gp_Dir(0, 0, 1));
    return BRepPrimAPI_MakeCylinder(ax, kHoleR, kHoleH).Shape();
}

// Fuse a list of tool shapes into ONE compound tool (the OCCT analogue of
// applyPattern's single multi-shell compound), then CUT from the plate in ONE
// boolean. Returns (volume, cylindrical-bore count).
static OcctOut occtPatternCut(const std::vector<std::pair<double,double>>& centres) {
    OcctOut out;
    if (centres.empty()) return out;

    BRepPrimAPI_MakeBox mkBox(gp_Pnt(0, 0, 0), kPlateX, kPlateY, kPlateZ);
    TopoDS_Shape plate = mkBox.Shape();

    // Fuse all N tool cylinders into one compound tool.
    TopoDS_Shape tool = occtHole(centres[0].first, centres[0].second);
    for (std::size_t i = 1; i < centres.size(); ++i) {
        TopoDS_Shape next = occtHole(centres[i].first, centres[i].second);
        BRepAlgoAPI_Fuse fuse(tool, next);
        fuse.Build();
        if (!fuse.IsDone()) { std::printf("  [occt] fuse %zu not done\n", i); return out; }
        tool = fuse.Shape();
    }

    // ONE cut: plate - (fused tools).
    BRepAlgoAPI_Cut cut(plate, tool);
    cut.Build();
    if (!cut.IsDone()) { std::printf("  [occt] cut not done\n"); return out; }
    TopoDS_Shape result = cut.Shape();
    if (result.IsNull()) { std::printf("  [occt] cut result null\n"); return out; }

    GProp_GProps props;
    BRepGProp::VolumeProperties(result, props);
    out.volume = props.Mass();
    out.holes = occtCylBoreCount(result);
    out.ok = true;
    return out;
}

// Centres of the CIRCULAR bolt circle: 6 holes on radius 7 about (10,10), first at
// (17,10), 60deg step — the SAME placements the native circular pattern produces.
static std::vector<std::pair<double,double>> circCentres() {
    std::vector<std::pair<double,double>> c;
    const double rx = kCircFirstX - kCircCx, ry = kCircFirstY - kCircCy; // (7,0)
    for (int k = 0; k < kCircN; ++k) {
        double a = (2.0 * PI / kCircN) * k;
        double ca = std::cos(a), sa = std::sin(a);
        c.emplace_back(kCircCx + (ca * rx - sa * ry), kCircCy + (sa * rx + ca * ry));
    }
    return c;
}

// Centres of the LINEAR row: 4 holes from (2.5,10) stepping +X by 5.
static std::vector<std::pair<double,double>> linCentres() {
    std::vector<std::pair<double,double>> c;
    for (int k = 0; k < kLinN; ++k)
        c.emplace_back(kLinFirstX + kLinStep * k, kLinFirstY);
    return c;
}

int main() {
    std::printf("=== A/B 1:1  native analytic FEATURE PATTERN  vs  OCCT "
                "(MakeBox + N MakeCylinder, fuse, Cut) ===\n");
    std::printf("    plate %gx%gx%g (V=%g)   hole r=%g through t=%g   nSeg=%d\n\n",
                kPlateX, kPlateY, kPlateZ, kPlateV, kHoleR, kThick, kNSeg);

    // ---------------- CIRCULAR ----------------
    std::printf("[CIRCULAR] bolt circle: %d holes r=%g on radius 7, centre (%g,%g)\n",
                kCircN, kHoleR, kCircCx, kCircCy);
    const NativeOut natC = runNativeCircular();
    const OcctOut   occC = occtPatternCut(circCentres());
    std::printf("  NATIVE : vol=%.15f  holes=%d  fallback=%d  closed2mfd=%d\n",
                natC.volume, natC.holes, natC.usedMeshFallback, natC.closed2Manifold);
    std::printf("  OCCT   : vol=%.15f  holes=%d\n", occC.volume, occC.holes);
    std::printf("  ORACLE : vol=%.15f  (= 800 - 12*pi)\n", kCircExpect);
    double cAbs = std::fabs(natC.volume - occC.volume);
    double cRel = occC.volume != 0.0 ? cAbs / std::fabs(occC.volume) : 1e9;
    std::printf("  -> |native.vol - occt.vol| = %.6e   rel = %.6e\n\n", cAbs, cRel);

    // ---------------- LINEAR ----------------
    std::printf("[LINEAR] row: %d holes r=%g spacing %g in +X, first (%g,%g)\n",
                kLinN, kHoleR, kLinStep, kLinFirstX, kLinFirstY);
    const NativeOut natL = runNativeLinear();
    const OcctOut   occL = occtPatternCut(linCentres());
    std::printf("  NATIVE : vol=%.15f  holes=%d  fallback=%d  closed2mfd=%d\n",
                natL.volume, natL.holes, natL.usedMeshFallback, natL.closed2Manifold);
    std::printf("  OCCT   : vol=%.15f  holes=%d\n", occL.volume, occL.holes);
    std::printf("  ORACLE : vol=%.15f  (= 800 - 8*pi)\n", kLinExpect);
    double lAbs = std::fabs(natL.volume - occL.volume);
    double lRel = occL.volume != 0.0 ? lAbs / std::fabs(occL.volume) : 1e9;
    std::printf("  -> |native.vol - occt.vol| = %.6e   rel = %.6e\n", lAbs, lRel);

    std::printf("\n=== GATES ===\n");
    check(natC.ok, "native circular applyPattern ok");
    check(occC.ok, "occt   circular MakeBox+MakeCylinder+Fuse+Cut ok");
    check(natL.ok, "native linear   applyPattern ok");
    check(occL.ok, "occt   linear   MakeBox+MakeCylinder+Fuse+Cut ok");

    // (1) CIRCULAR patterned volume native vs OCCT, rel <= 1e-6.
    check(natC.ok && occC.ok && cRel <= 1e-6,
          "CIRCULAR patterned VOLUME native == OCCT  (relative <= 1e-6)");
    // sanity: both hit the closed-form oracle 800-12pi.
    check(natC.ok && std::fabs(natC.volume - kCircExpect) / kCircExpect <= 1e-6,
          "native circular volume == 800 - 12*pi  (rel <= 1e-6)");
    check(occC.ok && std::fabs(occC.volume - kCircExpect) / kCircExpect <= 1e-6,
          "occt   circular volume == 800 - 12*pi  (rel <= 1e-6)");

    // (2) LINEAR patterned volume native vs OCCT, rel <= 1e-6.
    check(natL.ok && occL.ok && lRel <= 1e-6,
          "LINEAR patterned VOLUME native == OCCT  (relative <= 1e-6)");
    check(natL.ok && std::fabs(natL.volume - kLinExpect) / kLinExpect <= 1e-6,
          "native linear volume == 800 - 8*pi  (rel <= 1e-6)");
    check(occL.ok && std::fabs(occL.volume - kLinExpect) / kLinExpect <= 1e-6,
          "occt   linear volume == 800 - 8*pi  (rel <= 1e-6)");

    // (3) CIRCULAR bored-hole count native == OCCT == 6.
    check(natC.holes == kCircN, "native circular bored-hole count == 6");
    check(occC.holes == kCircN, "occt   circular bored-hole count == 6");
    check(natC.holes == occC.holes, "CIRCULAR bored-hole count native == OCCT");

    // (4) LINEAR bored-hole count native == OCCT == 4.
    check(natL.holes == kLinN, "native linear bored-hole count == 4");
    check(occL.holes == kLinN, "occt   linear bored-hole count == 4");
    check(natL.holes == occL.holes, "LINEAR bored-hole count native == OCCT");

    const bool volPass =
        natC.ok && occC.ok && cRel <= 1e-6 &&
        natL.ok && occL.ok && lRel <= 1e-6;
    const bool holePass =
        natC.holes == kCircN && occC.holes == kCircN && natC.holes == occC.holes &&
        natL.holes == kLinN  && occL.holes == kLinN  && natL.holes == occL.holes;

    std::printf("\n=== VERDICT: %s ===\n", (volPass && holePass) ? "PASS" : "FAIL");
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
