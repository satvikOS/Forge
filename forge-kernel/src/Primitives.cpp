#include "forge/Primitives.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <Precision.hxx>
#include <cmath>
#include <stdexcept>

namespace forge {

namespace {
inline void requirePositive(double v, const char* what) {
    if (!(v > Precision::Confusion())) {
        throw std::invalid_argument(std::string("forge: ") + what +
                                    " must be > Precision::Confusion (1e-7)");
    }
}
}

ShapeHandle makeBox(double dx, double dy, double dz) {
    requirePositive(dx, "box.dx");
    requirePositive(dy, "box.dy");
    requirePositive(dz, "box.dz");
    BRepPrimAPI_MakeBox mk(dx, dy, dz);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeCylinder(double r, double h) {
    requirePositive(r, "cylinder.radius");
    requirePositive(h, "cylinder.height");
    BRepPrimAPI_MakeCylinder mk(r, h);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeSphere(double r) {
    requirePositive(r, "sphere.radius");
    BRepPrimAPI_MakeSphere mk(r);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeCone(double r1, double r2, double h) {
    if (r1 < 0 || r2 < 0) {
        throw std::invalid_argument("forge: cone radii must be >= 0");
    }
    requirePositive(h, "cone.height");
    // Equal-radii cone is degenerate at the apex direction; auto-shim to cylinder.
    if (std::abs(r1 - r2) < Precision::Confusion()) {
        return makeCylinder(r1, h);
    }
    BRepPrimAPI_MakeCone mk(r1, r2, h);
    return ShapeRegistry::instance().add(mk.Shape());
}

ShapeHandle makeTorus(double R, double r) {
    requirePositive(R, "torus.majorR");
    requirePositive(r, "torus.minorR");
    if (r >= R) {
        throw std::invalid_argument("forge: torus.minorR must be < majorR (self-intersecting otherwise)");
    }
    BRepPrimAPI_MakeTorus mk(R, r);
    return ShapeRegistry::instance().add(mk.Shape());
}

} // namespace forge
