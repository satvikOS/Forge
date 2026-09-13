// forge/BodyInventoryOcct.hpp — the OCCT-typed half of the body inventory.
//
// Split out of forge/BodyInventory.hpp on 2026-09-12, for the reason
// forge/ShapeHandle.hpp records at length: the migration's Stage 1 is that
// APPLICATION CODE STOPS TALKING TO OCCT, and removing OCCT includes from the
// application's .cpp files does not achieve it. The boundary is where the
// HEADERS are. BodyInventory.hpp declared one overload whose parameter is a
// TopoDS_Shape, and that single line put OCCT on the include path of every file
// that wanted a body inventory -- measurably including
// forge-desktop/src/KernelScene.cpp, which names no OCCT type at all.
//
// Nothing outside forge-kernel/src/BodyInventory.cpp calls this overload today.
// It is kept, rather than deleted, because it IS the definition the handle form
// delegates to, and because a caller that already holds a TopoDS_Shape should
// not have to put it back in the registry to measure it.
#pragma once

#include "forge/BodyInventory.hpp"

#include <TopoDS_Shape.hxx>

namespace forge {

// The inventory over a shape the caller already holds. The handle overload in
// BodyInventory.hpp resolves its handle and delegates here, so the two can never
// measure differently.
BodyInventory bodyInventory(const TopoDS_Shape& shape, const BodyInventoryOptions& options = {});

}  // namespace forge
