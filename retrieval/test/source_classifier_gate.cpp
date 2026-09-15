// ─────────────────────────────────────────────────────────────────────────────
// source_classifier_gate.cpp — what the source classifier must REFUSE.
//
// SearxngClient::classifySource() decides the 12.2 authority tier of every
// retrieved record from its URL host. That tier is shown to the operator on the
// approval screen and reaches the model as may_be_sole_authority, so a host that
// BUYS a tier buys standing for whatever number its page carries.
//
// MEASURED 2026-09-14 before the fix (wf_21d25761-6a4 attacker pass): the old
// classifier matched host SUBSTRINGS, so ecfr.attacker-cdn.example classified as
// LawOrRegulator and rendered on the approval screen identically to ecfr.gov in
// every judgment field. The pre-existing retrieval_gate asserted only what the
// classifier must ACCEPT (iso.org, ecfr.gov, doi.org, ...), so a lookalike and
// the real domain were indistinguishable to the whole suite.
//
// This gate is the other half: a corpus of attacker-registrable and malformed
// hostnames, each of which must classify to exactly the tier an unknown domain
// gets, beside positive controls proving the legitimate domains keep theirs. It
// deliberately calls ONLY classifySource() and publisherFromUrl(), which existed
// before the fix, so the same file builds against the unfixed source and is
// shown RED there (run_source_classifier_gate.sh --against <tree>).
//
// Every case carries an id. The runner's mutation phase requires a SPECIFIC id to
// fail for each mutation, so a mutation caught only by an unrelated check (or by
// a build error) does not count as having been caught.
//
// No socket, no fixture file, no environment. Exit 0 iff "N passed, 0 failed".
// ─────────────────────────────────────────────────────────────────────────────
#include <iostream>
#include <string>
#include <vector>

#include "forge/retrieval/EvidenceRecord.hpp"
#include "forge/retrieval/SearxngClient.hpp"

using namespace forge::retrieval;

namespace {

int g_pass = 0;
int g_fail = 0;

void check(const char* id, bool cond, const std::string& what, const std::string& got) {
  if (cond) {
    ++g_pass;
    std::cout << "  ok   [" << id << "] " << what << "\n";
  } else {
    ++g_fail;
    std::cout << "  FAIL [" << id << "] " << what << "   (got " << got << ")\n";
  }
}

// Printable form of a URL for the log: a raw control or non-ASCII byte in a case
// label must not itself be able to reorder or hide a line of this gate's output.
std::string printable(const std::string& s) {
  static const char* hex = "0123456789abcdef";
  std::string out;
  for (unsigned char c : s) {
    if (c >= 0x20 && c < 0x7f && c != '\\') {
      out += static_cast<char>(c);
    } else {
      out += "\\x";
      out += hex[c >> 4];
      out += hex[c & 0xf];
    }
  }
  return out;
}

struct TierCase {
  const char* id;
  const char* url;
  SourceType expected;
  const char* why;
};

void runTier(const TierCase& c) {
  const SourceType got = SearxngClient::classifySource(c.url, "");
  check(c.id, got == c.expected,
        printable(c.url) + " -> " + sourceTypeName(c.expected) + "  (" + c.why + ")",
        sourceTypeName(got));
}

struct PublisherCase {
  const char* id;
  const char* url;
  const char* expected;
  const char* why;
};

void runPublisher(const PublisherCase& c) {
  const std::string got = SearxngClient::publisherFromUrl(c.url);
  check(c.id, got == c.expected,
        "publisher(" + printable(c.url) + ") == \"" + c.expected + "\"  (" + c.why + ")",
        "\"" + printable(got) + "\"");
}

constexpr SourceType kLaw = SourceType::LawOrRegulator;
constexpr SourceType kMfr = SourceType::ManufacturerDocument;
constexpr SourceType kPeer = SourceType::PeerReviewed;
constexpr SourceType kInst = SourceType::InstitutionalReference;
constexpr SourceType kSec = SourceType::SecondaryTechnical;  // what ANY unknown domain gets
constexpr SourceType kComm = SourceType::CommunityDiscussion;

}  // namespace

int main() {
  // ── 1. hostile: attacker-registrable names that merely CONTAIN a trusted one ──
  // Every one of these must get exactly what evil.example gets. SecondaryTechnical
  // is not a verdict of trust; it is the absence of any grant.
  std::cout << "\n== hostile: substring lookalikes ==\n";
  const std::vector<TierCase> lookalikes = {
      {"H01", "https://ecfr.attacker-cdn.example/title-14", kSec, "the measured spoof: 'ecfr.' prefix"},
      {"H02", "https://nist.gov.evil.example/pml", kSec, "trusted name as a LEFT label"},
      {"H03", "https://doi.org.attacker/10.1/x", kSec, "trusted name followed by an attacker TLD"},
      {"H04", "https://legislation.attacker.example/act", kSec, "'legislation.' prefix"},
      {"H05", "https://federalregister.attacker.example/d/1", kSec, "'federalregister.' prefix"},
      {"H06", "https://noteuropa.eu/law", kSec, "suffix without a label boundary"},
      {"H07", "https://wikipedia.org.evil.example/wiki/6061", kSec, "'wikipedia.org' mid-host"},
      {"H08", "https://arxiv.org.evil.example/abs/1", kSec, "'arxiv.org' mid-host"},
      {"H09", "https://evil-springer.example/article", kSec, "'springer' substring"},
      {"H10", "https://docs.attacker.com/datasheet.pdf", kSec, "'docs.' on any .com bought tier 1"},
      {"H11", "https://datasheet-cdn.com/6061.pdf", kSec, "'datasheet' substring bought tier 1"},
      {"H12", "https://evil-iso.org/standard/1", kSec, "'iso.org' without a label boundary"},
      {"H13", "https://iso.org.evil.example/standard/1", kSec, "'iso.org.' as a left label"},
      {"H14", "https://ieee.org.attacker.example/doc", kSec, "'ieee.org' mid-host"},
      {"H15", "https://pubmed.attacker.example/1", kSec, "'pubmed' substring"},
  };
  for (const auto& c : lookalikes) runTier(c);

  // ── 2. hostile: case, trailing dot, port ──────────────────────────────────────
  std::cout << "\n== hostile: case, trailing dot, port ==\n";
  const std::vector<TierCase> forms = {
      {"C01", "https://ECFR.ATTACKER-CDN.EXAMPLE/title-14", kSec, "uppercase spoof"},
      {"C02", "https://Nist.Gov.Evil.Example/", kSec, "mixed-case spoof"},
      {"C03", "https://nist.gov.evil.example./pml", kSec, "trailing-dot spoof"},
      {"C04", "https://doi.org.attacker./10.1/x", kSec, "trailing-dot spoof"},
      {"C05", "https://iso.org../standard/1", kSec, "two trailing dots is not a hostname"},
      {"C06", "https://.iso.org/standard/1", kSec, "empty leading label"},
      {"C07", "https://ecfr..gov/title-14", kSec, "empty inner label"},
      {"P01", "https://ecfr.attacker-cdn.example:443/title-14", kSec, "port suffix on a spoof"},
      {"P02", "https://nist.gov.evil.example:8443/pml", kSec, "port suffix on a spoof"},
      {"P03", "https://evil.example:443.iso.org/standard/1", kSec, "a 'port' that is really a host"},
      {"P04", "https://iso.org:evil/standard/1", kSec, "non-numeric port: not a URL a browser opens"},
      {"P05", "https://[::1]:443/iso.org", kSec, "IP literal"},
  };
  for (const auto& c : forms) runTier(c);

  // ── 3. hostile: authority parsing (userinfo, delimiters, scheme) ──────────────
  // RFC 3986 §3.2: the authority ends at the first '/', '?' or '#'. WHATWG URL
  // Standard §4.4: for special schemes '\' also ends it, and userinfo ends at the
  // LAST '@' inside the authority. A parser that looks only for '/' reads the
  // host out of the fragment or query — which is where an attacker writes it.
  std::cout << "\n== hostile: authority parsing ==\n";
  const std::vector<TierCase> authority = {
      {"U01", "https://evil.example#@ecfr.gov/title-14", kSec, "host smuggled through the fragment"},
      {"U02", "https://evil.example?@iso.org", kSec, "host smuggled through the query"},
      {"U03", "https://evil.example\\@iso.org/standard/1", kSec, "backslash ends the authority"},
      {"U04", "https://ecfr.gov@evil.example/title-14", kSec, "trusted name as USERINFO"},
      {"U05", "https://user:pw@ecfr.gov.evil.example/", kSec, "userinfo in front of a spoof"},
      {"U06", "https://ecfr.gov:443@evil.example/", kSec, "trusted host:port as userinfo"},
      {"U07", "https://a@ecfr.gov@evil.example/", kSec, "two '@': the host follows the LAST"},
      {"S01", "evil.example/redirect?to=https://iso.org/standard/1", kSec, "no scheme; '://' in the query"},
      {"S02", "javascript://iso.org/%0aalert(1)", kSec, "not an http(s) URL"},
      {"S03", "ftp://iso.org/standard/1", kSec, "not an http(s) URL"},
      {"S04", "https:/iso.org/standard/1", kSec, "missing authority"},
      {"S05", "https://ecfr.gov%2eevil.example/title-14", kSec, "percent-encoded dot"},
      {"S06", "https://ecfr.gov\n.evil.example/title-14", kSec, "newline inside the host"},
      {"S07", "https://ecfr.gov\t.evil.example/title-14", kSec, "tab inside the host"},
      {"S08", "https://ecfr gov/title-14", kSec, "space inside the host"},
  };
  for (const auto& c : authority) runTier(c);

  // ── 4. hostile: IDN and homoglyphs ─────────────────────────────────────────────
  // A label spelled in another script, raw (UTF-8) or as an IDNA A-label
  // ("xn--", RFC 5890/5891), is not the ASCII label it resembles. The classifier
  // does not carry the UTS #46 mapping or UTS #39 confusable tables needed to say
  // what such a name DISPLAYS as, so it grants nothing to one — a false negative
  // on a real internationalised host is the safe direction, a false positive is
  // the vulnerability.
  std::cout << "\n== hostile: IDN and homoglyphs ==\n";
  const std::vector<TierCase> idn = {
      {"I01", "https://www.xn--cfr-qdd.gov/title-14", kSec, "A-label for Cyrillic-e 'ecfr' under .gov"},
      {"I02", "https://xn--nst-jhd.gov/pml", kSec, "A-label for Cyrillic-i 'nist' under .gov"},
      {"I03", "https://ecfr.xn--ttacker-1fg.example/title-14", kSec, "'ecfr.' in front of an A-label"},
      {"I04", "https://xn--so-goc.org/standard/1", kSec, "A-label for Cyrillic-i 'iso.org'"},
      {"I05", "https://xn--di-fmc.org/10.1/x", kSec, "A-label for Cyrillic-o 'doi.org'"},
      {"I06", "https://docs.xn--80ak6aa92e.com/datasheet.pdf", kSec, "'docs.' on an A-label .com"},
      {"I07", "https://\xd0\xb5" "cfr.gov/title-14", kSec, "raw UTF-8 Cyrillic-e 'ecfr' under .gov"},
      {"I08", "https://\xd1\x96" "so.org/standard/1", kSec, "raw UTF-8 Cyrillic-i 'iso.org'"},
      {"I09", "https://ecfr.\xd0\xb0" "ttacker.example/title-14", kSec, "raw UTF-8 homoglyph after 'ecfr.'"},
      {"I10", "https://ecfr\xef\xbc\x8e" "gov/title-14", kSec, "U+FF0E FULLWIDTH FULL STOP"},
      {"I11", "https://nist\xe3\x80\x82" "gov.evil.example/", kSec, "U+3002 IDEOGRAPHIC FULL STOP"},
  };
  for (const auto& c : idn) runTier(c);

  // ── 5. positive controls: the legitimate domains KEEP their tier ──────────────
  // Without these, "everything is SecondaryTechnical" would pass sections 1-4.
  std::cout << "\n== positive controls ==\n";
  const std::vector<TierCase> legit = {
      {"G01", "https://www.iso.org/standard/1", kLaw, "iso.org"},
      {"G02", "https://ISO.ORG/standard/1", kLaw, "DNS names are case-insensitive (RFC 4343)"},
      {"G03", "https://iso.org./standard/1", kLaw, "one trailing dot is the same name (RFC 1034 §3.1)"},
      {"G04", "https://ecfr.gov/title-14", kLaw, "ecfr.gov"},
      {"G05", "https://www.ecfr.gov:443/current/title-14", kLaw, "numeric port is not part of the host"},
      {"G06", "https://www.federalregister.gov/d/2024-1", kLaw, "federalregister.gov"},
      {"G07", "https://www.legislation.gov.uk/ukpga/1974/37", kLaw, "legislation.gov.uk"},
      {"G08", "https://www.legislation.gov.au/C2004A00001", kLaw, "legislation.gov.au"},
      {"G09", "https://eur-lex.europa.eu/eli/reg/2023/1", kLaw, "europa.eu"},
      {"G10", "https://mvn.usace.army.mil/Missions", kLaw, ".mil (observed live, SIDECAR_WIRING.md)"},
      {"G11", "https://reader@www.astm.org/b0209.html", kLaw, "userinfo in front of a real host"},
      {"G12", "HTTPS://www.astm.org/b0209.html", kLaw, "scheme is case-insensitive (RFC 3986 §3.1)"},
      {"G13", "https://doi.org/10.1/x", kPeer, "doi.org"},
      {"G14", "https://dx.doi.org/10.1/x", kPeer, "subdomain of doi.org"},
      {"G15", "https://link.springer.com/article/1", kPeer, "springer.com"},
      {"G16", "https://onlinelibrary.wiley.com/doi/1", kPeer, "wiley.com"},
      {"G17", "https://ieeexplore.ieee.org/document/1", kPeer, "ieee.org"},
      {"G18", "https://arxiv.org/abs/2401.00001", kPeer, "arxiv.org"},
      {"G19", "https://www.sciencedirect.com/science/article/1", kPeer, "sciencedirect.com"},
      {"G20", "https://engineering.stackexchange.com/q/1", kComm, "stackexchange"},
      {"G21", "https://www.reddit.com/r/engineering", kComm, "reddit"},
      {"G22", "https://forum.example.org/t/1", kComm, "'forum' still DOWNGRADES"},
      {"G23", "https://en.wikipedia.org/wiki/6061_aluminium_alloy", kInst, "wikipedia.org"},
      {"G24", "https://web.mit.edu/2.001/notes", kInst, ".edu"},
      {"G25", "https://www.esa.int/Science", kInst, "esa.int"},
      {"G26", "https://docs.skf.com/bearing.pdf", kMfr, "skf.com"},
      {"G27", "https://evil.example/6061", kSec, "an unknown domain gets no grant"},
      {"G28", "https://docs.example-machining.com/handbook/tolerances", kSec,
       "a 'docs.' subdomain of an unlisted vendor is not a manufacturer grant"},
      // A downgrade heuristic is allowed to stay a substring match: it can only
      // REMOVE standing. It must still read the real host, not the fragment.
      {"G29", "https://forum.evil.example#@iso.org/standard/1", kComm, "downgrade reads the real host"},
  };
  for (const auto& c : legit) runTier(c);

  // ── 6. publisher identity ─────────────────────────────────────────────────────
  // publisher feeds min_distinct_publishers and the corroboration rule. A parser
  // that takes the host from the fragment lets ONE attacker appear as iso.org, or
  // as several distinct publishers, and one name spelled two ways counts twice.
  std::cout << "\n== publisher identity ==\n";
  const std::vector<PublisherCase> publishers = {
      {"B01", "https://www.iso.org:443/a/b", "iso.org", "scheme, www and port stripped"},
      {"B02", "https://evil.example#@ecfr.gov/title-14", "evil.example", "not the fragment"},
      {"B03", "https://evil.example?@iso.org", "evil.example", "not the query"},
      {"B04", "https://evil.example\\@iso.org/standard/1", "evil.example", "backslash ends the authority"},
      {"B05", "https://ecfr.gov@evil.example/title-14", "evil.example", "not the userinfo"},
      {"B06", "https://iso.org./standard/1", "iso.org", "trailing dot is the same publisher"},
      {"B07", "HTTPS://WWW.ISO.ORG/standard/1", "iso.org", "case is the same publisher"},
      {"B08", "https://a@ecfr.gov@evil.example/", "evil.example", "the host follows the LAST '@'"},
  };
  for (const auto& c : publishers) runPublisher(c);

  std::cout << "\n" << g_pass << " passed, " << g_fail << " failed\n";
  return g_fail == 0 ? 0 : 1;
}
