// forge/native/brep/shape_facade_test.cpp
//
// Validation gate for the OCCT-zero POLYMORPHIC SHAPE HANDLE + TRAVERSAL FACADE
// (forge::native::shape — the TopoDS_Shape / TopoDS_Wire / TopoDS_Compound /
// TopExp_Explorer / TopExp::MapShapesAndAncestors replacement). Pure C++20, no
// external dependencies, no test framework — a hand-rolled harness that prints
// PASS/FAIL and exits non-zero on any failure (mirrors k0_topology_test.cpp).
//
// It builds a known native Solid (an axis-aligned box: V=8 E=12 F=6 Sh=1) via the
// existing brep::TopologyBuilder and asserts EXACT expected counts against the
// builder's own counts, so "the Explorer sees the solid's actual topology" is a
// measured fact, not a guess.
//
// GATE (asserted below):
//   (1) Shape wrap + type-query + safe downcast for EVERY ShapeType
//       (SOLID/SHELL/FACE/WIRE/EDGE/VERTEX/COMPOUND + null); cross-type downcast
//       returns nullptr; identity (isSame) behaves.
//   (2) Wire: open + closed build from an edge list, auto-orientation, vertices,
//       length (straight-chord AND analytic-curve arc-length).
//   (3) Compound: heterogeneous container, size/countOfType, dedup on traversal.
//   (4) Explorer: FACE/EDGE/VERTEX/SHELL/SOLID counts of the box == builder counts;
//       FACE->EDGE/VERTEX/WIRE; EDGE->VERTEX; OCCT-style cursor iteration.
//   (5) Ancestry: EDGE->2 FACEs (manifold), VERTEX->3 EDGEs, VERTEX->3 FACEs.

#include "forge/native/shape/Compound.hpp"
#include "forge/native/shape/Explore.hpp"
#include "forge/native/shape/Shape.hpp"
#include "forge/native/shape/Wire.hpp"

#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Topology.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native;
using shape::Shape;
using shape::ShapeType;
using shape::Wire;
using shape::Compound;
using shape::Explorer;
using shape::Ancestry;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

static constexpr double PI = 3.14159265358979323846;

// ===========================================================================
// (1) Shape handle: wrap + type-query + safe downcast for every ShapeType.
// ===========================================================================
static void testShapeHandle(brep::Solid* solid, brep::Shell* shell,
                            brep::Face* face, brep::Edge* edge,
                            brep::Vertex* vtx, Wire* wire, Compound* comp) {
    std::printf("[1] polymorphic Shape handle: wrap + type-query + downcast\n");

    Shape sSolid = Shape::ofSolid(solid);
    Shape sShell = Shape::ofShell(shell);
    Shape sFace  = Shape::ofFace(face);
    Shape sEdge  = Shape::ofEdge(edge);
    Shape sVtx   = Shape::ofVertex(vtx);
    Shape sWire  = Shape::ofWire(wire);
    Shape sComp  = Shape::ofCompound(comp);
    Shape sNull;

    // type tags
    check(sSolid.type() == ShapeType::SOLID && sSolid.isSolid(), "SOLID tag + isSolid()");
    check(sShell.type() == ShapeType::SHELL && sShell.isShell(), "SHELL tag + isShell()");
    check(sFace.type()  == ShapeType::FACE  && sFace.isFace(),   "FACE tag + isFace()");
    check(sWire.type()  == ShapeType::WIRE  && sWire.isWire(),   "WIRE tag + isWire()");
    check(sEdge.type()  == ShapeType::EDGE  && sEdge.isEdge(),   "EDGE tag + isEdge()");
    check(sVtx.type()   == ShapeType::VERTEX && sVtx.isVertex(), "VERTEX tag + isVertex()");
    check(sComp.type()  == ShapeType::COMPOUND && sComp.isCompound(), "COMPOUND tag + isCompound()");
    check(sNull.isNull() && sNull.type() == ShapeType::NONE, "default Shape is NULL/NONE");
    check(!sSolid.isNull(), "wrapped Shape is not null");

    // correct downcast returns the exact pointer
    check(sSolid.asSolid() == solid, "asSolid() recovers the solid pointer");
    check(sShell.asShell() == shell, "asShell() recovers the shell pointer");
    check(sFace.asFace()   == face,  "asFace() recovers the face pointer");
    check(sEdge.asEdge()   == edge,  "asEdge() recovers the edge pointer");
    check(sVtx.asVertex()  == vtx,   "asVertex() recovers the vertex pointer");
    check(sWire.asWire()   == wire,  "asWire() recovers the wire pointer");
    check(sComp.asCompound() == comp,"asCompound() recovers the compound pointer");

    // wrong downcast returns nullptr (no UB on mismatch)
    check(sSolid.asFace() == nullptr && sSolid.asEdge() == nullptr, "SOLID.asFace/asEdge == null");
    check(sFace.asSolid() == nullptr && sFace.asWire() == nullptr,  "FACE.asSolid/asWire == null");
    check(sEdge.asVertex() == nullptr, "EDGE.asVertex == null (mismatch)");
    check(sWire.asCompound() == nullptr, "WIRE.asCompound == null (mismatch)");

    // identity
    check(Shape::ofSolid(solid).isSame(sSolid), "two handles to same solid are isSame");
    check(sSolid == Shape::ofSolid(solid), "operator== on same solid");
    check(sFace != sSolid, "operator!= across different entities");
    check(!(sEdge == sVtx), "edge handle != vertex handle");
}

// ===========================================================================
// (2) Free Wire: open + closed build, auto-orientation, vertices, length.
// ===========================================================================
static void testWire() {
    std::printf("[2] free-standing Wire: open/closed + query + length\n");
    brep::TopologyBuilder tb;

    // Unit square corners in the z=0 plane.
    brep::Vertex* a = tb.makeVertex({0, 0, 0});
    brep::Vertex* b = tb.makeVertex({1, 0, 0});
    brep::Vertex* c = tb.makeVertex({1, 1, 0});
    brep::Vertex* d = tb.makeVertex({0, 1, 0});
    brep::Edge* ab = tb.makeEdge(a, b);
    brep::Edge* bc = tb.makeEdge(b, c);
    brep::Edge* cd = tb.makeEdge(c, d);
    brep::Edge* da = tb.makeEdge(d, a);

    // OPEN wire a->b->c->d (3 edges).
    Wire wo = Wire::fromEdges({ab, bc, cd});
    check(wo.edgeCount() == 3, "open wire has 3 edges");
    check(wo.isOpen() && !wo.isClosed(), "open wire isOpen / !isClosed");
    check(wo.isContiguous(), "open wire is contiguous");
    check(wo.startVertex() == a && wo.endVertex() == d, "open wire start==a, end==d");
    check(wo.vertices().size() == 4, "open 3-edge wire has 4 vertices");
    check(approx(wo.length(), 3.0, 1e-12), "open unit-square path length == 3.0");

    // CLOSED wire a->b->c->d->a (4 edges).
    Wire wc = Wire::fromEdges({ab, bc, cd, da});
    check(wc.edgeCount() == 4, "closed wire has 4 edges");
    check(wc.isClosed() && !wc.isOpen(), "closed wire isClosed / !isOpen");
    check(wc.isContiguous(), "closed wire is contiguous");
    check(wc.startVertex() == a && wc.endVertex() == a, "closed wire start==end==a");
    check(wc.vertices().size() == 4, "closed 4-edge wire has 4 distinct vertices");
    check(approx(wc.length(), 4.0, 1e-12), "closed unit-square loop length == 4.0");

    // AUTO-ORIENTATION: feed a reversed edge (c->b) after a->b; the wire must flip
    // it so the chain reads a->b->c.
    brep::Edge* cb = tb.makeEdge(c, b);       // natural sense c->b
    Wire wflip = Wire::fromEdges({ab, cb});
    check(wflip.edgeCount() == 2 && wflip.isContiguous(), "auto-orient wire is contiguous");
    check(wflip.edges()[1].forward == false, "second edge auto-oriented reversed (forward==false)");
    check(wflip.endVertex() == c, "auto-oriented wire ends at c (a->b->c)");

    // BROKEN chain: two edges sharing no vertex -> non-contiguous, honestly flagged.
    brep::Vertex* p = tb.makeVertex({5, 5, 5});
    brep::Vertex* q = tb.makeVertex({6, 5, 5});
    brep::Edge* pq = tb.makeEdge(p, q);
    Wire wbreak = Wire::fromEdges({ab, pq});
    check(!wbreak.isContiguous(), "disjoint edges -> non-contiguous wire");
    check(!wbreak.isClosed(), "non-contiguous wire is not closed");

    // ANALYTIC-CURVE arc length: a quarter circle radius 2 -> length = 2*(pi/2)=pi.
    brep::Vertex* vs = tb.makeVertex({2, 0, 0});
    brep::Vertex* ve = tb.makeVertex({0, 2, 0});
    brep::Edge* arc = tb.makeEdge(vs, ve);
    arc->curve = tb.makeCurve(
        brep::Curve::makeCircle({0, 0, 0}, {1, 0, 0}, {0, 0, 1}, 2.0, 0.0, PI / 2.0));
    Wire warc = Wire::fromEdges({arc});
    const double expectArc = 2.0 * (PI / 2.0);   // r * dtheta
    std::printf("      quarter-circle wire length = %.6f (expect %.6f)\n",
                warc.length(), expectArc);
    check(approx(warc.length(), expectArc, 1e-3), "curved-edge wire arc length == pi");
    check(warc.isOpen(), "quarter-arc wire is open");
}

// ===========================================================================
// (3) Compound: heterogeneous container + dedup on traversal.
// ===========================================================================
static void testCompound(brep::Solid* solid, brep::Face* face) {
    std::printf("[3] Compound: heterogeneous container + dedup\n");
    brep::TopologyBuilder wtb;
    brep::Vertex* a = wtb.makeVertex({0, 0, 0});
    brep::Vertex* b = wtb.makeVertex({1, 0, 0});
    Wire w = Wire::fromEdges({wtb.makeEdge(a, b)});

    Compound comp;
    comp.add(Shape::ofSolid(solid));
    comp.add(Shape::ofFace(face));     // a face that is ALSO part of the solid
    comp.add(Shape::ofWire(&w));
    check(comp.size() == 3, "compound holds 3 heterogeneous children");
    check(comp.countOfType(ShapeType::SOLID) == 1, "compound direct SOLID count == 1");
    check(comp.countOfType(ShapeType::FACE)  == 1, "compound direct FACE count == 1");
    check(comp.countOfType(ShapeType::WIRE)  == 1, "compound direct WIRE count == 1");
    check(comp.countOfType(ShapeType::EDGE)  == 0, "compound direct EDGE count == 0");
    check(comp.at(0).asSolid() == solid, "compound.at(0) is the solid");

    // Exploring the compound for FACE: the solid's 6 faces + the explicitly-added
    // face (which is one of those 6) -> DEDUPED to 6.
    Explorer exF(Shape::ofCompound(&comp), ShapeType::FACE);
    check(exF.count() == 6, "compound FACE explore dedups the shared face -> 6");
}

// ===========================================================================
// (4) Explorer: sub-shape enumeration over the native adjacency.
// ===========================================================================
static void testExplorer(brep::TopologyBuilder& boxTb, brep::Solid* solid,
                         brep::Shell* shell, brep::Face* face, brep::Edge* edge) {
    std::printf("[4] Explorer: sub-shape traversal == builder's actual counts\n");
    Shape sSolid = Shape::ofSolid(solid);

    Explorer exFace(sSolid, ShapeType::FACE);
    Explorer exEdge(sSolid, ShapeType::EDGE);
    Explorer exVert(sSolid, ShapeType::VERTEX);
    Explorer exShell(sSolid, ShapeType::SHELL);
    Explorer exSolid(sSolid, ShapeType::SOLID);

    std::printf("      box explore: F=%zu E=%zu V=%zu Sh=%zu So=%zu"
                "  (builder F=%zu E=%zu V=%zu Sh=%zu)\n",
                exFace.count(), exEdge.count(), exVert.count(),
                exShell.count(), exSolid.count(),
                boxTb.faceCount(), boxTb.edgeCount(),
                boxTb.vertexCount(), boxTb.shellCount());

    check(exFace.count()  == boxTb.faceCount()   && exFace.count()  == 6, "FACE count == 6 (== builder)");
    check(exEdge.count()  == boxTb.edgeCount()   && exEdge.count()  == 12, "EDGE count == 12 (== builder, deduped)");
    check(exVert.count()  == boxTb.vertexCount() && exVert.count()  == 8,  "VERTEX count == 8 (== builder, deduped)");
    check(exShell.count() == boxTb.shellCount()  && exShell.count() == 1,  "SHELL count == 1 (== builder)");
    check(exSolid.count() == 1, "SOLID explore of a solid yields itself (1)");

    // every reported face/edge/vertex actually carries the matching tag
    bool allFaces = true;
    for (const Shape& s : exFace.all()) allFaces = allFaces && s.isFace();
    check(allFaces, "every FACE sub-shape carries the FACE tag");

    // Face -> edges / vertices / wire.
    Shape sFace = Shape::ofFace(face);
    Explorer fE(sFace, ShapeType::EDGE);
    Explorer fV(sFace, ShapeType::VERTEX);
    Explorer fW(sFace, ShapeType::WIRE);
    check(fE.count() == 4, "box quad face has 4 edges");
    check(fV.count() == 4, "box quad face has 4 vertices");
    check(fW.count() == 1, "box quad face has 1 (outer) wire");
    check(fW.all().size() == 1 && fW.all()[0].asWire() != nullptr, "face wire downcasts to Wire");
    check(fW.all()[0].asWire()->edgeCount() == 4, "synthesised face wire has 4 edges");
    check(fW.all()[0].asWire()->isClosed(), "synthesised face wire is closed");

    // Edge -> vertices.
    Explorer eV(Shape::ofEdge(edge), ShapeType::VERTEX);
    check(eV.count() == 2, "an edge has 2 vertices");

    // OCCT-style cursor iteration reaches every element exactly once.
    std::size_t walked = 0;
    for (Explorer ex(sSolid, ShapeType::EDGE); ex.more(); ex.next()) {
        Shape e = ex.current();
        if (e.isEdge()) ++walked;
    }
    check(walked == 12, "cursor more()/next()/current() walks all 12 edges once");
}

// ===========================================================================
// (5) Ancestry: MapShapesAndAncestors over the coedge adjacency.
// ===========================================================================
static void testAncestry(brep::Solid* solid, brep::Edge* edge) {
    std::printf("[5] Ancestry: edge->faces, vertex->edges, vertex->faces\n");
    Shape sSolid = Shape::ofSolid(solid);

    // EDGE -> FACE: every manifold edge is shared by exactly 2 faces.
    Ancestry ef(sSolid, ShapeType::EDGE, ShapeType::FACE);
    check(ef.childCount() == 12, "edge->face ancestry has 12 edges");
    bool allTwo = true;
    for (std::size_t i = 0; i < ef.childCount(); ++i) {
        if (ef.parentsOfIndex(i).size() != 2) { allTwo = false; break; }
    }
    check(allTwo, "every edge is shared by exactly 2 faces (manifold)");
    // both ancestors of a specific edge are faces, and distinct.
    const std::vector<Shape>& fa = ef.ancestors(Shape::ofEdge(edge));
    check(fa.size() == 2, "ancestors(edge) returns 2 faces");
    check(fa.size() == 2 && fa[0].isFace() && fa[1].isFace(), "both ancestors are FACEs");
    check(fa.size() == 2 && !fa[0].isSame(fa[1]), "the 2 face ancestors are distinct");
    // an unknown child yields an empty ancestor list (no crash).
    check(ef.ancestors(Shape::ofSolid(solid)).empty(), "ancestors(unknown child) is empty");

    // VERTEX -> EDGE: every box corner meets exactly 3 edges.
    Ancestry ve(sSolid, ShapeType::VERTEX, ShapeType::EDGE);
    check(ve.childCount() == 8, "vertex->edge ancestry has 8 vertices");
    bool allThreeE = true;
    for (std::size_t i = 0; i < ve.childCount(); ++i) {
        if (ve.parentsOfIndex(i).size() != 3) { allThreeE = false; break; }
    }
    check(allThreeE, "every box vertex meets exactly 3 edges");

    // VERTEX -> FACE: every box corner touches exactly 3 faces.
    Ancestry vf(sSolid, ShapeType::VERTEX, ShapeType::FACE);
    check(vf.childCount() == 8, "vertex->face ancestry has 8 vertices");
    bool allThreeF = true;
    for (std::size_t i = 0; i < vf.childCount(); ++i) {
        if (vf.parentsOfIndex(i).size() != 3) { allThreeF = false; break; }
    }
    check(allThreeF, "every box vertex touches exactly 3 faces");
}

// ===========================================================================
int main() {
    std::printf("=== forge::native::shape — polymorphic Shape + traversal facade gate ===\n");

    // Known solid: an axis-aligned box (V=8 E=12 F=6 Sh=1) built ONLY in boxTb, so
    // its builder counts are the ground truth the Explorer is checked against.
    brep::TopologyBuilder boxTb;
    brep::Solid* solid = boxTb.buildBox({0, 0, 0}, {2, 3, 4});
    brep::Shell* shell = solid->shells.at(0);
    brep::Face*  face  = shell->faces.at(0);
    brep::Coedge* co   = face->outerLoop->first;
    brep::Edge*  edge  = co->edge;
    brep::Vertex* vtx  = edge->start;

    // Scratch Wire + Compound for the handle test.
    brep::TopologyBuilder scratch;
    brep::Vertex* wa = scratch.makeVertex({0, 0, 0});
    brep::Vertex* wb = scratch.makeVertex({1, 0, 0});
    Wire hw = Wire::fromEdges({scratch.makeEdge(wa, wb)});
    Compound hc;
    hc.add(Shape::ofSolid(solid));

    testShapeHandle(solid, shell, face, edge, vtx, &hw, &hc);
    testWire();
    testCompound(solid, face);
    testExplorer(boxTb, solid, shell, face, edge);
    testAncestry(solid, edge);

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
