// ─────────────────────────────────────────────────────────────────────────────
// shell_override_refusal_gate.cpp — a per-face override the engine cannot build
// must be REFUSED, never silently dropped.
//
// THE DEFECT. part::shellMultiThickness builds the base shell, then for each
// per-face override builds a second thick solid and fuses it in. When that second
// construction came back null the loop did `continue` — a skip inherited from the
// OCCT path's `!IsDone()`. TKOffset family G deleted OCCT's MakeThickSolid, and the
// native engine declines far more often than OCCT failed, so the skip started
// firing on ordinary requests: the caller got the UNIFORM shell — its request with
// the override deleted — and a success.
//
// MEASURED on box(10), face 0 removed, base wall 1.0, override on face 1:
//     override   OCCT (origin/archdisc)   native + skip (PR #245 @ 8085b49a)
//     1.5        632.5                     632.5
//     4.0        980.0                     980.0
//     5.0        809.524                   424.0   <- the shell WITHOUT the override
//     6.0        1000.0                    424.0
//     20.0       1000.0                    424.0
//
// THE REFERENCES ARE CLOSED FORMS, not either engine's output. This entry point
// fuses two hollow bodies, so the void that survives is the INTERSECTION of the two
// cavities, and each fused body's wall closes the other's mouth:
//     base    (wall 1, mouth at x=0):   x in [0, 9],    y,z in [1, 9]
//     override(wall t, mouth at x=10):  x in [t, 10],   y,z in [t, 10-t]
//     V(t) = 1000 - (9 - t) * (10 - 2t)^2          for 1 < t < 5
//     V(1.5) = 632.5   V(4.0) = 980   V(4.9) = 999.836
// That is what the smoke (part_features_smoke.js) and kernel_correctness_gate G2
// already assert for t = 1.5, extended here to the two values nearest the edge.
//
// WHAT IT ASSERTS
//   controls   t = 1.5, 4.0, 4.9 (and -1.5, the sign is ignored) BUILD, each equal
//              to V(t), outer bbox exactly [0,10]^3, BRepCheck-valid — so the gate
//              cannot pass by having become "refuse every override";
//   refusals   t = 5.0, 6.0, 20.0 and -6.0 THROW, the message names the override
//              and carries the engine's reason, and no handle is returned — in
//              particular never the 424 uniform shell.
//
// usage: shell_override_refusal_gate   (exit 0 iff every check holds)
// ─────────────────────────────────────────────────────────────────────────────
#include <cmath>
#include <cstdio>
#include <exception>
#include <string>

#include "forge/Features.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>

namespace {

int g_fail = 0, g_checks = 0;

void ok(bool cond, const std::string& what) {
    ++g_checks;
    std::printf("  %-5s %s\n", cond ? "ok" : "FAIL", what.c_str());
    if (!cond) ++g_fail;
}

struct Outcome {
    bool threw = false;
    std::string msg;
    double vol = 0.0;
    double b[6] = {0, 0, 0, 0, 0, 0};
    bool valid = false;
};

Outcome multi(double t) {
    Outcome o;
    try {
        forge::part::FaceThickness ovr{};
        ovr.faceId = 1;
        ovr.thickness = t;
        const forge::ShapeHandle h = forge::part::shellMultiThickness(
            forge::makeBox(10, 10, 10), {0}, 1.0, {ovr});
        const TopoDS_Shape& s = forge::ShapeRegistry::instance().get(h);
        GProp_GProps p;
        BRepGProp::VolumeProperties(s, p);
        o.vol = p.Mass();
        // Tolerance-free box: a vertex-and-geometry optimal box, so an exact
        // envelope reads exactly and a grown one cannot hide inside a gap.
        Bnd_Box bb;
        BRepBndLib::AddOptimal(s, bb, Standard_False, Standard_False);
        bb.Get(o.b[0], o.b[1], o.b[2], o.b[3], o.b[4], o.b[5]);
        o.valid = BRepCheck_Analyzer(s).IsValid();
    } catch (const std::exception& e) {
        o.threw = true;
        o.msg = e.what();
    }
    return o;
}

double closedForm(double t) {  // valid for 1 < |t| < 5
    const double a = std::fabs(t);
    return 1000.0 - (9.0 - a) * (10.0 - 2.0 * a) * (10.0 - 2.0 * a);
}

}  // namespace

int main() {
    std::printf("[shell-override-refusal] an override the engine cannot build is a "
                "REFUSAL, never the shell without it\n");

    const double UNIFORM = 1000.0 - 8.0 * 8.0 * 9.0;  // 424: the override deleted

    for (double t : {1.5, -1.5, 4.0, 4.9}) {
        const Outcome o = multi(t);
        char tag[64];
        std::snprintf(tag, sizeof tag, "override %+.1f", t);
        if (o.threw) {
            ok(false, std::string(tag) + " BUILDS (control) — it threw: " + o.msg);
            continue;
        }
        const double ref = closedForm(t);
        std::printf("  ----  %s  V=%.9f  closed form %.9f\n", tag, o.vol, ref);
        ok(std::fabs(o.vol - ref) <= 1.0e-9 * 1000.0,
           std::string(tag) + " equals the closed form (9-t)(10-2t)^2 removed");
        bool env = true;
        for (int k = 0; k < 3; ++k)
            env = env && std::fabs(o.b[k]) < 1.0e-7 && std::fabs(o.b[k + 3] - 10.0) < 1.0e-7;
        ok(env, std::string(tag) + " keeps the outer envelope exactly [0,10]^3");
        ok(o.valid, std::string(tag) + " is BRepCheck-valid");
    }

    for (double t : {5.0, 6.0, 20.0, -6.0}) {
        const Outcome o = multi(t);
        char tag[64];
        std::snprintf(tag, sizeof tag, "override %+.1f", t);
        if (!o.threw) {
            std::printf("  ----  %s  RETURNED V=%.9f%s\n", tag, o.vol,
                        std::fabs(o.vol - UNIFORM) < 1.0e-9
                            ? "  <- the uniform shell: the override was silently DROPPED"
                            : "");
        } else {
            std::printf("  ----  %s  refused: %s\n", tag, o.msg.c_str());
        }
        ok(o.threw, std::string(tag) + " is REFUSED (no handle returned)");
        ok(o.threw && o.msg.find("per-face override on face 1") != std::string::npos,
           std::string(tag) + " refusal names the override and its face");
        const auto l = o.msg.find('('), r = o.msg.find(')');
        ok(o.threw && l != std::string::npos && r != std::string::npos && r > l + 1,
           std::string(tag) + " refusal carries the engine's own reason, not an empty one");
    }

    std::printf("[shell-override-refusal] %d checks, %d failed\n", g_checks, g_fail);
    return g_fail ? 1 : 0;
}
