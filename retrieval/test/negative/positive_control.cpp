// POSITIVE CONTROL for the negative-compilation phase. This one MUST compile.
//
// Without it, a typo in the include path or a broken compiler would make every
// negative case "fail to compile" and the phase would report a perfect score
// while proving nothing. A test that cannot fail is not a test; a test that
// cannot PASS is not one either.
#include "forge/retrieval/EvidenceRecord.hpp"
#include "forge/retrieval/PlanValue.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

int main() {
  // The whole legitimate path, in the order a caller would walk it.
  CitedCandidate c;
  c.value = 276.0;
  c.unit = "MPa";
  c.source_url = "https://docs.example-alloys.com/6061-t6";
  c.source_type = SourceType::ManufacturerDocument;

  const CitationPreview preview = CitationPreview::of(c);
  const OperatorCitationApproval approval = OperatorCitationApproval::grant(preview);
  BindRefusal why = BindRefusal::None;
  const auto bound = BoundCitation::bind(c, approval, std::nullopt, why);
  if (!bound.has_value()) return 1;

  GeometryMutation m(MutationOp::SetParameter);
  m.withNumber("allowable_stress", ProvenancedValue::fromCitation(*bound));
  m.withText("parameter", "allowable_stress");

  MutationLedger ledger;
  if (ledger.apply(m) != MutationLedger::Refusal::None) return 1;
  return ledger.applied() == 1 ? 0 : 1;
}
