// forge/NativeLease.hpp — a read lease on a registry payload, with no OCCT.
//
// WHY THIS HEADER EXISTS (T-261). T-183 introduced NativeLease<T> inside
// ShapeRegistry.hpp, and ShapeRegistry.hpp includes TopoDS_Shape.hxx. The
// OCCT-free seam (forge/NativeShapeAccess.hpp) could therefore not RETURN a
// lease: the only thing it could hand an OCCT-free caller was the pointer it
// took out of one (`getNativeSolid(h).share().get()`), which is a borrow that
// dangles the moment another thread releases the handle. The type moved here,
// unchanged, so both the registry and the seam can hand out the same lease.
// ShapeRegistry.hpp includes this header, so every existing user of
// forge::NativeLease keeps compiling unedited.
//
// Pure C++20: <memory> only. Nothing here may ever include an OCCT header —
// forge_shape_seam_gate compiles against this through NativeShapeAccess.hpp
// with no OCCT include path, so a regression is a build failure, not a comment.
#pragma once

#include <memory>
#include <utility>

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

namespace forge {

// A read lease on a native payload: shared ownership, read-only access. Holding
// one keeps the payload alive however many times its handle is released; the
// payload dies with the last lease or entry that shares it.
//
// An EMPTY lease (operator bool false) is how a refusal is said: the handle
// names nothing, or names a payload of another kind.
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

}  // namespace forge
