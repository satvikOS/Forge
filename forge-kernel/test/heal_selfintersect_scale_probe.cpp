// heal_selfintersect_scale_probe.cpp — T-138. MEASURE the self-intersection scan's
// cost at the face count where it was reported to fall off a cliff.
//
// WHY A SYNTHETIC FIXTURE. The ledger's repro is "a box with ONE through-bore, 400
// imported faces, 297.191 s". Building that needs the importer and the boolean
// engine; this probe needs neither, because the defect is not about bores. It is
// about FACE COUNT and the absence of any spatial rejection: the scan is O(F^2)
// face pairs x O(T_i*T_j) exact triangle tests, so ANY shell with a few hundred
// faces pays it. A grid of separated boxes reaches that count exactly, and it is
// the honest shape for the question, because almost every pair is far apart —
// which is precisely the case a bounding-box rejection is supposed to answer in
// constant time and the unpatched scan answers with exact arithmetic.
//
// WHAT IT PRINTS, and why three numbers rather than one: wall time alone cannot
// distinguish "faster because it rejects cheaply" from "faster because it stopped
// testing things it should test". So it also prints the pair and exact-test counts
// AND the heal verdict, and a rejection that changed the ANSWER would move the
// verdict while the counts fell.
//
// usage:  heal_selfintersect_scale_probe [boxes_per_side]      (default 6 -> 432 faces)
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Topology.hpp"

using forge::math::Point3;
using forge::native::brep::Face;
using forge::native::brep::HealOptions;
using forge::native::brep::HealReport;
using forge::native::brep::TopologyBuilder;
using forge::native::brep::healBRep;

static Face* faceFromRing(TopologyBuilder& tb, const std::vector<Point3>& ring) {
    Face* f = tb.makeFace();
    std::vector<forge::native::brep::Vertex*> vs;
    vs.reserve(ring.size());
    for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

static void pushQuadAsTris(TopologyBuilder& tb, std::vector<Face*>& out,
                           const Point3& a, const Point3& b, const Point3& c, const Point3& d) {
    out.push_back(faceFromRing(tb, {a, b, c}));
    out.push_back(faceFromRing(tb, {a, c, d}));
}

static void boxAt(TopologyBuilder& tb, std::vector<Face*>& out,
                  double x0, double y0, double z0, double X, double Y, double Z) {
    const Point3 P[8] = {
        {x0,     y0,     z0    }, {x0 + X, y0,     z0    },
        {x0 + X, y0 + Y, z0    }, {x0,     y0 + Y, z0    },
        {x0,     y0,     z0 + Z}, {x0 + X, y0,     z0 + Z},
        {x0 + X, y0 + Y, z0 + Z}, {x0,     y0 + Y, z0 + Z},
    };
    pushQuadAsTris(tb, out, P[0], P[3], P[2], P[1]);
    pushQuadAsTris(tb, out, P[4], P[5], P[6], P[7]);
    pushQuadAsTris(tb, out, P[0], P[1], P[5], P[4]);
    pushQuadAsTris(tb, out, P[2], P[3], P[7], P[6]);
    pushQuadAsTris(tb, out, P[0], P[4], P[7], P[3]);
    pushQuadAsTris(tb, out, P[1], P[2], P[6], P[5]);
}

int main(int argc, char** argv) {
    const int n = (argc > 1) ? std::atoi(argv[1]) : 6;
    // ★ SPACING IS AN ARGUMENT because a grid of well-separated boxes is the
    //   FAVOURABLE case for a bounding-box rejection: almost every pair is provably
    //   apart. The adversarial case -- boxes close enough that their boxes overlap --
    //   must also be measured, or the speed-up is a claim about the fixture rather
    //   than about the code. Pass a small pitch to get it.
    const double pitch = (argc > 2) ? std::atof(argv[2]) : 3.0;
    if (n < 1 || n > 20) { std::fprintf(stderr, "boxes_per_side out of range\n"); return 2; }

    TopologyBuilder tb;
    std::vector<Face*> faces;
    // Separated by 3 units on a 1-unit box, so no two boxes touch: every pair is a
    // genuine non-intersection that the exact test must currently prove the hard way.
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j)
            boxAt(tb, faces, i * pitch, j * pitch, 0.0, 1.0, 1.0, 1.0);

    HealOptions opt;
    opt.tol = 1e-6;
    opt.repairSelfIntersection = true;

    const auto t0 = std::chrono::steady_clock::now();
    HealReport r = healBRep(tb, faces, opt);
    const auto t1 = std::chrono::steady_clock::now();
    const double secs = std::chrono::duration<double>(t1 - t0).count();

    std::printf("faces=%zu pitch=%.2f  wall=%.3fs\n", faces.size(), pitch, secs);
    std::printf("  facePairs=%zu  boxSkipped=%zu  exactTriTests=%zu\n",
                r.selfIntersectFacePairs, r.selfIntersectFacePairsSkipped,
                r.selfIntersectExactTriTests);
    // THE ANSWER, printed beside the cost so a speed-up that changed it is visible.
    std::printf("  ANSWER: slivers=%zu unfixedPairs=%zu ok=%d\n",
                r.selfIntersectingFacesRemoved, r.unfixedSelfIntersectionFacePairs.size(),
                r.ok ? 1 : 0);

    // ★ A CEILING ON THE EXACT-TEST COUNT, NOT ON WALL TIME. The count is exact and
    //   machine-independent; a wall-clock gate on a shared CI runner is a flake
    //   generator. If the spatial rejection is ever removed or broken, exactTriTests
    //   explodes by orders of magnitude and this fails -- which is the regression this
    //   probe exists to hold. Measured on the fixtures above: 216 at pitch 3.0/1.5,
    //   2486 at pitch 1.0 (the adversarial touching case). The baseline without any
    //   rejection runs essentially every triangle pair of every non-adjacent face pair.
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--assert-max-exact" && i + 1 < argc) {
            const std::size_t cap = std::strtoull(argv[i + 1], nullptr, 10);
            if (r.selfIntersectExactTriTests > cap) {
                std::fprintf(stderr,
                    "FAIL: exact tri-tri tests %zu exceed the ceiling %zu -- the spatial "
                    "rejection in Heal.cpp's self-intersection scan is gone or broken\n",
                    r.selfIntersectExactTriTests, cap);
                return 1;
            }
            std::printf("  [gate] exactTriTests %zu <= %zu  OK\n",
                        r.selfIntersectExactTriTests, cap);
        }
    }
    return 0;
}
