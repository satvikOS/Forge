#pragma once

// Topology signature of a solid — genus, shell count, Euler characteristic.
//
// WHY THIS IS A KERNEL FUNCTION AND NOT A SCRIPT
//
// Topology is 0.2 of the CADGenBench metric and the difference between a part
// that has the right holes and one that merely has the right volume. A tree can
// match volume to 0.1% and still be wrong — v18/205 measured 0.7% volume error
// with genus 24 collapsed to 1. So genus has to be assertable INSIDE the IR
// (`VERIFY(%b, "genus=24")`) and measurable by every tool, from one definition.
//
// The signature is computed on the tessellation, not the B-rep: quantise and weld
// vertices, union-find the shells, chi = V - E + F over the welded mesh, genus by
// the single-shell formula. That is deliberately deflection-invariant — a
// topology number that moves when you change tessellation settings cannot gate
// anything.

#include "forge/ShapeRegistry.hpp"

namespace forge {

struct TopoSignature {
    long vertexCount = 0;   // welded, not raw
    long edgeCount   = 0;   // unique welded edges
    long faceCount   = 0;   // triangles
    long eulerChar   = 0;   // V - E + F
    long genus       = 0;   // max(0, round((2 - chi) / 2))
    long shellCount  = 0;   // connected components of the welded mesh
};

// Tessellate `body` and compute its weld-betti topology signature.
// Returns false when the body cannot be meshed (degenerate / empty).
bool topologySignature(ShapeHandle body, TopoSignature& out,
                       double linearDeflection = 0.3, double angularDeflection = 0.6);

} // namespace forge
