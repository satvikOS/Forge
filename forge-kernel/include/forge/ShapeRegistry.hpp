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
// Kind::Occt entries, so the existing get(h) -> const TopoDS_Shape& path is
// byte-for-byte unchanged. The native members are only present when the addon
// is compiled with -DFORGE_NATIVE_BREP (the includes + members are #ifdef'd),
// so the default build's Entry layout and behaviour are identical to before.

#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <TopoDS_Shape.hxx>

// The native variant payload is only compiled in when the in-house B-rep path
// is enabled. Pure C++20 headers (no OCCT); pulled in fully because Entry owns
// shared_ptrs of the complete types.
#ifdef FORGE_NATIVE_BREP
#include <memory>
#include "forge/native/brep/Topology.hpp"           // brep::TopologyBuilder, brep::Solid
#include "forge/native/mesh/HalfEdgeMesh.hpp"        // mesh::HalfEdgeMesh
#endif

namespace forge {

using ShapeHandle = std::uint32_t;
constexpr ShapeHandle kInvalidHandle = 0;

// The backend that produced the shape behind a handle.
enum class ShapeKind : std::uint8_t {
    Occt = 0,        // a TopoDS_Shape (OCCT — the default live path)
    NativeSolid = 1, // a forge::native::brep::Solid (analytic native B-rep)
    NativeMesh = 2   // a forge::native::mesh::HalfEdgeMesh (native fillet/chamfer result)
};

class ShapeRegistry {
public:
    static ShapeRegistry& instance();

    // Insert a new OCCT shape and return its handle. Refcount starts at 1.
    // (Kind::Occt — the default live path.)
    ShapeHandle add(TopoDS_Shape shape);

    // The backend that produced the shape behind `h`. Aborts if invalid.
    ShapeKind kindOf(ShapeHandle h) const;

    // Bump the refcount on an existing handle.
    void retain(ShapeHandle h);

    // Drop one refcount; deletes when reaching zero.
    void release(ShapeHandle h);

    // Borrow the OCCT shape without changing refcount. Throws if the handle is
    // invalid OR if the entry is NOT a Kind::Occt entry (a native-backed handle
    // has no TopoDS_Shape — the caller must branch on kindOf() first).
    const TopoDS_Shape& get(ShapeHandle h) const;

    // Read-only diagnostics — used by the smoke test and the 100k benchmark.
    std::size_t liveCount() const;
    std::size_t totalEverIssued() const;

#ifdef FORGE_NATIVE_BREP
    // Insert a native analytic B-rep solid behind a handle. `owner` keeps the
    // builder (which owns the topology/surfaces the Solid* views into) alive for
    // the lifetime of the entry; `solid` is a non-owning view into *owner.
    ShapeHandle addNativeSolid(std::shared_ptr<native::brep::TopologyBuilder> owner,
                               native::brep::Solid* solid);

    // Insert a native fillet/chamfer RESULT mesh behind a handle. The result of a
    // mesh-bridge feature op (HONESTLY a mesh, not an analytic Solid).
    ShapeHandle addNativeMesh(std::shared_ptr<native::mesh::HalfEdgeMesh> mesh);

    // Borrow the native solid. Throws if the handle is not a Kind::NativeSolid.
    const native::brep::Solid& getNativeSolid(ShapeHandle h) const;

    // Borrow the native mesh. Throws if the handle is not a Kind::NativeMesh.
    const native::mesh::HalfEdgeMesh& getNativeMesh(ShapeHandle h) const;
#endif

private:
    ShapeRegistry() = default;

    struct Entry {
        ShapeKind     kind = ShapeKind::Occt;
        TopoDS_Shape  shape;             // kind == Occt
        std::uint32_t refcount = 0;
#ifdef FORGE_NATIVE_BREP
        // kind == NativeSolid: `owner` keeps the topology alive; `solid` views it.
        std::shared_ptr<native::brep::TopologyBuilder> owner;
        native::brep::Solid* solid = nullptr;
        // kind == NativeMesh: the fillet/chamfer result mesh.
        std::shared_ptr<native::mesh::HalfEdgeMesh> mesh;
#endif
    };

    mutable std::mutex mtx_;
    // mutable: get() lazily materializes + caches a native handle's OCCT shape
    // (the native→OCCT bridge) on first OCCT-only access — a const-logical memo.
    mutable std::unordered_map<ShapeHandle, Entry> entries_;
    ShapeHandle next_ = 1;
    std::size_t totalEverIssued_ = 0;
};

} // namespace forge
