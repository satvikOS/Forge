// forge/OcctThickenBaseline.hpp — the THICKEN ORIENTATION POST-CONDITION, and
// nothing else. TKOffset family I is DELETED from this header.
//
// ═══════════════════════════════════════════════════════════════════════════
// ★ READ THE NAME AS HISTORY, NOT AS A FACT
// ═══════════════════════════════════════════════════════════════════════════
// This file used to hold `occtThickenBaseline` / `occtThickenBaselineRaw` — two
// inline functions that called BRepOffset_MakeOffset, and the ONLY reason
// libforge_kernel_core carried these five TKOffset symbols:
//
//     BRepOffset_MakeOffset::BRepOffset_MakeOffset()
//     BRepOffset_MakeOffset::Initialize(TopoDS_Shape const&, double, double,
//                                       BRepOffset_Mode, bool, bool,
//                                       GeomAbs_JoinType, bool, bool)
//     BRepOffset_MakeOffset::MakeThickSolid(Message_ProgressRange const&)
//     BRepOffset_MakeOffset::Shape() const
//     BRepOffset_MakeOffset::IsDone() const
//
// They are GONE — deleted, not put behind a flag. A flag that stops taking a
// branch leaves the symbol in the binary; only removing the code removes the
// symbol, and this programme lost a week to that distinction. Measured on the
// production translation unit (the only one in src/ or include/ that ever
// reached them):
//
//     src/Features.cpp.o, TKOffset undefined symbols   BEFORE 31   AFTER 26
//     of which BRepOffset_MakeOffset::*                BEFORE  5   AFTER  0
//
// THE FILE NAME IS LEFT ALONE ON PURPOSE, and that is a trade, not an oversight:
// eight sibling families are being converted in parallel against this same tree,
// and a rename would turn their merges into build breaks rather than conflicts.
// Renaming it to forge/ThickenOrientation.hpp is named follow-up work for after
// the ninth family lands. Until then this banner is the correction: there is no
// OCCT baseline in here.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE OCCT ANSWER WENT — IT IS STILL THE ORACLE, IT IS JUST NOT SHIPPED
// ═══════════════════════════════════════════════════════════════════════════
// OCCT remains the thing this family is TESTED AGAINST; it is no longer the thing
// that answers. The baseline moved, unchanged in behaviour, to
//
//     forge-kernel/test/OcctThickenOracle.hpp
//
// which lives under test/ — a directory no target in CMakeLists.txt compiles into
// libforge_kernel_core, and which tools/tkoffset_callsite_gate.py deliberately
// does not scan (it walks src/ and include/ only, because those are what ship).
// The A/B harnesses and the orientation gate include it and go on measuring the
// native engine against live OCCT on every run.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT REMAINS HERE, AND WHY IT IS NOT OCCT-FAMILY WORK
// ═══════════════════════════════════════════════════════════════════════════
// The orientation post-condition. It is TKOffset-free and always was: it uses
// only BRepGProp / GProp_GProps (TKTopAlgo) and TopoDS_Shape (TKBRep), both of
// which are in the load closure unconditionally and are called from dozens of
// other sites. Deleting family I does not touch it, and it must NOT be deleted
// with it — after the drop it is the ONLY orientation guarantee `thickenSurface`
// has, because the branch that used to carry one is the branch that went away.
//
// ── THE MATHEMATICS, NAMED ──────────────────────────────────────────────────
// `BRepGProp::VolumeProperties` evaluates the volume of a B-rep solid as a
// surface integral over its boundary, by the DIVERGENCE (Gauss) THEOREM:
//
//     V = (1/3) * closed-integral over dS of  ( r · n ) dA
//
// with r the position vector and n the face normal. The classical treatment for
// a boundary representation is Lien & Kajiya, "A Symbolic Method for Calculating
// the Integral Properties of Arbitrary Nonconvex Polyhedra", IEEE Computer
// Graphics and Applications 4(10):35-41, 1984 — the formulation OCCT's GProp
// package implements exactly for the polyhedral case and integrates numerically
// for the general one.
//
// The consequence is the whole reason this file exists: the identity holds with
// n OUTWARD. Feed it the same geometry with every face reversed and the integrand
// changes sign, so V comes back NEGATIVE. THE SIGN OF THE REPORTED MASS IS
// THEREFORE A DIRECT READ-OUT OF THE SHELL'S ORIENTATION — it is not a
// convention, an accident, or a house style, and `std::fabs` on it is not a fix
// but the erasure of the only observable that carries the bit.
//
// ── WHICH SIGN IS CORRECT — MEASURED, NOT ASSERTED ──────────────────────────
// The native engine (forge::occtthicken::thickenShell) returns POSITIVE.
// BRepOffset_MakeOffset, called as the deleted baseline called it (Skin,
// GeomAbs_Arc, makeThickSolid=true), returned NEGATIVE. Four independent
// findings, all of which predate this drop and none of which it changes:
//
//   1. OCCT'S OWN CLASSIFIER DISAGREED WITH OCCT'S OWN OFFSET. Run
//      BRepClass3d_SolidClassifier on a point strictly inside the wall of the
//      thickened plate. Against the native solid it answers TopAbs_IN. Against
//      the RAW BRepOffset_MakeOffset solid it answered TopAbs_OUT — the raw
//      solid denotes the UNBOUNDED complement of the plate, not the plate. That
//      is a wrong answer to a question with one right answer.
//      forge-kernel/test/thicken_orientation_gate.cpp asserts both directions
//      and still does, against the test-only oracle.
//   2. OCCT'S OWN NORMALISER AGREES. BRepLib::OrientClosedSolid orients a closed
//      shell outward, and outward normals are exactly what makes
//      BRepGProp::VolumeProperties positive — see the integral above. Every OCCT
//      primitive (BRepPrimAPI_MakeBox and friends) is positive.
//   3. THE KERNEL ALREADY KEEPS POSITIVE, at six independent sites:
//      OcctPrimBuilder.cpp:76,106,315 and NativeOcctBridge.cpp:120,296,695.
//   4. A REAL CONSUMER BREAKS ON NEGATIVE. SheetMetalExtended.cpp:327
//      isDownstream() tests `Mass() <= kEps`, which a NEGATIVE volume PASSES,
//      silently dropping a good solid into the bounding-box-centre fallback and
//      answering from the wrong geometry.
//
// ★ THE ONE PIECE OF HISTORY WORTH CARRYING FORWARD. The 600-part corpus A/B
//   once reported the two engines disagreeing on SIGNED volume on 600 of 600
//   parts at ratio exactly -1.000000, with area, centre of mass, all six
//   bounding-box bounds and every face/edge/vertex count identical on 595 of
//   them. That was never a geometric disagreement: the harness's OCCT arm was a
//   hand-copy of only the FIRST HALF of the production block and omitted this
//   normalisation. Do not re-litigate it; the arms call shared code and the raw
//   sign is still measured every run under the diagnostic family THICKEN_RAWOCCT.
//
// ═══════════════════════════════════════════════════════════════════════════
// DROP HYGIENE
// ═══════════════════════════════════════════════════════════════════════════
// No #ifdef guards anything in this header any more, and that is the point: there
// is no OCCT branch left to guard. The name BRepOffset_MakeOffset appears in this
// file only in the banner above, where it is history — zero code references, so
// tools/tkoffset_callsite_gate.py counts nothing here under any family.
// OCCT includes: 3 (BRepGProp, GProp_GProps, TopoDS_Shape) — was 6.

#ifndef FORGE_OCCTTHICKENBASELINE_HPP
#define FORGE_OCCTTHICKENBASELINE_HPP

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>

namespace forge {
namespace part {

// THE ORIENTATION POST-CONDITION, for whichever engine answered.
//
// Returns `s` oriented so that BRepGProp::VolumeProperties reports a POSITIVE
// mass — i.e. the shell's normals point OUT of the material and the solid
// denotes the bounded region, which is the only reading under which
// BRepClass3d_SolidClassifier answers TopAbs_IN for an interior point. See the
// divergence-theorem paragraph in the banner for why the sign carries that bit.
//
// A null shape passes through unchanged (the caller's defer path owns it).
// A shape whose |volume| is zero cannot be oriented and is returned as-is
// rather than silently declared fine; callers that care assert on it.
inline TopoDS_Shape orientedPositiveSolid(TopoDS_Shape s) {
    if (s.IsNull()) return s;
    GProp_GProps vp;
    BRepGProp::VolumeProperties(s, vp);
    if (vp.Mass() < 0.0) s.Reverse();
    return s;
}

// Is `s` positively oriented (outward normals, bounded region)? The predicate the
// gate and the A/B both read, so "positively oriented" has ONE definition in the
// tree rather than one per call site.
inline bool isPositivelyOrientedSolid(const TopoDS_Shape& s) {
    if (s.IsNull()) return false;
    GProp_GProps vp;
    BRepGProp::VolumeProperties(s, vp);
    return vp.Mass() > 0.0;
}

}  // namespace part
}  // namespace forge

#endif  // FORGE_OCCTTHICKENBASELINE_HPP
