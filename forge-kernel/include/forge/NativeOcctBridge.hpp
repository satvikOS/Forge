// forge/NativeOcctBridge.hpp
//
// IN-HOUSE KERNEL — the native→OCCT fallback BRIDGE.
//
// The migration runs native-where-proven, OCCT-everywhere-else (Bible §0). For
// that to be safe when a primitive/boolean builds NATIVE (a NativeSolid handle
// with NO TopoDS_Shape), any op that lacks a native path — and any native op that
// honestly defers — must be able to obtain an OCCT shape for that handle. This
// bridge provides exactly that, reusing the VALIDATED analytic STEP round-trip
// (native StepAnalytic::write → OCCT STEPControl_Reader; the step3c A/B gate
// proves it round-trips volume/COM/inertia/AABB). Compiled only under
// FORGE_NATIVE_BREP; a pure-OCCT build never references it.
//
// HONEST: this is a real conversion, never a fake. It throws (never returns a
// wrong shape) if the native solid cannot be serialised or OCCT cannot read it.

#ifndef FORGE_NATIVE_OCCT_BRIDGE_HPP
#define FORGE_NATIVE_OCCT_BRIDGE_HPP

#include "forge/ShapeRegistry.hpp"

#ifdef FORGE_NATIVE_BREP
#include <TopoDS_Shape.hxx>
#endif

namespace forge {

#ifdef FORGE_NATIVE_BREP
// Convert a native analytic Solid into an OCCT TopoDS_Shape via the validated
// analytic STEP round-trip (StepAnalytic::write → OCCT STEPControl_Reader). Throws
// on a malformed solid / OCCT read failure (never a silently-wrong shape). Used by
// ShapeRegistry::get() to lazily materialize a native handle's OCCT shape on demand.
TopoDS_Shape occtFromNativeSolid(const native::brep::Solid& solid);
#endif

// If `h` is a NativeSolid handle, convert it to an OCCT-backed handle (via the
// analytic STEP round-trip) and return the NEW handle. If `h` is already an
// OCCT-backed handle (or the native compile gate is off), returns `h` unchanged.
// Throws if the conversion genuinely fails (malformed native solid / OCCT read
// failure) or if `h` is a NativeMesh (faceted feature result — bridged in a later
// wave). Never returns a silently-wrong shape.
ShapeHandle toOcctBackedHandle(ShapeHandle h);

}  // namespace forge

#endif  // FORGE_NATIVE_OCCT_BRIDGE_HPP
