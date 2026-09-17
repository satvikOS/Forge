#include "forge/retrieval/PlanValue.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

#include "forge/retrieval/SearxngClient.hpp"

namespace forge::retrieval {
namespace {

std::uint64_t fnv1a(std::uint64_t h, const std::string& bytes) {
  for (const unsigned char c : bytes) {
    h ^= static_cast<std::uint64_t>(c);
    h *= 1099511628211ull;
  }
  return h;
}

std::string toLowerAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

// A stable textual form of a double, so a digest does not depend on locale or
// on the formatting the caller happened to use.
std::string canonicalNumber(double v) {
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%.17g", v);
  return std::string(buf);
}

// THERE IS NO URL PARSER IN THIS FILE, AND THAT IS THE FIX.
//
// A local hostOf() used to decide the "different publisher" corroboration rule:
// it split the authority at the FIRST '@', kept a trailing dot, ignored the
// scheme and cut at the first ':' — a third URL parser beside the two
// SearxngClient.cpp had already had to repair. Against it, ONE attacker host
// corroborated itself (measured on 1dd9ed9b, all BOUND with forum.evil.example
// as the primary):
//     https://iso.org:1@forum.evil.example/t/2   hostOf -> "iso.org"
//     https://forum.evil.example./t/2            hostOf -> "forum.evil.example."
//     https://x@forum.evil.example/t/2           hostOf -> "x@forum.evil.example"
// Publisher identity now comes from SearxngClient::corroborationPublisher(),
// which is the same authority parse and host canonicaliser classifySource() uses.
std::string publisherIdentity(const std::string& url) {
  return SearxngClient::corroborationPublisher(url);
}

}  // namespace

const char* valueProvenanceName(ValueProvenance p) {
  switch (p) {
    case ValueProvenance::UserIntent: return "UserIntent";
    case ValueProvenance::RegistryDefault: return "RegistryDefault";
    case ValueProvenance::DocumentMeasured: return "DocumentMeasured";
    case ValueProvenance::CitedBound: return "CitedBound";
    case ValueProvenance::PlannerDerived: return "PlannerDerived";
  }
  return "Unknown";
}

// ── IntentSpan ──────────────────────────────────────────────────────────────
std::optional<IntentSpan> IntentSpan::locate(const std::string& user_intent, double value) {
  if (!std::isfinite(value)) return std::nullopt;
  // Re-read the user's own text. The literal must actually be there: this is a
  // check, not a label the caller gets to apply to a number of its choosing.
  for (const NumericSpan& s : scanNumericSpans(user_intent)) {
    if (s.value != value) continue;
    IntentSpan out;
    out.value_ = value;
    out.begin_ = s.begin;
    out.literal_ = canonicalNumber(value);
    return out;
  }
  return std::nullopt;
}

// ── RegistryNumber ──────────────────────────────────────────────────────────
std::optional<RegistryNumber> RegistryNumber::fromSpec(const ParameterSpec& spec) {
  if (spec.name.empty()) return std::nullopt;
  if (!spec.has_default_number) return std::nullopt;
  if (!std::isfinite(spec.default_number)) return std::nullopt;
  RegistryNumber n;
  n.value_ = spec.default_number;  // taken FROM the spec; no caller double exists
  n.parameter_ = spec.name;
  return n;
}

// ── Measurement ─────────────────────────────────────────────────────────────
KernelMeasurementToken KernelMeasurementToken::forSession(const void* kernel_session) {
  KernelMeasurementToken t;
  t.session_ = kernel_session;
  return t;
}

std::optional<Measurement> Measurement::fromKernel(const KernelMeasurementToken& token,
                                                   std::string quantity, std::string entity_ref,
                                                   double value, std::string unit) {
  if (!token.valid()) return std::nullopt;
  if (quantity.empty() || unit.empty()) return std::nullopt;
  if (!std::isfinite(value)) return std::nullopt;
  Measurement m;
  m.value_ = value;
  m.quantity_ = std::move(quantity);
  m.entity_ref_ = std::move(entity_ref);
  m.unit_ = std::move(unit);
  return m;
}

// ── the citation crossing ───────────────────────────────────────────────────
std::uint64_t citationDigest(const CitedCandidate& c) {
  // Derived from the candidate's bytes EVERY time. Everything that decides what
  // the candidate means is in here, so changing any of it changes the digest and
  // invalidates an approval that was granted for the old one.
  std::uint64_t h = 1469598103934665603ull;
  h = fnv1a(h, canonicalNumber(c.value));
  h = fnv1a(h, "\x1f" + toLowerAscii(c.unit));
  h = fnv1a(h, "\x1f" + c.source_url);
  h = fnv1a(h, "\x1f" + c.content_hash);
  h = fnv1a(h, "\x1f" + c.normalized_claim);
  h = fnv1a(h, "\x1f" + c.applicability_conditions);
  h = fnv1a(h, "\x1f" + std::string(sourceTypeName(c.source_type)));
  h = fnv1a(h, c.requires_corroboration ? "\x1f" "C" : "\x1f" "-");
  h = fnv1a(h, c.from_flagged_source ? "\x1f" "F" : "\x1f" "-");
  return h;
}

CitationPreview CitationPreview::of(const CitedCandidate& candidate) {
  CitationPreview p;
  p.digest_ = citationDigest(candidate);
  p.flagged_ = candidate.from_flagged_source;
  p.requires_corroboration_ = candidate.requires_corroboration;

  // The claim is re-neutralized on the way to the operator. It has already been
  // through display() to become normalized_claim, and it goes through again
  // here, because the operator is the last gate and text aimed at them is worse
  // than text aimed at the model.
  const std::string claim = UntrustedText(candidate.normalized_claim).display();

  std::string r;
  r += "BIND A RETRIEVED NUMBER INTO A PLAN\n";
  r += "  value          : " + canonicalNumber(candidate.value) + " " + candidate.unit + "\n";
  r += "  unit source    : read from the page, adjacent to the number\n";
  // The identity the corroboration rule compares, so the operator is shown the
  // publisher the decision is made on — never a host written into the userinfo.
  const std::string publisher = publisherIdentity(candidate.source_url);
  r += "  publisher      : " +
       (publisher.empty() ? std::string("(unidentifiable: this URL names no registrant; it cannot corroborate)")
                          : publisher) +
       "\n";
  r += "  source type    : " + std::string(sourceTypeName(candidate.source_type)) + " (authority " +
       std::to_string(authorityRank(candidate.source_type)) + ")\n";
  r += "  url            : " + candidate.source_url + "\n";
  r += "  content hash   : " + candidate.content_hash + "\n";
  r += "  applicability  : " + candidate.applicability_conditions + "\n";
  r += "  corroboration  : " + std::string(candidate.requires_corroboration ? "REQUIRED"
                                                                            : "not required") + "\n";
  r += "  source tried to issue instructions: " +
       std::string(candidate.from_flagged_source ? "YES" : "no") + "\n";
  r += "  claim          : " + claim + "\n";
  p.rendered_ = std::move(r);
  return p;
}

OperatorCitationApproval OperatorCitationApproval::grant(const CitationPreview& preview) {
  OperatorCitationApproval a;
  a.digest_ = preview.digest();
  a.granted_ = true;
  a.acknowledged_flagged_ = false;
  return a;
}

OperatorCitationApproval OperatorCitationApproval::grantAcknowledgingFlaggedSource(
    const CitationPreview& preview) {
  OperatorCitationApproval a;
  a.digest_ = preview.digest();
  a.granted_ = true;
  a.acknowledged_flagged_ = true;
  return a;
}

const char* bindRefusalName(BindRefusal r) {
  switch (r) {
    case BindRefusal::None: return "None";
    case BindRefusal::NotGranted: return "NotGranted";
    case BindRefusal::DigestMismatch: return "DigestMismatch";
    case BindRefusal::FlaggedSourceNotAcknowledged: return "FlaggedSourceNotAcknowledged";
    case BindRefusal::CorroborationMissing: return "CorroborationMissing";
    case BindRefusal::CorroborationSamePublisher: return "CorroborationSamePublisher";
    case BindRefusal::CorroborationUnitMismatch: return "CorroborationUnitMismatch";
    case BindRefusal::CorroborationValueDisagrees: return "CorroborationValueDisagrees";
    case BindRefusal::CorroborationPublisherUnidentifiable: return "CorroborationPublisherUnidentifiable";
  }
  return "Unknown";
}

std::optional<BoundCitation> BoundCitation::bind(const CitedCandidate& candidate,
                                                 const OperatorCitationApproval& approval,
                                                 const std::optional<CitedCandidate>& corroboration,
                                                 BindRefusal& why) {
  why = BindRefusal::None;
  if (!approval.granted()) {
    why = BindRefusal::NotGranted;
    return std::nullopt;
  }
  // RE-DERIVE from the candidate in hand. An approval granted for one candidate
  // cannot be spent on another.
  if (citationDigest(candidate) != approval.digest()) {
    why = BindRefusal::DigestMismatch;
    return std::nullopt;
  }
  if (candidate.from_flagged_source && !approval.acknowledged_flagged_source()) {
    why = BindRefusal::FlaggedSourceNotAcknowledged;
    return std::nullopt;
  }
  // `requires_corroboration` governs only whether ABSENCE is fatal. Whenever a
  // corroborating candidate IS supplied it is checked, required or not.
  //
  // MEASURED 2026-09-14 on live results: without this, a SecondaryTechnical page
  // whose snippet was a unit-conversion line ("1 kg/m3 = 0.0624 lb/ft3") bound
  // the value 1, while a second source saying 2710 kg/m3 sat in the corroboration
  // argument UNREAD, because corroboration was not required for that tier. The
  // caller had handed in a contradiction and the binding ignored it. 12.2:
  // contradictory current sources remain visible until resolved — which they
  // cannot be if nothing looks at them.
  if (candidate.requires_corroboration || corroboration.has_value()) {
    if (!corroboration.has_value()) {
      why = BindRefusal::CorroborationMissing;
      return std::nullopt;
    }
    // DENY BY DEFAULT: a side whose publisher cannot be identified cannot be
    // shown to be a DIFFERENT publisher, so it does not corroborate anything.
    const std::string primary_publisher = publisherIdentity(candidate.source_url);
    const std::string corroborating_publisher = publisherIdentity(corroboration->source_url);
    if (primary_publisher.empty() || corroborating_publisher.empty()) {
      why = BindRefusal::CorroborationPublisherUnidentifiable;
      return std::nullopt;
    }
    if (corroborating_publisher == primary_publisher) {
      why = BindRefusal::CorroborationSamePublisher;
      return std::nullopt;
    }
    if (toLowerAscii(corroboration->unit) != toLowerAscii(candidate.unit)) {
      why = BindRefusal::CorroborationUnitMismatch;
      return std::nullopt;
    }
    const double a = candidate.value;
    const double b = corroboration->value;
    const double scale = std::max(std::abs(a), std::abs(b));
    const double tol = scale == 0.0 ? 1e-12 : scale * 0.05;
    if (std::abs(a - b) > tol) {
      why = BindRefusal::CorroborationValueDisagrees;
      return std::nullopt;
    }
  }

  BoundCitation bc;
  bc.value_ = candidate.value;
  bc.unit_ = candidate.unit;
  bc.source_url_ = candidate.source_url;
  bc.content_hash_ = candidate.content_hash;
  bc.digest_ = approval.digest();
  return bc;
}

// ── ProvenancedValue ────────────────────────────────────────────────────────
ProvenancedValue ProvenancedValue::fromUserIntent(const IntentSpan& span) {
  ProvenancedValue v;
  v.value_ = span.value();
  v.provenance_ = ValueProvenance::UserIntent;
  v.detail_ = "user wrote \"" + span.literal() + "\" at byte " + std::to_string(span.begin());
  return v;
}

ProvenancedValue ProvenancedValue::fromRegistryDefault(const RegistryNumber& n) {
  ProvenancedValue v;
  v.value_ = n.value();
  v.provenance_ = ValueProvenance::RegistryDefault;
  v.detail_ = "registry default for " + n.parameter();
  return v;
}

ProvenancedValue ProvenancedValue::fromMeasurement(const Measurement& m) {
  ProvenancedValue v;
  v.value_ = m.value();
  v.provenance_ = ValueProvenance::DocumentMeasured;
  v.detail_ = "kernel measured " + m.quantity() +
              (m.entity_ref().empty() ? std::string() : " of " + m.entity_ref()) + " = " +
              canonicalNumber(m.value()) + " " + m.unit();
  return v;
}

ProvenancedValue ProvenancedValue::fromCitation(const BoundCitation& c) {
  ProvenancedValue v;
  v.value_ = c.value();
  v.provenance_ = ValueProvenance::CitedBound;
  v.detail_ = "operator bound " + canonicalNumber(c.value()) + " " + c.unit() + " from " +
              c.source_url() + " (hash " + c.content_hash() + ")";
  v.citation_digest_ = c.digest();
  return v;
}

// ── Derivation ──────────────────────────────────────────────────────────────
namespace {
bool g_derivation_enabled = false;
}  // namespace

void Derivation::setEnabled(bool on) { g_derivation_enabled = on; }
bool Derivation::enabled() { return g_derivation_enabled; }

std::optional<Derivation> Derivation::of(std::string note, std::vector<ProvenancedValue> inputs,
                                         double result) {
  if (!g_derivation_enabled) return std::nullopt;   // shipped disabled
  if (inputs.empty()) return std::nullopt;          // arithmetic over nothing is not a derivation
  if (!std::isfinite(result)) return std::nullopt;
  for (const ProvenancedValue& in : inputs) {
    // Every input must be non-derived: depth is capped at 2 by refusing to
    // derive from a derivation at all.
    if (in.provenance() == ValueProvenance::PlannerDerived) return std::nullopt;
  }
  Derivation d;
  d.note_ = std::move(note);
  d.inputs_ = std::move(inputs);
  d.result_ = result;
  return d;
}

std::optional<ProvenancedValue> Derivation::toValue(const Derivation& d) {
  if (!g_derivation_enabled) return std::nullopt;
  if (d.inputs_.empty()) return std::nullopt;
  ProvenancedValue v;
  v.value_ = d.result_;
  v.provenance_ = ValueProvenance::PlannerDerived;
  v.detail_ = d.note_ + " (over " + std::to_string(d.inputs_.size()) + " provenanced inputs)";
  v.derivation_depth_ = 1;
  return v;
}

// ── the closed identifier set ───────────────────────────────────────────────
const char* mutationOpName(MutationOp op) {
  switch (op) {
    case MutationOp::Extrude: return "Extrude";
    case MutationOp::Revolve: return "Revolve";
    case MutationOp::Fillet: return "Fillet";
    case MutationOp::Chamfer: return "Chamfer";
    case MutationOp::Shell: return "Shell";
    case MutationOp::Translate: return "Translate";
    case MutationOp::Rotate: return "Rotate";
    case MutationOp::Scale: return "Scale";
    case MutationOp::SetParameter: return "SetParameter";
  }
  return "Unknown";
}

std::optional<MutationOp> mutationOpFromName(const std::string& name) {
  static const MutationOp kAll[] = {
      MutationOp::Extrude, MutationOp::Revolve,   MutationOp::Fillet,
      MutationOp::Chamfer, MutationOp::Shell,     MutationOp::Translate,
      MutationOp::Rotate,  MutationOp::Scale,     MutationOp::SetParameter,
  };
  for (const MutationOp op : kAll) {
    // Exact and case-sensitive. A prefix or case-insensitive match would let
    // "scale=10" and "SCALE" in, and each one that gets in is a new verb.
    if (name == mutationOpName(op)) return op;
  }
  return std::nullopt;
}

// ── GeometryMutation ────────────────────────────────────────────────────────
GeometryMutation& GeometryMutation::withNumber(std::string name, ProvenancedValue value) {
  numbers_.emplace_back(std::move(name), std::move(value));
  return *this;
}

GeometryMutation& GeometryMutation::withText(std::string name, std::string value) {
  texts_.emplace_back(std::move(name), std::move(value));
  return *this;
}

// ── MutationLedger ──────────────────────────────────────────────────────────
const char* MutationLedger::refusalName(Refusal r) {
  switch (r) {
    case Refusal::None: return "None";
    case Refusal::UnprovenancedValue: return "UnprovenancedValue";
    case Refusal::DerivationTooDeep: return "DerivationTooDeep";
    case Refusal::TextArgumentNamesAnOp: return "TextArgumentNamesAnOp";
    case Refusal::TextArgumentNotInert: return "TextArgumentNotInert";
    case Refusal::TextArgumentTooLong: return "TextArgumentTooLong";
    case Refusal::MissingRequiredArgument: return "MissingRequiredArgument";
  }
  return "Unknown";
}

MutationLedger::Refusal MutationLedger::apply(const GeometryMutation& m) {
  auto refuse = [&](Refusal r) {
    ++refused_;
    return r;
  };

  for (const auto& [name, value] : m.numbers()) {
    (void)name;
    if (value.provenance() == ValueProvenance::PlannerDerived) {
      if (!Derivation::enabled()) return refuse(Refusal::UnprovenancedValue);
      if (value.derivation_depth() > 2) return refuse(Refusal::DerivationTooDeep);
    }
  }

  for (const auto& [name, value] : m.texts()) {
    (void)name;
    if (value.size() > kMaxTextArgumentChars) return refuse(Refusal::TextArgumentTooLong);
    for (const unsigned char c : value) {
      // A text argument is a selector or a plane name. It is never a sentence,
      // never multi-line, and never carries a quote or an angle bracket — the
      // characters with which a further statement, or a chat-template frame, is
      // opened.
      if (c < 0x20 || c == 0x7F) return refuse(Refusal::TextArgumentNotInert);
      if (c == '"' || c == '\'' || c == '<' || c == '>' || c == '`' || c == '\\') {
        return refuse(Refusal::TextArgumentNotInert);
      }
    }
    // An op name inside an argument is the documented smuggling shape.
    const std::string lower = toLowerAscii(value);
    for (int i = 0; i <= static_cast<int>(MutationOp::SetParameter); ++i) {
      const std::string op = toLowerAscii(mutationOpName(static_cast<MutationOp>(i)));
      if (lower.find(op) != std::string::npos) return refuse(Refusal::TextArgumentNamesAnOp);
    }
  }

  // Applied. Fold it into the digest so "nothing moved" is a byte comparison.
  std::string record = std::string(mutationOpName(m.op()));
  for (const auto& [name, value] : m.numbers()) {
    record += "\x1f" + name + "=" + canonicalNumber(value.value()) + "@" +
              valueProvenanceName(value.provenance());
  }
  for (const auto& [name, value] : m.texts()) {
    record += "\x1f" + name + ":" + value;
  }
  digest_ = fnv1a(digest_, record);
  journal_.push_back(record);
  ++applied_;
  return Refusal::None;
}

}  // namespace forge::retrieval
