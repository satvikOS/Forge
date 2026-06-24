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

// K0 FOUNDATION (additive): the tagged 3D Curve a tolerant Edge follows, and the
// 2D PCurve a Coedge follows in its Face's surface parameter plane. Included
// fully (not forward-declared) because the builder owns std::unique_ptr<Curve>
// and std::unique_ptr<PCurve>, whose vector destructors need the complete type
// in every TU that instantiates a builder. Curve.hpp depends only on
// brep/Nurbs.hpp (no cycle through Topology.hpp). Every Edge/Coedge defaults its
// geometry pointer to null, so the original bare-topology box gate is unaffected
// (Bible §0/§9).
#include "forge/native/brep/Curve.hpp"

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

    // K0 TOLERANT-ENTITY semantics (additive): the vertex's true position is
    // `point` within +/- `tolerance` model-space units. A coincidence test
    // between two tolerant vertices passes when |p_a - p_b| <= tol_a + tol_b.
    // Default 0 == an EXACT vertex, so the existing exact box gate is unchanged.
    double tolerance = 0.0;
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

    // K0 GEOMETRY (additive): the EXACT 3D curve this edge follows, parameterised
    // start->end over its own [t0,t1] trim. Owned by the builder; null when the
    // edge is bare topology (the original box gate). When present, the edge runs
    // from curve.evaluate(t0) at `start` to curve.evaluate(t1) at `end`.
    Curve* curve = nullptr;

    // K0 TOLERANT-ENTITY semantics (additive): the edge's true curve lies within
    // +/- `tolerance` of `curve`. Default 0 == an EXACT edge.
    double tolerance = 0.0;
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

    // K0 GEOMETRY (additive): the 2D PARAMETER-SPACE curve this coedge follows in
    // its Face's surface (u,v) plane. Owned by the builder; null when no surface
    // is attached. Parameterised in the COEDGE's traversal sense (origin->dest),
    // so composing P(t) with the Face's Surface S(u,v) reproduces the 3D edge
    // curve walked in this coedge's direction (the K0 consistency invariant).
    PCurve* pcurve = nullptr;

    // K0 TOLERANT-ENTITY semantics (additive): the coedge's true 2D curve lies
    // within +/- `tolerance` (parameter-space units) of `pcurve`. Default 0.
    double tolerance = 0.0;

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

    // K0 (additive): true for a Face's single outer (peripheral) loop, false for
    // an inner (hole) loop. Lets the validity re-derivation count rings without
    // re-scanning Face::innerLoops. Defaults true so existing single-loop faces
    // (every box face) are reported as outer, unchanged.
    bool isOuter = true;
};

// ----------------------------------------------------------------------------
// Face — a 2-dimensional element bounded by exactly one outer loop in this
// increment (no inner hole loops yet — that is a later increment / TARGETED).
// ----------------------------------------------------------------------------
struct Face {
    std::uint32_t id = 0;
    Shell* shell = nullptr;
    Loop* outerLoop = nullptr;

    // K0 INNER/HOLE LOOPS (additive): a face may now carry zero or more inner
    // (hole) loops in addition to its single outer loop. Each inner loop is a
    // closed coedge ring bounding a hole cut out of the face; its coedges are
    // oriented OPPOSITE to the outer loop (clockwise when the outer is CCW as
    // seen along the surface normal) so the material side is consistently on the
    // left of every coedge. Empty by default, so every existing single-loop face
    // (the box gate) is unchanged. The general loop set of the face is
    // {outerLoop} U innerLoops.
    std::vector<Loop*> innerLoops;

    // Total bounding-loop count of this face = 1 (outer, if set) + inner count.
    std::size_t loopCount() const {
        return (outerLoop ? 1u : 0u) + innerLoops.size();
    }

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

    // ADDITIVE (native boolean STEP 2): when true, this face's CURVED analytic
    // surface is integrated/tessellated over the PARAMETER TRIANGLE spanned by the
    // first three `vertexUV` entries (a (u,v) triangle on the surface), NOT over
    // the axis-aligned rectangle [u0,u1]x[v0,v1]. This lets the boolean split a
    // curved face along an arbitrary imprinted cut while keeping the EXACT parent
    // surface (the sub-face is a true patch of the same quadric, integrated over
    // its real parameter triangle — so a bored cylinder wall's mass is exact).
    // Default false: every primitive face (full rectangular sector) is unaffected.
    bool paramTri = false;
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
    std::size_t loops    = 0;   // TOTAL loops (outer + inner) over all faces
    std::size_t shells   = 0;

    // K0 (additive): of the `loops` above, how many are INNER (hole) loops, i.e.
    // rings. innerLoops == loops - faces when every face has exactly one outer
    // loop (the normal case). Defaults 0 so the classic gate is unchanged.
    std::size_t innerLoops = 0;

    // V - E + F for the classic (single-loop-per-face) characteristic.
    long long characteristic() const {
        return static_cast<long long>(vertices)
             - static_cast<long long>(edges)
             + static_cast<long long>(faces);
    }

    // K0 GENERAL Euler-Poincare validity re-derivation (additive). The full
    // formula for a B-rep solid is:
    //
    //     V - E + F - R = 2 (S - G)
    //
    // where R = number of inner rings (hole loops) and S = shell count, G =
    // genus (number of through-holes / handles), per the standard B-rep
    // Euler-Poincare-Masuda relation (a.k.a. V - E + 2F - L - 2S + 2G - ... in
    // some texts; here R = L_total - F so 2F - L = F - R). Returns true iff the
    // counts are consistent with the supplied (shells, genus). For the classic
    // genus-0 single-shell box (R = 0, S = 1) this reduces to V - E + F == 2.
    //
    // NOTE: this is a SINGLE-PIECE-of-shell-per-face check on a manifold solid;
    // it does NOT itself prove 2-manifoldness (TopologyBuilder::isClosedTwoManifold
    // does that structurally). It is the arithmetic invariant the K0 gate asserts
    // for a face-with-hole and for the box.
    bool eulerPoincareValid(std::size_t shellCount, std::size_t genus) const {
        const long long V = static_cast<long long>(vertices);
        const long long E = static_cast<long long>(edges);
        const long long F = static_cast<long long>(faces);
        const long long R = static_cast<long long>(innerLoops);
        const long long S = static_cast<long long>(shellCount);
        const long long G = static_cast<long long>(genus);
        // V - E + F - R - 2(S - G) == 0
        return (V - E + F - R - 2 * (S - G)) == 0;
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

    // K0 (additive): allocate a Curve / PCurve owned by this builder. Pass a
    // fully-formed value (e.g. Curve::makeCircle(...)) and receive a stable raw
    // pointer to attach to an Edge / Coedge.
    Curve*  makeCurve(const Curve& c = Curve{});
    PCurve* makePcurve(const PCurve& p = PCurve{});

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

    // K0 INNER/HOLE LOOP (additive): assemble a closed coedge ring over an
    // ordered vertex `ring` and attach it to `face` as an INNER (hole) loop. The
    // ring is given in the loop's own traversal order; edges are created on
    // demand and SHARED with prior uses exactly like addOuterLoopToFace (so a
    // hole shared between two faces reuses its edges and mates its coedges). The
    // returned Loop has isOuter == false and is appended to face->innerLoops.
    // The caller is responsible for orienting the inner ring opposite to the
    // outer loop (material on the left of every coedge); this routine performs
    // the same structural wiring as the outer path without imposing a winding.
    Loop* addInnerLoopToFace(Face* face,
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

    // K0 (additive): shared coedge-ring assembly used by both the outer- and
    // inner-loop builders (creates/shares edges, wires next/prev/mate, points
    // every coedge at `loop`, sets loop->first/coedgeCount).
    void buildCoedgeRing(Loop* loop, const std::vector<Vertex*>& ring);

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
    // K0 (additive): Curve / PCurve geometry owned by this builder.
    std::vector<std::unique_ptr<Curve>>  curves_;
    std::vector<std::unique_ptr<PCurve>> pcurves_;

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
