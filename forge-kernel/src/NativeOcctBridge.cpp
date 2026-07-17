// forge/NativeOcctBridge.cpp — native→OCCT fallback bridge (see header).

#include "forge/NativeOcctBridge.hpp"

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/StepAnalytic.hpp"

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <system_error>

namespace forge {
namespace {
// Monotone per-process counter — unique temp paths without Date/random.
std::atomic<std::uint64_t> g_bridgeCtr{0};
}  // namespace

// native analytic Solid -> OCCT TopoDS_Shape, via the validated analytic STEP
// round-trip (StepAnalytic::write -> temp .step -> OCCT STEPControl_Reader).
TopoDS_Shape occtFromNativeSolid(const native::brep::Solid& solid) {
    auto wr = native::brep::StepAnalytic::write(solid, "forge_native_occt_bridge");
    if (!wr.ok) {
        throw std::runtime_error(
            "native->OCCT bridge: analytic STEP write failed: " + wr.reason);
    }

    namespace fs = std::filesystem;
    const fs::path path = fs::temp_directory_path() /
        ("forge_bridge_" + std::to_string(g_bridgeCtr.fetch_add(1, std::memory_order_relaxed))
         + ".step");
    {
        std::ofstream out(path, std::ios::binary);
        if (!out) {
            throw std::runtime_error("native->OCCT bridge: cannot open temp file " + path.string());
        }
        out << wr.text;
    }

    STEPControl_Reader reader;
    const IFSelect_ReturnStatus stat = reader.ReadFile(path.string().c_str());
    std::error_code ec;
    fs::remove(path, ec);  // best-effort cleanup; never mask the read result
    if (stat != IFSelect_RetDone) {
        throw std::runtime_error("native->OCCT bridge: OCCT STEP read failed");
    }
    reader.TransferRoots();
    TopoDS_Shape shape = reader.OneShape();
    if (shape.IsNull()) {
        throw std::runtime_error("native->OCCT bridge: OCCT produced a null shape");
    }

    // G1 ANALYTIC-FACE SURVIVAL (Parasolid/ACIS parity). The native analytic Solid
    // carries each smooth surface (cylinder/cone/torus wall) as N angular STRIP
    // faces (buildCylinder emits nSeg=128), so the STEP round-trip above hands OCCT
    // 128 co-domain ADVANCED_FACEs for one cylinder — a shattered topology in which
    // direct.* / naming / drawings / STEP-export have no well-defined analytic face
    // to target (KERNEL_PARITY_PLAN G1, the #1 root-cause defect). Coalesce every
    // maximal set of faces that share the SAME underlying surface into ONE analytic
    // face here, at the single lazy-bridge point, so faceInventory/faceCount/direct
    // all observe the canonical minimal B-rep (cylinder 3F, cone 3F, torus 1F —
    // matching OCCT's own BRepPrimAPI). This is SAME-GEOMETRY (UnifySameDomain never
    // moves a surface; volume/COM are byte-preserved) and SELF-LIMITING (a no-op on
    // already-minimal planar solids: box stays 6F, so the brepExact A/B gate holds).
    // The stored native Solid (getNativeSolid) is untouched, so native ops that
    // consume the strip topology are unaffected. Defensive: any UnifySameDomain
    // failure keeps the raw round-trip shape — the bridge is never made more fragile.
    try {
        ShapeUpgrade_UnifySameDomain unifier(
            shape, Standard_True /*unifyEdges*/, Standard_True /*unifyFaces*/,
            Standard_True /*concatBSplines*/);
        unifier.Build();
        const TopoDS_Shape unified = unifier.Shape();
        if (!unified.IsNull()) {
            shape = unified;
        }
    } catch (const Standard_Failure&) {
        // Keep the un-unified round-trip shape (still valid): correctness of the
        // returned solid is unchanged, only its face granularity.
    }

    return shape;
}

ShapeHandle toOcctBackedHandle(ShapeHandle h) {
    auto& reg = ShapeRegistry::instance();
    const ShapeKind k = reg.kindOf(h);
    if (k == ShapeKind::NativeSolid) {
        return reg.add(occtFromNativeSolid(reg.getNativeSolid(h)));
    }
    if (k == ShapeKind::NativeMesh) {
        throw std::runtime_error(
            "toOcctBackedHandle: NativeMesh (faceted feature result) bridging is a "
            "later wave — the analytic-solid bridge does not cover it");
    }
    return h;  // already OCCT-backed
}

}  // namespace forge

#else  // !FORGE_NATIVE_BREP — pure OCCT build: identity (no native handles exist).

namespace forge {
ShapeHandle toOcctBackedHandle(ShapeHandle h) { return h; }
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
