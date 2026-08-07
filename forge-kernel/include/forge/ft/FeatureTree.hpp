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
// (like the v18 builders' `body = nk.op(body, ...)` chain). A value is one of:
//   * PROFILE — a 2D sketch/face on the Z=0 plane (a SketchHandle), consumed by
//               EXTRUDE / REVOLVE, or
//   * WIRE    — a 3D closed section ring placed anywhere in space (a TopoDS_Wire
//               ShapeHandle via forge::part::profileWire), consumed by LOFT. This
//               is what makes a real vertical/organic loft possible — the always
//               Z=0 sketcher cannot express a section at a different height/plane.
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
//   * keyword  ALL VERTICAL RIM ...  (bare identifier, for selectors / modes)
//   * points   [x y; x y; ...]       (POLY / WIRE / SWEEP — a 2D or 3D point ring)
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
struct Point3 { double x = 0.0; double y = 0.0; double z = 0.0; };

// --------------------------------------------------------------------- op set
enum class OpCode {
    // --- 2D profiles (produce a PROFILE) ---
    Rect,        // RECT(w, h [, cx=0, cy=0])
    RRect,       // RRECT(w, h, r [, cx=0, cy=0])              rounded rectangle / stadium
    Circle,      // CIRCLE(r [, cx=0, cy=0])
    Slot,        // SLOT(len, wid [, cx=0, cy=0, angleDeg=0])  obround
    Poly,        // POLY([x y; x y; ...])                       organic closed silhouette
    RegPoly,     // REGPOLY(r, n [, cx=0, cy=0, rotDeg=0])      n-gon (vertex radius)

    // --- 3D section rings (produce a WIRE — a loft cross-section placed in 3D) ---
    Ring,        // RING(rx, ry, z [, cx=0, cy=0, p=2, seg=48]) superellipse ring @ height z
                 //   p=2 circle/ellipse, p=4..6 rounded-rect (impeller/nozzle/duct sections)
    Wire,        // WIRE([x y z; x y z; ...])                    explicit closed 3D ring
                 //   (airfoil / organic / sharp-cornered loft section)

    // --- 3D primitives (produce a SOLID) ---
    Box,         // BOX(dx, dy, dz [, cx=0, cy=0, cz=0])        centred in XY, base at cz
    Cyl,         // CYL(r, h [, cx=0, cy=0, cz=0, axx=0, axy=0, axz=1])  base at centre, along axis
    Cone,        // CONE(r1, r2, h [, cx, cy, cz, axx, axy, axz])
    Sphere,      // SPHERE(r [, cx=0, cy=0, cz=0])
    Torus,       // TORUS(major, minor [, cx, cy, cz, axx, axy, axz])
    Prism,       // PRISM(nSides, circumR, h [, cx, cy, cz])
    Tube,        // TUBE(rOuter, rInner, h [, cx, cy, cz])

    // --- sketch/wire -> solid ---
    Extrude,     // EXTRUDE(%profile, amount [, dirx=0, diry=0, dirz=1] [, CENTERED])
                 //   CENTERED extrudes SYMMETRICALLY about the profile plane —
                 //   the profile ends up halfway along the extrusion instead of at
                 //   its start. Identical, to full precision, to the two-op form
                 //     %b = EXTRUDE(%a, L)  /  %c = TRANSLATE(%b, 0, 0, -L/2)
                 //   which the CadQuery transpiler emitted because the IR had no way
                 //   to say it (measured: 907 of the 1945 adjacent EXTRUDE->TRANSLATE
                 //   pairs in the training corpus, 633 rows). The point is not brevity:
                 //   the two-op form makes -L/2 a number the EMITTER has to compute
                 //   from a number it just emitted, and that arithmetic is where a
                 //   generative model silently fails. Flags may appear in any trailing
                 //   position; spelled as a flag, not a 6th number, because it is not
                 //   a quantity (same treatment as LOFT's RULED/OPEN).
    Revolve,     // REVOLVE(%profile, angleDeg [, ox=0, oy=0, oz=0, axx=0, axy=1, axz=0])
                 //   partial angle (0<a<=360) about an ARBITRARY axis line — already general
    Loft,        // LOFT(%w0, %w1 [, %w2 ...] [, RULED] [, OPEN])   skin >=2 WIRE sections
                 //   default: BSpline-smoothed, capped solid. RULED=straight rulings; OPEN=shell
    Sweep,       // SWEEP(r, [x y z; ...])            circular pipe of radius r along a 3D path
                 // SWEEP([x y; ...], [x y z; ...])   sweep a 2D profile ring along a 3D path

    // --- booleans ---
    Fuse,        // FUSE(%a, %b)
    Cut,         // CUT(%a, %b)
    Common,      // COMMON(%a, %b)

    // --- transforms / replication ---
    Translate,   // TRANSLATE(%a, dx, dy, dz)
    Align,       // ALIGN(%moved, %reference, SPEC [, offset] [, SPEC [, offset]] ...)
                 //   RELATIONAL placement: translate %moved (rigidly, no scaling, no
                 //   rotation) so that its axis-aligned extent stands in a named
                 //   relation to %reference's on each axis NAMED. An axis not named is
                 //   not moved. Returns the moved body; %reference is untouched.
                 //
                 //   SPEC is one of, for A in {X, Y, Z}:
                 //     MIN_A       flush low  — moved.min.A == ref.min.A      (alias <A)
                 //     MAX_A       flush high — moved.max.A == ref.max.A      (alias >A)
                 //     MID_A       centred    — the two mid-points coincide   (alias |A,
                 //                              CENTER_A, CENTRE_A, CTR_A)
                 //     ABUT_MAX_A  moved.min.A == ref.max.A   (sits just past the high face)
                 //     ABUT_MIN_A  moved.max.A == ref.min.A   (sits just before the low face)
                 //   An optional NUMBER immediately after a SPEC is a signed clearance
                 //   added along that axis after the relation is satisfied, so
                 //   `ALIGN(%b, %a, MAX_X, -2)` is "flush with the +X wall, held back 2 mm".
                 //
                 //   MIN/MAX/MID are the axis-extreme vocabulary the face selectors
                 //   already use ("+Z"/"-X" pick the extreme plane along an axis); the
                 //   CadQuery spellings <A/>A/|A are accepted for the same reason the
                 //   selector grammar accepts them.
                 //
                 //   WHY THIS OP EXISTS. 22.1% of non-zero TRANSLATE/ROTATE arguments in
                 //   the training corpus (42.0% held-out; 0.1% for the same detector on
                 //   random values) are an exact arithmetic function — x/2, (x-y)/2, x-y —
                 //   of numbers appearing EARLIER in the same program. Those three forms
                 //   ARE these three relations: x-y is flush-max, (x-y)/2 is centred, x/2
                 //   is centred on a body based at the origin. Writing the relation lets
                 //   the KERNEL do the arithmetic from measured geometry. Worked case
                 //   l_bracket_000146: GT wrote TRANSLATE(%4, 1.605, 1.605, 68.985) where
                 //   1.605 = (29.95-26.74)/2 makes the cutter flush with two walls and the
                 //   result an L-angle; a model that wrote any other offset produced a
                 //   channel with the SAME volume. ALIGN(%4, %1, MAX_X, MAX_Y) says it.
    Rotate,      // ROTATE(%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0])
    Mirror,      // MIRROR(%a, PLANE)                   PLANE = XY|YZ|XZ (through origin)
                 // MIRROR(%a, px,py,pz, nx,ny,nz)      arbitrary plane; reflect + FUSE (symmetrize)
    Pattern,     // PATTERN(%a, LINEAR, n, dx [, dy=0, dz=0])
                 // PATTERN(%a, POLAR, n, totalAngleDeg [, ox,oy,oz, axx,axy,axz=+Z])  step=angle/n
                 // PATTERN(%a, GRID, nx, ny, dx, dy)   nx*ny fused instances in XY

    // --- features ---
    Hole,        // HOLE(%body, dia, cx, cy, cz [, axx=0, axy=0, axz=1, depth<=0 => through])
    Cbore,       // CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axx, axy, axz])
    Fillet,      // FILLET(%body, radius [, sel=ALL])           sel: ALL|VERTICAL|RIM|CONVEX
    Chamfer,     // CHAMFER(%body, dist [, sel=ALL])
    Blend,       // BLEND(%body, rStart, rEnd [, sel=ALL] [, SMOOTH])  variable-radius fillet
                 //   linear r-law start->end along each selected edge; SMOOTH = S-law (C^1)
    Shell,       // SHELL(%body, wall [, openAxx=0, openAxy=0, openAxz=-1])   hollow (inward)
    Fold,        // FOLD(%body, hx, hy, hz, len, flangeH, thk, angleDeg [, runDeg=0])
                 //   sheet-metal flange macro: BOX + ROTATE(about hinge) + FUSE
    Heal,        // HEAL(%body)

    // --- edit ops (transform an EXISTING solid; SACROSANCT "one structure") ----
    // These make the feature-tree IR the single emission format for BOTH
    // generation and editing. Face SELECTORs are quoted predicate strings
    // resolved against the live faceInventory at compile time (see
    // resolveSelector in FeatureTreeCompiler.cpp).
    Tag,         // TAG(%body, "@name", "declaring-sel")   bind a PERSISTENT name to a feature
                 //   Pass-through like VERIFY: it returns %body unchanged. A naming
                 //   mechanism that can alter the solid is a defect generator.
                 //   Afterwards "@name" is legal anywhere a selector is legal, and
                 //   survives ops that renumber faces — which every edit does.
    Input,       // INPUT()                                bind the task's input STEP as a solid
    PushFace,    // PUSHFACE(%body, "sel", dist)           move planar face along its outward normal
    ResizeBore,  // RESIZEBORE(%body, "sel", newRadius)    set a cylindrical bore's radius exactly
    Defeature,   // DEFEATURE(%body, "sel")                delete the selected faces + heal the wound
    Verify,      // VERIFY(%body, "expr", ...)             assert do-no-harm invariants (loud failure)
};

// --------------------------------------------------------------------- tokens
enum class TokKind { Number, Ref, Keyword, Points, Str };

struct Token {
    TokKind             kind = TokKind::Number;
    double              num  = 0.0;   // kind == Number
    int                 ref  = 0;     // kind == Ref  (a prior op id)
    std::string         str;          // kind == Str — quoted literal, case + punctuation
                                      // preserved (face selectors: "bore:r=47.5")
    std::string         kw;           // kind == Keyword
    std::vector<Point3> pts;          // kind == Points ([x y; ...] 2D → z=0, or [x y z; ...])
    int                 dim  = 0;     // kind == Points: 2 or 3 (coords per source point)
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

    // VERIFY(...) results — one entry per assertion, "PASS <expr>" / "FAIL <expr> (got ...)".
    // A failed assertion is a LOUD failure: ok=false, error names the assertion.
    std::vector<std::string> verify;
};

// Walk a FeatureTree into native forge-kernel calls, building the solid.
// Never throws for a modelling failure — the failing op id + reason land in the
// returned CompileResult (ok=false). Fails LOUDLY (does not silently degrade).
//
// `inputStepPath` backs the edit op `INPUT()`: it is imported (and face-unified)
// to become the body an edit tree modifies. Empty for pure generation trees; an
// IR that uses INPUT() without one fails loudly.
CompileResult compile(const FeatureTree& ft, const std::string& inputStepPath = std::string());

// Convenience: parse + compile, and (if exportStepPath is non-empty) write the
// result solid to STEP via forge::io::exportStep. A parse error is reported the
// same way as a compile error (ok=false, error set).
//
// This is THE one kernel entry for both halves of the Unified IR: construction
// trees build from nothing; trees that open with `%0 = INPUT()` edit the solid
// at `inputStepPath` through the same parser, the same walker, the same measure.
CompileResult compileText(const std::string& text, const std::string& exportStepPath,
                          const std::string& inputStepPath = std::string());

}  // namespace ft
}  // namespace forge
