#pragma once

// ============================================================================
// forge::ft — declarative C++ FEATURE-TREE IR + native compiler.
//
// This is THE emission target the Archie VLM is trained to produce, and the
// compiler that walks it into native forge-kernel calls to build true 3D CAD
// (STEP). It REPLACES the scrapped scope-plan-JSON / build123d path.
//
//   Archie (VLM)  ->  a compact, typed, line-oriented C++ feature-tree IR
//                     (an ordered op list, 1:1-close to the ground-truth part)
//                ->  forge::ft::parse()   (text  -> FeatureTree)
//                ->  forge::ft::compile() (walks it -> native kernel ops)
//                ->  a real watertight TopoDS solid  ->  STEP.
//
// EVERYTHING is C++ and native: the compiler calls forge::makeBox / makeCylinder,
// forge::part::extrudeProfile / revolveProfile / loft / shell / filletEdges,
// forge::fuse / cut / common, forge::translate / rotate, the sketcher, and
// forge::io::exportStep. NO OCCT/build123d/CadQuery runtime dependency — the
// v18 nk.py builders (from cadgen import nk) were read purely as the reference
// for the SEMANTIC OP VOCABULARY this IR must cover.
//
// ------------------------------------- IR VALUE MODEL -----------------------
// Every op produces exactly one value, addressed by its 1-based creation id
// (like the v18 builders' `body = nk.op(body, ...)` chain). A value is either a
//   * PROFILE — a 2D sketch/face on the Z=0 plane (a SketchHandle), consumed by
//               EXTRUDE / REVOLVE, or
//   * SOLID   — a 3D body (a ShapeHandle), consumed by booleans / transforms /
//               features and exported.
// Ops reference prior ids by "%N". Creation order == evaluation order.
//
// ------------------------------------- GRAMMAR (one op per line) ------------
//   %<id> = OP(arg, arg, ...)
//   # ... comment           (blank lines and '#' lines are ignored)
//   RESULT(%<id>)           (optional; else the last SOLID produced is the result)
//
// Args are comma-separated and positional. Trailing args have defaults (a
// Z-axis cylinder at the origin is simply `CYL(r, h)`). Token forms:
//   * number   3.5   -2   139.2
//   * ref      %7                    (a prior op id)
//   * keyword  ALL VERTICAL RIM ...  (bare identifier, for selectors)
//   * points   [x y; x y; ...]       (POLY only — the outline ring)
//
// The full op set + per-op arg lists + defaults are documented in
// docs/feature_tree_ir.md and enumerated in the OpCode table below.
// ============================================================================

#include <cstdint>
#include <string>
#include <vector>

namespace forge {
namespace ft {

using Handle = std::uint32_t;   // mirrors forge::ShapeHandle / SketchHandle

struct Point2 { double x = 0.0; double y = 0.0; };

// --------------------------------------------------------------------- op set
enum class OpCode {
    // --- 2D profiles (produce a PROFILE) ---
    Rect,        // RECT(w, h [, cx=0, cy=0])
    RRect,       // RRECT(w, h, r [, cx=0, cy=0])              rounded rectangle / stadium
    Circle,      // CIRCLE(r [, cx=0, cy=0])
    Slot,        // SLOT(len, wid [, cx=0, cy=0, angleDeg=0])  obround
    Poly,        // POLY([x y; x y; ...])                       organic closed silhouette
    RegPoly,     // REGPOLY(r, n [, cx=0, cy=0, rotDeg=0])      n-gon (vertex radius)

    // --- 3D primitives (produce a SOLID) ---
    Box,         // BOX(dx, dy, dz [, cx=0, cy=0, cz=0])        centred in XY, base at cz
    Cyl,         // CYL(r, h [, cx=0, cy=0, cz=0, axx=0, axy=0, axz=1])  base at centre, along axis
    Cone,        // CONE(r1, r2, h [, cx, cy, cz, axx, axy, axz])
    Sphere,      // SPHERE(r [, cx=0, cy=0, cz=0])
    Torus,       // TORUS(major, minor [, cx, cy, cz, axx, axy, axz])
    Prism,       // PRISM(nSides, circumR, h [, cx, cy, cz])
    Tube,        // TUBE(rOuter, rInner, h [, cx, cy, cz])

    // --- sketch -> solid ---
    Extrude,     // EXTRUDE(%profile, amount [, dirx=0, diry=0, dirz=1])
    Revolve,     // REVOLVE(%profile, angleDeg [, ox=0, oy=0, oz=0, axx=0, axy=1, axz=0])
    Loft,        // LOFT(%p0, %p1 [, %p2 ...])                   ruled=false, closed=false

    // --- booleans ---
    Fuse,        // FUSE(%a, %b)
    Cut,         // CUT(%a, %b)
    Common,      // COMMON(%a, %b)

    // --- transforms ---
    Translate,   // TRANSLATE(%a, dx, dy, dz)
    Rotate,      // ROTATE(%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0])

    // --- features ---
    Hole,        // HOLE(%body, dia, cx, cy, cz [, axx=0, axy=0, axz=1, depth<=0 => through])
    Cbore,       // CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axx, axy, axz])
    Fillet,      // FILLET(%body, radius [, sel=ALL])           sel: ALL|VERTICAL|RIM|CONVEX
    Chamfer,     // CHAMFER(%body, dist [, sel=ALL])
    Shell,       // SHELL(%body, wall [, openAxx=0, openAxy=0, openAxz=-1])   hollow (inward)
    Heal,        // HEAL(%body)
};

// --------------------------------------------------------------------- tokens
enum class TokKind { Number, Ref, Keyword };

struct Token {
    TokKind     kind = TokKind::Number;
    double      num  = 0.0;   // kind == Number
    int         ref  = 0;     // kind == Ref  (a prior op id)
    std::string kw;           // kind == Keyword
};

// --------------------------------------------------------------------- one op
struct Op {
    int                 id   = 0;      // 1-based creation id
    OpCode              code = OpCode::Box;
    std::string         name;          // raw op token, for diagnostics
    std::vector<Token>  args;
    std::vector<Point2> poly;          // POLY only
    int                 srcLine = 0;   // 1-based source line, for diagnostics
};

struct FeatureTree {
    std::vector<Op> ops;
    int             resultId = -1;     // explicit RESULT(%id), or -1 => last solid
};

// ------------------------------------------------------------------ parse API
// text -> FeatureTree. Throws std::runtime_error("ft parse line N: ...") on any
// syntax error (unknown op, bad token, malformed point list, ...).
FeatureTree parse(const std::string& text);

// --------------------------------------------------------------- compile API
struct CompileResult {
    bool        ok         = false;
    std::string error;               // empty when ok
    int         failedOpId = -1;     // the op id that failed, or -1

    Handle      handle     = 0;      // the final SOLID's ShapeHandle (0 if none)

    // measured geometry of the result solid (populated when ok)
    bool        valid      = false;  // watertight/manifold/oriented, no self-intersect
    long        faceCount  = -1;
    long        edgeCount  = -1;
    double      volume     = 0.0;
    double      bboxMin[3] = {0, 0, 0};
    double      bboxMax[3] = {0, 0, 0};
    bool        exported   = false;  // STEP written (only if a path was given)
};

// Walk a FeatureTree into native forge-kernel calls, building the solid.
// Never throws for a modelling failure — the failing op id + reason land in the
// returned CompileResult (ok=false). Fails LOUDLY (does not silently degrade).
CompileResult compile(const FeatureTree& ft);

// Convenience: parse + compile, and (if exportStepPath is non-empty) write the
// result solid to STEP via forge::io::exportStep. A parse error is reported the
// same way as a compile error (ok=false, error set).
CompileResult compileText(const std::string& text, const std::string& exportStepPath);

}  // namespace ft
}  // namespace forge
