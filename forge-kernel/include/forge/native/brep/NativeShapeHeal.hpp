// forge/native/brep/NativeShapeHeal.hpp
//
// R4 — native SHAPE-HEALING subset that replaces the TKShHealing toolkit at the
// SPECIFIC call sites our kernel uses (KERNEL_DROP_MASTER_PLAN routine R4). This
// is the in-house implementation of the small, well-defined slice of
// ShapeAnalysis_* / ShapeFix_* that our sources actually call — NOT a
// re-implementation of OCCT's ~million-LOC general healer.
//
// ============================ HONESTY (Bible §0/§9) ========================
// Pure C++ + the SURVIVING OCCT foundation toolkits only. It consumes/produces
// OCCT geometry+topology handles (Handle(Geom_Surface), Handle(Geom_Curve),
// TopoDS_*), because every call site is OCCT-typed, but it implements the MATH
// natively and links against ZERO TKShHealing symbols. The toolkits it does use
// all SURVIVE the drop:
//   * TKMath  — gp_Pnt / gp_Vec / gp_Ax3            (foundation, dropped last)
//   * TKG3d   — Geom_Surface/Geom_Curve eval + DownCast to the analytic kinds
//   * TKBRep / TKTopAlgo — TopoDS_*, BRep_Tool, BRep_Builder, TopExp,
//                          BRepBuilderAPI_MakeSolid, BRepLib::SameParameter,
//                          BRepGProp (all already linked & used natively, e.g.
//                          StepReadOcct.cpp's volume-sign orient + SameParameter).
// It is the SAME pattern StepReadOcct.cpp uses: OCCT data types, native algebra,
// TKShHealing-free.
//
// ---------------------------------------------------------------------------
// WHAT THIS COVERS (the real subset our call sites use — see the wiring map at
// the bottom of NativeShapeHeal.cpp):
//   (1) ShapeAnalysis_Surface::ValueOfUV   -> valueOfUV        (3D point -> uv inversion)
//   (2) ShapeAnalysis_Curve::Project       -> projectPointOnCurve (nearest pt on 3D curve)
//   (3) ShapeAnalysis_FreeBounds           -> freeBounds       (free-boundary wire soup)
//   (4) ShapeFix_Solid (ctor/Solid/SolidFromShell) -> solidFromShell + orientSolidOutward
//   (5) ShapeAnalysis_Shell (LoadShells/CheckOrientedShells) -> shellOrientationConsistent
//   (6) ShapeFix_Shape (LIGHT-heal usage: ctor+Perform+Shape) -> finalizeShape
//
// ★ R1 OVERLAP (do NOT duplicate): (1) valueOfUV and (2) projectPointOnCurve are
//   the SAME point/curve/surface projection math that routine R1 authors as the
//   TKGeomAlgo/TKGeomBase replacement (GeomAPI_ProjectPointOnSurf /
//   Geom2dAPI_ProjectPointOnCurve, at ClassASurfacing.cpp:482/485,
//   OcctImport.cpp:939, Nurbs.cpp:716, OcctNativeMesh.cpp:236). They are kept
//   here as small self-contained routines so R4 can land INDEPENDENTLY of R1's
//   file, but when both land they should share ONE core (a common
//   `native/geom/Project.*`). Flagged so the serial integrator collapses them
//   rather than shipping two Newton solvers.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES **NOT** COVER — the honest gap vs full ShapeFix_Shape (kept OFF
// the "drop is complete" claim):
//   * The RICH general repair (ShapeFix.cpp / Healing.cpp autoRepair) with the
//     DONE1..8 / FAIL1..8 status bits and the SetMinTolerance/SetMaxTolerance
//     band. The honest native replacement for THAT is the already-built
//     forge::native::brep::healBRep (Heal.cpp), which operates on a native Solid
//     and is wired AHEAD of those call sites behind the FEAT gate. Making it the
//     UNCONDITIONAL path (so the OCCT fallback can be deleted) needs the
//     OCCT<->native bridge (importOcctSolid) promoted out of "defer" and the
//     STEP corpus gate (Models-OS 13/13) — build-iteration work, not authoring.
//   * ShapeFix_Shape's pcurve SYNTHESIS for non-planar faces that arrive with no
//     file pcurve (StepReadOcct.cpp:1570). finalizeShape does SameParameter +
//     outward-orient + shell->solid, which is the load-bearing part for planar
//     faces (OCCT computes their CurveOnSurface on demand) and for boolean
//     output (already valid); building a 2D pcurve by projecting a 3D edge onto a
//     spline face is R1/R2 territory and is left as a documented residual.
//   * ShapeUpgrade_UnifySameDomain (also a TKShHealing symbol, at DirectEdit.cpp:122
//     / Healing.cpp:387) — native unifySameDomain{Planar,Curved,Bored}
//     (UnifyFaces.cpp) already covers the eligible native cases; the OCCT
//     fallback for ineligible/OCCT-backed shapes is a SEPARATE residual, NOT in
//     this file.
//
// CONVENTIONS: namespace forge::occtheal. All angles returned in radians,
// analytic U wrapped to [0, 2pi) (the caller re-anchors to its own period, as
// StepReadOcct.cpp already does via shiftToAnchor).

#ifndef FORGE_NATIVE_BREP_NATIVESHAPEHEAL_HPP
#define FORGE_NATIVE_BREP_NATIVESHAPEHEAL_HPP

#ifdef FORGE_NATIVE_BREP   // OCCT-typed; empty in the OCCT-free run_native.sh harness

#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Curve.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Compound.hxx>

namespace forge {
namespace occtheal {

// ---------------------------------------------------------------------------
// (1) ShapeAnalysis_Surface::ValueOfUV replacement.
// Invert a 3D point onto `surf`, returning the (u,v) parameters of its nearest
// point. Closed form for Plane / Cylinder / Cone / Sphere / Torus; Gauss-Newton
// (seeded by a coarse parametric grid) for every other surface (B-spline,
// revolution, extrusion, offset...). U is wrapped to [0,2pi) for the periodic
// analytic kinds; the caller period-adjusts to its own span. `preci` seeds the
// Newton convergence tolerance (mirrors ShapeAnalysis_Surface's preci arg).
gp_Pnt2d valueOfUV(const Handle(Geom_Surface)& surf, const gp_Pnt& p, double preci);

// Same inversion, additionally reporting the 3D foot S(u,v) and its distance to
// p (optional out-params). `valueOfUV` is the thin wrapper over this.
gp_Pnt2d projectPointOnSurface(const Handle(Geom_Surface)& surf, const gp_Pnt& p,
                               double preci, gp_Pnt* foot, double* dist);

// ---------------------------------------------------------------------------
// (2) ShapeAnalysis_Curve::Project replacement.
// Nearest point on the 3D curve `c` to `p`. Returns the DISTANCE (matching
// ShapeAnalysis_Curve::Project's Standard_Real return); sets `proj` = foot,
// `param` = its parameter (clamped to [First,Last]). Closed form for Line /
// Circle; sampled Newton for everything else. `adjustToEnds` snaps to a curve
// end when the foot lands within `preci` of it (matches the OCCT flag).
double projectPointOnCurve(const Handle(Geom_Curve)& c, const gp_Pnt& p,
                           double preci, gp_Pnt& proj, double& param,
                           bool adjustToEnds);

// ---------------------------------------------------------------------------
// (3) ShapeAnalysis_FreeBounds replacement.
// Extract the FREE boundary of `shape` (edges owned by exactly one face) and
// chain the free edges into wires, split into closed loops vs open chains
// (endpoints within `tol`). Mirrors the ctor(shape,tol,splitClosed,splitOpen) +
// GetClosedWires()/GetOpenWires() usage in Healing.cpp::autoFillMissingFaces.
struct FreeBounds {
    TopoDS_Compound closedWires;   // free-edge loops (candidate cap boundaries)
    TopoDS_Compound openWires;     // free-edge chains that do not close
};
FreeBounds freeBounds(const TopoDS_Shape& shape, double tol);

// ---------------------------------------------------------------------------
// (4) ShapeFix_Solid replacement (the subset used: build-from-shell + orient).
// Build a solid from `shell` (BRepBuilderAPI_MakeSolid) and orient it so its
// signed volume is positive (outward normals). Returns a null solid only if the
// shell cannot make a solid.
TopoDS_Solid solidFromShell(const TopoDS_Shell& shell);

// Orient an already-built solid/shape outward by flipping it when its signed
// volume is negative (the ShapeFix_Solid::Perform() net effect our call sites
// rely on; identical to StepReadOcct.cpp's post-transfer volume-sign flip).
TopoDS_Shape orientSolidOutward(const TopoDS_Shape& solidOrShape);

// ---------------------------------------------------------------------------
// (5) ShapeAnalysis_Shell replacement (orientation consistency).
// True when every manifold (2-face) edge of `shell` is used with OPPOSITE
// orientation by its two faces — i.e. the shell is consistently oriented. This
// is the LoadShells + CheckOrientedShells signal harmonizeNormals reads. (The
// call site currently discards the result; we return a real answer.)
bool shellOrientationConsistent(const TopoDS_Shell& shell);

// ---------------------------------------------------------------------------
// (6) ShapeFix_Shape replacement — the LIGHT-heal subset (ctor + Perform +
// Shape) that DirectEdit.cpp / DirectModeling.cpp / StepReadOcct.cpp use as a
// defensive post-boolean / post-transfer pass:
//   - SameParameter reconcile of edge tolerances (the dominant real effect on
//     boolean output and freshly-built STEP shells),
//   - outward orientation by signed volume,
//   - promote a closed bare shell to a solid.
// This is NOT the general FixWire/FixEdge/FixFace pcurve-synthesis pass (see the
// gap note at the top of the file). `precision` seeds SameParameter (<=0 => a
// 1e-7 default); `maxTol` is accepted for signature parity and clamps the
// SameParameter tolerance ceiling.
struct FinalizeResult {
    TopoDS_Shape shape;
    bool sameParamApplied = false;   // SameParameter ran without throwing
    bool orientationFlipped = false; // the shape was reversed to face outward
    bool promotedToSolid = false;    // a closed shell was wrapped into a solid
};
FinalizeResult finalizeShape(const TopoDS_Shape& shape, double precision, double maxTol);

}  // namespace occtheal
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVESHAPEHEAL_HPP
