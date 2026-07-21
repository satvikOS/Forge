// forge/native/shape/Compound.cpp — heterogeneous Shape container (see Compound.hpp).

#include "forge/native/shape/Compound.hpp"

namespace forge {
namespace native {
namespace shape {

std::size_t Compound::countOfType(ShapeType t) const {
    std::size_t n = 0;
    for (const Shape& s : children_) {
        if (s.type() == t) ++n;
    }
    return n;
}

} // namespace shape
} // namespace native
} // namespace forge
