#pragma once

// Voxel IoU — the metric BenchCAD Vision2Code scores.
//
// WHY IT IS A KERNEL FUNCTION
//
// Our gate measures volume, genus, bore count and envelope. BenchCAD does not:
// it voxelises the candidate and the reference into a common grid and reports
// intersection-over-union. A part can match volume to 0.1% and sit in the wrong
// place, or have the right envelope and the wrong interior; volume and IoU
// disagree precisely on the errors that matter. Law 12 says measure the thing
// you are judged on, so the kernel measures it.
//
// The grid is shared between both solids and derived from the UNION of their
// bounding boxes, so a candidate that is offset from the reference is penalised
// rather than silently re-centred. Occupancy is decided by point-in-solid
// classification at each cell centre.

#include <string>

#include "forge/ShapeRegistry.hpp"

namespace forge {

// How the two solids are placed before voxelisation.
//
// This MATTERS and cannot be assumed. Published voxel-IoU CAD benchmarks differ:
// some score raw placement, others centre (and sometimes scale) both solids
// first. On a 41-task BenchCAD baseline, centring alone moved mean IoU from
// 0.372 to 0.439 — a 0.067 swing that is pure convention, not capability. A
// number reported under the wrong convention is not comparable to a published
// one, so the convention is an explicit input, never a default we forgot we made.
enum class IoUAlign {
    Raw,            // world placement as-is; an offset part is penalised
    Centred,        // translate both bbox centres to the origin
    CentredScaled,  // centre, then scale each to a unit bbox diagonal
};

struct VoxelIoUResult {
    long gridN        = 0;     // cells per axis (the grid is gridN^3)
    long inA          = 0;     // cells inside the candidate
    long inB          = 0;     // cells inside the reference
    long intersection = 0;
    long unionCount   = 0;
    double iou        = 0.0;   // intersection / union, 0 when both are empty
    double cellVolume = 0.0;   // mm^3, for reading the counts back as volumes
    // Why a measurement failed, when it did. An empty reason with a false return
    // is a bug: a swallowed catch(...) once made four cleanly-importable STEPs
    // simply "fail" with nothing to diagnose.
    std::string failure;
};

// Voxelise `candidate` and `reference` on a shared grid covering the union of
// their bounding boxes (padded by one cell) and return the IoU.
// `gridN` is cells per axis; 64 is the usual benchmark resolution.
// Returns false when either solid cannot be classified.
bool voxelIoU(ShapeHandle candidate, ShapeHandle reference, VoxelIoUResult& out,
              int gridN = 64, IoUAlign align = IoUAlign::Raw);

} // namespace forge
