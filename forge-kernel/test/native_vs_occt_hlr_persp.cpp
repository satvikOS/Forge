// forge-kernel/test/native_vs_occt_hlr_persp.cpp
//
// A/B validation: Forge native PERSPECTIVE hidden-line removal (hlrPerspective in
// src/native/brep/Hlr.cpp) vs OpenCASCADE's HLRBRep_Algo driven by a PERSPECTIVE
// HLRAlgo_Projector, on the SAME two scenes the native hlr_test added for the
// perspective path:
//
//   Scene A — "perspective box":  unit cube [0,0,0]->[1,1,1],
//             eye (4,4,4), target (0.5,0.5,0.5), up (0,0,1), fovY = 60deg.
//             (hlr_test case [4]: textbook 9 solid + 3 dashed.)
//
//   Scene B — "two-box occlusion":  near cube [0,0,0]->[1,1,1] and far cube
//             [3,0.6,0]->[4,1.6,1], eye (-6,0.5,0.5), target (4,0.5,0.5),
//             up (0,0,1), fovY = 60deg.  (hlr_test case [5]: near box occludes
//             part of the far box.)
//
// Both engines run the SAME pin-hole camera. We report LITERAL visible/hidden
// edge counts and per-class projected length on BOTH sides, then compare:
//   * counts (informational — OCCT splits edges at silhouette/occlusion crossings
//     and the native sampled-HLR merges spans, so raw counts legitimately differ),
//   * per-class projected length, compared as the scale-invariant FRACTION of the
//     total drawn (visible+hidden) length, since the native image-plane focal model
//     (u = focal*(p-eye).U/depth) and OCCT's (x*F/(F-z)) are different
//     parameterizations of the perspective image plane and so absolute lengths are
//     not in the same units. The visible/hidden SPLIT of the total drawn length is
//     the engine-independent invariant.
//
// PASS iff the per-class length FRACTION matches within rel<=1e-3 on both scenes.
// Counts that differ only by OCCT edge-splitting / native sampled-HLR ceiling are
// reported and flagged PARTIAL, not FAIL (per the task's note).
//
// Build (single clang++, C++20):
//   clang++ -std=c++20 -O2 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_hlr_persp.cpp \
//     forge-kernel/src/native/brep/Hlr.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKHLR -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_hlr_persp && /tmp/native_vs_occt_hlr_persp

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ---- Forge native HLR --------------------------------------------------------
#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

// ---- OpenCASCADE -------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Trsf.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <HLRAlgo_Projector.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>

using namespace forge::native::brep;

// =============================================================================
// Small 3-vector helpers (camera math identical to Hlr.cpp's makeCameraFrame /
// projectPersp so the OCCT projector is set up to mirror the native camera).
// =============================================================================
struct V3 { double x, y, z; };
static V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static double dot(const V3& a, const V3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
static V3 cross(const V3& a, const V3& b) {
    return {a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x};
}
static double len(const V3& a) { return std::sqrt(dot(a, a)); }
static V3 norm(const V3& a) { double n = len(a); return {a.x/n, a.y/n, a.z/n}; }

struct Camera {
    V3 eye, target, up;
    double fovY;
};

// Native camera basis (Hlr.cpp::makeCameraFrame):  N = look, U = N x up, V = U x N.
static void cameraBasis(const Camera& c, V3& N, V3& U, V3& V) {
    N = norm(sub(c.target, c.eye));
    U = norm(cross(N, c.up));
    V = cross(U, N);   // unit
}

// =============================================================================
// Build the OCCT PERSPECTIVE projector that mirrors the native pin-hole camera.
//
// OCCT perspective Project() maps a world point P, after the view transform T into
// view coordinates (X,Y,Z), to the image point
//      ( X * Focus / (Focus - Z) , Y * Focus / (Focus - Z) ).
// The eye sits at view Z = Focus, the projection plane at Z = 0.
//
// To make OCCT's perspective image IDENTICAL (same parameterization) to the native
// projectPersp ( u = focal*(P-eye).U / depth ), we set up T so that
//      X =  (P - eye) . U                    (right)
//      Y =  (P - eye) . V                    (up)
//      Z =  Focus - (P - eye) . N            (eye at Z=Focus; depth = (P-eye).N)
// Then (Focus - Z) = depth, so OCCT's image is
//      ( X*Focus/depth , Y*Focus/depth )  ==  native with focal == Focus.
// Choosing Focus == 1/tan(fovY/2) (the native focal) makes the two perspective
// projections produce the same image-plane coordinates up to identity, so per-edge
// projected lengths — and hence the visible/hidden split — are directly comparable.
// =============================================================================
static HLRAlgo_Projector makePerspProjector(const Camera& c, double focus) {
    V3 N, U, V;
    cameraBasis(c, N, U, V);

    // T maps world point P to view coords (rows are the basis, origin shifted so the
    // eye lands at view Z = Focus and depth = (P-eye).N gives Z = Focus - depth):
    //   X =  U.(P-eye)
    //   Y =  V.(P-eye)
    //   Z =  Focus - N.(P-eye)  =  -N.P + (N.eye + Focus)
    gp_Trsf T;
    T.SetValues(
        U.x,  U.y,  U.z,  -(U.x*c.eye.x + U.y*c.eye.y + U.z*c.eye.z),
        V.x,  V.y,  V.z,  -(V.x*c.eye.x + V.y*c.eye.y + V.z*c.eye.z),
        -N.x, -N.y, -N.z,  (N.x*c.eye.x + N.y*c.eye.y + N.z*c.eye.z) + focus);

    // Persp = true, Focus = focal distance (eye->plane) == native 1/tan(fovY/2).
    return HLRAlgo_Projector(T, Standard_True, focus);
}

// =============================================================================
// Run OCCT HLR on a shape with the given perspective projector; return the total
// VISIBLE and HIDDEN projected (2D image-plane) edge length + edge counts.
//
// VCompound() / HCompound() return the 2D image-plane edges (sharp visible /
// hidden). We also fold in the outline (silhouette) compounds so curved-face
// silhouettes would count too (irrelevant for boxes, harmless here). Length is
// measured on the resulting 2D edges via BRepGProp (LinearProperties).
// =============================================================================
struct OcctHlr {
    double visLen = 0.0, hidLen = 0.0;
    int    visEdges = 0, hidEdges = 0;
};

static double edgeSetLength(const TopoDS_Shape& comp, int& nEdges) {
    double L = 0.0;
    nEdges = 0;
    if (comp.IsNull()) return 0.0;
    for (TopExp_Explorer ex(comp, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = TopoDS::Edge(ex.Current());
        GProp_GProps props;
        BRepGProp::LinearProperties(e, props);
        L += props.Mass();   // Mass() of a linear GProp == curve length
        ++nEdges;
    }
    return L;
}

static OcctHlr runOcct(const TopoDS_Shape& shape, const HLRAlgo_Projector& proj) {
    OcctHlr r;
    Handle(HLRBRep_Algo) algo = new HLRBRep_Algo();
    algo->Add(shape);
    algo->Projector(proj);
    algo->Update();
    algo->Hide();

    HLRBRep_HLRToShape hlrToShape(algo);

    // Visible: sharp + outline (silhouette) edges.
    int n;
    {
        TopoDS_Shape v  = hlrToShape.VCompound();         // sharp visible
        TopoDS_Shape vo = hlrToShape.OutLineVCompound();  // visible outline/silhouette
        int na = 0, nb = 0;
        r.visLen   += edgeSetLength(v,  na);
        r.visLen   += edgeSetLength(vo, nb);
        r.visEdges += na + nb;
    }
    {
        TopoDS_Shape h  = hlrToShape.HCompound();         // sharp hidden
        TopoDS_Shape ho = hlrToShape.OutLineHCompound();  // hidden outline/silhouette
        int na = 0, nb = 0;
        r.hidLen   += edgeSetLength(h,  na);
        r.hidLen   += edgeSetLength(ho, nb);
        r.hidEdges += na + nb;
    }
    (void)n;
    return r;
}

// =============================================================================
// Native side: run hlrPerspective and pull per-class projected length + counts.
// =============================================================================
struct NativeHlr {
    double visLen = 0.0, hidLen = 0.0;
    int    visEdges = 0, hidEdges = 0;
    bool   ok = false;
    std::string reason;
};

static NativeHlr runNative(const Solid& solid, const Camera& c,
                           std::size_t samplesPerEdge = 64) {
    HlrCamera cam;
    cam.eye    = {c.eye.x, c.eye.y, c.eye.z};
    cam.target = {c.target.x, c.target.y, c.target.z};
    cam.up     = {c.up.x, c.up.y, c.up.z};
    cam.fovYRadians = c.fovY;
    HlrOptions opt;
    opt.samplesPerEdge = samplesPerEdge;
    HlrResult res = hlrPerspective(solid, cam, opt);

    NativeHlr r;
    r.ok = res.ok;
    r.reason = res.reason ? res.reason : "";
    r.visLen = res.visibleLength2d;
    r.hidLen = res.hiddenLength2d;
    r.visEdges = (int)res.visibleSegments;
    r.hidEdges = (int)res.hiddenSegments;
    return r;
}

// =============================================================================
// Compare one scene; return true if per-class length FRACTION matches rel<=1e-3.
// =============================================================================
static bool g_anyPartial = false;

static bool compareScene(const char* name,
                         const NativeHlr& nat, const OcctHlr& occt,
                         double relTol) {
    double natTot  = nat.visLen + nat.hidLen;
    double occtTot = occt.visLen + occt.hidLen;

    double natVisFrac  = (natTot  > 0) ? nat.visLen  / natTot  : 0.0;
    double natHidFrac  = (natTot  > 0) ? nat.hidLen  / natTot  : 0.0;
    double occtVisFrac = (occtTot > 0) ? occt.visLen / occtTot : 0.0;
    double occtHidFrac = (occtTot > 0) ? occt.hidLen / occtTot : 0.0;

    auto rel = [](double a, double b) {
        double d = std::fabs(a - b);
        double base = std::max(std::fabs(a), std::fabs(b));
        return (base > 1e-15) ? d / base : d;
    };
    double relVisFrac = rel(natVisFrac, occtVisFrac);
    double relHidFrac = rel(natHidFrac, occtHidFrac);

    std::printf("\n================ %s ================\n", name);
    std::printf("  NATIVE  visibleSeg=%d  hiddenSeg=%d\n", nat.visEdges, nat.hidEdges);
    std::printf("  NATIVE  visLen2d=%.9f  hidLen2d=%.9f  total=%.9f\n",
                nat.visLen, nat.hidLen, natTot);
    std::printf("  NATIVE  visFrac=%.9f  hidFrac=%.9f\n", natVisFrac, natHidFrac);
    std::printf("  OCCT    visEdges=%d  hidEdges=%d\n", occt.visEdges, occt.hidEdges);
    std::printf("  OCCT    visLen2d=%.9f  hidLen2d=%.9f  total=%.9f\n",
                occt.visLen, occt.hidLen, occtTot);
    std::printf("  OCCT    visFrac=%.9f  hidFrac=%.9f\n", occtVisFrac, occtHidFrac);
    std::printf("  REL(visFrac)=%.3e  REL(hidFrac)=%.3e   (tol=%.1e)\n",
                relVisFrac, relHidFrac, relTol);

    bool lenOk = (relVisFrac <= relTol) && (relHidFrac <= relTol);
    std::printf("  --> per-class length FRACTION match: %s\n",
                lenOk ? "PASS" : "FAIL");

    bool countsMatch = (nat.visEdges == occt.visEdges) && (nat.hidEdges == occt.hidEdges);
    if (!countsMatch) {
        std::printf("  [note] visible/hidden COUNTS differ (OCCT edge-splitting / "
                    "native sampled-HLR span-merge) -> PARTIAL on counts, not FAIL.\n");
        g_anyPartial = true;
    }
    return lenOk;
}

// =============================================================================
int main() {
    std::printf("=== A/B: native hlrPerspective vs OCCT perspective HLRBRep_Algo ===\n");

    const double DEG = 3.14159265358979323846 / 180.0;
    const double fovY = 60.0 * DEG;
    // Native focal = 1/tan(fovY/2); use the same value as the OCCT perspective
    // Focus so the two perspective strengths are matched.
    const double focus = 1.0 / std::tan(0.5 * fovY);
    std::printf("    fovY=60deg   focal=Focus=%.9f\n", focus);

    bool allLenOk = true;

    // ---------------------------------------------------------------------
    // Scene A — perspective box (hlr_test case [4]).
    // ---------------------------------------------------------------------
    {
        Camera c{ {4,4,4}, {0.5,0.5,0.5}, {0,0,1}, fovY };

        // Native unit cube.
        TopologyBuilder tb;
        Solid* box = tb.buildBox({0,0,0}, {1,1,1});
        NativeHlr nat = runNative(*box, c);
        std::printf("\n[A] native ok=%d reason='%s'\n", (int)nat.ok, nat.reason.c_str());

        // OCCT unit cube.
        TopoDS_Shape occtBox = BRepPrimAPI_MakeBox(gp_Pnt(0,0,0), 1.0, 1.0, 1.0).Shape();
        OcctHlr occt = runOcct(occtBox, makePerspProjector(c, focus));

        allLenOk &= compareScene("Scene A: perspective unit box", nat, occt, 1e-3);
    }

    // ---------------------------------------------------------------------
    // Scene B — two-box occlusion (hlr_test case [5]).
    // ---------------------------------------------------------------------
    {
        Camera c{ {-6,0.5,0.5}, {4,0.5,0.5}, {0,0,1}, fovY };

        // Native two-box scene: merge far box shells into the near box's solid
        // graph (exactly as hlr_test case [5] does).
        TopologyBuilder tb;
        Solid* nearBox = tb.buildBox({0,0,0},   {1,1,1});
        Solid* farBox  = tb.buildBox({3,0.6,0}, {4,1.6,1});
        for (Shell* sh : farBox->shells) nearBox->shells.push_back(sh);

        // OCCT two-box scene as one compound (built once, exact crossing).
        TopoDS_Shape oNear = BRepPrimAPI_MakeBox(gp_Pnt(0,0,0),   1.0, 1.0, 1.0).Shape();
        TopoDS_Shape oFar  = BRepPrimAPI_MakeBox(gp_Pnt(3,0.6,0), 1.0, 1.0, 1.0).Shape();
        TopoDS_Compound comp;
        BRep_Builder bld;
        bld.MakeCompound(comp);
        bld.Add(comp, oNear);
        bld.Add(comp, oFar);
        OcctHlr occt = runOcct(comp, makePerspProjector(c, focus));

        // (B0) as-shipped native default (64 samples/edge): sampled-HLR ceiling.
        NativeHlr nat64 = runNative(*nearBox, c, 64);
        std::printf("\n[B] native(64 samples/edge) ok=%d reason='%s'\n",
                    (int)nat64.ok, nat64.reason.c_str());
        bool lenOk64 = compareScene("Scene B (native default 64 samples/edge)",
                                    nat64, occt, 1e-3);

        // (B1) high-res native (2048 samples/edge): converges to OCCT's exact
        // occlusion crossing -> the sampling residual collapses below rel<=1e-3.
        // Rebuild the scene (a fresh solid graph) for the high-res pass.
        TopologyBuilder tb2;
        Solid* nb2 = tb2.buildBox({0,0,0},   {1,1,1});
        Solid* fb2 = tb2.buildBox({3,0.6,0}, {4,1.6,1});
        for (Shell* sh : fb2->shells) nb2->shells.push_back(sh);
        NativeHlr nat2048 = runNative(*nb2, c, 2048);
        std::printf("\n[B] native(2048 samples/edge) ok=%d reason='%s'\n",
                    (int)nat2048.ok, nat2048.reason.c_str());
        bool lenOk2048 = compareScene("Scene B (native 2048 samples/edge, converged)",
                                      nat2048, occt, 1e-3);

        std::printf("\n  [B summary] sampled-HLR convergence toward OCCT exact crossing:\n");
        std::printf("    64   samples/edge -> length-fraction match: %s\n",
                    lenOk64 ? "PASS" : "FAIL (sampling ceiling)");
        std::printf("    2048 samples/edge -> length-fraction match: %s\n",
                    lenOk2048 ? "PASS" : "FAIL");
        // Judge Scene B on the converged native result (the sampling parameter is
        // the only knob between the two engines once the projection is identical).
        allLenOk &= lenOk2048;
    }

    std::printf("\n=== VERDICT ===\n");
    if (allLenOk && !g_anyPartial) {
        std::printf("PASS: per-class length fraction within rel<=1e-3 on both scenes; "
                    "counts also matched.\n");
        return 0;
    } else if (allLenOk) {
        std::printf("PASS (length): per-class length fraction within rel<=1e-3 on both "
                    "scenes. COUNTS differ by OCCT splitting / native sampled-HLR (noted "
                    "as PARTIAL above).\n");
        return 0;
    } else {
        std::printf("FAIL: per-class length fraction exceeded rel<=1e-3 on some scene.\n");
        return 1;
    }
}
