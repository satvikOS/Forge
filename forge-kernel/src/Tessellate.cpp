#include "forge/Tessellate.hpp"

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <cmath>

namespace forge {

namespace {
// Accumulate weighted face normal into each of the triangle's three vertices.
// At the end we re-normalise once. This matches the standard
// "smooth-shaded" behaviour Three.js viewers expect from BREP meshes.
inline void accumulate(float* dst, const gp_Vec& n) {
    dst[0] += static_cast<float>(n.X());
    dst[1] += static_cast<float>(n.Y());
    dst[2] += static_cast<float>(n.Z());
}
inline void renormalize(float* n) {
    const float l = std::sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    if (l > 1e-20f) { n[0] /= l; n[1] /= l; n[2] /= l; }
    else            { n[0] = 0.0f; n[1] = 0.0f; n[2] = 1.0f; }
}
}

Mesh tessellate(ShapeHandle h, double linearTol, double angularTol) {
    const auto& shape = ShapeRegistry::instance().get(h);

    BRepMesh_IncrementalMesh mesher(shape, linearTol, /*isRelative*/ Standard_False,
                                    angularTol, /*isInParallel*/ Standard_True);
    mesher.Perform();

    Mesh out;

    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face face = TopoDS::Face(ex.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
        if (tri.IsNull()) continue;

        const bool reversed = (face.Orientation() == TopAbs_REVERSED);
        const gp_Trsf& tr = loc.Transformation();
        const std::uint32_t base = static_cast<std::uint32_t>(out.positions.size() / 3);

        // Positions in world space.
        for (Standard_Integer i = 1; i <= tri->NbNodes(); ++i) {
            gp_Pnt p = tri->Node(i).Transformed(tr);
            out.positions.push_back(static_cast<float>(p.X()));
            out.positions.push_back(static_cast<float>(p.Y()));
            out.positions.push_back(static_cast<float>(p.Z()));
        }

        // Zero-fill normals for these new vertices; we'll accumulate
        // per-triangle face normals onto them and renormalize at the end.
        const std::size_t normalsBase = out.normals.size();
        out.normals.resize(normalsBase + 3 * tri->NbNodes(), 0.0f);

        // Triangles + per-triangle normal accumulation.
        for (Standard_Integer i = 1; i <= tri->NbTriangles(); ++i) {
            Standard_Integer n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);
            if (reversed) std::swap(n2, n3);

            const gp_Pnt p1 = tri->Node(n1).Transformed(tr);
            const gp_Pnt p2 = tri->Node(n2).Transformed(tr);
            const gp_Pnt p3 = tri->Node(n3).Transformed(tr);

            const gp_Vec v1(p1, p2);
            const gp_Vec v2(p1, p3);
            gp_Vec n = v1.Crossed(v2); // area-weighted face normal
            if (n.SquareMagnitude() < 1e-30) continue; // degenerate

            accumulate(out.normals.data() + normalsBase + 3*(n1-1), n);
            accumulate(out.normals.data() + normalsBase + 3*(n2-1), n);
            accumulate(out.normals.data() + normalsBase + 3*(n3-1), n);

            out.indices.push_back(base + n1 - 1);
            out.indices.push_back(base + n2 - 1);
            out.indices.push_back(base + n3 - 1);
        }

        // Renormalise this face's contribution.
        for (Standard_Integer i = 1; i <= tri->NbNodes(); ++i) {
            renormalize(out.normals.data() + normalsBase + 3*(i-1));
        }
    }

    return out;
}

} // namespace forge
