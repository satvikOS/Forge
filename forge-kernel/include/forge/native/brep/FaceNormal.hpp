// forge/native/brep/FaceNormal.hpp
//
// forge::native::brep — NATIVE face-normal helpers that replace
// BRepGProp_Face::Normal / BRepGProp_Face::Bounds WITHOUT instantiating
// BRepGProp_Face. That class holds a `Geom2dAdaptor_Curve myCurve;` member, so
// merely constructing it drags in Geom2dAdaptor_Curve's ctor + vtable — the
// TKG2d dependency this half of K6 removes.
//
// EXACT-SEMANTICS replacement (measured against OCCT 7.9.3 BRepGProp_Face):
//
//   BRepGProp_Face::Normal(u,v,P,VNor):
//        gp_Vec Du,Dv; mySurface.D1(u,v,P,Du,Dv);   // BRepAdaptor_Surface (TKG3d)
//        VNor = Du.Crossed(Dv);
//        if (face REVERSED) VNor.Reverse();          // mySReverse == (orient==REVERSED)
//     -> VNor is NOT normalized. Callers keep their own magnitude/degeneracy math,
//        which is why `faceOrientedNormal` returns the raw gp_Vec (NOT a gp_Dir:
//        a gp_Dir would auto-normalize away the magnitude callers test AND throw
//        Standard_ConstructionError on the near-zero normal at poles/degeneracies).
//
//   BRepGProp_Face::Bounds(u0,u1,v0,v1):
//        forwards to mySurface.First/LastU/VParameter() — i.e. exactly the
//        BRepAdaptor_Surface parameter bounds used elsewhere in the kernel.
//
// Both paths resolve ONLY through BRep_Tool::Surface (TKBRep), Geom_Surface::D1
// (TKG3d, virtual via the surface Handle) and BRepAdaptor_Surface (TKBRep) — all
// KEPT toolkits. Verified: a standalone .o of these functions has ZERO undefined
// Geom2d* / BRepGProp_Face symbols.

#ifndef FORGE_NATIVE_BREP_FACENORMAL_HPP
#define FORGE_NATIVE_BREP_FACENORMAL_HPP

#include <TopoDS_Face.hxx>
#include <TopAbs_Orientation.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Surface.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace native {
namespace brep {

// Native equivalent of BRepGProp_Face::Normal(u,v,P,VNor). Computes the face's
// oriented (outward-per-face-orientation) normal at parametric (u,v): the raw
// geometric surface normal S_u x S_v, reversed when the face is TopAbs_REVERSED,
// matching OCCT bit-for-bit in direction and (non-unit) magnitude. `P` receives
// the surface point (callers that don't need it pass a throwaway, as they did
// with the OCCT out-param). On a null surface returns a zero vector so the
// caller's existing degeneracy branch fires.
inline void faceOrientedNormal(const TopoDS_Face& face,
                               double u, double v,
                               gp_Pnt& P, gp_Vec& VNor) {
    Handle(Geom_Surface) surf = BRep_Tool::Surface(face);
    if (surf.IsNull()) {
        P = gp_Pnt();
        VNor = gp_Vec(0.0, 0.0, 0.0);
        return;
    }
    gp_Vec Du, Dv;
    surf->D1(u, v, P, Du, Dv);
    VNor = Du.Crossed(Dv);
    if (face.Orientation() == TopAbs_REVERSED) {
        VNor.Reverse();
    }
}

// Native equivalent of BRepGProp_Face::Bounds(u0,u1,v0,v1) — the surface
// parameter bounds as reported by BRepAdaptor_Surface (identical source to
// OCCT's implementation, which forwards to the same adaptor).
inline void faceUVBounds(const TopoDS_Face& face,
                         double& u0, double& u1, double& v0, double& v1) {
    BRepAdaptor_Surface s(face);
    u0 = s.FirstUParameter();
    u1 = s.LastUParameter();
    v0 = s.FirstVParameter();
    v1 = s.LastVParameter();
}

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_FACENORMAL_HPP
