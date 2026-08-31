#include "forge/orch/NodeContract.hpp"

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "forge/orch/WorkflowState.hpp"   // canon::escape / unescape / splitFields

namespace forge::orch {

// ── enum names ──────────────────────────────────────────────────────────────
const char* nodeStatusName(NodeStatus s) {
  switch (s) {
    case NodeStatus::NotStarted: return "NotStarted";
    case NodeStatus::Running: return "Running";
    case NodeStatus::AwaitingApproval: return "AwaitingApproval";
    case NodeStatus::Succeeded: return "Succeeded";
    case NodeStatus::Failed: return "Failed";
    case NodeStatus::Blocked: return "Blocked";
  }
  return "NotStarted";
}

bool parseNodeStatus(const std::string& text, NodeStatus& out) {
  const NodeStatus all[] = {NodeStatus::NotStarted, NodeStatus::Running,
                            NodeStatus::AwaitingApproval, NodeStatus::Succeeded,
                            NodeStatus::Failed, NodeStatus::Blocked};
  for (NodeStatus s : all) {
    if (text == nodeStatusName(s)) { out = s; return true; }
  }
  return false;
}

const char* failureClassName(FailureClass f) {
  switch (f) {
    case FailureClass::None: return "None";
    case FailureClass::MalformedIr: return "MalformedIr";
    case FailureClass::SchemaTypeUnitOrReference: return "SchemaTypeUnitOrReference";
    case FailureClass::ImpossibleOrContradictorySpec: return "ImpossibleOrContradictorySpec";
    case FailureClass::SketchConflictOrUnderconstraint: return "SketchConflictOrUnderconstraint";
    case FailureClass::KernelNumericOrDegeneracy: return "KernelNumericOrDegeneracy";
    case FailureClass::TopologicalNamingAmbiguity: return "TopologicalNamingAmbiguity";
    case FailureClass::VerificationMismatch: return "VerificationMismatch";
    case FailureClass::ManufacturingOrPhysicsViolation: return "ManufacturingOrPhysicsViolation";
    case FailureClass::DataToolOrNetworkFailure: return "DataToolOrNetworkFailure";
    case FailureClass::ResourceExhaustion: return "ResourceExhaustion";
    case FailureClass::PolicyPermissionOrSourceBlock: return "PolicyPermissionOrSourceBlock";
  }
  return "None";
}

namespace {
const FailureClass kAllFailureClasses[] = {
    FailureClass::None,
    FailureClass::MalformedIr,
    FailureClass::SchemaTypeUnitOrReference,
    FailureClass::ImpossibleOrContradictorySpec,
    FailureClass::SketchConflictOrUnderconstraint,
    FailureClass::KernelNumericOrDegeneracy,
    FailureClass::TopologicalNamingAmbiguity,
    FailureClass::VerificationMismatch,
    FailureClass::ManufacturingOrPhysicsViolation,
    FailureClass::DataToolOrNetworkFailure,
    FailureClass::ResourceExhaustion,
    FailureClass::PolicyPermissionOrSourceBlock,
};
}  // namespace

bool parseFailureClass(const std::string& text, FailureClass& out) {
  for (FailureClass f : kAllFailureClasses) {
    if (text == failureClassName(f)) { out = f; return true; }
  }
  return false;
}

// 11.4: "The system chooses a repair operator specific to the class. Blindly
// resampling the entire answer is prohibited after a localized failure is
// known." Every operator below is local to its class.
const char* repairOperatorFor(FailureClass f) {
  switch (f) {
    case FailureClass::None: return "none";
    case FailureClass::MalformedIr: return "reparse-and-repair-failing-lines";
    case FailureClass::SchemaTypeUnitOrReference: return "rebind-reference-and-normalize-units";
    case FailureClass::ImpossibleOrContradictorySpec: return "raise-ambiguity-for-operator";
    case FailureClass::SketchConflictOrUnderconstraint: return "add-missing-constraint";
    case FailureClass::KernelNumericOrDegeneracy: return "perturb-tolerance-and-retry-op";
    case FailureClass::TopologicalNamingAmbiguity: return "re-resolve-persistent-name";
    case FailureClass::VerificationMismatch: return "localize-to-failing-predicate";
    case FailureClass::ManufacturingOrPhysicsViolation: return "apply-dfm-repair-to-feature";
    case FailureClass::DataToolOrNetworkFailure: return "fail-closed-and-mark-unresolved";
    case FailureClass::ResourceExhaustion: return "reduce-chunk-size-and-resume";
    case FailureClass::PolicyPermissionOrSourceBlock: return "stop-and-report-policy-block";
  }
  return "none";
}

const char* sideEffectClassName(SideEffectClass c) {
  switch (c) {
    case SideEffectClass::PureReadOnly: return "PureReadOnly";
    case SideEffectClass::ReproducibleDerivedWrite: return "ReproducibleDerivedWrite";
    case SideEffectClass::ProjectMutation: return "ProjectMutation";
    case SideEffectClass::ReviewedLocalPackage: return "ReviewedLocalPackage";
    case SideEffectClass::LocallyAttachedHighImpact: return "LocallyAttachedHighImpact";
  }
  return "PureReadOnly";
}

bool parseSideEffectClass(const std::string& text, SideEffectClass& out) {
  const SideEffectClass all[] = {
      SideEffectClass::PureReadOnly, SideEffectClass::ReproducibleDerivedWrite,
      SideEffectClass::ProjectMutation, SideEffectClass::ReviewedLocalPackage,
      SideEffectClass::LocallyAttachedHighImpact};
  for (SideEffectClass c : all) {
    if (text == sideEffectClassName(c)) { out = c; return true; }
  }
  return false;
}

const char* sideEffectDefaultBehavior(SideEffectClass c) {
  switch (c) {
    case SideEffectClass::PureReadOnly:
      return "retry safely under policy";
    case SideEffectClass::ReproducibleDerivedWrite:
      return "write content-addressed artifact";
    case SideEffectClass::ProjectMutation:
      return "transactional and versioned";
    case SideEffectClass::ReviewedLocalPackage:
      return "preview, local export, and approval record; Archie does not transmit it";
    case SideEffectClass::LocallyAttachedHighImpact:
      return "separate authorization, domain interlock, and no direct machine motion";
  }
  return "";
}

bool replaySafeOnLostResponse(SideEffectClass c) {
  switch (c) {
    case SideEffectClass::PureReadOnly:
    case SideEffectClass::ReproducibleDerivedWrite:
      return true;
    case SideEffectClass::ProjectMutation:
    case SideEffectClass::ReviewedLocalPackage:
    case SideEffectClass::LocallyAttachedHighImpact:
      return false;
  }
  return false;
}

bool forbidsArchieTransmission(SideEffectClass c) {
  return c == SideEffectClass::ReviewedLocalPackage ||
         c == SideEffectClass::LocallyAttachedHighImpact;
}

const char* approvalClassName(HumanApprovalClass a) {
  switch (a) {
    case HumanApprovalClass::None: return "None";
    case HumanApprovalClass::PreviewOnly: return "PreviewOnly";
    case HumanApprovalClass::ExplicitApproval: return "ExplicitApproval";
    case HumanApprovalClass::SeparateAuthorizationAndInterlock:
      return "SeparateAuthorizationAndInterlock";
  }
  return "None";
}

bool parseApprovalClass(const std::string& text, HumanApprovalClass& out) {
  const HumanApprovalClass all[] = {HumanApprovalClass::None, HumanApprovalClass::PreviewOnly,
                                    HumanApprovalClass::ExplicitApproval,
                                    HumanApprovalClass::SeparateAuthorizationAndInterlock};
  for (HumanApprovalClass a : all) {
    if (text == approvalClassName(a)) { out = a; return true; }
  }
  return false;
}

const char* checkpointPolicyName(CheckpointPolicy p) {
  switch (p) {
    case CheckpointPolicy::Never: return "Never";
    case CheckpointPolicy::OnNodeCompletion: return "OnNodeCompletion";
    case CheckpointPolicy::AfterEveryStateChange: return "AfterEveryStateChange";
  }
  return "Never";
}

bool parseCheckpointPolicy(const std::string& text, CheckpointPolicy& out) {
  const CheckpointPolicy all[] = {CheckpointPolicy::Never, CheckpointPolicy::OnNodeCompletion,
                                  CheckpointPolicy::AfterEveryStateChange};
  for (CheckpointPolicy p : all) {
    if (text == checkpointPolicyName(p)) { out = p; return true; }
  }
  return false;
}

const char* replayVerdictName(ReplayVerdict v) {
  switch (v) {
    case ReplayVerdict::Allowed: return "Allowed";
    case ReplayVerdict::RefusedNonIdempotentOnLostResponse:
      return "RefusedNonIdempotentOnLostResponse";
    case ReplayVerdict::RefusedNotRetryableClass: return "RefusedNotRetryableClass";
    case ReplayVerdict::RefusedAttemptsExhausted: return "RefusedAttemptsExhausted";
  }
  return "RefusedNotRetryableClass";
}

// ── contract ────────────────────────────────────────────────────────────────
bool NodeContract::validate(std::string& why) const {
  why.clear();
  if (node_id.empty()) { why = "node_id is empty"; return false; }
  if (declared_inputs.empty()) { why = "no declared inputs"; return false; }
  if (declared_outputs.empty()) { why = "no declared outputs"; return false; }
  if (read_effects.empty() && write_effects.empty()) {
    why = "neither read nor write effects declared";
    return false;
  }
  if (idempotency_key.empty()) { why = "no idempotency key"; return false; }
  if (timeout_ms == 0) { why = "no timeout declared"; return false; }
  if (max_attempts == 0) { why = "max_attempts is zero"; return false; }
  if (checkpoint_policy == CheckpointPolicy::Never && max_attempts > 1) {
    why = "a retryable node with no checkpoint policy cannot resume";
    return false;
  }
  // A node that declares retries but no retryable class can never actually
  // retry; that is an under-declared contract, not a working one.
  if (max_attempts > 1 && retryable_error_classes.empty()) {
    why = "max_attempts > 1 but no retryable error classes declared";
    return false;
  }
  // 11.2's high-impact row demands a separate authorization, so a contract that
  // claims that class with a weaker approval is refused outright.
  if (side_effect_class == SideEffectClass::LocallyAttachedHighImpact &&
      approval_class != HumanApprovalClass::SeparateAuthorizationAndInterlock) {
    why = "LocallyAttachedHighImpact requires SeparateAuthorizationAndInterlock";
    return false;
  }
  if (side_effect_class != SideEffectClass::PureReadOnly && write_effects.empty()) {
    why = "a non-read-only class must declare at least one write effect";
    return false;
  }
  return true;
}

bool NodeContract::isRetryable(FailureClass f) const {
  for (FailureClass c : retryable_error_classes) {
    if (c == f) return true;
  }
  return false;
}

namespace {

std::string joinEscaped(const std::vector<std::string>& v) {
  std::string out;
  for (std::size_t i = 0; i < v.size(); ++i) {
    if (i) out += ",";
    out += canon::escape(v[i]);
  }
  return out;
}

std::vector<std::string> splitCommas(const std::string& s) {
  std::vector<std::string> out;
  if (s.empty()) return out;
  std::size_t start = 0;
  while (true) {
    const std::size_t comma = s.find(',', start);
    if (comma == std::string::npos) {
      out.push_back(canon::unescape(s.substr(start)));
      break;
    }
    out.push_back(canon::unescape(s.substr(start, comma - start)));
    start = comma + 1;
  }
  return out;
}

}  // namespace

std::string NodeContract::canonicalForm() const {
  std::string classes;
  for (std::size_t i = 0; i < retryable_error_classes.size(); ++i) {
    if (i) classes += ",";
    classes += failureClassName(retryable_error_classes[i]);
  }
  std::string out;
  out += canon::escape(node_id);
  out += "\t"; out += joinEscaped(declared_inputs);
  out += "\t"; out += joinEscaped(declared_outputs);
  out += "\t"; out += joinEscaped(read_effects);
  out += "\t"; out += joinEscaped(write_effects);
  out += "\t"; out += sideEffectClassName(side_effect_class);
  out += "\t"; out += canon::escape(idempotency_key);
  out += "\t"; out += std::to_string(timeout_ms);
  out += "\t"; out += classes;
  out += "\t"; out += std::to_string(max_attempts);
  out += "\t"; out += checkpointPolicyName(checkpoint_policy);
  out += "\t"; out += approvalClassName(approval_class);
  return out;
}

bool NodeContract::parseCanonicalForm(const std::string& line, NodeContract& out,
                                      std::string& err) {
  const std::vector<std::string> f = canon::splitFields(line);
  if (f.size() != 12) {
    err = "expected 12 contract fields, got " + std::to_string(f.size());
    return false;
  }
  NodeContract c;
  c.node_id = canon::unescape(f[0]);
  c.declared_inputs = splitCommas(f[1]);
  c.declared_outputs = splitCommas(f[2]);
  c.read_effects = splitCommas(f[3]);
  c.write_effects = splitCommas(f[4]);
  if (!parseSideEffectClass(f[5], c.side_effect_class)) {
    err = "unknown side-effect class '" + f[5] + "'";
    return false;
  }
  c.idempotency_key = canon::unescape(f[6]);
  c.timeout_ms = static_cast<std::uint32_t>(std::strtoul(f[7].c_str(), nullptr, 10));
  for (const std::string& name : splitCommas(f[8])) {
    FailureClass fc = FailureClass::None;
    if (!parseFailureClass(name, fc)) {
      err = "unknown failure class '" + name + "'";
      return false;
    }
    c.retryable_error_classes.push_back(fc);
  }
  c.max_attempts = static_cast<std::uint32_t>(std::strtoul(f[9].c_str(), nullptr, 10));
  if (!parseCheckpointPolicy(f[10], c.checkpoint_policy)) {
    err = "unknown checkpoint policy '" + f[10] + "'";
    return false;
  }
  if (!parseApprovalClass(f[11], c.approval_class)) {
    err = "unknown approval class '" + f[11] + "'";
    return false;
  }
  out = std::move(c);
  return true;
}

// ── the 11.2 scheduler rule ─────────────────────────────────────────────────
ReplayVerdict mayReplay(const NodeContract& contract, FailureClass observed,
                        std::uint32_t attempts_so_far, bool response_lost) {
  // FIRST, and unconditionally: a lost response on a non-idempotent class is
  // never replayed. No retry budget and no retryable-class list can reach past
  // this check, which is precisely what 11.2 requires.
  if (response_lost && !replaySafeOnLostResponse(contract.side_effect_class)) {
    return ReplayVerdict::RefusedNonIdempotentOnLostResponse;
  }
  if (!response_lost && !contract.isRetryable(observed)) {
    return ReplayVerdict::RefusedNotRetryableClass;
  }
  if (attempts_so_far >= contract.max_attempts) {
    return ReplayVerdict::RefusedAttemptsExhausted;
  }
  return ReplayVerdict::Allowed;
}

}  // namespace forge::orch
