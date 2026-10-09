// shape_registry_lifetime_gate.cpp — T-183: what a ShapeRegistry read hands back
// must stay alive while the caller uses it, whatever release() does meanwhile.
//
// THE DEFECT THIS GATE WAS WRITTEN AGAINST (origin/archdisc b609b41d):
//   * get() returned `const TopoDS_Shape&` INTO the registry's hash-map node, and
//     getNativeSolid()/getNativeMesh() returned references into the entry's
//     payload, all AFTER the lock_guard had gone. release() erases the node and
//     drops the payload's last owner, so a reader still holding the reference
//     reads freed memory (ASan: heap-use-after-free; TSan: a race with the
//     entry's destructor).
//   * the lazy native->OCCT conversion ran INSIDE get(), under the one global
//     mutex, so every registry call on every thread stalled behind it, and no
//     counter recorded that it had happened at all.
//   * release() destroyed the payload while still holding that mutex, so a
//     payload destructor that touched the registry self-deadlocked.
//   * nothing could release the handles a build created: every in-process
//     compile leaked all of them (measured: 5 per bracket build, 100 after 20).
//
// SCENARIOS
//   common (old + new)  race-occt, race-native-solid, race-native-mesh: a reader
//                       holds what a read handed it while another thread releases
//                       the handle. conversion-unlocked: a registry call during a
//                       ~100 ms conversion must not wait for it. destroy-unlocked:
//                       a payload destructor that calls the registry (through
//                       release(); on the new API also through a Scope's
//                       releaseAll()).
//   new API             lease-outlives-release, stress (8 threads x 1500 mixed
//                       ops), conversion-counter (0 on native ops; exactly 1 per
//                       entry, 8 racing threads included), release-during-
//                       conversion, scope (document close), scope-attribution
//                       (whose reference a release inside a capture drops).
//   integration         the real kernel library: 0 conversions across
//                       makeBox/makeCylinder/translate/cut/tessellate/
//                       massProperties; an OCCT-only consumer counted once;
//                       100 scoped rebuilds of the bracket keep ONE build live.
//
// BUILD MODES (run_shape_registry_lifetime_gate.sh drives all of them):
//   default              src/ShapeRegistry.cpp compiled INTO this binary under
//                        -fsanitize=thread or -fsanitize=address; native builders
//                        and occtFromNativeSolid come from libforge_kernel_core.
//   -DGATE_OLD_API       only the common scenarios, whose SOURCE compiles against
//                        both the old and the new registry. Built against the
//                        PREVIOUS ShapeRegistry.{hpp,cpp} each must go RED; that
//                        is the failing-first proof, rerun on every invocation.
//   -DGATE_INTEGRATION   no registry compiled in: the REAL libforge_kernel_core
//                        registry, driven through the real kernel ops and the
//                        real feature-tree compiler.
//
// The race scenarios use the CALL-SITE SHAPES the kernel actually uses, not the
// new API, because the point is that existing callers became safe without being
// edited:  `const TopoDS_Shape& s = reg.get(h);`  (85 sites in src/ and
// include/) and `f(reg.getNativeSolid(h))` / `f(reg.getNativeMesh(h))`
// (argument passing).
//
// NEGATIVE CONTROLS: run_shape_registry_lifetime_gate.sh --mutations compiles 12
// one-line mutants of src/ShapeRegistry.cpp into this gate (each removes one
// guarantee above) and requires the scenario named for it to go RED.
//
// usage: shape_registry_lifetime_gate [scenario|all]   — exit 0 iff every PASS.

#include "forge/ShapeRegistry.hpp"

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <BRep_Builder.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Pnt.hxx>

#ifdef GATE_INTEGRATION
#include "forge/Booleans.hpp"
#include "forge/MassProps.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeQuery.hpp"
#include "forge/Tessellate.hpp"
#include "forge/Transform.hpp"
#include "forge/ft/FeatureTree.hpp"
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <random>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using forge::ShapeHandle;
using forge::ShapeKind;
using forge::ShapeRegistry;
namespace nb = forge::native::brep;
namespace nm = forge::native::mesh;

namespace {

int g_fail = 0;
[[maybe_unused]] std::atomic<long> g_sink{0};  // defeats dead-read elimination

bool check(bool ok, const char* scenario, const std::string& what) {
  std::printf("  [%s] %s: %s\n", ok ? "PASS" : "FAIL", scenario, what.c_str());
  if (!ok) ++g_fail;
  return ok;
}

// Is `h` live in THIS registry? Not forge::shapeHandleKnown(): outside
// GATE_INTEGRATION that would ask libforge_kernel_core's own registry singleton,
// not the instrumented one compiled into this binary, and always say "no".
[[maybe_unused]] bool known(ShapeHandle h) {
  try {
    (void)ShapeRegistry::instance().kindOf(h);
    return true;
  } catch (const std::exception&) {
    return false;
  }
}

// Everything from here to the INTEGRATION section is the unit half: helpers
// and scenarios that drive the registry compiled into this binary.
#ifndef GATE_INTEGRATION

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// A compiler barrier: forces every probe below to re-read memory each pass so
// the read that lands after release() is a real load, not a hoisted register.
// It is NOT a synchronisation point, so it adds no happens-before edge that
// would hide the race from TSan.
inline void compilerBarrier() { asm volatile("" ::: "memory"); }

// Read `probe` until the releaser has published (RELAXED, deliberately: an
// acquire here would order the free() before our reads and TSan, which only
// reports unordered pairs, would then stay silent on the old code) and then a
// further 256 times, so some reads are guaranteed to land after the release.
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

TopoDS_Shape makeOcctShape(int seed) {
  BRep_Builder bb;
  TopoDS_Compound c;
  bb.MakeCompound(c);
  for (int i = 0; i < 3; ++i) {
    TopoDS_Vertex v;
    bb.MakeVertex(v, gp_Pnt(seed, i, 0.5 * i), 1e-7);
    bb.Add(c, v);
  }
  return c;
}

// The racy loop reads only the TopoDS_Shape OBJECT the caller holds (its TShape
// pointer and orientation), never through the pointer: on the old code that
// object sits in the registry's freed hash-map node, and a read of it is exactly
// the defect. Dereferencing a TShape that is mid-destruction would crash ("pure
// virtual function called") before either sanitizer could name the bug, which
// is what the first version of this probe did on the old code.
__attribute__((noinline)) long shapeFields(const TopoDS_Shape& s) {
  return static_cast<long>(s.IsNull()) + static_cast<long>(s.Orientation()) +
         static_cast<long>(reinterpret_cast<std::uintptr_t>(s.TShape().get()) & 0xff);
}

// Through the pointer: the topology itself is alive.
__attribute__((noinline)) long shapeProbe(const TopoDS_Shape& s) {
  long r = shapeFields(s);
  if (!s.IsNull()) r += static_cast<long>(s.ShapeType()) + s.TShape()->NbChildren();
  return r;
}

// A native solid whose ONLY owner is the registry entry (the local shared_ptr is
// moved in), so erasing the entry frees it.
//
// WHY THE SOLID LIVES IN A HOLDER HERE and not in TopologyBuilder::makeSolid()'s
// storage: ~TopologyBuilder() is out of line, in the UNINSTRUMENTED
// libforge_kernel_core, and TSan on Darwin ignores frees made from
// non-instrumented modules (ignore_noninstrumented_modules=1, the default). With
// builder-owned storage the old code's use-after-free was invisible to TSan
// (MEASURED: race-native-solid GREEN under TSan on b609b41d, RED under ASan).
// The registry contract under test is unchanged — the entry's `owner` is what
// keeps the Solid alive — only the storage is where both sanitizers can see it
// freed.
struct SolidHolder {
  nb::TopologyBuilder tb;  // what the registry's owner pointer names
  nb::Shell shell;
  nb::Solid solid;
};

ShapeHandle addBareNativeSolid() {
  auto holder = std::make_shared<SolidHolder>();
  holder->solid.id = 1;
  holder->shell.id = 1;
  holder->shell.solid = &holder->solid;
  holder->solid.shells.push_back(&holder->shell);
  nb::Solid* s = &holder->solid;
  nb::TopologyBuilder* tb = &holder->tb;
  std::shared_ptr<nb::TopologyBuilder> owner(std::move(holder), tb);
  return ShapeRegistry::instance().addNativeSolid(std::move(owner), s);
}

// A real primitive (convertible by occtFromNativeSolid), owned the way
// Primitives.cpp's registerNative() owns one: an aliasing pointer to the
// factory's builder.
template <class Fn>
ShapeHandle addFactorySolid(Fn&& fn) {
  auto fac = std::make_shared<nb::SolidFactory>();
  nb::Solid* s = fn(*fac);
  std::shared_ptr<nb::TopologyBuilder> owner(fac, &fac->builder());
  return ShapeRegistry::instance().addNativeSolid(std::move(owner), s);
}

ShapeHandle addTetraMesh() {
  auto m = std::make_shared<nm::HalfEdgeMesh>();
  const std::vector<double> p = {0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1};
  const std::vector<std::uint32_t> t = {0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2};
  if (!m->buildFromSoup(p, t)) return forge::kInvalidHandle;
  return ShapeRegistry::instance().addNativeMesh(std::move(m));
}

__attribute__((noinline)) long consumeSolid(const nb::Solid& sol, std::atomic<bool>& holding,
                                            const std::atomic<bool>& released) {
  holding.store(true, std::memory_order_release);
  return readUntilReleased(
      [&] {
        long r = static_cast<long>(sol.id) + static_cast<long>(sol.shells.size());
        if (!sol.shells.empty()) r += static_cast<long>(sol.shells[0]->faces.size());
        return r;
      },
      released);
}

__attribute__((noinline)) long consumeMesh(const nm::HalfEdgeMesh& m, std::atomic<bool>& holding,
                                           const std::atomic<bool>& released) {
  holding.store(true, std::memory_order_release);
  return readUntilReleased(
      [&] {
        long r = static_cast<long>(m.vertexCount()) + static_cast<long>(m.faceCount());
        if (m.vertexCount() > 1) r += static_cast<long>(m.vertices()[1].position.x);
        return r;
      },
      released);
}

// One reader holds what the registry handed it; one releaser drops the handle
// while it does. `read(h, holding, released)` is the reader's whole body.
template <class Read>
void raceOnce(ShapeHandle h, Read&& read) {
  std::atomic<bool> holding{false};
  std::atomic<bool> released{false};
  std::thread reader([&] { g_sink += read(h, holding, released); });
  std::thread releaser([&] {
    while (!holding.load(std::memory_order_acquire)) std::this_thread::yield();
    ShapeRegistry::instance().release(h);
    released.store(true, std::memory_order_relaxed);  // relaxed ON PURPOSE (see above)
  });
  reader.join();
  releaser.join();
}

// ───────────────────────── scenarios common to OLD and NEW ─────────────────────

// R1: `const TopoDS_Shape& s = reg.get(h);` while another thread releases h.
void raceOcct() {
  const char* S = "race-occt";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  constexpr int kIters = 64;
  for (int i = 0; i < kIters; ++i) {
    const ShapeHandle h = reg.add(makeOcctShape(i));
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      const TopoDS_Shape& s = ShapeRegistry::instance().get(hh);  // the kernel's call-site shape
      holding.store(true, std::memory_order_release);
      const long acc = readUntilReleased([&] { return shapeFields(s); }, released);
      return acc + shapeProbe(s);  // and the topology behind it is still alive
    });
  }
  check(reg.liveCount() == base, S,
        std::to_string(kIters) + " get()+concurrent release() rounds, reader kept reading its "
        "shape after release; live back to base (" + std::to_string(reg.liveCount()) + "==" +
        std::to_string(base) + ")");
}

// R2: `f(reg.getNativeSolid(h))` — the argument-passing shape (booleanSolid,
// tessellateSolid, massProperties, ...) — while another thread releases h.
void raceNativeSolid() {
  const char* S = "race-native-solid";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  constexpr int kIters = 64;
  for (int i = 0; i < kIters; ++i) {
    const ShapeHandle h = addBareNativeSolid();
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      return consumeSolid(ShapeRegistry::instance().getNativeSolid(hh), holding, released);
    });
  }
  check(reg.liveCount() == base, S,
        std::to_string(kIters) + " f(getNativeSolid(h)) + concurrent release() rounds; the "
        "solid was read after release and the builder had no other owner");
}

// R3: `f(reg.getNativeMesh(h))` while another thread releases h.
void raceNativeMesh() {
  const char* S = "race-native-mesh";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  constexpr int kIters = 64;
  for (int i = 0; i < kIters; ++i) {
    const ShapeHandle h = addTetraMesh();
    if (!check(h != forge::kInvalidHandle, S, "tetra mesh built")) return;
    raceOnce(h, [](ShapeHandle hh, std::atomic<bool>& holding, const std::atomic<bool>& released) {
      return consumeMesh(ShapeRegistry::instance().getNativeMesh(hh), holding, released);
    });
  }
  check(reg.liveCount() == base, S,
        std::to_string(kIters) + " f(getNativeMesh(h)) + concurrent release() rounds; the "
        "mesh was read after release");
}

// R4: the lazy native->OCCT conversion must not hold the registry's global lock.
// Thread A converts a 256-sided native prism (≈65 ms Release, measured); thread
// B calls liveCount() the whole time. Under the global lock B's first call waits
// for the entire conversion, so its worst call latency ≈ the conversion time.
void conversionOutsideLock() {
  const char* S = "conversion-unlocked";
  auto& reg = ShapeRegistry::instance();
  const ShapeHandle h = addFactorySolid([](nb::SolidFactory& f) { return f.buildPrism(256, 10, 5); });
  std::atomic<bool> started{false};
  std::atomic<bool> done{false};
  double convMs = 0;
  bool converted = false;
  long completed = 0;
  double worstMs = 0;
  std::thread a([&] {
    started.store(true, std::memory_order_release);
    const Clock::time_point t0 = Clock::now();
    const TopoDS_Shape s = reg.get(h);
    convMs = msSince(t0);
    converted = !s.IsNull();
    done.store(true, std::memory_order_release);
  });
  std::thread b([&] {
    while (!started.load(std::memory_order_acquire)) std::this_thread::yield();
    while (!done.load(std::memory_order_acquire)) {
      const Clock::time_point t0 = Clock::now();
      g_sink += static_cast<long>(reg.liveCount());
      worstMs = std::max(worstMs, msSince(t0));
      ++completed;
    }
  });
  a.join();
  b.join();
  reg.release(h);
  char buf[256];
  std::snprintf(buf, sizeof buf, "conversion %.1f ms; concurrent liveCount(): %ld calls, worst %.2f ms",
                convMs, completed, worstMs);
  if (!check(converted, S, "the 256-gon prism converted to a non-null TopoDS_Shape")) return;
  if (!check(convMs >= 10.0, S, std::string("conversion long enough to measure (>=10 ms): ") + buf))
    return;
  check(worstMs < convMs * 0.25 && completed >= 20, S,
        std::string("no registry call waited on the conversion (worst < 25% of it, >=20 calls): ") + buf);
}

// R5: the payload's destructor must not run under the registry lock. A native
// solid's owner is a shared_ptr, and its deleter is arbitrary code — here it asks
// the registry a question, as a builder that unregisters something would. Under
// the old release() the entry was erased, and the payload destroyed, while
// release() still held the one global mutex: a self-deadlock.
// A bare native solid whose builder's deleter asks the registry for liveCount()
// (taking the registry lock) and stores it in `seen`.
ShapeHandle addSolidThatCallsRegistryOnDestroy(long& seen) {
  auto holder = std::make_shared<SolidHolder>();
  holder->solid.id = 1;
  holder->shell.id = 1;
  holder->shell.solid = &holder->solid;
  holder->solid.shells.push_back(&holder->shell);
  nb::Solid* s = &holder->solid;
  nb::TopologyBuilder* tb = &holder->tb;
  std::shared_ptr<nb::TopologyBuilder> owner(tb, [keep = holder, &seen](nb::TopologyBuilder*) mutable {
    seen = static_cast<long>(ShapeRegistry::instance().liveCount());  // takes the registry lock
    keep.reset();
  });
  holder.reset();
  return ShapeRegistry::instance().addNativeSolid(std::move(owner), s);
}

void destroyOutsideLock() {
  const char* S = "destroy-unlocked";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  long seen = -1;
  const ShapeHandle h = addSolidThatCallsRegistryOnDestroy(seen);
  reg.release(h);
  check(seen == static_cast<long>(base), S,
        "the payload's destructor ran after release() dropped the lock and saw the entry gone "
        "(liveCount from inside it = " + std::to_string(seen) + ", base " + std::to_string(base) + ")");
#ifndef GATE_OLD_API
  // The same contract on the document-close path: Scope::releaseAll() destroys
  // the entries it leaves unreferenced after dropping the lock, too.
  long seenScope = -1;
  {
    ShapeRegistry::Scope doc;
    {
      auto cap = doc.capture();
      (void)addSolidThatCallsRegistryOnDestroy(seenScope);
    }
    doc.releaseAll();
  }
  check(seenScope == static_cast<long>(base), S,
        "via Scope::releaseAll() (document close) too: the destructor ran after the lock was "
        "dropped (liveCount from inside it = " + std::to_string(seenScope) + ", base " +
            std::to_string(base) + ")");
#endif
}

// ───────────────────────────── NEW-API scenarios ───────────────────────────────
#ifndef GATE_OLD_API

// N1: what a read hands back outlives release() — deterministic, one thread.
void leasesOutliveRelease() {
  const char* S = "lease-outlives-release";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();

  const ShapeHandle ho = reg.add(makeOcctShape(7));
  const TopoDS_Shape& so = reg.get(ho);  // lifetime-extended copy
  reg.release(ho);
  check(reg.liveCount() == base && !so.IsNull() && so.TShape()->NbChildren() == 3, S,
        "TopoDS_Shape from get() still reads 3 children after its handle was released");

  const ShapeHandle hs = addBareNativeSolid();
  const auto& lease = reg.getNativeSolid(hs);  // `const auto&` binds the lease itself
  reg.release(hs);
  const nb::Solid& sol = lease;
  check(reg.liveCount() == base && sol.shells.size() == 1 && sol.shells[0]->faces.empty(), S,
        "native solid lease still reads its shell after its handle was released");

  const ShapeHandle hm = addTetraMesh();
  auto mlease = reg.getNativeMesh(hm);
  reg.release(hm);
  check(reg.liveCount() == base && mlease->vertexCount() == 4 && mlease->faceCount() == 4, S,
        "native mesh lease still reads V=4 F=4 after its handle was released");

  bool threw = false;
  try {
    (void)reg.getNativeSolid(ho);
  } catch (const std::exception&) {
    threw = true;
  }
  check(threw, S, "a released handle still refuses (getNativeSolid on a dead handle throws)");
}

// N2: everything at once, many threads, fixed seeds. TSan is the oracle; the
// refcount books must balance at the end.
void stress() {
  const char* S = "stress";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  constexpr int kThreads = 8;
  constexpr int kIters = 1500;
  std::vector<ShapeHandle> shared;
  for (int i = 0; i < 6; ++i) shared.push_back(reg.add(makeOcctShape(100 + i)));
  shared.push_back(addBareNativeSolid());
  shared.push_back(addTetraMesh());
  std::atomic<long> errors{0};
  std::vector<std::thread> ts;
  for (int t = 0; t < kThreads; ++t) {
    ts.emplace_back([&, t] {
      std::minstd_rand rng(1234u + static_cast<unsigned>(t));
      std::vector<ShapeHandle> mine;
      for (int i = 0; i < kIters; ++i) {
        const ShapeHandle hs = shared[rng() % shared.size()];
        try {
          switch (rng() % 7) {
            case 0: mine.push_back(reg.add(makeOcctShape(i))); break;
            case 1: mine.push_back(addBareNativeSolid()); break;
            case 2:
              if (!mine.empty()) { reg.release(mine.back()); mine.pop_back(); }
              break;
            case 3: {  // a temporary reference on a shared handle
              reg.retain(hs);
              const ShapeKind k = reg.kindOf(hs);
              if (k == ShapeKind::Occt) g_sink += shapeProbe(reg.get(hs));
              reg.release(hs);
              break;
            }
            case 4: {
              const ShapeKind k = reg.kindOf(hs);
              if (k == ShapeKind::NativeSolid) g_sink += static_cast<long>(reg.getNativeSolid(hs)->shells.size());
              if (k == ShapeKind::NativeMesh) g_sink += static_cast<long>(reg.getNativeMesh(hs)->faceCount());
              break;
            }
            case 5:
              if (!mine.empty()) {
                const ShapeHandle h = mine[rng() % mine.size()];
                if (reg.kindOf(h) == ShapeKind::Occt) g_sink += shapeProbe(reg.get(h));
                else g_sink += static_cast<long>(reg.getNativeSolid(h)->shells.size());
              }
              break;
            default: g_sink += static_cast<long>(reg.liveCount()); break;
          }
        } catch (const std::exception&) {
          ++errors;
        }
      }
      for (ShapeHandle h : mine) reg.release(h);
    });
  }
  for (auto& th : ts) th.join();
  for (ShapeHandle h : shared) reg.release(h);
  check(errors.load() == 0 && reg.liveCount() == base, S,
        std::to_string(kThreads) + " threads x " + std::to_string(kIters) +
            " mixed add/retain/get/lease/release ops: " + std::to_string(errors.load()) +
            " exceptions, live " + std::to_string(reg.liveCount()) + " == base " + std::to_string(base));
}

// N3: the native path converts NOTHING to OCCT; get() on a native solid converts
// exactly once, however many threads ask at the same moment.
void conversionCounter() {
  const char* S = "conversion-counter";
  auto& reg = ShapeRegistry::instance();
  const std::uint64_t c0 = reg.nativeToOcctConversions();

  const ShapeHandle hs = addFactorySolid([](nb::SolidFactory& f) { return f.buildBox(10, 20, 30); });
  const ShapeHandle hm = addTetraMesh();
  long n = 0;
  for (int i = 0; i < 50; ++i) {
    n += static_cast<long>(reg.kindOf(hs)) + static_cast<long>(reg.kindOf(hm));
    n += static_cast<long>(reg.getNativeSolid(hs)->shells.size());
    n += static_cast<long>(reg.getNativeMesh(hm)->faceCount());
    reg.retain(hs);
    reg.release(hs);
  }
  {
    ShapeRegistry::Scope sc;
    sc.hold(hs);
    sc.releaseAll();
  }
  g_sink += n;
  check(reg.nativeToOcctConversions() - c0 == 0, S,
        "0 native->OCCT conversions across 50x kindOf/getNativeSolid/getNativeMesh/retain/release/Scope "
        "on native handles (counter delta " + std::to_string(reg.nativeToOcctConversions() - c0) + ")");

  const TopoDS_Shape first = reg.get(hs);
  check(!first.IsNull() && reg.nativeToOcctConversions() - c0 == 1, S,
        "get() on a native solid ran the conversion and the counter says 1 (delta " +
            std::to_string(reg.nativeToOcctConversions() - c0) + ")");
  const TopoDS_Shape again = reg.get(hs);
  check(again.TShape() == first.TShape() && reg.nativeToOcctConversions() - c0 == 1, S,
        "a second get() is served from the memo: same TShape, counter still 1");

  // 8 threads ask for a fresh native solid's OCCT shape at the same instant.
  const ShapeHandle hp = addFactorySolid([](nb::SolidFactory& f) { return f.buildPrism(64, 10, 5); });
  const std::uint64_t c1 = reg.nativeToOcctConversions();
  constexpr int kThreads = 8;
  std::atomic<int> ready{0};
  std::vector<const void*> tshapes(kThreads, nullptr);
  std::vector<std::thread> ts;
  for (int t = 0; t < kThreads; ++t) {
    ts.emplace_back([&, t] {
      ready.fetch_add(1);
      while (ready.load() < kThreads) std::this_thread::yield();
      const TopoDS_Shape s = reg.get(hp);
      tshapes[t] = s.TShape().get();
    });
  }
  for (auto& th : ts) th.join();
  bool same = tshapes[0] != nullptr;
  for (const void* p : tshapes) same = same && (p == tshapes[0]);
  check(reg.nativeToOcctConversions() - c1 == 1 && same, S,
        std::to_string(kThreads) + " simultaneous get() on one fresh native solid: " +
            std::to_string(reg.nativeToOcctConversions() - c1) + " conversion(s), all got the same TShape");

  bool threw = false;
  try {
    (void)reg.get(hm);
  } catch (const std::exception&) {
    threw = true;
  }
  check(threw && reg.nativeToOcctConversions() - c1 == 1, S,
        "get() on a native MESH still refuses and converts nothing");
  reg.release(hs);
  reg.release(hm);
  reg.release(hp);
}

// N4: the conversion now runs WITHOUT the registry lock, so release() can erase
// the entry while it runs. The converter must keep the builder it is reading
// alive until it is done: the builder may die only when get() lets go of it, on
// the converting thread — never on the releasing thread mid-conversion. (The
// conversion's reads happen in the uninstrumented library, so this asks WHERE
// the owner's deleter ran rather than relying on a sanitizer.)
void releaseDuringConversion() {
  const char* S = "release-during-conversion";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  auto fac = std::make_shared<nb::SolidFactory>();
  nb::Solid* solid = fac->buildPrism(256, 10, 5);
  std::thread::id diedOn;
  std::shared_ptr<nb::TopologyBuilder> owner(&fac->builder(), [keep = fac, &diedOn](nb::TopologyBuilder*) mutable {
    diedOn = std::this_thread::get_id();
    keep.reset();
  });
  fac.reset();
  const ShapeHandle h = reg.addNativeSolid(std::move(owner), solid);
  const std::uint64_t c0 = reg.nativeToOcctConversions();
  std::thread::id converter;
  bool converted = false;
  std::thread a([&] {
    converter = std::this_thread::get_id();
    converted = !reg.get(h).IsNull();
  });
  std::thread b([&] {
    // The counter is bumped as the conversion starts; release while it runs.
    while (reg.nativeToOcctConversions() == c0) std::this_thread::yield();
    reg.release(h);
  });
  a.join();
  b.join();
  check(converted && diedOn == converter && reg.liveCount() == base, S,
        "the handle was released mid-conversion; the conversion finished on a live builder, "
        "which died on the converting thread when get() returned");
}

// N5: a Scope owns references and gives them back on releaseAll()/destruction —
// the registry half of "release the document's handles when it closes".
void scopes() {
  const char* S = "scope";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  const std::uint64_t refused0 = reg.refusedReleases();

  ShapeRegistry::Scope doc;
  ShapeHandle a = 0, b = 0, c = 0;
  {
    auto cap = doc.capture();
    a = reg.add(makeOcctShape(1));
    b = addBareNativeSolid();
    c = addTetraMesh();
  }
  const ShapeHandle outside = reg.add(makeOcctShape(2));  // after the capture ended
  check(doc.size() == 3 && reg.liveCount() == base + 4, S,
        "capture() took the 3 handles issued inside it and not the one issued after");

  reg.release(a);  // after the capture the creation reference is the SCOPE's: not freed
  check(reg.liveCount() == base + 4 && reg.refusedReleases() - refused0 == 1, S,
        "release() of a scope-owned creation reference is refused (counted), not a free");

  reg.retain(b);  // a caller that wants b past the document takes its own reference
  doc.hold(outside);
  reg.release(outside);  // the scope's hold keeps it alive
  check(reg.liveCount() == base + 4 && doc.size() == 4, S, "hold() keeps a handle past its creator's release()");

  const auto lease = reg.getNativeMesh(c);
  const std::size_t dropped = doc.releaseAll();
  check(dropped == 4 && doc.size() == 0 && reg.liveCount() == base + 1, S,
        "releaseAll() dropped 4 references; only b (retained by its caller) is left");
  check(lease->faceCount() == 4, S, "a lease taken before the document closed still reads its mesh");
  check(reg.kindOf(b) == ShapeKind::NativeSolid, S, "the retained handle is still valid after releaseAll()");
  reg.release(b);
  check(reg.liveCount() == base, S, "and its own release() frees it");

  // Nesting, threads, RAII, move.
  {
    ShapeRegistry::Scope outer;
    ShapeRegistry::Scope inner;
    std::thread other;
    ShapeHandle otherH = 0;
    {
      auto co = outer.capture();
      (void)reg.add(makeOcctShape(3));
      {
        auto ci = inner.capture();
        (void)reg.add(makeOcctShape(4));
        (void)reg.add(makeOcctShape(5));
        other = std::thread([&] { otherH = reg.add(makeOcctShape(6)); });  // not this thread
        other.join();
      }
      (void)reg.add(makeOcctShape(7));
    }
    check(outer.size() == 2 && inner.size() == 2, S,
          "nested capture: the innermost scope takes the handle; the outer resumes after");
    check(reg.kindOf(otherH) == ShapeKind::Occt && reg.liveCount() == base + 5, S,
          "a capture is per-thread: another thread's add() is not captured");
    reg.release(otherH);
    ShapeRegistry::Scope moved = std::move(inner);
    check(moved.size() == 2 && reg.liveCount() == base + 4, S, "a moved Scope carries its references");
  }
  check(reg.liveCount() == base, S, "Scope destructors released everything they held");
}

// N6: WHOSE reference a release() inside a capture drops. A build that registers
// a transient and releases it (ClassASurfacing's continuity check, ShapeQuery's
// partial-registration cleanup) must free it at once — not park it in the
// document until close, and not count it as refused — and when another owner
// holds a reference too, the build's release must drop the BUILD's (the
// Scope's), never the other owner's.
void scopeAttribution() {
  const char* S = "scope-attribution";
  auto& reg = ShapeRegistry::instance();
  const std::size_t base = reg.liveCount();
  const std::uint64_t refused0 = reg.refusedReleases();

  ShapeRegistry::Scope doc;
  ShapeHandle kept = 0, shared = 0;
  {
    auto cap = doc.capture();
    kept = reg.add(makeOcctShape(10));
    for (int i = 0; i < 50; ++i) {  // 50 transients, registered and released by the build
      const ShapeHandle t = reg.add(makeOcctShape(11));
      reg.release(t);
    }
    shared = reg.add(makeOcctShape(12));
    std::thread([&] { reg.retain(shared); }).join();  // another owner, another thread
    reg.release(shared);                              // the build is done with it
  }
  check(reg.liveCount() == base + 2 && doc.size() == 1 && reg.refusedReleases() == refused0, S,
        "50 transients released by the build inside its capture were freed at once (live " +
            std::to_string(reg.liveCount() - base) + " == 2, scope holds " +
            std::to_string(doc.size()) + " == 1, 0 refused)");
  doc.releaseAll();  // document close
  check(reg.liveCount() == base + 1 && reg.kindOf(shared) == ShapeKind::Occt, S,
        "the build's release of `shared` dropped the BUILD's reference: the other owner's "
        "survives document close");
  reg.release(shared);
  check(reg.liveCount() == base && !known(kept), S,
        "and the other owner's own release frees it; the build's result went with the document");

  // Nested: an inner capture releasing a handle the OUTER scope holds drops the
  // outer scope's reference (the code on this thread is the outer build's too).
  ShapeRegistry::Scope outer;
  ShapeRegistry::Scope inner;
  ShapeHandle h = 0;
  {
    auto co = outer.capture();
    h = reg.add(makeOcctShape(13));
    {
      auto ci = inner.capture();
      reg.release(h);
    }
  }
  check(outer.size() == 0 && inner.size() == 0 && !known(h) &&
            reg.liveCount() == base && reg.refusedReleases() == refused0,
        S, "a release inside a nested capture dropped the enclosing scope's reference");
}

#endif  // !GATE_OLD_API
#endif  // !GATE_INTEGRATION

// ─────────────────────────── INTEGRATION (real kernel) ─────────────────────────
#ifdef GATE_INTEGRATION

// I1+I2: through the REAL kernel ops, a native body never converts; an OCCT-only
// consumer converts exactly once, and the counter says so.
void integrationNativePath() {
  const char* S = "integration-native-path";
  auto& reg = ShapeRegistry::instance();
  const std::uint64_t c0 = reg.nativeToOcctConversions();
  const ShapeHandle box = forge::makeBox(40, 30, 20);
  const ShapeHandle cyl = forge::makeCylinder(5, 40);
  const ShapeHandle cylT = forge::translate(cyl, 20, 15, -10);
  const ShapeHandle body = forge::cut(box, cylT);
  const bool allNative = reg.kindOf(box) == ShapeKind::NativeSolid &&
                         reg.kindOf(cyl) == ShapeKind::NativeSolid &&
                         reg.kindOf(cylT) == ShapeKind::NativeSolid &&
                         reg.kindOf(body) == ShapeKind::NativeSolid;
  if (!check(allNative, S, "makeBox/makeCylinder/translate/cut all produced NativeSolid handles "
                           "(otherwise this scenario would be vacuous)"))
    return;
  const forge::Mesh mesh = forge::tessellate(body, 0.1, 0.5);
  const forge::MassProperties mp = forge::massProperties(body);
  const double expected = 40.0 * 30.0 * 20.0 - 3.14159265358979 * 25.0 * 20.0;
  char buf[200];
  std::snprintf(buf, sizeof buf, "tessellate (%zu tris) + massProperties (V=%.3f, expected %.3f)",
                mesh.indices.size() / 3, mp.volume, expected);
  check(!mesh.indices.empty() && std::abs(mp.volume - expected) < 1e-3 * expected, S, buf);
  check(reg.nativeToOcctConversions() - c0 == 0, S,
        "0 native->OCCT conversions across makeBox, makeCylinder, translate, cut, tessellate, "
        "massProperties (delta " + std::to_string(reg.nativeToOcctConversions() - c0) + ")");

  const std::size_t faces = forge::shapeFaceCount(body);  // an OCCT-only consumer (ShapeQuery)
  const std::uint64_t d1 = reg.nativeToOcctConversions() - c0;
  (void)forge::shapeFaceCount(body);
  const std::uint64_t d2 = reg.nativeToOcctConversions() - c0;
  check(faces > 0 && d1 == 1 && d2 == 1, S,
        "an OCCT-only consumer (shapeFaceCount=" + std::to_string(faces) +
            ") is counted: 1 conversion, and still 1 after a second call (memo)");
  for (ShapeHandle h : {box, cyl, cylT, body}) reg.release(h);
}

// I3: the document-close contract with the real compiler. Without a Scope every
// build leaks all of its handles; with one per document generation, the live
// count is the current build's and goes to the baseline on close.
void integrationDocumentClose() {
  const char* S = "integration-document-close";
  auto& reg = ShapeRegistry::instance();
  const char* ir =
      "%1 = RECT(80, 50)\n%2 = EXTRUDE(%1, 20)\n%3 = HOLE(%2, 6, 0, 0, 20)\n%4 = FILLET(%3, 1, ALL)\n";
  const std::size_t base = reg.liveCount();

  // Control arm: what every in-process build does today.
  for (int i = 0; i < 3; ++i) (void)forge::ft::compileText(ir, "");
  const std::size_t leaked = reg.liveCount() - base;
  const std::size_t perBuild = leaked / 3;
  check(leaked > 0 && leaked % 3 == 0, S,
        "control: 3 unscoped builds leave " + std::to_string(leaked) + " handles live (" +
            std::to_string(perBuild) + " per build)");

  // Scoped arm: one Scope per document generation; a rebuild replaces it.
  const std::size_t base2 = reg.liveCount();
  ShapeRegistry::Scope current;
  ShapeHandle result = 0;
  bool allOk = true;
  constexpr int kRebuilds = 100;
  for (int i = 0; i < kRebuilds; ++i) {
    ShapeRegistry::Scope next;
    forge::ft::CompileResult r;
    {
      auto cap = next.capture();
      r = forge::ft::compileText(ir, "");
    }
    allOk = allOk && r.ok;
    result = static_cast<ShapeHandle>(r.handle);
    current = std::move(next);  // the previous generation's handles are released here
  }
  const std::size_t liveAfter = reg.liveCount() - base2;
  check(allOk && liveAfter == perBuild && current.size() == perBuild, S,
        std::to_string(kRebuilds) + " scoped rebuilds: live = " + std::to_string(liveAfter) +
            " (one build's worth, " + std::to_string(perBuild) + "), not " +
            std::to_string(kRebuilds * perBuild));
  check(reg.kindOf(result) == ShapeKind::Occt || reg.kindOf(result) == ShapeKind::NativeSolid, S,
        "the live document's result handle is valid while the document is open");
  const std::size_t dropped = current.releaseAll();  // document close
  check(dropped == perBuild && reg.liveCount() == base2, S,
        "document close released " + std::to_string(dropped) + " handles; live back to " +
            std::to_string(base2));
  check(!known(result), S, "the closed document's result handle is gone");
}

#endif  // GATE_INTEGRATION

struct Scenario {
  const char* name;
  void (*fn)();
};

const std::vector<Scenario>& scenarios() {
  static const std::vector<Scenario> s = {
#ifndef GATE_INTEGRATION
    {"race-occt", raceOcct},
    {"race-native-solid", raceNativeSolid},
    {"race-native-mesh", raceNativeMesh},
    {"conversion-unlocked", conversionOutsideLock},
    {"destroy-unlocked", destroyOutsideLock},
#ifndef GATE_OLD_API
    {"lease-outlives-release", leasesOutliveRelease},
    {"stress", stress},
    {"conversion-counter", conversionCounter},
    {"release-during-conversion", releaseDuringConversion},
    {"scope", scopes},
    {"scope-attribution", scopeAttribution},
#endif
#else
    {"integration-native-path", integrationNativePath},
    {"integration-document-close", integrationDocumentClose},
#endif
  };
  return s;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string want = argc > 1 ? argv[1] : "all";
  bool ran = false;
  for (const Scenario& sc : scenarios()) {
    if (want != "all" && want != sc.name) continue;
    ran = true;
    std::printf("[%s]\n", sc.name);
    std::fflush(stdout);
    sc.fn();
    std::fflush(stdout);
  }
  if (!ran) {
    std::printf("unknown scenario '%s'; known:", want.c_str());
    for (const Scenario& sc : scenarios()) std::printf(" %s", sc.name);
    std::printf("\n");
    return 2;
  }
  std::printf("%s — %d failure(s)\n", g_fail == 0 ? "GREEN" : "RED", g_fail);
  return g_fail == 0 ? 0 : 1;
}
