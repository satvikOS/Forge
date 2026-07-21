// forge/native/shape/Explore.hpp
//
// TRAVERSAL FACADE for the Forge native kernel — the OCCT-zero replacement for
// TopExp_Explorer (~90 uses), TopTools_IndexedMapOfShape and
// TopExp::MapShapesAndAncestors. Walks the EXISTING native adjacency in
// brep/Topology.hpp (Shell::faces, Face::outerLoop/innerLoops, Loop coedge ring,
// Coedge::edge, Edge::start/end) — no new geometry, no new data structures on the
// entities themselves.
//
// ============================ HONESTY (Bible §0/§9) ========================
// Three facilities, mirroring the OCCT trio the migration leans on:
//
//   * ShapeMap                — TopTools_IndexedMapOfShape: an ordered,
//                               de-duplicated set of Shapes with O(1) contains /
//                               indexOf (keyed by Shape identity).
//   * Explorer(shape, type)   — TopExp_Explorer: enumerate every DISTINCT
//                               sub-shape of `type` inside `shape`, over the
//                               native adjacency. Shared sub-shapes (an edge on
//                               two faces, a vertex on three edges) appear ONCE.
//   * Ancestry(root, c, p)    — TopExp::MapShapesAndAncestors: for every distinct
//                               `c`-type sub-shape of root, the DISTINCT `p`-type
//                               sub-shapes that contain it (e.g. edge -> the 2
//                               faces meeting on it), built from the same coedge
//                               adjacency (a coedge's edge belongs to the coedge's
//                               loop's face; the edge's two coedges name its two
//                               faces).
//
// WIRE sub-shapes of a Face/Solid are SYNTHESISED from the face's loops (a Loop
// becomes a free Wire); the Explorer OWNS that synthesised storage so the Shape
// handles it returns stay valid for the Explorer's lifetime. Because those
// handles point into the Explorer, Explorer is deliberately NON-COPYABLE and
// NON-MOVABLE — hold it by name and iterate; do not copy it or return it.
//
// ADDITIVE: NEW types in namespace forge::native::shape; no production path
// touched — existing behaviour is byte-identical.

#ifndef FORGE_NATIVE_SHAPE_EXPLORE_HPP
#define FORGE_NATIVE_SHAPE_EXPLORE_HPP

#include <cstddef>
#include <deque>
#include <unordered_map>
#include <vector>

#include "forge/native/shape/Compound.hpp"
#include "forge/native/shape/Shape.hpp"
#include "forge/native/shape/Wire.hpp"

namespace forge {
namespace native {
namespace shape {

// ----------------------------------------------------------------------------
// ShapeMap — an ordered, de-duplicated set of Shapes (TopTools_IndexedMapOfShape
// analogue). Insertion order is preserved; a Shape already present is not
// re-added. Indices are 0-based (index i == the i-th distinct Shape inserted).
// ----------------------------------------------------------------------------
class ShapeMap {
public:
    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

    // Insert s if absent; return its index (existing or newly assigned).
    std::size_t add(const Shape& s);

    bool        contains(const Shape& s) const;
    std::size_t indexOf(const Shape& s) const;   // npos if absent

    const Shape& at(std::size_t i) const { return items_[i]; }
    std::size_t  size()  const { return items_.size(); }
    bool         empty() const { return items_.empty(); }
    const std::vector<Shape>& items() const { return items_; }

private:
    std::vector<Shape> items_;
    std::unordered_map<Shape, std::size_t> index_;
};

// ----------------------------------------------------------------------------
// Explorer — enumerate every distinct sub-shape of `toFind` type inside `shape`.
//
// Iterate OCCT-style with a named Explorer:
//   Explorer ex(shape, ShapeType::EDGE);
//   for (; ex.more(); ex.next()) { Shape e = ex.current(); ... }
// or eagerly over the collected vector (named Explorer, not a temporary):
//   Explorer ex(shape, ShapeType::EDGE);
//   for (const Shape& e : ex.all()) { ... }
// ----------------------------------------------------------------------------
class Explorer {
public:
    Explorer(const Shape& shape, ShapeType toFind);

    // Non-copyable, non-movable: returned Shapes may point into wireStore_.
    Explorer(const Explorer&)            = delete;
    Explorer& operator=(const Explorer&) = delete;

    // --- OCCT-style cursor ----------------------------------------------------
    bool  more() const { return cursor_ < found_.size(); }
    void  next()       { if (cursor_ < found_.size()) ++cursor_; }
    Shape current() const { return more() ? found_[cursor_] : Shape(); }
    void  reset()      { cursor_ = 0; }

    // --- Eager view -----------------------------------------------------------
    const std::vector<Shape>& all() const { return found_; }
    std::size_t count() const { return found_.size(); }

private:
    void collect(const Shape& s, ShapeType want, ShapeMap& out);

    std::vector<Shape> found_;
    std::size_t        cursor_ = 0;
    // Storage for WIRE sub-shapes synthesised from face loops. std::deque keeps
    // element addresses stable across growth, so the Shape handles that point at
    // these wires remain valid for the Explorer's whole lifetime.
    std::deque<Wire>   wireStore_;
};

// ----------------------------------------------------------------------------
// Ancestry — TopExp::MapShapesAndAncestors analogue. For every distinct
// `childType` sub-shape of `root`, the distinct `parentType` sub-shapes that
// contain it. Canonical use: Ancestry(solid, EDGE, FACE) -> each edge maps to the
// (two, for a manifold solid) faces meeting on it.
// ----------------------------------------------------------------------------
class Ancestry {
public:
    Ancestry(const Shape& root, ShapeType childType, ShapeType parentType);

    // Non-copyable, non-movable (owns Explorers whose Shapes may point into them).
    Ancestry(const Ancestry&)            = delete;
    Ancestry& operator=(const Ancestry&) = delete;

    std::size_t  childCount() const { return children_.size(); }
    const Shape& childAt(std::size_t i) const { return children_.at(i); }

    // Parents of the i-th child (by child index).
    const std::vector<Shape>& parentsOfIndex(std::size_t i) const { return parents_[i]; }

    // Parents of a specific child Shape (empty vector if the child is unknown).
    const std::vector<Shape>& ancestors(const Shape& child) const;

private:
    ShapeMap                        children_;
    std::vector<std::vector<Shape>> parents_;   // parallel to children_ indices
    std::vector<Shape>              empty_;      // returned for unknown children

    // Explorers kept alive so any synthesised-wire storage they own outlives the
    // Shapes copied out of them. parentExplorer_ enumerates the parents once;
    // childExplorers_ holds one Explorer per parent.
    Explorer            parentExplorer_;
    std::deque<Explorer> childExplorers_;
};

} // namespace shape
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_SHAPE_EXPLORE_HPP
