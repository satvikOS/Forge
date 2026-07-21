// forge/native/shape/Wire.hpp
//
// FREE-STANDING WIRE for the Forge native kernel — an ordered edge sequence that
// is NOT bound to a face (sketch profiles, sweep/loft spines, section-cut
// contours). The OCCT-zero replacement for the free TopoDS_Wire (~85 uses).
//
// ============================ HONESTY (Bible §0/§9) ========================
// brep/Topology.hpp already has a `Loop`: a closed ring of coedges bounding one
// side of a Face. That is FACE-BOUND by construction (Loop::face, Loop::first is
// a Coedge that belongs to a Face's loop) and cannot represent an OPEN chain or a
// standalone profile that carries no face. `Wire` fills that gap:
//   * an ORDERED sequence of oriented Edges (native brep::Edge*, non-owning),
//   * OPEN or CLOSED (a closed wire's last edge returns to the first's origin),
//   * carries NO face — it is pure 1-D topology usable as a sketch/spine/section.
//
// Edges are auto-oriented head-to-tail by shared-vertex matching as they are
// appended, so `fromEdges({e0,e1,e2})` chains them regardless of each edge's own
// start/end sense; an explicit oriented constructor is also provided.
//
// ADDITIVE / NON-OWNING: Wire references existing brep::Edge/Vertex owned by a
// TopologyBuilder. It defines a NEW type in the forge::native::shape namespace,
// touches no production path — existing behaviour is byte-identical.
//
// CONVENTIONS: namespace forge::native::shape. Pure C++20, standard library only.

#ifndef FORGE_NATIVE_SHAPE_WIRE_HPP
#define FORGE_NATIVE_SHAPE_WIRE_HPP

#include <cstddef>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // brep::Edge / brep::Vertex / brep::Curve

namespace forge {
namespace native {
namespace shape {

// One oriented use of an Edge inside a Wire.
//   forward == true  : traverse edge->start -> edge->end
//   forward == false : traverse edge->end   -> edge->start
struct WireEdge {
    brep::Edge* edge    = nullptr;
    bool        forward = true;

    brep::Vertex* origin() const { return forward ? edge->start : edge->end;   }
    brep::Vertex* dest()   const { return forward ? edge->end   : edge->start; }
};

// ----------------------------------------------------------------------------
// Wire — a free-standing, ordered, oriented edge sequence (open or closed).
// ----------------------------------------------------------------------------
class Wire {
public:
    Wire() = default;

    // Build from an ordered edge list. Each edge after the first is auto-oriented
    // so its origin coincides with the running tail vertex (shared-vertex match);
    // the first edge keeps its natural start->end sense. If an edge shares NO
    // vertex with the tail it is appended in natural sense and the wire is flagged
    // non-contiguous (isContiguous() == false) — honest, not silently reordered.
    static Wire fromEdges(const std::vector<brep::Edge*>& edges);

    // Build from explicit oriented edges (caller supplies each edge's sense).
    static Wire fromOrientedEdges(const std::vector<WireEdge>& oriented);

    // Append one edge, auto-oriented to chain from the current tail vertex.
    void addEdge(brep::Edge* e);
    // Append one edge with an explicit sense.
    void addOrientedEdge(brep::Edge* e, bool forward);

    // --- Queries --------------------------------------------------------------
    std::size_t edgeCount() const { return edges_.size(); }
    bool        empty()     const { return edges_.empty(); }
    const std::vector<WireEdge>& edges() const { return edges_; }

    // Every edge chained head-to-tail with a shared vertex (no gaps).
    bool isContiguous() const { return contiguous_; }

    // Closed iff non-empty, contiguous, and the last edge's dest vertex is the
    // first edge's origin vertex.
    bool isClosed() const;
    bool isOpen()   const { return !isClosed(); }

    brep::Vertex* startVertex() const { return edges_.empty() ? nullptr : edges_.front().origin(); }
    brep::Vertex* endVertex()   const { return edges_.empty() ? nullptr : edges_.back().dest();    }

    // Ordered vertices along the wire: the origin of each edge, in order, plus the
    // final edge's dest UNLESS that equals the first origin (a closed contiguous
    // wire therefore returns its N distinct vertices, an open one returns N+1).
    std::vector<brep::Vertex*> vertices() const;

    // Total length. An edge carrying an analytic brep::Curve is arc-length
    // integrated (dense polyline sampling of the exact curve); a bare-topology
    // edge falls back to the straight chord between its start/end vertices — exact
    // for the polyline case (line-segment sketches / section contours).
    double length() const;

private:
    std::vector<WireEdge> edges_;
    bool contiguous_ = true;
};

} // namespace shape
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_SHAPE_WIRE_HPP
