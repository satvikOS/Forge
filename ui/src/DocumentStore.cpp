#include "forge/ui/DocumentStore.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include "forge/ui/DocumentModel.hpp"

namespace forge::ui {
namespace {

bool isSpace(char c) noexcept { return c == ' ' || c == '\t' || c == '\r'; }

std::string trim(const std::string& s) {
  std::size_t begin = 0;
  while (begin < s.size() && isSpace(s[begin])) ++begin;
  std::size_t end = s.size();
  while (end > begin && isSpace(s[end - 1])) --end;
  return s.substr(begin, end - begin);
}

void splitKey(const std::string& line, std::string& key, std::string& rest) {
  const std::size_t sp = line.find(' ');
  if (sp == std::string::npos) {
    key = line;
    rest.clear();
    return;
  }
  key = line.substr(0, sp);
  rest = trim(line.substr(sp + 1));
}

std::string parentOf(const std::string& path) {
  const std::size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

bool endsWith(const std::string& text, const std::string& suffix) {
  return text.size() >= suffix.size() &&
         text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

// ── FileSystemStorage ───────────────────────────────────────────────────────
bool FileSystemStorage::exists(const std::string& path) const {
  std::error_code ec;
  return std::filesystem::exists(std::filesystem::path(path), ec) && !ec;
}

bool FileSystemStorage::read(const std::string& path, std::string& text,
                             std::string& error) const {
  if (path.empty()) {
    error = "no path";
    return false;
  }
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    error = "cannot open '" + path + "'";
    return false;
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  // A read that failed halfway must not be reported as a read.
  if (in.bad()) {
    error = "read of '" + path + "' failed";
    return false;
  }
  text = buffer.str();
  error.clear();
  return true;
}

bool FileSystemStorage::write(const std::string& path, const std::string& text,
                              std::string& error) {
  if (path.empty()) {
    error = "no path";
    return false;
  }
  std::error_code ec;
  const std::string directory = parentOf(path);
  if (!directory.empty()) {
    std::filesystem::create_directories(std::filesystem::path(directory), ec);
    // create_directories reports "already there" as ec too on some platforms;
    // the honest test is whether the directory exists afterwards.
    if (!std::filesystem::exists(std::filesystem::path(directory))) {
      error = "cannot create directory '" + directory + "'";
      return false;
    }
  }

  // ATOMIC REPLACEMENT. Writing straight over the target means a process that
  // dies mid-write has destroyed the last good copy -- which for an AUTOSAVE is
  // precisely the moment it mattered.
  const std::string temporary = path + ".forge-tmp";
  {
    std::ofstream out(temporary, std::ios::trunc | std::ios::binary);
    if (!out) {
      error = "cannot open '" + temporary + "' for writing";
      return false;
    }
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
    out.flush();
    if (!out) {
      error = "write to '" + temporary + "' failed";
      std::error_code ignored;
      std::filesystem::remove(std::filesystem::path(temporary), ignored);
      return false;
    }
  }
  std::filesystem::rename(std::filesystem::path(temporary), std::filesystem::path(path), ec);
  if (ec) {
    error = "cannot replace '" + path + "': " + ec.message();
    std::error_code ignored;
    std::filesystem::remove(std::filesystem::path(temporary), ignored);
    return false;
  }
  error.clear();
  return true;
}

bool FileSystemStorage::remove(const std::string& path, std::string& error) {
  std::error_code ec;
  std::filesystem::remove(std::filesystem::path(path), ec);
  if (ec) {
    error = "cannot remove '" + path + "': " + ec.message();
    return false;
  }
  error.clear();
  return true;
}

std::vector<std::string> FileSystemStorage::list(const std::string& directory) const {
  std::vector<std::string> out;
  std::error_code ec;
  std::filesystem::directory_iterator it(std::filesystem::path(directory), ec);
  if (ec) return out;  // "nothing there" and "could not look" are the caller's to report
  for (const std::filesystem::directory_entry& entry : it) {
    out.push_back(entry.path().string());
  }
  std::sort(out.begin(), out.end());
  return out;
}

// ── MemoryStorage ───────────────────────────────────────────────────────────
bool MemoryStorage::exists(const std::string& path) const {
  return files_.find(path) != files_.end();
}

bool MemoryStorage::read(const std::string& path, std::string& text, std::string& error) const {
  const auto it = files_.find(path);
  if (it == files_.end()) {
    error = "cannot open '" + path + "'";
    return false;
  }
  text = it->second;
  error.clear();
  return true;
}

bool MemoryStorage::write(const std::string& path, const std::string& text, std::string& error) {
  ++writes_;
  if (failWrites_ > 0) {
    --failWrites_;
    error = "injected write failure for '" + path + "'";
    return false;  // the map is untouched: the previous contents survive
  }
  files_[path] = text;
  error.clear();
  return true;
}

bool MemoryStorage::remove(const std::string& path, std::string& error) {
  files_.erase(path);
  error.clear();
  return true;
}

std::vector<std::string> MemoryStorage::list(const std::string& directory) const {
  std::vector<std::string> out;
  const std::string prefix = directory.empty() ? std::string() : directory + "/";
  for (const auto& kv : files_) {
    if (kv.first.compare(0, prefix.size(), prefix) != 0) continue;
    if (kv.first.find('/', prefix.size()) != std::string::npos) continue;  // direct children only
    out.push_back(kv.first);
  }
  std::sort(out.begin(), out.end());
  return out;
}

bool MemoryStorage::contents(const std::string& path, std::string& text) const {
  const auto it = files_.find(path);
  if (it == files_.end()) return false;
  text = it->second;
  return true;
}

// ── plain save / open ───────────────────────────────────────────────────────
bool saveDocumentFile(DocumentStorage& storage, const std::string& path,
                      const DocumentFileData& data, std::string& error) {
  return storage.write(path, writeDocumentFile(data), error);
}

bool loadDocumentFile(const DocumentStorage& storage, const std::string& path,
                      DocumentFileData& out, DocumentIoError& error) {
  std::string text;
  std::string why;
  if (!storage.read(path, text, why)) {
    error = DocumentIoError{};
    error.message = why;
    return false;
  }
  return readDocumentFile(text, out, error);
}

bool saveDocumentFile(const std::string& path, const DocumentFileData& data, std::string& error) {
  FileSystemStorage storage;
  return saveDocumentFile(storage, path, data, error);
}

bool loadDocumentFile(const std::string& path, DocumentFileData& out, DocumentIoError& error) {
  FileSystemStorage storage;
  return loadDocumentFile(storage, path, out, error);
}

// ── the session marker ──────────────────────────────────────────────────────
std::string writeRecoveryMarker(const RecoveryCandidate& candidate) {
  std::string out;
  out += std::string(kRecoveryMarkerMagic) + " " + std::to_string(kRecoveryMarkerVersion) + "\n";
  out += "SESSION " + candidate.sessionId + "\n";
  out += "STARTED " + std::to_string(candidate.startedAtMillis) + "\n";
  out += "SAVED " + std::to_string(candidate.savedAtMillis) + "\n";
  out += std::string("AUTOSAVED ") + (candidate.hasAutosave ? "1" : "0") + "\n";
  if (!candidate.autosavePath.empty()) out += "AUTOSAVE " + candidate.autosavePath + "\n";
  if (!candidate.documentPath.empty()) out += "DOCUMENT " + candidate.documentPath + "\n";
  if (!candidate.documentName.empty()) out += "NAME " + candidate.documentName + "\n";
  return out;
}

bool parseRecoveryMarker(const std::string& text, RecoveryCandidate& out, std::string& error) {
  RecoveryCandidate candidate;
  std::istringstream in(text);
  std::string raw;
  bool sawHeader = false;
  while (std::getline(in, raw)) {
    const std::string line = trim(raw);
    if (line.empty() || line[0] == '#') continue;
    std::string key;
    std::string rest;
    splitKey(line, key, rest);
    if (!sawHeader) {
      if (key != kRecoveryMarkerMagic) {
        error = "not a session marker (expected '" + std::string(kRecoveryMarkerMagic) + "')";
        return false;
      }
      double version = 0.0;
      if (!parseRoundTripNumber(rest, version) ||
          static_cast<int>(version) != kRecoveryMarkerVersion) {
        error = "session marker version '" + rest + "' is not " +
                std::to_string(kRecoveryMarkerVersion);
        return false;
      }
      sawHeader = true;
      continue;
    }
    double number = 0.0;
    if (key == "SESSION") {
      candidate.sessionId = rest;
    } else if (key == "STARTED" && parseRoundTripNumber(rest, number)) {
      candidate.startedAtMillis = static_cast<std::uint64_t>(number);
    } else if (key == "SAVED" && parseRoundTripNumber(rest, number)) {
      candidate.savedAtMillis = static_cast<std::uint64_t>(number);
    } else if (key == "AUTOSAVED") {
      candidate.hasAutosave = (rest == "1");
    } else if (key == "AUTOSAVE") {
      candidate.autosavePath = rest;
    } else if (key == "DOCUMENT") {
      candidate.documentPath = rest;
    } else if (key == "NAME") {
      candidate.documentName = rest;
    } else {
      error = "unknown session-marker key '" + key + "'";
      return false;
    }
  }
  if (!sawHeader) {
    error = "empty session marker";
    return false;
  }
  if (candidate.sessionId.empty()) {
    error = "session marker has no SESSION id";
    return false;
  }
  out = candidate;
  error.clear();
  return true;
}

// ── RecoveryService ─────────────────────────────────────────────────────────
RecoveryService::RecoveryService(DocumentStorage& storage, std::string directory)
    : storage_(storage), directory_(std::move(directory)) {}

std::string RecoveryService::markerPath() const {
  if (sessionId_.empty()) return {};
  return directory_ + "/" + sessionId_ + kSessionMarkerSuffix;
}

std::string RecoveryService::autosavePath() const {
  if (sessionId_.empty()) return {};
  return directory_ + "/" + sessionId_ + kAutosaveSuffix;
}

bool RecoveryService::beginSession(const std::string& sessionId, std::uint64_t nowMillis,
                                   std::string& error) {
  if (sessionId.empty()) {
    error = "a recovery session needs an id";
    return false;
  }
  sessionId_ = sessionId;
  startedAtMillis_ = nowMillis;
  lastAutosaveMillis_ = nowMillis;
  lastUndoDepth_ = 0;
  lastAutosavedDigest_.clear();
  wroteAutosave_ = false;
  stats_ = RecoveryStats{};
  if (!writeMarker(0, std::string(), std::string(), false, error)) {
    // A session whose marker could not be written is a session with no crash
    // evidence. Say so rather than running with silent recovery disabled.
    sessionId_.clear();
    return false;
  }
  return true;
}

bool RecoveryService::writeMarker(std::uint64_t savedAtMillis, const std::string& documentPath,
                                  const std::string& documentName, bool hasAutosave,
                                  std::string& error) {
  RecoveryCandidate candidate;
  candidate.sessionId = sessionId_;
  candidate.startedAtMillis = startedAtMillis_;
  candidate.savedAtMillis = savedAtMillis;
  candidate.autosavePath = autosavePath();
  candidate.documentPath = documentPath;
  candidate.documentName = documentName;
  candidate.hasAutosave = hasAutosave;
  return storage_.write(markerPath(), writeRecoveryMarker(candidate), error);
}

bool RecoveryService::autosaveNow(std::uint64_t nowMillis, const DocumentModel& model,
                                  const std::string& documentPath, std::string& error) {
  error.clear();
  if (!active()) {
    error = "no recovery session is open";
    return false;
  }
  // Nothing changed: writing again would cost a disk and tell a reader of the
  // statistics that work was happening when none was.
  const std::string digest = model.contentDigest();
  if (wroteAutosave_ && digest == lastAutosavedDigest_) {
    ++stats_.autosavesSkipped;
    lastAutosaveMillis_ = nowMillis;
    lastUndoDepth_ = model.undo().undoDepth();
    return false;
  }

  const std::string text = writeDocumentFile(model.capture());
  if (!storage_.write(autosavePath(), text, error)) {
    ++stats_.autosaveFailures;
    stats_.lastError = error;
    // The previous autosave is still there: DocumentStorage::write is
    // all-or-nothing. Recovery from the older snapshot beats recovery from a
    // truncated one.
    return false;
  }
  if (!writeMarker(nowMillis, documentPath, model.name(), true, error)) {
    ++stats_.autosaveFailures;
    stats_.lastError = error;
    return false;
  }

  ++stats_.autosavesWritten;
  stats_.lastAutosaveMillis = nowMillis;
  stats_.lastError.clear();
  lastAutosaveMillis_ = nowMillis;
  lastUndoDepth_ = model.undo().undoDepth();
  lastAutosavedDigest_ = digest;
  wroteAutosave_ = true;
  return true;
}

bool RecoveryService::tick(std::uint64_t nowMillis, const DocumentModel& model,
                           const std::string& documentPath, std::string& error) {
  error.clear();
  if (!active() || !policy_.enabled) return false;

  const std::size_t depth = model.undo().undoDepth();
  const std::size_t edits = depth > lastUndoDepth_ ? depth - lastUndoDepth_ : lastUndoDepth_ - depth;
  const bool dueByTime =
      policy_.intervalMillis == 0 || nowMillis >= lastAutosaveMillis_ + policy_.intervalMillis;
  const bool dueByEdits = policy_.everyNEdits > 0 && edits >= policy_.everyNEdits;
  if (!dueByTime && !dueByEdits) return false;

  return autosaveNow(nowMillis, model, documentPath, error);
}

bool RecoveryService::endSession(std::string& error) {
  error.clear();
  if (!active()) return true;
  std::string why;
  bool ok = true;
  // The autosave goes first: a marker with no autosave is a harmless "nothing to
  // recover", while an autosave with no marker is invisible to scan() and would
  // sit on disk for ever.
  if (storage_.exists(autosavePath()) && !storage_.remove(autosavePath(), why)) {
    error = why;
    ok = false;
  }
  if (!storage_.remove(markerPath(), why)) {
    if (error.empty()) error = why;
    ok = false;
  }
  sessionId_.clear();
  wroteAutosave_ = false;
  lastAutosavedDigest_.clear();
  return ok;
}

std::vector<RecoveryCandidate> RecoveryService::scan() const {
  std::vector<RecoveryCandidate> out;
  for (const std::string& path : storage_.list(directory_)) {
    if (!endsWith(path, kSessionMarkerSuffix)) continue;
    std::string text;
    std::string why;
    if (!storage_.read(path, text, why)) continue;
    RecoveryCandidate candidate;
    if (!parseRecoveryMarker(text, candidate, why)) continue;
    if (!sessionId_.empty() && candidate.sessionId == sessionId_) continue;  // our own, still live
    candidate.markerPath = path;
    if (candidate.autosavePath.empty()) {
      candidate.autosavePath = directory_ + "/" + candidate.sessionId + kAutosaveSuffix;
    }
    // Claiming an autosave the marker points at but that is not there would
    // hand the user a recovery that fails when they accept it.
    candidate.hasAutosave = candidate.hasAutosave && storage_.exists(candidate.autosavePath);
    out.push_back(candidate);
  }
  std::sort(out.begin(), out.end(), [](const RecoveryCandidate& a, const RecoveryCandidate& b) {
    if (a.savedAtMillis != b.savedAtMillis) return a.savedAtMillis > b.savedAtMillis;
    return a.sessionId < b.sessionId;
  });
  return out;
}

bool RecoveryService::recover(const RecoveryCandidate& candidate, DocumentModel& out,
                              DocumentIoError& error) const {
  error = DocumentIoError{};
  if (!candidate.hasAutosave || candidate.autosavePath.empty()) {
    error.message = "session " + candidate.sessionId + " has no autosave to recover";
    return false;
  }
  std::string text;
  std::string why;
  if (!storage_.read(candidate.autosavePath, text, why)) {
    error.message = why;
    return false;
  }
  // The SAME reader a normal Open uses: a recovered document is a document.
  return out.load(text, error);
}

bool RecoveryService::discard(const RecoveryCandidate& candidate, std::string& error) {
  error.clear();
  bool ok = true;
  std::string why;
  if (!candidate.autosavePath.empty() && storage_.exists(candidate.autosavePath) &&
      !storage_.remove(candidate.autosavePath, why)) {
    error = why;
    ok = false;
  }
  if (!candidate.markerPath.empty() && !storage_.remove(candidate.markerPath, why)) {
    if (error.empty()) error = why;
    ok = false;
  }
  return ok;
}

}  // namespace forge::ui
