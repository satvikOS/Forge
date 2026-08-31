// forge/native/brep/NativeVariableFillet.hpp — TKFillet-free VARIABLE-radius fillet.
//
// ROUTINE R3-V of the OCCT-zero drop plan (companion to NativeFilletChamfer.hpp).
// Re-implements the ONE remaining OCCT call-site operation that still pulls in
// TKFillet after the constant-radius fillet/chamfer went native —
//   BRepFilletAPI_MakeFillet::Add(TColgp_Array1OfPnt2d law, edge)  (the
//   VARIABLE-radius rolling-ball edge fillet used by forge::varfillet::fillet /
//   src/VarFillet.cpp) — DIRECTLY on the surviving modeling toolkits: the blend
// patch is an EXACT rational Geom_BSplineSurface (TKG3d), the re-trim / caps use
// BRepBuilderAPI / BRepTools (TKBRep/TKTopAlgo), gp_ on TKMath, and the radius
// law is evaluated with forge::occtlaw::Law (pure std, NativeLaw.cpp). NO
// ChFi3d_Builder / BRepFilletAPI symbol is referenced, so this TU carries none of
// TKFillet's 11 exclusive symbols.
//
// It is the variable-radius sibling of NativeFilletChamfer.cpp (R3): same
// LOCAL-NEIGHBOURHOOD reconstruction on an ARBITRARY TopoDS_Shape (retrim the two
// adjacent planar faces + clip the two end faces at the edge endpoints + emit one
// new blend face, re-use every other face VERBATIM, sew watertight). It reuses R3's
// retrim / end-cap / sew idiom unchanged; the ONLY new geometry is the blend
// surface, which is a variable-radius swept arc rather than R3's constant cylinder.
//
// BLEND GEOMETRY (one CONVEX straight edge P0->P1 shared by two PLANAR faces A,B,
// radius R(u) = law.Value(u), u the NORMALISED edge station in [0,1], u=0 at P0):
//   At each station u the rolling ball has radius R(u); its centre (axis foot)
//   F(u) sits on the interior bisector at distance R(u) from BOTH planes, and the
//   exposed patch cross-section is the circular arc of radius R(u) about F(u) from
//   the contact on A (SA(u) = P(u) + s(u)*tA, s(u)=R(u)/tan(theta/2)) to the
//   contact on B (SB(u) = P(u) + s(u)*tB), spanning arc angle alpha = acos(nA.nB)
//   = pi - theta.  The blend surface sweeps that varying arc along the edge.
//   For a LINEAR law the three rational-Bezier control rows move LINEARLY in u, so
//   the surface is EXACTLY a degree-2 (rational arc) x degree-1 (edge) NURBS — the
//   same exact representation FilletAnalytic::filletBoxEdgeVariable builds for the
//   native-analytic box path, but here on an OCCT TopoDS_Shape neighbourhood.
//
// HONEST SCOPE (Bible §0 — REAL, no MVP/stub/fake; every gap DEFERS, never fakes):
//   NATIVE (exact, watertight):
//     * a CONVEX, STRAIGHT edge shared by TWO PLANAR faces (prismatic / box /
//       plate / bar / boolean-of-planar edge) whose two adjacent faces and the two
//       end faces at the endpoints have STRAIGHT outer boundaries (inner-wire holes
//       preserved verbatim), with a LINEAR radius law R(u)=R0+(R1-R0)u. The blend
//       is one exact rational-NURBS variable-arc patch; the two planes are
//       re-trimmed to the (now non-parallel) tangent lines; each end face gets a
//       circular-arc corner clip of its own end radius (R0 at P0, R1 at P1).
//   DEFERS to the OCCT fallback (Result.ok == false, reason set — NOT a throw):
//     * a NON-LINEAR radius law (Law_S / smooth, or any law whose midpoint is not
//       the mean of its ends) — its exact blend is degree>1 in the edge direction;
//       gated by a geometric midpoint test, not an enum, so the true linear-exact
//       capability is what is served. (The exact degree-3 S-law recipe is noted in
//       the .cpp for the next increment.)
//     * curved edges / curved adjacent faces (contact surface would be a pipe/torus
//       sweep, not this planar-planar arc sweep),
//     * CONCAVE (reflex) edges,
//     * end faces not perpendicular to the edge (the end-plane section would be an
//       ellipse, not the circular arc the cap clip builds),
//     * a vertex where more than 3 faces meet, or an affected face whose outer
//       boundary is not all-straight,
//     * a radius so large the tangent setback overflows an adjacent/end face (the
//       retrim returns a null face -> defer), a degenerate dihedral, or a
//       planar pair that is not rolling-ball consistent (ball centre from A != from
//       B beyond tolerance).
//
// Because out-of-scope inputs DEFER (ok==false with a reason, never a throw or a
// faked solid), the src/VarFillet.cpp call site can take this native path for the
// common linear-law prismatic case while KEEPING the compiled OCCT fallback for the
// rest — so it *enables* the TKFillet drop only once the OCCT fallback is either
// removed (accepting a throw on out-of-scope var-fillets) or the curved / S-law
// cases are also authored. See the .cpp's WIRING PLAN for the full drop gate.

#ifndef FORGE_NATIVE_BREP_NATIVEVARIABLEFILLET_HPP
#define FORGE_NATIVE_BREP_NATIVEVARIABLEFILLET_HPP

#ifdef FORGE_NATIVE_BREP   // OCCT-typed; empty in the OCCT-free run_native.sh harness

#include "forge/native/brep/NativeFilletChamfer.hpp"  // reuse forge::occtfillet::Result
#include "forge/native/geom/NativeLaw.hpp"            // forge::occtlaw::Law (radius law)

#include <TopoDS_Shape.hxx>
#include <TopoDS_Edge.hxx>

#include <vector>

namespace forge {
namespace occtfillet {

// One requested variable-radius fillet: round `edge` with a rolling-ball radius
// that follows `law` — R at normalised edge station u in [0,1] is law.Value(u),
// with u=0 at the edge's start vertex (FirstParameter) and u=1 at its end vertex.
// This mirrors src/VarFillet.cpp's law convention (Law::Linear(0,rStart,1,rEnd)).
struct VariableFilletSpec {
    TopoDS_Edge       edge;
    forge::occtlaw::Law law;   // R(u) = law.Value(u); only the LINEAR law is native
};

// Variable-radius rolling-ball fillet of every edge in `specs` (each carries its
// own law). Edges are applied in sequence against the running shape, re-resolved
// by geometry after each rebuild; if ANY edge is out of scope or cannot be
// re-resolved the whole op DEFERS (ok==false, reason set) so the caller's OCCT
// fallback (BRepFilletAPI_MakeFillet) handles the entire request unchanged.
// The returned Result is the SAME type as makeFillet/makeChamfer (NativeFilletChamfer.hpp).
Result makeVariableFillet(const TopoDS_Shape& shape,
                          const std::vector<VariableFilletSpec>& specs);

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEVARIABLEFILLET_HPP
