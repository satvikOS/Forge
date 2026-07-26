#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle fuse(ShapeHandle a, ShapeHandle b);
ShapeHandle cut(ShapeHandle a, ShapeHandle b);
ShapeHandle common(ShapeHandle a, ShapeHandle b);

// Open a fresh OCCT-boolean hang-guard window.
//
// The guard exists to stop a storm of DEGENERATE booleans on ONE body from
// spinning for minutes — its own diagnostic says "exhausted for this body". But
// the window is process-global and only resets after a >3 s idle gap, so a batch
// that builds one healthy body after another with no pause shares a single 20 s
// budget between all of them. Building a 6788-tree corpus, 34% of the trees
// failed on an exhausted budget rather than on anything wrong with them.
//
// Call this at the start of each independent build so every body gets the budget
// the guard was documented to give it. A genuinely degenerate body is still
// collapsed at 20 s, because that 20 s is now measured over that body alone.
void resetBooleanBudget();

} // namespace forge
