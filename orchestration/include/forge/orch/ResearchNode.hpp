// ─────────────────────────────────────────────────────────────────────────────
// ResearchNode.hpp — ONE real workflow node.
//
// It takes a typed engineering question (retrieval::SearchRequest), drives the
// proven SearXNG client through its redact → preview → approve → send gates, and
// commits the returned EvidenceRecords onto the WorkflowState. It is the only
// node in this module: the point is a working durable slice, not a framework.
//
// FOUR PROPERTIES, EACH ENFORCED BY THE CODE AND TESTED IN THE GATE.
//
//  1. DURABLE AND RESUMABLE. The node is a fixed sequence of six ordered steps.
//     Every state-changing step ends in a checkpoint, and the number of durably
//     completed steps lives on NodeProgress. Re-entering run() after a crash
//     skips exactly the steps that are already committed. Because the parsed
//     evidence is STAGED on the state before the ingest step, a crash after
//     transmission resumes WITHOUT a second transmission.
//
//  2. IDEMPOTENT. The idempotency key is derived from the request's meaningful
//     fields. A completed node replays as a no-op, and a commit under a key that
//     is already committed adds nothing. Evidence is additionally content-
//     addressed, so the same page cannot be counted twice.
//
//  3. FAIL CLOSED. A missing sidecar yields RetrievalUnavailable. This class
//     holds exactly one SearxngClient and constructs nothing: there is no second
//     transport, no alternate endpoint, no local-index substitution and no
//     compute fallback anywhere in it. On that path the node records a 12.4
//     unresolved question and commits no evidence at all.
//
//  4. RETRIEVAL IS NOT EXECUTION (12.3). Nothing the node reads out of a result
//     can name a node, a tool, a gate, an approval, a policy label or a next
//     step. Retrieved bytes reach only EvidenceEntry::title / ::quoted_span,
//     which the control plane excludes. See WorkflowState::controlPlaneDigest().
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <utility>

#include "forge/orch/CheckpointStore.hpp"
#include "forge/orch/NodeContract.hpp"
#include "forge/orch/WorkflowState.hpp"
#include "forge/retrieval/SearchRequest.hpp"
#include "forge/retrieval/SearxngClient.hpp"

namespace forge::orch {

// The node's ordered steps. `completed_steps` on NodeProgress is an index into
// this list, which is why the order is fixed and the list is public.
enum class ResearchStep : std::uint32_t {
  RegisterContract = 0,
  BuildPreview = 1,
  RecordApproval = 2,
  Transmit = 3,
  CommitEvidence = 4,
  Complete = 5,
};
inline constexpr std::uint32_t kResearchStepCount = 6;
const char* researchStepName(ResearchStep s);

enum class ResearchOutcomeStatus {
  Succeeded,
  AlreadyComplete,        // idempotent replay of a finished node
  RetrievalUnavailable,   // 12.4 fail-closed
  RedactionRefused,
  RequestRejected,
  PolicyLocalOnly,
  InsufficientDiversity,
  ApprovalDenied,
  ContractInvalid,
};
const char* researchOutcomeName(ResearchOutcomeStatus s);

struct ResearchOutcome {
  ResearchOutcomeStatus status = ResearchOutcomeStatus::RetrievalUnavailable;
  FailureClass failure = FailureClass::None;
  std::string detail;
  std::size_t evidence_added = 0;
  std::size_t duplicates_skipped = 0;
  std::size_t injection_attempts_flagged = 0;
  std::size_t distinct_publishers = 0;
  std::uint32_t steps_executed = 0;   // steps this call actually ran
  std::uint32_t steps_skipped = 0;    // steps already durable when it started
  int transmit_attempts = 0;          // socket writes attempted by THIS call
  bool resumed = false;
};

// 20.2's preview duty. The provider is shown exactly the bytes that will be
// transmitted and returns the grant decision. Injectable so the gate is headless
// — production supplies the operator-facing implementation.
class ApprovalProvider {
public:
  virtual ~ApprovalProvider() = default;
  virtual bool review(const retrieval::QueryPreview& preview) = 0;
  virtual std::string approverName() const { return "operator"; }
};

// Grants any sendable preview. For headless tests and unattended runs only.
class AutoApprovalProvider final : public ApprovalProvider {
public:
  bool review(const retrieval::QueryPreview& preview) override { return preview.sendable(); }
  std::string approverName() const override { return "headless-auto"; }
};

class ResearchNode {
public:
  ResearchNode(std::shared_ptr<retrieval::SearxngClient> client,
               std::shared_ptr<ApprovalProvider> approver,
               CheckpointStore* checkpoints);

  static const char* kNodeId;

  // Stable over the request's meaningful fields. Two runs of the same question
  // under the same policy share a key; changing the question changes it.
  static std::string idempotencyKey(const retrieval::SearchRequest& request);

  // The node's 11.2 contract, with the idempotency key bound to this request.
  static NodeContract contract(const retrieval::SearchRequest& request);

  // Called immediately AFTER each step's checkpoint is durable. The gate uses it
  // to kill the node mid-flight by throwing, which is what "interrupted" means
  // here: run() does not catch it, so the exception leaves the node exactly as a
  // dead process would.
  void setStepInterceptor(std::function<void(ResearchStep)> hook) { hook_ = std::move(hook); }

  ResearchOutcome run(WorkflowState& state, const retrieval::SearchRequest& request);

private:
  bool checkpoint(const WorkflowState& state, const std::string& step_label, std::string& err);

  std::shared_ptr<retrieval::SearxngClient> client_;
  std::shared_ptr<ApprovalProvider> approver_;
  CheckpointStore* checkpoints_;
  std::function<void(ResearchStep)> hook_;
};

}  // namespace forge::orch
