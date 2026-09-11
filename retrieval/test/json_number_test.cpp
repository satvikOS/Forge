// The JSON number path, tested directly.
//
// parseNumber stopped using std::from_chars because its FLOATING-POINT overload
// is `= delete`d in the libc++ Xcode 16.4 ships -- which broke the CI build the
// first time anything compiled this file. The replacement must keep the original
// contract exactly, so the contract is asserted here rather than assumed: a token
// must parse, be consumed WHOLE, and be representable.
#include "forge/retrieval/Json.hpp"

#include <cmath>
#include <cstdio>
#include <string>

namespace {
int checks = 0, failures = 0;

void ck(const char* what, bool ok, const std::string& detail = {}) {
  ++checks;
  if (ok) { std::printf("  ok   %s\n", what); return; }
  ++failures;
  std::printf("  FAIL %s%s%s\n", what, detail.empty() ? "" : " -> ", detail.c_str());
}

bool parses(const char* text, double& out) {
  forge::retrieval::json::Value v;
  std::string err;
  if (!forge::retrieval::json::parse(text, v, err)) return false;
  if (!v.isNumber()) return false;
  out = v.number(0.0);
  return true;
}
}  // namespace

int main() {
  std::printf("== json number parsing ==\n");
  double d = 0.0;

  ck("an integer", parses("42", d) && d == 42.0);
  ck("a negative", parses("-7", d) && d == -7.0);
  ck("a fraction", parses("0.5", d) && d == 0.5);
  ck("a negative fraction", parses("-0.25", d) && d == -0.25);
  ck("an exponent", parses("1e3", d) && d == 1000.0);
  ck("a negative exponent", parses("2.5e-2", d) && std::fabs(d - 0.025) < 1e-12);
  ck("zero", parses("0", d) && d == 0.0);

  // the contract the old from_chars call enforced, and this must still
  ck("trailing garbage is REFUSED", !parses("1.5abc", d));
  ck("a bare minus is refused", !parses("-", d));
  ck("a leading plus is refused (JSON forbids it)", !parses("+1", d));
  ck("a bare dot is refused", !parses(".5", d));
  ck("an empty exponent is refused", !parses("1e", d));
  ck("overflow is refused rather than becoming inf",
     !parses("1e999", d) || std::isfinite(d));

  // a long but legal token must still work -- the replacement copies the token
  {
    std::string long_one = "0.";
    for (int i = 0; i < 300; ++i) long_one += "1";
    ck("a 300-digit fraction still parses", parses(long_one.c_str(), d) && d > 0.1 && d < 0.2);
  }

  std::printf("\n%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
