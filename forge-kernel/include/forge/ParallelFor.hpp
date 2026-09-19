#pragma once

// ParallelFor — the kernel's one shared answer to "run this index range on every core".
//
// WHY THIS FILE EXISTS
//
// Before it, this kernel was single-threaded everywhere that mattered. Tessellate.cpp
// owned the only real worker pool; BooleanTol.cpp, Features.cpp and Booleans.cpp each
// spawn a std::thread, but as a TIMEOUT WATCHDOG, not for parallelism. A grep of src/
// and include/ for arm_neon.h, Accelerate/Accelerate.h, simd/simd.h and cblas_ returns
// no file at all. Every embarrassingly parallel loop — voxel classification being the
// worst of them, at 2 x gridN^3 point-in-solid queries per scored part — ran on one
// core of fourteen.
//
// HEADER-ONLY ON PURPOSE. Adding a src/*.cpp edits CMakeLists.txt, and editing
// CMakeLists.txt invalidates three derived files in sequence (OCCT_REMOVAL_TRACKER.md
// -> archie_op_vocabulary.json -> ui/ArchieOpVocabulary.hpp). Sixty lines of standard
// library are not worth putting a build-system cascade between a caller and a core.
//
// WHY TILES ARE CLAIMED, NOT DEALT
//
// The obvious split is "n/threads contiguous cells each". It is the wrong split on this
// hardware, and measurably so. An Apple-silicon M-series part is 10 PERFORMANCE cores
// plus 4 EFFICIENCY cores, and an E-core does not retire a tile in the time a P-core
// does. An equal static partition finishes when its SLOWEST share finishes, so the few
// slow shares set the clock while the fast cores idle. The work is intrinsically uneven
// too: a cell deep inside a solid classifies far faster than one that lands on a face.
//
// So the range is cut into many MORE tiles than there are workers, and each worker
// claims the next unclaimed tile from one shared atomic cursor whenever it goes idle.
// A slow core simply claims fewer tiles. This is dynamic self-scheduling over an
// over-decomposed space — the same balancing property a work-stealing deque gives, with
// one atomic instead of a deque per worker, which is the right trade when a tile body
// is hundreds of microseconds and never spawns sub-work.
//
// DETERMINISM IS A REQUIREMENT, NOT A HOPE
//
// Nothing here shares a mutable result cell. `body` is handed a worker index and is
// expected to write only into that worker's own slot; the caller merges slots in worker
// order afterwards. Which worker happens to take which tile is nondeterministic and
// must not be observable in the answer.

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <functional>
#include <thread>
#include <vector>

namespace forge {

// Worker count for a parallel region.
//   requested > 0   -> exactly that many, no cap
//   requested <= 0  -> FORGE_VOXEL_THREADS if set and parseable (this ALSO ignores
//                      defaultCap: an explicit request is a measurement, and a cap that
//                      silently swallows it turns a sweep into a flat line — measured,
//                      when an earlier draft capped the override and reported "8 and 14
//                      workers are the same as 4" for the single reason that both were
//                      4); otherwise min(hardware_concurrency, defaultCap), else 1.
//
// defaultCap <= 0 means no cap on the default either.
// 1 means the caller's body runs inline on the calling thread and nothing is spawned.
inline int parallelWorkerCount(int requested = 0, int defaultCap = 0) {
    if (requested > 0) return requested;
    if (const char* e = std::getenv("FORGE_VOXEL_THREADS")) {
        // An unparseable or non-positive override is IGNORED rather than taken as 0.
        // Silently dropping to one thread on a typo would look exactly like "the
        // parallel build is no faster", which is the one conclusion this must never
        // fabricate.
        char* end = nullptr;
        const long v = std::strtol(e, &end, 10);
        if (end && end != e && v > 0) return static_cast<int>(std::min<long>(v, 1024));
    }
    const unsigned hw = std::thread::hardware_concurrency();
    int n = hw ? static_cast<int>(hw) : 1;
    if (defaultCap > 0) n = std::min(n, defaultCap);
    return n;
}

// Run `body(begin, end, worker)` over every index of [0, n), exactly once each.
//
//   tile     indices per claim. <= 0 asks for the default: enough tiles that each worker
//            can claim about 64 of them — deep enough to absorb the P/E core asymmetry,
//            shallow enough that the atomic is not the bottleneck.
//   threads  as parallelWorkerCount() above.
//
// `body` must not throw: an escaping exception would cross a thread boundary and call
// std::terminate. Catch inside it, as the voxel loop does.
inline void parallelForTiles(long n, long tile, int threads,
                             const std::function<void(long begin, long end, int worker)>& body) {
    if (n <= 0) return;
    int workers = parallelWorkerCount(threads);
    if (workers < 1) workers = 1;
    if (static_cast<long>(workers) > n) workers = static_cast<int>(n);

    if (tile <= 0) {
        tile = n / (static_cast<long>(workers) * 64);
        if (tile < 1) tile = 1;
    }

    if (workers == 1) {
        // A real path, not a degenerate configuration of the parallel one: this is what
        // FORGE_VOXEL_THREADS=1 must exercise when it is used as a determinism control.
        for (long b = 0; b < n; b += tile) body(b, std::min(b + tile, n), 0);
        return;
    }

    std::atomic<long> cursor{0};
    std::vector<std::thread> pool;
    pool.reserve(static_cast<std::size_t>(workers));
    for (int w = 0; w < workers; ++w) {
        pool.emplace_back([&, w]() {
            for (;;) {
                const long b = cursor.fetch_add(tile, std::memory_order_relaxed);
                if (b >= n) return;
                body(b, std::min(b + tile, n), w);
            }
        });
    }
    for (auto& t : pool) t.join();
}

}  // namespace forge
