// ui/include/forge/ui/ArchieOpVocabulary.hpp -- GENERATED FILE. DO NOT EDIT.
//
// Written by implementation/sacrosanct/tools/gen_op_constraint_table.py
// from implementation/sacrosanct/archie_op_vocabulary.json
// sha256(vocabulary) = f7bb21c21c6e6f21dcbffe8f0ad244a822b8c73983f6c5dd914a9d0c57094ed1
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
inline constexpr std::string_view kVocabularySha256 = "f7bb21c21c6e6f21dcbffe8f0ad244a822b8c73983f6c5dd914a9d0c57094ed1";
inline constexpr std::string_view kVocabularySchema = "forge.archie.op_vocabulary/1";

// The counts the vocabulary computes about itself.  A gate that re-derives
// these from the LIVE registry is the check that the file is not merely
// self-consistent.
inline constexpr std::size_t kKernelOpsCount = 46;
inline constexpr std::size_t kRegistryCommandsCount = 41;
inline constexpr std::size_t kCommandsEmittingIrCount = 30;
inline constexpr std::size_t kUserInvocableOpsCount = 28;
inline constexpr std::size_t kForbiddenOpsCount = 18;

// ---------------------------------------------------------------- side tables
// Sliced by the (first, count) pairs in the rows below.
inline constexpr std::array<std::string_view, 16> kConsumedValueKinds = {{
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "SOLID",
    "PROFILE",
    "SOLID",
    "SOLID",
    "SOLID",
    "WIRE",
    "SOLID",
    "SOLID",
    "PROFILE",
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
inline constexpr std::array<ArgCountRange, 52> kEmittedArgCounts = {{
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
    ArgCountRange{5, 5},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{9, 9},
    ArgCountRange{2, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{3, kUnboundedArgs},
    ArgCountRange{4, kUnboundedArgs},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{4, 4},
    ArgCountRange{6, 6},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{7, 7},
    ArgCountRange{5, 5},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{1, 1},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{4, 4},
    ArgCountRange{3, 3},
    ArgCountRange{6, 6},
}};

inline constexpr std::array<std::string_view, 30> kOpCommandIds = {{
    "part.variable_fillet",
    "part.primitive_box",
    "part.counterbore",
    "part.chamfer",
    "part.sketch_circle",
    "part.boolean_intersect",
    "part.primitive_cone",
    "part.boolean_subtract",
    "part.primitive_cylinder",
    "part.extrude",
    "part.fillet",
    "part.boolean_union",
    "part.hole",
    "part.loft",
    "part.mirror",
    "part.pattern_circular",
    "part.pattern_grid",
    "part.pattern_linear",
    "part.primitive_prism",
    "part.sketch_rect",
    "part.sketch_polygon",
    "part.revolve",
    "part.section_ring",
    "part.rotate",
    "part.sketch_rounded_rect",
    "part.shell",
    "part.primitive_sphere",
    "part.primitive_torus",
    "part.move",
    "part.primitive_tube",
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
inline constexpr std::array<OpRow, 28> kAllowedOps = {{
    OpRow{"BLEND", "SOLID", 0, 1, 3, 5, true, 0, 2, 0, 1},
    OpRow{"BOX", "SOLID", 1, 0, 3, 6, false, 2, 2, 1, 1},
    OpRow{"CBORE", "SOLID", 1, 1, 7, 10, true, 4, 1, 2, 1},
    OpRow{"CHAMFER", "SOLID", 2, 1, 2, 3, true, 5, 1, 3, 1},
    OpRow{"CIRCLE", "PROFILE", 3, 0, 1, 3, false, 6, 2, 4, 1},
    OpRow{"COMMON", "SOLID", 3, 1, 2, 2, true, 8, 1, 5, 1},
    OpRow{"CONE", "SOLID", 4, 0, 3, 9, false, 9, 2, 6, 1},
    OpRow{"CUT", "SOLID", 4, 1, 2, 2, true, 11, 1, 7, 1},
    OpRow{"CYL", "SOLID", 5, 0, 2, 8, false, 12, 2, 8, 1},
    OpRow{"EXTRUDE", "SOLID", 5, 1, 2, 5, true, 14, 2, 9, 1},
    OpRow{"FILLET", "SOLID", 6, 1, 2, 3, true, 16, 1, 10, 1},
    OpRow{"FUSE", "SOLID", 7, 1, 2, 2, true, 17, 1, 11, 1},
    OpRow{"HOLE", "SOLID", 8, 1, 5, 9, true, 18, 2, 12, 1},
    OpRow{"LOFT", "SOLID", 9, 1, 2, kUnboundedArgs, true, 20, 4, 13, 1},
    OpRow{"MIRROR", "SOLID", 10, 1, 2, 7, true, 24, 1, 14, 1},
    OpRow{"PATTERN", "SOLID", 11, 1, 4, 10, true, 25, 4, 15, 3},
    OpRow{"PRISM", "SOLID", 12, 0, 3, 6, false, 29, 2, 18, 1},
    OpRow{"RECT", "PROFILE", 12, 0, 2, 4, false, 31, 2, 19, 1},
    OpRow{"REGPOLY", "PROFILE", 12, 0, 2, 5, false, 33, 2, 20, 1},
    OpRow{"REVOLVE", "SOLID", 12, 1, 2, 8, true, 35, 2, 21, 1},
    OpRow{"RING", "WIRE", 13, 0, 3, 7, false, 37, 2, 22, 1},
    OpRow{"ROTATE", "SOLID", 13, 1, 5, 8, true, 39, 2, 23, 1},
    OpRow{"RRECT", "PROFILE", 14, 0, 3, 5, false, 41, 2, 24, 1},
    OpRow{"SHELL", "SOLID", 14, 1, 2, 5, true, 43, 2, 25, 1},
    OpRow{"SPHERE", "SOLID", 15, 0, 1, 4, false, 45, 2, 26, 1},
    OpRow{"TORUS", "SOLID", 15, 0, 2, 8, false, 47, 2, 27, 1},
    OpRow{"TRANSLATE", "SOLID", 15, 1, 4, 4, true, 49, 1, 28, 1},
    OpRow{"TUBE", "SOLID", 16, 0, 3, 6, false, 50, 2, 29, 1},
}};

// ------------------------------------------------------------- forbidden ops
// A REAL kernel op that no forge::ui command emits.  The reason is carried so a
// refusal can say WHY rather than "not allowed".
struct ForbiddenRow {
  std::string_view op;
  std::string_view reason;
};
inline constexpr std::array<ForbiddenRow, 18> kForbiddenOps = {{
    ForbiddenRow{"CAP",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"DEFEATURE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"FACES",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"FOLD",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"HEAL",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"INPUT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"POLY",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"PUSHFACE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"RESIZEBORE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SEW",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SKIN",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SLOT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SURFCHECK",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SWEEP",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"TAG",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"THICKEN",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"VERIFY",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"WIRE",
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
inline constexpr std::array<CommandRow, 30> kEmittingCommands = {{
    CommandRow{"part.boolean_intersect", "COMMON", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_subtract", "CUT", "Body", 2, 2, "Solid"},
    CommandRow{"part.boolean_union", "FUSE", "Body", 2, 2, "Solid"},
    CommandRow{"part.chamfer", "CHAMFER", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.counterbore", "CBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.extrude", "EXTRUDE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.fillet", "FILLET", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.hole", "HOLE", "Face", 1, kUnboundedArgs, "Solid"},
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
    CommandRow{"part.revolve", "REVOLVE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.rotate", "ROTATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.section_ring", "RING", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.shell", "SHELL", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.sketch_circle", "CIRCLE", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_polygon", "REGPOLY", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rect", "RECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rounded_rect", "RRECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.variable_fillet", "BLEND", "Edge", 1, kUnboundedArgs, "Solid"},
}};

}  // namespace forge::ui::vocab

#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP
