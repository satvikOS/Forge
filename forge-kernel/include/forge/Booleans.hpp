#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle fuse(ShapeHandle a, ShapeHandle b);
ShapeHandle cut(ShapeHandle a, ShapeHandle b);
ShapeHandle common(ShapeHandle a, ShapeHandle b);

// THE FOURTH OCCT BOOLEAN OPERATOR, and the one this kernel did not have.
//
// BRepAlgoAPI has four: Fuse, Cut, Common, Section. The first three are above and
// each returns a SOLID. Section does not, and that is the whole reason it needs its
// own declaration rather than a fourth `which` value in runBoolean<>: it returns the
// INTERSECTION CURVES of the two shapes' faces -- a compound of EDGES, with no faces,
// no shells and zero volume. Typing it as a solid would be worse than not having it:
// every downstream measurement (massProperties, faceCount, checkValidity) would report
// an "empty solid" for a perfectly good section.
//
// What comes back:
//   * the section edges CHAINED by endpoint proximity into wires;
//   * exactly one chain  -> a TopoDS_Wire, which is what forge::part::profileWire
//                           produces and therefore what loftguide::loft consumes;
//   * more than one      -> a TopoDS_Compound of those wires (a plane cutting a tube
//                           gives two circles, and merging them into one wire would be
//                           a lie about the geometry).
//
// MEASURED (OCCT 7.9.3, BRepAlgoAPI_Section with Approximation on):
//   BOX(40,40,20) n SPHERE(r=10) centred on the top face -> 1 edge, 1 closed wire,
//       length 62.831853 == 2*pi*10 (the exact circle, not a chord polygon)
//   BOX n BOX overlapping at a corner                    -> 6 edges, 1 closed wire, length 100
//   BOX n CYL(r=10) passing through                      -> 2 edges, 2 closed wires, length 125.663706
//
// THROWS when the operands do not intersect: an empty section is not a value any
// consumer can use, and returning an empty compound would push the failure into
// whatever tried to loft it.
ShapeHandle section(ShapeHandle a, ShapeHandle b);

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
