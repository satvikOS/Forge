// forge/native/shape/Explore.cpp — traversal facade (see Explore.hpp).
//
// All traversal walks the EXISTING native adjacency in brep/Topology.hpp:
//   Solid::shells -> Shell::faces -> Face::outerLoop/innerLoops
//   -> Loop::first + Coedge::next ring (Loop::coedgeCount steps)
//   -> Coedge::edge -> Edge::start / Edge::end.
// De-duplication of shared sub-shapes (an edge on two faces, a vertex on three
// edges) is done by Shape identity via ShapeMap.

#include "forge/native/shape/Explore.hpp"

namespace forge {
namespace native {
namespace shape {

// ============================================================================
// ShapeMap
// ============================================================================
std::size_t ShapeMap::add(const Shape& s) {
    auto it = index_.find(s);
    if (it != index_.end()) return it->second;
    const std::size_t idx = items_.size();
    items_.push_back(s);
    index_.emplace(s, idx);
    return idx;
}

bool ShapeMap::contains(const Shape& s) const {
    return index_.find(s) != index_.end();
}

std::size_t ShapeMap::indexOf(const Shape& s) const {
    auto it = index_.find(s);
    return it == index_.end() ? npos : it->second;
}

// ============================================================================
// Loop -> free Wire synthesis (used for FACE/SOLID -> WIRE exploration).
// The wire follows the loop's coedge ring in traversal order; each WireEdge takes
// the coedge's own orientation so the wire's origin/dest match the coedge walk.
// ============================================================================
static Wire wireFromLoop(const brep::Loop* lp) {
    std::vector<WireEdge> oriented;
    if (lp != nullptr && lp->first != nullptr) {
        const brep::Coedge* ce = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount && ce != nullptr; ++i) {
            oriented.push_back(WireEdge{ce->edge, ce->forward});
            ce = ce->next;
        }
    }
    return Wire::fromOrientedEdges(oriented);
}

// ============================================================================
// Explorer
// ============================================================================
Explorer::Explorer(const Shape& shape, ShapeType toFind) {
    ShapeMap out;
    collect(shape, toFind, out);
    found_ = out.items();
}

void Explorer::collect(const Shape& s, ShapeType want, ShapeMap& out) {
    if (s.isNull()) return;

    // The shape itself matches the wanted type -> it is its own (only) sub-shape.
    if (s.type() == want) {
        out.add(s);
        return;
    }

    switch (s.type()) {
        case ShapeType::COMPOUND: {
            const Compound* c = s.asCompound();
            if (c != nullptr) {
                for (const Shape& child : c->children()) collect(child, want, out);
            }
            break;
        }
        case ShapeType::SOLID: {
            const brep::Solid* sol = s.asSolid();
            if (sol != nullptr) {
                for (brep::Shell* sh : sol->shells) collect(Shape::ofShell(sh), want, out);
            }
            break;
        }
        case ShapeType::SHELL: {
            const brep::Shell* sh = s.asShell();
            if (sh != nullptr) {
                for (brep::Face* f : sh->faces) collect(Shape::ofFace(f), want, out);
            }
            break;
        }
        case ShapeType::FACE: {
            brep::Face* f = s.asFace();
            if (f == nullptr) break;
            if (want == ShapeType::WIRE) {
                // Synthesise a free Wire per bounding loop (outer first, then holes).
                // The Explorer owns the storage so the handles stay valid.
                if (f->outerLoop != nullptr) {
                    wireStore_.push_back(wireFromLoop(f->outerLoop));
                    out.add(Shape::ofWire(&wireStore_.back()));
                }
                for (brep::Loop* il : f->innerLoops) {
                    wireStore_.push_back(wireFromLoop(il));
                    out.add(Shape::ofWire(&wireStore_.back()));
                }
            } else {
                // Descend the loops' coedge rings to reach edges/vertices.
                auto walkLoop = [&](const brep::Loop* lp) {
                    if (lp == nullptr || lp->first == nullptr) return;
                    const brep::Coedge* ce = lp->first;
                    for (std::size_t i = 0; i < lp->coedgeCount && ce != nullptr; ++i) {
                        if (ce->edge != nullptr) collect(Shape::ofEdge(ce->edge), want, out);
                        ce = ce->next;
                    }
                };
                walkLoop(f->outerLoop);
                for (brep::Loop* il : f->innerLoops) walkLoop(il);
            }
            break;
        }
        case ShapeType::WIRE: {
            const Wire* w = s.asWire();
            if (w != nullptr) {
                for (const WireEdge& we : w->edges()) {
                    if (we.edge != nullptr) collect(Shape::ofEdge(we.edge), want, out);
                }
            }
            break;
        }
        case ShapeType::EDGE: {
            const brep::Edge* e = s.asEdge();
            if (e != nullptr && want == ShapeType::VERTEX) {
                if (e->start != nullptr) out.add(Shape::ofVertex(e->start));
                if (e->end   != nullptr) out.add(Shape::ofVertex(e->end));
            }
            break;
        }
        case ShapeType::VERTEX:
        case ShapeType::NONE:
        default:
            break;
    }
}

// ============================================================================
// Ancestry
// ============================================================================
Ancestry::Ancestry(const Shape& root, ShapeType childType, ShapeType parentType)
    : parentExplorer_(root, parentType) {
    // For every parent sub-shape, enumerate its children of childType and record
    // parent as an ancestor of each such child (de-duplicated both ways).
    for (const Shape& parent : parentExplorer_.all()) {
        childExplorers_.emplace_back(parent, childType);
        const Explorer& cex = childExplorers_.back();
        for (const Shape& child : cex.all()) {
            const std::size_t ci = children_.add(child);
            if (ci >= parents_.size()) parents_.resize(ci + 1);
            std::vector<Shape>& list = parents_[ci];
            bool present = false;
            for (const Shape& p : list) {
                if (p.isSame(parent)) { present = true; break; }
            }
            if (!present) list.push_back(parent);
        }
    }
}

const std::vector<Shape>& Ancestry::ancestors(const Shape& child) const {
    const std::size_t ci = children_.indexOf(child);
    if (ci == ShapeMap::npos) return empty_;
    return parents_[ci];
}

} // namespace shape
} // namespace native
} // namespace forge
