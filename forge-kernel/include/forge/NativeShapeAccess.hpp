// forge/NativeShapeAccess.hpp — the kernel's shape store, reached WITHOUT OCCT.
//
// WHY THIS EXISTS, and it is not the reason the removal tracker gave.
//
// OCCT_REMOVAL_TRACKER named "an OWNING, OCCT-free shape handle adopted as the
// kernel interchange type" as the single highest-unlock item -- it gates 365 of
// 550 remaining symbols -- and then named OWNERSHIP as the piece that was
// missing: "shape::Shape is a NON-OWNING tagged pointer into a TopologyBuilder
// while ShapeRegistry stores its Occt entries by value, so a registry entry that
// outlives its builder dangles. Either shape::Shape gains shared ownership or
// ShapeRegistry owns the builder per entry."
//
// MEASURED on the tree that paragraph was generated from: the second disjunct is
// ALREADY IMPLEMENTED. ShapeRegistry::Entry holds
// `std::shared_ptr<native::brep::TopologyBuilder> owner` and addNativeSolid()
// takes one by value (ShapeRegistry.hpp / ShapeRegistry.cpp:97). A NativeSolid
// entry cannot outlive its builder, because it OWNS it. The tracker was steering
// the programme at a blocker that had been removed.
//
// THE REAL BLOCKER, measured the same way: nothing can PRODUCE a shape::Shape
// from the kernel's live shape store. Before this header,
//     grep -rn 'shape::Shape' forge-kernel/src forge-kernel/include ui forge-desktop
//       --exclude-dir=shape
// returned ZERO hits. The handle type, the traversal facade, Wire, Compound and
// ~13k lines of OCCT-free B-rep ops all exist and compile, and there was no seam
// between them and ShapeRegistry -- which is the only place a body a user built
// actually lives. Adoption was blocked on a MISSING FUNCTION, not on a lifetime.
//
// So this header is that seam, and it is deliberately the SMALLEST one: register
// a native solid, and read one back as a Shape. It names no OCCT type, which is
// the whole point -- an OCCT-free caller can now round-trip through the registry.
// forge-kernel/test/shape_seam_gate.cpp is compiled with an include path that has
// NO OCCT in it, so "OCCT-free" is a build fact and not a comment.
//
// WHAT IT IS NOT. It does not drop an OCCT symbol by itself, and claiming so
// would be exactly the accounting the tracker warns about. It removes the
// blocker; the symbols fall when call sites move.
#pragma once

#include <memory>

#include "forge/NativeLease.hpp"     // NativeLease<T> — OCCT-free (T-261)
#include "forge/ShapeHandle.hpp"
#include "forge/native/brep/Topology.hpp"    // brep::TopologyBuilder, brep::Solid
#include "forge/native/shape/Shape.hpp"      // shape::Shape
// mesh::HalfEdgeMesh — INCLUDED WHOLE rather than forward-declared, and the
// question was asked rather than assumed. MEASURED: the header is 153 lines and
// its entire include list is forge/math/Vec3.hpp + <cstdint> + <vector> +
// <array> — no OCCT, nothing heavy, and ShapeRegistry.hpp already pulls it in
// full for the same reason (Entry owns one). A forward declaration would type
// the pointer below and leave every caller unable to read a vertex without a
// second include, which is a worse header, not a lighter one.
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {

// Register a native analytic B-rep solid and take a handle to it. `owner` keeps
// the builder -- and therefore the topology `solid` views into -- alive for the
// lifetime of the entry: the registry COPIES the shared_ptr, so the caller may
// drop its own reference immediately and the entry stays valid.
//
// Refcount starts at 1; releaseShape(h) drops it, and the builder dies with the
// last reference. Returns kInvalidHandle for a null owner or a null solid, and
// in a build without FORGE_NATIVE_BREP (where the registry has no native half) —
// never throws, because the OCCT-free callers this exists for have no OCCT
// exception machinery to catch.
ShapeHandle addNativeSolidShape(std::shared_ptr<native::brep::TopologyBuilder> owner,
                                native::brep::Solid* solid);

// The body behind `h`, as the polymorphic Forge shape handle.
//
// A NULL Shape (isNull()) when the handle names nothing, when the entry is not
// NativeSolid-backed (an OCCT TopoDS_Shape or a native RESULT MESH is not a
// shape::Shape and saying otherwise would be a lie), or in a build without
// FORGE_NATIVE_BREP. Check kind with shapeKind() / shapeHandleKnown() from
// ShapeHandle.hpp when you need to tell those cases apart.
//
// The returned Shape is NON-OWNING, like TopoDS_Shape: it stays valid as long as
// the handle does. Release the handle and it dangles. A caller that cannot rule
// out a concurrent release takes nativeShapeLease(h) (below) instead.
native::shape::Shape nativeShapeOf(ShapeHandle h);

// ── THE NATIVE PAYLOAD, READ DIRECTLY ────────────────────────────────────────
//
// WHY THESE TWO EXIST, measured and not argued. nativeShapeOf() hands back the
// TRAVERSAL facade — the thing an explorer walks. It is the right answer for a
// caller that wants faces and edges, and it is the WRONG answer for the native
// engines, which take a `const brep::Solid&` or a `const mesh::HalfEdgeMesh&`
// and cannot be reached from a shape::Shape at all. So a file whose body names
// no OCCT type still had to include ShapeRegistry.hpp — and therefore
// TopoDS_Shape.hxx — purely to call getNativeSolid()/getNativeMesh().
//
// MEASURED on src/MassProps.cpp, the smallest such file: rewritten to name no
// OCCT type it still failed to compile with the OCCT include dir removed, with
// exactly one error, ShapeRegistry.hpp:30: 'TopoDS_Shape.hxx' file not found.
// ZERO geometry nouns blocked it. Not one TopoDS_*, Geom_*, gp_* or BRep_Tool —
// the only two absent things were these two lines of plumbing.
//
// CONTRACT, the same one nativeShapeOf() carries, said once for both:
//   * NON-OWNING BORROWS. The pointee lives in the registry entry and dies with
//     the handle (for a solid, with the TopologyBuilder the entry owns). Release
//     the handle and the pointer dangles — exactly like nativeShapeOf()'s Shape.
//     The owning siblings nativeSolidLease()/nativeMeshLease() below are what a
//     caller uses when a release can happen while it reads (T-261). Every call
//     site in forge-kernel/src and forge-desktop/src has moved onto them except
//     the ones run_native_access_lease_gate.sh lists as ALLOWED_BORROWS (with
//     the reason); any other new borrow call site fails that gate.
//   * nullptr, never a plausible substitute, for: a handle that names nothing
//     (unknown, released, or kInvalidHandle); an entry of the WRONG KIND — an
//     OCCT-backed entry is not a native solid and a native mesh is not one
//     either, and saying otherwise would be the same lie nativeShapeOf() refuses
//     to tell; and a build without FORGE_NATIVE_BREP, where the registry has no
//     native half to read. Use shapeKind() / shapeHandleKnown() from
//     ShapeHandle.hpp when you need to tell those cases apart.
//   * NEVER THROWS. The OCCT-free callers this exists for have no OCCT exception
//     machinery to catch, which is the same reason addNativeSolidShape() returns
//     kInvalidHandle instead of raising.
//
// WHAT THEY ARE NOT. Like the rest of this header, they drop no OCCT symbol by
// themselves. They remove the reason a native-only file has to include the
// OCCT-typed registry; the symbols fall when the call sites move.
const native::brep::Solid* nativeSolidOf(ShapeHandle h);

const native::mesh::HalfEdgeMesh* nativeMeshOf(ShapeHandle h);

// ── LEASES: THE SAME THREE READS, OWNING (T-261) ─────────────────────────────
//
// WHY. The three reads above are BORROWS: each takes the pointer out of the
// registry's own lease and lets the lease go, so what it returns is valid only
// while the handle is. Nothing stops another thread — a document closing, a
// rebuild releasing the previous generation — from releasing that handle while
// the caller is still reading, and then the caller reads freed topology.
// MEASURED (test/run_native_access_lease_gate.sh, 64 races per scenario): a
// reader holding nativeSolidOf(h) / nativeMeshOf(h) / nativeShapeOf(h) while
// another thread releases h is reported by AddressSanitizer (heap-use-after-
// free) and by ThreadSanitizer (a data race with the payload's destruction) on
// every run. Through the real library, forge::massProperties() looping on a
// native prism while another thread released it, on the borrow-reading build:
// the payload's last owner was never the reading call (0/200 rounds) or the
// process died of SIGSEGV reading the freed solid. With the leases: the reading
// call was the last owner in 187-199 of 200 rounds, and nothing crashed.
//
// The siblings below hand back SHARED OWNERSHIP instead (forge::NativeLease, the
// lease ShapeRegistry::getNativeSolid()/getNativeMesh() already return, moved
// to the OCCT-free forge/NativeLease.hpp so it can be returned from here):
// holding the lease keeps the payload alive however the handle is released,
// and the payload dies with the last lease or entry that shares it.
//
// CONTRACT, the borrows' contract with the lifetime fixed:
//   * an EMPTY lease (operator bool false), never a plausible substitute, for a
//     handle that names nothing (unknown, released, kInvalidHandle), an entry of
//     the wrong kind, and a build without FORGE_NATIVE_BREP;
//   * NEVER THROWS, for the reason the borrows do not;
//   * HOLD THE LEASE, not what it points at:
//         const auto s = nativeSolidLease(h);  if (s) use(*s);      // pinned
//         use(*nativeSolidLease(h));          // pinned to the full-expression
//         const Solid& s = *nativeSolidLease(h);   // DANGLES (clang -Wdangling)
//
// Prefer these everywhere a release can happen while the payload is read —
// which, for any handle a document owns, is everywhere off the owning thread.
NativeLease<native::brep::Solid> nativeSolidLease(ShapeHandle h);

NativeLease<native::mesh::HalfEdgeMesh> nativeMeshLease(ShapeHandle h);

// nativeShapeOf()'s owning sibling: the traversal facade TOGETHER with the
// lease that keeps the topology it points into alive. shape::Shape is a
// non-owning tagged pointer by design (like TopoDS_Shape's TShape view), so
// the pin has to travel beside it. A NULL shape() (and operator bool false)
// for exactly the handles nativeShapeOf() answers a NULL Shape for.
//
// The Shape is valid while THIS OBJECT is. A COPY of shape() taken out of it
// is the old borrow again — keep the NativeShapeLease alive for as long as
// the Shape (or anything an Explorer reached through it) is used.
class NativeShapeLease {
public:
    NativeShapeLease() = default;

    // Views the solid `solid` leases; pins it for this object's lifetime.
    explicit NativeShapeLease(NativeLease<native::brep::Solid> solid) noexcept
        : solid_(std::move(solid)),
          // The object is the non-const brep::Solid the builder owns (the
          // registry stores it non-const); shape::Shape's factories take a
          // mutable pointer, so the constness the lease added is cast back off.
          shape_(solid_ ? native::shape::Shape::ofSolid(
                              const_cast<native::brep::Solid*>(solid_.get()))
                        : native::shape::Shape()) {}

    const native::shape::Shape& shape() const noexcept FORGE_LIFETIMEBOUND { return shape_; }
    bool isNull() const noexcept { return shape_.isNull(); }
    explicit operator bool() const noexcept { return !shape_.isNull(); }

    // The pin itself, for a caller that needs the payload as a brep::Solid too.
    const NativeLease<native::brep::Solid>& solid() const noexcept { return solid_; }

private:
    NativeLease<native::brep::Solid> solid_;
    native::shape::Shape shape_;
};

NativeShapeLease nativeShapeLease(ShapeHandle h);

}  // namespace forge
