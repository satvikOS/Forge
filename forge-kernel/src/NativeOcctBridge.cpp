// forge/NativeOcctBridge.cpp — native→OCCT fallback bridge (see header).

#include "forge/NativeOcctBridge.hpp"

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/StepAnalytic.hpp"

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS_Shape.hxx>

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
