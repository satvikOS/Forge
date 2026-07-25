// forge/native/brep/NativeFilletChamfer.hpp — TKFillet-free edge fillet / chamfer.
//
// ROUTINE R3 of the OCCT-zero drop plan (reports/KERNEL_DROP_MASTER_PLAN.md).
// Re-implements the two OCCT call-site operations that pull in TKFillet —
//   BRepFilletAPI_MakeFillet  (constant-radius rolling-ball edge fillet), and
//   BRepFilletAPI_MakeChamfer (constant-distance flat-bevel edge chamfer)
// — DIRECTLY on the surviving modeling toolkits (Geom_ analytic surfaces on
// TKG3d, BRepBuilderAPI / BRepTools on TKBRep/TKTopAlgo, gp_ on TKMath), with
// NO ChFi3d_Builder / BRepFilletAPI symbol referenced. This is the exact analogue
// of OcctPrimBuilder.hpp (which retired BRepPrimAPI/TKPrim the same way).
//
// UNLIKE the native-analytic FilletAnalytic.cpp / ChamferAnalytic.cpp engines
// (which build a fresh forge::native::brep::Solid and therefore only serve
// ShapeKind::NativeSolid handles), these routines operate on an ARBITRARY OCCT
// TopoDS_Shape — the very shapes the Features.cpp call sites still feed to OCCT
// (imported STEP, boolean results, or any body when native features are off).
// They reconstruct ONLY the local neighbourhood of the selected edge (its two
// adjacent faces + the two end faces at the edge's endpoints + the new blend
// face) and re-use every other face of the input VERBATIM, then sew watertight —
// so a STEP body whose bulk is NURBS is still chamferable on a planar prismatic
// edge without importing the whole solid.
//
// HONEST SCOPE (Bible §0 — REAL, no MVP/stub/fake; every gap DEFERS, never fakes):
//   COVERED (exact, watertight):
//     * a CONVEX, STRAIGHT edge shared by TWO PLANAR faces (the prismatic /
//       box / plate / wedge / boolean-of-planar edge) whose two adjacent faces
//       and the two end faces meeting the edge's endpoints have STRAIGHT outer
//       boundaries (inner-wire holes are preserved verbatim). Chamfer = one
//       planar bevel face (symmetric or asymmetric two-distance). Fillet = one
//       Geom_CylindricalSurface quarter(-ish) patch tangent to both planes.
//   DEFERS to the OCCT fallback (Result.ok == false, reason set — NOT a throw):
//     * curved edges / curved adjacent faces (contact surface would be a torus
//       or pipe, not a cylinder — a real follow-up),
//     * CONCAVE (reflex) edges,
//     * end faces not perpendicular to the edge (the fillet/end-plane section
//       would be an ellipse, not the circular arc we build),
//     * a vertex where more than 3 faces meet, or an affected face whose outer
//       boundary is not all-straight,
//     * the VARIABLE-radius law fillet (BRepFilletAPI_MakeFillet::Add(Pnt2d[],e))
//       used by forge::part::variableFilletEdge — a swept variable surface, not a
//       constant cylinder; see FilletAnalytic::filletBoxEdgeVariable for the
//       native-analytic linear-law engine and the remaining OCCT-topology gap.
//
// Because out-of-scope inputs DEFER, this routine lets the two Features.cpp
// call sites take the native path for the common prismatic case while KEEPING
// the compiled OCCT fallback for the rest — so it *enables* the TKFillet drop
// only once the fallback is either removed (accepting a throw on out-of-scope
// fillets) or the curved/variable cases are also authored. See the file's
// wiring plan / the master plan for the full drop gate.

#ifndef FORGE_NATIVE_BREP_NATIVEFILLETCHAMFER_HPP
#define FORGE_NATIVE_BREP_NATIVEFILLETCHAMFER_HPP

#ifdef FORGE_NATIVE_BREP   // OCCT-typed; empty in the OCCT-free run_native.sh harness

#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>

#include <string>
#include <vector>

namespace forge {
namespace occtfillet {

// One requested constant-radius fillet: round `edge` with rolling-ball radius R.
struct FilletSpec {
    TopoDS_Edge edge;
    double      radius = 0.0;
};

// One requested chamfer. Symmetric setback: dist2 <= 0 -> both faces cut by dist.
// Asymmetric (OCCT's Add(d1,d2,edge,face)): `contact` (if non-null) is cut by
// dist, the other adjacent face by dist2; if `contact` is null the edge's first
// adjacent face is cut by dist and the second by dist2.
struct ChamferSpec {
    TopoDS_Edge edge;
    double      dist    = 0.0;
    double      dist2   = 0.0;   // <=0 => symmetric (dist on both faces)
    TopoDS_Face contact;         // may be null
};

// Result of a native fillet/chamfer. ok==false is an HONEST DEFERRAL (the caller
// should fall back to the OCCT path) — `reason` says why. A genuine internal
// failure after the op was accepted (e.g. sew produced no closed shell) also
// reports ok==false with a diagnostic reason rather than throwing, so the call
// site can always fall back cleanly.
struct Result {
    bool         ok = false;
    TopoDS_Shape shape;   // the filleted/chamfered solid — valid iff ok
    std::string  reason;
};

// Constant-radius rolling-ball fillet of every edge in `specs` (each may carry
// its own radius). Edges are applied in sequence against the running shape,
// re-resolved by geometry after each rebuild; if ANY edge is out of scope or
// cannot be re-resolved the whole op DEFERS (ok==false) so the caller's OCCT
// fallback handles the entire request unchanged.
Result makeFillet(const TopoDS_Shape& shape, const std::vector<FilletSpec>& specs);

// Constant-distance flat-bevel chamfer of every edge in `specs`. Same
// sequential-apply + honest-deferral contract as makeFillet.
Result makeChamfer(const TopoDS_Shape& shape, const std::vector<ChamferSpec>& specs);

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEFILLETCHAMFER_HPP
