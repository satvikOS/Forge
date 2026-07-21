// forge/native/shape/Shape.hpp
//
// POLYMORPHIC SHAPE HANDLE for the Forge native kernel — the OCCT-zero
// replacement for TopoDS_Shape (KERNEL_INHOUSE_ROADMAP.md / OCCT-zero program).
//
// ============================ HONESTY (Bible §0/§9) ========================
// TopoDS_Shape is the universal topological currency across the OCCT-facing
// code (~297 uses). The native substrate (brep/Topology.hpp) is Solid-centred
// and exposes ONLY typed entity pointers (Vertex/Edge/Coedge/Loop/Face/Shell/
// Solid) — there was NO generic handle a caller could hold irrespective of the
// entity's kind, which alone blocked the migration off TopoDS_Shape.
//
// `Shape` is that handle: a small, trivially-copyable, NON-OWNING tagged pointer
// (ShapeType tag + type-erased address). It references the entities OWNED by a
// TopologyBuilder (Vertex/Edge/Face/Shell/Solid) and the two new free-standing
// entity types (shape::Wire, shape::Compound). It provides:
//   * a type query (type(), isSolid()/isEdge()/… , isNull()),
//   * SAFE downcast accessors (asSolid()/asEdge()/… ) that return the typed
//     pointer when the tag matches and nullptr otherwise (no UB on mismatch),
//   * identity (isSame / operator==) and a std::hash so a Shape can key the
//     de-duplicating maps the traversal facade (Explore.hpp) builds.
//
// This is deliberately a HANDLE, not an owner — exactly like TopoDS_Shape, whose
// TopoDS_TShape is reference-counted and shared. Lifetime of the pointed-to
// entity is the TopologyBuilder's (native brep) or the Wire/Compound object's.
//
// ADDITIVE: this header defines NEW types in a NEW namespace (forge::native::
// shape). It touches no production path, flips no default, and includes only the
// existing brep/Topology.hpp — so existing behaviour is byte-identical.
//
// CONVENTIONS: namespace forge::native::shape. Pure C++20, standard library
// only. No OCCT, no WASM.

#ifndef FORGE_NATIVE_SHAPE_SHAPE_HPP
#define FORGE_NATIVE_SHAPE_SHAPE_HPP

#include <cstddef>
#include <cstdint>
#include <functional>   // std::hash

#include "forge/native/brep/Topology.hpp"   // brep::Vertex/Edge/Face/Shell/Solid

namespace forge {
namespace native {
namespace shape {

// The two NEW free-standing entity types a Shape can hold. Forward-declared here
// (Shape stores/returns only pointers to them); their definitions live in
// Wire.hpp / Compound.hpp, which include this header — no include cycle.
class Wire;
class Compound;

// ----------------------------------------------------------------------------
// ShapeType — the tag discriminating what a Shape handle points at. Ordered by
// increasing topological dimension/containment (VERTEX ⊂ EDGE ⊂ WIRE ⊂ FACE ⊂
// SHELL ⊂ SOLID ⊂ COMPOUND), the same ordering OCCT's TopAbs_ShapeEnum uses.
// ----------------------------------------------------------------------------
enum class ShapeType : std::uint8_t {
    VERTEX   = 0,
    EDGE     = 1,
    WIRE     = 2,
    FACE     = 3,
    SHELL    = 4,
    SOLID    = 5,
    COMPOUND = 6,
    NONE     = 255,   // the null handle
};

// Human-readable tag name (for diagnostics/tests). Defined in Shape.cpp.
const char* shapeTypeName(ShapeType t);

// ----------------------------------------------------------------------------
// Shape — the polymorphic, non-owning topological handle (TopoDS_Shape analogue).
// ----------------------------------------------------------------------------
class Shape {
public:
    // A default-constructed Shape is NULL (holds nothing).
    Shape() = default;

    // --- Typed factories: wrap an existing native entity into a Shape. --------
    static Shape ofVertex(brep::Vertex* v)  { return Shape(ShapeType::VERTEX,   v); }
    static Shape ofEdge  (brep::Edge*   e)  { return Shape(ShapeType::EDGE,     e); }
    static Shape ofWire  (Wire*         w)  { return Shape(ShapeType::WIRE,     static_cast<void*>(w)); }
    static Shape ofFace  (brep::Face*   f)  { return Shape(ShapeType::FACE,     f); }
    static Shape ofShell (brep::Shell*  s)  { return Shape(ShapeType::SHELL,    s); }
    static Shape ofSolid (brep::Solid*  s)  { return Shape(ShapeType::SOLID,    s); }
    static Shape ofCompound(Compound*   c)  { return Shape(ShapeType::COMPOUND, static_cast<void*>(c)); }

    // --- Type query -----------------------------------------------------------
    ShapeType type() const { return type_; }
    bool isNull() const { return type_ == ShapeType::NONE || ptr_ == nullptr; }

    bool isVertex()   const { return type_ == ShapeType::VERTEX; }
    bool isEdge()     const { return type_ == ShapeType::EDGE; }
    bool isWire()     const { return type_ == ShapeType::WIRE; }
    bool isFace()     const { return type_ == ShapeType::FACE; }
    bool isShell()    const { return type_ == ShapeType::SHELL; }
    bool isSolid()    const { return type_ == ShapeType::SOLID; }
    bool isCompound() const { return type_ == ShapeType::COMPOUND; }

    // --- SAFE downcasts: typed pointer when the tag matches, else nullptr. -----
    // (Converting the stored void* to the concrete pointer type via static_cast
    // is well-defined and needs neither RTTI nor a complete Wire/Compound type
    // at this point — the tag guarantees the stored address really is that type.)
    brep::Vertex* asVertex()   const { return type_ == ShapeType::VERTEX   ? static_cast<brep::Vertex*>(ptr_) : nullptr; }
    brep::Edge*   asEdge()     const { return type_ == ShapeType::EDGE     ? static_cast<brep::Edge*>(ptr_)   : nullptr; }
    Wire*         asWire()     const { return type_ == ShapeType::WIRE     ? static_cast<Wire*>(ptr_)         : nullptr; }
    brep::Face*   asFace()     const { return type_ == ShapeType::FACE     ? static_cast<brep::Face*>(ptr_)   : nullptr; }
    brep::Shell*  asShell()    const { return type_ == ShapeType::SHELL    ? static_cast<brep::Shell*>(ptr_)  : nullptr; }
    brep::Solid*  asSolid()    const { return type_ == ShapeType::SOLID    ? static_cast<brep::Solid*>(ptr_)  : nullptr; }
    Compound*     asCompound() const { return type_ == ShapeType::COMPOUND ? static_cast<Compound*>(ptr_)     : nullptr; }

    // --- Identity (TopoDS_Shape::IsSame analogue) -----------------------------
    // The type-erased address; the identity key together with the tag.
    const void* raw() const { return ptr_; }

    bool isSame(const Shape& o) const { return type_ == o.type_ && ptr_ == o.ptr_; }
    bool operator==(const Shape& o) const { return isSame(o); }
    bool operator!=(const Shape& o) const { return !isSame(o); }

private:
    Shape(ShapeType t, void* p) : type_(t), ptr_(p) {}

    ShapeType type_ = ShapeType::NONE;
    void*     ptr_  = nullptr;
};

} // namespace shape
} // namespace native
} // namespace forge

// std::hash<Shape> — so a Shape can key an unordered_map/set (the de-duplicating
// traversal maps in Explore.hpp rely on this). Mixes the address and the tag.
namespace std {
template <>
struct hash<forge::native::shape::Shape> {
    std::size_t operator()(const forge::native::shape::Shape& s) const noexcept {
        const std::size_t h1 = std::hash<const void*>{}(s.raw());
        const std::size_t h2 = static_cast<std::size_t>(s.type());
        return h1 ^ (h2 * static_cast<std::size_t>(0x9E3779B97F4A7C15ull));
    }
};
} // namespace std

#endif // FORGE_NATIVE_SHAPE_SHAPE_HPP
