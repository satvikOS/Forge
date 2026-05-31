#pragma once

// ShapeRegistry — stable handle table over OCCT TopoDS_Shape.
//
// Handles are uint32_t IDs that survive across the JS / C++ boundary
// without exposing the TopoDS_Shape object's reference machinery to V8.
// The frontend never has to think about copies, retains, or destructors.
//
// 100,000-instance assemblies use this directly: every body lives in the
// registry once; assembly instances are (handle, transform) pairs that
// share the same underlying TopoDS_Shape.

#include <cstdint>
#include <mutex>
#include <unordered_map>
#include <TopoDS_Shape.hxx>

namespace forge {

using ShapeHandle = std::uint32_t;
constexpr ShapeHandle kInvalidHandle = 0;

class ShapeRegistry {
public:
    static ShapeRegistry& instance();

    // Insert a new shape and return its handle. Refcount starts at 1.
    ShapeHandle add(TopoDS_Shape shape);

    // Bump the refcount on an existing handle.
    void retain(ShapeHandle h);

    // Drop one refcount; deletes when reaching zero.
    void release(ShapeHandle h);

    // Borrow without changing refcount. Aborts if handle is invalid.
    const TopoDS_Shape& get(ShapeHandle h) const;

    // Read-only diagnostics — used by the smoke test and the 100k benchmark.
    std::size_t liveCount() const;
    std::size_t totalEverIssued() const;

private:
    ShapeRegistry() = default;

    struct Entry {
        TopoDS_Shape shape;
        std::uint32_t refcount;
    };

    mutable std::mutex mtx_;
    std::unordered_map<ShapeHandle, Entry> entries_;
    ShapeHandle next_ = 1;
    std::size_t totalEverIssued_ = 0;
};

} // namespace forge
