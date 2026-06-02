#pragma once

// Forge-178 — glTF 2.0 binary (.glb) export.
//
// Tessellates the supplied BREP handles + writes a self-contained .glb
// file (single binary blob with embedded JSON header + binary buffer).
// Per-handle materials are exported via the standard PBR metallic-
// roughness model (baseColorFactor + metallicFactor + roughnessFactor).
//
// The output is conformant with the glTF 2.0 spec (Khronos)
// (https://github.com/KhronosGroup/glTF/tree/main/specification/2.0)
// and round-trips through Three.js, model-viewer, Babylon, Sketchfab.

#include <cstdint>
#include <string>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge { namespace gltf {

struct ExportBody {
    ShapeHandle handle;
    std::string name;
    // Per-body PBR material (defaults to a brushed-steel grey if unset).
    double baseColorR = 0.78;
    double baseColorG = 0.80;
    double baseColorB = 0.84;
    double baseColorA = 1.0;
    double metallicFactor  = 0.40;
    double roughnessFactor = 0.55;
};

struct ExportOptions {
    double deflection      = 0.1;   // OCCT tessellation linear deflection
    double angularDeflection = 0.5; // OCCT tessellation angular deflection (rad)
    bool   computeNormals  = true;
    // Generator string written into the .glb asset metadata.
    std::string generator  = "Forge MCAD (kernel 0.1.0)";
};

struct ExportSummary {
    std::uint32_t bodiesWritten;
    std::uint32_t verticesTotal;
    std::uint32_t trianglesTotal;
    std::uint64_t fileSizeBytes;
};

// Writes a .glb at `filepath`. Throws std::runtime_error on I/O failure
// or empty input.
ExportSummary writeGlb(const std::vector<ExportBody>& bodies,
                       const std::string& filepath,
                       const ExportOptions& options);

// Forge-198 — streaming variant.
//
// Tessellates one body at a time and writes its geometry to a temporary
// BIN file before composing the final .glb (header + JSON + BIN). Peak
// memory stays at one body's worth of triangles regardless of the
// input scene size — the previous one-shot writer accumulated every
// body's positions/normals/indices in RAM before emitting the file.
//
// Output is byte-identical to writeGlb() for the same inputs (same
// JSON layout, same accessor / bufferView ordering). The summary adds
// peakBytesInMemory to record the maximum per-body buffer size.
struct StreamingSummary : public ExportSummary {
    std::uint64_t peakBytesInMemory;
};

StreamingSummary writeGlbStream(const std::vector<ExportBody>& bodies,
                                const std::string& filepath,
                                const ExportOptions& options);

}} // namespace forge::gltf
