// NativeShapeAccess.cpp — the implementation of the OCCT-free shape seam.
//
// Like ShapeHandle.cpp, these are free functions so a caller that wants a
// shape::Shape out of the registry does not have to include the registry's class
// definition, which holds a TopoDS_Shape by value and drags OCCT in with it.
// THIS file includes it; the HEADER does not, and that is where the boundary is.
#include "forge/NativeShapeAccess.hpp"

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle addNativeSolidShape(std::shared_ptr<native::brep::TopologyBuilder> owner,
                                native::brep::Solid* solid) {
#ifdef FORGE_NATIVE_BREP
  // No null guard here ON PURPOSE. addNativeSolid() already refuses a null owner
  // or a null solid by throwing, and the catch below turns that into
  // kInvalidHandle -- so a guard on this line would be redundant, and a
  // MUTATION SWEEP proved it: deleting it left the gate GREEN, because the
  // contract was enforced one layer down the whole time. A defensive line no
  // test can falsify is a line that reads as a check and is not one. The
  // contract itself IS gated (shape_seam_gate.cpp S0: null owner and null solid
  // both give kInvalidHandle); what is gone is the duplicate enforcement.
  try {
    return ShapeRegistry::instance().addNativeSolid(std::move(owner), solid);
  } catch (...) {
    return kInvalidHandle;
  }
#else
  // No native half compiled in. Say so by failing, not by handing back a handle
  // that nativeShapeOf() would then have to call null.
  (void)owner;
  (void)solid;
  return kInvalidHandle;
#endif
}

native::shape::Shape nativeShapeOf(ShapeHandle h) {
#ifdef FORGE_NATIVE_BREP
  // Same as above: kindOf(kInvalidHandle) throws and the catch answers a null
  // Shape, so an explicit invalid-handle guard here was redundant and the sweep
  // said so. Removed rather than kept as decoration.
  try {
    const ShapeRegistry& reg = ShapeRegistry::instance();
    // ★ THIS ONE IS KEPT THOUGH THE SWEEP CALLS IT UNGUARDED, and the reason is
    //   COST, not correctness. getNativeSolid() refuses a non-NativeSolid entry
    //   by throwing, so deleting this line changes no ANSWER -- it changes the
    //   PATH. Every lookup of an OCCT-backed handle (the default kind, and the
    //   majority of entries today) would raise and catch a C++ exception, on
    //   what is meant to become the kernel's interchange read. It is named as
    //   unguarded in the commit rather than dressed up as a check.
    if (reg.kindOf(h) != ShapeKind::NativeSolid) return native::shape::Shape();
    // getNativeSolid() hands back a const reference because BORROWING is its
    // contract, but the object itself is the non-const brep::Solid the registry
    // stores and the builder owns -- so casting the constness back off is
    // well-defined here, and it is the only way to hand the facade the
    // brep::Solid* its factories take. The Shape is still a borrow: it dies with
    // the handle, exactly as the header says.
    const native::brep::Solid& s = reg.getNativeSolid(h);
    return native::shape::Shape::ofSolid(const_cast<native::brep::Solid*>(&s));
  } catch (...) {
    return native::shape::Shape();
  }
#else
  (void)h;
  return native::shape::Shape();
#endif
}

}  // namespace forge
