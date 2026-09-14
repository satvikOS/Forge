// test/OcctThickenOracle.hpp — the OCCT THICKEN answer, kept as an ORACLE.
// TEST-ONLY. NOTHING IN src/ OR include/ MAY INCLUDE THIS FILE.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS, AND WHY IT IS HERE AND NOT IN include/
// ═══════════════════════════════════════════════════════════════════════════
// TKOffset family I (BRepOffset_MakeOffset, 5 symbols) has been deleted from the
// kernel: forge::part::thickenSurface now has exactly one engine,
// forge::occtthicken::thickenShell, and refuses by name when that engine
// declines. What used to live in include/forge/OcctThickenBaseline.hpp — the
// production OCCT call plus its normalisation — is reproduced below.
//
// It is NOT deleted, because OCCT IS THE ORACLE THIS FAMILY IS MEASURED AGAINST.
// Deleting the oracle along with the dependency would leave the native engine
// with nothing to be wrong against, which is how a replacement programme stops
// being able to tell parity from a plausible-looking answer.
//
// THE WHOLE POINT IS THE DIRECTORY. `test/` is compiled by
// test/build_*.sh and by the FORGE_BUILD_TESTS targets into standalone gate
// binaries. No target in forge-kernel/CMakeLists.txt compiles anything under
// test/ into libforge_kernel_core, and tools/tkoffset_callsite_gate.py walks
// only src/ and include/ — deliberately, because those are what ship. So the
// five symbols below appear in gate binaries, which link -lTKOffset on purpose,
// and in NOTHING that reaches Forge.app.
//
//   shipped library  libforge_kernel_core   TKOffset family-I symbols: 0
//   gate binaries    thicken_orientation_gate, corpus_ab_coverage,
//                    ab_native_thicken_occt                          : 5, by design
//
// ═══════════════════════════════════════════════════════════════════════════
// FIDELITY: THIS IS THE WHOLE BLOCK, NOT THE CALL
// ═══════════════════════════════════════════════════════════════════════════
// The single most expensive mistake this family has made was an A/B whose OCCT
// arm was a hand-copy of only the FIRST HALF of the production block — the
// BRepOffset_MakeOffset call without the normalising Reverse() that followed it.
// The result was a measured, reproducible and entirely spurious finding: over the
// 600-part reference corpus the two arms disagreed on SIGNED volume on 600 of
// 600 parts at ratio EXACTLY -1.000000, with area ratio exactly 1.000000 and 595
// of 600 identical on every other observable.
//
// So the oracle below is the WHOLE thing production used to do, in one callable
// unit, and every harness calls THIS rather than re-typing it. That is the same
// discipline the old header enforced; only the directory changed.
//
// `occtThickenOracleRaw` is the un-normalised sub-expression, exposed under a
// name that says what it is, so the raw sign stays on the permanent record as a
// DIAGNOSTIC (corpus family THICKEN_RAWOCCT) instead of vanishing once the arm
// is correct.
//
// See include/forge/OcctThickenBaseline.hpp for the divergence-theorem argument
// that makes POSITIVE the correct orientation rather than a house style, and
// test/thicken_orientation_gate.cpp for the two-directional gate on it.

#ifndef FORGE_TEST_OCCTTHICKENORACLE_HPP
#define FORGE_TEST_OCCTTHICKENORACLE_HPP

#include <stdexcept>

#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_Shape.hxx>
#include <TopoDS_Shape.hxx>

#include "forge/OcctThickenBaseline.hpp"   // orientedPositiveSolid — the post-condition

namespace forge {
namespace testoracle {

// THE OCCT THICKEN ORACLE — what forge::part::thickenSurface did before TKOffset
// family I was deleted: the call AND the normalisation, with nothing added and
// nothing left out.
//
// `offset` is SIGNED (the side selector is applied by the caller); `tol` is the
// build tolerance BRepOffset_MakeOffset::Initialize takes.
// Throws std::runtime_error if the offset build fails, with the message the
// production path used to throw — kept verbatim so a harness can still assert on
// it as the historical behaviour.
inline TopoDS_Shape occtThickenOracle(const TopoDS_Shape& src, double offset, double tol) {
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
    return ::forge::part::orientedPositiveSolid(mk.Shape());
}

// THE RAW, UN-NORMALISED OCCT ANSWER. Returns a null shape rather than throwing,
// because its callers are diagnostics that want "no answer" as a datum.
inline TopoDS_Shape occtThickenOracleRaw(const TopoDS_Shape& src, double offset, double tol) {
    BRepOffset_MakeOffset mk;
    mk.Initialize(src, offset, tol, BRepOffset_Skin,
                  Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
    mk.MakeThickSolid();
    if (!mk.IsDone()) return TopoDS_Shape();
    return mk.Shape();
}

}  // namespace testoracle
}  // namespace forge

// ── COMPATIBILITY ALIASES ───────────────────────────────────────────────────
// The harnesses that already existed call forge::part::occtThickenBaseline /
// ...Raw. Those names now resolve here, in a TEST-ONLY header, so a harness that
// is not updated fails to COMPILE (the name is gone from include/) rather than
// silently measuring something else. The aliases are inline functions and not
// `using`-declarations so that the file:line a harness reports still points at
// this oracle.
namespace forge {
namespace part {

inline TopoDS_Shape occtThickenBaseline(const TopoDS_Shape& src, double offset, double tol) {
    return ::forge::testoracle::occtThickenOracle(src, offset, tol);
}
inline TopoDS_Shape occtThickenBaselineRaw(const TopoDS_Shape& src, double offset, double tol) {
    return ::forge::testoracle::occtThickenOracleRaw(src, offset, tol);
}

}  // namespace part
}  // namespace forge

#endif  // FORGE_TEST_OCCTTHICKENORACLE_HPP
