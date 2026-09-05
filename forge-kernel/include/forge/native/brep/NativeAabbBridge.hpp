// forge/native/brep/NativeAabbBridge.hpp
//
// THE ONE SEAM between an OCCT-typed call site that wants a bounding box and the
// in-house analytic AABB (brep::computeAabb, Aabb.hpp). OCCT_ZERO track 1.
//
// ============================ WHY A SEAM AT ALL ============================
// brep::computeAabb takes a `const brep::Solid&`. Every existing call site holds a
// `TopoDS_Shape`. So each site would otherwise have to hand-roll
//     importOcctSolid -> ok? -> computeAabb -> else BRepBndLib::Add
// twenty-one times, and twenty-one hand-rolled fall-throughs is twenty-one chances
// to return a silently wrong box. This puts the fall-through in ONE place.
//
// ============================ THE HONEST CONTRACT ==========================
//   shapeAabb(shape, box)  is a DROP-IN for  BRepBndLib::Add(shape, box).
//
//   * gate OFF (the default)            -> calls BRepBndLib::Add. Byte-identical.
//   * gate ON, importOcctSolid DECLINES -> calls BRepBndLib::Add. Byte-identical.
//   * gate ON, import succeeds          -> the EXACT analytic box.
//
// There is no third outcome. A site can only ever get the native box or the box it
// got before; it can never get a fabricated one.
//
// ============================ THE DELTA, MEASURED ==========================
// The native box is NOT bit-identical to BRepBndLib::Add, and pretending otherwise
// would be the lie. Measured (scratchpad/aabb_probe.cpp, closed-form oracle, 7
// primitives incl. a boolean result):
//
//   NATIVE vs closed form          max|d| = 0.000e+00   (exact)
//   BRepBndLib::AddOptimal vs same max|d| = 0.000e+00   (exact)
//   BRepBndLib::Add        vs same max|d| = 1.000e-07   (inflated, every axis)
//
// BRepBndLib::Add enlarges by the shape tolerance (Precision::Confusion). So
// turning the gate ON SHRINKS every converted box by exactly 1e-7 per face onto
// the true tight box. That is a real behavioural change, which is precisely why
// this has its own gate and why it defaults OFF.
//
// ============================ WHAT IS *NOT* ROUTED =========================
// src/VoxelIoU.cpp:68 (boundsOf) is deliberately left on BRepBndLib::Add. It sets
// lo/hi/step of the voxel lattice for the official 64^3 IoU metric. Tightening that
// box by 1e-7 shifts the lattice and can flip boundary voxels — i.e. it MOVES THE
// RULER the whole programme is judged by. Correctness of the box is not the point
// there; comparability across a corpus is.
//
// Sites whose argument is a bare FACE or WIRE are also not routed: measured
// (scratchpad/subshape_probe.cpp), importOcctSolid declines a lone face with
// "import not 2-manifold (edge shared by != 2 faces)" and a wire with "no faces in
// shape". Routing them would buy an honest fall-through and nothing else. SOLID and
// SHELL both import.
//
// Pure declaration; the TU is listed UNCONDITIONALLY in CMakeLists (this target
// links -undefined dynamic_lookup, so a conditionally-listed file is a runtime
// SIGSEGV, not a link error) and defines every symbol below in BOTH arms of
// FORGE_NATIVE_BREP.

#ifndef FORGE_NATIVE_BREP_NATIVE_AABB_BRIDGE_HPP
#define FORGE_NATIVE_BREP_NATIVE_AABB_BRIDGE_HPP

class TopoDS_Shape;
class Bnd_Box;

namespace forge {
namespace native {
namespace brep {

// Runtime gate, DEFAULT OFF. Env FORGE_NATIVE_AABB=1/on/true/yes turns it on.
// Deliberately NOT wired into setForgeNativeBrepEnabled(): the existing native_vs_occt
// A/B harness must not start moving bounding boxes as a side effect of toggling
// something else.
bool forgeNativeAabbEnabled();

// Force the gate for the rest of the process (analytic test / A/B harness only).
void setForgeNativeAabbEnabled(bool on);

// DROP-IN for BRepBndLib::Add(shape, box). See the contract above.
void shapeAabb(const TopoDS_Shape& shape, Bnd_Box& box);

// Same, but reports which route was taken, so a caller (or a test) can PROVE the
// native path actually fired instead of silently deferring. Returns true iff the
// native analytic box was used.
bool shapeAabbNative(const TopoDS_Shape& shape, Bnd_Box& box);

// Process-wide counters. entered = shapeAabb calls; native = calls that returned
// the analytic box. entered-native = honest fall-throughs to OCCT. Zero production
// impact (two relaxed atomics); they exist so "wired" is a measurement, not a claim.
unsigned long long shapeAabbCallCount();
unsigned long long shapeAabbNativeCount();

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NATIVE_AABB_BRIDGE_HPP
