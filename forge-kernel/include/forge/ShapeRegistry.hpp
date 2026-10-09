#pragma once

// ShapeRegistry — stable handle table over a SHAPE that is EITHER an OCCT
// TopoDS_Shape OR an in-house forge::native::brep result (an analytic Solid or
// a fillet/chamfer mesh), behind the SAME uint32_t handle.
//
// Handles are uint32_t IDs that survive across the JS / C++ boundary
// without exposing the underlying shape's reference machinery to V8.
// The frontend never has to think about copies, retains, or destructors —
// NOR about which kernel backend produced the body. makeBox / cut / fillet /
// massProps / tessellate are byte-identical in JS whether the entry was built
// by OCCT (default) or by the native B-rep path (FORGE_NATIVE_BREP=ON).
//
// 100,000-instance assemblies use this directly: every body lives in the
// registry once; assembly instances are (handle, transform) pairs that
// share the same underlying shape.
//
// ============================ HONESTY (Bible §0/§9) ========================
// The variant entry is ADDITIVE: the default (OCCT) path only ever stores
// Kind::Occt entries. The native members are only present when the addon is
// compiled with -DFORGE_NATIVE_BREP (the includes + members are #ifdef'd).
//
// ===================== OWNERSHIP, LIFETIME, LOCKING (T-183) ================
// EVERY READ HANDS BACK SHARED OWNERSHIP of what it reads. Before T-183, get(),
// getNativeSolid() and getNativeMesh() returned REFERENCES into the entry after
// the lock was gone, and release() — on another thread, or later on this one —
// could erase the entry and free what the caller was still reading (gated:
// test/shape_registry_lifetime_gate.cpp: heap-use-after-free under ASan, a
// data race with the entry's destruction under TSan, on the old code).
//
//   get(h)            -> TopoDS_Shape BY VALUE. A TopoDS_Shape is itself a
//                        handle (an atomically refcounted TShape + location), so
//                        the copy is two atomic increments and co-owns the
//                        topology. `const TopoDS_Shape& s = reg.get(h);` — the
//                        common call-site shape — binds to the returned
//                        temporary and extends its life to the reference's
//                        scope, so those callers are safe UNEDITED. A helper
//                        that RETURNED `const TopoDS_Shape&` from get() must now
//                        return by value (clang: -Wreturn-stack-address).
//   getNativeSolid(h) -> NativeLease<Solid>: shares ownership of the entry's
//                        TopologyBuilder (an aliasing shared_ptr).
//   getNativeMesh(h)  -> NativeLease<HalfEdgeMesh>: shares the mesh.
//
// A lease converts implicitly to `const T&`, so `f(reg.getNativeSolid(h))`
// still compiles and is PINNED for the whole call (the temporary lease lives to
// the end of the full-expression). Binding a NAMED reference or pointer to a
// temporary lease (`const Solid& s = reg.getNativeSolid(h);`) would be the old
// unpinned borrow again; the accessors are [[clang::lifetimebound]], so clang
// flags it (-Wdangling). Hold the lease (`const auto s = reg.getNativeSolid(h);`
// then `*s` / `s->`) for as long as the payload is used.
//
// LOCKS. `mtx_` guards the table and is held only for lookups and bookkeeping:
// never across a payload destructor (erased entries are destroyed after it is
// dropped) and never across the native->OCCT conversion. The conversion runs
// under a PER-ENTRY memo mutex, taken with `mtx_` NOT held; nothing takes a
// memo mutex while holding `mtx_`, so there is no lock-order cycle. Re-entering
// get() for the SAME handle from inside the conversion would self-deadlock on
// its memo; occtFromNativeSolid does not touch the registry.
//
// THREADS. Every member function may be called from any thread. A Scope's
// capture() is per-thread (see Scope).

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>
#include "forge/ShapeHandle.hpp"

#include <TopoDS_Shape.hxx>

// The native variant payload is only compiled in when the in-house B-rep path
// is enabled. Pure C++20 headers (no OCCT); pulled in fully because Entry owns
// shared_ptrs of the complete types.
#ifdef FORGE_NATIVE_BREP
#include "forge/native/brep/Topology.hpp"           // brep::TopologyBuilder, brep::Solid
#include "forge/native/mesh/HalfEdgeMesh.hpp"        // mesh::HalfEdgeMesh
#endif

namespace forge {


// ShapeHandle, kInvalidHandle and ShapeKind now live in forge/ShapeHandle.hpp,
// which names no OCCT type. Application code includes THAT; this header is the
// OCCT-typed surface on top of it, and every existing includer of this file keeps
// working because it is included below.

// [[clang::lifetimebound]] on an accessor of a temporary lease makes clang warn
// (-Wdangling) when its result outlives the lease — i.e. an unpinned borrow.
#if defined(__has_cpp_attribute)
#if __has_cpp_attribute(clang::lifetimebound)
#define FORGE_LIFETIMEBOUND [[clang::lifetimebound]]
#endif
#endif
#ifndef FORGE_LIFETIMEBOUND
#define FORGE_LIFETIMEBOUND
#endif

// A read lease on a native payload: shared ownership, read-only access. Holding
// one keeps the payload alive however many times its handle is released; the
// payload dies with the last lease or entry that shares it.
template <class T>
class NativeLease {
public:
    NativeLease() = default;
    explicit NativeLease(std::shared_ptr<const T> p) noexcept : p_(std::move(p)) {}

    // Source compatibility with the reference-returning accessors this replaced:
    // `f(reg.getNativeSolid(h))` binds f's `const T&` through here and the
    // temporary lease pins the payload until f returns.
    operator const T&() const noexcept FORGE_LIFETIMEBOUND { return *p_; }

    const T& operator*() const noexcept FORGE_LIFETIMEBOUND { return *p_; }
    const T* operator->() const noexcept { return p_.get(); }
    const T* get() const noexcept FORGE_LIFETIMEBOUND { return p_.get(); }
    explicit operator bool() const noexcept { return static_cast<bool>(p_); }

    // The underlying shared ownership, for a caller that must store it.
    const std::shared_ptr<const T>& share() const noexcept { return p_; }

private:
    std::shared_ptr<const T> p_;
};

class ShapeRegistry {
public:
    class Scope;

    static ShapeRegistry& instance();

    // Insert a new OCCT shape and return its handle. Refcount starts at 1 — or,
    // inside a Scope::capture() on this thread, the creation reference belongs
    // to that Scope (see Scope). (Kind::Occt — the default live path.)
    ShapeHandle add(TopoDS_Shape shape);

    // The backend that produced the shape behind `h`. Throws if invalid.
    ShapeKind kindOf(ShapeHandle h) const;

    // Bump the refcount on an existing handle. Throws if invalid.
    void retain(ShapeHandle h);

    // Drop one reference; the entry is destroyed (outside the lock) when no
    // reference of any kind is left. A release of an unknown or already-dead
    // handle is a no-op. WHOSE reference is dropped:
    //   * on a thread inside a Scope::capture() whose Scope (or an enclosing
    //     capture's Scope) holds `h`: that Scope's — the build dropping a
    //     handle it created, e.g. a transient it registered and is done with;
    //   * otherwise a caller-owned one (add/retain) when any is left;
    //   * otherwise none: only Scope-owned references remain, which are not the
    //     caller's to drop, so the release is REFUSED and counted in
    //     refusedReleases() instead of freeing a body a document still owns.
    void release(ShapeHandle h);

    // The OCCT shape, BY VALUE (shared ownership of the topology — see the
    // header comment). Throws if the handle is invalid or names a native MESH
    // (a faceted feature result has no analytic TopoDS_Shape). For a native
    // SOLID it is the LAZY native->OCCT BRIDGE: materialized once per entry via
    // occtFromNativeSolid, counted in nativeToOcctConversions(), memoized, and
    // run WITHOUT the registry lock so the rest of the registry stays live.
    TopoDS_Shape get(ShapeHandle h) const;

    // Read-only diagnostics — used by the smoke test and the 100k benchmark.
    std::size_t liveCount() const;
    std::size_t totalEverIssued() const;

    // How many times get() has run the native->OCCT conversion (attempts,
    // counted before the call, so a conversion that throws is still counted).
    // The native path's acceptance is a ZERO delta across its ops; every
    // non-zero delta is an OCCT-only consumer reached by a native body. Always
    // 0 in a build without FORGE_NATIVE_BREP.
    std::uint64_t nativeToOcctConversions() const noexcept;

    // How many release() calls were refused because only Scope-owned
    // references were left (a would-be over-release).
    std::uint64_t refusedReleases() const noexcept;

#ifdef FORGE_NATIVE_BREP
    // Insert a native analytic B-rep solid behind a handle. `owner` keeps the
    // builder (which owns the topology/surfaces the Solid* views into) alive for
    // the lifetime of the entry AND of every lease taken from it; `solid` is a
    // non-owning view into *owner.
    ShapeHandle addNativeSolid(std::shared_ptr<native::brep::TopologyBuilder> owner,
                               native::brep::Solid* solid);

    // Insert a native fillet/chamfer RESULT mesh behind a handle. The result of a
    // mesh-bridge feature op (HONESTLY a mesh, not an analytic Solid).
    ShapeHandle addNativeMesh(std::shared_ptr<native::mesh::HalfEdgeMesh> mesh);

    // A lease on the native solid. Throws if the handle is not a Kind::NativeSolid.
    NativeLease<native::brep::Solid> getNativeSolid(ShapeHandle h) const;

    // A lease on the native mesh. Throws if the handle is not a Kind::NativeMesh.
    NativeLease<native::mesh::HalfEdgeMesh> getNativeMesh(ShapeHandle h) const;
#endif

private:
    ShapeRegistry() = default;

#ifdef FORGE_NATIVE_BREP
    // The lazily-converted OCCT form of a native solid, shared (not owned) by
    // its entry so a conversion in flight survives a concurrent release.
    struct OcctMemo;
#endif

    struct Entry {
        ShapeKind     kind = ShapeKind::Occt;
        TopoDS_Shape  shape;             // kind == Occt
        std::uint32_t refcount = 0;      // references owned by callers (add/retain)
        std::uint32_t scopeRefs = 0;     // references owned by Scopes (sum over scopes_)
#ifdef FORGE_NATIVE_BREP
        // kind == NativeSolid: `owner` keeps the topology alive; `solid` views it.
        std::shared_ptr<native::brep::TopologyBuilder> owner;
        native::brep::Solid* solid = nullptr;
        // kind == NativeSolid: get()'s memo, created on first get() — a
        // const-logical cache, hence mutable.
        mutable std::shared_ptr<OcctMemo> occt;
        // kind == NativeMesh: the fillet/chamfer result mesh.
        std::shared_ptr<native::mesh::HalfEdgeMesh> mesh;
#endif
    };

    // A Scope's references: handle -> how many references the Scope holds on it.
    using ScopeRefs = std::unordered_map<ShapeHandle, std::uint32_t>;

    // Every add*() lands here: assigns the handle and decides who owns the
    // creation reference (the calling thread's innermost capturing Scope, or the
    // caller).
    ShapeHandle insert(Entry e);

    // Scope bookkeeping (each takes mtx_).
    std::uint64_t openScope();
    bool holdInScope(std::uint64_t scope, ShapeHandle h);
    std::size_t releaseScope(std::uint64_t scope, bool close) noexcept;
    std::size_t scopeSize(std::uint64_t scope) const;

    mutable std::mutex mtx_;
    std::unordered_map<ShapeHandle, Entry> entries_;
    std::unordered_map<std::uint64_t, ScopeRefs> scopes_;  // open Scopes only
    ShapeHandle next_ = 1;
    std::uint64_t nextScope_ = 1;
    std::size_t totalEverIssued_ = 0;
    mutable std::atomic<std::uint64_t> conversions_{0};
    std::atomic<std::uint64_t> refusedReleases_{0};
};

// ShapeRegistry::Scope — a set of registry references with one owner and RAII
// release. It is the registry half of "a document's handles are released when
// the document closes" (or rebuilds):
//
//   ShapeRegistry::Scope doc;              // one per document generation
//   { auto cap = doc.capture();            // every handle issued ON THIS THREAD
//     result = compile(program); }         //   while `cap` lives belongs to doc
//   ...                                    // the bodies stay valid while doc does
//   doc.releaseAll();                      // close / rebuild: all of them go
//
// A captured handle's CREATION reference is the Scope's. The build that
// created it may still release it inside the capture (see release()); after
// the capture, a plain release() that would drop the Scope's reference is
// refused and counted rather than freeing a body the document still owns. A
// caller that needs a handle beyond the Scope takes its own reference with
// retain(); hold(h) adds a Scope reference to an existing handle.
//
// capture() is PER-THREAD and nests (the innermost live capture takes new
// handles): a handle issued by another thread is not captured. The kernel ops
// register their results on the calling thread, so an in-process compile is
// captured whole (gated: 100 scoped rebuilds leave exactly one build's handles
// live, and close leaves none).
//
// Movable, not copyable. Not itself thread-safe: one owner at a time. Moving
// a Scope keeps its live captures attached to it (they name it by id).
class ShapeRegistry::Scope {
public:
    explicit Scope(ShapeRegistry& reg = ShapeRegistry::instance());
    ~Scope();
    Scope(Scope&& other) noexcept;
    Scope& operator=(Scope&& other) noexcept;  // releases what *this held first
    Scope(const Scope&) = delete;
    Scope& operator=(const Scope&) = delete;

    // Take a Scope-owned reference to an existing handle. False if it is invalid.
    bool hold(ShapeHandle h);

    // Drop every reference this Scope holds; entries left with none are
    // destroyed. Returns the number of references dropped. The Scope stays
    // usable (empty) afterwards.
    std::size_t releaseAll() noexcept;

    // References currently held.
    std::size_t size() const;

    // While the returned guard lives, handles issued on THIS thread belong to
    // this Scope. Guards are not movable, so a local variable is destroyed on
    // the thread, and in the (reverse) order, it was created in — as required.
    class Capture {
    public:
        ~Capture();
        Capture(const Capture&) = delete;
        Capture& operator=(const Capture&) = delete;
        Capture(Capture&&) = delete;
        Capture& operator=(Capture&&) = delete;

    private:
        friend class Scope;
        friend class ShapeRegistry;
        Capture(const ShapeRegistry* reg, std::uint64_t scope) noexcept;
        const ShapeRegistry* reg_;
        std::uint64_t scope_;
        const Capture* prev_;  // the enclosing capture on this thread, if any
    };
    [[nodiscard]] Capture capture() noexcept;

private:
    ShapeRegistry* reg_;
    std::uint64_t id_;  // 0 once moved from
};

} // namespace forge
