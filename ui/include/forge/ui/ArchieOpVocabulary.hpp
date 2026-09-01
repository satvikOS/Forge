// ui/include/forge/ui/ArchieOpVocabulary.hpp -- GENERATED FILE. DO NOT EDIT.
//
// Written by implementation/sacrosanct/tools/gen_op_constraint_table.py
// from implementation/sacrosanct/archie_op_vocabulary.json
// sha256(vocabulary) = 145fe0be61dde771a1a1bb0df146b10cbab9b14b64f79ea458ba06a03105e9ce
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
inline constexpr std::string_view kVocabularySha256 = "145fe0be61dde771a1a1bb0df146b10cbab9b14b64f79ea458ba06a03105e9ce";
inline constexpr std::string_view kVocabularySchema = "forge.archie.op_vocabulary/1";

// The counts the vocabulary computes about itself.  A gate that re-derives
// these from the LIVE registry is the check that the file is not merely
// self-consistent.
inline constexpr std::size_t kKernelOpsCount = 55;
inline constexpr std::size_t kRegistryCommandsCount = 72;
inline constexpr std::size_t kCommandsEmittingIrCount = 49;
inline constexpr std::size_t kUserInvocableOpsCount = 46;
inline constexpr std::size_t kForbiddenOpsCount = 9;

// ---------------------------------------------------------------- side tables
// Sliced by the (first, count) pairs in the rows below.
inline constexpr std::array<std::string_view, 30> kConsumedValueKinds = {{
    "SOLID",
    "SURFACE",
    "SOLID",
    "SOLID",
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
    "PROFILE",
    "SOLID",
    "SOLID",
    "SURFACE",
    "SOLID",
    "WIRE",
    "SURFACE",
    "SOLID",
    "SURFACE",
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
inline constexpr std::array<ArgCountRange, 78> kEmittedArgCounts = {{
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
    ArgCountRange{9, 9},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{2, 2},
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
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{1, 1},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{7, 7},
    ArgCountRange{5, 5},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{2, 2},
    ArgCountRange{1, kUnboundedArgs},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{1, 1},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{4, 4},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{1, 1},
}};

inline constexpr std::array<std::string_view, 49> kOpCommandIds = {{
    "part.variable_fillet",
    "part.primitive_box",
    "part.cap",
    "part.counterbore",
    "part.chamfer",
    "part.sketch_circle",
    "part.boolean_intersect",
    "part.primitive_cone",
    "part.boolean_subtract",
    "part.primitive_cylinder",
    "part.defeature",
    "part.extrude",
    "part.extract_faces",
    "part.fillet",
    "part.fold_flange",
    "part.boolean_union",
    "part.heal",
    "part.hole",
    "part.input_solid",
    "part.loft",
    "part.mirror",
    "part.pattern_circular",
    "part.pattern_grid",
    "part.pattern_linear",
    "part.sketch_poly",
    "part.primitive_prism",
    "part.push_face",
    "part.sketch_rect",
    "part.sketch_polygon",
    "part.resize_bore",
    "part.revolve",
    "part.section_ring",
    "part.rotate",
    "part.sketch_rounded_rect",
    "part.section_curve",
    "part.sew",
    "part.shell",
    "part.skin",
    "part.primitive_sphere",
    "part.surfcheck",
    "part.sweep_pipe",
    "part.sweep_profile",
    "part.tag_feature",
    "part.thicken",
    "part.primitive_torus",
    "part.move",
    "part.primitive_tube",
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
inline constexpr std::array<OpRow, 46> kAllowedOps = {{
    OpRow{"BLEND", "SOLID", 0, 1, 3, 5, true, 0, 2, 0, 1},
    OpRow{"BOX", "SOLID", 1, 0, 3, 6, false, 2, 2, 1, 1},
    OpRow{"CAP", "SOLID", 1, 1, 1, 2, true, 4, 2, 2, 1},
    OpRow{"CBORE", "SOLID", 2, 1, 7, 10, true, 6, 1, 3, 1},
    OpRow{"CHAMFER", "SOLID", 3, 1, 2, 3, true, 7, 1, 4, 1},
    OpRow{"CIRCLE", "PROFILE", 4, 0, 1, 3, false, 8, 2, 5, 1},
    OpRow{"COMMON", "SOLID", 4, 1, 2, 2, true, 10, 1, 6, 1},
    OpRow{"CONE", "SOLID", 5, 0, 3, 9, false, 11, 2, 7, 1},
    OpRow{"CUT", "SOLID", 5, 1, 2, 2, true, 13, 1, 8, 1},
    OpRow{"CYL", "SOLID", 6, 0, 2, 8, false, 14, 2, 9, 1},
    OpRow{"DEFEATURE", "SOLID", 6, 1, 2, 2, true, 16, 1, 10, 1},
    OpRow{"EXTRUDE", "SOLID", 7, 1, 2, 5, true, 17, 2, 11, 1},
    OpRow{"FACES", "SURFACE", 8, 1, 2, 2, true, 19, 1, 12, 1},
    OpRow{"FILLET", "SOLID", 9, 1, 2, 3, true, 20, 1, 13, 1},
    OpRow{"FOLD", "SOLID", 10, 1, 8, 9, true, 21, 2, 14, 1},
    OpRow{"FUSE", "SOLID", 11, 1, 2, 2, true, 23, 1, 15, 1},
    OpRow{"HEAL", "SOLID", 12, 1, 1, 1, true, 24, 1, 16, 1},
    OpRow{"HOLE", "SOLID", 13, 1, 5, 9, true, 25, 2, 17, 1},
    OpRow{"INPUT", "SOLID", 14, 0, 0, 0, false, 27, 1, 18, 1},
    OpRow{"LOFT", "SOLID", 14, 1, 2, kUnboundedArgs, true, 28, 4, 19, 1},
    OpRow{"MIRROR", "SOLID", 15, 1, 2, 7, true, 32, 1, 20, 1},
    OpRow{"PATTERN", "SOLID", 16, 1, 4, 10, true, 33, 4, 21, 3},
    OpRow{"POLY", "PROFILE", 17, 0, 1, 1, false, 37, 1, 24, 1},
    OpRow{"PRISM", "SOLID", 17, 0, 3, 6, false, 38, 2, 25, 1},
    OpRow{"PUSHFACE", "SOLID", 17, 1, 3, 3, true, 40, 1, 26, 1},
    OpRow{"RECT", "PROFILE", 18, 0, 2, 4, false, 41, 2, 27, 1},
    OpRow{"REGPOLY", "PROFILE", 18, 0, 2, 5, false, 43, 2, 28, 1},
    OpRow{"RESIZEBORE", "SOLID", 18, 1, 3, 3, true, 45, 1, 29, 1},
    OpRow{"REVOLVE", "SOLID", 19, 1, 2, 8, true, 46, 2, 30, 1},
    OpRow{"RING", "WIRE", 20, 0, 3, 7, false, 48, 2, 31, 1},
    OpRow{"ROTATE", "SOLID", 20, 1, 5, 8, true, 50, 2, 32, 1},
    OpRow{"RRECT", "PROFILE", 21, 0, 3, 5, false, 52, 2, 33, 1},
    OpRow{"SECTION", "WIRE", 21, 1, 2, 2, true, 54, 1, 34, 1},
    OpRow{"SEW", "SURFACE", 22, 1, 1, kUnboundedArgs, true, 55, 2, 35, 1},
    OpRow{"SHELL", "SOLID", 23, 1, 2, 5, true, 57, 2, 36, 1},
    OpRow{"SKIN", "SURFACE", 24, 1, 2, kUnboundedArgs, true, 59, 2, 37, 1},
    OpRow{"SPHERE", "SOLID", 25, 0, 1, 4, false, 61, 2, 38, 1},
    OpRow{"SURFCHECK", "SURFACE", 25, 1, 2, kUnboundedArgs, true, 63, 2, 39, 1},
    OpRow{"SWEEP", "SOLID", 26, 0, 2, 2, false, 65, 2, 40, 2},
    OpRow{"TAG", "SOLID", 26, 1, 3, 3, true, 67, 1, 42, 1},
    OpRow{"THICKEN", "SOLID", 27, 1, 2, 3, true, 68, 2, 43, 1},
    OpRow{"TORUS", "SOLID", 28, 0, 2, 8, false, 70, 2, 44, 1},
    OpRow{"TRANSLATE", "SOLID", 28, 1, 4, 4, true, 72, 1, 45, 1},
    OpRow{"TUBE", "SOLID", 29, 0, 3, 6, false, 73, 2, 46, 1},
    OpRow{"VERIFY", "SOLID", 29, 1, 2, kUnboundedArgs, true, 75, 2, 47, 1},
    OpRow{"WIRE", "WIRE", 30, 0, 1, 1, false, 77, 1, 48, 1},
}};

// ------------------------------------------------------------- forbidden ops
// A REAL kernel op that no forge::ui command emits.  The reason is carried so a
// refusal can say WHY rather than "not allowed".
struct ForbiddenRow {
  std::string_view op;
  std::string_view reason;
};
inline constexpr std::array<ForbiddenRow, 9> kForbiddenOps = {{
    ForbiddenRow{"ARC",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"CON",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SARC",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SCIRC",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SKETCH",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SLINE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SLOT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SOLVE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SPT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
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
inline constexpr std::array<CommandRow, 49> kEmittingCommands = {{
    CommandRow{"part.boolean_intersect", "COMMON", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_subtract", "CUT", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_union", "FUSE", "Body", 2, 2, "Solid"},
    CommandRow{"part.cap", "CAP", "Surface", 1, 1, "Solid"},
    CommandRow{"part.chamfer", "CHAMFER", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.counterbore", "CBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.defeature", "DEFEATURE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.extract_faces", "FACES", "Face", 1, kUnboundedArgs, "Surface"},
    CommandRow{"part.extrude", "EXTRUDE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.fillet", "FILLET", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.fold_flange", "FOLD", "Body", 1, 1, "Solid"},
    CommandRow{"part.heal", "HEAL", "Body", 1, 1, "Solid"},
    CommandRow{"part.hole", "HOLE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.input_solid", "INPUT", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.loft", "LOFT", "Wire", 2, kUnboundedArgs, "Solid"},
    CommandRow{"part.mirror", "MIRROR", "Body", 1, 1, "Solid"},
    CommandRow{"part.move", "TRANSLATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_circular", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_grid", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_linear", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.primitive_box", "BOX", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_cone", "CONE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_cylinder", "CYL", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_prism", "PRISM", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_sphere", "SPHERE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_torus", "TORUS", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.primitive_tube", "TUBE", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.push_face", "PUSHFACE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.resize_bore", "RESIZEBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.revolve", "REVOLVE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.rotate", "ROTATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.section_curve", "SECTION", "Body", 2, 2, "Wire"},
    CommandRow{"part.section_ring", "RING", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.section_wire", "WIRE", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.sew", "SEW", "Surface", 1, kUnboundedArgs, "Surface"},
    CommandRow{"part.shell", "SHELL", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.sketch_circle", "CIRCLE", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_poly", "POLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_polygon", "REGPOLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rect", "RECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rounded_rect", "RRECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.skin", "SKIN", "Wire", 2, kUnboundedArgs, "Surface"},
    CommandRow{"part.surfcheck", "SURFCHECK", "Surface", 1, 1, "Surface"},
    CommandRow{"part.sweep_pipe", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.sweep_profile", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.tag_feature", "TAG", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.thicken", "THICKEN", "Surface", 1, 1, "Solid"},
    CommandRow{"part.variable_fillet", "BLEND", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.verify", "VERIFY", "Body", 1, 1, "Solid"},
}};

}  // namespace forge::ui::vocab

#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP
