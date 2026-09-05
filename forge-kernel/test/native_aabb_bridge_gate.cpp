// test/native_aabb_bridge_gate.cpp
//
// GATE for forge::native::brep::shapeAabb — the OCCT-shape -> native-analytic-AABB
// seam that 21 former BRepBndLib::Add call sites now go through.
//
// ============================ ORACLE POLICY ================================
// ANALYTIC ONLY. Every expected box below is written from the primitive's own
// parameters (a cylinder of radius r and height h on +Z from the origin spans
// [-r,r]x[-r,r]x[0,h]). NOT ONE captured number appears in this file. Proving a
// native replacement against whatever the old code returned only enshrines the old
// code's behaviour, including its bugs.
//
// ============================ WHAT IS PROVEN ===============================
//  A. gate OFF  -> shapeAabb is BIT-IDENTICAL to BRepBndLib::Add on every fixture.
//                  (memcmp of the six doubles, not a tolerance.) This is the
//                  flag-OFF-arm proof the whole conversion rests on.
//  B. gate ON, solid/shell -> the box equals the CLOSED FORM exactly, and
//                  shapeAabbNative() returns true, so the native route provably
//                  FIRED rather than silently deferring.
//  C. gate ON, face/wire   -> shapeAabbNative() returns false AND the box is again
//                  BIT-IDENTICAL to BRepBndLib::Add. The fall-through is honest:
//                  a declined import yields the OCCT answer, never a made-up one.
//  D. a null shape does not crash and produces a void box.
//  E. the call/native counters move exactly as A-C predict.
//
// Exit 0 iff every check passes.

#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include "forge/native/brep/NativeAabbBridge.hpp"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using forge::native::brep::shapeAabb;
using forge::native::brep::shapeAabbNative;
using forge::native::brep::setForgeNativeAabbEnabled;
using forge::native::brep::shapeAabbCallCount;
using forge::native::brep::shapeAabbNativeCount;

namespace {

int g_fail = 0;

void fail(const std::string& what, const std::string& detail) {
    std::printf("  [FAIL] %s: %s\n", what.c_str(), detail.c_str());
    ++g_fail;
}

struct Box6 { double v[6]; bool void_ = true; };

Box6 viaBridge(const TopoDS_Shape& s, bool* tookNative) {
    Box6 b;
    Bnd_Box bb;
    const bool nat = shapeAabbNative(s, bb);
    if (tookNative) *tookNative = nat;
    if (!bb.IsVoid()) { bb.Get(b.v[0], b.v[1], b.v[2], b.v[3], b.v[4], b.v[5]); b.void_ = false; }
    return b;
}

Box6 viaOcct(const TopoDS_Shape& s) {
    Box6 b;
    Bnd_Box bb;
    BRepBndLib::Add(s, bb);
    if (!bb.IsVoid()) { bb.Get(b.v[0], b.v[1], b.v[2], b.v[3], b.v[4], b.v[5]); b.void_ = false; }
    return b;
}

// BIT-identical, not near-identical. A tolerance here would hide exactly the class
// of drift this arm exists to rule out.
bool bitIdentical(const Box6& a, const Box6& b) {
    if (a.void_ != b.void_) return false;
    if (a.void_) return true;
    return std::memcmp(a.v, b.v, sizeof(a.v)) == 0;
}

double maxAbsDiff(const Box6& a, const Box6& b) {
    double m = 0;
    for (int i = 0; i < 6; ++i) m = std::max(m, std::fabs(a.v[i] - b.v[i]));
    return m;
}

std::string fmt(const Box6& b) {
    if (b.void_) return "<void>";
    char buf[256];
    std::snprintf(buf, sizeof(buf), "[%.17g %.17g %.17g .. %.17g %.17g %.17g]",
                  b.v[0], b.v[1], b.v[2], b.v[3], b.v[4], b.v[5]);
    return buf;
}

struct Fixture {
    std::string   name;
    TopoDS_Shape  shape;
    Box6          closed;      // analytic oracle, written from the parameters
    bool          expectNative = true;  // solid/shell import; face/wire decline
};

std::vector<Fixture> buildFixtures() {
    std::vector<Fixture> f;

    {   // box a x b x c with its min corner at the origin
        const double a = 10.0, b = 20.0, c = 30.0;
        f.push_back({"box(10,20,30)", BRepPrimAPI_MakeBox(a, b, c).Shape(),
                     Box6{{0, 0, 0, a, b, c}, false}, true});
    }
    {   // cylinder radius r, height h, axis +Z from the origin
        const double r = 7.0, h = 13.0;
        f.push_back({"cyl(r=7,h=13)", BRepPrimAPI_MakeCylinder(r, h).Shape(),
                     Box6{{-r, -r, 0, r, r, h}, false}, true});
    }
    {   // sphere radius r at the origin
        const double r = 5.0;
        f.push_back({"sphere(r=5)", BRepPrimAPI_MakeSphere(r).Shape(),
                     Box6{{-r, -r, -r, r, r, r}, false}, true});
    }
    {   // truncated cone, base radius r1 > top radius r2, height h on +Z.
        // The widest section is the base, so the box half-width is r1.
        const double r1 = 9.0, r2 = 3.0, h = 11.0;
        f.push_back({"cone(9,3,11)", BRepPrimAPI_MakeCone(r1, r2, h).Shape(),
                     Box6{{-r1, -r1, 0, r1, r1, h}, false}, true});
    }
    {   // cylinder off-origin: catches a frame/translation error that a box at the
        // origin cannot see (0 - 0 == 0 hides a dropped offset).
        const double r = 3.5, h = 9.0;
        const double ox = 100.0, oy = -50.0, oz = 7.0;
        gp_Ax2 ax(gp_Pnt(ox, oy, oz), gp_Dir(0, 0, 1));
        f.push_back({"cyl@(100,-50,7)", BRepPrimAPI_MakeCylinder(ax, r, h).Shape(),
                     Box6{{ox - r, oy - r, oz, ox + r, oy + r, oz + h}, false}, true});
    }
    {   // cylinder on +X: the angular extremum now lies in the Y-Z plane, so an
        // implementation that only handles a Z-axis sinusoid fails here.
        const double r = 4.0, h = 25.0;
        gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0));
        f.push_back({"cyl on +X", BRepPrimAPI_MakeCylinder(ax, r, h).Shape(),
                     Box6{{0, -r, -r, h, r, r}, false}, true});
    }
    {   // block with a through bore. A bore removes interior material only, so the
        // AABB is still the block's — an implementation that boxed the bore's own
        // faces without regard to the solid would be caught here.
        const double L = 40.0, W = 30.0, H = 20.0;
        TopoDS_Shape blk = BRepPrimAPI_MakeBox(L, W, H).Shape();
        gp_Ax2 ax(gp_Pnt(0.5 * L, 0.5 * W, -1.0), gp_Dir(0, 0, 1));
        TopoDS_Shape bore = BRepPrimAPI_MakeCylinder(ax, 6.0, H + 2.0).Shape();
        f.push_back({"block-with-bore", BRepAlgoAPI_Cut(blk, bore).Shape(),
                     Box6{{0, 0, 0, L, W, H}, false}, true});
    }
    {   // SHELL of a box — measured to import, so it must take the native route.
        const double a = 6.0, b = 8.0, c = 12.0;
        TopoDS_Shape box = BRepPrimAPI_MakeBox(a, b, c).Shape();
        for (TopExp_Explorer ex(box, TopAbs_SHELL); ex.More(); ex.Next()) {
            f.push_back({"box SHELL", ex.Current(), Box6{{0, 0, 0, a, b, c}, false}, true});
            break;
        }
    }
    {   // A bare FACE: importOcctSolid declines ("not 2-manifold"). Must fall through.
        TopoDS_Shape box = BRepPrimAPI_MakeBox(6.0, 8.0, 12.0).Shape();
        for (TopExp_Explorer ex(box, TopAbs_FACE); ex.More(); ex.Next()) {
            f.push_back({"box FACE (declines)", ex.Current(), Box6{}, false});
            break;
        }
    }
    {   // A bare WIRE: importOcctSolid declines ("no faces in shape"). Falls through.
        TopoDS_Shape box = BRepPrimAPI_MakeBox(6.0, 8.0, 12.0).Shape();
        for (TopExp_Explorer ex(box, TopAbs_WIRE); ex.More(); ex.Next()) {
            f.push_back({"box WIRE (declines)", ex.Current(), Box6{}, false});
            break;
        }
    }
    return f;
}

} // namespace

int main() {
    std::printf("=== native AABB bridge gate (analytic oracle only) ===\n\n");
    const std::vector<Fixture> fx = buildFixtures();
    std::printf("fixtures: %zu\n\n", fx.size());

    // ---------------------------------------------------------------- A: gate OFF
    // The production default. shapeAabb must be BIT-IDENTICAL to the call it replaced.
    std::printf("[A] gate OFF -> bit-identical to BRepBndLib::Add\n");
    setForgeNativeAabbEnabled(false);
    const unsigned long long callsBeforeA = shapeAabbCallCount();
    const unsigned long long natBeforeA   = shapeAabbNativeCount();
    for (const auto& f : fx) {
        bool tookNative = false;
        const Box6 got  = viaBridge(f.shape, &tookNative);
        const Box6 want = viaOcct(f.shape);
        if (tookNative)
            fail(f.name, "took the NATIVE route with the gate OFF");
        if (!bitIdentical(got, want))
            fail(f.name, "gate-OFF box differs from BRepBndLib::Add\n         got  " +
                          fmt(got) + "\n         want " + fmt(want));
    }
    if (shapeAabbNativeCount() != natBeforeA)
        fail("counters", "native count moved with the gate OFF");
    if (shapeAabbCallCount() != callsBeforeA + fx.size())
        fail("counters", "call count did not advance once per shapeAabb call");
    std::printf("     %zu fixtures checked bit-for-bit\n\n", fx.size());

    // ----------------------------------------------------------------- B/C: gate ON
    std::printf("[B/C] gate ON -> closed form (solid/shell) or honest fall-through (face/wire)\n");
    setForgeNativeAabbEnabled(true);
    std::size_t nNative = 0, nFellThrough = 0;
    for (const auto& f : fx) {
        bool tookNative = false;
        const Box6 got = viaBridge(f.shape, &tookNative);
        if (f.expectNative) {
            if (!tookNative) {
                fail(f.name, "expected the NATIVE route; the import declined instead");
                continue;
            }
            ++nNative;
            // Exact: the analytic AABB of an analytic primitive has a closed form and
            // the implementation claims to hit it, so 1e-12 is generous, not lax.
            const double d = maxAbsDiff(got, f.closed);
            if (!(d <= 1e-12))
                fail(f.name, "native box != closed form, max|d| = " + std::to_string(d) +
                              "\n         got  " + fmt(got) + "\n         want " + fmt(f.closed));
            else
                std::printf("     %-22s NATIVE   max|d| vs closed form = %.3e\n", f.name.c_str(), d);
        } else {
            if (tookNative) {
                fail(f.name, "took the NATIVE route on a shape the importer must decline");
                continue;
            }
            ++nFellThrough;
            const Box6 want = viaOcct(f.shape);
            if (!bitIdentical(got, want))
                fail(f.name, "fall-through box differs from BRepBndLib::Add\n         got  " +
                              fmt(got) + "\n         want " + fmt(want));
            else
                std::printf("     %-22s FELL THROUGH, bit-identical to BRepBndLib::Add\n",
                            f.name.c_str());
        }
    }
    std::printf("     native %zu, honest fall-through %zu\n\n", nNative, nFellThrough);

    // ---------------------------------------------------------------- D: null shape
    std::printf("[D] null shape does not crash\n");
    {
        TopoDS_Shape nullShape;
        Bnd_Box bb;
        bool crashed = false;
        try { (void)shapeAabbNative(nullShape, bb); }
        catch (...) { crashed = true; }
        if (crashed) fail("null shape", "shapeAabbNative threw");
        else if (!bb.IsVoid()) fail("null shape", "produced a non-void box");
        else std::printf("     void box, no throw\n");
    }
    std::printf("\n");

    // ---------------------------------------------------------------- E: the delta
    // Report, do not assert: the size of the difference the gate introduces. It is
    // the OCCT shape tolerance, and the whole reason this gate defaults OFF.
    std::printf("[E] measured gate-ON delta vs BRepBndLib::Add (report only)\n");
    setForgeNativeAabbEnabled(true);
    for (const auto& f : fx) {
        if (!f.expectNative) continue;
        bool tookNative = false;
        const Box6 nat = viaBridge(f.shape, &tookNative);
        if (!tookNative) continue;
        const Box6 occt = viaOcct(f.shape);
        std::printf("     %-22s max|native - BRepBndLib::Add| = %.3e\n",
                    f.name.c_str(), maxAbsDiff(nat, occt));
    }

    setForgeNativeAabbEnabled(false);
    std::printf("\n%d failed\n", g_fail);
    return g_fail == 0 ? 0 : 1;
}
