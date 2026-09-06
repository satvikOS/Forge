// src/native/brep/NativeAabbBridge.cpp
//
// Implementation of the ONE OCCT-shape -> native-analytic-AABB seam. See
// include/forge/native/brep/NativeAabbBridge.hpp for the contract and for the
// measured 1e-7 delta that makes this gated.
//
// This TU is listed UNCONDITIONALLY in CMakeLists and defines every declared
// symbol in BOTH arms of FORGE_NATIVE_BREP. The target links with
// -undefined dynamic_lookup: a conditionally-listed source is a runtime SIGSEGV,
// not a link error, and that has bitten this kernel before.

#include "forge/native/brep/NativeAabbBridge.hpp"

#if __has_include(<BRepBndLib.hxx>)
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <TopoDS_Shape.hxx>
#define FORGE_HAVE_OCCT_AABB 1
#endif

#include <atomic>
#include <cmath>
#include <cstdlib>
#include <string>

#if defined(FORGE_HAVE_OCCT_AABB) && defined(FORGE_NATIVE_BREP)
#include "forge/OcctImport.hpp"                // importOcctSolid
#include "forge/native/brep/Aabb.hpp"          // computeAabb (exact analytic)
#endif

namespace forge {
namespace native {
namespace brep {

namespace {
std::atomic<int>                g_aabbOverride{-1};
std::atomic<unsigned long long> g_calls{0};
std::atomic<unsigned long long> g_native{0};

bool readEnvFlagAabb(const char* name) {
    const char* v = std::getenv(name);
    if (!v) return false;
    std::string s(v);
    for (auto& c : s) c = static_cast<char>(std::tolower((unsigned char)c));
    return s == "1" || s == "on" || s == "true" || s == "yes";
}
} // namespace

bool forgeNativeAabbEnabled() {
    const int ov = g_aabbOverride.load(std::memory_order_relaxed);
    if (ov >= 0) return ov != 0;
    // DEFAULT OFF. Unlike CORE/STEP/INTERFERENCE this is not "unset means on":
    // flipping it changes every converted box by the OCCT shape tolerance, so it
    // must be asked for explicitly.
    static const bool envOn = readEnvFlagAabb("FORGE_NATIVE_AABB");
    return envOn;
}

void setForgeNativeAabbEnabled(bool on) {
    g_aabbOverride.store(on ? 1 : 0, std::memory_order_relaxed);
}

unsigned long long shapeAabbCallCount()   { return g_calls.load(std::memory_order_relaxed); }
unsigned long long shapeAabbNativeCount() { return g_native.load(std::memory_order_relaxed); }

bool shapeAabbNative(const TopoDS_Shape& shape, Bnd_Box& box) {
    g_calls.fetch_add(1, std::memory_order_relaxed);

#if defined(FORGE_HAVE_OCCT_AABB) && defined(FORGE_NATIVE_BREP)
    if (forgeNativeAabbEnabled() && !shape.IsNull()) {
        // importOcctSolid never throws on an unsupported face — it returns
        // ok=false with a named reason (measured: a bare FACE gives "import not
        // 2-manifold", a WIRE gives "no faces in shape"). The try/catch is for
        // anything deeper in OCCT's traversal, not for control flow.
        bool haveNative = false;
        double b[6] = {0, 0, 0, 0, 0, 0};
        try {
            ImportResult ir = importOcctSolid(shape);
            if (ir.ok && ir.solid != nullptr) {
                const Aabb3 a = computeAabb(*ir.solid);
                if (!a.void_) {
                    b[0] = a.minX; b[1] = a.minY; b[2] = a.minZ;
                    b[3] = a.maxX; b[4] = a.maxY; b[5] = a.maxZ;
                    // A native box that is not finite, or inverted, is a bug in the
                    // analytic path. Refuse it and fall through — a silently wrong
                    // box is far worse than an OCCT call.
                    haveNative = true;
                    for (int i = 0; i < 6; ++i)
                        if (!std::isfinite(b[i])) haveNative = false;
                    for (int i = 0; i < 3; ++i)
                        if (b[i] > b[i + 3]) haveNative = false;
                }
            }
        } catch (...) {
            haveNative = false;
        }
        if (haveNative) {
            // Bnd_Box::Update on a void box SETS it; the box keeps gap 0, so Get()
            // returns exactly these numbers (this is where the 1e-7 that
            // BRepBndLib::Add adds does NOT appear).
            box.Update(b[0], b[1], b[2], b[3], b[4], b[5]);
            g_native.fetch_add(1, std::memory_order_relaxed);
            return true;
        }
    }
#endif

#if defined(FORGE_HAVE_OCCT_AABB)
    // Gate OFF, import declined, or the native box failed its own sanity check.
    // EXACTLY what the call site did before this seam existed.
    BRepBndLib::Add(shape, box);
    return false;
#else
    (void)shape;
    (void)box;
    return false;
#endif
}

void shapeAabb(const TopoDS_Shape& shape, Bnd_Box& box) {
    (void)shapeAabbNative(shape, box);
}

} // namespace brep
} // namespace native
} // namespace forge
