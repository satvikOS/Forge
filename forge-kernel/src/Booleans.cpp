#include "forge/Booleans.hpp"

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <stdexcept>

namespace forge {

namespace {
template <typename Op>
ShapeHandle runBoolean(ShapeHandle a, ShapeHandle b, const char* opName) {
    const auto& sa = ShapeRegistry::instance().get(a);
    const auto& sb = ShapeRegistry::instance().get(b);
    Op op(sa, sb);
    op.Build();
    if (!op.IsDone()) {
        throw std::runtime_error(std::string("forge: boolean ") + opName + " failed");
    }
    return ShapeRegistry::instance().add(op.Shape());
}
}

ShapeHandle fuse(ShapeHandle a, ShapeHandle b)   { return runBoolean<BRepAlgoAPI_Fuse>(a, b, "fuse"); }
ShapeHandle cut(ShapeHandle a, ShapeHandle b)    { return runBoolean<BRepAlgoAPI_Cut>(a, b, "cut"); }
ShapeHandle common(ShapeHandle a, ShapeHandle b) { return runBoolean<BRepAlgoAPI_Common>(a, b, "common"); }

} // namespace forge
