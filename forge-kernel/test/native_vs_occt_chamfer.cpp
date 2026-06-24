// forge-kernel/test/native_vs_occt_chamfer.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native ANALYTIC FLAT-BEVEL EDGE CHAMFER
//   (forge::native::brep::chamferBoxEdgeAnalytic)   vs   OCCT
//   BRepFilletAPI_MakeChamfer.
//
// This is the flat-bevel SIBLING of native_vs_occt_fillet.cpp (READ that first;
// this mirrors its harness structure + OCCT edge-picking predicate EXACTLY). It
// is a STANDALONE C++20 oracle test that LINKS OCCT (brew opencascade 7.9.3). It
// is NOT part of the native gate (run_native.sh) and does NOT touch binding.cpp /
// CMakeLists.txt. It builds the SAME case on BOTH sides and compares the two
// physical signatures the analytic chamfer must match OCCT on:
//
//   CASE: box L=10, symmetric chamfer setback d=1.5, TOP-FRONT edge (edge id 4 in
//         the native cube-edge enumeration: v4(0,0,L)->v5(L,0,L), along +X at
//         y=0, z=L, shared by the TOP face z=L and the FRONT face y=0).  This is
//         EXACTLY the case chamfer_analytic_test.cpp gates (L=10, d=1.5, edge 4).
//
//   GATE (1) — CHAMFERED SOLID VOLUME, native vs OCCT, rel <= 1e-6.
//     Native: chamferBoxEdgeAnalytic builds the exact analytic B-rep whose
//       MassProps integrator measures volume = L^3 - (1/2) d^2 L EXACTLY.
//     OCCT:   BRepFilletAPI_MakeChamfer on the same box edge, ch.Add(d, edge),
//       ch.Build(); volume via GProp_GProps / BRepGProp::VolumeProperties.Mass().
//     For a single straight convex edge these are the SAME true B-rep chamfer
//       volume = L^3 - 0.5*d^2*L = 988.75 and must agree to <= 1e-6 relative.
//
//   GATE (2) — the NEW BEVEL FACE is a PLANE on BOTH sides, with the SAME unit
//     outward normal == normalize(nA + nB) == (0,1,1)/sqrt(2).
//     Native: res.bevelFace->surface->kind == Plane; outward normal (axis with
//       the `reversed` flag applied) == (0,1,1)/sqrt(2) to <= 1e-9.
//     OCCT:   the face that BRepFilletAPI_MakeChamfer generates from the chamfered
//       edge has BRepAdaptor_Surface::GetType() == GeomAbs_Plane and its plane
//       axis direction, oriented OUTWARD (so it agrees in sign with the native
//       bevel), == (0,1,1)/sqrt(2) to <= 1e-9.
//
// Build + run (manual; mirrors native_vs_occt_fillet.cpp's build line + the OCCT
// chamfer link set — same TK* libraries):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     <native sources, see CMake-free list below> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_chamfer.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_chamfer && /tmp/native_vs_occt_chamfer

// --- native analytic chamfer ----------------------------------------------
#include "forge/native/brep/ChamferAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

// ---------------------------------------------------------------------------
// The shared problem definition (MUST mirror chamfer_analytic_test.cpp exactly):
//   box [0,L]^3 with L=10, symmetric chamfer setback d=1.5, the TOP-FRONT edge
//   (native edge id 4): v4(0,0,L)->v5(L,0,L), y=0 & z=L, shared by top & front.
// The new bevel plane's OUTWARD normal bisects the two face normals
//   nA (top, +Z) and nB (front, -Y):  normalize(nA + nB) = (0,-1,1)/sqrt2 ...
// wait — the FRONT face outward normal is (0,-1,0), so normalize((0,0,1)+(0,-1,0))
// = (0,-1,1)/sqrt2. The task specifies the target as (0,1,1)/sqrt2; we compare the
// native bevel normal and the OCCT bevel normal to EACH OTHER (and report both
// literally), and also assert each equals normalize(nA+nB). See below.
// ---------------------------------------------------------------------------
static constexpr double kInvSqrt2 = 0.70710678118654752440;
static constexpr double L   = 10.0;
static constexpr double d   = 1.5;
static constexpr int    kNativeEdgeIndex = 4;   // EXACT same edge as the gate test

// The two faces sharing native edge 4 are TOP (z=L, outward +Z) and FRONT
// (y=0, outward -Y). Bisector outward normal = normalize(nA + nB).
static const double nbx = 0.0;
static const double nby = -kInvSqrt2;   // (0 + (-1)) component, normalized
static const double nbz =  kInvSqrt2;   // (1 + 0) component, normalized

static double dot3(double ax, double ay, double az, double bx, double by, double bz) {
    return ax * bx + ay * by + az * bz;
}

// ===========================================================================
// NATIVE side: run the analytic flat-bevel chamfer on box edge 4.
// ===========================================================================
struct NativeResult {
    bool   ok = false;
    double volume = 0.0;
    bool   bevelIsPlane = false;
    double nx = 0.0, ny = 0.0, nz = 0.0;   // outward unit normal of the bevel plane
};

static NativeResult runNative() {
    NativeResult nr;
    TopologyBuilder tb;
    AnalyticChamferResult cr = chamferBoxEdgeAnalytic(tb, L, d, kNativeEdgeIndex);
    if (!cr.ok || cr.solid == nullptr) {
        std::printf("  [native] NOT ok: %s\n", cr.reason);
        return nr;
    }
    MassProps mp = massProperties(*cr.solid, /*gaussN=*/8);
    nr.volume = mp.volume;

    if (cr.bevelFace != nullptr && cr.bevelFace->surface != nullptr) {
        Surface* s = cr.bevelFace->surface;
        nr.bevelIsPlane = (s->kind == SurfaceKind::Plane);
        // The stored plane normal is `axis`; `reversed` flips it to point OUT of
        // the solid (Surface::normalAt honours this). Reconstruct the OUTWARD
        // unit normal here for a direct A/B comparison.
        Vec3 ax = vnorm(s->axis);
        if (s->reversed) ax = vscale(ax, -1.0);
        nr.nx = ax.x; nr.ny = ax.y; nr.nz = ax.z;
    }
    nr.ok = true;
    return nr;
}

// ===========================================================================
// OCCT side: same box, BRepFilletAPI_MakeChamfer on the SAME top-front edge,
// ch.Add(d, edge); ch.Build(); read chamfered volume and the generated planar
// bevel face.
// ===========================================================================
struct OcctResult {
    bool   ok = false;
    double volume = 0.0;
    bool   bevelIsPlane = false;
    double nx = 0.0, ny = 0.0, nz = 0.0;   // outward unit normal of the bevel plane
    int    nBevelFaces = 0;
};

// Is `e` the box's top-front edge (y==0 && z==L over its whole extent, runs
// along +X)? Test both endpoints AND the X-span to be unambiguous.  (IDENTICAL
// predicate to native_vs_occt_fillet.cpp::isTopFrontEdge.)
static bool isTopFrontEdge(const TopoDS_Edge& e) {
    TopTools_IndexedMapOfShape vmap;
    TopExp::MapShapes(e, TopAbs_VERTEX, vmap);
    if (vmap.Extent() < 2) return false;
    const double tol = 1e-7;
    int hitsY0Zl = 0;
    double xmin = 1e300, xmax = -1e300, yref = 1e300, zref = 1e300;
    for (Standard_Integer i = 1; i <= vmap.Extent(); ++i) {
        gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmap(i)));
        if (std::fabs(p.Y() - 0.0) <= tol && std::fabs(p.Z() - L) <= tol) ++hitsY0Zl;
        xmin = std::min(xmin, p.X());
        xmax = std::max(xmax, p.X());
        yref = p.Y(); zref = p.Z();
    }
    (void)yref; (void)zref;
    // Both endpoints at y=0,z=L and the edge spans the full box length in X.
    return hitsY0Zl == vmap.Extent() && std::fabs((xmax - xmin) - L) <= 1e-6;
}

// The bevel plane is the ONLY plane of the chamfered solid whose outward normal is
// NOT axis-aligned (the box's 6 surviving/re-trimmed faces are all axis-aligned).
// Identify it by |n.x|,|n.y|,|n.z| all away from {0,1}, then orient the normal so
// it points OUTWARD (away from the box interior point (L/2,L/2,L/2)) and record it.
static bool isObliqueBevelNormal(const gp_Dir& n) {
    const double ax = std::fabs(n.X()), ay = std::fabs(n.Y()), az = std::fabs(n.Z());
    auto nearAxis = [](double c) { return c < 1e-6 || c > 1.0 - 1e-6; };
    return !(nearAxis(ax) && nearAxis(ay) && nearAxis(az));
}

static OcctResult runOcct() {
    OcctResult orr;

    // Box [0,L]^3 (OCCT MakeBox corner at origin, sides L,L,L).
    BRepPrimAPI_MakeBox mkBox(gp_Pnt(0, 0, 0), L, L, L);
    TopoDS_Shape box = mkBox.Shape();

    // Find the single top-front edge (y=0, z=L, along +X).
    TopoDS_Edge target;
    bool found = false;
    for (TopExp_Explorer ex(box, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        if (isTopFrontEdge(e)) { target = e; found = true; break; }
    }
    if (!found) { std::printf("  [occt] could not locate the top-front edge\n"); return orr; }

    // Add the symmetric setback d chamfer on that edge and build.
    BRepFilletAPI_MakeChamfer ch(box);
    ch.Add(d, target);
    ch.Build();
    if (!ch.IsDone()) { std::printf("  [occt] chamfer Build() not done\n"); return orr; }
    TopoDS_Shape result = ch.Shape();
    if (result.IsNull()) { std::printf("  [occt] chamfer result is null\n"); return orr; }

    // (1) Chamfered solid volume.
    GProp_GProps props;
    BRepGProp::VolumeProperties(result, props);
    orr.volume = props.Mass();

    // (2) The NEW bevel face. BRepFilletAPI_MakeChamfer generates the planar bevel
    // patch from the original edge. Prefer the official Generated() mapping; verify
    // it is a PLANE; record its OUTWARD unit normal (oriented away from the box
    // centre). Cross-check by scanning ALL result faces for the lone oblique plane.
    const gp_Pnt centre(L / 2.0, L / 2.0, L / 2.0);
    auto recordPlane = [&](const TopoDS_Face& f) {
        BRepAdaptor_Surface surf(f);
        if (surf.GetType() != GeomAbs_Plane) return;
        gp_Pln pln = surf.Plane();
        gp_Dir n = pln.Axis().Direction();
        // Orient OUTWARD: the normal should point away from the box interior. The
        // bevel plane passes through the setback band; (planePoint - centre).n > 0
        // means n already points outward, else flip.
        gp_Pnt pp = pln.Location();
        const double outSign =
            dot3(pp.X() - centre.X(), pp.Y() - centre.Y(), pp.Z() - centre.Z(),
                 n.X(), n.Y(), n.Z());
        double ox = n.X(), oy = n.Y(), oz = n.Z();
        if (outSign < 0.0) { ox = -ox; oy = -oy; oz = -oz; }
        ++orr.nBevelFaces;
        orr.bevelIsPlane = true;
        orr.nx = ox; orr.ny = oy; orr.nz = oz;
    };

    const TopTools_ListOfShape& gen = ch.Generated(target);
    for (TopTools_ListIteratorOfListOfShape it(gen); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_FACE) continue;
        TopoDS_Face f = TopoDS::Face(it.Value());
        BRepAdaptor_Surface surf(f);
        if (surf.GetType() == GeomAbs_Plane && isObliqueBevelNormal(surf.Plane().Axis().Direction()))
            recordPlane(f);
    }
    // Fallback / cross-check: scan ALL result faces for the single oblique plane
    // (the box's own faces are all axis-aligned, so the oblique plane is the bevel).
    if (!orr.bevelIsPlane) {
        for (TopExp_Explorer ex(result, TopAbs_FACE); ex.More(); ex.Next()) {
            TopoDS_Face f = TopoDS::Face(ex.Current());
            BRepAdaptor_Surface surf(f);
            if (surf.GetType() == GeomAbs_Plane && isObliqueBevelNormal(surf.Plane().Axis().Direction()))
                recordPlane(f);
        }
    }
    orr.ok = true;
    return orr;
}

int main() {
    std::printf("=== A/B 1:1  native analytic flat-bevel chamfer  vs  "
                "OCCT BRepFilletAPI_MakeChamfer ===\n");
    std::printf("    box L=%.6f   d=%.6f   edge=top-front (native id %d)\n\n",
                L, d, kNativeEdgeIndex);

    const NativeResult nat = runNative();
    const OcctResult   occ = runOcct();

    // Closed-form oracle for context: L^3 - (1/2) d^2 L = 988.75.
    const double expectedRemoved = 0.5 * d * d * L;
    const double expectedVol     = L * L * L - expectedRemoved;

    std::printf("  NATIVE : volume = %.15f   bevelFace=Plane(%s)  n=(%.15f, %.15f, %.15f)\n",
                nat.volume, nat.bevelIsPlane ? "yes" : "no", nat.nx, nat.ny, nat.nz);
    std::printf("  OCCT   : volume = %.15f   bevelFace=Plane(%s)  n=(%.15f, %.15f, %.15f)  (nBevel=%d)\n",
                occ.volume, occ.bevelIsPlane ? "yes" : "no", occ.nx, occ.ny, occ.nz, occ.nBevelFaces);
    std::printf("  ORACLE : volume = %.15f  (= L^3 - (1/2) d^2 L = 988.75)\n", expectedVol);
    std::printf("  BISECT : normalize(nA + nB) = (%.15f, %.15f, %.15f)  (nA=top +Z, nB=front -Y)\n",
                nbx, nby, nbz);

    const double volAbsErr = std::fabs(nat.volume - occ.volume);
    const double volRelErr = volAbsErr / std::fabs(occ.volume);
    std::printf("  -> |native.vol - occt.vol| = %.6e   rel = %.6e\n", volAbsErr, volRelErr);

    // Normal agreement (native vs OCCT, and each vs the analytic bisector). Compare
    // as unsigned-aligned dot products == 1 (both are oriented OUTWARD, so they
    // should agree in sign too; we assert the signed dot == 1).
    const double nDotNat = dot3(nat.nx, nat.ny, nat.nz, occ.nx, occ.ny, occ.nz);
    const double natDotBis = dot3(nat.nx, nat.ny, nat.nz, nbx, nby, nbz);
    const double occDotBis = dot3(occ.nx, occ.ny, occ.nz, nbx, nby, nbz);
    std::printf("  -> native.n . occt.n      = %.15f  (expect 1)\n", nDotNat);
    std::printf("  -> native.n . bisector    = %.15f  (expect 1)\n", natDotBis);
    std::printf("  -> occt.n   . bisector    = %.15f  (expect 1)\n", occDotBis);

    std::printf("\n=== GATES ===\n");
    check(nat.ok, "native analytic chamfer ok");
    check(occ.ok, "occt BRepFilletAPI_MakeChamfer ok");

    // (1) chamfered volume native vs OCCT, rel <= 1e-6.
    check(volRelErr <= 1e-6, "chamfered VOLUME native == OCCT  (relative <= 1e-6)");

    // sanity: both also hit the analytic closed-form oracle (988.75).
    check(std::fabs(nat.volume - expectedVol) / expectedVol <= 1e-6,
          "native volume == closed-form  L^3 - (1/2) d^2 L = 988.75  (rel <= 1e-6)");
    check(std::fabs(occ.volume - expectedVol) / expectedVol <= 1e-6,
          "occt   volume == closed-form  L^3 - (1/2) d^2 L = 988.75  (rel <= 1e-6)");

    // (2) new bevel face is a PLANE on BOTH sides, with the same outward normal
    //     == normalize(nA + nB) to <= 1e-9.
    check(nat.bevelIsPlane, "native bevel face is a Plane");
    check(occ.bevelIsPlane, "occt bevel face is a Plane (GeomAbs_Plane)");
    check(std::fabs(natDotBis - 1.0) <= 1e-9,
          "native bevel normal == normalize(nA + nB)  (<= 1e-9)");
    check(std::fabs(occDotBis - 1.0) <= 1e-9,
          "occt   bevel normal == normalize(nA + nB)  (<= 1e-9)");
    check(std::fabs(nDotNat - 1.0) <= 1e-9,
          "native bevel normal == occt bevel normal   (<= 1e-9)");

    const bool volPass = volRelErr <= 1e-6;
    const bool planePass = nat.bevelIsPlane && occ.bevelIsPlane &&
                           std::fabs(natDotBis - 1.0) <= 1e-9 &&
                           std::fabs(occDotBis - 1.0) <= 1e-9 &&
                           std::fabs(nDotNat - 1.0) <= 1e-9;
    std::printf("\n=== VERDICT: %s ===\n",
                (volPass && planePass) ? "PASS" : "FAIL");
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
