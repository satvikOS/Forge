// forge/native/brep/NativeWireFill.hpp — TKOffset-free free-wire cap synthesis.
//
// ROUTINE (kernel OCCT-zero drop plan, reports/KERNEL_DROP_MASTER_PLAN.md):
// a native, self-contained replacement for TKOffset **FAMILY B** — the 5 symbols that
// keep heal::autoFillMissingFaces (src/Healing.cpp) linked to that toolkit:
//
//   * BRepOffsetAPI_MakeFilling::BRepOffsetAPI_MakeFilling(int,int,int,bool,
//                                       double,double,double,double,int,int)   (TKOffset)
//   * BRepOffsetAPI_MakeFilling::Add(TopoDS_Edge const&, GeomAbs_Shape, bool)  (TKOffset)
//   * BRepOffsetAPI_MakeFilling::Build(Message_ProgressRange const&)           (TKOffset)
//   * BRepOffsetAPI_MakeFilling::IsDone() const                               (TKOffset)
//   * vtable for BRepOffsetAPI_MakeFilling                                    (TKOffset)
//
// Measured, not assumed: `nm -u build/Release/forge-kernel.node` ∩ TKOffset exports is
// exactly those 5 for this family, and the ONLY object file referencing any of them is
// src/Healing.cpp.o. src/DirectModeling.cpp includes the header but calls nothing
// (a dead include).
//
// ============================ WHAT THIS BUILDS (honest scope) ==============
// `fillFreeWire(wire, tol)` caps ONE closed free-boundary wire with ONE face.
//
//   PLANAR loop  -> an EXACT planar face. The support plane is fitted by NEWELL's
//                   method (area-weighted normal; exact for any planar polygon and
//                   numerically stable for slivers) through points sampled off the
//                   wire's real curves, then VERIFIED: every sample must lie within
//                   `tol` of that plane, otherwise the loop is not planar and we
//                   defer. The face is built with BRepBuilderAPI_MakeFace(Geom_Plane,
//                   wire, Inside=true), which keeps the ORIGINAL TopoDS_Edges — a
//                   circle stays a circle, a B-spline stays a B-spline — and derives
//                   pcurves by projection onto the plane. NOTHING IS TESSELLATED and
//                   nothing is refitted.
//
//   NON-PLANAR   -> HONEST DEFER (null face + `reason`). This is the capability
//   loop            frontier and it is documented, not hidden: OCCT's MakeFilling
//                   fabricates an energy-minimising Coons/Gregory-class patch across
//                   an arbitrary 3-D loop; the native tree has the EVALUATORS for that
//                   (SurfaceFill.cpp bicubic Coons, GregoryFill.cpp N-sided Gregory)
//                   but NEITHER exports a Geom_BSplineSurface, so wiring them here
//                   would require sampling-and-refitting the patch — an approximation
//                   this file refuses to make silently. See NativeWireFill.cpp §BLOCKER.
//
// Why a planar-exact fill is the RIGHT first increment and not a token one: it is
// STRICTLY MORE ACCURATE than what it replaces on the loops it accepts. MakeFilling
// always fits a B-spline patch to a tolerance (default 1e-4 in the 10-arg ctor the
// call site uses); a Geom_Plane through a planar loop is exact to machine precision.
//
// ============================ DROP HYGIENE =================================
// Uses ONLY toolkits that are already in OCCT_CLOSURE and would remain after a TKOffset
// drop — verified by `nm -gU` over /opt/homebrew/opt/opencascade/lib:
//   BRepBuilderAPI_MakeFace       TKTopAlgo
//   BRepAdaptor_Curve / BRep_Tool TKBRep
//   Geom_Plane / GeomAdaptor      TKG3d
//   gp_ / TColgp_                 TKMath
// NO BRepOffsetAPI_, NO BRepFill_, NO GeomPlate_, NO Approx_/AppDef_ symbol is
// referenced. This file introduces no toolkit that is not already loaded.
//
// ============================ WHAT THIS IS WORTH ===========================
// ★ ZERO closure movement on its own. TKOffset stays linked while ANY of its other
//   7 families still reference it, so OCCT_DIRECT stays 8 and OCCT_CLOSURE stays 14.
//   This is blocking-set reduction only. Do not score it as a drop.

#ifndef FORGE_NATIVE_BREP_NATIVEWIREFILL_HPP
#define FORGE_NATIVE_BREP_NATIVEWIREFILL_HPP

#ifdef FORGE_NATIVE_BREP

#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>

#include <string>

namespace forge {
namespace occtfill {

// Outcome of one cap attempt. `ok == false` is an HONEST DEFER, never a silent
// substitution: `face` is null and `reason` says which predicate failed.
struct WireFillResult {
    bool        ok = false;
    TopoDS_Face face;             // null unless ok
    bool        planar = false;   // the loop was planar within tol (the accepted class)
    double      planeResidual = 0.0;   // max |signed distance| of a boundary sample to
                                       // the fitted plane, in model units (measured,
                                       // reported even on defer so the frontier is visible)
    int         edgeCount = 0;
    std::string reason;
};

// Cap ONE closed free-boundary wire. `tol` is the planarity budget AND the tolerance
// handed to the face builder — the call site passes the same value it gives
// ShapeAnalysis_FreeBounds / BRepBuilderAPI_Sewing, so "planar enough to sew" and
// "planar enough to cap" are the same question.
//
// 1:1 drop-in for the call-site sequence
//     BRepOffsetAPI_MakeFilling f;
//     for (edge : wire) f.Add(edge, GeomAbs_C0);
//     f.Build();
//     if (f.IsDone()) use(f.Shape());
// with `ok` standing in for IsDone() and `face` for Shape().
WireFillResult fillFreeWire(const TopoDS_Wire& wire, double tol);

}  // namespace occtfill
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_BREP_NATIVEWIREFILL_HPP
