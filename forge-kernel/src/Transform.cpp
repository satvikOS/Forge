#include "forge/Transform.hpp"

#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>

namespace forge {

namespace {
ShapeHandle applyTrsf(ShapeHandle h, const gp_Trsf& tr) {
    const auto& shape = ShapeRegistry::instance().get(h);
    BRepBuilderAPI_Transform mover(shape, tr, /*copy*/ Standard_False);
    return ShapeRegistry::instance().add(mover.Shape());
}
}

ShapeHandle translate(ShapeHandle h, double dx, double dy, double dz) {
    gp_Trsf tr;
    tr.SetTranslation(gp_Vec(dx, dy, dz));
    return applyTrsf(h, tr);
}

ShapeHandle rotate(ShapeHandle h, double ax, double ay, double az, double angleRad) {
    gp_Trsf tr;
    const gp_Pnt origin(0, 0, 0);
    const gp_Dir axis(ax, ay, az);
    tr.SetRotation(gp_Ax1(origin, axis), angleRad);
    return applyTrsf(h, tr);
}

} // namespace forge
