// forge/native/shape/Wire.cpp — free-standing Wire (see Wire.hpp).

#include "forge/native/shape/Wire.hpp"

#include <cmath>

namespace forge {
namespace native {
namespace shape {

Wire Wire::fromEdges(const std::vector<brep::Edge*>& edges) {
    Wire w;
    for (brep::Edge* e : edges) w.addEdge(e);
    return w;
}

Wire Wire::fromOrientedEdges(const std::vector<WireEdge>& oriented) {
    Wire w;
    for (const WireEdge& oe : oriented) {
        if (oe.edge != nullptr) w.addOrientedEdge(oe.edge, oe.forward);
    }
    return w;
}

void Wire::addOrientedEdge(brep::Edge* e, bool forward) {
    if (e == nullptr) return;
    // A break in the chain is any append whose origin does not meet the running
    // tail vertex (the first edge can never break).
    if (!edges_.empty()) {
        brep::Vertex* tail = endVertex();
        brep::Vertex* origin = forward ? e->start : e->end;
        if (tail != nullptr && origin != nullptr && origin != tail) {
            contiguous_ = false;
        }
    }
    edges_.push_back(WireEdge{e, forward});
}

void Wire::addEdge(brep::Edge* e) {
    if (e == nullptr) return;
    if (edges_.empty()) {
        // First edge keeps its natural start->end sense.
        edges_.push_back(WireEdge{e, true});
        return;
    }
    // Auto-orient so this edge's origin coincides with the running tail vertex.
    brep::Vertex* tail = endVertex();
    if (tail != nullptr && e->start == tail) {
        addOrientedEdge(e, true);
    } else if (tail != nullptr && e->end == tail) {
        addOrientedEdge(e, false);
    } else {
        // No shared vertex — append in natural sense and flag the break honestly.
        addOrientedEdge(e, true);
        contiguous_ = false;
    }
}

bool Wire::isClosed() const {
    if (edges_.empty() || !contiguous_) return false;
    brep::Vertex* s = startVertex();
    brep::Vertex* e = endVertex();
    return s != nullptr && s == e;
}

std::vector<brep::Vertex*> Wire::vertices() const {
    std::vector<brep::Vertex*> out;
    if (edges_.empty()) return out;
    out.reserve(edges_.size() + 1);
    for (const WireEdge& we : edges_) out.push_back(we.origin());
    brep::Vertex* last = edges_.back().dest();
    // Omit the final dest when it closes back onto the first origin (closed wire).
    if (out.empty() || last != out.front()) out.push_back(last);
    return out;
}

double Wire::length() const {
    double total = 0.0;
    for (const WireEdge& we : edges_) {
        const brep::Edge* e = we.edge;
        if (e == nullptr) continue;

        if (e->curve != nullptr) {
            // Arc-length of the exact analytic curve by dense polyline sampling
            // over its trim [t0,t1] (orientation-independent length).
            const brep::Curve* c = e->curve;
            const int N = 128;
            brep::Vec3 prev = c->evaluate(c->t0);
            for (int i = 1; i <= N; ++i) {
                const double s = static_cast<double>(i) / static_cast<double>(N);
                const double t = c->t0 + (c->t1 - c->t0) * s;
                brep::Vec3 cur = c->evaluate(t);
                const double dx = cur.x - prev.x;
                const double dy = cur.y - prev.y;
                const double dz = cur.z - prev.z;
                total += std::sqrt(dx * dx + dy * dy + dz * dz);
                prev = cur;
            }
        } else {
            // Bare-topology edge: straight chord between its end vertices (exact
            // for line-segment sketch/section contours).
            const brep::Vertex* a = we.origin();
            const brep::Vertex* b = we.dest();
            if (a != nullptr && b != nullptr) {
                const double dx = a->point.x - b->point.x;
                const double dy = a->point.y - b->point.y;
                const double dz = a->point.z - b->point.z;
                total += std::sqrt(dx * dx + dy * dy + dz * dz);
            }
        }
    }
    return total;
}

} // namespace shape
} // namespace native
} // namespace forge
