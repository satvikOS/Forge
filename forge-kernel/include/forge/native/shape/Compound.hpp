// forge/native/shape/Compound.hpp
//
// COMPOUND for the Forge native kernel — a heterogeneous container of Shapes
// (assembly grouping / multi-body result). The OCCT-zero replacement for the
// free TopoDS_Compound (~11 uses).
//
// ============================ HONESTY (Bible §0/§9) ========================
// A Compound owns a flat, ORDERED list of Shape handles of ANY type (a solid
// next to a wire next to a face), exactly like TopoDS_Compound. It OWNS the
// Shape HANDLES (which are non-owning views), NOT the underlying entities — those
// remain owned by their TopologyBuilder / Wire objects. Compounds may be nested
// (a Compound Shape can be a child of another Compound); the traversal facade
// (Explore.hpp) recurses through them.
//
// ADDITIVE: NEW type in namespace forge::native::shape; no production path
// touched — existing behaviour is byte-identical.

#ifndef FORGE_NATIVE_SHAPE_COMPOUND_HPP
#define FORGE_NATIVE_SHAPE_COMPOUND_HPP

#include <cstddef>
#include <vector>

#include "forge/native/shape/Shape.hpp"

namespace forge {
namespace native {
namespace shape {

// ----------------------------------------------------------------------------
// Compound — an ordered, heterogeneous set of child Shapes.
// ----------------------------------------------------------------------------
class Compound {
public:
    Compound() = default;

    // Append a child Shape (any type, including another Compound).
    void add(const Shape& s) { children_.push_back(s); }

    std::size_t size()  const { return children_.size(); }
    bool        empty() const { return children_.empty(); }

    const Shape& at(std::size_t i) const { return children_[i]; }
    const std::vector<Shape>& children() const { return children_; }

    // Count DIRECT children of a given type (does not recurse into nested
    // compounds — use Explore.hpp for a full sub-shape enumeration).
    std::size_t countOfType(ShapeType t) const;

private:
    std::vector<Shape> children_;
};

} // namespace shape
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_SHAPE_COMPOUND_HPP
