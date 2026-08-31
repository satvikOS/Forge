// ui/include/forge/ui/ArchieConversation.hpp
//
// THE CONVERSATION — the surface a person actually talks to Archie through, and
// the place a MODEL'S PROPOSAL is turned into something a human can rule on one
// line at a time.
//
// ArchieCopilot (ArchieCopilot.hpp) models a WHOLE-PLAN offer: one plan, one
// Apply, one Discard. That is the right model for a two-step plan and the wrong
// one for the parts this app exists for — a 14-op tree against a 430-face solid,
// where "accept" and "reject" are not the only two things a user wants to say.
// This file is the per-step model: every proposed op carries its own
// op-constraint verdict, and each one can be ACCEPTED, REJECTED, or EDITED AND
// THEN ACCEPTED.
//
// ★IT ADDS NO SECOND VALIDATOR AND NO SECOND DISPATCH PATH. Every ruling here
// comes from validatePlan() and every dispatch from applyPlan() — the same two
// functions ArchieCopilot calls, over the same OpConstraintBridge built from the
// same generated vocabulary. A step's verdict is literally validatePlan()'s
// verdict for the one-step plan that step would become, and
// archie_conversation_test asserts that equality rather than trusting it. What
// is new here is the CONVERSATION: turns, dispositions, editing, grounding, and
// the approval of a tool call.
//
// ── 1. GROUNDING ────────────────────────────────────────────────────────────
// "Shrink the diameter of the largest bore by 5 mm" is not answerable from the
// intent text. It needs a MEASUREMENT, and the app has one: forge_verify returns
// a per-face census and a `bores` array. PartInventory.hpp parses it; this file
// puts it into the planner's context and, for the bore-edit shape, resolves the
// reference to the statement that made the bore. A planner that is handed
// "the largest bore measures ⌀12.000 at (0,0,0), made by %7 HOLE" is not
// guessing; one handed only the sentence is.
//
// ── 2. TOOL-CALL APPROVAL (owner decision, 2026-08-31) ──────────────────────
// The model NEVER grants its own SendApproval; the conversing user does. This
// header is where that is made STRUCTURAL rather than promised:
//
//   * proposeRetrieval() is the ONLY way a model-originated query enters, and it
//     cannot produce an approval. It reaches the preview and stops.
//   * approveRetrieval() is the ONLY function anywhere that produces a granted
//     RetrievalApprovalTicket, and RetrievalApprovalTicket has no other way to
//     become granted: its members are private and ArchieConversation is its only
//     friend. Every ticket that exists came from a human pressing Approve.
//   * approveRetrieval() REFUSES unless the renderer has already handed back the
//     text it drew and that text CONTAINS THE EXACT BYTES that will be sent AND
//     the original text of every redaction. A paraphrased preview cannot be
//     approved, and neither can one that hides what was stripped.
//   * approval is per-proposal and single-use. There is no "always allow", no
//     session grant, and no API that takes more than one proposal id — a UI that
//     batched approvals would be defeating SendApproval's type, not using it.
//   * with no operator present — the DEFAULT, which is what a headless run gets
//     — a proposal is recorded and immediately declined RETRIEVAL_UNAVAILABLE.
//   * ★a declined search NEVER touches the plan on offer. `declineRetrieval()`
//     mutates no offer and no step. A long feature tree survives a refused
//     lookup, because a refusal is not a build failure.
//
// forge::ui opens no socket, so nothing here talks to SearXNG. The preview
// arrives as PLAIN DATA (RetrievalPreview) and the granted ticket leaves as
// plain data; forge::copilot::approvedSendApproval() is the one function that
// turns that ticket into a forge::retrieval::SendApproval, and it lives outside
// forge::ui precisely so this layer keeps no network type at all.
//
// ── 3. TRANSPARENCY ─────────────────────────────────────────────────────────
// contextGiven() is the exact text the planner was handed and rawResponse() is
// the exact text it returned. A wrong answer with both of those visible is a
// debuggable answer; without them it is a mystery with a stack trace.
//
// HEADLESS: no ImGui, no GPU, no display, no socket, no file I/O, no clock.
#ifndef FORGE_UI_ARCHIECONVERSATION_HPP
#define FORGE_UI_ARCHIECONVERSATION_HPP

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/ArchieCopilot.hpp"
#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/OpConstraintBridge.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/PartInventory.hpp"
#include "forge/ui/SelectionService.hpp"

namespace forge::ui {

inline constexpr std::size_t kNoIndex = static_cast<std::size_t>(-1);

// ═══════════════════════════════════════════════════════════════════════════
// THE RETRIEVAL SEAM — plain data, mirroring forge::retrieval::QueryPreview
// ═══════════════════════════════════════════════════════════════════════════

// One thing the redactor removed. `removed` is the ORIGINAL text and exists ONLY
// so the approving human can see what was stripped; it is never part of the
// bytes and must never be written anywhere the bytes go.
struct RedactionRemoval {
  std::string kind;    // forge::retrieval::redactionKindName(), e.g. "DimensionLiteral"
  std::string removed; // the original text — local only
  std::string marker;  // what the annotated form shows in its place, e.g. "[DIM]"
  std::size_t offset = 0;
  std::size_t length = 0;

  std::string display() const;
};

// Everything the operator must see BEFORE a byte is transmitted. Filled by the
// app layer from a forge::retrieval::QueryPreview; forge::ui never builds one.
struct RetrievalPreview {
  bool sendable = false;
  std::string status;        // "Ok" | "PrivacyClassForbidsNetwork" | ...
  std::string statusDetail;

  std::string destinationClass;   // "same-Mac SearXNG sidecar"
  std::string destinationOrigin;  // "http://127.0.0.1:8888"
  std::string method;             // "POST"
  std::string path;               // "/search"

  std::string redactedQuery;   // exactly the q= value that will be sent
  std::string annotatedQuery;  // the same, with [DIM]/[CUSTOMER] markers left in
  std::vector<RedactionRemoval> removals;
  std::vector<std::pair<std::string, std::string>> fields;  // wire order

  // THE EXACT ENCODED BODY. What the approval is bound to, and what the UI must
  // show verbatim: search() re-checks this digest, so a prettified view would
  // discard the only guarantee the digest exists to give.
  std::string encodedBody;
  std::uint64_t bodyDigest = 0;

  // The three blocks the approval UI must render. renderForApproval() is their
  // concatenation and is what a caller should draw: passing its result back to
  // recordPreviewShown() satisfies every requirement by construction.
  std::string destinationBlock() const;
  std::string redactionDiff() const;
  std::string wireBlock() const;
  std::string renderForApproval() const;
};

// ── the capability token ────────────────────────────────────────────────────
// Default-constructible and INVALID. The only way one becomes granted is
// ArchieConversation::approveRetrieval(), which is a friend; nothing else in the
// codebase can set the flag. That is the same construction SendApproval uses,
// one layer earlier, and it is why "the model cannot approve its own query" is a
// property of the type rather than a rule someone has to remember.
class RetrievalApprovalTicket {
 public:
  RetrievalApprovalTicket() = default;

  bool valid() const noexcept { return granted_; }
  std::uint64_t proposalId() const noexcept { return proposalId_; }
  std::uint64_t digest() const noexcept { return digest_; }

  // Bound to ONE proposal and ONE body digest. A ticket granted for query A is
  // not a ticket for query B even if B is byte-identical, because the proposal
  // id differs — approval is per-query, and "the same query again" is a new
  // query that needs its own approval.
  bool bindsTo(std::uint64_t proposal, std::uint64_t bodyDigest) const noexcept {
    return granted_ && proposal != 0 && proposalId_ == proposal && digest_ == bodyDigest;
  }

 private:
  friend class ArchieConversation;
  bool granted_ = false;
  std::uint64_t proposalId_ = 0;
  std::uint64_t digest_ = 0;
};

// ── a proposal's life ───────────────────────────────────────────────────────
enum class RetrievalState : std::uint8_t {
  Proposed,   // Archie asked; nothing has been sent and nothing decided
  Approved,   // a human granted it; a ticket exists
  Declined,   // a human said no, or there was no human to ask
  Sent,       // the app layer reported a result
  Failed,     // the app layer reported a failure (RETRIEVAL_UNAVAILABLE, ...)
};

const char* toString(RetrievalState state) noexcept;

struct RetrievalProposal {
  std::uint64_t id = 0;
  std::string question;   // what Archie WANTED to ask, raw. NEVER transmitted.
  std::string rationale;  // why local evidence was said to be insufficient
  RetrievalPreview preview;

  RetrievalState state = RetrievalState::Proposed;
  // Set only by recordPreviewShown(), and only when what was drawn contained the
  // exact bytes and every removal. Approval is refused while this is false.
  bool previewShown = false;
  std::string shownProblem;  // what the drawn text was missing, when it was
  std::string decision;      // why it ended the way it did, in words
  std::string resultStatus;  // the app layer's own status name, when it reported
  std::string resultDetail;

  bool decided() const noexcept { return state != RetrievalState::Proposed; }
  std::string display() const;
};

// ═══════════════════════════════════════════════════════════════════════════
// THE CONVERSATION
// ═══════════════════════════════════════════════════════════════════════════

enum class Speaker : std::uint8_t { User, Archie, App };
const char* toString(Speaker who) noexcept;

enum class TurnKind : std::uint8_t {
  Question,       // the user asked for something
  Answer,         // Archie said something that is not a plan
  PlanOffer,      // a plan is on the table; `offer` indexes it
  PlanOutcome,    // what happened when steps were accepted
  Retrieval,      // a tool call was proposed, approved, declined or reported
  Note,           // the app explaining itself: a refusal, a transport failure
};

const char* toString(TurnKind kind) noexcept;

struct ConversationTurn {
  std::uint64_t id = 0;
  Speaker who = Speaker::App;
  TurnKind kind = TurnKind::Note;
  std::string text;
  std::size_t offer = kNoIndex;     // index into offers(), for PlanOffer/PlanOutcome
  std::size_t proposal = kNoIndex;  // index into proposals(), for Retrieval

  std::string display() const;
};

// ── one step of one offer ───────────────────────────────────────────────────
enum class StepState : std::uint8_t {
  Pending,   // the user has not ruled on it
  Rejected,  // the user said no to this line
  Applied,   // it ran and the dispatch succeeded
  Failed,    // it ran and the dispatch failed
  Blocked,   // the op-constraint gate refused it; it was NEVER dispatched
};

const char* toString(StepState state) noexcept;

struct OfferStep {
  PlanStep proposed;  // exactly what the planner said — kept for transparency
  PlanStep current;   // what would run now; equal to `proposed` until edited
  bool edited = false;
  StepState state = StepState::Pending;
  // The op-constraint ruling on `current`, recomputed after every edit. This is
  // what the panel prints beside the line, and it is validatePlan()'s own row.
  StepVerdict verdict;
  std::string outcome;  // what the dispatch said, once it ran

  bool acceptable() const noexcept { return state == StepState::Pending && !verdict.refused; }
  std::string display() const;
};

// ── one offer ───────────────────────────────────────────────────────────────
struct PlanOffer {
  std::uint64_t requestId = 0;
  std::string intent;
  std::string summary;
  std::vector<OfferStep> steps;

  // The whole-plan ruling deliver() got. A plan the gate refused is STILL SHOWN
  // — every step keeps its row — but no step is acceptable, because `verdict`
  // refuses them.
  PlanCheck check = PlanCheck::Ok;
  std::string detail;

  std::size_t pending() const noexcept;
  std::size_t applied() const noexcept;
  std::size_t rejected() const noexcept;
  std::size_t blocked() const noexcept;
  std::size_t refusedByGate() const noexcept;
  bool open() const noexcept { return pending() != 0; }
  std::string report() const;  // one line per step, for the transcript and a log
};

// ── what the planner was handed ─────────────────────────────────────────────
// A PlanRequest rendered as the text a model would actually see. Exposed as a
// free function so a gate can render one without a conversation, and so the
// panel's "what did Archie get?" disclosure and the transport's prompt are the
// SAME STRING rather than two renderings that can drift.
std::string renderContext(const PlanRequest& request);

// ── grounding, as a planner ─────────────────────────────────────────────────
// The ground-truth edit shape, answered from MEASUREMENTS: it recognises
// "shrink/enlarge the diameter of the {largest,smallest,deepest,Nth} bore
// {by,to} X mm", resolves the bore in the census, finds the HOLE/CBORE statement
// that made it, and emits part.edit_feature with the measured numbers. Anything
// it does not ground it hands to `fallback` UNCHANGED — it never guesses, and it
// never refuses a request the fallback could have answered.
//
// Holds POINTERS to caller-owned state, refreshed by the caller between asks; a
// planner that cached a census would answer today's question with yesterday's
// part.
class GroundedPlanner final : public Planner {
 public:
  GroundedPlanner(const PartInventory& inventory, const PartDocument& document,
                  Planner& fallback) noexcept;

  PlanResponse plan(const PlanRequest& request) override;

  // The last grounding attempt, whether or not it succeeded. The panel shows it
  // so a user can see WHY a number was chosen — or why none could be.
  const GroundedEdit& lastEdit() const noexcept { return lastEdit_; }
  const BoreEditPhrase& lastPhrase() const noexcept { return lastPhrase_; }

 private:
  const PartInventory* inventory_;
  const PartDocument* document_;
  Planner* fallback_;
  GroundedEdit lastEdit_;
  BoreEditPhrase lastPhrase_;
};

// ── the conversation ────────────────────────────────────────────────────────
class ArchieConversation {
 public:
  ArchieConversation() = default;

  // ── grounding ───────────────────────────────────────────────────────────
  void setInventory(PartInventory inventory);
  const PartInventory& inventory() const noexcept { return inventory_; }
  // Parses a forge_verify response line. Returns false with `why` filled and
  // KEEPS the previous inventory — a failed measurement must not silently
  // replace a good one with an empty one.
  bool measureFrom(const std::string& verifyJson, std::string& why);

  // ── asking ──────────────────────────────────────────────────────────────
  // Opens a request. Returns 0 and records NOTHING when the intent is blank or a
  // request is already in flight, so a double-press cannot queue two asks.
  // The context is built HERE, from the live registry, the live selection and
  // the measured inventory, and kept verbatim in contextGiven().
  std::uint64_t ask(std::string intent, const CommandRegistry& registry,
                    const SelectionService& selection, const PartDocument& document);

  bool pending() const noexcept { return pending_; }
  const PlanRequest& request() const noexcept { return request_; }
  const std::string& contextGiven() const noexcept { return context_; }
  const std::string& rawResponse() const noexcept { return raw_; }

  // The reply. `rawModelOutput` is whatever the transport received before it was
  // parsed into a PlanResponse — kept verbatim for the disclosure and never
  // interpreted. Refuses a stale id or a plan that does not validate, records
  // why in the transcript either way, and closes the request.
  //
  // A REFUSED PLAN IS STILL SHOWN, with a row per step, because a user watching
  // a CoPilot that answers nothing and says nothing is watching a bug.
  PlanCheck deliver(const PlanResponse& response, const CommandRegistry& registry,
                    std::string rawModelOutput = std::string());

  // The transport itself failed — no model configured, a timeout, a refusal.
  // Named apart from a bad plan because they are different problems.
  void failRequest(std::string why);

  // ── the offer ───────────────────────────────────────────────────────────
  bool hasOffer() const noexcept { return !offers_.empty() && offers_.back().open(); }
  const std::vector<PlanOffer>& offers() const noexcept { return offers_; }
  const PlanOffer& offer() const noexcept { return offers_.back(); }

  // EDIT ONE ARGUMENT, then re-rule the step. The value goes through the SAME
  // op-constraint check the planner's value did — an edit is untrusted input
  // too, and a user pasting a selector is exactly the path an injected op would
  // take. Returns false with `why` when the parameter is not declared, the type
  // is wrong, or the step is no longer pending.
  bool editStep(std::size_t step, const std::string& parameter, const PlanArg& value,
                const CommandRegistry& registry, std::string& why);
  // Back to what the planner proposed, re-ruled.
  bool resetStep(std::size_t step, const CommandRegistry& registry, std::string& why);

  // REJECT. `rejectStep` rules on one line; `rejectOffer` rules on every line
  // still pending. Both are the USER saying no, and both are recorded as that —
  // never as a failure.
  bool rejectStep(std::size_t step, std::string why = std::string());
  void rejectOffer(std::string why = std::string());

  // ACCEPT ONE LINE. Applied as a one-step plan through applyPlan(), against the
  // live document — so a step whose input the document does not hold yet comes
  // back with that named, rather than running against the wrong body.
  ApplyOutcome acceptStep(std::size_t step, ForgeShell& shell, const PartDocument& document);
  // ACCEPT EVERY LINE STILL PENDING, in plan order, as ONE plan. applyPlan()
  // stops at the first refusal; the steps after it stay Pending, because they
  // were written to consume what it would have produced.
  ApplyOutcome acceptAll(ForgeShell& shell, const PartDocument& document);

  // ── retrieval ───────────────────────────────────────────────────────────
  // FALSE by default, which is what a headless run gets: with no operator there
  // is no approval, so a benchmark run declines and proceeds. A score obtained
  // with web retrieval is not comparable to one obtained without it.
  bool operatorPresent() const noexcept { return operatorPresent_; }
  void setOperatorPresent(bool present) noexcept { operatorPresent_ = present; }

  // Archie proposes. This is the ONLY entry for a model-originated query and it
  // CANNOT approve. With no operator present the proposal is recorded and
  // immediately declined; with one, it waits.
  std::uint64_t proposeRetrieval(std::string question, std::string rationale,
                                 RetrievalPreview preview);

  // The renderer hands back the text it actually drew. Approval is refused until
  // this has been called with text containing the exact body bytes AND the
  // original text of every redaction: an invisible redaction cannot be audited
  // by the person approving it, and a paraphrased body is not the body.
  bool recordPreviewShown(std::uint64_t proposalId, const std::string& renderedText,
                          std::string& why);

  // ★THE ONLY PRODUCER OF A GRANTED TICKET IN THE CODEBASE.
  // Returns an invalid ticket with `why` filled unless ALL of:
  //   an operator is present; the proposal exists and is undecided; its preview
  //   is sendable; recordPreviewShown() accepted what was drawn; and the digest
  //   the caller passes is the digest of the bytes that will be sent.
  // Single-use: the proposal leaves the Proposed state, so a second call fails.
  RetrievalApprovalTicket approveRetrieval(std::uint64_t proposalId,
                                           std::uint64_t digestTheUserSaw, std::string& why);

  // The user said no — or nobody was there to ask. ★MUTATES NO OFFER AND NO
  // STEP: the plan on the table is exactly as it was, and a long feature tree
  // survives a refused lookup.
  bool declineRetrieval(std::uint64_t proposalId, std::string why = std::string());

  // The app layer reporting what its SearxngClient returned. `status` is that
  // layer's own status name, quoted, never re-spelled here.
  bool noteRetrievalResult(std::uint64_t proposalId, bool ok, std::string status,
                           std::string detail);

  const std::vector<RetrievalProposal>& proposals() const noexcept { return proposals_; }
  const RetrievalProposal* proposal(std::uint64_t id) const noexcept;

  // ── the transcript ──────────────────────────────────────────────────────
  const std::vector<ConversationTurn>& turns() const noexcept { return turns_; }
  std::string transcript() const;
  void clear();

  // ── counters ────────────────────────────────────────────────────────────
  std::size_t stepsApplied() const noexcept { return stepsApplied_; }
  std::size_t stepsRejected() const noexcept { return stepsRejected_; }
  // Steps the gate refused AT THE DOOR, never dispatched. The number that
  // answers "did the CoPilot ever run something the gate rejected".
  std::size_t stepsBlocked() const noexcept { return stepsBlocked_; }
  std::size_t stepsFailed() const noexcept { return stepsFailed_; }
  std::size_t plansRefused() const noexcept { return plansRefused_; }
  std::size_t retrievalApproved() const noexcept { return retrievalApproved_; }
  std::size_t retrievalDeclined() const noexcept { return retrievalDeclined_; }

  const OpConstraintBridge& bridge() const noexcept { return bridge_; }

 private:
  void say(Speaker who, TurnKind kind, std::string text, std::size_t offer = kNoIndex,
           std::size_t proposal = kNoIndex);
  // Re-rules ONE step by asking validatePlan() about the one-step plan it would
  // become. There is no second implementation of the rule anywhere in this file.
  void reruleStep(PlanOffer& offer, std::size_t step, const CommandRegistry& registry);
  void recordOutcome(PlanOffer& offer, const std::vector<std::size_t>& applied,
                     const ApplyOutcome& outcome);
  RetrievalProposal* mutableProposal(std::uint64_t id) noexcept;

  OpConstraintBridge bridge_;
  PartInventory inventory_;

  std::vector<ConversationTurn> turns_;
  std::vector<PlanOffer> offers_;
  std::vector<RetrievalProposal> proposals_;

  PlanRequest request_;
  std::string context_;
  std::string raw_;
  bool pending_ = false;
  bool operatorPresent_ = false;

  std::uint64_t nextRequestId_ = 1;
  std::uint64_t nextTurnId_ = 1;
  std::uint64_t nextProposalId_ = 1;

  std::size_t stepsApplied_ = 0;
  std::size_t stepsRejected_ = 0;
  std::size_t stepsBlocked_ = 0;
  std::size_t stepsFailed_ = 0;
  std::size_t plansRefused_ = 0;
  std::size_t retrievalApproved_ = 0;
  std::size_t retrievalDeclined_ = 0;
};

}  // namespace forge::ui

#endif  // FORGE_UI_ARCHIECONVERSATION_HPP
