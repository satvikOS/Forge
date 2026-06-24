// forge/native/brep/Topology.cpp
//
// Implementation of the in-house B-rep topology (Topology.hpp).
// Pure C++20, no external dependencies. See header for honesty / scope.

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"  // complete type for the owned unique_ptr<Surface>

#include <cassert>

namespace forge {
namespace native {
namespace brep {

// Out-of-line destructor: here Surface is a complete type, so the unique_ptr
// deleter in surfaces_ is well-formed (the header only forward-declares it).
TopologyBuilder::~TopologyBuilder() = default;

Surface* TopologyBuilder::makeSurface() {
    auto s = std::make_unique<Surface>();
    Surface* raw = s.get();
    surfaces_.push_back(std::move(s));
    return raw;
}

// K0 (additive): Curve / PCurve geometry factories.
Curve* TopologyBuilder::makeCurve(const Curve& c) {
    auto p = std::make_unique<Curve>(c);
    Curve* raw = p.get();
    curves_.push_back(std::move(p));
    return raw;
}

PCurve* TopologyBuilder::makePcurve(const PCurve& pc) {
    auto p = std::make_unique<PCurve>(pc);
    PCurve* raw = p.get();
    pcurves_.push_back(std::move(p));
    return raw;
}

// ---------------------------------------------------------------------------
// Element factories
// ---------------------------------------------------------------------------
Vertex* TopologyBuilder::makeVertex(const Point3& p) {
    auto v = std::make_unique<Vertex>();
    v->id = nextId_++;
    v->point = p;
    Vertex* raw = v.get();
    vertices_.push_back(std::move(v));
    return raw;
}

Edge* TopologyBuilder::makeEdge(Vertex* start, Vertex* end) {
    auto e = std::make_unique<Edge>();
    e->id = nextId_++;
    e->start = start;
    e->end = end;
    Edge* raw = e.get();
    edges_.push_back(std::move(e));
    return raw;
}

Coedge* TopologyBuilder::makeCoedge(Edge* e, bool forward) {
    auto c = std::make_unique<Coedge>();
    c->id = nextId_++;
    c->edge = e;
    c->forward = forward;
    Coedge* raw = c.get();
    // Attach to the edge's coedge slots and wire the mate link.
    if (e->coedgeA == nullptr) {
        e->coedgeA = raw;
    } else if (e->coedgeB == nullptr) {
        e->coedgeB = raw;
        // Mate the two uses of this edge.
        e->coedgeA->mate = raw;
        raw->mate = e->coedgeA;
    } else {
        // A third use of an edge would make the model non-manifold; this
        // increment does not support that. Fail loudly rather than fake it.
        assert(false && "edge already has two coedges (non-manifold use)");
    }
    coedges_.push_back(std::move(c));
    return raw;
}

Loop* TopologyBuilder::makeLoop() {
    auto l = std::make_unique<Loop>();
    l->id = nextId_++;
    Loop* raw = l.get();
    loops_.push_back(std::move(l));
    return raw;
}

Face* TopologyBuilder::makeFace() {
    auto f = std::make_unique<Face>();
    f->id = nextId_++;
    Face* raw = f.get();
    faces_.push_back(std::move(f));
    return raw;
}

Shell* TopologyBuilder::makeShell() {
    auto s = std::make_unique<Shell>();
    s->id = nextId_++;
    Shell* raw = s.get();
    shells_.push_back(std::move(s));
    return raw;
}

Solid* TopologyBuilder::makeSolid() {
    auto s = std::make_unique<Solid>();
    s->id = nextId_++;
    Solid* raw = s.get();
    solids_.push_back(std::move(s));
    return raw;
}

// ---------------------------------------------------------------------------
// findEdge — locate an existing edge between two vertices (either direction).
// ---------------------------------------------------------------------------
Edge* TopologyBuilder::findEdge(Vertex* a, Vertex* b) const {
    for (const auto& e : edges_) {
        if ((e->start == a && e->end == b) ||
            (e->start == b && e->end == a)) {
            return e.get();
        }
    }
    return nullptr;
}

// ---------------------------------------------------------------------------
// MEV — Make Edge & Vertex. Spawns a new vertex from an existing one and an
// edge joining them. A genuine basic Euler operator (it raises V by 1 and E
// by 1, leaving V-E+F invariant, as Euler operators must).
// ---------------------------------------------------------------------------
Edge* TopologyBuilder::mev(Vertex* from, const Point3& newPos,
                           Vertex** newVertexOut) {
    Vertex* nv = makeVertex(newPos);
    Edge* e = makeEdge(from, nv);
    if (newVertexOut) *newVertexOut = nv;
    return e;
}

// ---------------------------------------------------------------------------
// buildCoedgeRing — shared assembly of a closed coedge ring over an ordered
// vertex loop, sharing edges with previously built faces (first use orients the
// edge a->b; a reuse mates the second coedge). Wires next/prev and points every
// coedge at `loop`. Used by both addOuterLoopToFace and addInnerLoopToFace so
// the inner-loop path is structurally identical to the (validated) outer path.
// ---------------------------------------------------------------------------
void TopologyBuilder::buildCoedgeRing(Loop* loop,
                                      const std::vector<Vertex*>& ring) {
    const std::size_t n = ring.size();
    std::vector<Coedge*> ces;
    ces.reserve(n);

    for (std::size_t i = 0; i < n; ++i) {
        Vertex* a = ring[i];
        Vertex* b = ring[(i + 1) % n];

        Edge* e = findEdge(a, b);
        bool forward;
        if (e == nullptr) {
            // First use of this edge: orient it a->b, this coedge is forward.
            e = makeEdge(a, b);
            forward = true;
        } else {
            // Shared edge: this coedge runs a->b; whether that is the edge's
            // forward sense depends on how the edge was originally oriented.
            forward = (e->start == a && e->end == b);
        }
        Coedge* ce = makeCoedge(e, forward);
        ce->loop = loop;
        ces.push_back(ce);
    }

    // Link the ring (next / prev).
    for (std::size_t i = 0; i < n; ++i) {
        ces[i]->next = ces[(i + 1) % n];
        ces[i]->prev = ces[(i + n - 1) % n];
    }
    loop->first = ces.empty() ? nullptr : ces[0];
    loop->coedgeCount = n;
}

// ---------------------------------------------------------------------------
// addOuterLoopToFace — assemble the face's single OUTER coedge ring.
// ---------------------------------------------------------------------------
Loop* TopologyBuilder::addOuterLoopToFace(Face* face,
                                          const std::vector<Vertex*>& ring) {
    assert(ring.size() >= 3 && "a face outer loop needs at least 3 vertices");

    Loop* loop = makeLoop();
    loop->face = face;
    loop->isOuter = true;
    face->outerLoop = loop;

    buildCoedgeRing(loop, ring);
    return loop;
}

// ---------------------------------------------------------------------------
// addInnerLoopToFace — assemble an INNER (hole) coedge ring and append it to the
// face's innerLoops. Structurally identical to the outer path; the only
// differences are isOuter = false and that the loop is appended (not assigned as
// outerLoop). The caller orients the ring opposite to the outer loop.
// ---------------------------------------------------------------------------
Loop* TopologyBuilder::addInnerLoopToFace(Face* face,
                                          const std::vector<Vertex*>& ring) {
    assert(ring.size() >= 3 && "a face inner loop needs at least 3 vertices");

    Loop* loop = makeLoop();
    loop->face = face;
    loop->isOuter = false;
    face->innerLoops.push_back(loop);

    buildCoedgeRing(loop, ring);
    return loop;
}

void TopologyBuilder::addFaceToShell(Shell* shell, Face* face) {
    face->shell = shell;
    shell->faces.push_back(face);
}

void TopologyBuilder::addShellToSolid(Solid* solid, Shell* shell) {
    shell->solid = solid;
    solid->shells.push_back(shell);
}

// ---------------------------------------------------------------------------
// buildBox — closed axis-aligned box solid.
//
// Vertex layout (a = min, b = max):
//   0:(ax,ay,az) 1:(bx,ay,az) 2:(bx,by,az) 3:(ax,by,az)   -- z = az (bottom)
//   4:(ax,ay,bz) 5:(bx,ay,bz) 6:(bx,by,bz) 7:(ax,by,bz)   -- z = bz (top)
//
// Each face's vertex ring is listed counter-clockwise as seen from OUTSIDE the
// box, so the outward normal follows the right-hand rule. Shared edges are
// reused so every edge ends up with exactly two opposite-sense coedges.
// ---------------------------------------------------------------------------
Solid* TopologyBuilder::buildBox(const Point3& mn, const Point3& mx) {
    Vertex* v[8];
    v[0] = makeVertex({mn.x, mn.y, mn.z});
    v[1] = makeVertex({mx.x, mn.y, mn.z});
    v[2] = makeVertex({mx.x, mx.y, mn.z});
    v[3] = makeVertex({mn.x, mx.y, mn.z});
    v[4] = makeVertex({mn.x, mn.y, mx.z});
    v[5] = makeVertex({mx.x, mn.y, mx.z});
    v[6] = makeVertex({mx.x, mx.y, mx.z});
    v[7] = makeVertex({mn.x, mx.y, mx.z});

    Solid* solid = makeSolid();
    Shell* shell = makeShell();
    addShellToSolid(solid, shell);

    // Six faces, each CCW from outside.
    //  bottom (z=min, normal -Z): seen from below, CCW is 0,3,2,1
    //  top    (z=max, normal +Z): seen from above, CCW is 4,5,6,7
    //  front  (y=min, normal -Y): seen from -Y, CCW is 0,1,5,4
    //  back   (y=max, normal +Y): seen from +Y, CCW is 2,3,7,6
    //  left   (x=min, normal -X): seen from -X, CCW is 0,4,7,3
    //  right  (x=max, normal +X): seen from +X, CCW is 1,2,6,5
    const int faceRings[6][4] = {
        {0, 3, 2, 1}, // bottom
        {4, 5, 6, 7}, // top
        {0, 1, 5, 4}, // front
        {2, 3, 7, 6}, // back
        {0, 4, 7, 3}, // left
        {1, 2, 6, 5}, // right
    };

    for (const auto& fr : faceRings) {
        Face* f = makeFace();
        addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {v[fr[0]], v[fr[1]], v[fr[2]], v[fr[3]]};
        addOuterLoopToFace(f, ring);
    }

    return solid;
}

// ---------------------------------------------------------------------------
// counts
// ---------------------------------------------------------------------------
EulerCounts TopologyBuilder::counts() const {
    EulerCounts c;
    c.vertices = vertices_.size();
    c.edges    = edges_.size();
    c.faces    = faces_.size();
    c.loops    = loops_.size();
    c.shells   = shells_.size();
    // K0 (additive): count INNER (hole) loops so the general Euler-Poincare
    // re-derivation (V-E+F-R-2(S-G)=0) has its ring term R. A loop is inner iff
    // isOuter==false; every pre-K0 single-loop face stays isOuter==true, so this
    // reports 0 for the box and the classic gate is unchanged.
    std::size_t inner = 0;
    for (const auto& l : loops_) {
        if (!l->isOuter) ++inner;
    }
    c.innerLoops = inner;
    return c;
}

// ---------------------------------------------------------------------------
// isClosedTwoManifold — structural validity beyond the bare V-E+F count.
// ---------------------------------------------------------------------------
bool TopologyBuilder::isClosedTwoManifold() const {
    // 1. Every edge has exactly two coedges, mutually mated with opposite sense.
    for (const auto& e : edges_) {
        if (e->coedgeA == nullptr || e->coedgeB == nullptr) return false;
        if (e->coedgeA->mate != e->coedgeB) return false;
        if (e->coedgeB->mate != e->coedgeA) return false;
        if (e->coedgeA->forward == e->coedgeB->forward) return false;
    }
    // 2. Every coedge belongs to a loop and walks origin->dest consistently
    //    with the next coedge (the destination of one is the origin of next).
    for (const auto& c : coedges_) {
        if (c->loop == nullptr) return false;
        if (c->next == nullptr || c->prev == nullptr) return false;
        if (c->next->prev != c.get()) return false;
        if (c->prev->next != c.get()) return false;
        if (c->destVertex() != c->next->originVertex()) return false;
        if (c->mate == nullptr) return false;
    }
    // 3. Every loop closes: walking `next` from `first` returns to `first`
    //    after exactly coedgeCount steps, and every visited coedge points back
    //    at this loop.
    for (const auto& l : loops_) {
        if (l->first == nullptr || l->coedgeCount == 0) return false;
        Coedge* c = l->first;
        for (std::size_t i = 0; i < l->coedgeCount; ++i) {
            if (c == nullptr) return false;
            if (c->loop != l.get()) return false;
            c = c->next;
        }
        if (c != l->first) return false; // must return to start
    }
    return true;
}

} // namespace brep
} // namespace native
} // namespace forge
