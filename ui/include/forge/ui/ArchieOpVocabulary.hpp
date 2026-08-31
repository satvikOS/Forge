// ui/include/forge/ui/ArchieOpVocabulary.hpp -- GENERATED FILE. DO NOT EDIT.
//
// Written by implementation/sacrosanct/tools/gen_op_constraint_table.py
// from implementation/sacrosanct/archie_op_vocabulary.json
// sha256(vocabulary) = 6d826088af84c25db7a4562af3a4d1d72776328a6f357f33146f23dacf819d1d
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
inline constexpr std::string_view kVocabularySha256 = "6d826088af84c25db7a4562af3a4d1d72776328a6f357f33146f23dacf819d1d";
inline constexpr std::string_view kVocabularySchema = "forge.archie.op_vocabulary/1";

// The counts the vocabulary computes about itself.  A gate that re-derives
// these from the LIVE registry is the check that the file is not merely
// self-consistent.
inline constexpr std::size_t kKernelOpsCount = 40;
inline constexpr std::size_t kRegistryCommandsCount = 41;
inline constexpr std::size_t kCommandsEmittingIrCount = 30;
inline constexpr std::size_t kUserInvocableOpsCount = 28;
inline constexpr std::size_t kForbiddenOpsCount = 12;

// ---------------------------------------------------------------- side tables
// Sliced by the (first, count) pairs in the rows below.
inline constexpr std::array<std::string_view, 22> kConsumedValueKinds = {{
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
}};

// An argument COUNT a user command can actually emit.  Deliberately narrower
// than the kernel arity: the kernel would accept EXTRUDE with 4 arguments and
// no command in the app can produce that form.
struct ArgCountRange {
  std::size_t min = 0;
  std::size_t max = 0;  // kUnboundedArgs when the op is variadic
};
inline constexpr std::array<ArgCountRange, 44> kEmittedArgCounts = {{
    ArgCountRange{3, 3},
    ArgCountRange{5, 5},
    ArgCountRange{7, 7},
    ArgCountRange{3, 3},
    ArgCountRange{1, 1},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{2, 2},
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
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{4, 4},
    ArgCountRange{3, 3},
    ArgCountRange{2, 2},
    ArgCountRange{8, 8},
    ArgCountRange{3, 3},
    ArgCountRange{7, 7},
    ArgCountRange{2, 2},
    ArgCountRange{5, 5},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{4, 4},
    ArgCountRange{2, 2},
    ArgCountRange{3, 3},
    ArgCountRange{1, 1},
}};

inline constexpr std::array<std::string_view, 30> kOpCommandIds = {{
    "part.variable_fillet",
    "part.counterbore",
    "part.chamfer",
    "part.sketch_circle",
    "part.boolean_intersect",
    "part.boolean_subtract",
    "part.defeature",
    "part.extrude",
    "part.fillet",
    "part.fold",
    "part.boolean_union",
    "part.heal",
    "part.hole",
    "part.input",
    "part.loft",
    "part.mirror",
    "part.pattern_circular",
    "part.pattern_grid",
    "part.pattern_linear",
    "part.push_face",
    "part.sketch_rect",
    "part.resize_bore",
    "part.revolve",
    "part.section_ring",
    "part.shell",
    "part.sweep_pipe",
    "part.tag_feature",
    "part.move",
    "part.verify",
    "part.wire_section",
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
    OpRow{"CBORE", "SOLID", 1, 1, 7, 10, true, 2, 1, 1, 1},
    OpRow{"CHAMFER", "SOLID", 2, 1, 2, 3, true, 3, 1, 2, 1},
    OpRow{"CIRCLE", "PROFILE", 3, 0, 1, 3, false, 4, 2, 3, 1},
    OpRow{"COMMON", "SOLID", 3, 1, 2, 2, true, 6, 1, 4, 1},
    OpRow{"CUT", "SOLID", 4, 1, 2, 2, true, 7, 1, 5, 1},
    OpRow{"DEFEATURE", "SOLID", 5, 1, 2, 2, true, 8, 1, 6, 1},
    OpRow{"EXTRUDE", "SOLID", 6, 1, 2, 5, true, 9, 2, 7, 1},
    OpRow{"FILLET", "SOLID", 7, 1, 2, 3, true, 11, 1, 8, 1},
    OpRow{"FOLD", "SOLID", 8, 1, 8, 9, true, 12, 2, 9, 1},
    OpRow{"FUSE", "SOLID", 9, 1, 2, 2, true, 14, 1, 10, 1},
    OpRow{"HEAL", "SOLID", 10, 1, 1, 1, true, 15, 1, 11, 1},
    OpRow{"HOLE", "SOLID", 11, 1, 5, 9, true, 16, 2, 12, 1},
    OpRow{"INPUT", "SOLID", 12, 0, 0, 0, false, 18, 1, 13, 1},
    OpRow{"LOFT", "SOLID", 12, 1, 2, kUnboundedArgs, true, 19, 4, 14, 1},
    OpRow{"MIRROR", "SOLID", 13, 1, 2, 7, true, 23, 1, 15, 1},
    OpRow{"PATTERN", "SOLID", 14, 1, 4, 10, true, 24, 4, 16, 3},
    OpRow{"PUSHFACE", "SOLID", 15, 1, 3, 3, true, 28, 1, 19, 1},
    OpRow{"RECT", "PROFILE", 16, 0, 2, 4, false, 29, 2, 20, 1},
    OpRow{"RESIZEBORE", "SOLID", 16, 1, 3, 3, true, 31, 1, 21, 1},
    OpRow{"REVOLVE", "SOLID", 17, 1, 2, 8, true, 32, 2, 22, 1},
    OpRow{"RING", "WIRE", 18, 0, 3, 7, false, 34, 2, 23, 1},
    OpRow{"SHELL", "SOLID", 18, 1, 2, 5, true, 36, 2, 24, 1},
    OpRow{"SWEEP", "SOLID", 19, 0, 2, 2, false, 38, 1, 25, 1},
    OpRow{"TAG", "SOLID", 19, 1, 3, 3, true, 39, 1, 26, 1},
    OpRow{"TRANSLATE", "SOLID", 20, 1, 4, 4, true, 40, 1, 27, 1},
    OpRow{"VERIFY", "SOLID", 21, 1, 2, kUnboundedArgs, true, 41, 2, 28, 1},
    OpRow{"WIRE", "WIRE", 22, 0, 1, 1, false, 43, 1, 29, 1},
}};

// ------------------------------------------------------------- forbidden ops
// A REAL kernel op that no forge::ui command emits.  The reason is carried so a
// refusal can say WHY rather than "not allowed".
struct ForbiddenRow {
  std::string_view op;
  std::string_view reason;
};
inline constexpr std::array<ForbiddenRow, 12> kForbiddenOps = {{
    ForbiddenRow{"BOX",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"CONE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"CYL",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"POLY",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"PRISM",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"REGPOLY",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"ROTATE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"RRECT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SLOT",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"SPHERE",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"TORUS",
                 "no command in the forge::ui registry emits it, so no user can produce it"},
    ForbiddenRow{"TUBE",
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
    CommandRow{"part.defeature", "DEFEATURE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.extrude", "EXTRUDE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.fillet", "FILLET", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.fold", "FOLD", "Body", 1, 1, "Solid"},
    CommandRow{"part.heal", "HEAL", "Body", 1, 1, "Solid"},
    CommandRow{"part.hole", "HOLE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.input", "INPUT", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.loft", "LOFT", "Wire", 2, kUnboundedArgs, "Solid"},
    CommandRow{"part.mirror", "MIRROR", "Body", 1, 1, "Solid"},
    CommandRow{"part.move", "TRANSLATE", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_circular", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_grid", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.pattern_linear", "PATTERN", "Body", 1, 1, "Solid"},
    CommandRow{"part.push_face", "PUSHFACE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.resize_bore", "RESIZEBORE", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.revolve", "REVOLVE", "Sketch", 1, 1, "Solid"},
    CommandRow{"part.section_ring", "RING", "None", 0, kUnboundedArgs, "Wire"},
    CommandRow{"part.shell", "SHELL", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.sketch_circle", "CIRCLE", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sketch_rect", "RECT", "None", 0, kUnboundedArgs, "Profile"},
    CommandRow{"part.sweep_pipe", "SWEEP", "None", 0, kUnboundedArgs, "Solid"},
    CommandRow{"part.tag_feature", "TAG", "Face", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.variable_fillet", "BLEND", "Edge", 1, kUnboundedArgs, "Solid"},
    CommandRow{"part.verify", "VERIFY", "Body", 1, 1, "Solid"},
    CommandRow{"part.wire_section", "WIRE", "None", 0, kUnboundedArgs, "Wire"},
}};

}  // namespace forge::ui::vocab

#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP
