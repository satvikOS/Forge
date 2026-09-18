// ShapeClassify.cpp — the seam's only implementation.
//
// This is the ONLY translation unit allowed to reach ShapeRegistry::get /
// getNativeSolid / importOcctSolid for the purpose of classification. That
// restriction is the entire point: see include/forge/ShapeClassify.hpp for why a
// singular seam is what makes the OCCT classifier deletable at all.
//
// NOTE ON WHAT THIS FILE DOES *NOT* CONTAIN. It names no OCCT classifier. It does
// not #include <BRepClass3d_SolidClassifier.hxx>, and it must never grow a branch
// that does — not even a guarded one. A guarded branch still emits every symbol it
// names (measured: for months src/Healing.cpp carried an OCCT MakeFilling path
// behind #ifndef FORGE_FILLING_DROP_NATIVE, the option sat at OFF, and all five
// family-C symbols shipped anyway). The binding check is whole-library absence:
//
//     nm -u build-app/libforge_kernel_core.dylib | c++filt | grep -c BRepClass3d
//
// must read 0, and it cannot read 0 if any TU in the library names the type.

#include "forge/ShapeClassify.hpp"

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include "forge/ShapeRegistry.hpp"      // instance(), get(), getNativeSolid()
#include "forge/math/Vec3.hpp"          // math::Vec3 — what pointInSolid takes

#ifdef FORGE_NATIVE_BREP
#include "forge/OcctImport.hpp"         // importOcctSolid, ImportResult
#endif

namespace forge {

namespace {

#ifdef FORGE_NATIVE_BREP

// ---------------------------------------------------------------------------
// THE PER-HANDLE IMPORT CACHE
// ---------------------------------------------------------------------------
// WHY IT EXISTS. A classifier is called PER VOXEL. src/VoxelIoU.cpp runs
// gridN^3 probes — 262,144 at the benchmark's default gridN=64 — against ONE
// body, and src/FeaTet.cpp probes once per candidate tet. Importing the OCCT
// body to a native Solid on every point would make the seam unusable, and the
// OCCT classifier it replaces had exactly the same property: VoxelIoU.cpp:245
// holds its BRepClass3d_SolidClassifier open for precisely this reason
// ("the classifier is loaded in the constructor precisely because loading is the
// expensive half"). So: import once per handle, answer many times.
//
// HOW IT IS INVALIDATED — or rather, WHY IT NEED NOT BE.
//
// It needs no invalidation, and that is a property of the registry rather than an
// assumption about callers. Three facts, each checked in src/ShapeRegistry.cpp:
//
//  1. A handle is NEVER REUSED. Every insert allocates `next_++`
//     (src/ShapeRegistry.cpp:19 for add, :104 for addNativeSolid, :121 for
//     addNativeMesh) and nothing ever decrements or recycles it. So a handle that
//     once meant body X can never later mean body Y, and a cache keyed on the
//     handle cannot confuse two bodies.
//
//  2. The shape behind a LIVE handle is IMMUTABLE through the registry's API.
//     add() takes its TopoDS_Shape by value and get() hands back a
//     `const TopoDS_Shape&`; there is no mutating accessor. So a cached import
//     cannot drift out of date while the handle is alive.
//
//  3. A handle whose refcount reaches zero is ERASED (src/ShapeRegistry.cpp:52).
//     classifyPoint checks shapeHandleKnown(h) BEFORE it consults the cache, so a
//     dead handle throws and its cache entry is never readable again. Without
//     that ordering the cache would be a genuine defect: it would answer from a
//     stale entry for a handle the registry had already destroyed. The check is
//     cheap (it is a registry lookup, the same one get() would do) and the cache
//     still saves the expensive half, which is the import and not the lookup.
//
// What remains is a BOUNDED LEAK, stated rather than hidden: one imported topology
// per OCCT body ever classified, retained until classifyCacheClear(). That is the
// same lifetime the old per-call-site classifier objects had in aggregate, and it
// is bounded by the number of distinct bodies a process classifies.
// NEGATIVE CACHING IS NOT AN OPTIMISATION HERE, IT IS A REQUIREMENT.
//
// MEASURED, and it is why this field exists. The first version of this file cached
// only SUCCESSFUL imports and threw before the insert, so a handle whose import
// declines re-ran the whole of importOcctSolid on EVERY call. The A/B gate over the
// gold corpus then "timed out" on parts ho0.step and ho696.step at 60s/part, and
// the timeout looked like slow geometry. It was not: both parts refuse in under
// 140 ms. The gate was paying one full failed import per probe — 296 probes x ~100 ms
// on ho0.step — for an answer that could never change.
//
// In production that is far worse than a slow gate. src/VoxelIoU.cpp probes
// gridN^3 = 262,144 points against one body; on a body whose import declines that
// would have been 262,144 failed imports before the caller saw the first refusal.
// So the refusal is cached exactly like the success: decided once per handle.
struct CacheEntry {
    bool ok = false;                                        // did the import succeed?
    std::string reason;                                     // why not, when it did not
    std::shared_ptr<native::brep::TopologyBuilder> owner;  // keeps the topology alive
    native::brep::Solid* solid = nullptr;                   // non-owning view into *owner
};

std::mutex& cacheMutex() {
    static std::mutex m;
    return m;
}

std::unordered_map<ShapeHandle, CacheEntry>& cache() {
    static std::unordered_map<ShapeHandle, CacheEntry> c;
    return c;
}

#endif  // FORGE_NATIVE_BREP

}  // namespace

std::size_t classifyCacheSize() {
#ifdef FORGE_NATIVE_BREP
    std::lock_guard<std::mutex> lk(cacheMutex());
    // Counts SUCCESSFUL imports only. The A/B gate reads this as positive proof
    // that an OCCT body really traversed importOcctSolid -> native pointInSolid, so
    // counting cached refusals here would let a run of pure refusals masquerade as
    // a run that crossed the bridge.
    std::size_t n = 0;
    for (const auto& kv : cache()) if (kv.second.ok) ++n;
    return n;
#else
    return 0;
#endif
}

void classifyCacheClear() {
#ifdef FORGE_NATIVE_BREP
    std::lock_guard<std::mutex> lk(cacheMutex());
    cache().clear();
#endif
}

PointClass classifyPoint(ShapeHandle h, double x, double y, double z,
                         double onTol) {
    const math::Vec3 p{x, y, z};

    // Fact 3 above: liveness FIRST, before the cache is consulted. A dead handle
    // must not be answerable from a stale import.
    if (!shapeHandleKnown(h)) {
        throw ClassifyRefused(
            "classifyPoint: handle " + std::to_string(h) +
            " is not live in the ShapeRegistry (never issued, or already released)");
    }

    switch (shapeKind(h)) {

    // ---------------------------------------------------------------- native
    case ShapeKind::NativeSolid: {
#ifdef FORGE_NATIVE_BREP
        // The already-native case: no bridge, no cache, no import. This is the
        // path the whole migration is aiming at.
        return native::brep::pointInSolid(
            ShapeRegistry::instance().getNativeSolid(h), p, onTol);
#else
        throw ClassifyRefused(
            "classifyPoint: handle " + std::to_string(h) +
            " is a NativeSolid but this build has FORGE_NATIVE_BREP off, so the "
            "native B-rep query is not compiled in");
#endif
    }

    // ------------------------------------------------------------------ OCCT
    case ShapeKind::Occt: {
#ifdef FORGE_NATIVE_BREP
        std::shared_ptr<native::brep::TopologyBuilder> keepAlive;
        native::brep::Solid* solid = nullptr;

        {
            std::lock_guard<std::mutex> lk(cacheMutex());
            auto it = cache().find(h);
            if (it != cache().end() && !it->second.ok) {
                // Decided already, and the answer cannot change: the shape behind a
                // live handle is immutable (see fact 2 above). Refuse immediately
                // instead of re-running the import.
                throw ClassifyRefused(
                    "classifyPoint: handle " + std::to_string(h) +
                    " is OCCT-backed and importOcctSolid declined: " + it->second.reason);
            }
            if (it != cache().end()) {
                // Take our OWN reference to the topology before unlocking. The
                // raw Solid* views into *owner, so holding the shared_ptr for the
                // duration of the call is what makes it safe to run the query
                // outside the lock (and makes a concurrent classifyCacheClear()
                // unable to pull the geometry out from under a live call).
                keepAlive = it->second.owner;
                solid = it->second.solid;
            }
        }

        if (solid == nullptr) {
            // Import OUTSIDE the lock: importOcctSolid walks every face and is far
            // too slow to hold a global mutex across. Two threads racing the same
            // handle may both import; try_emplace below settles which one's result
            // the cache keeps, and the loser's import is simply dropped.
            ImportResult imported = importOcctSolid(ShapeRegistry::instance().get(h));

            // NO FALLBACK. See the header: a fallback branch would name the OCCT
            // classifier and every one of the eight symbols would stay in the
            // link, making the measured delta of this exercise zero.
            if (!imported.ok || imported.solid == nullptr) {
                const std::string why = imported.reason.empty()
                                            ? std::string("(no reason given)")
                                            : imported.reason;
                {   // remember the refusal before throwing — see CacheEntry above
                    std::lock_guard<std::mutex> lk(cacheMutex());
                    CacheEntry neg;
                    neg.ok = false;
                    neg.reason = why;
                    cache().try_emplace(h, std::move(neg));
                }
                throw ClassifyRefused(
                    "classifyPoint: handle " + std::to_string(h) +
                    " is OCCT-backed and importOcctSolid declined: " + why);
            }

            std::lock_guard<std::mutex> lk(cacheMutex());
            // try_emplace, NOT operator[]: if another thread inserted first we must
            // use ITS entry and leave the map's shared_ptr alone. Overwriting would
            // drop the last reference to the topology that thread is still reading
            // through, and its Solid* would dangle.
            CacheEntry pos;
            pos.ok = true;
            pos.owner = imported.owner;
            pos.solid = imported.solid;
            auto it = cache().try_emplace(h, std::move(pos)).first;
            keepAlive = it->second.owner;
            solid = it->second.solid;
        }

        // keepAlive is load-bearing: it is the reference that keeps *solid's
        // topology alive across the query below. It is deliberately not read.
        (void)keepAlive;

        return native::brep::pointInSolid(*solid, p, onTol);
#else
        throw ClassifyRefused(
            "classifyPoint: handle " + std::to_string(h) +
            " is OCCT-backed and this build has FORGE_NATIVE_BREP off, so the "
            "OCCT->native import bridge is not compiled in");
#endif
    }

    // ------------------------------------------------------------ native mesh
    case ShapeKind::NativeMesh:
        // STATED HONESTLY, as the task requires. There is no point-in-mesh query
        // in forge/native/mesh today: HalfEdgeMesh.hpp carries no containment
        // predicate and native::brep::pointInSolid takes a brep::Solid, not a
        // mesh. Reporting Outside here would be a fabricated answer, and Outside
        // is specifically the answer that removes material. So this REFUSES, by
        // name, and a consumer that legitimately needs mesh containment has to
        // come back and build the query rather than inherit a wrong default.
        throw ClassifyRefused(
            "classifyPoint: handle " + std::to_string(h) +
            " is a NativeMesh and there is no point-in-mesh containment query in "
            "forge/native/mesh — refusing rather than reporting Outside for it");
    }

    // shapeKind() returns one of the three enumerators above. A new ShapeKind
    // arriving without a branch here must be loud, not silently Outside.
    throw ClassifyRefused(
        "classifyPoint: handle " + std::to_string(h) +
        " has a ShapeKind this seam does not handle");
}

}  // namespace forge
