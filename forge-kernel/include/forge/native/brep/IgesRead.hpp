// forge/native/brep/IgesRead.hpp
//
// K6-core (SIBLING of StepRead.hpp) — FOREIGN IGES READ. Parse an ARBITRARY
// external IGES 5.3 (ASCII, fixed 80-column) file into the Forge NATIVE B-rep
// (the K1 trimmed-NURBS faces + the K1.4 native sew), so the kernel can INGEST
// real-world IGES parts WITHOUT OCCT (today `forge::io::importIges` is OCCT
// `IGESControl_Reader` only — docs/SCOPE_2026-06-24/kernel/data-exchange.md §2.3
// "no native IGES reader", and §3 Phase C5).
//
// IGES FILE STRUCTURE (the fixed-80-col, 5-section ASCII grammar this reader
// consumes — NOT the binary or compressed variants):
//
//   Each line is exactly 80 columns; columns 73-80 are the SECTION LETTER
//   (S/G/D/P/T) + the sequence number; columns 1-72 carry the payload.
//
//   * START   (S) : free-text human-readable prologue (ignored).
//   * GLOBAL  (G) : the file's parameters as a delimiter-separated stream:
//                   field 1 = parameter delimiter (default ','), field 2 = record
//                   delimiter (default ';'), ... field 14 = MODEL SPACE SCALE,
//                   field 15 = UNIT FLAG (1=inch, 2=mm ...), field 16 = UNIT NAME.
//                   The reader resolves the length scale TO MILLIMETRES from
//                   fields 14/15/16 and applies it to every coordinate.
//   * DIRECTORY ENTRY (D) : two 80-col lines per entity (20 eight-col fields):
//                   field 1 = ENTITY TYPE NUMBER, field 2 = pointer to the first
//                   PARAMETER DATA line (the DE<->PD pairing), field 9 = a status
//                   number, field 10 (line 2) = the entity's DE sequence number,
//                   field 14 (line 2) = form number. A "DE pointer" elsewhere is
//                   the ODD DE sequence number of the target entity.
//   * PARAMETER DATA (P) : the entity's parameters as a delimiter-separated stream
//                   (cols 1-64 payload); col 66-72 back-references the owning DE.
//   * TERMINATE (T) : one line with the section line counts.
//
// ENTITIES HANDLED (the core geometry+topology zoo a real exporter emits — the
// sibling subset of StepRead's STEP entities):
//   GEOMETRY
//     116 POINT, 110 LINE, 100 CIRCULAR ARC, 104 CONIC ARC,
//     126 RATIONAL B-SPLINE CURVE, 128 RATIONAL B-SPLINE SURFACE,
//     108 PLANE (unbounded analytic plane),
//     120 SURFACE OF REVOLUTION, 122 TABULATED CYLINDER.
//   TRIMMED SURFACE (the analytic-trim path)
//     142 CURVE ON A PARAMETRIC SURFACE, 144 TRIMMED (PARAMETRIC) SURFACE
//         -> a native TrimmedFace (the 144 outer boundary + every inner boundary
//            142 -> trim loops on the 128/108/... base surface). NURBS trims are
//            INVERTED onto the surface (u,v) exactly like StepRead (Plane analytic
//            / NURBS Gauss-Newton), no synthesis.
//   B-REP (the manifold-solid path)
//     186 MANIFOLD SOLID B-REP OBJECT, 514 SHELL, 510 FACE, 508 LOOP,
//     504 EDGE (vertex list), 502 VERTEX LIST -> sewn (Sew.hpp) into a native
//         shell / solid; the face surfaces (128/108) + the bounding 504 edges
//         (whose underlying 3D curves are 110/100/126) reconstruct each face.
//
// HONEST REPORTING: an entity type the reader does not reconstruct is NOT silently
// dropped — it is recorded in `unsupported` (keyed by "IGES_<type>") with a count,
// so a caller knows the body is incomplete (the data-exchange §1 "report
// unsupported entities honestly, don't silently drop" rule).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL reader, pure C++20 + stdlib only — NO external dependencies, NO OCCT, NO
// WASM. ADDITIVE: a brand-new header + TU. It REUSES (no re-derivation):
//   * Topology.hpp     — Vertex/Edge/Coedge/Loop/Face/Shell/Solid + the builder,
//   * Surface.hpp      — the analytic plane (so a foreign planar trimmed face is a
//                        native analytic face with EXACT mass props),
//   * Nurbs.hpp / NurbsSurface.hpp / TrimmedFace.hpp — the trimmed-NURBS face,
//   * Curve.hpp        — PCurve (Line2/BSpline2) for the trim pcurves,
//   * Sew.hpp          — the native sew/diagnose to weld the independent faces.
// It does NOT edit binding.cpp / CMakeLists / the native gate.
//
// CONVENTIONS: namespace forge::native::brep. The reader never fabricates
// geometry; any malformed / dangling / arity-wrong record is an honest `ok=false`
// with a `reason`. An entity whose type is unsupported is recorded (not faked, not
// dropped) and the read still succeeds for the rest. To keep the public result
// type IDENTICAL to the STEP reader (so an A/B harness probes both the same way),
// the same ForeignReadResult / ForeignFaceInfo from StepRead.hpp are reused.

#ifndef FORGE_NATIVE_BREP_IGESREAD_HPP
#define FORGE_NATIVE_BREP_IGESREAD_HPP

#include <string>

#include "forge/native/brep/StepRead.hpp"   // ForeignReadResult / ForeignFaceInfo (shared)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// readForeignIges — parse an ASCII (fixed-80-col) IGES `text` into a native
// B-rep, returning the SAME ForeignReadResult the STEP reader produces (so the
// A/B harness compares both identically). `sewTol` is the model-space distance (in
// the FILE's units, before scaling) under which two independent face-boundary
// vertices are welded by the native sew; <= 0 picks an automatic tolerance from
// the model bounding box.
//
// The reader supports two top-level body kinds, in priority order:
//   * a 186 MANIFOLD SOLID B-REP OBJECT  -> 514 shell(s) -> 510 faces, sewn solid;
//   * otherwise every 144 TRIMMED (PARAMETRIC) SURFACE in the file becomes an
//     independent native trimmed face, then sewn (so a sheet body of trimmed
//     faces still closes if its boundaries coincide).
// If neither is present it falls back to the bare analytic surfaces (128/108)
// found, reporting honestly. Units are read from the GLOBAL section.
// ---------------------------------------------------------------------------
ForeignReadResult readForeignIges(const std::string& text, double sewTol = -1.0);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_IGESREAD_HPP
