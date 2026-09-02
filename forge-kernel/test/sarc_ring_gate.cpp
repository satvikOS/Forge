// forge-kernel/test/sarc_ring_gate.cpp
//
// REGRESSION GATE — SARC SILENTLY DROPPED AN ARC WHOSE TWO ENDPOINTS WERE NOT
// EQUIDISTANT FROM ITS CENTRE, AND THE BUILD THAT NOTICED REPORTED ok:true.
//
// ================================ THE DEFECT ================================
//
// forge::extractWires built an arc's circle with r = |start - centre| ALONE and
// then handed BOTH stored endpoints to BRepBuilderAPI_MakeEdge(curve, P1, P2),
// which PROJECTS them onto the curve and refuses with PointProjectionFailed once
// one of them is further than Precision::Confusion() (1e-7 mm) off it. That
// refusal was read as `continue`. The arc vanished from the segment list, the
// ring it belonged to broke into two OPEN chains, and the caller extruded
// whichever fragment came back first. Nothing raised, and nothing reported it.
//
// THE TRIGGER, AS A PREDICATE — it is NOT "an arc":
//
//        | |end - centre| - |start - centre| |   >   1e-7 mm
//
// Arcs built by our own profile builders (profRRect and friends) derive both
// endpoints from the centre by exact arithmetic, so that quantity is BIT-ZERO
// and a rounded-rectangle repro can never fail. Arcs whose three points arrive
// as independently rounded data — a real CAD tree printed at six decimals, or
// solver output — miss by ~1e-7..1e-6.
//
// ============================== THE REPRODUCER ==============================
//
// Case 1 is ABC model 00001907: ONE closed 12-segment ring with four 45-degree
// r=2 arcs, extruded 19 mm. MEASURED before the fix, through the same entry this
// gate uses:
//
//     ok=true   error="first invalid solid is produced by op %31 EXTRUDE
//                      (line 31): not closed"
//     valid=false  volume=4222.610496  genus=1  faces=7  edges=16
//
// where the truth is 6240.66. On that ring the offending quantity measures
// 6.189e-07 for the two arcs that were dropped and 8.821e-08 for the two that
// survived — the SAME ring, differing only in which endpoint happened to define
// r. That asymmetry is the whole defect in one number.
//
// ============================== THE ORACLE ==================================
//
// VOLUME CANNOT VALIDATE GEOMETRY, so every case here is a VECTOR, and the
// reference for case 1 is TWO independent things:
//
//   (a) A CLOSED FORM. Area, perimeter and centroid of the ring by Green's
//       theorem — A = 1/2 oint (x dy - y dx), Cx = 1/(2A) oint x^2 dy,
//       Cy = -1/(2A) oint y^2 dx — evaluated exactly per segment (a line
//       analytically in t, an arc analytically in theta), with no kernel, no
//       OCCT and no tessellation anywhere in it. The constants below are that
//       evaluation. It was run under BOTH circle conventions — r = |start-centre|
//       and the perpendicular-bisector correction the repair uses — and they
//       agree to 6.6e-08 relative, so the oracle does not depend on the repair
//       it is checking.
//
//   (b) AN INDEPENDENT OCCT ARM, and an EXACT IoU against it. The arm never uses
//       the stated centre as a centre: it builds each arc with GC_MakeArcOfCircle
//       through THREE POINTS, which re-derives a circumcentre, so it is a
//       different algorithm on the same data. IoU = vol(A and B) / vol(A or B)
//       by two OCCT booleans — the only observable here that is not a summary.
//
// ============================== WHAT ELSE IT PINS ===========================
//
//   Case 2  THE PREDICATE ITSELF, on a minimal ring: one square corner replaced
//           by a 90-degree arc, built three ways that differ ONLY in a 5e-7 mm
//           radial nudge of a shared endpoint — dr=0 (under the trigger), dr on
//           the END (over it), dr on the START (over it, the other way round).
//           All three must build and agree. Before the fix, two of the three
//           lost the arc.
//   Case 3  THE BOUND IS LOUD. The same ring with a 1e-3 mm nudge is past what
//           any repair may absorb, and must be REFUSED BY NAME — never dropped,
//           and never silently rebuilt as something else.
//   Case 4  THE GATE THAT COULD NOT FAIL. compile() measured that a delivered
//           body was not a valid solid, NAMED the op that produced it, and
//           returned ok=true with that diagnosis sitting in `error`. Two boxes
//           fused along a single shared edge is the minimal witness; a plain box
//           and a corner-touching fuse are the positive controls that keep the
//           new ok=false from being a blanket refusal.
//
// ======================== PROOF THAT THIS GATE CAN FAIL ======================
//
// forge-kernel/test/sarc_ring_mutation.sh applies ONE mutation to the repair in
// src/Sketcher.cpp (the recovery branch is disabled — `if (!mk.IsDone())` becomes
// `if (false && !mk.IsDone())`), rebuilds this gate against the mutant, runs it,
// and restores the file. The mutant must make this gate exit non-zero; a gate
// that stays green against it is not testing the repair.
//
// BUILD: registered in forge-kernel/CMakeLists.txt as kernel.ab.sarc_ring_gate
// (FORGE_AB_GATES), linked against forge_kernel_core + the test OCCT toolkits.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

#include "forge/MassProps.hpp"
#include "forge/Topology.hpp"
#include "forge/ft/FeatureTree.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GProp_GProps.hxx>
#include <STEPControl_Reader.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace {

int g_pass = 0, g_total = 0;

void gate(bool ok, const std::string& what) {
    ++g_total;
    if (ok) ++g_pass;
    std::printf("    [%s] %s\n", ok ? "ok  " : "FAIL", what.c_str());
}

double rel(double a, double b) { return std::fabs(a - b) / std::max(std::fabs(b), 1e-12); }

// ---------------------------------------------------------------- the ring
struct V2 { double x, y; };
struct Seg { bool arc; int from, to, centre; };   // centre is -1 for a line

// ABC model 00001907's sketch, exactly as scripts/abc_ofs_to_ir.py emits it:
// twelve segments, four of them 45-degree r=2 arcs, coordinates at six decimals.
const V2 kPts1907[] = {
    /* 0*/ {  0.000000, -27.054456}, /* 1*/ {  0.000000,  -7.882883},
    /* 2*/ {  0.585786,  -6.468669}, /* 3*/ {  2.000000,  -7.882883},   // 3 = centre
    /* 4*/ { 50.325902,  43.271446}, /* 5*/ { 51.740115,  43.857232},
    /* 6*/ { 51.740115,  41.857232}, /* 7*/ { 65.911688,  43.857232},   // 6 = centre
    /* 8*/ { 65.911688,  46.857232}, /* 9*/ { 50.497475,  46.857232},
    /*10*/ { 49.083261,  46.271446}, /*11*/ { 50.497475,  44.857232},   // 11 = centre
    /*12*/ { -2.414214,  -5.226029}, /*13*/ { -3.000000,  -6.640242},
    /*14*/ { -1.000000,  -6.640242}, /*15*/ { -3.000000, -27.054456},   // 14 = centre
};
const Seg kRing1907[] = {
    {false,  0,  1, -1}, {true,  1,  2,  3}, {false,  2,  4, -1}, {true,  4,  5,  6},
    {false,  5,  7, -1}, {false,  7,  8, -1}, {false,  8,  9, -1}, {true,  9, 10, 11},
    {false, 10, 12, -1}, {true, 12, 13, 14}, {false, 13, 15, -1}, {false, 15,  0, -1},
};
const double kDepth1907 = 19.0;

// Emit the SKETCH / SPT / SLINE / SARC / SOLVE / EXTRUDE tree for a ring. Both
// arms of this gate read the SAME table, so they cannot drift apart.
std::string emitIr(const V2* pts, int nPts, const Seg* ring, int nSeg, double depth) {
    char buf[256];
    std::string ir = "%1 = SKETCH(XY)\n";
    for (int i = 0; i < nPts; ++i) {
        std::snprintf(buf, sizeof buf, "%%%d = SPT(%%1, %.9f, %.9f)\n", i + 2, pts[i].x, pts[i].y);
        ir += buf;
    }
    const int base = nPts + 2;
    for (int i = 0; i < nSeg; ++i) {
        const Seg& s = ring[i];
        if (s.arc)
            std::snprintf(buf, sizeof buf, "%%%d = SARC(%%%d, %%%d, %%%d)\n",
                          base + i, s.centre + 2, s.from + 2, s.to + 2);
        else
            std::snprintf(buf, sizeof buf, "%%%d = SLINE(%%%d, %%%d)\n",
                          base + i, s.from + 2, s.to + 2);
        ir += buf;
    }
    std::snprintf(buf, sizeof buf, "%%%d = SOLVE(%%1)\n%%%d = EXTRUDE(%%%d, %.9f, 0, 0, 1)\nRESULT(%%%d)\n",
                  base + nSeg, base + nSeg + 1, base + nSeg, depth, base + nSeg + 1);
    ir += buf;
    return ir;
}

// THE INDEPENDENT ARM. Every arc is built by GC_MakeArcOfCircle through THREE
// POINTS — start, a point ON the arc, end — so the stated centre is never used
// as a centre; OCCT re-derives a circumcentre from the three points. The mid
// point is taken at the mean of the two endpoint angles about the stated centre
// at the mean of the two endpoint radii, which is a point of the arc under
// either convention (they differ by < 1e-6 mm, five orders under the 1e-3 IoU
// bound this arm is used for).
TopoDS_Shape occtArm(const V2* pts, const Seg* ring, int nSeg, double depth) {
    BRepBuilderAPI_MakeWire mkw;
    for (int i = 0; i < nSeg; ++i) {
        const Seg& s = ring[i];
        const gp_Pnt a(pts[s.from].x, pts[s.from].y, 0.0);
        const gp_Pnt b(pts[s.to].x, pts[s.to].y, 0.0);
        if (!s.arc) {
            mkw.Add(BRepBuilderAPI_MakeEdge(a, b).Edge());
            continue;
        }
        const V2& c = pts[s.centre];
        const double r = 0.5 * (std::hypot(a.X() - c.x, a.Y() - c.y) +
                                std::hypot(b.X() - c.x, b.Y() - c.y));
        const double a0 = std::atan2(a.Y() - c.y, a.X() - c.x);
        double sweep = std::atan2(b.Y() - c.y, b.X() - c.x) - a0;
        while (sweep <= -M_PI) sweep += 2.0 * M_PI;
        while (sweep >   M_PI) sweep -= 2.0 * M_PI;
        const double am = a0 + 0.5 * sweep;
        const gp_Pnt m(c.x + r * std::cos(am), c.y + r * std::sin(am), 0.0);
        GC_MakeArcOfCircle mk(a, m, b);
        if (!mk.IsDone()) return TopoDS_Shape();
        mkw.Add(BRepBuilderAPI_MakeEdge(mk.Value()).Edge());
    }
    if (!mkw.IsDone()) return TopoDS_Shape();
    BRepBuilderAPI_MakeFace mkf(mkw.Wire(), Standard_True);
    if (!mkf.IsDone()) return TopoDS_Shape();
    return BRepPrimAPI_MakePrism(mkf.Face(), gp_Vec(0, 0, depth)).Shape();
}

double volumeOf(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps p;
    BRepGProp::VolumeProperties(s, p);
    return std::fabs(p.Mass());
}

// EXACT IoU = vol(A and B) / vol(A or B), by two OCCT booleans. Not a summary.
double exactIou(const TopoDS_Shape& a, const TopoDS_Shape& b) {
    if (a.IsNull() || b.IsNull()) return -1.0;
    const double inter = volumeOf(BRepAlgoAPI_Common(a, b).Shape());
    const double uni   = volumeOf(BRepAlgoAPI_Fuse(a, b).Shape());
    return uni > 0.0 ? inter / uni : -1.0;
}

// Arm A is read back from THE STEP THE KERNEL WROTE, not out of the shape
// registry: that is the artefact every downstream consumer actually receives,
// and it keeps this gate off the registry's native-vs-OCCT handle branch.
TopoDS_Shape readStep(const std::string& path) {
    STEPControl_Reader rd;
    if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) return TopoDS_Shape();
    rd.TransferRoots();
    return rd.OneShape();
}

// ------------------------------------------------ case 2/3: the minimal ring
// A 20 x 20 square whose top-right corner is replaced by a 90-degree r=5 arc.
// `bump` moves ONE shared endpoint RADIALLY away from the arc's centre by that
// many mm — which is exactly the quantity in the trigger predicate — and `onEnd`
// chooses WHICH endpoint, because the old defect was asymmetric in that choice.
struct MiniRing {
    std::vector<V2> pts;
    std::vector<Seg> ring;
    double dr;          // | |end-centre| - |start-centre| |, the trigger quantity
};

MiniRing miniRing(double bump, bool onEnd) {
    const double R = 5.0, H = 10.0;             // half-size 10, corner radius 5
    const double cx = H - R, cy = H - R;        // arc centre (5,5)
    V2 p0{-H, -H}, p1{H, -H}, p2{H, cy}, p3{cx, H}, p4{-H, H};
    // radial unit vectors of the two arc endpoints about (cx,cy): +x and +y.
    if (bump != 0.0) {
        if (onEnd) p3.y += bump;                // end   moves radially outward
        else       p2.x += bump;                // start moves radially outward
    }
    MiniRing m;
    m.pts = {p0, p1, p2, p3, p4, V2{cx, cy}};   // index 5 = the arc centre
    m.ring = {{false, 0, 1, -1}, {false, 1, 2, -1}, {true, 2, 3, 5},
              {false, 3, 4, -1}, {false, 4, 0, -1}};
    m.dr = std::fabs(std::hypot(p3.x - cx, p3.y - cy) - std::hypot(p2.x - cx, p2.y - cy));
    return m;
}

}  // namespace

int main() {
    std::printf("sarc_ring_gate — SARC's silent arc drop, and the ok:true that hid it\n\n");

    // ================================================================ CASE 1
    // THE REPRODUCER. Closed form + an independent OCCT arm + an exact IoU.
    //
    // Closed form (Green's theorem, evaluated per segment; see the header):
    //   area      328.455834105 mm^2      perimeter 224.626330817 mm
    //   centroid  (24.320692793, 16.343796767)
    // times a 19 mm extrusion:
    const double kVol1907  = 328.455834105 * kDepth1907;                 // 6240.660848
    const double kArea1907 = 224.626330817 * kDepth1907 + 2 * 328.455834105;  // 4924.811954
    const double kComX = 24.320692793, kComY = 16.343796767, kComZ = 0.5 * kDepth1907;
    const double kBox[6] = {-3.0, -27.054456, 0.0, 65.911688, 46.857232, kDepth1907};
    {
        std::printf("  [1] ABC 00001907 — one closed 12-segment ring, four 45-degree r=2 arcs\n");
        const std::string ir = emitIr(kPts1907, 16, kRing1907, 12, kDepth1907);
        const std::string stepPath =
            (std::filesystem::temp_directory_path() / "forge_sarc_ring_gate.step").string();
        forge::ft::CompileResult r = forge::ft::compileText(ir, stepPath);
        std::printf("      ok=%d valid=%d volume=%.6f faces=%ld edges=%ld error=%s\n",
                    (int)r.ok, (int)r.valid, r.volume, r.faceCount, r.edgeCount,
                    r.error.empty() ? "(none)" : r.error.c_str());
        gate(r.ok, "compiles: ok=true" + std::string(r.ok ? "" : " — " + r.error));
        gate(r.error.empty(), "  error string is empty on a success");
        gate(r.valid, "  the delivered body is a valid watertight solid");
        if (!r.ok || r.handle == 0) {
            std::printf("  [1] ABORTED — nothing to measure.\n");
            std::printf("sarc_ring_gate RESULT: %d/%d checks passed (gate did not complete)\n",
                        g_pass, g_total);
            return 1;
        }
        const forge::MassProperties mp = forge::massProperties(r.handle);
        forge::TopoSignature sig{};
        const bool haveTopo = forge::topologySignature(r.handle, sig);
        const double diag = std::sqrt(std::pow(kBox[3] - kBox[0], 2) +
                                      std::pow(kBox[4] - kBox[1], 2) +
                                      std::pow(kBox[5] - kBox[2], 2));
        std::printf("      volume %.6f  area %.6f  com (%.6f, %.6f, %.6f)\n",
                    mp.volume, mp.area, mp.cx, mp.cy, mp.cz);
        gate(rel(mp.volume, kVol1907) <= 1e-6,
             "  volume == closed form 6240.660848 (rel<=1e-6, measured " +
                 std::to_string(rel(mp.volume, kVol1907)) + ")");
        gate(rel(mp.area, kArea1907) <= 1e-6,
             "  surface area == closed form 4924.811954 (rel<=1e-6)");
        const double dcom = std::sqrt(std::pow(mp.cx - kComX, 2) + std::pow(mp.cy - kComY, 2) +
                                      std::pow(mp.cz - kComZ, 2)) / diag;
        gate(dcom <= 1e-6, "  centre of mass == closed form (<=1e-6 of the diagonal)");
        double dbox = 0.0;
        for (int i = 0; i < 3; ++i) {
            dbox = std::max(dbox, std::fabs(r.bboxMin[i] - kBox[i]));
            dbox = std::max(dbox, std::fabs(r.bboxMax[i] - kBox[3 + i]));
        }
        gate(dbox / diag <= 1e-5, "  bbox == the ring's own extremes (<=1e-5 of the diagonal)");
        gate(r.faceCount == 14, "  faceCount == 14 (12 lateral + 2 caps)");
        gate(r.edgeCount == 36, "  edgeCount == 36");
        gate(haveTopo && sig.vertexCount == 24, "  vertexCount == 24");
        gate(haveTopo && sig.genus == 0, "  genus == 0");
        gate(haveTopo && sig.shellCount == 1, "  shellCount == 1");
        // The pre-fix build measured 4222.610496 / genus 1 / 7 faces. Assert the
        // gate would have SEEN that, so a future regression cannot pass by being
        // "close enough" on volume alone.
        gate(rel(4222.610496, kVol1907) > 0.3,
             "  (the pre-fix 4222.610496 is 32% off — this gate rejects it)");

        const TopoDS_Shape occt = occtArm(kPts1907, kRing1907, 12, kDepth1907);
        const double vOcct = volumeOf(occt);
        std::printf("      independent OCCT arm (3-point arcs): volume %.6f\n", vOcct);
        gate(vOcct > 0.0 && rel(vOcct, kVol1907) <= 1e-6,
             "  the independent arm agrees with the closed form (rel<=1e-6)");
        const TopoDS_Shape kern = readStep(stepPath);
        gate(!kern.IsNull(), "  the kernel's own STEP reads back");
        const double iou = exactIou(kern, occt);
        std::printf("      exact IoU vol(A and B)/vol(A or B) = %.9f\n", iou);
        gate(iou >= 0.999999, "  exact IoU vs the independent arm >= 0.999999");
        std::printf("\n");
    }

    // ================================================================ CASE 2
    {
        std::printf("  [2] THE TRIGGER PREDICATE — one square corner as a 90-degree r=5 arc,\n"
                    "      perturbed by 5e-7 mm across the 1e-7 mm trigger\n");
        const double depth = 4.0;
        struct Arm { const char* name; double bump; bool onEnd; } arms[] = {
            {"dr = 0            (under the trigger)", 0.0,   false},
            {"dr = 5e-7 on END  (over  the trigger)", 5e-7,  true},
            {"dr = 5e-7 on START(over  the trigger)", 5e-7,  false},
        };
        double vref = 0.0;
        for (int i = 0; i < 3; ++i) {
            MiniRing m = miniRing(arms[i].bump, arms[i].onEnd);
            const std::string ir = emitIr(m.pts.data(), (int)m.pts.size(),
                                          m.ring.data(), (int)m.ring.size(), depth);
            forge::ft::CompileResult r = forge::ft::compileText(ir, "");
            std::printf("      %s  dr=%.3e  ok=%d valid=%d vol=%.9f\n",
                        arms[i].name, m.dr, (int)r.ok, (int)r.valid, r.volume);
            // The case must actually straddle the trigger, or it proves nothing.
            gate(i == 0 ? (m.dr <= 1e-7) : (m.dr > 1e-7),
                 std::string("      the case is on the intended side of the 1e-7 trigger (dr=") +
                     std::to_string(m.dr) + ")");
            gate(r.ok && r.valid, std::string("      builds a valid solid") +
                                  (r.ok ? "" : " — " + r.error));
            if (i == 0) vref = r.volume;
            else
                gate(vref > 0 && rel(r.volume, vref) <= 1e-6,
                     "      volume agrees with the unperturbed ring (rel<=1e-6)");
            // A dropped arc turns the ring into an open chain: the closing chord
            // replaces the arc and the solid LOSES the corner fillet's material.
            // That is what the volume check above would catch.
        }
        std::printf("\n");
    }

    // ================================================================ CASE 3
    {
        std::printf("  [3] THE BOUND IS LOUD — a 1e-3 mm nudge is past any repair\n");
        MiniRing m = miniRing(1e-3, true);
        const std::string ir = emitIr(m.pts.data(), (int)m.pts.size(),
                                      m.ring.data(), (int)m.ring.size(), 4.0);
        forge::ft::CompileResult r = forge::ft::compileText(ir, "");
        std::printf("      dr=%.3e  ok=%d  error=%s\n", m.dr, (int)r.ok,
                    r.error.empty() ? "(none)" : r.error.c_str());
        gate(m.dr > 1e-5, "      the case really is past the 10 um bound");
        gate(!r.ok, "      REFUSED (ok=false) rather than dropped");
        gate(r.error.find("equidistant") != std::string::npos,
             "      and the refusal NAMES the cause (\"not equidistant from its centre\")");
        std::printf("\n");
    }

    // ================================================================ CASE 4
    {
        std::printf("  [4] THE GATE THAT COULD NOT FAIL — ok must not be true for an\n"
                    "      invalid body the kernel has already diagnosed\n");
        // Two 10-mm boxes sharing exactly ONE EDGE. The fuse is non-manifold.
        // MEASURED before the fix: ok=true, valid=false, error="first invalid solid
        // is produced by op %3 FUSE (line 3): not manifold (...)".
        forge::ft::CompileResult bad = forge::ft::compileText(
            "%1 = BOX(10, 10, 10, 0, 0, 0)\n"
            "%2 = BOX(10, 10, 10, 10, 10, 0)\n"
            "%3 = FUSE(%1, %2)\n"
            "RESULT(%3)\n", "");
        std::printf("      edge-touching FUSE: ok=%d valid=%d error=%s\n",
                    (int)bad.ok, (int)bad.valid, bad.error.empty() ? "(none)" : bad.error.c_str());
        gate(!bad.valid, "      the kernel still MEASURES it as invalid");
        gate(!bad.ok, "      and now REPORTS that: ok == false");
        gate(!bad.error.empty(), "      with a non-empty error naming the op");

        // POSITIVE CONTROLS — the new ok=false must not be a blanket refusal.
        forge::ft::CompileResult box = forge::ft::compileText(
            "%1 = BOX(10, 10, 10, 0, 0, 0)\nRESULT(%1)\n", "");
        gate(box.ok && box.valid && box.error.empty() && rel(box.volume, 1000.0) <= 1e-9,
             "      control: a plain BOX still succeeds (ok, valid, vol==1000)");
        forge::ft::CompileResult corner = forge::ft::compileText(
            "%1 = BOX(10, 10, 10, 0, 0, 0)\n"
            "%2 = BOX(10, 10, 10, 10, 10, 10)\n"
            "%3 = FUSE(%1, %2)\n"
            "RESULT(%3)\n", "");
        gate(corner.ok && corner.valid && corner.error.empty(),
             "      control: a corner-touching FUSE the kernel calls valid still succeeds");
        std::printf("\n");
    }

    // ---- ASSERT THE COUNT OF CHECKS ACTUALLY EXECUTED ----------------------
    const int kExpectedChecks = 32;
    std::printf("sarc_ring_gate RESULT: %d/%d checks passed\n", g_pass, g_total);
    if (g_total != kExpectedChecks) {
        std::printf("  [FAIL] GATE INTEGRITY: executed %d checks, expected %d — "
                    "the gate did not run what it claims to run.\n", g_total, kExpectedChecks);
        return 2;
    }
    std::printf("  gate integrity: %d/%d checks executed as declared\n", g_total, kExpectedChecks);
    return (g_pass == g_total) ? 0 : 1;
}
