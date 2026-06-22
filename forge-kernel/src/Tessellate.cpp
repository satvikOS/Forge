#include "forge/Tessellate.hpp"

// IN-HOUSE KERNEL STEP 3a — native tessellation on a native-backed handle behind
// FORGE_NATIVE_BREP. NativeSolid -> watertight analytic-face tessellation +
// smooth normals + per-tri faceIds; NativeMesh -> the fillet/chamfer result soup.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/NativeRoute.hpp"
#endif

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace forge {

namespace {
// Accumulate weighted face normal into each of the triangle's three vertices.
// At the end we re-normalise once. This matches the standard
// "smooth-shaded" behaviour Three.js viewers expect from BREP meshes.
inline void accumulate(float* dst, const gp_Vec& n) {
    dst[0] += static_cast<float>(n.X());
    dst[1] += static_cast<float>(n.Y());
    dst[2] += static_cast<float>(n.Z());
}
inline void renormalize(float* n) {
    const float l = std::sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    if (l > 1e-20f) { n[0] /= l; n[1] /= l; n[2] /= l; }
    else            { n[0] = 0.0f; n[1] = 0.0f; n[2] = 1.0f; }
}
}

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
    const auto& shape = ShapeRegistry::instance().get(h);

    BRepMesh_IncrementalMesh mesher(shape, linearTol, /*isRelative*/ Standard_False,
                                    angularTol, /*isInParallel*/ Standard_True);
    mesher.Perform();

    Mesh out;

    std::uint32_t faceId = 0;  // 1-based id assigned in TopExp_Explorer order
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face face = TopoDS::Face(ex.Current());
        ++faceId;
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
        if (tri.IsNull()) continue;

        const bool reversed = (face.Orientation() == TopAbs_REVERSED);
        const gp_Trsf& tr = loc.Transformation();
        const std::uint32_t base = static_cast<std::uint32_t>(out.positions.size() / 3);

        // Positions in world space.
        for (Standard_Integer i = 1; i <= tri->NbNodes(); ++i) {
            gp_Pnt p = tri->Node(i).Transformed(tr);
            out.positions.push_back(static_cast<float>(p.X()));
            out.positions.push_back(static_cast<float>(p.Y()));
            out.positions.push_back(static_cast<float>(p.Z()));
        }

        // Zero-fill normals for these new vertices; we'll accumulate
        // per-triangle face normals onto them and renormalize at the end.
        const std::size_t normalsBase = out.normals.size();
        out.normals.resize(normalsBase + 3 * tri->NbNodes(), 0.0f);

        // Triangles + per-triangle normal accumulation.
        for (Standard_Integer i = 1; i <= tri->NbTriangles(); ++i) {
            Standard_Integer n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);
            if (reversed) std::swap(n2, n3);

            const gp_Pnt p1 = tri->Node(n1).Transformed(tr);
            const gp_Pnt p2 = tri->Node(n2).Transformed(tr);
            const gp_Pnt p3 = tri->Node(n3).Transformed(tr);

            const gp_Vec v1(p1, p2);
            const gp_Vec v2(p1, p3);
            gp_Vec n = v1.Crossed(v2); // area-weighted face normal
            if (n.SquareMagnitude() < 1e-30) continue; // degenerate

            accumulate(out.normals.data() + normalsBase + 3*(n1-1), n);
            accumulate(out.normals.data() + normalsBase + 3*(n2-1), n);
            accumulate(out.normals.data() + normalsBase + 3*(n3-1), n);

            out.indices.push_back(base + n1 - 1);
            out.indices.push_back(base + n2 - 1);
            out.indices.push_back(base + n3 - 1);
            out.faceIds.push_back(faceId);  // 1-based BREP face id for this triangle
        }

        // Renormalise this face's contribution.
        for (Standard_Integer i = 1; i <= tri->NbNodes(); ++i) {
            renormalize(out.normals.data() + normalsBase + 3*(i-1));
        }
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
