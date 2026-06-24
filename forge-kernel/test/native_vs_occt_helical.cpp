// forge-kernel/test/native_vs_occt_helical.cpp
//
// A/B-vs-OCCT validation for the FORGE native ANALYTIC HELICAL SWEEP
// (HelicalSweep.hpp / HelicalSweep.cpp) — the in-house brep::Solid replacement for
// OCCT BRepOffsetAPI_MakePipe(helixWire, profileWire): sweep a CIRCULAR profile
// along a constant-pitch HELIX into a closed coiled-tube solid (a spring).
//
// Canonical spring (mirrors helical_sweep_test.cpp):  profile r=0.5, coil R=3,
// pitch p=2, N=4 turns about +z. Both implementations are SWEPT APPROXIMATIONS of
// the same coil and converge to the Pappus value
//       V = pi r^2 * L,   L = N * sqrt((2 pi R)^2 + p^2)  ~= 59.55.
//
// SIDE A (Forge native): helicalSweep(spec) at the FINEST discretisation
//   (stepsPerTurn=256, profileSegments=96 ; M=1024 path stations) — exact
//   divergence-theorem volume of the watertight faceted coiled tube.
//
// SIDE B (OCCT): build the helix WIRE as a Geom2d_Line on a Geom_CylindricalSurface
//   (radius R), MakeEdge(line2d, cyl, 0, len) over the full N-turn parameter range,
//   MakeWire ; a circular PROFILE wire (radius r, in the plane normal to the helix
//   tangent at the start, centred on the helix start point) ; then
//   BRepOffsetAPI_MakePipe(helixWire, profileWire, GeomFill_IsCorrectedFrenet),
//   MakeSolid, BRepGProp::VolumeProperties.
//
// VERDICT: PASS if the native (finest M) volume and the OCCT pipe volume agree to a
//   relative error <= 1e-2 (both are swept approximations of the same coil
//   converging to the same Pappus value ~59.55).
//
// Pure C++20 ; OCCT 7.9.3 (-I /opt/homebrew/opt/opencascade/include/opencascade).
// Does NOT touch binding.cpp / CMakeLists / the native gate — standalone harness.

#include <cmath>
#include <cstdio>
#include <cstdlib>

// ---- Forge native (Side A) ----
#include "forge/native/brep/HelicalSweep.hpp"

// ---- OCCT (Side B) ----
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Circ.hxx>

#include <Geom_CylindricalSurface.hxx>
#include <Geom2d_Line.hxx>
#include <GC_MakeCircle.hxx>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepLib.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

#include <GeomFill_Trihedron.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

// -------------------------------------------------------------------------
// Side B (OCCT): build the coiled-tube solid with BRepOffsetAPI_MakePipe and
// return its volume (BRepGProp::VolumeProperties). Throws on OCCT failure.
// -------------------------------------------------------------------------
double occtHelicalSweepVolume(double r, double R, double p, double N) {
    // (1) Cylindrical surface of radius R about +z, apex at the world origin.
    //     Parametrisation: S(u,v) = (R cos u, R sin u, v).
    gp_Ax3 cylAx(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0));
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(cylAx, R);

    // (2) Helix WIRE = a Geom2d_Line in (u,v) space whose image on the cylinder is
    //     the helix. Over a u-advance of 2*pi (one full turn) the height v must
    //     rise by the pitch p, so the (u,v) direction is proportional to
    //     (2*pi*R/?, ...) — we use du:dv = 1 : p/(2*pi). Parametrise the edge over
    //     the line's natural arc length so u(t) = t*cos(a), v(t) = t*sin(a) with
    //     tan(a) = (p/(2*pi)). Then u sweeps 0 .. 2*pi*N when
    //         t in [0, (2*pi*N)/cos(a)].
    const double slope = p / (2.0 * kPi);          // dv/du along the helix
    const double a     = std::atan2(slope, 1.0);   // line direction angle in (u,v)
    gp_Pnt2d  p2d(0.0, 0.0);
    gp_Dir2d  d2d(std::cos(a), std::sin(a));
    Handle(Geom2d_Line) line2d = new Geom2d_Line(p2d, d2d);

    const double uTotal = 2.0 * kPi * N;            // total u-span (N turns)
    const double tEnd   = uTotal / std::cos(a);     // line param to reach uTotal

    TopoDS_Edge helixEdge =
        BRepBuilderAPI_MakeEdge(line2d, cyl, 0.0, tEnd).Edge();
    // Build the 3D curve representation from the (2d-curve, surface) pair so the
    // pipe spine has a usable 3D geometry.
    BRepLib::BuildCurves3d(helixEdge);
    TopoDS_Wire helixWire = BRepBuilderAPI_MakeWire(helixEdge).Wire();

    // (3) Circular PROFILE wire, radius r, centred at the helix START point
    //     C(0) = (R, 0, 0), lying in the plane NORMAL to the helix tangent there.
    //     Helix tangent at t=0:  C'(u) = (-R sin u, R cos u, p/(2*pi)) |_{u=0}
    //                          = (0, R, p/(2*pi))  -> unit.
    gp_Pnt  start(R, 0.0, 0.0);
    gp_Vec  tan(0.0, R, slope);
    gp_Dir  tanDir(tan);                            // profile-plane normal
    gp_Ax2  profAx(start, tanDir);                  // plane normal == helix tangent
    Handle(Geom_Circle) circ = GC_MakeCircle(profAx, r).Value();
    TopoDS_Edge profEdge = BRepBuilderAPI_MakeEdge(circ).Edge();
    TopoDS_Wire profWire = BRepBuilderAPI_MakeWire(profEdge).Wire();

    // (4) Sweep with corrected-Frenet trihedron (rotation-minimising, matches the
    //     native RMF transport), then close into a solid.
    BRepOffsetAPI_MakePipe pipe(helixWire, profWire,
                                GeomFill_IsCorrectedFrenet,
                                Standard_False);
    pipe.Build();
    if (!pipe.IsDone()) {
        std::fprintf(stderr, "OCCT MakePipe failed (not done)\n");
        std::exit(2);
    }
    TopoDS_Shape pipeShape = pipe.Shape();

    // The pipe of a closed profile is a closed shell; wrap it in a solid so the
    // volume integral is signed correctly.
    TopoDS_Shape solidShape = pipeShape;
    for (TopExp_Explorer ex(pipeShape, TopAbs_SHELL); ex.More(); ex.Next()) {
        TopoDS_Shell sh = TopoDS::Shell(ex.Current());
        BRepBuilderAPI_MakeSolid mk(sh);
        if (mk.IsDone()) { solidShape = mk.Solid(); break; }
    }

    GProp_GProps props;
    BRepGProp::VolumeProperties(solidShape, props);
    return std::fabs(props.Mass());   // |signed volume|
}

} // namespace

int main() {
    using namespace forge::native::brep;

    std::printf("=== Forge native HELICAL SWEEP  vs  OCCT BRepOffsetAPI_MakePipe ===\n");

    // Canonical spring (mirrors helical_sweep_test.cpp).
    const double r = 0.5, R = 3.0, p = 2.0, N = 4.0;
    std::printf("spring:  profile r=%.3f  coil R=%.3f  pitch p=%.3f  N=%.1f turns (+z)\n",
                r, R, p, N);

    // Pappus reference both sides converge to.
    const double arc    = helixArcLength(R, p, N);
    const double pappus = kPi * r * r * arc;
    std::printf("Pappus reference:  L=%.12f   V=pi*r^2*L = %.12f\n\n", arc, pappus);

    // ---- SIDE A: Forge native at the finest discretisation ----
    HelixSpec spec;
    spec.profileRadius   = r;
    spec.coilRadius      = R;
    spec.pitch           = p;
    spec.turns           = N;
    spec.stepsPerTurn    = 256;   // finest M = N*256 = 1024 path stations
    spec.profileSegments = 96;
    HelicalSweepResult nat = helicalSweep(spec);
    if (!nat.ok) {
        std::printf("[FAIL] native helicalSweep failed: %s\n", nat.reason);
        return 1;
    }
    const double nativeVol = nat.volume;
    std::printf("[A] NATIVE  (finest M=%zu, segs=96): V = %.12f\n",
                (nat.vertices / 96) - 1, nativeVol);
    std::printf("            closed-manifold=%s  area=%.6f  V=%zu E=%zu F=%zu\n",
                nat.closedManifold ? "YES" : "NO",
                nat.area, nat.vertices, nat.edges, nat.faces);
    std::printf("            rel-to-Pappus = %.3e\n",
                std::fabs(nativeVol - pappus) / pappus);

    // ---- SIDE B: OCCT MakePipe ----
    const double occtVol = occtHelicalSweepVolume(r, R, p, N);
    std::printf("[B] OCCT    (MakePipe corrected-Frenet): V = %.12f\n", occtVol);
    std::printf("            rel-to-Pappus = %.3e\n",
                std::fabs(occtVol - pappus) / pappus);

    // ---- A/B comparison ----
    const double relAB = std::fabs(nativeVol - occtVol) / occtVol;
    std::printf("\n--- A/B comparison ---\n");
    std::printf("native V = %.12f\n", nativeVol);
    std::printf("OCCT   V = %.12f\n", occtVol);
    std::printf("rel |A-B|/B = %.6e   (tol 1e-2)\n", relAB);

    const bool pass = (relAB <= 1e-2);
    std::printf("\n=== VERDICT: %s  (native vs OCCT helical sweep, rel %.3e <= 1e-2) ===\n",
                pass ? "PASS" : "FAIL", relAB);
    return pass ? 0 : 1;
}
