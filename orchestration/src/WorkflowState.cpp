#include "forge/orch/WorkflowState.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/orch/Digest.hpp"

namespace forge::orch {

// ── canonical text codec ────────────────────────────────────────────────────
// A record line is TAB-separated; a list inside a field is COMMA-separated.
// escape() therefore has to neutralize backslash, tab, newline, carriage return
// and comma, or a value carrying one of them could forge a field or a record.
// Retrieved page text carries all of them, which is exactly why this exists.
namespace canon {

std::string escape(const std::string& raw) {
  std::string out;
  out.reserve(raw.size() + 8);
  for (char c : raw) {
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '\t': out += "\\t"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case ',':  out += "\\c"; break;
      default:   out.push_back(c); break;
    }
  }
  return out;
}

std::string unescape(const std::string& enc) {
  std::string out;
  out.reserve(enc.size());
  for (std::size_t i = 0; i < enc.size(); ++i) {
    if (enc[i] != '\\' || i + 1 >= enc.size()) { out.push_back(enc[i]); continue; }
    ++i;
    switch (enc[i]) {
      case '\\': out.push_back('\\'); break;
      case 't':  out.push_back('\t'); break;
      case 'n':  out.push_back('\n'); break;
      case 'r':  out.push_back('\r'); break;
      case 'c':  out.push_back(',');  break;
      default:   out.push_back('\\'); out.push_back(enc[i]); break;
    }
  }
  return out;
}

std::vector<std::string> splitFields(const std::string& line) {
  std::vector<std::string> out;
  std::size_t start = 0;
  while (true) {
    const std::size_t tab = line.find('\t', start);
    if (tab == std::string::npos) { out.push_back(line.substr(start)); break; }
    out.push_back(line.substr(start, tab - start));
    start = tab + 1;
  }
  return out;
}

}  // namespace canon

namespace {

std::string b(bool v) { return v ? "1" : "0"; }
bool parseBool(const std::string& s) { return s == "1"; }

std::string doubleToText(double d) {
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%.17g", d);
  return std::string(buf);
}

std::uint64_t toU64(const std::string& s) {
  return std::strtoull(s.c_str(), nullptr, 10);
}

}  // namespace

// ── policy label names ──────────────────────────────────────────────────────
const char* privacyLabelName(PrivacyLabel l) {
  switch (l) {
    case PrivacyLabel::ProjectConfidential: return "ProjectConfidential";
    case PrivacyLabel::PublicDerived: return "PublicDerived";
  }
  return "ProjectConfidential";
}
const char* retentionLabelName(RetentionLabel l) {
  switch (l) {
    case RetentionLabel::SessionOnly: return "SessionOnly";
    case RetentionLabel::ProjectDurable: return "ProjectDurable";
  }
  return "SessionOnly";
}
const char* networkPolicyLabelName(NetworkPolicyLabel l) {
  switch (l) {
    case NetworkPolicyLabel::DeniedByDefault: return "DeniedByDefault";
    case NetworkPolicyLabel::SameMacSidecarOnly: return "SameMacSidecarOnly";
  }
  return "DeniedByDefault";
}
bool parsePrivacyLabel(const std::string& t, PrivacyLabel& out) {
  const PrivacyLabel all[] = {PrivacyLabel::ProjectConfidential, PrivacyLabel::PublicDerived};
  for (PrivacyLabel l : all) if (t == privacyLabelName(l)) { out = l; return true; }
  return false;
}
bool parseRetentionLabel(const std::string& t, RetentionLabel& out) {
  const RetentionLabel all[] = {RetentionLabel::SessionOnly, RetentionLabel::ProjectDurable};
  for (RetentionLabel l : all) if (t == retentionLabelName(l)) { out = l; return true; }
  return false;
}
bool parseNetworkPolicyLabel(const std::string& t, NetworkPolicyLabel& out) {
  const NetworkPolicyLabel all[] = {NetworkPolicyLabel::DeniedByDefault,
                                    NetworkPolicyLabel::SameMacSidecarOnly};
  for (NetworkPolicyLabel l : all) if (t == networkPolicyLabelName(l)) { out = l; return true; }
  return false;
}

std::string PolicyLabels::canonicalForm() const {
  return std::string(privacyLabelName(privacy)) + "\t" + retentionLabelName(retention) + "\t" +
         networkPolicyLabelName(network);
}

std::string PackageHashes::canonicalForm() const {
  return canon::escape(model) + "\t" + canon::escape(runtime) + "\t" + canon::escape(tool) + "\t" +
         canon::escape(kernel);
}

// ── input bundle immutability ───────────────────────────────────────────────
bool WorkflowState::setInputBundleHash(const std::string& hash, std::string& why) {
  why.clear();
  if (hash.empty()) { why = "refusing an empty input-bundle hash"; return false; }
  if (!input_bundle_hash_.empty()) {
    why = "input-bundle hash is immutable and is already bound to " + input_bundle_hash_;
    return false;
  }
  input_bundle_hash_ = hash;
  bump();
  return true;
}

bool WorkflowState::bindInputBundle(const std::string& bundle_bytes, std::string& why) {
  return setInputBundleHash(sha256Hex(bundle_bytes), why);
}

// ── ledger mutators (every one bumps the revision) ───────────────────────────
void WorkflowState::addAmbiguity(AmbiguityEntry e) { ambiguities_.push_back(std::move(e)); bump(); }
void WorkflowState::setCandidates(std::vector<CandidateScore> c) { candidates_ = std::move(c); bump(); }
void WorkflowState::setGraph(GraphLedger g) { graph_ = std::move(g); bump(); }
void WorkflowState::addArtifact(ArtifactEntry a) { artifacts_.push_back(std::move(a)); bump(); }
void WorkflowState::addObservation(ObservationEntry o) { observations_.push_back(std::move(o)); bump(); }
void WorkflowState::recordGate(GateResult g) { gates_.push_back(std::move(g)); bump(); }
void WorkflowState::setFailure(FailureClass f) { failure_ = f; bump(); }
void WorkflowState::setRepairBudget(std::uint32_t v) { repair_budget_ = v; bump(); }
void WorkflowState::recordApproval(ApprovalRecord a) { approvals_.push_back(std::move(a)); bump(); }
void WorkflowState::addPendingInterrupt(std::string s) { pending_interrupts_.push_back(std::move(s)); bump(); }
void WorkflowState::setPackages(PackageHashes p) { packages_ = std::move(p); bump(); }
AccountingLedger& WorkflowState::mutableAccounting() { bump(); return accounting_; }
void WorkflowState::setPolicy(PolicyLabels p) { policy_ = p; bump(); }
void WorkflowState::recordUnresolved(UnresolvedQuestion q) { unresolved_.push_back(std::move(q)); bump(); }

void WorkflowState::registerContract(NodeContract c) {
  for (NodeContract& existing : contracts_) {
    if (existing.node_id == c.node_id) { existing = std::move(c); bump(); return; }
  }
  contracts_.push_back(std::move(c));
  bump();
}

const NodeContract* WorkflowState::findContract(const std::string& node_id) const {
  for (const NodeContract& c : contracts_) {
    if (c.node_id == node_id) return &c;
  }
  return nullptr;
}

NodeProgress WorkflowState::nodeProgress(const std::string& node_id) const {
  for (const NodeProgress& p : nodes_) {
    if (p.node_id == node_id) return p;
  }
  NodeProgress fresh;
  fresh.node_id = node_id;
  return fresh;
}

void WorkflowState::setNodeProgress(const NodeProgress& p) {
  for (NodeProgress& existing : nodes_) {
    if (existing.node_id == p.node_id) { existing = p; bump(); return; }
  }
  nodes_.push_back(p);
  bump();
}

// ── evidence ────────────────────────────────────────────────────────────────
void WorkflowState::stageEvidence(const std::string& idempotency_key,
                                  std::vector<EvidenceEntry> entries) {
  staged_key_ = idempotency_key;
  staged_ = std::move(entries);
  bump();
}

void WorkflowState::clearStaged() {
  staged_.clear();
  staged_key_.clear();
  bump();
}

bool WorkflowState::isEvidenceKeyCommitted(const std::string& idempotency_key) const {
  for (const std::string& k : committed_keys_) {
    if (k == idempotency_key) return true;
  }
  return false;
}

bool WorkflowState::commitEvidence(const std::string& idempotency_key,
                                   const std::vector<EvidenceEntry>& entries,
                                   std::size_t& added, std::size_t& duplicates_skipped) {
  added = 0;
  duplicates_skipped = 0;
  // IDEMPOTENCY, LAYER 1: the whole commit is keyed. A replay of the same node
  // with the same inputs commits nothing at all.
  if (isEvidenceKeyCommitted(idempotency_key)) {
    duplicates_skipped = entries.size();
    return false;
  }
  // IDEMPOTENCY, LAYER 2: content addressing. Even a first-time key cannot add a
  // record whose bytes are already held — the same page found by a second query
  // is the same evidence, not two pieces of it.
  for (const EvidenceEntry& e : entries) {
    bool present = false;
    for (const EvidenceEntry& have : evidence_) {
      if (have.content_hash == e.content_hash) { present = true; break; }
    }
    if (present) { ++duplicates_skipped; continue; }
    evidence_.push_back(e);
    ++added;
  }
  committed_keys_.push_back(idempotency_key);
  bump();
  return true;
}

// ── digests ─────────────────────────────────────────────────────────────────
std::string WorkflowState::controlPlaneCanonicalForm() const {
  std::ostringstream o;
  o << "cp/1\n";
  o << "workflow\t" << canon::escape(workflow_id_) << "\n";
  o << "input_bundle\t" << canon::escape(input_bundle_hash_) << "\n";
  o << "policy\t" << policy_.canonicalForm() << "\n";
  o << "packages\t" << packages_.canonicalForm() << "\n";
  o << "failure\t" << failureClassName(failure_) << "\n";
  o << "repair_budget\t" << repair_budget_ << "\n";
  for (const NodeContract& c : contracts_) o << "contract\t" << c.canonicalForm() << "\n";
  for (const NodeProgress& p : nodes_) {
    o << "node\t" << canon::escape(p.node_id) << "\t" << nodeStatusName(p.status) << "\t"
      << p.attempts << "\t" << p.completed_steps << "\t" << failureClassName(p.failure) << "\t"
      << canon::escape(p.idempotency_key) << "\t" << canon::escape(p.detail) << "\n";
  }
  for (const ApprovalRecord& a : approvals_) {
    o << "approval\t" << canon::escape(a.node_id) << "\t" << approvalClassName(a.approval_class)
      << "\t" << canon::escape(a.bound_digest) << "\t" << canon::escape(a.approver) << "\n";
  }
  for (const std::string& i : pending_interrupts_) o << "interrupt\t" << canon::escape(i) << "\n";
  for (const GateResult& g : gates_) {
    o << "gate\t" << canon::escape(g.gate_id) << "\t" << b(g.passed) << "\t"
      << failureClassName(g.failure) << "\t" << canon::escape(g.detail) << "\n";
  }
  for (const UnresolvedQuestion& u : unresolved_) {
    o << "unresolved\t" << canon::escape(u.esg_assertion_id) << "\t" << canon::escape(u.reason)
      << "\t" << b(u.freshness_dependent) << "\n";
  }
  return o.str();
}

std::string WorkflowState::controlPlaneDigest() const {
  return sha256Hex(controlPlaneCanonicalForm());
}

std::string WorkflowState::stateHash() const { return sha256Hex(serialize()); }

// ── durable serialization ───────────────────────────────────────────────────
std::string WorkflowState::serialize() const {
  std::ostringstream o;
  o << "schema\tforge.orch/1\n";
  o << "workflow\t" << canon::escape(workflow_id_) << "\n";
  o << "input_bundle\t" << canon::escape(input_bundle_hash_) << "\n";
  o << "revision\t" << revision_ << "\n";
  o << "policy\t" << policy_.canonicalForm() << "\n";
  o << "packages\t" << packages_.canonicalForm() << "\n";
  o << "graph\t" << canon::escape(graph_.graph_header_hash) << "\t"
    << canon::escape(graph_.committed_chunk_tip) << "\t" << graph_.committed_chunk_count << "\t"
    << graph_.committed_line_count << "\n";
  o << "accounting\t" << accounting_.cost_micros << "\t" << accounting_.tokens_in << "\t"
    << accounting_.tokens_out << "\t" << accounting_.wall_ms << "\t"
    << accounting_.peak_memory_kib << "\t" << accounting_.retries << "\n";
  o << "failure\t" << failureClassName(failure_) << "\n";
  o << "repair_budget\t" << repair_budget_ << "\n";
  for (const AmbiguityEntry& a : ambiguities_) {
    o << "ambiguity\t" << canon::escape(a.question_id) << "\t" << canon::escape(a.note) << "\t"
      << b(a.resolved) << "\n";
  }
  for (const CandidateScore& c : candidates_) {
    o << "candidate\t" << canon::escape(c.candidate_id) << "\t" << doubleToText(c.score) << "\n";
  }
  for (const ArtifactEntry& a : artifacts_) {
    o << "artifact\t" << canon::escape(a.logical_name) << "\t" << canon::escape(a.content_hash)
      << "\n";
  }
  for (const ObservationEntry& ob : observations_) {
    o << "observation\t" << canon::escape(ob.key) << "\t" << canon::escape(ob.value) << "\n";
  }
  for (const GateResult& g : gates_) {
    o << "gate\t" << canon::escape(g.gate_id) << "\t" << b(g.passed) << "\t"
      << failureClassName(g.failure) << "\t" << canon::escape(g.detail) << "\n";
  }
  for (const ApprovalRecord& a : approvals_) {
    o << "approval\t" << canon::escape(a.node_id) << "\t" << approvalClassName(a.approval_class)
      << "\t" << canon::escape(a.bound_digest) << "\t" << canon::escape(a.approver) << "\n";
  }
  for (const std::string& i : pending_interrupts_) o << "interrupt\t" << canon::escape(i) << "\n";
  for (const UnresolvedQuestion& u : unresolved_) {
    o << "unresolved\t" << canon::escape(u.esg_assertion_id) << "\t" << canon::escape(u.reason)
      << "\t" << b(u.freshness_dependent) << "\n";
  }
  for (const NodeContract& c : contracts_) o << "contract\t" << c.canonicalForm() << "\n";
  for (const NodeProgress& p : nodes_) {
    o << "node\t" << canon::escape(p.node_id) << "\t" << nodeStatusName(p.status) << "\t"
      << p.attempts << "\t" << p.completed_steps << "\t" << failureClassName(p.failure) << "\t"
      << canon::escape(p.idempotency_key) << "\t" << canon::escape(p.detail) << "\n";
  }
  auto emitEvidence = [&](const char* tag, const EvidenceEntry& e) {
    o << tag << "\t" << canon::escape(e.content_hash) << "\t" << canon::escape(e.url) << "\t"
      << canon::escape(e.publisher) << "\t" << canon::escape(e.retrieval_time_utc) << "\t"
      << canon::escape(e.source_type) << "\t" << canon::escape(e.esg_assertion_id) << "\t"
      << canon::escape(e.title) << "\t" << canon::escape(e.quoted_span) << "\t"
      << b(e.injection_attempt_flagged) << "\t" << b(e.may_be_sole_authority) << "\n";
  };
  for (const EvidenceEntry& e : evidence_) emitEvidence("evidence", e);
  o << "staged_key\t" << canon::escape(staged_key_) << "\n";
  for (const EvidenceEntry& e : staged_) emitEvidence("staged", e);
  for (const std::string& k : committed_keys_) o << "committed_key\t" << canon::escape(k) << "\n";
  return o.str();
}

bool WorkflowState::deserialize(const std::string& text, WorkflowState& out, std::string& err) {
  err.clear();
  WorkflowState s;
  std::istringstream in(text);
  std::string line;
  bool saw_schema = false;

  auto need = [&](const std::vector<std::string>& f, std::size_t n, const char* what) {
    if (f.size() < n) {
      err = std::string("record '") + what + "' has " + std::to_string(f.size()) +
            " fields, needs " + std::to_string(n);
      return false;
    }
    return true;
  };

  auto readEvidence = [&](const std::vector<std::string>& f, EvidenceEntry& e) {
    e.content_hash = canon::unescape(f[1]);
    e.url = canon::unescape(f[2]);
    e.publisher = canon::unescape(f[3]);
    e.retrieval_time_utc = canon::unescape(f[4]);
    e.source_type = canon::unescape(f[5]);
    e.esg_assertion_id = canon::unescape(f[6]);
    e.title = canon::unescape(f[7]);
    e.quoted_span = canon::unescape(f[8]);
    e.injection_attempt_flagged = parseBool(f[9]);
    e.may_be_sole_authority = parseBool(f[10]);
  };

  while (std::getline(in, line)) {
    if (line.empty()) continue;
    const std::vector<std::string> f = canon::splitFields(line);
    const std::string& key = f[0];

    if (key == "schema") {
      if (!need(f, 2, "schema")) return false;
      if (f[1] != "forge.orch/1") { err = "unknown schema '" + f[1] + "'"; return false; }
      saw_schema = true;
    } else if (key == "workflow") {
      if (!need(f, 2, "workflow")) return false;
      s.workflow_id_ = canon::unescape(f[1]);
    } else if (key == "input_bundle") {
      if (!need(f, 2, "input_bundle")) return false;
      s.input_bundle_hash_ = canon::unescape(f[1]);
    } else if (key == "revision") {
      if (!need(f, 2, "revision")) return false;
      s.revision_ = toU64(f[1]);
    } else if (key == "policy") {
      if (!need(f, 4, "policy")) return false;
      if (!parsePrivacyLabel(f[1], s.policy_.privacy) ||
          !parseRetentionLabel(f[2], s.policy_.retention) ||
          !parseNetworkPolicyLabel(f[3], s.policy_.network)) {
        err = "unknown policy label in '" + line + "'";
        return false;
      }
    } else if (key == "packages") {
      if (!need(f, 5, "packages")) return false;
      s.packages_.model = canon::unescape(f[1]);
      s.packages_.runtime = canon::unescape(f[2]);
      s.packages_.tool = canon::unescape(f[3]);
      s.packages_.kernel = canon::unescape(f[4]);
    } else if (key == "graph") {
      if (!need(f, 5, "graph")) return false;
      s.graph_.graph_header_hash = canon::unescape(f[1]);
      s.graph_.committed_chunk_tip = canon::unescape(f[2]);
      s.graph_.committed_chunk_count = static_cast<std::size_t>(toU64(f[3]));
      s.graph_.committed_line_count = static_cast<std::size_t>(toU64(f[4]));
    } else if (key == "accounting") {
      if (!need(f, 7, "accounting")) return false;
      s.accounting_.cost_micros = toU64(f[1]);
      s.accounting_.tokens_in = toU64(f[2]);
      s.accounting_.tokens_out = toU64(f[3]);
      s.accounting_.wall_ms = toU64(f[4]);
      s.accounting_.peak_memory_kib = toU64(f[5]);
      s.accounting_.retries = toU64(f[6]);
    } else if (key == "failure") {
      if (!need(f, 2, "failure")) return false;
      if (!parseFailureClass(f[1], s.failure_)) { err = "unknown failure class '" + f[1] + "'"; return false; }
    } else if (key == "repair_budget") {
      if (!need(f, 2, "repair_budget")) return false;
      s.repair_budget_ = static_cast<std::uint32_t>(toU64(f[1]));
    } else if (key == "ambiguity") {
      if (!need(f, 4, "ambiguity")) return false;
      AmbiguityEntry a;
      a.question_id = canon::unescape(f[1]);
      a.note = canon::unescape(f[2]);
      a.resolved = parseBool(f[3]);
      s.ambiguities_.push_back(std::move(a));
    } else if (key == "candidate") {
      if (!need(f, 3, "candidate")) return false;
      CandidateScore c;
      c.candidate_id = canon::unescape(f[1]);
      c.score = std::strtod(f[2].c_str(), nullptr);
      s.candidates_.push_back(std::move(c));
    } else if (key == "artifact") {
      if (!need(f, 3, "artifact")) return false;
      ArtifactEntry a;
      a.logical_name = canon::unescape(f[1]);
      a.content_hash = canon::unescape(f[2]);
      s.artifacts_.push_back(std::move(a));
    } else if (key == "observation") {
      if (!need(f, 3, "observation")) return false;
      ObservationEntry ob;
      ob.key = canon::unescape(f[1]);
      ob.value = canon::unescape(f[2]);
      s.observations_.push_back(std::move(ob));
    } else if (key == "gate") {
      if (!need(f, 5, "gate")) return false;
      GateResult g;
      g.gate_id = canon::unescape(f[1]);
      g.passed = parseBool(f[2]);
      if (!parseFailureClass(f[3], g.failure)) { err = "unknown gate failure class '" + f[3] + "'"; return false; }
      g.detail = canon::unescape(f[4]);
      s.gates_.push_back(std::move(g));
    } else if (key == "approval") {
      if (!need(f, 5, "approval")) return false;
      ApprovalRecord a;
      a.node_id = canon::unescape(f[1]);
      if (!parseApprovalClass(f[2], a.approval_class)) { err = "unknown approval class '" + f[2] + "'"; return false; }
      a.bound_digest = canon::unescape(f[3]);
      a.approver = canon::unescape(f[4]);
      s.approvals_.push_back(std::move(a));
    } else if (key == "interrupt") {
      if (!need(f, 2, "interrupt")) return false;
      s.pending_interrupts_.push_back(canon::unescape(f[1]));
    } else if (key == "unresolved") {
      if (!need(f, 4, "unresolved")) return false;
      UnresolvedQuestion u;
      u.esg_assertion_id = canon::unescape(f[1]);
      u.reason = canon::unescape(f[2]);
      u.freshness_dependent = parseBool(f[3]);
      s.unresolved_.push_back(std::move(u));
    } else if (key == "contract") {
      const std::size_t tab = line.find('\t');
      NodeContract c;
      std::string cerr;
      if (tab == std::string::npos ||
          !NodeContract::parseCanonicalForm(line.substr(tab + 1), c, cerr)) {
        err = "bad contract record: " + cerr;
        return false;
      }
      s.contracts_.push_back(std::move(c));
    } else if (key == "node") {
      if (!need(f, 8, "node")) return false;
      NodeProgress p;
      p.node_id = canon::unescape(f[1]);
      if (!parseNodeStatus(f[2], p.status)) { err = "unknown node status '" + f[2] + "'"; return false; }
      p.attempts = static_cast<std::uint32_t>(toU64(f[3]));
      p.completed_steps = static_cast<std::uint32_t>(toU64(f[4]));
      if (!parseFailureClass(f[5], p.failure)) { err = "unknown node failure class '" + f[5] + "'"; return false; }
      p.idempotency_key = canon::unescape(f[6]);
      p.detail = canon::unescape(f[7]);
      s.nodes_.push_back(std::move(p));
    } else if (key == "evidence" || key == "staged") {
      if (!need(f, 11, "evidence")) return false;
      EvidenceEntry e;
      readEvidence(f, e);
      if (key == "evidence") s.evidence_.push_back(std::move(e));
      else s.staged_.push_back(std::move(e));
    } else if (key == "staged_key") {
      if (!need(f, 2, "staged_key")) return false;
      s.staged_key_ = canon::unescape(f[1]);
    } else if (key == "committed_key") {
      if (!need(f, 2, "committed_key")) return false;
      s.committed_keys_.push_back(canon::unescape(f[1]));
    } else {
      // FAIL CLOSED. An unknown record means this checkpoint was written by a
      // version that knew something this one does not; silently dropping it
      // would resume from a state that is missing fields.
      err = "unknown record key '" + key + "'";
      return false;
    }
  }

  if (!saw_schema) { err = "no schema record"; return false; }
  out = std::move(s);
  return true;
}

}  // namespace forge::orch
