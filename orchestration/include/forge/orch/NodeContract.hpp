// ─────────────────────────────────────────────────────────────────────────────
// NodeContract.hpp — SACROSANCT 11.2 node contract + 11.4 failure taxonomy.
//
// 11.2: "Each workflow node declares inputs, outputs, read effects, write
// effects, idempotency key, timeout, retryable error classes, checkpoint policy,
// and human-approval class." Every one of those is a field below, and
// NodeContract::validate() REFUSES a contract that leaves any of them unstated.
// A node that forgets to declare its effects cannot run.
//
// 11.2 also assigns every tool call a SIDE-EFFECT CLASS, and states the rule the
// scheduler must obey:
//
//     "The scheduler must not replay a non-idempotent project mutation, local
//      export, or locally attached physical action merely because a process
//      response was lost."
//
// That sentence is implemented as mayReplay(), a pure function with a typed
// verdict, so it can be tested rather than trusted. Pure/read-only and
// reproducible-derived-write are replay-safe on a lost response; the other three
// classes are NOT, and mayReplay() returns RefusedNonIdempotentOnLostResponse
// for them no matter what the retry budget says.
//
// Pure C++20 + the standard library.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace forge::orch {

// ── node execution status ───────────────────────────────────────────────────
enum class NodeStatus {
  NotStarted,
  Running,
  AwaitingApproval,
  Succeeded,
  Failed,
  Blocked,
};
const char* nodeStatusName(NodeStatus s);
bool parseNodeStatus(const std::string& text, NodeStatus& out);

// ── 11.4 error taxonomy ─────────────────────────────────────────────────────
// Errors are classified BEFORE retry, and the repair operator is chosen for the
// class. "Blindly resampling the entire answer is prohibited after a localized
// failure is known."
enum class FailureClass {
  None,
  MalformedIr,
  SchemaTypeUnitOrReference,
  ImpossibleOrContradictorySpec,
  SketchConflictOrUnderconstraint,
  KernelNumericOrDegeneracy,
  TopologicalNamingAmbiguity,
  VerificationMismatch,
  ManufacturingOrPhysicsViolation,
  DataToolOrNetworkFailure,
  ResourceExhaustion,
  PolicyPermissionOrSourceBlock,
};

const char* failureClassName(FailureClass f);
bool parseFailureClass(const std::string& text, FailureClass& out);
// The repair operator the taxonomy selects for this class. Never "resample
// everything": that string is not producible by this function.
const char* repairOperatorFor(FailureClass f);

// ── 11.2 side-effect classes ────────────────────────────────────────────────
enum class SideEffectClass {
  PureReadOnly,                 // inspect graph, calculate property, local index search
  ReproducibleDerivedWrite,     // render view, compile chunk, local report
  ProjectMutation,              // commit graph revision, update drawing
  ReviewedLocalPackage,         // RFQ/ECO/release files prepared for manual transfer
  LocallyAttachedHighImpact,    // write an approved controller package to local media
};

const char* sideEffectClassName(SideEffectClass c);
bool parseSideEffectClass(const std::string& text, SideEffectClass& out);
// The default behaviour 11.2's table assigns to the class.
const char* sideEffectDefaultBehavior(SideEffectClass c);
// True only for the two classes whose repetition is harmless.
bool replaySafeOnLostResponse(SideEffectClass c);
// 11.2: Archie does not transmit a reviewed local package, and does not drive
// machine motion. True when the class forbids Archie transmitting the result.
bool forbidsArchieTransmission(SideEffectClass c);

// ── 11.2 approval + checkpoint policy ───────────────────────────────────────
enum class HumanApprovalClass {
  None,
  PreviewOnly,                       // operator sees it; no explicit grant needed
  ExplicitApproval,                  // operator must grant, bound to exact bytes
  SeparateAuthorizationAndInterlock, // 11.2 locally-attached high-impact row
};
const char* approvalClassName(HumanApprovalClass a);
bool parseApprovalClass(const std::string& text, HumanApprovalClass& out);

enum class CheckpointPolicy {
  Never,
  OnNodeCompletion,
  AfterEveryStateChange,
};
const char* checkpointPolicyName(CheckpointPolicy p);
bool parseCheckpointPolicy(const std::string& text, CheckpointPolicy& out);

// ── the contract ────────────────────────────────────────────────────────────
struct NodeContract {
  std::string node_id;

  std::vector<std::string> declared_inputs;   // typed state keys read
  std::vector<std::string> declared_outputs;  // typed state keys written
  std::vector<std::string> read_effects;      // resources observed
  std::vector<std::string> write_effects;     // resources changed

  SideEffectClass side_effect_class = SideEffectClass::PureReadOnly;

  // Stable over the node's inputs. Two runs with the same inputs share a key,
  // which is what makes a replay detectable as a replay.
  std::string idempotency_key;

  std::uint32_t timeout_ms = 0;
  std::vector<FailureClass> retryable_error_classes;
  std::uint32_t max_attempts = 1;

  CheckpointPolicy checkpoint_policy = CheckpointPolicy::AfterEveryStateChange;
  HumanApprovalClass approval_class = HumanApprovalClass::None;

  // Refuses an under-declared contract. `why` names the missing declaration.
  bool validate(std::string& why) const;
  bool isRetryable(FailureClass f) const;

  // Deterministic single-line rendering, used for the registry digest and for
  // the durable checkpoint. Field order is fixed.
  std::string canonicalForm() const;
  static bool parseCanonicalForm(const std::string& line, NodeContract& out, std::string& err);
};

// ── the 11.2 scheduler rule ─────────────────────────────────────────────────
enum class ReplayVerdict {
  Allowed,
  RefusedNonIdempotentOnLostResponse,
  RefusedNotRetryableClass,
  RefusedAttemptsExhausted,
};
const char* replayVerdictName(ReplayVerdict v);

// `response_lost` distinguishes "we never learned the outcome" from "we observed
// a classified failure". The first is exactly the case 11.2 forbids replaying
// for a non-idempotent class, and it is checked FIRST so no retry budget can
// override it.
ReplayVerdict mayReplay(const NodeContract& contract,
                        FailureClass observed,
                        std::uint32_t attempts_so_far,
                        bool response_lost);

// ── per-node progress, carried on the workflow state ─────────────────────────
// `completed_steps` is the resume point: the number of the node's ordered steps
// that are durably committed. A node re-entered after a crash skips exactly that
// many steps.
struct NodeProgress {
  std::string node_id;
  NodeStatus status = NodeStatus::NotStarted;
  std::uint32_t attempts = 0;
  std::uint32_t completed_steps = 0;
  FailureClass failure = FailureClass::None;
  std::string idempotency_key;
  std::string detail;
};

}  // namespace forge::orch
