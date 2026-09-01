// ui/include/forge/ui/PartDocumentFile.hpp
//
// THE .fpart DOCUMENT — the native format the application reads and writes.
//
// ── why it lives in forge::ui and not in the app ────────────────────────────
// It used to be forge-desktop/src/PartFile.{hpp,cpp}, which meant the ONE thing
// standing between a user and their work could only be compiled by the 4.5-minute
// macOS job that builds SDL2, Vulkan and ImGui. Nothing here needs any of that:
// this file is value types plus a line reader, exactly like the rest of
// forge::ui, so it now compiles and is gated by `bash ui/test/run_ui.sh` in
// seconds. forge-desktop/src/PartFile.hpp is a shim over it, so every existing
// call site keeps working and there is still exactly ONE writer and ONE reader.
//
// ── what is stored, and why it is NOT the IR text ───────────────────────────
// A document is a list of FeatureRecords: an SSA feature-IR statement PLUS the
// state that makes it a document rather than a program — the tree label, the
// authoring command, the value kind, the node ids the typed selection binds it
// by, its persistent @name, whether it is suppressed, and which of its arguments
// a named parameter drives.
//
// "Write irProgram(), re-parse it on load" is rejected for two measured reasons:
//   1. It is LOSSY. irProgram() carries none of the state above, so a round trip
//      silently discards every label, binding, parameter and suppression — the
//      document comes back as a program that happens to build.
//   2. It would need a SECOND IR parser in the UI's vocabulary, alongside
//      forge::ft::parse. Two parsers for one grammar is the "same thing, two code
//      paths" failure the single-registry rule exists to prevent, and the one
//      that drifts is always the one with fewer users.
// So a record is stored STRUCTURALLY — one `ARG <kind> <value>` line per
// argument — and the IR text is DERIVED from it by the same IrLine::text() the
// live document uses.
//
// ═══ THE VERSION POLICY ═════════════════════════════════════════════════════
//
// Line 1 is `FORGE-PART <integer>`. There is no other place a version may live,
// and a file without it is not a .fpart.
//
//   WRITES  kPartFileVersion (2), always. Never an older version: "save as v1"
//           would have to drop parameters, materials, suppression, the rollback
//           bar and every persistent name, and a Save that silently deletes half
//           the document is worse than one that refuses.
//   READS   kPartFileMinReadVersion (1) .. kPartFileVersion (2), inclusive.
//   UPGRADE is implicit and total: every v1 key means in v2 exactly what it
//           meant in v1, and every v2 addition has a default that reproduces v1
//           behaviour (no parameters, no materials, nothing suppressed, the
//           rollback bar at the end, one NODE per feature). So a v1 file opens
//           as the same document it always was, and the next Save writes v2.
//   REFUSES a version ABOVE kPartFileVersion, naming both numbers. This is the
//           one refusal in this subsystem, and it is not a refusal of a user's
//           EDIT — it is a refusal to open a file this build cannot represent,
//           because opening it would mean loading half of someone's part and
//           writing the half back.
//   FORWARD COMPATIBILITY is what `X-` lines are for. Any line whose key starts
//           `X-`, at document level or inside a FEATURE block, is not
//           understood, is not an error, and is PRESERVED VERBATIM and re-emitted
//           on the next save. That is the mechanism that lets version 3 add a
//           field which survives a round trip through a version-2 build. Every
//           other unrecognised key IS an error, naming its line: a typo that is
//           silently ignored is a field the user believes they set.
//
// The writer and reader are proved to round-trip on a 71-statement document — by
// text, by every field, and by the KERNEL's measurement of the solid both
// programs build — in ui/test/part_document_file_test.cpp and
// ui/test/run_document_roundtrip_gate.sh.
#ifndef FORGE_UI_PARTDOCUMENTFILE_HPP
#define FORGE_UI_PARTDOCUMENTFILE_HPP

#include <cstddef>
#include <map>
#include <string>
#include <vector>

#include "forge/ui/PartCommands.hpp"

namespace forge::ui {

inline constexpr const char* kPartFileMagic = "FORGE-PART";
inline constexpr int kPartFileVersion = 2;
inline constexpr int kPartFileMinReadVersion = 1;
inline constexpr const char* kPartFileExtension = ".fpart";

// One stored feature: the document record, plus EVERY selection node bound to
// its value.
//
// v1 stored ONE node per feature and the capture took the first match, so a
// value that two nodes named came back named by one of them. A vector is not a
// generalisation for its own sake: bindings_ is a many-to-one map and the file
// has to be able to say so.
struct PartFileFeature {
  FeatureRecord record;
  std::vector<std::string> nodes;
};

struct PartFileDoc {
  std::string name = "untitled";
  std::string units = "mm";
  int rollbackAfter = PartDocument::kRollbackEnd;
  std::vector<Parameter> parameters;
  std::vector<Material> materials;
  std::map<std::string, std::string> materialAssignments;  // node -> material name
  std::vector<PartFileFeature> features;
  // Lines from a FUTURE version this build did not understand, kept so they
  // survive being opened and saved here. See the version policy above.
  std::vector<std::string> extensions;

  // The feature-IR program these records spell, newline-joined — derived, never
  // stored, so it cannot disagree with the records.
  std::string irProgram() const;
};

// ── the format ──────────────────────────────────────────────────────────────
std::string writePartFile(const PartFileDoc& doc);
// Returns false and fills `error` with a line-numbered reason. `out` is only
// written on success: a rejected file never half-replaces a document.
bool readPartFile(const std::string& text, PartFileDoc& out, std::string& error);
// The version on line 1, or 0 when the text is not a .fpart at all. Exposed so a
// caller can tell "too new" from "not ours" without parsing twice.
int partFileVersion(const std::string& text);

// ── document <-> file ───────────────────────────────────────────────────────
// `name` overrides the document's own when non-empty (Save As), otherwise the
// document's name is kept.
PartFileDoc capturePartDocument(const PartDocument& doc, const std::string& name);

// Rebuilds a document from a file.
//
// TOLERANT BY POLICY. It appends through PartDocument::adoptFeature, which keeps
// the one structural rule that cannot be recovered from — statements arrive in
// creation order, or every later `%N` means something else — and accepts
// everything else, recording per-row why it is broken. A document saved with a
// dangling reference in it therefore REOPENS, in the only program that can
// repair it, with the damage visible per feature. Such statements never reach
// the kernel: PartDocument::activeIrProgram() drops them and blockedFeatures()
// names them.
bool restorePartDocument(const PartFileDoc& file, PartDocument& doc, std::string& error);

// ── disk ────────────────────────────────────────────────────────────────────
bool savePartFile(const std::string& path, const PartFileDoc& doc, std::string& error);
bool loadPartFile(const std::string& path, PartFileDoc& out, std::string& error);

}  // namespace forge::ui

#endif  // FORGE_UI_PARTDOCUMENTFILE_HPP
