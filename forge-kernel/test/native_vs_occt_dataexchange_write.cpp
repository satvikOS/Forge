// forge-kernel/test/native_vs_occt_dataexchange_write.cpp
//
// A/B-vs-OCCT for the native STEP + IGES *WRITE* round trip.
//
// This proves the FILES the native writers emit (StepAnalytic::write +
// writeIges) are READABLE by Open CASCADE 7.9.3, and that the geometry OCCT
// reconstructs MATCHES the native source body (face count == , volume rel<=1e-6).
//
// It is the OCCT-side sibling of the native-only gate
//   test/native/brep/dataexchange_roundtrip_test.cpp
// which feeds the writer output to the FORGE foreign readers. Here we feed the
// EXACT SAME writer output to OCCT's STEPControl_Reader / IGESControl_Reader and
// measure with BRepGProp::VolumeProperties + TopExp face count — the independent,
// third-party proof of interoperability.
//
// TWO BODIES (mirroring the native gate + the bored-plate ask):
//   (A) box + NURBS-top body — a CLOSED box [0,L]^3 whose +Z face is a trimmed
//       bilinear NURBS surface; 6 faces, volume L^3 = 27 (L = 3).
//       STEP exercises B_SPLINE_SURFACE_WITH_KNOTS; IGES exercises 128 RATIONAL
//       B-SPLINE SURFACE; the other 5 faces are PLANEs.
//   (B) bored plate — a rectangular plate W x D x H with a square through-hole
//       (an N=4 inner loop on each cap). The caps carry an OUTER loop + an INNER
//       (hole) FACE_BOUND, so this exercises the writers' inner-hole emit path.
//       OCCT must read the inner-hole FACE_BOUND back: the face count / area must
//       reflect the hole (10 faces: 6 box + 4 hole walls; cap area = plate -hole).
//
// Build (standalone C++20; native srcs compiled in-line, OCCT linked):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     test/native_vs_occt_dataexchange_write.cpp \
//     src/native/brep/{StepAnalytic,IgesWrite,StepRead,IgesRead,TrimmedFace,Surface,\
//        Topology,MassProps,Sew,Nurbs,NurbsSurface,NurbsCalculus,NurbsAlgebra,Curve,\
//        Primitives}.cpp \
//     src/native/geom/{ConstrainedDelaunay2D,Geom,Delaunay}.cpp \
//     src/native/Predicates.cpp src/native/mesh/HalfEdgeMesh.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKDESTEP -lTKDEIGES -lTKXSBase -lTKShHealing \
//     -o /tmp/nvo_dx_write && /tmp/nvo_dx_write

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

// ---- Forge native writers + topology --------------------------------------
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/IgesWrite.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"

// ---- OCCT readers + geometry properties -----------------------------------
#include <STEPControl_Reader.hxx>
#include <IGESControl_Reader.hxx>
#include <IGESData_IGESModel.hxx>
#include <IGESData_IGESEntity.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

#include <sstream>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool relle(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
static inline Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
static std::size_t nativeFaceCount(const Solid& s) {
    std::size_t n = 0;
    for (const Shell* sh : s.shells) if (sh) n += sh->faces.size();
    return n;
}

// ===========================================================================
// OCCT side: read a STEP / IGES text blob -> TopoDS_Shape, then count FACEs and
// measure the volume (BRepGProp::VolumeProperties) and surface area
// (BRepGProp::SurfaceProperties). Returns ok=false if OCCT could not read it.
// ===========================================================================
struct OcctRead {
    bool        ok = false;
    std::size_t faces = 0;
    double      volume = 0.0;
    double      area = 0.0;
    std::string why;
};

static std::size_t occtFaceCount(const TopoDS_Shape& sh) {
    std::size_t n = 0;
    for (TopExp_Explorer ex(sh, TopAbs_FACE); ex.More(); ex.Next()) ++n;
    return n;
}

static OcctRead occtMeasure(const TopoDS_Shape& shape) {
    OcctRead r;
    if (shape.IsNull()) { r.why = "OCCT shape is null"; return r; }
    r.faces = occtFaceCount(shape);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(shape, vp);
    r.volume = std::fabs(vp.Mass());   // |signed volume|
    GProp_GProps sp;
    BRepGProp::SurfaceProperties(shape, sp);
    r.area = sp.Mass();
    r.ok = true;
    return r;
}

// OCCT: read STEP text via STEPControl_Reader.ReadStream + TransferRoots + OneShape.
static OcctRead occtReadStep(const std::string& text, const char* tag) {
    OcctRead r;
    STEPControl_Reader reader;
    std::istringstream iss(text);
    IFSelect_ReturnStatus st = reader.ReadStream(tag, iss);
    if (st != IFSelect_RetDone) { r.why = "STEPControl_Reader.ReadStream failed"; return r; }
    Standard_Integer nroots = reader.TransferRoots();
    if (nroots <= 0) { r.why = "STEP TransferRoots produced 0 roots"; return r; }
    TopoDS_Shape shape = reader.OneShape();
    return occtMeasure(shape);
}

// OCCT: read IGES text. IGESControl_Reader has no public ReadStream, so the text
// is written to a temp .igs file and read via ReadFile + TransferRoots + OneShape.
static OcctRead occtReadIges(const std::string& text, const char* tag) {
    OcctRead r;
    std::string path = std::string("/tmp/forge_nvo_") + tag + ".igs";
    if (FILE* f = std::fopen(path.c_str(), "wb")) {
        std::fwrite(text.data(), 1, text.size(), f);
        std::fclose(f);
    } else { r.why = "could not open temp IGES file"; return r; }
    IGESControl_Reader reader;
    IFSelect_ReturnStatus st = reader.ReadFile(path.c_str());
    if (st != IFSelect_RetDone) { r.why = "IGESControl_Reader.ReadFile failed"; return r; }
    reader.TransferRoots();
    TopoDS_Shape shape = reader.OneShape();
    // FALLBACK: if TransferRoots produced no shape (OCCT did not pick the BREP
    // solid as a transfer root), explicitly transfer the 186 MANIFOLD SOLID BREP
    // (else the 514 SHELL) entity by hand — a legitimate OCCT IGES read path.
    if (shape.IsNull()) {
        Handle(IGESData_IGESModel) model = reader.IGESModel();
        if (!model.IsNull()) {
            for (int pass = 0; pass < 2 && shape.IsNull(); ++pass) {
                const int want = (pass == 0) ? 186 : 514;
                const int nb = model->NbEntities();
                for (int i = 1; i <= nb; ++i) {
                    Handle(IGESData_IGESEntity) e = model->Entity(i);
                    if (!e.IsNull() && e->TypeNumber() == want) {
                        reader.TransferEntity(e);
                    }
                }
                shape = reader.OneShape();
            }
        }
    }
    return occtMeasure(shape);
}

// ===========================================================================
// BODY A — closed box [0,L]^3 with a trimmed-NURBS +Z (top) face. Mirrors
// dataexchange_roundtrip_test.cpp::buildBoxWithNurbsTop exactly (6 faces, L^3).
// ===========================================================================
struct OwnedSolid {
    std::shared_ptr<TopologyBuilder> owner;
    Solid* solid = nullptr;
};

static OwnedSolid buildBoxWithNurbsTop(double L) {
    OwnedSolid out;
    out.owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *out.owner;
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    auto V = [&](double x, double y, double z) { return tb.makeVertex(Point3{x, y, z}); };
    Vertex* v000 = V(0, 0, 0);
    Vertex* v100 = V(L, 0, 0);
    Vertex* v110 = V(L, L, 0);
    Vertex* v010 = V(0, L, 0);
    Vertex* v001 = V(0, 0, L);
    Vertex* v101 = V(L, 0, L);
    Vertex* v111 = V(L, L, L);
    Vertex* v011 = V(0, L, L);

    auto addPlane = [&](std::vector<Vertex*> ring, Vec3 n, Vec3 ref) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        s->origin = PV(ring[0]->point);
        s->axis = vnorm(n);
        s->refDir = vnorm(ref);
        f->surface = s;
        Vec3 bn = s->binormal();
        double u0 = 0, u1 = 0, w0 = 0, w1 = 0;
        f->vertexUV.clear();
        for (std::size_t i = 0; i < ring.size(); ++i) {
            Vec3 rel = vsub(PV(ring[i]->point), s->origin);
            double pu = vdot(rel, s->refDir), pv = vdot(rel, bn);
            f->vertexUV.push_back({pu, pv});
            if (i == 0) { u0 = u1 = pu; w0 = w1 = pv; }
            else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
                   w0 = std::min(w0, pv); w1 = std::max(w1, pv); }
        }
        f->u0 = u0; f->u1 = u1; f->v0 = w0; f->v1 = w1;
        return f;
    };

    addPlane({v000, v010, v110, v100}, {0, 0, -1}, {1, 0, 0});   // -Z bottom
    addPlane({v000, v100, v101, v001}, {0, -1, 0}, {1, 0, 0});   // -Y front
    addPlane({v100, v110, v111, v101}, {1, 0, 0},  {0, 1, 0});   // +X right
    addPlane({v110, v010, v011, v111}, {0, 1, 0},  {-1, 0, 0});  // +Y back
    addPlane({v010, v000, v001, v011}, {-1, 0, 0}, {0, -1, 0});  // -X left

    {   // +Z top: planar bilinear NURBS face (the 4 corners are the control grid).
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, {v001, v101, v111, v011});
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Nurbs;
        NurbsSurface& nb = s->nurbs;
        nb.degreeU = 1;
        nb.degreeV = 1;
        nb.control = {
            { Vec3{0, 0, L}, Vec3{0, L, L} },
            { Vec3{L, 0, L}, Vec3{L, L, L} },
        };
        nb.weights = { {1.0, 1.0}, {1.0, 1.0} };
        nb.knotsU = {0, 0, 1, 1};
        nb.knotsV = {0, 0, 1, 1};
        s->reversed = false;
        f->surface = s;
        f->u0 = 0.0; f->u1 = 1.0; f->v0 = 0.0; f->v1 = 1.0;
        f->vertexUV = { {0, 0}, {1, 0}, {1, 1}, {0, 1} };
    }

    out.solid = solid;
    return out;
}

// ===========================================================================
// BODY B — a bored plate: rectangular plate [0,W]x[0,D]x[0,H] with a square
// through-hole (N=4 inner loop on each cap). The caps carry an OUTER loop + an
// INNER (hole) FACE_BOUND. All faces are PLANEs, so it exports to BOTH writers.
//
// The square hole is inscribed in radius `r` (the 4 corners at angle k*pi/2),
// so the hole footprint is a square of half-diagonal r -> side = r*sqrt2 ->
// area = 2 r^2. Volume = W*D*H - 2 r^2 * H.
//
// 10 faces: bottom cap, top cap, 4 outer side walls, 4 inner hole walls.
// ===========================================================================
static OwnedSolid buildBoredPlate(double W, double D, double H,
                                  double cx, double cy, double r) {
    OwnedSolid out;
    out.owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *out.owner;

    const std::size_t N = 4;                 // square hole
    const double TWO_PI = 6.283185307179586476925286766559;

    // Outer box corners (bottom 0..3, top 4..7), CCW in XY seen from +Z.
    Vertex* o[8];
    o[0] = tb.makeVertex({0, 0, 0});
    o[1] = tb.makeVertex({W, 0, 0});
    o[2] = tb.makeVertex({W, D, 0});
    o[3] = tb.makeVertex({0, D, 0});
    o[4] = tb.makeVertex({0, 0, H});
    o[5] = tb.makeVertex({W, 0, H});
    o[6] = tb.makeVertex({W, D, H});
    o[7] = tb.makeVertex({0, D, H});

    // Hole corners: N at bottom (z=0), N at top (z=H). theta_i = 2pi i / N.
    std::vector<Vertex*> hb(N), ht(N);
    for (std::size_t i = 0; i < N; ++i) {
        double th = TWO_PI * double(i) / double(N);
        double x = cx + r * std::cos(th);
        double y = cy + r * std::sin(th);
        hb[i] = tb.makeVertex({x, y, 0});
        ht[i] = tb.makeVertex({x, y, H});
    }

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);
    out.solid = solid;

    // Helper: attach a PLANE surface to a face given the outer ring vertices,
    // outward normal n and in-plane ref. (vertexUV / trim left at defaults — the
    // exact-polygon mass integrator only needs the loop; surface frame is enough
    // for both writers.)
    auto attachPlane = [&](Face* f, std::vector<Vertex*> ring, Vec3 n, Vec3 ref) {
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        s->origin = PV(ring[0]->point);
        s->axis = vnorm(n);
        s->refDir = vnorm(ref);
        f->surface = s;
        Vec3 bn = s->binormal();
        f->vertexUV.clear();
        for (Vertex* v : ring) {
            Vec3 rel = vsub(PV(v->point), s->origin);
            f->vertexUV.push_back({vdot(rel, s->refDir), vdot(rel, bn)});
        }
    };

    // Bottom cap (z=0, outward -Z). Outer CCW-from-below: 0,3,2,1. Hole ring
    // (opposite winding to outer as seen from -Z) is hb[0..N-1].
    {
        Face* bottom = tb.makeFace();
        tb.addFaceToShell(shell, bottom);
        std::vector<Vertex*> outer = {o[0], o[3], o[2], o[1]};
        tb.addOuterLoopToFace(bottom, outer);
        std::vector<Vertex*> inner(N);
        for (std::size_t i = 0; i < N; ++i) inner[i] = hb[i];
        tb.addInnerLoopToFace(bottom, inner);
        // surface frame for the bottom plane (origin on the cap, -Z outward).
        attachPlane(bottom, outer, {0, 0, -1}, {1, 0, 0});
        // re-set vertexUV to the OUTER ring only (the integrator handles the hole
        // via innerLoops); leave default trim.
        Surface* s = bottom->surface;
        bottom->vertexUV.clear();
        Vec3 bn = s->binormal();
        for (Vertex* v : outer) {
            Vec3 rel = vsub(PV(v->point), s->origin);
            bottom->vertexUV.push_back({vdot(rel, s->refDir), vdot(rel, bn)});
        }
    }

    // Top cap (z=H, outward +Z). Outer CCW-from-above: 4,5,6,7. Hole ring winds
    // opposite (reversed).
    {
        Face* top = tb.makeFace();
        tb.addFaceToShell(shell, top);
        std::vector<Vertex*> outer = {o[4], o[5], o[6], o[7]};
        tb.addOuterLoopToFace(top, outer);
        std::vector<Vertex*> inner(N);
        for (std::size_t i = 0; i < N; ++i) inner[i] = ht[(N - i) % N];
        tb.addInnerLoopToFace(top, inner);
        attachPlane(top, outer, {0, 0, 1}, {1, 0, 0});
    }

    // 4 outer side walls (each a CCW-from-outside quad).
    const int wall[4][4] = {
        {0, 1, 5, 4}, // front  (y=0, -Y)
        {1, 2, 6, 5}, // right  (x=W, +X)
        {2, 3, 7, 6}, // back   (y=D, +Y)
        {3, 0, 4, 7}, // left   (x=0, -X)
    };
    const Vec3 wallN[4] = {{0,-1,0},{1,0,0},{0,1,0},{-1,0,0}};
    for (int w = 0; w < 4; ++w) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {o[wall[w][0]], o[wall[w][1]], o[wall[w][2]], o[wall[w][3]]};
        tb.addOuterLoopToFace(f, ring);
        Vec3 ref = vsub(PV(ring[1]->point), PV(ring[0]->point));
        attachPlane(f, ring, wallN[w], ref);
    }

    // N inner hole walls (normal points INTO the hole). Ring chosen so every edge
    // mates the caps in the opposite sense (mirrors k0_topology_test).
    for (std::size_t i = 0; i < N; ++i) {
        std::size_t j = (i + 1) % N;
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {hb[j], hb[i], ht[i], ht[j]};
        tb.addOuterLoopToFace(f, ring);
        // inward normal: from the wall midpoint toward the hole axis (cx,cy).
        Vec3 mid = vscale(vadd(PV(hb[i]->point), PV(hb[j]->point)), 0.5);
        Vec3 inward = vnorm(vsub(Vec3{cx, cy, mid.z}, mid));
        Vec3 ref = vsub(PV(ring[1]->point), PV(ring[0]->point));
        attachPlane(f, ring, inward, ref);
    }

    return out;
}

// ===========================================================================
// Run both writers on `src`, feed the output to OCCT, and assert:
//   * OCCT reads the file (ok),
//   * face count == native source face count (or an explicit override expFaces),
//   * volume rel<=1e-6 vs the native body volume,
//   * (when expArea > 0) OCCT surface area rel<=1e-6 vs expArea (proves a hole).
// `stepHasKw` / `igesHasTok` are sanity substrings the writer output must carry.
// ===========================================================================
static void runBody(const char* label, const Solid& src,
                    double expVol, std::size_t expFaces,
                    const char* stepKw, const char* igesTok,
                    double expArea /* <=0 to skip */) {
    std::printf("\n=== %s ===\n", label);
    MassProps mp = massProperties(src);
    std::printf("  native: faces=%zu volume=%.12g area=%.12g\n",
                nativeFaceCount(src), mp.volume, mp.area);
    check(relle(mp.volume, expVol, 1e-9),
          std::string(label) + ": native volume == expected (" +
          std::to_string(mp.volume) + ")");
    check(nativeFaceCount(src) == expFaces,
          std::string(label) + ": native face count == " + std::to_string(expFaces));

    // ---------------- STEP write -> OCCT read ----------------
    {
        AnalyticWriteResult wr = StepAnalytic::write(src, label);
        check(wr.ok, std::string(label) + " STEP: native write ok" +
              (wr.ok ? "" : " — " + wr.reason));
        if (wr.ok) {
            check(wr.text.find(stepKw) != std::string::npos,
                  std::string(label) + " STEP: emits " + stepKw);
            OcctRead rr = occtReadStep(wr.text, label);
            check(rr.ok, std::string(label) + " STEP: OCCT reads the native file" +
                  (rr.ok ? "" : " — " + rr.why));
            if (rr.ok) {
                std::printf("  OCCT(STEP): faces=%zu volume=%.12g area=%.12g\n",
                            rr.faces, rr.volume, rr.area);
                check(rr.faces == nativeFaceCount(src),
                      std::string(label) + " STEP: OCCT face count == native (" +
                      std::to_string(rr.faces) + " == " +
                      std::to_string(nativeFaceCount(src)) + ")");
                check(relle(rr.volume, mp.volume, 1e-6),
                      std::string(label) + " STEP: OCCT volume rel<=1e-6 vs native (got " +
                      std::to_string(rr.volume) + ", exp " + std::to_string(mp.volume) + ")");
                if (expArea > 0.0)
                    check(relle(rr.area, expArea, 1e-6),
                          std::string(label) + " STEP: OCCT area reflects the hole (got " +
                          std::to_string(rr.area) + ", exp " + std::to_string(expArea) + ")");
            }
        }
    }

    // ---------------- IGES write -> OCCT read ----------------
    {
        IgesWriteResult wr = writeIges(src, label);
        check(wr.ok, std::string(label) + " IGES: native write ok" +
              (wr.ok ? "" : " — " + wr.reason));
        if (wr.ok) {
            check(wr.text.find(igesTok) != std::string::npos,
                  std::string(label) + " IGES: carries token " + igesTok);
            OcctRead rr = occtReadIges(wr.text, label);
            check(rr.ok, std::string(label) + " IGES: OCCT reads the native file" +
                  (rr.ok ? "" : " — " + rr.why));
            if (rr.ok) {
                std::printf("  OCCT(IGES): faces=%zu volume=%.12g area=%.12g\n",
                            rr.faces, rr.volume, rr.area);
                check(rr.faces == nativeFaceCount(src),
                      std::string(label) + " IGES: OCCT face count == native (" +
                      std::to_string(rr.faces) + " == " +
                      std::to_string(nativeFaceCount(src)) + ")");
                check(relle(rr.volume, mp.volume, 1e-6),
                      std::string(label) + " IGES: OCCT volume rel<=1e-6 vs native (got " +
                      std::to_string(rr.volume) + ", exp " + std::to_string(mp.volume) + ")");
                if (expArea > 0.0)
                    check(relle(rr.area, expArea, 1e-6),
                          std::string(label) + " IGES: OCCT area reflects the hole (got " +
                          std::to_string(rr.area) + ", exp " + std::to_string(expArea) + ")");
            }
        }
    }
}

int main() {
    std::printf("native_vs_occt_dataexchange_write — STEP+IGES WRITE A/B vs OCCT 7.9.3\n");

    // -------- BODY A: box + NURBS top, L = 3, vol = 27, 6 faces --------
    {
        const double L = 3.0;
        OwnedSolid a = buildBoxWithNurbsTop(L);
        runBody("box_nurbs_top", *a.solid, L * L * L, 6,
                "B_SPLINE_SURFACE_WITH_KNOTS", "128", /*expArea=*/0.0);
    }

    // -------- BODY B: bored plate with a square through-hole --------
    // W x D x H = 4 x 4 x 2, hole inscribed-radius r = 0.8 centred at (2,2).
    // Square hole footprint area = 2 r^2 ; volume = W*D*H - 2 r^2 * H.
    // OCCT must read the inner-hole FACE_BOUND -> 10 faces and a cap area that
    // reflects the hole (each cap = W*D - 2 r^2). Total surface area:
    //   2 caps : 2*(W*D - 2 r^2)
    //   4 outer walls : 2*(W*H) + 2*(D*H)
    //   4 hole walls : perimeter(square side r*sqrt2) * H = 4*(r*sqrt2)*H
    {
        const double W = 4.0, D = 4.0, H = 2.0, r = 0.8;
        const double cx = 2.0, cy = 2.0;
        OwnedSolid b = buildBoredPlate(W, D, H, cx, cy, r);
        const double holeArea = 2.0 * r * r;                 // square inscribed in r
        const double expVol = W * D * H - holeArea * H;
        const double side = r * std::sqrt(2.0);
        const double expArea = 2.0 * (W * D - holeArea)      // 2 caps (with hole)
                             + 2.0 * (W * H) + 2.0 * (D * H)  // 4 outer walls
                             + 4.0 * side * H;                // 4 hole walls
        runBody("bored_plate", *b.solid, expVol, 10,
                "FACE_BOUND", "510", expArea);
    }

    std::printf("\nnative_vs_occt_dataexchange_write RESULT: %d/%d passed\n",
                g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
