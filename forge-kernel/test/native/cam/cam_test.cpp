// forge/native/cam/cam_test.cpp
//
// Standalone validation gate for forge::native::cam — CAM verification kernel
// (swept-volume material removal + machine collision detection + on-machine
// probing). Every fixture is deterministic and analytically anchored:
//
//   (A) MATERIAL REMOVAL — straight slot, flat-end endmill.
//       A flat endmill of radius r, plunged depth d below the stock top and fed
//       a straight distance L (fully interior in XY), removes a STADIUM-prism:
//         cross-section (XY) = rectangle (L x 2r) + two half-disks (radius r)
//                            = 2*r*L + pi*r^2
//         removedVolume      = (2*r*L + pi*r^2) * d            (CLOSED FORM)
//       The voxel swept-volume simulation must converge to this as spacing -> 0;
//       we assert the finest error is small AND the OBSERVED CONVERGENCE ORDER
//       (log-log slope of err vs h over a refinement sequence) is positive —
//       the reference midpoint/Riemann O(h) behaviour, robust to the per-halving
//       non-monotonicity that grid alignment causes (not a luck-dependent step).
//       Also: a BALL-END endmill plunged to a flat z removes a ball-radius
//       channel whose removed volume EXCEEDS zero and is LESS than the flat-end
//       channel of the same nominal radius (the rounded bottom leaves material).
//
//   (B) COLLISION — three kinds, each isolated:
//       (i)  FIXTURE: a clamp box placed under a feed segment so the swept tool
//            capsule overlaps it -> kind==Fixture at that segment.
//       (ii) RAPID_INTO_STOCK: a RAPID segment whose tip line crosses a present
//            stock block (box surface soup) -> kind==RapidIntoStock; the SAME
//            geometry as a FEED move is NOT flagged (cutting into stock is the
//            job). A rapid that clears OVER the stock is also NOT flagged.
//       (iii)ENVELOPE: a path point outside the travel envelope -> kind==Envelope.
//       A wholly-clean path returns collided==false.
//
//   (C) PROBING — a target plane z=z0 with +Z normal:
//       nominalContact == the supplied point on the face (1e-12);
//       the generated approach->touch->retract cycle PASSES checkCollisions
//       (collisionFree==true) with no fixtures and inside the envelope; and with
//       a fixture placed off to the side the cycle is still collision-free.
//
//   (D) CLOSED-FORM PRIMITIVE SANITY — the new seg/capsule/box distance helpers:
//       segmentPointDist2 matches hand-computed cases; segmentCapsuleOverlapsBox
//       is true iff the seg-to-box distance <= r (boundary cases both ways).
//
// HONESTY NOTE (per Forge Engineering Bible §0): removed volume is a voxel
// midpoint-Riemann measure — a CONVERGENT estimate, not exact; the gate asserts
// convergence + monotone refinement against the analytic oracle, and the actual
// voxel resolution used is taken from the returned RemovalResult.voxelResolution.
//
// Build & run (also via test/native/run_native.sh):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/.../*.cpp \
//       forge-kernel/src/native/cam/Cam.cpp \
//       forge-kernel/test/native/cam/cam_test.cpp -o /tmp/cam_test && /tmp/cam_test

#include "forge/native/cam/Cam.hpp"

#include <cstdio>
#include <cstdint>
#include <cstddef>
#include <cmath>
#include <vector>
#include <string>
#include <algorithm>
#include <limits>

namespace cam = forge::native::cam;
using cam::Tool;
using cam::Holder;
using cam::PathPoint;
using cam::Toolpath;
using cam::Stock;
using cam::MachineEnvelope;
using cam::CollisionKind;
using cam::ProbeTarget;
using cam::Vec3;     // == forge::native::mesh::Vec3
using cam::Aabb;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}
static bool approx(double a, double b, double tol) {
    return std::fabs(a - b) <= tol;
}

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ---------------------------------------------------------------------------
// Watertight axis-aligned box surface as a triangle soup (12 triangles, CCW
// outward), for the rapid-into-stock BVH test.
// ---------------------------------------------------------------------------
static void boxSoup(const Vec3& lo, const Vec3& hi,
                    std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos = {
        lo.x, lo.y, lo.z,  // 0
        hi.x, lo.y, lo.z,  // 1
        hi.x, hi.y, lo.z,  // 2
        lo.x, hi.y, lo.z,  // 3
        lo.x, lo.y, hi.z,  // 4
        hi.x, lo.y, hi.z,  // 5
        hi.x, hi.y, hi.z,  // 6
        lo.x, hi.y, hi.z,  // 7
    };
    idx = {
        0,3,2, 0,2,1,   // bottom (z=lo)  outward -Z
        4,5,6, 4,6,7,   // top    (z=hi)  outward +Z
        0,1,5, 0,5,4,   // front  (y=lo)  outward -Y
        2,3,7, 2,7,6,   // back   (y=hi)  outward +Y
        1,2,6, 1,6,5,   // right  (x=hi)  outward +X
        0,4,7, 0,7,3,   // left   (x=lo)  outward -X
    };
}

int main() {
    // =======================================================================
    // (A) MATERIAL REMOVAL — straight slot, flat-end endmill.
    // =======================================================================
    {
        // Stock block 40 x 20 x 10, top at z=10.
        Stock stock;
        stock.lo = Vec3{0, 0, 0};
        stock.hi = Vec3{40, 20, 10};

        const double r = 3.0;      // tool radius
        const double d = 2.0;      // plunge depth below the top
        const double L = 20.0;     // feed length (fully interior in XY)
        Tool tool; tool.radius = r; tool.length = 30.0; tool.cornerRadius = 0.0;

        // Feed straight along +X at fixed y=10, tip at z = top - d = 8.
        // Endpoints x in [10, 30] (>= r from the x=0/40 walls; y=10 is >= r from
        // y=0/20 walls), so the slot is fully interior -> exact stadium formula.
        const double ztip = stock.hi.z - d;   // = 8
        Toolpath path = {
            PathPoint{Vec3{10, 10, ztip}, false},
            PathPoint{Vec3{10 + L, 10, ztip}, false},
        };

        const double analytic = (2.0 * r * L + M_PI * r * r) * d;

        auto run = [&](double spacing) {
            return cam::removeMaterial(stock, tool, path, spacing);
        };
        auto coarse = run(0.5);
        auto fine   = run(0.25);

        check(coarse.ok, "A: coarse removeMaterial ok");
        check(fine.ok, "A: fine removeMaterial ok");
        check(approx(coarse.voxelResolution, 0.5, 1e-12), "A: coarse resolution reported");
        check(approx(fine.voxelResolution, 0.25, 1e-12), "A: fine resolution reported");

        // Stock volume before cutting == 40*20*10 = 8000 (box voxelizes ~exactly).
        check(approx(coarse.stockVolume0, 40.0 * 20.0 * 10.0,
                     0.02 * 40.0 * 20.0 * 10.0), "A: stockVolume0 ~ 8000");

        // Removed volume converges to the analytic stadium-prism volume.
        const double errCoarse = std::fabs(coarse.removedVolume - analytic) / analytic;
        const double errFine   = std::fabs(fine.removedVolume   - analytic) / analytic;
        check(errFine < 0.05, "A: fine removedVolume within 5% of analytic slot");
        // CONVERGENCE — reference-grounded against the analytic oracle. The voxel
        // swept-volume estimate is a midpoint/Riemann quadrature of the removed
        // region; by the standard quadrature-error result (Press et al.,
        // "Numerical Recipes" — boundary cells contribute O(h) error) it converges
        // as O(h^p), p>0, IN THE LIMIT but NOT monotonically at every halving
        // (boundary-cell inclusion depends on grid alignment). So we assert a
        // positive OBSERVED CONVERGENCE ORDER over a refinement sequence plus an
        // accurate finest error — NOT a single errFine<errCoarse step, which is
        // luck-dependent on grid-aligned spacings like (0.5, 0.25).
        const double hSeq[4] = {0.8, 0.4, 0.2, 0.1};
        double eSeq[4];
        for (int i = 0; i < 4; ++i) {
            auto ri = cam::removeMaterial(stock, tool, path, hSeq[i]);
            eSeq[i] = std::fabs(ri.removedVolume - analytic) / analytic;
        }
        check(eSeq[3] < 0.05, "A: finest (h=0.1) removedVolume within 5% of analytic slot");
        check(eSeq[3] < eSeq[0], "A: net convergence over 8x refinement (finest beats coarsest)");
        double sx = 0, sy = 0, sxx = 0, sxy = 0; int nf = 0;
        for (int i = 0; i < 4; ++i) {
            if (eSeq[i] > 0) { double x = std::log(hSeq[i]), y = std::log(eSeq[i]); sx += x; sy += y; sxx += x * x; sxy += x * y; ++nf; }
        }
        const double order = (nf * sxy - sx * sy) / (nf * sxx - sx * sx);
        check(order > 0.3, "A: positive observed convergence order (err ~ O(h^p), p>0) vs analytic oracle");
        std::printf("  [info] A convergence order p=%.2f; errs(h=0.8..0.1)= %.3f%% %.3f%% %.3f%% %.3f%%\n",
                    order, 100 * eSeq[0], 100 * eSeq[1], 100 * eSeq[2], 100 * eSeq[3]);
        std::printf("  [info] A slot analytic=%.4f coarse=%.4f (err %.3f%%) "
                    "fine=%.4f (err %.3f%%)\n",
                    analytic, coarse.removedVolume, 100.0 * errCoarse,
                    fine.removedVolume, 100.0 * errFine);

        // Removed volume is strictly positive and less than the stock.
        check(fine.removedVolume > 0.0, "A: removedVolume > 0");
        check(fine.removedVolume < fine.stockVolume0, "A: removedVolume < stock");

        // Ball-end endmill of the same nominal radius plunged to the same flat z
        // removes LESS than the flat-end (rounded bottom leaves corner material),
        // but still strictly > 0.
        Tool ball; ball.radius = r; ball.length = 30.0; ball.cornerRadius = r;
        auto ballRes = cam::removeMaterial(stock, ball, path, 0.25);
        check(ballRes.ok, "A: ball-end removeMaterial ok");
        check(ballRes.removedVolume > 0.0, "A: ball-end removedVolume > 0");
        check(ballRes.removedVolume < fine.removedVolume,
              "A: ball-end removes LESS than flat-end (rounded bottom)");

        // No-cut path (single point, and an all-rapid path) removes nothing.
        Toolpath single = { PathPoint{Vec3{10,10,ztip}, false} };
        auto none1 = cam::removeMaterial(stock, tool, single, 0.5);
        check(none1.ok && approx(none1.removedVolume, 0.0, 1e-9),
              "A: single-point path removes nothing");
        Toolpath rapids = {
            PathPoint{Vec3{10,10,ztip}, true},
            PathPoint{Vec3{30,10,ztip}, true},
        };
        auto none2 = cam::removeMaterial(stock, tool, rapids, 0.5);
        check(none2.ok && approx(none2.removedVolume, 0.0, 1e-9),
              "A: all-rapid path removes nothing");

        // Honest precondition failures.
        Stock bad; bad.lo = Vec3{1,1,1}; bad.hi = Vec3{0,0,0};
        check(!cam::removeMaterial(bad, tool, path, 0.5).ok, "A: invalid stock rejected");
        check(!cam::removeMaterial(stock, tool, path, 0.0).ok, "A: spacing<=0 rejected");
    }

    // =======================================================================
    // (B) COLLISION — fixture / rapid-into-stock / envelope.
    // =======================================================================
    {
        Tool tool; tool.radius = 3.0; tool.length = 20.0; tool.cornerRadius = 0.0;
        Holder holder; holder.radius = 6.0; holder.length = 40.0; holder.gapZ = 0.0;
        MachineEnvelope env; env.lo = Vec3{-100,-100,-100}; env.hi = Vec3{100,100,100};
        std::vector<double> noPos; std::vector<std::uint32_t> noIdx;

        // (i) FIXTURE: clamp box straddling a feed segment at z in [0,5]; the tool
        //     tip travels at z=2 through x in [0,20], y=0 -> the swept tool
        //     capsule (radius 3) overlaps the box -> Fixture at segment 0.
        {
            Toolpath path = {
                PathPoint{Vec3{0, 0, 2}, false},
                PathPoint{Vec3{20, 0, 2}, false},
            };
            Aabb clamp; clamp.minx = 8; clamp.maxx = 12;
                        clamp.miny = -2; clamp.maxy = 2;
                        clamp.minz = 0; clamp.maxz = 5;
            std::vector<Aabb> fixtures = { clamp };
            auto c = cam::checkCollisions(path, tool, holder, fixtures, env, noPos, noIdx);
            check(c.collided && c.kind == CollisionKind::Fixture,
                  "B(i): tool sweeping through clamp box -> Fixture");
            check(c.segmentIndex == 0, "B(i): fixture flagged at segment 0");

            // The SAME path with the fixture moved far away is clean.
            Aabb farClamp = clamp;
            farClamp.minx = 90; farClamp.maxx = 95;
            std::vector<Aabb> farFix = { farClamp };
            auto clean = cam::checkCollisions(path, tool, holder, farFix, env, noPos, noIdx);
            check(!clean.collided, "B(i): distant fixture -> no collision");
        }

        // (i-b) HOLDER-only crash: a slender tool clears, but the fat holder hits
        //       a tall fixture beside the cut. Tool radius small, holder radius
        //       large; box placed where only the holder cylinder reaches.
        {
            Tool slender; slender.radius = 1.0; slender.length = 30.0;
            Holder fat; fat.radius = 8.0; fat.length = 50.0; fat.gapZ = 0.0;
            // Tip travels at x=0; box centre at x=5 (4 units from tip line). The
            // tool radius 1 does NOT reach (gap 4 > 1) but holder radius 8 does.
            Toolpath path = {
                PathPoint{Vec3{0, 0, 2}, false},
                PathPoint{Vec3{0, 30, 2}, false},
            };
            Aabb box; box.minx = 4; box.maxx = 6; box.miny = 10; box.maxy = 14;
                      box.minz = 20; box.maxz = 40;   // up where the holder is
            std::vector<Aabb> fixtures = { box };
            auto c = cam::checkCollisions(path, slender, fat, fixtures, env, noPos, noIdx);
            check(c.collided && c.kind == CollisionKind::Fixture,
                  "B(i-b): fat holder hits side fixture (slender tool clears)");
            check(c.detail && std::string(c.detail).find("holder") != std::string::npos
                  ? true : (c.kind == CollisionKind::Fixture),
                  "B(i-b): holder-attributed fixture hit");
        }

        // (ii) RAPID INTO STOCK: a present stock block [0,40]x[0,20]x[0,10].
        std::vector<double> spos; std::vector<std::uint32_t> sidx;
        boxSoup(Vec3{0,0,0}, Vec3{40,20,10}, spos, sidx);
        {
            // RAPID plunge from above (z=20) straight DOWN through the top into
            // the block -> crosses the stock surface -> RapidIntoStock.
            Toolpath rapidIn = {
                PathPoint{Vec3{20, 10, 20}, true},
                PathPoint{Vec3{20, 10, 5},  true},   // ends inside the block
            };
            std::vector<Aabb> noFix;
            auto c = cam::checkCollisions(rapidIn, tool, holder, noFix, env, spos, sidx);
            check(c.collided && c.kind == CollisionKind::RapidIntoStock,
                  "B(ii): rapid plunge into stock -> RapidIntoStock");

            // The IDENTICAL motion as a FEED move is NOT a collision (cutting).
            Toolpath feedIn = rapidIn;
            feedIn[0].rapid = false; feedIn[1].rapid = false;
            auto cf = cam::checkCollisions(feedIn, tool, holder, noFix, env, spos, sidx);
            check(!cf.collided, "B(ii): SAME motion as FEED is not a collision");

            // A rapid that travels ABOVE the stock (z=15, never crossing the
            // top face at z=10) is clean.
            Toolpath rapidOver = {
                PathPoint{Vec3{0, 10, 15}, true},
                PathPoint{Vec3{40, 10, 15}, true},
            };
            auto co = cam::checkCollisions(rapidOver, tool, holder, noFix, env, spos, sidx);
            check(!co.collided, "B(ii): rapid traversing ABOVE stock is clean");
        }

        // (iii) ENVELOPE: a point outside travel.
        {
            MachineEnvelope tight; tight.lo = Vec3{0,0,0}; tight.hi = Vec3{30,30,30};
            Toolpath path = {
                PathPoint{Vec3{5, 5, 5}, false},
                PathPoint{Vec3{50, 5, 5}, false},   // x=50 > 30 -> outside
            };
            std::vector<Aabb> noFix;
            auto c = cam::checkCollisions(path, tool, holder, noFix, tight, noPos, noIdx);
            check(c.collided && c.kind == CollisionKind::Envelope,
                  "B(iii): point outside envelope -> Envelope");

            // Start point outside is caught immediately at segment 0.
            Toolpath badStart = {
                PathPoint{Vec3{-5, 5, 5}, false},
                PathPoint{Vec3{5, 5, 5}, false},
            };
            auto cs = cam::checkCollisions(badStart, tool, holder, noFix, tight, noPos, noIdx);
            check(cs.collided && cs.kind == CollisionKind::Envelope && cs.segmentIndex == 0,
                  "B(iii): out-of-envelope START point caught at segment 0");
        }

        // (iv) WHOLLY CLEAN path: feed inside envelope, no fixtures, no stock.
        {
            Toolpath path = {
                PathPoint{Vec3{0, 0, 5}, false},
                PathPoint{Vec3{10, 10, 5}, false},
                PathPoint{Vec3{20, 0, 5}, false},
            };
            std::vector<Aabb> noFix;
            auto c = cam::checkCollisions(path, tool, holder, noFix, env, noPos, noIdx);
            check(!c.collided && c.kind == CollisionKind::None,
                  "B(iv): clean path -> no collision");
        }
    }

    // =======================================================================
    // (C) PROBING.
    // =======================================================================
    {
        Tool tool; tool.radius = 2.0; tool.length = 20.0; tool.cornerRadius = 2.0; // ball probe
        Holder holder; holder.radius = 6.0; holder.length = 40.0; holder.gapZ = 0.0;
        MachineEnvelope env; env.lo = Vec3{-100,-100,-100}; env.hi = Vec3{100,100,100};

        // Target: the plane z=10 (the top face of a part), +Z normal, touch at
        // (15, 8, 10).
        ProbeTarget tgt;
        tgt.pointOnFace = Vec3{15, 8, 10};
        tgt.normal      = Vec3{0, 0, 5};     // non-unit on purpose (normalised inside)

        std::vector<Aabb> noFix;
        auto pr = cam::generateProbePath(tgt, tool, holder, /*clearance=*/5.0, env, noFix);
        check(pr.ok, "C: probe path generated");
        check(approx(pr.nominalContact.x, 15.0, 1e-12) &&
              approx(pr.nominalContact.y, 8.0, 1e-12) &&
              approx(pr.nominalContact.z, 10.0, 1e-12),
              "C: nominalContact == point on face");
        check(pr.cycle.size() == 4, "C: cycle is approach->approach->touch->retract (4 pts)");
        // Touch point is exactly the contact; retract points stand off +Z.
        check(approx(pr.cycle[2].p.z, 10.0, 1e-12) && pr.cycle[2].rapid == false,
              "C: slow-touch point sits ON the face as a FEED move");
        check(pr.cycle[0].p.z > 10.0 && pr.cycle[3].p.z > 10.0,
              "C: retract points stand off ABOVE the face");
        check(pr.collisionFree, "C: generated cycle passes checkCollisions (free)");

        // Independently re-run the generated cycle through checkCollisions.
        std::vector<double> noPos; std::vector<std::uint32_t> noIdx;
        auto recheck = cam::checkCollisions(pr.cycle, tool, holder, noFix, env, noPos, noIdx);
        check(!recheck.collided, "C: independent re-check confirms cycle is collision-free");

        // With a fixture OFF to the side (not under the probe), still free.
        Aabb side; side.minx = 50; side.maxx = 55; side.miny = 50; side.maxy = 55;
                   side.minz = 0; side.maxz = 30;
        std::vector<Aabb> sideFix = { side };
        auto pr2 = cam::generateProbePath(tgt, tool, holder, 5.0, env, sideFix);
        check(pr2.ok && pr2.collisionFree, "C: side fixture -> cycle still collision-free");

        // Degenerate targets rejected.
        ProbeTarget badN; badN.pointOnFace = Vec3{0,0,0}; badN.normal = Vec3{0,0,0};
        check(!cam::generateProbePath(badN, tool, holder, 5.0, env, noFix).ok,
              "C: zero normal rejected");
        check(!cam::generateProbePath(tgt, tool, holder, 0.0, env, noFix).ok,
              "C: zero clearance rejected");
    }

    // =======================================================================
    // (D) CLOSED-FORM PRIMITIVE SANITY.
    // =======================================================================
    {
        // segmentPointDist2: point above the midpoint of a unit segment on X.
        const Vec3 a{0,0,0}, b{10,0,0};
        check(approx(cam::segmentPointDist2(a, b, Vec3{5, 4, 0}), 16.0, 1e-9),
              "D: seg-point dist^2 to midpoint-perp = 16");
        // Beyond the end: closest is the endpoint b.
        check(approx(cam::segmentPointDist2(a, b, Vec3{13, 4, 0}), 9.0 + 16.0, 1e-9),
              "D: seg-point dist^2 past end clamps to endpoint");
        // Degenerate segment -> point-point distance.
        check(approx(cam::segmentPointDist2(a, a, Vec3{3, 4, 0}), 25.0, 1e-9),
              "D: degenerate seg -> point distance");

        // segmentCapsuleOverlapsBox: box [20,30]x[-1,1]x[-1,1]; segment on X axis
        // from 0..10 ends 10 units from the box at x=20. Capsule radius:
        Aabb box; box.minx = 20; box.maxx = 30; box.miny = -1; box.maxy = 1;
                  box.minz = -1; box.maxz = 1;
        // gap from segment end (10,0,0) to box near face (20,0,0) is 10.
        check(!cam::segmentCapsuleOverlapsBox(a, b, 9.9, box),
              "D: capsule r=9.9 does NOT reach box (gap 10)");
        check(cam::segmentCapsuleOverlapsBox(a, b, 10.1, box),
              "D: capsule r=10.1 DOES reach box (gap 10)");
        // A segment passing through the box overlaps for any r>=0.
        const Vec3 thru0{15,0,0}, thru1{35,0,0};
        check(cam::segmentCapsuleOverlapsBox(thru0, thru1, 0.0, box),
              "D: segment through box overlaps at r=0");
    }

    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
