// ShapeHandle.hpp — the shape identity, with no OCCT in sight.
//
// WHY THIS EXISTS. The migration's Stage 1 is "Forge application code should stop
// talking directly to OCCT", and removing OCCT includes from the application's .cpp
// files does not achieve it. MEASURED: after
// forge-desktop/src/ModelQuality.cpp was rewritten to name no OCCT type at all, it
// still would not compile without the OCCT headers --
//
//     forge/ShapeRegistry.hpp:28:10: fatal error: 'TopoDS_Shape.hxx' file not found
//
// -- because ShapeRegistry.hpp declares add(TopoDS_Shape) and get() -> const
// TopoDS_Shape&, and holds a TopoDS_Shape by value in its private Entry. Including
// that header is how the app kept a hard dependency on OCCT while naming none of it.
// The boundary is where the HEADERS are.
//
// So this header carries the part of the registry that is Forge's own: the handle,
// what kind of body is behind it, and the reference counting. ShapeRegistry.hpp
// includes this one and adds the OCCT-typed members on top, so all 59 of its
// existing includers are unaffected. Application code includes THIS.
#pragma once

#include <cstdint>

namespace forge {

using ShapeHandle = std::uint32_t;
constexpr ShapeHandle kInvalidHandle = 0;

// The backend that produced the shape behind a handle.
enum class ShapeKind : std::uint8_t {
  Occt = 0,         // a TopoDS_Shape (OCCT -- the default live path)
  NativeSolid = 1,  // a forge::native::brep::Solid (analytic native B-rep)
  NativeMesh = 2    // a forge::native::mesh::HalfEdgeMesh (native fillet/chamfer)
};

// What kind of body is behind this handle. ShapeKind::Occt for an unknown handle
// would be a lie, so these report honestly: see shapeHandleKnown().
ShapeKind shapeKind(ShapeHandle h);
bool shapeHandleKnown(ShapeHandle h);

// Reference counting, the registry's, reached without naming the registry.
void retainShape(ShapeHandle h);
void releaseShape(ShapeHandle h);

}  // namespace forge
