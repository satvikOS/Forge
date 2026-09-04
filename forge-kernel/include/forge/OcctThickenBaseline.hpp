// forge/OcctThickenBaseline.hpp — the OCCT THICKEN baseline, as ONE callable unit,
// and the orientation post-condition BOTH thicken engines are held to.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS
// ═══════════════════════════════════════════════════════════════════════════
// forge::part::thickenSurface has two engines behind one option. What
// FORGE_THICKEN_DROP_NATIVE=ON deletes is NOT "the BRepOffset_MakeOffset call" —
// it is the WHOLE block at Features.cpp, call AND post-processing. Any A/B that
// re-implements only the call is measuring a sub-expression of the thing under
// test, and this repository has already paid for that: the 600-part corpus A/B
// reported native and OCCT disagreeing on SIGNED VOLUME on 600 of 600 parts,
// ratio exactly -1.000000, with area, centre of mass, all six bounding-box
// bounds and every face/edge/vertex count identical on 595 of them. The
// disagreement was entirely the normalising `Reverse()` that lives INSIDE the
// deleted block and that the harness's hand-copy of the block did not have.
//
// So the baseline is defined ONCE, here, and BOTH the production path and the
// A/B harness call it. The harness stops re-implementing production, and the
// two cannot drift again.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHICH ORIENTATION IS CORRECT — MEASURED, NOT ASSERTED
// ═══════════════════════════════════════════════════════════════════════════
// BRepOffset_MakeOffset, called with (Skin, GeomAbs_Arc, makeThickSolid=true),
// returns a solid whose signed volume is NEGATIVE. The native engine
// (forge::occtthicken::thickenShell) returns POSITIVE. They are not two equally
// good conventions, and the deciding evidence is not a house style:
//
//   1. OCCT'S OWN CLASSIFIER DISAGREES WITH OCCT'S OWN OFFSET. Run
//      BRepClass3d_SolidClassifier on a point strictly inside the wall of the
//      thickened plate. Against the native solid it answers TopAbs_IN. Against
//      the RAW BRepOffset_MakeOffset solid it answers TopAbs_OUT — the raw solid
//      denotes the UNBOUNDED complement of the plate, not the plate. That is a
//      wrong answer to a question with one right answer, not a convention.
//      forge-kernel/test/thicken_orientation_gate.cpp asserts both directions.
//
//   2. OCCT'S OWN NORMALISER AGREES. BRepLib::OrientClosedSolid orients a closed
//      shell outward, and outward normals are exactly what makes
//      BRepGProp::VolumeProperties positive. Every OCCT primitive
//      (BRepPrimAPI_MakeBox and friends) is positive.
//
//   3. THE KERNEL ALREADY KEEPS POSITIVE, at six independent sites:
//      OcctPrimBuilder.cpp:76,106,315 and NativeOcctBridge.cpp:120,296,695.
//
//   4. A REAL CONSUMER BREAKS ON NEGATIVE. SheetMetalExtended.cpp:327
//      isDownstream() tests `Mass() <= kEps`, which a NEGATIVE volume PASSES,
//      silently dropping a good solid into the bounding-box-centre fallback and
//      answering from the wrong geometry.
//
// THE NATIVE ENGINE IS THE ONE THAT IS RIGHT. It is therefore NOT changed to
// match the incumbent. The incumbent is normalised — which production already
// did — and the normalisation is now applied to BOTH engines, at one site, so
// the flag cannot change what a caller receives.
//
// ═══════════════════════════════════════════════════════════════════════════
// DROP HYGIENE
// ═══════════════════════════════════════════════════════════════════════════
// occtThickenBaseline and its BRepOffset_MakeOffset include are BOTH guarded by
// `#ifndef FORGE_THICKEN_DROP_NATIVE`, exactly as the block in Features.cpp is,
// so a drop build emits no TKOffset symbol from this header. orientedPositiveSolid
// is NOT guarded: it is the post-condition of the surviving native engine too,
// and it uses only BRepGProp/GProp, which are in the closure unconditionally.

#ifndef FORGE_OCCTTHICKENBASELINE_HPP
#define FORGE_OCCTTHICKENBASELINE_HPP

#include <stdexcept>

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>

#ifndef FORGE_THICKEN_DROP_NATIVE
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_Shape.hxx>
#endif

namespace forge {
namespace part {

// THE ORIENTATION POST-CONDITION, for whichever engine answered.
//
// Returns `s` oriented so that BRepGProp::VolumeProperties reports a POSITIVE
// mass — i.e. the shell's normals point OUT of the material and the solid
// denotes the bounded region, which is the only reading under which
// BRepClass3d_SolidClassifier answers TopAbs_IN for an interior point.
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

#ifndef FORGE_THICKEN_DROP_NATIVE
// THE OCCT THICKEN BASELINE — byte-for-byte the block FORGE_THICKEN_DROP_NATIVE
// deletes from forge::part::thickenSurface, call AND normalisation, with nothing
// added and nothing left out.
//
// `offset` is SIGNED (the side selector is applied by the caller); `tol` is the
// build tolerance BRepOffset_MakeOffset::Initialize takes.
// Throws std::runtime_error if the offset build fails, with the message the
// production path has always thrown.
inline TopoDS_Shape occtThickenBaseline(const TopoDS_Shape& src, double offset, double tol) {
    BRepOffset_MakeOffset mk;
    mk.Initialize(src, offset, tol, BRepOffset_Skin,
                  /*Intersection*/ Standard_False,
                  /*SelfInter*/ Standard_False,
                  GeomAbs_Arc,
                  /*makeThickSolid*/ Standard_True);
    mk.MakeThickSolid();
    if (!mk.IsDone()) {
        throw std::runtime_error("forge.part.thickenSurface: offset build failed "
                                 "(surface may be non-manifold or self-intersecting)");
    }
    return orientedPositiveSolid(mk.Shape());
}

// THE RAW, UN-NORMALISED OCCT ANSWER — the sub-expression above, exposed under a
// name that says what it is, so the A/B can keep reporting the raw sign as a
// DIAGNOSTIC instead of the raw sign disappearing from the record when the arm is
// corrected. Nothing in production calls this.
inline TopoDS_Shape occtThickenBaselineRaw(const TopoDS_Shape& src, double offset, double tol) {
    BRepOffset_MakeOffset mk;
    mk.Initialize(src, offset, tol, BRepOffset_Skin,
                  Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
    mk.MakeThickSolid();
    if (!mk.IsDone()) return TopoDS_Shape();
    return mk.Shape();
}
#endif  // FORGE_THICKEN_DROP_NATIVE

}  // namespace part
}  // namespace forge

#endif  // FORGE_OCCTTHICKENBASELINE_HPP
