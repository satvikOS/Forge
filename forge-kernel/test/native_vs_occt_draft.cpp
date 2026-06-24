// native_vs_occt_draft.cpp
//
// 1:1 A/B-vs-OCCT validation harness for the ANALYTIC FACE DRAFT
// (DraftAnalytic.hpp / DraftAnalytic.cpp). It builds the SAME canonical draft on
// BOTH engines and compares the drafted VOLUME (and the drafted-face angle) to a
// tight tolerance:
//
//   Case: axis-aligned box L=10, neutral plane z=0, pull direction +Z,
//         draft angle alpha = 5 deg EXACTLY, all FOUR side walls drafted.
//
//   Native (forge::native::brep::draftBoxAnalytic):
//       walls lean IN -> square frustum, V = (L^3 - (L-2 t L)^3)/(6 t)
//       with t = tan(alpha), which evaluates to 835.228361275555.
//
//   OCCT (BRepPrimAPI_MakeBox + BRepOffsetAPI_DraftAngle):
//       MakeBox(10,10,10) -> for each of the 4 side faces:
//         .Add(face, gp_Dir(0,0,1), alpha_rad,
//              gp_Pln(gp_Pnt(0,0,0), gp_Dir(0,0,1)));
//       .Build(); then GProp_GProps drafted volume.
//
//   OCCT sign convention: BRepOffsetAPI_DraftAngle's angle sign decides whether the
//   wall leans IN (removes material, volume < box) or OUT (adds material). We try
//   +alpha first; if OCCT EXPANDS the box (volume > L^3) we flip to -alpha so the
//   wall leans IN to match the native inward (mold-release) frustum. |V| vs the
//   frustum closed form is symmetric, so the inward-leaning OCCT solid is the
//   apples-to-apples partner of the native frustum.
//
// PASS criterion:
//   * drafted VOLUME: |V_occt - V_native| / |V_native| <= 1e-6
//   * drafted-face angle vs the original vertical wall: |theta - 5deg| <= 1e-6 deg
//
// Build (links OCCT + the native brep/mesh object set; does NOT touch the kernel
// binding / CMakeLists / native gate):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     test/native_vs_occt_draft.cpp \
//     src/native/brep/{DraftAnalytic,Topology,Surface,Curve,MassProps,Sew,Nurbs,NurbsSurface}.cpp \
//     src/native/mesh/HalfEdgeMesh.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_draft && /tmp/native_vs_occt_draft

#include <cmath>
#include <cstdio>
#include <vector>

// ---- native analytic draft -------------------------------------------------
#include "forge/native/brep/DraftAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/MassProps.hpp"

// ---- OCCT ------------------------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp_Explorer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Vec.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>

using namespace forge::native::brep;

static constexpr double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Apply a uniform draft of `angRad` (radians) to all four SIDE faces of an
// axis-aligned MakeBox(L,L,L), about the neutral plane z=0, pull dir +Z. Returns
// false if the OCCT Build() fails (no fallback / no fake — surfaced as a failure).
// ---------------------------------------------------------------------------
static bool occtDraftAllSides(double L, double angRad, TopoDS_Shape& outShape) {
    BRepPrimAPI_MakeBox mk(L, L, L);
    TopoDS_Shape box = mk.Shape();

    BRepOffsetAPI_DraftAngle draft(box);

    const gp_Dir pullDir(0.0, 0.0, 1.0);
    const gp_Pln neutral(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0));

    // Add ONLY the four vertical side faces (skip the two z-cap faces, whose plane
    // normal is parallel to +Z). A side face's plane normal is horizontal.
    int added = 0;
    for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        gp_Dir n = as.Plane().Axis().Direction();
        // side faces: normal has (near) zero Z component -> vertical wall.
        if (std::fabs(n.Z()) < 1e-9) {
            draft.Add(f, pullDir, angRad, neutral);
            ++added;
        }
    }
    if (added != 4) {
        std::printf("[occt] expected 4 side faces, added %d\n", added);
        return false;
    }
    draft.Build();
    if (!draft.IsDone()) {
        std::printf("[occt] BRepOffsetAPI_DraftAngle::Build() not done\n");
        return false;
    }
    outShape = draft.Shape();
    return true;
}

static double occtVolume(const TopoDS_Shape& s) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(s, props);
    return props.Mass();
}

// Largest |Z| of the bounding box, i.e. box height after draft (sanity only).
static void occtBBox(const TopoDS_Shape& s, double& zmin, double& zmax) {
    Bnd_Box bb;
    BRepBndLib::Add(s, bb);
    double xmin, ymin, xmax, ymax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
}

// Achieved draft angle (deg) of a tilted side wall vs the original VERTICAL wall.
// For each NON-cap planar face of the drafted shape we measure the angle of its
// plane normal away from horizontal == the tilt of the wall == alpha. Returns the
// max over the four side walls (they should all equal alpha). Caps are skipped.
static double occtMaxSideTiltDeg(const TopoDS_Shape& s) {
    double maxTilt = -1.0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        BRepAdaptor_Surface as(f);
        if (as.GetType() != GeomAbs_Plane) continue;
        gp_Dir n = as.Plane().Axis().Direction();
        // skip the two z-caps (normal ~ +/-Z).
        if (std::fabs(n.Z()) > 0.9999999) continue;
        // tilt of this wall from vertical = angle of its normal above horizontal
        // = asin(|n.Z|): a vertical wall has n.Z()==0 (tilt 0); a wall leaned by
        // alpha has its outward normal lifted by alpha from horizontal.
        double tiltDeg = std::asin(std::min(1.0, std::fabs(n.Z()))) * 180.0 / kPi;
        if (tiltDeg > maxTilt) maxTilt = tiltDeg;
    }
    return maxTilt;
}

int main() {
    std::printf("=== A/B vs OCCT — ANALYTIC FACE DRAFT (neutral-plane taper) ===\n");
    std::printf("    case: box L=10, neutral z=0, pull +Z, alpha = 5 deg EXACTLY, all 4 walls\n\n");

    const double L = 10.0;
    const double alphaDeg = 5.0;
    const double alphaRad = alphaDeg * kPi / 180.0;

    // ---------------- NATIVE -------------------------------------------------
    TopologyBuilder tb;
    AnalyticDraftResult dr = draftBoxAnalytic(tb, L, alphaDeg);
    if (!dr.ok || !dr.solid) {
        std::printf("[native] FAILED: %s\n", dr.reason);
        return 1;
    }
    MassProps mp = massProperties(*dr.solid, /*gaussN=*/8);
    const double vNative = mp.volume;

    double nativeMaxAngErr = 0.0;
    for (double a : dr.faceAngleVsVerticalDeg)
        nativeMaxAngErr = std::max(nativeMaxAngErr, std::fabs(a - alphaDeg));

    std::printf("[native] reason: %s\n", dr.reason);
    std::printf("[native] drafted volume       = %.15f\n", vNative);
    std::printf("[native] box L^3              = %.15f  (removed by draft = %.15f)\n",
                L * L * L, L * L * L - vNative);
    std::printf("[native] drafted-face angles vs vertical (deg): ");
    for (double a : dr.faceAngleVsVerticalDeg) std::printf("%.12f ", a);
    std::printf("\n[native] max |angle - alpha|  = %.3e deg\n\n", nativeMaxAngErr);

    // ---------------- OCCT ---------------------------------------------------
    // Try +alpha first; flip to -alpha if OCCT EXPANDS (wall leans OUT) so the
    // drafted wall leans IN to match the native inward (mold-release) frustum.
    TopoDS_Shape occtShape;
    double angUsedRad = alphaRad;
    if (!occtDraftAllSides(L, alphaRad, occtShape)) {
        std::printf("[occt] +alpha draft build failed, trying -alpha\n");
        angUsedRad = -alphaRad;
        if (!occtDraftAllSides(L, -alphaRad, occtShape)) {
            std::printf("[occt] FAILED to build draft with either sign\n");
            return 1;
        }
    } else {
        double vTry = occtVolume(occtShape);
        std::printf("[occt] +alpha draft volume    = %.15f  (box L^3 = %.15f)\n",
                    vTry, L * L * L);
        if (vTry > L * L * L) {
            // +alpha EXPANDS -> flip sign so the wall leans IN like native.
            std::printf("[occt] +alpha EXPANDS the box -> flipping to -alpha for an inward (mold-release) taper\n");
            angUsedRad = -alphaRad;
            TopoDS_Shape flipped;
            if (!occtDraftAllSides(L, -alphaRad, flipped)) {
                std::printf("[occt] FAILED to build -alpha draft\n");
                return 1;
            }
            occtShape = flipped;
        }
    }

    const double vOcct = occtVolume(occtShape);
    double zmin = 0, zmax = 0;
    occtBBox(occtShape, zmin, zmax);
    const double occtTiltDeg = occtMaxSideTiltDeg(occtShape);

    std::printf("[occt] sign used              = %s alpha (%.6f rad)\n",
                angUsedRad < 0 ? "-" : "+", angUsedRad);
    std::printf("[occt] drafted volume         = %.15f\n", vOcct);
    std::printf("[occt] box L^3                = %.15f  (removed by draft = %.15f)\n",
                L * L * L, L * L * L - vOcct);
    std::printf("[occt] bbox z range           = [%.6f, %.6f]\n", zmin, zmax);
    std::printf("[occt] max side-wall tilt     = %.12f deg\n",  occtTiltDeg);
    std::printf("[occt] |tilt - alpha|         = %.3e deg\n\n", std::fabs(occtTiltDeg - alphaDeg));

    // ---------------- A/B comparison ----------------------------------------
    const double relVol = std::fabs(vOcct - vNative) / std::fabs(vNative);
    const double absVol = std::fabs(vOcct - vNative);
    const double angErr = std::fabs(occtTiltDeg - alphaDeg);

    std::printf("=== A/B-vs-OCCT comparison ===\n");
    std::printf("  native volume = %.15f\n", vNative);
    std::printf("  OCCT   volume = %.15f\n", vOcct);
    std::printf("  |abs diff|    = %.6e\n", absVol);
    std::printf("  |rel diff|    = %.6e   (tol 1e-6)\n", relVol);
    std::printf("  drafted-face angle: native max-err %.3e deg, OCCT |tilt-alpha| %.3e deg (tol 1e-6 deg)\n",
                nativeMaxAngErr, angErr);

    const bool volPass = (relVol <= 1e-6);
    const bool angPass = (angErr <= 1e-6) && (nativeMaxAngErr <= 1e-6);

    std::printf("\n  [%s] drafted VOLUME native==OCCT to rel <= 1e-6\n",
                volPass ? "PASS" : "FAIL");
    std::printf("  [%s] drafted-face angle == 5deg to abs <= 1e-6 deg (both engines)\n",
                angPass ? "PASS" : "FAIL");

    const bool pass = volPass && angPass;
    std::printf("\n=== VERDICT: %s ===\n", pass ? "PASS" : "FAIL");
    return pass ? 0 : 1;
}
