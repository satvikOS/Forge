// ui/include/forge/ui/ArchieOpVocabulary.hpp -- GENERATED FILE. DO NOT EDIT.
//
// Written by implementation/sacrosanct/tools/gen_op_constraint_table.py
// from implementation/sacrosanct/archie_op_vocabulary.json
// sha256(vocabulary) = ed5d230469d6fa8116ae1334a2c034caec492f1c2a0c91c685e11e9c438d1243
//
// This is the ALLOWED OP SET made compilable: the feature-IR ops a USER of the
// Forge app can reach through the forge::ui command registry, and the reason each
// of the remaining kernel ops is out of reach.  forge::ui::OpConstraintBridge is
// the only intended consumer.  Regenerate with:
//
//     python3 implementation/sacrosanct/tools/gen_op_constraint_table.py --write
//
// `--check` is run by CI and by the CMake build, so an edit to the vocabulary
// that is not accompanied by a regeneration fails rather than drifts.
//
// Everything here is the vocabulary's OWN SPELLING, kept as string_view on
// purpose: mapping "SOLID" onto forge::ui::IrValueKind and "Edge" onto
// forge::ui::EntityKind happens once, in ui/src/OpConstraintBridge.cpp, where
// ui/test/op_constraint_bridge_test.cpp proves the mapping is TOTAL.  A
// generated file that interprets its source cannot be diffed against it.
#ifndef FORGE_UI_ARCHIEOPVOCABULARY_HPP
#define FORGE_UI_ARCHIEOPVOCABULARY_HPP

#include <array>
#include <cstddef>
// <string> is carried deliberately: ui/test/check_includes_ui.sh matches
// `std::string` as a prefix, so std::string_view reads as std::string to it.
#include <string>
#include <string_view>

namespace forge::ui::vocab {

// LOFT(%w0, %w1 [, %w2 ...]) has no upper bound; every other op does.
inline constexpr std::size_t kUnboundedArgs = static_cast<std::size_t>(-1);

inline constexpr std::string_view kVocabularyPath = "implementation/sacrosanct/archie_op_vocabulary.json";
inline constexpr std::string_view kVocabularySha256 = "ed5d230469d6fa8116ae1334a2c034caec492f1c2a0c91c685e11e9c438d1243";
inline constexpr std::string_view kVocabularySchema = "forge.archie.op_vocabulary/1";

// The counts the vocabulary computes about itself.  A gate that re-derives
// these from the LIVE registry is the check that the file is not merely
// self-consistent.
inline constexpr std::size_t kKernelOpsCount = 68;
inline constexpr std::size_t kRegistryCommandsCount = 97;
inline constexpr std::size_t kCommandsEmittingIrCount = 69;
inline constexpr std::size_t kUserInvocableOpsCount = 65;
inline constexpr std::size_t kForbiddenOpsCount = 3;

// ---------------------------------------------------------------- side tables
// Sliced by the (first, count) pairs in the rows below.
inline constexpr std::array<std::string_view, 48> kConsumedValueKinds = {{
    "SOLID",
    "SURFACE",
    "SOLID",
    "SOLID",
    "SOLID",
    "SKETCHREF",
    "SOLID",
    "SOLID",
    "SOLID",
    "PROFILE",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "WIRE",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "PROFILE",
    "SOLID",
    "SOLID",
    "SKETCHREF",
    "SOLID",
    "SKETCHREF",
    "SOLID",
    "SURFACE",
    "SOLID",
    "WIRE",
    "SKETCHREF",
    "SKETCH",
    "SOLID",
    "SKETCH",
    "SURFACE",
    "SURFACE",
    "SURFACE",
    "SOLID",
    "SURFACE",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
}};

// An argument COUNT a user command can actually emit.  Deliberately narrower
// than the kernel arity: the kernel would accept EXTRUDE with 4 arguments and
// no command in the app can produce that form.
struct ArgCountRange {
  std::size_t min = 0;
  std::size_t max = 0;  // kUnboundedArgs when the op is variadic
};
inline constexpr std::array<ArgCountRange, 99> kEmittedArgCounts = {{
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{1, 1},
    ArgCountRange{2, 2},
    ArgCountRange{7, 7},
    ArgCountRange{3, 3},
    ArgCountRange{1, 1},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{9, 9},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{8, 8},
    ArgCountRange{9, 9},
    ArgCountRange{2, 2},
    ArgCountRange{1, 1},
    ArgCountRange{5, 5},
    ArgCountRange{9, 9},
    ArgCountRange{0, 0},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{4, kUnboundedArgs},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{4, 4},
    ArgCountRange{1, 1},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{4, 4},
    ArgCountRange{3, 3},
    ArgCountRange{7, 7},
    ArgCountRange{5, 5},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{1, kUnboundedArgs},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{1, 1},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{2, 2},
    ArgCountRange{1, 1},
    ArgCountRange{1, 1},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{4, 4},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{1, 1},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{1, 1},
}};

inline constexpr std::array<std::string_view, 69> kOpCommandIds = {{
    "part.variable_fillet",
    "part.primitive_box",
    "part.cap",
    "part.counterbore",
    "part.chamfer",
    "part.sketch_circle",
    "part.boolean_intersect",
    "part.sketch_constrain",
    "part.sketch_constrain_single",
    "part.primitive_cone",
    "part.boolean_subtract",
    "part.primitive_cylinder",
    "part.defeature",
    "part.draft",
    "part.extrude",
    "part.extract_faces",
    "part.fillet",
    "part.fold_flange",
    "part.boolean_union",
    "part.heal",
    "part.hole",
    "part.input_solid",
    "part.loft",
    "part.measure",
    "part.mirror",
    "part.offset_solid",
    "part.pattern_circular",
    "part.pattern_grid",
    "part.pattern_linear",
    "part.pocket",
    "part.sketch_poly",
    "part.primitive_prism",
    "part.push_face",
    "part.sketch_rect",
    "part.sketch_polygon",
    "part.replace_face",
    "part.resize_bore",
    "part.revolve",
    "part.rib",
    "part.section_ring",
    "part.rotate",
    "part.sketch_rounded_rect",
    "part.sketch_entity_arc",
    "part.scale_uniform",
    "part.sketch_entity_circle",
    "part.section_curve",
    "part.sew",
    "part.shell",
    "part.sketch_new",
    "part.skin",
    "part.sketch_entity_line",
    "part.sketch_solve",
    "part.primitive_sphere",
    "part.split_body",
    "part.sketch_entity_point",
    "part.surfcheck",
    "part.surf_extend",
    "part.surf_trim",
    "part.sweep_pipe",
    "part.sweep_profile",
    "part.tag_feature",
    "part.thicken",
    "part.thread",
    "part.primitive_torus",
    "part.move",
    "part.primitive_tube",
    "part.unfold",
    "part.verify",
    "part.section_wire",
}};

// ---------------------------------------------------------------- allowed ops
struct OpRow {
  std::string_view op;                 // UPPERCASE feature-IR op name
  std::string_view produces;           // "PROFILE" | "WIRE" | "SOLID"
  std::size_t consumesFirst = 0;       // slice of kConsumedValueKinds
  std::size_t consumesCount = 0;
  std::size_t kernelMinArgs = 0;       // what forge::ft would accept
  std::size_t kernelMaxArgs = 0;
  bool firstArgIsValueRef = false;     // OP(%body, ...) -- false means a CREATOR
  std::size_t formFirst = 0;           // slice of kEmittedArgCounts
  std::size_t formCount = 0;
  std::size_t commandFirst = 0;        // slice of kOpCommandIds
  std::size_t commandCount = 0;
};
inline constexpr std::array<OpRow, 65> kAllowedOps = {{
    OpRow{"BLEND", "SOLID", 0, 1, 3, 5, true, 0, 2, 0, 1},
    OpRow{"BOX", "SOLID", 1, 0, 3, 6, false, 2, 2, 1, 1},
    OpRow{"CAP", "SOLID", 1, 1, 1, 2, true, 4, 2, 2, 1},
    OpRow{"CBORE", "SOLID", 2, 1, 7, 10, true, 6, 1, 3, 1},
    OpRow{"CHAMFER", "SOLID", 3, 1, 2, 3, true, 7, 1, 4, 1},
    OpRow{"CIRCLE", "PROFILE", 4, 0, 1, 3, false, 8, 2, 5, 1},
    OpRow{"COMMON", "SOLID", 4, 1, 2, 2, true, 10, 1, 6, 1},
    OpRow{"CON", "SKETCH", 5, 1, 2, 4, true, 11, 3, 7, 2},
    OpRow{"CONE", "SOLID", 6, 0, 3, 9, false, 14, 2, 9, 1},
    OpRow{"CUT", "SOLID", 6, 1, 2, 2, true, 16, 1, 10, 1},
    OpRow{"CYL", "SOLID", 7, 0, 2, 8, false, 17, 2, 11, 1},
    OpRow{"DEFEATURE", "SOLID", 7, 1, 2, 2, true, 19, 1, 12, 1},
    OpRow{"DRAFT", "SOLID", 8, 1, 3, 5, true, 20, 1, 13, 1},
    OpRow{"EXTRUDE", "SOLID", 9, 1, 2, 5, true, 21, 2, 14, 1},
    OpRow{"FACES", "SURFACE", 10, 1, 2, 2, true, 23, 1, 15, 1},
    OpRow{"FILLET", "SOLID", 11, 1, 2, 3, true, 24, 1, 16, 1},
    OpRow{"FOLD", "SOLID", 12, 1, 8, 9, true, 25, 2, 17, 1},
    OpRow{"FUSE", "SOLID", 13, 1, 2, 2, true, 27, 1, 18, 1},
    OpRow{"HEAL", "SOLID", 14, 1, 1, 1, true, 28, 1, 19, 1},
    OpRow{"HOLE", "SOLID", 15, 1, 5, 9, true, 29, 2, 20, 1},
    OpRow{"INPUT", "SOLID", 16, 0, 0, 0, false, 31, 1, 21, 1},
    OpRow{"LOFT", "SOLID", 16, 1, 2, kUnboundedArgs, true, 32, 4, 22, 1},
    OpRow{"MEASURE", "SOLID", 17, 1, 2, kUnboundedArgs, true, 36, 1, 23, 1},
    OpRow{"MIRROR", "SOLID", 18, 1, 2, 7, true, 37, 1, 24, 1},
    OpRow{"OFFSETSOLID", "SOLID", 19, 1, 2, 3, true, 38, 1, 25, 1},
    OpRow{"PATTERN", "SOLID", 20, 1, 4, 10, true, 39, 4, 26, 3},
    OpRow{"POCKET", "SOLID", 21, 1, 4, 7, true, 43, 1, 29, 1},
    OpRow{"POLY", "PROFILE", 22, 0, 1, 1, false, 44, 1, 30, 1},
    OpRow{"PRISM", "SOLID", 22, 0, 3, 6, false, 45, 2, 31, 1},
    OpRow{"PUSHFACE", "SOLID", 22, 1, 3, 3, true, 47, 1, 32, 1},
    OpRow{"RECT", "PROFILE", 23, 0, 2, 4, false, 48, 2, 33, 1},
    OpRow{"REGPOLY", "PROFILE", 23, 0, 2, 5, false, 50, 2, 34, 1},
    OpRow{"REPLACEFACE", "SOLID", 23, 1, 3, 3, true, 52, 1, 35, 1},
    OpRow{"RESIZEBORE", "SOLID", 24, 1, 3, 3, true, 53, 1, 36, 1},
    OpRow{"REVOLVE", "SOLID", 25, 1, 2, 8, true, 54, 2, 37, 1},
    OpRow{"RIB", "SOLID", 26, 1, 4, 6, true, 56, 1, 38, 1},
    OpRow{"RING", "WIRE", 27, 0, 3, 7, false, 57, 2, 39, 1},
    OpRow{"ROTATE", "SOLID", 27, 1, 5, 8, true, 59, 2, 40, 1},
    OpRow{"RRECT", "PROFILE", 28, 0, 3, 5, false, 61, 2, 41, 1},
    OpRow{"SARC", "SKETCHREF", 28, 1, 3, 3, true, 63, 1, 42, 1},
    OpRow{"SCALEUNIFORM", "SOLID", 29, 1, 2, 5, true, 64, 1, 43, 1},
    OpRow{"SCIRC", "SKETCHREF", 30, 1, 2, 2, true, 65, 1, 44, 1},
    OpRow{"SECTION", "WIRE", 31, 1, 2, 2, true, 66, 1, 45, 1},
    OpRow{"SEW", "SURFACE", 32, 1, 1, kUnboundedArgs, true, 67, 2, 46, 1},
    OpRow{"SHELL", "SOLID", 33, 1, 2, 5, true, 69, 2, 47, 1},
    OpRow{"SKETCH", "SKETCH", 34, 0, 1, 1, false, 71, 1, 48, 1},
    OpRow{"SKIN", "SURFACE", 34, 1, 2, kUnboundedArgs, true, 72, 2, 49, 1},
    OpRow{"SLINE", "SKETCHREF", 35, 1, 2, 2, true, 74, 1, 50, 1},
    OpRow{"SOLVE", "PROFILE", 36, 1, 1, 1, true, 75, 1, 51, 1},
    OpRow{"SPHERE", "SOLID", 37, 0, 1, 4, false, 76, 2, 52, 1},
    OpRow{"SPLITBODY", "SOLID", 37, 1, 2, 3, true, 78, 1, 53, 1},
    OpRow{"SPT", "SKETCHREF", 38, 1, 3, 3, true, 79, 1, 54, 1},
    OpRow{"SURFCHECK", "SURFACE", 39, 1, 2, kUnboundedArgs, true, 80, 2, 55, 1},
    OpRow{"SURFEXTEND", "SURFACE", 40, 1, 2, 4, true, 82, 1, 56, 1},
    OpRow{"SURFTRIM", "SURFACE", 41, 1, 2, 3, true, 83, 1, 57, 1},
    OpRow{"SWEEP", "SOLID", 42, 0, 2, 2, false, 84, 2, 58, 2},
    OpRow{"TAG", "SOLID", 42, 1, 3, 3, true, 86, 1, 60, 1},
    OpRow{"THICKEN", "SOLID", 43, 1, 2, 3, true, 87, 2, 61, 1},
    OpRow{"THREAD", "SOLID", 44, 1, 4, 7, true, 89, 1, 62, 1},
    OpRow{"TORUS", "SOLID", 45, 0, 2, 8, false, 90, 2, 63, 1},
    OpRow{"TRANSLATE", "SOLID", 45, 1, 4, 4, true, 92, 1, 64, 1},
    OpRow{"TUBE", "SOLID", 46, 0, 3, 6, false, 93, 2, 65, 1},
    OpRow{"UNFOLD", "SURFACE", 46, 1, 1, 2, true, 95, 1, 66, 1},
    OpRow{"VERIFY", "SOLID", 47, 1, 2, kUnboundedArgs, true, 96, 2, 67, 1},
    OpRow{"WIRE", "WIRE", 48, 0, 1, 1, false, 98, 1, 68, 1},
}};

// ------------------------------------------------------------- forbidden ops
// A REAL kernel op that no forge::ui command emits.  The reason is carried so a
// refusal can say WHY rather than "not allowed".
struct ForbiddenRow {
  std::string_view op;
  std::string_view reason;
};
inline constexpr std::array<ForbiddenRow, 3> kForbiddenOps = {{
    ForbiddenRow{"ARC",
                 "no command in Forge produces it, so nothing you can do in the application reaches it"},
    ForbiddenRow{"HELIX",
                 "no command in Forge produces it, so nothing you can do in the application reaches it"},
    ForbiddenRow{"SLOT",
                 "no command in Forge produces it, so nothing you can do in the application reaches it"},
}};

// --------------------------------------------------- the commands that emit IR
// Selection spellings are EntityKind's names as the vocabulary writes them.
struct CommandRow {
  std::string_view id;
  std::string_view op;
  std::string_view selectionKind;      // "None" | "Edge" | "Face" | "Body" | ...
  std::size_t selectionMin = 0;
  std::size_t selectionMax = 0;        // kUnboundedArgs when open-ended
  std::string_view producesValueKind;  // "Profile" | "Wire" | "Solid"
};
inline constexpr std::array<CommandRow, 69> kEmittingCommands = {{
    CommandRow{"part.boolean_intersect", "COMMON", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_subtract", "CUT", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_union", "FUSE", "Body", 2, 2, "Solid"},
    CommandRow{"part.cap", "CAP", "Surface", 1, 1, "Solid"},
    CommandRow{"part.chamfer", "CHAMFER", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.counterbore", "CBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.defeature", "DEFEATURE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.draft", "DRAFT", "Body", 1, 1, "Solid"},
    CommandRow{"part.extract_faces", "FACES", "Face", 1, kUnboundedArgs, "Surface"},
    CommandRow{"part.extrude", "EXTRUDE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.fillet", "FILLET", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.fold_flange", "FOLD", "Body", 1, 1, "Solid"},
    CommandRow{"part.heal", "HEAL", "Body", 1, 1, "Solid"},
    CommandRow{"part.hole", "HOLE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.input_solid", "INPUT", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.loft", "LOFT", "Wire", 2, kUnboundedArgs, "Solid"},
    CommandRow{"part.measure", "MEASURE", "Body", 1, 1, "Solid"},
    CommandRow{"part.mirror", "MIRROR", "Body", 1, 1, "Solid"},
    CommandRow{"part.move", "TRANSLATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.offset_solid", "OFFSETSOLID", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_circular", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_grid", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_linear", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pocket", "POCKET", "Body", 2, 2, "Solid"},
    CommandRow{"part.primitive_box", "BOX", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_cone", "CONE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_cylinder", "CYL", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_prism", "PRISM", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_sphere", "SPHERE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_torus", "TORUS", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_tube", "TUBE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.push_face", "PUSHFACE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.replace_face", "REPLACEFACE", "Body", 2, 2, "Solid"},
    CommandRow{"part.resize_bore", "RESIZEBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.revolve", "REVOLVE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.rib", "RIB", "Body", 2, 2, "Solid"},
    CommandRow{"part.rotate", "ROTATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.scale_uniform", "SCALEUNIFORM", "Body", 1, 1, "Solid"},
    CommandRow{"part.section_curve", "SECTION", "Body", 2, 2, "Wire"},
    CommandRow{"part.section_ring", "RING", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.section_wire", "WIRE", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.sew", "SEW", "Surface", 1, kUnboundedArgs, "Surface"},
    CommandRow{"part.shell", "SHELL", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.sketch_circle", "CIRCLE", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_constrain", "CON", "SketchRef", 2, 2, "Sketch"},
    CommandRow{"part.sketch_constrain_single", "CON", "SketchRef", 1, 1, "Sketch"},
    CommandRow{"part.sketch_entity_arc", "SARC", "SketchRef", 3, 3, "SketchRef"},
    CommandRow{"part.sketch_entity_circle", "SCIRC", "SketchRef", 1, 1, "SketchRef"},
    CommandRow{"part.sketch_entity_line", "SLINE", "SketchRef", 2, 2, "SketchRef"},
    CommandRow{"part.sketch_entity_point", "SPT", "OpenSketch", 1, 1, "SketchRef"},
    CommandRow{"part.sketch_new", "SKETCH", "None", 0, kUnboundedArgs, "Sketch"},
    CommandRow{"part.sketch_poly", "POLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_polygon", "REGPOLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rect", "RECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rounded_rect", "RRECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_solve", "SOLVE", "OpenSketch", 1, 1, "Profile"},
    CommandRow{"part.skin", "SKIN", "Wire", 2, kUnboundedArgs, "Surface"},
    CommandRow{"part.split_body", "SPLITBODY", "Body", 2, 2, "Solid"},
    CommandRow{"part.surf_extend", "SURFEXTEND", "Surface", 1, 1, "Surface"},
    CommandRow{"part.surf_trim", "SURFTRIM", "Surface", 2, kUnboundedArgs, "Surface"},
    CommandRow{"part.surfcheck", "SURFCHECK", "Surface", 1, 1, "Surface"},
    CommandRow{"part.sweep_pipe", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.sweep_profile", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.tag_feature", "TAG", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.thicken", "THICKEN", "Surface", 1, 1, "Solid"},
    CommandRow{"part.thread", "THREAD", "Body", 1, 1, "Solid"},
    CommandRow{"part.unfold", "UNFOLD", "Body", 1, 1, "Surface"},
    CommandRow{"part.variable_fillet", "BLEND", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.verify", "VERIFY", "Body", 1, 1, "Solid"},
}};

}  // namespace forge::ui::vocab

#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP
