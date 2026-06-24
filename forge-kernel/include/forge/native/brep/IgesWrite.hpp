// forge/native/brep/IgesWrite.hpp
//
// K6-core (round-trip SIBLING of IgesRead.hpp) — NATIVE IGES WRITE. Serialise a
// Forge NATIVE B-rep brep::Solid to an ASCII (fixed 80-column) IGES 5.3 file
// WITHOUT OCCT, so the kernel can EXPORT a part to the most widely-ingested neutral
// CAD format (today `forge::io::exportIges` is OCCT `IGESControl_Writer` only —
// docs/SCOPE_2026-06-24/kernel/data-exchange.md §2.3 "no native IGES writer").
//
// It is the exact inverse of IgesRead.hpp: it emits the SAME core entity zoo the
// reader consumes, through the MANIFOLD-SOLID-BREP path (so a round-trip
// writeIges -> readForeignIges reconstructs the same faces / topology / volume):
//
//   GEOMETRY (the face base surfaces + the bounding 3D edge curves)
//     108 PLANE                       <- a SurfaceKind::Plane face
//     128 RATIONAL B-SPLINE SURFACE   <- a SurfaceKind::Nurbs face (the trimmed-
//                                        NURBS surface, full control/knot/weight)
//     110 LINE                        <- each topological Edge (straight chord)
//   TOPOLOGY (the manifold-solid B-rep path the reader prefers)
//     502 VERTEX LIST                 <- the welded vertices
//     504 EDGE LIST                   <- the edges (curve + svPtr/svIdx/tvPtr/tvIdx)
//     508 LOOP                        <- one per face boundary loop (outer + holes)
//     510 FACE                        <- surface ptr + N loops (first = outer)
//     514 SHELL                       <- the face list (face ptr + orientation)
//     186 MANIFOLD SOLID B-REP OBJECT <- the shell -> a closed solid the reader sews
//   GLOBAL
//     unit flag 2 = MILLIMETRE, model-space scale 1.0 (the native model is mm).
//
// HONEST SCOPE (Bible §0/§9): the writer covers the surfaces the IGES READER can
// read back as a 510 FACE base surface — PLANE (108) and NURBS (128). The 4
// analytic QUADRICS (cylinder/cone/sphere/torus) have NO 510-face base surface in
// the reader's supported set, so a face whose surface is a quadric is reported as
// ok=false (the caller knows the body is incomplete) — NOT faked, NOT silently
// dropped, NOT down-converted to a tessellated mesh. (Exporting quadrics would
// require a 128-NURBS conversion of the quadric, which is a later increment; the
// STEP analytic writer is the analytic-quadric export path.)
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL writer, pure C++20 + stdlib only — NO external dependencies, NO OCCT, NO
// WASM. ADDITIVE: a brand-new header + TU. It REUSES (no re-derivation):
//   * Topology.hpp     — Vertex/Edge/Coedge/Loop/Face/Shell/Solid,
//   * Surface.hpp      — the analytic plane + the NurbsSurface a Nurbs face holds.
// It does NOT edit binding.cpp / CMakeLists / the native gate. The emitted file is
// a valid fixed-80-column IGES 5.3 document (S/G/D/P/T sections, the DE<->PD
// pairing by odd DE sequence number) that IgesRead.hpp re-reads 1:1.
//
// CONVENTIONS: namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_IGESWRITE_HPP
#define FORGE_NATIVE_BREP_IGESWRITE_HPP

#include <string>

#include "forge/native/brep/Topology.hpp"   // Solid / Face / topology

namespace forge {
namespace native {
namespace brep {

// Result of writeIges().
struct IgesWriteResult {
    bool        ok = false;
    std::string text;    // the fixed-80-column IGES 5.3 document on success
    std::string reason;  // empty on success
};

// ---------------------------------------------------------------------------
// writeIges — serialise a closed native B-rep `solid` to an ASCII IGES 5.3 file
// (the MANIFOLD SOLID B-REP path). `name` is echoed in the GLOBAL file-name
// Hollerith field. Returns ok=false (empty text) on a solid with no shells, a
// face with no surface, or a face whose surface is a quadric (NOT in the IGES
// reader's 510-face base-surface set) — never fabricating geometry.
// ---------------------------------------------------------------------------
IgesWriteResult writeIges(const Solid& solid,
                          const std::string& name = "forge_native_solid");

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_IGESWRITE_HPP
