// ─────────────────────────────────────────────────────────────────────────────
// CheckpointStore.hpp — the durable half of SACROSANCT 11.2's checkpoint policy.
//
// A checkpoint is a plain-text file holding one serialized WorkflowState plus a
// header that links it to its predecessor:
//
//     seq / previous_record_hash / state_hash / node_id / step / payload
//
// The records form a HASH CHAIN, for the same reason s0.11's chunk stream does:
// after a crash the only thing standing between the agent and a silently
// altered, truncated or reordered history is the chain. verifyChain() detects
// an altered record, a removed record, a duplicate sequence number and a broken
// back-link, and restoreLatest() REFUSES to hand back a state from a chain that
// does not verify. A caller cannot resume from a tampered history by forgetting
// to check first.
//
// Durability model: each record is written to a temporary file and then renamed
// into place, so a crash mid-write leaves the previous tip intact rather than a
// half-written record that would fail the chain.
//
// Filesystem only. No network, no database, no third-party library.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <string>
#include <vector>

#include "forge/orch/WorkflowState.hpp"

namespace forge::orch {

struct CheckpointRecord {
  std::size_t sequence = 0;            // 1-based, contiguous
  std::string previous_record_hash;    // kGenesisHash for sequence 1
  std::string state_hash;              // sha256 of `payload`
  std::string node_id;
  std::string step_label;
  std::string payload;                 // WorkflowState::serialize()
  std::string record_hash;             // stored digest of everything above

  // Recompute from content. A record whose stored record_hash differs from this
  // has been ALTERED.
  std::string computeRecordHash() const;
  std::string encode() const;
  static bool decode(const std::string& text, CheckpointRecord& out, std::string& err);
};

// Anchors sequence 1 so the first record is chained to something rather than to
// nothing, which is what makes deleting record 1 detectable.
extern const char* const kGenesisHash;

enum class ChainFault {
  None,
  RecordAltered,      // stored record_hash != recomputed digest
  StateAltered,       // payload does not hash to state_hash
  LinkBroken,         // previous_record_hash does not match the predecessor
  SequenceGap,        // a record was REMOVED
  DuplicateSequence,  // a record was DUPLICATED
  OutOfOrder,         // records REORDERED
  Unreadable,         // a record on disk could not be decoded
};
const char* chainFaultName(ChainFault f);

struct ChainVerdict {
  bool accepted = false;
  ChainFault fault = ChainFault::None;
  std::size_t at_sequence = 0;
  std::string detail;
};

class CheckpointStore {
public:
  // `dir` is created if it does not exist. An existing directory is LOADED, so
  // constructing a store over a crashed run's directory is exactly what a fresh
  // process does on restart.
  explicit CheckpointStore(std::string dir);

  const std::string& dir() const { return dir_; }
  std::size_t size() const { return records_.size(); }
  const std::vector<CheckpointRecord>& records() const { return records_; }

  // Append one checkpoint. Returns false with `err` set on any I/O failure.
  bool append(const WorkflowState& state, const std::string& node_id,
              const std::string& step_label, std::string& err);

  // Re-read every record from disk, discarding the in-memory view. This is the
  // "new process after a crash" path.
  bool reload(std::string& err);

  ChainVerdict verifyChain() const;

  // Restore the tip. REFUSES when the chain does not verify.
  bool restoreLatest(WorkflowState& out, std::string& err) const;

  bool latest(CheckpointRecord& out) const;

private:
  std::string pathFor(std::size_t sequence) const;

  std::string dir_;
  std::vector<CheckpointRecord> records_;
};

}  // namespace forge::orch
