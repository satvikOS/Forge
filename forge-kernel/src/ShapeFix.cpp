// PUSH-18 — ShapeFix_Shape::Perform() with full status logging.
//
// Wraps Healing's ShapeFix_Shape pass with a human-readable list of every
// fixer that fired. Maps the DONE1..8 / FAIL1..8 enums to short strings
// matching OCCT documentation. Returns the fixed shape's handle + log.

#include "forge/ShapeFix.hpp"

#include <Precision.hxx>
#include <ShapeExtend_Status.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>

namespace forge::shapefix {

namespace {

// Map DONE1..DONE8 to a short message taken from the OCCT ShapeFix_Shape
// header documentation (DONE1 = some free wires fixed, DONE2 = some free
// edges fixed, …). FAIL bits use a generic "fix attempted, failed" tag
// since the per-bit semantics aren't always documented per-sub-fixer.
const char* doneMessage(int idx) {
    switch (idx) {
        case 1: return "DONE1: tolerance fixed";
        case 2: return "DONE2: wires fixed";
        case 3: return "DONE3: small faces removed";
        case 4: return "DONE4: edges fixed";
        case 5: return "DONE5: face orientations fixed";
        case 6: return "DONE6: self-intersection / shell topology fixed";
        case 7: return "DONE7: missing seams / pcurves fixed";
        case 8: return "DONE8: other fixer fired";
    }
    return "DONE?: unknown";
}

const char* failMessage(int idx) {
    switch (idx) {
        case 1: return "FAIL1: tolerance fix failed";
        case 2: return "FAIL2: wire fix failed";
        case 3: return "FAIL3: small-face fix failed";
        case 4: return "FAIL4: edge fix failed";
        case 5: return "FAIL5: face orientation fix failed";
        case 6: return "FAIL6: self-intersection / shell fix failed";
        case 7: return "FAIL7: missing seam / pcurve fix failed";
        case 8: return "FAIL8: other fixer failed";
    }
    return "FAIL?: unknown";
}

}  // namespace

RepairResult repair(ShapeHandle shape,
                    double precision,
                    double minTol,
                    double maxTol) {
    const auto& s = ShapeRegistry::instance().get(shape);
    if (s.IsNull()) {
        throw std::invalid_argument("forge.shapefix.repair: null shape");
    }

    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    if (precision > Precision::Confusion()) fixer->SetPrecision(precision);
    if (minTol    > Precision::Confusion()) fixer->SetMinTolerance(minTol);
    if (maxTol    > Precision::Confusion()) fixer->SetMaxTolerance(maxTol);

    // Perform runs ShapeFix_Wire, ShapeFix_Edge, ShapeFix_Face,
    // ShapeFix_Shell, ShapeFix_Solid in order, recording DONEi bits on
    // success and FAILi bits on failure.
    fixer->Perform();
    TopoDS_Shape fixed = fixer->Shape();
    if (fixed.IsNull()) {
        throw std::runtime_error(
            "forge.shapefix.repair: ShapeFix_Shape produced a null shape");
    }

    RepairResult out{};
    out.handle = ShapeRegistry::instance().add(fixed);

    // ShapeExtend_DONE1..DONE8 are the 8 consecutive enum values starting
    // at ShapeExtend_DONE1; same for FAIL1..FAIL8. We probe each bit
    // explicitly via fixer->Status(<bit>).
    const ShapeExtend_Status doneBits[8] = {
        ShapeExtend_DONE1, ShapeExtend_DONE2, ShapeExtend_DONE3,
        ShapeExtend_DONE4, ShapeExtend_DONE5, ShapeExtend_DONE6,
        ShapeExtend_DONE7, ShapeExtend_DONE8
    };
    const ShapeExtend_Status failBits[8] = {
        ShapeExtend_FAIL1, ShapeExtend_FAIL2, ShapeExtend_FAIL3,
        ShapeExtend_FAIL4, ShapeExtend_FAIL5, ShapeExtend_FAIL6,
        ShapeExtend_FAIL7, ShapeExtend_FAIL8
    };
    for (int i = 0; i < 8; ++i) {
        if (fixer->Status(doneBits[i])) {
            out.log.emplace_back(doneMessage(i + 1));
        }
    }
    for (int i = 0; i < 8; ++i) {
        if (fixer->Status(failBits[i])) {
            out.log.emplace_back(failMessage(i + 1));
        }
    }
    if (out.log.empty()) {
        out.log.emplace_back("no fixer fired — input was already clean");
    }
    return out;
}

}  // namespace forge::shapefix
