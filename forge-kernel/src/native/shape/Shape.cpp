// forge/native/shape/Shape.cpp — polymorphic Shape handle (see Shape.hpp).

#include "forge/native/shape/Shape.hpp"

namespace forge {
namespace native {
namespace shape {

const char* shapeTypeName(ShapeType t) {
    switch (t) {
        case ShapeType::VERTEX:   return "VERTEX";
        case ShapeType::EDGE:     return "EDGE";
        case ShapeType::WIRE:     return "WIRE";
        case ShapeType::FACE:     return "FACE";
        case ShapeType::SHELL:    return "SHELL";
        case ShapeType::SOLID:    return "SOLID";
        case ShapeType::COMPOUND: return "COMPOUND";
        case ShapeType::NONE:     return "NONE";
    }
    return "NONE";
}

} // namespace shape
} // namespace native
} // namespace forge
