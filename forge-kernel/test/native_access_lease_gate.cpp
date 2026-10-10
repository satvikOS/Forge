// native_access_lease_gate.cpp — T-261: what the OCCT-free seam
// (forge/NativeShapeAccess.hpp) hands a caller must stay alive while the caller
// reads it, whatever another thread does to the handle meanwhile.
//
// THE DEFECT. T-183 made the registry's own reads co-own what they return
// (ShapeRegistry::getNativeSolid()/getNativeMesh() -> NativeLease<T>), but the
// seam's three free functions kept their BORROW contract: nativeSolidOf(),
// nativeMeshOf() and nativeShapeOf() take the raw pointer out of the lease and
// let the lease go. A caller holding that pointer while another thread releases
// the handle reads freed topology. Every native-payload reader in the kernel
// (MassProps, IoExchange, Sewing, SheetMetal, ClassASurfacing, FeaTet) and the
// desktop's FileExchangeHost read through those borrows.
//
// SCENARIOS (run_native_access_lease_gate.sh drives them all)
//   borrow-solid  borrow-mesh  borrow-shape
//       A reader holds nativeSolidOf(h) / nativeMeshOf(h) / nativeShapeOf(h)
//       and keeps reading while another thread releases h. These are the
//       DEFECT, kept runnable on purpose: the runner REQUIRES each to be caught
//       by the sanitizer (ASan heap-use-after-free, TSan data race). One that
//       comes back clean means the gate can no longer see the defect.
//   lease-solid   lease-mesh   lease-shape
//       The same reader on nativeSolidLease / nativeMeshLease /
//       nativeShapeLease: no sanitizer report, the payload is still there after
//       the handle is gone (the handle is unknown, the payload's weak_ptr has
//       not expired), and it dies exactly when the reader drops the lease.
//   lease-refusal  the leases' refusal contract: invalid, unknown, released and
//                  wrong-kind handles all give an EMPTY lease and never throw.
//   lease-stress   8 threads x 2000 mixed create / lease / read / release ops on
//                  shared handles; no sanitizer report, live count back to base.
//   integ-massprops  integ-stl          (-DGATE_INTEGRATION)
//       The REAL kernel library: forge::massProperties() / forge::io::exportStl()
//       on a native prism in a tight loop while another thread releases the
//       handle. Every answer must be the closed-form value, nothing may crash,
//       and — the call-site property — the payload's LAST OWNER must be the
//       reader thread in a set share of rounds: the call held a lease across
//       the release (>= 25% for massProperties, >= 5% for exportStl, whose
//       lease covers only its tessellation; see callSiteRace).
//       On the pre-T-261 library that count is 0 (the entry was always the
//       last owner: the call read through a borrow), which the runner records.
//
// BUILD MODES
//   -DGATE_OLD_API      the borrow scenarios only, built against the PRE-T-261
//                       seam (git show): the defect the fix removes, rerun.
//   default             src/ShapeRegistry.cpp, src/ShapeHandle.cpp and
//                       src/NativeShapeAccess.cpp compiled INTO this binary under
//                       -fsanitize=thread or =address; native builders come from
//                       the (uninstrumented) libforge_kernel_core. That is why
//                       the race payloads live in storage THIS binary allocates
//                       (SolidHolder, below): TSan on Darwin ignores frees made
//                       by non-instrumented modules (T-183 measured it).
//   -DGATE_INTEGRATION  nothing compiled in: the real library end to end.
//
// usage: native_access_lease_gate <scenario>   — exit 0 iff every check PASSes.

#include "forge/NativeShapeAccess.hpp"
#include "forge/ShapeHandle.hpp"
#include "forge/ShapeRegistry.hpp"  // addNativeMesh (no seam creates a mesh), liveCount

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/shape/Explore.hpp"

#ifdef GATE_INTEGRATION
#include "forge/IoExchange.hpp"
#include "forge/MassProps.hpp"
#endif

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <vector>

using forge::kInvalidHandle;
using forge::ShapeHandle;
using forge::ShapeRegistry;
namespace nb = forge::native::brep;
namespace nm = forge::native::mesh;
namespace ns = forge::native::shape;

namespace {

int g_fail = 0;
[[maybe_unused]] std::atomic<long> g_sink{0};  // defeats dead-read elimination

bool check(bool ok, const char* scenario, const std::string& what) {
  std::printf("  [%s] %s: %s\n", ok ? "PASS" : "FAIL", scenario, what.c_str());
  std::fflush(stdout);  // a sanitizer abort after a [FAIL] must not swallow it
  if (!ok) ++g_fail;
  return ok;
}

#ifndef GATE_INTEGRATION

// A compiler barrier: every probe below re-reads memory each pass, so the read
// that lands after the release is a real load. Not a synchronisation point, so
// it adds no happens-before edge that would hide the race from TSan.
inline void compilerBarrier() { asm volatile("" ::: "memory"); }

// Read `probe` until the releaser has published (RELAXED on purpose: an acquire
// here would order the free before our reads and TSan, which reports only
// unordered pairs, would stay silent on the borrow API) and then 256 more
// times, so some reads are guaranteed to land after the release.
template <class Probe>
long readUntilReleased(Probe&& probe, const std::atomic<bool>& released) {
  long acc = 0;
  int after = 0;
  while (after < 256) {
    compilerBarrier();
    acc += probe();
    if (released.load(std::memory_order_relaxed)) ++after;
  }
  return acc;
}

// A native solid whose ONLY owner is the registry entry (the local shared_ptr is
// moved in), allocated by this instrumented binary so both sanitizers see it
// freed.
//
// `watch` observes the payload's lifetime through a separate WITNESS token the
// payload owns, never through a weak_ptr to the payload itself: a weak_ptr to a
// make_shared block keeps that block ALLOCATED after the object is destroyed, so
// a read through a dangling pointer would land in destroyed-but-live memory and
// AddressSanitizer would stay silent (measured: the first version of this gate
// killed the solid-lease-borrowed mutant under ASan only through a [FAIL] check,
// never through a heap-use-after-free report).
struct SolidHolder {
  nb::TopologyBuilder tb;  // what the registry's owner pointer names
  nb::Shell shell;
  nb::Solid solid;
  std::shared_ptr<int> witness = std::make_shared<int>(1);
};

ShapeHandle addBareNativeSolid(std::weak_ptr<int>* watch = nullptr) {
  auto holder = std::make_shared<SolidHolder>();
  holder->solid.id = 7;
  holder->shell.id = 1;
  holder->shell.solid = &holder->solid;
  holder->solid.shells.push_back(&holder->shell);
  if (watch != nullptr) *watch = holder->witness;
  nb::Solid* s = &holder->solid;
  nb::TopologyBuilder* tb = &holder->tb;
  std::shared_ptr<nb::TopologyBuilder> owner(std::move(holder), tb);
  return forge::addNativeSolidShape(std::move(owner), s);  // through the seam
}

// The mesh's witness rides in its DELETER: the control block (deleter included)
// is destroyed right after the mesh, when the last strong owner lets go, because
// nothing holds a weak reference to the mesh itself.
ShapeHandle addTetraMesh(std::weak_ptr<int>* watch = nullptr) {
  auto witness = std::make_shared<int>(1);
  if (watch != nullptr) *watch = witness;
  std::shared_ptr<nm::HalfEdgeMesh> m(new nm::HalfEdgeMesh,
                                      [w = std::move(witness)](nm::HalfEdgeMesh* mp) {
                                        (void)w;  // dies with the control block
                                        delete mp;
                                      });
  const std::vector<double> p = {0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1};
  const std::vector<std::uint32_t> t = {0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2};
  if (!m->buildFromSoup(p, t)) return kInvalidHandle;
  return ShapeRegistry::instance().addNativeMesh(std::move(m));
}

// What a reader reads, through the payload (not just the pointer value).
__attribute__((noinline)) long readSolid(const nb::Solid& sol) {
  long r = static_cast<long>(sol.id) + static_cast<long>(sol.shells.size());
  if (!sol.shells.empty()) r += static_cast<long>(sol.shells[0]->faces.size());
  return r;
}
__attribute__((noinline)) long readMesh(const nm::HalfEdgeMesh& m) {
  long r = static_cast<long>(m.vertexCount()) + static_cast<long>(m.faceCount());
  if (m.vertexCount() > 1) r += static_cast<long>(m.vertices()[1].position.x);
  return r;
}
// Through the traversal facade: the Shape's tag, then the solid it views.
__attribute__((noinline)) long readShape(const ns::Shape& s) {
  long r = static_cast<long>(s.isSolid());
  if (const nb::Solid* sol = s.asSolid()) r += readSolid(*sol);
  return r;
}

// One reader takes what the seam hands it and reads; one releaser drops the
// handle once the reader is holding. `read(h, holding, released)` is the
// reader's whole body.
template <class Read>
void raceOnce(ShapeHandle h, Read&& read) {
  std::atomic<bool> holding{false};
  std::atomic<bool> released{false};
  std::thread reader([&] { g_sink += read(h, holding, released); });
  std::thread releaser([&] {
    while (!holding.load(std::memory_order_acquire)) std::this_thread::yield();
    forge::releaseShape(h);
    released.store(true, std::memory_order_relaxed);  // relaxed ON PURPOSE (see above)
  });
  reader.join();
  releaser.join();
}

constexpr int kRaceIters = 64;

// ───────────────────────── the BORROW API: the defect ──────────────────────────
// Each of these is REQUIRED to be caught by the sanitizer. The checks after the
// loop only run if the sanitizer stayed silent, i.e. if the gate went blind.

void borrowSolid() {
  const char* S = "borrow-solid";
  for (int i = 0; i < kRaceIters; ++i) {
    const ShapeHandle h = addBareNativeSolid();
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      const nb::Solid* s = forge::nativeSolidOf(hh);  // the pre-T-261 call-site shape
      if (s == nullptr) return 0L;
      holding.store(true, std::memory_order_release);
      return readUntilReleased([&] { return readSolid(*s); }, released);
    });
  }
  check(false, S, "a reader kept reading nativeSolidOf(h) after another thread released h "
                  "and NO sanitizer reported it — this scenario must be caught");
}

void borrowMesh() {
  const char* S = "borrow-mesh";
  for (int i = 0; i < kRaceIters; ++i) {
    const ShapeHandle h = addTetraMesh();
    if (!check(h != kInvalidHandle, S, "tetra mesh built")) return;
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      const nm::HalfEdgeMesh* m = forge::nativeMeshOf(hh);
      if (m == nullptr) return 0L;
      holding.store(true, std::memory_order_release);
      return readUntilReleased([&] { return readMesh(*m); }, released);
    });
  }
  check(false, S, "a reader kept reading nativeMeshOf(h) after release and NO sanitizer "
                  "reported it — this scenario must be caught");
}

void borrowShape() {
  const char* S = "borrow-shape";
  for (int i = 0; i < kRaceIters; ++i) {
    const ShapeHandle h = addBareNativeSolid();
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      const ns::Shape s = forge::nativeShapeOf(hh);  // FileExchangeHost's call-site shape
      if (s.isNull()) return 0L;
      holding.store(true, std::memory_order_release);
      return readUntilReleased([&] { return readShape(s); }, released);
    });
  }
  check(false, S, "a reader kept walking nativeShapeOf(h) after release and NO sanitizer "
                  "reported it — this scenario must be caught");
}

// ───────────────────────── the LEASE API: the fix ──────────────────────────────
// (Compiled out under -DGATE_OLD_API: the pre-T-261 seam has no leases, which
// is itself the first half of the failing-first proof — see the runner.)
#ifndef GATE_OLD_API

bool known(ShapeHandle h) { return forge::shapeHandleKnown(h); }

// Shared shape of the three lease races: the race itself, then the ownership
// facts asked deterministically (no UB needed to show any of them).
template <class AddFn, class LeaseFn, class ReadFn>
void leaseRace(const char* S, AddFn&& add, LeaseFn&& takeLease, ReadFn&& readLease) {
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  int pinnedAfterRelease = 0;  // rounds where the payload outlived its handle
  int diedWithLease = 0;       // ... and died exactly when the lease went
  int readsOk = 0;
  for (int i = 0; i < kRaceIters; ++i) {
    std::weak_ptr<int> watch;
    const ShapeHandle h = add(&watch);
    if (!check(h != kInvalidHandle, S, "payload registered")) return;
    std::atomic<int> state{0};  // reader's verdict, read after join
    raceOnce(h, [&](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      auto lease = takeLease(hh);
      if (!lease) return 0L;
      holding.store(true, std::memory_order_release);
      const long first = readLease(lease);
      long acc = readUntilReleased([&] { return readLease(lease); }, released);
      // After the release is published: the handle is gone, the payload is not,
      // and it still reads what it read before the release.
      while (!released.load(std::memory_order_acquire)) std::this_thread::yield();
      const bool handleGone = !known(hh);
      const bool stillAlive = !watch.expired();
      const bool sameAnswer = readLease(lease) == first;
      lease = decltype(lease)();  // drop the last owner
      const bool diedNow = watch.expired();
      state.store((handleGone && stillAlive ? 1 : 0) | (diedNow ? 2 : 0) | (sameAnswer ? 4 : 0),
                  std::memory_order_relaxed);
      return acc;
    });
    const int st = state.load(std::memory_order_relaxed);
    pinnedAfterRelease += (st & 1) ? 1 : 0;
    diedWithLease += (st & 2) ? 1 : 0;
    readsOk += (st & 4) ? 1 : 0;
  }
  const std::string n = std::to_string(kRaceIters);
  check(pinnedAfterRelease == kRaceIters, S,
        "after the release the handle was unknown AND the leased payload was alive in " +
            std::to_string(pinnedAfterRelease) + "/" + n + " rounds");
  check(readsOk == kRaceIters, S,
        "the payload read the same after the release as before it in " +
            std::to_string(readsOk) + "/" + n + " rounds");
  check(diedWithLease == kRaceIters, S,
        "the payload died exactly when the reader dropped the lease in " +
            std::to_string(diedWithLease) + "/" + n + " rounds (no leak, no early free)");
  check(reg.liveCount() == base, S,
        "live count back to base (" + std::to_string(reg.liveCount()) + "==" +
            std::to_string(base) + ")");
}

void leaseSolid() {
  leaseRace(
      "lease-solid", [](std::weak_ptr<int>* w) { return addBareNativeSolid(w); },
      [](ShapeHandle h) { return forge::nativeSolidLease(h); },
      [](const forge::NativeLease<nb::Solid>& l) { return readSolid(*l); });
}

void leaseMesh() {
  leaseRace(
      "lease-mesh", [](std::weak_ptr<int>* w) { return addTetraMesh(w); },
      [](ShapeHandle h) { return forge::nativeMeshLease(h); },
      [](const forge::NativeLease<nm::HalfEdgeMesh>& l) { return readMesh(*l); });
}

void leaseShape() {
  leaseRace(
      "lease-shape", [](std::weak_ptr<int>* w) { return addBareNativeSolid(w); },
      [](ShapeHandle h) { return forge::nativeShapeLease(h); },
      [](const forge::NativeShapeLease& l) {
        // Walk it the way FileExchangeHost does: the facade, then the solid.
        return readShape(l.shape()) + static_cast<long>(l.solid().get() == l.shape().asSolid());
      });
}

void leaseRefusal() {
  const char* S = "lease-refusal";
  const ShapeHandle never = 0x7ffffff0u;
  bool threw = false;
  try {
    check(!forge::nativeSolidLease(kInvalidHandle), S, "nativeSolidLease(kInvalidHandle) is empty");
    check(!forge::nativeMeshLease(kInvalidHandle), S, "nativeMeshLease(kInvalidHandle) is empty");
    check(forge::nativeShapeLease(kInvalidHandle).isNull(), S,
          "nativeShapeLease(kInvalidHandle) is null");
    check(!forge::nativeSolidLease(never), S, "nativeSolidLease(unknown) is empty");
    check(!forge::nativeMeshLease(never), S, "nativeMeshLease(unknown) is empty");
    check(!forge::nativeShapeLease(never), S, "nativeShapeLease(unknown) is null");

    const ShapeHandle hs = addBareNativeSolid();
    const ShapeHandle hm = addTetraMesh();
    check(static_cast<bool>(forge::nativeSolidLease(hs)), S, "a NativeSolid handle leases a solid");
    check(!forge::nativeMeshLease(hs), S, "nativeMeshLease(NativeSolid handle) is empty");
    check(static_cast<bool>(forge::nativeMeshLease(hm)), S, "a NativeMesh handle leases a mesh");
    check(!forge::nativeSolidLease(hm), S, "nativeSolidLease(NativeMesh handle) is empty");
    check(forge::nativeShapeLease(hm).isNull(), S, "nativeShapeLease(NativeMesh handle) is null");
    {
      const forge::NativeShapeLease sl = forge::nativeShapeLease(hs);
      check(!sl.isNull() && sl.shape().isSolid() && sl.shape().asSolid() == sl.solid().get(), S,
            "nativeShapeLease() views exactly the solid it pins");
    }
    forge::releaseShape(hs);
    forge::releaseShape(hm);
    check(!forge::nativeSolidLease(hs), S, "nativeSolidLease(released handle) is empty");
    check(!forge::nativeMeshLease(hm), S, "nativeMeshLease(released handle) is empty");
    check(!forge::nativeShapeLease(hs), S, "nativeShapeLease(released handle) is null");
  } catch (...) {
    threw = true;
  }
  check(!threw, S, "no lease call threw");
}

// 8 threads, shared handle pool: create, lease, read, release, in random order.
void leaseStress() {
  const char* S = "lease-stress";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  constexpr int kThreads = 8;
  constexpr int kOps = 2000;
  constexpr int kSlots = 16;
  std::vector<std::atomic<ShapeHandle>> slots(kSlots);
  for (auto& s : slots) s.store(kInvalidHandle);
  std::atomic<long> reads{0};
  std::atomic<long> empties{0};
  std::vector<std::thread> ts;
  for (int t = 0; t < kThreads; ++t) {
    ts.emplace_back([&, t] {
      std::mt19937 rng(1234u + static_cast<unsigned>(t));
      for (int i = 0; i < kOps; ++i) {
        auto& slot = slots[rng() % kSlots];
        switch (rng() % 5) {
          case 0: {  // create into an empty slot (or release what we displace)
            const ShapeHandle h = (rng() & 1) ? addBareNativeSolid() : addTetraMesh();
            const ShapeHandle old = slot.exchange(h);
            if (old != kInvalidHandle) forge::releaseShape(old);
            break;
          }
          case 1: {  // release whatever is there
            const ShapeHandle old = slot.exchange(kInvalidHandle);
            if (old != kInvalidHandle) forge::releaseShape(old);
            break;
          }
          default: {  // lease and read, racing the two above on other threads
            const ShapeHandle h = slot.load();
            if (auto s = forge::nativeSolidLease(h)) {
              g_sink += readSolid(*s);
              ++reads;
            } else if (auto m = forge::nativeMeshLease(h)) {
              g_sink += readMesh(*m);
              ++reads;
            } else {
              ++empties;  // released between load and lease: the honest answer
            }
            if (auto sh = forge::nativeShapeLease(h)) {
              g_sink += readShape(sh.shape());
              ++reads;
            }
            break;
          }
        }
      }
    });
  }
  for (auto& th : ts) th.join();
  for (auto& s : slots) {
    const ShapeHandle h = s.exchange(kInvalidHandle);
    if (h != kInvalidHandle) forge::releaseShape(h);
  }
  check(reads.load() > 1000, S,
        std::to_string(kThreads) + " threads x " + std::to_string(kOps) + " ops: " +
            std::to_string(reads.load()) + " leased reads, " + std::to_string(empties.load()) +
            " empty leases (handle released first)");
  check(reg.liveCount() == base, S,
        "live count back to base (" + std::to_string(reg.liveCount()) + "==" +
            std::to_string(base) + ")");
}

#endif  // GATE_OLD_API

#else  // GATE_INTEGRATION ─────────────────────────────────────────────────────────

// A 256-sided native prism through the REAL library's registry, whose last owner
// records which thread destroyed it. Volume closed form: (n/2) R^2 sin(2pi/n) h.
constexpr int kN = 256;
constexpr double kR = 10.0, kH = 5.0;
double prismVolume() {
  const double pi = std::acos(-1.0);
  return 0.5 * kN * kR * kR * std::sin(2.0 * pi / kN) * kH;
}

ShapeHandle addWatchedPrism(std::atomic<int>& destroyedOn, int releaserTag,
                            const std::thread::id& readerId) {
  auto fac = std::shared_ptr<nb::SolidFactory>(
      new nb::SolidFactory, [&destroyedOn, releaserTag, readerId](nb::SolidFactory* f) {
        destroyedOn.store(std::this_thread::get_id() == readerId ? 1 : releaserTag);
        delete f;
      });
  nb::Solid* s = fac->buildPrism(kN, kR, kH);
  if (s == nullptr) return kInvalidHandle;
  std::shared_ptr<nb::TopologyBuilder> owner(fac, &fac->builder());
  fac.reset();
  return forge::addNativeSolidShape(std::move(owner), s);
}

// The call-site race: `call(h)` in a tight loop on the reader thread (it throws
// once the handle is gone), release on another thread after a random delay.
// `minPinnedPct`: the share of rounds in which the release must land inside a
// lease. It differs per call site because the LEASE WINDOW does: massProperties
// holds its lease for the whole call, exportStl only for the tessellation (the
// text formatting and the file write after it need no payload, and keeping the
// lease past them would be pinning for nothing). MEASURED on this Mac Studio:
// massProperties 199/200, exportStl 13/60 — and 0 for both on the borrow library.
template <class Call>
void callSiteRace(const char* S, Call&& call, int rounds, int minPinnedPct) {
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  int pinned = 0, onReleaser = 0, other = 0, wrong = 0, built = 0;
  long calls = 0;
  std::mt19937 rng(42);
  for (int r = 0; r < rounds; ++r) {
    std::atomic<int> destroyedOn{0};
    std::atomic<bool> started{false};
    std::atomic<std::thread::id> readerId{};
    std::atomic<ShapeHandle> handle{kInvalidHandle};
    std::atomic<bool> ready{false};
    const unsigned delayUs = rng() % 200;
    std::thread reader([&] {
      readerId.store(std::this_thread::get_id());
      while (!ready.load(std::memory_order_acquire)) std::this_thread::yield();
      const ShapeHandle h = handle.load();
      started.store(true, std::memory_order_release);
      for (;;) {
        double v = 0;
        try {
          v = call(h);
        } catch (...) {
          break;  // the handle is gone: the honest end of the loop
        }
        ++calls;
        if (std::fabs(v - prismVolume()) > 1e-9 * prismVolume()) ++wrong;
      }
    });
    while (readerId.load() == std::thread::id{}) std::this_thread::yield();
    const ShapeHandle h = addWatchedPrism(destroyedOn, 2, readerId.load());
    if (h == kInvalidHandle) {
      ready.store(true, std::memory_order_release);
      reader.join();
      continue;
    }
    ++built;
    handle.store(h);
    ready.store(true, std::memory_order_release);
    while (!started.load(std::memory_order_acquire)) std::this_thread::yield();
    std::this_thread::sleep_for(std::chrono::microseconds(delayUs));
    forge::releaseShape(h);
    reader.join();
    switch (destroyedOn.load()) {
      case 1: ++pinned; break;
      case 2: ++onReleaser; break;
      default: ++other; break;
    }
  }
  char buf[320];
  std::snprintf(buf, sizeof buf,
                "%d rounds, %ld calls: payload's last owner was the READER in %d (a call held "
                "it across the release), the releaser in %d, never destroyed in %d",
                built, calls, pinned, onReleaser, other);
  std::printf("  [MEASURE] %s: %s\n", S, buf);
  std::printf("  [MEASURE] %s: pinned=%d\n", S, pinned);
  check(built == rounds, S, "every round registered its prism");
  check(wrong == 0, S, std::to_string(wrong) + " answers differed from the closed form");
  check(other == 0, S, "every payload was destroyed exactly once, after its last use");
  check(reg.liveCount() == base, S, "live count back to base");
  // The call-site property. A call that reads through a BORROW never owns the
  // payload, so the entry is always its last owner and pinned stays 0 (the
  // pre-T-261 library; measured and recorded by the runner). A call that reads
  // through a LEASE owns it for the whole call, and the reader spends nearly all
  // of its time inside the call, so the release lands inside one most rounds.
  check(pinned * 100 >= built * minPinnedPct && pinned > 0, S,
        "a call in flight kept the payload alive across the release in >= " +
            std::to_string(minPinnedPct) + "% of rounds (" + std::to_string(pinned) + "/" +
            std::to_string(built) + ")");
}

void integMassProps() {
  callSiteRace("integ-massprops", [](ShapeHandle h) { return forge::massProperties(h).volume; },
               200, 25);
}

std::string g_outDir = ".";
void integStl() {
  const std::string path = g_outDir + "/integ_stl_race.stl";
  callSiteRace(
      "integ-stl",
      [&path](ShapeHandle h) {
        forge::io::exportStl(h, path, 0.1, 0.5, true);
        return prismVolume();  // exportStl answers no volume; the race is the point
      },
      120, 5);
  std::remove(path.c_str());
}

#endif  // GATE_INTEGRATION

}  // namespace

int main(int argc, char** argv) {
  const std::string which = argc > 1 ? argv[1] : "";
  std::printf("[native-access-lease] scenario %s\n", which.c_str());
#ifndef GATE_INTEGRATION
  if (which == "borrow-solid") borrowSolid();
  else if (which == "borrow-mesh") borrowMesh();
  else if (which == "borrow-shape") borrowShape();
#ifndef GATE_OLD_API
  else if (which == "lease-solid") leaseSolid();
  else if (which == "lease-mesh") leaseMesh();
  else if (which == "lease-shape") leaseShape();
  else if (which == "lease-refusal") leaseRefusal();
  else if (which == "lease-stress") leaseStress();
#endif
#else
  if (argc > 2) g_outDir = argv[2];
  if (which == "integ-massprops") integMassProps();
  else if (which == "integ-stl") integStl();
#endif
  else {
    std::printf("unknown scenario '%s'\n", which.c_str());
    return 2;
  }
  if (g_fail != 0) {
    std::printf("RED %s (%d failed)\n", which.c_str(), g_fail);
    return 1;
  }
  std::printf("GREEN %s\n", which.c_str());
  return 0;
}
