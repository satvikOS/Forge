// ─────────────────────────────────────────────────────────────────────────────
// thicken_cylpatch_probe.cpp — WHAT ARE THE PARTS PATH C DECLINES?
//
// TKOffset family I (`FORGE_THICKEN_DROP_NATIVE`) sits at 96.2% native against
// OCCT's 100.0% on the 600-part corpus A/B, and CMakeLists.txt names the
// residue as "the next bounded target":
//
//     "the face is not the full parametric rectangle (a trimmed or holed
//      patch): a hole cut in the tube wall, on which the closed form is
//      measurably NOT OCCT's answer (rel 2e-2 .. 9e-2), so the engine declines
//      rather than return a plausible wrong solid."
//
// That paragraph records the RECTANGLE closed form failing. It does NOT record
// what OCCT's answer IS on those parts, and a bounded fix cannot be designed
// against an unknown target. This probe measures it.
//
// THE CANDIDATE IDENTITY. Write the offset body of a cylindrical patch in
// cylindrical coordinates (r, u, v) about the surface's own axis. The patch
// trims the surface to some region D of the (u,v) plane; the body swept by
// offsetting the patch radially between Rlo and Rhi is exactly D x [Rlo,Rhi],
// and dV = r dr du dv, so
//
//     V = INT_D INT_Rlo^Rhi r dr du dv = 0.5 * (Rhi^2 - Rlo^2) * area_uv(D).
//
// A cylindrical patch's 3-D area is R * area_uv(D) exactly, so area_uv(D) is
// OBSERVABLE as area(face)/R without ever describing D. Hence
//
//     V_general = 0.5 * (Rhi^2 - Rlo^2) * area(face) / R.                 (B)
//
// The shipped path's form is the same expression with D forced to the whole
// parametric rectangle:
//
//     V_rect    = 0.5 * (Rhi^2 - Rlo^2) * du * dv.                        (A)
//
// (A) and (B) coincide exactly when the rectangle certificate holds, so (B) is
// a strict generalisation and the 170 parts already covered are a CONTROL on
// it: if (B) is right, it must reproduce (A) on every one of them.
//
// WHAT THIS PROBE DECIDES. For every corpus part whose picked face is a
// cylinder it prints R, the UV box, the true face area, the wire count, OCCT's
// BRepOffset_MakeOffset volume (the exact call src/Features.cpp makes, quoted
// by the A/B), and the relative error of BOTH forms. If (B) lands at ~1e-9 on
// the parts (A) misses by 2e-2..9e-2, the residue is a KNOWN target and the
// remaining work is construction, not identification. If it does not, the
// radial-sweep model of what OCCT computes is wrong and no engine built on it
// would be correct — which is equally worth knowing before writing one.
//
// This probe MEASURES ONLY. It calls no native engine and changes no shipped
// code path.
//
// build: bash test/build_thicken_cylpatch_probe.sh
// run  : .build-corpus-ab/thicken_cylpatch_probe <part.step>
//        prints one JSON object per part on stdout.
// ─────────────────────────────────────────────────────────────────────────────
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Pnt.hxx>

namespace {

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

double solidVolume(const TopoDS_Shape& s) {
    GProp_GProps g;
    try { BRepGProp::VolumeProperties(s, g); } catch (...) { return 0.0; }
    return g.Mass();
}

// The A/B's own tie-break, copied verbatim so a row here refers to the same
// face a row there refers to (test/corpus_ab_coverage.cpp::betterFace).
bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}

Handle(Geom_Surface) basisSurface(Handle(Geom_Surface) s) {
    for (int i = 0; i < 8 && !s.IsNull(); ++i) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
        if (rt.IsNull()) break;
        s = rt->BasisSurface();
    }
    return s;
}

void esc(const std::string& in, std::string& out) {
    out.clear();
    for (char c : in) { if (c == '"' || c == '\\') out += '\\'; out += c; }
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step>\n", argv[0]); return 2; }
    const std::string path = argv[1];
    std::string name = path;
    { const size_t sl = name.find_last_of('/');
      if (sl != std::string::npos) name = name.substr(sl + 1);
      const size_t dot = name.find_last_of('.');
      if (dot != std::string::npos) name = name.substr(0, dot); }
    std::string nameEsc; esc(name, nameEsc);

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(path.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", nameEsc.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
    }
    if (shape.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", nameEsc.c_str());
        return 1;
    }

    // ---- the A/B's `scale`, reproduced so t is the same number -------------
    double bb[6] = {0, 0, 0, 0, 0, 0};
    {
        bool any = false;
        TopExp_Explorer ex(shape, TopAbs_VERTEX);
        for (; ex.More(); ex.Next()) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
            if (!any) { bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z(); any = true; }
            else {
                bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
                bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
                bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
            }
        }
        if (!any) {
            std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", nameEsc.c_str());
            return 1;
        }
    }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double minExt = std::min(dx, std::min(dy, dz));
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diag > 0.0)) {
        std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", nameEsc.c_str());
        return 1;
    }
    const bool flat = !(minExt > 1e-9 * diag);
    const double scale = flat ? diag * 0.05 : minExt;
    const double t = 0.05 * scale;

    // ---- pick the same face the A/B's THICKEN arm picks -------------------
    TopoDS_Face big; double bigArea = 0.0;
    {
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            if (betterFace(f, a, big, bigArea)) { big = f; bigArea = a; }
        }
    }
    if (big.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_face\"}\n", nameEsc.c_str());
        return 1;
    }

    Handle(Geom_Surface) srf = basisSurface(BRep_Tool::Surface(big));
    Handle(Geom_CylindricalSurface) cs = Handle(Geom_CylindricalSurface)::DownCast(srf);
    if (cs.IsNull()) {
        std::printf("{\"part\":\"%s\",\"surface\":\"not_cylinder\"}\n", nameEsc.c_str());
        return 0;
    }

    const double R = cs->Cylinder().Radius();
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    BRepTools::UVBounds(big, u0, u1, v0, v1);
    const double du = u1 - u0, dv = v1 - v0;

    int nWires = 0;
    for (TopExp_Explorer ex(big, TopAbs_WIRE); ex.More(); ex.Next()) ++nWires;

    const bool rectCert = (R > 1e-12 && du > 1e-12 && dv > 1e-12) &&
        std::fabs(bigArea - R * du * dv) <= 1.0e-6 * (R * du * dv);

    // ---- OCCT's answer: the exact call src/Features.cpp makes -------------
    double occtVol = 0.0; int occtDone = 0;
    try {
        BRepOffset_MakeOffset mk;
        mk.Initialize(big, t, 1.0e-4, BRepOffset_Skin,
                      Standard_False, Standard_False, GeomAbs_Arc, Standard_True);
        mk.MakeThickSolid();
        if (mk.IsDone()) { occtDone = 1; occtVol = std::fabs(solidVolume(mk.Shape())); }
    } catch (...) { occtDone = 0; }

    // ---- the two candidate closed forms, both signs of the offset ---------
    // The sign is a property of the face's orientation and is NOT known to this
    // probe, so BOTH are printed and the caller reads which one OCCT matched.
    auto form = [&](double sgn, bool general) -> double {
        const double Rp = R + sgn * t;
        if (!(Rp > 0.0)) return -1.0;
        const double lo = std::min(R, Rp), hi = std::max(R, Rp);
        const double areaUV = general ? (bigArea / R) : (du * dv);
        return 0.5 * (hi * hi - lo * lo) * areaUV;
    };
    const double rectPlus = form(+1.0, false), rectMinus = form(-1.0, false);
    const double genPlus  = form(+1.0, true),  genMinus  = form(-1.0, true);

    auto rel = [&](double v) -> double {
        if (!(occtVol > 0.0) || !(v > 0.0)) return -1.0;
        return std::fabs(v - occtVol) / occtVol;
    };

    std::printf(
        "{\"part\":\"%s\",\"surface\":\"cylinder\",\"R\":%.12g,\"du\":%.12g,\"dv\":%.12g,"
        "\"area\":%.12g,\"area_rect\":%.12g,\"wires\":%d,\"rect_cert\":%d,\"t\":%.12g,"
        "\"occt_done\":%d,\"occt_vol\":%.12g,"
        "\"rect_plus\":%.12g,\"rect_minus\":%.12g,\"gen_plus\":%.12g,\"gen_minus\":%.12g,"
        "\"rel_rect_plus\":%.6g,\"rel_rect_minus\":%.6g,"
        "\"rel_gen_plus\":%.6g,\"rel_gen_minus\":%.6g}\n",
        nameEsc.c_str(), R, du, dv, bigArea, R * du * dv, nWires, rectCert ? 1 : 0, t,
        occtDone, occtVol, rectPlus, rectMinus, genPlus, genMinus,
        rel(rectPlus), rel(rectMinus), rel(genPlus), rel(genMinus));
    return 0;
}
