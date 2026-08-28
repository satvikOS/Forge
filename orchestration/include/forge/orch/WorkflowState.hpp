// ─────────────────────────────────────────────────────────────────────────────
// WorkflowState.hpp — SACROSANCT 11.1 typed workflow state.
//
// 11.1 lists what every workstream state must include. This header carries that
// list as TYPES, one field per bullet, so a missing element is a compile error
// rather than a convention nobody checks:
//
//   immutable input-bundle hash ............... inputBundleHash(), set once
//   current ESG revision + ambiguity ledger ... revision(), ambiguities()
//   active candidate set + deterministic scores candidates()
//   graph header / chunk tip / count ledger ... graph()
//   compiled artifact manifest + observations . artifacts(), observations()
//   gate results, failure taxonomy, repair budget gates(), failure(), repairBudget()
//   user approvals and pending interrupts ..... approvals(), pendingInterrupts()
//   model/runtime/tool/kernel package hashes .. packages()
//   cost/token/time/memory/retry accounting ... accounting()
//   privacy/retention/network policy labels ... policy()
//
// TWO INVARIANTS ARE STRUCTURAL, NOT DOCUMENTARY.
//
//  1. THE INPUT-BUNDLE HASH IS IMMUTABLE. setInputBundleHash() REFUSES once the
//     hash is set. There is no other writer, so a workflow cannot be quietly
//     re-pointed at a different input bundle half-way through.
//
//  2. THE CONTROL PLANE IS SEPARABLE FROM RETRIEVED CONTENT. controlPlaneDigest()
//     covers policy labels, approvals, pending interrupts, the node-contract
//     registry, node statuses and the gate ledger — and DELIBERATELY EXCLUDES
//     every byte that came off the network. That is what makes 12.3 testable:
//     ingesting hostile retrieved text and benign retrieved text must leave the
//     SAME control-plane digest. If a retrieved byte ever reaches a control
//     field, the two digests diverge and the gate goes red.
//
// Retrieved text lives in EvidenceEntry::quoted_span / ::title as inert bytes.
// Nothing in this file interprets it, dispatches on it, or lets it name a node,
// a tool, a gate, an approval, or a policy label.
//
// Pure C++20 + the standard library. No kernel, no OCCT, no network.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/orch/NodeContract.hpp"

namespace forge::orch {

// ── canonical text codec ────────────────────────────────────────────────────
// Checkpoints are plain text so a human can read one after a crash. Values are
// escaped so a field containing a newline or a tab — retrieved page text does —
// cannot forge an extra record line.
namespace canon {
std::string escape(const std::string& raw);
std::string unescape(const std::string& enc);
std::vector<std::string> splitFields(const std::string& line);
}  // namespace canon

// NodeStatus, NodeContract, NodeProgress and the 11.4 FailureClass taxonomy live
// in NodeContract.hpp, included above.

// ── 11.1 policy labels ──────────────────────────────────────────────────────
enum class PrivacyLabel { ProjectConfidential, PublicDerived };
enum class RetentionLabel { SessionOnly, ProjectDurable };
// 20.2: egress is denied by default; the same-Mac SearXNG sidecar is the single
// production exception, and it must be named on the state to be permitted.
enum class NetworkPolicyLabel { DeniedByDefault, SameMacSidecarOnly };

const char* privacyLabelName(PrivacyLabel l);
const char* retentionLabelName(RetentionLabel l);
const char* networkPolicyLabelName(NetworkPolicyLabel l);
bool parsePrivacyLabel(const std::string& t, PrivacyLabel& out);
bool parseRetentionLabel(const std::string& t, RetentionLabel& out);
bool parseNetworkPolicyLabel(const std::string& t, NetworkPolicyLabel& out);

struct PolicyLabels {
  PrivacyLabel privacy = PrivacyLabel::ProjectConfidential;
  RetentionLabel retention = RetentionLabel::ProjectDurable;
  NetworkPolicyLabel network = NetworkPolicyLabel::DeniedByDefault;
  std::string canonicalForm() const;
};

// ── 11.1 accounting ─────────────────────────────────────────────────────────
struct AccountingLedger {
  std::uint64_t cost_micros = 0;
  std::uint64_t tokens_in = 0;
  std::uint64_t tokens_out = 0;
  std::uint64_t wall_ms = 0;
  std::uint64_t peak_memory_kib = 0;
  std::uint64_t retries = 0;
};

// ── 11.1 package hashes ─────────────────────────────────────────────────────
struct PackageHashes {
  std::string model;
  std::string runtime;
  std::string tool;
  std::string kernel;
  std::string canonicalForm() const;
};

// ── 11.1 graph header / chunk tip / count ledger ─────────────────────────────
struct GraphLedger {
  std::string graph_header_hash;
  std::string committed_chunk_tip;   // hash of the last accepted chunk
  std::size_t committed_chunk_count = 0;
  std::size_t committed_line_count = 0;
};

// ── 11.1 ledgers ────────────────────────────────────────────────────────────
struct AmbiguityEntry {
  std::string question_id;
  std::string note;
  bool resolved = false;
};

struct CandidateScore {
  std::string candidate_id;
  double score = 0.0;
};

struct ArtifactEntry {
  std::string logical_name;
  std::string content_hash;   // content-addressed, per the 11.2 derived-write class
};

struct ObservationEntry {
  std::string key;
  std::string value;
};

struct GateResult {
  std::string gate_id;
  bool passed = false;
  FailureClass failure = FailureClass::None;
  std::string detail;
};

struct ApprovalRecord {
  std::string node_id;
  HumanApprovalClass approval_class = HumanApprovalClass::None;
  std::string bound_digest;      // the previewed bytes the approval is bound to
  std::string approver;
};

// 12.4: a question that could not be refreshed is RECORDED, not silently
// answered from somewhere else.
struct UnresolvedQuestion {
  std::string esg_assertion_id;
  std::string reason;            // e.g. "RETRIEVAL_UNAVAILABLE"
  bool freshness_dependent = true;
};

// ── evidence projection ─────────────────────────────────────────────────────
// A retrieval::EvidenceRecord flattened for durable storage. `quoted_span` and
// `title` are the bytes that came off the wire. They are stored, hashed and
// displayed; they are never parsed for meaning by this module.
struct EvidenceEntry {
  std::string content_hash;
  std::string url;
  std::string publisher;
  std::string retrieval_time_utc;
  std::string source_type;
  std::string esg_assertion_id;
  std::string title;
  std::string quoted_span;
  bool injection_attempt_flagged = false;
  bool may_be_sole_authority = true;
};

// ── the state ───────────────────────────────────────────────────────────────
class WorkflowState {
public:
  WorkflowState() = default;
  explicit WorkflowState(std::string workflow_id) : workflow_id_(std::move(workflow_id)) {}

  const std::string& workflowId() const { return workflow_id_; }
  void setWorkflowId(std::string id) { workflow_id_ = std::move(id); }

  // — 11.1 immutable input-bundle hash —
  const std::string& inputBundleHash() const { return input_bundle_hash_; }
  // Returns false and leaves the state untouched when a hash is already bound.
  bool setInputBundleHash(const std::string& hash, std::string& why);
  // Convenience: hash the bundle bytes and bind them.
  bool bindInputBundle(const std::string& bundle_bytes, std::string& why);

  // — 11.1 current revision —
  std::uint64_t revision() const { return revision_; }

  // — ledgers (11.1) —
  const std::vector<AmbiguityEntry>& ambiguities() const { return ambiguities_; }
  void addAmbiguity(AmbiguityEntry e);
  const std::vector<CandidateScore>& candidates() const { return candidates_; }
  void setCandidates(std::vector<CandidateScore> c);
  const GraphLedger& graph() const { return graph_; }
  void setGraph(GraphLedger g);
  const std::vector<ArtifactEntry>& artifacts() const { return artifacts_; }
  void addArtifact(ArtifactEntry a);
  const std::vector<ObservationEntry>& observations() const { return observations_; }
  void addObservation(ObservationEntry o);
  const std::vector<GateResult>& gates() const { return gates_; }
  void recordGate(GateResult g);
  FailureClass failure() const { return failure_; }
  void setFailure(FailureClass f);
  std::uint32_t repairBudget() const { return repair_budget_; }
  void setRepairBudget(std::uint32_t b);
  const std::vector<ApprovalRecord>& approvals() const { return approvals_; }
  void recordApproval(ApprovalRecord a);
  const std::vector<std::string>& pendingInterrupts() const { return pending_interrupts_; }
  void addPendingInterrupt(std::string s);
  const PackageHashes& packages() const { return packages_; }
  void setPackages(PackageHashes p);
  const AccountingLedger& accounting() const { return accounting_; }
  AccountingLedger& mutableAccounting();      // bumps the revision
  const PolicyLabels& policy() const { return policy_; }
  void setPolicy(PolicyLabels p);
  const std::vector<UnresolvedQuestion>& unresolved() const { return unresolved_; }
  void recordUnresolved(UnresolvedQuestion q);

  // — node contract registry (11.2) —
  // The declared contract of every node that has run. Retrieved content can
  // never add, remove or alter an entry: only registerContract() writes here and
  // it is called with a contract built in code, never from a response body.
  const std::vector<NodeContract>& contracts() const { return contracts_; }
  void registerContract(NodeContract c);
  const NodeContract* findContract(const std::string& node_id) const;

  // — node progress (the resume point) —
  const std::vector<NodeProgress>& nodes() const { return nodes_; }
  NodeProgress nodeProgress(const std::string& node_id) const;
  void setNodeProgress(const NodeProgress& p);

  // — evidence (12.2 / 12.3) —
  const std::vector<EvidenceEntry>& evidence() const { return evidence_; }

  // Staging area: evidence that has been RETRIEVED but not yet committed. It
  // exists so a checkpoint taken straight after transmission is enough to resume
  // without a second transmission.
  const std::vector<EvidenceEntry>& stagedEvidence() const { return staged_; }
  const std::string& stagedKey() const { return staged_key_; }
  void stageEvidence(const std::string& idempotency_key, std::vector<EvidenceEntry> entries);
  void clearStaged();

  // Commit staged (or supplied) evidence under an idempotency key.
  // • A key that has already been committed commits NOTHING and reports it.
  // • Within a commit, an entry whose content_hash is already present is a
  //   duplicate and is skipped.
  // Returns true when the key was newly committed.
  bool commitEvidence(const std::string& idempotency_key,
                      const std::vector<EvidenceEntry>& entries,
                      std::size_t& added, std::size_t& duplicates_skipped);
  bool isEvidenceKeyCommitted(const std::string& idempotency_key) const;
  const std::vector<std::string>& committedEvidenceKeys() const { return committed_keys_; }

  // — digests —
  // Everything, including retrieved content.
  std::string stateHash() const;
  // Control plane ONLY: the fields that STEER EXECUTION — input-bundle hash,
  // policy labels, package hashes, the node-contract registry, node schedule and
  // status, approvals, pending interrupts, the gate ledger, the active failure
  // class, the repair budget, and the unresolved-question ledger. Retrieved
  // content (evidence, staging, observations) is excluded BY DESIGN: it is
  // inert data, and keeping it out is what makes "retrieval cannot inject
  // instructions" a checkable equality rather than a claim.
  std::string controlPlaneCanonicalForm() const;
  std::string controlPlaneDigest() const;

  // — durability —
  std::string serialize() const;
  static bool deserialize(const std::string& text, WorkflowState& out, std::string& err);

private:
  void bump() { ++revision_; }

  std::string workflow_id_;
  std::string input_bundle_hash_;
  std::uint64_t revision_ = 0;

  std::vector<AmbiguityEntry> ambiguities_;
  std::vector<CandidateScore> candidates_;
  GraphLedger graph_;
  std::vector<ArtifactEntry> artifacts_;
  std::vector<ObservationEntry> observations_;
  std::vector<GateResult> gates_;
  FailureClass failure_ = FailureClass::None;
  std::uint32_t repair_budget_ = 0;
  std::vector<ApprovalRecord> approvals_;
  std::vector<std::string> pending_interrupts_;
  PackageHashes packages_;
  AccountingLedger accounting_;
  PolicyLabels policy_;
  std::vector<UnresolvedQuestion> unresolved_;

  std::vector<NodeContract> contracts_;
  std::vector<NodeProgress> nodes_;

  std::vector<EvidenceEntry> evidence_;
  std::vector<EvidenceEntry> staged_;
  std::string staged_key_;
  std::vector<std::string> committed_keys_;
};

}  // namespace forge::orch
