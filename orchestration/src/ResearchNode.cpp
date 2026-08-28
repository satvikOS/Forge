#include "forge/orch/ResearchNode.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "forge/orch/Digest.hpp"
#include "forge/retrieval/EvidenceRecord.hpp"

namespace forge::orch {

const char* ResearchNode::kNodeId = "research.searxng.v1";

const char* researchStepName(ResearchStep s) {
  switch (s) {
    case ResearchStep::RegisterContract: return "register-contract";
    case ResearchStep::BuildPreview: return "build-preview";
    case ResearchStep::RecordApproval: return "record-approval";
    case ResearchStep::Transmit: return "transmit";
    case ResearchStep::CommitEvidence: return "commit-evidence";
    case ResearchStep::Complete: return "complete";
  }
  return "unknown";
}

const char* researchOutcomeName(ResearchOutcomeStatus s) {
  switch (s) {
    case ResearchOutcomeStatus::Succeeded: return "Succeeded";
    case ResearchOutcomeStatus::AlreadyComplete: return "AlreadyComplete";
    case ResearchOutcomeStatus::RetrievalUnavailable: return "RetrievalUnavailable";
    case ResearchOutcomeStatus::RedactionRefused: return "RedactionRefused";
    case ResearchOutcomeStatus::RequestRejected: return "RequestRejected";
    case ResearchOutcomeStatus::PolicyLocalOnly: return "PolicyLocalOnly";
    case ResearchOutcomeStatus::InsufficientDiversity: return "InsufficientDiversity";
    case ResearchOutcomeStatus::ApprovalDenied: return "ApprovalDenied";
    case ResearchOutcomeStatus::ContractInvalid: return "ContractInvalid";
  }
  return "RetrievalUnavailable";
}

namespace {

std::string hex64(std::uint64_t v) {
  char buf[24];
  std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
  return std::string(buf);
}

std::string joinCommas(const std::vector<std::string>& v) {
  std::string out;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (i) out += ",";
    out += v[i];
  }
  return out;
}

// The 11.1 network policy label a request's privacy class demands. A request
// asking for the sidecar under a state labelled DeniedByDefault is a policy
// mismatch the node refuses, rather than quietly widening the label.
bool policyPermits(const WorkflowState& state, const retrieval::SearchRequest& request,
                   std::string& why) {
  if (request.privacy_class == retrieval::NetworkPrivacyClass::LocalIndexOnly) return true;
  if (state.policy().network == NetworkPolicyLabel::SameMacSidecarOnly) return true;
  why = "workflow network policy label is DeniedByDefault; the request asks for SameMacSearxng";
  return false;
}

EvidenceEntry project(const retrieval::EvidenceRecord& r) {
  EvidenceEntry e;
  e.content_hash = r.content_hash;
  e.url = r.url;
  e.publisher = r.publisher;
  e.retrieval_time_utc = r.retrieval_time_utc;
  e.source_type = retrieval::sourceTypeName(r.source_type);
  e.esg_assertion_id = r.esg_assertion_id;
  // 12.3: these two fields are the ONLY place retrieved bytes land. They are
  // copied out of UntrustedText through its explicit storage accessor and are
  // never interpreted by this module.
  e.title = r.title.rawForStorage();
  e.quoted_span = r.quoted_span.rawForStorage();
  e.injection_attempt_flagged = r.injection_attempt_flagged;
  e.may_be_sole_authority = retrieval::mayBeSoleAuthorityForCriticalValue(r.source_type);
  return e;
}

std::size_t countDistinctPublishers(const std::vector<EvidenceEntry>& v) {
  std::set<std::string> seen;
  for (const EvidenceEntry& e : v) {
    if (!e.publisher.empty()) seen.insert(e.publisher);
  }
  return seen.size();
}

}  // namespace

// ── identity ────────────────────────────────────────────────────────────────
std::string ResearchNode::idempotencyKey(const retrieval::SearchRequest& r) {
  // Every field that can change WHAT IS ASKED or WHAT IS ACCEPTABLE goes into
  // the key. Two calls that differ in any of them are different work; two calls
  // that agree in all of them are a replay.
  std::string material;
  material += "q\t" + r.engineering_question + "\n";
  material += "esg\t" + r.esg_assertion_id + "\n";
  material += "jur\t" + r.jurisdiction + "\n";
  material += "std\t" + r.standard_edition + "\n";
  material += "fresh\t" + std::string(retrieval::freshnessName(r.freshness)) + "\n";
  material += "lang\t" + r.language + "\n";
  material += "inc\t" + joinCommas(r.include_domains) + "\n";
  material += "exc\t" + joinCommas(r.exclude_domains) + "\n";
  material += "primary\t" + std::string(r.prefer_primary_sources ? "1" : "0") + "\n";
  material += "privacy\t" +
              std::string(r.privacy_class == retrieval::NetworkPrivacyClass::LocalIndexOnly
                              ? "LocalIndexOnly"
                              : "SameMacSearxng") + "\n";
  material += "units\t" + joinCommas(r.expected_units) + "\n";
  material += "max_results\t" + std::to_string(r.max_results) + "\n";
  material += "min_pub\t" + std::to_string(r.min_distinct_publishers) + "\n";
  return "research-" + sha256Hex(material).substr(0, 32);
}

NodeContract ResearchNode::contract(const retrieval::SearchRequest& request) {
  NodeContract c;
  c.node_id = kNodeId;
  c.declared_inputs = {"search_request", "policy.network", "policy.privacy", "esg_assertion_id"};
  c.declared_outputs = {"evidence", "unresolved", "gates", "approvals", "observations"};
  c.read_effects = {"searxng.sidecar.loopback", "workflow.state"};
  // Evidence, gate and approval writes are content-addressed appends onto the
  // workflow state. Nothing here mutates the project graph or touches a file
  // outside the checkpoint directory.
  c.write_effects = {"workflow.state.evidence", "workflow.state.gates",
                     "workflow.state.approvals", "checkpoint.store"};
  // A search is a READ of the outside world that produces a content-addressed
  // record. It is not a project mutation, so a lost response may be retried.
  c.side_effect_class = SideEffectClass::ReproducibleDerivedWrite;
  c.idempotency_key = idempotencyKey(request);
  c.timeout_ms = request.max_time_ms == 0 ? 8000u : request.max_time_ms;
  // 11.4: only the data/tool/network class is retryable here. A policy block or
  // a redaction refusal is NOT retried — retrying it would just re-attempt a
  // transmission that policy already refused.
  c.retryable_error_classes = {FailureClass::DataToolOrNetworkFailure,
                               FailureClass::ResourceExhaustion};
  c.max_attempts = 2;
  c.checkpoint_policy = CheckpointPolicy::AfterEveryStateChange;
  // 20.2: the operator sees the exact outgoing bytes and grants, bound to them.
  c.approval_class = HumanApprovalClass::ExplicitApproval;
  return c;
}

// ── construction ────────────────────────────────────────────────────────────
ResearchNode::ResearchNode(std::shared_ptr<retrieval::SearxngClient> client,
                           std::shared_ptr<ApprovalProvider> approver,
                           CheckpointStore* checkpoints)
    : client_(std::move(client)), approver_(std::move(approver)), checkpoints_(checkpoints) {}

bool ResearchNode::checkpoint(const WorkflowState& state, const std::string& step_label,
                              std::string& err) {
  if (checkpoints_ == nullptr) { err.clear(); return true; }
  return checkpoints_->append(state, kNodeId, step_label, err);
}

// ── the node ────────────────────────────────────────────────────────────────
ResearchOutcome ResearchNode::run(WorkflowState& state,
                                  const retrieval::SearchRequest& request) {
  ResearchOutcome out;

  const NodeContract c = contract(request);
  std::string why;
  if (!c.validate(why)) {
    out.status = ResearchOutcomeStatus::ContractInvalid;
    out.failure = FailureClass::SchemaTypeUnitOrReference;
    out.detail = "node contract is under-declared: " + why;
    return out;
  }

  NodeProgress p = state.nodeProgress(kNodeId);
  // A different question re-uses the node id but is different work: its progress
  // starts from zero rather than inheriting the previous question's resume point.
  if (!p.idempotency_key.empty() && p.idempotency_key != c.idempotency_key) {
    p = NodeProgress();
    p.node_id = kNodeId;
  }
  p.node_id = kNodeId;
  p.idempotency_key = c.idempotency_key;

  out.steps_skipped = p.completed_steps;
  out.resumed = p.completed_steps > 0;

  // IDEMPOTENT REPLAY: a node whose steps are all durable does nothing at all.
  if (p.completed_steps >= kResearchStepCount) {
    out.status = ResearchOutcomeStatus::AlreadyComplete;
    out.failure = p.failure;
    out.detail = "all " + std::to_string(kResearchStepCount) + " steps already durable";
    out.distinct_publishers = countDistinctPublishers(state.evidence());
    return out;
  }

  // Every entry into the executing path is an attempt, including a resume: the
  // 11.1 retry ledger has to count the run that crashed.
  p.attempts += 1;
  p.status = NodeStatus::Running;
  state.mutableAccounting().retries = (p.attempts > 1) ? (p.attempts - 1u) : 0u;

  auto done = [&](ResearchStep s) {
    return p.completed_steps > static_cast<std::uint32_t>(s);
  };
  std::string cperr;
  auto commitStep = [&](ResearchStep s) -> bool {
    p.completed_steps = static_cast<std::uint32_t>(s) + 1u;
    state.setNodeProgress(p);
    ++out.steps_executed;
    if (!checkpoint(state, researchStepName(s), cperr)) return false;
    if (hook_) hook_(s);   // the gate throws here to simulate a dead process
    return true;
  };
  auto abort = [&](ResearchStep s, NodeStatus status, FailureClass f,
                   ResearchOutcomeStatus os, const std::string& detail) {
    p.status = status;
    p.failure = f;
    p.detail = researchOutcomeName(os);   // never retrieved text
    state.setNodeProgress(p);
    state.setFailure(f);
    ++out.steps_executed;
    std::string err;
    checkpoint(state, std::string(researchStepName(s)) + ":failed", err);
    out.status = os;
    out.failure = f;
    out.detail = detail;
  };

  // ── step 0: register the contract ─────────────────────────────────────────
  if (!done(ResearchStep::RegisterContract)) {
    if (!policyPermits(state, request, why)) {
      abort(ResearchStep::RegisterContract, NodeStatus::Blocked,
            FailureClass::PolicyPermissionOrSourceBlock,
            ResearchOutcomeStatus::PolicyLocalOnly, why);
      return out;
    }
    state.registerContract(c);
    p.failure = FailureClass::None;
    p.detail = "running";
    if (!commitStep(ResearchStep::RegisterContract)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  }

  // ── step 1: build the preview ─────────────────────────────────────────────
  // The preview is a PURE function of the request (redaction has no state and
  // touches no socket), so it is recomputed on resume rather than persisted.
  retrieval::QueryPreview preview;
  if (!done(ResearchStep::Transmit)) preview = client_->preview(request);

  if (!done(ResearchStep::BuildPreview)) {
    if (!preview.sendable()) {
      ResearchOutcomeStatus os = ResearchOutcomeStatus::RequestRejected;
      FailureClass fc = FailureClass::SchemaTypeUnitOrReference;
      if (preview.status == retrieval::RequestBuildStatus::PrivacyClassForbidsNetwork) {
        os = ResearchOutcomeStatus::PolicyLocalOnly;
        fc = FailureClass::PolicyPermissionOrSourceBlock;
      } else if (preview.status == retrieval::RequestBuildStatus::RedactionResidueDetected) {
        os = ResearchOutcomeStatus::RedactionRefused;
        fc = FailureClass::PolicyPermissionOrSourceBlock;
      }
      abort(ResearchStep::BuildPreview, NodeStatus::Blocked, fc, os, preview.status_detail);
      return out;
    }
    if (!commitStep(ResearchStep::BuildPreview)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  }

  // ── step 2: the operator sees the exact bytes and grants ─────────────────
  if (!done(ResearchStep::RecordApproval)) {
    if (!approver_ || !approver_->review(preview)) {
      abort(ResearchStep::RecordApproval, NodeStatus::Blocked,
            FailureClass::PolicyPermissionOrSourceBlock, ResearchOutcomeStatus::ApprovalDenied,
            "the operator did not approve the previewed request");
      return out;
    }
    ApprovalRecord a;
    a.node_id = kNodeId;
    a.approval_class = HumanApprovalClass::ExplicitApproval;
    a.bound_digest = hex64(preview.body_digest);
    a.approver = approver_->approverName();
    state.recordApproval(a);
    p.status = NodeStatus::Running;
    if (!commitStep(ResearchStep::RecordApproval)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  }

  // ── step 3: transmit ──────────────────────────────────────────────────────
  if (!done(ResearchStep::Transmit)) {
    const retrieval::SendApproval approval = retrieval::SendApproval::grant(preview);
    const retrieval::RetrievalResult result = client_->search(preview, approval);
    out.transmit_attempts = result.transmit_attempts;

    if (result.status != retrieval::RetrievalStatus::Ok &&
        result.status != retrieval::RetrievalStatus::INSUFFICIENT_DIVERSITY) {
      // FAIL CLOSED. No second transport, no alternate endpoint, no local
      // substitute. The question is recorded as unresolved (12.4) and the node
      // commits no evidence whatsoever.
      ResearchOutcomeStatus os = ResearchOutcomeStatus::RetrievalUnavailable;
      FailureClass fc = FailureClass::DataToolOrNetworkFailure;
      switch (result.status) {
        case retrieval::RetrievalStatus::REDACTION_REFUSED:
          os = ResearchOutcomeStatus::RedactionRefused;
          fc = FailureClass::PolicyPermissionOrSourceBlock;
          break;
        case retrieval::RetrievalStatus::REQUEST_REJECTED:
          os = ResearchOutcomeStatus::RequestRejected;
          fc = FailureClass::SchemaTypeUnitOrReference;
          break;
        case retrieval::RetrievalStatus::POLICY_LOCAL_ONLY:
          os = ResearchOutcomeStatus::PolicyLocalOnly;
          fc = FailureClass::PolicyPermissionOrSourceBlock;
          break;
        default:
          break;
      }
      UnresolvedQuestion u;
      u.esg_assertion_id = request.esg_assertion_id;
      // The reason is the STATUS NAME, not the transport's free text: an
      // unresolved-question ledger entry is control-plane data.
      u.reason = retrieval::retrievalStatusName(result.status);
      u.freshness_dependent = request.freshness != retrieval::FreshnessWindow::Any;
      state.recordUnresolved(u);
      GateResult g;
      g.gate_id = "12.4-retrieval-available";
      g.passed = false;
      g.failure = fc;
      g.detail = retrieval::retrievalStatusName(result.status);
      state.recordGate(g);
      abort(ResearchStep::Transmit, NodeStatus::Failed, fc, os, result.detail);
      return out;
    }

    std::vector<EvidenceEntry> staged;
    staged.reserve(result.evidence.size());
    for (const retrieval::EvidenceRecord& r : result.evidence) staged.push_back(project(r));
    // Staging BEFORE the checkpoint is what makes a crash here resumable without
    // a second transmission.
    state.stageEvidence(c.idempotency_key, std::move(staged));
    if (!commitStep(ResearchStep::Transmit)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  }

  // ── step 4: commit the staged evidence ────────────────────────────────────
  bool diversity_ok = true;
  if (!done(ResearchStep::CommitEvidence)) {
    const std::vector<EvidenceEntry> staged = state.stagedEvidence();
    const std::string staged_key = state.stagedKey();
    std::size_t added = 0, dup = 0;
    state.commitEvidence(staged_key.empty() ? c.idempotency_key : staged_key, staged, added, dup);
    out.evidence_added = added;
    out.duplicates_skipped = dup;

    for (const EvidenceEntry& e : staged) {
      if (!e.injection_attempt_flagged) continue;
      ++out.injection_attempts_flagged;
      // 12.3: the attempt is RECORDED so a reviewer can see the source tried.
      // The observation carries the URL and the content hash — identifiers this
      // module derived — and NOT one byte of the page's own text.
      ObservationEntry ob;
      ob.key = "12.3-injection-attempt-observed";
      ob.value = e.url + " " + e.content_hash;
      state.addObservation(ob);
    }

    const std::size_t publishers = countDistinctPublishers(state.evidence());
    out.distinct_publishers = publishers;
    diversity_ok = staged.empty() || publishers >= request.min_distinct_publishers;
    GateResult g;
    g.gate_id = "12.2-source-diversity";
    g.passed = diversity_ok;
    g.failure = diversity_ok ? FailureClass::None : FailureClass::PolicyPermissionOrSourceBlock;
    g.detail = std::to_string(publishers) + " distinct publishers, " +
               std::to_string(request.min_distinct_publishers) + " required";
    state.recordGate(g);
    state.clearStaged();

    if (!commitStep(ResearchStep::CommitEvidence)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  } else {
    out.distinct_publishers = countDistinctPublishers(state.evidence());
    for (const GateResult& g : state.gates()) {
      if (g.gate_id == "12.2-source-diversity") diversity_ok = g.passed;
    }
  }

  // ── step 5: complete ──────────────────────────────────────────────────────
  if (!done(ResearchStep::Complete)) {
    if (diversity_ok) {
      p.status = NodeStatus::Succeeded;
      p.failure = FailureClass::None;
      p.detail = "Succeeded";
      out.status = ResearchOutcomeStatus::Succeeded;
      out.failure = FailureClass::None;
      out.detail = "evidence committed";
    } else {
      p.status = NodeStatus::Failed;
      p.failure = FailureClass::PolicyPermissionOrSourceBlock;
      p.detail = "InsufficientDiversity";
      state.setFailure(FailureClass::PolicyPermissionOrSourceBlock);
      out.status = ResearchOutcomeStatus::InsufficientDiversity;
      out.failure = FailureClass::PolicyPermissionOrSourceBlock;
      out.detail = "source-diversity requirement unmet; evidence retained and visible";
    }
    if (!commitStep(ResearchStep::Complete)) {
      out.detail = "checkpoint failed: " + cperr;
      out.failure = FailureClass::ResourceExhaustion;
      return out;
    }
  }
  return out;
}

}  // namespace forge::orch
