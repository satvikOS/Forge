// forge/native/voxel/Tpms.cpp
//
// Stage 5 (voxel/lattice) — translation unit for the TPMS gyroid generator.
//
// The gyroid field + thresholding + grid-stamping are inline functions in
// include/forge/native/voxel/Tpms.hpp. This .cpp exists so the explicit build
// source list has a real translation unit and so the header type-checks as a
// standalone TU. No logic lives only here — see the header.
//
// Pure C++20, standard library only. No external deps, no OCCT, no WASM.

#include "forge/native/voxel/Tpms.hpp"

namespace forge {
namespace native {

// Force ODR-use of the inline API so this TU exercises the header symbols.
// (Returns a sample of the canonical unit-frequency gyroid at the origin == 0.)
namespace {
[[maybe_unused]] double tpms_translation_unit_anchor() {
    return gyroidField(0.0, 0.0, 0.0, 2.0 * M_PI);
}
} // namespace

} // namespace native
} // namespace forge
