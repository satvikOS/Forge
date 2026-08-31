// frame_contract_test — the AnimationFrame contract's REJECTION paths.
//
// The value of the contract is entirely in what it refuses. Each case below
// builds a frame that a naive producer would happily emit, and asserts the
// exact reason it is refused. A contract that only ever accepts is not a
// contract, so an accepted-only test would prove nothing.

#include "forge/simulation/AnimationFrame.hpp"
#include "TestHarness.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

using namespace forge::simulation;

namespace {

// A frame that satisfies every clause of the contract, used as the base that
// each negative case then breaks in exactly one place.
AnimationFrame goodFrame(std::uint64_t index = 0, std::uint64_t step = 0) {
    AnimationFrame f;
    f.frameIndex       = index;
    f.simTime          = 0.02 * static_cast<double>(index);
    f.geometryRevision = 0xC0FFEEULL;
    f.solverStep       = step;
    BodyTransform b;
    b.body = 0;
    b.position = {1.5, -0.25, 0.0};
    b.rotation = {0, -1, 0, 1, 0, 0, 0, 0, 1};
    b.linearVelocity = {0.1, 0.2, 0.0};
    b.angularVelocity = {0, 0, 6.0};
    f.bodies.push_back(b);
    f.probes.push_back({"crank_theta_rad", 0.75});
    f.resultHash = computeResultHash(f);
    return f;
}

std::string reasonFor(const AnimationFrame& f) {
    const FrameCheck c = checkFrame(f);
    return c.accepted ? std::string("<accepted>") : c.reason;
}

}  // namespace

int main() {
    forge::simtest::TestRun t("frame_contract");

    // ---- 1. the well-formed frame is accepted -----------------------------
    {
        const AnimationFrame f = goodFrame();
        t.equalStr("well-formed frame is accepted", reasonFor(f), "<accepted>");
    }

    // ---- 2. hash is a pure function of the physical content ---------------
    {
        const AnimationFrame a = goodFrame(3, 600);
        const AnimationFrame b = goodFrame(3, 600);
        t.equalU64("identical content hashes identically",
                   computeResultHash(a), computeResultHash(b));

        // Validity and wall-clock are RUN metadata, not trajectory. They must
        // not move the hash -- the whole determinism gate rests on this.
        AnimationFrame c = a;
        c.validity           = ValidityState::Degraded;
        c.solverWallSeconds  = 12.5;
        c.frameBudgetSeconds = 0.02;
        c.constraintResidual = 1e-9;
        c.energyDrift        = 3e-7;
        t.equalU64("validity/wall-clock/diagnostics do not change the hash",
                   computeResultHash(c), computeResultHash(a));
        t.equalStr("...and such a frame is still accepted", reasonFor(c), "<accepted>");

        // Physical content DOES move the hash.
        AnimationFrame d = a;
        d.bodies[0].position[0] += 1e-12;
        t.differU64("a 1e-12 m position change changes the hash",
                    computeResultHash(d), computeResultHash(a));
        AnimationFrame e = a;
        e.probes[0].value += 1e-12;
        t.differU64("a 1e-12 rad probe change changes the hash",
                    computeResultHash(e), computeResultHash(a));

        // -0.0 == +0.0, so they must hash equal.
        AnimationFrame z1 = goodFrame();
        z1.bodies[0].position = {0.0, 0.0, 0.0};
        z1.resultHash = computeResultHash(z1);
        AnimationFrame z2 = goodFrame();
        z2.bodies[0].position = {-0.0, -0.0, -0.0};
        z2.resultHash = computeResultHash(z2);
        t.equalU64("-0.0 hashes as +0.0", z2.resultHash, z1.resultHash);
    }

    // ---- 3. SR-4 provenance: a frame that cannot name its origin is refused
    {
        AnimationFrame f = goodFrame();
        f.geometryRevision = 0;
        f.resultHash = computeResultHash(f);
        t.equalStr("no geometry revision -> rejected", reasonFor(f),
                   "frame does not name a geometry revision (geometryRevision == 0)");
    }
    {
        AnimationFrame f = goodFrame();
        f.resultHash = 0;
        t.equalStr("no result hash -> rejected", reasonFor(f),
                   "frame does not name its content (resultHash == 0)");
    }
    {
        // A frame edited after the solver produced it: the classic way a
        // "smoothed" or hand-tweaked animation gets laundered as evidence.
        AnimationFrame f = goodFrame();
        f.bodies[0].position[1] = 999.0;   // hash NOT recomputed
        t.equalStr("content altered after emission -> rejected", reasonFor(f),
                   "resultHash does not match frame content (frame was altered after emission)");
    }

    // ---- 4. state and numeric sanity --------------------------------------
    {
        AnimationFrame f = goodFrame();
        f.bodies.clear();
        f.probes.clear();
        f.resultHash = computeResultHash(f);
        t.equalStr("no bodies and no nodal field -> rejected", reasonFor(f),
                   "frame carries no state (no body transforms and no nodal field)");
    }
    {
        AnimationFrame f = goodFrame();
        f.simTime = -1e-9;
        f.resultHash = computeResultHash(f);
        t.equalStr("negative simTime -> rejected", reasonFor(f),
                   "simTime is not a finite non-negative time");
    }
    {
        AnimationFrame f = goodFrame();
        f.bodies[0].position[2] = std::numeric_limits<double>::quiet_NaN();
        f.resultHash = computeResultHash(f);
        t.equalStr("NaN in a body transform -> rejected", reasonFor(f),
                   "body transform contains a non-finite value");
    }
    {
        AnimationFrame f = goodFrame();
        f.probes[0].value = std::numeric_limits<double>::infinity();
        f.resultHash = computeResultHash(f);
        t.equalStr("infinite probe -> rejected", reasonFor(f),
                   "probe 'crank_theta_rad' is non-finite");
    }
    {
        AnimationFrame f = goodFrame();
        f.validity = ValidityState::Diverged;
        f.resultHash = computeResultHash(f);
        t.equalStr("Diverged frame -> rejected", reasonFor(f),
                   "validity_state=Diverged: the integrator produced no physical state");
    }

    // ---- 5. deforming-part payload ----------------------------------------
    {
        // A frame carrying ONLY a nodal displacement field (an FEA result with
        // no rigid-body motion) is legitimate evidence.
        AnimationFrame f;
        f.frameIndex = 7;
        f.simTime = 0.14;
        f.geometryRevision = 42;
        f.solverStep = 1400;
        f.nodalDisplacement = {0.0, 0.0, 0.0, 1e-4, -2e-4, 0.0, 2e-4, -8e-4, 0.0};
        f.resultHash = computeResultHash(f);
        t.equalStr("nodal-field-only frame is accepted", reasonFor(f), "<accepted>");

        AnimationFrame g = f;
        g.nodalDisplacement.pop_back();       // 8 values: not x,y,z per node
        g.resultHash = computeResultHash(g);
        t.equalStr("ragged nodal field -> rejected", reasonFor(g),
                   "nodalDisplacement size is not a multiple of 3 (x,y,z per node)");

        AnimationFrame h = f;
        h.nodalDisplacement[4] = std::numeric_limits<double>::quiet_NaN();
        h.resultHash = computeResultHash(h);
        t.equalStr("NaN in the nodal field -> rejected", reasonFor(h),
                   "nodal displacement field contains a non-finite value");
    }

    // ---- 6. FrameSink sequence invariants ---------------------------------
    {
        FrameSink sink;
        for (std::uint64_t i = 0; i < 5; ++i) {
            AnimationFrame f = goodFrame(i, i * 200);
            sink.accept(f);
        }
        t.equalU64("sink accepted a clean 5-frame sequence",
                   static_cast<std::uint64_t>(sink.acceptedCount()), 5);
        t.equalU64("...with no rejections",
                   static_cast<std::uint64_t>(sink.rejectedCount()), 0);

        // A dropped frame breaks the index chain. This is exactly how a driver
        // "catching up" by skipping a frame becomes detectable.
        AnimationFrame skipped = goodFrame(6, 1200);   // 5 was never emitted
        const bool tookIt = sink.accept(skipped);
        t.predicate("a skipped frameIndex is rejected", !tookIt,
                    "accept()=" + std::string(tookIt ? "true" : "false") +
                    " rejections=" + std::to_string(sink.rejectedCount()));
        t.equalStr("...for the right reason",
                   sink.rejections().back(),
                   "frame 6: frameIndex is not previous+1 (a frame was dropped or reordered)");
        t.equalU64("...and the rejected frame was NOT stored",
                   static_cast<std::uint64_t>(sink.acceptedCount()), 5);

        // A stalled solverStep means the frame carries no new integration.
        AnimationFrame stalled = goodFrame(5, 800);    // 800 < previous 800? equal
        const bool tookStalled = sink.accept(stalled);
        t.predicate("a non-advancing solverStep is rejected", !tookStalled,
                    "prev solverStep=800 new solverStep=800");
        t.equalStr("...for the right reason", sink.rejections().back(),
                   "frame 5: solverStep did not advance");
    }

    // ---- 7. sequence hash ---------------------------------------------------
    {
        std::vector<AnimationFrame> a, b;
        FrameSink sa, sb;
        for (std::uint64_t i = 0; i < 8; ++i) {
            AnimationFrame f = goodFrame(i, i * 200);
            sa.accept(f);
            a.push_back(f);
            AnimationFrame g = goodFrame(i, i * 200);
            g.validity          = ValidityState::Degraded;   // run metadata only
            g.solverWallSeconds = 99.0;
            sb.accept(g);
            b.push_back(g);
        }
        t.equalU64("sequence hash is reproducible", sb.sequenceHash(), sa.sequenceHash());
        t.equalU64("standalone sequenceHash matches the sink's",
                   sequenceHash(a), sa.sequenceHash());

        std::vector<AnimationFrame> c = a;
        c[4].bodies[0].position[0] += 1e-12;
        c[4].resultHash = computeResultHash(c[4]);
        t.differU64("perturbing one frame changes the sequence hash",
                    sequenceHash(c), sequenceHash(a));

        // Order matters: a reordered sequence is a different trajectory.
        std::vector<AnimationFrame> d = a;
        std::swap(d[2], d[5]);
        t.differU64("reordering the sequence changes the sequence hash",
                    sequenceHash(d), sequenceHash(a));
    }

    return t.exitCode();
}
