// forge/native/voxel/VoxelGrid.cpp
//
// Stage 5 (voxel/lattice) — translation unit for VoxelGrid.
//
// The VoxelGrid<T> field engine is implemented as a header-only template in
// include/forge/native/voxel/VoxelGrid.hpp (the storage + sampling + volume +
// connectivity logic is all inline / templated). This .cpp exists so the build
// system's explicit source list (CMakeLists.txt:139) has a real translation
// unit for the module and so the template is instantiated and type-checked in
// isolation. It also forces an EXPLICIT instantiation of VoxelGrid<float>, the
// concrete grid this stage ships.
//
// No logic lives only here — see the header. Pure C++20, no external deps.

#include "forge/native/voxel/VoxelGrid.hpp"

namespace forge {
namespace native {

// Explicit instantiation of the concrete grid this increment ships + validates.
template class VoxelGrid<float>;

} // namespace native
} // namespace forge
