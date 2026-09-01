// ui/include/forge/ui/ArchieOpVocabulary.hpp -- GENERATED FILE. DO NOT EDIT.
//
// Written by implementation/sacrosanct/tools/gen_op_constraint_table.py
// from implementation/sacrosanct/archie_op_vocabulary.json
// sha256(vocabulary) = d635729032cfaf649f57bb861b2f401d0f5766bafe39d662083fe6cf2df73ec0
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
inline constexpr std::string_view kVocabularySha256 = "d635729032cfaf649f57bb861b2f401d0f5766bafe39d662083fe6cf2df73ec0";
inline constexpr std::string_view kVocabularySchema = "forge.archie.op_vocabulary/1";

// The counts the vocabulary computes about itself.  A gate that re-derives
// these from the LIVE registry is the check that the file is not merely
// self-consistent.
inline constexpr std::size_t kKernelOpsCount = 47;
inline constexpr std::size_t kRegistryCommandsCount = 58;
inline constexpr std::size_t kCommandsEmittingIrCount = 43;
inline constexpr std::size_t kUserInvocableOpsCount = 40;
inline constexpr std::size_t kForbiddenOpsCount = 7;

// ---------------------------------------------------------------- side tables
// Sliced by the (first, count) pairs in the rows below.
inline constexpr std::array<std::string_view, 24> kConsumedValueKinds = {{
    "SOLID",
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
    "WIRE",
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
}};

// An argument COUNT a user command can actually emit.  Deliberately narrower
// than the kernel arity: the kernel would accept EXTRUDE with 4 arguments and
// no command in the app can produce that form.
struct ArgCountRange {
  std::size_t min = 0;
  std::size_t max = 0;  // kUnboundedArgs when the op is variadic
};
inline constexpr std::array<ArgCountRange, 67> kEmittedArgCounts = {{
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
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
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{1, 1},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
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

inline constexpr std::array<std::string_view, 43> kOpCommandIds = {{
    "part.variable_fillet",
    "part.primitive_box",
    "part.counterbore",
    "part.chamfer",
    "part.sketch_circle",
    "part.boolean_intersect",
    "part.primitive_cone",
    "part.boolean_subtract",
    "part.primitive_cylinder",
    "part.defeature",
    "part.extrude",
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
    "part.shell",
    "part.primitive_sphere",
    "part.sweep_pipe",
    "part.sweep_profile",
    "part.tag_feature",
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
inline constexpr std::array<OpRow, 40> kAllowedOps = {{
    OpRow{"BLEND", "SOLID", 0, 1, 3, 5, true, 0, 2, 0, 1},
    OpRow{"BOX", "SOLID", 1, 0, 3, 6, false, 2, 2, 1, 1},
    OpRow{"CBORE", "SOLID", 1, 1, 7, 10, true, 4, 1, 2, 1},
    OpRow{"CHAMFER", "SOLID", 2, 1, 2, 3, true, 5, 1, 3, 1},
    OpRow{"CIRCLE", "PROFILE", 3, 0, 1, 3, false, 6, 2, 4, 1},
    OpRow{"COMMON", "SOLID", 3, 1, 2, 2, true, 8, 1, 5, 1},
    OpRow{"CONE", "SOLID", 4, 0, 3, 9, false, 9, 2, 6, 1},
    OpRow{"CUT", "SOLID", 4, 1, 2, 2, true, 11, 1, 7, 1},
    OpRow{"CYL", "SOLID", 5, 0, 2, 8, false, 12, 2, 8, 1},
    OpRow{"DEFEATURE", "SOLID", 5, 1, 2, 2, true, 14, 1, 9, 1},
    OpRow{"EXTRUDE", "SOLID", 6, 1, 2, 5, true, 15, 2, 10, 1},
    OpRow{"FILLET", "SOLID", 7, 1, 2, 3, true, 17, 1, 11, 1},
    OpRow{"FOLD", "SOLID", 8, 1, 8, 9, true, 18, 2, 12, 1},
    OpRow{"FUSE", "SOLID", 9, 1, 2, 2, true, 20, 1, 13, 1},
    OpRow{"HEAL", "SOLID", 10, 1, 1, 1, true, 21, 1, 14, 1},
    OpRow{"HOLE", "SOLID", 11, 1, 5, 9, true, 22, 2, 15, 1},
    OpRow{"INPUT", "SOLID", 12, 0, 0, 0, false, 24, 1, 16, 1},
    OpRow{"LOFT", "SOLID", 12, 1, 2, kUnboundedArgs, true, 25, 4, 17, 1},
    OpRow{"MIRROR", "SOLID", 13, 1, 2, 7, true, 29, 1, 18, 1},
    OpRow{"PATTERN", "SOLID", 14, 1, 4, 10, true, 30, 4, 19, 3},
    OpRow{"POLY", "PROFILE", 15, 0, 1, 1, false, 34, 1, 22, 1},
    OpRow{"PRISM", "SOLID", 15, 0, 3, 6, false, 35, 2, 23, 1},
    OpRow{"PUSHFACE", "SOLID", 15, 1, 3, 3, true, 37, 1, 24, 1},
    OpRow{"RECT", "PROFILE", 16, 0, 2, 4, false, 38, 2, 25, 1},
    OpRow{"REGPOLY", "PROFILE", 16, 0, 2, 5, false, 40, 2, 26, 1},
    OpRow{"RESIZEBORE", "SOLID", 16, 1, 3, 3, true, 42, 1, 27, 1},
    OpRow{"REVOLVE", "SOLID", 17, 1, 2, 8, true, 43, 2, 28, 1},
    OpRow{"RING", "WIRE", 18, 0, 3, 7, false, 45, 2, 29, 1},
    OpRow{"ROTATE", "SOLID", 18, 1, 5, 8, true, 47, 2, 30, 1},
    OpRow{"RRECT", "PROFILE", 19, 0, 3, 5, false, 49, 2, 31, 1},
    OpRow{"SECTION", "WIRE", 19, 1, 2, 2, true, 51, 1, 32, 1},
    OpRow{"SHELL", "SOLID", 20, 1, 2, 5, true, 52, 2, 33, 1},
    OpRow{"SPHERE", "SOLID", 21, 0, 1, 4, false, 54, 2, 34, 1},
    OpRow{"SWEEP", "SOLID", 21, 0, 2, 2, false, 56, 2, 35, 2},
    OpRow{"TAG", "SOLID", 21, 1, 3, 3, true, 58, 1, 37, 1},
    OpRow{"TORUS", "SOLID", 22, 0, 2, 8, false, 59, 2, 38, 1},
    OpRow{"TRANSLATE", "SOLID", 22, 1, 4, 4, true, 61, 1, 39, 1},
    OpRow{"TUBE", "SOLID", 23, 0, 3, 6, false, 62, 2, 40, 1},
    OpRow{"VERIFY", "SOLID", 23, 1, 2, kUnboundedArgs, true, 64, 2, 41, 1},
    OpRow{"WIRE", "WIRE", 24, 0, 1, 1, false, 66, 1, 42, 1},
}};

// ------------------------------------------------------------- forbidden ops
// A REAL kernel op that no forge::ui command emits.  The reason is carried so a
// refusal can say WHY rather than "not allowed".
struct ForbiddenRow {
  std::string_view op;
  std::string_view reason;
};
inline constexpr std::array<ForbiddenRow, 7> kForbiddenOps = {{
    ForbiddenRow{"CAP",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"FACES",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SEW",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SKIN",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SLOT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SURFCHECK",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"THICKEN",
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
inline constexpr std::array<CommandRow, 43> kEmittingCommands = {{
    CommandRow{"part.boolean_intersect", "COMMON", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_subtract", "CUT", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_union", "FUSE", "Body", 2, 2, "Solid"},
    CommandRow{"part.chamfer", "CHAMFER", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.counterbore", "CBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.defeature", "DEFEATURE", "Face", 1, kUnboundedArgs, "Solid"},
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
    CommandRow{"part.shell", "SHELL", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.sketch_circle", "CIRCLE", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_poly", "POLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_polygon", "REGPOLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rect", "RECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rounded_rect", "RRECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sweep_pipe", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.sweep_profile", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.tag_feature", "TAG", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.variable_fillet", "BLEND", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.verify", "VERIFY", "Body", 1, 1, "Solid"},
}};

}  // namespace forge::ui::vocab

#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP
