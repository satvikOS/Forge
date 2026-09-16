// native_payload_access_gate.cpp — can an OCCT-FREE caller read the NATIVE
// PAYLOAD behind a handle?  (forge/NativeShapeAccess.hpp: nativeSolidOf /
// nativeMeshOf)
//
// WHY A SECOND SEAM GATE. shape_seam_gate.cpp proves an OCCT-free caller can
// register a body and read it back as the TRAVERSAL facade (shape::Shape). That
// is the right answer for an explorer and the WRONG answer for the native
// engines: brep::massProperties takes `const brep::Solid&`, meshMassProperties
// takes `const mesh::HalfEdgeMesh&`, and neither is reachable from a
// shape::Shape. Before nativeSolidOf/nativeMeshOf, a file whose body named no
// OCCT type still had to include ShapeRegistry.hpp — and through it
// TopoDS_Shape.hxx — purely to call getNativeSolid()/getNativeMesh().
//
// MEASURED on src/MassProps.cpp before this change: rewritten to name no OCCT
// type it still failed to compile with the OCCT include dir removed, with
// exactly ONE error —
//     include/forge/ShapeRegistry.hpp:30: fatal error: TopoDS_Shape.hxx file not found
// — and ZERO geometry nouns were responsible. The only two absent things were
// these two accessors.
//
// ★ THE BOUNDARY IS A BUILD FACT, NOT A COMMENT. This translation unit is
//   compiled with an include path containing NO OCCT directory (see
//   test/build_native_payload_access_gate.sh). If NativeShapeAccess.hpp ever
//   grows an OCCT include — directly or through Topology.hpp / Shape.hpp /
//   HalfEdgeMesh.hpp — this file stops COMPILING.
//
// ★ AND IT FAILS WITHOUT THE ACCESSORS, which is the other half of what a gate
//   is for: built against the header as it stood before this change, this file
//   does not compile at all ("no member named 'nativeSolidOf' in namespace
//   'forge'"). The runner proves that by compiling it against the previous
//   revision of the header and requiring a NON-ZERO exit.
//
// CHECKS
//   P0  REFUSAL. kInvalidHandle, a handle that was never issued, and a RELEASED
//       handle each give nullptr from both accessors — never a plausible body.
//   P1  the payload comes back, and it is THE payload: nativeSolidOf(h) is
//       POINTER-IDENTICAL to the brep::Solid that was registered, not a copy,
//       and is not the scratch solid that is alive at the same time.
//   P2  WRONG KIND IS NOT ANSWERED. nativeMeshOf() on a NativeSolid handle is
//       nullptr. An OCCT-backed entry is not a native solid either; that half
//       cannot be staged from an OCCT-free TU and is named below, not faked.
//   P3  the payload SURVIVES the caller letting go of its shared_ptr — the
//       registry's ownership reaches the raw Solid*, not just the facade.
//   P4  the two readers agree: the face count read straight off the payload
//       (shells -> faces, the way an engine reads it) equals the face count an
//       Explorer walks through nativeShapeOf(). One body, two doors.
//
// NOT COVERED, and said out loud rather than left to look covered: the POSITIVE
// nativeMeshOf() case. A NativeMesh entry can only be created by
// ShapeRegistry::addNativeMesh(), and there is no OCCT-free seam for it — the
// header publishes addNativeSolidShape() and nothing for meshes. So this gate
// pins nativeMeshOf's REFUSAL contract (P0, P2) and leaves its success path to
// whatever registers the first mesh through a seam. Claiming otherwise from a
// nullptr-only test would be a green check over nothing.
//
// MUTATIONS (--mutate N). Each replaces ONE production call with the defect it
// guards against, deterministically and without UB:
//   1  the payload reader answers a solid for ANY handle.        (P0 must fail)
//   2  the payload reader answers nullptr for a live handle.     (P1/P3/P4 fail)
//   3  the payload reader answers the SCRATCH solid.             (P1/P4 fail)
//
// Pure C++20 + the kernel library. No test framework, no OCCT header.
#include "forge/NativeShapeAccess.hpp"
#include "forge/ShapeHandle.hpp"
#include "forge/native/shape/Explore.hpp"

#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <memory>
#include <string>

using forge::ShapeHandle;
using forge::ShapeKind;
using forge::kInvalidHandle;
namespace brep  = forge::native::brep;
namespace mesh  = forge::native::mesh;
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
    std::printf("[payload-seam] %d checks, %d failed\n", g_pass + g_fail, g_fail);
    if (g_fail != 0) { std::printf("[payload-seam] RED\n"); return 1; }
    std::printf("[payload-seam] ALL CHECKS PASS — an OCCT-free caller reads the "
                "NATIVE PAYLOAD behind a handle\n");
    return 0;
}

// The one production call under test, behind a single indirection so a mutation
// can replace exactly it and nothing else.
static const brep::Solid* readSolid(ShapeHandle h, brep::Solid* scratch) {
    if (g_mutation == 1) {
        // DEFECT: answer a body for any handle at all, including one that names
        // nothing. A registry that guesses is worse than one that refuses.
        return scratch;
    }
    if (g_mutation == 2) {
        // DEFECT: the seam is there and reads as "no body" for a body that is.
        return nullptr;
    }
    if (g_mutation == 3) {
        // DEFECT: the right KIND of answer, taken from the WRONG BODY — and
        // only where a body exists, so the refusal contract still looks perfect.
        // This is the failure a nullptr check alone would never see, which is
        // why P1 compares identity and P4 compares counts.
        const brep::Solid* real = forge::nativeSolidOf(h);
        return real != nullptr ? scratch : real;
    }
    return forge::nativeSolidOf(h);
}

static std::size_t faceCountOfPayload(const brep::Solid* s) {
    if (s == nullptr) return 0;
    std::size_t n = 0;
    for (const brep::Shell* sh : s->shells) {
        if (sh != nullptr) n += sh->faces.size();
    }
    return n;
}

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) {
            g_mutation = std::atoi(argv[++i]);
        }
    }
    if (g_mutation != 0) std::printf("[payload-seam] MUTATION %d ACTIVE\n", g_mutation);

    // A second, DIFFERENT body alive for the whole run: 10x10x10 against the
    // 2x3x4 below. P1 and P4 exist to prove no answer comes from this one.
    brep::TopologyBuilder scratch;
    brep::Solid* scratchSolid = scratch.buildBox({0, 0, 0}, {10, 10, 10});
    if (scratchSolid == nullptr) {
        std::printf("[payload-seam] FATAL: the scratch box did not build; the "
                    "mutations below could not be staged. Refusing to report.\n");
        return 2;
    }

    // ── P0: REFUSAL, before anything is registered ───────────────────────────
    std::printf("[P0] the payload readers refuse what names nothing\n");
    check(readSolid(kInvalidHandle, scratchSolid) == nullptr,
          "nativeSolidOf(kInvalidHandle) is nullptr");
    check(forge::nativeMeshOf(kInvalidHandle) == nullptr,
          "nativeMeshOf(kInvalidHandle) is nullptr");
    // A handle that was never issued. next_ starts at 1 and this run cannot have
    // issued four billion of them.
    const ShapeHandle never = static_cast<ShapeHandle>(0xDEADBEEFu);
    check(!forge::shapeHandleKnown(never), "the control handle is genuinely unknown");
    check(readSolid(never, scratchSolid) == nullptr,
          "nativeSolidOf(unknown handle) is nullptr");
    check(forge::nativeMeshOf(never) == nullptr,
          "nativeMeshOf(unknown handle) is nullptr");

    // ── P1: the payload, and that it IS the payload ──────────────────────────
    std::printf("[P1] the registered brep::Solid comes back, by identity\n");
    auto owner = std::make_shared<brep::TopologyBuilder>();
    brep::Solid* solid = owner->buildBox({0, 0, 0}, {2, 3, 4});
    if (solid == nullptr) {
        std::printf("[payload-seam] FATAL: the box did not build.\n");
        return 2;
    }
    const ShapeHandle h = forge::addNativeSolidShape(owner, solid);
    check(h != kInvalidHandle, "the seam returned a live handle",
          "h=" + std::to_string(h));
    check(forge::shapeKind(h) == ShapeKind::NativeSolid, "shapeKind() says NativeSolid");

    const brep::Solid* got = readSolid(h, scratchSolid);
    const bool live = check(got != nullptr, "nativeSolidOf() answers a body");
    check(got == solid,
          "and it is POINTER-IDENTICAL to the solid that was registered (a borrow, "
          "not a copy)");
    check(got != scratchSolid, "and it is NOT the scratch solid alive beside it");

    // ── P2: the wrong kind is refused, not approximated ──────────────────────
    std::printf("[P2] a NativeSolid handle is not a native mesh\n");
    check(forge::nativeMeshOf(h) == nullptr,
          "nativeMeshOf(NativeSolid handle) is nullptr");
    std::printf("      (the POSITIVE nativeMeshOf case is NOT covered here: no "
                "OCCT-free seam registers a mesh yet — see the header.)\n");

    // ── P3: the payload survives the caller letting go ───────────────────────
    std::printf("[P3] the caller drops its reference; the payload is still there\n");
    owner.reset();
    const brep::Solid* afterDrop = readSolid(h, scratchSolid);
    const bool stillThere = check(afterDrop == solid,
          "nativeSolidOf() still answers the same body after the caller let go");

    // ── P4: the two doors agree ──────────────────────────────────────────────
    // Only run if BOTH readers gave something to compare; otherwise this would
    // dereference a null payload and take the [FAIL] above down with a SIGSEGV.
    std::printf("[P4] the payload reader and the facade reader see ONE body\n");
    if (!live || !stillThere) {
        std::printf("[payload-seam] the payload did not come back; comparing it "
                    "against the facade would be undefined, so it is NOT done\n");
        forge::releaseShape(h);
        return verdict();
    }
    const shape::Shape facade = forge::nativeShapeOf(h);
    if (facade.isNull() || !facade.isSolid()) {
        check(false, "nativeShapeOf() answers a live SOLID for the same handle");
        forge::releaseShape(h);
        return verdict();
    }
    const std::size_t nPayload = faceCountOfPayload(afterDrop);
    const std::size_t nFacade  = shape::Explorer(facade, shape::ShapeType::FACE).count();
    check(nPayload == 6,
          "the payload's own shells carry the box's 6 faces",
          "payload faces=" + std::to_string(nPayload));
    check(nPayload == nFacade,
          "payload face count == Explorer face count through nativeShapeOf()",
          "payload=" + std::to_string(nPayload) + " facade=" + std::to_string(nFacade));

    // ── P0 again, on a RELEASED handle ───────────────────────────────────────
    std::printf("[P0b] a released handle names nothing\n");
    forge::releaseShape(h);
    check(readSolid(h, scratchSolid) == nullptr,
          "nativeSolidOf(released handle) is nullptr");
    check(forge::nativeMeshOf(h) == nullptr,
          "nativeMeshOf(released handle) is nullptr");

    return verdict();
}
