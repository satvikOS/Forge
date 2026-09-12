// ShapeHandle.cpp — the OCCT-free shape identity, answered by the registry.
//
// These are deliberately free functions rather than members: a caller that only
// needs "what kind of body is this" and "let go of it" should not have to include
// the registry's class definition, which holds a TopoDS_Shape by value and drags
// OCCT in with it. See forge/ShapeHandle.hpp for why that mattered.
#include "forge/ShapeHandle.hpp"

#include "forge/ShapeRegistry.hpp"

namespace forge {

bool shapeHandleKnown(ShapeHandle h) {
  if (h == kInvalidHandle) return false;
  try {
    (void)ShapeRegistry::instance().kindOf(h);
    return true;
  } catch (...) {
    return false;
  }
}

ShapeKind shapeKind(ShapeHandle h) {
  // An unknown handle is not an OCCT shape, and saying Occt for one would send the
  // caller down the get() path for a body that is not there. Callers that need to
  // tell "unknown" from "OCCT" ask shapeHandleKnown() first.
  try {
    return ShapeRegistry::instance().kindOf(h);
  } catch (...) {
    return ShapeKind::Occt;
  }
}

void retainShape(ShapeHandle h) {
  if (h == kInvalidHandle) return;
  try { ShapeRegistry::instance().retain(h); } catch (...) {}
}

void releaseShape(ShapeHandle h) {
  if (h == kInvalidHandle) return;
  try { ShapeRegistry::instance().release(h); } catch (...) {}
}

}  // namespace forge
