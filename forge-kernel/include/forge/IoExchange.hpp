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

namespace forge::io {

// Returns a new ShapeHandle (refcount=1) on success.
// Throws std::runtime_error on parse / disk failures.
ShapeHandle importStep(const std::string& filepath);
ShapeHandle importBrep(const std::string& filepath);
ShapeHandle importStl (const std::string& filepath); // returns a shell, not a solid

// Returns true on success. Throws on write failure.
bool exportStep(ShapeHandle, const std::string& filepath);
bool exportBrep(ShapeHandle, const std::string& filepath);
bool exportStl (ShapeHandle, const std::string& filepath,
                double linearTol = 0.1, double angularTol = 0.5,
                bool ascii = false);

} // namespace forge::io
