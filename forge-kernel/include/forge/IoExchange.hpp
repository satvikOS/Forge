#pragma once

// IoExchange — STEP / STL / BREP file I/O.
//
// STEP is the industry-standard interoperability format: every commercial
// CAD reads + writes it (SolidWorks, NX, Catia, Fusion, FreeCAD…). BREP
// is OCCT's native binary format — perfect for fast project autosaves
// because it round-trips with no loss. STL is the only tessellated
// format here; included because every 3D printer slicer wants it.
//
// All operations are file-path based to keep the API surface tiny. A
// Buffer overload is queued for a follow-up slice once we know whether
// the renderer needs in-memory I/O (e.g. for STEP-paste from clipboard).

#include "forge/ShapeRegistry.hpp"

#include <string>
#include <vector>

namespace forge::io {

// Returns a new ShapeHandle (refcount=1) on success.
// Throws std::runtime_error on parse / disk failures.
ShapeHandle importStep(const std::string& filepath);
ShapeHandle importBrep(const std::string& filepath);
ShapeHandle importStl (const std::string& filepath); // returns a shell, not a solid

// Forge-34 — IGES / JT / Parasolid.
//   IGES is implemented via OCCT's IGESControl_Reader (TKDEIGES is linked).
//   JT and Parasolid are *stubs that throw* — they require proprietary
//   kits we don't vendor. The function detects the magic bytes and
//   produces a friendly error pointing the user at STEP/IGES instead.
ShapeHandle importIges     (const std::string& filepath);
ShapeHandle importJt       (const std::string& filepath);
ShapeHandle importParasolid(const std::string& filepath);

// Returns true on success. Throws on write failure.
bool exportStep(ShapeHandle, const std::string& filepath);
bool exportBrep(ShapeHandle, const std::string& filepath);
bool exportStl (ShapeHandle, const std::string& filepath,
                double linearTol = 0.1, double angularTol = 0.5,
                bool ascii = false);

// Forge-34 — STEP AP242 PMI overload.
//   Same STEP writer as exportStep() but, after the AP242 file is
//   written, an `/* PMI_FCF: … */` ISO-10303-21 comment block is
//   appended carrying the GD&T feature-control-frame text. AP242
//   readers tolerate trailing comment blocks, so this is a stub
//   suitable for round-tripping the PMI text until full
//   representation_item / dimensional_size entity emission lands.
struct PmiNote {
    std::string text;        // e.g. "⊥|0.05|A" or "⌖|0.10MA|B|C"
    std::string anchorKind;  // "face" | "edge" | "vertex" | "" (none)
    std::uint32_t anchorId;  // topo id; 0 if unanchored
};
bool exportStepWithPmi(ShapeHandle, const std::string& filepath,
                       const std::vector<PmiNote>& notes);

} // namespace forge::io
