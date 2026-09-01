// ui/include/forge/ui/DocumentStore.hpp
//
// WHERE THE DOCUMENT LIVES, AND HOW IT SURVIVES A CRASH.
//
// The kernel segfaults on some geometry — a documented, open defect — so this
// application WILL die on a user's work. Losing it is not acceptable, and "save
// often" is not a design. What is a design:
//
//   1. A SESSION MARKER, written the moment a session opens and removed only by
//      a CLEAN exit. A marker still on disk therefore MEANS a session that did
//      not end — there is no separate "was it a crash?" heuristic to get wrong,
//      because the absence of the clean-exit step IS the evidence.
//   2. AUTOSAVES beside it, written on a cadence and ONLY when the document
//      actually changed since the last one (DocumentModel::contentDigest is the
//      comparison — a timer that rewrites an unchanged document is a timer that
//      spins a disk for nothing and hides real activity in its statistics).
//   3. ATOMIC replacement: an autosave is written to a temporary and renamed
//      over the previous one, so a process that dies mid-write leaves the LAST
//      GOOD autosave intact rather than a truncated file where the recovery was.
//   4. Recovery reads the autosave through the SAME reader a normal Open uses,
//      so a recovered document is a document and not a special case. The
//      autosave is a plain .fpart: a user can open one by hand.
//
// ── the filesystem seam ─────────────────────────────────────────────────────
// `DocumentStorage` exists so all of the above runs HEADLESS in CI. The gate
// drives a `MemoryStorage` whose next write can be made to FAIL — because the
// whole point of an autosave is what happens when the write fails, and a test
// that cannot make one fail has not tested recovery. `FileSystemStorage` is the
// real one, and the gate exercises it on a real temporary directory too, since a
// seam proved only against its own fake proves only the fake.
#ifndef FORGE_UI_DOCUMENTSTORE_HPP
#define FORGE_UI_DOCUMENTSTORE_HPP

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "forge/ui/DocumentModel.hpp"

namespace forge::ui {

// ── the seam ────────────────────────────────────────────────────────────────
class DocumentStorage {
 public:
  virtual ~DocumentStorage() = default;

  virtual bool exists(const std::string& path) const = 0;
  virtual bool read(const std::string& path, std::string& text, std::string& error) const = 0;
  // Must be ALL-OR-NOTHING: on failure the previous contents of `path` are still
  // there. Every implementation states how it achieves that.
  virtual bool write(const std::string& path, const std::string& text, std::string& error) = 0;
  virtual bool remove(const std::string& path, std::string& error) = 0;
  // Full paths of the entries directly inside `directory`, sorted. An
  // unreadable or missing directory is an empty list, not an error: "there is
  // nothing to recover" and "I could not look" are separated by scan()'s own
  // reporting rather than by an exception nobody catches.
  virtual std::vector<std::string> list(const std::string& directory) const = 0;
};

// Real files. Writes go to `<path>.forge-tmp` and are renamed over the target,
// which is atomic within a filesystem on every platform this ships to.
class FileSystemStorage final : public DocumentStorage {
 public:
  bool exists(const std::string& path) const override;
  bool read(const std::string& path, std::string& text, std::string& error) const override;
  bool write(const std::string& path, const std::string& text, std::string& error) override;
  bool remove(const std::string& path, std::string& error) override;
  std::vector<std::string> list(const std::string& directory) const override;
};

// The headless fake. Atomic by construction: a refused write never reaches the
// map.
class MemoryStorage final : public DocumentStorage {
 public:
  bool exists(const std::string& path) const override;
  bool read(const std::string& path, std::string& text, std::string& error) const override;
  bool write(const std::string& path, const std::string& text, std::string& error) override;
  bool remove(const std::string& path, std::string& error) override;
  std::vector<std::string> list(const std::string& directory) const override;

  // Make the next `writes` calls fail, as a full disk or a revoked permission
  // would. The previous contents must survive — that is the property under test.
  void failNextWrites(std::size_t writes) noexcept { failWrites_ = writes; }
  std::size_t fileCount() const noexcept { return files_.size(); }
  std::size_t writeCount() const noexcept { return writes_; }
  bool contents(const std::string& path, std::string& text) const;

 private:
  std::map<std::string, std::string> files_;
  std::size_t failWrites_ = 0;
  std::size_t writes_ = 0;
};

// ── plain save / open ───────────────────────────────────────────────────────
bool saveDocumentFile(DocumentStorage& storage, const std::string& path,
                      const DocumentFileData& data, std::string& error);
bool loadDocumentFile(const DocumentStorage& storage, const std::string& path,
                      DocumentFileData& out, DocumentIoError& error);
// The same two against the real filesystem, for callers that do not own a seam.
bool saveDocumentFile(const std::string& path, const DocumentFileData& data, std::string& error);
bool loadDocumentFile(const std::string& path, DocumentFileData& out, DocumentIoError& error);

// ── autosave and crash recovery ─────────────────────────────────────────────
inline constexpr const char* kSessionMarkerSuffix = ".forgesession";
inline constexpr const char* kAutosaveSuffix = ".autosave.fpart";
inline constexpr const char* kRecoveryMarkerMagic = "FORGE-RECOVERY";
inline constexpr int kRecoveryMarkerVersion = 1;

struct AutosavePolicy {
  bool enabled = true;
  // Whichever comes first. The edit trigger matters because a burst of twenty
  // features in ten seconds is exactly the work a time-only cadence loses.
  std::uint64_t intervalMillis = 30000;
  std::size_t everyNEdits = 20;
};

struct RecoveryCandidate {
  std::string sessionId;
  std::string markerPath;
  std::string autosavePath;
  std::string documentPath;  // the user's own file; "" when never saved
  std::string documentName;
  std::uint64_t startedAtMillis = 0;
  std::uint64_t savedAtMillis = 0;
  bool hasAutosave = false;
};

struct RecoveryStats {
  std::size_t autosavesWritten = 0;
  std::size_t autosavesSkipped = 0;  // due, but the document had not changed
  std::size_t autosaveFailures = 0;
  std::uint64_t lastAutosaveMillis = 0;
  std::string lastError;
};

class RecoveryService {
 public:
  RecoveryService(DocumentStorage& storage, std::string directory);

  void setPolicy(const AutosavePolicy& policy) noexcept { policy_ = policy; }
  const AutosavePolicy& policy() const noexcept { return policy_; }

  // Opens a session and writes its marker. `sessionId` must be unique per live
  // process; the caller owns that (a pid plus a start time is what the app uses).
  bool beginSession(const std::string& sessionId, std::uint64_t nowMillis, std::string& error);
  bool active() const noexcept { return !sessionId_.empty(); }
  const std::string& sessionId() const noexcept { return sessionId_; }
  std::string autosavePath() const;
  std::string markerPath() const;

  // Called on a frame tick. Writes an autosave when one is DUE and the document
  // has CHANGED since the last one. Returns true only when it actually wrote.
  bool tick(std::uint64_t nowMillis, const DocumentModel& model,
            const std::string& documentPath, std::string& error);
  // Unconditional (still skipped when nothing changed) — what a "snapshot now"
  // command and a shutdown hook call.
  bool autosaveNow(std::uint64_t nowMillis, const DocumentModel& model,
                   const std::string& documentPath, std::string& error);

  // A clean exit removes the marker AND the autosave. Whatever is left after
  // this is, by definition, a session that died.
  bool endSession(std::string& error);

  // Every marker in the directory that is not this session's own: every session
  // that did not end cleanly.
  std::vector<RecoveryCandidate> scan() const;
  bool recover(const RecoveryCandidate& candidate, DocumentModel& out,
               DocumentIoError& error) const;
  bool discard(const RecoveryCandidate& candidate, std::string& error);

  const RecoveryStats& stats() const noexcept { return stats_; }

 private:
  bool writeMarker(std::uint64_t savedAtMillis, const std::string& documentPath,
                   const std::string& documentName, bool hasAutosave, std::string& error);

  DocumentStorage& storage_;
  std::string directory_;
  std::string sessionId_;
  AutosavePolicy policy_{};
  RecoveryStats stats_{};
  std::uint64_t startedAtMillis_ = 0;
  std::uint64_t lastAutosaveMillis_ = 0;
  std::size_t lastUndoDepth_ = 0;
  std::string lastAutosavedDigest_;
  bool wroteAutosave_ = false;
};

// Parses a session marker. Exposed so a gate can assert on the evidence itself
// rather than only on what scan() chose to report.
bool parseRecoveryMarker(const std::string& text, RecoveryCandidate& out, std::string& error);
std::string writeRecoveryMarker(const RecoveryCandidate& candidate);

}  // namespace forge::ui

#endif  // FORGE_UI_DOCUMENTSTORE_HPP
