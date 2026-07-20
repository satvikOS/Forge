#include "forge/Tessellate.hpp"

// IN-HOUSE KERNEL STEP 3a — native tessellation on a native-backed handle behind
// FORGE_NATIVE_BREP. NativeSolid -> watertight analytic-face tessellation +
// smooth normals + per-tri faceIds; NativeMesh -> the fillet/chamfer result soup.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#endif

#include "forge/OcctNativeMesh.hpp"   // K5 — native display mesher (no BRepMesh/TKMesh)

#include <cstdio>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace forge {

// K5 — the smooth-normal accumulation + per-face renormalise (area-weighted) that
// the BRepMesh readback used now lives in the native display mesher
// (forge::occtmesh::tessellateShapeForViewport), so this TU no longer touches any
// OCCT geometry/triangulation type.

Mesh tessellate(ShapeHandle h, double linearTol, double angularTol) {
#ifdef FORGE_NATIVE_BREP
    {
        auto& reg = ShapeRegistry::instance();
        ShapeKind k = reg.kindOf(h);
        if (k == ShapeKind::NativeSolid || k == ShapeKind::NativeMesh) {
            namespace nb = forge::native::brep;
            nb::NativeTessOut t = (k == ShapeKind::NativeSolid)
                ? nb::tessellateSolidForViewport(reg.getNativeSolid(h))
                : nb::tessellateMeshForViewport(reg.getNativeMesh(h));
            Mesh out;
            out.positions = std::move(t.positions);
            out.normals   = std::move(t.normals);
            out.indices   = std::move(t.indices);
            out.faceIds   = std::move(t.faceIds);
            return out;
        }
    }
#endif
    // K5 — DISPLAY meshing is fully NATIVE (forge::occtmesh, no BRepMesh / TKMesh).
    // The native path returns the full viewport contract (positions + smooth
    // normals + 1-based per-tri faceIds + indices) directly, verified watertight &
    // genus-identical to BRepMesh across the core A/B battery + the FeaTet / Drawings
    // gates (0 deferrals anywhere). An OCCT face the native path cannot read (no
    // pcurve) is an HONEST DEFERRAL: TKMesh is gone, so there is NO BRepMesh
    // fallback — the shape renders with an empty mesh (never a crash) and logs.
    const auto& shape = ShapeRegistry::instance().get(h);
    Mesh out;
    if (!forge::occtmesh::tessellateShapeForViewport(
            shape, out.positions, out.normals, out.indices, out.faceIds,
            linearTol, angularTol)) {
        std::fprintf(stderr,
            "[K5][tessellate] native occtmesh DEFERRED (no BRepMesh) — empty mesh for this shape\n");
    }
    return out;
}

// ---------------------------------------------------------------- async pool
//
// Lazy-initialised on first tessellateAsync() call. Workers pull jobs off
// a shared queue under a mutex + condvar. Pool size is
// max(1, hardware_concurrency()-1) so the main thread always has a core
// for the V8 isolate while big STEP imports tessellate in the background.

namespace {

struct TessJob {
    ShapeHandle h;
    double linTol;
    double angTol;
    std::function<void(Mesh)> done;
};

struct TessPool {
    std::mutex              mtx;
    std::condition_variable cv;
    std::queue<TessJob>     jobs;
    std::vector<std::thread> workers;
    std::atomic<std::size_t> inflight{0};      // jobs pulled but not yet finished
    std::atomic<std::size_t> queued{0};        // jobs waiting in the queue
    std::atomic<std::size_t> completed{0};
    std::atomic<bool>       stop{false};
    std::condition_variable idleCv;
    std::mutex              idleMtx;

    void workerLoop() {
        for (;;) {
            TessJob job;
            {
                std::unique_lock<std::mutex> g(mtx);
                cv.wait(g, [&]{ return stop || !jobs.empty(); });
                if (stop && jobs.empty()) return;
                job = std::move(jobs.front());
                jobs.pop();
                queued.store(jobs.size(), std::memory_order_relaxed);
                inflight.fetch_add(1, std::memory_order_relaxed);
            }
            try {
                Mesh m = tessellate(job.h, job.linTol, job.angTol);
                if (job.done) job.done(std::move(m));
            } catch (...) {
                // Swallow — the done callback signature has no error path.
                if (job.done) job.done(Mesh{});
            }
            completed.fetch_add(1, std::memory_order_relaxed);
            inflight.fetch_sub(1, std::memory_order_relaxed);
            {
                std::lock_guard<std::mutex> g(idleMtx);
                idleCv.notify_all();
            }
        }
    }
};

// Static singleton — destructor sets stop+joins, so V8 exit doesn't
// abort with libc++abi when worker threads outlive the main thread.
struct PoolHolder {
    TessPool p;
    ~PoolHolder() {
        {
            std::lock_guard<std::mutex> g(p.mtx);
            p.stop = true;
        }
        p.cv.notify_all();
        for (auto& th : p.workers) {
            if (th.joinable()) th.join();
        }
    }
};

TessPool& pool() {
    static PoolHolder holder;
    static std::once_flag flag;
    std::call_once(flag, [] {
        unsigned hc = std::thread::hardware_concurrency();
        unsigned n = (hc > 1) ? hc - 1 : 1;
        for (unsigned i = 0; i < n; ++i) {
            holder.p.workers.emplace_back([] { pool().workerLoop(); });
        }
    });
    return holder.p;
}

} // namespace

void tessellateAsync(ShapeHandle h, double linearTol, double angularTol,
                     std::function<void(Mesh)> done) {
    auto& p = pool();
    {
        std::lock_guard<std::mutex> g(p.mtx);
        p.jobs.push(TessJob{h, linearTol, angularTol, std::move(done)});
        p.queued.store(p.jobs.size(), std::memory_order_relaxed);
    }
    p.cv.notify_one();
}

void waitForTessellationIdle() {
    auto& p = pool();
    std::unique_lock<std::mutex> g(p.idleMtx);
    p.idleCv.wait(g, [&] {
        std::lock_guard<std::mutex> jg(p.mtx);
        return p.jobs.empty() && p.inflight.load() == 0;
    });
}

std::size_t tessellationPoolSize() {
    return pool().workers.size();
}
std::size_t tessellationQueued() {
    return pool().queued.load(std::memory_order_relaxed);
}
std::size_t tessellationCompletedSinceLaunch() {
    return pool().completed.load(std::memory_order_relaxed);
}

} // namespace forge
