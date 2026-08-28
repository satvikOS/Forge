#include "forge/orch/CheckpointStore.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#include "forge/orch/Digest.hpp"

namespace forge::orch {

const char* const kGenesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";

const char* chainFaultName(ChainFault f) {
  switch (f) {
    case ChainFault::None: return "None";
    case ChainFault::RecordAltered: return "RecordAltered";
    case ChainFault::StateAltered: return "StateAltered";
    case ChainFault::LinkBroken: return "LinkBroken";
    case ChainFault::SequenceGap: return "SequenceGap";
    case ChainFault::DuplicateSequence: return "DuplicateSequence";
    case ChainFault::OutOfOrder: return "OutOfOrder";
    case ChainFault::Unreadable: return "Unreadable";
  }
  return "None";
}

std::string CheckpointRecord::computeRecordHash() const {
  std::ostringstream o;
  o << sequence << "\n"
    << previous_record_hash << "\n"
    << state_hash << "\n"
    << canon::escape(node_id) << "\n"
    << canon::escape(step_label) << "\n"
    << payload.size() << "\n"
    << payload;
  return sha256Hex(o.str());
}

std::string CheckpointRecord::encode() const {
  std::ostringstream o;
  o << "ckpt\tforge.orch.ckpt/1\n"
    << "seq\t" << sequence << "\n"
    << "prev\t" << previous_record_hash << "\n"
    << "state_hash\t" << state_hash << "\n"
    << "node\t" << canon::escape(node_id) << "\n"
    << "step\t" << canon::escape(step_label) << "\n"
    << "record_hash\t" << record_hash << "\n"
    << "payload_bytes\t" << payload.size() << "\n"
    << "payload\n"
    << payload;
  return o.str();
}

bool CheckpointRecord::decode(const std::string& text, CheckpointRecord& out, std::string& err) {
  err.clear();
  const std::string marker = "\npayload\n";
  const std::size_t split = text.find(marker);
  if (split == std::string::npos) { err = "no payload marker"; return false; }

  CheckpointRecord r;
  r.payload = text.substr(split + marker.size());

  std::istringstream head(text.substr(0, split));
  std::string line;
  bool saw_schema = false;
  std::size_t declared_bytes = 0;
  bool saw_bytes = false;
  while (std::getline(head, line)) {
    const std::vector<std::string> f = canon::splitFields(line);
    if (f.size() < 2) { err = "malformed header line '" + line + "'"; return false; }
    if (f[0] == "ckpt") {
      if (f[1] != "forge.orch.ckpt/1") { err = "unknown checkpoint schema '" + f[1] + "'"; return false; }
      saw_schema = true;
    } else if (f[0] == "seq") {
      r.sequence = static_cast<std::size_t>(std::strtoull(f[1].c_str(), nullptr, 10));
    } else if (f[0] == "prev") {
      r.previous_record_hash = f[1];
    } else if (f[0] == "state_hash") {
      r.state_hash = f[1];
    } else if (f[0] == "node") {
      r.node_id = canon::unescape(f[1]);
    } else if (f[0] == "step") {
      r.step_label = canon::unescape(f[1]);
    } else if (f[0] == "record_hash") {
      r.record_hash = f[1];
    } else if (f[0] == "payload_bytes") {
      declared_bytes = static_cast<std::size_t>(std::strtoull(f[1].c_str(), nullptr, 10));
      saw_bytes = true;
    } else {
      err = "unknown checkpoint header key '" + f[0] + "'";
      return false;
    }
  }
  if (!saw_schema) { err = "no checkpoint schema line"; return false; }
  if (r.sequence == 0) { err = "checkpoint sequence is zero"; return false; }
  // A truncated write is a torn record, not a valid one.
  if (saw_bytes && declared_bytes != r.payload.size()) {
    err = "payload is " + std::to_string(r.payload.size()) + " bytes, header declares " +
          std::to_string(declared_bytes);
    return false;
  }
  out = std::move(r);
  return true;
}

// ── store ───────────────────────────────────────────────────────────────────
CheckpointStore::CheckpointStore(std::string dir) : dir_(std::move(dir)) {
  std::error_code ec;
  std::filesystem::create_directories(dir_, ec);
  std::string err;
  reload(err);   // an existing directory is a crashed run's history
}

std::string CheckpointStore::pathFor(std::size_t sequence) const {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "ckpt-%06zu.txt", sequence);
  return dir_ + "/" + buf;
}

bool CheckpointStore::append(const WorkflowState& state, const std::string& node_id,
                             const std::string& step_label, std::string& err) {
  err.clear();
  CheckpointRecord r;
  r.sequence = records_.size() + 1;
  r.previous_record_hash = records_.empty() ? kGenesisHash : records_.back().record_hash;
  r.payload = state.serialize();
  r.state_hash = sha256Hex(r.payload);
  r.node_id = node_id;
  r.step_label = step_label;
  r.record_hash = r.computeRecordHash();

  const std::string final_path = pathFor(r.sequence);
  const std::string tmp_path = final_path + ".partial";
  {
    std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
    if (!out) { err = "cannot open " + tmp_path; return false; }
    const std::string encoded = r.encode();
    out.write(encoded.data(), static_cast<std::streamsize>(encoded.size()));
    out.flush();
    if (!out) { err = "write failed for " + tmp_path; return false; }
  }
  std::error_code ec;
  std::filesystem::rename(tmp_path, final_path, ec);
  if (ec) { err = "rename failed: " + ec.message(); return false; }

  records_.push_back(std::move(r));
  return true;
}

bool CheckpointStore::reload(std::string& err) {
  err.clear();
  records_.clear();
  std::error_code ec;
  std::vector<std::filesystem::path> files;
  for (const auto& entry : std::filesystem::directory_iterator(dir_, ec)) {
    if (ec) break;
    if (!entry.is_regular_file()) continue;
    const std::string name = entry.path().filename().string();
    if (name.rfind("ckpt-", 0) != 0) continue;
    if (name.size() < 5 || name.substr(name.size() - 4) != ".txt") continue;  // skip .partial
    files.push_back(entry.path());
  }
  if (ec) { err = "cannot list " + dir_ + ": " + ec.message(); return false; }
  std::sort(files.begin(), files.end());

  for (const std::filesystem::path& p : files) {
    std::ifstream in(p, std::ios::binary);
    if (!in) { err = "cannot read " + p.string(); return false; }
    std::ostringstream ss;
    ss << in.rdbuf();
    CheckpointRecord r;
    std::string derr;
    if (!CheckpointRecord::decode(ss.str(), r, derr)) {
      err = p.string() + ": " + derr;
      return false;
    }
    records_.push_back(std::move(r));
  }
  return true;
}

ChainVerdict CheckpointStore::verifyChain() const {
  ChainVerdict v;
  std::string previous = kGenesisHash;
  std::size_t expected_seq = 1;
  for (const CheckpointRecord& r : records_) {
    if (r.sequence < expected_seq) {
      v.fault = (r.sequence == expected_seq - 1) ? ChainFault::DuplicateSequence
                                                 : ChainFault::OutOfOrder;
      v.at_sequence = r.sequence;
      v.detail = "expected sequence " + std::to_string(expected_seq) + ", found " +
                 std::to_string(r.sequence);
      return v;
    }
    if (r.sequence > expected_seq) {
      v.fault = ChainFault::SequenceGap;
      v.at_sequence = r.sequence;
      v.detail = "expected sequence " + std::to_string(expected_seq) + ", found " +
                 std::to_string(r.sequence);
      return v;
    }
    if (sha256Hex(r.payload) != r.state_hash) {
      v.fault = ChainFault::StateAltered;
      v.at_sequence = r.sequence;
      v.detail = "payload does not hash to the stored state_hash";
      return v;
    }
    if (r.computeRecordHash() != r.record_hash) {
      v.fault = ChainFault::RecordAltered;
      v.at_sequence = r.sequence;
      v.detail = "record content does not hash to the stored record_hash";
      return v;
    }
    if (r.previous_record_hash != previous) {
      v.fault = ChainFault::LinkBroken;
      v.at_sequence = r.sequence;
      v.detail = "back-link " + r.previous_record_hash.substr(0, 12) + "… does not match the "
                 "predecessor " + previous.substr(0, 12) + "…";
      return v;
    }
    previous = r.record_hash;
    ++expected_seq;
  }
  v.accepted = true;
  return v;
}

bool CheckpointStore::latest(CheckpointRecord& out) const {
  if (records_.empty()) return false;
  out = records_.back();
  return true;
}

bool CheckpointStore::restoreLatest(WorkflowState& out, std::string& err) const {
  err.clear();
  const ChainVerdict v = verifyChain();
  if (!v.accepted) {
    err = std::string("checkpoint chain rejected: ") + chainFaultName(v.fault) + " at sequence " +
          std::to_string(v.at_sequence) + " (" + v.detail + ")";
    return false;
  }
  if (records_.empty()) { err = "no checkpoints to restore"; return false; }
  return WorkflowState::deserialize(records_.back().payload, out, err);
}

}  // namespace forge::orch
