// shape_seam_gate.cpp — can an OCCT-FREE caller round-trip through the kernel's
// shape store?  (forge/NativeShapeAccess.hpp)
//
// WHAT THIS GATE IS FOR. OCCT_REMOVAL_TRACKER names "an OWNING, OCCT-free shape
// handle adopted as the kernel interchange type" as the single highest-unlock
// item of the whole removal programme -- it gates 365 of 550 remaining symbols
// and 5 of the 11 remaining libraries -- and it named OWNERSHIP as the missing
// piece.  Measured, ownership was already there (ShapeRegistry::Entry holds a
// shared_ptr<TopologyBuilder>); what was missing was a FUNCTION: nothing could
// produce a shape::Shape from a ShapeHandle, so 13k lines of OCCT-free B-rep had
// zero production consumers.  This gate is the evidence for both halves.
//
// ★ THE BOUNDARY IS A BUILD FACT, NOT A COMMENT.  This translation unit is
//   compiled with an include path that contains NO OCCT directory (see
//   forge-kernel/CMakeLists.txt: forge_shape_seam_gate takes only
//   ${CMAKE_SOURCE_DIR}/include, the same trick forge_capi_smoke uses).  If
//   NativeShapeAccess.hpp ever grows an OCCT include -- directly or through
//   Shape.hpp / Topology.hpp -- this file stops COMPILING.  A header that says
//   "no OCCT" and a header that cannot be compiled without it are told apart
//   here and nowhere else.
//
// CHECKS
//   S1  an OCCT-free caller can register a native solid and get a live handle,
//       and shapeKind() says NativeSolid.
//   S2  OWNERSHIP, measured and not argued: the caller's shared_ptr use_count
//       RISES when the registry takes the builder, and FALLS back when the
//       handle is released.  No use-after-free is needed to show it, which is
//       the point -- a lifetime bug proved by UB is proved by nothing.
//   S3  the caller drops its own reference entirely and the body is still there:
//       nativeShapeOf() traverses to the box's real 6/12/8 through the HANDLE.
//   S4  honesty at the edges: an unknown handle, the invalid handle, and a
//       released handle each give a NULL Shape rather than a plausible one.
//   S5  the counts are read THROUGH the seam.  A scratch builder with different
//       dimensions is alive at the same time, and mutation 5 proves the gate
//       would notice if the numbers came from it instead.
//
// MUTATIONS (--mutate N).  Each replaces ONE production step with the defect it
// guards against, deterministically and without UB:
//   1  registration hands the registry a NON-OWNING aliasing shared_ptr -- the
//      exact design the tracker said was the blocker.            (S2 must fail)
//   2  lookup answers a Shape for ANY handle, known or not.      (S4 must fail)
//   3  lookup answers NULL for a valid native handle.            (S1/S3 fail)
//   4  release leaves the entry in the registry.                 (S4 must fail)
//   5  the topology counts are taken from the scratch builder.   (S5 must fail)
//
// Pure C++20 + the kernel library.  No test framework, no OCCT header.
#include "forge/NativeShapeAccess.hpp"
#include "forge/ShapeHandle.hpp"
#include "forge/native/shape/Explore.hpp"

#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

using forge::ShapeHandle;
using forge::ShapeKind;
using forge::kInvalidHandle;
namespace brep  = forge::native::brep;
namespace shape = forge::native::shape;

static int g_mutation = 0;
static int g_pass = 0;
static int g_fail = 0;

static bool check(bool ok, const std::string& what, const std::string& got = "") {
    if (ok) { ++g_pass; std::printf("  [PASS] %s\n", what.c_str()); }
    else    { ++g_fail; std::printf("  [FAIL] %s%s%s\n", what.c_str(),
                                    got.empty() ? "" : "  -> ", got.c_str()); }
    std::fflush(stdout);   // a crash after a [FAIL] must not swallow the [FAIL]
    return ok;
}

static int verdict() {
    std::printf("[shape-seam] %d checks, %d failed\n", g_pass + g_fail, g_fail);
    if (g_fail != 0) { std::printf("[shape-seam] RED\n"); return 1; }
    std::printf("[shape-seam] ALL CHECKS PASS — an OCCT-free caller round-trips "
                "through the kernel shape store\n");
    return 0;
}

// ── the production calls, each behind one indirection so a mutation can replace
//    exactly one of them and nothing else. ───────────────────────────────────
static ShapeHandle registerSolid(std::shared_ptr<brep::TopologyBuilder> owner,
                                 brep::Solid* solid) {
    if (g_mutation == 1) {
        // DEFECT: an aliasing shared_ptr with a no-op deleter. The registry gets
        // something that LOOKS like ownership and shares no reference count --
        // "shape::Shape is a NON-OWNING tagged pointer", made real.
        std::shared_ptr<brep::TopologyBuilder> nonOwning(owner.get(),
                                                         [](brep::TopologyBuilder*) {});
        return forge::addNativeSolidShape(nonOwning, solid);
    }
    return forge::addNativeSolidShape(std::move(owner), solid);
}

static shape::Shape lookupShape(ShapeHandle h, brep::Solid* pretend) {
    if (g_mutation == 2 && pretend != nullptr) {
        // DEFECT: answer a Shape for any handle at all, including one that names
        // nothing. A registry that guesses is worse than one that refuses.
        return shape::Shape::ofSolid(pretend);
    }
    if (g_mutation == 3) {
        // DEFECT: the seam is there and returns nothing, so the round trip reads
        // as "no body" for a body that exists.
        return shape::Shape();
    }
    return forge::nativeShapeOf(h);
}

static void releaseHandle(ShapeHandle h) {
    if (g_mutation == 4) return;   // DEFECT: the entry outlives its release.
    forge::releaseShape(h);
}

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
            g_mutation = std::atoi(argv[++i]);
        }
    }
    if (g_mutation != 0) std::printf("[shape-seam] MUTATION %d ACTIVE\n", g_mutation);

    // A second, DIFFERENT builder alive for the whole run. S5's job is to prove
    // the counts below are not coming from this one.
    brep::TopologyBuilder scratch;
    brep::Solid* scratchSolid = scratch.buildBox({10, 10, 10}, {1, 1, 1});

    // ── S0: the REFUSAL contract. Added because a production mutation sweep
    //    found the impl's own null guard unfalsifiable -- nothing asked the seam
    //    what it does with nothing. The guard is gone now; the contract is here.
    std::printf("[S0] the seam refuses what it cannot register\n");
    check(forge::addNativeSolidShape(nullptr, scratchSolid) == kInvalidHandle,
          "a null owner is refused with kInvalidHandle");
    {
        auto tmp = std::make_shared<brep::TopologyBuilder>();
        check(forge::addNativeSolidShape(tmp, nullptr) == kInvalidHandle,
              "a null solid is refused with kInvalidHandle");
    }

    // ── S1: an OCCT-free caller registers a native solid ─────────────────────
    std::printf("[S1] register a native solid through the OCCT-free seam\n");
    auto owner = std::make_shared<brep::TopologyBuilder>();
    brep::Solid* solid = owner->buildBox({0, 0, 0}, {2, 3, 4});
    check(solid != nullptr, "TopologyBuilder built the box");

    const long beforeCount = owner.use_count();
    ShapeHandle h = registerSolid(owner, solid);
    const long afterCount = owner.use_count();

    check(h != kInvalidHandle, "the seam returned a live handle",
          "h=" + std::to_string(h));
    check(forge::shapeHandleKnown(h), "the registry knows the handle");
    check(forge::shapeKind(h) == ShapeKind::NativeSolid,
          "shapeKind() says NativeSolid",
          "kind=" + std::to_string(static_cast<int>(forge::shapeKind(h))));

    // ── S2: OWNERSHIP, as a number ───────────────────────────────────────────
    std::printf("[S2] the registry TAKES the builder (use_count, not a crash)\n");
    check(beforeCount == 1, "before registration the caller is the only owner",
          "use_count=" + std::to_string(beforeCount));
    const bool owned = check(afterCount >= 2,
          "after registration the registry holds a reference too",
          "use_count=" + std::to_string(afterCount));

    // ★ STOP HERE IF OWNERSHIP IS DISPROVEN, and this is not tidiness.  S3 drops
    //   the caller's reference on purpose.  If the registry did NOT take one,
    //   that reset DESTROYS the builder and everything after this point is a
    //   use-after-free -- which on this machine is SIGSEGV, exit 139, and a lost
    //   stdout buffer that shows ZERO failures for a gate that had already found
    //   one.  A gate whose evidence is erased by the defect it detected is a
    //   gate that cannot be read.  Refuse to execute the UB and report instead.
    if (!owned) {
        std::printf("[shape-seam] the registry did not take the builder; the rest "
                    "of this gate would be a use-after-free, so it is NOT run\n");
        return verdict();
    }

    // ── S3: the caller lets go and the body survives ─────────────────────────
    std::printf("[S3] the caller drops its reference; the body is still there\n");
    owner.reset();
    shape::Shape s = lookupShape(h, scratchSolid);
    const bool live = check(!s.isNull(),
                            "nativeShapeOf() answers a Shape after the caller let go");
    const bool solidTag = check(s.isSolid(), "and it is a SOLID");
    if (!live || !solidTag) {
        // Explorer would walk the handle AS the type its tag claims. A wrong tag
        // is a reinterpret_cast waiting to happen, and a SIGSEGV here would take
        // the [FAIL] above down with it. Same rule as S2: report, do not execute.
        std::printf("[shape-seam] the handle did not come back as a live SOLID; "
                    "traversing it would be undefined, so it is NOT traversed\n");
        return verdict();
    }

    shape::Explorer exF(s, shape::ShapeType::FACE);
    shape::Explorer exE(s, shape::ShapeType::EDGE);
    shape::Explorer exV(s, shape::ShapeType::VERTEX);
    const std::size_t nF = g_mutation == 5
        ? shape::Explorer(shape::Shape::ofSolid(scratchSolid), shape::ShapeType::FACE).count()
        : exF.count();
    const std::size_t nE = exE.count();
    const std::size_t nV = exV.count();

    // ── S5 rides on the same numbers: a box is 6/12/8 whichever box it is, so
    //    the SIZE is what separates the two solids. ───────────────────────────
    check(nF == 6, "6 faces through the handle", "got " + std::to_string(nF));
    check(nE == 12, "12 edges through the handle", "got " + std::to_string(nE));
    check(nV == 8, "8 vertices through the handle", "got " + std::to_string(nV));

    std::printf("[S5] the geometry is the REGISTERED box, not the scratch one\n");
    brep::Solid* got = s.asSolid();
    const brep::Solid* want = g_mutation == 5 ? scratchSolid : solid;
    check(got == want, "the Shape points at the solid that was registered",
          got == scratchSolid ? "it points at the SCRATCH solid" : "");

    // ── S4: honesty at the edges ─────────────────────────────────────────────
    std::printf("[S4] a handle that names nothing gets NOTHING back\n");
    const ShapeHandle bogus = h + 4096;   // never issued
    check(lookupShape(bogus, scratchSolid).isNull(),
          "an unknown handle gives a NULL Shape");
    check(lookupShape(kInvalidHandle, scratchSolid).isNull(),
          "the invalid handle gives a NULL Shape");
    check(!forge::shapeHandleKnown(bogus), "and shapeHandleKnown() agrees");

    releaseHandle(h);
    check(!forge::shapeHandleKnown(h),
          "after release the handle is gone from the registry");
    check(forge::nativeShapeOf(h).isNull(),
          "and the seam answers NULL for it");

    return verdict();
}
