// forge::surf — see include/forge/SurfaceValue.hpp for WHY this exists.
//
// Every entry point here is deliberately TOTAL: `facesOf` never refuses an index
// list, `boundaryOf` never refuses a shape without faces, and `statsOf` never
// refuses a degenerate sheet. The SURFACE value kind is defined by having the
// weakest invariant of the four IR kinds, and a producer that throws on a
// degenerate input would put that invariant back.

#include "forge/SurfaceValue.hpp"

#include <algorithm>
#include <vector>

#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom2d_Curve.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>

namespace forge {
namespace surf {
namespace {

// IDENTICAL to DirectEdit.cpp's faceMap. Face indices are the currency between
// FACES("sel") -- which resolves its selector through forge::faceInventory -- and
// the extraction here, so the two orderings must be the same map, not merely the
// same idea. TopExp_Explorer would traverse a compound in a different order and
// would not de-duplicate a shared face; that difference is invisible until a
// selector silently extracts a neighbour.
TopTools_IndexedMapOfShape faceMap(const TopoDS_Shape& s) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);
    return m;
}

}  // namespace

std::size_t faceCountOf(ShapeHandle body) {
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    if (shape.IsNull()) return 0;
    return static_cast<std::size_t>(faceMap(shape).Extent());
}

namespace {

// Wrap a face list as a sheet handle. Exactly one face is returned AS a face: a
// one-face compound is legal but reads as a different thing to every downstream
// OCCT algorithm. Zero faces yields an EMPTY compound, which is the point — an
// empty sheet is a representable SURFACE value, so a selector miss is a fact the
// tree carries rather than an exception that ends it.
ShapeHandle asSheet(const std::vector<TopoDS_Face>& picked) {
    if (picked.size() == 1) return ShapeRegistry::instance().add(picked.front());
    TopoDS_Compound comp;
    BRep_Builder builder;
    builder.MakeCompound(comp);
    for (const TopoDS_Face& f : picked) builder.Add(comp, f);
    return ShapeRegistry::instance().add(comp);
}

}  // namespace

ShapeHandle facesOf(ShapeHandle body, const std::vector<int>& faceIndices,
                    std::vector<int>* skipped) {
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);

    std::vector<TopoDS_Face> picked;
    if (!shape.IsNull() && !faceIndices.empty()) {
        const TopTools_IndexedMapOfShape m = faceMap(shape);
        const int n = m.Extent();
        std::vector<int> seen;
        for (const int idx : faceIndices) {
            // An out-of-range or repeated index is SKIPPED and reported, not
            // thrown. A selector that drifted by one face must not be able to
            // destroy a 200-op tree; the caller records what was dropped and
            // SURFCHECK can assert on the face count that survived.
            if (idx < 1 || idx > n ||
                std::find(seen.begin(), seen.end(), idx) != seen.end()) {
                if (skipped != nullptr) skipped->push_back(idx);
                continue;
            }
            seen.push_back(idx);
            picked.push_back(TopoDS::Face(m.FindKey(idx)));
        }
    }
    return asSheet(picked);
}

ShapeHandle boundaryOf(ShapeHandle body) {
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
    std::vector<TopoDS_Face> picked;
    if (!shape.IsNull()) {
        const TopTools_IndexedMapOfShape m = faceMap(shape);
        picked.reserve(static_cast<std::size_t>(m.Extent()));
        for (int i = 1; i <= m.Extent(); ++i) picked.push_back(TopoDS::Face(m.FindKey(i)));
    }
    return asSheet(picked);
}

SheetStats statsOf(ShapeHandle sheet) {
    SheetStats st;
    const TopoDS_Shape& shape = ShapeRegistry::instance().get(sheet);
    if (shape.IsNull()) return st;

    const TopTools_IndexedMapOfShape fm = faceMap(shape);
    st.faces = static_cast<std::size_t>(fm.Extent());

    for (TopExp_Explorer ex(shape, TopAbs_SHELL); ex.More(); ex.Next()) ++st.shells;

    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        BRepAdaptor_Surface ad(f);
        switch (ad.GetType()) {
            case GeomAbs_Plane:
            case GeomAbs_Cylinder:
            case GeomAbs_Cone:
            case GeomAbs_Sphere:
            case GeomAbs_Torus:
                break;
            default:
                // BSpline, Bezier, revolution, extrusion, offset: everything the
                // three old value kinds could not name. 67 of the 430 faces in the
                // canonical edit fixture land here.
                ++st.freeformFaces;
                break;
        }
        GProp_GProps props;
        BRepGProp::SurfaceProperties(f, props);
        st.area += props.Mass();
    }

    // Edge -> adjacent faces. One face == a free boundary edge; more than two ==
    // non-manifold. Both are legal states of a SURFACE and both are measured.
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    st.edges = static_cast<std::size_t>(edgeFaces.Extent());
    for (int i = 1; i <= edgeFaces.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(edgeFaces.FindKey(i));
        const TopTools_ListOfShape& adj = edgeFaces.FindFromIndex(i);
        const std::size_t deg = static_cast<std::size_t>(adj.Extent());
        if (deg <= 1) ++st.freeEdges;
        if (deg > 2) ++st.nonManifoldEdges;

        // A p-curve is the edge's 2D curve IN a neighbouring face's parameter
        // space. STEP and IGES imports routinely arrive without them, and every
        // sewing / offsetting algorithm then behaves unpredictably. One missing
        // p-curve on any adjacent face is enough to count the edge.
        bool missing = false;
        for (TopTools_ListOfShape::Iterator it(adj); it.More(); it.Next()) {
            const TopoDS_Face af = TopoDS::Face(it.Value());
            Standard_Real f0 = 0.0, f1 = 0.0;
            const Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(e, af, f0, f1);
            if (pc.IsNull()) { missing = true; break; }
        }
        if (missing) ++st.edgesWithoutPCurve;
    }

    st.closed = (st.faces > 0 && st.freeEdges == 0);
    return st;
}

}  // namespace surf
}  // namespace forge
