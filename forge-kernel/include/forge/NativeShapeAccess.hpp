// forge/NativeShapeAccess.hpp — the kernel's shape store, reached WITHOUT OCCT.
//
// WHY THIS EXISTS, and it is not the reason the removal tracker gave.
//
// OCCT_REMOVAL_TRACKER named "an OWNING, OCCT-free shape handle adopted as the
// kernel interchange type" as the single highest-unlock item -- it gates 365 of
// 550 remaining symbols -- and then named OWNERSHIP as the piece that was
// missing: "shape::Shape is a NON-OWNING tagged pointer into a TopologyBuilder
// while ShapeRegistry stores its Occt entries by value, so a registry entry that
// outlives its builder dangles. Either shape::Shape gains shared ownership or
// ShapeRegistry owns the builder per entry."
//
// MEASURED on the tree that paragraph was generated from: the second disjunct is
// ALREADY IMPLEMENTED. ShapeRegistry::Entry holds
// `std::shared_ptr<native::brep::TopologyBuilder> owner` and addNativeSolid()
// takes one by value (ShapeRegistry.hpp / ShapeRegistry.cpp:97). A NativeSolid
// entry cannot outlive its builder, because it OWNS it. The tracker was steering
// the programme at a blocker that had been removed.
//
// THE REAL BLOCKER, measured the same way: nothing can PRODUCE a shape::Shape
// from the kernel's live shape store. Before this header,
//     grep -rn 'shape::Shape' forge-kernel/src forge-kernel/include ui forge-desktop
//       --exclude-dir=shape
// returned ZERO hits. The handle type, the traversal facade, Wire, Compound and
// ~13k lines of OCCT-free B-rep ops all exist and compile, and there was no seam
// between them and ShapeRegistry -- which is the only place a body a user built
// actually lives. Adoption was blocked on a MISSING FUNCTION, not on a lifetime.
//
// So this header is that seam, and it is deliberately the SMALLEST one: register
// a native solid, and read one back as a Shape. It names no OCCT type, which is
// the whole point -- an OCCT-free caller can now round-trip through the registry.
// forge-kernel/test/shape_seam_gate.cpp is compiled with an include path that has
// NO OCCT in it, so "OCCT-free" is a build fact and not a comment.
//
// WHAT IT IS NOT. It does not drop an OCCT symbol by itself, and claiming so
// would be exactly the accounting the tracker warns about. It removes the
// blocker; the symbols fall when call sites move.
#pragma once

#include <memory>

#include "forge/ShapeHandle.hpp"
#include "forge/native/brep/Topology.hpp"    // brep::TopologyBuilder, brep::Solid
#include "forge/native/shape/Shape.hpp"      // shape::Shape

namespace forge {

// Register a native analytic B-rep solid and take a handle to it. `owner` keeps
// the builder -- and therefore the topology `solid` views into -- alive for the
// lifetime of the entry: the registry COPIES the shared_ptr, so the caller may
// drop its own reference immediately and the entry stays valid.
//
// Refcount starts at 1; releaseShape(h) drops it, and the builder dies with the
// last reference. Returns kInvalidHandle for a null owner or a null solid, and
// in a build without FORGE_NATIVE_BREP (where the registry has no native half) —
// never throws, because the OCCT-free callers this exists for have no OCCT
// exception machinery to catch.
ShapeHandle addNativeSolidShape(std::shared_ptr<native::brep::TopologyBuilder> owner,
                                native::brep::Solid* solid);

// The body behind `h`, as the polymorphic Forge shape handle.
//
// A NULL Shape (isNull()) when the handle names nothing, when the entry is not
// NativeSolid-backed (an OCCT TopoDS_Shape or a native RESULT MESH is not a
// shape::Shape and saying otherwise would be a lie), or in a build without
// FORGE_NATIVE_BREP. Check kind with shapeKind() / shapeHandleKnown() from
// ShapeHandle.hpp when you need to tell those cases apart.
//
// The returned Shape is NON-OWNING, like TopoDS_Shape: it stays valid as long as
// the handle does. Release the handle and it dangles — which is the same
// contract every other borrow in this registry has.
native::shape::Shape nativeShapeOf(ShapeHandle h);

}  // namespace forge
