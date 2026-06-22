// forge/native/brep/Topology.hpp
//
// In-house B-rep TOPOLOGY data structure for the Forge native kernel
// (Stage 6 of KERNEL_INHOUSE_ROADMAP.md — the OCCT replacement, longest pole).
//
// ============================ HONESTY (Bible §0/§9) ========================
// This is the FIRST increment of a multi-year, Parasolid/ACIS/OCCT-class
// program. What is REAL and VALIDATED in this file:
//
//   * A boundary-representation topology graph:
//       Vertex, Edge, Coedge(HalfEdge), Loop, Face, Shell, Solid.
//   * The basic Euler operators (MEV/MEF style mutators) used to assemble a
//     valid, orientable, closed 2-manifold shell from nothing.
//   * A builder that constructs a closed box Solid and reports its
//       V (vertices), E (edges), F (faces), L (loops), Sh (shells)
//     counts so the Euler-Poincaré characteristic V - E + F = 2 - 2*genus
//     can be checked by the gate test.
//
// What is explicitly TARGETED (NOT built here, do not claim it works):
//   * No geometry is attached to the topology yet (no curves on edges /
//     surfaces on faces) — that binding to brep/Nurbs is a later increment.
//   * No general Euler operator completeness (KEV/KEF/MEKR/KEMR/MZEV ...),
//     no non-manifold support, no genus>0 handle operators, no validation
//     beyond the closed-2-manifold box gate.
//   * No booleans / sewing / healing / feature ops (fillet/chamfer/offset).
//   * No persistent-ID minting via the existing LineageRegistry yet.
//
// CONVENTIONS: namespace forge::native (shared in-house kernel). Pure C++20,
// zero external dependencies, standard library only. No OCCT, no WASM.
//
// TOPOLOGY MODEL (radial-edge-lite / winged half-edge):
//   - A Coedge (a.k.a. HalfEdge) is one oriented use of an Edge by a Loop.
//     Every Edge in a closed 2-manifold solid is shared by exactly two
//     Coedges, one from each adjacent Face, traversed in opposite directions.
//   - A Loop is a closed ring of Coedges bounding one side of a Face.
//   - A Face has one outer Loop (this increment: faces are simple quads/tris
//     with a single loop — no inner holes yet).
//   - A Shell is a connected, closed set of Faces; a Solid owns one outer Shell.
//
// The graph owns its elements (std::vector of unique_ptr); raw pointers are
// used for the adjacency cross-links (non-owning).

#ifndef FORGE_NATIVE_BREP_TOPOLOGY_HPP
#define FORGE_NATIVE_BREP_TOPOLOGY_HPP

#include <array>
#include <cstdint>
#include <memory>
#include <vector>

// The analytic surface geometry a Face may optionally carry (Surface.hpp). It is
// included fully (not just forward-declared) because TopologyBuilder owns
// std::unique_ptr<Surface>, whose vector destructor needs the complete type in
// every TU that instantiates a builder. Surface.hpp does NOT include Topology.hpp
// (it only depends on brep/Nurbs.hpp), so there is no include cycle. This is
// additive: a Face's surface defaults to null, so the bare-topology box gate is
// unaffected (Bible §0/§9).
#include "forge/native/brep/Surface.hpp"

namespace forge {
namespace native {
namespace brep {

// A 3D point in model space (geometry-light: a vertex just carries a position).
struct Point3 {
    double x = 0.0, y = 0.0, z = 0.0;
};

struct Vertex;
struct Edge;
struct Coedge;
struct Loop;
struct Face;
struct Shell;
struct Solid;

// ----------------------------------------------------------------------------
// Vertex — a 0-dimensional topological element with a geometric position.
// ----------------------------------------------------------------------------
struct Vertex {
    std::uint32_t id = 0;
    Point3 point;
};

// ----------------------------------------------------------------------------
// Edge — a 1-dimensional element bounded by two vertices (start, end).
// In a closed 2-manifold solid it is referenced by exactly two Coedges.
// ----------------------------------------------------------------------------
struct Edge {
    std::uint32_t id = 0;
    Vertex* start = nullptr;
    Vertex* end   = nullptr;
    // The (up to) two oriented uses of this edge. For a closed manifold both
    // slots are filled with opposite-sense coedges.
    Coedge* coedgeA = nullptr;
    Coedge* coedgeB = nullptr;
};

// ----------------------------------------------------------------------------
// Coedge / HalfEdge — one oriented use of an Edge by a Loop.
//   `forward == true`  : this coedge runs edge->start -> edge->end
//   `forward == false` : this coedge runs edge->end   -> edge->start
// `mate` is the opposite-sense coedge on the same edge (the other face's use).
// `next`/`prev` walk the bounding Loop.
// ----------------------------------------------------------------------------
struct Coedge {
    std::uint32_t id = 0;
    Edge* edge    = nullptr;
    bool  forward = true;
    Loop* loop    = nullptr;
    Coedge* next  = nullptr; // next coedge around the loop
    Coedge* prev  = nullptr; // previous coedge around the loop
    Coedge* mate  = nullptr; // opposite-sense coedge on the same edge

    Vertex* originVertex() const {
        return forward ? edge->start : edge->end;
    }
    Vertex* destVertex() const {
        return forward ? edge->end : edge->start;
    }
};

// ----------------------------------------------------------------------------
// Loop — a closed ring of coedges bounding one side of a face.
// `first` is any coedge in the ring; follow `next` to traverse.
// ----------------------------------------------------------------------------
struct Loop {
    std::uint32_t id = 0;
    Face* face = nullptr;
    Coedge* first = nullptr;
    std::size_t coedgeCount = 0;
};

// ----------------------------------------------------------------------------
// Face — a 2-dimensional element bounded by exactly one outer loop in this
// increment (no inner hole loops yet — that is a later increment / TARGETED).
// ----------------------------------------------------------------------------
struct Face {
    std::uint32_t id = 0;
    Shell* shell = nullptr;
    Loop* outerLoop = nullptr;

    // OPTIONAL analytic geometry (Surface.hpp). Null when the face is bare
    // topology (the original box gate). When present, `surface` is owned by the
    // builder and (u0,u1)x(v0,v1) is the parameter-rectangle trim window over
    // which the face's surface is integrated / tessellated. `vertexUV` carries
    // the (u,v) parameter of each outer-loop vertex in ring order (so a planar
    // polygon face knows its own corner parameters); empty for non-planar
    // analytic faces that use the full rectangle.
    Surface* surface = nullptr;
    double u0 = 0.0, u1 = 1.0, v0 = 0.0, v1 = 1.0;
    std::vector<std::array<double, 2>> vertexUV;
};

// ----------------------------------------------------------------------------
// Shell — a connected, oriented, (for this increment) closed set of faces.
// ----------------------------------------------------------------------------
struct Shell {
    std::uint32_t id = 0;
    Solid* solid = nullptr;
    std::vector<Face*> faces;
};

// ----------------------------------------------------------------------------
// Solid — owns one outer shell (no voids/inner shells yet — TARGETED).
// ----------------------------------------------------------------------------
struct Solid {
    std::uint32_t id = 0;
    std::vector<Shell*> shells; // outer shell first
};

// ----------------------------------------------------------------------------
// Counts of the topological elements, for the Euler-Poincaré gate.
//   Euler-Poincaré for a B-rep solid:
//       V - E + F - (L - F) - 2*(S - G) = 0
//   where V,E,F,L are vertex/edge/face/loop counts, S = shell count,
//   G = genus, and (L - F) counts inner loops (rings). For a simple solid
//   with one loop per face (no inner rings) and one shell, this reduces to the
//   familiar polyhedral formula:  V - E + F = 2 - 2*genus  =  2  for genus 0.
// ----------------------------------------------------------------------------
struct EulerCounts {
    std::size_t vertices = 0;
    std::size_t edges    = 0;
    std::size_t faces    = 0;
    std::size_t loops    = 0;
    std::size_t shells   = 0;

    // V - E + F for the classic (single-loop-per-face) characteristic.
    long long characteristic() const {
        return static_cast<long long>(vertices)
             - static_cast<long long>(edges)
             + static_cast<long long>(faces);
    }
};

// ----------------------------------------------------------------------------
// TopologyBuilder — owns all topological elements and provides the basic
// Euler operators plus the box builder. The owned-element vectors give the
// element lifetimes; raw pointers above are non-owning adjacency links.
// ----------------------------------------------------------------------------
class TopologyBuilder {
public:
    TopologyBuilder() = default;

    // --- Element factories (Euler-operator primitives) ---------------------
    Vertex* makeVertex(const Point3& p);
    Edge*   makeEdge(Vertex* start, Vertex* end);
    Coedge* makeCoedge(Edge* e, bool forward);
    Loop*   makeLoop();
    Face*   makeFace();
    Shell*  makeShell();
    Solid*  makeSolid();

    // Allocate a Surface owned by this builder (default-constructed; the caller
    // fills in the kind/frame/radii). Returns a stable raw pointer.
    Surface* makeSurface();

    // --- Basic Euler operators (the documented "basic" set) ----------------
    //
    // MEV  (Make Edge & Vertex): from an existing vertex, create a new vertex
    //      and an edge joining them. Returns the new edge (and the new vertex
    //      via out-param).
    Edge* mev(Vertex* from, const Point3& newPos, Vertex** newVertexOut);

    // MEKL-free MEF (Make Edge & Face): connect two existing vertices that lie
    //      on a common loop with a new edge, splitting that loop's bounded
    //      region into a new face. (Provided for completeness of the basic
    //      set; the box builder below assembles faces directly via makeFace +
    //      addLoopToFace, which is the validated path in this increment.)
    //      TARGETED: a fully general MEF over an arbitrary loop is a later
    //      increment; this entry point currently asserts on misuse rather than
    //      faking a result.
    //
    // Assemble a closed loop of coedges over an ordered vertex ring and attach
    // it to a face as that face's outer loop. The vertices are given in
    // counter-clockwise order as seen from outside the solid (so the face
    // normal points outward by the right-hand rule). Edges are created on
    // demand and SHARED: if an edge between two vertices already exists it is
    // reused and the second coedge becomes the mate.
    Loop* addOuterLoopToFace(Face* face,
                             const std::vector<Vertex*>& ring);

    // Insert a fully-built face into a shell.
    void addFaceToShell(Shell* shell, Face* face);
    // Insert a shell into a solid.
    void addShellToSolid(Solid* solid, Shell* shell);

    // --- The box builder ---------------------------------------------------
    //
    // Build an axis-aligned closed box Solid spanning [min, max]. All six
    // quad faces are oriented with outward normals; every edge is shared by
    // exactly two faces with opposite-sense coedges (closed 2-manifold).
    Solid* buildBox(const Point3& min, const Point3& max);

    // --- Counts / validation ----------------------------------------------
    EulerCounts counts() const;

    // Verify the closed-2-manifold invariants actually achieved by the graph:
    //   * every edge is used by exactly two coedges (mated, opposite sense),
    //   * every coedge has a mate, next, prev consistent with its loop,
    //   * every loop closes (next-ring returns to first with the right count).
    // Returns true iff all hold. (This is the structural truth the gate needs
    // beyond the bare V-E+F arithmetic.)
    bool isClosedTwoManifold() const;

    // Accessors for tests.
    std::size_t vertexCount() const { return vertices_.size(); }
    std::size_t edgeCount()   const { return edges_.size(); }
    std::size_t faceCount()   const { return faces_.size(); }
    std::size_t loopCount()   const { return loops_.size(); }
    std::size_t coedgeCount() const { return coedges_.size(); }
    std::size_t shellCount()  const { return shells_.size(); }

private:
    // Find an existing edge between two vertices (either orientation), or null.
    Edge* findEdge(Vertex* a, Vertex* b) const;

    std::uint32_t nextId_ = 1;

    std::vector<std::unique_ptr<Vertex>> vertices_;
    std::vector<std::unique_ptr<Edge>>   edges_;
    std::vector<std::unique_ptr<Coedge>> coedges_;
    std::vector<std::unique_ptr<Loop>>   loops_;
    std::vector<std::unique_ptr<Face>>   faces_;
    std::vector<std::unique_ptr<Shell>>  shells_;
    std::vector<std::unique_ptr<Solid>>  solids_;
    // Surface geometry owned by this builder (unique_ptr so a forward-declared
    // Surface needs the deleter only in the .cpp, where Surface.hpp is included).
    std::vector<std::unique_ptr<Surface>> surfaces_;

public:
    // The builder owns Surface unique_ptrs of an incomplete type at the point of
    // declaration; the destructor must see the full type — defined out-of-line
    // in Topology.cpp (which includes Surface.hpp).
    TopologyBuilder(const TopologyBuilder&) = delete;
    TopologyBuilder& operator=(const TopologyBuilder&) = delete;
    ~TopologyBuilder();
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_TOPOLOGY_HPP
